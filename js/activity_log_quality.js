/*
  R04 / #309: presentation-only activity-log quality bridge.
  Keeps raw UI.addLog diagnostics intact while suppressing duplicate/noisy structured cards.
*/
(function installActivityLogQualityBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const RETRY_MS = 25;
  const MAX_ATTEMPTS = 400;
  const RECENT_TTL_MS = 5000;
  let attempts = 0;

  function text(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function install() {
    const UI = Game.UI;
    const ActivityLog = Game.ActivityLog;
    if (!UI || typeof UI.addLog !== 'function' || !ActivityLog || typeof ActivityLog.snapshot !== 'function') {
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) window.setTimeout(install, RETRY_MS);
      return;
    }
    if (UI.addLog.__r04ActivityLogQualityBridge === true) return;

    const original = UI.addLog.bind(UI);
    const recent = new Map();

    function prune(now) {
      for (const [key, timestamp] of recent.entries()) {
        if (now - timestamp > RECENT_TTL_MS) recent.delete(key);
      }
    }

    UI.addLog = function qualityAwareAddLog(message, details, meta) {
      const title = text(message);
      const detailText = text(details);
      const lower = title.toLowerCase();
      const supplied = meta && typeof meta === 'object' ? meta : {};
      const nextMeta = { ...supplied };
      const now = Date.now();
      prune(now);

      // High-frequency camera zoom messages remain available in raw/export diagnostics,
      // but do not flood the default meaningful timeline.
      if (/\bzoom\b|yakınlaştır|uzaklaştır|zoom değiştirildi/.test(lower)) {
        nextMeta.category = nextMeta.category || 'system';
        nextMeta.source = nextMeta.source || 'camera-zoom';
        nextMeta.diagnosticOnly = true;
      }

      // Optional map probing is expected startup fallback behavior after #256; retain the
      // raw diagnostic but do not present it as an independent player-facing failure.
      if (/js map bundle (load failed|was not usable)|trying js map bundle/.test(lower)) {
        nextMeta.category = nextMeta.category || 'system';
        nextMeta.source = nextMeta.source || 'optional-map-probe';
        nextMeta.diagnosticOnly = true;
      }

      const isErrorLike = /error|failed|failure|exception|rejection|hata/.test(lower);
      const duplicateKey = isErrorLike && detailText
        ? `error:${detailText}`
        : `event:${lower}|${detailText}`;
      const previous = recent.get(duplicateKey);
      if (previous !== undefined && now - previous <= RECENT_TTL_MS) {
        nextMeta.diagnosticOnly = true;
        nextMeta.source = nextMeta.source || (isErrorLike ? 'duplicate-error-capture' : 'duplicate-event');
      } else {
        recent.set(duplicateKey, now);
      }

      return original(title, details, nextMeta);
    };

    Object.defineProperty(UI.addLog, '__r04ActivityLogQualityBridge', {
      value: true,
      enumerable: false
    });

    Game.ActivityLogQuality = Object.freeze({
      installed: true,
      duplicateWindowMs: RECENT_TTL_MS
    });
  }

  install();
})();
