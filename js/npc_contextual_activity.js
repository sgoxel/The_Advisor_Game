/*
  R04 / #317: contextual NPC activity labels.

  Simulation keeps authoritative generic routine/activity state. This presentation-only
  companion derives human-readable current actions from that state + occupation and feeds
  cloned NPC records to the existing #275 bubble layout only while it renders. Authoritative
  NPC objects/positions/activities are restored untouched before returning.
*/
(function installNpcContextualActivity(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-contextual-npc-activity-v1';
  const RETRY_LIMIT = 600;
  let attempts = 0;
  let installed = false;
  let lastSnapshot = null;

  const WORK_BY_OCCUPATION = Object.freeze({
    baker: 'Baking',
    blacksmith: 'Forging',
    smith: 'Forging',
    miller: 'Milling',
    innkeeper: 'Serving Guests',
    tavernkeeper: 'Serving Guests',
    trader: 'Trading',
    merchant: 'Trading',
    farmer: 'Checking Crops',
    herder: 'Tending Animals',
    shepherd: 'Tending Animals',
    woodcutter: 'Cutting Woods',
    lumberjack: 'Cutting Woods',
    hunter: 'Hunting',
    guard: 'Guarding',
    carpenter: 'Carpentry',
    laborer: 'Handling Materials',
    healer: 'Treating Patients',
    villager: 'Running Errands'
  });

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
  }

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

  function semanticActivity(npc) {
    const activity = normalized(npc?.activity || npc?.dailySchedule?.activity || 'idle');
    const scheduled = normalized(npc?.dailySchedule?.activity);
    const movement = normalized(npc?.movementDecision);

    if (npc?.dialogueWith || activity === 'talking' || activity === 'chatting') return 'Chatting';
    if (scheduled === 'sleep' || scheduled === 'sleeping' || activity === 'sleep' || activity === 'sleeping') return 'Sleeping';

    const visiblyMoving = ['move', 'side-step', 'yield-detour'].includes(movement);
    if (visiblyMoving || ['commuting-to-work', 'returning-home'].includes(activity)) return 'Walking';

    if (activity === 'working' || activity === 'work') return occupationAction(npc);
    if (activity === 'social' || activity === 'socializing') return 'Chatting';
    if (activity === 'local-errand' || activity === 'errand') return visiblyMoving ? 'Walking' : 'Running Errands';
    if (activity === 'home' || activity === 'rest' || activity === 'resting' || activity === 'idle') return 'Resting';

    // Already-specific Simulation states remain recognizable without inventing a new action.
    const direct = {
      baking: 'Baking', walking: 'Walking', chatting: 'Chatting',
      'cutting-woods': 'Cutting Woods', 'cutting-wood': 'Cutting Woods', hunting: 'Hunting',
      'checking-crops': 'Checking Crops', forging: 'Forging', milling: 'Milling',
      guarding: 'Guarding', trading: 'Trading', harvesting: 'Harvesting', planting: 'Planting',
      watering: 'Watering', cooking: 'Cooking', eating: 'Eating'
    };
    if (direct[activity]) return direct[activity];

    return activity
      ? activity.split('-').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      : 'Resting';
  }

  function presentationClone(npc) {
    return {
      ...npc,
      activity: semanticActivity(npc),
      // Side-step/yield detail is path-debug information, not the current human activity.
      // Keep coordinates/dialogue identity but prevent the legacy bubble formatter appending it.
      movementDecision: ['side-step', 'yield-detour', 'yield-wait'].includes(normalized(npc?.movementDecision))
        ? 'hold'
        : npc?.movementDecision
    };
  }

  function withBubblesSuppressed(callback) {
    if (!Game.Config) return callback();
    const prior = Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES;
    Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    try { return callback(); }
    finally { Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = prior; }
  }

  function drawContextualBubbles() {
    const world = Game.State?.world;
    const layout = Game.NPCBubbleLayout;
    if (!world || !Array.isArray(world.npcs) || !layout?.draw) return false;
    if (Game.Config?.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES === false) return false;

    const authoritativeNpcs = world.npcs;
    const presentationNpcs = authoritativeNpcs.map(presentationClone);
    const before = authoritativeNpcs.map((npc) => ({ id: npc.id, activity: npc.activity, row: npc.row, col: npc.col }));

    world.npcs = presentationNpcs;
    try {
      layout.draw();
      lastSnapshot = Object.freeze({
        version: VERSION,
        authority: 'presentation-only',
        labels: presentationNpcs.map((npc) => Object.freeze({ id: npc.id, name: npc.name, activity: npc.activity }))
      });
      return true;
    } finally {
      world.npcs = authoritativeNpcs;
      // Defensive invariant: no authoritative record may have been rewritten by the presentation pass.
      for (let i = 0; i < authoritativeNpcs.length; i += 1) {
        const current = authoritativeNpcs[i];
        const original = before[i];
        if (!current || !original || current.id !== original.id || current.activity !== original.activity || current.row !== original.row || current.col !== original.col) {
          throw new Error('Contextual activity presentation detected authoritative NPC mutation.');
        }
      }
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

    Game.NPCContextualActivity = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      semanticActivity,
      occupationAction,
      presentationClone,
      draw: drawContextualBubbles,
      install,
      snapshot() { return lastSnapshot ? JSON.parse(JSON.stringify(lastSnapshot)) : null; }
    });

    installed = true;
    renderer.renderWorld(true);
    return true;
  }

  if (document.readyState === 'complete') global.requestAnimationFrame(install);
  else global.addEventListener('load', () => global.requestAnimationFrame(install), { once: true });
})(typeof window !== 'undefined' ? window : globalThis);
