import assert from 'node:assert/strict';
import test from 'node:test';
import { createCampaignSnapshot, exportCampaignState } from '../js/campaign-save.js';

function sampleState() {
  return {
    schemaVersion: 1,
    campaignId: 'campaign-001',
    world: {
      seed: 'KINGDOM-ALPHA',
      generationVersion: 'worldgen-1',
      turn: 42,
      stateDifferences: [
        { regionKey: '0,0', entityId: 'mill-1', kind: 'upgraded', providerToken: 'drop-me' },
      ],
      apiKey: 'drop-me',
    },
    character: {
      id: 'hero-1',
      name: 'Aren',
      rank: 'Peasant',
      location: { regionKey: '0,0', x: 10, y: 12, secret: 'drop-me' },
      personality: [{ id: 'courage', value: 0.4, token: 'drop-me' }],
      goals: [{ id: 'g1', text: 'Find steady work', priority: 1, status: 'active', apiKey: 'drop-me' }],
      memories: [{ id: 'm1', summary: 'Met the miller', importance: 0.5, turn: 40, rawResponse: 'drop-me' }],
      relationships: [{
        characterId: 'miller-1', trust: 0.2, friendship: 0.1, affection: 0, fear: 0,
        rivalry: 0, loyalty: 0, resentment: 0, respect: 0.1, suspicion: 0, obligation: 0,
        credential: 'drop-me',
      }],
      advisorTrust: 0.25,
      advisorInstructions: 'Prefer honest work.',
      resources: [{ id: 'Gold', amount: 3, secret: 'drop-me' }],
      decisionState: { lastDecisionId: 'd41', pendingIntent: 'seek_work', rawRequest: 'drop-me' },
      providerCredentials: { apiKey: 'drop-me' },
      directCommand: 'attack',
    },
    chronicle: [{ id: 'c1', turn: 1, fact: 'Campaign began.', modelResponse: 'drop-me' }],
    credentials: { token: 'drop-me' },
    rawModelRequest: 'drop-me',
  };
}

test('export produces valid versioned JSON', () => {
  const parsed = JSON.parse(exportCampaignState(sampleState()));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.campaignId, 'campaign-001');
});

test('export preserves SEED and generation version', () => {
  const parsed = JSON.parse(exportCampaignState(sampleState()));
  assert.equal(parsed.world.seed, 'KINGDOM-ALPHA');
  assert.equal(parsed.world.generationVersion, 'worldgen-1');
  assert.equal(parsed.world.turn, 42);
});

test('export preserves authoritative autonomous character resume state', () => {
  const parsed = JSON.parse(exportCampaignState(sampleState()));
  assert.deepEqual(parsed.character.location, { regionKey: '0,0', x: 10, y: 12 });
  assert.equal(parsed.character.rank, 'Peasant');
  assert.equal(parsed.character.goals[0].text, 'Find steady work');
  assert.equal(parsed.character.memories[0].summary, 'Met the miller');
  assert.equal(parsed.character.relationships[0].characterId, 'miller-1');
  assert.equal(parsed.character.advisorTrust, 0.25);
  assert.equal(parsed.character.advisorInstructions, 'Prefer honest work.');
  assert.equal(parsed.character.resources[0].amount, 3);
  assert.equal(parsed.character.decisionState.pendingIntent, 'seek_work');
});

test('export allowlist excludes provider credentials, raw model traffic, and direct-command fields', () => {
  const json = exportCampaignState(sampleState());
  for (const forbidden of [
    'drop-me', 'apiKey', 'providerToken', 'providerCredentials', 'credentials', 'token',
    'secret', 'rawRequest', 'rawResponse', 'rawModelRequest', 'modelResponse', 'directCommand',
  ]) {
    assert.equal(json.includes(forbidden), false, `export must exclude ${forbidden}`);
  }
});

test('snapshot is detached from later source mutations', () => {
  const source = sampleState();
  const snapshot = createCampaignSnapshot(source);
  source.world.seed = 'MUTATED';
  source.character.goals[0].text = 'MUTATED';
  assert.equal(snapshot.world.seed, 'KINGDOM-ALPHA');
  assert.equal(snapshot.character.goals[0].text, 'Find steady work');
});

test('unsupported schema versions are not silently exported', () => {
  const source = sampleState();
  source.schemaVersion = 2;
  assert.throws(() => exportCampaignState(source), /Unsupported campaign schemaVersion/);
});
