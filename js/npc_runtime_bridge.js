/*
  R04 / #237 + #351: final production integration bridge for NPC spatial state.

  Legacy NPCWorld still participates in the compatibility render chain and can mutate
  coordinates before the newer spatial wrapper finishes. The spatial runtime correctly
  owns authoritative occupancy. Valid-state reconciliation is queued through the
  render-first scheduler; invalid authoritative occupancy is repaired synchronously
  before optional relevance throttling can preserve corrupted coordinates.
*/
(function installNpcRuntimeBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-runtime-bridge-v3-invalid-recovery';
  const REGION_SIZE = Number(Game.SpatialWorld?.regionSize || Game.Config?.LOGICAL_REGION_TILES || 100);
  let installed = false;
  let attempts = 0;
  let lastSpatialSignature = '';
  let reconcileRequests = 0;
  let reconcileRuns = 0;
  let invalidRecoveryRuns = 0;

  function coordinateSignature() {
    const npcs = Game.State?.world?.npcs;
    if (!Array.isArray(npcs)) return '';
    return npcs.map((npc) => `${npc.id}:${Number(npc.row)},${Number(npc.col)}`).join('|');
  }

  function validSpatialPopulation() {
    const world = Game.State?.world;
    const village = world?.originVillage;
    const npcs = world?.npcs;
    if (!village || !Array.isArray(village.population) || !Array.isArray(npcs)) return false;
    if (npcs.length !== village.population.length || npcs.length === 0) return false;
    const occupied = new Set();
    for (const npc of npcs) {
      const row = Number(npc.row);
      const col = Number(npc.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
      if (row < 0 || row >= REGION_SIZE || col < 0 || col >= REGION_SIZE) return false;
      const key = `${row},${col}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
    return true;
  }

  function runSpatialUpdate({ forceFull = false } = {}) {
    const spatial = Game.NPCSpatial;
    if (!spatial || typeof spatial.updateAt !== 'function') return false;
    if (!forceFull) return spatial.updateAt();

    // Relevance throttling is valid only while the authoritative compact population is
    // already spatially valid. If a legacy render wrapper has produced NaN/duplicate/
    // out-of-bounds coordinates, treating those NPCs as non-due would freeze corruption.
    // Bypass the scheduling-only relevance service for this synchronous recovery call;
    // the next normal frame re-enters relevance scheduling from a valid population.
    const relevance = Game.NPCRelevanceRuntime;
    if (!relevance) return spatial.updateAt();
    try {
      Game.NPCRelevanceRuntime = null;
      return spatial.updateAt();
    } finally {
      Game.NPCRelevanceRuntime = relevance;
    }
  }

  function reconcile() {
    const world = Game.State?.world;
    const spatial = Game.NPCSpatial;
    if (!world?.originVillage || !spatial || typeof spatial.updateAt !== 'function') return false;
    reconcileRuns += 1;

    const before = coordinateSignature();
    const drifted = Boolean(lastSpatialSignature && before !== lastSpatialSignature);
    const invalid = !validSpatialPopulation();

    if (drifted || invalid || !lastSpatialSignature) {
      if (world.npcRuntime) world.npcRuntime.lastRoutineStateKey = null;
      if (invalid) invalidRecoveryRuns += 1;
      runSpatialUpdate({ forceFull: invalid });
    }

    const after = coordinateSignature();
    lastSpatialSignature = after;

    Game.NPCWorld?.drawPresentation?.();
    spatial.drawDevelopmentBubbles?.();
    return validSpatialPopulation();
  }

  function scheduleReconcile() {
    reconcileRequests += 1;

    // Invalid Simulation occupancy is not optional presentation/background work. Repair
    // it immediately so the lazy scheduler never receives corrupted coordinates as a
    // legitimate fixed/non-due baseline.
    if (!validSpatialPopulation()) return reconcile();

    Game.NPCRelevanceRuntime?.scheduleFrame?.();
    const scheduler = Game.FrameBudgetScheduler;
    if (scheduler?.enqueue) {
      scheduler.enqueue('npc-runtime-reconcile', () => reconcile(), {
        priority: 25,
        label: 'NPC runtime authoritative reconcile',
        version: String(Math.floor(Number(Game.GameTime?.capture?.()?.totalGameMinutes || 0)))
      });
      return true;
    }
    return reconcile();
  }

  function attach() {
    const renderer = Game.Renderer;
    if (installed) return true;
    if (!renderer || typeof renderer.renderWorld !== 'function' || !Game.NPCSpatial || !Game.NPCWorld) return false;

    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function npcRuntimeBridgeRenderWorld(force) {
      const result = renderWorld(force);
      scheduleReconcile();
      return result;
    };
    installed = true;
    return true;
  }

  function settle() {
    attempts += 1;
    const attached = attach();
    if (attached) scheduleReconcile();
    if (!attached && attempts < 600) requestAnimationFrame(settle);
  }

  function start() {
    requestAnimationFrame(() => requestAnimationFrame(settle));
  }

  Game.NPCRuntimeBridge = Object.freeze({
    version: VERSION,
    authority: 'simulation-integration',
    get installed() { return installed; },
    validSpatialPopulation,
    reconcile,
    scheduleReconcile,
    metrics() {
      return Object.freeze({
        reconcileRequests,
        reconcileRuns,
        invalidRecoveryRuns,
        queued: Boolean(Game.FrameBudgetScheduler?.metrics?.().queuedKeys?.includes('npc-runtime-reconcile'))
      });
    }
  });

  Game.Utils?.loadScriptOnce?.('js/npc_relevance_runtime.js', 'r04NpcRelevanceRuntimeModule');

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();

// #275 is a presentation-only companion. Queue it one frame after the final runtime bridge
// has attached so the bubble layout wrapper becomes the outermost presentation boundary.
function loadNpcActivityBubbleLayout() {
  requestAnimationFrame(() => {
    window.Game?.Utils?.loadScriptOnce?.('js/npc_activity_bubble_layout.js', 'r04NpcActivityBubbleLayoutModule');
  });
}
if (document.readyState === 'complete') loadNpcActivityBubbleLayout();
else window.addEventListener('load', loadNpcActivityBubbleLayout, { once: true });
