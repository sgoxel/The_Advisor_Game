export const SEEDED_CHECK_CONTRACT = Object.freeze({
  version: 1,
  authority: 'simulation',
  deterministicInputs: Object.freeze([
    'worldSeed',
    'generationVersion',
    'checkId',
    'context',
  ]),
  forbiddenEntropy: Object.freeze([
    'wall-clock time',
    'Math.random',
    'ambient randomness',
    'provider/model output',
    'UI-selected result',
  ]),
  rule: 'Identical compatible deterministic inputs must resolve to the same RNG value and seeded-check result.',
  uiCanForceOutcome: false,
});

const ALLOWED_INPUT_KEYS = new Set([
  'worldSeed',
  'generationVersion',
  'checkId',
  'context',
]);

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function canonicalize(value, path = 'context') {
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
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain deterministic data`);
    }

    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw new TypeError(`${path}.${key} must not be undefined`);
      }
      result[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return result;
  }

  throw new TypeError(`${path} contains unsupported nondeterministic data`);
}

export function createSeededCheckInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('seeded-check input must be an object');
  }

  const unknownKeys = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`seeded-check input contains unsupported fields: ${unknownKeys.join(', ')}`);
  }

  assertNonEmptyString(input.worldSeed, 'worldSeed');
  assertNonEmptyString(input.generationVersion, 'generationVersion');
  assertNonEmptyString(input.checkId, 'checkId');

  return Object.freeze({
    contractVersion: SEEDED_CHECK_CONTRACT.version,
    worldSeed: input.worldSeed,
    generationVersion: input.generationVersion,
    checkId: input.checkId,
    context: Object.freeze(canonicalize(input.context ?? {})),
  });
}

export function serializeSeededCheckInput(input) {
  const normalized = createSeededCheckInput(input);
  return JSON.stringify(normalized);
}
