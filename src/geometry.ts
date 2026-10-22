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
import { metresToSource, sourceUnitsPerMetreAt } from "./physical-scale.ts";

type Point = [number, number, number];
type RGB = readonly [number, number, number];
const color = (r: number, g: number, b: number): RGB => [r, g, b];

class Builder {
  origin = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 };
  placeAt(x: number, y: number, z: number, sourceZ: number, physical: boolean) {
    const scale = sourceUnitsPerMetreAt(sourceZ);
    this.origin = { x, y, z, sx: physical ? scale.x : 1, sy: metresToSource(1), sz: physical ? scale.z : 1 };
  }
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    this.triangleGradient(a, b, c, tint, tint, tint);
  }
  triangleGradient(a: Point, b: Point, c: Point, tintA: RGB, tintB: RGB, tintC: RGB) {
    const o = this.origin, transform = (p: Point): Point => [o.x + p[0] * o.sx, o.y + p[1] * o.sy, o.z + p[2] * o.sz];
    [a, b, c] = [transform(a), transform(b), transform(c)];
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

function offsetLocal(x: number, z: number, yaw: number, lx: number, lz: number) {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos };
}

function addServiceGeometry(structures: Builder, detail: Builder, service: string | undefined, x: number, y: number, z: number, width: number, depth: number, yaw: number) {
  const timber = color(82, 60, 40), plaster = color(201, 183, 143), stone = color(154, 153, 136), roof = color(103, 67, 49), dark = color(75, 72, 64);
  if (service === "market" || service === "merchant") {
    structures.boxYaw(x, y + .02, z, width, .16, depth, yaw, color(154, 132, 83));
    const canopy = offsetLocal(x, z, yaw, 0, depth * .12);
    structures.boxYaw(canopy.x, y + 3.25, canopy.z, width * .76, .22, depth * .62, yaw, color(169, 113, 62));
    for (const lx of [-width * .31, width * .31]) for (const lz of [-depth * .2, depth * .32]) {
      const post = offsetLocal(x, z, yaw, lx, lz);
      detail.boxYaw(post.x, y, post.z, .28, 3.3, .28, yaw, timber);
    }
    return;
  }
  if (service === "guard-office") {
    structures.boxYaw(x, y - .08, z, width, 4.9, depth, yaw, stone);
    structures.boxYaw(x, y + 4.7, z, width * .82, .65, depth * .82, yaw, dark);
    const tower = offsetLocal(x, z, yaw, width * .34, -depth * .28);
    structures.boxYaw(tower.x, y - .08, tower.z, width * .34, 6.8, depth * .36, yaw, color(143, 143, 129));
    detail.cone(tower.x, y + 6.65, tower.z, Math.max(1.7, width * .22), 2.2, roof, 4);
    return;
  }
  if (service === "farmstead") {
    structures.boxYaw(x, y - .05, z, width, 4.8, depth, yaw, color(137, 105, 70));
    structures.boxYaw(x, y + 4.55, z, width * 1.04, .72, depth * 1.04, yaw, roof);
    const loft = offsetLocal(x, z, yaw, 0, depth * .505);
    detail.boxYaw(loft.x, y + 2.05, loft.z, width * .32, 2.5, .18, yaw, dark);
    return;
  }
  if (service === "blacksmith") {
    structures.boxYaw(x, y - .05, z, width, 4.3, depth, yaw, color(174, 158, 124));
    structures.boxYaw(x, y + 4.05, z, width * 1.03, .64, depth * 1.03, yaw, dark);
    const chimney = offsetLocal(x, z, yaw, width * .3, -depth * .22);
    structures.boxYaw(chimney.x, y + 3.2, chimney.z, 1.35, 4.1, 1.35, yaw, color(114, 111, 101));
    const forge = offsetLocal(x, z, yaw, -width * .28, depth * .42);
    detail.boxYaw(forge.x, y + .05, forge.z, width * .28, 1.15, depth * .18, yaw, color(96, 79, 59));
    return;
  }
  if (service === "butcher") {
    structures.boxYaw(x, y - .05, z, width, 4.15, depth, yaw, plaster);
    structures.boxYaw(x, y + 3.95, z, width * 1.04, .55, depth * 1.04, yaw, roof);
    const awning = offsetLocal(x, z, yaw, 0, depth * .56);
    detail.boxYaw(awning.x, y + 2.45, awning.z, width * .72, .16, 2.2, yaw, color(153, 83, 59));
    return;
  }
  if (service === "inn") {
    structures.boxYaw(x, y - .06, z, width, 5.7, depth, yaw, plaster);
    structures.boxYaw(x, y + 5.35, z, width * 1.05, .75, depth * 1.05, yaw, roof);
    const chimney = offsetLocal(x, z, yaw, width * .3, -depth * .28), sign = offsetLocal(x, z, yaw, -width * .48, depth * .24);
    structures.boxYaw(chimney.x, y + 4.4, chimney.z, 1.1, 3.1, 1.1, yaw, stone);
    detail.boxYaw(sign.x, y + 2.9, sign.z, .22, 2.2, .22, yaw, timber);
    detail.boxYaw(sign.x, y + 4.35, sign.z, 1.8, 1.1, .18, yaw, color(129, 86, 52));
    return;
  }
  if (service === "headman") {
    structures.boxYaw(x, y - .06, z, width, 5.8, depth, yaw, stone);
    structures.boxYaw(x, y + 5.45, z, width * 1.06, .72, depth * 1.06, yaw, roof);
    const wing = offsetLocal(x, z, yaw, width * .4, -depth * .08);
    structures.boxYaw(wing.x, y - .04, wing.z, width * .42, 4.6, depth * .68, yaw, plaster);
    return;
  }
  structures.boxYaw(x, y - .05, z, width, 4.6, depth, yaw, plaster);
  structures.boxYaw(x, y + 4.3, z, width * 1.04, .62, depth * 1.04, yaw, roof);
}

