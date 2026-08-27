import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSeededSimulationCheck } from '../js/seeded-check-resolution.js';

function baseInput(overrides = {}) {
  return {
    worldSeed: 'KINGDOM-ALPHA',
    generationVersion: 'worldgen-1',
    checkId: 'forage-check',
    context: {
      turn: 12,
      actorId: 'character-1',
      regionKey: '0,0',
      difficulty: 45,
    },
    ...overrides,
  };
}

test('same deterministic input reproduces the same authoritative check result', () => {
  const first = resolveSeededSimulationCheck(baseInput());
  const second = resolveSeededSimulationCheck(baseInput());

  assert.deepEqual(first, second);
  assert.equal(first.authority, 'simulation');
  assert.equal(first.checkId, 'forage-check');
  assert.equal(Number.isInteger(first.rollUint32), true);
  assert.equal(first.unitRoll >= 0 && first.unitRoll < 1, true);
  assert.equal(first.percentile >= 1 && first.percentile <= 100, true);
});

test('canonical context key ordering does not change the result', () => {
  const first = resolveSeededSimulationCheck(baseInput({
    context: { turn: 12, actorId: 'character-1', regionKey: '0,0', difficulty: 45 },
  }));
  const second = resolveSeededSimulationCheck(baseInput({
    context: { difficulty: 45, regionKey: '0,0', actorId: 'character-1', turn: 12 },
  }));

  assert.deepEqual(first, second);
});

test('changed deterministic context can change the resolved result and remains repeatable', () => {
  const first = resolveSeededSimulationCheck(baseInput());
  const changedInput = baseInput({
    context: { turn: 13, actorId: 'character-1', regionKey: '0,0', difficulty: 45 },
  });
  const changed = resolveSeededSimulationCheck(changedInput);

  assert.notEqual(first.rollUint32, changed.rollUint32);
  assert.deepEqual(changed, resolveSeededSimulationCheck(changedInput));
});

test('player or UI cannot submit a desired authoritative outcome', () => {
  for (const forbiddenField of [
    ['desiredResult', 'success'],
    ['desiredOutcome', 'success'],
    ['forcedResult', true],
    ['success', true],
    ['roll', 100],
    ['rollUint32', 0xffffffff],
    ['unitRoll', 0.999],
    ['percentile', 100],
  ]) {
    const [key, value] = forbiddenField;
    assert.throws(
      () => resolveSeededSimulationCheck({ ...baseInput(), [key]: value }),
      /unsupported fields/,
    );
  }
});

test('ambient entropy fields are rejected before resolution', () => {
  for (const [field, value] of [
    ['timestamp', Date.now()],
    ['randomValue', Math.random()],
    ['providerOutput', 'model says success'],
  ]) {
    assert.throws(
      () => resolveSeededSimulationCheck({ ...baseInput(), [field]: value }),
      /unsupported fields/,
    );
  }
});

test('invalid or nondeterministic context data is rejected before resolution', () => {
  assert.throws(
    () => resolveSeededSimulationCheck(baseInput({ context: { turn: Number.NaN } })),
    /numbers must be finite/,
  );
  assert.throws(
    () => resolveSeededSimulationCheck(baseInput({ context: { callback() {} } })),
    /unsupported nondeterministic data/,
  );
});

test('result is immutable and contains no direct state mutation command', () => {
  const result = resolveSeededSimulationCheck(baseInput());
  assert.equal(Object.isFrozen(result), true);
  assert.equal('statePatch' in result, false);
  assert.equal('desiredResult' in result, false);
  assert.equal('legalAction' in result, false);
});
