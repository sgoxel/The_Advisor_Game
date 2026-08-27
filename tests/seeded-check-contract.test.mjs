import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEEDED_CHECK_CONTRACT,
  createSeededCheckInput,
  serializeSeededCheckInput,
} from '../js/seeded-check-contract.js';

const BASE_INPUT = Object.freeze({
  worldSeed: 'ADVISOR-P01-DEMO',
  generationVersion: 'worldgen-1',
  checkId: 'example.check',
  context: Object.freeze({
    actorId: 'character-1',
    difficulty: 12,
    turn: 1,
  }),
});

test('seeded-check contract keeps authoritative resolution simulation-owned', () => {
  assert.equal(SEEDED_CHECK_CONTRACT.version, 1);
  assert.equal(SEEDED_CHECK_CONTRACT.authority, 'simulation');
  assert.equal(SEEDED_CHECK_CONTRACT.uiCanForceOutcome, false);
  assert.match(SEEDED_CHECK_CONTRACT.rule, /Identical compatible deterministic inputs/);
  assert.ok(SEEDED_CHECK_CONTRACT.forbiddenEntropy.includes('wall-clock time'));
  assert.ok(SEEDED_CHECK_CONTRACT.forbiddenEntropy.includes('Math.random'));
  assert.ok(SEEDED_CHECK_CONTRACT.forbiddenEntropy.includes('provider/model output'));
});

test('equivalent deterministic inputs serialize identically regardless of object key order', () => {
  const first = serializeSeededCheckInput(BASE_INPUT);
  const second = serializeSeededCheckInput({
    checkId: 'example.check',
    generationVersion: 'worldgen-1',
    worldSeed: 'ADVISOR-P01-DEMO',
    context: {
      turn: 1,
      difficulty: 12,
      actorId: 'character-1',
    },
  });

  assert.equal(first, second);
});

test('changed deterministic identity or context changes serialized input', () => {
  const base = serializeSeededCheckInput(BASE_INPUT);

  assert.notEqual(
    base,
    serializeSeededCheckInput({ ...BASE_INPUT, worldSeed: 'DIFFERENT-SEED' })
  );
  assert.notEqual(
    base,
    serializeSeededCheckInput({ ...BASE_INPUT, checkId: 'different.check' })
  );
  assert.notEqual(
    base,
    serializeSeededCheckInput({ ...BASE_INPUT, context: { ...BASE_INPUT.context, turn: 2 } })
  );
});

test('contract rejects top-level fields that could bypass deterministic authority', () => {
  for (const [field, value] of [
    ['desiredOutcome', 'success'],
    ['forcedResult', true],
    ['timestamp', Date.now()],
    ['randomValue', 0.5],
    ['providerOutput', 'success'],
  ]) {
    assert.throws(
      () => createSeededCheckInput({ ...BASE_INPUT, [field]: value }),
      /unsupported fields/
    );
  }
});

test('contract accepts only JSON-like finite deterministic context data', () => {
  assert.throws(
    () => createSeededCheckInput({ ...BASE_INPUT, context: { when: new Date(0) } }),
    /plain deterministic data/
  );
  assert.throws(
    () => createSeededCheckInput({ ...BASE_INPUT, context: { score: Number.NaN } }),
    /numbers must be finite/
  );
  assert.throws(
    () => createSeededCheckInput({ ...BASE_INPUT, context: { missing: undefined } }),
    /must not be undefined/
  );
});
