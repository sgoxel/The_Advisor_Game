/*
  R04 / #244 runtime bridge: apply the authoritative starter-village footprint stamp
  to the generated terrain grid that app.js actually installs as State.world.terrain.

  This is Simulation integration only. It does not draw presentation overlays and it does
  not create a second village descriptor. It reuses SpatialWorld's deterministic base state
  and stampVillageOnRuntimeTerrain() authority.
*/
(function installStarterVillageRuntimeTerrainBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const MARKER = '__starterVillageRuntimeTerrainBridge';

  function install() {
    const Terrain = Game.Terrain;
    const SpatialWorld = Game.SpatialWorld;
    if (!Terrain || typeof Terrain.generateWorld !== 'function') return false;
    if (!SpatialWorld || typeof SpatialWorld.bindRuntime !== 'function' || typeof SpatialWorld.stampVillageOnRuntimeTerrain !== 'function') return false;

    // Ensure the canonical spatial wrapper is installed first. bindRuntime() is idempotent.
    SpatialWorld.bindRuntime();
    if (Terrain.generateWorld && Terrain.generateWorld[MARKER]) return true;

    const generateWorld = Terrain.generateWorld.bind(Terrain);
    const wrappedGenerateWorld = function starterVillageRuntimeTerrainGenerateWorld(seedInput, colsInput, rowsInput) {
      const generated = generateWorld(seedInput, colsInput, rowsInput);
      const grid = generated && generated.grid;
      const village = generated && generated.originVillageBase && generated.originVillageBase.village;
      if (Array.isArray(grid) && village) {
        SpatialWorld.stampVillageOnRuntimeTerrain({ terrain: grid }, village);
      }
      return generated;
    };

    Object.defineProperty(wrappedGenerateWorld, MARKER, { value: true });
    Terrain.generateWorld = wrappedGenerateWorld;
    return true;
  }

  Game.StarterVillageRuntimeTerrain = Object.freeze({
    authority: 'simulation',
    version: 'r04-starter-village-runtime-terrain-v1',
    install
  });

  // utils.js parser-loads this bridge before the later static spatial/terrain scripts.
  // `readystatechange=interactive` fires after those scripts have been parsed/executed but
  // before app.js' DOMContentLoaded world rebuild, so the returned-grid wrapper is in place.
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    const onReadyStateChange = () => {
      if (document.readyState === 'loading') return;
      document.removeEventListener('readystatechange', onReadyStateChange);
      install();
    };
    document.addEventListener('readystatechange', onReadyStateChange);
  } else {
    install();
  }
})();
