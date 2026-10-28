import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { CHARACTER_TYPES } from "../src/characters.ts";
import { cities, countries, villages } from "../src/geography.ts";
import { CANONICAL_PLANET_RADIUS, greatCircleDistance, lonLatToSource, normalizeLongitude, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
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
  residentGuardPresence,
  legalPosition,
  continuousWalkableOffsetSegment,
  residentWalkableSurface,
  legalEnclosureSegment,
  timedWalkOnPath,
  unfinishedOrBlockedOvernightReturn,
  provablyLateWithoutStreetSearch,
  routineHasProvablyLateLeg,
  provablyLateWithStandingBounds,
  walkWindowOnPath,
  lastReachableRoutineStop,
  residentOccupiesBuilding,
  residentInsideRenderedService,
  readableResidentSite,
  readableResidentRoute,
  residentInspectorSelection,
  residentShortLabel,
  nearestNode,
  nearestLegalStreetNode,
  StableStreetFrontier,
  legalOpenGroundDetour,
  exteriorGroundCorridor,
  residentStreetPathKey,
  validatedResidentRoadPolyline,
  residentViewQuery,
  threeNearestOffsets,
  residentBucketBoundsOverlap,
  streetTopologyComponents,
  orderedResidentIndicesByStandingRank,
} from "../src/simulation.ts";

import { localDayIndex, localSecondOfDay, localWeekday, tickAtLocalTime, timeZoneOffsetHours } from "../src/clock.ts";
import { daylightAt } from "../src/daylight.ts";
import { dailyPlan, traitsFor } from "../src/routines.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { transportBridgeByCode } from "../src/transport-network.ts";

const HOUR = 3600;
/** Tick at which villages[0]'s local clock shows this time on calendar day `day` (routines follow local time). */
const LON = villages[0].canonicalPosition.lon;
const at = (hour: number, day = 1) => tickAtLocalTime(day, hour * HOUR, LON);
/** First calendar day after the origin that is a local workday (weekday 0-5). */
const WORKDAY = [1, 2, 3, 4, 5, 6, 7].find((day) => localWeekday(tickAtLocalTime(day, 12 * HOUR, LON), LON) !== 6)!;

test("resident inspector can resolve facts: linear standing ranks preserve all canonical sorted slots", () => {
  // The population scan appends canonical indexes in ascending order. Its
  // original comparator sorts first by activity rank (0–9), then by index.
  for (const n of [0, 1, 2, 3, 12, 101, 480, 2400])
    for (let mode = 0; mode < 6; mode++) {
      const list: [number, number][] = Array.from({ length: n }, (_, i) => [
        mode === 0 ? 0 : mode === 1 ? 9 : mode === 2 ? i % 10 :
          mode === 3 ? 9 - i % 10 : mode === 4 ? (i * i + 3) % 10 :
            (i * 7 + (i >> 2)) % 10,
        i * 3 + 1,
      ]);
      const expected = [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, index]) => index);
      assert.deepEqual([...orderedResidentIndicesByStandingRank(list)], expected,
        `same SEED slots for population ${n} distribution ${mode}`);
      assert.deepEqual(list.map(([, index]) => index), Array.from({ length: n }, (_, i) => i * 3 + 1),
        "never mutate original canonical resident enumeration");
    }
});

test("the roster and seeded population exclude child characters and deleted sprites", () => {
  for (const type of Object.values(CHARACTER_TYPES)) {
    assert.ok(type.age === "adult" || type.age === "elder");
    assert.ok(!type.key.startsWith("child_"));
  }
  for (const place of [...villages.slice(0, 3), ...cities.slice(0, 2)]) {
    for (let index = 0; index < Math.min(populationOf(place), 160); index++) {
      const resident = residentFoundationAt(place, index);
      assert.ok(resident.ageGroup === "adult" || resident.ageGroup === "elder");
      assert.ok(!resident.character.startsWith("child_"));
      assert.notEqual(String(resident.role), "child");
    }
  }
  for (const key of ["child_female", "child_male"]) {
    assert.ok(!existsSync(new URL(`../public/characters/${key}.webp`, import.meta.url)));
  }
});

test("bounded resident foundation reuse does not rebuild SEED identity on a warm query", () => {
  const place = villages[0], index = 70;
  const initial = residentFoundationAt(place, index);
  assert.equal(residentFoundationAt(place, index), initial,
    "the spatial index, standing slots and route evaluation share one immutable foundation");
  assert.equal(residentAt(place, index, at(15, WORKDAY)).code, initial.code,
    "caching identity cannot change the actual Simulation actor");
  assert.equal(residentFoundationAt(place, index), initial,
    "route reconstruction must not evict the active village foundation");
  assert.throws(() => residentFoundationAt(place, populationOf(place)), RangeError,
    "bounded caching must not make an invalid resident index valid");
});

test("resident inspector can resolve facts with identical compact cold spatial candidates", () => {
  // Original index inserted every resident into every 4-source-unit bucket in
  // its rectangle, then unioned all query buckets. Compare that exact oracle
  // against compact rectangle intersections, including negatives/boundaries.
  const bounds = Array.from({ length: 160 }, (_, index) => {
    const bx0 = (index * 13) % 29 - 14, bz0 = (index * 17) % 31 - 15;
    return { bx0, bx1: bx0 + (index * 3) % 18,
      bz0, bz1: bz0 + (index * 7) % 15 };
  });
  const buckets = new Map<string, Set<number>>();
  for (let index = 0; index < bounds.length; index++) {
    const b = bounds[index];
    for (let bz = b.bz0; bz <= b.bz1; bz++)
      for (let bx = b.bx0; bx <= b.bx1; bx++) {
        const key = `${bx}/${bz}`, group = buckets.get(key) ?? new Set<number>();
        group.add(index);
        buckets.set(key, group);
      }
  }
  const queries = [
    { bx0: -14, bx1: -14, bz0: -15, bz1: -15 },
    { bx0: -8, bx1: 2, bz0: -4, bz1: 8 },
    { bx0: 0, bx1: 0, bz0: 0, bz1: 0 },
    { bx0: 20, bx1: 40, bz0: 21, bz1: 32 },
    { bx0: 100, bx1: 110, bz0: 100, bz1: 110 },
  ];
  for (const query of queries) {
    const old = new Set<number>();
    for (let bz = query.bz0; bz <= query.bz1; bz++)
      for (let bx = query.bx0; bx <= query.bx1; bx++)
        for (const id of buckets.get(`${bx}/${bz}`) ?? []) old.add(id);
    const compact = bounds.flatMap((bounds, index) =>
      residentBucketBoundsOverlap(bounds, query) ? [index] : []);
    assert.deepEqual(compact, [...old].sort((a, b) => a - b),
      "all candidate SEED resident IDs match original inclusive bucket union");
  }
});

test("resident inspector can resolve facts with stable bounded nearest-site selection", () => {
  const sites = Array.from({ length: 256 }, (_, i) => ({
    eastM: (i % 16 - 8) * 12, northM: (Math.floor(i / 16) - 8) * 9, id: `GARDEN/${i}`,
  }));
  // Reproduce the previous stable full-sort oracle, including ties and original order.
  for (const home of [{ eastM: 0, northM: 0 }, { eastM: 49, northM: -32 },
    { eastM: -55, northM: 78 }, { eastM: 1, northM: 1 }]) {
    const oracle = [...sites].sort((a, b) =>
      Math.hypot(a.eastM - home.eastM, a.northM - home.northM) -
      Math.hypot(b.eastM - home.eastM, b.northM - home.northM)).slice(0, 3);
    assert.deepEqual(threeNearestOffsets(sites, home), oracle,
      "bounded top three must preserve every canonical nearest-site choice");
  }
  assert.deepEqual(threeNearestOffsets([], { eastM: 0, northM: 0 }), []);
  assert.deepEqual(threeNearestOffsets(sites.slice(0, 2), { eastM: 0, northM: 0 }),
    [...sites.slice(0, 2)].sort((a, b) => Math.hypot(a.eastM, a.northM) - Math.hypot(b.eastM, b.northM)));
});

test("resident inspector can resolve facts with one shared cold exterior plan", () => {
  const place = villages[11], plan = settlementExteriorFor(place), index = 61,
    indexed = residentFoundationAt(place, index, plan),
    ordinary = residentFoundationAt(place, index);
  assert.strictEqual(indexed, ordinary,
    "cold spatial-index reuse must not produce an alternate SEED resident or home lot");
  assert.equal(indexed.homeEntrance, `${place.code}/RESIDENCE/${index}/ENTRANCE`);
  const actor = residentAt(place, index, at(15, WORKDAY));
  assert.equal(actor.code, indexed.code,
    "a cached indexed identity must still resolve the same Simulation actor");
  assert.equal(actor.homeBuilding, indexed.homeBuilding);
  assert.equal(actor.homeEntrance, indexed.homeEntrance);
});

