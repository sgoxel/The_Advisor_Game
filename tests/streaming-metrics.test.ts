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
