import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, villages } from "../src/geography.ts";
import { CANONICAL_PLANET_RADIUS, greatCircleDistance, normalizeLongitude, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { settlementExteriorFor, settlementHomeFor } from "../src/settlement-exterior.ts";
import { featuresFor, finalSurfaceAt, finalSurfaceEvidenceAnchors, resolvedSettlementHomeDoorFor, tileForPosition } from "../src/world.ts";
import {
  LazySimulation,
  RESIDENTIAL_CAPACITY,
  gateCountFor,
  guardCoverageAt,
  guardsPerGateFor,
  populationOf,
  residentAt,
  residentFoundationAt,
  legalPosition,
  continuousWalkableOffsetSegment,
  residentWalkableSurface,
  legalEnclosureSegment,
  timedWalkOnPath,
  walkWindowOnPath,
  lastReachableRoutineStop,
  residentOccupiesBuilding,
  readableResidentSite,
  readableResidentRoute,
  residentInspectorSelection,
  nearestNode,
  nearestLegalStreetNode,
  legalOpenGroundDetour,
  residentStreetPathKey,
  residentViewQuery,
} from "../src/simulation.ts";

import { localDayIndex, localSecondOfDay, localWeekday, tickAtLocalTime, timeZoneOffsetHours } from "../src/clock.ts";
import { daylightAt } from "../src/daylight.ts";
import { dailyPlan, traitsFor } from "../src/routines.ts";

const HOUR = 3600;
/** Tick at which villages[0]'s local clock shows this time on calendar day `day` (routines follow local time). */
const LON = villages[0].canonicalPosition.lon;
const at = (hour: number, day = 1) => tickAtLocalTime(day, hour * HOUR, LON);
/** First calendar day after the origin that is a local workday (weekday 0-5). */
const WORKDAY = [1, 2, 3, 4, 5, 6, 7].find((day) => localWeekday(tickAtLocalTime(day, 12 * HOUR, LON), LON) !== 6)!;

test("resident inspector can resolve facts independently of optional actor detail", () => {
  assert.deepEqual(residentViewQuery(48, true, false, false, false), { actors: false, inspect: true },
    "open village-scale information must not wait for mesh refinement");
  assert.deepEqual(residentViewQuery(48, false, false, false, false), { actors: false, inspect: false },
    "hidden inspector performs no extra resident search");
  assert.deepEqual(residentViewQuery(12, false, true, true, true), { actors: true, inspect: true },
    "close-up street actors retain their usual bounded query");
  assert.deepEqual(residentViewQuery(12, true, true, true, false), { actors: false, inspect: true },
    "not-yet-ready optional billboards must not hide authoritative resident facts");
  assert.deepEqual(residentViewQuery(100, true, true, true, true), { actors: false, inspect: false },
    "remote city and realm views do not issue expensive resident searches");
});

test("resident walking path cache preserves exact doorway offsets, direction and gate policy", () => {
  const home = { eastM: 12.011, northM: -2.02 }, otherDoor = { eastM: 12.049, northM: -2.02 },
    workplace = { eastM: 180.004, northM: 25.002 }, placeCode = villages[0].code;
  const first = residentStreetPathKey(placeCode, home, workplace, true);
  assert.equal(first, residentStreetPathKey(placeCode, home, workplace, true), "same SEED trip has one stable key");
  assert.notEqual(first, residentStreetPathKey(placeCode, otherDoor, workplace, true),
    "separate doors less than a tenth of a metre apart must not inherit another door's path");
  assert.notEqual(first, residentStreetPathKey(placeCode, workplace, home, true), "reversed routes retain independent endpoints");
  assert.notEqual(first, residentStreetPathKey(placeCode, home, workplace, false), "a gate detour cannot satisfy a no-detour lookup");
});

test("resident streets attach to the true nearest vertex across grid bucket boundaries", () => {
  const cell = 12, nodes = [
    { eastM: 0, northM: 0 }, // same bucket, but farther away
    { eastM: 23.9, northM: 23.9 }, // adjacent bucket, still farther
    { eastM: 24.01, northM: 11.9 }, // two buckets over and truly closest
  ];
  const grid = new Map<string, number[]>();
  nodes.forEach((point, id) => {
    const key = `${Math.floor(point.eastM / cell)}/${Math.floor(point.northM / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
  });
  const graph = { nodes, grid, cell }, offset = { eastM: 11.9, northM: 11.9 };
  assert.equal(nearestNode(graph, offset), 2,
    "first occupied grid cell cannot override a closer street vertex two buckets away");
  assert.equal(nearestNode(graph, nodes[0]), 0, "exact vertex lookup remains stable");
  assert.equal(nearestNode({ nodes: [], grid: new Map(), cell }, offset), -1,
    "empty streets cannot invent a connected vertex");
});

test("resident street connectors choose a nearby legal vertex, never an unverified chord", () => {
  const cell = 12, nodes = [
    { eastM: 2, northM: 0 }, // physically nearest, but blocked by a wall
    { eastM: 8, northM: 0 }, // accessible alternative on a neighboring street
    { eastM: 50, northM: 0 }, // outside bounded local fallback
  ], grid = new Map<string, number[]>();
  nodes.forEach((node, id) => {
    const key = `${Math.floor(node.eastM / cell)}/${Math.floor(node.northM / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
  });
  const graph = { nodes, grid, cell }, from = { eastM: 0, northM: 0 };
  assert.equal(nearestNode(graph, from), 0, "the closest street can be disconnected");
  assert.equal(nearestLegalStreetNode(graph, from, (_, node) => node === nodes[1]), 1,
    "use the nearby surface-checked legal connector instead");
  assert.equal(nearestLegalStreetNode(graph, from, (_, node) => node === nodes[0]), 0,
    "retain the nearest street when it is already legal");
  assert.equal(nearestLegalStreetNode(graph, from, () => false), -1,
    "no legal connector means blocked, not a straight-line shortcut");
  assert.equal(nearestLegalStreetNode(graph, from, (_, node) => node === nodes[2]), -1,
    "do not expand an unbounded search to a remote street");
  assert.equal(nearestLegalStreetNode({ nodes: [], grid: new Map(), cell }, from, () => true), -1,
    "no street network cannot create a connection");
});

test("continuous walking segments reject interior water or blocked cuts without endpoint-only approval", () => {
  const start = { eastM: 0, northM: 0 }, goal = { eastM: 12, northM: 0 };
  assert.equal(continuousWalkableOffsetSegment(start, goal, point => point.eastM < 5 || point.eastM > 7), false,
    "walkable endpoints cannot legalize an impassable middle crossing");
  assert.equal(continuousWalkableOffsetSegment(start, goal, point => point.northM === 0), true,
    "an unobstructed straight local segment remains eligible");
  assert.equal(continuousWalkableOffsetSegment(goal, start, point => point.eastM < 5 || point.eastM > 7), false,
    "crossing legality cannot depend on direction");
});

test("S006 residents traverse only authoritative bridge decks and stand at deck elevation", () => {
  const bridge = finalSurfaceEvidenceAnchors().bridge,
    surface = finalSurfaceAt(bridge.x, bridge.z);
  assert.equal(surface.traversal, "bridge", "retain the known physical canonical crossing");
  assert.notEqual(surface.water.kind, "none", "deck overlays natural water, not rewritten land");
  assert.ok(surface.deckHeight !== null && residentWalkableSurface(surface),
    "a physically valid bridge is walkable despite the submerged ground beneath it");
  assert.equal(residentWalkableSurface({ ...surface, deckHeight: null, walkable: true }), false,
    "an open water gap without a deck cannot become a walkable shortcut");
  assert.equal(residentWalkableSurface({
    ...surface, water: { ...surface.water, kind: "none" }, deckHeight: null, groundHeight: 0, walkable: true,
  }), false, "near-sea-level non-deck ground keeps its existing clearance rule");
  const coords = sourceToLonLat(bridge.x, bridge.z),
    place = { ...villages[0], code: `${villages[0].code}/BRIDGE-TEST`,
      canonicalPosition: { ...villages[0].canonicalPosition, lon: coords.lon, lat: coords.lat } },
    resident = legalPosition(place, 0, 0);
  assert.ok(resident.grounded, "a resident can stand on the real bridge top");
  assert.equal(resident.position.elevation, finalSurfaceAt(resident.x, resident.z).surfaceHeight,
    "Simulation elevation must follow the composed bridge deck, not submerged terrain");
});

test("outdoor journeys can legally detour around small barriers without crossing water or walls", () => {
  const from = { eastM: 0, northM: 0 }, to = { eastM: 100, northM: 0 },
    dry = (point: { eastM: number; northM: number }) =>
      point.eastM < 40 || point.eastM > 60 || Math.abs(point.northM) > 20,
    legal = (a: typeof from, b: typeof from) =>
      continuousWalkableOffsetSegment(a, b, dry);
  assert.equal(legal(from, to), false, "the direct route is genuinely blocked");
  const path = legalOpenGroundDetour(from, to, legal);
  assert.ok(path && path.length === 3, "a real dry two-leg route around the obstacle exists");
  assert.ok(path.slice(1).every((point, i) => legal(path[i], point)),
    "every detour segment is independently lawful, not just its endpoints");
  const returnPath = legalOpenGroundDetour(to, from, legal);
  assert.ok(returnPath && returnPath.slice(1).every((point, i) => legal(returnPath[i], point)),
    "the same physical obstruction admits an independently legal return path");
  const longBank = (point: typeof from) =>
    point.eastM < 20 || point.eastM > 80 || Math.abs(point.northM) > 200,
    longLegal = (a: typeof from, b: typeof from) =>
      continuousWalkableOffsetSegment(a, b, longBank),
    aroundBank = legalOpenGroundDetour(from, to, longLegal);
  assert.equal(aroundBank?.length, 4,
    "a longer real obstacle needs an approach, parallel dry corridor and return approach");
  assert.ok(aroundBank?.slice(1).every((point, i) => longLegal(aroundBank[i], point)),
    "every segment of the longer diversion stays entirely off the impassable bank");
  const river = (point: typeof from) => point.eastM < 40 || point.eastM > 60;
  assert.equal(legalOpenGroundDetour(from, to,
    (a, b) => continuousWalkableOffsetSegment(a, b, river)), null,
    "a continuous impassable river remains blocked even if endpoints are dry");
  assert.equal(legalOpenGroundDetour(from, to, () => false), null,
    "a missing gate or blocked wall cannot be bypassed by doglegs");
});

test("settlement walls admit resident crossings only through SEED gate apertures", () => {
  const p = (eastM: number, northM: number) => ({ eastM, northM }),
    border = [p(-20, -20), p(20, -20), p(20, 20), p(-20, 20)],
    gates = [p(20, 0)];
  assert.equal(legalEnclosureSegment(p(0, 0), p(40, 0), border, gates), true,
    "a connected crossing through the real east gate is allowed");
  assert.equal(legalEnclosureSegment(p(40, 0), p(0, 0), border, gates), true,
    "a lawful return through the same gate is symmetric");
  assert.equal(legalEnclosureSegment(p(0, 12), p(40, 12), border, gates), false,
    "dry endpoints cannot tunnel through the adjacent wall");
  assert.equal(legalEnclosureSegment(p(40, 12), p(0, 12), border, gates), false,
    "reversing an illegal trip cannot make a wall traversable");
  assert.equal(legalEnclosureSegment(p(0, 0), p(-40, 0), border, gates), false,
    "there is no west-side gate");
  assert.equal(legalEnclosureSegment(p(0, 0), p(40, 0), border, []), false,
    "a missing or blocked gate is not a traversable crossing");
  assert.equal(legalEnclosureSegment(p(20, -18), p(20, 18), border, gates), false,
    "walking along the solid wall cannot be mistaken for a gate route");
  assert.equal(legalEnclosureSegment(p(20, -4), p(20, 4), border, gates), true,
    "the actual nine-metre rendered gate aperture remains available");
  assert.equal(legalEnclosureSegment(p(-10, -10), p(10, 10), border, gates), true,
    "valid interior movement does not require exiting through a gate");
});

test("invalid resident terrain never silently moves the requested point toward town", () => {
  const place = villages[0], lat = place.canonicalPosition.lat;
  let ungrounded = 0;
  for (const radius of [0, 15_000, 40_000, 120_000, 250_000])
    for (let n = 0; n < 16; n++) {
      const eastM = radius * Math.cos(n * Math.PI / 8),
        northM = radius * Math.sin(n * Math.PI / 8),
        actual = legalPosition(place, eastM, northM),
        expected = {
          lon: normalizeLongitude(place.canonicalPosition.lon + eastM /
            (CANONICAL_PLANET_RADIUS * Math.max(1e-9, Math.abs(Math.cos(lat))))),
          lat: lat + northM / CANONICAL_PLANET_RADIUS,
        },
        surface = finalSurfaceAt(actual.x, actual.z);
      assert.ok(greatCircleDistance(actual.position, expected) < .05,
        "position must not be shrunk to an unrelated, apparently legal location");
      assert.equal(actual.grounded, surface.walkable && actual.position.elevation > .1);
      if (!actual.grounded) ungrounded++;
    }
  assert.ok(ungrounded > 0, "fixture must include real non-walkable or submerged surface");
});

test("unresolved houses keep resident identity without inventing lawful travel", () => {
  for (const place of [villages[0], cities[0]])
    for (let index = 0; index < 16; index++) {
      if (resolvedSettlementHomeDoorFor(place, index)) continue;
      const resident = residentAt(place, index, tickAtLocalTime(WORKDAY, 9 * HOUR, place.canonicalPosition.lon));
      assert.equal(resident.code, residentFoundationAt(place, index).code);
      assert.equal(resident.grounded, false);
      assert.equal(resident.indoors, false);
      assert.equal(resident.activity, "rest");
      assert.ok(resident.task.includes("no legally resolved doorway"));
      assert.ok(resident.route.startsWith("BLOCKED:"));
      assert.equal(resident.travelProgress, undefined);
    }
});

test("time-bounded legal paths never jump to an unfinished endpoint", () => {
  const path = [
    { eastM: 0, northM: 0 }, { eastM: 30, northM: 0 },
    { eastM: 30, northM: 40 },
  ];
  const start = timedWalkOnPath(path, 0), midway = timedWalkOnPath(path, 35),
    arrived = timedWalkOnPath(path, 70), replay = timedWalkOnPath(path, 35);
  assert.deepEqual(start.offset, path[0]);
  assert.deepEqual(midway.offset, { eastM: 30, northM: 5 });
  assert.deepEqual(arrived.offset, path[2]);
  assert.equal(midway.progress, .5);
  assert.deepEqual(midway, replay);
});

test("walk windows keep the corners of the legal street path", () => {
  const path = [{ eastM: 0, northM: 0 }, { eastM: 100, northM: 0 }, { eastM: 100, northM: 100 }];
  const near = (a: { eastM: number; northM: number }, b: { eastM: number; northM: number }) => {
    assert.ok(Math.abs(a.eastM - b.eastM) < 1e-9 && Math.abs(a.northM - b.northM) < 1e-9, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  // d0 = 90 m and d1 = 110 m: the window straddles the corner at (100, 0).
  const straddle = walkWindowOnPath(path, 90, 20);
  assert.ok(straddle.includes(path[1]));
  for (const p of straddle)
    assert.ok((p.northM === 0 && p.eastM >= 0 && p.eastM <= 100) || (p.eastM === 100 && p.northM >= 0 && p.northM <= 100), JSON.stringify(p));
  near(straddle[0], timedWalkOnPath(path, 90).offset);
  near(straddle[straddle.length - 1], timedWalkOnPath(path, 110).offset);
  // Arrived: both ends are the final vertex.
  const arrived = walkWindowOnPath(path, 300, 24);
  assert.equal(arrived.length, 2);
  near(arrived[0], path[2]);
  near(arrived[1], path[2]);
  // Entirely inside the first segment: just the two endpoints.
  const inside = walkWindowOnPath(path, 10, 20);
  assert.equal(inside.length, 2);
  near(inside[0], { eastM: 10, northM: 0 });
  near(inside[1], { eastM: 30, northM: 0 });
});

test("sampled daily schedule transitions do not teleport between sites", () => {
  for (const [place, indices] of [[villages[0], [0, 3, 6, 7]], [cities[0], [3, 6]]] as const)
    for (const index of indices) {
      const resident = residentFoundationAt(place, index), lon = place.canonicalPosition.lon,
        noon = tickAtLocalTime(WORKDAY, 12 * HOUR, lon),
        weekday = localWeekday(noon, lon), day = localDayIndex(noon, lon),
        plan = dailyPlan({ code: resident.code, role: resident.role, ageGroup: resident.ageGroup, guardShift: resident.guardShift }, resident.traits, day, weekday);
      for (let i = 1; i < plan.length; i++) {
        if (plan[i].anchor === plan[i - 1].anchor) continue;
        const atStep = tickAtLocalTime(WORKDAY, plan[i].start, lon),
          before = residentAt(place, index, atStep - 1),
          after = residentAt(place, index, atStep + 1),
          travelledM = greatCircleDistance(before.position, after.position);
        assert.ok(travelledM <= 3, `${resident.code} jumped ${travelledM.toFixed(1)}m at ${plan[i].start}`);
      }
    }
});

test("a blocked leg never becomes the origin of a later resident activity", () => {
  const home = "home", work = "work", market = "market";
  const allowed = (from: string, to: string) =>
    from === to || (from === home && to === market);
  assert.equal(lastReachableRoutineStop([home, work], allowed), home,
    "an impassable home-to-work leg leaves the resident at home");
  assert.equal(lastReachableRoutineStop([home, work, market], allowed), market,
    "a later legal errand starts from the actual reached home, not unreachable work");
  assert.equal(lastReachableRoutineStop([home, work, market, work], allowed), market,
    "a later blocked return cannot teleport from an unvisited worksite");
  assert.equal(lastReachableRoutineStop([home, work, home], allowed), home,
    "homecoming after a blocked commute does not invent worksite occupancy");
});

test("building occupancy requires the exact canonical site, not nearby indoor status", () => {
  const foundation = residentFoundationAt(villages[0], 12), home = foundation.homeBuilding,
    residence = { code: `seed/version/F/${villages[0].id}/${home}`, kind: "residence" },
    adjacent = { code: `seed/version/F/${villages[0].id}/${villages[0].code}/RESIDENCE/13`, kind: "residence" },
    resident = { ...foundation, indoors: true, route: foundation.homeEntrance };
  assert.equal(residentOccupiesBuilding(resident, residence), true);
  assert.equal(residentOccupiesBuilding(resident, adjacent), false, "a neighbouring house does not own this resident");
  assert.equal(residentOccupiesBuilding({ ...resident, indoors: false }, residence), false);
  assert.equal(residentOccupiesBuilding({ ...resident, route: "BLOCKED: home → work" }, residence), false);
  assert.equal(residentOccupiesBuilding({ ...resident, route: `${villages[0].code}/INN` }, residence), false);
  assert.equal(residentOccupiesBuilding({ ...resident, route: `${home}/WORKSHOP` }, residence), true,
    "a home workshop remains inside its owned home");
  const service = { code: `seed/version/F/${villages[0].id}/${villages[0].code}/PLOT/7`, kind: "service", service: "inn" };
  assert.equal(residentOccupiesBuilding({ ...resident, route: `${villages[0].code}/INN` }, service), true);
  assert.equal(residentOccupiesBuilding({ ...resident, route: `${villages[0].code}/MARKET` }, service), false);
  assert.equal(residentOccupiesBuilding({ ...resident, route: `${cities[0].code}/INN` }, service), false,
    "residents from another settlement do not occupy this inn");
});

test("house inspection resolves the rendered legal doorway, never an unverified first candidate", () => {
  let matched = 0;
  for (const [place, indexes] of [[villages[0], [0, 3, 12]], [cities[0], [0, 6]]] as const)
    for (const index of indexes) {
      const foundation = residentFoundationAt(place, index),
        resident = residentAt(place, index, tickAtLocalTime(WORKDAY, 3 * HOUR, place.canonicalPosition.lon)),
        door = resolvedSettlementHomeDoorFor(place, index);
      assert.equal(resident.code, foundation.code, "lazy door resolution never changes SEED identity");
      assert.deepEqual(resolvedSettlementHomeDoorFor(place, index), door,
        "house focus must be deterministic without camera or presentation state");
      if (!door) continue; // A rejected house must not fabricate an entrance.
      // The simulated home anchor must be the exact rendered doorway, not the
      // first candidate or the house centre; verify the canonical metre mapping.
      const target = sourceToLonLat(door.x, door.z),
        latitude = place.canonicalPosition.lat,
        position = {
          lon: normalizeLongitude(place.canonicalPosition.lon + resident.homeOffset.eastM /
            (CANONICAL_PLANET_RADIUS * Math.max(1e-9, Math.abs(Math.cos(latitude))))),
          lat: latitude + resident.homeOffset.northM / CANONICAL_PLANET_RADIUS,
        };
      assert.ok(greatCircleDistance(target, position) < .05,
        `${resident.code}: simulation home does not match the rendered front-wall door`);
      assert.ok(finalSurfaceAt(door.x, door.z).walkable, "resolved doorway must lie on legal terrain");
      const feature = featuresFor(tileForPosition(door.x, door.z, 12))
        .find(entry => entry.kind === "residence" && entry.ownerId === resident.code);
      if (feature) {
        assert.equal(feature.entranceX, door.x, "inspector focus must match the rendered door X");
        assert.equal(feature.entranceZ, door.z, "inspector focus must match the rendered door Z");
        matched++;
      }
    }
  assert.ok(matched > 0, "compare against at least one actually rendered residence");
});

test("resident inspector preserves the exact selected SEED identity across camera and LOD churn", () => {
  const visible = Array.from({ length: 20 }, (_, index) => ({ code: `SEED/RESIDENT/${index}`, index }));
  const selected = visible[18], absent = { code: "SEED/RESIDENT/77", index: 77 };
  let resolutions = 0;
  const resolve = (code: string) => {
    resolutions++;
    return code === absent.code ? absent : undefined;
  };
  const first = residentInspectorSelection(visible, "", resolve);
  assert.equal(first.selectedCode, visible[0].code, "first selection is deterministic");
  assert.equal(first.records.length, 16, "ordinary inspector work stays bounded");
  assert.equal(resolutions, 0, "no extra SEED resolution on initial selection");

  const beyondLimit = residentInspectorSelection(visible, selected.code, resolve);
  assert.equal(beyondLimit.selectedCode, selected.code, "the 17th+ visible resident cannot be replaced by the first 16");
  assert.equal(beyondLimit.records[0], selected);
  assert.equal(beyondLimit.outsideView, false);
  assert.equal(resolutions, 0, "already evaluated visible residents need no second resolution");

  const panned = residentInspectorSelection([], absent.code, resolve);
  assert.equal(panned.selectedCode, absent.code, "panning/LOD must not silently select another person");
  assert.equal(panned.records[0], absent);
  assert.equal(panned.outsideView, true, "resolved SEED resident stays inspectable off-screen");
  assert.equal(resolutions, 1, "only the selected identity is lazily resolved");
  assert.equal(panned.unavailable, false);

  const missing = residentInspectorSelection(visible, "SEED/RESIDENT/MISSING", resolve);
  assert.equal(missing.selectedCode, "SEED/RESIDENT/MISSING");
  assert.equal(missing.unavailable, true, "unknown resident must say unavailable, not switch identity");
  assert.equal(missing.records.length, 16);
  assert.equal(resolutions, 2);
  assert.equal(residentInspectorSelection([], "", resolve).selectedCode, "");
});

test("inspector names the actual blocked route and exact SEED gate instead of a generic warning", () => {
  const foundation = residentFoundationAt(villages[0], 6),
    from = foundation.homeEntrance,
    to = foundation.gatePost!;
  assert.equal(readableResidentSite(to),
    `Gate 1 post 1`,
    "gate captions must distinguish actual gate and watch position");
  assert.equal(readableResidentRoute(`BLOCKED: ${from} → ${to}`),
    "Blocked — Residence 6 entrance → Gate 1 post 1",
    "a grounded-but-blocked watchman must expose the failed destination, not just 'no legal route'");
  assert.equal(readableResidentRoute(`BLOCKED: en route → ${to}`),
    "Blocked — en route → Gate 1 post 1",
    "stranded commutes must retain their actual en-route origin");
  assert.equal(readableResidentRoute("BLOCKED: assigned house has no legally resolved doorway"),
    "Blocked — assigned house has no legally resolved doorway",
    "unresolved owned houses keep their precise failure reason");
  assert.equal(readableResidentRoute(`${from} → ${to}`),
    "Residence 6 entrance → Gate 1 post 1",
    "legal route captions share the same true physical destinations");
});

test("resident captions are short while authoritative site IDs stay unchanged", () => {
  const foundation = residentFoundationAt(villages[0], 12);
  assert.equal(readableResidentSite(foundation.homeEntrance), "Residence 12 entrance");
  assert.equal(foundation.homeEntrance, `${foundation.homeBuilding}/ENTRANCE`);
  assert.ok(readableResidentSite(foundation.workplace).length < foundation.workplace.length,
    "the visible caption is shorter than the expandable canonical workplace code");
});

test("every resident foundation owns one stable canonical house and entrance", () => {
  assert.equal(RESIDENTIAL_CAPACITY, 1);
  for (const place of [villages[0], cities[0]]) {
    const homes = new Set<string>();
    for (let index = 0; index < populationOf(place); index++) {
      const first = residentFoundationAt(place, index),
        replay = residentFoundationAt(place, index);
      assert.deepEqual(replay, first);
      assert.equal(first.home, first.homeBuilding);
      assert.equal(first.homeOwner, first.code);
      assert.equal(first.settlement, place.id);
      assert.equal(first.homeEntrance, `${first.homeBuilding}/ENTRANCE`);
      assert.equal(first.homeBuilding, `${place.code}/RESIDENCE/${index}`);
      assert.ok(first.workplace.startsWith(place.code));
      assert.ok(!homes.has(first.homeBuilding), `${first.homeBuilding} assigned twice`);
      homes.add(first.homeBuilding);
    }
    assert.equal(homes.size, populationOf(place));
  }
});

test("every village has required service staff and continuous seeded gate coverage", () => {
  const serviceRoles = new Set([
    "innkeeper",
    "merchant",
    "blacksmith",
    "farmer",
    "butcher",
    "guard-officer",
  ]);
  for (const village of villages) {
    const initialRoles = new Set(
      Array.from({ length: 6 }, (_, index) =>
        residentFoundationAt(village, index).role,
      ),
    );
    assert.deepEqual(initialRoles, serviceRoles, `${village.code} service roster`);
    assert.ok(gateCountFor(village) === 1 || gateCountFor(village) === 2);
    for (const tick of [0, 6 * HOUR, 12 * HOUR, 18 * HOUR, 23 * HOUR + 3599]) {
      const coverage = guardCoverageAt(village, tick);
      assert.equal(coverage.length, gateCountFor(village));
      for (const gate of coverage) {
        assert.equal(gate.required, guardsPerGateFor(village, gate.gateIndex));
        assert.equal(gate.scheduled, gate.required, `${village.code}: the SEED watch roster is complete`);
        assert.ok(gate.onDuty >= 0 && gate.onDuty <= gate.scheduled, "physical coverage never exceeds scheduled watchmen");
        assert.equal(gate.missing, gate.required - gate.onDuty, "actual missing post capacity must stay visible");
        assert.equal(gate.residentCodes.length, gate.onDuty);
        assert.equal(gate.unresolvedCodes.length, gate.missing);
        assert.equal(new Set([...gate.residentCodes, ...gate.unresolvedCodes]).size, gate.scheduled,
          "every assigned watchman is present or explicitly unresolved, never silently counted twice");
      }
    }
  }
});

test("legal guard arrivals fill posts while unresolved homes remain explicit gate vacancies", () => {
  const village = villages[0], lon = village.canonicalPosition.lon;
  for (const [index, hour] of [[6, 9], [7, 21]] as const) {
    const tick = tickAtLocalTime(WORKDAY, hour * HOUR, lon),
      resident = residentAt(village, index, tick),
      gate = guardCoverageAt(village, tick)[0];
    assert.equal(resident.role, "guard");
    assert.ok(resident.grounded && resident.activity === "guard",
      `${resident.code}: a legal SEED watchman must actually arrive at the post`);
    assert.ok(gate.residentCodes.includes(resident.code),
      "a grounded watchman at the physical post must count in gate coverage");
  }
  const midnight = guardCoverageAt(village, 0);
  const unresolved = residentAt(village, 8, 0);
  if (!unresolved.grounded || unresolved.route.startsWith("BLOCKED:"))
    assert.ok(midnight.every(gate => !gate.residentCodes.includes(unresolved.code)),
      "an unresolved house must never become a fictitious physically staffed gate");
});

test("night guards carry their lawful evening position through midnight and the morning shift", () => {
  const affected = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(affected, "retain the prior road-trimmed village case");
  for (const village of [villages[0], affected]) {
    const lon = village.canonicalPosition.lon,
      late = tickAtLocalTime(WORKDAY, 24 * HOUR - 1, lon),
      midnight = tickAtLocalTime(WORKDAY + 1, 0, lon),
      dawn = tickAtLocalTime(WORKDAY + 1, 6 * HOUR, lon);
    let index = 6;
    for (let gate = 0; gate < gateCountFor(village); gate++)
      for (let slot = 0; slot < guardsPerGateFor(village, gate); slot++, index += 2) {
        const code = residentFoundationAt(village, index + 1).code,
          before = residentAt(village, index + 1, late),
          after = residentAt(village, index + 1, midnight),
          beforeDawn = residentAt(village, index + 1, dawn - 1),
          afterDawn = residentAt(village, index + 1, dawn);
        assert.equal(before.code, code);
        assert.equal(after.code, code, "midnight may not replace canonical identity");
        assert.ok(greatCircleDistance(before.position, after.position) < 3,
          `${code}: fantasy midnight cannot teleport a watchman to the gate`);
        assert.ok(greatCircleDistance(beforeDawn.position, afterDawn.position) < 3,
          `${code}: the 06:00 watch handoff cannot teleport a stranded watchman`);
        if (before.activity !== "guard" || !before.grounded) {
          assert.notEqual(after.activity, "guard",
            `${code}: blocked/incomplete evening approach cannot become a staffed midnight watch`);
          assert.ok(!guardCoverageAt(village, midnight)[gate].residentCodes.includes(code),
            "the physical gate roster must not count an unarrived guard");
        } else {
          assert.equal(after.activity, "guard", "an actually reached watch stays on its post overnight");
        }
      }
  }
});

test("midnight watch attendance requires a previous-day journey from a legal owned home", () => {
  const affected = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(affected, "retain the road-trimmed village");
  let arrived = 0;
  for (const village of [villages[0], affected]) {
    const lon = village.canonicalPosition.lon,
      homeTick = tickAtLocalTime(WORKDAY, 11 * HOUR, lon),
      eveningTick = tickAtLocalTime(WORKDAY, 21 * HOUR, lon),
      midnightTick = tickAtLocalTime(WORKDAY + 1, 0, lon);
    let index = 6;
    for (let gate = 0; gate < gateCountFor(village); gate++)
      for (let slot = 0; slot < guardsPerGateFor(village, gate); slot++, index += 2) {
        const code = residentFoundationAt(village, index + 1).code,
          home = residentAt(village, index + 1, homeTick),
          evening = residentAt(village, index + 1, eveningTick),
          midnight = residentAt(village, index + 1, midnightTick),
          staffing = guardCoverageAt(village, midnightTick)[gate].residentCodes.includes(code);
        assert.equal(staffing, midnight.grounded && midnight.activity === "guard" &&
          !midnight.route.startsWith("BLOCKED:"),
          `${code}: only a physically present guard can fill the watch post`);
        if (!staffing) continue;
        arrived++;
        assert.ok(home.grounded && home.indoors && home.route === home.homeEntrance,
          `${code}: a midnight watch must have reached its real home before departing`);
        assert.ok(evening.grounded && evening.activity === "guard" && !evening.route.startsWith("BLOCKED:"),
          `${code}: a midnight watch requires a lawful evening arrival`);
        assert.ok(greatCircleDistance(evening.position, midnight.position) < 2,
          `${code}: the actual evening post must persist through midnight`);
      }
  }
  assert.ok(arrived > 0, "at least one real village night watch must be physically staffed");
});

test("actual guard home lots follow the final road-trimmed village enclosure", () => {
  const village = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(village, "retain the real village with a formerly blocked watchman's house");
  const plan = settlementExteriorFor(village);
  const inside = (x: number, z: number) => {
    const px = wrapSourceX(x - village.x), pz = z - village.z;
    let result = false;
    for (let i = 0, j = plan.border.length - 1; i < plan.border.length; j = i++) {
      const a = plan.border[i], b = plan.border[j],
        ax = wrapSourceX(a.x - village.x), az = a.z - village.z,
        bx = wrapSourceX(b.x - village.x), bz = b.z - village.z;
      if ((az > pz) !== (bz > pz) && px < ax + (bx - ax) * (pz - az) / (bz - az)) result = !result;
    }
    return result;
  };
  const lots = Array.from({ length: populationOf(village) }, (_, index) =>
    settlementHomeFor(village, index, plan).candidates[0]);
  assert.ok(lots.every(lot => inside(lot.x, lot.z)),
    "all owned homes must be drawn from within the final trimmed enclosure");
  assert.equal(new Set(lots.map(lot => `${lot.x.toFixed(7)}/${lot.z.toFixed(7)}`)).size, lots.length,
    "reconciliation must never allocate the same physical lot twice");
  assert.ok(resolvedSettlementHomeDoorFor(village, 7),
    "the formerly road-displaced watchman must own a real legal front door");
});

test("physical watchmen remain spatially inspectable at resolved homes after frontage relocation", () => {
  const village = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(village, "retain the real village whose original watchman frontage was clipped");
  const simulation = new LazySimulation();
  simulation.setFocus(village);
  for (const [index, hour] of [[6, 2], [7, 11]] as const) {
    const tick = tickAtLocalTime(WORKDAY, hour * HOUR, village.canonicalPosition.lon),
      door = resolvedSettlementHomeDoorFor(village, index),
      person = residentAt(village, index, tick);
    assert.ok(door, `guard ${index} must keep one legally resolved owned doorway`);
    assert.ok(person.grounded && person.indoors && !person.route.startsWith("BLOCKED:"),
      `${person.code}: night/day off-duty rest must occur at the lawful owned home`);
    assert.ok(Math.hypot(wrapSourceX(person.x - door.x), person.z - door.z) < .001,
      "off-duty logical position agrees with the actual resolved house entrance");
    simulation.advance(tick);
    assert.ok(simulation.focusedResidents(person.x, person.z, .08, 160)
      .some(found => found.code === person.code),
      "bounded resident spatial query must include the physical home, not just its old SEED frontage");
    assert.ok(simulation.stats.residentEvaluationsSinceAdvance <= populationOf(village),
      "a home lookup never materializes the entire settlement beyond its population bound");
  }
});

test("resident schedule state is analytical from absolute fantasy time", () => {
  const village = villages[0], tick = at(14, WORKDAY) + 1234,
    direct = residentAt(village, 3, tick), simulation = new LazySimulation();
  simulation.setFocus(village);
  simulation.advance(1);
  simulation.advance(8000);
  simulation.advance(tick);
  const caughtUp = simulation.residentByCode(direct.code);
  assert.deepEqual(caughtUp, direct);
  assert.equal(caughtUp?.role, "farmer");
  assert.equal(caughtUp?.task, "Working the farm");
  assert.equal(caughtUp?.route, caughtUp?.workplace);
});

test("analytical resident positions stay on walkable final surface", () => {
  const village = villages[0];
  for (const tick of [at(2), at(6.5), at(11), at(18.5), at(22)])
    for (const index of [0, 3, 6, 12, 31, 57, 79]) {
      const resident = residentAt(village, index, tick),
        surface = finalSurfaceAt(resident.x, resident.z);
      assert.ok(surface.walkable, `${resident.code} at ${tick} is not walkable`);
    }
});

test("sampled commute states remain walkable and spatially continuous", () => {
  const fixtures = [villages[0], villages[Math.min(7, villages.length - 1)], cities[0]];
  for (const place of fixtures)
    for (const index of [0, 3, 6, Math.min(17, populationOf(place) - 1)])
      for (const start of [at(6, WORKDAY), at(18, WORKDAY)]) {
        let previous = residentAt(place, index, start);
        for (let offset = 5 * 60; offset <= HOUR; offset += 5 * 60) {
          const current = residentAt(place, index, start + offset),
            surface = finalSurfaceAt(current.x, current.z),
            stepM = greatCircleDistance(previous.position, current.position);
          assert.ok(surface.walkable, `${current.code} commute sample is not walkable`);
          // Walking pace: never faster than the canonical good-road speed (1 m/s) between five-minute samples.
          assert.ok(
            stepM <= 1.05 * 5 * 60,
            `${current.code} commute jumped ${stepM.toFixed(1)}m between five-minute samples`,
          );
          previous = current;
        }
      }
});

test("advance never rebuilds a focused country's resident objects", () => {
  const city = cities[0], country = countries.find(
    (entry) => entry.continent === city.continent && entry.id === city.country,
  )!, simulation = new LazySimulation();
  simulation.setFocus(city);
  for (const tick of [1, 2, 3, 60, 3600, 7200]) {
    simulation.advance(tick);
    assert.equal(simulation.stats.liveCountries, 1);
    assert.equal(simulation.stats.activeScheduleRecords, 0);
    assert.equal(simulation.stats.residentEvaluationsSinceAdvance, 0);
    assert.ok(simulation.stats.logicalResidents >= populationOf(city));
    assert.equal(simulation.summaries.get(country.code)?.tier, "live");
  }
});

test("focused resident queries use a lazy spatial index and bounded evaluation", () => {
  const city = cities[0], simulation = new LazySimulation();
  simulation.setFocus(city);
  simulation.advance(9 * HOUR);
  const first = simulation.focusedResidents(city.x, city.z, 2, 32),
    firstStats = simulation.stats;
  assert.ok(first.length <= 32);
  assert.equal(firstStats.query.returnedResidents, first.length);
  assert.ok(firstStats.query.settlements >= 1);
  assert.ok(firstStats.query.candidateResidents > 0);
  assert.ok(firstStats.query.candidateResidents < firstStats.logicalResidents);
  assert.ok(firstStats.query.evaluatedResidents <= firstStats.query.candidateResidents);
  assert.ok(firstStats.query.evaluatedResidents < firstStats.logicalResidents);
  assert.equal(new Set(first.map((resident) => resident.code)).size, first.length);
  const builds = firstStats.residentIndexBuilds;
  simulation.focusedResidents(city.x + 0.5, city.z + 0.5, 2, 32);
  assert.equal(simulation.stats.residentIndexBuilds, builds, "steady queries reuse spatial index");
});

test("unload and revisit reconstruct the same resident from seed and absolute time", () => {
  const home = villages[0], other = villages.find(
    (place) => place.continent !== home.continent || place.country !== home.country,
  );
  assert.ok(other, "test world needs a village in another country");
  const tick = 10 * HOUR + 777, code = residentFoundationAt(home, 11).code,
    direct = residentAt(home, 11, tick), simulation = new LazySimulation();
  simulation.setFocus(home);
  simulation.advance(tick);
  simulation.focusedResidents(home.x, home.z, 4, 16);
  assert.ok(simulation.stats.activeResidentIndexes > 0);
  simulation.setFocus(other);
  assert.equal(simulation.stats.activeResidentIndexes, 0, "country handoff releases resident indexes");
  simulation.setFocus(home);
  const replay = simulation.residentByCode(code, tick);
  assert.deepEqual(replay, direct);
  assert.ok(simulation.stats.reconstructionCount >= 2);
});
test("traits, mood and daily routines are reproducible from the SEED and follow the fantasy clock", () => {
  const village = villages[0];
  for (const index of [0, 3, 9, 25, 61]) {
    const f = residentFoundationAt(village, index);
    assert.deepEqual(traitsFor(f.code, f.role, f.ageGroup), f.traits, "traits are a pure function of the seeded code");
    for (const value of Object.values(f.traits.abilities)) assert.ok(value >= 3 && value <= 18);
    for (const value of Object.values(f.traits.personality)) assert.ok(value >= 0 && value <= 1);
    const plan = dailyPlan({ code: f.code, role: f.role, ageGroup: f.ageGroup, guardShift: f.guardShift }, f.traits, 9, 2);
    assert.deepEqual(dailyPlan({ code: f.code, role: f.role, ageGroup: f.ageGroup, guardShift: f.guardShift }, f.traits, 9, 2), plan);
    assert.equal(plan[0].start, 0, "every plan starts at midnight");
    assert.equal(plan[0].anchor, plan[plan.length - 1].anchor, "days join without a jump");
    for (let i = 1; i < plan.length; i++) assert.ok(plan[i].start >= plan[i - 1].start);
  }
  const resident = residentAt(village, 9, at(10)), replay = residentAt(village, 9, at(10));
  assert.deepEqual(replay, resident);
  assert.equal(localSecondOfDay(at(10), LON), 10 * HOUR, "routines run on the settlement's local clock");
});

test("an ordinary workday: asleep at night, breakfast at home, at the workplace by day, home or inn at dinner", () => {
  const village = villages[0];
  let checked = 0, sampled = 0;
  for (let index = 6; index < populationOf(village) && sampled < 24 && checked < 12; index++) {
    const f = residentFoundationAt(village, index);
    if (f.role === "guard" || f.ageGroup !== "adult" || f.role === "innkeeper") continue;
    sampled++;
    const night = residentAt(village, index, at(2, WORKDAY)), noon = residentAt(village, index, at(10.5, WORKDAY)),
      evening = residentAt(village, index, at(19.5, WORKDAY)), late = residentAt(village, index, at(23.9, WORKDAY));
    const states = [night, noon, evening, late];
    if (states.some(state => !state.grounded)) {
      for (const state of states.filter(state => !state.grounded)) {
        assert.ok(state.route.startsWith("BLOCKED:"), `${f.code}: an ungrounded activity is explicitly blocked`);
        assert.equal(state.indoors, false, `${f.code}: an unverified home cannot claim indoor occupancy`);
        assert.equal(state.travelProgress, undefined);
      }
      continue; // Do not pretend the resident slept or worked at a missing physical home.
    }
    checked++;
    assert.equal(night.activity, "sleep", `${f.code} sleeps at 02:00`);
    assert.ok(night.indoors);
    assert.ok(["work", "commute", "rest"].includes(noon.activity), `${f.code} works at 10:30 (got ${noon.activity})`);
    assert.ok(["dinner", "commute", "socialise", "work", "rest"].includes(evening.activity), `${f.code} at 19:30: ${evening.activity}`);
    assert.equal(late.activity, "sleep", `${f.code} is in bed before midnight`);
    const morning = dailyPlan({ code: f.code, role: f.role, ageGroup: f.ageGroup }, f.traits, 0, 1).find((entry) => entry.kind === "breakfast");
    assert.equal(morning?.anchor, "home", "breakfast is made at home");
  }
  assert.ok(checked >= 6);
});

test("seeded names: stable people, buildings and unique street names per settlement", async () => {
  const { personName, buildingName, streetNames, familyName } = await import("../src/names.ts");
  const village = villages[0], f = residentFoundationAt(village, 12);
  assert.equal(f.name, personName(f.code, f.sex, village.continent), "a resident's name comes from the name generator");
  assert.equal(residentFoundationAt(village, 12).name, f.name);
  assert.match(f.name, /^[A-Z][a-z'A-Z]+ [A-Z][A-Za-z' ]+$/);
  for (const continent of [0, 1, 2]) {
    const names = new Set(Array.from({ length: 200 }, (_, i) => personName(`TEST/${continent}/${i}`, i % 2 ? "male" : "female", continent)));
    assert.ok(names.size > 150, `culture ${continent} gives varied names`);
  }
  for (const city of [true, false]) {
    const streets = streetNames(`TEST/STREETS/${city}`, 30, city);
    assert.equal(new Set(streets).size, streets.length, "street names are unique within a settlement");
  }
  assert.equal(buildingName("inn", "PLOT/INN", "Alderwick", 0), buildingName("inn", "PLOT/INN", "Alderwick", 0));
  assert.match(buildingName("inn", "PLOT/INN", "Alderwick", 0), /^The [A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.equal(buildingName("house", "PLOT/H", "Alderwick", 0, familyName("OWNER", 0)), `${familyName("OWNER", 0)} House`);
});

test("time zones GMT+1..+14 and local daylight drive lighting and routines", () => {
  assert.equal(timeZoneOffsetHours(-Math.PI + 1e-6), 1);
  assert.equal(timeZoneOffsetHours(Math.PI - 1e-6), 14);
  for (let lon = -3.1; lon < 3.1; lon += .2) {
    const zone = timeZoneOffsetHours(lon);
    assert.ok(zone >= 1 && zone <= 14);
    assert.equal(localSecondOfDay(tickAtLocalTime(3, 7 * HOUR, lon), lon), 7 * HOUR);
  }
  const night = daylightAt(0), dawn = daylightAt(6.3 * HOUR), noon = daylightAt(12 * HOUR);
  assert.deepEqual([...noon.terrainTint], [1, 1, 1], "daytime keeps the original bright settings");
  assert.equal(noon.sunIntensity, .9);
  assert.ok(night.sky[2] > night.sky[0] && night.sunIntensity < .3, "midnight is dark blue");
  assert.ok(dawn.sunColor[0] > dawn.sunColor[2] + .4 && dawn.terrainTint[0] > dawn.terrainTint[2], "dawn light is orange");
  // Two settlements in different zones are at different local hours at the same realm tick.
  const east = villages.find((v) => timeZoneOffsetHours(v.canonicalPosition.lon) !== timeZoneOffsetHours(LON));
  if (east) assert.notEqual(localSecondOfDay(at(12), east.canonicalPosition.lon), 12 * HOUR);
});


test("outdoor trades use many real plots instead of one farmstead", () => {
  for (const place of [villages[0], cities[0]]) {
    const workers = Array.from({ length: populationOf(place) }, (_, i) => residentFoundationAt(place, i))
      .filter(f => (f.role === "farmer" || f.role === "laborer") && f.index >= 6);
    const counts = new Map<string, number>();
    for (const f of workers) {
      const site = `${f.workOffset.eastM.toFixed(2)}/${f.workOffset.northM.toFixed(2)}`;
      counts.set(site, (counts.get(site) ?? 0) + 1);
      assert.deepEqual(f.workOffset, residentFoundationAt(place, f.index).workOffset);
    }
    assert.ok(counts.size >= (place.kind === "city" ? 40 : 12), `${place.name}: ${counts.size} outdoor work sites`);
    assert.ok(Math.max(...counts.values()) < workers.length * .25, "no single farmstead absorbs the workforce");
  }
});

test("children and elders share several nearby gardens while retaining town-square visits", () => {
  const place = cities[0], tick = tickAtLocalTime(WORKDAY, 10.5 * HOUR, place.canonicalPosition.lon), gardens = new Set<string>();
  let square = 0;
  for (let i = 0; i < populationOf(place); i++) {
    const f = residentFoundationAt(place, i);
    if (f.ageGroup !== "child" && f.ageGroup !== "elder") continue;
    const r = residentAt(place, i, tick);
    if (r.route.includes("/GARDEN/")) gardens.add(r.route);
    if (r.task.includes("square") || r.task.includes("prayers")) square++;
  }
  assert.ok(gardens.size >= 10, `${gardens.size} neighbourhood gardens visited`);
  assert.ok(square > 0, "a logical central gathering still exists");
});

test("nearby queries find residents at distributed farm and garden destinations", () => {
  const place = villages[0], simulation = new LazySimulation(), tick = tickAtLocalTime(WORKDAY, 10.5 * HOUR, place.canonicalPosition.lon);
  simulation.setFocus(place); simulation.advance(tick);
  let checked = 0;
  for (let i = 6; i < populationOf(place); i++) {
    const r = residentAt(place, i, tick);
    if (!r.route.includes("/PATCH/") && !r.route.includes("/GARDEN/")) continue;
    assert.ok(simulation.focusedResidents(r.x, r.z, .15, 160).some(candidate => candidate.code === r.code), r.code);
    checked++;
  }
  assert.ok(checked >= 10);
});


test("outlying woodland workers use real habitat and remain queryable away from town", async () => {
  const { climateSampleAt } = await import("../src/climate.ts"), place = villages[0], simulation = new LazySimulation(), tick = tickAtLocalTime(WORKDAY, 15 * HOUR, place.canonicalPosition.lon);
  simulation.setFocus(place); simulation.advance(tick);
  let checked = 0;
  for (let i = 6; i < populationOf(place); i++) {
    const f = residentFoundationAt(place, i);
    if (!f.workplace.includes("/WOODLAND/")) continue;
    const r = residentAt(place, i, tick), surface = finalSurfaceAt(r.x, r.z);
    if (!r.grounded) {
      assert.ok(r.route.startsWith("BLOCKED:"), "unverified woodland arrival is never reported as work");
      assert.equal(r.activity, "rest");
      continue;
    }
    assert.equal(r.activity, "work");
    assert.ok(surface.walkable && surface.water.kind === "none" && surface.vegetationDensityScale > .5);
    assert.ok(climateSampleAt(r.position, surface.groundHeight).forestFamily);
    assert.ok(simulation.focusedResidents(r.x, r.z, .15, 160).some(candidate => candidate.code === r.code));
    checked++;
  }
  assert.ok(checked >= 2, "woodland trades leave the central farmstead for actual habitat");
});


test("fishing destinations are dry banks beside actual water, with inland fallback", async () => {
  const { CANONICAL_PLANET_RADIUS, lonLatToSource } = await import("../src/planet.ts");
  const place = villages.find(p => p.name === "Falconham")!, f = residentFoundationAt(place, 70);
  assert.equal(f.character, "fisherman_male");
  const inland = residentFoundationAt(villages.find(p => p.name === "Willowstead")!, 59);
  assert.ok(inland.workplace.includes("/PATCH/"), "unreachable bank falls back to a real farm patch");
  assert.ok(f.workplace.includes("/SHORE/"), "waterside resident has a real fishing bank");
  const tick = tickAtLocalTime(WORKDAY, 15 * HOUR, place.canonicalPosition.lon), r = residentAt(place, 70, tick),
    // The site and the resident's actual location are different facts: an
    // assigned fishing bank must exist even when the gate/shore route is blocked.
    bank = {
      lon: normalizeLongitude(place.canonicalPosition.lon + f.workOffset.eastM /
        (CANONICAL_PLANET_RADIUS * Math.max(1e-9, Math.abs(Math.cos(place.canonicalPosition.lat))))),
      lat: place.canonicalPosition.lat + f.workOffset.northM / CANONICAL_PLANET_RADIUS,
    },
    bankSource = lonLatToSource(bank.lon, bank.lat);
  assert.equal(finalSurfaceAt(bankSource.x, bankSource.z).water.kind, "none",
    "the SEED-assigned fishing bank must be dry regardless of resident travel");
  assert.ok(Array.from({length:16},(_,i)=> {
    const a=i*Math.PI/8, p=lonLatToSource(bank.lon+Math.cos(a)*15/(CANONICAL_PLANET_RADIUS*Math.cos(bank.lat)),bank.lat+Math.sin(a)*15/CANONICAL_PLANET_RADIUS);
    return finalSurfaceAt(p.x,p.z).water.kind !== "none";
  }).some(Boolean), "water must be within 15 m of the actual assigned bank");
  assert.ok(!r.route.startsWith("BLOCKED:"), `Falconham fisherman must reach the dry bank: ${r.task} / ${r.route}`);
  assert.ok(r.grounded, "a working fisherman stands on legal ground");
  assert.equal(r.task, "Fishing from the bank");
  assert.equal(r.activity, "work");
  assert.ok(greatCircleDistance(r.position, bank) < 2, "fishing work must occur at its assigned bank");
});
