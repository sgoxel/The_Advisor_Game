import { forestCoverForTile } from "./forest-cover.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import {elevationToRenderY} from "./render-frame.ts";
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
  private origin = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 };
  placeAt(x: number, y: number, z: number, sourceZ: number) {
    const metric = sourceUnitsPerMetreAt(sourceZ);
    this.origin = { x, y, z, sx: metric.x, sy: metric.z, sz: metric.z };
  }
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  private triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const o = this.origin, transform = (p: Point): Point => [o.x+p[0]*o.sx,o.y+p[1]*o.sy,o.z+p[2]*o.sz];
    [a,b,c] = [transform(a),transform(b),transform(c)];
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
 * positions and exclusion remain in vegetation.ts / forest-cover.ts; this
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
    if (feature.family) continue; // Forests use dense, physically scaled crowns below.
    builder.placeAt(feature.x-originX,elevationToRenderY(feature.y),feature.z-originZ,feature.z);
    const x = 0, z = 0, y = 0,
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

    const colors=TREE_COLORS["temperate-deciduous-mixed"],h=(7.2+(feature.variant%5))*size,r=2.6*size;
    builder.box(x,y-.05,z,.6*size,h*.5,.6*size,timber);
    builder.cone(x,y+h*.35,z,r,h*.55,colors[0],8,angle);
    builder.cone(x+r*.4,y+h*.5,z,r*.7,h*.45,colors[1],7,angle+.3);
  }

  const cover = forestCoverForTile(tile);
  for (const patch of cover.patches) {
    builder.placeAt(patch.x-originX,elevationToRenderY(patch.y),patch.z-originZ,patch.z);
    const colors = TREE_COLORS[patch.family], r = patch.radiusM, h = patch.heightM, angle = variantAngle(patch.variant);
    builder.box(0,-.05,0,.48,h*.55,.48,timber);
    if (patch.family === "conifer-boreal") {
      builder.cone(0,h*.18,0,r,h*.7,colors[0],6,angle);
      builder.cone(0,h*.46,0,r*.74,h*.54,colors[1],6,angle+.25);
    } else {
      builder.cone(0,h*.4,0,r,h*.5,colors[0],7,angle,r*.12,0);
      builder.cone(r*.4,h*.48,r*.15,r*.7,h*.45,colors[1],6,angle+.4);
      builder.cone(-r*.32,h*.45,-r*.22,r*.68,h*.42,colors[0],6,angle-.3);
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
      trees: features.filter(f=>f.kind==="tree"&&!f.family).length + cover.patches.length,
      visibleInstances: features.filter(f=>!f.family).length + cover.patches.length,
      maxInstances: Math.max(telemetry.maxInstances, 320),
      maxTriangles: Math.max(telemetry.maxTriangles, 8192),
      drawCalls: triangles ? 1 : 0, materialCount: triangles ? 1 : 0,
    },
  };
}
