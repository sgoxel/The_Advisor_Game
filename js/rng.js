/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Deterministic random generation from canonical SEED text.
  Same canonical seed and stream key must always produce the same sequences.

  DEPENDENCIES:
  - none

  PUBLIC API:
  - Game.RNG.normalizeSeed
  - Game.RNG.deriveSeed
  - Game.RNG.xmur3
  - Game.RNG.mulberry32
  - Game.RNG.createSeededRandom
  - Game.RNG.createStream
  - Game.RNG.hashNoise
  - Game.RNG.chanceFromSeed
  - Game.RNG.pickWeighted

  R02 AUTHORITY RULES:
  - Canonical SEED is trimmed NFC text. Numeric/string equivalents normalize identically.
  - Empty input remains empty unless an explicit fallback is supplied by the caller.
  - Derived streams are deterministic legacy-compatible `seed|key` compositions.
  - Do not use Math.random(), wall-clock time, performance timing, crypto randomness,
    locale, or ambient browser state for authoritative generation.
  - Existing already-canonical ASCII SEED behavior remains sequence-compatible.
*/

window.Game = window.Game || {};

window.Game.RNG = {
  normalizeSeed(seedInput, fallback = "") {
    const normalizeText = (value) => {
      const text = value === null || value === undefined ? "" : String(value);
      const trimmed = text.trim();
      return typeof trimmed.normalize === "function" ? trimmed.normalize("NFC") : trimmed;
    };

    const canonical = normalizeText(seedInput);
    return canonical || normalizeText(fallback);
  },

  deriveSeed(seedInput, streamKey, ...parts) {
    const root = this.normalizeSeed(seedInput);
    const keyParts = [streamKey, ...parts].map((value) => this.normalizeSeed(value));
    return [root, ...keyParts].join("|");
  },

  xmur3(str) {
    const text = String(str);
    let h = 1779033703 ^ text.length;

    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }

    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  },

  mulberry32(a) {
    let state = a >>> 0;
    return function () {
      let t = state += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  createSeededRandom(seedInput) {
    const canonicalSeed = this.normalizeSeed(seedInput);
    const seedFactory = this.xmur3(canonicalSeed);
    return this.mulberry32(seedFactory());
  },

  createStream(seedInput, streamKey, ...parts) {
    return this.createSeededRandom(this.deriveSeed(seedInput, streamKey, ...parts));
  },

  hashNoise(seedInput, row, col, salt) {
    const rng = this.createStream(seedInput, salt, row, col);
    return rng();
  },

  chanceFromSeed(seedInput, key) {
    return this.createStream(seedInput, key)();
  },

  pickWeighted(seedInput, key, values, weights) {
    const roll = this.chanceFromSeed(seedInput, key);
    const sum = weights.reduce((a, b) => a + b, 0);

    let acc = 0;
    for (let i = 0; i < values.length; i++) {
      acc += weights[i] / sum;
      if (roll <= acc) return values[i];
    }

    return values[values.length - 1];
  }
};