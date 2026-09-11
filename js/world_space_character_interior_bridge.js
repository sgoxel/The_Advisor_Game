/*
  R04 / #254 + WP-112: keep Simulation-derived interior membership attached to
  independently dynamic character presentation without relying on a separate interior canvas.

  NPC/protagonist identity and position remain Simulation authority. Static interior/world art
  is flattened by StaticTileCompositor; NPC presentation remains the sole dynamic world-image
  exception.
*/
(function installWorldSpaceCharacterInteriorBridge(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-space-character-interior-continuity-v2-static-background';
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
    const world = Game.State?.world;
    if (!npcOverlay || !world || !Game.NPCWorld) return false;

    // WP-112: there is no interior/background object canvas beneath NPCs anymore. Static world
    // pixels are already in the shared background path; NPCs remain above that path.
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
    npcOverlay.dataset.staticWorldPresentation = '100px-tile-composites';
    npcOverlay.dataset.interiorLayerZIndex = '';
    return true;
  }

  function snapshot() {
    const world = Game.State?.world;
    const npcOverlay = global.document?.getElementById('npcWorldOverlay');
    return {
      version: VERSION,
      authority: 'presentation-only',
      protagonist: presentationFor(world?.player, 'protagonist'),
      npcs: Array.isArray(world?.npcs) ? world.npcs.map((npc) => presentationFor(npc, 'npc')).filter(Boolean) : [],
      layers: {
        staticWorld: 'shared-background-100px-tile-composites',
        npc: npcOverlay ? Number.parseInt(getComputedStyle(npcOverlay).zIndex || '0', 10) || 0 : null,
        interior: null
      }
    };
  }

  function install() {
    if (!Game.NPCWorld || !Game.StarterVillageInteriors) return false;
    installed = true;
    synchronize();
    if (!timer && typeof global.setInterval === 'function') timer = global.setInterval(synchronize, RETRY_MS);
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
