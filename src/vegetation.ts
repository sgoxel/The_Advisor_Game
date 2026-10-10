import { climateSampleAt, type ForestFamily, type RGB } from "./climate.ts";
import { nearestPlace, roadAt } from "./geography.ts";
import { sourceToLonLat, wrapSourceX } from "./planet.ts";
import {
  GENERATOR_VERSION,
  WORLD_SEED,
  WORLD_SIZE,
  biomeAt,
  coordinateValue,
  field,
  heightAt,
  type Tile,
} from "./world.ts";

export type VegetationKind = "tree" | "rock";

export type VegetationFeature = {
  code: string;
  owner: string;
  kind: VegetationKind;
  family: ForestFamily | null;
  x: number;
  y: number;
  z: number;
  scale: number;
  variant: number;
};

export type VegetationTelemetry = {
  candidateCount: number;
  visibleInstances: number;
  trees: number;
  rocks: number;
  triangles: number;
  drawCalls: number;
  materialCount: number;
  estimatedBytes: number;
  cacheKey: string;
  maxInstances: number;
  maxTriangles: number;
};

type Geometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};

type Candidate = {
  gx: number;
  gz: number;
  addressGX: number;
  x: number;
  z: number;
  priority: number;
  variant: number;
};

type Evaluated = Candidate & {
  kind: VegetationKind;
  family: ForestFamily | null;
  y: number;
  scale: number;
  separation: number;
};

type CachedEvaluator = (candidate: Candidate) => Evaluated | undefined;

// Canonical source-space addresses still divide the wrapped circumference exactly,
// but candidates are decorrelated from visible row/column phases. Identity remains
// one stable seed address per bucket; only its deterministic physical offset changes.
const SCATTER_SPACING = 16;
const SCATTER_JITTER_SPAN = 2;
const SCATTER_HALO = 2;
const WRAP_BUCKET_COUNT = WORLD_SIZE / SCATTER_SPACING;
const HALF_WRAP_BUCKET_COUNT = WRAP_BUCKET_COUNT / 2;
const MAX_RENDER_TILE = 256;
const MAX_SEPARATION = 11.5;
const MAX_DENSE_FOREST_OCCUPANCY = 0.84;
const TREE_COLORS: Readonly<Record<ForestFamily, readonly [RGB, RGB]>> = {
  "conifer-boreal": [
    [43, 79, 58],
    [58, 96, 65],
  ],
  "temperate-deciduous-mixed": [
    [69, 116, 63],
    [88, 132, 72],
  ],
  "warm-dry-woodland": [
    [104, 117, 69],
    [124, 132, 76],
  ],
};
const WATER_BIOMES = new Set(["Ocean", "Lake", "River"]);
const BARREN_TERRAIN = new Set([
  "ocean",
  "lake",
  "sea-ice",
  "polar-ice",
  "snowy-mountain",
  "beach",
]);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
// Half-step normalization keeps canonical samples strictly inside [0, 1), so two
// seed addresses can never become identical through an exact boundary sample.
const unit = (value: number) => ((value >>> 0) + 0.5) / 4294967296;
const scatterOffset = (value: number) =>
  unit(value) * SCATTER_JITTER_SPAN - (SCATTER_JITTER_SPAN - 1) / 2;
const scatterPhase = (value: number) => unit(value) - 0.5;

function wrapBucketX(gx: number) {
  return (
    ((((gx + HALF_WRAP_BUCKET_COUNT) % WRAP_BUCKET_COUNT) + WRAP_BUCKET_COUNT) %
      WRAP_BUCKET_COUNT) -
    HALF_WRAP_BUCKET_COUNT
  );
}

function candidateAt(gx: number, gz: number): Candidate {
  const addressGX = wrapBucketX(gx),
    a = coordinateValue(addressGX, gz, 601),
    b = coordinateValue(addressGX, gz, 602),
    // A row phase in X and column phase in Z break the residual 16-unit cardinal
    // Fourier band without changing the canonical bucket/owner. Both phases are
    // seed-addressed and periodic across the east/west wrap.
    rowPhase = scatterPhase(coordinateValue(0, gz, 605)),
    columnPhase = scatterPhase(coordinateValue(addressGX, 0, 606));
  return {
    gx,
    gz,
    addressGX,
    // gx stays in the caller's local periodic copy so seam-neighbour distances are
    // short. Only addressGX decides identity/hash, therefore ±WORLD_SIZE replays
    // the exact same canonical candidate without creating a second owner.
    x: (gx + scatterOffset(a) + rowPhase) * SCATTER_SPACING,
    z: (gz + scatterOffset(b) + columnPhase) * SCATTER_SPACING,
    priority: coordinateValue(addressGX, gz, 603),
    variant: coordinateValue(addressGX, gz, 604),
  };
}

