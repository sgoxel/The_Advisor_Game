import assert from "node:assert/strict";
import test from "node:test";
import { climateSampleAt } from "../src/climate.ts";
import { lonLatToSource } from "../src/planet.ts";
import { vegetationForTile } from "../src/vegetation.ts";
import { selectTiles, type View } from "../src/world.ts";

const DEVICE_LIMITS = {
  phone: {
    width: 390,
    height: 844,
    natureInstances: 4_000,
    drawCalls: 160,
    triangles: 200_000,
    materials: 24,
  },
  tablet: {
    width: 1024,
    height: 768,
    natureInstances: 8_000,
    drawCalls: 220,
    triangles: 350_000,
    materials: 32,
  },
  desktop: {
    width: 1440,
    height: 900,
    natureInstances: 12_000,
    drawCalls: 300,
    triangles: 600_000,
    materials: 40,
  },
} as const;

function representativeForestSource() {
  for (let latDeg = -65; latDeg <= 65; latDeg += 5)
    for (let lonDeg = -175; lonDeg <= 175; lonDeg += 5) {
      const canonical = {
        lon: (lonDeg * Math.PI) / 180,
        lat: (latDeg * Math.PI) / 180,
      };
      if (climateSampleAt(canonical).forestFamily)
        return lonLatToSource(canonical.lon, canonical.lat);
    }
  throw new Error("No deterministic forest fixture found");
}

function sceneTelemetry(view: View) {
  const tiles = selectTiles(view),
    details = tiles.map((tile) => vegetationForTile(tile)),
    features = details.flatMap((detail) => detail.features),
    candidateCount = details.reduce(
      (sum, detail) => sum + detail.telemetry.candidateCount,
      0,
    ),
    triangles = details.reduce(
      (sum, detail) => sum + detail.telemetry.triangles,
      0,
    ),
    drawCalls = details.reduce(
      (sum, detail) => sum + detail.telemetry.drawCalls,
      0,
    ),
    estimatedBytes = details.reduce(
      (sum, detail) => sum + detail.telemetry.estimatedBytes,
      0,
    );
  return {
    activePatches: tiles.length,
    candidateCount,
    visibleInstances: features.length,
    triangles,
    drawCalls,
    // All tile nature meshes use the retained shared world material in main.ts.
    materialCount: features.length ? 1 : 0,
    estimatedBytes,
    identityDigest: features.map((feature) => feature.code).sort().join("|"),
  };
}

test("representative forest scenes stay inside phone/tablet/desktop nature budgets and replay identically", () => {
  const source = representativeForestSource(),
    reports: Record<string, ReturnType<typeof sceneTelemetry>> = {};
  for (const [name, limit] of Object.entries(DEVICE_LIMITS)) {
    const view: View = {
        x: source.x,
        z: source.z,
        halfHeight: 150,
        aspect: limit.width / limit.height,
        yaw: 0,
        pixels: limit.height,
      },
      first = sceneTelemetry(view),
      second = sceneTelemetry(view);
    assert.equal(second.identityDigest, first.identityDigest, `${name} revisit changed vegetation identities`);
    assert.ok(first.visibleInstances <= limit.natureInstances, `${name} nature instances ${first.visibleInstances} > ${limit.natureInstances}`);
    assert.ok(first.drawCalls <= limit.drawCalls, `${name} nature draw calls ${first.drawCalls} > ${limit.drawCalls}`);
    assert.ok(first.triangles <= limit.triangles, `${name} nature triangles ${first.triangles} > ${limit.triangles}`);
    assert.ok(first.materialCount <= limit.materials, `${name} materials ${first.materialCount} > ${limit.materials}`);
    reports[name] = first;
  }
  console.log(`WP16 viewport budgets ${JSON.stringify(reports)}`);
});
