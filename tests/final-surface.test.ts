import assert from "node:assert/strict";
import test from "node:test";
import { roads, villages } from "../src/geography.ts";
import { SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";
import {
  WORLD_BUILDING_PRIORITY,
  clearFinalSurfaceCache,
  composedSurfaceAt,
  finalSurfaceAt,
  finalSurfaceEvidenceExamples,
  finalSurfaceStats,
  resetFinalSurfaceTelemetry,
} from "../src/final-surface.ts";
import { biomeAt, cellAt, heightAt } from "../src/world.ts";

const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fingerprint = (sample: ReturnType<typeof finalSurfaceAt>) => ({
  x: sample.x,
  z: sample.z,
  naturalElevation: sample.naturalElevation,
  groundElevation: sample.groundElevation,
  surfaceElevation: sample.surfaceElevation,
  groundMaterial: sample.groundMaterial,
  surfaceMaterial: sample.surfaceMaterial,
  water: sample.water,
  flow: sample.flow,
  vegetationExcluded: sample.vegetationExcluded,
  reservedUse: sample.reservedUse,
  countryCode: sample.countryCode,
  slopeM: sample.slopeM,
  walkable: sample.walkable,
  contributions: sample.contributions,
});

test("world-building priorities are the exact canonical 0-9 contract", () => {
  assert.deepEqual(WORLD_BUILDING_PRIORITY, {
    ocean: 0,
    continent: 1,
    island: 2,
    naturalTerrain: 3,
    hydrology: 4,
    country: 5,
    city: 6,
    village: 7,
    road: 8,
    criticalSite: 9,
  });
});

test("reverse visits, wrap aliases, and cache resets preserve surface fingerprints", () => {
  const points = [
    { x: -1024, z: 512 },
    { x: 0, z: 0 },
    { x: 125, z: 0 },
    { x: villages[0].x, z: villages[0].z },
    { x: villages[15].x + 17, z: villages[15].z - 13 },
  ];
  clearFinalSurfaceCache();
  const forward = points.map(({ x, z }) => fingerprint(finalSurfaceAt(x, z)));
  clearFinalSurfaceCache();
  const reverse = [...points]
    .reverse()
    .map(({ x, z }) => fingerprint(finalSurfaceAt(x, z)))
    .reverse();
  assert.deepEqual(reverse, forward);
  for (const sample of forward) {
    const ordered = [...sample.contributions].sort(
      (a, b) => a.priority - b.priority || ascii(a.id, b.id),
    );
    assert.deepEqual(sample.contributions, ordered);
  }

  const wrapProbe = fingerprint(finalSurfaceAt(1234.5, 1000.5)),
    wrapAlias = fingerprint(
      finalSurfaceAt(1234.5 + SOURCE_PRESENTATION_WIDTH, 1000.5),
    );
  assert.deepEqual(wrapAlias, wrapProbe);
});

test("country affiliation is composed without flattening political land", () => {
  const sample = finalSurfaceAt(villages[0].x, villages[0].z);
  assert.ok(sample.countryCode);
  assert.ok(
    sample.contributions.some(
      (item) =>
        item.priority === WORLD_BUILDING_PRIORITY.country &&
        item.id === sample.countryCode &&
        item.channels.includes("affiliation"),
    ),
  );
});

test("road cut/fill changes final channels within bounded support", () => {
  const road = roads[0],
    x = road.fromX + (road.toX - road.fromX) * 0.5,
    z = road.fromZ + (road.toZ - road.fromZ) * 0.5,
    roadSurface = finalSurfaceAt(x, z);
  assert.ok(
    roadSurface.contributions.some(
      (item) => item.priority === WORLD_BUILDING_PRIORITY.road && item.id === road.code,
    ),
  );
  assert.equal(roadSurface.vegetationExcluded, true);
  assert.equal(roadSurface.walkable, true);
  assert.ok(roadSurface.reservedUse === "road" || roadSurface.reservedUse === "bridge");
  if (roadSurface.reservedUse === "bridge") {
    assert.equal(roadSurface.water, "river");
    assert.equal(roadSurface.surfaceMaterial, "Bridge");
    assert.ok(roadSurface.surfaceElevation - roadSurface.groundElevation >= 1);
  } else {
    assert.equal(roadSurface.water, "none");
    assert.equal(roadSurface.groundMaterial, "Dirt foundation");
    assert.equal(roadSurface.surfaceMaterial, "Road");
    const delta = roadSurface.groundElevation - roadSurface.naturalElevation;
    assert.ok(delta <= 3.01, `road fill exceeded 3 m: ${delta}`);
    assert.ok(delta >= -4.01, `road cut exceeded 4 m: ${delta}`);
  }
});

test("seeded hillside home pad prepares authoritative ground and excludes vegetation", () => {
  const example = finalSurfaceEvidenceExamples().hillsideHome,
    pad = finalSurfaceAt(example.x, example.z);
  assert.equal(pad.water, "none");
  assert.equal(pad.reservedUse, "building-pad");
  assert.equal(pad.groundMaterial, "Prepared ground");
  assert.equal(pad.surfaceMaterial, "Prepared ground");
  assert.equal(pad.vegetationExcluded, true);
  assert.equal(pad.walkable, true);
  assert.ok(
    pad.contributions.some(
      (item) => item.id === example.code && item.channels.includes("elevation"),
    ),
  );
  const delta = pad.groundElevation - pad.naturalElevation;
  assert.ok(delta <= 3.01 && delta >= -3.01, `pad cut/fill exceeded 3 m: ${delta}`);

  let outside: ReturnType<typeof finalSurfaceAt> | undefined;
  for (let radius = 14; radius <= 30 && !outside; radius += 4)
    for (let step = 0; step < 16 && !outside; step++) {
      const angle = (step / 16) * Math.PI * 2,
        sample = finalSurfaceAt(
          example.x + Math.cos(angle) * radius,
          example.z + Math.sin(angle) * radius,
        );
      if (
        sample.water === "none" &&
        !sample.contributions.some(
          (item) =>
            item.priority >= WORLD_BUILDING_PRIORITY.city &&
            item.channels.includes("elevation"),
        )
      )
        outside = sample;
    }
  assert.ok(outside, "expected an unmodified sample beyond the home-pad support");
  assert.equal(outside!.groundElevation, outside!.naturalElevation);
});

test("legacy adapters and runtime cells consume the composed authority", () => {
  const probes = [
    { x: 1, z: 1 },
    { x: 125, z: 1 },
    { x: villages[8].x + 20, z: villages[8].z + 18 },
  ];
  for (const probe of probes) {
    const composed = composedSurfaceAt(probe.x, probe.z);
    assert.equal(heightAt(probe.x, probe.z), composed.groundElevation);
    assert.equal(biomeAt(probe.x, probe.z), composed.surfaceMaterial);
  }
  const village = villages[3],
    cell = cellAt(village.x, village.z),
    sample = finalSurfaceAt(cell.x * 2 + 1, cell.z * 2 + 1);
  assert.equal(cell.elevation, sample.surfaceElevation);
  assert.equal(cell.biome, sample.surfaceMaterial);
  assert.equal(cell.walkable, sample.walkable);
  assert.deepEqual(cell.finalSurface, sample);
});

test("final-surface caches are memoization only and remain bounded", () => {
  clearFinalSurfaceCache();
  resetFinalSurfaceTelemetry();
  const before = fingerprint(finalSurfaceAt(10, 10));
  for (let i = 0; i < 22_000; i++)
    composedSurfaceAt(i * 0.5, 2000 + (i % 211) * 0.5);
  const stats = finalSurfaceStats();
  assert.ok(stats.cacheEntries <= stats.cacheLimit);
  assert.ok(stats.maxCandidateModifiers <= 4);
  clearFinalSurfaceCache();
  const after = fingerprint(finalSurfaceAt(10, 10));
  assert.deepEqual(after, before);
});