function settlementClearance(x: number, z: number) {
  const place = nearestPlace(x, z);
  if (!place) return 1;
  const distance = Math.hypot(wrapSourceX(x - place.x), z - place.z),
    protectedRadius = place.kind === "city" ? 445 : 96;
  if (distance <= protectedRadius) return 0;
  return smoothstep(protectedRadius, protectedRadius + 90, distance);
}

function evaluate(candidate: Candidate): Evaluated | undefined {
  const { x, z, variant } = candidate,
    canonicalX = wrapSourceX(x),
    y = heightAt(canonicalX, z);
  if (
    y < 0.2 ||
    WATER_BIOMES.has(biomeAt(canonicalX, z)) ||
    roadAt(canonicalX, z)
  )
    return undefined;

  const clearance = settlementClearance(canonicalX, z);
  if (clearance <= 0) return undefined;

  const climate = climateSampleAt(sourceToLonLat(canonicalX, z), y);
  if (BARREN_TERRAIN.has(climate.terrainClass)) return undefined;

  const core = field(canonicalX, z, 154, 611),
    clearing = field(canonicalX, z, 66, 612),
    grove = field(canonicalX, z, 37, 613),
    roll = unit(coordinateValue(candidate.addressGX, candidate.gz, 614)),
    kindRoll = unit(coordinateValue(candidate.addressGX, candidate.gz, 615)),
    forest = climate.forestFamily;

  let treeDensity = 0;
  if (forest) {
    const familyFactor = forest === "warm-dry-woodland" ? 0.63 : 1,
      clearingFactor = 0.25 + 0.75 * smoothstep(0.2, 0.66, clearing),
      clusterFactor = 0.42 + 0.48 * core + 0.1 * grove;
    // Near-complete occupation of the canonical address buckets can make their
    // source frequency reappear after terrain/settlement rejection. A high cap
    // keeps forests dense while retaining enough deterministic gaps to avoid a
    // visible cardinal lattice.
    treeDensity = Math.min(
      MAX_DENSE_FOREST_OCCUPANCY,
      clamp01(clusterFactor * clearingFactor * familyFactor * clearance),
    );
  } else if (["meadow", "grassland", "dryland", "bare-earth", "highland"].includes(climate.terrainClass)) {
    const loneTree = 0.025 + 0.12 * climate.moisture * (0.45 + 0.55 * core);
    treeDensity = loneTree * clearance * (1 - smoothstep(0.5, 0.78, climate.ruggedness));
  }

  const rockDensity =
    (0.014 + climate.ruggedness * 0.12 + (climate.terrainClass === "highland" ? 0.06 : 0)) *
    clearance;
  const tree = roll < treeDensity,
    rock = !tree && roll < treeDensity + rockDensity && kindRoll > 0.18;
  if (!tree && !rock) return undefined;

  const scale = tree ? 0.78 + unit(variant) * 0.6 : 0.65 + unit(variant ^ 0x5bd1e995) * 0.75;
  return {
    ...candidate,
    kind: tree ? "tree" : "rock",
    family: tree ? forest : null,
    y,
    scale,
    separation: tree ? (forest ? 8.2 : 11.5) : 6.5,
  };
}

function beats(a: Candidate, b: Candidate) {
  return (
    a.priority < b.priority ||
    (a.priority === b.priority &&
      (a.gz < b.gz || (a.gz === b.gz && a.addressGX < b.addressGX)))
  );
}

function accepted(candidate: Evaluated, evaluateCached: CachedEvaluator): boolean {
  for (let dz = -SCATTER_HALO; dz <= SCATTER_HALO; dz++)
    for (let dx = -SCATTER_HALO; dx <= SCATTER_HALO; dx++) {
      if (dx === 0 && dz === 0) continue;
      const raw = candidateAt(candidate.gx + dx, candidate.gz + dz);
      if (!beats(raw, candidate)) continue;
      const distance = Math.hypot(candidate.x - raw.x, candidate.z - raw.z);
      if (distance >= MAX_SEPARATION) continue;
      const neighbour = evaluateCached(raw);
      if (!neighbour) continue;
      if (distance < Math.max(candidate.separation, neighbour.separation)) return false;
    }
  return true;
}

