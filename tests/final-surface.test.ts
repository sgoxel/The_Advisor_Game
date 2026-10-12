import assert from "node:assert/strict";
import test from "node:test";
import { roads, villages } from "../src/geography.ts";
import {
  WORLD_BUILDING_PRIORITY,
  clearFinalSurfaceCache,
  composedSurfaceAt,
  finalSurfaceAt,
  finalSurfaceStats,
  resetFinalSurfaceTelemetry,
} from "../src/final-surface.ts";
import { biomeAt, cellAt, heightAt } from "../src/world.ts";

const fingerprint = (sample: ReturnType<typeof finalSurfaceAt>) => ({
  groundElevation: sample.groundElevation,
  surfaceElevation: sample.surfaceElevation,
  groundMaterial: sample.groundMaterial,
  surfaceMaterial: sample.surfaceMaterial,
  water: sample.water,
  flow: sample.flow,
  vegetationExcluded: sample.vegetationExcluded,
  reservedUse: sample.reservedUse,
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

test("reverse visits and cache resets preserve composed surface fingerprints", () => {
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
      (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
    );
    assert.deepEqual(sample.contributions, ordered);
  }
});

test("road and settlement modifiers coherently alter channels inside bounded support", () => {
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
    assert.notEqual(roadSurface.water, "none");
    assert.equal(roadSurface.surfaceMaterial, "Bridge");
    assert.ok(roadSurface.surfaceElevation > roadSurface.groundElevation);
  } else {
    assert.equal(roadSurface.water, "none");
    assert.equal(roadSurface.surfaceMaterial, "Road");
    assert.ok(Math.abs(roadSurface.groundElevation - 3) < 1e-9);
  }

  const village = villages[0];
  let terrace: ReturnType<typeof finalSurfaceAt> | undefined;
  for (let radius = 18; radius <= 54 && !terrace; radius += 6)
    for (let step = 0; step < 16 && !terrace; step++) {
      const angle = (step / 16) * Math.PI * 2,
        sample = finalSurfaceAt(
          village.x + Math.cos(angle) * radius,
          village.z + Math.sin(angle) * radius,
        );
      if (
        sample.water === "none" &&
        sample.contributions.some((item) => item.priority === WORLD_BUILDING_PRIORITY.village) &&
        !sample.contributions.some((item) => item.priority === WORLD_BUILDING_PRIORITY.road)
      )
        terrace = sample;
    }
  assert.ok(terrace, "expected a non-road village terrace sample");
  assert.equal(terrace!.reservedUse, "village");
  assert.equal(terrace!.surfaceMaterial, "Settlement");
  assert.equal(terrace!.vegetationExcluded, true);
  assert.ok(terrace!.groundElevation <= terrace!.naturalElevation || Math.abs(terrace!.groundElevation - 3) < 1e-6);
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
  for (let i = 0; i < 22_000; i++) composedSurfaceAt(i * 0.5, 2000 + (i % 211) * 0.5);
  const stats = finalSurfaceStats();
  assert.ok(stats.cacheEntries <= stats.cacheLimit);
  assert.ok(stats.maxCandidateModifiers <= 3);
  clearFinalSurfaceCache();
  const after = fingerprint(finalSurfaceAt(10, 10));
  assert.deepEqual(after, before);
});
