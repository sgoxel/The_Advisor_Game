import test from "node:test";
import { residentFootRingGeometry } from "../src/resident-foot-ring.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_POLE_DISTANCE, lonLatToSource } from "../src/planet.ts";
import { residentGpuHitAllows } from "../src/resident-gpu-pick.ts";
import { structuralMeshBlocksSegment, residentOcclusionReachDepth } from "../src/resident-scene-occlusion.ts";
import assert from "node:assert/strict";
import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed, residentColdQueryCanStart, residentActorSnapshotMayMarkPresented, residentWorkerShardPlan, terrainWorkerIndexAvoidingWarmResident, residentActorPickDistance, residentActorPaintedTapFraction, residentActorPickPrefersFront, residentActorInFront, nearestKeyboardResident, nearestPickableKeyboardResident, residentMotionFraction, residentWalkingPolyline, residentWalkingHeadingDelta, residentStationaryWithinActivity, residentQueryAreasOverlap, residentStationaryPartialCarryover, residentLabelRightOfActor, ownedDoorLabelClearOfResident, residentQueryLimitForView, residentActorSearchContinues, residentFirstPreviewVisible, residentGateWatchFocus, selectedResidentVisibleInView, selectedResidentCurrentCarryover, activeResidentWorkers } from "../src/resident-query.ts";
import { LazySimulation, residentOrderFor, residentFoundationAt, residentStandSeedFor, neighbourhoodSite, routineHasAnchorChange, fieldConnectorsAllowCore } from "../src/simulation.ts";
import { villages, cities, nearbyPlaces, type Place } from "../src/geography.ts";
import { settlementExteriorFor, settlementHomeFor, settlementHomeAnchorFor } from "../src/settlement-exterior.ts";
import { continuousWalkableOffsetSegment, residentEndpointWalkable, legalPosition } from "../src/simulation.ts";
import { dailyPlan, dailyStandingActivities, personalityFor, traitsFor, type RoutineSubject } from "../src/routines.ts";

const request = (key = "town-a", tick = 100) => ({ key, tick, placeCode: "town", x: 0, z: 0, radius: 2, limit: 160 });
const result = { residents: [], query: { settlements: 1, candidateResidents: 20, evaluatedResidents: 20, returnedResidents: 0 } };

test("WP #550 empty remote wilderness returns no residents without a cold population index", () => {
  const x = 0, z = SOURCE_PRESENTATION_POLE_DISTANCE - 1;
  assert.equal(nearbyPlaces(x, z).length, 0,
    "the canonical polar wilderness has no SEED settlement candidates");
  // The worker uses this identical immutable prefilter BEFORE importing and
  // constructing Simulation. The old full query must have the same empty fact.
  const simulation = new LazySimulation();
  simulation.setFocus(villages[0]);
  assert.deepEqual(simulation.focusedResidents(x, z, 16, 8), [],
    "an empty source region never authorizes an invented visible resident");
  assert.equal(simulation.stats.query.settlements, 0);
  assert.ok(nearbyPlaces(villages[0].x, villages[0].z).some(candidate =>
    candidate.continent === villages[0].continent && candidate.country === villages[0].country),
    "an inhabited same-country view must still use its complete normal Simulation query");
});

test("S009 unchanged prior-day anchors cannot require a physical homecoming route", () => {
  assert.equal(routineHasAnchorChange([{ anchor: "home" }, { anchor: "home" }, { anchor: "home" }]), false);
  assert.equal(routineHasAnchorChange([{ anchor: "garden" }, { anchor: "garden" }]), false);
  assert.equal(routineHasAnchorChange([{ anchor: "home" }, { anchor: "work" }, { anchor: "home" }]), true);
  assert.equal(routineHasAnchorChange([{ anchor: "home" }, { anchor: "home" }, { anchor: "market" }]), true);
  assert.equal(routineHasAnchorChange([]), false);
});

test("S009 field route preflight skips only an actually illegal directed field connector", () => {
  const from = { eastM: -0, northM: 17 }, to = { eastM: 93, northM: 0 },
    fromEntry = { eastM: 18, northM: 17 }, toEntry = { eastM: 81, northM: -0 };
  for (const useFrom of [false, true]) for (const useTo of [false, true])
    for (const fromLegal of [false, true]) for (const toLegal of [false, true]) {
      const seen: string[] = [],
        validate = (a: typeof from, b: typeof from) => {
          const directed = a === from && b === fromEntry ? "out" :
            a === toEntry && b === to ? "in" : "unexpected";
          seen.push(directed);
          assert.notEqual(directed, "unexpected", "only original directed metre-sampled connectors may be tested");
          return directed === "out" ? fromLegal : toLegal;
        },
        actual = fieldConnectorsAllowCore(from, to,
          useFrom ? fromEntry : undefined, useTo ? toEntry : undefined, validate),
        originalWhenCoreExists = (!useFrom || fromLegal) && (!useTo || toLegal);
      assert.equal(actual, originalWhenCoreExists, "reordering cannot authorize a previously illegal approach");
      assert.deepEqual(seen, [
        ...(useFrom ? ["out"] : []),
        ...(useTo && (!useFrom || fromLegal) ? ["in"] : []),
      ], "a failed first connector prevents unnecessary second validation");
    }
});

test("WP #550 visible resident walking respects canonical metres at high latitude and seam", () => {
  const lat = Math.PI / 3;
  const a = lonLatToSource(0, lat), b = lonLatToSource(.001, lat),
    c = lonLatToSource(.001, lat - .001);
  const physical = residentWalkingPolyline([a, b, c]);
  assert.equal(physical.lengths.length, 3);
  const east = residentWalkingHeadingDelta(a, b);
  const south = residentWalkingHeadingDelta(b, c);
  assert.ok(Math.abs(east.east / south.south - .5) < .02,
    "the optional 3D resident faces physical east/south, not stretched flat-map diagonals");

  assert.ok(Math.abs(physical.lengths[1] / (physical.total - physical.lengths[1]) - .5) < .02,
    "east-west source pixels cannot be used as physical walk metres at 60 degrees latitude");
  const seam = residentWalkingPolyline([
    lonLatToSource(Math.PI - .0001, 0), lonLatToSource(-Math.PI + .0001, 0),
  ]);
  assert.ok(Math.abs(seam.points[1].x - seam.points[0].x) < 20,
    "the visible SEED resident crosses the longitude seam without teleporting");
  assert.ok(seam.total > 0 && seam.total < 300,
    "the original physical route stays short across the canonical wrap");
});

test("S009 resident cold index builds only the shard while retaining all original SEED candidates and order", () => {
  const place = villages[0], simulation = new LazySimulation();
  type Shard = { index: number; count: number };
  const candidates = (shard?: Shard) =>
    (simulation as unknown as { residentCandidates: (place: Place, x: number, z: number,
      radius: number, shard?: Shard) => number[] }).residentCandidates(place, place.x, place.z, 32, shard);
  const expected = candidates();
  const rank = residentOrderFor(place);
  for (const count of [1, 2, 3, 4, 6, 8]) {
    const partitions = Array.from({ length: count }, (_, index) => candidates({ index, count }));
    for (let index = 0; index < count; index++)
      assert.ok(partitions[index].every(id => id % count === index),
        "shard index never manufactures another worker's resident");
    const combined = partitions.flat().sort((a, b) => rank(a) - rank(b));
    assert.deepEqual(combined, expected, `complete SEED candidate parity across ${count} worker shards`);
    assert.equal(new Set(combined).size, combined.length, "every SEED resident belongs to one shard");
  }
});

test("S009 fast resident home anchor exactly matches canonical full-home plot", () => {
  for (const place of [villages[0], cities[0]]) {
    const plan = settlementExteriorFor(place);
    for (const index of [0, 1, 7, 31, 79]) {
      const expected = settlementHomeFor(place, index, plan).candidates[0],
        actual = settlementHomeAnchorFor(place, index, plan);
      assert.deepEqual(actual, expected, `resident ${place.code}/${index} retains exact home`);
    }
  }
});