test("resident evaluation instrumentation preserves the same authoritative actor and legal route", () => {
  const place = villages[11], tick = at(15, WORKDAY), sample = 61,
    phases = { candidateLookupMs: 0, foundationMs: 0, doorMs: 0, scheduleMs: 0, overnightRiskMs: 0, groundingMs: 0, evaluated: 0 };
  const profiled = residentAt(place, sample, tick, phases),
    ordinary = residentAt(place, sample, tick);
  assert.deepEqual(profiled, ordinary, "observational profiling cannot change seeded actor identity or legal movement");
  assert.equal(phases.evaluated, 1);
  for (const value of [phases.foundationMs, phases.doorMs, phases.scheduleMs, phases.overnightRiskMs, phases.groundingMs])
    assert.ok(Number.isFinite(value) && value >= 0, "worker phase timing is finite nonnegative wall time");
});

test("resident inspector off-screen status is stable and carries the same SEED identity", () => {
  const sample = { index: 6, role: "guard-officer" } as const;
  assert.equal(residentShortLabel(sample), "Resident 7 · guard officer");
  const caption = residentShortLabel(sample, true);
  assert.equal(caption, "Resident 7 · guard officer · off-screen");
  assert.equal(residentShortLabel(sample, true), caption, "repeat queries must not grow the caption");
  assert.equal(residentShortLabel(sample, false), "Resident 7 · guard officer", "return to view clears the status");
});

test("resident inspector can resolve facts with early fully validated SEED resident callback and unchanged final order", () => {
  const place = villages[0], simulation = new LazySimulation();
  simulation.setFocus(place);
  simulation.advance(at(9, WORKDAY));
  const observed: string[] = [], indexBuildsAtFirst: number[] = [];
  const residents = simulation.focusedResidents(place.x, place.z, 8, 8, undefined, false, undefined,
    resident => {
      observed.push(resident.code);
      indexBuildsAtFirst.push(simulation.stats.residentIndexBuilds);
    });
  assert.ok(residents.length > 0, "fixture must produce authoritative residents");
  assert.deepEqual(observed, [residents[0].code],
    "first fact must be fully resolved, once only, and agree with the final ordered resident batch");
  assert.deepEqual(indexBuildsAtFirst, [0],
    "the first fully checked resident must reach inspection before a cold index finishes");
  assert.equal(simulation.stats.residentIndexBuilds, 1,
    "the early callback cannot abandon the complete canonical spatial index");
});

test("resident inspector can resolve facts for cold actors in exact completed-index order", () => {
  const place = villages[0], tick = at(9, WORKDAY),
    cold = new LazySimulation(), indexed = new LazySimulation();
  cold.setFocus(place); cold.advance(tick);
  indexed.setFocus(place); indexed.advance(tick);
  // A fully indexed comparator retains the original canonical selection.
  indexed.focusedResidents(place.x, place.z, 8, 8, undefined, false);
  assert.equal(indexed.stats.residentIndexBuilds, 1);
  const previews: ReturnType<typeof residentAt>[] = [];
  const first = cold.focusedResidents(place.x, place.z, 8, 2, undefined, true, undefined,
    resident => previews.push(resident));
  const expected = indexed.focusedResidents(place.x, place.z, 8, 2, undefined, true);
  assert.ok(first.length > 0, "actual settled SEED village must have inspectable actors");
  assert.deepEqual(first, expected, "bounded cold scan cannot change a resident, order, route or ground verdict");
  assert.equal(previews.length, 1, "only one fully validated preview is published");
  assert.deepEqual(previews[0], residentAt(place, previews[0].index, tick),
    "early first fact must have the complete original Simulation ground and route validation");
  assert.ok(cold.stats.query.evaluatedResidents <= 4,
    "limit-two outdoor scan must never evaluate more than four real residents");
});

test("resident inspector can resolve facts and close-up actors independently of optional scenery", () => {
  assert.deepEqual(residentViewQuery(48, true, false), { actors: false, inspect: true },
    "village-scale inspection must not wait for terrain or meshes");
  assert.deepEqual(residentViewQuery(48, false, false), { actors: false, inspect: false },
    "hidden inspector performs no extra resident search");
  assert.deepEqual(residentViewQuery(12, false, false), { actors: false, inspect: false },
    "street sprites must not appear before coherent terrain is ready");
  assert.deepEqual(residentViewQuery(12, false, true), { actors: true, inspect: true },
    "street actors and inspection become available at coherent terrain without optional models");
  assert.deepEqual(residentViewQuery(12, true, true), { actors: true, inspect: true },
    "opening the inspector cannot delay valid close-up actors");
  assert.deepEqual(residentViewQuery(100, true, true), { actors: false, inspect: false },
    "remote city and realm views do not issue expensive resident searches");
});

