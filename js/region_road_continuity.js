/*
  WP-041/I04: authoritative road continuity across neighboring 100x100 regions.

  This layer wraps Simulation-owned RegionTerrain generation. It does not invent a
  presentation road network. When the deterministic base terrain says a road reaches
  either side of a shared, mutually walkable region seam, both seam tiles are promoted
  to the same authoritative road crossing. The rule is symmetric, deterministic, and
  independent of renderer/camera state.
*/
(function installRegionRoadContinuity() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const RegionTerrain = Game.RegionTerrain;
  if (!RegionTerrain || typeof RegionTerrain.generateRegion !== 'function' || typeof RegionTerrain.sampleTile !== 'function') return;
  if (Game.RegionRoadContinuity?.installed) return;

  const REGION_SIZE = Number(RegionTerrain.regionSize) || 100;
  const generateRegion = RegionTerrain.generateRegion.bind(RegionTerrain);
  const sampleTile = RegionTerrain.sampleTile.bind(RegionTerrain);

  function isBaseWalkable(tile) {
    return Boolean(tile) && !tile.water && tile.type !== 'lake' && tile.type !== 'river' && tile.type !== 'mountain';
  }

  function shouldBridgeRoad(seed, worldAX, worldAY, worldBX, worldBY) {
    const a = sampleTile(seed, worldAX, worldAY);
    const b = sampleTile(seed, worldBX, worldBY);
    return isBaseWalkable(a) && isBaseWalkable(b) && (Boolean(a.road) || Boolean(b.road));
  }

  function roadTile(tile) {
    if (tile?.road === true && tile?.type === 'road' && tile?.water === false) return tile;
    return Object.freeze({ ...tile, type: 'road', road: true, water: false });
  }

  function applySharedEdgeRoads(base) {
    if (!base || !Array.isArray(base.tiles) || base.tiles.length !== REGION_SIZE) return base;

    const seed = base.region?.seed;
    const originWorldX = Number(base.originWorldX);
    const originWorldY = Number(base.originWorldY);
    if (seed == null || !Number.isFinite(originWorldX) || !Number.isFinite(originWorldY)) return base;

    const rows = base.tiles.map((row) => Array.from(row));
    let changed = false;

    for (let row = 0; row < REGION_SIZE; row += 1) {
      const worldY = originWorldY + row;
      const westX = originWorldX;
      if (shouldBridgeRoad(seed, westX - 1, worldY, westX, worldY)) {
        rows[row][0] = roadTile(rows[row][0]);
        changed = true;
      }

      const eastX = originWorldX + REGION_SIZE - 1;
      if (shouldBridgeRoad(seed, eastX, worldY, eastX + 1, worldY)) {
        rows[row][REGION_SIZE - 1] = roadTile(rows[row][REGION_SIZE - 1]);
        changed = true;
      }
    }

    for (let col = 0; col < REGION_SIZE; col += 1) {
      const worldX = originWorldX + col;
      const northY = originWorldY;
      if (shouldBridgeRoad(seed, worldX, northY - 1, worldX, northY)) {
        rows[0][col] = roadTile(rows[0][col]);
        changed = true;
      }

      const southY = originWorldY + REGION_SIZE - 1;
      if (shouldBridgeRoad(seed, worldX, southY, worldX, southY + 1)) {
        rows[REGION_SIZE - 1][col] = roadTile(rows[REGION_SIZE - 1][col]);
        changed = true;
      }
    }

    if (!changed) return base;

    const counts = { ...base.counts };
    for (const key of Object.keys(counts)) counts[key] = 0;
    for (const row of rows) {
      Object.freeze(row);
      for (const tile of row) counts[tile.type] = (counts[tile.type] || 0) + 1;
    }

    return Object.freeze({
      ...base,
      counts: Object.freeze(counts),
      tiles: Object.freeze(rows),
      roadContinuity: Object.freeze({ authority: 'simulation', version: 'wp041-i04-v1', sharedEdgeRule: 'base-road-either-side-and-both-walkable' })
    });
  }

  function generateRegionWithRoadContinuity(seedInput, regionXInput, regionYInput) {
    return applySharedEdgeRoads(generateRegion(seedInput, regionXInput, regionYInput));
  }

  Game.RegionTerrain = Object.freeze({
    ...RegionTerrain,
    generateRegion: generateRegionWithRoadContinuity
  });

  Game.RegionRoadContinuity = Object.freeze({
    installed: true,
    authority: 'simulation',
    version: 'wp041-i04-v1',
    shouldBridgeRoad,
    applySharedEdgeRoads
  });
})();
