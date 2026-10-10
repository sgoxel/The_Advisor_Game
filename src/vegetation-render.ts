import type { ForestFamily, RGB } from "./climate.ts";
import {
  vegetationForTile,
  type VegetationTelemetry,
} from "./vegetation.ts";
import type { Tile } from "./world.ts";

type Point = [number, number, number];
type Geometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};

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

class Builder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  private triangle(a: Point, b: Point, c: Point, tint: RGB) {
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

  private quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
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

  cone(
    x: number,
    y: number,
    z: number,
    radius: number,
    h: number,
    tint: RGB,
    sides: number,
    rotation: number,
    apexDX = 0,
    apexDZ = 0,
  ) {
    for (let index = 0; index < sides; index++) {
      const a = rotation + (index * Math.PI * 2) / sides,
        b = rotation + ((index + 1) * Math.PI * 2) / sides;
      this.triangle(
        [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius],
        [x + apexDX, y + h, z + apexDZ],
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

function variantAngle(variant: number) {
  return (((variant >>> 8) % 4096) / 4096) * Math.PI * 2;
}

/**
 * Presentation-only mesh variation for canonical vegetation records. Logical
 * positions, ownership, density and exclusion remain in vegetation.ts; this
 * layer only changes silhouette using the stable per-feature variant.
 */
export function buildVegetationGeometry(tile: Tile): {
  geometry: Geometry;
  telemetry: VegetationTelemetry;
} {
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
      size = feature.scale,
      angle = variantAngle(feature.variant),
      dx = Math.cos(angle),
      dz = Math.sin(angle);

    if (feature.kind === "rock") {
      builder.cone(
        x,
        y - 0.18,
        z,
        1.25 * size,
        1.25 * size,
        rock,
        5,
        angle,
        dx * 0.18 * size,
        dz * 0.18 * size,
      );
      builder.cone(
        x + dx * 0.42 * size,
        y - 0.1,
        z + dz * 0.42 * size,
        0.78 * size,
        0.9 * size,
        [143, 145, 126],
        5,
        angle + 0.7,
        -dz * 0.12 * size,
        dx * 0.12 * size,
      );
      continue;
    }

    const family = feature.family || "temperate-deciduous-mixed",
      colors = TREE_COLORS[family],
      h = (7.2 + (feature.variant % 5)) * size,
      r = (2.2 + ((feature.variant >>> 5) % 7) / 10) * size;

    if (family === "conifer-boreal") {
      builder.box(x, y - 0.1, z, 0.58 * size, h * 0.5, 0.58 * size, timber);
      builder.cone(
        x,
        y + h * 0.08,
        z,
        r,
        h * 0.72,
        colors[0],
        6,
        angle,
        dx * r * 0.13,
        dz * r * 0.13,
      );
      builder.cone(
        x - dx * r * 0.08,
        y + h * 0.38,
        z - dz * r * 0.08,
        r * 0.7,
        h * 0.5,
        colors[1],
        6,
        angle + 0.52,
        -dz * r * 0.09,
        dx * r * 0.09,
      );
    } else if (family === "warm-dry-woodland") {
      builder.box(x, y - 0.1, z, 0.68 * size, h * 0.56, 0.68 * size, [91, 68, 46]);
      builder.cone(
        x,
        y + h * 0.48,
        z,
        r * 1.25,
        h * 0.2,
        colors[0],
        7,
        angle,
        dx * r * 0.2,
        dz * r * 0.2,
      );
      builder.cone(
        x + dx * r * 0.5,
        y + h * 0.5,
        z + dz * r * 0.5,
        r * 0.7,
        h * 0.16,
        colors[1],
        6,
        angle + 0.4,
        -dz * r * 0.12,
        dx * r * 0.12,
      );
    } else {
      builder.box(x, y - 0.1, z, 0.72 * size, h * 0.55, 0.72 * size, timber);
      builder.cone(
        x,
        y + h * 0.43,
        z,
        r * 0.9,
        h * 0.27,
        colors[0],
        8,
        angle,
        dx * r * 0.16,
        dz * r * 0.16,
      );
      builder.cone(
        x + dx * r * 0.5,
        y + h * 0.46,
        z + dz * r * 0.5,
        r * 0.72,
        h * 0.23,
        colors[1],
        7,
        angle + 0.34,
        -dz * r * 0.12,
        dx * r * 0.12,
      );
      builder.cone(
        x - dz * r * 0.46,
        y + h * 0.45,
        z + dx * r * 0.46,
        r * 0.66,
        h * 0.22,
        colors[0],
        7,
        angle - 0.41,
        dx * r * 0.1,
        dz * r * 0.1,
      );
    }
  }

  const geometry = builder.finish(),
    triangles = geometry.indices.length / 3,
    estimatedVertices = triangles * 3,
    estimatedBytes =
      estimatedVertices * (3 * 4 + 3 * 4 + 4) + triangles * 3 * 4;
  return {
    geometry,
    telemetry: {
      ...telemetry,
      triangles,
      estimatedBytes,
    },
  };
}