test("S009 lightweight standing-roster seeds equal full canonical resident foundations", () => {
  for (const place of [villages[0], cities[0]]) {
    for (const index of [0, 1, 7, 31, 79, ...(place.kind === "city" ? [240, 2399] : [])]) {
      const compact = residentStandSeedFor(place, index),
        full = residentFoundationAt(place, index),
        expected = {
          code: full.code, role: full.role, ageGroup: full.ageGroup,
          guardShift: full.guardShift, traits: full.traits,
          homeOffset: full.homeOffset, workOffset: full.workOffset,
        };
      assert.deepEqual(compact, expected, `${place.code}/${index} preserves exact cold SEED anchors`);
      assert.deepEqual(residentStandSeedFor(place, index), expected,
        `${place.code}/${index} preserves exact warm dailyPlan facts`);
    }
  }
});

test("S009 reused cold spatial seeds preserve exact resident identities across settlements", () => {
  const samples = [villages[0], cities[0], cities[1], villages[0], cities[0]];
  for (const place of samples) {
    for (const index of [0, 31, 79, ...(place.kind === "city" ? [2399] : [])]) {
      const standing = residentStandSeedFor(place, index),
        foundation = residentFoundationAt(place, index);
      assert.equal(standing.code, foundation.code, "SEED code cannot cross into another settlement");
      assert.equal(standing.role, foundation.role);
      assert.equal(standing.ageGroup, foundation.ageGroup);
      assert.equal(standing.guardShift, foundation.guardShift);
      assert.deepEqual(standing.traits, foundation.traits);
      assert.deepEqual(standing.homeOffset, foundation.homeOffset, "shared home is the original canonical lot");
      assert.deepEqual(standing.workOffset, foundation.workOffset, "shared work is the original SEED post");
    }
  }
});

test("S009 cached neighbourhood sites retain seeded garden/market and exact home-offset keys", () => {
  for (const place of [villages[0], cities[0]]) {
    for (const index of [0, 1, 31, 79, ...(place.kind === "city" ? [240, 2399] : [])]) {
      const foundation = residentStandSeedFor(place, index);
      for (const kind of ["market", "garden"] as const) {
        const original = neighbourhoodSite(place, foundation, kind);
        assert.deepEqual(neighbourhoodSite(place, foundation, kind), original,
          "repeated pure SEED site selection may reuse the same exact site");
        const alternative = { ...foundation, homeOffset: {
          eastM: foundation.homeOffset.eastM + 90, northM: foundation.homeOffset.northM - 45,
        } };
        const alternateResult = neighbourhoodSite(place, alternative, kind);
        assert.deepEqual(neighbourhoodSite(place, alternative, kind), alternateResult,
          "a separately resolved home offset has a separately cached canonical destination");
        assert.deepEqual(neighbourhoodSite(place, foundation, kind), original,
          "alternate home requests cannot change the original resident's selected site");
      }
    }
  }
});

test("S010 gate-watch focus follows only a physically arrived real guard", () => {
  const post = { x: 4, z: 9 };
  const residents = new Map<string, { x: number; z: number; grounded: boolean; indoors: boolean; activity: "guard" | "work" }>([
    ["late", { x: 20, z: 30, grounded: false, indoors: false, activity: "guard" }],
    ["inside", { x: 22, z: 32, grounded: true, indoors: true, activity: "guard" }],
    ["real", { x: 24, z: 34, grounded: true, indoors: false, activity: "guard" }],
    ["second", { x: 28, z: 38, grounded: true, indoors: false, activity: "guard" }],
    ["visitor", { x: 26, z: 36, grounded: true, indoors: false, activity: "work" }],
  ]);
  const lookup = (code: string) => residents.get(code);
  assert.deepEqual(residentGateWatchFocus(["late", "inside", "real", "visitor"], lookup, post),
    { x: 24, z: 34 }, "camera follows the first real on-duty guard, not an unused gate post");
  assert.equal(residentGateWatchFocus(["visitor", "late"], lookup, post), post,
    "unstaffed or physically absent gate retains the original SEED post");
  assert.equal(residentGateWatchFocus(undefined, lookup, post), post);
  assert.deepEqual(residentGateWatchFocus(["real"], lookup, post), { x: 24, z: 34 },
    "a lone guard retains their original canonical coordinate");
  const centered = residentGateWatchFocus(["real", "second"], lookup, post);
  assert.ok(Math.abs(centered.x - 26) < 1e-8 && centered.z === 36,
    "two genuine duty guards share a centered camera frame instead of clipping the second");
  const reverse = residentGateWatchFocus(["second", "real", "real"], lookup, post);
  assert.ok(Math.abs(reverse.x - 26) < 1e-8 && reverse.z === 36,
    "roster order and duplicate codes cannot shift a camera frame");
  const mixed = residentGateWatchFocus(["inside", "late", "real", "second"], lookup, post);
  assert.ok(Math.abs(mixed.x - 26) < 1e-8 && mixed.z === 36,
    "invalid and indoor guards never influence camera framing");
});

test("S010 preserves stationary in-view actors on wider pans but not distant views", () => {
  const original = { x: 100, z: 20, radius: 10 };
  assert.equal(residentQueryAreasOverlap(original, { x: 106, z: 20, radius: 10 }), true,
    "a 6m pan exceeds the old 2.5m cutoff while both views still contain the same legal residents");
  assert.equal(residentQueryAreasOverlap(original, { x: 121, z: 20, radius: 10 }), false,
    "distant nonoverlapping views must not reuse old actor data");
  assert.equal(residentQueryAreasOverlap(original, { x: 100, z: 20, radius: 0 }), false);
  assert.equal(residentQueryAreasOverlap(original, { x: Number.NaN, z: 20, radius: 10 }), false);
});

test("a fixed Fantasy tick cannot move an original resident off the legal route", () => {
  const absoluteTick = 268295, scale = 24;
  assert.equal(residentMotionFraction(absoluteTick, absoluteTick, scale), 0,
    "frozen Fantasy Time must keep the original actor on its canonical exact-tick station");
  assert.equal(residentMotionFraction(absoluteTick + 12, absoluteTick, scale), .5,
    "live clock advances halfway along the next verified Simulation second");
  assert.equal(residentMotionFraction(absoluteTick + 24, absoluteTick, scale), 1);
  assert.equal(residentMotionFraction(absoluteTick + 96, absoluteTick, scale), 1,
    "delayed rendering must never extrapolate off the verified legal walking path");
  assert.equal(residentMotionFraction(absoluteTick - 12, absoluteTick, scale), 0);
  assert.equal(residentMotionFraction(Number.NaN, absoluteTick, scale), 0);
  assert.equal(residentMotionFraction(absoluteTick, absoluteTick, 0), 0);
});

test("S010 cutout picking follows its real projected body, not an imaginary vertical head", () => {
  const feet = { x: 100, y: 220 }, paintedHead = { x: 130, y: 180 };
  assert.notEqual(residentActorPickDistance(130, 190, feet, paintedHead), null,
    "a tap on the tilted painted silhouette must select its original resident");
  assert.equal(residentActorPickDistance(130, 190, feet, { x: 100, y: 180 }), null,
    "the old vertical proxy rectangle does not cover that visible silhouette");
});

