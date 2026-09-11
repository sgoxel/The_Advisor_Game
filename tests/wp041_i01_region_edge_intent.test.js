'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '../js/region_transition_intent.js'), 'utf8');
const sandbox = { globalThis: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'region_transition_intent.js' });

const api = sandbox.Game.RegionTransitionIntent;
assert(api && typeof api.detect === 'function', 'RegionTransitionIntent.detect must be installed');

function world(row, col, regionX = 0, regionY = 0) {
  return {
    rows: 100,
    cols: 100,
    currentRegion: { x: regionX, y: regionY },
    protagonist: { id: 'protagonist:main' },
    player: { id: 'protagonist:main', row, col, regionX, regionY }
  };
}

const cases = [
  ['north', world(0, 50, 2, -3), { x: 0, y: -1 }, 'south'],
  ['east', world(40, 99, 2, -3), { x: 1, y: 0 }, 'west'],
  ['south', world(99, 20, 2, -3), { x: 0, y: 1 }, 'north'],
  ['west', world(75, 0, 2, -3), { x: -1, y: 0 }, 'east']
];

for (const [direction, input, delta, entryEdge] of cases) {
  const before = JSON.stringify(input);
  const result = api.detect(input, direction);
  assert(result, `${direction} edge crossing should produce an intent`);
  assert.strictEqual(result.type, 'adjacent-region-crossing-intent');
  assert.strictEqual(result.authority, 'simulation-request');
  assert.strictEqual(result.direction, direction);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.fromRegion)), { x: 2, y: -3 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.regionDelta)), delta);
  assert.strictEqual(result.requestedEntryEdge, entryEdge);
  assert.strictEqual(result.directWorldMutation, false);
  assert.strictEqual(JSON.stringify(input), before, 'Detection must not mutate authoritative world state');
}

assert.strictEqual(api.detect(world(50, 50), 'north'), null, 'Interior north movement must not request region travel');
assert.strictEqual(api.detect(world(50, 50), 'east'), null, 'Interior east movement must not request region travel');
assert.strictEqual(api.detect(world(50, 50), 'south'), null, 'Interior south movement must not request region travel');
assert.strictEqual(api.detect(world(50, 50), 'west'), null, 'Interior west movement must not request region travel');
assert.strictEqual(api.detect(world(0, 0), 'invalid'), null, 'Unknown direction must not request region travel');

const rendererNoiseWorld = world(0, 10, 5, 6);
rendererNoiseWorld.renderer = { fps: 7, canvasWidth: 99999, domOrder: 123 };
const a = api.detect(rendererNoiseWorld, 'north');
rendererNoiseWorld.renderer = { fps: 240, canvasWidth: 1, domOrder: 0 };
const b = api.detect(rendererNoiseWorld, 'north');
assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), 'Renderer state must not affect authoritative edge intent');

console.log('WP-041/I01 authoritative region-edge crossing intent: PASS');
