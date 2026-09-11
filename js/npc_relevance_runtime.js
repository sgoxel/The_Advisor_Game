/*
  R04 / #351: deterministic NPC relevance tiers and lazy-detail scheduling.
  Simulation remains authoritative; this module owns only when expensive per-NPC detail
  may be materialized and the compact scheduling metadata needed to reconcile it later.
*/
(function installNpcRelevanceRuntime(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  if (Game.NPCRelevanceRuntime) return;

  const VERSION = 'r04-npc-relevance-v6-demotion-snapshot';
  const TIER = Object.freeze({ CRITICAL: 'critical', NEARBY: 'nearby', LOCAL: 'local', DISTANT: 'distant' });
  const CADENCE_MINUTES = Object.freeze({ critical: 1, nearby: 2, local: 5, distant: 15 });
  const CRITICAL_DISTANCE = 6;
  const NEAR_DISTANCE = 14;
  const LOCAL_DISTANCE = 38;
  const compact = new Map();
  const samples = [];
  const dispatchSamples = [];
  let lastSecond = -1;
  let jobsThisSecond = 0;
  let jobsPerSecond = 0;
  let deferredJobs = 0;
  let completedJobs = 0;
  let promotedReconciliations = 0;

  function hash32(text) { let hash = 2166136261 >>> 0; for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; } return hash >>> 0; }
  function gameTime() { const captured = Game.GameTime?.capture?.(); const value = Number(captured?.totalGameMinutes ?? Game.State?.world?.gameTime?.totalGameMinutes ?? 0); return Number.isFinite(value) ? Math.max(0, value) : 0; }
  function manhattan(a, b) { return Math.abs(Number(a?.row || 0) - Number(b?.row || 0)) + Math.abs(Number(a?.col || 0) - Number(b?.col || 0)); }
  function classify(npc) { const player = Game.State?.world?.player; const interactionCritical = Boolean(npc?.dialogueWith || npc?.interactionCritical || npc?.selectedForInteraction); if (interactionCritical) return TIER.CRITICAL; const distance = player ? manhattan(npc, player) : Infinity; if (distance <= CRITICAL_DISTANCE) return TIER.CRITICAL; if (distance <= NEAR_DISTANCE) return TIER.NEARBY; if (distance <= LOCAL_DISTANCE) return TIER.LOCAL; return TIER.DISTANT; }
  function rank(tier) { return tier === TIER.CRITICAL ? 0 : tier === TIER.NEARBY ? 1 : tier === TIER.LOCAL ? 2 : 3; }
  function cadenceFor(tier) { return CADENCE_MINUTES[tier] || CADENCE_MINUTES.distant; }
  function stableBucket(npc, tier) { const cadence = cadenceFor(tier); return cadence <= 1 ? 0 : hash32(`${Game.State?.world?.seed || ''}|${npc?.id || ''}|${tier}`) % cadence; }
  function stablePhase(npc, tier) { const cadence = cadenceFor(tier); const hash = hash32(`${Game.State?.world?.seed || ''}|${npc?.id || ''}|${tier}|temporal-phase`); return (hash / 0x100000000) * cadence; }
  function dueThreshold(time, npc, tier) { const cadence = cadenceFor(tier); const cycleStart = Math.floor(time / cadence) * cadence; const current = cycleStart + stablePhase(npc, tier); if (time + 1e-9 >= current) return current; return current - cadence; }

  function ensureCompact(npc, time) {
    const id = String(npc?.id || ''); if (!id) return null;
    let entry = compact.get(id);
    if (!entry) { const tier = classify(npc); entry = { id, tier, previousTier: tier, bucket: stableBucket(npc, tier), phaseOffsetMinutes: stablePhase(npc, tier), lastObservedMinute: Math.floor(time), lastObservedTime: time, lastDetailedMinute: Math.floor(time), lastDetailedTime: time, lastAuthoritativeMinute: Math.floor(time), lastAuthoritativeTime: time, lastRow: Number(npc.row), lastCol: Number(npc.col), lastActivity: String(npc.activity || 'idle'), detailLoaded: tier !== TIER.DISTANT, authoritativePromotionPending: false, demotionSnapshot: null }; compact.set(id, entry); }
    return entry;
  }

  function authoritativeDemotionSnapshot(npc, time) {
    return Object.freeze({ id: String(npc?.id || ''), authoritativeTime: time, row: Number(npc?.row), col: Number(npc?.col), activity: String(npc?.activity || 'idle') });
  }
  function captureDemotion(entry, npc, tier, time) {
    const demotedToDistant = tier === TIER.DISTANT && entry.tier !== TIER.DISTANT;
    if (!demotedToDistant) return false;
    entry.demotionSnapshot = authoritativeDemotionSnapshot(npc, time);
    entry.lastAuthoritativeMinute = Math.floor(time); entry.lastAuthoritativeTime = time;
    entry.lastRow = entry.demotionSnapshot.row; entry.lastCol = entry.demotionSnapshot.col; entry.lastActivity = entry.demotionSnapshot.activity;
    return true;
  }
  function refreshTierMetadata(entry, npc, tier) { entry.bucket = stableBucket(npc, tier); entry.phaseOffsetMinutes = stablePhase(npc, tier); }
  function isDue(entry, npc, tier, time, promoted) { if (promoted) return true; if (tier === TIER.DISTANT) return false; const threshold = dueThreshold(time, npc, tier); return Number(entry.lastDetailedTime ?? entry.lastDetailedMinute ?? -Infinity) + 1e-9 < threshold; }
  function authoritativeDue(npc, minuteInput = gameTime()) { const time = Math.max(0, Number(minuteInput) || 0); const entry = ensureCompact(npc, time); if (!entry) return true; const tier = classify(npc); const promoted = rank(tier) < rank(entry.tier) || entry.authoritativePromotionPending === true; if (promoted) return true; const lastTime = Number(entry.lastAuthoritativeTime ?? entry.lastAuthoritativeMinute ?? time); const threshold = dueThreshold(time, npc, tier); if (lastTime + 1e-9 < threshold) return true; const cadence = cadenceFor(tier); return (time - lastTime) >= cadence * 2; }
  function markAuthoritativeUpdated(npc, minuteInput = gameTime()) { const time = Math.max(0, Number(minuteInput) || 0); const entry = ensureCompact(npc, time); if (!entry) return false; const tier = classify(npc); captureDemotion(entry, npc, tier, time); entry.previousTier = entry.tier; entry.tier = tier; refreshTierMetadata(entry, npc, tier); entry.lastAuthoritativeMinute = Math.floor(time); entry.lastAuthoritativeTime = time; entry.lastObservedMinute = Math.floor(time); entry.lastObservedTime = time; entry.lastRow = Number(npc.row); entry.lastCol = Number(npc.col); entry.lastActivity = String(npc.activity || 'idle'); entry.detailLoaded = tier !== TIER.DISTANT; entry.authoritativePromotionPending = false; return true; }
  function updateRateCounter() { const second = Math.floor(Date.now() / 1000); if (second !== lastSecond) { jobsPerSecond = jobsThisSecond; jobsThisSecond = 0; lastSecond = second; } jobsThisSecond += 1; }
  function recordDispatch(npc, entry, tier, time) { dispatchSamples.push(Object.freeze({ id: String(npc?.id || entry.id), tier, bucket: entry.bucket, phaseOffsetMinutes: Number(entry.phaseOffsetMinutes.toFixed(6)), gameTimeMinutes: Number(time.toFixed(6)), monotonicMs: Number((typeof performance !== 'undefined' ? performance.now() : 0).toFixed(3)) })); if (dispatchSamples.length > 512) dispatchSamples.splice(0, dispatchSamples.length - 512); }
  function materialize(npc, entry, tier, time, promoted) { const started = performance.now(); if (Game.NPCLife?.scheduleState) { try { npc.dailySchedule = Game.NPCLife.scheduleState(npc, time); } catch (_) {} } if (promoted) entry.authoritativePromotionPending = true; entry.previousTier = entry.tier; entry.tier = tier; refreshTierMetadata(entry, npc, tier); entry.lastObservedMinute = Math.floor(time); entry.lastObservedTime = time; entry.lastDetailedMinute = Math.floor(time); entry.lastDetailedTime = time; entry.lastRow = Number(npc.row); entry.lastCol = Number(npc.col); entry.lastActivity = String(npc.activity || 'idle'); entry.detailLoaded = tier !== TIER.DISTANT; if (promoted) promotedReconciliations += 1; const duration = Math.max(0, performance.now() - started); samples.push(duration); if (samples.length > 240) samples.splice(0, samples.length - 240); recordDispatch(npc, entry, tier, time); completedJobs += 1; updateRateCounter(); return true; }
  function scheduleNpc(npc, time) { const entry = ensureCompact(npc, time); if (!entry) return false; const tier = classify(npc); const promoted = rank(tier) < rank(entry.tier); if (promoted) entry.authoritativePromotionPending = true; captureDemotion(entry, npc, tier, time); entry.lastObservedMinute = Math.floor(time); entry.lastObservedTime = time; entry.lastRow = Number(npc.row); entry.lastCol = Number(npc.col); entry.lastActivity = String(npc.activity || entry.lastActivity || 'idle'); if (!isDue(entry, npc, tier, time, promoted)) { entry.previousTier = entry.tier; entry.tier = tier; refreshTierMetadata(entry, npc, tier); if (tier === TIER.DISTANT) entry.detailLoaded = false; return false; } const scheduler = Game.FrameBudgetScheduler; const jobKey = `npc-detail:${entry.id}`; const cadence = cadenceFor(tier); const cycle = Math.floor(time / cadence); if (scheduler?.enqueue) { scheduler.enqueue(jobKey, () => materialize(npc, entry, tier, time, promoted), { priority: tier === TIER.CRITICAL ? 30 : tier === TIER.NEARBY ? 20 : tier === TIER.LOCAL ? 10 : 0, label: `NPC detail ${entry.id}`, version: `${cycle}:${tier}:${entry.bucket}:${entry.phaseOffsetMinutes.toFixed(6)}` }); if (scheduler.interactionActive?.() && tier !== TIER.CRITICAL) deferredJobs += 1; return true; } return materialize(npc, entry, tier, time, promoted); }
  function scheduleFrame() { const npcs = Game.State?.world?.npcs; if (!Array.isArray(npcs) || !npcs.length) return false; const time = gameTime(); for (const npc of npcs) scheduleNpc(npc, time); return true; }
  function detailEligible(npc) { const entry = compact.get(String(npc?.id || '')); const tier = entry?.tier || classify(npc); return tier === TIER.CRITICAL || tier === TIER.NEARBY; }
  function snapshot() { const counts = { critical: 0, nearby: 0, local: 0, distant: 0 }; for (const entry of compact.values()) counts[entry.tier] = (counts[entry.tier] || 0) + 1; const sorted = samples.slice().sort((a, b) => a - b); const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0; return Object.freeze({ version: VERSION, authority: 'scheduling-only', compactStatePersisted: false, counts: Object.freeze(counts), jobsPerSecond, deferredJobs, completedJobs, promotedReconciliations, npcJobP95Ms: p95, npcJobWorstMs: sorted.length ? sorted[sorted.length - 1] : 0, cadenceMinutes: CADENCE_MINUTES, dispatchSamples: dispatchSamples.slice(), entries: Array.from(compact.values()).map((entry) => Object.freeze({ ...entry })) }); }
  Game.NPCRelevanceRuntime = Object.freeze({ version: VERSION, authority: 'scheduling-only', tiers: TIER, cadenceMinutes: CADENCE_MINUTES, classify, stableBucket, stablePhase, authoritativeDue, markAuthoritativeUpdated, scheduleFrame, detailEligible, snapshot });
})(typeof window !== 'undefined' ? window : globalThis);
