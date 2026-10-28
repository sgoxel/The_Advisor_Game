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
  metrics.complete(1, true, 360, { preparationMs: 65, queryMs: 120, indexBuildMs: 85,
    candidateLookupMs: 90, foundationMs: 3, doorMs: 4, scheduleMs: 13, overnightRiskMs: 9, groundingMs: 2 }, false);
  const report = metrics.summary();
  assert.equal(report.offerToDispatchMs.latest, 40);
  assert.equal(report.dispatchToResponseMs.latest, 220);
  assert.equal(report.acceptedResponseMs.latest, 220);
  assert.equal(report.workerPreparationWallMs.latest, 65);
  assert.equal(report.coldWorkerQueryWallMs.latest, 120);
  assert.equal(report.workerIndexBuildWallMs.latest, 85);
  assert.equal(report.workerNonIndexQueryWallMs.latest, 35);
  assert.equal(report.workerCandidateLookupWallMs.latest, 90);
  assert.equal(report.workerResidentFoundationWallMs.latest, 3);
  assert.equal(report.workerResidentDoorWallMs.latest, 4);
  assert.equal(report.workerResidentScheduleWallMs.latest, 13);
  assert.equal(report.workerResidentOvernightRiskWallMs.latest, 9);
  assert.equal(report.workerResidentGroundingWallMs.latest, 2);
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
  assert.equal(metrics.summary().workerIndexBuildWallMs.samples, 0);
  assert.equal(metrics.summary().workerNonIndexQueryWallMs.samples, 0);
  assert.equal(metrics.summary().workerResidentDoorWallMs.samples, 0);
  assert.equal(metrics.summary().workerResidentScheduleWallMs.samples, 0);
  assert.equal(metrics.summary().workerResidentOvernightRiskWallMs.samples, 0);
  assert.equal(metrics.summary().firstAcceptedViewMs, null);
});

test("overlapping resident timings stay attached to their own request IDs", () => {
  const metrics = new ResidentQueryPhaseSamples();
  metrics.offer("old-town", 10);
  metrics.dispatch(1, "old-town", 20);
  metrics.offer("new-town", 25);
  metrics.dispatch(2, "new-town", 30);
  metrics.complete(2, true, 50, { queryMs: 18, scheduleMs: 7 }, true);
  metrics.complete(1, false, 100, { queryMs: 60, scheduleMs: 11 }, false);
  const s = metrics.summary();
  assert.equal(s.accepted, 1);
  assert.equal(s.staleViewOrCleared, 1);
  assert.equal(s.acceptedResponseMs.latest, 20);
  assert.equal(s.staleResponseMs.latest, 80);
  assert.equal(s.firstAcceptedViewMs, 25);
  assert.equal(s.workerResidentScheduleWallMs.samples, 2, "late older result retains its own observational phases");
  metrics.complete(1, true, 101);
  assert.equal(metrics.summary().accepted, 1, "duplicate completions cannot mutate statistics");
});

test("separate bounded coverage/detail worker stages expose honest p95 without changing work", async () => {
  const { TileWorkerPhaseSamples } = await import("../src/streaming-metrics.ts");
  const phases = new TileWorkerPhaseSamples();
  assert.equal(phases.summary().coverage.totalMs.p95, null);
  phases.record("residents", { totalMs: 9000 });
  phases.record("coverage", { baseMs: 3, groundRefinementMs: 4, decorationMs: 1, totalMs: 8 });
  phases.record("coverage", { baseMs: 4, groundRefinementMs: 5, decorationMs: 2, totalMs: 11 });
  phases.record("detail", { baseMs: 20, groundRefinementMs: 80, naturalMs: 54, surfaceRefinementMs: 26,
    decorationMs: 40, totalMs: 140 });
  phases.record("detail", { baseMs: NaN, groundRefinementMs: -1, decorationMs: Infinity });
  const summary = phases.summary();
  assert.deepEqual(summary.coverage.totalMs, { samples: 2, latest: 11, p50: 8, p95: 11, p99: 11 });
  assert.equal(summary.coverage.baseMs.p95, 4);
  assert.equal(summary.detail.groundRefinementMs.p95, 80);
  assert.equal(summary.detail.totalMs.p95, 140);
  assert.equal(summary.detail.naturalMs.p95, 54);
  assert.equal(summary.detail.surfaceRefinementMs.p95, 26);
  assert.equal(summary.coverage.naturalMs.samples, 0, "coverage never reports fictional natural rebuild time");
  assert.equal(summary.detail.baseMs.samples, 1, "invalid stage data may not produce a fake zero");
  assert.equal(summary.coverage.totalMs.samples, 2, "unrelated resident jobs never count as tiles");
  for (let i = 0; i < 320; i++) phases.record("detail", { totalMs: i });
  assert.equal(phases.summary().detail.totalMs.samples, 300, "stage timing ring remains bounded");
  assert.equal(phases.summary().coverage.totalMs.samples, 2, "detail work does not contaminate coverage p95");
});

test("resident transport phases distinguish worker queue and return delivery without inventing timings", () => {
  const metrics = new ResidentQueryPhaseSamples();
  assert.equal(metrics.summary().mainSendToWorkerMs.samples, 0);
  metrics.recordTransport({ mainSentEpochMs: 100, workerReceiveEpochMs: 130, workerSendEpochMs: 190 }, 260);
  let report = metrics.summary();
  assert.equal(report.mainSendToWorkerMs.latest, 30);
  assert.equal(report.workerReceiveToSendMs.latest, 60);
  assert.equal(report.workerSendToMainMs.latest, 70);
  assert.equal(report.mainSendToResponseMs.latest, 160);
  metrics.recordTransport({ mainSentEpochMs: 300, workerReceiveEpochMs: 290, workerSendEpochMs: 400 }, 500);
  metrics.recordTransport({ mainSentEpochMs: 300, workerReceiveEpochMs: 400 }, 500);
  metrics.recordTransport({ mainSentEpochMs: 300, workerReceiveEpochMs: 400, workerSendEpochMs: 450 }, 449);
  report = metrics.summary();
  assert.equal(report.mainSendToResponseMs.samples, 1, "invalid or partial cross-thread epochs never imply zero latency");
  assert.equal(report.accepted, 0, "observations cannot accept a resident or mutate Simulation");
});
