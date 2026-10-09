import assert from "node:assert/strict";
import test from "node:test";
import { cities, roadAt, nearestPlace } from "../src/geography.ts";
import { wrapSourceX } from "../src/planet.ts";
import { buildVegetationGeometry } from "../src/vegetation-render.ts";
import {
  vegetationForTile,
  type VegetationFeature,
} from "../src/vegetation.ts";
import { biomeAt, WORLD_SIZE, type Tile } from "../src/world.ts";

const SCATTER_SPACING = 16;

function tile(minX: number, minZ: number, size: number): Tile {
  return {
    level: 0,
    x: 0,
    z: 0,
    key: `test/${minX}/${minZ}/${size}`,
    size,
    minX,
    minZ,
  };
}

// Cities are deterministic rejection samples on low-relief Mainland. Probe just
// outside each protected urban radius so acceptance tests exercise real dry land
// rather than depending on arbitrary source-plane coordinates that may be ocean.
const probes = cities.slice(0, 16).map((place, index) => {
  const inward = place.x > 0 ? -1 : 1,
    x = place.x + inward * (500 + (index % 3) * 36),
    z = place.z + (index % 2 === 0 ? -180 : 180);
  return [x, z] as const;
});

function populatedTile() {
  for (const [x, z] of probes) {
    const candidate = tile(x, z, 256);
    if (vegetationForTile(candidate).features.length) return candidate;
  }
  throw new Error("No seeded mainland vegetation probe produced a feature");
}

function allProbeFeatures() {
  return probes.flatMap(([x, z]) => vegetationForTile(tile(x, z, 256)).features);
}

function signature(features: readonly VegetationFeature[]) {
  return features.map((feature) => [
    feature.code,
    feature.owner,
    feature.kind,
    feature.family,
    feature.x,
    feature.z,
    feature.scale,
  ]);
}

test("vegetation scatter is deterministic and owns stable canonical identities", () => {
  const sample = populatedTile(),
    first = vegetationForTile(sample),
    second = vegetationForTile(sample);
  assert.deepEqual(signature(first.features), signature(second.features));
  assert.equal(new Set(first.features.map((feature) => feature.code)).size, first.features.length);
  assert.equal(new Set(first.features.map((feature) => feature.owner)).size, first.features.length);
  assert.equal(first.telemetry.cacheKey, second.telemetry.cacheKey);
});

test("one full-turn source wrap replays the same canonical vegetation owners", () => {
  const sample = populatedTile(),
    original = vegetationForTile(sample).features,
    periodic = vegetationForTile(tile(sample.minX + WORLD_SIZE, sample.minZ, sample.size)).features,
    wrappedSignature = periodic.map((feature) => [
      feature.code,
      feature.owner,
      feature.kind,
      feature.family,
      feature.x - WORLD_SIZE,
      feature.z,
      feature.scale,
    ]);
  assert.ok(original.length > 0);
  assert.deepEqual(wrappedSignature, signature(original));
});

test("render tile subdivision clips the same vegetation instead of rerolling it", () => {
  const parent = populatedTile(),
    parentFeatures = vegetationForTile(parent).features,
    half = parent.size / 2,
    children = [
      tile(parent.minX, parent.minZ, half),
      tile(parent.minX + half, parent.minZ, half),
      tile(parent.minX, parent.minZ + half, half),
      tile(parent.minX + half, parent.minZ + half, half),
    ],
    childFeatures = children.flatMap((child) => vegetationForTile(child).features);
  assert.deepEqual(
    signature(childFeatures).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    signature(parentFeatures).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
});

test("scatter does not expose fixed rows or columns", () => {
  const features = allProbeFeatures(),
    xRemainders = new Set(
      features.map((feature) =>
        Math.floor(((feature.x % SCATTER_SPACING) + SCATTER_SPACING) % SCATTER_SPACING),
      ),
    ),
    zRemainders = new Set(
      features.map((feature) =>
        Math.floor(((feature.z % SCATTER_SPACING) + SCATTER_SPACING) % SCATTER_SPACING),
      ),
    ),
    exactTenMetre = features.filter(
      (feature) =>
        Math.abs(feature.x / 10 - Math.round(feature.x / 10)) < 1e-9 ||
        Math.abs(feature.z / 10 - Math.round(feature.z / 10)) < 1e-9,
    ).length;
  assert.ok(features.length >= 8, `only ${features.length} vegetation features across seeded mainland probes`);
  assert.ok(xRemainders.size >= 5, `x jitter collapsed to ${xRemainders.size} remainder buckets`);
  assert.ok(zRemainders.size >= 5, `z jitter collapsed to ${zRemainders.size} remainder buckets`);
  assert.ok(exactTenMetre < features.length / 4, `${exactTenMetre}/${features.length} features still align to 10 m lines`);
});

test("vegetation respects water, road and settlement exclusion authority", () => {
  const features = allProbeFeatures();
  assert.ok(features.length > 0);
  for (const feature of features) {
    assert.ok(!["Ocean", "Lake", "River", "Road", "Settlement"].includes(biomeAt(feature.x, feature.z)));
    assert.equal(roadAt(feature.x, feature.z), undefined);
    const place = nearestPlace(feature.x, feature.z);
    if (!place) continue;
    const distance = Math.hypot(wrapSourceX(feature.x - place.x), feature.z - place.z),
      radius = place.kind === "city" ? 445 : 96;
    assert.ok(distance > radius, `${feature.code} intrudes into ${place.id}`);
  }
});

test("merged runtime vegetation geometry stays inside the tile budget", () => {
  const sample = populatedTile(),
    { features, telemetry } = vegetationForTile(sample),
    built = buildVegetationGeometry(sample),
    triangles = built.geometry.indices.length / 3;
  assert.equal(telemetry.visibleInstances, features.length);
  assert.ok(features.length <= telemetry.maxInstances);
  assert.ok(triangles <= telemetry.maxTriangles, `${triangles} triangles > ${telemetry.maxTriangles}`);
  assert.ok(built.telemetry.drawCalls <= 1);
  assert.ok(built.telemetry.materialCount <= 1);
  assert.ok(built.telemetry.estimatedBytes < 1024 * 1024);
  assert.equal(built.telemetry.visibleInstances, telemetry.visibleInstances);
  assert.equal(built.telemetry.triangles, triangles);
});
