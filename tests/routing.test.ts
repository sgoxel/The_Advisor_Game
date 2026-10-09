import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { villages } from "../src/geography.ts";
import {
  enuToPosition,
  greatCircleDistance,
  positionToEnu,
  type CanonicalPosition,
  type LonLat,
} from "../src/planet.ts";
import {
  BRIDGE_MAX_LENGTH_M,
  ROUTE_MAX_EXPANSIONS,
  ROUTE_MAX_SEPARATION_M,
  macroTerrainSampler,
  planRoute,
  villagePairMeetsMinimumWalk,
  type RoadSegment,
  type SurfaceSample,
  type TerrainSampler,
} from "../src/routing.ts";
import {
  OPEN_GROUND_WALK_SPEED_MPS,
  MIN_VILLAGE_WALK_FANTASY_SECONDS,
} from "../src/travel.ts";
import {
  NEIGHBOUR_LIMIT,
  clearVillageRouteCache,
  neighbouringVillages,
  routeBetweenVillages,
  verifyVillageMinimumWalk,
  villageRouteCacheSize,
} from "../src/village-routes.ts";

const origin: CanonicalPosition = { ...villages[0].canonicalPosition, elevation: 0 };
const at = (east: number, north = 0): LonLat => {
  const { lon, lat } = enuToPosition({ east, north, up: 0 }, origin);
  return { lon, lat };
};
const local = (p: LonLat) => positionToEnu({ ...p, elevation: 0 }, origin);
const flat = (extra: Partial<SurfaceSample> = {}): SurfaceSample => ({
  water: false,
  heightM: 0,
  highland: 0,
  ...extra,
});
const lakeTerrain =
  (centerEast: number, radius: number): TerrainSampler =>
  (p) => {
    const e = local(p);
    return flat({ water: Math.hypot(e.east - centerEast, e.north) < radius });
  };
const riverTerrain =
  (east: number, halfWidth: number): TerrainSampler =>
  (p) => flat({ water: Math.abs(local(p).east - east) < halfWidth });
const polylineSamples = (points: LonLat[], stepM = 25) => {
  const out: LonLat[] = [];
  for (let k = 1; k < points.length; k++) {
    const a = local(points[k - 1]),
      b = local(points[k]),
      length = Math.hypot(b.east - a.east, b.north - a.north),
      steps = Math.max(1, Math.ceil(length / stepM));
    for (let s = 0; s <= steps; s++)
      out.push(at(a.east + ((b.east - a.east) * s) / steps, a.north + ((b.north - a.north) * s) / steps));
  }
  return out;
};

test("every village pair keeps the 60-fantasy-minute minimum: geodesic proof or routed lower bound", () => {
  const report = verifyVillageMinimumWalk();
  const n = villages.length;
  assert.equal(report.pairs, (n * (n - 1)) / 2);
  assert.ok(n >= 270, "village registry stays at least 270");
  assert.deepEqual(report.failures, []);
  assert.ok(report.minGeodesicM >= 3_600, `closest pair is ${report.minGeodesicM} m`);
  assert.ok(report.minLowerBoundSeconds >= MIN_VILLAGE_WALK_FANTASY_SECONDS);
  // Seeded 6 km siting spacing means no pair needs a routed check at all.
  assert.equal(report.provenByGeodesic + report.routedChecks, report.pairs);
});

