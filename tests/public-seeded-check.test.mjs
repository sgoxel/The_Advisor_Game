import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicSeededCheckInput } from '../js/app.js';
import { createInitialCampaignState } from '../js/phase1-runtime.js';
import { resolveSeededSimulationCheck } from '../js/seeded-check-resolution.js';

test('public check input derives only from authoritative campaign state plus check identity', () => {
  const state = createInitialCampaignState();
  const input = createPublicSeededCheckInput(state, 'p02-public-check-a');
  assert.deepEqual(input, {
    worldSeed: state.world.seed,
    generationVersion: state.world.generationVersion,
    checkId: 'p02-public-check-a',
    context: {
      campaignId: state.campaignId,
      turn: state.world.turn,
      characterId: state.character.id,
    },
  });
  assert.ok(!Object.hasOwn(input, 'desiredResult'));
  assert.ok(!Object.hasOwn(input, 'success'));
});

test('unchanged public deterministic context reproduces the exact same result', () => {
  const state = createInitialCampaignState();
  const input = createPublicSeededCheckInput(state, 'p02-public-check-a');
  assert.deepEqual(resolveSeededSimulationCheck(input), resolveSeededSimulationCheck(input));
});

test('allowed check identity participates in deterministic context without accepting an outcome', () => {
  const state = createInitialCampaignState();
  const a = resolveSeededSimulationCheck(createPublicSeededCheckInput(state, 'p02-public-check-a'));
  const b = resolveSeededSimulationCheck(createPublicSeededCheckInput(state, 'p02-public-check-b'));
  assert.notEqual(a.rollUint32, b.rollUint32);
  assert.equal(a.authority, 'simulation');
  assert.equal(b.authority, 'simulation');
});
