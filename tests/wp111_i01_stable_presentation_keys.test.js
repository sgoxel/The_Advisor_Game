'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'presentation_identity.js'), 'utf8');
const context = { Game: {} };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'presentation_identity.js' });

const identity = context.Game.PresentationIdentity;
assert(identity, 'PresentationIdentity must install');
assert.strictEqual(identity.authority, 'presentation-only');

const npcA = Object.freeze({ id: 'npc-17', row: 4, col: 8, activity: 'home' });
const npcB = Object.freeze({ id: 'npc-29', row: 9, col: 3, activity: 'work' });
const beforeA = JSON.stringify(npcA);
const beforeB = JSON.stringify(npcB);

const firstOrder = [npcA, npcB].map(identity.npc);
const secondOrder = [npcB, npcA].map(identity.npc);
assert.deepStrictEqual(firstOrder, ['npc:npc-17', 'npc:npc-29']);
assert.deepStrictEqual(secondOrder, ['npc:npc-29', 'npc:npc-17']);
assert.strictEqual(identity.npc(npcA), firstOrder[0], 'same NPC must retain the same key across refresh/reorder');
assert.strictEqual(identity.npc(npcB), firstOrder[1], 'same NPC must retain the same key across refresh/reorder');

const recreatedA = Object.freeze({ id: 'npc-17', row: 5, col: 8, activity: 'commuting' });
assert.strictEqual(identity.npc(recreatedA), identity.npc(npcA), 'object recreation must not change presentation identity');
assert.strictEqual(identity.protagonist({ id: 'hero-1', row: 1, col: 1 }), 'protagonist:hero-1');
assert.strictEqual(identity.worldObject({ objectId: 'well:center' }), 'world-object:well:center');
assert.strictEqual(identity.npc({}), null, 'missing authoritative identity must not fabricate a key');
assert.strictEqual(identity.worldObject({}), null, 'missing authoritative identity must not fabricate a key');
assert.strictEqual(JSON.stringify(npcA), beforeA, 'keying must not mutate NPC state');
assert.strictEqual(JSON.stringify(npcB), beforeB, 'keying must not mutate NPC state');

const motionSource = fs.readFileSync(path.join(root, 'js', 'npc_motion_presentation.js'), 'utf8');
assert(/motions\.get\(npc\.id\)/.test(motionSource), 'NPC motion reconciliation must be keyed by stable NPC id, not array index');
assert(/motions\.set\(npc\.id/.test(motionSource), 'NPC motion state must reuse stable NPC id');
assert(!/motions\.get\(index\)|motions\.set\(index/.test(motionSource), 'NPC motion state must not use render/iteration index');

const utilsSource = fs.readFileSync(path.join(root, 'js', 'utils.js'), 'utf8');
const identityLoad = utilsSource.indexOf('js/presentation_identity.js');
const npcWorldLoad = utilsSource.indexOf('js/npc_world.js');
const objectLoad = utilsSource.indexOf('js/world_object_renderer.js');
assert(identityLoad >= 0 && identityLoad < npcWorldLoad && identityLoad < objectLoad, 'stable identity resolver must load before visible entity renderers');

console.log('PASS WP-111/I01 stable presentation keys');
