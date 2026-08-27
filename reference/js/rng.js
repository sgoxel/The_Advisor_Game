/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Deterministic random generation from seed text.
  Same seed must always produce the same sequences.

  DEPENDENCIES:
  - none

  PUBLIC API:
  - Game.RNG.xmur3
  - Game.RNG.mulberry32
  - Game.RNG.createSeededRandom
  - Game.RNG.hashNoise
  - Game.RNG.pickWeighted

  IMPORTANT RULES:
  - Do not use Math.random() for world generation.
  - World generation must use deterministic RNG only.
*/

window.Game = window.Game || {};

window.Game.RNG = {
  xmur3(str) {
    let h = 1779033703 ^ str.length;

    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }

    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  },

  mulberry32(a) {
    return function () {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  createSeededRandom(seedText) {
    const seedFactory = this.xmur3(seedText);
    return this.mulberry32(seedFactory());
  },

  hashNoise(seedText, row, col, salt) {
    const rng = this.createSeededRandom(`${seedText}|${salt}|${row}|${col}`);
    return rng();
  },

  chanceFromSeed(seed, key) {
    const rng = this.createSeededRandom(`${seed}|${key}`);
    return rng();
  },

  pickWeighted(seed, key, values, weights) {
    const roll = this.chanceFromSeed(seed, key);
    const sum = weights.reduce((a, b) => a + b, 0);

    let acc = 0;
    for (let i = 0; i < values.length; i++) {
      acc += weights[i] / sum;
      if (roll <= acc) return values[i];
    }

    return values[values.length - 1];
  }
};