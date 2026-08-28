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
  - Game.WorldCoordinates (R02-T12 authoritative region identity contract)
  - Game.RegionTerrain (R02-T14 deterministic multi-region base terrain)

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

/*
  R02-T12 / #107: authoritative continuous world-coordinate and region identity contract.

  This contract defines identity only. It does not activate regions, move the protagonist,
  generate terrain, persist deltas, or expose a presentation-facing setter. Region identity
  derives exclusively from canonical campaign SEED + integer world coordinates + compatible
  generator-rules version, so camera/render/cache state cannot inject authoritative position.
*/
(function installWorldCoordinateContract() {
  const Game = window.Game;
  const RNG = Game.RNG;
  const Config = Game.Config || {};
  const SCHEMA_VERSION = 1;
  const DEFAULT_RULES_VERSION = 'r02-region-v1';
  const ORIGIN = Object.freeze({ x: 0, y: 0 });
  const DIRECTIONS = Object.freeze({
    north: Object.freeze({ x: 0, y: -1 }),
    east: Object.freeze({ x: 1, y: 0 }),
    south: Object.freeze({ x: 0, y: 1 }),
    west: Object.freeze({ x: -1, y: 0 })
  });

  function canonicalSeed(seedInput) {
    return RNG.normalizeSeed(seedInput, Config.DEFAULT_SEED || '');
  }

  function normalizeCoordinate(value, label) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new TypeError(`${label || 'world coordinate'} must be a safe integer.`);
    }
    return Object.is(number, -0) ? 0 : number;
  }

  function normalizeRulesVersion(value) {
    const normalized = RNG.normalizeSeed(value, DEFAULT_RULES_VERSION);
    if (!normalized) throw new TypeError('generator rules version must not be empty.');
    return normalized;
  }

  function regionKey(seed, x, y, rulesVersion) {
    return `region:${encodeURIComponent(rulesVersion)}:${encodeURIComponent(seed)}:${x}:${y}`;
  }

  function describeRegion(seedInput, xInput, yInput, rulesVersionInput = DEFAULT_RULES_VERSION) {
    const seed = canonicalSeed(seedInput);
    const x = normalizeCoordinate(xInput, 'world x');
    const y = normalizeCoordinate(yInput, 'world y');
    const rulesVersion = normalizeRulesVersion(rulesVersionInput);
    const generationSeed = RNG.deriveSeed(seed, 'world-region', rulesVersion, x, y);

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      seed,
      x,
      y,
      rulesVersion,
      id: regionKey(seed, x, y, rulesVersion),
      generationSeed
    });
  }

  function adjacentRegion(seedInput, xInput, yInput, direction, rulesVersionInput = DEFAULT_RULES_VERSION) {
    const delta = DIRECTIONS[direction];
    if (!delta) throw new TypeError(`Unknown cardinal direction: ${String(direction)}`);
    const x = normalizeCoordinate(xInput, 'world x');
    const y = normalizeCoordinate(yInput, 'world y');
    return describeRegion(seedInput, x + delta.x, y + delta.y, rulesVersionInput);
  }

  function adjacentRegions(seedInput, xInput, yInput, rulesVersionInput = DEFAULT_RULES_VERSION) {
    const x = normalizeCoordinate(xInput, 'world x');
    const y = normalizeCoordinate(yInput, 'world y');
    return Object.freeze({
      north: adjacentRegion(seedInput, x, y, 'north', rulesVersionInput),
      east: adjacentRegion(seedInput, x, y, 'east', rulesVersionInput),
      south: adjacentRegion(seedInput, x, y, 'south', rulesVersionInput),
      west: adjacentRegion(seedInput, x, y, 'west', rulesVersionInput)
    });
  }

  Game.WorldCoordinates = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    hasGameplayFiniteBoundary: false,
    defaultRulesVersion: DEFAULT_RULES_VERSION,
    origin: ORIGIN,
    directions: DIRECTIONS,
    canonicalSeed,
    normalizeCoordinate,
    describeRegion,
    adjacentRegion,
    adjacentRegions
  });
})();