test("zero resident query budget yields no residents, evaluations or index work", () => {
  const place = villages[0], simulation = new LazySimulation();
  simulation.setFocus(place);
  simulation.advance(at(9, WORKDAY));
  assert.deepEqual(simulation.focusedResidents(place.x, place.z, 2, 0), []);
  assert.equal(simulation.stats.query.returnedResidents, 0);
  assert.equal(simulation.stats.query.candidateResidents, 0);
  assert.equal(simulation.stats.query.evaluatedResidents, 0);
  assert.equal(simulation.stats.residentIndexBuilds, 0,
    "a zero budget must not construct or evaluate an entire resident index");
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

test("street ring perimeter scan preserves distant nearest-node and tie choices", () => {
  const cell = 12, nodes = [
    { eastM: -307, northM: 305 },
    { eastM: 306, northM: -304 },
    { eastM: 306, northM: 304 },
    { eastM: -306, northM: -304 },
    { eastM: 0, northM: 0 },
    { eastM: 0, northM: 0 }, // exact ties must keep original node order
  ];
  const grid = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = `${Math.floor(node.eastM / cell)}/${Math.floor(node.northM / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), index]);
  });
  const graph = { nodes, grid, cell };
  const originalSquareScan = (offset: { eastM: number; northM: number }) => {
    let best = -1, bestDistance = Infinity;
    const cx = Math.floor(offset.eastM / cell), cz = Math.floor(offset.northM / cell);
    for (let ring = 0; ring < 40; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        for (const id of grid.get(`${cx + dx}/${cz + dz}`) ?? []) {
          const distance = Math.hypot(nodes[id].eastM - offset.eastM, nodes[id].northM - offset.northM);
          if (distance < bestDistance) { best = id; bestDistance = distance; }
        }
      }
      if (best >= 0 && bestDistance <= ring * cell) break;
    }
    return best;
  };
  // The real immutable street graph records its occupied bucket bounds once.
  // A remote habitat outside the original 40-ring scan must remain unconnected
  // without performing any thousands-of-empty-grid-lookups search.
  const boundedGrid = new Map(grid);
  let remoteBucketReads = 0;
  boundedGrid.get = (key: string) => {
    remoteBucketReads++;
    return Map.prototype.get.call(boundedGrid, key) as number[] | undefined;
  };
  const boundedGraph = { ...graph, grid: boundedGrid,
    gridBounds: { minX: -26, maxX: 25, minZ: -26, maxZ: 25 } };
  const remote = { eastM: 5000, northM: -5000 };
  assert.equal(nearestNode(boundedGraph, remote), originalSquareScan(remote));
  assert.equal(remoteBucketReads, 0, "proved-out-of-range routes never scan empty street buckets");
  // The same occupied-cell bound must also skip empty *inner* rings when
  // there is a real reachable node further out. The original nearest node,
  // scanned distance and tie rule remain the reference, never a new guess.
  remoteBucketReads = 0;
  const withinRange = { eastM: 500, northM: 500 };
  assert.equal(nearestNode(boundedGraph, withinRange), originalSquareScan(withinRange));
  assert.ok(remoteBucketReads < 1500,
    "provably empty inner rings are not probed before reaching a real street");
  for (const offset of [
    { eastM: 0, northM: 0 },
    { eastM: 30, northM: -15 },
    { eastM: -126, northM: 130 },
    { eastM: 300, northM: 310 },
    { eastM: -300, northM: -290 },
    { eastM: 500, northM: 500 },
  ]) {
    assert.equal(nearestNode(boundedGraph, offset), originalSquareScan(offset),
      "bounded perimeter traversal must retain the original nearest vertex and deterministic ties");
  }
});



test("resident street connectors indexed frontier exactly matches insertion-order route score selection", () => {
  const frontier = new StableStreetFrontier();
  const reference: { id: number; score: number }[] = [];
  const put = (id: number, score: number) => {
    const entry = reference.find(item => item.id === id);
    if (entry) entry.score = score;
    else reference.push({ id, score });
    frontier.set(id, score);
    assert.equal(frontier.size, reference.length);
  };
  const take = () => {
    let best = 0;
    for (let i = 1; i < reference.length; i++)
      if (reference[i].score < reference[best].score) best = i;
    const expected = reference.splice(best, 1)[0].id;
    assert.equal(frontier.take(), expected, "exact prior strict-less tie and re-open order");
    assert.equal(frontier.size, reference.length);
  };
  // Deterministic sequence exercises equal scores, decreasing/increasing
  // existing scores, arbitrary reopenings and many heap index exchanges.
  for (let step = 0; step < 800; step++) {
    const id = (step * 17 + 3) % 41;
    const score = (step * 23) % 19;
    put(id, score);
    if (step % 3 === 0) take();
  }
  while (reference.length) take();
  assert.throws(() => frontier.take(), RangeError);
});

test("resident street connectors preserve sparse-grid legal picks without changing blocked routes", () => {
  const cell = 12, nodes = [
    { eastM: 300, northM: 0 }, { eastM: 306, northM: 0 },
    { eastM: 307, northM: 0 }, { eastM: 310, northM: 0 },
    ...Array.from({ length: 36 }, (_, i) => ({ eastM: 1000 + i * 48, northM: -1200 - i * 72 })),
  ];
  const grid = new Map<string, number[]>();
  nodes.forEach((point, id) => {
    const key = `${Math.floor(point.eastM / cell)}/${Math.floor(point.northM / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
  });
  const origin = { eastM: 0, northM: 0 }, graph = { nodes, grid, cell };
  assert.equal(nearestNode(graph, origin), 0, "far seeded road still uses the same closest vertex");
  assert.equal(nearestLegalStreetNode(graph, origin, (_from, to) => to.eastM >= 306), 1,
    "sparse occupied-bucket iteration preserves legal distance/id order");
  assert.equal(nearestLegalStreetNode(graph, origin, () => false), -1,
    "skipping empty cells never invents a legal street approach");
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

test("resident street connectors at dense SEED junctions find later legal nodes without wall shortcuts", () => {
  const cell = 12, from = { eastM: 0, northM: 0 };
  // The nine nearest approaches terminate across a blocked wall or water
  // strip; a tenth node is still within the existing nearest + 24m radius.
  const nodes = Array.from({ length: 24 }, (_, i) => ({ eastM: i + 1, northM: 0 })),
    grid = new Map<string, number[]>();
  nodes.forEach((node, id) => {
    const key = `${Math.floor(node.eastM / cell)}/0`;
    grid.set(key, [...(grid.get(key) ?? []), id]);
  });
  const graph = { nodes, grid, cell }, legalNode = nodes[9];
  let checked = 0;
  assert.equal(nearestLegalStreetNode(graph, from, (_, candidate) => {
    checked++;
    return candidate === legalNode;
  }), 9, "a verified tenth-nearest, still-local street is not a fabricated blocked route");
  assert.ok(checked <= 17, "nearest node plus at most sixteen alternatives keep resident queries bounded");
  let blockedChecks = 0;
  assert.equal(nearestLegalStreetNode(graph, from, () => {
    blockedChecks++;
    return false;
  }), -1, "a failed real ground/gate check cannot turn proximity into a lawful path");
  assert.ok(blockedChecks <= 17, "even a fully blocked dense junction cannot trigger an unbounded scan");
});

test("resident streets attach: disconnected SEED topology cannot produce a lawful A-star route", () => {
  // Topology overapproximates physical reachability: removing water, blocked
  // edges or forbidden enclosures cannot create a new street connection.
  const edges = [[1], [0, 2], [1], [4], [3], [], [7], [6]] as const;
  const components = streetTopologyComponents(edges);
  assert.deepEqual([...components], [0, 0, 0, 3, 3, 5, 6, 6],
    "every connected street has the stable lowest-index component label");
  const canReach = (start: number, goal: number, deny: (a: number, b: number) => boolean) => {
    const visited = new Set([start]), stack = [start];
    while (stack.length) {
      const next = stack.pop()!;
      if (next === goal) return true;
      for (const neighbor of edges[next])
        if (!deny(next, neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
    }
    return false;
  };
  for (let from = 0; from < edges.length; from++)
    for (let to = 0; to < edges.length; to++)
      for (const denied of [
        (_a: number, _b: number) => false,
        (a: number, b: number) => a === 1 && b === 2 || a === 2 && b === 1,
        (a: number, b: number) => (a + b) % 3 === 0,
      ]) {
        if (components[from] !== components[to])
          assert.equal(canReach(from, to, denied), false,
            "no subset of the SEED street edges can connect different components");
      }
  assert.notEqual(components[2], components[3],
    "two physically separate neighborhoods do not require an expensive failed A-star search");
  assert.equal(streetTopologyComponents([]).length, 0,
    "a streetless settlement retains its original no-street behavior");
});

test("civilian midnight replay is gated: SEED standing radii conservatively prove late commutes", () => {
  const from = { eastM: 0, northM: 0 }, to = { eastM: 260, northM: 0 };
  // Every real standing slot is within four SEED area radii of its anchor.
  // A positive proof must survive even the closest permitted displacement.
  assert.equal(provablyLateWithStandingBounds(from, to, 20, 30, 65), true,
    "even the closest legal slots are farther than the available walk");
  for (const a of [-20, -10, 0, 10, 20])
    for (const b of [-30, -15, 0, 15, 30]) {
      const actualFrom = { eastM: a, northM: 0 },
        actualTo = { eastM: to.eastM + b, northM: 0 };
      assert.equal(provablyLateWithoutStreetSearch(actualFrom, actualTo, 65), true,
        "all allowed exact slots inherit the positive lower-bound proof");
    }
  assert.equal(provablyLateWithStandingBounds(from, to, 150, 150, 65), false,
    "overlapping possible ground slots remain uncertain and require exact routing");
  assert.equal(provablyLateWithStandingBounds(from, from, 0, 0, 20), false,
    "a stationary resident cannot be declared late from a nonzero-distance proof");
  assert.equal(provablyLateWithStandingBounds(from, to, -1, 5, 65), false,
    "invalid standing-radius bounds cannot authorize an early at-risk classification");
  assert.equal(provablyLateWithStandingBounds(from, to, Infinity, 0, 65), false,
    "unbounded displacements never bypass the physical route search");
});

test("civilian midnight replay is gated: a later impossible deadline skips every costly street search", () => {
  // The baseline checks each individual route before advancing. The new proof
  // pass can reorder only *mathematical impossibility*, not authorize a route.
  const at = (x: number) => ({ eastM: x, northM: 0 });
  for (const size of [1, 2, 3, 5, 9])
    for (let late = -1; late < size; late++)
      for (let blocked = -1; blocked < size; blocked++) {
        const legs = Array.from({ length: size }, (_, index) => ({
          from: at(index * 8),
          to: at(index * 8 + (index === late ? 800 : 4)),
          remainingSeconds: index === late ? 3 : 3600,
        }));
        const oldVerdict = (() => {
          for (let i = 0; i < legs.length; i++)
            if (provablyLateWithoutStreetSearch(legs[i].from, legs[i].to, legs[i].remainingSeconds) ||
                unfinishedOrBlockedOvernightReturn(i === blocked ? null :
                  [legs[i].from, legs[i].to], legs[i].remainingSeconds))
              return true;
          return false;
        })();
        let searched = 0;
        const preflight = routineHasProvablyLateLeg(legs);
        const newVerdict = preflight || legs.some((leg, i) => {
          searched++;
          return unfinishedOrBlockedOvernightReturn(i === blocked ? null :
            [leg.from, leg.to], leg.remainingSeconds);
        });
        assert.equal(newVerdict, oldVerdict,
          `same lawful overnight-risk verdict with ${size} legs, late=${late}, blocked=${blocked}`);
        if (late >= 0) {
          assert.equal(preflight, true, "an impossible later leg is sufficient physical proof");
          assert.equal(searched, 0, "no street search needed when any leg is provably too late");
        } else {
          assert.equal(preflight, false, "uncertain routes must retain their full physical search");
        }
      }
});

test("continuous walking segments reject interior water or blocked cuts without endpoint-only approval", () => {
  const start = { eastM: 0, northM: 0 }, goal = { eastM: 12, northM: 0 };
  assert.equal(continuousWalkableOffsetSegment(start, goal, point => point.eastM < 5 || point.eastM > 7), false,
    "walkable endpoints cannot legalize an impassable middle crossing");
  assert.equal(continuousWalkableOffsetSegment(start, goal, point => point.northM === 0), true,
    "an unobstructed straight local segment remains eligible");
  assert.equal(continuousWalkableOffsetSegment(goal, start, point => point.eastM < 5 || point.eastM > 7), false,
    "crossing legality cannot depend on direction");
  // A one-metre-deep water/cut strip lies precisely between the old 2 m
  // probes (x=0,2,...). Endpoints are valid; the interior must still block.
  const narrowCut = (point: typeof start) => point.eastM < .75 || point.eastM > 1.25;
  assert.equal(narrowCut(start), true);
  assert.equal(narrowCut(goal), true);
  assert.equal(continuousWalkableOffsetSegment(start, goal, narrowCut), false,
    "an unbridged one-metre obstacle cannot be skipped by coarse sampling");
  assert.equal(continuousWalkableOffsetSegment(goal, start, narrowCut), false,
    "reverse travel cannot bypass the same narrow physical crossing");
});

test("continuous walking segments reject long routes early without skipping any one-metre crossing", () => {
  const origin = { eastM: 0, northM: 0 }, destination = { eastM: 3200, northM: 0 };
  let calls = 0;
  assert.equal(continuousWalkableOffsetSegment(origin, destination, point => {
    calls++;
    return point.eastM < 1450 || point.eastM > 1750;
  }), false, "a large unbridged cut must reject the exact SEED corridor");
  assert.ok(calls < 100, "a blocked long candidate must not trigger thousands of expensive final-surface checks");

  let visited = new Set<number>();
  assert.equal(continuousWalkableOffsetSegment(origin, destination, point => {
    visited.add(point.eastM);
    return true;
  }), true);
  assert.equal(visited.size, 3201, "an accepted route must still validate every original 1 m position");
  const narrowCut = (point: typeof origin) => point.eastM !== 1573;
  assert.equal(continuousWalkableOffsetSegment(origin, destination, narrowCut), false,
    "a single-metre water gap between the coarse probes must still block travel");
  assert.equal(continuousWalkableOffsetSegment(destination, origin, narrowCut), false,
    "reverse travel must not bypass the identical narrow cut");
});

test("medium blocked overnight detours reject early but still require every legal metre", () => {
  const start = { eastM: 0, northM: 0 }, end = { eastM: 96, northM: 0 };
  let checked = 0;
  assert.equal(continuousWalkableOffsetSegment(start, end, point => {
    checked++;
    return point.eastM < 44 || point.eastM > 52;
  }), false, "a real blocked middle cut must reject an off-street detour");
  assert.ok(checked <= 16, "a medium blocked detour must not incur its full metre scan");
  const accepted = new Set<number>();
  assert.equal(continuousWalkableOffsetSegment(start, end, point => {
    accepted.add(point.eastM);
    return true;
  }), true);
  assert.equal(accepted.size, 97, "a permitted 96 m walk checks all 97 exact original samples");
  assert.equal(continuousWalkableOffsetSegment(start, end, point => point.eastM !== 47), false,
    "one-metre water missed by early probes must still prevent passage");
  assert.equal(continuousWalkableOffsetSegment(end, start, point => point.eastM !== 47), false,
    "reversing a medium corridor cannot legalize the same blocked metre");
});

test("continuous walking segments prioritize original central cut without losing any legal metre", () => {
  const start = { eastM: 0, northM: 0 }, end = { eastM: 96, northM: 0 };
  let checks = 0;
  assert.equal(continuousWalkableOffsetSegment(start, end, point => {
    checks++;
    return point.eastM < 44 || point.eastM > 52;
  }), false, "a real central cut still blocks the original exact corridor");
  assert.equal(checks, 1, "a central blocked stride position needs only one final-surface probe");
  for (const length of [33, 34, 96, 97, 3200]) {
    const visited: number[] = [], count = Math.ceil(length);
    assert.equal(continuousWalkableOffsetSegment(start, { eastM: length, northM: 0 }, point => {
      visited.push(Math.round(point.eastM * count / length));
      return true;
    }), true);
    assert.deepEqual(visited.sort((a, b) => a - b),
      Array.from({ length: count + 1 }, (_, i) => i),
      "all original one-metre-or-finer positions must be checked exactly once");
  }
  assert.equal(continuousWalkableOffsetSegment(start, end,
    point => point.eastM !== 47), false,
    "a narrow off-stride cut still rejects a walk rather than becoming an invented crossing");
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
  assert.equal(residentWalkableSurface({ ...surface, traversal: "open" }), false,
    "a height field without canonical bridge traversal cannot authorize the river crossing");
  assert.equal(residentWalkableSurface({ ...surface, surfaceHeight: surface.deckHeight! + 1 }), false,
    "a resident cannot stand on an asserted deck at a different physical walking elevation");
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

  // Exercise the SAME continuous resident segment validator against this
  // actual Campaign-SEED road/river crossing, rather than a mocked bridge.
  // Convert the canonical tangent to a physically measured four-metre walk.
  const tangent = finalSurfaceEvidenceAnchors().bridgeTangent,
    scale = sourceUnitsPerMetreAt(bridge.z),
    sourcePerMetre = 1 / Math.hypot(tangent.x / scale.x, tangent.z / scale.z),
    pointSurface = (metres: number) => finalSurfaceAt(
      wrapSourceX(bridge.x + tangent.x * sourcePerMetre * metres),
      bridge.z + tangent.z * sourcePerMetre * metres),
    from = { eastM: -2, northM: 0 }, to = { eastM: 2, northM: 0 };
  assert.ok(continuousWalkableOffsetSegment(from, to,
    point => residentWalkableSurface(pointSurface(point.eastM))),
    "the actual bridge deck admits a continuous physical resident walking segment");
  assert.equal(continuousWalkableOffsetSegment(from, to,
    point => residentWalkableSurface(Math.abs(point.eastM) < .51
      ? { ...pointSurface(point.eastM), deckHeight: null } : pointSurface(point.eastM))), false,
    "the identical river segment cannot be traversed after removing its real deck");
});

test("real-road resident connector rejects absent deck and never cuts across a water gap", () => {
  // This is a unit contract for the route adapter; it is NOT the separate
  // real-SEED same-person bridge-day acceptance fixture.
  const road = [
    {eastM:0,northM:0}, {eastM:10,northM:0},
    {eastM:20,northM:0}, {eastM:30,northM:0},
  ], from = {eastM:0,northM:-3}, to = {eastM:30,northM:3};
  const legal = (deck: boolean) => (a: typeof from, b: typeof from) =>
    continuousWalkableOffsetSegment(a,b,point => deck ||
      point.eastM < 13 || point.eastM > 17);
  const valid = validatedResidentRoadPolyline(from,to,road,legal(true));
  assert.ok(valid && valid.length >= 4, "both physical connectors and original road corners are retained");
  assert.deepEqual(valid![0], from);
  assert.deepEqual(valid!.at(-1), to);
  assert.equal(validatedResidentRoadPolyline(from,to,road,legal(false)),null,
    "no deck: even the real-road centreline is not permission to cross water");
  assert.equal(validatedResidentRoadPolyline(from,to,road,()=>false),null,
    "a disconnected real road never overrides enclosure or ground authority");
  const reverse = validatedResidentRoadPolyline(to,from,road,legal(true));
  assert.deepEqual(reverse, [...valid!].reverse(),
    "road directions produce one identical canonical legal walk");
  assert.equal(validatedResidentRoadPolyline(from,to,road,legal(true),2),null,
    "a missing legal street-to-road connector cannot be skipped");
  assert.equal(validatedResidentRoadPolyline(from,to,road,legal(true),450,20),null,
    "bounded evidence cannot accept a journey longer than its explicit budget");
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

test("unconnected town doors cannot shortcut through dry open ground", () => {
  const p = (eastM: number, northM: number) => ({ eastM, northM }),
    border = [p(-20, -20), p(20, -20), p(20, 20), p(-20, 20)],
    gate = p(20, 0), gates = [gate];
  assert.equal(exteriorGroundCorridor(p(-10, 0), p(10, 0), border, gates), false,
    "both inside town must use connected validated streets, not a fallback chord");
  assert.equal(exteriorGroundCorridor(p(10, 0), p(-10, 0), border, gates), false,
    "direction cannot legalize an interior shortcut");
  assert.equal(exteriorGroundCorridor(p(10, 0), p(40, 0), border, gates), false,
    "a dry straight line through a valid gate is not proof of a connected street approach");
  assert.equal(exteriorGroundCorridor(p(40, 0), p(10, 0), border, gates), false,
    "return journeys must also connect the gate to the interior street network");
  assert.equal(exteriorGroundCorridor(p(10, 0), gate, border, gates), false,
    "the interior approach to the gate cannot bypass missing streets");
  assert.equal(exteriorGroundCorridor(gate, p(40, 0), border, gates), true,
    "a reached canonical gate permits an independently lawful exterior corridor");
  assert.equal(exteriorGroundCorridor(p(40, 0), gate, border, gates), true,
    "the gate-to-exterior link is reversible");
  assert.equal(exteriorGroundCorridor(p(-20, 0), p(-40, 0), border, [p(-20, 0)]), true,
    "a gate on the polygon's opposite boundary remains eligible in both directions");
  assert.equal(exteriorGroundCorridor(p(-30, 0), p(30, 0), border, gates), true,
    "an exterior chord still needs the independent wall/gate and surface predicates");
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

test("same-door indoor work needs no invented street commute", () => {
  const point = { eastM: 8, northM: -3 }, stationary = [point, point],
    arrived = timedWalkOnPath(stationary, 0);
  assert.equal(arrived.progress, 1);
  assert.equal(arrived.durationSeconds, 0);
  assert.equal(arrived.lengthM, 0);
  assert.deepEqual(arrived.offset, point);
  assert.deepEqual(walkWindowOnPath(stationary, 0, 24), [point, point]);

  const village = villages[0], index = Array.from({ length: populationOf(village) }, (_, i) => i)
    .find(i => {
      const f = residentFoundationAt(village, i);
      return f.role === "artisan" && f.ageGroup === "adult" &&
        f.workOffset === f.homeOffset && !!resolvedSettlementHomeDoorFor(village, i);
    });
  assert.notEqual(index, undefined, "fixture requires a real artisan living and working through one legal door");
  const f = residentFoundationAt(village, index!),
    planDay = localDayIndex(tickAtLocalTime(WORKDAY, 12 * HOUR, village.canonicalPosition.lon), village.canonicalPosition.lon),
    weekday = localWeekday(tickAtLocalTime(WORKDAY, 12 * HOUR, village.canonicalPosition.lon), village.canonicalPosition.lon),
    plan = dailyPlan({ code: f.code, role: f.role, ageGroup: f.ageGroup, guardShift: f.guardShift }, f.traits, planDay, weekday),
    start = plan.find(step => step.kind === "work" && step.anchor === "work");
  assert.ok(start, "artisan has a deterministic work start");
  const resident = residentAt(village, index!, tickAtLocalTime(WORKDAY, start.start + 1, village.canonicalPosition.lon)),
    doorway = resolvedSettlementHomeDoorFor(village, index!);
  assert.ok(resident.grounded && doorway, "working state is grounded at a verified house door");
  assert.equal(resident.activity, "work", "stationary home-work transition is not a fictional walk");
  assert.equal(resident.travelProgress, undefined, "no one-minute phantom commute");
  assert.ok(greatCircleDistance(resident.position, sourceToLonLat(doorway.x, doorway.z)) < 0.1,
    "actual artisan stays at the same owned entrance");
});

test("prior-day earliest-arrival proof never skips a possibly lawful timely route", () => {
  const at = { eastM: 0, northM: 0 };
  assert.equal(provablyLateWithoutStreetSearch(at, at, -1), false,
    "stationary same-door actions remain valid even at zero remaining time");
  assert.equal(provablyLateWithoutStreetSearch(at, { eastM: 1, northM: 0 }, 59), true,
    "nonzero trips require the same minimum 60 fantasy seconds as timed walking");
  assert.equal(provablyLateWithoutStreetSearch(at, { eastM: 1, northM: 0 }, 60), false);
  for (const to of [
    { eastM: 0, northM: 0 },
    { eastM: 1, northM: 0 },
    { eastM: 60, northM: 0 },
    { eastM: 700, northM: 300 },
    { eastM: -500, northM: -900 },
  ]) for (const remaining of [-1, 0, 30, 59, 60, 120, 800, 3600]) {
    const straight = [at, to];
    if (provablyLateWithoutStreetSearch(at, to, remaining))
      assert.ok(unfinishedOrBlockedOvernightReturn(straight, remaining),
        "proven-late optimistic straight path must match actual timed walker");
  }
  assert.equal(provablyLateWithoutStreetSearch(at, { eastM: 100, northM: 0 }, 500), false,
    "all potentially timely routes retain full final-surface/street/bridge checking");
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

  // A shared service name and a nearby-query hit never certify THIS plot.
  const centre = { x: 400, z: 200 }, metric = sourceUnitsPerMetreAt(centre.z),
    renderedInn = { ...centre, widthM: 8, depthM: 12, yawRad: Math.PI / 2 };
  assert.equal(residentInsideRenderedService(centre, renderedInn), true,
    "the actual rendered service building centre can report its occupant");
  assert.equal(residentInsideRenderedService(
    { x: centre.x + 3 * metric.x, z: centre.z }, renderedInn), true,
    "footprint follows the rendered yaw, not an axis-aligned search radius");
  assert.equal(residentInsideRenderedService(
    { x: centre.x + 8 * metric.x, z: centre.z }, renderedInn), false,
    "a nearby resident outside the exact rotated plot must not be reported inside");
  assert.equal(residentInsideRenderedService(
    { x: centre.x, z: centre.z + 6 * metric.z }, renderedInn), false,
    "a neighbouring same-service plot is not the clicked building");
  assert.equal(residentInsideRenderedService(centre, { ...centre }), false,
    "missing geometry never certifies an indoor occupant");
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
        // The rendered door is at local (0, +depth/2), rotated by the
        // actual house yaw, NOT a ray towards a possibly perpendicular street.
        const metric = sourceUnitsPerMetreAt(feature.z),
          halfDepthM = (feature.depthM ?? 0) * .5,
          frontX = wrapSourceX(feature.x + Math.sin(feature.yawRad ?? 0) * metric.x * halfDepthM),
          frontZ = feature.z + Math.cos(feature.yawRad ?? 0) * metric.z * halfDepthM;
        assert.ok(halfDepthM > 0, "real rendered home has physical wall depth");
        assert.ok(Math.hypot(wrapSourceX(door.x - frontX) / metric.x, (door.z - frontZ) / metric.z) < .03,
          `${resident.code}: canonical entrance must be on the actual rendered front wall, not a side street`);
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

test("selected guard status distinguishes physical attendance from off-shift assignment", () => {
  const place = villages[0], lon = place.canonicalPosition.lon,
    daytime = tickAtLocalTime(WORKDAY, 9 * HOUR, lon),
    nighttime = tickAtLocalTime(WORKDAY, 21 * HOUR, lon),
    dayGuard = residentAt(place, 6, daytime),
    nightGuard = residentAt(place, 7, nighttime),
    dayRoster = guardCoverageAt(place, daytime)[0].residentCodes,
    nightRoster = guardCoverageAt(place, nighttime)[0].residentCodes;
  assert.ok(dayRoster.includes(dayGuard.code) && nightRoster.includes(nightGuard.code),
    "real assigned guards arrive at the gate before the inspector reports them present");
  assert.equal(residentGuardPresence(dayGuard, daytime, place, dayRoster), "at-post");
  assert.equal(residentGuardPresence(nightGuard, nighttime, place, nightRoster), "at-post");
  assert.equal(residentGuardPresence(dayGuard, nighttime, place, nightRoster), "off-duty",
    "an off-shift guard must not be presented as a missing watchman");
  assert.equal(residentGuardPresence(nightGuard, daytime, place, dayRoster), "off-duty");
  assert.equal(residentGuardPresence(dayGuard, daytime, place, []), "absent",
    "scheduled duty alone is never a claim of physical presence");
});

test("late-closing innkeepers retain their actual position through local midnight", () => {
  const trimmed = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(trimmed, "retain the real road-trimmed village fixture");
  // Innkeepers close at 22:30 local time. Preserve the actual position reached
  // or blocked on yesterday's journey rather than adopting scheduled home.
  for (const place of [villages[0], trimmed, cities[0]]) {
    const lon = place.canonicalPosition.lon,
      beforeTick = tickAtLocalTime(WORKDAY, 24 * HOUR - 1, lon),
      midnightTick = tickAtLocalTime(WORKDAY + 1, 0, lon),
      before = residentAt(place, 0, beforeTick),
      midnight = residentAt(place, 0, midnightTick),
      next = residentAt(place, 0, midnightTick + 1);
    assert.equal(before.role, "innkeeper", "the fixture must exercise late closing, not a guard");
    assert.equal(midnight.code, before.code, "midnight cannot change SEED identity or home");
    assert.equal(midnight.homeEntrance, before.homeEntrance);
    assert.equal(midnight.workplace, before.workplace);
    assert.ok(greatCircleDistance(before.position, midnight.position) < 3,
      `${before.code}: midnight jumped away from the actual prior-day position`);
    assert.ok(greatCircleDistance(midnight.position, next.position) < 3,
      `${before.code}: the first next-day second cannot teleport`);
    assert.deepEqual(residentAt(place, 0, midnightTick), midnight,
      "direct time catch-up reproduces one canonical midnight state");
    if (before.route.startsWith("BLOCKED:"))
      assert.ok(midnight.route.startsWith("BLOCKED:") ||
        greatCircleDistance(before.position, midnight.position) < 1,
        "an impassable return must not fabricate an arrival");
  }
});

test("civilian midnight replay is gated by an actual blocked or overlong return", () => {
  const leg = [{ eastM: 0, northM: 0 }, { eastM: 120, northM: 0 }];
  assert.equal(unfinishedOrBlockedOvernightReturn(null, 86_400), true,
    "no connector cannot be called a successful homecoming");
  assert.equal(unfinishedOrBlockedOvernightReturn(leg, 10), true,
    "not enough Fantasy Time to walk the legal route before midnight");
  assert.equal(unfinishedOrBlockedOvernightReturn(leg, 300), false,
    "a completed short homecoming avoids full civilian history replay");
  assert.equal(unfinishedOrBlockedOvernightReturn([leg[0], leg[0]], 1), false,
    "same-door arrivals never need a phantom commute");
});

test("civilian midnight replay is gated: overnight deadline-only check agrees with the authoritative timed walker", () => {
  const origin = { eastM: 0, northM: 0 };
  const paths: { eastM: number; northM: number }[][] = [
    [], [origin], [origin, origin],
    [origin, { eastM: 1, northM: 0 }],
    [origin, { eastM: 30, northM: 40 }, { eastM: 180, northM: 40 }],
    [origin, { eastM: 80, northM: -70 }, { eastM: 80, northM: 0 }, origin],
  ];
  for (const path of paths)
    for (const remaining of [-Infinity, -1, 0, 59.9999999, 60, 60.0000001, 120, 300, 3600, Infinity, NaN])
      assert.equal(unfinishedOrBlockedOvernightReturn(path, remaining),
        timedWalkOnPath(path, remaining).progress < 1,
        `deadline-only decision differs from authoritative walker: ${JSON.stringify({ path, remaining })}`);
});

test("ordinary civilian identity and real ground persist across local midnight", () => {
  const trimmed = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(trimmed, "retain the physically trimmed road village");
  for (const place of [villages[0], trimmed, cities[0]]) {
    const lon = place.canonicalPosition.lon,
      beforeTick = tickAtLocalTime(WORKDAY, 24 * HOUR - 1, lon),
      midnightTick = tickAtLocalTime(WORKDAY + 1, 0, lon);
    for (const index of [16, 25, 42, 70]) {
      const previous = residentAt(place, index, beforeTick),
        midnight = residentAt(place, index, midnightTick),
        next = residentAt(place, index, midnightTick + 1);
      assert.ok(previous.role !== "guard" && index >= 6, "probe ordinary seeded citizens, not the service roster");
      assert.equal(midnight.code, previous.code, "day rollover cannot replace canonical civilian identity");
      assert.equal(midnight.homeEntrance, previous.homeEntrance, "owned door is canonical across midnight");
      assert.equal(midnight.workplace, previous.workplace, "worksite is canonical across midnight");
      assert.ok(greatCircleDistance(previous.position, midnight.position) < 3,
        `${previous.code}: local midnight cannot teleport from the actual last position`);
      assert.ok(greatCircleDistance(midnight.position, next.position) < 3,
        `${previous.code}: following second must be physically continuous`);
      assert.deepEqual(residentAt(place, index, midnightTick), midnight,
        "direct-time reconstruction retains exactly the same physical facts");
      if (!previous.grounded)
        assert.ok(!midnight.grounded || midnight.route.startsWith("BLOCKED:"),
          "unresolved physical ground must never fabricate successful arrival");
    }
  }
});

test("a blocked leg never becomes a fabricated civilian work origin across local midnight", () => {
  // Find an actual SEED resident whose first work departure is physically
  // blocked. Observe the last reached point immediately BEFORE that failed
  // leg, then verify that no scheduled work destination replaces it.
  let witness: { place: (typeof villages)[number]; index: number; day: number; departureTick: number } | undefined;
  for (const place of villages.slice(0, 12)) {
    const lon = place.canonicalPosition.lon,
      day = [1, 2, 3, 4, 5, 6, 7].find(d =>
        localWeekday(tickAtLocalTime(d, 12 * HOUR, lon), lon) !== 6)!;
    for (let index = 6; index < Math.min(populationOf(place), 80); index++) {
      const foundation = residentFoundationAt(place, index);
      if (foundation.role === "guard" || foundation.workplace === foundation.homeEntrance) continue;
      const blocked = residentAt(place, index, tickAtLocalTime(day, 9 * HOUR, lon));
      if (!(blocked.grounded && blocked.route.startsWith("BLOCKED:") &&
          blocked.route.includes(" → ") && blocked.route.includes(foundation.workplace))) continue;
      const plan = dailyPlan({ code: foundation.code, role: foundation.role,
        ageGroup: foundation.ageGroup, guardShift: foundation.guardShift }, foundation.traits,
        localDayIndex(tickAtLocalTime(day, 9 * HOUR, lon), lon),
        localWeekday(tickAtLocalTime(day, 9 * HOUR, lon), lon));
      const departure = plan.find((step, i) => i > 0 && step.anchor === "work" &&
        step.anchor !== plan[i - 1].anchor && step.start <= 9 * HOUR);
      if (!departure) continue;
      const departureTick = tickAtLocalTime(day, departure.start, lon),
        reached = residentAt(place, index, departureTick - 1),
        failed = residentAt(place, index, departureTick);
      if (!failed.grounded || !failed.route.startsWith("BLOCKED:") ||
          greatCircleDistance(reached.position, failed.position) >= .1) continue;
      witness = { place, index, day, departureTick };
      break;
    }
    if (witness) break;
  }
  assert.ok(witness, "SEED must exhibit a grounded ordinary civilian with a failed physical work departure");
  const { place, index, day, departureTick } = witness, lon = place.canonicalPosition.lon,
    foundation = residentFoundationAt(place, index),
    reached = residentAt(place, index, departureTick - 1),
    blockedStart = residentAt(place, index, departureTick),
    morning = residentAt(place, index, tickAtLocalTime(day, 9 * HOUR, lon)),
    midnightTick = tickAtLocalTime(day + 1, 0, lon),
    before = residentAt(place, index, midnightTick - 1),
    midnight = residentAt(place, index, midnightTick),
    after = residentAt(place, index, midnightTick + 1);
  assert.equal(blockedStart.route, `BLOCKED: ${reached.route} → ${foundation.workplace}`,
    "blocked work departure records the actual last reached site, not an assumed work origin");
  assert.ok(greatCircleDistance(blockedStart.position, reached.position) < .1,
    "Simulation leaves the physical resident at their last legally reached position");
  assert.ok(morning.grounded && morning.route.startsWith("BLOCKED:") &&
    morning.task.startsWith("Blocked:"), `${morning.name}: earlier worksite physically unreachable`);
  assert.ok(greatCircleDistance(morning.position, reached.position) < .1,
    "a blocked morning never fabricates a position at the unreachable worksite");
  assert.equal(morning.travelProgress, undefined, "blocked commute cannot report completed travel");
  assert.equal(before.code, morning.code, "earlier failed leg must belong to the same named civilian");
  assert.equal(midnight.name, morning.name);
  assert.equal(midnight.code, morning.code);
  assert.equal(midnight.homeEntrance, morning.homeEntrance);
  assert.equal(midnight.workplace, morning.workplace);
  assert.ok(greatCircleDistance(before.position, midnight.position) < 3,
    `${morning.name} (${morning.code}): local midnight invented movement after blocked work approach`);
  if (before.route.startsWith("BLOCKED:"))
    assert.ok(greatCircleDistance(before.position, midnight.position) < .1,
      "a physically blocked overnight leg preserves the exact last reached point");
  assert.ok(greatCircleDistance(midnight.position, after.position) < 3,
    `${morning.name} (${morning.code}): next-second physical continuity violated`);
  assert.deepEqual(residentAt(place, index, midnightTick), midnight,
    `${morning.name}: direct absolute Fantasy Time replay must equal current state`);
});

test("fixed primary service workers keep real owned-door positions through local midnight", () => {
  const trimmed = villages.find(place => place.code.includes("/CITY/6/VILLAGE/1"));
  assert.ok(trimmed, "retain the real road-trimmed village");
  // Only six canonical service indices are replayed; thousands of other
  // civilians in a city stay on the inexpensive analytical path.
  const serviceRoles = ["innkeeper", "merchant", "blacksmith", "farmer", "butcher", "guard-officer"];
  for (const place of [villages[0], trimmed, cities[0]]) {
    const lon = place.canonicalPosition.lon,
      beforeTick = tickAtLocalTime(WORKDAY, 24 * HOUR - 1, lon),
      midnightTick = tickAtLocalTime(WORKDAY + 1, 0, lon);
    for (let index = 0; index < serviceRoles.length; index++) {
      const before = residentAt(place, index, beforeTick),
        midnight = residentAt(place, index, midnightTick),
        next = residentAt(place, index, midnightTick + 1);
      assert.equal(before.role, serviceRoles[index], "the fixture must exercise a fixed service worker");
      assert.equal(midnight.code, before.code, "crossing a date never changes the SEED character");
      assert.equal(midnight.homeEntrance, before.homeEntrance, "owned doorway persists");
      assert.equal(midnight.workplace, before.workplace, "work assignment persists");
      assert.ok(greatCircleDistance(before.position, midnight.position) < 3,
        `${before.code}: midnight must retain the actual previous position`);
      assert.ok(greatCircleDistance(midnight.position, next.position) < 3,
        `${before.code}: the next fantasy second cannot teleport`);
      assert.deepEqual(residentAt(place, index, midnightTick), midnight,
        "direct-time reconstruction must reproduce the same physical state");
    }
  }
});

test("both guard shifts preserve real gate/home positions at local midnight", () => {
  const fixtures = [villages[0], villages.find(p => p.code.includes("/CITY/6/VILLAGE/1"))!, cities[0]];
  for (const place of fixtures) {
    const lon = place.canonicalPosition.lon,
      beforeTick = tickAtLocalTime(WORKDAY, 24 * HOUR - 1, lon),
      midnight = tickAtLocalTime(WORKDAY + 1, 0, lon);
    let index = 6;
    for (let gate = 0; gate < gateCountFor(place); gate++)
      for (let slot = 0; slot < guardsPerGateFor(place, gate); slot++)
        for (let shift = 0; shift < 2; shift++, index++) {
          const before = residentAt(place, index, beforeTick),
            after = residentAt(place, index, midnight),
            separation = greatCircleDistance(before.position, after.position);
          assert.equal(before.role, "guard");
          assert.equal(after.code, before.code, "midnight cannot replace a SEED watchman");
          assert.ok(separation < 3, `${before.code}: midnight displaced ${separation.toFixed(2)}m`);
          assert.deepEqual(residentAt(place, index, midnight), after,
            "absolute-time watch state must reproduce under direct catch-up");
          if (!before.grounded)
            assert.ok(after.route.startsWith("BLOCKED:"),
              "an unresolved watchman's home cannot become a legal midnight arrival");
        }
  }
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

test("elders share several nearby gardens while retaining town-square visits", () => {
  const place = cities[0], tick = tickAtLocalTime(WORKDAY, 10.5 * HOUR, place.canonicalPosition.lon), gardens = new Set<string>();
  let square = 0;
  for (let i = 0; i < populationOf(place); i++) {
    const f = residentFoundationAt(place, i);
    if (f.ageGroup !== "elder") continue;
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


test("real guard and fisherman outbound walking and owned-home returns use legal ground", () => {
  const fishermanPlace = villages.find(place => place.name === "Falconham");
  assert.ok(fishermanPlace, "the canonical Falconham fishing fixture must exist");
  const fixtures = [
    { place: villages[0], index: 6, workHour: 9, homeHour: 23.9, activity: "guard" },
    { place: villages[0], index: 7, workHour: 21, homeHour: 11, activity: "guard" },
    { place: fishermanPlace, index: 70, workHour: 15, homeHour: 23.9, activity: "work" },
  ] as const;
  let verifiedWalkingWindows = 0;
  for (const { place, index, workHour, homeHour, activity } of fixtures) {
    const lon = place.canonicalPosition.lon,
      seed = residentFoundationAt(place, index),
      door = resolvedSettlementHomeDoorFor(place, index);
    assert.ok(door, `${seed.code}: an owned legal doorway is required`);
    const home = residentAt(place, index, tickAtLocalTime(WORKDAY, homeHour * HOUR, lon)),
      work = residentAt(place, index, tickAtLocalTime(WORKDAY, workHour * HOUR, lon));
    assert.equal(home.code, seed.code);
    assert.equal(work.code, seed.code);
    assert.ok(home.grounded && home.indoors && home.route === seed.homeEntrance,
      `${seed.code}: return must reach its actual owned home, got ${home.task} / ${home.route}`);
    assert.ok(greatCircleDistance(home.position, sourceToLonLat(door.x, door.z)) < 0.05,
      `${seed.code}: the return destination is the resolved doorway, not an invented home`);
    assert.ok(work.grounded && work.activity === activity && !work.route.startsWith("BLOCKED:"),
      `${seed.code}: physical outbound arrival failed: ${work.task} / ${work.route}`);

    // Inspect only two bounded departure opportunities, never the population.
    const day = localDayIndex(tickAtLocalTime(WORKDAY, 12 * HOUR, lon), lon),
      weekday = localWeekday(tickAtLocalTime(WORKDAY, 12 * HOUR, lon), lon),
      plan = dailyPlan({ code: seed.code, role: seed.role, ageGroup: seed.ageGroup,
        guardShift: seed.guardShift }, seed.traits, day, weekday);
    const departures = plan.filter((step, i) => i > 0 &&
      step.anchor !== plan[i - 1].anchor && (step.anchor === "work" || step.anchor === "home"));
    for (const departure of departures.slice(0, 2)) {
      const walker = residentAt(place, index, tickAtLocalTime(WORKDAY, departure.start + 3, lon));
      if (walker.activity !== "commute") continue;
      const path = walker.walkAhead;
      assert.ok(path && path.length >= 2,
        `${seed.code}: a moving character must expose its canonical path, not an unchecked chord`);
      assert.ok(greatCircleDistance(walker.position, sourceToLonLat(path[0].x, path[0].z)) < .1,
        "actor movement begins at the Simulation's current physical position");
      let distance = 0;
      for (let j = 1; j < path.length; j++) {
        const first = path[j - 1], last = path[j],
          physicalM = greatCircleDistance(sourceToLonLat(first.x, first.z), sourceToLonLat(last.x, last.z));
        distance += physicalM;
        const steps = Math.max(1, Math.ceil(physicalM / 2));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps,
            surface = finalSurfaceAt(first.x + wrapSourceX(last.x - first.x) * t,
              first.z + (last.z - first.z) * t);
          assert.ok(residentWalkableSurface(surface),
            `${seed.code}: visible walking segment crosses unbridged water or illegal ground`);
        }
      }
      assert.ok(distance <= 24.1, `${seed.code}: one real-second path exceeds legal walking speed: ${distance}m`);
      verifiedWalkingWindows++;
    }
  }
  assert.ok(verifiedWalkingWindows >= 2, "real guard/fisherman departures must expose legal moving windows");
});

test("real guard and fisherman outbound: Falconham full gated workday reaches the owned door", () => {
  const place = villages.find(place => place.name === "Falconham");
  assert.ok(place, "retain the seeded outdoor fishing settlement");
  const index = 70, seed = residentFoundationAt(place, index), lon = place.canonicalPosition.lon,
    door = resolvedSettlementHomeDoorFor(place, index);
  assert.ok(door && seed.character.startsWith("fisherman"), "the subject has a rendered owned door and fishing trade");
  const localNoon = tickAtLocalTime(WORKDAY, 12 * HOUR, lon),
    day = localDayIndex(localNoon, lon), weekday = localWeekday(localNoon, lon),
    plan = dailyPlan({ code: seed.code, role: seed.role, ageGroup: seed.ageGroup,
      guardShift: seed.guardShift }, seed.traits, day, weekday),
    transitions = plan.filter((step, i) => i > 0 && step.anchor !== plan[i - 1].anchor);
  assert.equal(transitions[0]?.anchor, "work", "the observed journey starts from the owned home");
  assert.equal(transitions[transitions.length - 1]?.anchor, "home", "the last journey returns to the same owned door");
  const exterior = settlementExteriorFor(place),
    offset = (point: { x: number; z: number }) => {
      const ll = sourceToLonLat(point.x, point.z);
      return {
        eastM: normalizeLongitude(ll.lon - lon) * CANONICAL_PLANET_RADIUS * Math.max(1e-9, Math.abs(Math.cos(place.canonicalPosition.lat))),
        northM: (ll.lat - place.canonicalPosition.lat) * CANONICAL_PLANET_RADIUS,
      };
    },
    border = exterior.border.map(offset), gates = exterior.gates.map(offset);
  let walkedLegs = 0, gateCrossings = 0;
  for (const departure of transitions) {
    const first = residentAt(place, index, tickAtLocalTime(WORKDAY, departure.start, lon));
    assert.equal(first.code, seed.code, "one SEED character must make every leg");
    assert.equal(first.activity, "commute", `${seed.code}: physical leg to ${departure.anchor} must begin as a real walk`);
    assert.ok(first.travelDistanceM !== undefined && first.walkAhead,
      "an executable leg reports its full physical length and next walk path");
    // One Fantasy second walks one metre on a good road. Sample every 24
    // Fantasy seconds, exactly matching each exposed next-window distance.
    const duration = Math.max(60, first.travelDistanceM),
      budget = Math.min(300, Math.ceil(duration / 24) + 2);
    let arrived = false;
    for (let sample = 0; sample < budget; sample++) {
      const tick = tickAtLocalTime(WORKDAY, departure.start + sample * 24, lon),
        resident = residentAt(place, index, tick);
      if (resident.activity !== "commute") {
        assert.ok(resident.grounded && !resident.route.startsWith("BLOCKED:"),
          `${seed.code}: arrival at ${departure.anchor} cannot bypass ground or route authority`);
        arrived = true;
        break;
      }
      assert.ok(resident.grounded, `${seed.code}: an active walking actor must have legal ground`);
      const path = resident.walkAhead;
      assert.ok(path && path.length >= 2);
      assert.ok(greatCircleDistance(resident.position, sourceToLonLat(path[0].x, path[0].z)) < .1,
        "each physical segment begins at the current Simulation position");
      for (let i = 1; i < path.length; i++) {
        const from = path[i - 1], to = path[i],
          a = offset(from), b = offset(to);
        assert.ok(legalEnclosureSegment(a, b, border, gates),
          `${seed.code}: a path cannot cross the rendered wall outside a SEED gate`);
        if (!legalEnclosureSegment(a, b, border, [])) gateCrossings++;
        const distance = greatCircleDistance(sourceToLonLat(from.x, from.z), sourceToLonLat(to.x, to.z)),
          probes = Math.max(1, Math.ceil(distance));
        for (let k = 0; k <= probes; k++) {
          const t = k / probes;
          assert.ok(residentWalkableSurface(finalSurfaceAt(
            from.x + wrapSourceX(to.x - from.x) * t, from.z + (to.z - from.z) * t)),
          `${seed.code}: real route crosses water without a bridge deck or impassable ground`);
        }
      }
    }
    assert.ok(arrived, `${seed.code}: the full ${departure.anchor} leg must physically reach its stop`);
    walkedLegs++;
  }
  const work = residentAt(place, index, tickAtLocalTime(WORKDAY, 15 * HOUR, lon)),
    home = residentAt(place, index, tickAtLocalTime(WORKDAY, 23.9 * HOUR, lon));
  assert.ok(work.grounded && work.activity === "work", "the sampled trip must reach the actual fishing worksite");
  assert.ok(home.grounded && home.indoors && home.route === seed.homeEntrance,
    "the final trip must arrive at the same owned door, not a scheduled teleport");
  assert.ok(greatCircleDistance(home.position, sourceToLonLat(door.x, door.z)) < .05);
  assert.ok(walkedLegs >= 2, "the canonical working day contains an outward and a returning physical journey");
  assert.ok(gateCrossings >= 2,
    "the real outlying fisherman's trip must cross the SEED gate both ways; a route without gates cannot substitute");
});

test("one real Greyfield worker crosses its SEED gate and wet bridge to work and returns to the owned door", () => {
  // Proven by actual one-ID residentAt/workday witness; this is no made-up
  // position, fixture bridge, alternate worker or graph-only route preview.
  const place = villages.find(place => place.name === "Greyfield");
  assert.ok(place, "retain the existing canonical bridge-work village");
  const index = 15, seed = residentFoundationAt(place, index),
    door = resolvedSettlementHomeDoorFor(place, index),
    bridgeCode = seed.workplace.split("/MAINTENANCE/")[0],
    bridge = transportBridgeByCode(bridgeCode);
  assert.equal(seed.role, "laborer");
  assert.ok(door && bridge && seed.workplace.includes("/MAINTENANCE/BANK/"),
    "ordinary seeded worker's assigned job must be on the original real bridge far bank");
  const lon = place.canonicalPosition.lon, lat = place.canonicalPosition.lat,
    day = [1,2,3,4,5,6,7].find(d =>
      localWeekday(tickAtLocalTime(d,12*HOUR,lon),lon) !== 6)!,
    noon = tickAtLocalTime(day,12*HOUR,lon),
    plan = dailyPlan({
      code:seed.code, role:seed.role, ageGroup:seed.ageGroup,
      guardShift:seed.guardShift,
    },seed.traits,localDayIndex(noon,lon),localWeekday(noon,lon)),
    departures = plan.filter((step,i)=>i>0&&step.anchor!==plan[i-1].anchor &&
      (step.anchor==="work"||step.anchor==="home")),
    exterior = settlementExteriorFor(place),
    offset = (point:{x:number;z:number})=>{
      const ll=sourceToLonLat(point.x,point.z);
      return {eastM:normalizeLongitude(ll.lon-lon)*CANONICAL_PLANET_RADIUS *
        Math.max(1e-9,Math.abs(Math.cos(lat))),
        northM:(ll.lat-lat)*CANONICAL_PLANET_RADIUS};
    },
    border = exterior.border.map(offset), gates = exterior.gates.map(offset);
  let wetDeckSteps = 0, gateCrossings = 0, walkedLegs = 0,
    missingDeckRejected = false, missingGateRejected = false;
  for(const departure of departures){
    const first=residentAt(place,index,tickAtLocalTime(day,departure.start,lon));
    assert.equal(first.code,seed.code);
    if(first.activity!=="commute")continue;
    assert.ok(first.travelDistanceM && first.walkAhead);
    walkedLegs++;
    for(let sample=0;sample<Math.min(300,Math.ceil(first.travelDistanceM/24)+2);sample++){
      const state=residentAt(place,index,tickAtLocalTime(day,departure.start+sample*24,lon));
      if(state.activity!=="commute")break;
      assert.equal(state.code,seed.code);
      assert.ok(state.grounded && state.walkAhead && state.walkAhead.length>=2);
      for(let j=1;j<state.walkAhead.length;j++){
        const p=state.walkAhead[j-1],q=state.walkAhead[j],
          from=offset(p),to=offset(q);
        assert.ok(legalEnclosureSegment(from,to,border,gates),
          "all real resident segments cross the town enclosure only at SEED gates");
        if(!legalEnclosureSegment(from,to,border,[])){
          missingGateRejected = true;gateCrossings++;
        }
        const distance=greatCircleDistance(sourceToLonLat(p.x,p.z),sourceToLonLat(q.x,q.z)),
          steps=Math.max(1,Math.ceil(distance));
        assert.ok(distance<=24.1,`the actual resident walked ${distance.toFixed(3)}m in a 24-fantasy-second window`);
        let segmentHasBridge=false;
        for(let k=0;k<=steps;k++){
          const t=k/steps, x=p.x+wrapSourceX(q.x-p.x)*t, z=p.z+(q.z-p.z)*t,
            surface=finalSurfaceAt(x,z);
          assert.ok(residentWalkableSurface(surface),"every real walking sample has canonical legal ground");
          if(surface.traversal==="bridge"&&surface.water.kind!=="none"&&
            greatCircleDistance(sourceToLonLat(x,z),bridge.position)<=Math.max(bridge.spanM,30)){
            wetDeckSteps++;segmentHasBridge=true;
            assert.equal(residentWalkableSurface({...surface,deckHeight:null}),false,
              "the same occupied actual wet bridge point becomes illegal if its deck is removed");
          }
        }
        if(segmentHasBridge&&!missingDeckRejected){
          // Replay this exact SEED resident path with its real bridge deck
          // removed from the surface verdict; an untouched dry segment remains legal.
          const blocked = continuousWalkableOffsetSegment(from,to,point=>{
            const pos={
              lon:normalizeLongitude(lon+point.eastM/(CANONICAL_PLANET_RADIUS*Math.max(1e-9,Math.abs(Math.cos(lat))))),
              lat:lat+point.northM/CANONICAL_PLANET_RADIUS,
            },src=lonLatToSource(pos.lon,pos.lat),surface=finalSurfaceAt(src.x,src.z);
            return residentWalkableSurface(surface.traversal==="bridge"&&surface.water.kind!=="none"
              ? {...surface,deckHeight:null} : surface);
          });
          assert.equal(blocked,false,"the actual resident route cannot continue with missing bridge deck");
          missingDeckRejected = true;
        }
      }
    }
  }
  const work=residentAt(place,index,tickAtLocalTime(day,15*HOUR,lon)),
    home=residentAt(place,index,tickAtLocalTime(day,23.9*HOUR,lon));
  assert.ok(work.grounded&&work.activity==="work"&&work.code===seed.code&&
    home.grounded&&home.indoors&&home.code===seed.code&&home.route===seed.homeEntrance,
    "one real ordinary resident must work and return to its own exact SEED home");
  assert.ok(greatCircleDistance(home.position,sourceToLonLat(door.x,door.z))<.05);
  assert.ok(walkedLegs>=2&&wetDeckSteps>=2&&gateCrossings>=2&&missingDeckRejected&&missingGateRejected,
    "real workday crosses an occupied bridge and legal gates; either physical removal rejects it");
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

/** Tick at which a place's own local clock shows `hour` on its first local workday (not the weekly rest day). */
function workdayTick(place: (typeof villages)[number], hour: number) {
  const lon = place.canonicalPosition.lon, day = [1, 2, 3, 4, 5, 6, 7].find((d) => localWeekday(tickAtLocalTime(d, 12 * HOUR, lon), lon) !== 6)!;
  return tickAtLocalTime(day, hour * HOUR, lon);
}

test("townspeople who stand outdoors at local midday never share a spot or stand on a street", () => {
  for (const place of [cities[0], cities[2], villages[0]]) {
    const tick = workdayTick(place, 12), metre = sourceUnitsPerMetreAt(place.z), plan = settlementExteriorFor(place), standing: { code: string; task: string; e: number; n: number; x: number; z: number }[] = [];
    for (let index = 0; index < populationOf(place); index++) {
      const r = residentAt(place, index, tick);
      assert.deepEqual(residentAt(place, index, tick).x, r.x, "standing slots are a pure function of place, resident and tick");
      if (!r.grounded) {
        assert.match(r.route, /^BLOCKED:/, "unresolved residents remain explicit facts and are not drawn as street actors");
        continue;
      }
      if (r.indoors || r.travelProgress !== undefined) continue;
      standing.push({ code: r.code, task: r.task, e: r.x / metre.x, n: r.z / metre.z, x: r.x, z: r.z });
    }
    assert.ok(standing.length > populationOf(place) * .3, `${place.name}: many townspeople are outdoors at midday (${standing.length})`);
    // Grid of 2 m cells: every pair within 0.6 m is in the same or an adjacent cell.
    const cells = new Map<string, typeof standing>();
    for (const p of standing) {
      const key = `${Math.floor(p.e / 2)}/${Math.floor(p.n / 2)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(p);
    }
    let closest = Infinity;
    for (const [key, list] of cells) {
      const [cx, cz] = key.split("/").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const a of list) for (const b of cells.get(`${cx + dx}/${cz + dz}`) ?? []) {
        if (a === b) continue;
        const d = Math.hypot(a.e - b.e, a.n - b.n);
        closest = Math.min(closest, d);
        assert.ok(d >= .6, `${place.name}: ${a.code} (${a.task}) and ${b.code} (${b.task}) are ${d.toFixed(2)} m apart`);
      }
    }
    // Nobody stands on the carriageway of a street.
    for (const p of standing) for (const street of plan.streets) for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1], b = street.points[i], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, qx = wrapSourceX(p.x - a.x), qz = p.z - a.z,
        t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / (dx * dx + dz * dz || 1)));
      assert.ok(Math.hypot(qx - dx * t, qz - dz * t) >= street.width / 2, `${place.name}: ${p.code} (${p.task}) stands on ${street.id}`);
    }
  }
});

test("a city does not pile its clergy and elders onto one spot at the well", () => {
  const place = cities[2], tick = workdayTick(place, 12), well = settlementExteriorFor(place).plots.find((plot) => plot.kind === "well")!.candidates[0], metre = sourceUnitsPerMetreAt(place.z);
  let nearWell = 0, within1m = 0;
  for (let index = 0; index < populationOf(place); index++) {
    const r = residentAt(place, index, tick);
    if (!r.grounded || r.indoors || r.travelProgress !== undefined) continue;
    const d = Math.hypot(wrapSourceX(r.x - well.x) / metre.x, (r.z - well.z) / metre.z);
    if (d < 15) nearWell++;
    if (d < 1) within1m++;
  }
  assert.ok(nearWell < 120, `${nearWell} townspeople within 15 m of the well`);
  assert.equal(within1m, 0, "nobody stands on the well itself");
});
