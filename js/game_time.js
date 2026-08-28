/* R02-T21 / #122: Simulation-owned authoritative real-time game clock. */
(function installGameTime() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-game-time-v1';
  const GAME_MINUTES_PER_REAL_MILLISECOND = 1 / 2500;
  const MINUTES_PER_DAY = 1440;
  const DAWN_MINUTE = 5 * 60;
  const NIGHT_MINUTE = 22 * 60;
  const DEFAULT_START_MINUTE = 8 * 60;
  const TICK_MS = 250;
  let timer = null;
  let lastRealMs = null;

  function phaseForMinute(minuteOfDay) {
    return minuteOfDay >= DAWN_MINUTE && minuteOfDay < NIGHT_MINUTE ? 'daylight' : 'night';
  }

  function normalizeTotalMinutes(value) {
    const total = Number(value);
    if (!Number.isFinite(total) || total < 0) throw new TypeError('Game time must be a non-negative finite minute count.');
    return total;
  }

  function snapshotFromTotal(totalGameMinutes) {
    const total = normalizeTotalMinutes(totalGameMinutes);
    const wholeMinute = Math.floor(total);
    const dayIndex = Math.floor(wholeMinute / MINUTES_PER_DAY);
    const minuteOfDay = wholeMinute % MINUTES_PER_DAY;
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      totalGameMinutes: Number(total.toFixed(6)),
      day: dayIndex + 1,
      minuteOfDay,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      phase: phaseForMinute(minuteOfDay),
      daylight: minuteOfDay >= DAWN_MINUTE && minuteOfDay < NIGHT_MINUTE
    });
  }

  function ensureWorldState() {
    const world = Game.State?.world;
    if (!world) return null;
    const current = world.gameTime;
    if (!current || current.version !== VERSION || current.authority !== 'simulation') {
      world.gameTime = snapshotFromTotal(DEFAULT_START_MINUTE);
    }
    return world.gameTime;
  }

  function installSnapshot(snapshot) {
    const world = Game.State?.world;
    if (!world) return null;
    world.gameTime = snapshotFromTotal(snapshot.totalGameMinutes);
    return world.gameTime;
  }

  function advanceRealMilliseconds(realMilliseconds) {
    const elapsed = Number(realMilliseconds);
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new TypeError('Real elapsed milliseconds must be non-negative and finite.');
    const current = ensureWorldState();
    if (!current) return null;
    return installSnapshot({ totalGameMinutes: current.totalGameMinutes + elapsed * GAME_MINUTES_PER_REAL_MILLISECOND });
  }

  function advanceGameMinutes(gameMinutes) {
    const minutes = Number(gameMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw new TypeError('Game minutes must be non-negative and finite.');
    const current = ensureWorldState();
    if (!current) return null;
    return installSnapshot({ totalGameMinutes: current.totalGameMinutes + minutes });
  }

  function setForTest(totalGameMinutes) {
    return installSnapshot({ totalGameMinutes: normalizeTotalMinutes(totalGameMinutes) });
  }

  function capture() {
    const current = ensureWorldState();
    return current ? JSON.parse(JSON.stringify(current)) : null;
  }

  function validate(candidate) {
    if (!candidate || typeof candidate !== 'object' || candidate.authority !== 'simulation') return Object.freeze({ ok: false, code: 'INVALID_GAME_TIME' });
    try {
      return Object.freeze({ ok: true, state: snapshotFromTotal(candidate.totalGameMinutes) });
    } catch {
      return Object.freeze({ ok: false, code: 'INVALID_GAME_TIME' });
    }
  }

  function restore(candidate) {
    const checked = validate(candidate);
    if (!checked.ok) return checked;
    installSnapshot(checked.state);
    return Object.freeze({ ok: true, state: capture() });
  }

  function tick(nowMs) {
    const now = Number(nowMs);
    if (!Number.isFinite(now)) return;
    if (lastRealMs === null) {
      lastRealMs = now;
      return;
    }
    const elapsed = Math.max(0, now - lastRealMs);
    lastRealMs = now;
    if (elapsed > 0) advanceRealMilliseconds(elapsed);
  }

  function start() {
    if (timer !== null) return;
    ensureWorldState();
    lastRealMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    timer = window.setInterval(() => tick(typeof performance !== 'undefined' ? performance.now() : Date.now()), TICK_MS);
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    lastRealMs = null;
  }

  Game.GameTime = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    normalSpeed: Object.freeze({ gameMinutesPerRealMillisecond: GAME_MINUTES_PER_REAL_MILLISECOND, realMillisecondsPerGameHour: 150000 }),
    boundaries: Object.freeze({ dawnMinute: DAWN_MINUTE, nightMinute: NIGHT_MINUTE }),
    capture,
    validate,
    restore,
    advanceRealMilliseconds,
    advanceGameMinutes,
    setForTest,
    start,
    stop
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();