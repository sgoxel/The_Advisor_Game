/*
  R04 / #301 Admin regression: final production integration bridge for semantic roads.

  The road presentation module can be loaded through the compatibility loader while
  several other R04 modules also wrap Renderer.renderWorld. This bridge deliberately
  attaches only after the page load boundary and after the road API exists, so the
  semantic road draw remains the final road-presentation step in the real app loop.
  It is presentation-only and never mutates road topology or Simulation state.
*/
(function installRoadRuntimeBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-road-runtime-bridge-v2-main-road-composition';
  let installed = false;
  let attempts = 0;

  function worldReady() {
    return Boolean(
      Game.State?.world?.originVillage &&
      Array.isArray(Game.State.world.originVillage.roadTiles) &&
      Game.State.world.originVillage.roadTiles.length > 0
    );
  }

  function drawRoads() {
    const roads = Game.StarterVillageRoads;
    if (!roads || !worldReady()) return false;
    try {
      roads.ensureSemanticAssets?.();
      const ordinaryDrawn = roads.drawPresentation?.() !== false;

      // #339: StarterVillageRoads and MainRoadRenderer intentionally share one
      // transparent road overlay. StarterVillageRoads clears that canvas before
      // drawing ordinary roads, so the final runtime bridge must compose the
      // verified two-tile main-road layer *after* that clear. Otherwise the late
      // bridge erases the broad main-road surface and leaves only the underlying
      // ordinary-road tiles, producing the Admin-observed rail/ladder pattern.
      const mainRoads = Game.MainRoadRenderer;
      if (!mainRoads?.drawPresentation) return ordinaryDrawn;
      mainRoads.ensureAssets?.();
      const mainDrawn = mainRoads.drawPresentation();
      return ordinaryDrawn && mainDrawn !== false;
    } catch (error) {
      console.warn('Road runtime bridge presentation failed.', error);
      return false;
    }
  }

  function attach() {
    const renderer = Game.Renderer;
    const roads = Game.StarterVillageRoads;
    if (installed) return true;
    if (!renderer || typeof renderer.renderWorld !== 'function' || !roads || typeof roads.drawPresentation !== 'function') {
      return false;
    }

    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function roadRuntimeBridgeRenderWorld(force) {
      const result = renderWorld(force);
      drawRoads();
      return result;
    };
    installed = true;
    return true;
  }

  function settle() {
    attempts += 1;
    const attached = attach();
    const drawn = attached && drawRoads();
    if ((!attached || !drawn) && attempts < 600) requestAnimationFrame(settle);
  }

  function start() {
    // Two frames after load lets every compatibility module finish its own renderer
    // wrapping first. This bridge then becomes the final integration layer used by app.js.
    requestAnimationFrame(() => requestAnimationFrame(settle));
  }

  Game.RoadRuntimeBridge = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    get installed() { return installed; },
    drawRoads
  });

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();
