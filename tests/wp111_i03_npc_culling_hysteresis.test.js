const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.resolve(__dirname, '../js/npc_culling_hysteresis.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const context = {
  console,
  Math,
  Number,
  String,
  Set,
  Map,
  Object,
  Date,
  globalThis: null,
  setInterval(callback) {
    // The pure culling contract is tested without installing a runtime renderer.
    return { callback };
  },
  clearInterval() {},
  setTimeout(callback) { callback(); }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: sourcePath });

const api = context.Game.NPCCullingHysteresis;
assert(api, 'culling hysteresis API must install');
assert.strictEqual(api.authority, 'presentation-only');
assert(api.exitMarginPx > api.enterMarginPx, 'exit margin must be larger than enter margin');
assert(api.exitMarginPx <= 64, 'exit margin must remain bounded');

const scale = Object.freeze({ width: 40, height: 50 });
const viewport = Object.freeze({ width: 800, height: 600 });

// A new entity just outside the entry boundary must stay culled.
const edgePoint = Object.freeze({ x: -25, y: 300 });
assert.strictEqual(api.shouldPresent('npc:a', edgePoint, scale, viewport.width, viewport.height, false), false);

// The same already-presented entity stays alive through the bounded hysteresis band.
assert.strictEqual(api.shouldPresent('npc:a', edgePoint, scale, viewport.width, viewport.height, true), true);

// Once it leaves the wider exit band it is actually culled.
const farPoint = Object.freeze({ x: -60, y: 300 });
assert.strictEqual(api.shouldPresent('npc:a', farPoint, scale, viewport.width, viewport.height, true), false);

// Screen coordinates are evaluated, never replaced with a viewport-edge clamp position.
const before = JSON.stringify(edgePoint);
api.shouldPresent('npc:a', edgePoint, scale, viewport.width, viewport.height, true);
assert.strictEqual(JSON.stringify(edgePoint), before, 'culling must not mutate presentation coordinates');

// Authoritative world coordinates are not inputs to or outputs from the culling decision.
const authoritativeNpc = Object.freeze({ id: 'npc-a', row: 12, col: 34 });
const authoritativeBefore = JSON.stringify(authoritativeNpc);
api.shouldPresent('npc:npc-a', { x: 100, y: 100 }, scale, viewport.width, viewport.height, false);
assert.strictEqual(JSON.stringify(authoritativeNpc), authoritativeBefore, 'culling must not mutate Simulation state');

// Boundary churn regression: enter -> slight outside -> slight inside retains continuously,
// while a truly far excursion clears presentation eligibility.
const sequence = [
  { point: { x: 10, y: 300 }, expected: true },
  { point: { x: -25, y: 300 }, expected: true },
  { point: { x: -18, y: 300 }, expected: true },
  { point: { x: 8, y: 300 }, expected: true },
  { point: { x: -60, y: 300 }, expected: false }
];
let presented = false;
for (const step of sequence) {
  presented = api.shouldPresent('npc:a', step.point, scale, viewport.width, viewport.height, presented);
  assert.strictEqual(presented, step.expected);
}

console.log('PASS WP-111/I03 bounded NPC culling hysteresis');
