/*
  R04 / #345: presentation-only world presentation debugger.
  All state lives outside campaign serialization and exists only to isolate render faults.
*/
(function installVectorLayerDebug(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-presentation-debug-v2';
  const RETRY_MS = 100;
  const entries = new Map();
  const patched = new Map();
  const savedVisibility = new Map();
  let baseRenderSource = null;
  let baseRenderWrapper = null;
  let baseRenderInstalled = false;
  let baseRenderInProgress = false;
  let uiInstalled = false;
  let renderPending = false;

  const DOM_CONTRIBUTORS = [
    ['terrain-shape-overlay', 'Terrain / Elevation Overlay', 'terrain', '#terrainShapeOverlay'],
    ['starter-village-roads', 'Starter Village Roads', 'roads', '#starterVillageRoadOverlay'],
    ['starter-village-exteriors', 'Starter Village Exteriors', 'buildings', '#starterVillageExteriorOverlay'],
    ['starter-village-interiors', 'Starter Village Interiors', 'buildings', '#starterVillageInteriorOverlay'],
    ['world-objects', 'World Objects / Props', 'objects', '#worldObjectCompositionOverlay'],
    ['npc-world-overlay', 'NPC Sprites / Names', 'characters', '#npcWorldOverlay'],
    ['development-labels', 'Development Labels / Overlays', 'development', '#starterVillageDevelopmentLabels']
  ];

  const METHOD_GATES = [
    ['StarterVillageRoads', 'drawPresentation', 'starter-village-roads'],
    ['MainRoadRenderer', 'drawPresentation', 'main-road-overlay'],
    ['StarterVillageExteriors', 'drawPresentation', 'starter-village-exteriors'],
    ['StarterVillageInteriors', 'drawPresentation', 'starter-village-interiors'],
    ['WorldObjectRenderer', 'drawPresentation', 'world-objects'],
    ['StarterVillageDevOverlay', 'drawDevelopmentLabels', 'development-labels']
  ];

  function cameraSnapshot() {
    const camera = Game.State?.camera || {};
    return {
      zoom: Number(camera.zoom) || 0,
      x: Number(camera.x ?? camera.centerX) || 0,
      z: Number(camera.z ?? camera.centerZ ?? camera.y) || 0
    };
  }

  function logChange(message, id, enabled) {
    const camera = cameraSnapshot();
    const detail = `contributor=${id} enabled=${enabled} zoom=${camera.zoom} camera=(${camera.x},${camera.z})`;
    if (Game.UI?.addLog) Game.UI.addLog(message, detail, { category: 'system', severity: 'info', source: 'vector-layer-debug' });
    else console.info(`[VectorLayerDebug] ${detail}`);
  }

  function register(definition) {
    if (!definition?.id) throw new Error('World presentation contributor id is required.');
    const id = String(definition.id);
    const existing = entries.get(id);
    if (existing) return existing;
    const entry = {
      id,
      label: String(definition.label || id),
      category: String(definition.category || 'presentation'),
      enabled: definition.enabled !== false,
      defaultEnabled: definition.enabled !== false,
      selector: definition.selector ? String(definition.selector) : '',
      available: definition.available !== false
    };
    entries.set(id, entry);
    refreshUI();
    return entry;
  }

  function isEnabled(id) { return entries.get(id)?.enabled !== false; }

  function clearCanvas(canvas) {
    if (!canvas || String(canvas.tagName).toLowerCase() !== 'canvas') return;
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    } catch (_) {}
  }

  function setElementVisibility(element, visible) {
    if (!element) return;
    if (!savedVisibility.has(element)) savedVisibility.set(element, element.style.visibility || '');
    if (visible) {
      element.style.visibility = savedVisibility.get(element) || '';
      savedVisibility.delete(element);
    } else {
      clearCanvas(element);
      element.style.visibility = 'hidden';
    }
  }

  function applyDomContributor(entry) {
    if (!entry?.selector || typeof document === 'undefined') return;
    for (const element of document.querySelectorAll(entry.selector)) setElementVisibility(element, entry.enabled);
  }

  function setBubblePresentation(enabled) {
    if (!Game.Config) return;
    Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = Boolean(enabled);
  }

  function clearNpcCanvasIfNeeded() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('npcWorldOverlay');
    if (!canvas) return;
    if (!isEnabled('npc-world-overlay')) setElementVisibility(canvas, false);
    else setElementVisibility(canvas, true);
  }

  function clearMainWebgl() {
    const gl = Game.State?.dom?.gl;
    if (!gl) return;
    try {
      gl.viewport(0, 0, Game.State.dom.canvas.width, Game.State.dom.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } catch (_) {}
  }

  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    const render = () => {
      renderPending = false;
      try { Game.Renderer?.renderWorld?.(true); } catch (_) {}
      enforceVisibility();
    };
    if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(render);
    else global.setTimeout(render, 0);
  }

  function setEnabled(id, enabled, options = {}) {
    const entry = entries.get(id);
    if (!entry) return false;
    const next = Boolean(enabled);
    if (entry.enabled === next) return true;
    entry.enabled = next;
    if (id === 'npc-activity-dialogue') setBubblePresentation(next);
    applyDomContributor(entry);
    if (!next && id.startsWith('renderer-')) clearMainWebgl();
    if (options.log !== false) logChange('World presentation debug changed.', id, next);
    refreshUI();
    requestRender();
    return true;
  }

  function setAll(enabled, options = {}) {
    const next = Boolean(enabled);
    for (const entry of entries.values()) {
      entry.enabled = next;
      if (entry.id === 'npc-activity-dialogue') setBubblePresentation(next);
      applyDomContributor(entry);
    }
    if (!next) clearMainWebgl();
    if (options.log !== false) logChange(next ? 'World presentation enabled.' : 'All world presentation disabled.', 'all-world-presentation', next);
    refreshUI();
    requestRender();
    return true;
  }

  function reset() {
    for (const entry of entries.values()) {
      entry.enabled = entry.defaultEnabled;
      if (entry.id === 'npc-activity-dialogue') setBubblePresentation(entry.enabled);
      applyDomContributor(entry);
    }
    logChange('World presentation debug reset.', 'reset-defaults', true);
    refreshUI();
    requestRender();
    return true;
  }

  function snapshot() { return Array.from(entries.values()).map((entry) => ({ ...entry })); }

  function withMaskedProperty(target, key, value, callback) {
    if (!target) return callback();
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    const previous = target[key];
    let changed = false;
    try {
      Object.defineProperty(target, key, { configurable: true, enumerable: descriptor?.enumerable !== false, get: () => value, set: () => {} });
      changed = true;
      return callback();
    } catch (_) {
      try { target[key] = value; changed = true; return callback(); } catch (_) { return callback(); }
    } finally {
      if (changed) {
        try {
          if (descriptor) Object.defineProperty(target, key, descriptor);
          else { delete target[key]; target[key] = previous; }
        } catch (_) { try { target[key] = previous; } catch (_) {} }
      }
    }
  }

  function withBaseMasks(callback) {
    const world = Game.State?.world;
    const camera = Game.State?.camera;
    const masks = [];
    if (!isEnabled('renderer-grid')) masks.push([camera, 'showGrid', false]);
    if (!isEnabled('renderer-hover-marker')) masks.push([world, 'hover', null]);
    if (!isEnabled('renderer-selection-marker')) masks.push([world, 'selected', null]);
    if (!isEnabled('renderer-route-preview')) masks.push([world, 'previewPath', null]);
    if (!isEnabled('renderer-player')) masks.push([world, 'player', null]);
    const run = (index) => index >= masks.length ? callback() : withMaskedProperty(masks[index][0], masks[index][1], masks[index][2], () => run(index + 1));
    return run(0);
  }

  function withBackgroundGate(callback) {
    const gl = Game.State?.dom?.gl;
    if (!gl || isEnabled('renderer-background-terrain')) return callback();
    const drawArrays = gl.drawArrays;
    const drawElements = gl.drawElements;
    const textureProgram = Game.State?.render?.textureProgram;
    const suppress = (original) => function gatedDraw(...args) {
      let current = null;
      try { current = gl.getParameter(gl.CURRENT_PROGRAM); } catch (_) {}
      if (current === textureProgram) return;
      return original.apply(gl, args);
    };
    try {
      gl.drawArrays = suppress(drawArrays);
      if (typeof drawElements === 'function') gl.drawElements = suppress(drawElements);
      return callback();
    } finally {
      try { gl.drawArrays = drawArrays; } catch (_) {}
      try { if (typeof drawElements === 'function') gl.drawElements = drawElements; } catch (_) {}
    }
  }

  function installBaseRenderGate() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function') return false;
    if (baseRenderInstalled) return true;
    const current = renderer.renderWorld;
    if (current.__worldPresentationDebugV2) {
      baseRenderWrapper = current;
      baseRenderInstalled = true;
      return true;
    }
    baseRenderSource = current;
    baseRenderWrapper = function worldPresentationDebugRender(...args) {
      if (baseRenderInProgress) {
        enforceVisibility();
        return false;
      }
      baseRenderInProgress = true;
      try {
        return withBaseMasks(() => withBackgroundGate(() => baseRenderSource.apply(this, args)));
      } finally {
        baseRenderInProgress = false;
        enforceVisibility();
      }
    };
    Object.defineProperty(baseRenderWrapper, '__worldPresentationDebugV2', { value: true });
    try {
      renderer.renderWorld = baseRenderWrapper;
      baseRenderInstalled = true;
      return true;
    } catch (_) {
      baseRenderSource = null;
      baseRenderWrapper = null;
      return false;
    }
  }

  function cloneWithMethodGate(gameKey, methodName, layerId) {
    const target = Game[gameKey];
    if (!target || typeof target[methodName] !== 'function') return false;
    const current = target[methodName];
    const patchKey = `${gameKey}.${methodName}`;
    if (current.__worldPresentationContributorGate === layerId) return true;
    if (patched.get(patchKey)?.source === current) return true;
    const wrapped = function contributorGatedMethod(...args) {
      if (!isEnabled(layerId)) { enforceVisibility(); return false; }
      const result = current.apply(this, args);
      enforceVisibility();
      return result;
    };
    Object.defineProperty(wrapped, '__worldPresentationContributorGate', { value: layerId });
    try {
      const replacement = Object.create(Object.getPrototypeOf(target));
      Object.defineProperties(replacement, Object.getOwnPropertyDescriptors(target));
      Object.defineProperty(replacement, methodName, { value: wrapped, enumerable: true, configurable: true, writable: true });
      if (Object.isFrozen(target)) Object.freeze(replacement);
      else if (Object.isSealed(target)) Object.seal(replacement);
      Game[gameKey] = replacement;
      patched.set(patchKey, { source: current, replacement, layerId });
      return true;
    } catch (_) {
      try { target[methodName] = wrapped; patched.set(patchKey, { source: current, replacement: target, layerId }); return true; } catch (_) { return false; }
    }
  }

  function enforceVisibility() {
    for (const entry of entries.values()) applyDomContributor(entry);
    clearNpcCanvasIfNeeded();
    if (!isEnabled('terrain-shape-overlay')) {
      const canvas = document.getElementById('terrainShapeOverlay');
      if (canvas) clearCanvas(canvas);
    }
  }

  function registerDefaults() {
    register({ id: 'renderer-background-terrain', label: 'Terrain / Background WebGL', category: 'terrain' });
    register({ id: 'renderer-grid', label: 'Grid Overlay', category: 'base-renderer' });
    register({ id: 'renderer-hover-marker', label: 'Hover Marker', category: 'markers' });
    register({ id: 'renderer-selection-marker', label: 'Selection Marker', category: 'markers' });
    register({ id: 'renderer-route-preview', label: 'Route Preview', category: 'routes' });
    register({ id: 'renderer-player', label: 'Protagonist / Player', category: 'characters' });
    register({ id: 'main-road-overlay', label: 'Main Road Overlay', category: 'roads', selector: '#starterVillageRoadOverlay' });
    register({ id: 'npc-activity-dialogue', label: 'NPC Activity / Dialogue Bubbles', category: 'characters' });
    for (const [id, label, category, selector] of DOM_CONTRIBUTORS) register({ id, label, category, selector });
  }

  function installGates() {
    installBaseRenderGate();
    for (const [gameKey, methodName, id] of METHOD_GATES) cloneWithMethodGate(gameKey, methodName, id);
    enforceVisibility();
    return true;
  }

  function updateButton(button, entry) {
    button.dataset.vectorLayerId = entry.id;
    button.setAttribute('aria-pressed', entry.enabled ? 'true' : 'false');
    button.setAttribute('aria-label', `${entry.label}: ${entry.enabled ? 'enabled' : 'disabled'}`);
    button.textContent = entry.enabled ? 'On' : 'Off';
  }

  function makeButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn vector-layer-debug-toggle';
    button.addEventListener('click', () => setEnabled(button.dataset.vectorLayerId, !isEnabled(button.dataset.vectorLayerId)));
    updateButton(button, entry);
    return button;
  }

  function renderTable(section) {
    const body = section.querySelector('[data-vector-layer-body]');
    if (!body) return;
    const existing = new Map(Array.from(body.querySelectorAll('[data-vector-layer-row]')).map((row) => [row.dataset.vectorLayerRow, row]));
    const active = new Set();
    for (const entry of entries.values()) {
      active.add(entry.id);
      let row = existing.get(entry.id);
      if (!row) {
        row = document.createElement('tr');
        row.dataset.vectorLayerRow = entry.id;
        const name = document.createElement('td'); name.dataset.vectorLayerName = '';
        const category = document.createElement('td'); category.dataset.vectorLayerCategory = '';
        const state = document.createElement('td'); state.appendChild(makeButton(entry));
        row.append(name, category, state); body.appendChild(row);
      }
      row.querySelector('[data-vector-layer-name]').textContent = entry.label;
      row.querySelector('[data-vector-layer-category]').textContent = entry.category;
      const button = row.querySelector('[data-vector-layer-id]'); if (button) updateButton(button, entry);
    }
    for (const [id, row] of existing) if (!active.has(id)) row.remove();
  }

  function ensureUI() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return false;
    let section = document.getElementById('vectorLayerDebugSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'vectorLayerDebugSection';
      section.className = 'vector-layer-debug-section';
      section.setAttribute('aria-labelledby', 'vectorLayerDebugHeading');
      section.innerHTML = `
        <style>
          #settingsModal .modal-card,#settingsModal .settings-content,#settingsModal .modal-content{max-height:calc(100dvh - 2rem);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y}
          #vectorLayerDebugSection{margin-top:1rem;padding-top:1rem;border-top:1px solid currentColor}
          #vectorLayerDebugSection table{width:100%;border-collapse:collapse;font-size:.9rem}
          #vectorLayerDebugSection th,#vectorLayerDebugSection td{text-align:left;padding:.35rem .4rem;vertical-align:middle}
          #vectorLayerDebugSection .vector-layer-debug-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.5rem 0}
        </style>
        <h3 id="vectorLayerDebugHeading">Vector Layer Debug</h3>
        <p>Development-only world presentation controls. Simulation and save data are not modified.</p>
        <div class="vector-layer-debug-actions">
          <button type="button" id="vectorLayerDebugAllOff" class="secondary-btn">All world presentation Off</button>
          <button type="button" id="vectorLayerDebugReset" class="secondary-btn">Reset defaults</button>
        </div>
        <table aria-label="Vector layer debug controls"><thead><tr><th scope="col">Contributor</th><th scope="col">Category</th><th scope="col">State</th></tr></thead><tbody data-vector-layer-body></tbody></table>`;
      const card = modal.querySelector('.modal-card, .settings-content, .modal-content') || modal;
      const footer = card.querySelector('.modal-actions, .settings-actions, footer');
      if (footer?.parentNode === card) card.insertBefore(section, footer); else card.appendChild(section);
      section.querySelector('#vectorLayerDebugAllOff')?.addEventListener('click', () => setAll(false));
      section.querySelector('#vectorLayerDebugReset')?.addEventListener('click', reset);
      modal.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
      modal.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });
    }
    renderTable(section);
    uiInstalled = true;
    return true;
  }

  function refreshUI() {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('vectorLayerDebugSection'); if (section) renderTable(section);
  }

  function visualEvidence() {
    const result = [];
    for (const entry of entries.values()) {
      if (!entry.selector) continue;
      for (const element of document.querySelectorAll(entry.selector)) result.push({ id: entry.id, selector: entry.selector, visible: getComputedStyle(element).visibility !== 'hidden', width: Number(element.width || 0), height: Number(element.height || 0) });
    }
    return result;
  }

  function install() { registerDefaults(); installGates(); ensureUI(); return uiInstalled; }

  Game.VectorLayerDebug = Object.freeze({ version: VERSION, authority: 'presentation-only', register, isEnabled, setEnabled, setAll, reset, snapshot, visualEvidence, install });
  install();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
    global.setInterval(install, RETRY_MS);
  }
})(typeof window !== 'undefined' ? window : globalThis);