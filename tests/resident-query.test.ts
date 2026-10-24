import test from "node:test";
import assert from "node:assert/strict";
import { ResidentQueryQueue, mergeResidentQueries } from "../src/resident-query.ts";
const request = (key = "town-a", tick = 100) => ({ key, tick, placeCode: "town", x: 0, z: 0, radius: 2, limit: 160 });
const result = { residents: [], query: { settlements: 1, candidateResidents: 20, evaluatedResidents: 20, returnedResidents: 0 } };

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
