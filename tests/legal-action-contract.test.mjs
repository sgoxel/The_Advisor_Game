import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGAL_ACTION_REASON_CODES,
  LEGAL_ACTION_REASON_ORDER,
  LEGAL_ACTION_VALIDATION_CONTRACT,
  createLegalActionReason,
  createLegalActionValidationInput,
  createSimulationLegalityResult,
  serializeLegalActionValidationInput,
} from '../js/legal-action-contract.js';

const BASE_INPUT = Object.freeze({
  candidateAction: Object.freeze({
    actionId: 'action.inspect_gate',
    targetId: 'gate-1',
  }),
  actor: Object.freeze({
    actorId: 'character-1',
    rank: 'peasant',
  }),
  context: Object.freeze({
    locationId: 'village-gate',
    turn: 4,
  }),
});

test('legal-action contract keeps legality simulation-owned and deterministic', () => {
  assert.equal(LEGAL_ACTION_VALIDATION_CONTRACT.version, 1);
  assert.equal(LEGAL_ACTION_VALIDATION_CONTRACT.authority, 'simulation');
  assert.equal(LEGAL_ACTION_VALIDATION_CONTRACT.callerCanForceLegality, false);
  assert.equal(LEGAL_ACTION_VALIDATION_CONTRACT.validationExecutesAction, false);
  assert.deepEqual(LEGAL_ACTION_VALIDATION_CONTRACT.resultStatuses, ['legal', 'blocked']);
  assert.ok(LEGAL_ACTION_VALIDATION_CONTRACT.forbiddenEntropy.includes('wall-clock time'));
  assert.ok(LEGAL_ACTION_VALIDATION_CONTRACT.forbiddenEntropy.includes('Math.random'));
  assert.ok(LEGAL_ACTION_VALIDATION_CONTRACT.forbiddenEntropy.includes('provider/model output'));
  assert.ok(LEGAL_ACTION_VALIDATION_CONTRACT.forbiddenEntropy.includes('presentation state'));
});

test('equivalent validation inputs serialize identically regardless of key order', () => {
  const first = serializeLegalActionValidationInput(BASE_INPUT);
  const second = serializeLegalActionValidationInput({
    context: { turn: 4, locationId: 'village-gate' },
    actor: { rank: 'peasant', actorId: 'character-1' },
    candidateAction: { targetId: 'gate-1', actionId: 'action.inspect_gate' },
  });

  assert.equal(first, second);
});

test('contract deterministically rejects missing or invalid action and actor identity', () => {
  assert.throws(
    () => createLegalActionValidationInput({ ...BASE_INPUT, candidateAction: {} }),
    /candidateAction\.actionId must be a non-empty string/
  );
  assert.throws(
    () => createLegalActionValidationInput({ ...BASE_INPUT, candidateAction: { actionId: '   ' } }),
    /candidateAction\.actionId must be a non-empty string/
  );
  assert.throws(
    () => createLegalActionValidationInput({ ...BASE_INPUT, actor: {} }),
    /actor\.actorId must be a non-empty string/
  );
  assert.throws(
    () => createLegalActionValidationInput({ ...BASE_INPUT, actor: { actorId: '' } }),
    /actor\.actorId must be a non-empty string/
  );
});

test('callers cannot inject legality, outcomes, forced results, or authority bypass state', () => {
  for (const [field, value] of [
    ['legal', true],
    ['legality', 'legal'],
    ['isLegal', true],
    ['desiredOutcome', 'success'],
    ['outcome', 'success'],
    ['forcedResult', 'legal'],
    ['forceResult', true],
    ['authorityOverride', 'king'],
    ['bypassAuthority', true],
    ['bypassValidation', true],
  ]) {
    assert.throws(
      () => createLegalActionValidationInput({ ...BASE_INPUT, [field]: value }),
      /unsupported fields/
    );
  }

  assert.throws(
    () => createLegalActionValidationInput({
      ...BASE_INPUT,
      context: { ...BASE_INPUT.context, authorityOverride: 'king' },
    }),
    /forbidden caller field: authorityOverride/
  );

  assert.throws(
    () => createLegalActionValidationInput({
      ...BASE_INPUT,
      candidateAction: { ...BASE_INPUT.candidateAction, desiredOutcome: 'legal' },
    }),
    /forbidden caller field: desiredOutcome/
  );
});

test('validation input accepts only finite plain deterministic data', () => {
  assert.throws(
    () => createLegalActionValidationInput({
      ...BASE_INPUT,
      context: { observedAt: new Date(0) },
    }),
    /plain deterministic data/
  );
  assert.throws(
    () => createLegalActionValidationInput({
      ...BASE_INPUT,
      context: { score: Number.NaN },
    }),
    /numbers must be finite/
  );
  assert.throws(
    () => createLegalActionValidationInput({
      ...BASE_INPUT,
      actor: { actorId: 'character-1', capability: undefined },
    }),
    /must not be undefined/
  );
});

test('reason taxonomy and ordering are stable and machine-readable', () => {
  assert.deepEqual(LEGAL_ACTION_REASON_ORDER, [
    'actor_authority_insufficient',
    'actor_capability_missing',
    'action_precondition_unmet',
  ]);

  assert.equal(
    LEGAL_ACTION_REASON_CODES.ACTOR_AUTHORITY_INSUFFICIENT,
    'actor_authority_insufficient'
  );
  assert.equal(
    LEGAL_ACTION_REASON_CODES.ACTOR_CAPABILITY_MISSING,
    'actor_capability_missing'
  );
  assert.equal(
    LEGAL_ACTION_REASON_CODES.ACTION_PRECONDITION_UNMET,
    'action_precondition_unmet'
  );
});

test('simulation legality results are immutable and reasons sort by stable taxonomy order', () => {
  const blocked = createSimulationLegalityResult([
    createLegalActionReason(LEGAL_ACTION_REASON_CODES.ACTION_PRECONDITION_UNMET, {
      requirementId: 'gate.is_open',
    }),
    createLegalActionReason(LEGAL_ACTION_REASON_CODES.ACTOR_AUTHORITY_INSUFFICIENT, {
      requiredAuthority: 'guard',
    }),
  ]);

  assert.equal(blocked.authority, 'simulation');
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(
    blocked.reasons.map((reason) => reason.code),
    ['actor_authority_insufficient', 'action_precondition_unmet']
  );
  assert.equal(Object.isFrozen(blocked), true);
  assert.equal(Object.isFrozen(blocked.reasons), true);
  assert.equal(Object.isFrozen(blocked.reasons[0]), true);
  assert.equal(Object.isFrozen(blocked.reasons[0].explanationData), true);

  const legal = createSimulationLegalityResult();
  assert.equal(legal.status, 'legal');
  assert.deepEqual(legal.reasons, []);
});

test('result factory rejects unsupported or duplicate reason codes', () => {
  assert.throws(
    () => createLegalActionReason('caller_forced_legal'),
    /unsupported legal-action reason code/
  );

  assert.throws(
    () => createSimulationLegalityResult([
      { code: LEGAL_ACTION_REASON_CODES.ACTOR_CAPABILITY_MISSING },
      { code: LEGAL_ACTION_REASON_CODES.ACTOR_CAPABILITY_MISSING },
    ]),
    /duplicate legal-action reason code/
  );
});
