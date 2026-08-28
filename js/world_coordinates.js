/*
  R02-T12 / #107: authoritative continuous world-coordinate and region identity contract.

  This module deliberately defines identity only. It does not activate regions, move the
  protagonist, generate terrain, persist deltas, or expose a presentation-facing setter.
  Region identity is derived exclusively from canonical campaign SEED + integer world
  coordinates + compatible generator-rules version.
*/

window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const RNG = Game.RNG;
  const Config = Game.Config || {};

  if (!RNG || typeof RNG.normalizeSeed !== 'function' || typeof RNG.deriveSeed !== 'function') {
    throw new Error('Game.WorldCoordinates requires Game.RNG to be loaded first.');
  }

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
