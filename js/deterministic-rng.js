import { serializeSeededCheckInput } from './seeded-check-contract.js';

const UINT32_RANGE = 0x100000000;

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function stepMulberry32(state) {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    state: nextState,
    value: (value ^ (value >>> 14)) >>> 0,
  };
}

export function deriveDeterministicSeed(input) {
  return fnv1a32(serializeSeededCheckInput(input));
}

export function createDeterministicRng(input) {
  let state = deriveDeterministicSeed(input);

  return Object.freeze({
    nextUint32() {
      const step = stepMulberry32(state);
      state = step.state;
      return step.value;
    },

    nextFloat() {
      return this.nextUint32() / UINT32_RANGE;
    },
  });
}
