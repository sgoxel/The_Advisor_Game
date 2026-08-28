/* R02-T18 / #113: Simulation-callable adjacent-region living-map activation. */
(function installRegionNavigation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-region-navigation-v1';
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

  function buildWindow(seedInput, regionXInput, regionYInput) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const centerX = Number(regionXInput);
    const centerY = Number(regionYInput);
    if (!Number.isSafeInteger(centerX) || !Number.isSafeInteger(centerY)) throw new TypeError('Region coordinates must be safe integers.');
    const size = Game.RegionTerrain.regionSize;
    const regions = [];
    const terrain = [];

    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      const regionRow = Array.from({ length: size }, () => []);
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        const region = reconstruct(seed, centerX + dx, centerY + dy);
        regions.push({ x: centerX + dx, y: centerY + dy, fingerprint: Game.RegionTerrain.fingerprint(region) });
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
      radius: RADIUS,
      regionSize: size,
      rows: terrain.length,
      cols: terrain[0]?.length || 0,
      regions,
      terrain
    };
  }

  function activate(regionX, regionY) {
    const world = Game.State?.world;
    if (!world) throw new Error('World state is unavailable.');
    const windowState = buildWindow(world.seed, regionX, regionY);
    const size = windowState.regionSize;
    const localCenter = size * RADIUS + Math.floor(size / 2);
    const center = windowState.centerRegion;

    world.currentRegion = center;
    world.activeRegionWindow = {
      version: VERSION,
      authority: 'simulation',
      seed: windowState.seed,
      centerRegion: center,
      radius: RADIUS,
      regionSize: size,
      regions: windowState.regions
    };
    world.rows = windowState.rows;
    world.cols = windowState.cols;
    world.terrain = windowState.terrain;
    if (world.player) {
      world.player.regionX = center.x;
      world.player.regionY = center.y;
      world.player.row = localCenter;
      world.player.col = localCenter;
      world.player.worldX = center.x * size + Math.floor(size / 2);
      world.player.worldY = center.y * size + Math.floor(size / 2);
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