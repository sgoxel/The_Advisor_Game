import test from "node:test";
import assert from "node:assert/strict";
import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed, residentColdQueryCanStart, residentWorkerShardPlan, terrainWorkerIndexAvoidingWarmResident, residentActorPickDistance, residentMotionFraction, residentLabelRightOfActor, ownedDoorLabelClearOfResident, residentQueryLimitForView, residentActorSearchContinues, selectedResidentVisibleInView, activeResidentWorkers } from "../src/resident-query.ts";
import { LazySimulation, residentOrderFor, residentFoundationAt, residentStandSeedFor, neighbourhoodSite, routineHasAnchorChange, fieldConnectorsAllowCore } from "../src/simulation.ts";
import { villages, cities, type Place } from "../src/geography.ts";
import { settlementExteriorFor, settlementHomeFor, settlementHomeAnchorFor } from "../src/settlement-exterior.ts";
import { continuousWalkableOffsetSegment, residentEndpointWalkable, legalPosition } from "../src/simulation.ts";
import { dailyPlan, dailyStandingActivities, personalityFor, traitsFor, type RoutineSubject } from "../src/routines.ts";

const request = (key = "town-a", tick = 100) => ({ key, tick, placeCode: "town", x: 0, z: 0, radius: 2, limit: 160 });
const result = { residents: [], query: { settlements: 1, candidateResidents: 20, evaluatedResidents: 20, returnedResidents: 0 } };

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

test("S009 cold resident precomputation reserves one real terrain worker and admission slot", () => {
  const allowed = residentColdQueryCanStart;
  assert.equal(allowed(false, 12, 2, 0, 4), true,
    "a close scene with two spare workers may overlap canonical resident facts and terrain");
  assert.equal(allowed(false, 12, 3, 3, 6), true,
    "bounded existing workers may prepare a resident while mandatory tiles keep capacity");
  assert.equal(allowed(false, 12, 1, 0, 4), false,
    "one-worker hardware cannot lose the only worker to resident replay");
  assert.equal(allowed(false, 12, 2, 3, 4), false,
    "one remaining shared admission slot belongs to required terrain");
  assert.equal(allowed(true, 12, 2, 0, 4), false,
    "a pending camera change must not start an obsolete actor query");
  for (const halfHeight of [20, 48, 100, Infinity, NaN])
    assert.equal(allowed(false, halfHeight, 4, 0, 8), false,
      "remote and invalid camera scales must not precompute unrelated actors");
  assert.equal(allowed(false, 12, 2, 6, 6), false,
    "a fully occupied admission cannot overcommit workers");
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
