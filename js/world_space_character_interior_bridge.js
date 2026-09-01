/*
  R04 / #254: compose the independently verified exterior world-space character
  presentation with #253 same-world interiors.

  Character identity/position and building membership remain derived from Simulation.
  This bridge only records presentation continuity and keeps the character layer above
  the interior floor/cutaway canvas; it never mutates occupancy, movement or save state.
*/
(function installWorldSpaceCharacterInteriorBridge(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-space-character-interior-continuity-v1';
  const RETRY_MS = 120;
  let installed = false;
  let timer = 0;

  function finitePosition(character) {
    return Boolean(
      character &&
      Number.isFinite(Number(character.row)) &&
      Number.isFinite(Number(character.col))
    );
  }

  function interiorFor(character) {
    if (!finitePosition(character) || typeof Game.StarterVillageInteriors?.interiorAt !== 'function') return null;
    return Game.StarterVillageInteriors.interiorAt(Number(character.row), Number(character.col));
  }

  function presentationFor(character, kind) {
    if (!finitePosition(character)) return null;
    const isPlayer = kind === 'protagonist';
    const asset = isPlayer
      ? Game.NPCWorld?.protagonistWorldSpaceAssetFor?.(character) || ''
      : Game.NPCWorld?.worldSpaceAssetFor?.(character) || '';
    const interior = interiorFor(character);
    return Object.freeze({
      kind: isPlayer ? 'protagonist' : 'npc',
      id: isPlayer ? 'protagonist' : String(character.id || ''),
      authority: isPlayer ? 'simulation' : String(character.authority || ''),
      row: Number(character.row),
      col: Number(character.col),
      asset,
      renderMode: asset ? 'world-space-png' : 'neutral-humanoid-fallback',
      buildingId: interior?.buildingId || null,
      locationLayer: interior ? 'interior' : 'exterior',
      spriteAnchor: 'bottom-center-feet'
    });
  }

  function synchronize() {
    const npcOverlay = global.document?.getElementById('npcWorldOverlay');
    const interiorOverlay = global.document?.getElementById('starterVillageInteriorOverlay');
    const world = Game.State?.world;
    if (!npcOverlay || !world || !Game.NPCWorld) return false;

    // #252 depth contract: interior floor/lower mass, then character sprites, then bubbles.
    // The #253 and #324 canvases were both z-index 2; make their order explicit instead of
    // relying on dynamic script/append timing.
    npcOverlay.style.zIndex = '3';

    const protagonist = presentationFor(world.player, 'protagonist');
    const npcs = Array.isArray(world.npcs)
      ? world.npcs.map((npc) => presentationFor(npc, 'npc')).filter(Boolean)
      : [];
    const interiorNpcCount = npcs.filter((entry) => entry.locationLayer === 'interior').length;

    npcOverlay.dataset.interiorContinuityVersion = VERSION;
    npcOverlay.dataset.protagonistLocationLayer = protagonist?.locationLayer || 'unavailable';
    npcOverlay.dataset.protagonistBuildingId = protagonist?.buildingId || '';
    npcOverlay.dataset.interiorNpcCount = String(interiorNpcCount);
    npcOverlay.dataset.interiorLayerZIndex = interiorOverlay ? String(getComputedStyle(interiorOverlay).zIndex || '') : '';
    return true;
  }

  function snapshot() {
    const world = Game.State?.world;
    const npcOverlay = global.document?.getElementById('npcWorldOverlay');
    const interiorOverlay = global.document?.getElementById('starterVillageInteriorOverlay');
    return {
      version: VERSION,
      authority: 'presentation-only',
      protagonist: presentationFor(world?.player, 'protagonist'),
      npcs: Array.isArray(world?.npcs) ? world.npcs.map((npc) => presentationFor(npc, 'npc')).filter(Boolean) : [],
      layers: {
        npc: npcOverlay ? Number.parseInt(getComputedStyle(npcOverlay).zIndex || '0', 10) || 0 : null,
        interior: interiorOverlay ? Number.parseInt(getComputedStyle(interiorOverlay).zIndex || '0', 10) || 0 : null
      }
    };
  }

  function install() {
    if (!Game.NPCWorld || !Game.StarterVillageInteriors) return false;
    installed = true;
    synchronize();
    if (!timer && typeof global.setInterval === 'function') {
      timer = global.setInterval(synchronize, RETRY_MS);
    }
    return true;
  }

  Game.WorldSpaceCharacterContinuity = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    install,
    synchronize,
    interiorFor,
    presentationFor,
    snapshot,
    get installed() { return installed; }
  });

  function tryInstall() {
    if (!install() && typeof global.setTimeout === 'function') global.setTimeout(tryInstall, RETRY_MS);
  }

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', tryInstall, { once: true });
  } else {
    tryInstall();
  }
})(typeof window !== 'undefined' ? window : globalThis);
