/*
  R04 / #317 + #346 + #347: contextual NPC activity labels.
  Presentation derives human-readable actions from Simulation-validated activity state.
*/
(function installNpcContextualActivity(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-contextual-npc-activity-v5-authority-guard';
  const RETRY_LIMIT = 600;
  let attempts = 0;
  let installed = false;
  let lastSnapshot = null;
  const WORK_BY_OCCUPATION = Object.freeze({
    baker: 'Baking', blacksmith: 'Forging', smith: 'Forging', miller: 'Milling',
    innkeeper: 'Serving Guests', tavernkeeper: 'Serving Guests', trader: 'Trading', merchant: 'Trading',
    farmer: 'Checking Crops', herder: 'Tending Animals', shepherd: 'Tending Animals',
    woodcutter: 'Cutting Woods', lumberjack: 'Cutting Woods', hunter: 'Hunting', guard: 'Guarding',
    carpenter: 'Carpentry', laborer: 'Handling Materials', healer: 'Treating Patients', villager: 'Running Errands'
  });
  function normalized(value) { return String(value ?? '').trim().toLowerCase().replaceAll('_', '-'); }
  function occupationAction(npc) {
    const occupation = normalized(npc?.occupation);
    if (WORK_BY_OCCUPATION[occupation]) return WORK_BY_OCCUPATION[occupation];
    if (occupation.includes('bake')) return 'Baking';
    if (occupation.includes('smith')) return 'Forging';
    if (occupation.includes('mill')) return 'Milling';
    if (occupation.includes('farm')) return 'Checking Crops';
    if (occupation.includes('hunt')) return 'Hunting';
    if (occupation.includes('wood') || occupation.includes('lumber')) return 'Cutting Woods';
    if (occupation.includes('guard') || occupation.includes('watch')) return 'Guarding';
    if (occupation.includes('inn') || occupation.includes('tavern')) return 'Serving Guests';
    if (occupation.includes('trade') || occupation.includes('merchant')) return 'Trading';
    return 'Performing Duties';
  }
  function hasValidDirectPartner(npc) {
    return Boolean(Game.NPCIndoorWorkAnchors?.conversationValidity?.(npc, Game.State?.world)?.valid);
  }
  function semanticActivity(npc) {
    const activity = normalized(npc?.activity || npc?.dailySchedule?.activity || 'idle');
    const scheduled = normalized(npc?.dailySchedule?.activity);
    const movement = normalized(npc?.movementDecision);
    if ((npc?.dialogueWith || activity === 'talking' || activity === 'chatting') && hasValidDirectPartner(npc)) return 'Chatting';
    const visiblyMoving = ['move', 'side-step', 'yield-detour'].includes(movement);
    if (visiblyMoving || ['commuting-to-work', 'returning-home', 'walking', 'traveling', 'approach'].includes(activity)) return 'Walking';
    if (activity === 'waiting' || ((npc?.dialogueWith || activity === 'talking' || activity === 'chatting') && !hasValidDirectPartner(npc))) return 'Waiting';
    if (scheduled === 'sleep' || scheduled === 'sleeping' || activity === 'sleep' || activity === 'sleeping') return 'Sleeping';
    if (activity === 'working' || activity === 'work') return occupationAction(npc);
    if (activity === 'social' || activity === 'socializing') return 'Socializing';
    if (activity === 'local-errand' || activity === 'errand') return visiblyMoving ? 'Walking' : 'Running Errands';
    if (activity === 'home' || activity === 'rest' || activity === 'resting' || activity === 'idle') return 'Resting';
    const direct = {
      baking: 'Baking', walking: 'Walking', chatting: 'Waiting', talking: 'Waiting',
      'cutting-woods': 'Cutting Woods', 'cutting-wood': 'Cutting Woods', hunting: 'Hunting',
      'checking-crops': 'Checking Crops', forging: 'Forging', milling: 'Milling', guarding: 'Guarding',
      trading: 'Trading', harvesting: 'Harvesting', planting: 'Planting', watering: 'Watering', cooking: 'Cooking', eating: 'Eating'
    };
    if (direct[activity]) return direct[activity];
    return activity ? activity.split('-').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Resting';
  }
  function presentationClone(npc) {
    // Derive presentation semantics from a detached shell. Even read-only presentation
    // helpers must never receive the authoritative NPC object when a clone is sufficient.
    const detached = { ...npc };
    return { ...detached, activity: semanticActivity(detached), movementDecision: ['side-step', 'yield-detour', 'yield-wait'].includes(normalized(detached?.movementDecision)) ? 'hold' : detached?.movementDecision };
  }
  function withBubblesSuppressed(callback) {
    if (!Game.Config) return callback();
    const prior = Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES;
    Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    try { return callback(); } finally { Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = prior; }
  }
  function authoritySnapshot(npcs) {
    return npcs.map((npc) => ({ id: npc?.id, activity: npc?.activity, row: npc?.row, col: npc?.col }));
  }
  function authorityDifferences(npcs, before) {
    const fields = ['id', 'activity', 'row', 'col'];
    const differences = [];
    for (let i = 0; i < before.length; i += 1) {
      const current = npcs[i], original = before[i];
      if (!current || !original) {
        differences.push(`index=${i}:record-missing`);
        continue;
      }
      for (const field of fields) {
        // Object.is treats an unchanged NaN as unchanged; the old !== guard could
        // report a mutation when an already-invalid numeric value simply remained NaN.
        if (!Object.is(current[field], original[field])) differences.push(`index=${i},id=${String(original.id)},field=${field}`);
      }
    }
    if (npcs.length !== before.length) differences.push(`length=${before.length}->${npcs.length}`);
    return differences;
  }
  function drawContextualBubbles() {
    const authoritativeWorld = Game.State?.world;
    const layout = Game.NPCBubbleLayout;
    if (!authoritativeWorld || !Array.isArray(authoritativeWorld.npcs) || !layout?.draw) return false;
    if (Game.Config?.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES === false) return false;
    const authoritativeNpcs = authoritativeWorld.npcs;
    // Capture authority before any presentation semantic derivation, not only before draw.
    const before = authoritySnapshot(authoritativeNpcs);
    const presentationNpcs = authoritativeNpcs.map(presentationClone);

    // Never replace `authoritativeWorld.npcs` in-place. Region activation and other
    // synchronous runtime hooks may retain the authoritative world object while the
    // presentation draw is running. Mutating that object's `npcs` reference therefore
    // lets presentation-only work leak into authoritative update paths. Instead expose
    // a shallow presentation-world facade for the duration of the bubble draw; every
    // presented NPC is already a detached clone and the authoritative world object is
    // never modified.
    const presentationWorld = { ...authoritativeWorld, npcs: presentationNpcs };
    Game.State.world = presentationWorld;
    try {
      layout.draw();
      lastSnapshot = Object.freeze({ version: VERSION, authority: 'presentation-only', labels: presentationNpcs.map((npc) => Object.freeze({ id: npc.id, name: npc.name, activity: npc.activity })) });
      return true;
    } finally {
      Game.State.world = authoritativeWorld;
      const differences = authorityDifferences(authoritativeNpcs, before);
      if (differences.length) throw new Error(`Contextual activity presentation detected authoritative NPC mutation: ${differences.slice(0, 8).join('; ')}`);
    }
  }
  function install() {
    if (installed) return true;
    attempts += 1;
    const renderer = Game.Renderer;
    if (!renderer?.renderWorld || !Game.NPCBubbleLayout?.draw || !Game.NPCWorld) {
      if (attempts < RETRY_LIMIT) global.requestAnimationFrame(install);
      return false;
    }
    const previousRenderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function contextualNpcActivityRenderWorld(...args) {
      const enabled = Game.Config?.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES !== false;
      const result = withBubblesSuppressed(() => previousRenderWorld(...args));
      if (enabled) drawContextualBubbles();
      return result;
    };
    Game.NPCContextualActivity = Object.freeze({ version: VERSION, authority: 'presentation-only', semanticActivity, occupationAction, presentationClone, draw: drawContextualBubbles, install, snapshot() { return lastSnapshot ? JSON.parse(JSON.stringify(lastSnapshot)) : null; } });
    installed = true;
    renderer.renderWorld(true);
    return true;
  }
  if (document.readyState === 'complete') global.requestAnimationFrame(install);
  else global.addEventListener('load', () => global.requestAnimationFrame(install), { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
