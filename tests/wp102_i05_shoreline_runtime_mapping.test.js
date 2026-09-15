const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const runtime = require('../js/shoreline_transition_runtime.js');
const semantics = JSON.parse(read('textures/tiles/shoreline/shoreline_tiles.semantics.json'));
const runtimeSource = read('js/shoreline_transition_runtime.js');
const utils = read('js/utils.js');
const compositor = read('js/static_tile_compositor.js');

assert.strictEqual(runtime.authority, 'presentation-only');
assert.strictEqual(semantics.family, 'shoreline');
assert.strictEqual(semantics.policy.compositionMode, 'opaque-base-transition');
assert.strictEqual(semantics.policy.rotationAllowed, false);
assert.strictEqual(semantics.tiles.length, 100);
assert.strictEqual(new Set(semantics.tiles.map((tile) => tile.id)).size, 100);
assert.strictEqual(runtime.semanticIndex('r00_c00'), 0);
assert.strictEqual(runtime.semanticIndex('r09_c09'), 99);
assert.strictEqual(runtime.semanticIndex('invalid'), -1);

const allWater = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'lake' })));
assert.strictEqual(runtime.selectTile(semantics, allWater, 2, 2), null, 'interior water must keep the normal water texture');
assert.strictEqual(runtime.selectTile(semantics, allWater, 0, 2), null, 'region edge must not invent a shoreline outside the local authoritative grid');

const northLand = allWater.map((row) => row.map((tile) => ({ ...tile })));
for (const col of [1, 2, 3]) northLand[1][col] = { type: 'grass' };
const target = runtime.buildTarget(northLand, 2, 2, semantics.policy);
assert.ok(target);
assert.strictEqual(target.edges[0], 'L');
assert.strictEqual(target.edges[2], 'W');
assert.strictEqual(target.edgeWater[0], 0);
assert.strictEqual(target.edgeWater[2], 1);
const first = runtime.selectTile(semantics, northLand, 2, 2);
const second = runtime.selectTile(semantics, northLand, 2, 2);
assert.ok(first && second);
assert.strictEqual(first.id, second.id, 'equivalent authoritative terrain must select the same shoreline tile');
assert.ok(first.tile.edgeWater[0] <= semantics.policy.landMaxWaterFraction, 'selected tile must preserve the definite north land edge');
assert.ok(first.tile.edgeWater[2] >= semantics.policy.waterMinWaterFraction, 'selected tile must preserve the definite south water edge');

const landCenter = northLand.map((row) => row.map((tile) => ({ ...tile })));
landCenter[2][2] = { type: 'grass' };
assert.strictEqual(runtime.selectTile(semantics, landCenter, 2, 2), null, 'shoreline replacement is limited to authoritative water cells');

assert.match(runtimeSource, /State && State\.world/);
assert.match(runtimeSource, /textureVariantImages && render\.textureVariantImages\.shoreline/);
assert.match(runtimeSource, /ctx\.drawImage\(image, 0, 0, 100, 100/);
assert.match(runtimeSource, /authority:\s*'presentation-only'/);
assert.match(runtimeSource, /rotationAllowed:\s*false/);
assert.ok(!runtimeSource.includes('.rotate('), 'shoreline source cells must never be rotated');
assert.ok(!/world\.terrain\s*=/.test(runtimeSource), 'presentation runtime must not replace authoritative terrain');
assert.ok(!/terrain\s*\[[^\]]+\]\s*\[[^\]]+\]\s*=/.test(runtimeSource), 'presentation runtime must not mutate authoritative terrain cells');

const shorelineLoad = utils.indexOf('js/shoreline_transition_runtime.js');
const compositorLoad = utils.indexOf('js/static_tile_compositor.js');
assert.ok(shorelineLoad >= 0 && compositorLoad >= 0 && shorelineLoad < compositorLoad, 'shoreline presentation must run before static compositor snapshots the rebuilt background');
assert.match(compositor, /COMPOSITE_TILE_PX\s*=\s*100/);
assert.match(compositor, /captureBaseSnapshot/);
assert.match(compositor, /static-background-plus-dynamic-npc-only/);

console.log('WP-102/I05 deterministic shoreline runtime mapping regression: PASS');
