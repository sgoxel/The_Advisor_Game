/*
  R04 #294: generalized transparent world-object composition.

  Simulation-backed descriptors (#293) own object truth. This renderer consumes
  semantic registry identities (#285) and composes transparent presentation only.
  PNG alpha, source size, registry paths and depth ordering never become gameplay authority.
*/
(function installWorldObjectRenderer(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-object-renderer-v1';
  const PRESENTATION_AUTHORITY = 'presentation-only';
  const SCRIPT_URL = typeof document !== 'undefined' && document.currentScript?.src
    ? document.currentScript.src
    : new URL('js/world_object_renderer.js', global.location?.href || 'http://localhost/').href;
  const REGISTRY_MODULE_URL = new URL('tile_registry.js', SCRIPT_URL).href;
  const MAX_OBJECTS = 128;
  const MAX_COMPOSITION_ITEMS = 192;

  let overlayCanvas = null;
  let registryEntries = [];
  let semanticRegistry = null;
  let registryModulePromise = null;
  let explicitDescriptors = [];
  let descriptorSource = 'none';
  let renderHookInstalled = false;
  const objectAssetCache = new Map();
  const npcAssetCache = new Map();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).sort().forEach((key) => { out[key] = clone(value[key]); });
    return out;
  }

  async function registryModule() {
    if (!registryModulePromise) registryModulePromise = import(REGISTRY_MODULE_URL);
    return registryModulePromise;
  }

  async function configureRegistry(entries) {
    const module = await registryModule();
    registryEntries = (Array.isArray(entries) ? entries : []).map((entry) => clone(entry));
    semanticRegistry = new module.SemanticTileRegistry(registryEntries);
    objectAssetCache.clear();
    await ensureAssets();
    drawPresentation();
    return registrySnapshot();
  }

  function registrySnapshot() {
    return semanticRegistry?.entries ? semanticRegistry.entries().map((entry) => clone(entry)) : [];
  }

  function descriptorApi() {
    return Game.WorldObjectPresentationDescriptor;
  }

  function normalizeDescriptor(input) {
    const api = descriptorApi();
    if (!api?.describe || !api?.fingerprint) throw new Error('WorldObjectPresentationDescriptor is unavailable.');
    if (
      input &&
      input.authority === api.authority &&
      input.descriptorVersion === api.descriptorVersion &&
      Object.isFrozen(input)
    ) return input;
    return api.describe(input);
  }

  function setDescriptors(inputs, options = {}) {
    if (!Array.isArray(inputs)) throw new TypeError('World-object descriptors must be an array.');
    explicitDescriptors = inputs.slice(0, MAX_OBJECTS).map(normalizeDescriptor);
    descriptorSource = options.source || 'explicit';
    ensureAssets().finally(drawPresentation);
    return descriptorSnapshot();
  }

  function clearDescriptors() {
    explicitDescriptors = [];
    descriptorSource = 'none';
    restoreNpcOverlay();
    drawPresentation();
  }

  function syncFromWorld() {
    const source = Game.State?.world?.objectPresentationDescriptors;
    if (!Array.isArray(source)) return false;
    explicitDescriptors = source.slice(0, MAX_OBJECTS).map(normalizeDescriptor);
    descriptorSource = 'simulation-world-descriptors';
    ensureAssets().finally(drawPresentation);
    return true;
  }

  function descriptors() {
    return explicitDescriptors;
  }

  function descriptorSnapshot() {
    const api = descriptorApi();
    return descriptors().map((descriptor) => ({
      objectId: descriptor.objectId,
      fingerprint: api.fingerprint(descriptor),
      presentationClass: descriptor.presentationClass,
      semanticKey: descriptor.visual.semanticKey,
      assetAvailable: descriptor.visual.assetAvailable
    }));
  }

  function semanticIdentity(descriptor) {
    const semanticKey = String(descriptor?.visual?.semanticKey || descriptor?.semanticType || '').trim();
    const parts = semanticKey.split('.').map((part) => part.trim()).filter(Boolean);
    const family = (parts.shift() || String(descriptor?.semanticType || '')).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const type = (parts.length ? parts.join('_') : 'default').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    return { family, type, size: 256 };
  }

  function assetKey(descriptor) {
    const semantic = semanticIdentity(descriptor);
    return `${semantic.family}:${semantic.type}:${semantic.size}`;
  }

  function inspectTransparency(image) {
    if (typeof document === 'undefined' || !image) return null;
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.min(256, image.naturalWidth || image.width || 1));
    const height = Math.max(1, Math.min(256, image.naturalHeight || image.height || 1));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 16));
    let sawTransparent = false;
    let sawVisible = false;
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha < 250) sawTransparent = true;
        if (alpha > 5) sawVisible = true;
        if (sawTransparent && sawVisible) return true;
      }
    }
    return sawTransparent && sawVisible;
  }

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') {
        reject(new Error('Image decoding is unavailable.'));
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Semantic object image could not be decoded.'));
      };
      image.src = objectUrl;
    });
  }

  async function loadObjectAsset(descriptor) {
    const key = assetKey(descriptor);
    if (descriptor.visual.assetAvailable === false) {
      const unavailable = { key, status: 'descriptor-unavailable', image: null, url: null, hasTransparency: null };
      objectAssetCache.set(key, unavailable);
      return unavailable;
    }
    if (objectAssetCache.has(key)) {
      const cached = objectAssetCache.get(key);
      return cached.promise || cached;
    }

    const record = { key, status: 'loading', image: null, url: null, hasTransparency: null, promise: null };
    record.promise = (async () => {
      try {
        if (!semanticRegistry) throw new Error('Semantic registry is not configured.');
        const module = await registryModule();
        const semantic = semanticIdentity(descriptor);
        const loaded = await module.loadSemanticTile(
          semanticRegistry,
          semantic.family,
          semantic.type,
          { size: semantic.size, baseUrl: document.baseURI }
        );
        const blob = await loaded.response.blob();
        const image = await imageFromBlob(blob);
        record.status = 'ready';
        record.image = image;
        record.url = loaded.url;
        record.hasTransparency = inspectTransparency(image);
      } catch (error) {
        record.status = 'failed';
        record.image = null;
        record.error = String(error?.message || error);
      } finally {
        record.promise = null;
      }
      return record;
    })();
    objectAssetCache.set(key, record);
    return record.promise;
  }

  async function ensureAssets() {
    await Promise.all(descriptors().map((descriptor) => loadObjectAsset(descriptor)));
    return assetDiagnostics();
  }

  function assetDiagnostics() {
    return Array.from(objectAssetCache.values())
      .map((record) => ({
        key: record.key,
        status: record.status,
        url: record.url,
        hasTransparency: record.hasTransparency,
        error: record.error || null
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  function ensureOverlay() {
    if (typeof document === 'undefined') return null;
    const host = document.getElementById('center-area');
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    if (!host || !gameCanvas) return null;
    if (overlayCanvas?.isConnected) return overlayCanvas;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'worldObjectCompositionOverlay';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    overlayCanvas.tabIndex = -1;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.inset = '0';
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '2';
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function npcOverlay() {
    return typeof document !== 'undefined' ? document.getElementById('npcWorldOverlay') : null;
  }

  function suppressNpcOverlay() {
    const overlay = npcOverlay();
    if (overlay) overlay.style.visibility = descriptors().length ? 'hidden' : '';
  }

  function restoreNpcOverlay() {
    const overlay = npcOverlay();
    if (overlay) overlay.style.visibility = '';
  }

  function projectedTileSize(renderer, row, col) {
    const origin = renderer.gridToScreen(row, col, 0, 0);
    const east = renderer.gridToScreen(row, col + 1, 0, 0);
    const south = renderer.gridToScreen(row + 1, col, 0, 0);
    const eastDistance = Math.hypot(finite(east.x) - finite(origin.x), finite(east.y) - finite(origin.y));
    const southDistance = Math.hypot(finite(south.x) - finite(origin.x), finite(south.y) - finite(origin.y));
    return clamp(Math.max(eastDistance, southDistance, 18), 18, 180);
  }

  function baselineCell(descriptor) {
    const occupied = descriptor.footprint?.occupiedCells || [];
    if (!occupied.length) return { row: descriptor.position.row, col: descriptor.position.col };
    return occupied.slice().sort((a, b) => {
      const depth = (a.row + a.col) - (b.row + b.col);
      return depth || a.row - b.row || a.col - b.col;
    }).at(-1);
  }

  function displayBounds(descriptor, renderer, viewport) {
    const baseline = baselineCell(descriptor);
    const tileSize = projectedTileSize(renderer, baseline.row, baseline.col);
    const sourceBounds = descriptor.visual?.bounds;
    const aspect = sourceBounds ? clamp(sourceBounds.height / sourceBounds.width, 0.45, 3.2) : 1;
    const footprintSpan = Math.max(1, descriptor.footprint?.width || 1, descriptor.footprint?.height || 1);
    const classMultiplier = descriptor.presentationClass === 'multi-tile-prop'
      ? 0.9 + Math.min(2.2, (footprintSpan - 1) * 0.62)
      : descriptor.presentationClass === 'world-entity'
        ? 1.15 + Math.min(1.6, (footprintSpan - 1) * 0.45)
        : 0.92;
    const maxWidth = Math.max(48, viewport.width * 0.28);
    const maxHeight = Math.max(72, viewport.height * 0.42);
    const width = clamp(tileSize * classMultiplier, 18, maxWidth);
    const height = clamp(width * aspect, 18, maxHeight);
    return { width, height, tileSize };
  }

  function objectEntries(renderer, viewport) {
    return descriptors().map((descriptor) => {
      const baseline = baselineCell(descriptor);
      const point = renderer.gridToScreen(baseline.row, baseline.col, 0, 0);
      const bounds = displayBounds(descriptor, renderer, viewport);
      const semantic = semanticIdentity(descriptor);
      const asset = objectAssetCache.get(assetKey(descriptor)) || {
        status: descriptor.visual.assetAvailable === false ? 'descriptor-unavailable' : 'unrequested',
        image: null,
        hasTransparency: null
      };
      return {
        kind: 'object',
        id: descriptor.objectId,
        sortId: `object:${descriptor.objectId}`,
        depthKey: finite(point.y),
        screenX: finite(point.x),
        screenY: finite(point.y),
        descriptor,
        semantic,
        asset,
        displayWidth: bounds.width,
        displayHeight: bounds.height
      };
    });
  }

  function npcEntries(renderer, viewport) {
    const api = Game.NPCWorld;
    if (!api?.capture) return [];
    const iconSize = clamp((30 + clamp(finite(Game.State?.camera?.zoom, 5), 2, 5) * 6.2) * clamp(viewport.width / 1440, 0.78, 1.18), 34, 64);
    return api.capture().map((npc) => {
      const point = renderer.gridToScreen(npc.row, npc.col, 0, 0);
      return {
        kind: 'npc',
        id: npc.id,
        sortId: `npc:${npc.id}`,
        depthKey: finite(point.y),
        screenX: finite(point.x),
        screenY: finite(point.y),
        npc,
        iconSize
      };
    });
  }

  function compositionEntries(renderer, viewport) {
    const entries = [...objectEntries(renderer, viewport), ...npcEntries(renderer, viewport)]
      .filter((entry) => Number.isFinite(entry.screenX) && Number.isFinite(entry.screenY))
      .sort((a, b) => a.depthKey - b.depthKey || a.sortId.localeCompare(b.sortId))
      .slice(0, MAX_COMPOSITION_ITEMS);
    return entries;
  }

  function requestNpcImage(src) {
    if (!src || typeof Image === 'undefined') return null;
    if (npcAssetCache.has(src)) return npcAssetCache.get(src);
    const record = { status: 'loading', image: null };
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { record.status = 'ready'; record.image = image; drawPresentation(); };
    image.onerror = () => { record.status = 'failed'; record.image = null; drawPresentation(); };
    image.src = src;
    npcAssetCache.set(src, record);
    return record;
  }

  function drawNpcFallback(ctx, entry) {
    const radius = clamp(entry.iconSize / 6.8, 5, 9);
    ctx.fillStyle = 'rgba(216,231,239,0.92)';
    ctx.strokeStyle = 'rgba(38,52,61,0.95)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -radius * 1.7, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.7, -radius);
    ctx.lineTo(radius * 0.7, -radius);
    ctx.lineTo(radius * 0.95, radius);
    ctx.lineTo(-radius * 0.95, radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawNpc(ctx, entry) {
    const src = Game.NPCWorld?.worldIconAssetFor?.(entry.npc) || '';
    const record = requestNpcImage(src);
    if (record?.status === 'ready' && record.image) {
      ctx.drawImage(record.image, -entry.iconSize / 2, -entry.iconSize * 0.82, entry.iconSize, entry.iconSize);
      return 'png';
    }
    drawNpcFallback(ctx, entry);
    return 'fallback';
  }

  function drawMissingObject(ctx, entry) {
    const width = clamp(entry.displayWidth * 0.58, 18, 64);
    const height = clamp(entry.displayHeight * 0.42, 18, 64);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(235,198,106,0.92)';
    ctx.fillStyle = 'rgba(22,24,20,0.36)';
    ctx.strokeRect(-width / 2, -height, width, height);
    ctx.fillRect(-width / 2, -height, width, height);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,232,197,0.95)';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, -height / 2);
    ctx.restore();
  }

  function drawObject(ctx, entry) {
    const anchor = entry.descriptor.visual?.anchor || { x: 0.5, y: 1 };
    const x = -entry.displayWidth * clamp(finite(anchor.x, 0.5), 0, 1);
    const y = -entry.displayHeight * clamp(finite(anchor.y, 1), 0, 1);
    if (entry.asset?.status === 'ready' && entry.asset.image) {
      ctx.drawImage(entry.asset.image, x, y, entry.displayWidth, entry.displayHeight);
      return 'png';
    }
    drawMissingObject(ctx, entry);
    return 'fallback';
  }

  function drawPresentation() {
    const renderer = Game.Renderer;
    const canvas = ensureOverlay();
    if (!renderer || !canvas) return false;
    if (!descriptors().length) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      restoreNpcOverlay();
      canvas.dataset.objectCount = '0';
      return true;
    }

    suppressNpcOverlay();
    const width = Math.max(1, canvas.clientWidth || Game.State?.dom?.canvas?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State?.dom?.canvas?.clientHeight || 1);
    const dpr = Math.max(1, global.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const entries = compositionEntries(renderer, { width, height });

    let readyObjects = 0;
    let missingObjects = 0;
    let entityObjects = 0;
    let npcCount = 0;
    for (const entry of entries) {
      const margin = entry.kind === 'object' ? Math.max(entry.displayWidth, entry.displayHeight) : entry.iconSize;
      if (entry.screenX < -margin || entry.screenY < -margin || entry.screenX > width + margin || entry.screenY > height + margin) continue;
      ctx.save();
      ctx.translate(entry.screenX, entry.screenY);
      if (entry.kind === 'object') {
        const rendered = drawObject(ctx, entry);
        if (rendered === 'png') readyObjects += 1;
        else missingObjects += 1;
        if (entry.descriptor.presentationClass === 'world-entity') entityObjects += 1;
      } else {
        drawNpc(ctx, entry);
        npcCount += 1;
      }
      ctx.restore();
    }

    canvas.dataset.presentationAuthority = PRESENTATION_AUTHORITY;
    canvas.dataset.descriptorAuthority = 'simulation';
    canvas.dataset.descriptorSource = descriptorSource;
    canvas.dataset.objectCount = String(descriptors().length);
    canvas.dataset.readyObjectCount = String(readyObjects);
    canvas.dataset.missingObjectCount = String(missingObjects);
    canvas.dataset.worldEntityCount = String(entityObjects);
    canvas.dataset.composedNpcCount = String(npcCount);
    canvas.dataset.depthOrder = 'authoritative-ground-baseline';
    canvas.dataset.registryEntryCount = String(registrySnapshot().length);
    canvas.dataset.pointerPassive = 'true';
    return true;
  }

  function snapshotComposition() {
    const renderer = Game.Renderer;
    const canvas = ensureOverlay();
    if (!renderer || !canvas) return [];
    const width = Math.max(1, canvas.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || 1);
    return compositionEntries(renderer, { width, height }).map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      depthKey: entry.depthKey,
      screenX: entry.screenX,
      screenY: entry.screenY,
      presentationClass: entry.kind === 'object' ? entry.descriptor.presentationClass : 'character',
      assetStatus: entry.kind === 'object' ? entry.asset.status : null,
      semantic: entry.kind === 'object' ? clone(entry.semantic) : null,
      displayWidth: entry.kind === 'object' ? entry.displayWidth : entry.iconSize,
      displayHeight: entry.kind === 'object' ? entry.displayHeight : entry.iconSize
    }));
  }

  function installRenderHook() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function worldObjectAwareRenderWorld(force) {
      const result = renderWorld(force);
      if (descriptorSource !== 'explicit') syncFromWorld();
      drawPresentation();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function detachPresentation() {
    restoreNpcOverlay();
    if (overlayCanvas?.parentNode) overlayCanvas.parentNode.removeChild(overlayCanvas);
    overlayCanvas = null;
  }

  function initialize() {
    ensureOverlay();
    installRenderHook();
    syncFromWorld();
    drawPresentation();
  }

  Game.WorldObjectRenderer = Object.freeze({
    version: VERSION,
    authority: PRESENTATION_AUTHORITY,
    maxObjects: MAX_OBJECTS,
    configureRegistry,
    registrySnapshot,
    setDescriptors,
    clearDescriptors,
    syncFromWorld,
    descriptorSnapshot,
    ensureAssets,
    assetDiagnostics,
    semanticIdentity,
    drawPresentation,
    snapshotComposition,
    detachPresentation
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
