/*
  R04 / #237 Admin regression: final production integration bridge for NPC spatial state.

  Legacy NPCWorld still participates in the compatibility render chain and can mutate
  coordinates before the newer spatial wrapper finishes. The spatial runtime correctly
  owns authoritative occupancy, but its same-game-minute idempotence guard cannot know
  that another wrapper changed coordinates afterward. This bridge detects that drift and
  re-applies NPCSpatial at the final render boundary without changing schedule, topology,
  collision, yielding or GameTime rules.
*/
(function installNpcRuntimeBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-runtime-bridge-v1';
  const REGION_SIZE = Number(Game.SpatialWorld?.regionSize || Game.Config?.LOGICAL_REGION_TILES || 100);
  let installed = false;
  let attempts = 0;
  let lastSpatialSignature = '';

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

  function reconcile() {
    const world = Game.State?.world;
    const spatial = Game.NPCSpatial;
    if (!world?.originVillage || !spatial || typeof spatial.updateAt !== 'function') return false;

    const before = coordinateSignature();
    const drifted = Boolean(lastSpatialSignature && before !== lastSpatialSignature);
    const invalid = !validSpatialPopulation();

    if (drifted || invalid || !lastSpatialSignature) {
      // The key is runtime bookkeeping, not world truth. Clearing it only when the
      // observed coordinates diverged lets NPCSpatial recompute the same authoritative
      // game-minute solution that its idempotence guard would otherwise skip.
      if (world.npcRuntime) world.npcRuntime.lastRoutineStateKey = null;
      spatial.updateAt();
    }

    const after = coordinateSignature();
    lastSpatialSignature = after;

    Game.NPCWorld?.drawPresentation?.();
    spatial.drawDevelopmentBubbles?.();
    return validSpatialPopulation();
  }

  function attach() {
    const renderer = Game.Renderer;
    if (installed) return true;
    if (!renderer || typeof renderer.renderWorld !== 'function' || !Game.NPCSpatial || !Game.NPCWorld) return false;

    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function npcRuntimeBridgeRenderWorld(force) {
      const result = renderWorld(force);
      reconcile();
      return result;
    };
    installed = true;
    return true;
  }

  function settle() {
    attempts += 1;
    const attached = attach();
    const reconciled = attached && reconcile();
    if ((!attached || !reconciled) && attempts < 600) requestAnimationFrame(settle);
  }

  function start() {
    // Attach after all compatibility wrappers have had the opportunity to install.
    requestAnimationFrame(() => requestAnimationFrame(settle));
  }

  Game.NPCRuntimeBridge = Object.freeze({
    version: VERSION,
    authority: 'simulation-integration',
    get installed() { return installed; },
    validSpatialPopulation,
    reconcile
  });

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();
