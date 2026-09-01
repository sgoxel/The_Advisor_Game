/*
  R04 / #345: presentation-only vector layer debugger.
  Lets development users isolate zoom/render faults without mutating Simulation state.
*/
(function installVectorLayerDebug(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-vector-layer-debug-v1';
  const RETRY_MS = 100;
  const entries = new Map();
  const patched = new Map();
  let renderHookInstalled = false;
  let uiInstalled = false;

  function cameraSnapshot() {
    const camera = Game.State?.camera || {};
    return {
      zoom: Number(camera.zoom) || 0,
      x: Number(camera.x ?? camera.centerX) || 0,
      z: Number(camera.z ?? camera.centerZ ?? camera.y) || 0
    };
  }

  function logToggle(id, enabled) {
    const camera = cameraSnapshot();
    const detail = `layer=${id} enabled=${enabled} zoom=${camera.zoom} camera=(${camera.x},${camera.z})`;
    if (Game.UI?.addLog) {
      Game.UI.addLog('Vector layer debug changed.', detail, {
        category: 'system', severity: 'info', source: 'vector-layer-debug'
      });
    } else {
      console.info(`[VectorLayerDebug] ${detail}`);
    }
  }

  function requestRender() {
    try { Game.Renderer?.renderWorld?.(true); } catch (_) {}
  }

  function register(definition) {
    if (!definition?.id) throw new Error('Vector layer id is required.');
    const existing = entries.get(definition.id);
    if (existing) return existing;
    const entry = {
      id: String(definition.id),
      label: String(definition.label || definition.id),
      category: String(definition.category || 'presentation'),
      enabled: definition.enabled !== false,
      defaultEnabled: definition.enabled !== false,
      available: definition.available !== false
    };
    entries.set(entry.id, entry);
    refreshUI();
    return entry;
  }

  function isEnabled(id) {
    return entries.get(id)?.enabled !== false;
  }

  function setEnabled(id, enabled, options = {}) {
    const entry = entries.get(id);
    if (!entry) return false;
    const next = Boolean(enabled);
    if (entry.enabled === next) return true;
    entry.enabled = next;
    if (options.log !== false) logToggle(id, next);
    refreshUI();
    requestRender();
    return true;
  }

  function reset() {
    for (const entry of entries.values()) entry.enabled = entry.defaultEnabled;
    const camera = cameraSnapshot();
    if (Game.UI?.addLog) {
      Game.UI.addLog('Vector layer debug reset.', `zoom=${camera.zoom} camera=(${camera.x},${camera.z})`, {
        category: 'system', severity: 'info', source: 'vector-layer-debug'
      });
    }
    refreshUI();
    requestRender();
    return true;
  }

  function snapshot() {
    return Array.from(entries.values()).map((entry) => ({ ...entry }));
  }

  function cloneWithMethodGate(gameKey, methodName, layerId) {
    const target = Game[gameKey];
    if (!target || typeof target[methodName] !== 'function') return false;
    const current = target[methodName];
    const patchKey = `${gameKey}.${methodName}`;
    const known = patched.get(patchKey);
    if (current.__vectorLayerDebugGate === layerId) return true;
    if (known?.source === current) return true;

    const wrapped = function vectorLayerDebugGatedMethod(...args) {
      if (!isEnabled(layerId)) return false;
      return current.apply(this, args);
    };
    Object.defineProperty(wrapped, '__vectorLayerDebugGate', { value: layerId });

    let replacement;
    try {
      replacement = Object.create(Object.getPrototypeOf(target));
      Object.defineProperties(replacement, Object.getOwnPropertyDescriptors(target));
      Object.defineProperty(replacement, methodName, {
        value: wrapped,
        enumerable: true,
        configurable: true,
        writable: true
      });
      if (Object.isFrozen(target)) Object.freeze(replacement);
      else if (Object.isSealed(target)) Object.seal(replacement);
      Game[gameKey] = replacement;
    } catch (_) {
      try {
        target[methodName] = wrapped;
        replacement = target;
      } catch (_) {
        return false;
      }
    }

    patched.set(patchKey, { source: current, replacement, layerId });
    return true;
  }

  function installWebglGate() {
    if (renderHookInstalled || typeof Game.Renderer?.renderWorld !== 'function') return renderHookInstalled;
    const renderer = Game.Renderer;
    const previous = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function vectorLayerDebugRenderWorld(...args) {
      const gl = Game.State?.render?.gl || Game.State?.dom?.canvas?.getContext?.('webgl2') || Game.State?.dom?.canvas?.getContext?.('webgl');
      if (!gl || isEnabled('renderer-webgl')) return previous(...args);

      const drawArrays = gl.drawArrays;
      const drawElements = gl.drawElements;
      try {
        gl.drawArrays = function suppressedDrawArrays() {};
        if (typeof drawElements === 'function') gl.drawElements = function suppressedDrawElements() {};
        return previous(...args);
      } finally {
        try { gl.drawArrays = drawArrays; } catch (_) {}
        try { if (typeof drawElements === 'function') gl.drawElements = drawElements; } catch (_) {}
      }
    };
    renderHookInstalled = true;
    return true;
  }

  const METHOD_LAYERS = [
    ['StarterVillageRoads', 'drawPresentation', 'starter-village-roads', 'Starter Village Roads', 'roads'],
    ['MainRoadRenderer', 'drawPresentation', 'main-road-overlay', 'Main Road Overlay', 'roads'],
    ['StarterVillageExteriors', 'drawPresentation', 'starter-village-exteriors', 'Starter Village Exteriors', 'buildings'],
    ['WorldObjectRenderer', 'drawPresentation', 'world-objects', 'World Objects', 'objects'],
    ['NPCWorld', 'drawPresentation', 'npc-world-overlay', 'NPC World Overlay', 'characters']
  ];

  register({ id: 'renderer-webgl', label: 'Base World WebGL', category: 'base-renderer' });
  for (const [, , id, label, category] of METHOD_LAYERS) register({ id, label, category });

  function installGates() {
    installWebglGate();
    for (const [gameKey, methodName, id] of METHOD_LAYERS) {
      cloneWithMethodGate(gameKey, methodName, id);
    }
    return true;
  }

  function makeButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn vector-layer-debug-toggle';
    button.dataset.vectorLayerId = entry.id;
    button.setAttribute('aria-pressed', entry.enabled ? 'true' : 'false');
    button.setAttribute('aria-label', `${entry.label}: ${entry.enabled ? 'enabled' : 'disabled'}`);
    button.textContent = entry.enabled ? 'On' : 'Off';
    button.addEventListener('click', () => setEnabled(entry.id, !isEnabled(entry.id)));
    return button;
  }

  function renderTable(section) {
    const body = section.querySelector('[data-vector-layer-body]');
    if (!body) return;
    body.textContent = '';
    for (const entry of entries.values()) {
      const row = document.createElement('tr');
      row.dataset.vectorLayerRow = entry.id;
      const name = document.createElement('td');
      name.textContent = entry.label;
      const type = document.createElement('td');
      type.textContent = entry.category;
      const state = document.createElement('td');
      state.appendChild(makeButton(entry));
      row.append(name, type, state);
      body.appendChild(row);
    }
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
          #vectorLayerDebugSection{margin-top:1rem;padding-top:1rem;border-top:1px solid currentColor}
          #vectorLayerDebugSection table{width:100%;border-collapse:collapse;font-size:.9rem}
          #vectorLayerDebugSection th,#vectorLayerDebugSection td{text-align:left;padding:.35rem .4rem;vertical-align:middle}
          #vectorLayerDebugSection .vector-layer-debug-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.5rem 0}
        </style>
        <h3 id="vectorLayerDebugHeading">Vector Layer Debug</h3>
        <p>Development-only presentation controls. Simulation and save data are not modified.</p>
        <div class="vector-layer-debug-actions">
          <button type="button" id="vectorLayerDebugReset" class="secondary-btn">Reset layers</button>
        </div>
        <table aria-label="Vector layer debug controls">
          <thead><tr><th scope="col">Layer</th><th scope="col">Category</th><th scope="col">State</th></tr></thead>
          <tbody data-vector-layer-body></tbody>
        </table>`;
      const card = modal.querySelector('.modal-card, .settings-content, .modal-content') || modal;
      const footer = card.querySelector('.modal-actions, .settings-actions, footer');
      if (footer?.parentNode === card) card.insertBefore(section, footer);
      else card.appendChild(section);
      section.querySelector('#vectorLayerDebugReset')?.addEventListener('click', reset);
    }
    renderTable(section);
    uiInstalled = true;
    return true;
  }

  function refreshUI() {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('vectorLayerDebugSection');
    if (section) renderTable(section);
  }

  function install() {
    installGates();
    ensureUI();
    return renderHookInstalled || uiInstalled;
  }

  Game.VectorLayerDebug = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    register,
    isEnabled,
    setEnabled,
    reset,
    snapshot,
    install
  });

  install();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
    global.setInterval(install, RETRY_MS);
  }
})(typeof window !== 'undefined' ? window : globalThis);
