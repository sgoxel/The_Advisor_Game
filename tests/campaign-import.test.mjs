import assert from 'node:assert/strict';
import test from 'node:test';
import { exportCampaignState } from '../js/campaign-save.js';
import { importCampaignState, parseCampaignImport } from '../js/campaign-import.js';

function sampleState() {
  return {
    schemaVersion: 1,
    campaignId: 'campaign-001',
    world: { seed: 'KINGDOM-ALPHA', generationVersion: 'worldgen-1', turn: 42, stateDifferences: [] },
    character: {
      id: 'hero-1', name: 'Aren', rank: 'Peasant', location: { regionKey: '0,0', x: 10, y: 12 },
      personality: [], goals: [], memories: [], relationships: [], advisorTrust: 0.25,
      advisorInstructions: 'Prefer honest work.', resources: [],
      decisionState: { lastDecisionId: null, pendingIntent: null },
    },
    chronicle: [],
  };
}

test('valid exported campaign parses and round-trips authoritative state', () => {
  const source = sampleState();
  const parsed = parseCampaignImport(exportCampaignState(source));
  assert.deepEqual(parsed, source);
});

test('malformed JSON is rejected safely', () => {
  assert.throws(() => parseCampaignImport('{bad json'), /not valid JSON/);
});

test('unsupported schema version is rejected', () => {
  const source = sampleState();
  source.schemaVersion = 99;
  assert.throws(() => parseCampaignImport(JSON.stringify(source)), /Unsupported campaign schemaVersion/);
});

test('unexpected top-level fields cannot smuggle credentials or commands', () => {
  const source = sampleState();
  source.providerCredentials = { apiKey: 'secret' };
  assert.throws(() => parseCampaignImport(JSON.stringify(source)), /not supported/);
});

test('import must pass deterministic simulation validation before state replacement', () => {
  const calls = [];
  const simulation = {
    validateImportedCampaign(candidate) { calls.push(['validate', candidate.campaignId]); return true; },
    replaceCampaignState(candidate) { calls.push(['replace', candidate.campaignId]); return candidate; },
  };
  const result = importCampaignState(exportCampaignState(sampleState()), simulation);
  assert.equal(result.campaignId, 'campaign-001');
  assert.deepEqual(calls, [['validate', 'campaign-001'], ['replace', 'campaign-001']]);
});

test('failed simulation validation never replaces authoritative state', () => {
  let replaced = false;
  const simulation = {
    validateImportedCampaign() { return false; },
    replaceCampaignState() { replaced = true; },
  };
  assert.throws(() => importCampaignState(exportCampaignState(sampleState()), simulation), /failed simulation validation/);
  assert.equal(replaced, false);
});
