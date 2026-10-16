export * from "./geometry-core.ts";

import {
  buildTile as coreBuildTile,
  terrainTint as coreTerrainTint,
  type Geometry,
  type TileGeometry,
} from "./geometry-core.ts";
import { featuresFor, type Tile } from "./world.ts";
import { elevationToRenderY } from "./render-frame.ts";
import { continuitySurfaceAt as finalSurfaceAt } from "./continuity-runtime.ts";
import { SOURCE_PRESENTATION_WIDTH } from "./planet.ts";

type Point = [number, number, number];
type RGB = readonly [number, number, number];
const color = (r: number, g: number, b: number): RGB => [r, g, b];

class Builder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    this.triangleGradient(a, b, c, tint, tint, tint);
  }
  triangleGradient(a: Point, b: Point, c: Point, tintA: RGB, tintB: RGB, tintC: RGB) {
    const u = b.map((value, index) => value - a[index]), v = c.map((value, index) => value - a[index]),
      normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...normal) || 1,
      start = this.p.length / 3, points = [a, b, c], tints = [tintA, tintB, tintC];
    for (let index = 0; index < points.length; index++) {
      this.p.push(...points[index]);
      this.n.push(...normal.map((value) => value / length));
      this.c.push(...tints[index], 255);
    }
    this.i.push(start, start + 1, start + 2);
  }
  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) { this.triangle(a, b, c, tint); this.triangle(a, c, d, tint); }
  quadGradient(a: Point, b: Point, c: Point, d: Point, tintA: RGB, tintB: RGB, tintC: RGB, tintD: RGB) {
    this.triangleGradient(a, b, c, tintA, tintB, tintC);
    this.triangleGradient(a, c, d, tintA, tintC, tintD);
  }
  boxYaw(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, tint: RGB) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw), top = y + h,
      at = (lx: number, lz: number, yy: number): Point => [x + lx * cos + lz * sin, yy, z - lx * sin + lz * cos],
      a = at(-w / 2, -d / 2, y), b = at(w / 2, -d / 2, y), c = at(w / 2, d / 2, y), d0 = at(-w / 2, d / 2, y),
      A = at(-w / 2, -d / 2, top), B = at(w / 2, -d / 2, top), C = at(w / 2, d / 2, top), D = at(-w / 2, d / 2, top);
    this.quad(a, A, B, b, tint); this.quad(b, B, C, c, tint); this.quad(c, C, D, d0, tint); this.quad(d0, D, A, a, tint); this.quad(A, D, C, B, tint);
  }
  cone(x: number, y: number, z: number, radius: number, h: number, tint: RGB, sides = 6) {
    for (let index = 0; index < sides; index++) {
      const a = index * Math.PI * 2 / sides, b = (index + 1) * Math.PI * 2 / sides;
      this.triangle([x + Math.cos(b) * radius, y, z + Math.sin(b) * radius], [x, y + h, z], [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius], tint);
    }
  }
  relativeTo(x: number, z: number) {
    for (let index = 0; index < this.p.length; index += 3) {
      this.p[index] -= x;
      this.p[index + 2] -= z;
    }
  }
  finish(): Geometry { return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), colors: new Uint8Array(this.c), indices: new Uint32Array(this.i) }; }
}
function mergeGeometry(a: Geometry, b: Geometry): Geometry {
  if (!b.positions.length) return a;
  const positions = new Float32Array(a.positions.length + b.positions.length), normals = new Float32Array(a.normals.length + b.normals.length),
    colors = new Uint8Array(a.colors.length + b.colors.length), indices = new Uint32Array(a.indices.length + b.indices.length), offset = a.positions.length / 3;
  positions.set(a.positions); positions.set(b.positions, a.positions.length);
  normals.set(a.normals); normals.set(b.normals, a.normals.length);
  colors.set(a.colors); colors.set(b.colors, a.colors.length);
  indices.set(a.indices); for (let index = 0; index < b.indices.length; index++) indices[a.indices.length + index] = b.indices[index] + offset;
  return { ...a, positions, normals, colors, indices };
}

/**
 * Current-view coverage adapter from main. Preview meshes intentionally omit
 * roads/properties/S004 overlays while sampling the same authoritative surface.
 */
