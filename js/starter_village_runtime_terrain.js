/*
  R04 / #244 + #301 runtime bridge: bind the authoritative starter-village base state
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
    if (
      !SpatialWorld ||
      typeof SpatialWorld.bindRuntime !== 'function' ||
      typeof SpatialWorld.generateOriginVillage !== 'function' ||
      typeof SpatialWorld.stampVillageOnRuntimeTerrain !== 'function'
    ) return false;

    // Ensure the canonical spatial wrapper is installed first. bindRuntime() is idempotent.
    SpatialWorld.bindRuntime();
    if (Terrain.generateWorld && Terrain.generateWorld[MARKER]) return true;

    function resolveCanonicalBase(generated, seedInput) {
      const returned = generated && generated.originVillageBase;
      if (
        returned &&
        returned.village &&
        Array.isArray(returned.village.roadTiles) &&
        returned.village.roadTiles.length > 0
      ) {
        return returned;
      }
      return SpatialWorld.generateOriginVillage(seedInput);
    }

    function bindCanonicalWorldState(base) {
      const world = Game.State && Game.State.world;
      if (!world || !base || !base.village) return;

      // app.js owns the runtime world container; this bridge installs only the
      // deterministic Simulation descriptor returned by the canonical generator.
      world.originVillage = base.village;
      world.originBaseState = base;
      world.currentRegion = {
        ...base.region,
        theme: base.theme && base.theme.theme,
        regionSize: SpatialWorld.regionSize
      };
      world.spatialRegion = {
        version: SpatialWorld.version,
        authority: 'simulation',
        regionSize: SpatialWorld.regionSize,
        theme: base.theme
      };
    }

    const generateWorld = Terrain.generateWorld.bind(Terrain);
    const wrappedGenerateWorld = function starterVillageRuntimeTerrainGenerateWorld(seedInput, colsInput, rowsInput) {
      const generated = generateWorld(seedInput, colsInput, rowsInput) || {};
      const grid = generated.grid;
      const base = resolveCanonicalBase(generated, seedInput);
      const village = base && base.village;

      if (Array.isArray(grid) && village) {
        // Stamp the exact grid returned to app.js, not a stale pre-generation terrain array.
        SpatialWorld.stampVillageOnRuntimeTerrain({ terrain: grid }, village);
      }
      bindCanonicalWorldState(base);

      const protagonistOrigin = base && base.protagonistOrigin;
      const playerStart = generated.playerStart || (
        protagonistOrigin
          ? { row: protagonistOrigin.localRow, col: protagonistOrigin.localCol }
          : undefined
      );

      return {
        ...generated,
        playerStart,
        originVillageBase: base,
        spatialRegion: generated.spatialRegion || (base && base.theme)
      };
    };

    Object.defineProperty(wrappedGenerateWorld, MARKER, { value: true });
    Terrain.generateWorld = wrappedGenerateWorld;
    return true;
  }

  Game.StarterVillageRuntimeTerrain = Object.freeze({
    authority: 'simulation',
    version: 'r04-starter-village-runtime-terrain-v2-canonical-origin-binding',
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

  // #253 stays coupled to this authoritative runtime bridge rather than generic Utils.
  // The interior module derives floors/walls/door from the canonical originVillage and
  // materializes only presentation/pathfinding integration on the same runtime world.
  Game.Utils?.loadScriptOnce?.('js/starter_village_interiors.js', 'r04StarterVillageInteriorsModule');
})();
