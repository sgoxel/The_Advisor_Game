/* R02-T23 / #125: Simulation-backed time-aware NPC schedules and ambient dialogue. */
(function installNpcLife() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-npc-life-v2-location-gated';

  const ROLE_PROFILES = Object.freeze({
    guard: Object.freeze({ wake: 300, work: 360, break: 720, social: 1080, home: 1260, sleep: 1380 }),
    innkeeper: Object.freeze({ wake: 360, work: 420, break: 840, social: 1140, home: 1320, sleep: 1410 }),
    baker: Object.freeze({ wake: 240, work: 300, break: 660, social: 960, home: 1140, sleep: 1320 }),
    farmer: Object.freeze({ wake: 300, work: 360, break: 720, social: 1020, home: 1200, sleep: 1320 }),
    herder: Object.freeze({ wake: 300, work: 360, break: 720, social: 1020, home: 1200, sleep: 1320 }),
    trader: Object.freeze({ wake: 360, work: 420, break: 780, social: 1080, home: 1200, sleep: 1350 }),
    merchant: Object.freeze({ wake: 360, work: 420, break: 780, social: 1080, home: 1200, sleep: 1350 }),
    blacksmith: Object.freeze({ wake: 330, work: 390, break: 750, social: 1020, home: 1170, sleep: 1320 }),
    default: Object.freeze({ wake: 360, work: 450, break: 750, social: 1020, home: 1200, sleep: 1320 })
  });

  const DIALOGUE = Object.freeze({
    dawn: Object.freeze([
      'The village is stirring early today.',
      'Morning light makes the road easier to read.',
      'There is plenty to finish before midday.'
    ]),
    work: Object.freeze([
      'Trade has been steady around the settlement.',
      'The road crews have been busy near the crossing.',
      'Most folk are keeping to their work while daylight holds.'
    ]),
    social: Object.freeze([
      'The square is busier now that the day is easing.',
      'People are swapping ordinary news before heading home.',
      'It is a good hour for a short rest and conversation.'
    ]),
    night: Object.freeze([
      'It is getting late; most doors will be shut soon.',
      'The settlement grows quieter after dark.',
      'Only the night watch should be moving for long.'
    ])
  });

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function minuteOfDay(input) {
    const value = Number(input);
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Game minute must be non-negative and finite.');
    return Math.floor(value) % 1440;
  }

  function profileFor(npc) {
    const role = String(npc?.occupation || 'default').toLowerCase();
    return ROLE_PROFILES[role] || ROLE_PROFILES.default;
  }

  function scheduleState(npc, totalGameMinutesInput = null) {
    const time = totalGameMinutesInput === null ? Game.GameTime?.capture()?.totalGameMinutes : totalGameMinutesInput;
    const minute = minuteOfDay(time);
    const profile = profileFor(npc);
    let activity;
    let anchor;
    if (minute < profile.wake || minute >= profile.sleep) { activity = 'sleep'; anchor = 'home'; }
    else if (minute < profile.work) { activity = 'prepare-and-travel'; anchor = 'work'; }
    else if (minute < profile.break) { activity = 'work'; anchor = 'work'; }
    else if (minute < profile.social) { activity = 'break-or-errand'; anchor = 'social'; }
    else if (minute < profile.home) { activity = 'social'; anchor = 'social'; }
    else { activity = 'return-home'; anchor = 'home'; }
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      npcId: String(npc?.id || ''),
      occupation: String(npc?.occupation || 'villager'),
      minuteOfDay: minute,
      activity,
      anchor,
      playerControllable: false
    });
  }

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
  }

  function finitePoint(value) {
    const row = Number(value?.row);
    const col = Number(value?.col);
    return Number.isFinite(row) && Number.isFinite(col) ? { row, col } : null;
  }

  function samePoint(a, b) {
    const pa = finitePoint(a);
    const pb = finitePoint(b);
    return Boolean(pa && pb && pa.row === pb.row && pa.col === pb.col);
  }

  function strategicOutdoorTarget(world, actorId) {
    const entry = world?.outdoorWorksites?.assignments?.find?.((item) => String(item.id) === String(actorId));
    if (!entry || entry.status !== 'assigned') return null;
    const local = finitePoint(entry);
    if (!local) return null;
    const binding = world?.npcRuntime?.originBinding || {};
    return {
      row: local.row + Number(binding.rowOffset || 0),
      col: local.col + Number(binding.colOffset || 0),
      localRow: local.row,
      localCol: local.col,
      source: 'authoritative-outdoor-worksite',
      worksiteId: entry.worksiteId || null
    };
  }

  function requirementFor(scheduleInput) {
    const activity = normalized(scheduleInput?.activity);
    const anchor = normalized(scheduleInput?.anchor);
    if (['prepare-and-travel', 'return-home', 'commuting-to-work', 'returning-home', 'walking', 'travel', 'traveling', 'approach'].includes(activity)) {
      return { kind: anchor || null, terminal: false, intendedActivity: activity };
    }
    if (activity === 'sleep' || activity === 'sleeping' || anchor === 'home' && ['home', 'rest', 'resting'].includes(activity)) {
      return { kind: 'home', terminal: true, intendedActivity: 'sleeping' };
    }
    if (activity === 'work' || activity === 'working') return { kind: 'work', terminal: true, intendedActivity: 'working' };
    if (activity === 'social' || activity === 'socializing') return { kind: 'social', terminal: true, intendedActivity: 'social' };
    if (activity === 'break-or-errand' || activity === 'local-errand' || activity === 'errand') {
      return { kind: 'social', terminal: true, intendedActivity: 'local-errand' };
    }
    return { kind: anchor || null, terminal: false, intendedActivity: activity || 'idle' };
  }

  function targetFor(actor, scheduleInput, worldInput = Game.State?.world, options = {}) {
    const requirement = requirementFor(scheduleInput);
    if (options.target) return finitePoint(options.target);
    if (requirement.kind === 'work') {
      return strategicOutdoorTarget(worldInput, actor?.id) || finitePoint(actor?.indoorWorkAnchor) || finitePoint(actor?.anchors?.work);
    }
    if (requirement.kind === 'home') return finitePoint(actor?.anchors?.home);
    if (requirement.kind === 'social') return finitePoint(actor?.anchors?.social);
    return finitePoint(actor?.anchors?.[requirement.kind]);
  }

  function travelActivity(kind) {
    if (kind === 'work') return 'commuting-to-work';
    if (kind === 'home') return 'returning-home';
    if (kind === 'social') return 'local-errand';
    return 'traveling';
  }

  function activityLocationState(actor, scheduleInput, options = {}) {
    const world = options.world || Game.State?.world;
    const requirement = requirementFor(scheduleInput);
    const target = targetFor(actor, scheduleInput, world, options);
    const current = finitePoint(options.current || actor);
    if (!requirement.terminal) {
      return Object.freeze({
        version: 'r04-activity-location-gate-v1', authority: 'simulation', legal: true,
        requiredLocation: requirement.kind, intendedActivity: requirement.intendedActivity,
        activeActivity: requirement.intendedActivity, target, current, reason: 'travel-or-nonterminal-state'
      });
    }
    if (!target) {
      return Object.freeze({
        version: 'r04-activity-location-gate-v1', authority: 'simulation', legal: false,
        requiredLocation: requirement.kind, intendedActivity: requirement.intendedActivity,
        activeActivity: 'waiting', target: null, current, reason: 'required-authoritative-location-unavailable'
      });
    }
    const legal = samePoint(current, target);
    return Object.freeze({
      version: 'r04-activity-location-gate-v1', authority: 'simulation', legal,
      requiredLocation: requirement.kind, intendedActivity: requirement.intendedActivity,
      activeActivity: legal ? requirement.intendedActivity : travelActivity(requirement.kind),
      target, current, reason: legal ? 'actor-at-required-authoritative-location' : 'travel-required-before-activity'
    });
  }

  function applyActivityLocationGate(actor, scheduleInput, options = {}) {
    if (!actor) return null;
    const state = activityLocationState(actor, scheduleInput, options);
    actor.intendedActivity = state.intendedActivity;
    actor.activity = state.activeActivity;
    actor.activityLocationState = state;
    return state;
  }

  function applySchedules(totalGameMinutesInput = null) {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return [];
    const time = totalGameMinutesInput === null ? Game.GameTime?.capture()?.totalGameMinutes : totalGameMinutesInput;
    const results = [];
    for (const npc of world.npcs) {
      const state = scheduleState(npc, time);
      npc.dailySchedule = state;
      // #346: schedules express intent. They never teleport an actor into compliance.
      // The authoritative location gate exposes travel/wait until the actor reaches
      // its existing home/work/worksite/social anchor.
      applyActivityLocationGate(npc, state, { world });
      results.push(state);
    }
    return results;
  }

  function dialoguePeriod(minute) {
    const value = minuteOfDay(minute);
    if (value < 360) return 'night';
    if (value < 540) return 'dawn';
    if (value < 1020) return 'work';
    if (value < 1320) return 'social';
    return 'night';
  }

  function ambientDialogue(speaker, listener, context = {}) {
    if (!speaker || !listener || speaker.id === listener.id) throw new TypeError('Distinct speaker and listener NPCs are required.');
    const time = context.totalGameMinutes ?? Game.GameTime?.capture()?.totalGameMinutes;
    const period = dialoguePeriod(time);
    const location = String(context.location || context.settlement || 'settlement');
    const environment = String(context.environment || 'temperate');
    const key = [
      Game.State?.world?.seed || '', speaker.id, listener.id,
      speaker.occupation || '', listener.occupation || '',
      location, environment, Math.floor(Number(time) / 30), period
    ].join('|');
    const pool = DIALOGUE[period];
    const line = pool[hash32(key) % pool.length];
    return Object.freeze({
      version: VERSION,
      authority: 'presentation-context',
      authoritativeFact: false,
      externalLlmRequired: false,
      speakerId: String(speaker.id),
      listenerId: String(listener.id),
      period,
      location,
      environment,
      line
    });
  }

  function contextualConversation(context = {}) {
    const npcs = Game.State?.world?.npcs || [];
    if (npcs.length < 2) return null;
    const time = context.totalGameMinutes ?? Game.GameTime?.capture()?.totalGameMinutes ?? 0;
    const first = hash32(`${Game.State?.world?.seed || ''}|${Math.floor(Number(time) / 30)}|speaker`) % npcs.length;
    let second = hash32(`${Game.State?.world?.seed || ''}|${Math.floor(Number(time) / 30)}|listener`) % npcs.length;
    if (second === first) second = (second + 1) % npcs.length;
    return ambientDialogue(npcs[first], npcs[second], context);
  }

  Game.NPCLife = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    scheduleState,
    requirementFor,
    targetFor,
    activityLocationState,
    applyActivityLocationGate,
    applySchedules,
    ambientDialogue,
    contextualConversation
  });
})();