/**
 * WP-S009-003-001 — app-owned resource ledger.
 *
 * The combined CPU+GPU estimate must count each owned resource once per side,
 * must include queued uploads (they become GPU memory), and must never present an
 * incomplete measurement as a complete one.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  UNMEASURED_CATEGORIES,
  buildLedger,
  exceedsCeiling,
  shouldTrim,
} from "../src/memory-ledger.ts";
import { STREAMING_MEMORY_POLICY } from "../src/streaming.ts";

const input = (over = {}) => ({
  cachedGeometryBytes: 1_000_000,
  readyUploadBytes: 250_000,
  surfaceBytes: 4_000_000,
  continuityCpuBytes: 500_000,
  ...over,
});

test("the combined total counts cached geometry once per side", () => {
  const ledger = buildLedger(input());
  assert.equal(ledger.categories["cached-geometry-cpu"], 1_000_000);
  assert.equal(ledger.categories["cached-geometry-gpu"], 1_000_000);
  // Present on both sides, but not double-counted within one side.
  assert.equal(ledger.cpuBytes, 1_000_000 + 250_000 + 4_000_000 + 500_000);
});

test("queued uploads are counted on both CPU and GPU (the original undercount)", () => {
  const withUploads = buildLedger(input());
  const withoutUploads = buildLedger(input({ readyUploadBytes: 0 }));
  assert.equal(withUploads.categories["ready-upload-gpu"], 250_000);
  // The GPU side must grow by the queued bytes; previously it did not at all.
  assert.equal(withUploads.gpuBytes - withoutUploads.gpuBytes, 250_000);
  assert.equal(withUploads.combinedBytes - withoutUploads.combinedBytes, 500_000, "once per side");
});

test("the surface texture is padded on the GPU side only", () => {
  const ledger = buildLedger(input({ surfaceBytes: 3_000_000 }));
  assert.equal(ledger.categories["surface-texture-cpu"], 3_000_000);
  assert.equal(ledger.categories["surface-texture-gpu"], Math.ceil(3_000_000 * 4 / 3));
});

test("combined equals CPU plus GPU exactly", () => {
  const ledger = buildLedger(input());
  assert.equal(ledger.combinedBytes, ledger.cpuBytes + ledger.gpuBytes);
});

test("unmeasured resource classes are named rather than treated as zero", () => {
  const ledger = buildLedger(input());
  assert.ok(ledger.unmeasured.length >= 4);
  for (const expected of ["shadow-maps", "render-targets", "glb-model-textures"]) {
    assert.ok(ledger.unmeasured.includes(expected), `"${expected}" must be declared unmeasured`);
  }
  assert.equal(ledger.lowerBound, true, "an incomplete measurement must be labelled a lower bound");
  assert.equal(UNMEASURED_CATEGORIES.length, ledger.unmeasured.length);
});

test("negative or non-finite inputs can never reduce the total", () => {
  const ledger = buildLedger({
    cachedGeometryBytes: -5_000,
    readyUploadBytes: Number.NaN,
    surfaceBytes: -1,
    continuityCpuBytes: Number.POSITIVE_INFINITY,
  });
  const values = Object.values(ledger.categories);
  for (const value of values) assert.ok(Number.isFinite(value) && value >= 0, `bad category value: ${value}`);
});

test("an empty ledger is zero, not negative", () => {
  const ledger = buildLedger({ cachedGeometryBytes: 0, readyUploadBytes: 0, surfaceBytes: 0, continuityCpuBytes: 0 });
  assert.equal(ledger.combinedBytes, 0);
  assert.equal(ledger.cpuBytes, 0);
  assert.equal(ledger.gpuBytes, 0);
});

test("trim and ceiling thresholds follow the documented policy", () => {
  const policy = STREAMING_MEMORY_POLICY;
  assert.equal(policy.combinedBytes, 1_000_000_000, "the approved ceiling is 1 GB");
  const small = buildLedger(input());
  const huge = buildLedger(input({ cachedGeometryBytes: 900_000_000 }));

  assert.equal(exceedsCeiling(small, policy.combinedBytes), false);
  assert.equal(exceedsCeiling(huge, policy.combinedBytes), true);
  assert.equal(shouldTrim(small, policy.cacheTrimStartBytes), false);
  assert.equal(shouldTrim(huge, policy.cacheTrimStartBytes), true);
});

test("a realistic warm scene stays far below the ceiling", () => {
  // 60 retained tiles of ~150 KB plus a 2048x1024 globe surface.
  const ledger = buildLedger({
    cachedGeometryBytes: 60 * 150_000,
    readyUploadBytes: 0,
    surfaceBytes: 2048 * 1024 * 4,
    continuityCpuBytes: 8_000_000,
  });
  assert.ok(ledger.combinedBytes < 100_000_000, `warm scene should be well under 100 MB, got ${ledger.combinedBytes}`);
  assert.equal(exceedsCeiling(ledger, 1_000_000_000), false);
});

test("transient worker scratch is reported separately from retained memory", () => {
  const withScratch = buildLedger({ ...input(), transientCpuBytes: 470_000_000 });
  const withoutScratch = buildLedger(input());
  assert.equal(withScratch.transientBytes, 470_000_000);
  assert.equal(withoutScratch.transientBytes, 0);
  // The steady-state cost is visible without the transient peak.
  assert.equal(withScratch.combinedBytes - withoutScratch.combinedBytes, 470_000_000);
  assert.equal(withScratch.categories["transient-worker-scratch"], 470_000_000);
  // Transient memory is still admitted against the ceiling (conservative).
  assert.ok(withScratch.combinedBytes > withoutScratch.combinedBytes);
});

test("a transient peak that is released leaves the retained total unchanged", () => {
  const peak = buildLedger({ ...input(), transientCpuBytes: 200_000_000 });
  const settled = buildLedger({ ...input(), transientCpuBytes: 0 });
  assert.equal(peak.cpuBytes - peak.transientBytes, settled.cpuBytes - settled.transientBytes);
});