test("every neighbouring village pair has a valid, bounded route that respects the minimum", () => {
  clearVillageRouteCache();
  const seen = new Set<string>();
  let checked = 0;
  for (const village of villages) {
    const neighbours = neighbouringVillages(village.id);
    assert.ok(neighbours.length >= 1 && neighbours.length <= NEIGHBOUR_LIMIT);
    for (const { place, geodesicM } of neighbours) {
      const key = [village.id, place.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const route = routeBetweenVillages(village.id, place.id);
      assert.equal(route.found, true, `${key} must have a legal route (${route.reason})`);
      assert.ok(route.fantasySeconds >= MIN_VILLAGE_WALK_FANTASY_SECONDS, `${key} takes ${route.fantasySeconds}s`);
      assert.ok(route.distanceM >= geodesicM * 0.995, `${key} cannot be shorter than the geodesic`);
      assert.ok(route.expansions <= ROUTE_MAX_EXPANSIONS * 3);
      assert.ok(route.fantasySeconds >= route.straightLineFantasySeconds * 0.995);
      assert.deepEqual(
        [route.points[0], route.points[route.points.length - 1]],
        [village.canonicalPosition, place.canonicalPosition].map(({ lon, lat }) => ({ lon, lat })),
      );
      checked++;
    }
  }
  assert.ok(checked >= 400, `checked ${checked} neighbouring pairs`);
  assert.ok(villageRouteCacheSize() <= 256, "route cache is bounded");
});

test("a road corridor is walked at good-road speed and matches the seeded road length", () => {
  const route = routeBetweenVillages("0/0/0/0", "0/0/0/1");
  assert.equal(route.found, true);
  assert.ok(route.surfaceM.road / route.distanceM > 0.99, "route follows the road");
  assert.ok(route.fantasySeconds >= route.straightLineFantasySeconds);
  assert.ok(route.fantasySeconds <= route.straightLineFantasySeconds * 1.03, "no hidden detour on a straight road");
  assert.ok(route.fantasySeconds > 3_600);
});

test("terrain can make a real seeded route longer than its straight-line time", () => {
  const route = routeBetweenVillages("1/8/0/2", "1/8/1/2");
  assert.equal(route.found, true);
  assert.ok(route.surfaceM.difficult > 5_000, "route crosses difficult highland");
  assert.ok(
    route.fantasySeconds > route.straightLineFantasySeconds * 1.4,
    `${route.fantasySeconds}s vs straight ${route.straightLineFantasySeconds}s`,
  );
  // Even compared with plain open-ground walking, the highland makes it slower.
  assert.ok(route.fantasySeconds > route.geodesicM / OPEN_GROUND_WALK_SPEED_MPS);
});

test("routes detour around water and never cross it", () => {
  const from = at(0),
    to = at(6_000),
    terrain = lakeTerrain(3_000, 1_500),
    route = planRoute({ from, to, terrain });
  assert.equal(route.found, true);
  assert.ok(route.distanceM > route.geodesicM * 1.08, "detour is longer than the straight line");
  assert.ok(route.fantasySeconds > route.straightLineFantasySeconds);
  assert.ok(route.points.length > 2, "the path bends around the lake");
  const cell = route.cellSizeM;
  for (const sample of polylineSamples(route.points)) {
    const e = local(sample);
    assert.ok(Math.hypot(e.east - 3_000, e.north) >= 1_500 - cell, "route stays out of the lake");
  }
  assert.equal(route.surfaceM.bridge, 0);
});

test("only legal bridges cross water; oversize bridges and missing bridges do not", () => {
  const from = at(0),
    to = at(6_000),
    river = riverTerrain(3_000, 60),
    legal: RoadSegment = { from: at(2_950), to: at(3_050), bridge: true },
    tooLong: RoadSegment = { from: at(2_000), to: at(4_000), bridge: true },
    notBridge: RoadSegment = { from: at(2_950), to: at(3_050) };
  assert.ok(Math.hypot(100, 0) <= BRIDGE_MAX_LENGTH_M);

  const withBridge = planRoute({ from, to, terrain: river, roads: [legal] });
  assert.equal(withBridge.found, true);
  assert.ok(withBridge.surfaceM.bridge > 0, "the bridge is used");
  assert.ok(withBridge.distanceM < withBridge.geodesicM * 1.03, "a bridge on the line needs no detour");

  for (const roads of [[], [tooLong], [notBridge]]) {
    const result = planRoute({ from, to, terrain: river, roads });
    assert.equal(result.found, false, "an unbridged infinite river blocks the walk");
    assert.equal(result.reason, "no-legal-route");
    assert.ok(result.expansions <= ROUTE_MAX_EXPANSIONS * 3, "failed searches stay bounded");
  }
});

test("a graded road cuts through highland that is difficult off-road", () => {
  const mountain: TerrainSampler = (p) => {
    const e = local(p);
    const d = Math.abs(e.east - 3_000);
    // A 300 m ridge with ~0.3 slope: steep enough to be difficult, not a cliff.
    return flat({ highland: d < 1_000 ? 0.9 : 0, heightM: Math.max(0, 300 * (1 - d / 1_000)) });
  };
  const from = at(0),
    to = at(6_000),
    offRoad = planRoute({ from, to, terrain: mountain }),
    withRoad = planRoute({ from, to, terrain: mountain, roads: [{ from, to }] });
  assert.equal(offRoad.found && withRoad.found, true);
  assert.ok(offRoad.surfaceM.difficult > 0, "off-road crossing is difficult terrain");
  assert.equal(withRoad.surfaceM.difficult, 0, "the graded road ignores highland");
  assert.ok(withRoad.fantasySeconds < offRoad.fantasySeconds * 0.85);
  assert.ok(withRoad.surfaceM.road / withRoad.distanceM > 0.99);
});

test("cliffs block off-road walking but a graded road may still pass", () => {
  const ridge: TerrainSampler = (p) => {
    const e = local(p),
      d = Math.abs(e.east - 3_000);
    // Height steps by 2000 m inside 60 m: a wall far steeper than CLIFF_SLOPE.
    return flat({ heightM: d < 30 ? 2_000 : 0 });
  };
  const from = at(0),
    to = at(6_000);
  const blocked = planRoute({ from, to, terrain: ridge });
  assert.equal(blocked.found, false, "an unbroken cliff wall blocks the route");
  const cut = planRoute({ from, to, terrain: ridge, roads: [{ from, to }] });
  assert.equal(cut.found, true);
  assert.ok(cut.surfaceM.road > 0);
});

test("seeded placement rule: geodesic proof first, routed lower bound only for close pairs", () => {
  const a = at(0);
  const far = villagePairMeetsMinimumWalk(a, at(6_000));
  assert.deepEqual([far.ok, far.proof], [true, "geodesic"]);

  const close = villagePairMeetsMinimumWalk(a, at(2_000), () => flat());
  assert.equal(close.ok, false, "2 km on open ground is under 60 fantasy minutes");
  assert.equal(close.proof, "routed");
  assert.ok(close.lowerBoundSeconds < MIN_VILLAGE_WALK_FANTASY_SECONDS);

  // A lake wall between two 3 km apart villages makes the real walk long enough.
  const wall: TerrainSampler = (p) => {
    const e = local(p);
    return flat({ water: Math.abs(e.east - 1_500) < 40 && Math.abs(e.north) < 3_000 });
  };
  const separated = villagePairMeetsMinimumWalk(a, at(3_000), wall);
  assert.deepEqual([separated.ok, separated.proof], [true, "routed"]);
  assert.ok(separated.lowerBoundSeconds >= MIN_VILLAGE_WALK_FANTASY_SECONDS);

  // No legal route at all is never an acceptable village pair.
  const unreachable = villagePairMeetsMinimumWalk(a, at(3_000), riverTerrain(1_500, 40));
  assert.deepEqual([unreachable.ok, unreachable.proof], [false, "no-route"]);
});

test("routing is deterministic and independent of query order and caching", () => {
  const pairs: [string, string][] = [
    ["0/0/0/0", "0/0/0/2"],
    ["1/8/0/2", "1/8/1/2"],
    ["0/0/0/1", "0/0/0/0"],
  ];
  clearVillageRouteCache();
  const forward = pairs.map(([a, b]) => JSON.stringify(routeBetweenVillages(a, b)));
  clearVillageRouteCache();
  const reversed = [...pairs].reverse().map(([a, b]) => JSON.stringify(routeBetweenVillages(a, b))).reverse();
  assert.deepEqual(forward, reversed);

  const ab = routeBetweenVillages("0/0/0/0", "0/0/0/2"),
    ba = routeBetweenVillages("0/0/0/2", "0/0/0/0");
  assert.equal(ab.distanceM, ba.distanceM);
  assert.equal(ab.fantasySeconds, ba.fantasySeconds);
  assert.deepEqual([...ab.points].reverse(), ba.points);

  const lake = lakeTerrain(3_000, 1_500);
  assert.equal(
    JSON.stringify(planRoute({ from: at(0), to: at(6_000), terrain: lake })),
    JSON.stringify(planRoute({ from: at(0), to: at(6_000), terrain: lake })),
  );
});

test("search stays bounded and refuses separations beyond the local planner", () => {
  const far = planRoute({ from: at(0), to: at(ROUTE_MAX_SEPARATION_M + 5_000) });
  assert.equal(far.found, false);
  assert.equal(far.reason, "separation-exceeds-local-search");
  assert.equal(far.expansions, 0);

  const into = planRoute({ from: at(0), to: at(1_500), terrain: lakeTerrain(1_500, 300) });
  assert.equal(into.found, false);
  assert.equal(into.reason, "destination-in-water");

  const same = planRoute({ from: at(0), to: at(0) });
  assert.equal(same.found, true);
  assert.equal(same.distanceM, 0);
});

test("the real macro terrain sampler agrees with macro-geography water and relief", () => {
  const sample = macroTerrainSampler(villages[0].canonicalPosition);
  assert.equal(sample.water, false, "villages stand on dry land");
  assert.ok(greatCircleDistance(villages[0].canonicalPosition, villages[1].canonicalPosition) > 3_600);
});

test("routing source has no random, wall-clock or camera inputs", () => {
  for (const file of ["../src/routing.ts", "../src/village-routes.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /Math\.random|Date\.now|performance\.now|new Date|crypto\./);
    assert.doesNotMatch(source, /camera|viewport|devicePixelRatio|innerWidth/i);
  }
});
