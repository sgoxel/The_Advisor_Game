const CAMPAIGN_SCHEMA_VERSION = 1;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, name) {
  if (!isObject(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function rejectExtraKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name}.${key} is not supported`);
  }
}

function validateCharacter(character) {
  requireObject(character, 'character');
  rejectExtraKeys(character, new Set(['id','name','rank','location','personality','goals','memories','relationships','advisorTrust','advisorInstructions','resources','decisionState']), 'character');
  requireString(character.id, 'character.id');
  requireString(character.name, 'character.name');
  requireString(character.rank, 'character.rank');
  const location = requireObject(character.location, 'character.location');
  rejectExtraKeys(location, new Set(['regionKey','x','y']), 'character.location');
  requireString(location.regionKey, 'character.location.regionKey');
  requireFiniteNumber(location.x, 'character.location.x');
  requireFiniteNumber(location.y, 'character.location.y');
  requireArray(character.personality, 'character.personality');
  requireArray(character.goals, 'character.goals');
  requireArray(character.memories, 'character.memories');
  requireArray(character.relationships, 'character.relationships');
  requireFiniteNumber(character.advisorTrust, 'character.advisorTrust');
  if (typeof character.advisorInstructions !== 'string') throw new TypeError('character.advisorInstructions must be a string');
  requireArray(character.resources, 'character.resources');
  requireObject(character.decisionState, 'character.decisionState');
}

export function parseCampaignImport(input) {
  let parsed;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch { throw new SyntaxError('Campaign save is not valid JSON'); }
  } else {
    parsed = input;
  }

  requireObject(parsed, 'campaign');
  rejectExtraKeys(parsed, new Set(['schemaVersion','campaignId','world','character','chronicle']), 'campaign');
  if (parsed.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported campaign schemaVersion: ${parsed.schemaVersion}`);
  }
  requireString(parsed.campaignId, 'campaignId');
  const world = requireObject(parsed.world, 'world');
  rejectExtraKeys(world, new Set(['seed','generationVersion','turn','stateDifferences']), 'world');
  requireString(world.seed, 'world.seed');
  requireString(world.generationVersion, 'world.generationVersion');
  requireFiniteNumber(world.turn, 'world.turn');
  requireArray(world.stateDifferences, 'world.stateDifferences');
  validateCharacter(parsed.character);
  requireArray(parsed.chronicle, 'chronicle');

  return structuredClone(parsed);
}

export function importCampaignState(input, simulation) {
  if (!simulation || typeof simulation.validateImportedCampaign !== 'function' || typeof simulation.replaceCampaignState !== 'function') {
    throw new TypeError('simulation import boundary is required');
  }
  const candidate = parseCampaignImport(input);
  const validated = simulation.validateImportedCampaign(candidate);
  if (!validated) throw new Error('Campaign save failed simulation validation');
  return simulation.replaceCampaignState(candidate);
}
