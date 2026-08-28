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

// R02 modules stay isolated from generic helpers; each preserves Simulation authority.
window.Game.Utils.loadScriptOnce("js/npc_world.js", "r02NpcWorldModule");
window.Game.Utils.loadScriptOnce("js/world_composition.js", "r02WorldCompositionModule");
window.Game.Utils.loadScriptOnce("js/game_time.js", "r02GameTimeModule");
window.Game.Utils.loadScriptOnce("js/campaign_calendar.js", "r02CampaignCalendarModule");
window.Game.Utils.loadScriptOnce("js/region_navigation.js", "r02RegionNavigationModule");
window.Game.Utils.loadScriptOnce("js/npc_life.js", "r02NpcLifeModule");
window.Game.Utils.loadScriptOnce("js/ecology.js", "r02EcologyModule");
window.Game.Utils.loadScriptOnce("js/world_hierarchy.js", "r02WorldHierarchyModule");
window.Game.Utils.loadScriptOnce("js/political_geography.js", "r02PoliticalGeographyModule");
window.Game.Utils.loadScriptOnce("js/settlement_evolution.js", "r02SettlementEvolutionModule");
window.Game.Utils.loadScriptOnce("js/relevance_bounded_compute.js", "r02RelevanceBoundedComputeModule");
window.Game.Utils.loadScriptOnce("js/region_time_progression.js", "r02RegionTimeProgressionModule");