test("S010 selected ground ring is a closed planar world mesh with no screen-space proxy", () => {
  const { positions, normals, indices } = residentFootRingGeometry();
  assert.equal(positions.length, 32 * 4 * 3);
  assert.equal(normals.length, positions.length);
  assert.equal(indices.length, 32 * 2 * 3 * 2);
  assert.ok(positions.every((coordinate, index) => index % 3 !== 1 ||
      Math.abs(coordinate * CANONICAL_METRES_PER_SOURCE_UNIT - 0.22) < 1e-10),
    "both scene-depth bands retain exactly 22 cm foot clearance");
  const radii = [0.32, 0.38, 0.48, 0.60];
  for (let index = 0; index < positions.length; index += 3) {
    const radiusM = Math.hypot(positions[index], positions[index + 2]) * CANONICAL_METRES_PER_SOURCE_UNIT;
    assert.ok(Math.abs(radiusM - radii[Math.floor(index / 3 / 64) * 2 + (index / 3 % 2)]) < 1e-10,
      "old visible inner band and larger outer halo use identical canonical physical-metre scale");
  }
  assert.ok(indices.every(index => index >= 0 && index < positions.length / 3));
  assert.ok(indices.some(index => index === 0) && indices.some(index => index === 63) &&
    indices.some(index => index === 64) && indices.some(index => index === 127),
    "both closed rings wrap without seams and remain one depth-tested mesh");
});

test("S010 Enter inspection picks one deterministic real visible resident near the canvas centre", () => {
  const visible = [
    { code: "seed/guard", x: 80, y: 50 },
    { code: "seed/farmer", x: 48, y: 50 },
    { code: "seed/beggar", x: 52, y: 50 },
  ];
  assert.equal(nearestKeyboardResident(visible, 100, 100)?.code, "seed/beggar",
    "equidistant painted bodies tie-break by canonical ID, not worker arrival");
  assert.equal(nearestKeyboardResident([...visible].reverse(), 100, 100)?.code, "seed/beggar");
  assert.equal(nearestKeyboardResident([{ code: "invalid", x: NaN, y: 2 }, ...visible], 100, 100)?.code, "seed/beggar");
  assert.equal(nearestKeyboardResident([], 100, 100), undefined);
  assert.equal(nearestKeyboardResident(visible, 0, 100), undefined);
});

test("S010 only camera-front painted residents can be clicked or receive a selected marker", () => {
  assert.equal(residentActorInFront(-2, -1), true, "painted head and physical feet are in front");
  assert.equal(residentActorInFront(2, 1), false, "behind-camera ghost projections are not pickable");
  assert.equal(residentActorInFront(-2, 1), false, "partially behind-camera cutouts cannot claim a valid screen hit");
  assert.equal(residentActorInFront(0, -1), false, "a foot at the eye plane is not a visible resident");
  assert.equal(residentActorInFront(Number.NaN, -1), false);
  assert.equal(residentActorInFront(-1, Infinity), false);
});

test("first close-up residents are queried under a finite identical rendered/state budget", () => {
  assert.equal(residentQueryLimitForView(true), 8,
    "first street characters must not wait for 32 complete cold door-and-path evaluations");
  assert.equal(residentQueryLimitForView(false), 24,
    "non-actor inspection still uses the existing fact budget");
  assert.equal(residentQueryLimitForView(true), residentQueryLimitForView(true),
    "camera/frame timing must not choose the visible resident limit");
});

test("first outdoor canvas actor may use one bounded follow-up after an indoor-only eight", () => {
  assert.equal(residentActorSearchContinues(8, 0, 8), true,
    "eight indoor residents do not prove the street has no real actors");
  assert.equal(residentActorSearchContinues(8, 1, 8), false,
    "once a legal outdoor actor is found, never delay the first click for optional extras");
  assert.equal(residentActorSearchContinues(15, 0, 8), true);
  assert.equal(residentActorSearchContinues(16, 0, 8), false,
    "cold worker scans are strictly capped at two query batches");
  assert.equal(residentActorSearchContinues(7, 8, 8), false);
  assert.equal(residentActorSearchContinues(0, 0, 0), false);
});

test("progressive outdoor results keep every valid NPC without duplicates or stale camera actors", () => {
  const queue = new ResidentQueryQueue(48);
  const actorQuery = { ...request("street"), actors: true };
  queue.offer(actorQuery);
  const job = queue.take()!;
  const outdoor = (code: string) => ({ code, grounded: true, indoors: false });
  const first = outdoor("beggar"), second = outdoor("guard");
  assert.equal(queue.appendPartial(job.id, [first] as never[], 100), true);
  assert.deepEqual(queue.current?.residents.map(r => r.code), ["beggar"]);
  assert.equal(queue.current?.partial, true);
  assert.equal(queue.ready, false, "partial residents never claim that all current-view facts are ready");
  assert.equal(queue.appendPartial(job.id, [first, second] as never[], 100), true);
  assert.deepEqual(queue.current?.residents.map(r => r.code), ["beggar", "guard"]);
  assert.equal(queue.appendPartial(job.id, [{ ...outdoor("innkeeper"), indoors: true }] as never[], 100), false);
  assert.equal(queue.appendPartial(job.id, [second] as never[], 100), false);
  assert.equal(queue.appendPartial(job.id, [outdoor("farmer")] as never[], 149), false);
  assert.equal(queue.complete(job.id, { ...result, residents: [first, second] as never[] }, 100), true);
  assert.equal(queue.current?.partial, undefined);
  assert.deepEqual(queue.current?.residents.map(r => r.code), ["beggar", "guard"]);
  queue.offer({ ...actorQuery, key: "elsewhere" });
  assert.equal(queue.current, undefined);
});

test("S010 streaming a new camera view keeps only real stationary overlap until final facts arrive", () => {
  const queue = new ResidentQueryQueue(48), firstView = {
    ...request("before-pan", 100), actors: true, radius: 4,
  };
  const resident = (code: string, x: number, change: Record<string, unknown> = {}) =>
    ({ code, x, z: 0, grounded: true, indoors: false, ...change });
  const atPost = resident("SEED/still-at-post", 1);
  const offscreen = resident("SEED/now-offscreen", -3);
  const indoor = resident("SEED/indoors", 1, { indoors: true });
  queue.offer(firstView);
  const firstJob = queue.take()!;
  assert.equal(queue.complete(firstJob.id, {
    ...result, residents: [atPost, offscreen, indoor] as never[],
  }, 100), true);
  const previous = queue.latest!;
  const nextView = { ...firstView, key: "after-pan", x: 3, tick: 101 };
  queue.offer(nextView);
  const nextJob = queue.take()!;
  const seen: string[] = [];
  const retained = residentStationaryPartialCarryover(previous, nextView, (person, oldTick, newTick) => {
    seen.push(person.code);
    assert.equal(oldTick, 100);
    assert.equal(newTick, 101);
    return true; // The caller has independently validated the same original local routine.
  });
  assert.deepEqual(retained.map(person => person.code), ["SEED/still-at-post"],
    "a pan retains only the grounded original position within both real camera searches");
  assert.equal(seen.includes("SEED/now-offscreen"), true);
  const arrived = resident("SEED/new-street-person", 3.5);
  assert.equal(queue.appendPartial(nextJob.id, [arrived] as never[], 101, retained as never[]), true);
  assert.deepEqual(queue.current?.residents.map(person => person.code),
    ["SEED/still-at-post", "SEED/new-street-person"],
    "first real partial worker fact does not erase a stationary actor behind the pan");
  assert.equal(queue.ready, false, "stationary carryover never makes a partial batch authoritative");
  assert.equal(queue.appendPartial(nextJob.id, [atPost] as never[], 101), false,
    "a repeated real resident never duplicates the original SEED identity");
  assert.equal(queue.complete(nextJob.id, {
    ...result, residents: [arrived] as never[],
  }, 101), true);
  assert.deepEqual(queue.current?.residents.map(person => person.code), ["SEED/new-street-person"],
    "complete worker facts replace every temporary old-camera visual");
  assert.deepEqual(residentStationaryPartialCarryover(previous,
    { ...nextView, x: 20 }, () => true), [], "nonoverlapping distant pans retain no actors");
  assert.deepEqual(residentStationaryPartialCarryover(previous,
    { ...nextView, placeCode: "another-place" }, () => true), [], "different SEED settlements never mix");
  assert.deepEqual(residentStationaryPartialCarryover(previous,
    { ...nextView, actors: false }, () => true), [], "inspector-only queries never paint temporary actors");
  assert.deepEqual(residentStationaryPartialCarryover(previous, nextView, () => false), [],
    "a schedule/day/route change invalidates even a physically nearby former resident");
});


