/* R04 #333/#335: presentation-only Development Mode diagnostics and NPC routine inspection. */
(function installDevelopmentMode() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const REFRESH_MS = 500;
  const ROUTINE_NODES = Object.freeze([
    { id: 'commute-work', label: 'Travel to workplace', start: 0, end: 0.25, activity: 'commuting-to-work', destination: 'work' },
    { id: 'work', label: 'Work', start: 0.25, end: 0.50, activity: 'working', destination: 'work' },
    { id: 'local-errand', label: 'Travel to social destination', start: 0.50, end: 0.65, activity: 'local-errand', destination: 'social' },
    { id: 'social', label: 'Socialize', start: 0.65, end: 0.80, activity: 'social', destination: 'social' },
    { id: 'return-home', label: 'Return home', start: 0.80, end: 1, activity: 'returning-home', destination: 'home' }
  ]);
  let enabled = false;
  let timer = null;
  let lastSnapshot = null;
  let selectedNpcId = null;
  let dialogInvoker = null;

  function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
  function text(value, fallback = 'Unavailable') { return value === undefined || value === null || value === '' ? fallback : String(value); }
  function worldState() { return Game.State?.world || {}; }
  function gameMinutes() { return finite(Game.GameTime?.capture?.()?.totalGameMinutes ?? worldState().gameTime?.totalGameMinutes); }
  function dayPosition(total, offset = 0) {
    if (!Number.isFinite(total)) return null;
    const minute = ((total + Number(offset || 0)) % 1440 + 1440) % 1440;
    return minute / 1440;
  }
  function activeRoutineNode(npc, total) {
    const position = dayPosition(total, npc?.routineOffsetGameMinutes);
    return position === null ? null : ROUTINE_NODES.find((node) => position >= node.start && position < node.end) || ROUTINE_NODES[ROUTINE_NODES.length - 1];
  }
  function anchorLabel(anchor) {
    if (!anchor) return 'Unavailable';
    const building = anchor.buildingId ? `${anchor.buildingId} · ` : '';
    return `${building}tile ${finite(anchor.row) ?? '?'},${finite(anchor.col) ?? '?'}`;
  }
  function routineProjection(npc) {
    if (!npc) return null;
    const total = gameMinutes();
    const current = activeRoutineNode(npc, total);
    const nodes = ROUTINE_NODES.map((node, index) => ({
      ...node,
      current: node.id === current?.id,
      timeWindow: `${Math.round(node.start * 24).toString().padStart(2, '0')}:00–${node.end === 1 ? '24:00' : Math.round(node.end * 24).toString().padStart(2, '0') + ':00'}`,
      destinationLabel: anchorLabel(npc.anchors?.[node.destination]),
      nextId: ROUTINE_NODES[(index + 1) % ROUTINE_NODES.length].id
    }));
    return {
      id: text(npc.id), name: text(npc.name, text(npc.id)), profession: text(npc.occupation),
      activity: text(npc.activity), movement: text(npc.movementDecision), dialogueWith: text(npc.dialogueWith, 'Not applicable'),
      row: finite(npc.row), col: finite(npc.col), totalGameMinutes: total,
      clockAuthority: text(worldState().npcRuntime?.routineClockAuthority, 'Game.GameTime'),
      currentNodeId: current?.id || null, nodes,
      anchors: { home: anchorLabel(npc.anchors?.home), work: anchorLabel(npc.anchors?.work), social: anchorLabel(npc.anchors?.social) }
    };
  }
  function npcProjections() { return (Array.isArray(worldState().npcs) ? worldState().npcs : []).filter(Boolean).map(routineProjection); }

  function captureSimulation() {
    const world = worldState(); const player = world.player || world.protagonist || {};
    const gameTime = Game.GameTime?.capture?.() || world.gameTime || null; const npcs = Array.isArray(world.npcs) ? world.npcs : [];
    const activeNpc = npcs.find((npc) => npc && (npc.activity || npc.movementDecision || npc.dialogueWith)) || npcs[0] || null;
    return { authority: 'simulation', gameTime: gameTime ? { day: finite(gameTime.day), hour: finite(gameTime.hour), minute: finite(gameTime.minute), totalGameMinutes: finite(gameTime.totalGameMinutes), phase: text(gameTime.phase) } : null,
      world: { seed: text(world.seed), rows: finite(world.rows), cols: finite(world.cols), regionX: finite(world.regionX ?? world.currentRegionX), regionY: finite(world.regionY ?? world.currentRegionY) },
      protagonist: { row: finite(player.row), col: finite(player.col), moving: player.moving === true, pathSteps: Array.isArray(player.pathQueue) ? player.pathQueue.length : 0, activity: text(world.protagonistActivity ?? world.autonomousActivity ?? player.activity) },
      npc: { count: npcs.length, sampleId: text(activeNpc?.id), sampleActivity: text(activeNpc?.activity), sampleMovement: text(activeNpc?.movementDecision), sampleRow: finite(activeNpc?.row), sampleCol: finite(activeNpc?.col), sampleDialogueWith: text(activeNpc?.dialogueWith) } };
  }
  function capturePresentation() {
    const state = Game.State || {}; const camera = state.camera || {}; const render = state.render || {}; const log = state.log || {};
    return { authority: 'presentation', camera: { x: finite(camera.x), y: finite(camera.y), zoom: finite(camera.zoom), followPlayer: camera.followPlayer === true, dragActive: camera.dragActive === true }, render: { needsWorldRedraw: render.needsWorldRedraw === true, needsMinimapRedraw: render.needsMinimapRedraw === true, backgroundTextureReady: render.backgroundTextureReady === true, textureLoadStatus: text(render.textureLoadStatus) }, log: { eventCount: Array.isArray(log.events) ? log.events.length : Array.isArray(log.lines) ? log.lines.length : 0, maxEntries: finite(log.maxEvents ?? log.maxLines) } };
  }
  function capture() { return Object.freeze({ version: 'r04-development-mode-v2', presentationOnly: true, enabled, simulation: captureSimulation(), presentation: capturePresentation() }); }
  function formatTime(t) { return !t || t.day === null || t.hour === null || t.minute === null ? 'Unavailable' : `Day ${t.day} · ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} · ${t.phase}`; }
  function setValue(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function renderSnapshot(snapshot) {
    lastSnapshot = snapshot; const sim = snapshot.simulation; const view = snapshot.presentation;
    setValue('devGameTime', formatTime(sim.gameTime)); setValue('devWorldIdentity', `${sim.world.seed} · ${sim.world.rows ?? '?'}x${sim.world.cols ?? '?'} · region ${sim.world.regionX ?? 0},${sim.world.regionY ?? 0}`);
    setValue('devProtagonistState', `tile ${sim.protagonist.row ?? '?'},${sim.protagonist.col ?? '?'} · ${sim.protagonist.activity} · path ${sim.protagonist.pathSteps}`);
    setValue('devNpcState', `${sim.npc.count} active · ${sim.npc.sampleId}: ${sim.npc.sampleActivity} / ${sim.npc.sampleMovement} · tile ${sim.npc.sampleRow ?? '?'},${sim.npc.sampleCol ?? '?'}`);
    setValue('devCameraState', `x ${Math.round(view.camera.x ?? 0)} · y ${Math.round(view.camera.y ?? 0)} · zoom ${(view.camera.zoom ?? 0).toFixed(2)}x · follow ${view.camera.followPlayer ? 'on' : 'off'}`);
    setValue('devRenderState', `world dirty ${view.render.needsWorldRedraw ? 'yes' : 'no'} · minimap dirty ${view.render.needsMinimapRedraw ? 'yes' : 'no'} · background ${view.render.backgroundTextureReady ? 'ready' : 'pending'} · textures ${view.render.textureLoadStatus}`);
    setValue('devLogState', `${view.log.eventCount} retained · max ${view.log.maxEntries ?? '?'}`);
  }
  function closeDialog(id, restore = true) { const dialog = document.getElementById(id); if (dialog?.open) dialog.close(); if (restore && dialogInvoker?.focus) dialogInvoker.focus(); }
  function renderNpcList() {
    const list = document.getElementById('devNpcList'); if (!list) return; const npcs = npcProjections(); list.replaceChildren();
    if (!npcs.length) { const empty = document.createElement('p'); empty.textContent = 'No active NPCs are available for inspection.'; list.appendChild(empty); return; }
    npcs.forEach((npc) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'development-npc-row'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(npc.id === selectedNpcId)); button.dataset.npcId = npc.id; button.innerHTML = `<strong>${npc.name}</strong><span>${npc.profession} · ${npc.activity}</span>`; button.addEventListener('click', () => openRoutine(npc.id, button)); list.appendChild(button); });
  }
  function openNpcList(invoker) { dialogInvoker = invoker || document.activeElement; renderNpcList(); const dialog = document.getElementById('devNpcListDialog'); if (!dialog) return; dialog.showModal(); dialog.querySelector('button, [tabindex]')?.focus(); }
  function renderRoutine(npc) {
    setValue('devRoutineTitle', `${npc.name} — routine`); setValue('devRoutineIdentity', `${npc.profession} · ${npc.id}`); setValue('devRoutineCurrent', `${npc.activity} · ${npc.currentNodeId || 'Unavailable'} · ${npc.movement} · tile ${npc.row ?? '?'},${npc.col ?? '?'}`);
    setValue('devRoutineContext', `Clock: ${npc.clockAuthority} · Home: ${npc.anchors.home} · Work: ${npc.anchors.work} · Social: ${npc.anchors.social} · Dialogue: ${npc.dialogueWith}`);
    const flow = document.getElementById('devRoutineFlow'); if (!flow) return; flow.replaceChildren();
    npc.nodes.forEach((node, index) => { const item = document.createElement('div'); item.className = `development-routine-node${node.current ? ' current' : ''}`; item.tabIndex = 0; item.setAttribute('aria-label', `${node.label}. ${node.timeWindow}. Destination ${node.destinationLabel}.${node.current ? ' CURRENT.' : ''} Next when time window advances: ${node.nextId}.`); item.innerHTML = `<div><strong>${node.label}</strong>${node.current ? '<span class="development-current-badge">CURRENT</span>' : ''}</div><small>${node.timeWindow} · ${node.destinationLabel}</small>`; flow.appendChild(item); if (index < npc.nodes.length - 1) { const edge = document.createElement('div'); edge.className = 'development-routine-edge'; edge.textContent = '↓ Time window advances'; flow.appendChild(edge); } });
  }
  function openRoutine(id, invoker) { const npc = npcProjections().find((candidate) => candidate.id === String(id)); if (!npc) return; selectedNpcId = npc.id; renderNpcList(); renderRoutine(npc); closeDialog('devNpcListDialog', false); dialogInvoker = invoker || dialogInvoker; const dialog = document.getElementById('devRoutineDialog'); dialog?.showModal(); dialog?.querySelector('.development-dialog-back')?.focus(); }
  function backToList() { closeDialog('devRoutineDialog', false); openNpcList(document.getElementById('devNpcRoutinesBtn')); }

  function ensureSurface() {
    if (document.getElementById('developmentModePanel')) return;
    const button = document.createElement('button'); button.id = 'developmentModeBtn'; button.className = 'menu-btn development-mode-toggle'; button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-controls', 'developmentModePanel'); button.textContent = 'Development'; const logButton = document.getElementById('logBtn'); if (logButton?.parentNode) logButton.parentNode.insertBefore(button, logButton.nextSibling);
    const panel = document.createElement('aside'); panel.id = 'developmentModePanel'; panel.className = 'development-mode-panel hidden'; panel.setAttribute('aria-label', 'Development Mode diagnostics'); panel.setAttribute('aria-live', 'off'); panel.innerHTML = `<div class="development-mode-header"><strong>Development Mode</strong><span>Read-only diagnostics</span></div><button id="devNpcRoutinesBtn" type="button" class="development-inspect-button" aria-label="Inspect NPC routines">NPC routines</button><section><h3>Simulation-backed</h3><dl><div><dt>Game Time</dt><dd id="devGameTime">Unavailable</dd></div><div><dt>World / SEED</dt><dd id="devWorldIdentity">Unavailable</dd></div><div><dt>Protagonist</dt><dd id="devProtagonistState">Unavailable</dd></div><div><dt>NPC sample</dt><dd id="devNpcState">Unavailable</dd></div></dl></section><section><h3>Presentation / runtime</h3><dl><div><dt>Camera</dt><dd id="devCameraState">Unavailable</dd></div><div><dt>Renderer</dt><dd id="devRenderState">Unavailable</dd></div><div><dt>Activity Log</dt><dd id="devLogState">Unavailable</dd></div></dl></section>`; document.body.appendChild(panel);
    const listDialog = document.createElement('dialog'); listDialog.id = 'devNpcListDialog'; listDialog.className = 'development-dialog'; listDialog.setAttribute('aria-labelledby', 'devNpcListTitle'); listDialog.innerHTML = `<header><h2 id="devNpcListTitle">NPC routines</h2><button type="button" class="development-dialog-close" aria-label="Close NPC routines">×</button></header><p>Read-only Simulation inspection</p><div id="devNpcList" role="listbox" aria-label="Active NPCs"></div>`; document.body.appendChild(listDialog);
    const routineDialog = document.createElement('dialog'); routineDialog.id = 'devRoutineDialog'; routineDialog.className = 'development-dialog development-routine-dialog'; routineDialog.setAttribute('aria-labelledby', 'devRoutineTitle'); routineDialog.innerHTML = `<header><button type="button" class="development-dialog-back">Back</button><h2 id="devRoutineTitle">NPC routine</h2><button type="button" class="development-dialog-close" aria-label="Close routine inspector">×</button></header><p class="development-readonly-status">Read-only · Development Mode</p><p id="devRoutineIdentity">Unavailable</p><section><h3>Current state</h3><p id="devRoutineCurrent">Unavailable</p><p id="devRoutineContext">Unavailable</p></section><section><h3>Routine flow</h3><div id="devRoutineFlow" class="development-routine-flow" aria-label="Routine flow"></div></section>`; document.body.appendChild(routineDialog);
    button.addEventListener('click', () => setEnabled(!enabled)); panel.querySelector('#devNpcRoutinesBtn').addEventListener('click', (event) => openNpcList(event.currentTarget)); listDialog.querySelector('.development-dialog-close').addEventListener('click', () => closeDialog('devNpcListDialog')); routineDialog.querySelector('.development-dialog-close').addEventListener('click', () => closeDialog('devRoutineDialog')); routineDialog.querySelector('.development-dialog-back').addEventListener('click', backToList);
  }
  function refresh() { if (!enabled) return lastSnapshot; const snapshot = capture(); renderSnapshot(snapshot); if (document.getElementById('devNpcListDialog')?.open) renderNpcList(); if (document.getElementById('devRoutineDialog')?.open && selectedNpcId) { const npc = npcProjections().find((item) => item.id === selectedNpcId); if (npc) renderRoutine(npc); } return snapshot; }
  function setEnabled(next) { ensureSurface(); enabled = next === true; const button = document.getElementById('developmentModeBtn'); const panel = document.getElementById('developmentModePanel'); if (button) button.setAttribute('aria-pressed', String(enabled)); if (panel) panel.classList.toggle('hidden', !enabled); if (!enabled) { closeDialog('devRoutineDialog', false); closeDialog('devNpcListDialog', false); } if (timer !== null) window.clearInterval(timer); timer = null; if (enabled) { refresh(); timer = window.setInterval(refresh, REFRESH_MS); } return enabled; }
  function isEnabled() { return enabled; }
  Game.DevelopmentMode = Object.freeze({ version: 'r04-development-mode-v2', presentationOnly: true, refreshIntervalMs: REFRESH_MS, capture, refresh, setEnabled, isEnabled, routineProjection, npcProjections, openNpcList });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureSurface, { once: true }); else ensureSurface();
})();
