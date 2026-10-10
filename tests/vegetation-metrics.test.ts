import assert from "node:assert/strict";
import test from "node:test";
import { climateSampleAt } from "../src/climate.ts";
import { lonLatToSource, type LonLat } from "../src/planet.ts";
import {
  vegetationForTile,
  type VegetationFeature,
} from "../src/vegetation.ts";
import type { Tile } from "../src/world.ts";

const FIXTURE_SIZE_SOURCE = 1000;
const TILE_SIZE_SOURCE = 250;
const SCATTER_BUCKET_SOURCE = 16;
const RADIUS_FACTORS = [0.82, 0.91, 1, 1.09, 1.18] as const;

function tile(minX: number, minZ: number): Tile {
  return {
    level: 0,
    x: 0,
    z: 0,
    key: `metrics/${minX}/${minZ}`,
    size: TILE_SIZE_SOURCE,
    minX,
    minZ,
  };
}

function forestFixtures(): LonLat[] {
  const fixtures: LonLat[] = [];
  for (let latDeg = -65; latDeg <= 65 && fixtures.length < 3; latDeg += 5)
    for (let lonDeg = -175; lonDeg <= 175 && fixtures.length < 3; lonDeg += 5) {
      const point = {
        lon: (lonDeg * Math.PI) / 180,
        lat: (latDeg * Math.PI) / 180,
      };
      if (!climateSampleAt(point).forestFamily) continue;
      if (
        fixtures.every(
          (other) =>
            Math.hypot(point.lon - other.lon, point.lat - other.lat) > 0.35,
        )
      )
        fixtures.push(point);
    }
  assert.equal(fixtures.length, 3, "expected three separated forest fixtures");
  return fixtures;
}

function fixtureFeatures(center: LonLat): VegetationFeature[] {
  const source = lonLatToSource(center.lon, center.lat),
    minX = source.x - FIXTURE_SIZE_SOURCE / 2,
    minZ = source.z - FIXTURE_SIZE_SOURCE / 2,
    features: VegetationFeature[] = [];
  for (let dz = 0; dz < FIXTURE_SIZE_SOURCE; dz += TILE_SIZE_SOURCE)
    for (let dx = 0; dx < FIXTURE_SIZE_SOURCE; dx += TILE_SIZE_SOURCE)
      features.push(...vegetationForTile(tile(minX + dx, minZ + dz)).features);
  return features;
}

function nearestNeighbourDistances(features: readonly VegetationFeature[]) {
  return features
    .map((feature, index) => {
      let nearest = Infinity;
      for (let other = 0; other < features.length; other++) {
        if (other === index) continue;
        nearest = Math.min(
          nearest,
          Math.hypot(
            feature.x - features[other].x,
            feature.z - features[other].z,
          ),
        );
      }
      return nearest;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function quantile(values: readonly number[], q: number) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.floor(q * values.length))];
}

function spectralPower(
  features: readonly VegetationFeature[],
  fx: number,
  fz: number,
) {
  let real = 0,
    imaginary = 0;
  for (const feature of features) {
    const phase = Math.PI * 2 * (fx * feature.x + fz * feature.z);
    real += Math.cos(phase);
    imaginary += Math.sin(phase);
  }
  return (real * real + imaginary * imaginary) / Math.max(1, features.length);
}

function periodogramAxisRatio(features: readonly VegetationFeature[]) {
  const base = 1 / SCATTER_BUCKET_SOURCE,
    powers: number[] = [],
    cardinalPowers: number[] = [];
  for (const radiusFactor of RADIUS_FACTORS) {
    const radius = base * radiusFactor;
    for (let angleIndex = 0; angleIndex < 32; angleIndex++) {
      const angle = (angleIndex * Math.PI) / 16;
      powers.push(
        spectralPower(
          features,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ),
      );
    }
    for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2])
      cardinalPowers.push(
        spectralPower(
          features,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ),
      );
  }
  const sorted = [...powers].sort((a, b) => a - b),
    median = sorted[Math.floor(sorted.length / 2)] || 1,
    // A real row/column lattice produces a broad high-energy cardinal band.
    // Averaging the matching bins avoids treating one random Fourier spike as
    // a visible lattice defect while preserving the ≤2× acceptance threshold.
    axisBand =
      cardinalPowers.reduce((sum, power) => sum + power, 0) /
      Math.max(1, cardinalPowers.length);
  return { axisBand, median, ratio: axisBand / median };
}

function fixedCenterOffsetFraction(features: readonly VegetationFeature[]) {
  const nearCenter = (value: number) => {
    const phase = ((value / SCATTER_BUCKET_SOURCE) % 1 + 1) % 1;
    return Math.abs(phase - 0.5) <= 0.05;
  };
  return (
    features.filter((feature) => nearCenter(feature.x) || nearCenter(feature.z))
      .length / Math.max(1, features.length)
  );
}

test("three fixed forest scatter fixtures satisfy nearest-neighbour and periodogram metrics", () => {
  const reports = forestFixtures().map((fixture, index) => {
    const features = fixtureFeatures(fixture),
      distances = nearestNeighbourDistances(features),
      spectrum = periodogramAxisRatio(features),
      fixedOffsetFraction = fixedCenterOffsetFraction(features);
    assert.ok(features.length >= 20, `fixture ${index} only has ${features.length} features`);
    assert.ok(quantile(distances, 0.1) >= 6.4, `fixture ${index} has implausibly close repeated scatter`);
    assert.ok(
      spectrum.ratio <= 2,
      `fixture ${index} cardinal lattice band ${spectrum.ratio.toFixed(3)}× median annulus power`,
    );
    assert.ok(
      fixedOffsetFraction <= 0.25,
      `fixture ${index} fixed-center offset fraction ${fixedOffsetFraction.toFixed(3)}`,
    );
    return {
      fixture: index,
      fixtureSizeSourceUnits: FIXTURE_SIZE_SOURCE,
      features: features.length,
      nearestNeighbourSourceUnits: {
        p10: quantile(distances, 0.1),
        p50: quantile(distances, 0.5),
        p90: quantile(distances, 0.9),
      },
      periodogramAxisBandToMedian: spectrum.ratio,
      fixedCenterOffsetFraction,
    };
  });
  console.log(`WP16 scatter metrics ${JSON.stringify(reports)}`);
});
