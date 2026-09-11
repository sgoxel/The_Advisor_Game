const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const sandbox = { globalThis: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const path of ['js/character_personality.js', 'js/character_personality_context.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox, { filename: path });
}

const baseline = sandbox.Game.CharacterPersonality.generate('seed-a', 'char-a');
const before = JSON.stringify(baseline);
const context = Object.freeze({
  authority: 'simulation', danger: 0.8, injury: 0.2, fatigue: 0.4,
  hunger: 0.3, safety: 0.2, relationshipTrust: 0.7, dutyPressure: 0.6
});
const derive = sandbox.Game.CharacterPersonalityContext.derive;
const first = derive(baseline, context);
const second = derive(baseline, context);
assert.strictEqual(JSON.stringify(first), JSON.stringify(second), 'derivation must be deterministic');
assert.strictEqual(JSON.stringify(baseline), before, 'baseline must remain unchanged');
for (const value of Object.values(first.traits)) assert(value >= 0 && value <= 1, 'traits must remain bounded');
assert(Object.isFrozen(first) && Object.isFrozen(first.traits), 'payload and traits must be immutable');
const neutral = derive(baseline);
for (const value of Object.values(neutral.traits)) assert(value >= 0 && value <= 1);
assert.throws(() => derive(baseline, { authority: 'renderer', danger: 1 }), /Simulation-backed/);
assert.throws(() => derive({ authority: 'ui', traits: baseline.traits }, context), /Simulation-backed/);
const noisy = derive(baseline, Object.freeze({ authority: 'simulation', danger: 5, injury: -2, fatigue: NaN }));
for (const value of Object.values(noisy.traits)) assert(value >= 0 && value <= 1);
console.log('WP-014/I03 contextual personality regression: PASS');
