import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeterministicRng,
  deriveDeterministicSeed,
} from '../js/deterministic-rng.js';

function baseInput(overrides = {}) {
  return {
    worldSeed: 'ADVISOR-P02-SEED',
    generationVersion: 'worldgen-1',
    checkId: 'forage-check-1',
    context: {
      regionKey: '0,0',
      actorId: 'character-1',
      difficulty: 12,
    },
    ...overrides,
  };
}

function takeSequence(input, count = 6) {
  const rng = createDeterministicRng(input);
  return Array.from({ length: count }, () => rng.nextUint32());
}

test('same deterministic inputs reproduce the same uint32 sequence', () => {
  assert.deepEqual(takeSequence(baseInput()), takeSequence(baseInput()));
});

test('canonical context key order produces the same seed and sequence', () => {
  const first = baseInput({
    context: { regionKey: '0,0', actorId: 'character-1', difficulty: 12 },
  });
  const second = baseInput({
    context: { difficulty: 12, actorId: 'character-1', regionKey: '0,0' },
  });

  assert.equal(deriveDeterministicSeed(first), deriveDeterministicSeed(second));
  assert.deepEqual(takeSequence(first), takeSequence(second));
});

test('distinct deterministic seed or context can produce distinct sequences', () => {
  const baseline = takeSequence(baseInput());
  const changedWorldSeed = takeSequence(baseInput({ worldSeed: 'ADVISOR-P02-OTHER' }));
  const changedContext = takeSequence(baseInput({
    context: { regionKey: '0,0', actorId: 'character-1', difficulty: 13 },
  }));

  assert.notDeepEqual(changedWorldSeed, baseline);
  assert.notDeepEqual(changedContext, baseline);
});

test('nextFloat is stable and always within [0, 1)', () => {
  const first = createDeterministicRng(baseInput());
  const second = createDeterministicRng(baseInput());

  const firstValues = Array.from({ length: 8 }, () => first.nextFloat());
  const secondValues = Array.from({ length: 8 }, () => second.nextFloat());

  assert.deepEqual(firstValues, secondValues);
  for (const value of firstValues) {
    assert.equal(Number.isFinite(value), true);
    assert.equal(value >= 0 && value < 1, true);
  }
});

test('RNG rejects entropy fields not permitted by the seeded-check contract', () => {
  assert.throws(
    () => createDeterministicRng({ ...baseInput(), timestamp: Date.now() }),
    /unsupported fields/,
  );
  assert.throws(
    () => createDeterministicRng({ ...baseInput(), desiredOutcome: 'success' }),
    /unsupported fields/,
  );
});
