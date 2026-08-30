/* R04 / #327: deterministic village guard-duty anchor/workplace foundation. */
(function installGuardDutyAnchors() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-guard-duty-anchors-v1';

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }
  function canonicalSeed(seedInput) {
    if (Game.WorldCoordinates?.canonicalSeed) return Game.WorldCoordinates.canonicalSeed(seedInput);
    return String(seedInput ?? Game.State?.world?.seed ?? '');
  }
  function pointKey(point) { return `${Number(point.row)},${Number(point.col)}`; }
  function normalized(value) { return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-'); }
  function inside(point, size) {
    return Number.isInteger(point?.row) && Number.isInteger(point?.col) && point.row >= 0 && point.col >= 0 && point.row < size && point.col < size;
  }
  function footprintCells(building) {
    const fp = building?.footprint || building;
    const row0 = Number(fp?.row), col0 = Number(fp?.col);
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
    const blocked = new Set();
    for (const building of village?.buildings || []) {
      if (building?.passable) continue;
      for (const key of footprintCells(building)) blocked.add(key);
    }
    return blocked;
  }
  function guardWorkplace(village) {
    return (village?.buildings || []).find((building) => {
      const tokens = [building?.role, building?.type, building?.name].map(normalized);
      return tokens.some((token) => ['guard', 'guard-post', 'barracks', 'watch', 'keep'].includes(token));
    }) || null;
  }
  function sideForRoad(point, size) {
    const distances = [
      ['north', point.row], ['south', size - 1 - point.row],
      ['west', point.col], ['east', size - 1 - point.col]
    ];
    distances.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    return distances[0][0];
  }
  function boundaryRoads(roadTiles, size) {
    const sorted = roadTiles.filter((point) => inside(point, size)).slice().sort((a, b) => a.row - b.row || a.col - b.col);
    if (!sorted.length) return [];
    const bySide = new Map();
    for (const point of sorted) {
      const side = sideForRoad(point, size);
      const distance = side === 'north' ? point.row : side === 'south' ? size - 1 - point.row : side === 'west' ? point.col : size - 1 - point.col;
      const previous = bySide.get(side);
      if (!previous || distance < previous.distance || (distance === previous.distance && pointKey(point) < pointKey(previous.point))) {
        bySide.set(side, { point: { row: point.row, col: point.col }, distance });
      }
    }
    return ['north', 'east', 'south', 'west'].flatMap((side) => bySide.has(side) ? [{ side, ...bySide.get(side) }] : []);
  }
  function candidateOffsets(side) {
    if (side === 'north' || side === 'south') return [[0,-1],[0,1],[-1,0],[1,0]];
    return [[-1,0],[1,0],[0,-1],[0,1]];
  }
  function traversable(terrain, point, blocked, roadSet, size) {
    if (!inside(point, size) || blocked.has(pointKey(point)) || roadSet.has(pointKey(point))) return false;
    const tile = terrain?.[point.row]?.[point.col];
    if (!tile) return true;
    const type = normalized(tile.type);
    if (tile.water || tile.blocked || tile.obstacle || tile.solid || tile.cliff || tile.steep) return false;
    return !['lake','river','water','ocean','sea','mountain'].includes(type);
  }
  function derive(seedInput, village, terrainInput) {
    if (!village || !Array.isArray(village.roadTiles)) throw new TypeError('Authoritative village roadTiles are required.');
    const seed = canonicalSeed(seedInput);
    const size = Math.max(1, Number(village.regionSize || terrainInput?.length || 100));
    const roadSet = new Set(village.roadTiles.map(pointKey));
    const blocked = blockedBuildingCells(village);
    const workplace = guardWorkplace(village);
    const used = new Set();
    const anchors = [];

    for (const entry of boundaryRoads(village.roadTiles, size)) {
      let duty = null;
      for (const [dr, dc] of candidateOffsets(entry.side)) {
        const candidate = { row: entry.point.row + dr, col: entry.point.col + dc };
        if (!traversable(terrainInput, candidate, blocked, roadSet, size) || used.has(pointKey(candidate))) continue;
        duty = candidate;
        break;
      }
      if (!duty) continue;
      used.add(pointKey(duty));
      anchors.push({
        id: `guard-duty:${entry.side}:${duty.row}:${duty.col}`,
        authority: 'simulation',
        side: entry.side,
        entranceRoadTile: { row: entry.point.row, col: entry.point.col },
        row: duty.row,
        col: duty.col,
        workplaceBuildingId: workplace?.id || null,
        status: 'available'
      });
    }

    return deepFreeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      persistenceModel: 'seed+authoritative-village-roads+workplace-derived',
      workplaceBuildingId: workplace?.id || null,
      anchors
    });
  }
  function capture(seedInput) {
    const seed = canonicalSeed(seedInput);
    const world = Game.State?.world;
    const village = world?.originVillage || Game.SpatialWorld?.generateOriginVillage?.(seed)?.village;
    if (!village) return null;
    return clone(derive(seed, village, world?.terrain || null));
  }
  function sync() {
    const world = Game.State?.world;
    if (!world) return false;
    const snapshot = capture(world.seed);
    if (!snapshot) return false;
    world.guardDutyAnchors = deepFreeze(snapshot);
    return true;
  }

  Game.GuardDutyAnchors = Object.freeze({ version: VERSION, authority: 'simulation', derive, capture, sync });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
    else sync();
  }
})();
