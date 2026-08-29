/*
  R04 / #309: structured, bounded, presentation-only activity log runtime.

  Compatibility:
  - Existing UI.addLog(message, details) callers remain valid.
  - Existing State.log.lines remains diagnostic/raw compatibility storage.
  - Structured events are presentation-only and never enter authoritative campaign state.
*/
(function installActivityLogRuntime() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const MAX_EVENTS = 200;
  const INSTALL_RETRY_MS = 20;
  const INSTALL_RETRY_LIMIT = 500;
  const SESSION_STARTED_AT = Date.now();
  let installAttempts = 0;
  let installed = false;
  let sequence = 0;
  let pendingMeta = null;
  let npcPollHandle = null;
  let lastNpcRoutineKey = '';
  let lastNpcDialogueKey = '';
  let lastAdvisorRevision = 0;

  const COPY = Object.freeze({
    en: Object.freeze({
      title: 'Activity Log',
      description: 'Meaningful character, world, Advisor and system activity in chronological order.',
      emptyTitle: 'No meaningful activity yet.',
      emptyBody: 'Important decisions, world changes and warnings will appear here as they happen.',
      detail: 'Technical details',
      session: 'Session',
      game: 'Game',
      categories: Object.freeze({ character: 'Character', advisor: 'Advisor', npc: 'NPC', world: 'World', system: 'System' }),
      severities: Object.freeze({ info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' }),
      advisorSent: 'Advice sent',
      advisorConsidered: 'Protagonist considered advice',
      npcRoutines: 'NPC routines updated',
      npcDialogue: 'NPC dialogue active'
    }),
    tr: Object.freeze({
      title: 'Etkinlik Günlüğü',
      description: 'Karakter, dünya, Danışman ve sistemdeki anlamlı olaylar kronolojik sırayla.',
      emptyTitle: 'Henüz anlamlı bir etkinlik yok.',
      emptyBody: 'Önemli kararlar, dünya değişiklikleri ve uyarılar gerçekleştiğinde burada görünecek.',
      detail: 'Teknik ayrıntılar',
      session: 'Oturum',
      game: 'Oyun',
      categories: Object.freeze({ character: 'Karakter', advisor: 'Danışman', npc: 'NPC', world: 'Dünya', system: 'Sistem' }),
      severities: Object.freeze({ info: 'Bilgi', success: 'Başarılı', warning: 'Uyarı', error: 'Hata' }),
      advisorSent: 'Tavsiye gönderildi',
      advisorConsidered: 'Ana karakter tavsiyeyi değerlendirdi',
      npcRoutines: 'NPC rutinleri güncellendi',
      npcDialogue: 'NPC konuşması etkin'
    })
  });

  function localeKey() {
    return Game.State?.i18n?.current === 'tr' ? 'tr' : 'en';
  }

  function copy() { return COPY[localeKey()]; }
  function text(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function safeDetails(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function sessionTimeLabel() {
    const elapsed = Math.max(0, Date.now() - SESSION_STARTED_AT);
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${copy().session} +${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function gameClock() {
    try {
      if (Game.GameTime && typeof Game.GameTime.capture === 'function') return Game.GameTime.capture();
      if (Game.GameTime && typeof Game.GameTime.getCurrent === 'function') return Game.GameTime.getCurrent();
    } catch (_) {}
    return null;
  }

  function gameTimeLabel() {
    const clock = gameClock();
    const total = Number(clock?.totalGameMinutes ?? clock?.gameMinutes ?? clock?.elapsedGameMinutes);
    if (!Number.isFinite(total)) return null;
    const minute = Math.max(0, Math.floor(total));
    const day = Math.floor(minute / 1440) + 1;
    const minuteOfDay = minute % 1440;
    const hour = Math.floor(minuteOfDay / 60);
    const min = minuteOfDay % 60;
    return `${copy().game} · D${day} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  function normalizeCategory(value) {
    const category = text(value).toLowerCase();
    return ['character', 'advisor', 'npc', 'world', 'system'].includes(category) ? category : 'system';
  }

  function normalizeSeverity(value) {
    const severity = text(value).toLowerCase();
    return ['info', 'success', 'warning', 'error'].includes(severity) ? severity : 'info';
  }

  function inferSeverity(message) {
    const value = text(message).toLowerCase();
    if (/\b(error|failed|failure|exception|rejection|could not|unavailable|not supported)\b/.test(value)) return 'error';
    if (/\b(warn|warning|missing|blocked|ignored|invalid|not usable|not found)\b/.test(value)) return 'warning';
    if (/\b(success|succeeded|loaded|generated|rebuilt|completed|ready|applied|exported)\b/.test(value)) return 'success';
    return 'info';
  }

  function inferCategory(message) {
    const value = text(message).toLowerCase();
    if (/advisor|advice/.test(value)) return 'advisor';
    if (/\bnpc\b|dialogue|routine/.test(value)) return 'npc';
    if (/world|map|seed|terrain|road|village|region|spawn/.test(value)) return 'world';
    if (/character|protagonist/.test(value)) return 'character';
    return 'system';
  }

  function isDefaultNoise(message) {
    const value = text(message).toLowerCase();
    return [
      'settings opened', 'settings closed', 'log opened', 'log closed',
      'window resized', 'character panel selected'
    ].some((needle) => value.includes(needle)) ||
      /startup load step \d+\/\d+: trying js map bundle/.test(value) ||
      /trying js map bundle/.test(value);
  }

  function isDiagnosticOnly(message, severity) {
    const value = text(message).toLowerCase();
    if (severity === 'error' || severity === 'warning') return false;
    return isDefaultNoise(value) || /js map bundle was not usable|path: map\//.test(value);
  }

  function locationLabel() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    if (!Number.isFinite(Number(player.row)) || !Number.isFinite(Number(player.col))) return '';
    return `tile ${Math.trunc(Number(player.row))},${Math.trunc(Number(player.col))}`;
  }

  function buildEvent(input = {}) {
    const category = normalizeCategory(input.category);
    const severity = normalizeSeverity(input.severity);
    const useGameTime = input.timeKind === 'game' || (input.timeKind !== 'session' && category !== 'system');
    const gameLabel = useGameTime ? gameTimeLabel() : null;
    return Object.freeze({
      id: `activity-${Date.now()}-${++sequence}`,
      sequence,
      createdAtMs: Date.now(),
      timeKind: gameLabel ? 'game' : 'session',
      timeLabel: text(input.timeLabel) || gameLabel || sessionTimeLabel(),
      category,
      source: text(input.source) || category,
      severity,
      title: text(input.title || input.message) || 'Activity',
      actor: text(input.actor),
      location: text(input.location),
      outcome: text(input.outcome),
      details: safeDetails(input.details),
      diagnosticOnly: input.diagnosticOnly === true
    });
  }

  function ensureStore() {
    const State = Game.State;
    if (!State) return null;
    State.log = State.log || {};
    if (!Array.isArray(State.log.lines)) State.log.lines = [];
    if (!Array.isArray(State.log.events)) State.log.events = [];
    State.log.maxEvents = MAX_EVENTS;
    State.log.presentationOnly = true;
    return State.log;
  }

  function addEvent(input) {
    const store = ensureStore();
    if (!store) return null;
    const event = buildEvent(input);
    store.events.push(event);
    if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
    render();
    return event;
  }

  function parseLegacyLine(line, meta = {}) {
    const raw = text(line);
    if (!raw) return null;
    const match = raw.match(/^\[[^\]]+\]\s*([^\n]*)(?:\n([\s\S]*))?$/);
    const message = text(match ? match[1] : raw);
    const details = text(match ? match[2] : '');
    const severity = normalizeSeverity(meta.severity || inferSeverity(message));
    if (isDefaultNoise(message)) return null;
    return {
      category: meta.category || inferCategory(message),
      source: meta.source || inferCategory(message),
      severity,
      title: meta.title || message,
      actor: meta.actor || '',
      location: meta.location || '',
      outcome: meta.outcome || '',
      details: meta.details !== undefined ? meta.details : details,
      timeKind: meta.timeKind,
      diagnosticOnly: meta.diagnosticOnly === true || isDiagnosticOnly(message, severity)
    };
  }

  function ingestLegacyLine(line, meta) {
    const parsed = parseLegacyLine(line, meta || {});
    if (parsed) addEvent(parsed);
  }

  function escapeTextNode(value) { return document.createTextNode(text(value)); }

  function makeMeta(label, value) {
    if (!value) return null;
    const span = document.createElement('span');
    span.className = 'activity-event-context-item';
    span.append(escapeTextNode(`${label}: ${value}`));
    return span;
  }

  function render() {
    const store = ensureStore();
    const list = document.getElementById('activityLogList');
    if (!store || !list) return;
    const legacyPre = document.getElementById('logText');
    if (legacyPre) legacyPre.hidden = true;
    let entries = document.getElementById('activityLogEntries');
    if (!entries) {
      entries = document.createElement('div');
      entries.id = 'activityLogEntries';
      entries.className = 'activity-log-entries';
      list.appendChild(entries);
    }
    entries.replaceChildren();
    const visible = store.events.filter((event) => !event.diagnosticOnly);
    const empty = document.getElementById('activityLogEmpty');
    if (empty) empty.hidden = visible.length > 0;
    for (const event of visible) {
      const article = document.createElement('article');
      article.className = 'activity-event';
      article.dataset.category = event.category;
      article.dataset.severity = event.severity;
      article.dataset.eventId = event.id;

      const head = document.createElement('div');
      head.className = 'activity-event-head';
      const time = document.createElement('time');
      time.className = 'activity-event-time';
      time.textContent = event.timeLabel;
      const badges = document.createElement('div');
      badges.className = 'activity-event-badges';
      const category = document.createElement('span');
      category.className = 'activity-event-category';
      category.textContent = copy().categories[event.category] || event.category;
      const severity = document.createElement('span');
      severity.className = 'activity-event-severity';
      severity.textContent = copy().severities[event.severity] || event.severity;
      badges.append(category, severity);
      head.append(time, badges);

      const title = document.createElement('h3');
      title.className = 'activity-event-title';
      title.textContent = event.title;
      article.append(head, title);

      const context = document.createElement('div');
      context.className = 'activity-event-context';
      [makeMeta('Actor', event.actor), makeMeta('Location', event.location), makeMeta('Outcome', event.outcome)]
        .filter(Boolean).forEach((node) => context.appendChild(node));
      if (context.childNodes.length) article.appendChild(context);

      if (event.details) {
        const details = document.createElement('details');
        details.className = 'activity-event-details';
        const summary = document.createElement('summary');
        summary.textContent = copy().detail;
        const pre = document.createElement('pre');
        pre.textContent = event.details;
        details.append(summary, pre);
        article.appendChild(details);
      }
      entries.appendChild(article);
    }
    list.scrollTop = list.scrollHeight;
    localizeShell();
  }

  function localizeShell() {
    const c = copy();
    const title = document.getElementById('activityLogTitle');
    const description = document.getElementById('activityLogDescription');
    const empty = document.getElementById('activityLogEmpty');
    if (title) title.textContent = c.title;
    if (description) description.textContent = c.description;
    if (empty) {
      const strong = empty.querySelector('strong');
      const span = empty.querySelector('span');
      if (strong) strong.textContent = c.emptyTitle;
      if (span) span.textContent = c.emptyBody;
    }
    document.querySelectorAll('.activity-log-key[data-category]').forEach((node) => {
      const category = node.dataset.category;
      if (c.categories[category]) node.textContent = c.categories[category];
    });
  }

  function installLegacyBridge() {
    const store = ensureStore();
    const UI = Game.UI;
    if (!store || !UI || typeof UI.addLog !== 'function') return false;
    if (store.__structuredPushInstalled) return true;
    store.__structuredPushInstalled = true;
    const nativePush = Array.prototype.push;
    store.lines.push = function structuredCompatibilityPush(...items) {
      for (const item of items) ingestLegacyLine(item, pendingMeta || {});
      return nativePush.apply(this, items);
    };
    const originalAddLog = UI.addLog.bind(UI);
    UI.addLog = function structuredAddLog(message, details, meta) {
      pendingMeta = meta && typeof meta === 'object' ? meta : null;
      try { return originalAddLog(message, details); }
      finally { pendingMeta = null; }
    };
    return true;
  }

  function bindAdvisorEvents() {
    const form = document.getElementById('advisorChatForm');
    if (!form || form.dataset.activityLogBound === 'true') return;
    form.dataset.activityLogBound = 'true';
    form.addEventListener('submit', () => {
      const input = document.getElementById('advisorMessageInput');
      const message = text(input?.value);
      if (!message) return;
      const beforeRevision = Number(Game.State?.advisor?.transcriptRevision || 0);
      addEvent({
        category: 'advisor', severity: 'info', source: 'advisor-chat',
        title: copy().advisorSent, actor: 'Advisor', location: locationLabel(),
        details: message, timeKind: 'game'
      });
      window.setTimeout(() => {
        const advisor = Game.State?.advisor || {};
        const revision = Number(advisor.transcriptRevision || 0);
        if (revision <= beforeRevision || revision <= lastAdvisorRevision) return;
        lastAdvisorRevision = revision;
        const influence = advisor.latestInfluence;
        const record = influence?.record?.character || {};
        addEvent({
          category: 'character', severity: influence?.status === 'ready' ? 'success' : 'warning', source: 'advisor-influence',
          title: copy().advisorConsidered, actor: 'Protagonist', location: locationLabel(),
          outcome: text(influence?.disposition || influence?.status || advisor.localBotEvaluation?.reasonCode),
          details: [text(record.response), text(record.interpretation)].filter(Boolean).join('\n'), timeKind: 'game'
        });
      }, 0);
    }, true);
  }

  function npcSummary() {
    const world = Game.State?.world || {};
    const npcs = Array.isArray(world.npcs) ? world.npcs : [];
    if (!npcs.length) return;
    const counts = {};
    for (const npc of npcs) {
      const activity = text(npc.activity || npc.dailySchedule?.activity || 'idle') || 'idle';
      counts[activity] = (counts[activity] || 0) + 1;
    }
    const routineKey = text(world.npcRuntime?.lastRoutineStateKey) || JSON.stringify(counts);
    if (routineKey && routineKey !== lastNpcRoutineKey) {
      lastNpcRoutineKey = routineKey;
      const rows = npcs.map((npc) => Number(npc.row)).filter(Number.isFinite);
      const cols = npcs.map((npc) => Number(npc.col)).filter(Number.isFinite);
      const spread = rows.length && cols.length
        ? `Population ${npcs.length}; row span ${Math.max(...rows) - Math.min(...rows)}; col span ${Math.max(...cols) - Math.min(...cols)}.`
        : `Population ${npcs.length}.`;
      addEvent({
        category: 'npc', severity: 'info', source: 'npc-routine', title: copy().npcRoutines,
        outcome: Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join(' · '),
        details: spread, timeKind: 'game'
      });
    }
    const dialogues = Array.isArray(world.npcDialogues) ? world.npcDialogues : [];
    const first = dialogues[0];
    const dialogueKey = first ? `${first.speakerId}|${first.listenerId}|${first.line}` : '';
    if (dialogueKey && dialogueKey !== lastNpcDialogueKey) {
      lastNpcDialogueKey = dialogueKey;
      const speaker = npcs.find((npc) => npc.id === first.speakerId);
      const listener = npcs.find((npc) => npc.id === first.listenerId);
      addEvent({
        category: 'npc', severity: 'info', source: 'npc-dialogue', title: copy().npcDialogue,
        actor: [speaker?.name, listener?.name].filter(Boolean).join(' ↔ '),
        location: speaker && Number.isFinite(Number(speaker.row)) ? `tile ${speaker.row},${speaker.col}` : '',
        details: text(first.line), timeKind: 'game'
      });
    }
    if (!dialogueKey) lastNpcDialogueKey = '';
  }

  function startNpcPoll() {
    if (npcPollHandle) return;
    npcPollHandle = window.setInterval(npcSummary, 1000);
  }

  function install() {
    if (installed) return true;
    installAttempts += 1;
    if (!Game.State || !Game.UI || typeof Game.UI.addLog !== 'function') {
      if (installAttempts < INSTALL_RETRY_LIMIT) window.setTimeout(install, INSTALL_RETRY_MS);
      return false;
    }
    installed = installLegacyBridge();
    if (!installed) return false;
    const originalApplyLanguage = Game.UI.applyCurrentLanguageToUI;
    if (typeof originalApplyLanguage === 'function') {
      Game.UI.applyCurrentLanguageToUI = function activityLogLocalizedApplyLanguage(...args) {
        const result = originalApplyLanguage.apply(Game.UI, args);
        render();
        return result;
      };
    }
    bindAdvisorEvents();
    startNpcPoll();
    render();
    return true;
  }

  Game.ActivityLog = Object.freeze({
    version: 'r04-structured-activity-log-v1',
    authority: 'presentation-only',
    maxEvents: MAX_EVENTS,
    add: addEvent,
    snapshot() { return (ensureStore()?.events || []).map((event) => ({ ...event })); },
    render,
    install,
    npcSummary
  });

  install();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      install();
      bindAdvisorEvents();
      render();
    }, { once: true });
  }
})();
