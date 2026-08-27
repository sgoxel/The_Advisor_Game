const INITIAL_CAMPAIGN = Object.freeze({
  schemaVersion: 1,
  campaignId: 'phase1-demo',
  world: Object.freeze({
    seed: 'ADVISOR-P01-DEMO',
    generationVersion: 'worldgen-1',
    turn: 1,
    stateDifferences: Object.freeze([]),
  }),
  character: Object.freeze({
    id: 'character-1',
    name: 'Aren',
    rank: 'Peasant',
    location: Object.freeze({ regionKey: '0,0', x: 0, y: 0 }),
    personality: Object.freeze([]),
    goals: Object.freeze([]),
    memories: Object.freeze([]),
    relationships: Object.freeze([]),
    advisorTrust: 0,
    advisorInstructions: '',
    resources: Object.freeze([{ id: 'Gold', amount: 0 }]),
    decisionState: Object.freeze({ lastDecisionId: null, pendingIntent: null }),
  }),
  chronicle: Object.freeze([{ id: 'chronicle-1', turn: 1, fact: 'Campaign began.' }]),
});

function clone(value) {
  return structuredClone(value);
}

export function createInitialCampaignState() {
  return clone(INITIAL_CAMPAIGN);
}

export function createPhase1Simulation(initialState = createInitialCampaignState()) {
  let authoritativeState = clone(initialState);

  return Object.freeze({
    getCampaignState() {
      return clone(authoritativeState);
    },

    validateImportedCampaign(candidate) {
      return Boolean(
        candidate
        && candidate.schemaVersion === 1
        && candidate.world?.generationVersion === 'worldgen-1'
        && Number.isInteger(candidate.world?.turn)
        && candidate.world.turn >= 0
        && Number.isFinite(candidate.character?.location?.x)
        && Number.isFinite(candidate.character?.location?.y)
      );
    },

    replaceCampaignState(candidate) {
      authoritativeState = clone(candidate);
      return clone(authoritativeState);
    },

    resetCampaignState() {
      authoritativeState = createInitialCampaignState();
      return clone(authoritativeState);
    },
  });
}
