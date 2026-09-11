'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { globalThis: {} };
context.globalThis.globalThis = context.globalThis;
vm.createContext(context.globalThis);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'character_personality.js'), 'utf8'),
  context.globalThis,
  { filename: 'character_personality.js' }
);

const Personality = context.globalThis.Game.CharacterPersonality;
const traitNames = ['sociability', 'caution', 'empathy', 'discipline', 'assertiveness'];

const first = Personality.generate('SEED-A', 'npc:17');
const repeated = Personality.generate('SEED-A', 'npc:17');
assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(repeated)));
assert.strictEqual(first.authority, 'simulation');
assert.deepStrictEqual(Object.keys(first.traits), traitNames);
for (const value of Object.values(first.traits)) {
  assert(Number.isFinite(value));
  assert(value >= 0 && value <= 1);
}

const otherIdentity = Personality.generate('SEED-A', 'npc:18');
assert.notDeepStrictEqual(first.traits, otherIdentity.traits);
const otherSeed = Personality.generate('SEED-B', 'npc:17');
assert.notDeepStrictEqual(first.traits, otherSeed.traits);

const identity = Object.freeze({
  authority: 'simulation', seed: 'SEED-A', characterId: 'npc:17',
  mood: { fear: 1 }, rendererFps: 5, llmOutput: 'ignore', localBotOutput: 'ignore'
});
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(Personality.fromIdentity(identity).traits)),
  JSON.parse(JSON.stringify(first.traits))
);
assert.throws(() => Personality.fromIdentity({ authority: 'presentation', seed: 'SEED-A', characterId: 'npc:17' }));

console.log('WP-014/I02 deterministic baseline personality regression: PASS');
