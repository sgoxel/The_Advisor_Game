/* R02-T31 / #141: compact Simulation-owned settlement development/history state. */
(function installSettlementEvolution() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-settlement-evolution-v1';
  const GAME_MINUTES_PER_DAY = 1440;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function clamp(value, min = 0, max = 100) { return Math.max(min, Math.min(max, Number(value))); }
  function intCoord(value, name) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer.`);
    return n;
  }
  function dependencies() {
    if (!Game.WorldComposition?.composeRegion) throw new Error('WorldComposition is required before SettlementEvolution.');
    if (!Game.WorldHierarchy?.refinementInput) throw new Error('WorldHierarchy is required before SettlementEvolution.');
    if (!Game.CampaignCalendar?.capture) throw new Error('CampaignCalendar is required before SettlementEvolution.');
  }
  function currentMinutes() {
    dependencies();
    const snapshot = Game.CampaignCalendar.capture();
    const value = Number(snapshot?.totalGameMinutes);
    if (!Number.isFinite(value) || value < 0) throw new Error('Authoritative campaign minutes are unavailable.');
    return value;
  }
  function seededMetric(seed, settlementId, name, min, max) {
    const span = max - min + 1;
    return min + (hash32(`${seed}|${settlementId}|development|${name}`) % span);
  }
  function baseState(seedInput, regionXInput, regionYInput) {
    dependencies();
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const composition = Game.WorldComposition.composeRegion(seed, regionX, regionY);
    if (!composition.settlement) return null;
    const settlementId = composition.settlement.id;
    const population = seededMetric(seed, settlementId, 'population', 32, 72);
    const prosperity = seededMetric(seed, settlementId, 'prosperity', 30, 70);
    const security = seededMetric(seed, settlementId, 'security', 35, 78);
    const trade = seededMetric(seed, settlementId, 'trade', 20, 68);
    const resources = seededMetric(seed, settlementId, 'resources', 30, 82);
    const fortification = /castle|fortified/.test(composition.settlement.type) ? 60 : seededMetric(seed, settlementId, 'fortification', 5, 28);
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      base: true,
      seed,
      settlementId,
      regionX,
      regionY,
      baseType: composition.settlement.type,
      baseFingerprint: composition.baseFingerprint,
      metrics: Object.freeze({ population, prosperity, security, trade, resources, damage: 0, fortification, abandonment: 0 }),
      status: 'stable',
      economicFunction: trade >= 55 ? 'trade' : resources >= 58 ? 'resource' : security >= 62 ? 'defensive' : 'local-service',
      lastGameMinute: 0,
      pendingGameMinutes: 0,
      accumulatedHistory: Object.freeze({ growth: 0, decline: 0, damage: 0, recovery: 0 }),
      presentationAuthority: false
    });
  }

  function normalizePrior(base, prior) {
    if (!prior) return base;
    if (prior.authority !== 'simulation' || String(prior.settlementId) !== base.settlementId) throw new TypeError('Compatible Simulation-owned settlement development state is required.');
    const metrics = prior.metrics || {};
    const history = prior.accumulatedHistory || {};
    const pendingGameMinutes = Math.max(0, Number(prior.pendingGameMinutes) || 0);
    if (!Number.isFinite(pendingGameMinutes) || pendingGameMinutes >= GAME_MINUTES_PER_DAY) throw new TypeError('Settlement pending game minutes must be within one day.');
    return Object.freeze({
      ...base,
      base: false,
      metrics: Object.freeze({
        population: clamp(metrics.population ?? base.metrics.population),
        prosperity: clamp(metrics.prosperity ?? base.metrics.prosperity),
        security: clamp(metrics.security ?? base.metrics.security),
        trade: clamp(metrics.trade ?? base.metrics.trade),
        resources: clamp(metrics.resources ?? base.metrics.resources),
        damage: clamp(metrics.damage ?? base.metrics.damage),
        fortification: clamp(metrics.fortification ?? base.metrics.fortification),
        abandonment: clamp(metrics.abandonment ?? base.metrics.abandonment)
      }),
      lastGameMinute: Math.max(0, Number(prior.lastGameMinute) || 0),
      pendingGameMinutes,
      accumulatedHistory: Object.freeze({
        growth: Math.max(0, Number(history.growth) || 0),
        decline: Math.max(0, Number(history.decline) || 0),
        damage: Math.max(0, Number(history.damage) || 0),
        recovery: Math.max(0, Number(history.recovery) || 0)
      })
    });
  }

  function outcomeStatus(metrics, deltaScore) {
    if (metrics.abandonment >= 72 || metrics.population <= 12) return 'abandoned';
    if (metrics.damage >= 68) return 'ruined';
    if (metrics.damage >= 38) return 'damaged';
    if (deltaScore >= 10) return 'growing';
    if (deltaScore <= -10) return 'declining';
    if (metrics.damage >= 12 && metrics.security >= 45 && metrics.prosperity >= 45) return 'recovering';
    if (metrics.fortification >= 65) return 'fortified';
    return 'stable';
  }

  function advance(seedInput, regionXInput, regionYInput, options = {}) {
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const base = baseState(seed, regionX, regionY);
    if (!base) return null;
    const prior = normalizePrior(base, options.priorState || null);
    const targetMinute = options.campaignMinutes === undefined ? currentMinutes() : Number(options.campaignMinutes);
    if (!Number.isFinite(targetMinute) || targetMinute < prior.lastGameMinute) throw new RangeError('Settlement evolution cannot move backwards.');
    const newlyObservedMinutes = targetMinute - prior.lastGameMinute;
    const accumulatedMinutes = prior.pendingGameMinutes + newlyObservedMinutes;
    const elapsedDays = Math.floor(accumulatedMinutes / GAME_MINUTES_PER_DAY);
    const pendingGameMinutes = accumulatedMinutes - elapsedDays * GAME_MINUTES_PER_DAY;
    const refinement = Game.WorldHierarchy.refinementInput(seed, regionX, regionY, targetMinute, options.persistentHistory || {});
    const aggregate = refinement.settlement?.aggregate || refinement.region.aggregate;
    const hazardPressure = clamp(Number(options.hazardPressure || 0));
    const warPressure = clamp(Number(options.warPressure ?? aggregate.militaryPressure ?? 0));
    const constructionSupport = clamp(Number(options.constructionSupport || 0));
    const historyDamage = clamp(Number(options.historicalDamage || 0));
    const dailyScale = Math.min(30, elapsedDays);
    const growthSignal = (Number(aggregate.prosperity || 0) + Number(aggregate.resources || 0) + Number(aggregate.trade || 0) + Number(aggregate.security || 0)) / 4;
    const declineSignal = (Number(aggregate.unrest || 0) + warPressure + hazardPressure + historyDamage) / 4;
    const net = growthSignal - declineSignal;
    const change = Math.trunc((net / 100) * dailyScale);
    const recovery = Math.trunc(((Number(aggregate.security || 0) + constructionSupport) / 200) * dailyScale);
    const damageGain = Math.trunc(((warPressure + hazardPressure + historyDamage) / 300) * dailyScale);
    const fortificationGain = dailyScale > 0 ? Math.trunc((constructionSupport + Math.max(0, warPressure - 35)) / 35) : 0;
    const metrics = {
      population: clamp(prior.metrics.population + change - Math.trunc(damageGain / 2)),
      prosperity: clamp(prior.metrics.prosperity + change - damageGain),
      security: clamp(prior.metrics.security + Math.trunc(change / 2) - damageGain),
      trade: clamp(prior.metrics.trade + Math.trunc(change / 2) - Math.trunc(damageGain / 2)),
      resources: clamp(prior.metrics.resources + Math.trunc(change / 3) - Math.trunc(damageGain / 2)),
      damage: clamp(prior.metrics.damage + damageGain - recovery),
      fortification: clamp(prior.metrics.fortification + fortificationGain),
      abandonment: clamp(prior.metrics.abandonment + Math.max(0, -change) + Math.trunc(damageGain / 2) - Math.trunc(recovery / 2))
    };
    const status = outcomeStatus(metrics, change - damageGain + recovery);
    const nextHistory = {
      growth: prior.accumulatedHistory.growth + Math.max(0, change),
      decline: prior.accumulatedHistory.decline + Math.max(0, -change),
      damage: prior.accumulatedHistory.damage + damageGain,
      recovery: prior.accumulatedHistory.recovery + recovery
    };
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      base: false,
      seed,
      settlementId: base.settlementId,
      regionX,
      regionY,
      baseType: base.baseType,
      baseFingerprint: base.baseFingerprint,
      metrics: Object.freeze(metrics),
      status,
      economicFunction: metrics.trade >= 62 ? 'trade' : metrics.resources >= 62 ? 'resource' : metrics.fortification >= 65 ? 'defensive' : base.economicFunction,
      lastGameMinute: targetMinute,
      pendingGameMinutes: Number(pendingGameMinutes.toFixed(6)),
      elapsedDaysApplied: elapsedDays,
      boundedCatchUp: true,
      localTicksReplayed: 0,
      hierarchyRefinementKey: refinement.refinementKey,
      accumulatedHistory: Object.freeze(nextHistory),
      presentationAuthority: false
    });
  }

  function materializationInput(state) {
    if (!state || state.authority !== 'simulation') throw new TypeError('Simulation-owned settlement development state is required.');
    const metrics = state.metrics;
    const density = clamp((metrics.population + metrics.prosperity) / 2);
    const activeStructureFraction = clamp(100 - metrics.damage - Math.trunc(metrics.abandonment / 2));
    const defenseTier = metrics.fortification >= 80 ? 3 : metrics.fortification >= 55 ? 2 : metrics.fortification >= 28 ? 1 : 0;
    return Object.freeze({
      authority: 'simulation',
      settlementId: state.settlementId,
      sourceBaseFingerprint: state.baseFingerprint,
      status: state.status,
      populationBand: metrics.population >= 76 ? 'large' : metrics.population >= 46 ? 'medium' : metrics.population >= 18 ? 'small' : 'sparse',
      buildingDensity: Math.round(density),
      activeStructureFraction,
      defenseTier,
      economicFunction: state.economicFunction,
      damageLevel: metrics.damage,
      abandonmentLevel: metrics.abandonment,
      accumulatedHistory: state.accumulatedHistory,
      refinementKey: state.hierarchyRefinementKey || null,
      mustDifferFromUntouchedBase: state.status !== 'stable' || Object.values(state.accumulatedHistory).some((value) => Number(value) > 0),
      presentationAuthority: false
    });
  }

  Game.SettlementEvolution = Object.freeze({ version: VERSION, authority: 'simulation', baseState, advance, materializationInput });
})();