function buildTerrainOnly(tile: Tile): TileGeometry {
  const terrain = new Builder(), resolution = Math.min(8, tile.size / 2), step = tile.size / resolution,
    coveragePoints = new Map<string, Point>(), coverageTints = new Map<string, RGB>();
  const point = (px: number, pz: number): Point => {
    const key = `${px}/${pz}`;
    let value = coveragePoints.get(key);
    if (!value) {
      const surface = finalSurfaceAt(px, pz);
      value = [px, surface.water.kind === "none" ? surface.groundHeight : surface.water.level, pz];
      coveragePoints.set(key, value);
    }
    return value;
  };
  const tintAt = (value: Point): RGB => {
    const key = `${value[0]}/${value[2]}`;
    let tint = coverageTints.get(key);
    if (!tint) {
      tint = coreTerrainTint(value[0], value[2], tile.size, value[1], step, false);
      coverageTints.set(key, tint);
    }
    return tint;
  };
  const coverageQuad = (x: number, z: number, size: number, depth = 0): void => {
    const a = point(x, z), b = point(x, z + size), c = point(x + size, z + size), d = point(x + size, z),
      colours = [tintAt(a), tintAt(b), tintAt(c), tintAt(d)],
      range = Math.max(...[0, 1, 2].map((channel) => Math.max(...colours.map((value) => value[channel])) - Math.min(...colours.map((value) => value[channel]))));
    if (depth < 4 && range > 10) {
      const half = size / 2;
      coverageQuad(x, z, half, depth + 1); coverageQuad(x + half, z, half, depth + 1);
      coverageQuad(x, z + half, half, depth + 1); coverageQuad(x + half, z + half, half, depth + 1);
    } else terrain.quadGradient(a, b, c, d, colours[0], colours[1], colours[2], colours[3]);
  };
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++)
    coverageQuad(tile.minX + x * step, tile.minZ + z * step, step);

  const uvs = new Float32Array((terrain.p.length / 3) * 2);
  for (let index = 0, uv = 0; index < terrain.p.length; index += 3, uv += 2) {
    uvs[uv] = terrain.p[index] / SOURCE_PRESENTATION_WIDTH + 0.5;
    uvs[uv + 1] = Math.max(0, Math.min(1, 0.5 + terrain.p[index + 2] * 2 / SOURCE_PRESENTATION_WIDTH));
  }
  for (let index = 3; index < terrain.c.length; index += 4) terrain.c[index] = 0;
  terrain.relativeTo(tile.minX + tile.size / 2, tile.minZ + tile.size / 2);
  const empty = (): Geometry => ({ positions: new Float32Array(), normals: new Float32Array(), colors: new Uint8Array(), indices: new Uint32Array() });
  return { terrain: { ...terrain.finish(), uvs }, structures: empty(), nature: empty(), detail: empty() };
}

