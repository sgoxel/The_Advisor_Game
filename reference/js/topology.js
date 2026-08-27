/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Generate high-level topology and infrastructure decisions from the seed.

  DEPENDENCIES:
  - rng.js

  PUBLIC API:
  - Game.Topology.generateTopologyParams

  IMPORTANT RULES:
  - This file only decides "what kind of world" should exist.
  - This file should not paint tiles directly.
  - This file should not access DOM.
*/

window.Game = window.Game || {};

(function () {
  const RNG = window.Game.RNG;

  window.Game.Topology = {
    generateTopologyParams(seed, cols, rows) {
      const streamCount = RNG.pickWeighted(seed, "streams", [0, 1, 2], [0.18, 0.52, 0.30]);
      const hasLake = RNG.pickWeighted(seed, "lake", [0, 1], [0.45, 0.55]);
      const hillCount = RNG.pickWeighted(seed, "hills", [0, 1, 2, 3, 4], [0.06, 0.18, 0.32, 0.26, 0.18]);
      const roadCount = RNG.pickWeighted(seed, "roads", [0, 1, 2], [0.10, 0.48, 0.42]);
      const hasForest = RNG.pickWeighted(seed, "forest", [0, 1], [0.15, 0.85]);
      const hasSettlement = RNG.pickWeighted(seed, "settlement", [0, 1], [0.32, 0.68]);

      const hillCoverage = hillCount === 0
        ? 0
        : Math.round((0.07 + RNG.chanceFromSeed(seed, "hillCoverage") * 0.18) * 100);

      const forestCoverage = hasForest
        ? Math.round((0.08 + RNG.chanceFromSeed(seed, "forestCoverage") * 0.22) * 100)
        : 0;

      const dirtCoverage = Math.round((0.30 + RNG.chanceFromSeed(seed, "dirtCoverage") * 0.40) * 100);

      const settlementCoverage = hasSettlement
        ? Math.round((0.03 + RNG.chanceFromSeed(seed, "settlementCoverage") * 0.08) * 100)
        : 0;

      return {
        streamCount,
        hasLake,
        hillCount,
        hillCoverage,
        roadCount,
        hasForest,
        forestCoverage,
        hasSettlement,
        settlementCoverage,
        targetDirtCoverage: dirtCoverage,
        cols,
        rows,

        actualGrassCoverage: 0,
        actualDirtCoverage: 0,
        actualWaterCoverage: 0,
        actualStoneCoverage: 0,
        actualHillCoverage: 0,
        actualForestCoverage: 0,
        actualSettlementCoverage: 0
      };
    }
  };
})();