test("slow population scans preserve only grounded stationary on-duty NPCs", () => {
  const person = {
    grounded: true, indoors: false, activity: "work" as "work" | "guard" | "commute",
    activityStart: 7 * 3600, activityEnd: 12 * 3600,
    travelProgress: undefined as number | undefined, route: "SEED/WORKPLACE",
  };
  const stays = (change: Partial<typeof person> = {}, day = 3, second = 8 * 3600) =>
    residentStationaryWithinActivity({ ...person, ...change }, 3, day, second);
  assert.equal(stays(), true, "validated work position remains until the resident's next scheduled event");
  assert.equal(stays({ activity: "guard" }), true, "a physically arrived night guard does not vanish while on watch");
  assert.equal(stays({ indoors: true }), false);
  assert.equal(stays({ grounded: false }), false);
  assert.equal(stays({ activity: "commute" }), false, "a walking resident needs a current Simulation path");
  assert.equal(stays({ travelProgress: .5 }), false);
  assert.equal(stays({ route: "BLOCKED: work" }), false);
  assert.equal(stays({}, 4), false, "new local day needs new canonical schedule");
  assert.equal(stays({}, 3, 12 * 3600), false, "activity boundary needs fresh Simulation facts");
});

test("nearby camera movement reuses only recent, overlapping SEED residents without hiding the street", () => {
  const queue = new ResidentQueryQueue(48, 24);
  const street = { ...request("view-one", 100), actors: true, radius: 4 };
  queue.offer(street);
  const original = queue.take()!;
  const known = { code: "seeded-resident", grounded: true, indoors: false };
  assert.equal(queue.complete(original.id, { ...result, residents: [known] as never[] }, 100), true);
  assert.equal(queue.current?.key, street.key);

  // The old renderer sampled current only *after* changing the query key,
  // so even a sub-metre pan discarded every real actor for that frame.
  queue.offer({ ...street, key: "view-two", x: .2, tick: 101 });
  assert.equal(queue.current, undefined, "new camera still needs its own complete query");
  const retained = currentResidentSnapshot(queue.current, queue.latest, street.placeCode, 101, 48,
    { x: .2, z: 0, radius: 4 });
  assert.deepEqual(retained?.residents.map(entry => entry.code), ["seeded-resident"],
    "previous real residents remain visible through a tiny camera drag");
  assert.equal(queue.ready, false, "a nearby old view must never falsely complete the new query");
  assert.equal(currentResidentSnapshot(queue.current, queue.latest, street.placeCode, 101, 48,
    { x: 20, z: 0, radius: 4 }), undefined,
    "a genuinely distant view cannot portray the old street as locally occupied");
  assert.equal(currentResidentSnapshot(queue.current, queue.latest, street.placeCode, 149, 48,
    { x: .2, z: 0, radius: 4 }), undefined,
    "old positions cannot survive beyond the original finite Fantasy-Time freshness");
});

test("visible S006 residents retain a 44px CSS touch target without selecting distant actors", () => {
  const feet = { x: 100, y: 100 }, head = { x: 100, y: 94 };
  assert.equal(residentActorPickDistance(100, 97, feet, head), 0,
    "tapping the physically projected actor centre chooses its real SEED sprite");
  assert.notEqual(residentActorPickDistance(121, 97, feet, head), null,
    "tiny residents remain touch-selectable at the edge of the 44px target");
  assert.notEqual(residentActorPickDistance(100, 75, feet, head), null,
    "the vertical touch target also covers 44px");
  assert.equal(residentActorPickDistance(123, 97, feet, head), null,
    "unrelated scenery beyond the finite hit target must not select a resident");
  assert.equal(residentActorPickDistance(100, 74, feet, head), null);
  assert.equal(residentActorPickDistance(Number.NaN, 97, feet, head), null,
    "unprojectable actors never acquire an infinite picking surface");

  const other = { x: 118, y: 100 }, otherHead = { x: 118, y: 94 };
  assert.ok(residentActorPickDistance(115, 97, other, otherHead)! <
    residentActorPickDistance(115, 97, feet, head)!,
  "when sparse actor hit targets overlap, nearest canonical actor wins");
  const tallHead = { x: 100, y: -20 };
  assert.notEqual(residentActorPickDistance(100, -18, feet, tallHead), null,
    "full-height nearby 3D characters remain selectable near their visible heads");
});

test("S010 first actor preview never mistakes an indoor resident for visible street population", () => {
  assert.equal(residentFirstPreviewVisible({ grounded: true, indoors: false }, true), true,
    "original outdoor grounded character remains eligible for early 2D display");
  assert.equal(residentFirstPreviewVisible({ grounded: true, indoors: true }, true), false,
    "legal indoor inspector fact is not a visible street actor");
  assert.equal(residentFirstPreviewVisible({ grounded: false, indoors: false }, true), false,
    "invalid foot contact may never be previewed as a drawable character");
  assert.equal(residentFirstPreviewVisible({ grounded: true, indoors: true }, false), true,
    "inspector-only queries retain indoor resident facts without hiding identities");
  assert.equal(residentFirstPreviewVisible({ grounded: false, indoors: false }, false), true,
    "original inspector fact validation still comes entirely from Simulation");
});

test("S010 tilted cutout picking compares actual tapped head/feet depths", () => {
  const feet = { x: 100, y: 220 }, head = { x: 140, y: 140 };
  assert.equal(residentActorPaintedTapFraction(100, 220, feet, head), 0,
    "a tap at grounded feet uses their depth, not midpoint depth");
  assert.equal(residentActorPaintedTapFraction(140, 140, feet, head), 1,
    "a tap at the visibly pitched head uses its actual plane depth");
  assert.equal(residentActorPaintedTapFraction(120, 180, feet, head), .5);
  assert.equal(residentActorPaintedTapFraction(100, 100, feet, head), 1,
    "touch padding beyond the painted top clamps to the top of the real quad");
  assert.equal(residentActorPaintedTapFraction(100, 280, feet, head), 0,
    "touch padding below the original feet cannot extrapolate into terrain");
  assert.equal(residentActorPaintedTapFraction(50, 50, feet, feet), .5,
    "degenerate projection keeps the stable previous midpoint depth");
  assert.equal(residentActorPaintedTapFraction(NaN, 180, feet, head), null);
});

test("S010 overlapping real 2D residents pick the front painted plane, not a hidden rear centre", () => {
  const rear = { code: "seed/rear", distance: 1, viewDepth: -15 };
  const front = { code: "seed/front", distance: 14, viewDepth: -7 };
  assert.equal(residentActorPickPrefersFront(front, rear), true,
    "a visible foreground cutout must beat a rear actor closer to the tap centre");
  assert.equal(residentActorPickPrefersFront(rear, front), false,
    "pool iteration order cannot select the obscured rear actor");
  assert.equal(residentActorPickPrefersFront(front), true);
  assert.equal(residentActorPickPrefersFront({ code: "bad", distance: 0, viewDepth: 0 }), false,
    "an actor behind the camera has no picking priority");
  assert.equal(residentActorPickPrefersFront({ code: "bad", distance: NaN, viewDepth: -2 }), false);
  assert.equal(residentActorPickPrefersFront({ code: "bad", distance: 2, viewDepth: -Infinity }), false);
  const first = { code: "seed/a", distance: 4, viewDepth: -8 };
  assert.equal(residentActorPickPrefersFront({ code: "seed/b", distance: 3, viewDepth: -8 }, first), true,
    "equal-depth, overlapping cutouts choose the nearer projected painted centre");
  assert.equal(residentActorPickPrefersFront({ code: "seed/a", distance: 4, viewDepth: -8 },
    { code: "seed/b", distance: 4, viewDepth: -8 }), true,
    "identical depth and distance use stable SEED identity rather than actor pool order");
});