/** S004 detail overlay: semantic settlement identity is owned by world.ts; geometry only visualizes it. */
export function buildTile(tile: Tile, options: { terrainOnly?: boolean } = {}): TileGeometry {
  if (options.terrainOnly) return buildTerrainOnly(tile);
  const result = coreBuildTile(tile), structures = new Builder(), nature = new Builder(), detail = new Builder(),
    originX = tile.minX + tile.size / 2, originZ = tile.minZ + tile.size / 2;
  if (tile.size <= 512) for (const feature of featuresFor(tile) as any[]) {
    const x = feature.x - originX, z = feature.z - originZ, y = elevationToRenderY(feature.y), yaw = feature.yawRad || 0,
      width = feature.footprintWidth || 8, depth = feature.footprintDepth || 8, variant = feature.variant || 0;
    if (feature.kind === "border" && variant >= 2) {
      const length = feature.length || depth || 4,
        cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
      if (variant === 2) {
        structures.boxYaw(x, y - .02, z, Math.max(1.35, width), 1.65, length, yaw, color(76, 104, 59));
        if (tile.size <= 64) for (const lz of [-length * .34, 0, length * .34]) {
          const shrub = at(0, lz);
          detail.cone(shrub.x, y + .7, shrub.z, 1.15, 1.45, color(83, 116, 64), 7);
        }
      } else if (variant === 3) {
        structures.boxYaw(x, y - .05, z, Math.max(.9, width), 2.75, length, yaw, color(91, 66, 43));
        if (tile.size <= 64) for (const lz of [-length * .45, 0, length * .45]) {
          const post = at(0, lz);
          detail.boxYaw(post.x, y - .08, post.z, 1.25, 3.35, 1.25, yaw, color(73, 52, 35));
        }
      } else {
        structures.boxYaw(x, y - .06, z, Math.max(1.2, width), 2.05, length, yaw, color(151, 150, 132));
        structures.boxYaw(x, y + 1.82, z, Math.max(.82, width * .72), .3, length, yaw, color(112, 105, 89));
        if (tile.size <= 64) for (const lz of [-length * .42, length * .42]) {
          const brace = at(0, lz);
          detail.boxYaw(brace.x, y + .05, brace.z, Math.max(1.35, width), 2.25, .52, yaw, color(82, 61, 43));
        }
      }
    } else if (feature.kind === "garden") {
      structures.boxYaw(x, y + .02, z, width, .08, depth, yaw, color(117, 132, 71));
      if (tile.size <= 64) {
        const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
        for (const lx of [-width * .28, 0, width * .28]) { const row = at(lx, 0); detail.boxYaw(row.x, y + .12, row.z, .42, .3, depth * .72, yaw, color(151, 126, 62)); }
        for (const lz of [-depth / 2, depth / 2]) { const fence = at(0, lz); detail.boxYaw(fence.x, y + .1, fence.z, width, .18, .16, yaw, color(92, 68, 45)); }
      }
    } else if (feature.kind === "path") {
      structures.boxYaw(x, y + .015, z, width || 1.25, .06, feature.length || depth || 3, yaw, color(137, 116, 79));
    } else if (feature.kind === "pavement") {
      structures.boxYaw(x, y + .018, z, width || 1.5, .075, feature.length || depth || 3, yaw, color(154, 141, 111));
    } else if (feature.kind === "roadside-tree") {
      const h = 6.2 + (variant % 5) * .65, radius = 2 + ((variant >>> 3) % 6) * .18;
      nature.boxYaw(x, y - .1, z, .62, h * .58, .62, 0, color(82, 62, 42));
      nature.cone(x, y + h * .3, z, radius, h * .52, color(72 + (variant % 14), 111 + (variant % 17), 63), 7);
      if (tile.size <= 32) nature.cone(x + radius * .28, y + h * .46, z - radius * .08, radius * .65, h * .3, color(84, 126, 69), 6);
    } else if (feature.kind === "service" && feature.service === "merchant") {
      const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos }),
        awning = at(0, depth / 2 + 1.25), crateA = at(-width * .3, depth / 2 + 2), crateB = at(width * .26, depth / 2 + 2.25);
      structures.boxYaw(awning.x, y + 3.05, awning.z, width * .82, .18, 2.35, yaw, color(170, 118, 66));
      detail.boxYaw(crateA.x, y + .04, crateA.z, 1.5, 1, 1.4, yaw, color(115, 83, 49));
      detail.boxYaw(crateB.x, y + .04, crateB.z, 1.25, .85, 1.2, yaw, color(129, 93, 52));
    } else if (feature.kind === "service" && feature.service === "headman") {
      const cos = Math.cos(yaw), sin = Math.sin(yaw), at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos }),
        wing = at(width * .42, -depth * .08), porch = at(0, depth / 2 + 1.05);
      structures.boxYaw(wing.x, y, wing.z, width * .45, 5.1, depth * .68, yaw, color(167, 165, 144));
      structures.boxYaw(porch.x, y + .04, porch.z, width * .5, .18, 2.15, yaw, color(151, 132, 95));
      for (const lx of [-width * .2, width * .2]) { const post = at(lx, depth / 2 + 1.4); detail.boxYaw(post.x, y, post.z, .24, 3.1, .24, yaw, color(75, 58, 43)); }
    }
  }
  return {
    terrain: result.terrain,
    structures: mergeGeometry(result.structures, structures.finish()),
    nature: mergeGeometry(result.nature, nature.finish()),
    detail: mergeGeometry(result.detail, detail.finish()),
  };
}
