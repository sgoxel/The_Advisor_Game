import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { exportCampaignState } from '../js/campaign-save.js';
import { importCampaignState } from '../js/campaign-import.js';
import { summarizeCampaign } from '../js/app.js';
import { createInitialCampaignState, createPhase1Simulation } from '../js/phase1-runtime.js';

function compatibleSave(overrides = {}) {
  const state = createInitialCampaignState();
  state.campaignId = overrides.campaignId ?? 'restored-campaign';
  state.world.turn = overrides.turn ?? 8;
  state.character.name = overrides.name ?? 'Elin';
  state.character.resources[0].amount = overrides.gold ?? 12;
  return exportCampaignState(state);
}

test('public Phase 1 runtime restores visible campaign values through validated import', () => {
  const simulation = createPhase1Simulation();
  const restored = importCampaignState(compatibleSave(), simulation);
  const summary = summarizeCampaign(restored);

  assert.deepEqual(summary, {
    campaignId: 'restored-campaign',
    seed: 'ADVISOR-P01-DEMO',
    turn: 8,
    character: 'Elin',
    rank: 'Peasant',
    gold: 12,
  });
  assert.deepEqual(simulation.getCampaignState(), restored);
});

test('simulation validation rejects incompatible world generation without corrupting authoritative state', () => {
  const simulation = createPhase1Simulation();
  const before = simulation.getCampaignState();
  const candidate = JSON.parse(compatibleSave());
  candidate.world.generationVersion = 'unsupported-worldgen';

  assert.throws(
    () => importCampaignState(JSON.stringify(candidate), simulation),
    /failed simulation validation/,
  );
  assert.deepEqual(simulation.getCampaignState(), before);
});

test('public shell exposes responsive save controls without provider credentials or raw model traffic', async () => {
  const [html, appSource, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/app.css', import.meta.url), 'utf8'),
  ]);

  for (const id of ['save-json', 'export-save', 'import-save', 'reset-campaign', 'save-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /importCampaignState\(saveText\.value, simulation\)/);
  assert.match(appSource, /exportCampaignState\(simulation\.getCampaignState\(\)\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 420px\)/);

  for (const forbidden of ['apiKey', 'providerCredentials', 'rawModelRequest', 'rawModelResponse']) {
    assert.equal(html.includes(forbidden), false);
  }
});
