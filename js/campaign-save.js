const CAMPAIGN_SCHEMA_VERSION = 1;

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
}

function copyStateDifference(entry) {
  requireObject(entry, 'world.stateDifferences[]');
  const copy = {
    regionKey: entry.regionKey,
    entityId: entry.entityId,
    kind: entry.kind,
  };
  if ('key' in entry) copy.key = entry.key;
  if ('numberValue' in entry) copy.numberValue = entry.numberValue;
  if ('stringValue' in entry) copy.stringValue = entry.stringValue;
  if ('booleanValue' in entry) copy.booleanValue = entry.booleanValue;
  return copy;
}

function copyCharacter(character) {
  requireObject(character, 'character');
  return {
    id: character.id,
    name: character.name,
    rank: character.rank,
    location: {
      regionKey: character.location?.regionKey,
      x: character.location?.x,
      y: character.location?.y,
    },
    personality: requireArray(character.personality, 'character.personality').map((trait) => ({
      id: trait.id,
      value: trait.value,
    })),
    goals: requireArray(character.goals, 'character.goals').map((goal) => ({
      id: goal.id,
      text: goal.text,
      priority: goal.priority,
      status: goal.status,
    })),
    memories: requireArray(character.memories, 'character.memories').map((memory) => ({
      id: memory.id,
      summary: memory.summary,
      importance: memory.importance,
      turn: memory.turn,
    })),
    relationships: requireArray(character.relationships, 'character.relationships').map((relationship) => ({
      characterId: relationship.characterId,
      trust: relationship.trust,
      friendship: relationship.friendship,
      affection: relationship.affection,
      fear: relationship.fear,
      rivalry: relationship.rivalry,
      loyalty: relationship.loyalty,
      resentment: relationship.resentment,
      respect: relationship.respect,
      suspicion: relationship.suspicion,
      obligation: relationship.obligation,
    })),
    advisorTrust: character.advisorTrust,
    advisorInstructions: character.advisorInstructions,
    resources: requireArray(character.resources, 'character.resources').map((resource) => ({
      id: resource.id,
      amount: resource.amount,
    })),
    decisionState: {
      lastDecisionId: character.decisionState?.lastDecisionId ?? null,
      pendingIntent: character.decisionState?.pendingIntent ?? null,
    },
  };
}

export function createCampaignSnapshot(state) {
  requireObject(state, 'state');
  if (state.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported campaign schemaVersion: ${state.schemaVersion}`);
  }

  const world = requireObject(state.world, 'world');
  return {
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    campaignId: requireString(state.campaignId, 'campaignId'),
    world: {
      seed: requireString(world.seed, 'world.seed'),
      generationVersion: requireString(world.generationVersion, 'world.generationVersion'),
      turn: world.turn,
      stateDifferences: requireArray(world.stateDifferences, 'world.stateDifferences').map(copyStateDifference),
    },
    character: copyCharacter(state.character),
    chronicle: requireArray(state.chronicle, 'chronicle').map((fact) => ({
      id: fact.id,
      turn: fact.turn,
      fact: fact.fact,
    })),
  };
}

export function exportCampaignState(state) {
  return `${JSON.stringify(createCampaignSnapshot(state), null, 2)}\n`;
}
