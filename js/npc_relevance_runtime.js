/*
  R04 / #351: deterministic NPC relevance tiers and lazy-detail scheduling.
  Simulation remains authoritative; this module owns only when expensive per-NPC detail
  may be materialized and the compact scheduling metadata needed to reconcile it later.
*/
(function installNpcRelevanceRuntime(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  if (Game.NPCRelevanceRuntime) return;

  const VERSION = 'r04-npc-relevance-v1';
  const TIER = Object.freeze({ CRITICAL: 'critical', NEARBY: 'nearby', LOCAL: 'local', DISTANT: 'distant' });
  const CADENCE_MINUTES = Object.freeze({ critical: 1, nearby: 2, local: 5, distant: 15 });
  const NEAR_DISTANCE = 14;
  const LOCAL_DISTANCE = 38;
  const compact = new Map();
  const samples = [];
  let lastSecond = -1;
  let jobsThisSecond = 0;
  let jobsPerSecond = 0;
  let deferredJobs = 0;
  let completedJobs = 0;
  let promotedReconciliations = 0;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function gameMinute() {
    const captured = Game.GameTime?.capture?.();
    const value = Number(captured?.totalGameMinutes ?? Game.State?.world?.gameTime?.totalGameMinutes ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  function manhattan(a, b) {
    return Math.abs(Number(a?.row || 0) - Number(b?.row || 0)) + Math.abs(Number(a?.col || 0) - Number(b?.col || 0));
  }

  function visibleOnCanvas(npc) {
    const renderer = Game.Renderer;
    const canvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    if (!renderer?.gridToScreen || !canvas) return false;
    try {
      const point = renderer.gridToScreen(Number(npc.row), Number(npc.col), 0, 0);
      const margin = 48;
      return Number.isFinite(point?.x) && Number.isFinite(point?.y)
        && point.x >= -margin && point.y >= -margin
        && point.x <= canvas.clientWidth + margin && point.y <= canvas.clientHeight + margin;
    } catch (_) {
      return false;
    }
  }

  function classify(npc) {
    const player = Game.State?.world?.player;
    const dialogueCritical = Boolean(npc?.dialogueWith || npc?.interactionCritical || npc?.selectedForInteraction);
    if (dialogueCritical || visibleOnCanvas(npc)) return TIER.CRITICAL;
    const distance = player ? manhattan(npc, player) : Infinity;
    if (distance <= NEAR_DISTANCE) return TIER.NEARBY;
    if (distance <= LOCAL_DISTANCE) return TIER.LOCAL;
    return TIER.DISTANT;
  }

  function rank(tier) {
    return tier === TIER.CRITICAL ? 0 : tier === TIER.NEARBY ? 1 : tier === TIER.LOCAL ? 2 : 3;
  }

  function cadenceFor(tier) {
    return CADENCE_MINUTES[tier] || CADENCE_MINUTES.distant;
  }

  function stableBucket(npc, tier) {
    const cadence = cadenceFor(tier);
    return cadence <= 1 ? 0 : hash32(`${Game.State?.world?.seed || ''}|${npc?.id || ''}|${tier}`) % cadence;
  }

  function ensureCompact(npc, minute) {
    const id = String(npc?.id || '');
    if (!id) return null;
    let entry = compact.get(id);
    if (!entry) {
      const tier = classify(npc);
      entry = {
        id,
        tier,
        previousTier: tier,
        bucket: stableBucket(npc, tier),
        lastObservedMinute: minute,
        lastDetailedMinute: minute - cadenceFor(tier),
        lastRow: Number(npc.row),
        lastCol: Number(npc.col),
        lastActivity: String(npc.activity || 'idle'),
        detailLoaded: tier !== TIER.DISTANT
      };
      compact.set(id, entry);
    }
    return entry;
  }

  function isDue(entry, tier, minute, promoted) {
    const cadence = cadenceFor(tier);
    if (promoted) return true;
    if (tier === TIER.CRITICAL) return entry.lastDetailedMinute < minute;
    if (entry.lastDetailedMinute >= minute) return false;
    return (minute % cadence) === stableBucket({ id: entry.id }, tier);
  }

  function updateRateCounter() {
    const second = Math.floor(Date.now() / 1000);
    if (second !== lastSecond) {
      jobsPerSecond = jobsThisSecond;
      jobsThisSecond = 0;
      lastSecond = second;
    }
    jobsThisSecond += 1;
  }

  function materialize(npc, entry, tier, minute, promoted) {
    const started = performance.now();
    // Existing authoritative state/history remains the source of truth. The lazy detail
    // layer only derives already-supported schedule detail; it does not invent actions.
    if (Game.NPCLife?.scheduleState) {
      try { npc.dailySchedule = Game.NPCLife.scheduleState(npc, minute); } catch (_) {}
    }
    entry.previousTier = entry.tier;
    entry.tier = tier;
    entry.bucket = stableBucket(npc, tier);
    entry.lastObservedMinute = minute;
    entry.lastDetailedMinute = minute;
    entry.lastRow = Number(npc.row);
    entry.lastCol = Number(npc.col);
    entry.lastActivity = String(npc.activity || 'idle');
    entry.detailLoaded = tier !== TIER.DISTANT;
    if (promoted) promotedReconciliations += 1;
    const duration = Math.max(0, performance.now() - started);
    samples.push(duration);
    if (samples.length > 240) samples.splice(0, samples.length - 240);
    completedJobs += 1;
    updateRateCounter();
    return true;
  }

  function scheduleNpc(npc, minute) {
    const entry = ensureCompact(npc, minute);
    if (!entry) return false;
    const tier = classify(npc);
    const promoted = rank(tier) < rank(entry.tier);
    entry.lastObservedMinute = minute;
    entry.lastRow = Number(npc.row);
    entry.lastCol = Number(npc.col);
    entry.lastActivity = String(npc.activity || entry.lastActivity || 'idle');

    if (!isDue(entry, tier, minute, promoted)) {
      entry.previousTier = entry.tier;
      entry.tier = tier;
      entry.bucket = stableBucket(npc, tier);
      if (tier === TIER.DISTANT) entry.detailLoaded = false;
      return false;
    }

    const scheduler = Game.FrameBudgetScheduler;
    const jobKey = `npc-detail:${entry.id}`;
    if (scheduler?.enqueue) {
      scheduler.enqueue(jobKey, () => materialize(npc, entry, tier, minute, promoted), {
        priority: tier === TIER.CRITICAL ? 30 : tier === TIER.NEARBY ? 20 : tier === TIER.LOCAL ? 10 : 0,
        label: `NPC detail ${entry.id}`,
        version: `${minute}:${tier}:${entry.bucket}`
      });
      if (scheduler.interactionActive?.() && tier !== TIER.CRITICAL) deferredJobs += 1;
      return true;
    }
    return materialize(npc, entry, tier, minute, promoted);
  }

  function scheduleFrame() {
    const npcs = Game.State?.world?.npcs;
    if (!Array.isArray(npcs) || !npcs.length) return false;
    const minute = gameMinute();
    for (const npc of npcs) scheduleNpc(npc, minute);
    return true;
  }

  function detailEligible(npc) {
    const entry = compact.get(String(npc?.id || ''));
    const tier = entry?.tier || classify(npc);
    return tier === TIER.CRITICAL || tier === TIER.NEARBY;
  }

  function snapshot() {
    const counts = { critical: 0, nearby: 0, local: 0, distant: 0 };
    for (const entry of compact.values()) counts[entry.tier] = (counts[entry.tier] || 0) + 1;
    const sorted = samples.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
    return Object.freeze({
      version: VERSION,
      authority: 'scheduling-only',
      compactStatePersisted: false,
      counts: Object.freeze(counts),
      jobsPerSecond,
      deferredJobs,
      completedJobs,
      promotedReconciliations,
      npcJobP95Ms: p95,
      npcJobWorstMs: sorted.length ? sorted[sorted.length - 1] : 0,
      cadenceMinutes: CADENCE_MINUTES,
      entries: Array.from(compact.values()).map((entry) => Object.freeze({ ...entry }))
    });
  }

  Game.NPCRelevanceRuntime = Object.freeze({
    version: VERSION,
    authority: 'scheduling-only',
    tiers: TIER,
    cadenceMinutes: CADENCE_MINUTES,
    classify,
    stableBucket,
    scheduleFrame,
    detailEligible,
    snapshot
  });
})(typeof window !== 'undefined' ? window : globalThis);
