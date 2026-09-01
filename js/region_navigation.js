/* R02-T18 / #113 + Admin #233 + R04 #352: Simulation-callable adjacent-region activation with lazy neighbor prefetch. */
(function installRegionNavigation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'admin-100x100-region-navigation-v3-lazy-prefetch';
  const RADIUS = 1;
  const MAX_PREFETCH_CACHE = 24;
  const prefetchCache = new Map();
  const pendingKeys = new Set();
  const pendingMeta = new Map();
  const sliceSamples = [];
  let queuedJobs = 0;
  let completedJobs = 0;
  let discardedJobs = 0;
  let generation = 0;

  function nowMs() { return window.performance?.now ? window.performance.now() : Date.now(); }
  function percentile(list, ratio) {
    if (!list.length) return 0;
    const sorted = list.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
  }
  function mutableTile(tile) {
    const tags = new Set();
    if (tile.water) tags.add('water');
    if (tile.road) tags.add('road');
    if (tile.type === 'forest') tags.add('forest');
    if (tile.type === 'mountain') { tags.add('mountain'); tags.add('blocked'); }
    return { type: tile.type, biome: tile.biome, elevation: tile.type === 'mountain' ? 3 : (tile.type === 'forest' ? 2 : (tile.water ? 0 : 1)), authority: 'simulation', worldX: tile.worldX, worldY: tile.worldY, tags };
  }
  function reconstruct(seed, x, y) {
    const deltas = Game.WorldDeltaPersistence;
    return deltas?.reconstructRegion ? deltas.reconstructRegion(seed, x, y) : Game.RegionTerrain.generateRegion(seed, x, y);
  }
  function regionMeta(region, x, y) {
    return { x, y, fingerprint: Game.RegionTerrain.fingerprint(region), theme: region.theme?.theme || null, settlementId: region.theme?.settlementId || null, regionFootprint: region.theme?.regionFootprint || null };
  }
  function cacheKey(seed, x, y) { return `${String(seed)}|${Number(x)},${Number(y)}|${Game.RegionTerrain?.generatorVersion || 'terrain'}`; }
  function putPrefetch(key, value) {
    if (prefetchCache.has(key)) prefetchCache.delete(key);
    prefetchCache.set(key, value);
    while (prefetchCache.size > MAX_PREFETCH_CACHE) prefetchCache.delete(prefetchCache.keys().next().value);
  }

  // Compatibility path: explicit callers/tests may still request the full deterministic 3x3 mosaic.
  function buildWindow(seedInput, regionXInput, regionYInput) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const centerX = Number(regionXInput); const centerY = Number(regionYInput);
    if (!Number.isSafeInteger(centerX) || !Number.isSafeInteger(centerY)) throw new TypeError('Region coordinates must be safe integers.');
    const size = Game.RegionTerrain.regionSize; const regions = []; const terrain = []; let centerTerrain = null; let centerTheme = null;
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
      const regionRow = Array.from({ length: size }, () => []);
      for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
        const regionX = centerX + dx; const regionY = centerY + dy; const region = reconstruct(seed, regionX, regionY);
        regions.push(regionMeta(region, regionX, regionY));
        if (dx === 0 && dy === 0) { centerTerrain = region.tiles.map((row) => row.map(mutableTile)); centerTheme = region.theme || null; }
        for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) regionRow[row].push(mutableTile(region.tiles[row][col]));
      }
      terrain.push(...regionRow);
    }
    return { version: VERSION, authority: 'simulation', seed, centerRegion: Game.WorldCoordinates.describeRegion(seed, centerX, centerY), centerTheme, radius: RADIUS, regionSize: size, rows: terrain.length, cols: terrain[0]?.length || 0, activeRows: size, activeCols: size, regions, terrain, centerTerrain };
  }

  function buildActiveRegion(seedInput, regionXInput, regionYInput) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? ''); const x = Number(regionXInput); const y = Number(regionYInput);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new TypeError('Region coordinates must be safe integers.');
    const region = reconstruct(seed, x, y);
    return { seed, x, y, region, meta: regionMeta(region, x, y), centerTerrain: region.tiles.map((row) => row.map(mutableTile)), centerTheme: region.theme || null };
  }

  function cancelSupersededPrefetch() {
    const scheduler = Game.FrameBudgetScheduler;
    for (const key of [...pendingKeys]) { scheduler?.cancel?.(key); pendingKeys.delete(key); pendingMeta.delete(key); discardedJobs += 1; }
  }

  function scheduleNeighborPrefetch(seed, centerX, centerY, requestGeneration) {
    const scheduler = Game.FrameBudgetScheduler;
    if (!scheduler?.enqueue) {
      Game.Utils?.loadScriptOnce?.('js/frame_budget_scheduler.js', 'r04FrameBudgetSchedulerModule');
      window.requestAnimationFrame?.(() => { if (requestGeneration === generation) scheduleNeighborPrefetch(seed, centerX, centerY, requestGeneration); });
      return;
    }
    const jobs = [];
    for (let dy = -RADIUS; dy <= RADIUS; dy += 1) for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = centerX + dx; const y = centerY + dy; const resultKey = cacheKey(seed, x, y); const jobKey = `environment-prefetch:${resultKey}`;
      if (!prefetchCache.has(resultKey) && !pendingKeys.has(jobKey)) jobs.push({ x, y, resultKey, jobKey });
    }
    for (const job of jobs) {
      const enqueuedAt = nowMs();
      const step = () => {
        const started = nowMs();
        if (requestGeneration !== generation) { pendingKeys.delete(job.jobKey); pendingMeta.delete(job.jobKey); discardedJobs += 1; return true; }
        const region = reconstruct(seed, job.x, job.y);
        putPrefetch(job.resultKey, Object.freeze({ ...regionMeta(region, job.x, job.y), cachedAtGeneration: requestGeneration, authority: 'deterministic-prefetch' }));
        completedJobs += 1; pendingKeys.delete(job.jobKey); pendingMeta.delete(job.jobKey);
        sliceSamples.push(Math.max(0, nowMs() - started)); if (sliceSamples.length > 120) sliceSamples.shift();
        return true;
      };
      pendingKeys.add(job.jobKey); pendingMeta.set(job.jobKey, Object.freeze({ enqueuedAt, requestGeneration })); queuedJobs += 1;
      scheduler.enqueue(job.jobKey, step, { priority: -10, version: String(requestGeneration), label: `environment neighbor ${job.x},${job.y}` });
    }
  }

  function activate(regionX, regionY) {
    const world = Game.State?.world; if (!world) throw new Error('World state is unavailable.');
    generation += 1; cancelSupersededPrefetch();
    const active = buildActiveRegion(world.seed, regionX, regionY); const size = Game.RegionTerrain.regionSize; const localCenter = Math.floor(size / 2);
    const center = { ...Game.WorldCoordinates.describeRegion(active.seed, active.x, active.y), theme: active.centerTheme?.theme || null, settlementId: active.centerTheme?.settlementId || null, regionFootprint: active.centerTheme?.regionFootprint || null, regionSize: size };
    world.currentRegion = center;
    world.activeRegionWindow = { version: VERSION, authority: 'simulation', seed: active.seed, centerRegion: center, radius: RADIUS, regionSize: size, regions: [active.meta], cachedRows: size, cachedCols: size, activeRows: size, activeCols: size, lazyNeighborPrefetch: true };
    world.rows = size; world.cols = size; world.terrain = active.centerTerrain;
    if (world.player) {
      world.player.regionX = center.x; world.player.regionY = center.y; world.player.row = localCenter; world.player.col = localCenter; world.player.startRow = localCenter; world.player.startCol = localCenter; world.player.targetRow = localCenter; world.player.targetCol = localCenter; world.player.worldX = center.x * size + localCenter; world.player.worldY = center.y * size + localCenter;
    }
    if (Game.State.camera) { Game.State.camera.row = localCenter; Game.State.camera.col = localCenter; Game.State.camera.targetRow = localCenter; Game.State.camera.targetCol = localCenter; }
    Game.Renderer?.invalidateAll?.(); Game.Renderer?.renderWorld?.(true); Game.Minimap?.render?.();
    scheduleNeighborPrefetch(active.seed, active.x, active.y, generation);
    return capture();
  }

  function activateNeighbor(direction) {
    const current = Game.State?.world?.currentRegion || { x: 0, y: 0 }; const delta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[direction];
    if (!delta) throw new TypeError('Direction must be north, east, south, or west.');
    return activate(Number(current.x || 0) + delta[0], Number(current.y || 0) + delta[1]);
  }

  function lazyMetrics() {
    const schedulerMetrics = Game.FrameBudgetScheduler?.metrics?.() || {}; const time = nowMs();
    const pendingAges = [...pendingMeta.values()].map((entry) => Math.max(0, time - Number(entry.enqueuedAt || time)));
    return Object.freeze({ authority: 'scheduling-only', generation, queuedJobs, completedJobs, discardedJobs, pendingJobs: pendingKeys.size, cacheEntries: prefetchCache.size, maxCacheEntries: MAX_PREFETCH_CACHE, oldestQueueAgeMs: pendingAges.length ? Math.max(...pendingAges) : 0, jobP95Ms: percentile(sliceSamples, 0.95), jobWorstMs: sliceSamples.length ? Math.max(...sliceSamples) : 0, schedulerInteractionActive: Boolean(schedulerMetrics.interactionActive), schedulerQueueDepth: Number(schedulerMetrics.queueDepth || 0) });
  }
  function prefetchSnapshot() { return Object.freeze([...prefetchCache.values()].map((entry) => Object.freeze({ ...entry }))); }
  function capture() {
    const world = Game.State?.world;
    return JSON.parse(JSON.stringify({ currentRegion: world?.currentRegion || null, activeRegionWindow: world?.activeRegionWindow || null, activeRows: world?.rows, activeCols: world?.cols, player: world?.player ? { regionX: world.player.regionX, regionY: world.player.regionY, worldX: world.player.worldX, worldY: world.player.worldY, row: world.player.row, col: world.player.col } : null }));
  }

  Game.RegionNavigation = Object.freeze({ version: VERSION, authority: 'simulation', buildWindow, buildActiveRegion, activate, activateNeighbor, capture, lazyMetrics, prefetchSnapshot });
})();