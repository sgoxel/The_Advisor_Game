import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCampaignState } from '../js/campaign-save.js';
import { importCampaignState } from '../js/campaign-import.js';

function sampleRuntimeState() {
  return {
    schemaVersion: 1,
    campaignId: 'campaign-roundtrip-001',
    world: {
      seed: 'ROUNDTRIP-SEED',
      generationVersion: 'worldgen-1',
      turn: 17,
      stateDifferences: [
        {
          regionKey: '0,0',
          entityId: 'bridge-1',
          kind: 'repaired',
          booleanValue: true,
          providerToken: 'must-not-persist',
        },
      ],
      providerCredentials: { apiKey: 'must-not-persist' },
    },
    character: {
      id: 'hero-roundtrip',
      name: 'Aren',
      rank: 'Peasant',
      location: { regionKey: '0,0', x: 4, y: 9 },
      personality: [{ id: 'courage', value: 0.6 }],
      goals: [{ id: 'goal-1', text: 'Earn an honest living', priority: 1, status: 'active' }],
      memories: [{ id: 'memory-1', summary: 'Promised to help the miller', importance: 0.7, turn: 15 }],
      relationships: [{
        characterId: 'miller-1',
        trust: 0.4,
        friendship: 0.2,
        affection: 0,
        fear: 0,
        rivalry: 0,
        loyalty: 0.1,
        resentment: 0,
        respect: 0.3,
        suspicion: 0,
        obligation: 0.2,
      }],
      advisorTrust: 0.35,
      advisorInstructions: 'Prefer lawful work and keep promises.',
      resources: [{ id: 'Gold', amount: 6 }],
      decisionState: { lastDecisionId: 'decision-16', pendingIntent: 'seek_work' },
      providerCredentials: { apiKey: 'must-not-persist' },
      rawModelResponse: 'must-not-persist',
    },
    chronicle: [{ id: 'chronicle-1', turn: 1, fact: 'Campaign began.' }],
    providerCredentials: { apiKey: 'must-not-persist' },
    rawModelRequest: 'must-not-persist',
  };
}

function createSimulation(initialState = null) {
  let authoritativeState = initialState;
  const calls = [];

  return {
    calls,
    validateImportedCampaign(candidate) {
      calls.push(['validate', candidate.campaignId]);
      return candidate.schemaVersion === 1 && candidate.world.seed === 'ROUNDTRIP-SEED';
    },
    replaceCampaignState(candidate) {
      calls.push(['replace', candidate.campaignId]);
      authoritativeState = structuredClone(candidate);
      return structuredClone(authoritativeState);
    },
    getState() {
      return structuredClone(authoritativeState);
    },
  };
}

test('campaign save round-trip is deterministic after validated import', () => {
  const firstExport = exportCampaignState(sampleRuntimeState());
  const simulation = createSimulation();

  importCampaignState(firstExport, simulation);
  const secondExport = exportCampaignState(simulation.getState());

  assert.equal(secondExport, firstExport);
  assert.deepEqual(simulation.calls, [
    ['validate', 'campaign-roundtrip-001'],
    ['replace', 'campaign-roundtrip-001'],
  ]);
});

test('provider credentials and raw model traffic never persist through round-trip saves', () => {
  const firstExport = exportCampaignState(sampleRuntimeState());
  const simulation = createSimulation();
  importCampaignState(firstExport, simulation);
  const secondExport = exportCampaignState(simulation.getState());

  for (const forbidden of [
    'must-not-persist',
    'providerCredentials',
    'providerToken',
    'apiKey',
    'rawModelRequest',
    'rawModelResponse',
  ]) {
    assert.equal(firstExport.includes(forbidden), false, `first export must exclude ${forbidden}`);
    assert.equal(secondExport.includes(forbidden), false, `round-trip export must exclude ${forbidden}`);
  }
});

test('round-trip state remains detached from source runtime mutations', () => {
  const source = sampleRuntimeState();
  const saved = exportCampaignState(source);

  source.world.seed = 'MUTATED-SEED';
  source.character.goals[0].text = 'MUTATED GOAL';
  source.character.resources[0].amount = 999;

  const simulation = createSimulation();
  importCampaignState(saved, simulation);
  const restored = simulation.getState();

  assert.equal(restored.world.seed, 'ROUNDTRIP-SEED');
  assert.equal(restored.character.goals[0].text, 'Earn an honest living');
  assert.equal(restored.character.resources[0].amount, 6);
});
