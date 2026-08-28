/* R02-T24 / #126: deterministic Simulation-backed settlement/environment composition. */
(function installWorldComposition() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-world-composition-v1';
  const SETTLEMENT_TYPES = Object.freeze(['village', 'town', 'city', 'fortified-town', 'castle']);

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    const value = String(text);
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function seedKey(seed, regionX, regionY, salt) {
    return `${String(seed)}|${Number(regionX)}|${Number(regionY)}|${salt}`;
  }

  function edgeKey(seed, x, y, direction) {
    const neighbor = direction === 'east' ? [x + 1, y] : [x, y + 1];
    const a = `${x},${y}`;
    const b = `${neighbor[0]},${neighbor[1]}`;
    return `${String(seed)}|edge|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
  }

  function summarizeEnvironment(region) {
    const tiles = Array.isArray(region?.tiles) ? region.tiles.flat() : [];
    const counts = { water: 0, forest: 0, road: 0, mountain: 0, hill: 0, coast: 0 };
    let elevationTotal = 0;
    for (const tile of tiles) {
      const type = String(tile?.type || '').toLowerCase();
      const biome = String(tile?.biome || '').toLowerCase();
      const elevation = Number(tile?.elevation || 0);
      elevationTotal += elevation;
      if (tile?.water || /water|river|lake|sea|ocean|coast/.test(type) || /water|river|lake|coast/.test(biome)) counts.water += 1;
      if (/forest|wood/.test(type) || /forest|wood/.test(biome)) counts.forest += 1;
      if (tile?.road || /road|path|bridge/.test(type)) counts.road += 1;
      if (elevation >= 0.72 || /mountain|peak/.test(type) || /mountain/.test(biome)) counts.mountain += 1;
      else if (elevation >= 0.52 || /hill/.test(type) || /hill/.test(biome)) counts.hill += 1;
      if (/coast|shore|beach/.test(type) || /coast|shore/.test(biome)) counts.coast += 1;
    }
    const total = Math.max(1, tiles.length);
    return Object.freeze({
      tileCount: tiles.length,
      waterRatio: Number((counts.water / total).toFixed(4)),
      forestRatio: Number((counts.forest / total).toFixed(4)),
      roadRatio: Number((counts.road / total).toFixed(4)),
      mountainRatio: Number((counts.mountain / total).toFixed(4)),
      hillRatio: Number((counts.hill / total).toFixed(4)),
      coastRatio: Number((counts.coast / total).toFixed(4)),
      meanElevation: Number((elevationTotal / total).toFixed(4))
    });
  }

  function classifySettlement(seed, regionX, regionY, environment) {
    if (regionX === 0 && regionY === 0) return 'village';
    const roll = hash32(seedKey(seed, regionX, regionY, 'settlement')) % 100;
    const hospitable = environment.waterRatio < 0.58 && environment.mountainRatio < 0.58;
    if (!hospitable && roll < 62) return null;
    if (roll < 34) return null;
    if (roll < 58) return 'village';
    if (roll < 75) return 'town';
    if (roll < 86) return 'city';
    if (roll < 95) return 'fortified-town';
    return 'castle';
  }

  function settlementFeatures(type) {
    if (!type) return [];
    const features = {
      village: ['homes', 'well', 'market-green'],
      town: ['homes', 'market', 'workshops', 'inn'],
      city: ['districts', 'market', 'guild-quarter', 'civic-center'],
      'fortified-town': ['walls', 'gate', 'market', 'guard-post'],
      castle: ['keep', 'walls', 'gatehouse', 'service-yard']
    };
    return features[type].slice();
  }

  function environmentalFeatures(seed, regionX, regionY, env) {
    const features = [];
    if (env.waterRatio >= 0.32) features.push(env.coastRatio > 0.05 ? 'coast' : 'lake-or-river');
    else if ((hash32(seedKey(seed, regionX, regionY, 'stream')) % 100) < 28) features.push('stream');
    if (env.forestRatio >= 0.16) features.push('forest');
    if (env.mountainRatio >= 0.08) features.push('mountains');
    else if (env.hillRatio >= 0.12 || env.meanElevation >= 0.44) features.push('hills');
    if ((hash32(seedKey(seed, regionX, regionY, 'lake')) % 100) < 12) features.push('lake');
    return [...new Set(features)];
  }

  function connectionPlan(seed, regionX, regionY, env) {
    const east = (hash32(edgeKey(seed, regionX, regionY, 'east')) % 100) < 44;
    const south = (hash32(edgeKey(seed, regionX, regionY, 'south')) % 100) < 44;
    const west = (hash32(edgeKey(seed, regionX - 1, regionY, 'east')) % 100) < 44;
    const north = (hash32(edgeKey(seed, regionX, regionY - 1, 'south')) % 100) < 44;
    const bridgeChance = env.waterRatio >= 0.08;
    return Object.freeze({
      roads: Object.freeze({ north, east, south, west }),
      bridgeRequired: Boolean(bridgeChance && (north || east || south || west)),
      continuityKey: `${north ? 1 : 0}${east ? 1 : 0}${south ? 1 : 0}${west ? 1 : 0}`
    });
  }

  function composeRegion(seedInput, regionXInput, regionYInput) {
    const terrain = Game.RegionTerrain;
    if (!terrain?.generateRegion) throw new Error('RegionTerrain is required before world composition.');
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = Number(regionXInput);
    const regionY = Number(regionYInput);
    if (!Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionY)) throw new TypeError('Region coordinates must be safe integers.');
    const base = terrain.generateRegion(seed, regionX, regionY);
    const environment = summarizeEnvironment(base);
    const settlementType = classifySettlement(seed, regionX, regionY, environment);
    const settlement = settlementType ? Object.freeze({
      id: `settlement:${hash32(seedKey(seed, regionX, regionY, 'id')).toString(16).padStart(8, '0')}`,
      type: settlementType,
      authority: 'simulation',
      regionX,
      regionY,
      features: Object.freeze(settlementFeatures(settlementType))
    }) : null;
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      regionX,
      regionY,
      terrainGeneratorVersion: terrain.generatorVersion || null,
      baseFingerprint: terrain.fingerprint ? terrain.fingerprint(base) : null,
      environment,
      environmentFeatures: Object.freeze(environmentalFeatures(seed, regionX, regionY, environment)),
      connections: connectionPlan(seed, regionX, regionY, environment),
      settlement
    });
  }

  function composeNeighborhood(seed, centerX, centerY, radius = 1) {
    const size = Math.max(0, Math.min(4, Number(radius) || 0));
    const regions = [];
    for (let y = centerY - size; y <= centerY + size; y += 1) {
      for (let x = centerX - size; x <= centerX + size; x += 1) regions.push(composeRegion(seed, x, y));
    }
    return regions;
  }

  Game.WorldComposition = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    settlementTypes: SETTLEMENT_TYPES,
    composeRegion,
    composeNeighborhood,
    summarizeEnvironment
  });
})();