/* R02-T23 / #125: Simulation-backed time-aware NPC schedules and ambient dialogue. */
(function installNpcLife() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-npc-life-v1';

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

  function applySchedules(totalGameMinutesInput = null) {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return [];
    const time = totalGameMinutesInput === null ? Game.GameTime?.capture()?.totalGameMinutes : totalGameMinutesInput;
    const results = [];
    for (const npc of world.npcs) {
      const state = scheduleState(npc, time);
      npc.dailySchedule = state;
      npc.activity = state.activity;
      const target = npc.anchors?.[state.anchor];
      if (target) {
        npc.row = Number(target.row);
        npc.col = Number(target.col);
        if (Number.isFinite(Number(target.localRow))) npc.localRow = Number(target.localRow);
        if (Number.isFinite(Number(target.localCol))) npc.localCol = Number(target.localCol);
      }
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
    applySchedules,
    ambientDialogue,
    contextualConversation
  });
})();
