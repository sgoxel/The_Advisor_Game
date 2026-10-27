import { test } from "node:test";
import assert from "node:assert/strict";
import { BoundedTimingSamples } from "../src/streaming-metrics.ts";

test("streaming timings are absent, not fake zero values, before an observation", () => {
  const samples = new BoundedTimingSamples();
  assert.deepEqual(samples.summary(), { samples: 0, latest: null, p50: null, p95: null, p99: null });
  for (const bad of [NaN, Infinity, -Infinity, -1, null, undefined]) samples.record(bad);
  assert.equal(samples.samples, 0, "invalid or missing worker timings do not create samples");
});

test("bounded timing window overwrites old observations and computes nearest-rank p95/p99 on demand", () => {
  const samples = new BoundedTimingSamples(20);
  for (let i = 1; i <= 30; i++) samples.record(i);
  assert.deepEqual(samples.summary(), { samples: 20, latest: 30, p50: 20, p95: 29, p99: 30 });
  samples.record(0);
  assert.deepEqual(samples.summary(), { samples: 20, latest: 0, p50: 20, p95: 29, p99: 30 });
  assert.equal(samples.samples, 20, "samples cannot grow beyond their fixed allocation");
  samples.record(1.25);
  assert.equal(samples.summary().latest, 1.25, "sub-millisecond work retains precision");
  for (const invalid of [0, -4, 1.5]) {
    if (invalid < 0) samples.record(invalid);
  }
});

test("small timing windows and capacity bounds remain well-defined", () => {
  const singleton = new BoundedTimingSamples(1);
  singleton.record(8);
  assert.deepEqual(singleton.summary(), { samples: 1, latest: 8, p50: 8, p95: 8, p99: 8 });
  singleton.record(2);
  assert.deepEqual(singleton.summary(), { samples: 1, latest: 2, p50: 2, p95: 2, p99: 2 });
  for (const capacity of [0, -1, 1.5, 10_001, Infinity, NaN])
    assert.throws(() => new BoundedTimingSamples(capacity), RangeError);
});

import { ResidentQueryPhaseSamples } from "../src/streaming-metrics.ts";

test("resident first-fact latency separates queue waiting, cold preparation and worker query", () => {
  const metrics = new ResidentQueryPhaseSamples();
  metrics.offer("town-a", 100);
  metrics.offer("town-a", 110);
  metrics.dispatch(1, "town-a", 140);
  metrics.complete(1, true, 360, { preparationMs: 65, queryMs: 120 }, false);
  const report = metrics.summary();
  assert.equal(report.offerToDispatchMs.latest, 40);
  assert.equal(report.dispatchToResponseMs.latest, 220);
  assert.equal(report.acceptedResponseMs.latest, 220);
  assert.equal(report.workerPreparationWallMs.latest, 65);
  assert.equal(report.coldWorkerQueryWallMs.latest, 120);
  assert.equal(report.warmWorkerQueryWallMs.samples, 0);
  assert.equal(report.firstAcceptedViewMs, 260);
  assert.equal(report.accepted, 1);
});

test("old-camera and aged-tick answers are counted but never classified as accepted", () => {
  const metrics = new ResidentQueryPhaseSamples();
  metrics.offer("town-a", 100);
  metrics.dispatch(1, "town-a", 120);
  metrics.offer("town-b", 130);
  metrics.complete(1, false, 200, { queryMs: 50 }, false);
  metrics.dispatch(2, "town-b", 220);
  metrics.complete(2, false, 270, { queryMs: 40 }, true);
  metrics.offer("town-b", 275);
  metrics.dispatch(3, "town-b", 280);
  metrics.complete(3, true, 290, { queryMs: 8 }, true);
  const report = metrics.summary();
  assert.equal(report.offerToDispatchMs.samples, 3);
  assert.equal(report.staleViewOrCleared, 1);
  assert.equal(report.staleTick, 1);
  assert.equal(report.staleResponseMs.samples, 2);
  assert.equal(report.acceptedResponseMs.samples, 1);
  assert.equal(report.firstAcceptedViewMs, 160, "latest view first offered at 130");
  assert.equal(report.coldWorkerQueryWallMs.samples, 1);
  assert.equal(report.warmWorkerQueryWallMs.samples, 2);
  assert.equal(report.offerToDispatchMs.latest, 150, "same-view retry retains first pending offer");
});

test("clearing a view does not turn a delayed worker answer into an authoritative fact", () => {
  const metrics = new ResidentQueryPhaseSamples();
  metrics.offer("old-view", 10);
  metrics.dispatch(7, "old-view", 20);
  metrics.clearPending();
  metrics.complete(7, false, 40);
  metrics.complete(7, true, 60);
  assert.equal(metrics.summary().accepted, 0);
  assert.equal(metrics.summary().staleViewOrCleared, 1);
  assert.equal(metrics.summary().workerPreparationWallMs.samples, 0);
  assert.equal(metrics.summary().firstAcceptedViewMs, null);
});