test("S010 keyboard inspection stops after its first truly pickable nearest resident", () => {
  const far = { code: "SEED/far", x: 950, y: 50 };
  const near = { code: "SEED/near", x: 540, y: 960 };
  const visited: string[] = [];
  assert.equal(nearestPickableKeyboardResident([far, near], 1080, 1920, resident => {
    visited.push(resident.code);
    return true;
  })?.code, "SEED/near");
  assert.deepEqual(visited, ["SEED/near"],
    "a foreground accessible actor avoids repeating the entire pointer hit scan for distant residents");

  const covered = { code: "SEED/covered", x: 540, y: 960 };
  const visible = { code: "SEED/visible", x: 545, y: 960 };
  const checked: string[] = [];
  assert.equal(nearestPickableKeyboardResident([visible, covered, { code: "invalid", x: NaN, y: 0 }],
    1080, 1920, resident => {
      checked.push(resident.code);
      return resident.code === "SEED/visible";
    })?.code, "SEED/visible",
  "a UI-covered or rear hit is rejected by the real picker before trying the next original actor");
  assert.deepEqual(checked, ["SEED/covered", "SEED/visible"],
    "invalid projections are excluded and input order cannot override centre distance");
  assert.equal(nearestPickableKeyboardResident([far], 0, 1920, () => true), undefined);
});

test("selected S006 resident caption stays clear of portrait inspector without changing actor", () => {
  assert.equal(residentLabelRightOfActor(460, 1080, 1920), false,
    "selected resident at the portrait inspector edge is labeled to the left");
  assert.equal(residentLabelRightOfActor(190, 1080, 1920), true,
    "far-left resident retains the short right-facing leader");
  assert.equal(residentLabelRightOfActor(820, 1920, 1080), true,
    "landscape selected resident keeps its previously accepted location");
  assert.equal(residentLabelRightOfActor(1790, 1920, 1080), false,
    "right-edge labels never extend outside the screen");
});

test("S005 owned-door marker cannot cover returning original 2D resident", () => {
  // Genuine original front-door screenshot: the UI door anchor is almost
  // identical to the resident's feet; old head-only check incorrectly drew
  // a solid DOM label across the illustrated actor's head and torso.
  const feet = { x: 824, y: 458 }, head = { x: 824, y: 398 };
  assert.equal(ownedDoorLabelClearOfResident({ x: 824, y: 458 }, feet, head), false,
    "owned doorway at original feet must never obscure the arriving body");
  assert.equal(ownedDoorLabelClearOfResident({ x: 842, y: 422 }, feet, head), false,
    "the entire vertical 2D body is a label-free corridor");
  assert.equal(ownedDoorLabelClearOfResident({ x: 824, y: 347 }, feet, head), true,
    "a different nearby but non-overlapping building entrance is still labeled");
  assert.equal(ownedDoorLabelClearOfResident({ x: 900, y: 458 }, feet, head), true,
    "a separately located genuine door keeps its independent marker");
  assert.equal(ownedDoorLabelClearOfResident({ x: Number.NaN, y: 458 }, feet, head), false,
    "invalid projection must not create a floating doorway label");
});

test("S009 initial resident overlap preserves a live terrain worker and the shared queue", () => {
  const allowed = residentColdQueryCanStart;
  assert.equal(allowed(false, 12, 2, 0, 4, 0), true,
    "when no terrain tile is running, one worker and one slot remain reserved");
  assert.equal(allowed(false, 12, 3, 3, 6, 0), true,
    "the existing two-spare-capacity rule still admits an early actor query");
  assert.equal(allowed(false, 12, 1, 0, 4, 0), false,
    "one-worker hardware cannot lose the only worker to resident replay");
  assert.equal(allowed(false, 12, 2, 3, 4, 0), false,
    "one remaining admission slot without terrain in flight belongs to required ground");
  assert.equal(allowed(false, 12, 1, 1, 2, 1), true,
    "a second worker can prepare a resident while the first actually generates terrain");
  assert.equal(allowed(false, 12, 1, 7, 8, 2), true,
    "a busy eight-slot queue may use its one free slot when real terrain is running");
  assert.equal(allowed(false, 12, 0, 1, 2, 1), false,
    "one-worker hardware with an in-flight terrain job has no spare resident worker");
  assert.equal(allowed(false, 12, 1, 2, 2, 1), false,
    "full shared admission never allows an extra resident even with free hardware");
  assert.equal(allowed(false, 12, 1, 1, 1, 1), false,
    "single-slot devices do not overcommit a mandatory terrain worker");
  assert.equal(allowed(false, 12, 1, 0, 4, 0), false,
    "idle workers without active terrain still reserve one for mandatory coverage");
  assert.equal(allowed(true, 12, 2, 1, 4, 1), false,
    "a pending camera change must not start an obsolete actor query");
  for (const halfHeight of [20, 48, 100, Infinity, NaN])
    assert.equal(allowed(false, halfHeight, 4, 0, 8, 1), false,
      "remote or invalid camera scales never precompute unrelated actors");
  assert.equal(allowed(false, 12, 2, 6, 6, 2), false,
    "a fully occupied eight-or-smaller admission cannot overcommit workers");
});

test("S009 early canonical actor snapshots remain eligible for the first coherent frame", () => {
  assert.equal(residentActorSnapshotMayMarkPresented(false, true), false,
    "a cold precomputed actor result must not consume its only first visible update");
  assert.equal(residentActorSnapshotMayMarkPresented(true, true), true,
    "the exact early result becomes visible when the real terrain is ready");
  assert.equal(residentActorSnapshotMayMarkPresented(false, false), true,
    "ordinary inspector-only snapshots retain their existing presentation behavior");
});

test("resident facts dispatch after initial ready without waiting for later zoom refinement", () => {
  const allowed = residentDispatchAllowed;
  assert.equal(allowed(false, true, 1, false), true,
    "a spare worker may answer logical residents while a newly selected zoom is still refining");
  assert.equal(allowed(false, true, 1, false), true,
    "one-worker devices must not wait for optional detail before first inspection");
  assert.equal(allowed(false, false, 1, false), false,
    "initial coherent terrain must be ready before first resident query");
  assert.equal(allowed(true, true, 1, false), false,
    "camera changes must not launch a stale request");
  assert.equal(allowed(true, false, 1, true), true,
    "remaining shards of a started batch must retire after navigation");
  assert.equal(allowed(false, true, 0, true), false,
    "an occupied worker is never double-dispatched");
});

