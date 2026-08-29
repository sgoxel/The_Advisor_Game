/* R02-T18 / #113 + Admin #233: Simulation-callable adjacent-region living-map activation. */
(function installRegionNavigation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'admin-100x100-region-navigation-v2';
  const RADIUS = 1;

  function mutableTile(tile) {
    const tags = new Set();
    if (tile.water) tags.add('water');
    if (tile.road) tags.add('road');
    if (tile.type === 'forest') tags.add('forest');
    if (tile.type === 'mountain') { tags.add('mountain'); tags.add('blocked'); }
    return {
      type: tile.type,
      biome: tile.biome,
      elevation: tile.type === 'mountain' ? 3 : (tile.type === 'forest' ? 2 : (tile.water ? 0 : 1)),
      authority: 'simulation',
      worldX: tile.worldX,
      worldY: tile.worldY,
      tags
    };
  }

  function reconstruct(seed, x, y) {
    const deltas = Game.WorldDeltaPersistence;
    return deltas?.reconstructRegion
      ? deltas.reconstructRegion(seed, x, y)
      : Game.RegionTerrain.generateRegion(seed, x, y);
  }

  function regionMeta(region, x, y) {
    return {
      x,
      y,
      fingerprint: Game.RegionTerrain.fingerprint(region),
      theme: region.theme?.theme || null,
      settlementId: region.theme?.settlementId || null,
      regionFootprint: region.theme?.regionFootprint || null
    };
  }

  function buildWindow(seedInput, regionXInput, regionYInput) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const centerX = Number(regionXInput);
    const centerY = Number(regionYInput);
    if (!Number.isSafeInteger(centerX) || !Number.isSafeInteger(centerY)) throw new TypeError('Region coordinates must be safe integers.');
    const size = Game.RegionTerrain.regionSize;
    const regions = [];
    const terrain = [];
    let centerTerrain = null;
    let centerTheme = null;

    // Neighboring regions may be materialized as a deterministic prefetch/cache window for
    // continuity checks, but Admin #233 keeps the active logical gameplay region exactly
    // 100x100. buildWindow therefore exposes both the 3x3 cache mosaic and the center region.
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      const regionRow = Array.from({ length: size }, () => []);
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        const regionX = centerX + dx;
        const regionY = centerY + dy;
        const region = reconstruct(seed, regionX, regionY);
        regions.push(regionMeta(region, regionX, regionY));
        if (dx === 0 && dy === 0) {
          centerTerrain = region.tiles.map((row) => row.map(mutableTile));
          centerTheme = region.theme || null;
        }
        for (let row = 0; row < size; row += 1) {
          for (let col = 0; col < size; col += 1) regionRow[row].push(mutableTile(region.tiles[row][col]));
        }
      }
      terrain.push(...regionRow);
    }

    return {
      version: VERSION,
      authority: 'simulation',
      seed,
      centerRegion: Game.WorldCoordinates.describeRegion(seed, centerX, centerY),
      centerTheme,
      radius: RADIUS,
      regionSize: size,
      rows: terrain.length,
      cols: terrain[0]?.length || 0,
      activeRows: size,
      activeCols: size,
      regions,
      terrain,
      centerTerrain
    };
  }

  function activate(regionX, regionY) {
    const world = Game.State?.world;
    if (!world) throw new Error('World state is unavailable.');
    const windowState = buildWindow(world.seed, regionX, regionY);
    const size = windowState.regionSize;
    const localCenter = Math.floor(size / 2);
    const center = {
      ...windowState.centerRegion,
      theme: windowState.centerTheme?.theme || null,
      settlementId: windowState.centerTheme?.settlementId || null,
      regionFootprint: windowState.centerTheme?.regionFootprint || null,
      regionSize: size
    };

    world.currentRegion = center;
    world.activeRegionWindow = {
      version: VERSION,
      authority: 'simulation',
      seed: windowState.seed,
      centerRegion: center,
      radius: RADIUS,
      regionSize: size,
      // This metadata describes deterministic neighbor prefetch only. It does not enlarge
      // the active logical gameplay area beyond the canonical center 100x100 region.
      regions: windowState.regions,
      cachedRows: windowState.rows,
      cachedCols: windowState.cols,
      activeRows: size,
      activeCols: size
    };
    world.rows = size;
    world.cols = size;
    world.terrain = windowState.centerTerrain;
    if (world.player) {
      world.player.regionX = center.x;
      world.player.regionY = center.y;
      world.player.row = localCenter;
      world.player.col = localCenter;
      world.player.startRow = localCenter;
      world.player.startCol = localCenter;
      world.player.targetRow = localCenter;
      world.player.targetCol = localCenter;
      world.player.worldX = center.x * size + localCenter;
      world.player.worldY = center.y * size + localCenter;
    }

    if (Game.State.camera) {
      Game.State.camera.row = localCenter;
      Game.State.camera.col = localCenter;
      Game.State.camera.targetRow = localCenter;
      Game.State.camera.targetCol = localCenter;
    }
    Game.Renderer?.invalidateAll?.();
    Game.Renderer?.renderWorld?.(true);
    Game.Minimap?.render?.();
    return capture();
  }

  function activateNeighbor(direction) {
    const current = Game.State?.world?.currentRegion || { x: 0, y: 0 };
    const delta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[direction];
    if (!delta) throw new TypeError('Direction must be north, east, south, or west.');
    return activate(Number(current.x || 0) + delta[0], Number(current.y || 0) + delta[1]);
  }

  function capture() {
    const world = Game.State?.world;
    return JSON.parse(JSON.stringify({
      currentRegion: world?.currentRegion || null,
      activeRegionWindow: world?.activeRegionWindow || null,
      activeRows: world?.rows,
      activeCols: world?.cols,
      player: world?.player ? {
        regionX: world.player.regionX,
        regionY: world.player.regionY,
        worldX: world.player.worldX,
        worldY: world.player.worldY,
        row: world.player.row,
        col: world.player.col
      } : null
    }));
  }

  Game.RegionNavigation = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    buildWindow,
    activate,
    activateNeighbor,
    capture
  });
})();