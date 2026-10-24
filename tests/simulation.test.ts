import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, villages } from "../src/geography.ts";
import { CANONICAL_PLANET_RADIUS, greatCircleDistance, normalizeLongitude, sourceToLonLat } from "../src/planet.ts";
import { featuresFor, finalSurfaceAt, resolvedSettlementHomeDoorFor, tileForPosition } from "../src/world.ts";
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
  legalEnclosureSegment,
  timedWalkOnPath,
  lastReachableRoutineStop,
  residentOccupiesBuilding,
  readableResidentSite,
  residentInspectorSelection,
  nearestNode,
  nearestLegalStreetNode,
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
        assert.equal(gate.onDuty, gate.required, `${village.code} gate ${gate.gateIndex} at ${tick}`);
        assert.equal(new Set(gate.residentCodes).size, gate.onDuty);
      }
    }
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
  if (r.route.startsWith("BLOCKED:")) {
    assert.equal(r.activity, "rest", "a blocked resident cannot pretend to fish");
    assert.equal(r.travelProgress, undefined, "an unreachable bank cannot have successful travel progress");
    assert.notEqual(r.task, "Fishing from the bank", "assignment is not arrival");
  } else {
    assert.ok(r.grounded, "a working fisherman stands on legal ground");
    assert.equal(r.task, "Fishing from the bank");
    assert.equal(r.activity, "work");
    assert.ok(greatCircleDistance(r.position, bank) < 2, "fishing work must occur at its assigned bank");
  }
});