test("cold S009 resident queries split only across already idle workers and reuse warm shards", () => {
  assert.deepEqual(residentWorkerShardPlan([3, 1]), [
    { workerId: 1, shardIndex: 0, count: 2 },
    { workerId: 3, shardIndex: 1, count: 2 },
  ], "two idle workers divide expensive cold SEED and legal route work without starting new workers");
  assert.deepEqual(residentWorkerShardPlan([3, 1], new Set(), true), [
    { workerId: 1, shardIndex: 0, count: 1 },
  ], "first legal actor selection is invariant to extra idle workers");
  assert.deepEqual(residentWorkerShardPlan([1, 3], new Set([3]), true), [
    { workerId: 3, shardIndex: 0, count: 1 },
  ], "actor queries reuse one warmed worker without changing their global early-stop behavior");
  assert.deepEqual(residentWorkerShardPlan([3, 1, 4]), [
    { workerId: 1, shardIndex: 0, count: 2 },
    { workerId: 3, shardIndex: 1, count: 2 },
  ], "extra idle worker remains available for terrain");
  assert.deepEqual(residentWorkerShardPlan([3, 1], new Set([3])), [
    { workerId: 3, shardIndex: 0, count: 1 },
  ], "one warmed worker retains the full index rather than rebuilding half an index");
  assert.deepEqual(residentWorkerShardPlan([3, 1, 4], new Set([3, 1])), [
    { workerId: 1, shardIndex: 0, count: 2 },
    { workerId: 3, shardIndex: 1, count: 2 },
  ], "two warmed workers retain their exact original shard and cache mapping");
  assert.deepEqual(residentWorkerShardPlan([2]), [
    { workerId: 2, shardIndex: 0, count: 1 },
  ], "one-worker devices still answer the complete canonical query");
  assert.deepEqual(residentWorkerShardPlan([1, 2], new Set([9])), [
    { workerId: 1, shardIndex: 0, count: 2 },
    { workerId: 2, shardIndex: 1, count: 2 },
  ], "an occupied warmed worker never delays a cold legal query");
  assert.deepEqual(residentWorkerShardPlan([3, 3, -1]), [
    { workerId: 3, shardIndex: 0, count: 1 },
  ], "duplicate or invalid worker indices never create unanswered shards");
  assert.deepEqual(residentWorkerShardPlan([]), [], "no idle worker starts a batch");
});

test("terrain prefers cold idle workers, preserving warm resident index without starving mandatory tiles", () => {
  const select = terrainWorkerIndexAvoidingWarmResident;
  assert.equal(select([], new Set([1])), -1);
  assert.equal(select([2, 0, 1], new Set()), 2, "ordinary cold-only queue remains LIFO");
  assert.equal(select([2, 0, 1], new Set([1])), 1, "leave the warmed resident worker idle when a cold worker is free");
  assert.equal(select([4, 2, 7, 1], new Set([1, 7])), 1, "prefer latest eligible cold worker");
  assert.equal(select([7, 1], new Set([7, 1])), 1, "all-warm workers still serve urgent terrain");
  assert.equal(select([1], new Set([1])), 0, "a single warm worker cannot block terrain");
  assert.deepEqual(residentWorkerShardPlan([1, 4], new Set([1])), [{ workerId: 1, shardIndex: 0, count: 1 }],
    "preserved warm worker is preferred for the next real resident query");
});

test("camera navigation rejects the old town and dispatches only the latest view", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request()); const old = queue.take()!;
  queue.offer(request("town-b")); queue.offer(request("town-c"));
  assert.equal(queue.take(), undefined, "only one population query may run");
  assert.equal(queue.complete(old.id, result), false, "previous town never appears at the new focus");
  assert.equal(queue.ready, false);
  const latest = queue.take()!;
  assert.equal(latest.key, "town-c");
  assert.equal(queue.complete(old.id, result), false, "late duplicate cannot clear the current job");
  assert.equal(queue.busy, true);
  assert.equal(queue.complete(latest.id, result), true);
  assert.equal(queue.current?.key, "town-c");
});

test("S009 latest resident focus can pass one obsolete query without altering actor choice", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request("obsolete")); const old = queue.take()!;
  queue.offer(request("latest")); const newer = queue.take(true)!;
  assert.ok(newer.id > old.id, "new view gets a distinct deterministic job identity");
  assert.equal(queue.take(true), undefined, "never duplicate the same running view");
  assert.equal(queue.complete(newer.id, result), true, "current view may finish before stale work");
  assert.equal(queue.current?.key, "latest");
  assert.equal(queue.complete(old.id, result), false, "late obsolete response cannot replace newer truth");
  assert.equal(queue.current?.key, "latest", "out-of-order completion retains the accepted focus");
  assert.equal(queue.busy, false);
});

test("S009 two-flight bound retains the newest requested camera during rapid pans", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request("first")); const first = queue.take()!;
  queue.offer(request("second")); const second = queue.take(true)!;
  queue.offer(request("final"));
  assert.equal(queue.take(true), undefined, "two occupied workers cannot create a third batch");
  assert.equal(queue.complete(second.id, result), false, "already-obsolete second camera is rejected");
  const final = queue.take(true)!;
  assert.equal(final.key, "final", "free worker is used for the latest, not an intermediate view");
  assert.equal(queue.complete(final.id, result), true);
  assert.equal(queue.complete(first.id, result), false);
  assert.equal(queue.current?.key, "final");
});

test("S009 shared queue counts active resident shards, never merely reserved shards", () => {
  const batches = [
    { count: 2, completed: new Set([0]), unsent: new Set<number>() },
    { count: 2, completed: new Set<number>(), unsent: new Set([1]) },
  ];
  assert.equal(activeResidentWorkers(batches), 2);
  batches[0].completed.add(1);
  assert.equal(activeResidentWorkers(batches), 1, "finished work frees shared admission");
  batches[1].unsent.delete(1);
  assert.equal(activeResidentWorkers(batches), 2, "submitting a shard consumes exactly one slot");
});

test("slow cold reconstruction warms caches but must catch up to the unchanged realm clock", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request()); const cold = queue.take()!;
  queue.offer(request("town-a", 1000));
  assert.equal(queue.complete(cold.id, result), false);
  assert.equal(queue.current, undefined);
  const warm = queue.take()!;
  assert.equal(warm.tick, 1000);
  assert.equal(queue.complete(warm.id, result), true);
  assert.equal(queue.take(), undefined, "same view and tick are not recomputed");
  queue.offer(request("town-a", 1024));
  assert.equal(queue.current?.tick, 1000, "a recent snapshot survives normal asynchronous refresh");
  assert.equal(queue.take()?.tick, 1024);
});

test("leaving resident detail clears queued and visible results without interrupting terrain workers", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request()); const pending = queue.take()!;
  queue.clear();
  assert.equal(queue.ready, false);
  assert.equal(queue.complete(pending.id, result), false);
  assert.equal(queue.take(), undefined);
  queue.offer(request("new-town"));
  assert.equal(queue.take()?.key, "new-town");
});


test("parallel population shards reproduce the single-worker query in stable order", async () => {
  const { villages, places } = await import("../src/geography.ts"), { LazySimulation, residentOrderFor } = await import("../src/simulation.ts"),
    place = villages[0], simulation = new LazySimulation();
  simulation.setFocus(place);
  simulation.advance(0);
  const expected = simulation.focusedResidents(place.x, place.z, 10, 200);
  const shards = [2, 0, 1].map(index => {
    const residents = simulation.focusedResidents(place.x, place.z, 10, 200, { index, count: 3 });
    assert.ok(residents.every(resident => resident.index % 3 === index));
    return { residents, query: simulation.stats.query };
  });
  const order = new Map(places.map(place => [place.id, residentOrderFor(place)])), rank = resident => order.get(resident.settlement)!(resident.index);
  const merged = mergeResidentQueries(shards, 200, rank);
  assert.deepEqual(merged.residents, expected);
  assert.equal(new Set(merged.residents.map(resident => resident.code)).size, merged.residents.length);
  assert.deepEqual(mergeResidentQueries(shards, 7, rank).residents, expected.slice(0, 7));
});


test("snapshot readiness expires with the realm clock even when the camera stays still", () => {
  const queue = new ResidentQueryQueue(48);
  queue.offer(request()); const job = queue.take()!;
  queue.complete(job.id, result);
  assert.equal(queue.readyFor("town-a", 148), true);
  assert.equal(queue.readyFor("town-a", 149), false);
  assert.equal(queue.readyFor("another-town", 100), false);
  queue.offer(request("town-a", 149));
  assert.equal(queue.ready, false);
  assert.equal(queue.current, undefined);
  assert.equal(queue.take()?.tick, 149, "expired snapshot schedules a current reconstruction");
});


