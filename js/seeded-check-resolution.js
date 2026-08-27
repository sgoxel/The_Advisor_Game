import { createDeterministicRng } from './deterministic-rng.js';
import { createSeededCheckInput } from './seeded-check-contract.js';

const UINT32_RANGE = 0x100000000;

function freezeResult(result) {
  return Object.freeze(result);
}

/**
 * Resolve one authoritative seeded simulation check from explicit deterministic inputs.
 *
 * This function intentionally accepts no desired-result/success/failure override. Any
 * caller-supplied field outside the seeded-check contract is rejected by
 * createSeededCheckInput before RNG resolution occurs.
 */
export function resolveSeededSimulationCheck(input) {
  const normalized = createSeededCheckInput(input);
  const rng = createDeterministicRng(input);
  const rollUint32 = rng.nextUint32();
  const unitRoll = rollUint32 / UINT32_RANGE;

  return freezeResult({
    contractVersion: normalized.contractVersion,
    authority: 'simulation',
    checkId: normalized.checkId,
    rollUint32,
    unitRoll,
    percentile: Math.floor(unitRoll * 100) + 1,
  });
}
