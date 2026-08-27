export const LEGAL_ACTION_REASON_CODES = Object.freeze({
  ACTOR_AUTHORITY_INSUFFICIENT: 'actor_authority_insufficient',
  ACTOR_CAPABILITY_MISSING: 'actor_capability_missing',
  ACTION_PRECONDITION_UNMET: 'action_precondition_unmet',
});

export const LEGAL_ACTION_REASON_ORDER = Object.freeze([
  LEGAL_ACTION_REASON_CODES.ACTOR_AUTHORITY_INSUFFICIENT,
  LEGAL_ACTION_REASON_CODES.ACTOR_CAPABILITY_MISSING,
  LEGAL_ACTION_REASON_CODES.ACTION_PRECONDITION_UNMET,
]);

export const LEGAL_ACTION_VALIDATION_CONTRACT = Object.freeze({
  version: 1,
  authority: 'simulation',
  deterministicInputs: Object.freeze([
    'candidateAction',
    'actor',
    'context',
  ]),
  resultStatuses: Object.freeze(['legal', 'blocked']),
  forbiddenCallerFields: Object.freeze([
    'legal',
    'legality',
    'isLegal',
    'desiredOutcome',
    'outcome',
    'forcedResult',
    'forceResult',
    'authorityOverride',
    'bypassAuthority',
    'bypassValidation',
  ]),
  forbiddenEntropy: Object.freeze([
    'wall-clock time',
    'Math.random',
    'ambient randomness',
    'provider/model output',
    'presentation state',
  ]),
  rule: 'Legality is derived only from explicit deterministic simulation-owned validation inputs; validation does not choose, execute, or resolve an action.',
  callerCanForceLegality: false,
  validationExecutesAction: false,
});

const TOP_LEVEL_INPUT_KEYS = new Set(['candidateAction', 'actor', 'context']);
const FORBIDDEN_FIELD_NAMES = new Set(LEGAL_ACTION_VALIDATION_CONTRACT.forbiddenCallerFields);
const REASON_ORDER_INDEX = new Map(
  LEGAL_ACTION_REASON_ORDER.map((code, index) => [code, index])
);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must contain only plain deterministic data`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function canonicalize(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} numbers must be finite`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => canonicalize(item, `${path}[${index}]`))
    );
  }

  if (typeof value === 'object' && value !== null) {
    assertPlainObject(value, path);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) {
        throw new TypeError(`${path} contains forbidden caller field: ${key}`);
      }
      if (value[key] === undefined) {
        throw new TypeError(`${path}.${key} must not be undefined`);
      }
      result[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return Object.freeze(result);
  }

  throw new TypeError(`${path} contains unsupported nondeterministic data`);
}

function normalizeCandidateAction(candidateAction) {
  assertPlainObject(candidateAction, 'candidateAction');
  assertNonEmptyString(candidateAction.actionId, 'candidateAction.actionId');
  return canonicalize(candidateAction, 'candidateAction');
}

function normalizeActor(actor) {
  assertPlainObject(actor, 'actor');
  assertNonEmptyString(actor.actorId, 'actor.actorId');
  return canonicalize(actor, 'actor');
}

export function createLegalActionValidationInput(input) {
  assertPlainObject(input, 'legal-action validation input');

  const unknownKeys = Object.keys(input).filter((key) => !TOP_LEVEL_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(
      `legal-action validation input contains unsupported fields: ${unknownKeys.join(', ')}`
    );
  }

  const candidateAction = normalizeCandidateAction(input.candidateAction);
  const actor = normalizeActor(input.actor);
  const context = canonicalize(input.context ?? {}, 'context');

  return Object.freeze({
    contractVersion: LEGAL_ACTION_VALIDATION_CONTRACT.version,
    candidateAction,
    actor,
    context,
  });
}

export function serializeLegalActionValidationInput(input) {
  return JSON.stringify(createLegalActionValidationInput(input));
}

export function createLegalActionReason(code, explanationData = {}) {
  if (!REASON_ORDER_INDEX.has(code)) {
    throw new TypeError(`unsupported legal-action reason code: ${code}`);
  }

  return Object.freeze({
    code,
    explanationData: canonicalize(explanationData, `reason.${code}.explanationData`),
  });
}

export function createSimulationLegalityResult(reasons = []) {
  if (!Array.isArray(reasons)) {
    throw new TypeError('legality reasons must be an array');
  }

  const normalizedReasons = reasons.map((reason) => {
    if (!reason || typeof reason !== 'object' || Array.isArray(reason)) {
      throw new TypeError('each legality reason must be an object');
    }
    return createLegalActionReason(reason.code, reason.explanationData ?? {});
  });

  normalizedReasons.sort(
    (left, right) => REASON_ORDER_INDEX.get(left.code) - REASON_ORDER_INDEX.get(right.code)
  );

  const duplicate = normalizedReasons.find(
    (reason, index) => index > 0 && reason.code === normalizedReasons[index - 1].code
  );
  if (duplicate) {
    throw new TypeError(`duplicate legal-action reason code: ${duplicate.code}`);
  }

  return Object.freeze({
    contractVersion: LEGAL_ACTION_VALIDATION_CONTRACT.version,
    authority: LEGAL_ACTION_VALIDATION_CONTRACT.authority,
    status: normalizedReasons.length === 0 ? 'legal' : 'blocked',
    reasons: Object.freeze(normalizedReasons),
  });
}