test("completed frames cannot feed back into population queries within one real second", () => {
  const queue = new ResidentQueryQueue(48, 24);
  queue.offer(request("town-a", 100)); const initial = queue.take()!;
  assert.equal(queue.complete(initial.id, result, 101), true);
  for (let tick = 101; tick < 120; tick++) {
    queue.offer(request("town-a", tick));
    assert.equal(queue.take(), undefined, "actor refresh must not start another population scan");
  }
  queue.offer(request("town-a", 120));
  const next = queue.take()!;
  assert.equal(next.tick, 120, "the next real second samples the advancing realm clock");
  queue.complete(next.id, result, 121);
  queue.offer(request("town-b", 121));
  assert.equal(queue.take()?.key, "town-b", "camera navigation stays immediate within the same sampling interval");
});

test("stale result validation uses actual realm time even between scheduled requests", () => {
  const queue = new ResidentQueryQueue(48, 24);
  queue.offer(request("town-a", 100)); const job = queue.take()!;
  assert.equal(queue.complete(job.id, result, 149), false);
  assert.equal(queue.ready, false);
});


test("distant same-settlement pans never reuse unrelated resident actors or nearby facts", () => {
  const previous = { ...request("capital-neighbourhood", 100), placeCode: "capital", x: 12, z: -8, radius: 6 };
  const near = { x: 12.5, z: -8, radius: 6 }, far = { x: 28, z: -8, radius: 6 };
  assert.equal(currentResidentSnapshot(undefined, previous, "capital", 101, 48, near), previous,
    "a tiny pan keeps a valid recent same-area snapshot while the worker catches up");
  assert.equal(currentResidentSnapshot(undefined, previous, "capital", 101, 48, far), undefined,
    "a different part of the same city cannot inherit old nearby residents");
  assert.equal(currentResidentSnapshot(undefined, previous, "capital", 101, 48, { x: 12, z: -8, radius: 0.1 }), previous,
    "zooming at the exact same centre keeps the canonical physical actor position");
  const staleCurrent = { ...previous, placeCode: "other-town" };
  assert.equal(currentResidentSnapshot(staleCurrent, previous, "capital", 101, 48, near), previous,
    "a mismatched current result cannot conceal a relevant previous result");
});

test("panning retains fresh world positions while a newer view query is submitted", () => {
  const previous = { placeCode: "town-a", tick: 100, x: 12.5, z: -8 };
  assert.equal(currentResidentSnapshot(undefined, previous, "town-a", 101, 48), previous,
    "a pan does not discard a completed same-town update or rewrite its coordinates");
  assert.equal(currentResidentSnapshot(undefined, previous, "town-b", 101, 48), undefined,
    "a distant settlement never inherits another town's population");
  assert.equal(currentResidentSnapshot(undefined, previous, "town-a", 149, 48), undefined,
    "old world positions are not refreshed indefinitely");
  assert.equal(currentResidentSnapshot(undefined, previous, undefined, 101, 48), undefined,
    "leaving actor detail clears any fallback");
});

test("selected real actor stays visible during nearby population handoff, never when absent or elsewhere", () => {
  const view = { x: 12, z: 6, radius: .4 },
    actual = { x: 12.03, z: 5.99, grounded: true, indoors: false };
  assert.equal(selectedResidentVisibleInView(actual, view), true,
    "a real selected resident at the close camera remains eligible while a new query arrives");
  assert.equal(selectedResidentVisibleInView({ ...actual, indoors: true }, view), false);
  assert.equal(selectedResidentVisibleInView({ ...actual, grounded: false }, view), false);
  assert.equal(selectedResidentVisibleInView({ ...actual, x: 13 }, view), false,
    "a long pan never drags the old actor to a new location");
  assert.equal(selectedResidentVisibleInView(actual, undefined), false);
  assert.equal(selectedResidentVisibleInView(undefined, view), false,
    "absent residents never acquire a selected 3D stand-in");
  assert.equal(selectedResidentVisibleInView({ ...actual, x: -131071.98 },
    { x: 131071.98, z: 6, radius: .1 }), true,
    "the real canonical seam is wrapped rather than sending the actual actor to another world");
});

test("S009 repeated metre samples retain exact original SEED walkability in either direction", () => {
  const place = villages[0],
    samples = [
      [{ eastM: 0, northM: 0 }, { eastM: 13, northM: -8 }],
      [{ eastM: -0, northM: 0 }, { eastM: 8, northM: -0 }],
      [{ eastM: 91.01459183919955, northM: 0 }, { eastM: 91.01459183919954, northM: 7 }],
      [{ eastM: 18, northM: -12 }, { eastM: 25, northM: -18 }],
    ] as const;
  for (const [a, b] of samples) {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const full = continuousWalkableOffsetSegment(from, to,
        point => legalPosition(place, point.eastM, point.northM).grounded);
      for (let repeat = 0; repeat < 2; repeat++)
        assert.equal(continuousWalkableOffsetSegment(from, to,
          point => residentEndpointWalkable(place, point)), full,
        "a cached exact metre cannot invent dry ground, bridge access or a successful blocked leg");
    }
  }
});

test("S009 roster-only daily activities preserve every canonical outdoor rank and anchor", () => {
  // Independent full dailyPlan witness: no authority, seeded minute roll or
  // character-facing schedule is changed by the reduced standing-slot path.
  const roles = ["innkeeper", "merchant", "blacksmith", "farmer", "butcher",
    "guard-officer", "guard", "artisan", "laborer", "trader", "clergy",
    "noble", "beggar", "elder"] as const;
  let compared = 0, fullEntries = 0, standingEntries = 0;
  for (const role of roles)
    for (const ageGroup of ["adult", "elder"] as const)
      for (const guardShift of [0, 1] as const)
        for (const [day, weekday] of [[0, 0], [6, 6], [14, 3], [35, 6]] as const) {
          const subject: RoutineSubject = {
            code: `SEED/ROSTER/PARITY/${role}/${ageGroup}/${guardShift}`,
            role, ageGroup, guardShift,
          };
          const traits = traitsFor(subject.code, role, ageGroup),
            original = dailyPlan(subject, traits, day, weekday),
            reduced = dailyStandingActivities(subject, traits, day, weekday),
            normalize = (entries: typeof original) =>
              entries.filter(entry => !entry.indoors && entry.anchor !== "home")
                .map(entry => `${entry.kind}/${entry.anchor}`).sort();
          assert.deepEqual(normalize(reduced), normalize(original),
            `${role} ${ageGroup} shift ${guardShift} day ${day}/${weekday}`);
          const personality = personalityFor(subject.code, role);
          assert.deepEqual(personality, traits.personality,
            "lean SEED personality must equal the full immutable trait calculation");
          assert.deepEqual(normalize(dailyStandingActivities(subject, { personality }, day, weekday)),
            normalize(original), "lean personality must preserve full standing-slot ranks");
          assert.ok(reduced.every(entry => !entry.indoors && entry.anchor !== "home"));
          fullEntries += original.length;
          standingEntries += reduced.length;
          compared++;
        }
  assert.equal(compared, 224);
  assert.ok(standingEntries < fullEntries / 2,
    "a cold roster should not materialize the many unrelated indoor/time events");
});

