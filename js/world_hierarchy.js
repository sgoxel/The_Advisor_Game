/* R02 / #134: compact Simulation-owned global-to-local hierarchy and refinement boundaries. */
(function installWorldHierarchy() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-world-hierarchy-v1';

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function intCoord(value, name) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer.`);
    return n;
  }

  function bounded(hash, min, max) {
    return min + (hash % (max - min + 1));
  }

  function regionKey(seed, x, y, salt) {
    return `${String(seed)}|${x}|${y}|${salt}`;
  }

  function realmCoords(regionX, regionY) {
    return Object.freeze({ x: Math.floor(regionX / 16), y: Math.floor(regionY / 16) });
  }

  function aggregate(seed, key, campaignDay = 0) {
    const day = Math.max(0, Math.floor(Number(campaignDay) || 0));
    const base = hash32(`${seed}|${key}|base`);
    const drift = hash32(`${seed}|${key}|day:${day}`);
    return Object.freeze({
      populationTrend: bounded(base ^ drift, -3, 5),
      prosperity: bounded(hash32(`${seed}|${key}|prosperity`) + day, 20, 90),
      resources: bounded(hash32(`${seed}|${key}|resources`) + Math.floor(day / 3), 15, 95),
      security: bounded(hash32(`${seed}|${key}|security`) + Math.floor(day / 7), 20, 95),
      trade: bounded(hash32(`${seed}|${key}|trade`) + Math.floor(day / 5), 10, 90),
      militaryPressure: bounded(hash32(`${seed}|${key}|pressure`) + day, 0, 75),
      unrest: bounded(hash32(`${seed}|${key}|unrest`) + Math.floor(day / 2), 0, 65)
    });
  }

  function worldState(seedInput, campaignMinutes = 0) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const day = Math.max(0, Math.floor(Number(campaignMinutes) / 1440) || 0);
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      level: 'world',
      id: `world:${hash32(seed).toString(16).padStart(8, '0')}`,
      seed,
      campaignDay: day,
      aggregate: aggregate(seed, 'world', day),
      materializedLocalEntities: false,
      presentationAuthority: false
    });
  }

  function realmState(seedInput, regionXInput, regionYInput, campaignMinutes = 0) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const realm = realmCoords(regionX, regionY);
    const day = Math.max(0, Math.floor(Number(campaignMinutes) / 1440) || 0);
    const id = `realm:${realm.x}:${realm.y}`;
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      level: 'realm',
      id,
      seed,
      realmX: realm.x,
      realmY: realm.y,
      parentId: worldState(seed, campaignMinutes).id,
      aggregate: aggregate(seed, id, day),
      materializedLocalEntities: false
    });
  }

  function regionState(seedInput, regionXInput, regionYInput, campaignMinutes = 0) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const realm = realmState(seed, regionX, regionY, campaignMinutes);
    const day = Math.max(0, Math.floor(Number(campaignMinutes) / 1440) || 0);
    const id = `region:${regionX}:${regionY}`;
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      level: 'region',
      id,
      seed,
      regionX,
      regionY,
      parentId: realm.id,
      aggregate: aggregate(seed, id, day),
      compositionFingerprint: Game.WorldComposition?.composeRegion
        ? Game.WorldComposition.composeRegion(seed, regionX, regionY).baseFingerprint
        : null,
      materializedLocalEntities: false
    });
  }

  function settlementState(seedInput, regionXInput, regionYInput, campaignMinutes = 0) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const region = regionState(seed, regionXInput, regionYInput, campaignMinutes);
    const composition = Game.WorldComposition?.composeRegion?.(seed, region.regionX, region.regionY) || null;
    if (!composition?.settlement) return null;
    const day = Math.max(0, Math.floor(Number(campaignMinutes) / 1440) || 0);
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      level: 'settlement',
      id: composition.settlement.id,
      type: composition.settlement.type,
      parentId: region.id,
      seed,
      regionX: region.regionX,
      regionY: region.regionY,
      aggregate: aggregate(seed, composition.settlement.id, day),
      materializedLocalEntities: false
    });
  }

  function refinementInput(seedInput, regionXInput, regionYInput, campaignMinutes = 0, persistentHistory = {}) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const region = regionState(seed, regionXInput, regionYInput, campaignMinutes);
    const realm = realmState(seed, region.regionX, region.regionY, campaignMinutes);
    const world = worldState(seed, campaignMinutes);
    const settlement = settlementState(seed, region.regionX, region.regionY, campaignMinutes);
    const history = persistentHistory && typeof persistentHistory === 'object' ? persistentHistory : {};
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      campaignMinutes: Math.max(0, Math.floor(Number(campaignMinutes) || 0)),
      world,
      realm,
      region,
      settlement,
      persistentHistory: Object.freeze({ ...history }),
      refinementKey: hash32(JSON.stringify([
        seed,
        region.regionX,
        region.regionY,
        Math.max(0, Math.floor(Number(campaignMinutes) || 0)),
        world.aggregate,
        realm.aggregate,
        region.aggregate,
        settlement?.aggregate || null,
        history
      ])).toString(16).padStart(8, '0')
    });
  }

  function materializeLocal(refinement, options = {}) {
    if (!refinement || refinement.authority !== 'simulation') throw new TypeError('Simulation refinement input is required.');
    const importantEntityIds = Array.isArray(options.importantEntityIds)
      ? options.importantEntityIds.map(String).sort()
      : [];
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      level: 'local',
      id: `local:${refinement.region.regionX}:${refinement.region.regionY}`,
      parentId: refinement.settlement?.id || refinement.region.id,
      refinementKey: refinement.refinementKey,
      importantEntityIds: Object.freeze(importantEntityIds),
      detailPolicy: importantEntityIds.length ? 'active-with-retained-important-detail' : 'active',
      presentationAuthority: false
    });
  }

  function propagateLocalOutcome(refinement, outcome = {}) {
    if (!refinement || refinement.authority !== 'simulation') throw new TypeError('Simulation refinement input is required.');
    const magnitude = Math.max(-20, Math.min(20, Math.trunc(Number(outcome.magnitude) || 0)));
    const kind = String(outcome.kind || 'local-event');
    const regionAggregate = { ...refinement.region.aggregate };
    if (kind === 'prosperity') regionAggregate.prosperity = Math.max(0, Math.min(100, regionAggregate.prosperity + magnitude));
    if (kind === 'security') regionAggregate.security = Math.max(0, Math.min(100, regionAggregate.security + magnitude));
    if (kind === 'unrest') regionAggregate.unrest = Math.max(0, Math.min(100, regionAggregate.unrest + magnitude));
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      sourceLevel: 'local',
      outcome: Object.freeze({ kind, magnitude }),
      regionId: refinement.region.id,
      realmId: refinement.realm.id,
      worldId: refinement.world.id,
      updatedRegionAggregate: Object.freeze(regionAggregate),
      realmSignal: Object.freeze({ kind, magnitude: Math.trunc(magnitude / 2) }),
      worldSignal: Object.freeze({ kind, magnitude: Math.trunc(magnitude / 4) })
    });
  }

  Game.WorldHierarchy = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    worldState,
    realmState,
    regionState,
    settlementState,
    refinementInput,
    materializeLocal,
    propagateLocalOutcome
  });
})();
