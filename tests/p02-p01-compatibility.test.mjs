import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicSeededCheckInput } from '../js/app.js';
import { importCampaignState } from '../js/campaign-import.js';
import { exportCampaignState } from '../js/campaign-save.js';
import { createInitialCampaignState, createPhase1Simulation } from '../js/phase1-runtime.js';
import { resolveSeededSimulationCheck } from '../js/seeded-check-resolution.js';

function changedCampaign() {
  const state = createInitialCampaignState();
  state.campaignId = 'p02-p01-compatibility';
  state.world.turn = 23;
  state.world.stateDifferences.push({
    regionKey: '0,0',
    entityId: 'mill-1',
    kind: 'repaired',
    booleanValue: true,
  });
  state.character.name = 'Elin';
  state.character.location = { regionKey: '0,0', x: 7, y: 11 };
  state.character.resources[0].amount = 19;
  state.character.advisorInstructions = 'Keep promises and prefer lawful work.';
  return state;
}

test('P01 export/import round-trip preserves authoritative state and campaign SEED after P02 UI integration', () => {
  const source = changedCampaign();
  const exported = exportCampaignState(source);
  const targetSimulation = createPhase1Simulation();

  const restored = importCampaignState(exported, targetSimulation);

  assert.equal(restored.world.seed, source.world.seed);
  assert.deepEqual(restored, JSON.parse(exported));
  assert.equal(exportCampaignState(targetSimulation.getCampaignState()), exported);
});

test('P01 reset remains deterministic and detached after a changed campaign', () => {
  const simulation = createPhase1Simulation(changedCampaign());
  const expected = createInitialCampaignState();

  const firstReset = simulation.resetCampaignState();
  assert.deepEqual(firstReset, expected);
  assert.equal(exportCampaignState(firstReset), exportCampaignState(expected));

  firstReset.world.seed = 'CALLER-MUTATION';
  firstReset.character.resources[0].amount = 999;
  assert.deepEqual(simulation.getCampaignState(), expected);

  simulation.replaceCampaignState(changedCampaign());
  assert.deepEqual(simulation.resetCampaignState(), expected);
});

test('malformed or unsupported P01 imports fail without corrupting current authoritative campaign', () => {
  const simulation = createPhase1Simulation(changedCampaign());
  const before = simulation.getCampaignState();

  assert.throws(
    () => importCampaignState('{not valid json', simulation),
    /not valid JSON/,
  );
  assert.deepEqual(simulation.getCampaignState(), before);

  const unsupported = structuredClone(before);
  unsupported.schemaVersion = 999;
  assert.throws(
    () => importCampaignState(JSON.stringify(unsupported), simulation),
    /Unsupported campaign schemaVersion/,
  );
  assert.deepEqual(simulation.getCampaignState(), before);
});

test('creating and resolving the public P02 seeded check does not mutate P01 campaign save data', () => {
  const simulation = createPhase1Simulation(changedCampaign());
  const beforeState = simulation.getCampaignState();
  const beforeSave = exportCampaignState(beforeState);

  const input = createPublicSeededCheckInput(beforeState, 'p02-public-check-a');
  const result = resolveSeededSimulationCheck(input);

  assert.equal(result.authority, 'simulation');
  assert.equal(input.worldSeed, beforeState.world.seed);
  assert.equal(input.context.campaignId, beforeState.campaignId);
  assert.equal(input.context.turn, beforeState.world.turn);
  assert.deepEqual(simulation.getCampaignState(), beforeState);
  assert.equal(exportCampaignState(simulation.getCampaignState()), beforeSave);
});
