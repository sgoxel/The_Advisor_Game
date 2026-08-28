/* R02-T32 / #144: relevance-bounded, deterministic lazy/asynchronous-capable Simulation computation. */
(function installRelevanceBoundedCompute() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-relevance-bounded-compute-v1';
  const MINUTES_PER_DAY = 1440;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
      return out;
    }
    return value;
  }

  function fingerprint(value) {
    return hash32(JSON.stringify(stable(value))).toString(16).padStart(8, '0');
  }

  function intCoord(value, name) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new TypeError(`${name} must be a safe integer.`);
    return number;
  }

  function nonNegativeNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new TypeError(`${name} must be a finite non-negative number.`);
    return number;
  }

  function nonNegativeInteger(value, name) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} must be a non-negative safe integer.`);
    return number;
  }

  function dependencies() {
    if (!Game.WorldHierarchy?.refinementInput) throw new Error('WorldHierarchy is required before relevance-bounded computation.');
    if (!Game.PoliticalGeography?.baseRegion) throw new Error('PoliticalGeography is required before relevance-bounded computation.');
    if (!Game.SettlementEvolution?.baseState) throw new Error('SettlementEvolution is required before relevance-bounded computation.');
  }

  function freezeArray(values) {
    return Object.freeze(values.map((value) => Object.freeze(stable(value))));
  }

  function prepare(seedInput, regionXInput, regionYInput, options = {}) {
    dependencies();
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const regionX = intCoord(regionXInput, 'regionX');
    const regionY = intCoord(regionYInput, 'regionY');
    const targetCampaignMinutes = nonNegativeNumber(options.targetCampaignMinutes ?? 0, 'targetCampaignMinutes');
    const priorCampaignMinutes = nonNegativeNumber(options.priorCampaignMinutes ?? 0, 'priorCampaignMinutes');
    if (targetCampaignMinutes < priorCampaignMinutes) throw new RangeError('Lazy reconciliation cannot move campaign time backwards.');
    const authorityEpoch = String(options.authorityEpoch || 'campaign:default');
    const authorityRevision = nonNegativeInteger(options.authorityRevision ?? Math.floor(targetCampaignMinutes), 'authorityRevision');
    const irrelevantRegionCount = nonNegativeInteger(options.irrelevantRegionCount ?? 0, 'irrelevantRegionCount');
    const meaningfulEvents = freezeArray(Array.isArray(options.meaningfulEvents) ? options.meaningfulEvents : []);
    const persistentChanges = Object.freeze(stable(options.persistentChanges || {}));
    const politicalHistory = Object.freeze(stable(options.politicalHistory || {}));

    const refinement = Game.WorldHierarchy.refinementInput(seed, regionX, regionY, targetCampaignMinutes, persistentChanges);
    const basePolitical = Game.PoliticalGeography.baseRegion(seed, regionX, regionY);
    const currentPolitical = Game.PoliticalGeography.resolveCurrent(basePolitical, politicalHistory);
    const baseSettlement = Game.SettlementEvolution.baseState(seed, regionX, regionY);
    const settlementState = baseSettlement
      ? Game.SettlementEvolution.advance(seed, regionX, regionY, {
          priorState: options.priorSettlementState || baseSettlement,
          campaignMinutes: targetCampaignMinutes,
          persistentHistory: persistentChanges,
          hazardPressure: options.hazardPressure || 0,
          warPressure: options.warPressure,
          constructionSupport: options.constructionSupport || 0,
          historicalDamage: options.historicalDamage || 0
        })
      : null;
    const settlementMaterialization = settlementState ? Game.SettlementEvolution.materializationInput(settlementState) : null;

    const authoritativeInputs = Object.freeze(stable({
      seed,
      regionX,
      regionY,
      priorCampaignMinutes,
      targetCampaignMinutes,
      authorityEpoch,
      authorityRevision,
      hierarchyRefinementKey: refinement.refinementKey,
      politicalCurrent: currentPolitical.current,
      settlement: settlementMaterialization,
      meaningfulEvents,
      persistentChanges
    }));
    const inputFingerprint = fingerprint(authoritativeInputs);
    const elapsedMinutes = targetCampaignMinutes - priorCampaignMinutes;

    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      kind: 'lazy-reconciliation-job',
      seed,
      regionX,
      regionY,
      authorityEpoch,
      authorityRevision,
      priorCampaignMinutes,
      targetCampaignMinutes,
      elapsedMinutes,
      inputFingerprint,
      authoritativeInputs,
      workPlan: Object.freeze({
        continuousEntityTicks: 0,
        localMicroActionsReplayed: 0,
        dayNightCyclesReplayed: 0,
        relevantRegionsProcessed: 1,
        boundedAggregateOperations: 4,
        continuousWorkUnits: 1,
        irrelevantRegionsKnown: irrelevantRegionCount,
        scalesWithIrrelevantWorldSize: false
      }),
      presentationAuthority: false
    });
  }

  function compute(job) {
    if (!job || job.authority !== 'simulation' || job.kind !== 'lazy-reconciliation-job') {
      throw new TypeError('A Simulation-owned lazy reconciliation job is required.');
    }
    const elapsedDays = Math.floor(job.elapsedMinutes / MINUTES_PER_DAY);
    const resultCore = Object.freeze(stable({
      inputFingerprint: job.inputFingerprint,
      authorityEpoch: job.authorityEpoch,
      authorityRevision: job.authorityRevision,
      regionX: job.regionX,
      regionY: job.regionY,
      targetCampaignMinutes: job.targetCampaignMinutes,
      elapsedMinutes: job.elapsedMinutes,
      elapsedDays,
      hierarchyRefinementKey: job.authoritativeInputs.hierarchyRefinementKey,
      politicalCurrent: job.authoritativeInputs.politicalCurrent,
      settlement: job.authoritativeInputs.settlement,
      meaningfulEvents: job.authoritativeInputs.meaningfulEvents,
      persistentChanges: job.authoritativeInputs.persistentChanges
    }));
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      kind: 'lazy-reconciliation-result',
      authorityEpoch: job.authorityEpoch,
      authorityRevision: job.authorityRevision,
      targetCampaignMinutes: job.targetCampaignMinutes,
      inputFingerprint: job.inputFingerprint,
      resultFingerprint: fingerprint(resultCore),
      result: resultCore,
      boundedCatchUp: true,
      workAccounting: job.workPlan,
      presentationAuthority: false
    });
  }

  function computeAsync(job, options = {}) {
    const delayMs = Math.max(0, Math.min(1000, Math.trunc(Number(options.delayMs) || 0)));
    return new Promise((resolve) => {
      setTimeout(() => resolve(compute(job)), delayMs);
    });
  }

  function initialCommitState(authorityEpoch = 'campaign:default') {
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      authorityEpoch: String(authorityEpoch),
      authorityRevision: -1,
      targetCampaignMinutes: -1,
      inputFingerprint: null,
      resultFingerprint: null,
      result: null
    });
  }

  function acceptResult(currentState, candidate) {
    if (!currentState || currentState.authority !== 'simulation') throw new TypeError('Simulation-owned commit state is required.');
    if (!candidate || candidate.authority !== 'simulation' || candidate.kind !== 'lazy-reconciliation-result') throw new TypeError('Simulation-owned reconciliation result is required.');
    if (candidate.authorityEpoch !== currentState.authorityEpoch) {
      return Object.freeze({ accepted: false, reason: 'authority-epoch-mismatch', state: currentState });
    }
    if (candidate.targetCampaignMinutes < currentState.targetCampaignMinutes) {
      return Object.freeze({ accepted: false, reason: 'stale-campaign-time', state: currentState });
    }
    if (candidate.authorityRevision < currentState.authorityRevision) {
      return Object.freeze({ accepted: false, reason: 'stale-revision', state: currentState });
    }
    if (candidate.authorityRevision === currentState.authorityRevision) {
      if (candidate.inputFingerprint === currentState.inputFingerprint && candidate.resultFingerprint === currentState.resultFingerprint) {
        return Object.freeze({ accepted: false, reason: 'duplicate-result', state: currentState });
      }
      return Object.freeze({ accepted: false, reason: 'conflicting-same-revision', state: currentState });
    }
    const nextState = Object.freeze({
      version: VERSION,
      authority: 'simulation',
      authorityEpoch: currentState.authorityEpoch,
      authorityRevision: candidate.authorityRevision,
      targetCampaignMinutes: candidate.targetCampaignMinutes,
      inputFingerprint: candidate.inputFingerprint,
      resultFingerprint: candidate.resultFingerprint,
      result: candidate.result
    });
    return Object.freeze({ accepted: true, reason: 'newer-authoritative-revision', state: nextState });
  }

  function isStale(currentState, jobOrResult) {
    if (!currentState || currentState.authority !== 'simulation') throw new TypeError('Simulation-owned commit state is required.');
    if (!jobOrResult || jobOrResult.authority !== 'simulation') throw new TypeError('Simulation-owned work is required.');
    return jobOrResult.authorityEpoch !== currentState.authorityEpoch
      || jobOrResult.targetCampaignMinutes < currentState.targetCampaignMinutes
      || jobOrResult.authorityRevision < currentState.authorityRevision;
  }

  Game.RelevanceBoundedCompute = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    prepare,
    compute,
    computeAsync,
    initialCommitState,
    acceptResult,
    isStale
  });
})();
