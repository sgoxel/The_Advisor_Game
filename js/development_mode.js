/* R04 #333: presentation-only Development Mode diagnostics. */
(function installDevelopmentMode() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const REFRESH_MS = 500;
  let enabled = false;
  let timer = null;
  let lastSnapshot = null;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function text(value, fallback = 'Unavailable') {
    if (value === undefined || value === null || value === '') return fallback;
    return String(value);
  }

  function captureSimulation() {
    const state = Game.State || {};
    const world = state.world || {};
    const player = world.player || world.protagonist || {};
    const gameTime = Game.GameTime?.capture?.() || world.gameTime || null;
    const npcs = Array.isArray(world.npcs) ? world.npcs : [];
    const activeNpc = npcs.find((npc) => npc && (npc.activity || npc.movementDecision || npc.dialogueWith)) || npcs[0] || null;
    return {
      authority: 'simulation',
      gameTime: gameTime ? {
        day: finite(gameTime.day),
        hour: finite(gameTime.hour),
        minute: finite(gameTime.minute),
        totalGameMinutes: finite(gameTime.totalGameMinutes),
        phase: text(gameTime.phase)
      } : null,
      world: {
        seed: text(world.seed),
        rows: finite(world.rows),
        cols: finite(world.cols),
        regionX: finite(world.regionX ?? world.currentRegionX),
        regionY: finite(world.regionY ?? world.currentRegionY)
      },
      protagonist: {
        row: finite(player.row),
        col: finite(player.col),
        moving: player.moving === true,
        pathSteps: Array.isArray(player.pathQueue) ? player.pathQueue.length : 0,
        activity: text(world.protagonistActivity ?? world.autonomousActivity ?? player.activity)
      },
      npc: {
        count: npcs.length,
        sampleId: text(activeNpc?.id),
        sampleActivity: text(activeNpc?.activity),
        sampleMovement: text(activeNpc?.movementDecision),
        sampleRow: finite(activeNpc?.row),
        sampleCol: finite(activeNpc?.col),
        sampleDialogueWith: text(activeNpc?.dialogueWith)
      }
    };
  }

  function capturePresentation() {
    const state = Game.State || {};
    const camera = state.camera || {};
    const render = state.render || {};
    const log = state.log || {};
    return {
      authority: 'presentation',
      camera: {
        x: finite(camera.x),
        y: finite(camera.y),
        zoom: finite(camera.zoom),
        followPlayer: camera.followPlayer === true,
        dragActive: camera.dragActive === true
      },
      render: {
        needsWorldRedraw: render.needsWorldRedraw === true,
        needsMinimapRedraw: render.needsMinimapRedraw === true,
        backgroundTextureReady: render.backgroundTextureReady === true,
        textureLoadStatus: text(render.textureLoadStatus)
      },
      log: {
        eventCount: Array.isArray(log.events) ? log.events.length : Array.isArray(log.lines) ? log.lines.length : 0,
        maxEntries: finite(log.maxEvents ?? log.maxLines)
      }
    };
  }

  function capture() {
    return Object.freeze({
      version: 'r04-development-mode-v1',
      presentationOnly: true,
      enabled,
      simulation: captureSimulation(),
      presentation: capturePresentation()
    });
  }

  function formatTime(gameTime) {
    if (!gameTime || gameTime.day === null || gameTime.hour === null || gameTime.minute === null) return 'Unavailable';
    return `Day ${gameTime.day} · ${String(gameTime.hour).padStart(2, '0')}:${String(gameTime.minute).padStart(2, '0')} · ${gameTime.phase}`;
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderSnapshot(snapshot) {
    lastSnapshot = snapshot;
    const sim = snapshot.simulation;
    const view = snapshot.presentation;
    setValue('devGameTime', formatTime(sim.gameTime));
    setValue('devWorldIdentity', `${sim.world.seed} · ${sim.world.rows ?? '?'}x${sim.world.cols ?? '?'} · region ${sim.world.regionX ?? 0},${sim.world.regionY ?? 0}`);
    setValue('devProtagonistState', `tile ${sim.protagonist.row ?? '?'},${sim.protagonist.col ?? '?'} · ${sim.protagonist.activity} · path ${sim.protagonist.pathSteps}`);
    setValue('devNpcState', `${sim.npc.count} active · ${sim.npc.sampleId}: ${sim.npc.sampleActivity} / ${sim.npc.sampleMovement} · tile ${sim.npc.sampleRow ?? '?'},${sim.npc.sampleCol ?? '?'}`);
    setValue('devCameraState', `x ${Math.round(view.camera.x ?? 0)} · y ${Math.round(view.camera.y ?? 0)} · zoom ${(view.camera.zoom ?? 0).toFixed(2)}x · follow ${view.camera.followPlayer ? 'on' : 'off'}`);
    setValue('devRenderState', `world dirty ${view.render.needsWorldRedraw ? 'yes' : 'no'} · minimap dirty ${view.render.needsMinimapRedraw ? 'yes' : 'no'} · background ${view.render.backgroundTextureReady ? 'ready' : 'pending'} · textures ${view.render.textureLoadStatus}`);
    setValue('devLogState', `${view.log.eventCount} retained · max ${view.log.maxEntries ?? '?'}`);
  }

  function ensureSurface() {
    if (document.getElementById('developmentModePanel')) return;
    const button = document.createElement('button');
    button.id = 'developmentModeBtn';
    button.className = 'menu-btn development-mode-toggle';
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'developmentModePanel');
    button.textContent = 'Development';
    const logButton = document.getElementById('logBtn');
    if (logButton?.parentNode) logButton.parentNode.insertBefore(button, logButton.nextSibling);

    const panel = document.createElement('aside');
    panel.id = 'developmentModePanel';
    panel.className = 'development-mode-panel hidden';
    panel.setAttribute('aria-label', 'Development Mode diagnostics');
    panel.setAttribute('aria-live', 'off');
    panel.innerHTML = `
      <div class="development-mode-header"><strong>Development Mode</strong><span>Read-only diagnostics</span></div>
      <section><h3>Simulation-backed</h3><dl>
        <div><dt>Game Time</dt><dd id="devGameTime">Unavailable</dd></div>
        <div><dt>World / SEED</dt><dd id="devWorldIdentity">Unavailable</dd></div>
        <div><dt>Protagonist</dt><dd id="devProtagonistState">Unavailable</dd></div>
        <div><dt>NPC sample</dt><dd id="devNpcState">Unavailable</dd></div>
      </dl></section>
      <section><h3>Presentation / runtime</h3><dl>
        <div><dt>Camera</dt><dd id="devCameraState">Unavailable</dd></div>
        <div><dt>Renderer</dt><dd id="devRenderState">Unavailable</dd></div>
        <div><dt>Activity Log</dt><dd id="devLogState">Unavailable</dd></div>
      </dl></section>`;
    document.body.appendChild(panel);
    button.addEventListener('click', () => setEnabled(!enabled));
  }

  function refresh() {
    if (!enabled) return lastSnapshot;
    const snapshot = capture();
    renderSnapshot(snapshot);
    return snapshot;
  }

  function setEnabled(next) {
    ensureSurface();
    enabled = next === true;
    const button = document.getElementById('developmentModeBtn');
    const panel = document.getElementById('developmentModePanel');
    if (button) button.setAttribute('aria-pressed', String(enabled));
    if (panel) panel.classList.toggle('hidden', !enabled);
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    if (enabled) {
      refresh();
      timer = window.setInterval(refresh, REFRESH_MS);
    }
    return enabled;
  }

  function isEnabled() { return enabled; }

  Game.DevelopmentMode = Object.freeze({
    version: 'r04-development-mode-v1',
    presentationOnly: true,
    refreshIntervalMs: REFRESH_MS,
    capture,
    refresh,
    setEnabled,
    isEnabled
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureSurface, { once: true });
  else ensureSurface();
})();
