import test from "node:test";
import assert from "node:assert/strict";
import { labelAnchorFingerprint, labelLayoutNeedsMeasurement } from "../src/label-layout-cache.ts";

test("WP #81 unchanged atlas frames skip 300 redundant label/panel measurements", () => {
  const labels = [{ id: "seed-capital-a", x: 500.2, y: 300.1 }];
  const key = labelAnchorFingerprint(1920, 1080, labels);
  assert.equal(labelLayoutNeedsMeasurement(key, "", true), true);
  for (let i = 0; i < 300; i++) {
    assert.equal(labelLayoutNeedsMeasurement(
      labelAnchorFingerprint(1920, 1080, labels), key, false,
    ), false, "unchanged visible anchor must take DOM-free fast path");
  }
  assert.equal(labelLayoutNeedsMeasurement(
    labelAnchorFingerprint(1080, 1920, labels), key, false,
  ), true, "portrait resize invalidates cache");
  assert.equal(labelLayoutNeedsMeasurement(
    labelAnchorFingerprint(1920, 1080, [{ ...labels[0], x: 506 }]), key, false,
  ), true, "a moved camera updates label placement");
  assert.equal(labelLayoutNeedsMeasurement(key, key, true), true,
    "font load / panel visibility / selection invalidation must remeasure");
  assert.notEqual(labelAnchorFingerprint(1920, 1080,
    [{ ...labels[0], id: "seed-capital-b" }]), key,
    "a different canonical SEED label cannot reuse another label's hit target");
});