/*
  R02-T14 / #109: deterministic coordinate-addressable base terrain.

  Region base state samples continuous world-space fields, not per-region local RNG streams.
  Therefore generation order and presentation/cache state cannot change terrain truth, and
  neighboring regions sample the same continuous fields on consecutive global tile coordinates.
*/
(function installRegionTerrainContract() {
  const Game = window.Game;
  const RNG = Game.RNG;
  const Coordinates = Game.WorldCoordinates;
  const REGION_SIZE = 24;
  const GENERATOR_VERSION = 'r02-terrain-v1';

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function field(seed, worldX, worldY, salt, scale) {
    const x = worldX / scale;
    const y = worldY / scale;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);
    const n00 = RNG.hashNoise(seed, y0, x0, `${GENERATOR_VERSION}|${salt}`);
    const n10 = RNG.hashNoise(seed, y0, x0 + 1, `${GENERATOR_VERSION}|${salt}`);
    const n01 = RNG.hashNoise(seed, y0 + 1, x0, `${GENERATOR_VERSION}|${salt}`);
    const n11 = RNG.hashNoise(seed, y0 + 1, x0 + 1, `${GENERATOR_VERSION}|${salt}`);
    return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
  }

  function sampleTile(seedInput, worldXInput, worldYInput) {
    const seed = Coordinates.canonicalSeed(seedInput);
    const worldX = Coordinates.normalizeCoordinate(worldXInput, 'terrain world x');
    const worldY = Coordinates.normalizeCoordinate(worldYInput, 'terrain world y');
    const broad = field(seed, worldX, worldY, 'elevation-broad', 22);
    const detail = field(seed, worldX, worldY, 'elevation-detail', 7);
    const moisture = field(seed, worldX, worldY, 'moisture', 17);
    const temperature = field(seed, worldX, worldY, 'temperature', 31);
    const riverField = field(seed, worldX, worldY, 'river', 19);
    const roadField = field(seed, worldX, worldY, 'road', 27);
    const elevation = Math.max(0, Math.min(1, broad * 0.72 + detail * 0.28));

    let type = 'grass';
    let biome = temperature < 0.28 ? 'cool' : (temperature > 0.72 ? 'warm' : 'temperate');
    const river = Math.abs(riverField - 0.5) < 0.024 && elevation < 0.7;
    const lake = elevation < 0.245;
    const mountain = elevation > 0.77;
    const road = !lake && !river && !mountain && Math.abs(roadField - 0.5) < 0.028;

    if (lake) type = 'lake';
    else if (river) type = 'river';
    else if (mountain) type = 'mountain';
    else if (road) type = 'road';
    else if (moisture > 0.61) type = 'forest';
    else if (moisture < 0.31 || (temperature > 0.68 && moisture < 0.44)) type = 'dirt';

    return Object.freeze({
      authority: 'simulation',
      worldX,
      worldY,
      type,
      biome,
      elevation: Number(elevation.toFixed(6)),
      moisture: Number(moisture.toFixed(6)),
      temperature: Number(temperature.toFixed(6)),
      water: lake || river,
      road
    });
  }

  function generateRegion(seedInput, regionXInput, regionYInput) {
    const descriptor = Coordinates.describeRegion(seedInput, regionXInput, regionYInput);
    const originWorldX = descriptor.x * REGION_SIZE;
    const originWorldY = descriptor.y * REGION_SIZE;
    const tiles = [];
    const counts = { grass: 0, dirt: 0, forest: 0, lake: 0, river: 0, road: 0, mountain: 0 };

    for (let row = 0; row < REGION_SIZE; row++) {
      const line = [];
      for (let col = 0; col < REGION_SIZE; col++) {
        const tile = sampleTile(descriptor.seed, originWorldX + col, originWorldY + row);
        counts[tile.type] = (counts[tile.type] || 0) + 1;
        line.push(tile);
      }
      tiles.push(Object.freeze(line));
    }

    return Object.freeze({
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      authority: 'simulation',
      hasGameplayFiniteBoundary: false,
      regionSize: REGION_SIZE,
      region: descriptor,
      originWorldX,
      originWorldY,
      counts: Object.freeze(counts),
      tiles: Object.freeze(tiles)
    });
  }

  function fingerprint(region) {
    if (!region || !Array.isArray(region.tiles)) throw new TypeError('region base state is required.');
    return region.tiles.map((row) => row.map((tile) => tile.type[0]).join('')).join('|');
  }

  Game.RegionTerrain = Object.freeze({
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    authority: 'simulation',
    hasGameplayFiniteBoundary: false,
    regionSize: REGION_SIZE,
    sampleTile,
    generateRegion,
    fingerprint
  });
})();