export function vegetationBudgetForTile(tileSize: number) {
  const cells = Math.ceil(Math.min(MAX_RENDER_TILE, Math.max(0, tileSize)) / SCATTER_SPACING) + 2,
    maxInstances = Math.min(256, cells * cells),
    // The most detailed retained tree silhouette is 32 triangles.
    maxTriangles = maxInstances * 32;
  return { maxInstances, maxTriangles };
}

/**
 * Canonical fixed-coordinate scatter. Render tiles only clip the result; they do
 * not seed it, so zoom, visit order, renderer backend and eviction cannot reroll
 * vegetation identities or move ownership boundaries.
 */
export function vegetationForTile(tile: Tile): { features: VegetationFeature[]; telemetry: VegetationTelemetry } {
  const budget = vegetationBudgetForTile(tile.size),
    features: VegetationFeature[] = [];
  if (tile.size > MAX_RENDER_TILE) {
    return {
      features,
      telemetry: {
        candidateCount: 0,
        visibleInstances: 0,
        trees: 0,
        rocks: 0,
        triangles: 0,
        drawCalls: 0,
        materialCount: 0,
        estimatedBytes: 0,
        cacheKey: `${WORLD_SEED}/${GENERATOR_VERSION}/VEG/${tile.key}`,
        ...budget,
      },
    };
  }

  const minGX = Math.floor(tile.minX / SCATTER_SPACING) - SCATTER_HALO,
    maxGX = Math.floor((tile.minX + tile.size) / SCATTER_SPACING) + SCATTER_HALO,
    minGZ = Math.floor(tile.minZ / SCATTER_SPACING) - SCATTER_HALO,
    maxGZ = Math.floor((tile.minZ + tile.size) / SCATTER_SPACING) + SCATTER_HALO,
    evaluationCache = new Map<string, Evaluated | null>(),
    evaluateCached: CachedEvaluator = (candidate) => {
      const key = `${candidate.addressGX}/${candidate.gz}`,
        cached = evaluationCache.get(key);
      if (cached !== undefined) return cached || undefined;
      const evaluated = evaluate(candidate);
      evaluationCache.set(key, evaluated || null);
      return evaluated;
    };
  let candidateCount = 0;
  for (let gz = minGZ; gz <= maxGZ; gz++)
    for (let gx = minGX; gx <= maxGX; gx++) {
      const raw = candidateAt(gx, gz);
      if (
        raw.x < tile.minX ||
        raw.x >= tile.minX + tile.size ||
        raw.z < tile.minZ ||
        raw.z >= tile.minZ + tile.size
      )
        continue;
      candidateCount++;
      const feature = evaluateCached(raw);
      if (!feature || !accepted(feature, evaluateCached)) continue;
      features.push({
        code: `${WORLD_SEED}/${GENERATOR_VERSION}/VEG/${feature.addressGX}/${gz}`,
        owner: `${WORLD_SEED}/${GENERATOR_VERSION}/VEG-CELL/${feature.addressGX}/${gz}`,
        kind: feature.kind,
        family: feature.family,
        x: feature.x,
        y: feature.y,
        z: feature.z,
        scale: feature.scale,
        variant: feature.variant,
      });
    }

  features.sort((a, b) => a.code.localeCompare(b.code));
  if (features.length > budget.maxInstances) features.length = budget.maxInstances;
  const trees = features.filter((feature) => feature.kind === "tree").length,
    rocks = features.length - trees,
    triangles = features.reduce((sum, feature) => {
      if (feature.kind === "rock") return sum + 10;
      if (feature.family === "conifer-boreal") return sum + 22;
      if (feature.family === "warm-dry-woodland") return sum + 23;
      return sum + 32;
    }, 0),
    estimatedVertices = triangles * 3,
    estimatedBytes = estimatedVertices * (3 * 4 + 3 * 4 + 4) + triangles * 3 * 4;
  return {
    features,
    telemetry: {
      candidateCount,
      visibleInstances: features.length,
      trees,
      rocks,
      triangles,
      drawCalls: features.length ? 1 : 0,
      materialCount: features.length ? 1 : 0,
      estimatedBytes,
      cacheKey: `${WORLD_SEED}/${GENERATOR_VERSION}/VEG/${tile.key}`,
      ...budget,
    },
  };
}

