import test from "node:test";
import assert from "node:assert/strict";
import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed, residentWorkerShardPlan, residentActorPickDistance, residentMotionFraction, residentLabelRightOfActor, residentQueryLimitForView, residentActorSearchContinues, selectedResidentVisibleInView } from "../src/resident-query.ts";
const request = (key = "town-a", tick = 100) => ({ key, tick, placeCode: "town", x: 0, z: 0, radius: 2, limit: 160 });
const result = { residents: [], query: { settlements: 1, candidateResidents: 20, evaluatedResidents: 20, returnedResidents: 0 } };

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

test("cold S006 resident query reuses one stable worker without duplicate index builds", () => {
  assert.deepEqual(residentWorkerShardPlan([3, 1]), [
    { workerId: 1, shardIndex: 0, count: 1 },
  ], "first use builds one canonical settlement index, leaving other idle workers for terrain");
  assert.deepEqual(residentWorkerShardPlan([1, 3], new Set([3])), [
    { workerId: 3, shardIndex: 0, count: 1 },
  ], "prefer an idle worker with an already reconstructed resident index");
  assert.deepEqual(residentWorkerShardPlan([2]), [
    { workerId: 2, shardIndex: 0, count: 1 },
  ], "one available worker answers the whole bounded query");
  assert.deepEqual(residentWorkerShardPlan([1, 2], new Set([9])), [
    { workerId: 1, shardIndex: 0, count: 1 },
  ], "a warmed but occupied worker never blocks the next legitimate query");
  assert.deepEqual(residentWorkerShardPlan([3, 3, -1]), [
    { workerId: 3, shardIndex: 0, count: 1 },
  ], "duplicate or invalid worker indices never create unanswered shards");
  assert.deepEqual(residentWorkerShardPlan([]), [], "no available worker starts a batch");
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