/** S004 detail overlay: semantic settlement identity is owned by world.ts; geometry only visualizes it. */
export function buildTile(tile: Tile, options: { terrainOnly?: boolean } = {}): TileGeometry {
  if (options.terrainOnly) return buildTerrainOnly(tile);
  const result = coreBuildTile(tile), structures = new Builder(), nature = new Builder(), detail = new Builder(),
    originX = tile.minX + tile.size / 2, originZ = tile.minZ + tile.size / 2;
  if (tile.size <= 512) for (const feature of featuresFor(tile) as any[]) {
    const physical = feature.widthM !== undefined || feature.kind === "roadside-tree";
    for (const builder of [structures, nature, detail]) builder.placeAt(feature.x - originX, elevationToRenderY(feature.y), feature.z - originZ, feature.z, physical);
    const x = 0, z = 0, y = 0, yaw = feature.yawRad || 0,
      width = feature.widthM ?? feature.footprintWidth ?? 8, depth = feature.depthM ?? feature.footprintDepth ?? 8, variant = feature.variant || 0;
    if (feature.kind === "residence") {
      const wall = [color(185, 174, 145), color(167, 160, 139), color(196, 181, 149)][variant % 3], roof = [color(104, 65, 46), color(88, 67, 51), color(117, 73, 49)][(variant >>> 2) % 3],
        urban = Boolean(feature.urban), bodyHeight = feature.house?.wallHeightM ?? 2.8,
        roofHeight = .55, roofOverhang = .4;
      structures.boxYaw(x, y - .05, z, width, bodyHeight, depth, yaw, wall);
      structures.boxYaw(x, y + bodyHeight - .06, z, width + roofOverhang, roofHeight, depth + roofOverhang, yaw, roof);
      if (tile.size <= 32) {
        const front = offsetLocal(x, z, yaw, 0, depth * .5 + .03), chimney = offsetLocal(x, z, yaw, width * .26, -depth * .18);
        detail.boxYaw(front.x, y + .03, front.z, .9, 2.05, .09, yaw, color(78, 56, 40));
        detail.boxYaw(chimney.x, y + bodyHeight, chimney.z, .34, urban ? 1.05 : .78, .34, yaw, color(108, 102, 91));
      }
    } else if (feature.kind === "keep") {
      structures.boxYaw(x, -.1, z, width, 10, depth, yaw, color(154, 153, 136));
      structures.boxYaw(x, 9.8, z, width + .6, .7, depth + .6, yaw, color(85, 75, 64));
      for (const side of [-1, 1]) { const tower = offsetLocal(x, z, yaw, side * (width * .5 - 1.6), depth * .5 - 1.6); structures.boxYaw(tower.x, -.1, tower.z, 3.2, 13, 3.2, yaw, color(143, 143, 129)); }
    } else if (feature.kind === "well") {
      structures.boxYaw(x, 0, z, 2.3, 1, 2.3, yaw, color(154, 153, 136));
      detail.boxYaw(x, 1.02, z, 1.4, .04, 1.4, yaw, color(39, 59, 56));
      for (const side of [-1, 1]) { const post = offsetLocal(x, z, yaw, side * 1.2, 0); detail.boxYaw(post.x, 0, post.z, .18, 3, .18, yaw, color(82, 60, 40)); }
      structures.boxYaw(x, 3, z, 3, .25, 3, yaw, color(116, 69, 47));
    } else if (feature.kind === "street") {
      structures.boxYaw(x, y + .018, z, Math.max(metresToSource(2.8), width), .075, feature.length || depth || 4, yaw, color(119, 99, 68));
    } else if (feature.kind === "service") {
      addServiceGeometry(structures, detail, feature.service, x, y, z, width, depth, yaw);
    } else if (feature.kind === "gate") {
      const postSpan = Math.max(5.8, width * .72), left = offsetLocal(x, z, yaw, -postSpan * .5, 0), right = offsetLocal(x, z, yaw, postSpan * .5, 0), timber = color(85, 61, 40), stone = color(145, 144, 128);
      structures.boxYaw(left.x, y - .06, left.z, 1.8, 5.4, 1.8, yaw, stone);
      structures.boxYaw(right.x, y - .06, right.z, 1.8, 5.4, 1.8, yaw, stone);
      structures.boxYaw(x, y + 4.45, z, postSpan + 1.8, .7, 1.65, yaw, timber);
      if (tile.size <= 64) {
        detail.cone(left.x, y + 5.25, left.z, 1.55, 2.1, color(99, 66, 48), 4);
        detail.cone(right.x, y + 5.25, right.z, 1.55, 2.1, color(99, 66, 48), 4);
      }
    } else if (feature.kind === "guard-post") {
      structures.boxYaw(x, y - .05, z, width, 3.8, depth, yaw, color(143, 142, 126));
      structures.boxYaw(x, y + 3.55, z, width * 1.05, .55, depth * 1.05, yaw, color(91, 65, 47));
      if (tile.size <= 64) detail.cone(x, y + 3.95, z, Math.max(width, depth) * .72, 2.15, color(104, 70, 50), 4);
    } else if (feature.kind === "border" && variant >= 2) {
      const length = feature.length || depth || 4,
        at = (lx: number, lz: number) => offsetLocal(x, z, yaw, lx, lz);
      if (variant === 2) {
        structures.boxYaw(x, y - .02, z, Math.max(metresToSource(1.35), width), 1.65, length, yaw, color(76, 104, 59));
        if (tile.size <= 64) for (const lz of [-length * .34, 0, length * .34]) {
          const shrub = at(0, lz);
          detail.cone(shrub.x, y + .7, shrub.z, metresToSource(1.15), 1.45, color(83, 116, 64), 7);
        }
      } else if (variant === 3) {
        structures.boxYaw(x, y - .05, z, Math.max(metresToSource(.9), width), 2.75, length, yaw, color(91, 66, 43));
        if (tile.size <= 64) for (const lz of [-length * .45, 0, length * .45]) {
          const post = at(0, lz);
          detail.boxYaw(post.x, y - .08, post.z, metresToSource(1.25), 3.35, metresToSource(1.25), yaw, color(73, 52, 35));
        }
      } else {
        structures.boxYaw(x, y - .06, z, Math.max(metresToSource(1.2), width), 2.05, length, yaw, color(151, 150, 132));
        structures.boxYaw(x, y + 1.82, z, Math.max(metresToSource(.82), width * .72), .3, length, yaw, color(112, 105, 89));
        if (tile.size <= 64) for (const lz of [-length * .42, length * .42]) {
          const brace = at(0, lz);
          detail.boxYaw(brace.x, y + .05, brace.z, Math.max(metresToSource(1.35), width), 2.25, metresToSource(.52), yaw, color(82, 61, 43));
        }
      }
    } else if (feature.kind === "garden") {
      structures.boxYaw(x, y + .02, z, width, .08, depth, yaw, color(117, 132, 71));
      if (tile.size <= 64) {
        for (const lx of [-width * .28, 0, width * .28]) { const row = offsetLocal(x, z, yaw, lx, 0); detail.boxYaw(row.x, y + .12, row.z, .42, .3, depth * .72, yaw, color(151, 126, 62)); }
        for (const lz of [-depth / 2, depth / 2]) { const fence = offsetLocal(x, z, yaw, 0, lz); detail.boxYaw(fence.x, y + .1, fence.z, width, .18, .16, yaw, color(92, 68, 45)); }
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
    }
  }
  return {
    terrain: result.terrain,
    structures: mergeGeometry(result.structures, structures.finish()),
    nature: mergeGeometry(result.nature, nature.finish()),
    detail: mergeGeometry(result.detail, detail.finish()),
  };
}
