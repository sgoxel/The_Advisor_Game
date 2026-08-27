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

test('deterministic context variation remains stable across repeated construction', () => {
  const changed = baseInput({
    checkId: 'forage-check-2',
    context: { regionKey: '1,-2', actorId: 'character-1', difficulty: 13 },
  });

  const expectedSeed = deriveDeterministicSeed(changed);
  const expectedSequence = takeSequence(changed, 12);

  for (let repetition = 0; repetition < 5; repetition += 1) {
    assert.equal(deriveDeterministicSeed(changed), expectedSeed);
    assert.deepEqual(takeSequence(changed, 12), expectedSequence);
  }
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

test('interleaved RNG instances do not share ambient or mutable generator state', () => {
  const input = baseInput();
  const expected = takeSequence(input, 4);
  const first = createDeterministicRng(input);
  const second = createDeterministicRng(input);

  assert.equal(first.nextUint32(), expected[0]);
  assert.equal(second.nextUint32(), expected[0]);
  assert.equal(first.nextUint32(), expected[1]);
  assert.equal(second.nextUint32(), expected[1]);
  assert.equal(first.nextUint32(), expected[2]);
  assert.equal(second.nextUint32(), expected[2]);
  assert.equal(first.nextUint32(), expected[3]);
  assert.equal(second.nextUint32(), expected[3]);
});

test('RNG rejects entropy fields not permitted by the seeded-check contract', () => {
  for (const [field, value] of [
    ['timestamp', Date.now()],
    ['desiredOutcome', 'success'],
    ['randomValue', Math.random()],
    ['providerOutput', 'success'],
  ]) {
    assert.throws(
      () => createDeterministicRng({ ...baseInput(), [field]: value }),
      /unsupported fields/,
    );
  }
});

test('RNG rejects nondeterministic or non-finite nested context before drawing', () => {
  assert.throws(
    () => createDeterministicRng(baseInput({ context: { callback() {} } })),
    /unsupported nondeterministic data/,
  );
  assert.throws(
    () => createDeterministicRng(baseInput({ context: { difficulty: Number.POSITIVE_INFINITY } })),
    /numbers must be finite/,
  );
});