test("S009 resident-only worker stays free of eager geometry/asset imports", async () => {
  // A cold actor query must not evaluate rendering, mesh or GLB modules before
  // its first Simulation result. The same tile renderer still handles every
  // real coverage/detail job when that worker receives one.
  const { readFileSync } = await import("node:fs");
  const bootstrap = readFileSync(new URL("../src/tile-worker.ts", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/tile-render-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(bootstrap, /^import (?!type )/m,
    "resident worker bootstrap must have no eager runtime module imports");
  assert.match(bootstrap, /tileRendererReady \?\?= import\("\.\/tile-render-worker\.ts"\)/,
    "rendering modules must load on demand, not during resident initialization");
  assert.match(bootstrap, /renderTileJob\(job, started\)/,
    "first-use dynamic module load must remain inside measured tile end-to-end duration");
  assert.match(renderer, /renderTileJob\(job: TileJob, started: number\)/,
    "the unchanged tile renderer must receive the original worker start timestamp");
  assert.ok(bootstrap.indexOf('self.postMessage({ready:true})') >
    bootstrap.indexOf("self.onmessage ="),
    "workers must register their handler before advertising readiness");
  assert.ok(renderer.indexOf("rebuildNaturalSurface(tile, emptyTerrain)") <
    renderer.indexOf("await meshAssetsReady") &&
    renderer.indexOf("await meshAssetsReady") <
    renderer.indexOf("base = buildTile(tile, {skipBaseTerrain:proposed.replaced})"),
    "natural terrain may overlap GLB loading but exact detail geometry must await all models");
  for (const requirement of ["buildTile(", "rebuildNaturalSurface(", "refineTileSurfacePresentation(",
    "buildVegetationGeometry(", "convertTileGeometryToEnu(", "await meshAssetsReady"]) {
    assert.ok(renderer.includes(requirement), `the exact terrain renderer still performs ${requirement}`);
  }
});

test("S009 long blocked-route terminal preflight retains exact every-metre legality", () => {
  // Independent original metre enumeration: the optimization may change only
  // rejection order, never the physical sample set or route truth.
  for (const steps of [33, 64, 127, 256]) {
    const from = { eastM: 0.125, northM: -3.5 },
      to = { eastM: steps + 0.125, northM: -3.5 },
      key = (point: { eastM: number; northM: number }) =>
        `${Object.is(point.eastM, -0) ? "-0" : point.eastM}|${Object.is(point.northM, -0) ? "-0" : point.northM}`,
      original = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return key({ eastM: from.eastM + (to.eastM - from.eastM) * t,
          northM: from.northM + (to.northM - from.northM) * t });
      }),
      visited: string[] = [];
    assert.equal(continuousWalkableOffsetSegment(from, to, point => {
      visited.push(key(point));
      return true;
    }), true);
    assert.equal(visited.length, original.length, "each accepted original metre sampled once");
    assert.deepEqual([...visited].sort(), [...original].sort(),
      "accepted path uses the exact original floating-point positions");
    for (let blocked = 0; blocked <= steps; blocked++) {
      const blockedKey = original[blocked];
      assert.equal(continuousWalkableOffsetSegment(from, to,
        point => key(point) !== blockedKey), false,
      "a blocked original metre must still reject the complete route");
    }
    let terminalChecks = 0;
    assert.equal(continuousWalkableOffsetSegment(from, to, point => {
      terminalChecks++;
      return key(point) !== original[steps];
    }), false);
    assert.equal(terminalChecks, 2,
      "after the original central safety probe, a blocked terminal rejects before the corridor scan");
  }
});

test("S010 exact structural ray refuses a real wall before an illustrated resident", () => {
  const wall = [-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0],
    triangles = [0, 1, 2, 0, 2, 3];
  assert.equal(structuralMeshBlocksSegment({x:0,y:0,z:2}, {x:0,y:0,z:-2}, wall, triangles), true,
    "actual near roof/wall triangles block a ray to the resident behind");
  assert.equal(structuralMeshBlocksSegment({x:3,y:0,z:2}, {x:3,y:0,z:-2}, wall, triangles), false,
    "nearby visible resident ray must not be hidden by a different wall");
  assert.equal(structuralMeshBlocksSegment({x:0,y:0,z:2}, {x:0,y:0,z:1}, wall, triangles), false,
    "world geometry behind a foreground resident never rejects its selection");
  assert.equal(structuralMeshBlocksSegment({x:0,y:0,z:-1}, {x:0,y:0,z:2}, wall, triangles), true,
    "two-sided structural geometry blocks from either side without culling");
});

test("S010 structural occlusion reaches grounded feet beyond an estimated painted tap depth", () => {
  assert.equal(residentOcclusionReachDepth(-15, -23), -23,
    "a transparent lower cutout cannot truncate the roof ray before real feet");
  assert.equal(residentOcclusionReachDepth(-23, -15), -23,
    "a closer grounded foot must not shorten a legitimate painted tap ray");
});

test("S010 opaque world walls prevent picking an illustrated resident behind their depth", () => {
  const ownMesh = {}, wallMesh = {}, terrainMesh = {};
  assert.equal(residentGpuHitAllows(-15, -7, [ownMesh], [wallMesh, ownMesh]), false,
    "a visible touch rectangle does not grant selection through a closer opaque wall pixel");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh, terrainMesh]), true,
    "the same actual resident remains selectable over deeper world terrain");
  assert.equal(residentGpuHitAllows(-15, -15, [ownMesh], [ownMesh]), true,
    "the actor itself is the nearest painted depth");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], []), true,
    "empty sky-touch padding remains eligible when genuine actor pixels are nearby");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], [wallMesh]), false,
    "a null depth sample must not excuse an opaque wall ID at the exact clicked pixel");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], [ownMesh]), true,
    "a pixel on the real resident remains valid if depth readback is unavailable");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh], [ownMesh], -7), false,
    "world-only GPU pass exposes a real foreground roof hidden by the resident's own quad ID");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], [], -7), false,
    "a missing first depth sample still cannot select through the actual opaque wall");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh], [ownMesh], -21), true,
    "the same resident stays selectable when the world surface is genuinely behind it");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh, wallMesh], [wallMesh], -21, true), false,
    "an opaque wall owning the exact tap overrides a nearby 44px actor candidate even when the wall depth is farther");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh, wallMesh], [ownMesh], -21, true), true,
    "a visible actor ID at the exact tap remains pickable when a wall is behind it");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], [ownMesh], null, true), false,
    "opaque world-only roof ID rejects a resident even when GPU depth readback has a hole");
  assert.equal(residentGpuHitAllows(-15, null, [ownMesh], [ownMesh], [ownMesh], null, false), true,
    "a readable resident pixel above background terrain remains selectable without world depth");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [ownMesh], [ownMesh], -21, true), true,
    "a genuinely deeper world surface does not suppress a foreground resident");
  assert.equal(residentGpuHitAllows(-15, -20, [ownMesh], [terrainMesh]), false,
    "no original painted resident pixel means no invisible proxy selection");
  assert.equal(residentGpuHitAllows(-15, -20, [], [ownMesh]), false);
  assert.equal(residentGpuHitAllows(NaN, -20, [ownMesh], [ownMesh]), false);
  assert.equal(residentGpuHitAllows(-15, NaN, [ownMesh], [ownMesh]), false);
});

test("WP #550: selected visible resident retains only current Simulation feet during worker handoff", () => {
  const view = {x: 10, z: 20, radius: 3};
  const resident = {code: "SEED/RESIDENT/7", x: 11, z: 21, grounded: true, indoors: false};
  assert.equal(selectedResidentCurrentCarryover(resident.code, resident, view), true,
    "same resident at current lawful outdoor position can survive a slow view refocus");
  assert.equal(selectedResidentCurrentCarryover(resident.code, {...resident, x: 12}, view), true,
    "live Simulation movement remains valid during the same pending worker query");
  assert.equal(selectedResidentCurrentCarryover("SEED/RESIDENT/8", resident, view), false,
    "never replace an inspected person with another actor");
  assert.equal(selectedResidentCurrentCarryover(resident.code, {...resident, indoors: true}, view), false,
    "re-entering an actual home removes the outdoor mesh immediately");
  assert.equal(selectedResidentCurrentCarryover(resident.code, {...resident, grounded: false}, view), false,
    "unlawful or ungrounded residents cannot be held");
  assert.equal(selectedResidentCurrentCarryover(resident.code, {...resident, x: 50}, view), false,
    "moving outside the actual camera query must not keep a phantom");
  assert.equal(selectedResidentCurrentCarryover(resident.code, undefined, view), false,
    "missing current Simulation authority cannot be replaced by a cached sprite");
});
