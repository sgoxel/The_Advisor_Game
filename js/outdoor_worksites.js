/* R04 / #326: deterministic terrain-compatible outdoor profession worksite anchors. */
(function installOutdoorWorksites() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-outdoor-worksites-v1';
  const OUTDOOR_TYPES = Object.freeze({
    farmer: 'field',
    herder: 'pasture',
    hunter: 'forest-edge',
    woodcutter: 'forest-edge',
    forager: 'forest-edge',
    fisher: 'shoreline'
  });

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
  }

  function canonicalSeed(seedInput) {
    if (Game.WorldCoordinates?.canonicalSeed) return Game.WorldCoordinates.canonicalSeed(seedInput);
    return String(seedInput ?? Game.State?.world?.seed ?? '');
  }

  function stableHash(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function stableCharacterId(person) {
    return String(person?.id ?? person?.worldIdentity ?? person?.characterId ?? '');
  }

  function professionOf(person) {
    return normalized(person?.currentProfession || person?.profession || person?.occupation || person?.role || 'none');
  }

  function tileAt(terrain, row, col) {
    return terrain?.[row]?.[col] || null;
  }

  function isWater(tile) {
    return Boolean(tile?.water) || ['lake', 'river', 'water', 'ocean', 'sea'].includes(normalized(tile?.type));
  }

  function isMountain(tile) {
    return normalized(tile?.type) === 'mountain' || Boolean(tile?.cliff || tile?.steep);
  }

  function isBlockedTile(tile) {
    return !tile || isWater(tile) || isMountain(tile) || Boolean(tile.blocked || tile.obstacle || tile.solid);
  }

  function footprintCells(building) {
    const fp = building?.footprint || building;
    const row0 = Number(fp?.row);
    const col0 = Number(fp?.col);
    const height = Math.max(1, Number(fp?.height || building?.height || 1));
    const width = Math.max(1, Number(fp?.width || building?.width || 1));
    if (!Number.isInteger(row0) || !Number.isInteger(col0)) return [];
    const cells = [];
    for (let row = row0; row < row0 + height; row += 1) {
      for (let col = col0; col < col0 + width; col += 1) cells.push(`${row},${col}`);
    }
    return cells;
  }

  function blockedBuildingCells(village) {
    const result = new Set();
    for (const building of village?.buildings || []) {
      if (building?.passable) continue;
      for (const cell of footprintCells(building)) result.add(cell);
    }
    return result;
  }

  function neighbors(row, col, rows, cols) {
    return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
      .filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols);
  }

  function manhattan(a, b) {
    return Math.abs(Number(a?.row || 0) - Number(b?.row || 0)) + Math.abs(Number(a?.col || 0) - Number(b?.col || 0));
  }

  function agricultureAnchor(village) {
    return (village?.buildings || []).find((building) =>
      ['agriculture', 'farmstead', 'farm'].includes(normalized(building?.role)) ||
      ['farmstead', 'farm'].includes(normalized(building?.type))) || village?.center || { row: 50, col: 50 };
  }

  function candidatePool(kind, terrain, village) {
    if (!Array.isArray(terrain) || !terrain.length || !Array.isArray(terrain[0])) return [];
    const rows = terrain.length;
    const cols = terrain[0].length;
    const blocked = blockedBuildingCells(village);
    const farm = agricultureAnchor(village);
    const result = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tile = tileAt(terrain, row, col);
        if (isBlockedTile(tile) || blocked.has(`${row},${col}`)) continue;
        const type = normalized(tile?.type);
        const adjacent = neighbors(row, col, rows, cols).map(([r, c]) => tileAt(terrain, r, c));
        const adjacentWater = adjacent.some(isWater);
        const adjacentForest = adjacent.some((value) => normalized(value?.type) === 'forest');
        const distanceFromFarm = manhattan({ row, col }, farm);

        let valid = false;
        if (kind === 'shoreline') valid = adjacentWater;
        else if (kind === 'forest-edge') valid = type !== 'forest' && adjacentForest;
        else if (kind === 'field') valid = ['grass', 'dirt', 'field', 'road'].includes(type) && distanceFromFarm <= 24;
        else if (kind === 'pasture') valid = ['grass', 'dirt', 'field'].includes(type) && distanceFromFarm <= 32;
        if (!valid) continue;

        result.push({
          row,
          col,
          terrainType: type || 'unknown',
          adjacentWater,
          adjacentForest,
          distanceFromFarm
        });
      }
    }
    return result;
  }

  function chooseCandidate(seed, characterId, profession, candidates, used) {
    if (!candidates.length) return null;
    const ordered = candidates.slice().sort((a, b) => a.row - b.row || a.col - b.col);
    const start = stableHash(`${seed}|${characterId}|${profession}|outdoor-worksite`) % ordered.length;
    for (let offset = 0; offset < ordered.length; offset += 1) {
      const candidate = ordered[(start + offset) % ordered.length];
      const key = `${candidate.row},${candidate.col}`;
      const occupancy = used.get(key) || 0;
      if (occupancy < 3) {
        used.set(key, occupancy + 1);
        return { ...candidate, capacitySlot: occupancy, sharedCapacity: 3 };
      }
    }
    return null;
  }

  function derive(seedInput, village, terrain, populationInput) {
    if (!village || !Array.isArray(village.buildings)) throw new TypeError('Authoritative village is required.');
    if (!Array.isArray(terrain) || !terrain.length) throw new TypeError('Authoritative terrain is required.');
    const seed = canonicalSeed(seedInput);
    const population = Array.isArray(populationInput) ? populationInput : (village.population || []);
    const used = new Map();
    const pools = new Map();
    const assignments = [];

    for (const person of population.slice().sort((a, b) => stableCharacterId(a).localeCompare(stableCharacterId(b)))) {
      const id = stableCharacterId(person);
      const profession = professionOf(person);
      const worksiteKind = OUTDOOR_TYPES[profession];
      if (!id || !worksiteKind) continue;
      if (!pools.has(worksiteKind)) pools.set(worksiteKind, candidatePool(worksiteKind, terrain, village));
      const candidate = chooseCandidate(seed, id, profession, pools.get(worksiteKind), used);
      assignments.push({
        id,
        authority: 'simulation',
        profession,
        worksiteKind,
        worksiteId: candidate ? `worksite:${worksiteKind}:${candidate.row}:${candidate.col}` : null,
        row: candidate?.row ?? null,
        col: candidate?.col ?? null,
        terrainType: candidate?.terrainType ?? null,
        capacitySlot: candidate?.capacitySlot ?? null,
        sharedCapacity: candidate?.sharedCapacity ?? null,
        status: candidate ? 'assigned' : 'unavailable'
      });
    }

    return deepFreeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      persistenceModel: 'seed+stable-character+authoritative-terrain-derived',
      assignments
    });
  }

  function resolveTerrain(seed) {
    const world = Game.State?.world;
    if (Array.isArray(world?.terrain) && world.terrain.length) return world.terrain;
    return Game.RegionTerrain?.generateRegion?.(seed, 0, 0)?.tiles || null;
  }

  function capture(seedInput) {
    const seed = canonicalSeed(seedInput);
    const world = Game.State?.world;
    const village = world?.originVillage || Game.SpatialWorld?.generateOriginVillage?.(seed)?.village;
    const terrain = resolveTerrain(seed);
    if (!village || !terrain) return null;
    const population = village.population || [];
    return clone(derive(seed, village, terrain, population));
  }

  function sync() {
    const world = Game.State?.world;
    if (!world) return false;
    const snapshot = capture(world.seed);
    if (!snapshot) return false;
    world.outdoorWorksites = deepFreeze(snapshot);
    return true;
  }

  Game.OutdoorWorksites = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    outdoorTypes: OUTDOOR_TYPES,
    derive,
    capture,
    sync
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
    else sync();
  }
})();
