/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Small generic helper utilities.

  DEPENDENCIES:
  - none

  PUBLIC API:
  - Game.Utils

  IMPORTANT RULES:
  - Keep this file generic.
  - Do not reference world internals unless absolutely necessary.
*/

window.Game = window.Game || {};

window.Game.Utils = {
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  percent(part, total) {
    if (total === 0) return 0;
    return Math.round((part / total) * 100);
  },

  lightenHexColor(hex, amount) {
    const value = hex.replace("#", "");
    const num = parseInt(value, 16);

    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 255) + amount);
    const b = Math.min(255, num & 255);

    return `rgb(${r}, ${g}, ${b})`;
  },

  loadScriptOnce(src, id) {
    if (id && document.getElementById(id)) return;
    const script = document.createElement("script");
    if (id) script.id = id;
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }
};

// `js/spatial_world.js` is loaded statically immediately after `js/rng.js` in index.html.
// That explicit order guarantees its RNG/WorldCoordinates/RegionTerrain dependencies exist
// before the Admin #233 100x100 compatibility contract installs.

// #244 requires the deterministic starter-village footprint stamp to affect the exact
// generated grid that app.js later installs as State.world.terrain. Parser-load this small
// Simulation bridge now; it waits until document.readyState becomes interactive, after the
// later static spatial/terrain scripts exist but before app.js' DOMContentLoaded rebuild.
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.write('<script src="js/starter_village_runtime_terrain.js"><\/script>');
} else {
  window.Game.Utils.loadScriptOnce("js/starter_village_runtime_terrain.js", "r04StarterVillageRuntimeTerrainModule");
}

// #301: the semantic Road presentation and its final render-chain bridge are startup-critical.
// Loading them with the compatibility queue made their execution race the statically parsed
// Renderer/app scripts in the real public startup path. Parser-load them deterministically;
// both modules already defer actual Renderer/world work until DOM/load readiness and remain
// presentation-only. The fallback branch preserves non-parser embedding/test compatibility.
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.write('<script id="r04StarterVillageRoadsModule" src="js/starter_village_roads.js"><\/script>');
  document.write('<script id="r04RoadRuntimeBridgeModule" src="js/road_runtime_bridge.js"><\/script>');
} else {
  window.Game.Utils.loadScriptOnce("js/starter_village_roads.js", "r04StarterVillageRoadsModule");
  window.Game.Utils.loadScriptOnce("js/road_runtime_bridge.js", "r04RoadRuntimeBridgeModule");
}

// R02/R04 modules stay isolated from generic helpers; each preserves Simulation authority.
window.Game.Utils.loadScriptOnce("js/npc_world.js", "r02NpcWorldModule");
window.Game.Utils.loadScriptOnce("js/world_object_renderer.js", "r04WorldObjectRendererModule");
window.Game.Utils.loadScriptOnce("js/world_composition.js", "r02WorldCompositionModule");
window.Game.Utils.loadScriptOnce("js/game_time.js", "r02GameTimeModule");
window.Game.Utils.loadScriptOnce("js/campaign_calendar.js", "r02CampaignCalendarModule");
window.Game.Utils.loadScriptOnce("js/region_navigation.js", "r02RegionNavigationModule");
window.Game.Utils.loadScriptOnce("js/character_identity.js", "r04CharacterIdentityModule");
window.Game.Utils.loadScriptOnce("js/character_age.js", "r04CharacterAgeModule");
window.Game.Utils.loadScriptOnce("js/character_location_context.js", "r04CharacterLocationContextModule");
window.Game.Utils.loadScriptOnce("js/character_emotion.js", "r04CharacterEmotionModule");
window.Game.Utils.loadScriptOnce("js/character_driver_context.js", "r04CharacterDriverContextModule");
window.Game.Utils.loadScriptOnce("js/local_bot_character_context_bridge.js", "r04LocalBotCharacterContextBridgeModule");
window.Game.Utils.loadScriptOnce("js/npc_life.js", "r02NpcLifeModule");
window.Game.Utils.loadScriptOnce("js/npc_residency.js", "r04NpcResidencyModule");
window.Game.Utils.loadScriptOnce("js/npc_workplaces.js", "r04NpcWorkplacesModule");
window.Game.Utils.loadScriptOnce("js/ecology.js", "r02EcologyModule");
window.Game.Utils.loadScriptOnce("js/world_hierarchy.js", "r02WorldHierarchyModule");
window.Game.Utils.loadScriptOnce("js/political_geography.js", "r02PoliticalGeographyModule");
window.Game.Utils.loadScriptOnce("js/settlement_evolution.js", "r02SettlementEvolutionModule");
window.Game.Utils.loadScriptOnce("js/relevance_bounded_compute.js", "r02RelevanceBoundedComputeModule");
window.Game.Utils.loadScriptOnce("js/region_time_progression.js", "r02RegionTimeProgressionModule");
window.Game.Utils.loadScriptOnce("js/starter_village_exteriors.js", "r04StarterVillageExteriorsModule");

// Loaded after NPC life/presentation modules so it can add deterministic tile occupancy,
// route-conflict resolution, adjacent dialogue and development bubbles without duplicating
// the existing character-world-icon implementation.
window.Game.Utils.loadScriptOnce("js/npc_spatial_runtime.js", "admin100NpcSpatialRuntimeModule");

// Final Simulation-integration bridge for NPC positions. It attaches after the compatibility
// wrappers and restores NPCSpatial authority if an older renderer wrapper drifts coordinates
// inside the same authoritative game minute.
window.Game.Utils.loadScriptOnce("js/npc_runtime_bridge.js", "r04NpcRuntimeBridgeModule");