class Builder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  private triangle(a: number[], b: number[], c: number[], tint: RGB) {
    const u = b.map((value, index) => value - a[index]),
      v = c.map((value, index) => value - a[index]),
      normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      length = Math.hypot(...normal) || 1,
      start = this.positions.length / 3;
    for (const point of [a, b, c]) {
      this.positions.push(...point);
      this.normals.push(...normal.map((value) => value / length));
      this.colors.push(...tint, 255);
    }
    this.indices.push(start, start + 1, start + 2);
  }

  private quad(a: number[], b: number[], c: number[], d: number[], tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, tint: RGB) {
    const ax = x - w / 2,
      bx = x + w / 2,
      az = z - d / 2,
      bz = z + d / 2,
      top = y + h;
    this.quad([ax, y, az], [ax, top, az], [bx, top, az], [bx, y, az], tint);
    this.quad([bx, y, bz], [bx, top, bz], [ax, top, bz], [ax, y, bz], tint);
    this.quad([ax, y, bz], [ax, top, bz], [ax, top, az], [ax, y, az], tint);
    this.quad([bx, y, az], [bx, top, az], [bx, top, bz], [bx, y, bz], tint);
    this.quad([ax, top, az], [ax, top, bz], [bx, top, bz], [bx, top, az], tint);
  }

  cone(x: number, y: number, z: number, radius: number, h: number, tint: RGB, sides: number) {
    for (let index = 0; index < sides; index++) {
      const a = (index * Math.PI * 2) / sides,
        b = ((index + 1) * Math.PI * 2) / sides;
      this.triangle(
        [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius],
        [x, y + h, z],
        [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius],
        tint,
      );
    }
  }

  finish(): Geometry {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Uint8Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

export function buildVegetationGeometry(tile: Tile): { geometry: Geometry; telemetry: VegetationTelemetry } {
  const { features, telemetry } = vegetationForTile(tile),
    builder = new Builder(),
    originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    timber: RGB = [78, 59, 42],
    rock: RGB = [126, 132, 116];

  for (const feature of features) {
    const x = feature.x - originX,
      z = feature.z - originZ,
      y = feature.y,
      size = feature.scale;
    if (feature.kind === "rock") {
      builder.cone(x, y - 0.18, z, 1.25 * size, 1.25 * size, rock, 5);
      builder.cone(x + 0.35 * size, y - 0.1, z - 0.2 * size, 0.78 * size, 0.9 * size, [143, 145, 126], 5);
      continue;
    }

    const family = feature.family || "temperate-deciduous-mixed",
      colors = TREE_COLORS[family],
      h = (7.2 + (feature.variant % 5)) * size,
      r = (2.2 + ((feature.variant >>> 5) % 7) / 10) * size;
    if (family === "conifer-boreal") {
      builder.box(x, y - 0.1, z, 0.58 * size, h * 0.5, 0.58 * size, timber);
      builder.cone(x, y + h * 0.08, z, r, h * 0.72, colors[0], 6);
      builder.cone(x, y + h * 0.38, z, r * 0.7, h * 0.5, colors[1], 6);
    } else if (family === "warm-dry-woodland") {
      builder.box(x, y - 0.1, z, 0.68 * size, h * 0.56, 0.68 * size, [91, 68, 46]);
      builder.cone(x, y + h * 0.42, z, r * 1.2, h * 0.3, colors[0], 7);
      builder.cone(x + r * 0.32, y + h * 0.45, z - r * 0.12, r * 0.64, h * 0.23, colors[1], 6);
    } else {
      builder.box(x, y - 0.1, z, 0.72 * size, h * 0.55, 0.72 * size, timber);
      builder.cone(x, y + h * 0.34, z, r * 1.12, h * 0.42, colors[0], 8);
      builder.cone(x - r * 0.26, y + h * 0.48, z, r * 0.72, h * 0.28, colors[1], 7);
      builder.cone(x + r * 0.3, y + h * 0.47, z + r * 0.08, r * 0.66, h * 0.27, colors[0], 7);
    }
  }
  return { geometry: builder.finish(), telemetry };
}
