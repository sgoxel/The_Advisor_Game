const assert = require('assert');
require('../js/character_personality_advice_weight.js');

const weight = global.Game.CharacterPersonalityAdviceWeight;

function personality(traits) {
  return { authority: 'simulation', characterId: 'test-character', traits };
}

const cautious = personality({ sociability: 0.5, caution: 0.95, empathy: 0.5, discipline: 0.5, assertiveness: 0.5 });
const reckless = personality({ sociability: 0.5, caution: 0.05, empathy: 0.5, discipline: 0.5, assertiveness: 0.5 });
const safeAdvice = { safety: 1 };

const a = weight.evaluate(cautious, safeAdvice);
const b = weight.evaluate(cautious, safeAdvice);
assert.deepStrictEqual(a, b, 'Equivalent inputs must be deterministic.');
assert(a.influence >= 0 && a.influence <= 1);
assert(a.multiplier >= 0.75 && a.multiplier <= 1.25);
assert(Number.isFinite(a.influence) && Number.isFinite(a.multiplier));

const c = weight.evaluate(reckless, safeAdvice);
assert.notStrictEqual(a.influence, c.influence, 'Materially different traits must affect otherwise equivalent advice.');

const neutral = weight.evaluate(personality({ sociability: 0.5, caution: 0.5, empathy: 0.5, discipline: 0.5, assertiveness: 0.5 }));
assert.strictEqual(neutral.influence, 0.5, 'Missing metadata must be neutral.');
assert.deepStrictEqual(neutral.adviceMetadata, { social: 0.5, safety: 0.5, prosocial: 0.5, duty: 0.5, initiative: 0.5 });
assert.strictEqual(neutral.authoritative, false);
assert.strictEqual(neutral.authority, 'character-decision-input');
assert.strictEqual(neutral.sourceAuthority, 'simulation');

const input = personality({ sociability: 0.2, caution: 0.3, empathy: 0.4, discipline: 0.5, assertiveness: 0.6 });
const before = JSON.stringify(input);
weight.evaluate(input, { social: NaN, safety: Infinity, prosocial: -1, duty: 2, initiative: 'bad' });
assert.strictEqual(JSON.stringify(input), before, 'Weighting must not mutate Simulation-backed personality input.');

assert.throws(() => weight.evaluate({ authority: 'renderer', traits: cautious.traits }, safeAdvice), /Simulation-backed/);
assert.throws(() => weight.evaluate(personality({ ...cautious.traits, caution: Infinity }), safeAdvice), /0\.0\.\.1\.0/);

console.log('WP-014/I04 personality advice weighting regression: PASS');
