import test from "node:test";
import assert from "node:assert/strict";
import { ResidentQueryQueue, mergeResidentQueries, currentResidentSnapshot, residentDispatchAllowed } from "../src/resident-query.ts";
const request = (key = "town-a", tick = 100) => ({ key, tick, placeCode: "town", x: 0, z: 0, radius: 2, limit: 160 });
const result = { residents: [], query: { settlements: 1, candidateResidents: 20, evaluatedResidents: 20, returnedResidents: 0 } };

test("resident facts can dispatch after coherent coverage before optional fine meshes", () => {
  const allowed = residentDispatchAllowed;
  assert.equal(allowed(false, true, false, 1, 4, false), true,
    "a spare worker may answer logical resident facts while fine terrain continues");
  assert.equal(allowed(false, false, true, 4, 4, false), false,
    "initial coherent terrain must still complete before starting inspection");
  assert.equal(allowed(true, true, true, 4, 4, false), false,
    "a pending camera selection cannot start a stale query");
  assert.equal(allowed(false, true, false, 1, 1, false), false,
    "a single worker keeps preparing mandatory terrain until it is ready");
  assert.equal(allowed(false, true, true, 1, 1, false), true,
    "a single worker may inspect after mandatory tiles are cached");
  assert.equal(allowed(true, false, false, 1, 4, true), true,
    "remaining shards of an already started job must retire after navigation");
  assert.equal(allowed(false, true, true, 0, 4, true), false,
    "an occupied worker is never double-dispatched");
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
