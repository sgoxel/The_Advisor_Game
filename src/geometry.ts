import { facadeWindows } from "./street-lighting.ts";
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
import { finalSurfaceRenderChannelsAt } from "./world-core.ts";
import { SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { metresToSource, sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { assetFor, type AssetMesh } from "./asset-meshes.ts";

type Point = [number, number, number];
type RGB = readonly [number, number, number];
const color = (r: number, g: number, b: number): RGB => [r, g, b];
const PAVEMENT = color(168, 158, 134);

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
      const surface = finalSurfaceRenderChannelsAt(px, pz);
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

function addServiceGeometry(structures: Builder, detail: Builder, service: string | undefined, x: number, y: number, z: number, width: number, depth: number, yaw: number, close = false) {
  const timber = color(82, 60, 40), plaster = color(201, 183, 143), stone = color(154, 153, 136), roof = color(103, 67, 49), dark = color(75, 72, 64);
  if (service === "market" || service === "merchant") {
    structures.boxYaw(x, y + .02, z, width, .16, depth, yaw, color(154, 132, 83));
    // Close up, the bazaar stalls are the market: the far-zoom canopy would hide them.
    if (close) return;
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

// ---------------------------------------------------------------------------------------------
// Close-zoom town props (Hero/Close only). Everything below is low-poly, vertex-coloured and
// drawn into the existing builders; no textures, materials or lights. Physical features are in
// metres (1 unit = 1 m); a person is ~1.75 m tall, chairs 0.45 m, tables 0.75 m, umbrellas 2.3 m.
// ---------------------------------------------------------------------------------------------
type Frame = { b: Builder; x: number; y: number; z: number; yaw: number };
const frameOf = (b: Builder, yaw: number, y = 0): Frame => ({ b, x: 0, y, z: 0, yaw });
/** A child frame at local (lx, lz), rotated by dyaw and lifted by ly. */
const sub = (f: Frame, lx: number, lz: number, dyaw = 0, ly = 0): Frame => {
  const p = offsetLocal(f.x, f.z, f.yaw, lx, lz);
  return { b: f.b, x: p.x, y: f.y + ly, z: p.z, yaw: f.yaw + dyaw };
};
const pt = (f: Frame, lx: number, ly: number, lz: number): Point => {
  const p = offsetLocal(f.x, f.z, f.yaw, lx, lz);
  return [p.x, f.y + ly, p.z];
};
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Point): Point => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Convex planar polygon (triangle fan) whose normal points away from `ref` (or towards it when inverted). */
function polygon(b: Builder, points: Point[], ref: Point, tint: RGB, invert = false) {
  const n = cross3(minus(points[1], points[0]), minus(points[2], points[0]));
  const flip = (dot3(n, minus(points[0], ref)) < 0) !== invert;
  for (let k = 1; k + 1 < points.length; k++)
    if (flip) b.triangle(points[0], points[k + 1], points[k], tint); else b.triangle(points[0], points[k], points[k + 1], tint);
}
/** Box in frame-local space: 4 walls (+ optional top), 8-10 triangles. */
function cuboid(f: Frame, lx: number, ly: number, lz: number, w: number, h: number, d: number, tint: RGB, top = true) {
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]],
    lo = corners.map(([a, c]) => pt(f, lx + a, ly, lz + c)), hi = corners.map(([a, c]) => pt(f, lx + a, ly + h, lz + c)), ref = pt(f, lx, ly + h / 2, lz);
  for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; polygon(f.b, [lo[k], lo[j], hi[j], hi[k]], ref, tint); }
  if (top) polygon(f.b, hi, ref, tint);
}
function ringPoints(f: Frame, lx: number, ly: number, lz: number, r: number, sides: number): Point[] {
  const out: Point[] = [];
  for (let k = 0; k < sides; k++) { const a = (k + .5) * Math.PI * 2 / sides; out.push(pt(f, lx + Math.cos(a) * r, ly, lz + Math.sin(a) * r)); }
  return out;
}
/** Vertical n-sided prism; `inward` turns the walls to face the axis (basin insides). */
function prism(f: Frame, lx: number, ly: number, lz: number, r: number, h: number, sides: number, tint: RGB, top = true, topTint = tint, inward = false) {
  const lo = ringPoints(f, lx, ly, lz, r, sides), hi = ringPoints(f, lx, ly + h, lz, r, sides), ref = pt(f, lx, ly + h / 2, lz);
  for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; polygon(f.b, [lo[k], lo[j], hi[j], hi[k]], ref, tint, inward); }
  if (top) polygon(f.b, hi, ref, topTint);
}
/** Flat upward-facing polygon (sides-2 triangles). */
function disc(f: Frame, lx: number, ly: number, lz: number, r: number, sides: number, tint: RGB) {
  polygon(f.b, ringPoints(f, lx, ly, lz, r, sides), pt(f, lx, ly - 1, lz), tint);
}
function annulus(f: Frame, lx: number, ly: number, lz: number, inner: number, outer: number, sides: number, tint: RGB) {
  const a = ringPoints(f, lx, ly, lz, inner, sides), b = ringPoints(f, lx, ly, lz, outer, sides), ref = pt(f, lx, ly - 1, lz);
  for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; polygon(f.b, [a[k], b[k], b[j], a[j]], ref, tint); }
}
/** Cone with optionally alternating panel colours (striped parasols). */
function coneAt(f: Frame, lx: number, ly: number, lz: number, r: number, h: number, sides: number, tintA: RGB, tintB = tintA) {
  const rim = ringPoints(f, lx, ly, lz, r, sides), apex = pt(f, lx, ly + h, lz), ref = pt(f, lx, ly - Math.max(.05, h), lz);
  for (let k = 0; k < sides; k++) polygon(f.b, [rim[k], rim[(k + 1) % sides], apex], ref, k % 2 ? tintB : tintA);
}
/** Square-section beam between two arbitrary points (A-frames, chutes, chains); 8 triangles. */
function beam(b: Builder, p: Point, q: Point, w: number, h: number, tint: RGB) {
  const axis = norm3(minus(q, p));
  let side = cross3(axis, [0, 1, 0]);
  if (Math.hypot(...side) < 1e-6) side = [1, 0, 0];
  side = norm3(side);
  const up = norm3(cross3(side, axis)), mid: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2],
    offs = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, u]) => [0, 1, 2].map((i) => side[i] * s * w / 2 + up[i] * u * h / 2)),
    at = (base: Point, o: number[]): Point => [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
  for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; polygon(b, [at(p, offs[k]), at(p, offs[j]), at(q, offs[j]), at(q, offs[k])], mid, tint); }
}

/** Deterministic seeded stream (mulberry32); colour picks never use Math.random. */
function seeded(seed: number) {
  let s = (seed >>> 0) ^ 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];

const WOOD = color(139, 98, 58), DARK_WOOD = color(92, 64, 42), IRON = color(52, 50, 48), STONE = color(158, 152, 136),
  PALE_STONE = color(182, 176, 160), SOIL = color(88, 64, 44), LEAF = color(70, 118, 58), LEAF_LIGHT = color(92, 140, 68),
  WATER = color(70, 120, 150), SPRAY = color(176, 208, 222), CREAM = color(232, 220, 190), WHITE = color(238, 234, 226),
  DECK = color(146, 108, 70), BURLAP = color(168, 144, 102), SAND = color(214, 192, 140);
const FLOWERS = [color(198, 52, 48), color(232, 196, 60), color(126, 74, 160), color(236, 232, 222), color(226, 120, 160), color(230, 130, 50)];
/** Awning/parasol cloths with their stripe partner: red/white, blue/white, green/cream, ochre/cream. */
const CLOTHS: readonly (readonly [RGB, RGB])[] = [[color(176, 52, 46), WHITE], [color(52, 92, 150), WHITE], [color(62, 120, 72), CREAM], [color(196, 146, 52), CREAM]];
const PRODUCE = [color(196, 58, 44), color(236, 160, 48), color(118, 160, 58), color(140, 62, 112), color(226, 204, 92), color(170, 112, 62)];
const CHAIRS = [DARK_WOOD, color(58, 78, 64), color(70, 58, 50), color(120, 46, 40)];

/** Chair facing local +z: seat 0.45 m, back 0.9 m; 22 triangles. */
function addChair(f: Frame, lx: number, lz: number, dyaw: number, tint: RGB) {
  const c = sub(f, lx, lz, dyaw), ref = pt(c, 0, .2, 0);
  cuboid(c, 0, .41, 0, .42, .05, .4, tint);
  cuboid(c, 0, .46, -.18, .42, .44, .04, tint, false);
  polygon(c.b, [pt(c, -.19, 0, .18), pt(c, .19, 0, .18), pt(c, .19, .41, .18), pt(c, -.19, .41, .18)], ref, tint);
  polygon(c.b, [pt(c, -.19, 0, -.18), pt(c, .19, 0, -.18), pt(c, .19, .46, -.18), pt(c, -.19, .46, -.18)], ref, tint);
}
/** Round bistro table 0.75 m high (pole + octagonal top); 12 triangles. */
function addTable(f: Frame, lx: number, lz: number, r: number, tint: RGB) {
  prism(f, lx, 0, lz, .05, .74, 3, IRON, false);
  disc(f, lx, .75, lz, r, 8, tint);
}
/** Parasol 2.3 m high with a striped 8-panel canopy; 14 triangles. */
function addUmbrella(f: Frame, lx: number, lz: number, r: number, cloth: readonly [RGB, RGB]) {
  prism(f, lx, 0, lz, .03, 2.2, 3, color(214, 206, 188), false);
  coneAt(f, lx, 1.92, lz, r, .38, 8, cloth[0], cloth[1]);
}
/** Table with `chairs` chairs evenly around it, starting at angle theta0 (0 = chairs on local ±z). */
function addTableSet(f: Frame, lx: number, lz: number, chairs: number, r: Rand, options: { theta0?: number; tableR?: number; umbrellaR?: number } = {}) {
  const tableR = options.tableR ?? .4, theta0 = options.theta0 ?? Math.PI / 2, chair = pick(r, CHAIRS), reach = tableR + .22;
  addTable(f, lx, lz, tableR, chair === CHAIRS[0] ? color(170, 128, 84) : color(226, 218, 200));
  for (let k = 0; k < chairs; k++) {
    const angle = theta0 + k * Math.PI * 2 / chairs;
    addChair(f, lx + Math.sin(angle) * reach, lz + Math.cos(angle) * reach, angle + Math.PI, chair);
  }
  if (options.umbrellaR) addUmbrella(f, lx, lz, options.umbrellaR, pick(r, CLOTHS));
}
/** 1.8 x 0.6 m bench facing local +z: iron end frames with armrests, two seat slats, backrest; 50 triangles. */
function addBench(f: Frame, lx: number, lz: number, dyaw: number) {
  const c = sub(f, lx, lz, dyaw);
  for (const side of [-1, 1]) cuboid(c, side * .82, 0, -.04, .07, .62, .5, IRON);
  cuboid(c, 0, .42, .1, 1.64, .05, .19, WOOD);
  cuboid(c, 0, .42, -.12, 1.64, .05, .19, WOOD);
  cuboid(c, 0, .5, -.26, 1.64, .36, .05, WOOD);
}
/** Leafy mound with a coloured blossom cap; 9 triangles. */
function addFlowerClump(f: Frame, lx: number, ly: number, lz: number, flower: RGB, s = 1) {
  coneAt(f, lx, ly, lz, .2 * s, .3 * s, 5, LEAF);
  coneAt(f, lx, ly + .19 * s, lz, .13 * s, .15 * s, 4, flower);
}
/** Stone or timber planter with soil and 3-5 seeded flower clumps; <= 55 triangles. */
function addPlanter(f: Frame, lx: number, lz: number, dyaw: number, seed: number, w = 1.4, d = .7, h = .5) {
  const r = seeded(seed), c = sub(f, lx, lz, dyaw), box = r() < .5 ? STONE : color(120, 86, 56), count = 3 + Math.floor(r() * 3),
    a = pick(r, FLOWERS), b = pick(r, FLOWERS), s = Math.min(1.3, Math.max(.7, d / .7));
  cuboid(c, 0, 0, 0, w, h, d, box, false);
  polygon(c.b, [pt(c, -w / 2, h - .05, -d / 2), pt(c, w / 2, h - .05, -d / 2), pt(c, w / 2, h - .05, d / 2), pt(c, -w / 2, h - .05, d / 2)], pt(c, 0, 0, 0), SOIL);
  for (let i = 0; i < count; i++) addFlowerClump(c, -w / 2 + (i + .5) * w / count, h - .08, (i % 2 ? .07 : -.07) * s, i % 2 ? b : a, s);
}
function addCrate(f: Frame, lx: number, ly: number, lz: number, dyaw: number, produce: RGB) {
  const c = sub(f, lx, lz, dyaw, ly);
  cuboid(c, 0, 0, 0, .5, .3, .4, color(150, 112, 70));
  polygon(c.b, [pt(c, -.22, .31, -.17), pt(c, .22, .31, -.17), pt(c, .22, .31, .17), pt(c, -.22, .31, .17)], pt(c, 0, 0, 0), produce);
}
function addBarrel(f: Frame, lx: number, ly: number, lz: number) { prism(f, lx, ly, lz, .28, .8, 6, color(122, 86, 54), true, color(96, 70, 46)); }
function addSack(f: Frame, lx: number, ly: number, lz: number) { coneAt(f, lx, ly, lz, .24, .55, 5, BURLAP); }
/** Small decorative tree: trunk and two foliage cones; 23 triangles. */
function addTree(f: Frame, lx: number, lz: number, s: number, leaf = LEAF) {
  cuboid(f, lx, 0, lz, .16 * s, .9 * s, .16 * s, color(88, 64, 44));
  coneAt(f, lx, .6 * s, lz, .6 * s, 1.5 * s, 7, leaf);
  coneAt(f, lx, 1.4 * s, lz, .38 * s, 1 * s, 6, LEAF_LIGHT);
}
/** Copy a Blender asset (asset-local metres, +Y up, front +Z) into a frame, one flat colour per triangle. */
function addAssetMesh(f: Frame, mesh: AssetMesh) {
  const p = mesh.positions, at = (i: number) => pt(f, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  for (let t = 0; t < mesh.triangles; t++)
    f.b.triangle(at(mesh.indices[t * 3]), at(mesh.indices[t * 3 + 1]), at(mesh.indices[t * 3 + 2]), [mesh.colors[t * 3], mesh.colors[t * 3 + 1], mesh.colors[t * 3 + 2]]);
}
/** One seeded yard object of a home, facing local +z, inside its YARD_PROP_SIZES footprint (world.ts); ≤ 90 triangles. */
function addYardProp(f: Frame, kind: string, variant: number) {
  const r = seeded(variant ^ 0x7a2d);
  if (kind === "woodpile") {
    // Split logs stacked under a lean-to roof, a chopping block with an axe beside it.
    for (let row = 0; row < 3; row++) cuboid(f, -.25, row * .26, -.2, 1.2, .24, .55, row % 2 ? color(150, 108, 66) : color(132, 94, 58));
    cuboid(f, -.25, .95, -.2, 1.35, .05, .75, DARK_WOOD);
    prism(f, .6, 0, .25, .2, .45, 6, color(120, 86, 54), true, color(176, 140, 96));
    beam(f.b, pt(f, .6, .45, .25), pt(f, .72, .7, .32), .04, .04, DARK_WOOD);
    cuboid(f, .74, .66, .33, .03, .1, .14, IRON);
  } else if (kind === "barrels") {
    const xs = r() < .5 ? [-.24, .24] : [-.38, 0, .38];
    xs.forEach((x, i) => addBarrel(f, x, 0, i % 2 ? .1 : -.1));
    if (r() < .6) addCrate(f, xs[xs.length - 1], .8, -.1, .2, pick(r, [color(196, 70, 50), color(214, 170, 60), color(110, 150, 70)]));
  } else if (kind === "cart") {
    // Two-wheeled hand cart: plank bed with side boards, wheels, shafts resting on the ground.
    cuboid(f, 0, .45, -.25, 1.1, .08, 1.3, WOOD);
    for (const side of [-1, 1]) cuboid(f, side * .53, .53, -.25, .04, .25, 1.3, DARK_WOOD);
    // Upright wheels (low-poly: a rim board, a cross of spokes and a hub on each side).
    for (const side of [-1, 1]) {
      const x = side * .64;
      cuboid(f, x, .04, -.25, .07, .82, .3, DARK_WOOD, false);
      cuboid(f, x, .3, -.25, .07, .3, .82, DARK_WOOD, false);
      cuboid(f, x + side * .03, .38, -.25, .08, .14, .14, IRON);
    }
    for (const side of [-1, 1]) beam(f.b, pt(f, side * .4, .5, .4), pt(f, side * .45, .05, 1.15), .05, .05, DARK_WOOD);
    if (r() < .7) addSack(f, -.2, .53, -.4);
  } else if (kind === "washline") {
    // Two posts, a line and a few cloths in seeded colours.
    for (const side of [-1, 1]) cuboid(f, side * 1.5, 0, 0, .08, 1.9, .08, DARK_WOOD);
    beam(f.b, pt(f, -1.5, 1.82, 0), pt(f, 1.5, 1.82, 0), .015, .015, color(210, 205, 190));
    const cloths = 3 + Math.floor(r() * 2);
    for (let i = 0; i < cloths; i++) {
      const x = -1.15 + (i + .5) * 2.3 / cloths, h = .45 + r() * .3, w = .35 + r() * .25;
      cuboid(f, x, 1.8 - h, 0, w, h, .02, pick(r, [WHITE, CREAM, color(170, 70, 60), color(80, 110, 160), color(120, 150, 90), color(200, 180, 120)]));
    }
  } else if (kind === "coop") {
    // Small timber hen house with a pitched roof, a low fenced run and a few hens.
    cuboid(f, -.7, 0, -.5, 1.0, .95, .9, color(150, 112, 70));
    cuboid(f, -.7, .95, -.5, 1.15, .08, 1.05, color(120, 72, 52));
    const run = [[-1.2, -1.0], [1.2, -1.0], [1.2, 1.0], [-1.2, 1.0]];
    for (let k = 0; k < run.length; k++) {
      const a = run[k], b = run[(k + 1) % run.length];
      beam(f.b, pt(f, a[0], .45, a[1]), pt(f, b[0], .45, b[1]), .03, .03, WOOD);
      cuboid(f, a[0], 0, a[1], .05, .5, .05, DARK_WOOD, false);
    }
    const hens = 2 + Math.floor(r() * 2);
    for (let i = 0; i < hens; i++)
      cuboid(f, .15 + r() * .85, .05, -.6 + r() * 1.3, .17, .2, .26, pick(r, [WHITE, color(170, 110, 60), color(60, 50, 44)]));
  } else if (kind === "door-bench") {
    // 2.6 m footprint: the bench on the left, room for a small flower pot on the right.
    addBench(f, -.4, 0, 0);
    if (r() < .5) addPlanter(f, .95, 0, 0, variant, .5, .5, .45);
  }
}
/** Market stall facing local +z: 4 posts, counter, produce, sloping striped awning; 64 triangles. */
function addStall(f: Frame, lx: number, lz: number, dyaw: number, w: number, r: Rand) {
  const c = sub(f, lx, lz, dyaw), [cloth, stripe] = pick(r, CLOTHS), bands = 4, backY = 2.45, frontY = 2.05, backZ = -.8, frontZ = 1.1;
  for (const side of [-1, 1]) {
    prism(c, side * (w / 2 - .06), 0, -.75, .05, 2.45, 3, DARK_WOOD, false);
    prism(c, side * (w / 2 - .06), 0, .75, .05, 2.14, 3, DARK_WOOD, false);
  }
  cuboid(c, 0, 0, .45, w - .2, .9, .55, WOOD);
  cuboid(c, -w * .22, .9, .45, w * .38, .12, .4, pick(r, PRODUCE));
  cuboid(c, w * .22, .9, .45, w * .38, .12, .4, pick(r, PRODUCE));
  const below = pt(c, 0, 1, 0);
  for (let k = 0; k < bands; k++) {
    const x0 = -w / 2 - .05 + k * (w + .1) / bands, x1 = x0 + (w + .1) / bands;
    polygon(c.b, [pt(c, x0, backY, backZ), pt(c, x1, backY, backZ), pt(c, x1, frontY, frontZ), pt(c, x0, frontY, frontZ)], below, k % 2 ? stripe : cloth);
  }
  polygon(c.b, [pt(c, -w / 2 - .05, frontY - .2, frontZ), pt(c, w / 2 + .05, frontY - .2, frontZ), pt(c, w / 2 + .05, frontY, frontZ), pt(c, -w / 2 - .05, frontY, frontZ)], pt(c, 0, frontY, 0), cloth);
}
/** Octagonal stone fountain: step, basin with water, column and top bowl; ~125 triangles. */
function addFountain(f: Frame, lx: number, lz: number, radius: number) {
  const c = sub(f, lx, lz), s = Math.max(.7, Math.min(1, radius / 2.5));
  prism(c, 0, 0, 0, radius + .4, .15, 8, color(140, 134, 118));
  prism(c, 0, .15, 0, radius, .6, 8, STONE, false);
  annulus(c, 0, .75, 0, radius - .25, radius, 8, PALE_STONE);
  prism(c, 0, .6, 0, radius - .25, .15, 8, STONE, false, STONE, true);
  disc(c, 0, .62, 0, radius - .25, 8, WATER);
  prism(c, 0, .62, 0, .2 * s + .05, 1.55, 6, PALE_STONE);
  prism(c, 0, 1.72, 0, .75 * s, .18, 8, STONE, false);
  disc(c, 0, 1.9, 0, .75 * s, 8, WATER);
  coneAt(c, 0, 1.9, 0, .12, .5, 5, SPRAY);
}
/** Tapered n-sided column, radius r0 at the base and r1 at the top (walls + optional top). */
function frustum(f: Frame, lx: number, ly: number, lz: number, r0: number, r1: number, h: number, sides: number, tint: RGB, top = true) {
  const lo = ringPoints(f, lx, ly, lz, r0, sides), hi = ringPoints(f, lx, ly + h, lz, r1, sides), ref = pt(f, lx, ly + h / 2, lz);
  for (let k = 0; k < sides; k++) { const j = (k + 1) % sides; polygon(f.b, [lo[k], lo[j], hi[j], hi[k]], ref, tint); }
  if (top) polygon(f.b, hi, ref, tint);
}
const BRONZE = color(86, 108, 94), PLINTH = color(140, 134, 118), LAMP_METAL = color(55, 48, 39), LAMP_BRASS = color(142, 106, 57);
/** Statue on a two-tier stepped plinth (footprint 3 x 3 m at s = 1): a verdigris figure or a stone obelisk, ~3.8 m; ~110 triangles. */
function addStatue(f: Frame, lx: number, lz: number, s: number, obelisk: boolean) {
  const c = sub(f, lx, lz);
  cuboid(c, 0, 0, 0, 3 * s, .3, 3 * s, PLINTH);
  cuboid(c, 0, .3, 0, 2.1 * s, .3, 2.1 * s, STONE);
  cuboid(c, 0, .6, 0, 1, 1.2, 1, PALE_STONE, false);
  cuboid(c, 0, 1.8, 0, 1.2, .12, 1.2, STONE);
  if (obelisk) {
    frustum(c, 0, 1.92, 0, .46, .28, 1.75, 4, PALE_STONE, false);
    coneAt(c, 0, 3.67, 0, .28, .4, 4, STONE);
    return;
  }
  // A standing figure facing the street (+z): legs, coat, one arm raised, head.
  for (const side of [-1, 1]) cuboid(c, side * .1, 1.92, 0, .14, .8, .18, BRONZE, false);
  frustum(c, 0, 2.72, 0, .27, .33, .72, 6, BRONZE);
  beam(c.b, pt(c, .3, 3.34, 0), pt(c, .5, 3.82, .16), .1, .1, BRONZE);
  beam(c.b, pt(c, -.3, 3.34, 0), pt(c, -.36, 2.8, .06), .1, .1, BRONZE);
  prism(c, 0, 3.44, 0, .13, .27, 6, BRONZE);
}
/** Market cross: octagonal steps, tapering shaft, capital and stone cross, ~4.3 m; ~110 triangles. */
function addMarketCross(f: Frame, lx: number, lz: number) {
  const c = sub(f, lx, lz);
  prism(c, 0, 0, 0, 1.7, .25, 8, PLINTH);
  prism(c, 0, .25, 0, 1.25, .25, 8, STONE);
  prism(c, 0, .5, 0, .62, .32, 8, PALE_STONE);
  frustum(c, 0, .82, 0, .22, .15, 2.68, 6, STONE, false);
  cuboid(c, 0, 3.5, 0, .34, .12, .34, PALE_STONE);
  cuboid(c, 0, 3.62, 0, .15, .72, .15, PALE_STONE);
  cuboid(c, 0, 3.92, 0, .66, .15, .15, PALE_STONE);
}
/** Roofed well: round stone shaft with water, two posts, windlass, bucket and a gabled shingle roof, 2.8 m; ~110 triangles. */
function addWell(f: Frame, lx: number, lz: number) {
  const c = sub(f, lx, lz), roof = color(116, 69, 47);
  prism(c, 0, 0, 0, 1, .8, 8, STONE, false);
  annulus(c, 0, .8, 0, .72, 1, 8, PALE_STONE);
  prism(c, 0, .3, 0, .72, .5, 8, STONE, false, STONE, true);
  disc(c, 0, .32, 0, .72, 8, color(48, 78, 96));
  for (const side of [-1, 1]) cuboid(c, side * .86, .8, 0, .13, 1.98, .13, DARK_WOOD, false);
  cuboid(c, 0, 1.6, 0, 1.6, .1, .1, WOOD, false);
  beam(c.b, pt(c, .15, 1.6, 0), pt(c, .15, 1.12, 0), .02, .02, IRON);
  prism(c, .15, .9, 0, .15, .22, 6, color(120, 86, 54));
  // Gable along x: two slopes from the eaves (y 2.25, z ±.8) to the ridge (y 2.8), with gable ends.
  const ridge = (x: number) => pt(c, x, 2.8, 0), eave = (x: number, z: number) => pt(c, x, 2.25, z), under = pt(c, 0, 1.4, 0);
  for (const z of [-.8, .8]) polygon(c.b, [eave(-1.15, z), eave(1.15, z), ridge(1.15), ridge(-1.15)], under, roof);
  for (const x of [-1.15, 1.15]) polygon(c.b, [eave(x, -.8), eave(x, .8), ridge(x)], pt(c, 0, 2.4, 0), color(96, 70, 46));
}
/** Big shade tree with a round timber bench about its trunk; crown radius `crown` (<= 3 m), top ~5 m; ~95 triangles. */
function addSeatTree(f: Frame, lx: number, lz: number, crown: number) {
  const c = sub(f, lx, lz);
  disc(c, 0, .01, 0, .95, 8, SOIL);
  prism(c, 0, 0, 0, .34, 2.4, 7, color(88, 64, 44), false);
  annulus(c, 0, .45, 0, .95, 1.4, 8, WOOD);
  prism(c, 0, 0, 0, 1.4, .45, 8, DARK_WOOD, false);
  prism(c, 0, .45, 0, .95, .45, 8, WOOD, false);
  coneAt(c, 0, 1.95, 0, crown, 1.7, 8, LEAF);
  coneAt(c, 0, 2.8, 0, crown * .74, 1.55, 7, LEAF_LIGHT);
  coneAt(c, 0, 3.6, 0, crown * .44, 1.4, 6, LEAF);
}
/** Shade tree: trunk and two foliage cones; crown 1.8 m is the 5 m tree, smaller crowns are a little lower; 23 triangles. */
function addShadeTree(f: Frame, lx: number, lz: number, crown: number) {
  const h = .6 + .4 * crown / 1.8;
  cuboid(f, lx, 0, lz, .24, 2.1 * h, .24, color(88, 64, 44));
  coneAt(f, lx, 1.5 * h, lz, crown, 3.5 * h, 7, LEAF);
  coneAt(f, lx, 3.1 * h, lz, crown * .62, 1.9 * h, 6, LEAF_LIGHT);
}
/** Square lamp post, the street-lamp shape at 1:1 (3.25 m post, arm, brass lantern, cap); no light of its own; 36 triangles. */
function addLampPost(f: Frame, lx: number, lz: number, dyaw = 0) {
  const c = sub(f, lx, lz, dyaw);
  cuboid(c, 0, 0, 0, .12, 3.25, .12, LAMP_METAL, false);
  cuboid(c, 0, 3.1, 0, .66, .09, .09, LAMP_METAL);
  cuboid(c, 0, 2.76, 0, .4, .48, .4, LAMP_BRASS, false);
  cuboid(c, 0, 3.22, 0, .52, .08, .52, LAMP_METAL);
}
/** Low timber fence (two rails, square posts every <= 3 m) from local a to b; `firstPost` false leaves the start post to the previous run. */
function fenceRun(f: Frame, ax: number, az: number, bx: number, bz: number, firstPost = true) {
  const length = Math.hypot(bx - ax, bz - az), rail = sub(f, (ax + bx) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az)), posts = Math.max(2, Math.ceil(length / 3) + 1);
  cuboid(rail, 0, .52, 0, .05, .07, length, WOOD);
  cuboid(rail, 0, .24, 0, .05, .07, length, WOOD);
  for (let i = firstPost ? 0 : 1; i < posts; i++) prism(rail, 0, 0, -length / 2 + i * length / (posts - 1), .07, .66, 4, DARK_WOOD, false);
}

// ---------------------------------------------------------------------------------------------
// Park outlines. A park's seeded `parkShape` turns its widthM x depthM rectangle into a rectangle,
// a chamfered rectangle ("cut", chamfer 18 % of the short side), an octagon (chamfer 29 %) or the
// inscribed ellipse ("round", 24 segments). Every outline vertex lies inside the rectangle, so the
// placement footprint stays the plain rectangle. Pads, fences, hedges, paths and props all follow it.
// ---------------------------------------------------------------------------------------------
type XZ = [number, number];
export type ParkShape = "rect" | "cut" | "octagon" | "round";
const ROUND_SEGMENTS = 24;
const parkShapeOf = (shape: unknown): ParkShape => shape === "cut" || shape === "octagon" || shape === "round" ? shape : "rect";
/** Local park outline in metres (centred, +z = street side), counter-clockwise in (x, z): positive signed area. */
export function parkOutline(shape: unknown, w: number, d: number): XZ[] {
  const kind = parkShapeOf(shape), hw = w / 2, hd = d / 2;
  if (kind === "round") return Array.from({ length: ROUND_SEGMENTS }, (_, k): XZ => { const a = k * Math.PI * 2 / ROUND_SEGMENTS; return [Math.cos(a) * hw, Math.sin(a) * hd]; });
  if (kind === "rect") return [[hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]];
  const c = (kind === "cut" ? .18 : .29) * Math.min(w, d);
  return [[hw, -hd + c], [hw, hd - c], [hw - c, hd], [-hw + c, hd], [-hw, hd - c], [-hw, -hd + c], [-hw + c, -hd], [hw - c, -hd]];
}
/** Signed distance from (x, z) to the nearest edge of a convex counter-clockwise outline (positive inside). */
function clearance(outline: readonly XZ[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % outline.length], ex = bx - ax, ez = bz - az;
    best = Math.min(best, ((z - az) * ex - (x - ax) * ez) / (Math.hypot(ex, ez) || 1));
  }
  return best;
}
/** True when local (x, z) lies inside the park outline with at least `margin` metres to spare. */
export function insidePark(shape: unknown, w: number, d: number, x: number, z: number, margin = 0) {
  return clearance(parkOutline(shape, w, d), x, z) >= margin;
}
/** The convex outline moved `m` metres inwards (each edge offset, neighbours re-intersected). */
function insetOutline(outline: readonly XZ[], m: number): XZ[] {
  const n = outline.length, lines = outline.map(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % n], ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez) || 1;
    return [ax - ez / l * m, az + ex / l * m, ex, ez] as const;
  });
  return lines.map(([qx, qz, fx, fz], i): XZ => {
    const [px, pz, ex, ez] = lines[(i + n - 1) % n], den = ex * fz - ez * fx;
    if (Math.abs(den) < 1e-9) return [qx, qz];
    const t = ((qx - px) * fz - (qz - pz) * fx) / den;
    return [px + ex * t, pz + ez * t];
  });
}
/** Convex polygon `subject` clipped to the convex counter-clockwise `clip` outline (Sutherland-Hodgman). */
function clipToOutline(subject: readonly XZ[], clip: readonly XZ[]): XZ[] {
  let out: XZ[] = [...subject];
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, az] = clip[i], [bx, bz] = clip[(i + 1) % clip.length], side = ([x, z]: XZ) => (z - az) * (bx - ax) - (x - ax) * (bz - az), input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k], q = input[(k + 1) % input.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    out = out.filter((p, k) => { const q = out[(k + 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
  }
  return out.length >= 3 ? out : [];
}
const rectOutline = (x0: number, x1: number, z0: number, z1: number): XZ[] => [[x1, z0], [x1, z1], [x0, z1], [x0, z0]];
/** Flat-topped pad on a convex counter-clockwise outline: walls from y0 up to `top` and an upward fan top; 3n - 2 triangles. */
function padSlab(f: Frame, outline: readonly XZ[], y0: number, top: number, tint: RGB) {
  if (outline.length < 3) return;
  const n = outline.length, cx = outline.reduce((s, p) => s + p[0], 0) / n, cz = outline.reduce((s, p) => s + p[1], 0) / n,
    lo = outline.map(([x, z]) => pt(f, x, y0, z)), hi = outline.map(([x, z]) => pt(f, x, top, z)), ref = pt(f, cx, (y0 + top) / 2, cz);
  for (let k = 0; k < n; k++) { const j = (k + 1) % n; polygon(f.b, [lo[k], lo[j], hi[j], hi[k]], ref, tint); }
  // Counter-clockwise in (x, z) with y up: (0, k + 1, k) faces up.
  for (let k = 1; k + 1 < n; k++) f.b.triangle(hi[0], hi[k + 1], hi[k], tint);
}
/**
 * Fence/hedge runs along a closed outline, leaving a `gap`-wide entrance across local x = 0 on the street (+z) side.
 * `start`/`end` are the outline vertex indices a run begins/ends on (shared with the neighbouring run), or -1 at the entrance.
 */
function outlineRuns(outline: readonly XZ[], gap: number) {
  const runs: { a: XZ; b: XZ; start: number; end: number }[] = [], n = outline.length, maxZ = Math.max(...outline.map((p) => p[1])), g = gap / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = outline[i], b = outline[j], at = (t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (Math.min(a[1], b[1]) <= maxZ * .5 || Math.abs(b[0] - a[0]) < 1e-9) { runs.push({ a, b, start: i, end: j }); continue; }
    const t1 = (-g - a[0]) / (b[0] - a[0]), t2 = (g - a[0]) / (b[0] - a[0]), lo = Math.max(0, Math.min(1, Math.min(t1, t2))), hi = Math.max(0, Math.min(1, Math.max(t1, t2)));
    if (lo * length > .3) runs.push({ a, b: at(lo), start: i, end: lo >= 1 ? j : -1 });
    if ((1 - hi) * length > .3) runs.push({ a: at(hi), b, start: hi <= 0 ? i : -1, end: j });
  }
  return runs;
}

/** A prop's footprint in its own frame: [x0, x1, z0, z1] metres. */
type Box = readonly [number, number, number, number];
/**
 * Keeps a park's props inside its outline and off each other. Boxes are tested by their (rotated) corners, which is
 * exact for a convex outline; placed props block an axis-aligned box or a circle.
 */
class ParkLayout {
  boxes: Box[] = [];
  circles: [number, number, number][] = [];
  readonly outline: readonly XZ[];
  readonly margin: number;
  /** Edge start points with inward unit normals, precomputed for the many corner tests. */
  readonly edges: [number, number, number, number][];
  constructor(outline: readonly XZ[], margin = .3) {
    this.outline = outline; this.margin = margin;
    this.edges = outline.map(([ax, az], i) => { const [bx, bz] = outline[(i + 1) % outline.length], l = Math.hypot(bx - ax, bz - az) || 1; return [ax, az, -(bz - az) / l, (bx - ax) / l]; });
  }
  corners(x: number, z: number, box: Box, dyaw: number): XZ[] {
    const c = Math.cos(dyaw), s = Math.sin(dyaw);
    return ([[box[0], box[2]], [box[1], box[2]], [box[1], box[3]], [box[0], box[3]]] as XZ[]).map(([u, v]): XZ => [x + u * c + v * s, z - u * s + v * c]);
  }
  aabb(x: number, z: number, box: Box, dyaw: number): Box {
    const pts = this.corners(x, z, box, dyaw), xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  }
  fits(x: number, z: number, box: Box, dyaw = 0, gap = .2) {
    const pts = this.corners(x, z, box, dyaw);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [px, pz] of pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
    if (!this.boxes.every(([a0, a1, b0, b1]) => x1 + gap <= a0 || a1 + gap <= x0 || z1 + gap <= b0 || b1 + gap <= z0)) return false;
    if (!this.circles.every(([cx, cz, r]) => Math.hypot(Math.max(0, x0 - cx, cx - x1), Math.max(0, z0 - cz, cz - z1)) >= r + gap)) return false;
    return pts.every(([px, pz]) => this.edges.every(([ax, az, nx, nz]) => (px - ax) * nx + (pz - az) * nz >= this.margin));
  }
  block(x: number, z: number, box: Box, dyaw = 0) { this.boxes.push(this.aabb(x, z, box, dyaw)); }
  /** Tries the planned spot, then spots pulled along the ray towards `towards` (default: the centre) down to `minT`; blocks and returns the first fit. */
  place(x: number, z: number, box: Box, dyaw = 0, towards: XZ = [0, 0], minT = 0, gap = .2): XZ | undefined {
    for (let i = 0; i <= 20; i++) {
      const t = 1 - i * .05;
      if (t < minT - 1e-9) break;
      const px = towards[0] + (x - towards[0]) * t, pz = towards[1] + (z - towards[1]) * t;
      if (this.fits(px, pz, box, dyaw, gap)) { this.block(px, pz, box, dyaw); return [px, pz]; }
    }
    return undefined;
  }
}
const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const BENCH_BOX: Box = [-.9, .9, -.3, .25];

export type SquareCentrepiece = "fountain" | "statue" | "market-cross" | "well" | "tree";
/** A square's seeded composition: what stands in the middle and which programme surrounds it. */
export type SquareProgram = {
  /** City-sized (>= 24 x 18 m) squares lean civic (fountain, statue); smaller village squares lean rustic (well, big tree, market cross). */
  civic: boolean;
  centre: SquareCentrepiece;
  /** Statue only: a stone obelisk instead of a bronze figure. */
  obelisk: boolean;
  /** Café decks on the café side: none, one (front or rear half) or two. */
  decks: 0 | 1 | 2;
  deckSide: -1 | 1;
  cafeSide: -1 | 1;
  /** Market stalls along the rear edge (0 or 2-4); only on squares without two café decks. */
  stalls: number;
  trees: "corners" | "ring" | "avenue" | "none";
  greenery: "planters" | "beds";
  lamps: 0 | 2 | 4;
  benchRing: boolean;
  ringPaving: boolean;
  /** Crates, sacks and a barrel (squares without stalls). */
  cart: boolean;
  /** Centrepiece set back towards the rear (squares without stalls). */
  setBack: boolean;
};
function weighted<T>(r: Rand, entries: readonly (readonly [T, number])[]): T {
  let roll = r() * entries.reduce((sum, entry) => sum + entry[1], 0);
  for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
  return entries[entries.length - 1][0];
}
/** Pure, deterministic square plan from the feature variant, size and outline (the geometry may still skip what does not fit). */
export function squareProgramFor(variant: number, w: number, d: number, shape: unknown): SquareProgram {
  const r = seeded(variant ^ 0x50a7e), civic = w >= 24 && d >= 18, kind = parkShapeOf(shape),
    centre = weighted<SquareCentrepiece>(r, civic
      ? [["fountain", 4], ["statue", 4], ["market-cross", 1], ["well", .6], ["tree", 1.2]]
      : [["well", 4], ["tree", 3], ["market-cross", 3], ["fountain", 1.2], ["statue", .6]]),
    obelisk = r() < .4, decks = weighted<0 | 1 | 2>(r, civic ? [[0, 1], [1, 2], [2, 3]] : [[0, 2], [1, 3], [2, 1]]),
    deckSide: -1 | 1 = r() < .5 ? -1 : 1, cafeSide: -1 | 1 = r() < .5 ? -1 : 1,
    stallChance = decks === 2 ? 0 : centre === "market-cross" ? .85 : decks === 0 ? .7 : .4,
    stalls = r() < stallChance ? 2 + Math.floor(r() * 3) : 0,
    trees = centre === "tree" ? "none" : weighted<SquareProgram["trees"]>(r, [["corners", 3], ["ring", kind === "round" || kind === "octagon" ? 3 : 1.5], ["avenue", kind === "rect" ? 2.5 : 1.5]]),
    greenery: SquareProgram["greenery"] = r() < .5 ? "planters" : "beds",
    lamps = weighted<0 | 2 | 4>(r, civic ? [[0, 1], [2, 2], [4, 3]] : [[0, 3], [2, 3], [4, 1]]),
    benchRing = centre !== "tree" && r() < (centre === "fountain" || centre === "statue" ? .9 : .6),
    ringPaving = r() < (civic ? .7 : .35), cart = stalls === 0 && r() < .65, setBack = stalls === 0 && r() < .33;
  return { civic, centre, obelisk, decks, deckSide, cafeSide, stalls, trees, greenery, lamps, benchRing, ringPaving, cart, setBack };
}
const LAMP_BOX: Box = [-.38, .38, -.3, .3];

/**
 * Town-centre plaza: paved pad (structures) and a seeded composition (squareProgramFor): a centrepiece (fountain, statue,
 * market cross, roofed well or big seat tree), café decks, a row of market stalls, a bench ring, lamp posts, shade trees
 * (corners, a ring or an avenue), corner planters or flower beds and a market cart. Every prop takes its planned spot or
 * a spot pulled towards the middle, or is skipped, so it stays inside the outline and off its neighbours.
 */
function addSquare(ground: Frame, f: Frame, w: number, d: number, variant: number, close: boolean, shape: ParkShape) {
  // Darker kerb band: the full outline at .06 under the lighter cobbled field inset by the band at .07 (never coplanar).
  const outline = parkOutline(shape, w, d), band = .6;
  padSlab(ground, outline, -.25, .06, color(150, 132, 102));
  padSlab(ground, insetOutline(outline, band), 0, .07, color(178, 161, 128));
  if (!close) return;
  const plan = squareProgramFor(variant, w, d, shape), p = sub(f, 0, 0, 0, .08), r = seeded(variant ^ 0x5a17), layout = new ParkLayout(outline),
    span = Math.min(w, d), big = w >= 28 && d >= 20, cafeSide = plan.cafeSide;
  // Café terraces on one side: two-table decks (two rows on a big square), shrunk to one table or skipped where there is no room.
  let deckInner = cafeSide * w / 2;
  for (const side of plan.decks === 2 ? [-1, 1] : plan.decks === 1 ? [plan.deckSide] : []) {
    for (const tables of big ? [2] : [2, 1]) {
      const dx = big ? 1.6 : 1.5, deckW = tables === 2 ? dx * 2 + 2.6 : 2.8, deckD = big ? 5.6 : 2.6, cz = side * Math.max(d * .24, deckD / 2 + 1),
        cx = cafeSide * (w / 2 - deckW / 2 - (big ? 1.7 : .5)), box: Box = [-deckW / 2, deckW / 2, -deckD / 2, deckD / 2],
        spot = layout.place(cx, cz, box, 0, [0, cz], .45);
      if (!spot) continue;
      deckInner = cafeSide > 0 ? Math.min(deckInner, spot[0] - deckW / 2) : Math.max(deckInner, spot[0] + deckW / 2);
      const deck = sub(p, spot[0], spot[1], 0, .06), xs = tables === 2 ? [-dx, dx] : [0], rows = big ? [-1.5, 1.5] : [0];
      cuboid(p, spot[0], 0, spot[1], deckW, .06, deckD, DECK);
      for (const tx of xs) for (const tz of rows) addTableSet(deck, tx, tz, 2 + Math.floor(r() * 3), r, { umbrellaR: 1.15, theta0: big ? Math.PI / 4 : Math.PI / 2 });
      break;
    }
  }
  const free = (-cafeSide * w / 2 + deckInner) / 2;
  // Market stalls in a row along the rear edge, counters towards the square, grouped around the middle of the free band.
  if (plan.stalls) {
    const stallW = plan.civic ? 2.5 : 2.2, pitch = stallW + .5, slots = Math.max(1, Math.floor((w - 3) / pitch)), z = -d / 2 + 1.3,
      box: Box = [-stallW / 2 - .05, stallW / 2 + .05, -.85, 1.35];
    const xs = Array.from({ length: slots }, (_, k) => (k - (slots - 1) / 2) * pitch).sort((a, b) => Math.abs(a - free) - Math.abs(b - free));
    let placed = 0;
    for (const x of xs) {
      if (placed >= plan.stalls) break;
      const spot = layout.place(x, z, box, 0, [x, 0], .8);
      if (!spot) continue;
      addStall(p, spot[0], spot[1], 0, stallW, r);
      addCrate(p, spot[0] - stallW / 2 + .35, 0, spot[1] + 1.05, .2 * (r() - .5), pick(r, PRODUCE));
      placed++;
    }
  }
  // Centrepiece in the middle of the free band (centred, set back or, with stalls, a little forward); the bench ring
  // takes the room it has (benches = ring circumference / seeded pitch), or is dropped on a cramped square.
  const room = (x: number, z: number) => Math.min(clearance(outline, x, z) - .7, ...layout.boxes.map(([x0, x1, z0, z1]) => Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, z0 - z, z - z1)) - .55)),
    candidates: XZ[] = plan.stalls ? [[free, d * .06], [free, 0], [free * .5, d * .06], [0, d * .04]]
      : [[free, plan.setBack ? -d * .14 : -d * .04], [free, 0], [free * .5, plan.setBack ? -d * .1 : 0], [0, 0]],
    statueS = clampTo(span * .045, .85, 1.25);
  let radius = clampTo(span * .09 + .3, 1.4, 2.5);
  const core = { fountain: radius + .4, statue: 1.5 * statueS * Math.SQRT2 * .85, "market-cross": 1.7, well: 1.25, tree: 3 }[plan.centre];
  const [fx, fz] = candidates.find(([x, z]) => room(x, z) >= core + 1.1) ?? candidates.reduce((a, b) => room(b[0], b[1]) > room(a[0], a[1]) ? b : a);
  const here = room(fx, fz), ringR = Math.min(core + (big ? 3 : 2), here), benchRing = plan.benchRing && ringR >= core + 1.1;
  let footprint = core;
  if (plan.centre === "fountain") { radius = Math.min(radius, Math.max(1, here + .3)); footprint = radius + .4; }
  if (benchRing && plan.ringPaving && clearance(outline, fx, fz) >= ringR + 1.3) disc(p, fx, .005, fz, ringR + 1.1, 14, color(128, 112, 86));
  if (plan.centre === "fountain") addFountain(p, fx, fz, radius);
  else if (plan.centre === "statue") addStatue(p, fx, fz, statueS, plan.obelisk);
  else if (plan.centre === "market-cross") addMarketCross(p, fx, fz);
  else if (plan.centre === "well") addWell(p, fx, fz);
  else { footprint = clampTo(here + .5, 2, 3); addSeatTree(p, fx, fz, footprint); }
  if (benchRing) {
    const pitch = 3.4 + ((variant >>> 1) % 3) * .8, benches = clampTo(Math.floor(Math.PI * 2 * ringR / pitch), 3, 8);
    for (let k = 0; k < benches; k++) {
      const angle = Math.PI / benches + k * Math.PI * 2 / benches, bx = fx + Math.sin(angle) * ringR, bz = fz + Math.cos(angle) * ringR;
      if (layout.fits(bx, bz, BENCH_BOX, angle + Math.PI)) addBench(p, bx, bz, angle + Math.PI);
    }
  }
  // Without a ring, a pair of benches on the rear diagonals faces the centrepiece (the seat tree has its own round bench).
  if (!benchRing && plan.centre !== "tree") for (const side of [-1, 1]) {
    const angle = side * Math.PI * .75, br = footprint + 1.5, bx = fx + Math.sin(angle) * br, bz = fz + Math.cos(angle) * br;
    if (layout.fits(bx, bz, BENCH_BOX, angle + Math.PI)) { addBench(p, bx, bz, angle + Math.PI); layout.block(bx, bz, BENCH_BOX, angle + Math.PI); }
  }
  layout.circles.push([fx, fz, benchRing ? ringR + .5 : footprint + .3]);
  // Lamp posts just outside the ring: on the diagonals (two flank the approach from the street), or on the axes between
  // the trees of a tree ring.
  const base = benchRing ? ringR + .5 : footprint + .3;
  if (plan.lamps) {
    const lr = base + .65, axes = plan.trees === "ring";
    for (let k = 0; k < plan.lamps; k++) {
      const angle = (axes ? 0 : Math.PI / 4) + (plan.lamps === 4 ? k * Math.PI / 2 : axes ? (k ? -1 : 1) * Math.PI / 2 : (k ? -2 : 0) * Math.PI / 4),
        lx = fx + Math.sin(angle) * lr, lz = fz + Math.cos(angle) * lr;
      if (layout.fits(lx, lz, LAMP_BOX, 0, .1)) { layout.block(lx, lz, LAMP_BOX); addLampPost(p, lx, lz, angle); }
    }
  }
  // Shade trees: near the four quarter points (two or three on a smaller square), a ring about the centrepiece, or an avenue
  // along the rear edge (the side edge opposite the cafés when stalls hold the rear). Each fits or is skipped.
  // A tree ring is all four trees on the diagonals or none (then the quarter-point trees).
  const ringTree = 1.4, ringSpots: XZ[] = [], ringDist = base + ringTree * Math.SQRT2 + 1.1;
  for (let k = 0; k < 4; k++) { const angle = Math.PI / 4 + k * Math.PI / 2; ringSpots.push([fx + Math.sin(angle) * ringDist, fz + Math.cos(angle) * ringDist]); }
  const ringFits = plan.trees === "ring" && ringSpots.every(([x, z], k) => layout.fits(x, z, [-ringTree, ringTree, -ringTree, ringTree], 0, 0)
    && ringSpots.slice(0, k).every(([qx, qz]) => Math.max(Math.abs(qx - x), Math.abs(qz - z)) >= 2 * ringTree)),
    trees = plan.trees === "ring" && !ringFits ? "corners" : plan.trees;
  if (trees === "corners") {
    const crown = 1.8, treeBox: Box = [-crown, crown, -crown, crown],
      spots = big ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : variant & 16 && w >= 24 ? [[-cafeSide, 1], [-cafeSide, -1], [cafeSide, -1]] : [[-cafeSide, 1], [-cafeSide, -1]];
    // With a stall row along the rear, only the front-half trees are planted, so none hides the stalls.
    for (const [sx, sz] of spots.filter(([, sz]) => !plan.stalls || sz > 0)) {
      const grid: [number, number, number][] = [];
      for (let x = -Math.floor(w / 2); x <= w / 2; x++) for (let z = sz > 0 ? 0 : -Math.floor(d / 2); z <= (sz > 0 ? d / 2 : 0); z++) grid.push([Math.hypot(x - sx * w * .3, z - sz * d * .3), x, z]);
      grid.sort((a, b) => a[0] - b[0]);
      const hit = grid.find(([, x, z]) => layout.fits(x, z, treeBox, 0, 0));
      if (!hit) continue;
      layout.circles.push([hit[1], hit[2], crown]);
      addShadeTree(p, hit[1], hit[2], crown);
    }
  } else if (trees !== "none") {
    const crown = ringTree, treeBox: Box = [-crown, crown, -crown, crown], spots: XZ[] = trees === "ring" ? ringSpots : [];
    if (trees === "avenue" && plan.stalls) {
      for (let z = -d / 2 + 2.6; z <= d / 2 - 2.6; z += 4.4) spots.push([-cafeSide * (w / 2 - 2.1), z]);
    } else if (trees === "avenue") {
      const n = Math.max(2, Math.floor((w - 4) / 4.6) + 1);
      for (let k = 0; k < n; k++) spots.push([(k - (n - 1) / 2) * (w - 4) / Math.max(1, n - 1), -d / 2 + 2.1]);
    }
    for (const [x, z] of spots) {
      if (!layout.fits(x, z, treeBox, 0, 0)) continue;
      layout.circles.push([x, z, crown]);
      addShadeTree(p, x, z, crown);
    }
  }
  // Corner planters (turned along the chamfer/curve on a shaped square) or round flower beds, pulled in until they fit.
  const planterW = big ? 2.2 : 1.4, planterD = big ? 1 : .7, bedR = big ? 1.1 : .85;
  let corner = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (plan.greenery === "planters") {
      const dyaw = shape === "rect" ? 0 : Math.atan2(sz, sx), spot = layout.place(sx * (w / 2 - 1.6), sz * (d / 2 - 1.2), [-planterW / 2, planterW / 2, -planterD / 2, planterD / 2], dyaw, [0, 0], .6);
      if (spot) addPlanter(p, spot[0], spot[1], dyaw, variant * 4 + corner, planterW, planterD);
    } else {
      const spot = layout.place(sx * (w / 2 - 1.7), sz * (d / 2 - 1.5), [-bedR, bedR, -bedR, bedR], 0, [0, 0], .6);
      if (spot) addRoundBed(p, spot[0], spot[1], bedR, r, false);
    }
    corner++;
  }
  // Market cart: crates, sacks and a barrel at the first free spot of a seeded order of rear/front spots (skipped if none fits).
  if (plan.cart) {
    const crateSpots: XZ[] = [[-cafeSide * w * .32, -d * .34], [0, -d * .36], [cafeSide * w * .3, -d * .38], [-cafeSide * w * .32, d * .34]],
      crateStart = Math.floor(r() * 2);
    let crateSpot: XZ | undefined;
    for (let k = 0; k < crateSpots.length && !crateSpot; k++) { const [cx, cz] = crateSpots[(k + crateStart) % crateSpots.length]; crateSpot = layout.place(cx, cz, [-.9, 1.5, -.95, .8], .3, [0, 0], .7); }
    if (crateSpot) {
      const crates = sub(p, crateSpot[0], crateSpot[1], .3);
      for (const [x, y, z] of [[0, 0, 0], [.56, 0, .06], [.08, 0, .5], [.3, .3, .22], [-.62, 0, .32]]) addCrate(crates, x, y, z, 0, pick(r, PRODUCE));
      addSack(crates, 1.05, 0, -.25); addSack(crates, 1.2, 0, .35);
      addBarrel(crates, -.55, 0, -.6);
    }
  }
}
/** Fenced playground: swing set and sandbox always; a large one adds a slide and a see-saw; parents' benches and a shade tree. */
function addPlayground(ground: Frame, f: Frame, w: number, d: number, variant: number, close: boolean, shape: ParkShape) {
  const outline = parkOutline(shape, w, d);
  padSlab(ground, outline, -.25, .05, color(176, 146, 100));
  if (!close) return;
  // The fence follows the outline .15 m inside it (every other vertex of a round outline: half the posts, still inside).
  const fence = insetOutline(shape === "round" ? outline.filter((_, k) => k % 2 === 0) : outline, .15), layout = new ParkLayout(fence),
    p = sub(f, 0, 0, 0, .05), r = seeded(variant ^ 0x9a7e), large = w >= 14 && d >= 11, mirror = variant & 2 ? -1 : 1,
    paint = pick(r, [color(196, 58, 44), color(52, 104, 168), color(226, 184, 52), color(70, 140, 80)]);
  for (const run of outlineRuns(fence, 2.4)) fenceRun(p, run.a[0], run.a[1], run.b[0], run.b[1], run.start < 0);
  // Swing set: two A-frames, top bar, two seats on chains.
  const swingAt = layout.place(-mirror * w * .22, -d * .2, [-1.85, 1.85, -1, 1]);
  if (swingAt) {
    const swing = sub(p, swingAt[0], swingAt[1]);
    for (const side of [-1.7, 1.7]) for (const leg of [-.9, .9]) beam(p.b, pt(swing, side, 0, leg), pt(swing, side, 2.2, 0), .1, .1, DARK_WOOD);
    beam(p.b, pt(swing, -1.75, 2.2, 0), pt(swing, 1.75, 2.2, 0), .12, .12, DARK_WOOD);
    for (const seat of [-.75, .75]) {
      for (const chain of [-.2, .2]) beam(p.b, pt(swing, seat + chain, 2.15, 0), pt(swing, seat + chain, .5, 0), .025, .025, IRON);
      cuboid(swing, seat, .45, 0, .48, .05, .2, paint);
    }
  }
  // Slide: ladder up to a 1.5 m platform, chute down towards the front.
  const slideAt = large ? layout.place(mirror * w * .25, -d * .2, [-.5, .5, -1.25, 2.65]) : undefined;
  if (slideAt) {
    const slide = sub(p, slideAt[0], slideAt[1]);
    cuboid(slide, 0, 1.42, 0, .9, .08, .9, WOOD);
    for (const x of [-.4, .4]) for (const z of [-.4, .4]) prism(slide, x, 0, z, .05, 1.42, 4, DARK_WOOD, false);
    for (const x of [-.3, .3]) beam(p.b, pt(slide, x, 0, -1.15), pt(slide, x, 1.5, -.45), .06, .06, DARK_WOOD);
    for (const t of [.25, .5, .75]) cuboid(slide, 0, 1.5 * t - .02, -1.15 + .7 * t, .6, .04, .05, WOOD);
    beam(p.b, pt(slide, 0, 1.47, .45), pt(slide, 0, .2, 2.6), .5, .05, paint);
    for (const x of [-.26, .26]) beam(p.b, pt(slide, x, 1.6, .45), pt(slide, x, .33, 2.6), .04, .12, paint);
  }
  // Sandbox (always) and see-saw (large playgrounds).
  const sandAt = layout.place(-mirror * w * .25, d * .2, [-1.25, 1.25, -1.25, 1.25]);
  if (sandAt) {
    const sandbox = sub(p, sandAt[0], sandAt[1]);
    for (const [x, z, bw, bd] of [[0, -1.14, 2.4, .12], [0, 1.14, 2.4, .12], [-1.14, 0, .12, 2.16], [1.14, 0, .12, 2.16]]) cuboid(sandbox, x, 0, z, bw, .3, bd, WOOD);
    polygon(p.b, [pt(sandbox, -1.08, .2, -1.08), pt(sandbox, 1.08, .2, -1.08), pt(sandbox, 1.08, .2, 1.08), pt(sandbox, -1.08, .2, 1.08)], pt(sandbox, 0, -1, 0), SAND);
  }
  const sawAt = large ? layout.place(mirror * w * .21, d * .21, [-1.75, 1.75, -.25, .25]) : undefined;
  if (sawAt) {
    const seesaw = sub(p, sawAt[0], sawAt[1]);
    cuboid(seesaw, 0, 0, 0, .3, .45, .3, DARK_WOOD);
    beam(p.b, pt(seesaw, -1.6, .2, 0), pt(seesaw, 1.6, .7, 0), .3, .06, paint);
    for (const [x, y] of [[-1.3, .25], [1.3, .66]]) cuboid(seesaw, x, y, 0, .05, .3, .26, IRON);
  }
  // Parents' benches on the side edges facing in (one on a small playground), and a shade tree by the entrance.
  for (const side of large ? [-1, 1] : [mirror]) {
    const dyaw = side * -Math.PI / 2, spot = layout.place(side * (w / 2 - .75), 0, BENCH_BOX, dyaw);
    if (spot) addBench(p, spot[0], spot[1], dyaw);
  }
  // The tree's trunk stays >= 1.3 m inside the fence (box 1.0 + layout margin .3), so its .8 m crown never reaches the fence
  // line: the free .5 m grid point nearest a seeded front corner, keeping the entrance approach (|x| < 2 in the front half) clear.
  const treeBox: Box = [-1, 1, -1, 1], grid: [number, number, number][] = [];
  for (let x = -Math.floor(w); x <= w; x++) for (let z = -Math.floor(d); z <= d; z++) {
    const gx = x / 2, gz = z / 2;
    if (Math.abs(gx) < w / 2 && Math.abs(gz) < d / 2 && !(Math.abs(gx) < 2 && gz > 0)) grid.push([Math.hypot(gx - mirror * (w / 2 - 1.5), gz - (d / 2 - 1.5)), gx, gz]);
  }
  grid.sort((a, b) => a[0] - b[0]);
  const treeAt = grid.find(([, x, z]) => layout.fits(x, z, treeBox));
  if (treeAt) { layout.block(treeAt[1], treeAt[2], treeBox); addTree(p, treeAt[1], treeAt[2], 1.3); }
}
/**
 * Round flower bed: stone-rimmed soil disc with seeded clumps in two or three colours. Dense beds (gardens) of radius >= .75 m
 * carry 13 clumps (ring of 8, inner ring of 4, centre); smaller or sparse beds a ring of 6 and a centre clump.
 */
function addRoundBed(f: Frame, lx: number, lz: number, radius: number, r: Rand, dense = true) {
  prism(f, lx, 0, lz, radius, .2, 8, PALE_STONE, true, SOIL);
  const a = pick(r, FLOWERS), b = pick(r, FLOWERS), c = pick(r, FLOWERS), full = dense && radius >= .75,
    rings: [number, number, RGB][] = full ? [[8, .68, a], [4, .3, b]] : [[6, .58, a]];
  rings.forEach(([count, at, tint], ring) => {
    for (let i = 0; i < count; i++) {
      const angle = (i + ring * .5) * Math.PI * 2 / count;
      addFlowerClump(f, lx + Math.sin(angle) * radius * at, .16, lz + Math.cos(angle) * radius * at, i % 2 && !full ? b : tint, full ? 1 : 1.1);
    }
  });
  addFlowerClump(f, lx, .16, lz, c, 1.25);
}
/** Gravel paths of a flower garden: the main path runs from the street entrance to `rearEnd`, the cross path (wider gardens) stops short of the side hedges. */
function gardenPaths(shape: ParkShape, w: number, d: number) {
  const outline = parkOutline(shape, w, d), hd = d / 2, narrow = d <= 7 || w >= d * 1.7, rearEnd = -hd + (narrow ? 1.3 : 1.5);
  return {
    outline, narrow, rearEnd,
    main: clipToOutline(rectOutline(-GARDEN_PATH, GARDEN_PATH, rearEnd, hd), insetOutline(outline, .1)),
    cross: narrow ? [] : clipToOutline(rectOutline(-w / 2, w / 2, -.5, .5), insetOutline(outline, 1.05)),
  };
}
/** Half-width of a garden's main path; the hedge entrance is GARDEN_GAP wide, centred on the path. */
const GARDEN_PATH = .6, GARDEN_GAP = 2.4;
/**
 * Flower garden: lawn and gravel paths clipped to the outline (structures), a hedge along the outline with the street entrance
 * where the main path meets it, and a seeded bed layout: four quadrant beds, a ring of round beds around a centre bed
 * (round/octagon gardens), or two long beds beside a single path (narrow gardens). Benches face the paths across them (seat
 * towards +z/-z, so they read from an oblique camera) and one closes the main path's far end; topiary trees where they fit.
 */
function addFlowerGarden(ground: Frame, f: Frame, w: number, d: number, variant: number, close: boolean, shape: ParkShape) {
  const { outline, narrow, rearEnd, main, cross } = gardenPaths(shape, w, d), hw = w / 2, hd = d / 2, gravel = color(190, 178, 150),
    ring = !narrow && (shape === "round" || shape === "octagon" || (variant >>> 2) % 3 === 0);
  padSlab(ground, outline, -.25, .05, color(98, 138, 66));
  padSlab(ground, main, -.2, .09, gravel);
  padSlab(ground, cross, -.2, .08, gravel);
  if (!close) return;
  const p = sub(f, 0, 0, 0, .05), r = seeded(variant ^ 0xf10e), hedge = color(58, 102, 52), centre = insetOutline(outline, .25),
    layout = new ParkLayout(insetOutline(outline, .5));
  // Hedge boxes along the outline (.5 m thick, outer face on the outline), each stretched to close its corners; the entrance
  // gap is centred on the main path (x = 0) where it meets the street-side outline.
  const n = centre.length, dir = (i: number): XZ => { const a = centre[(i + n) % n], b = centre[(i + 1 + n) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; },
    stretch = (i: number) => { const u = dir(i - 1), v = dir(i), turn = Math.acos(clampTo(u[0] * v[0] + u[1] * v[1], -1, 1)); return .25 * Math.tan(turn / 2); };
  for (const run of outlineRuns(centre, GARDEN_GAP)) {
    const l0 = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]), u: XZ = [(run.b[0] - run.a[0]) / l0, (run.b[1] - run.a[1]) / l0],
      e0 = run.start >= 0 ? stretch(run.start) : 0, e1 = run.end >= 0 ? stretch(run.end) : 0,
      a: XZ = [run.a[0] - u[0] * e0, run.a[1] - u[1] * e0], b: XZ = [run.b[0] + u[0] * e1, run.b[1] + u[1] * e1];
    cuboid(sub(p, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[0] - a[0], b[1] - a[1])), 0, 0, 0, .5, .6, l0 + e0 + e1, hedge);
  }
  // A bench closes the main path's far end, facing down it towards the entrance.
  const endBench = layout.place(0, rearEnd - .1, BENCH_BOX, 0, [0, 0], .5);
  if (endBench) addBench(p, endBench[0], endBench[1], 0);
  // Narrow gardens: two benches flanking the path near the entrance, backs to the beds. Others: two benches on the far
  // side of the cross path, seats facing it.
  let benchBack = hd;
  for (const side of [-1, 1]) {
    if (narrow) {
      const spot = layout.place(side * 2.05, hd - 1.45, BENCH_BOX, 0, [side * 2.05, 0], .3);
      if (spot) { addBench(p, spot[0], spot[1], 0); benchBack = Math.min(benchBack, spot[1] - .3); }
      continue;
    }
    // Planned spot (pulled towards the path), else further out, else facing the path from its street side.
    let spot: XZ | undefined = layout.place(side * Math.max(2.1, hw * .5), -.86, BENCH_BOX, 0, [side * 1.2, -.86], .5), dyaw = 0;
    for (const [x, z, turn] of [[side * (hw - 1.5), -.86, 0], [side * Math.max(2.1, hw * .5), .86, Math.PI], [side * (hw - 1.5), .86, Math.PI]]) {
      if (spot) break;
      if (layout.fits(x, z, BENCH_BOX, turn)) { layout.block(x, z, BENCH_BOX, turn); spot = [x, z]; dyaw = turn; }
    }
    if (!spot) continue;
    addBench(p, spot[0], spot[1], dyaw);
    if (!dyaw) benchBack = Math.min(benchBack, spot[1] - .3);
  }
  // The paths keep beds and trees off them.
  for (const path of [main, cross]) if (path.length) {
    const xs = path.map((q) => q[0]), zs = path.map((q) => q[1]);
    layout.boxes.push([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]);
  }
  // Topiary trees: the two rear corners, or flanking the entrance on some gardens (pulled in until they fit, else skipped).
  const front = variant & 1 && !narrow, plantTrees = () => {
    for (const side of [-1, 1]) {
      const spot = (front ? layout.place(side * 1.9, hd - 1.05, [-.65, .65, -.65, .65], 0, [side * 1.9, 0], .5, .1) : undefined)
        ?? layout.place(side * (hw - 1.05), -(hd - 1.05), [-.65, .65, -.65, .65], 0, [0, 0], .5, .1);
      if (spot) addTree(p, spot[0], spot[1], 1, color(64, 112, 58));
    }
  };
  /**
   * A rectangular bed planned between (ix, iz) (inner corner) and (ox, oz), shrunk towards its inner corner (x, z, then both)
   * until it fits; planted on a ~.55 m grid (at least 3 x 2, at most 24 clumps) in two or three seeded colours, in rows or mixed.
   */
  const rectBed = (ix: number, iz: number, ox: number, oz: number) => {
    for (let k = 0; k < 36; k++) {
      const s = 1 - Math.floor(k / 3) * .05, sx = k % 3 === 1 ? 1 : s, sz = k % 3 === 0 ? 1 : s,
        x0 = Math.min(ix, ix + (ox - ix) * sx), x1 = Math.max(ix, ix + (ox - ix) * sx), z0 = Math.min(iz, iz + (oz - iz) * sz), z1 = Math.max(iz, iz + (oz - iz) * sz),
        bw = x1 - x0, bd = z1 - z0, box: Box = [-bw / 2, bw / 2, -bd / 2, bd / 2];
      if (bw < .8 || bd < .6) continue;
      if (!layout.fits((x0 + x1) / 2, (z0 + z1) / 2, box, 0, .1)) continue;
      layout.block((x0 + x1) / 2, (z0 + z1) / 2, box);
      const bed = sub(p, (x0 + x1) / 2, (z0 + z1) / 2), tints = [pick(r, FLOWERS), pick(r, FLOWERS), pick(r, FLOWERS)], rowsByColour = r() < .5;
      let cols = clampTo(Math.round(bw / .55), 3, 8), rows = clampTo(Math.round(bd / .55), 2, 4);
      while (cols * rows > 24) cols--;
      if (bd < .9) rows = 2;
      cuboid(bed, 0, 0, 0, bw, .14, bd, SOIL);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const jx = (r() - .5) * .1, jz = (r() - .5) * .1, tint = tints[(rowsByColour ? j : i + j) % 3];
        addFlowerClump(bed, -bw / 2 + (i + .5) * bw / cols + jx, .1, -bd / 2 + (j + .5) * bd / rows + jz, tint, Math.min(1.1, .45 * Math.min(bw / cols, bd / rows) / .2 + .2));
      }
      return;
    }
  };
  if (narrow) {
    // Two long beds either side of the single path, behind the entrance benches.
    for (const sx of [-1, 1]) rectBed(sx * 1.0, Math.min(hd - 2.85, benchBack - .15), sx * (hw - .9), -(hd - .9));
    plantTrees();
  } else if (ring) {
    // A centre bed on the crossing and round beds on the diagonals, shrunk until they fit.
    // Seeded: a larger or smaller centre bed and a tighter or wider ring.
    const rc = clampTo(Math.min(w, d) * .1 + .2 + ((variant >>> 3) & 1) * .25, .9, 1.6), spread = .4 + ((variant >>> 4) % 3) * .07;
    addRoundBed(p, 0, 0, rc, r);
    layout.block(0, 0, [-rc, rc, -rc, rc]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let rb = clampTo(Math.min(w, d) * .09, .8, 1.1); rb >= .45; rb -= .05) {
        // Rear beds stay behind the cross-path benches (their backs at z -1.16).
        const bx = sx * Math.max(rb + rc - .1, hw * spread), bz = sz * Math.max(rb + (sz < 0 ? 1.3 : .7), hd * (spread + .05)), box: Box = [-rb, rb, -rb, rb];
        if (!layout.fits(bx, bz, box, 0, .1)) continue;
        layout.block(bx, bz, box);
        addRoundBed(p, bx, bz, rb, r);
        break;
      }
    }
    plantTrees();
  } else {
    // Four quadrant beds: the front pair between the paths, the rear pair behind the cross-path benches.
    plantTrees();
    for (const sx of [-1, 1]) {
      rectBed(sx * .8, .7, sx * (hw - .9), hd - .9);
      rectBed(sx * 1.0, Math.min(-.7, benchBack - .15), sx * (hw - .9), -(hd - .9));
    }
    prism(p, 0, 0, 0, .95, .2, 8, PALE_STONE, true, SOIL);
    for (let i = 0; i < 6; i++) { const angle = i * Math.PI / 3; addFlowerClump(p, Math.sin(angle) * .56, .16, Math.cos(angle) * .56, pick(r, FLOWERS), 1); }
    addFlowerClump(p, 0, .16, 0, pick(r, FLOWERS), 1.25);
  }
}
/** Lively bazaar on the market platform: two stall rows facing a central aisle, crates, barrels, sacks, two table clusters. */
function addBazaar(f: Frame, w: number, d: number, variant: number) {
  const p = sub(f, 0, 0, 0, .18), r = seeded(variant ^ 0xba2a), big = w >= 24, stallW = big ? 2.6 : 2.2, pitch = big ? 3.3 : 2.8,
    count = Math.max(1, Math.floor((w - 2) / pitch));
  // Paving on the platform (top .18): seeded flag patches at .182, a lighter border and aisle at .186, and a 2 m grid of
  // darker joints at .19 inside the border; flat, upward, never coplanar; ~70 triangles.
  const slab = (x0: number, x1: number, z0: number, z1: number, y: number, tint: RGB) =>
    polygon(f.b, [pt(f, x0, y, z0), pt(f, x1, y, z0), pt(f, x1, y, z1), pt(f, x0, y, z1)], pt(f, (x0 + x1) / 2, y - 1, (z0 + z1) / 2), tint);
  const hw = w / 2 - .05, hd = d / 2 - .05, rim = .55, cell = 2, nx = Math.floor((w - 2 * rim) / cell), nz = Math.floor((d - 2 * rim) / cell),
    gx = (w - 2 * rim - nx * cell) / 2 - hw + rim, gz = (d - 2 * rim - nz * cell) / 2 - hd + rim, used = new Set<number>();
  for (let k = 0; k < 8; k++) {
    const i = Math.floor(r() * nx), j = Math.floor(r() * nz);
    if (used.has(i * 97 + j)) continue;
    used.add(i * 97 + j);
    slab(gx + i * cell, gx + (i + 1) * cell, gz + j * cell, gz + (j + 1) * cell, .182, r() < .5 ? color(144, 123, 77) : color(164, 142, 94));
  }
  const light = color(170, 150, 104), joint = color(122, 104, 66);
  slab(-hw, hw, hd - rim, hd, .186, light); slab(-hw, hw, -hd, -hd + rim, .186, light);
  slab(-hw, -hw + rim, -hd + rim, hd - rim, .186, light); slab(hw - rim, hw, -hd + rim, hd - rim, .186, light);
  slab(-hw + rim, hw - rim, -.33 * d + 1.45, .1 * d - 1.45, .186, color(162, 141, 95));
  for (let i = 0; i <= nx; i++) { const x = gx + i * cell; slab(x - .04, x + .04, -hd + rim, hd - rim, .19, joint); }
  for (let j = 0; j <= nz; j++) { const z = gz + j * cell; slab(-hw + rim, hw - rim, z - .04, z + .04, .19, joint); }
  for (const [rowZ, dyaw] of [[-.33 * d, 0], [.1 * d, Math.PI]] as const) {
    const row = sub(p, 0, rowZ, dyaw);
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * pitch;
      addStall(row, x, 0, 0, stallW, r);
      addCrate(row, x - stallW / 2 + .35, 0, 1.05, .2 * (r() - .5), pick(r, PRODUCE));
    }
  }
  for (const side of [-1, 1]) {
    addBarrel(p, side * (w / 2 - .6), 0, -.33 * d);
    addBarrel(p, side * (w / 2 - .6), 0, -.33 * d + .75);
    addSack(p, side * (w / 2 - .7), 0, .1 * d);
    addSack(p, side * (w / 2 - .7), 0, .1 * d + .55);
    addTableSet(p, side * w * .18, d * .3, 3, r, { theta0: 0 });
  }
}
/** Inn front terrace in the setback (local z depth/2+0.6 .. depth/2+4.5), door path |x| < 1.4 kept clear. */
function addInnTerrace(f: Frame, w: number, d: number, variant: number) {
  const r = seeded(variant ^ 0x1aa), cz = d / 2 + 2.45, wide = w >= 15, xs = wide ? [-5.6, -2.8, 2.8, 5.6] : [-5.3, -2.8, 2.8];
  for (const side of [-1, 1]) {
    const inner = 1.6, outer = Math.max(inner + 2, w / 2 - .2);
    cuboid(f, side * (inner + outer) / 2, 0, cz, outer - inner, .08, 3.6, DECK);
  }
  const deck = sub(f, 0, 0, 0, .08);
  for (const x of xs) addTableSet(deck, x, cz, 2 + Math.floor(r() * 3), r, { theta0: 0, umbrellaR: 1.2 });
  addPlanter(deck, w / 2 - .7, cz, Math.PI / 2, variant * 3 + 1);
  if (wide) addPlanter(deck, -(w / 2 - .7), cz, Math.PI / 2, variant * 3 + 2);
}
/** Café / restaurant frontage: striped awning, hanging sign, small terrace; door (|x| < 0.8) kept clear. */
function addShopFront(f: Frame, w: number, d: number, wallHeight: number, shop: string, variant: number) {
  const r = seeded(variant ^ (shop === "cafe" ? 0xcafe : 0x4e57)), [cloth, stripe] = pick(r, CLOTHS), front = d / 2,
    top = Math.min(2.65, wallHeight - .12), low = top - .3, aw = Math.max(1.2, Math.min(w - .6, 5.2)), bands = 5, below = pt(f, 0, 0, front + .4);
  for (let k = 0; k < bands; k++) {
    const x0 = -aw / 2 + k * aw / bands, x1 = x0 + aw / bands, tint = k % 2 ? stripe : cloth;
    // Even with a real doorway, an unbroken *overhead* café awning hid
    // the original returning resident at the canonical owned front wall.
    // Keep shade at the sides, opening a 1.9 m clear sightline/entrance
    // in the centre. This changes only disposable close-LOD cloth mesh.
    for (const [left, right] of [[x0, Math.min(x1, -.95)], [Math.max(x0, .95), x1]]) {
      if (right - left < .08) continue;
      polygon(f.b, [pt(f, left, top, front + .02), pt(f, right, top, front + .02), pt(f, right, low, front + .92), pt(f, left, low, front + .92)], below, tint);
      polygon(f.b, [pt(f, left, low - .15, front + .92), pt(f, right, low - .15, front + .92), pt(f, right, low, front + .92), pt(f, left, low, front + .92)], pt(f, (left + right) / 2, low, front), tint);
    }
  }
  const signX = -(w / 2 - .15);
  cuboid(f, signX, low - .08, front + .31, .04, .04, .62, IRON);
  cuboid(f, signX, low - .5, front + .38, .04, .38, .48, pick(r, [color(46, 72, 60), color(112, 42, 36), color(40, 52, 82)]));
  if (w < 4.4) return;
  const restaurant = shop === "restaurant", z = front + 1.3, wide = w >= 6.2,
    xs = restaurant ? [-Math.min(1.95, w / 2 - .5), Math.min(1.95, w / 2 - .5)] : wide ? [-1.8, 1.4, 2.6] : [-Math.min(1.75, w / 2 - .55), Math.min(1.75, w / 2 - .55)];
  // Restaurant table umbrellas must also keep the same owned door axis
  // clear; their former 1.1 m crowns projected across the central aisle.
  for (const x of xs) addTableSet(f, x, z, 2, r, { theta0: 0, tableR: restaurant ? .4 : .34, umbrellaR: restaurant ? .75 : undefined });
  if (!restaurant) {
    // Café parasols in a plain seeded cloth (restaurants keep striped ones): one per table, one shared over the paired tables
    // of a wide café; each canopy's inner rim stays >= .85 m from the door axis (8-gon extent r cos 22.5°).
    // A privately owned house may also host a café. Keep the authentic
    // central SEED home entrance and its line of sight free of overhead
    // parasols; tables remain on the terrace, while wide façades retain two
    // smaller umbrellas at the sides. No ownership/layout decisions change.
    const parasol = pick(r, CLOTHS)[0], spots = wide ? [-2.6, 2.6] : xs;
    for (const x of spots) addUmbrella(f, x, z, wide ? .65 : .48, [parasol, parasol]);
  }
  if (restaurant) {
    const board = sub(f, 1.1, front + 1.9);
    for (const side of [-1, 1]) beam(f.b, pt(board, 0, 0, side * .2), pt(board, 0, .9, side * .02), .5, .03, color(44, 48, 44));
  } else addPlanter(f, -1.6, front + .22, 0, variant * 5 + 3, 1, .36, .45);
}

type LayerBuilders = { structures: Builder; nature: Builder; detail: Builder; closeDetail: Builder; nightGlow: Builder; lampPools: Builder; streetTrees: Builder };

/** Draws one feature into the builders (already placed at the feature origin). */
function drawFeature(feature: any, tileSize: number, layers: LayerBuilders) {
  const { structures, nature, detail, closeDetail, nightGlow, lampPools } = layers, close = tileSize <= 8;
  const x = 0, z = 0, y = 0, yaw = feature.yawRad || 0,
    width = feature.widthM ?? feature.footprintWidth ?? 8, depth = feature.depthM ?? feature.footprintDepth ?? 8, variant = feature.variant || 0;
  if(close&&["residence","service","keep","guard-post"].includes(feature.kind)&&!["market","merchant"].includes(feature.service)){
    const storeys=feature.house?.storeys??(feature.kind==='keep'?3:feature.kind==='guard-post'?1:1),
      height=feature.house?.wallHeightM??(feature.kind==='keep'?10:feature.kind==='guard-post'?3.8:4);
    for(const window of facadeWindows(width,depth,height,storeys)){
      if(window.yaw===0&&["farmstead","blacksmith"].includes(feature.service))continue;
      const p=offsetLocal(0,0,yaw,window.x,window.z),angle=yaw+window.yaw,
        glass=offsetLocal(p.x,p.z,angle,0,.055),lit=offsetLocal(p.x,p.z,angle,0,.082);
      closeDetail.boxYaw(p.x,window.y-.08,p.z,window.width+.16,window.height+.16,.08,angle,color(69,49,32));
      closeDetail.boxYaw(glass.x,window.y,glass.z,window.width,window.height,.025,angle,color(51,68,75));
      const q=(xx:number,yy:number):Point=>{const p=offsetLocal(lit.x,lit.z,angle,xx,0);return[p.x,yy,p.z];};
      nightGlow.quad(q(-window.width/2,window.y),q(window.width/2,window.y),q(window.width/2,window.y+window.height),q(-window.width/2,window.y+window.height),color(255,186,82));
    }
  }
  if(feature.kind==='street-lamp'){
    const metal=LAMP_METAL,brass=LAMP_BRASS;
    closeDetail.boxYaw(0,0,0,.12,3.25,.12,yaw,metal);
    closeDetail.boxYaw(0,3.1,0,.66,.09,.09,yaw,metal);
    closeDetail.boxYaw(0,2.76,0,.4,.48,.4,yaw,brass);
    closeDetail.boxYaw(0,3.22,0,.52,.08,.52,yaw,metal);
    nightGlow.boxYaw(0,2.82,0,.416,.34,.416,yaw,color(255,198,104));
    // A small ground-conforming additive light pool, no point-light/shadow pass.
    const radius=3,metric=sourceUnitsPerMetreAt(feature.z),centre:Point=[0,.14,0];
    for(let side=0;side<12;side++){
      const point=(angle:number):Point=>{const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,
        ground=finalSurfaceAt(feature.x+x*metric.x,feature.z+z*metric.z);return[x,ground.groundHeight-feature.y+.14,z];};
      lampPools.triangleGradient(centre,point((side+1)*Math.PI/6),point(side*Math.PI/6),color(170,116,43),color(0,0,0),color(0,0,0));
    }
  }
  if (feature.kind === "residence") {
    const wall = [color(185, 174, 145), color(167, 160, 139), color(196, 181, 149)][variant % 3], roof = [color(104, 65, 46), color(88, 67, 51), color(117, 73, 49)][(variant >>> 2) % 3],
      urban = Boolean(feature.urban), bodyHeight = feature.house?.wallHeightM ?? 2.8,
      roofHeight = .55, roofOverhang = .4;
    if (close) {
      // The SEED-owned entrance is centred on the physical front (+Z) wall.
      // A solid facade with a dark decal hid the ORIGINAL resident at the
      // final door station. Cut a real, human-sized opening at close LOD;
      // preserve the wall/roof silhouette, owned position and Simulation.
      const gap = Math.min(1.35, width * .3), height = Math.min(2.2, bodyHeight - .3),
        thickness = .22, sideWidth = (width - gap) / 2;
      const shell = (lx: number, lz: number, w: number, h: number, d: number, bottom = y - .05) => {
        const p = offsetLocal(x, z, yaw, lx, lz);
        structures.boxYaw(p.x, bottom, p.z, w, h, d, yaw, wall);
      };
      shell(0, -depth / 2 + thickness / 2, width, bodyHeight, thickness);
      for (const side of [-1, 1]) {
        shell(side * (width / 2 - thickness / 2), 0, thickness, bodyHeight, depth);
        shell(side * (gap / 2 + sideWidth / 2), depth / 2 - thickness / 2,
          sideWidth, bodyHeight, thickness);
      }
      shell(0, depth / 2 - thickness / 2, gap, bodyHeight - height, thickness, y + height);
      // The recessed dark door is behind the real approach, not a coplanar
      // painted rectangle in front of the arriving resident's 2D body/feet.
      const inside = offsetLocal(x, z, yaw, 0, depth / 2 - .34);
      detail.boxYaw(inside.x, y + .03, inside.z, gap - .12, height - .12, .07, yaw, color(55, 43, 34));
      for (const side of [-1, 1]) {
        const jamb = offsetLocal(x, z, yaw, side * (gap / 2 + .045), depth / 2 + .015);
        detail.boxYaw(jamb.x, y, jamb.z, .09, height + .07, .085, yaw, color(107, 75, 49));
      }
    } else {
      structures.boxYaw(x, y - .05, z, width, bodyHeight, depth, yaw, wall);
    }
    structures.boxYaw(x, y + bodyHeight - .06, z, width + roofOverhang, roofHeight, depth + roofOverhang, yaw, roof);
    if (tileSize <= 32) {
      const chimney = offsetLocal(x, z, yaw, width * .26, -depth * .18);
      if (!close) {
        // Distant LOD retains the cheap opaque house and a readable door.
        const front = offsetLocal(x, z, yaw, 0, depth * .5 + .06);
        detail.boxYaw(front.x, y + .03, front.z, .9, 2.05, .09, yaw, color(78, 56, 40));
      }
      detail.boxYaw(chimney.x, y + bodyHeight, chimney.z, .34, urban ? 1.05 : .78, .34, yaw, color(108, 102, 91));
    }
    if (close && (feature.shop === "cafe" || feature.shop === "restaurant")) addShopFront(frameOf(closeDetail, yaw), width, depth, bodyHeight, feature.shop, variant);
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
    const roadWidth = Math.max(metresToSource(2.8), width), length = feature.length || depth || 4;
    // The pavement is part of the street: one stone slab under the road, a little wider on each side and
    // 43 mm lower (top at .05, road top at .093), so where streets cross the road surface clearly covers the neighbouring pavement.
    if (feature.pavementWidth) structures.boxYaw(x, y - .02, z, roadWidth + 2 * feature.pavementWidth, .07, length, yaw, PAVEMENT);
    structures.boxYaw(x, y + .018, z, roadWidth, .075, length, yaw, color(119, 99, 68));
  } else if (feature.kind === "street-joint") {
    // Flat 12-sided caps at a bend (source units, same tops/colours as the street) so segments meet without wedge gaps.
    const roadWidth = Math.max(metresToSource(2.8), feature.footprintWidth ?? width);
    if (feature.pavementWidth) disc(frameOf(structures, yaw), 0, .05, 0, roadWidth / 2 + feature.pavementWidth, 12, PAVEMENT);
    disc(frameOf(structures, yaw), 0, .093, 0, roadWidth / 2, 12, color(119, 99, 68));
  } else if (feature.kind === "service") {
    addServiceGeometry(structures, detail, feature.service, x, y, z, width, depth, yaw, close);
    if (close && feature.service === "market") addBazaar(frameOf(closeDetail, yaw), width, depth, variant);
    else if (close && feature.service === "inn") addInnTerrace(frameOf(closeDetail, yaw), width, depth, variant);
  } else if (feature.kind === "bench") {
    if (close) addBench(frameOf(closeDetail, yaw), 0, 0, 0);
  } else if (feature.kind === "planter") {
    if (close) addPlanter(frameOf(closeDetail, yaw), 0, 0, 0, variant, feature.widthM ?? 1.4, feature.depthM ?? .7);
  } else if (feature.kind === "yard-prop") {
    // A Blender model when one is loaded for this kind (src/models), otherwise the procedural kit.
    const asset = close ? assetFor(feature.label, variant) : undefined;
    if (asset) addAssetMesh(frameOf(closeDetail, yaw), asset);
    else if (close) addYardProp(frameOf(closeDetail, yaw), feature.label, variant);
  } else if (feature.kind === "park") {
    const ground = frameOf(structures, yaw), props = frameOf(closeDetail, yaw), shape = parkShapeOf(feature.parkShape);
    if (feature.label === "playground") addPlayground(ground, props, width, depth, variant, close, shape);
    else if (feature.label === "flower-garden") addFlowerGarden(ground, props, width, depth, variant, close, shape);
    else addSquare(ground, props, width, depth, variant, close, shape);
  } else if (feature.kind === "gate") {
    const postSpan = Math.max(5.8, width * .72), left = offsetLocal(x, z, yaw, -postSpan * .5, 0), right = offsetLocal(x, z, yaw, postSpan * .5, 0), timber = color(85, 61, 40), stone = color(145, 144, 128);
    structures.boxYaw(left.x, y - .06, left.z, 1.8, 5.4, 1.8, yaw, stone);
    structures.boxYaw(right.x, y - .06, right.z, 1.8, 5.4, 1.8, yaw, stone);
    structures.boxYaw(x, y + 4.45, z, postSpan + 1.8, .7, 1.65, yaw, timber);
    if (tileSize <= 64) {
      detail.cone(left.x, y + 5.25, left.z, 1.55, 2.1, color(99, 66, 48), 4);
      detail.cone(right.x, y + 5.25, right.z, 1.55, 2.1, color(99, 66, 48), 4);
    }
  } else if (feature.kind === "guard-post") {
    structures.boxYaw(x, y - .05, z, width, 3.8, depth, yaw, color(143, 142, 126));
    structures.boxYaw(x, y + 3.55, z, width * 1.05, .55, depth * 1.05, yaw, color(91, 65, 47));
    if (tileSize <= 64) detail.cone(x, y + 3.95, z, Math.max(width, depth) * .72, 2.15, color(104, 70, 50), 4);
  } else if (feature.kind === "border" && variant >= 2) {
    const length = feature.length || depth || 4,
      at = (lx: number, lz: number) => offsetLocal(x, z, yaw, lx, lz);
    if (variant === 2) {
      structures.boxYaw(x, y - .02, z, Math.max(metresToSource(1.35), width), 1.65, length, yaw, color(76, 104, 59));
      if (tileSize <= 64) for (const lz of [-length * .34, 0, length * .34]) {
        const shrub = at(0, lz);
        detail.cone(shrub.x, y + .7, shrub.z, metresToSource(1.15), 1.45, color(83, 116, 64), 7);
      }
    } else if (variant === 3) {
      structures.boxYaw(x, y - .05, z, Math.max(metresToSource(.9), width), 2.75, length, yaw, color(91, 66, 43));
      if (tileSize <= 64) for (const lz of [-length * .45, 0, length * .45]) {
        const post = at(0, lz);
        detail.boxYaw(post.x, y - .08, post.z, metresToSource(1.25), 3.35, metresToSource(1.25), yaw, color(73, 52, 35));
      }
    } else {
      structures.boxYaw(x, y - .06, z, Math.max(metresToSource(1.2), width), 2.05, length, yaw, color(151, 150, 132));
      structures.boxYaw(x, y + 1.82, z, Math.max(metresToSource(.82), width * .72), .3, length, yaw, color(112, 105, 89));
      if (tileSize <= 64) for (const lz of [-length * .42, length * .42]) {
        const brace = at(0, lz);
        detail.boxYaw(brace.x, y + .05, brace.z, Math.max(metresToSource(1.35), width), 2.25, metresToSource(.52), yaw, color(82, 61, 43));
      }
    }
  } else if (feature.kind === "garden") {
    structures.boxYaw(x, y + .02, z, width, .08, depth, yaw, color(117, 132, 71));
    if (tileSize <= 64) {
      for (const lx of [-width * .28, 0, width * .28]) { const row = offsetLocal(x, z, yaw, lx, 0); detail.boxYaw(row.x, y + .12, row.z, .42, .3, depth * .72, yaw, color(151, 126, 62)); }
      for (const lz of [-depth / 2, depth / 2]) { const fence = offsetLocal(x, z, yaw, 0, lz); detail.boxYaw(fence.x, y + .1, fence.z, width, .18, .16, yaw, color(92, 68, 45)); }
    }
  } else if (feature.kind === "field") {
    // Farmland in physical metres: a tilled plot, crop rows along its depth, a low rail fence.
    const form = feature.fieldForm, soil = form === "pasture" ? color(118, 140, 74) : form === "orchard" ? color(104, 126, 66) : color(158, 132, 66),
      crop = form === "vegetable" ? color(96, 132, 64) : form === "strip" ? color(196, 168, 88) : color(184, 158, 83);
    structures.boxYaw(x, y + .03, z, width, .12, depth, yaw, soil);
    if (tileSize <= 64 && form !== "pasture") {
      const rows = Math.max(2, Math.min(14, Math.floor(width / (form === "orchard" ? 5 : 2.4))));
      for (let row = 0; row < rows; row++) {
        const lx = -width * .5 + (row + .5) * width / rows, at = offsetLocal(x, z, yaw, lx, 0);
        if (form === "orchard") for (let k = -1; k <= 1; k++) { const tree = offsetLocal(at.x, at.z, yaw, 0, k * depth * .3); nature.cone(tree.x, y + .8, tree.z, 1.3, 2.4, color(79, 118, 62), 6); }
        else detail.boxYaw(at.x, y + .12, at.z, Math.min(.9, width / rows * .45), .3, depth * .92, yaw, crop);
      }
    }
    if (tileSize <= 32) for (const lz of [-depth * .5, depth * .5]) { const rail = offsetLocal(x, z, yaw, 0, lz); detail.boxYaw(rail.x, y + .9, rail.z, width, .12, .12, yaw, color(92, 68, 45)); }
  } else if (feature.kind === "path") {
    structures.boxYaw(x, y + .015, z, width || 1.25, .06, feature.length || depth || 3, yaw, color(137, 116, 79));
  } else if (feature.kind === "roadside-tree") {
    const h = 6.2 + (variant % 5) * .65, radius = 2 + ((variant >>> 3) % 6) * .18;
    layers.streetTrees.boxYaw(x, y - .1, z, .62, h * .58, .62, 0, color(82, 62, 42));
    layers.streetTrees.cone(x, y + h * .3, z, radius, h * .52, color(72 + (variant % 14), 111 + (variant % 17), 63), 7);
    if (tileSize <= 32) layers.streetTrees.cone(x + radius * .28, y + h * .46, z - radius * .08, radius * .65, h * .3, color(84, 126, 69), 6);
  }
}

/**
 * Test hook: builds one feature into fresh builders with an identity origin, so physical features
 * come back in local metres (x/z centred on the feature, y = 0 at its ground).
 */
export function buildPropForTest(feature: any, tileSize = 8): Record<keyof LayerBuilders, Geometry> {
  const layers: LayerBuilders = { structures: new Builder(), nature: new Builder(), detail: new Builder(), closeDetail: new Builder(), nightGlow: new Builder(), lampPools: new Builder(), streetTrees: new Builder() };
  drawFeature(feature, tileSize, layers);
  return {
    structures: layers.structures.finish(), nature: layers.nature.finish(), detail: layers.detail.finish(),
    closeDetail: layers.closeDetail.finish(), nightGlow: layers.nightGlow.finish(), lampPools: layers.lampPools.finish(), streetTrees: layers.streetTrees.finish(),
  };
}

/** S004 detail overlay: semantic settlement identity is owned by world.ts; geometry only visualizes it. */
export function buildTile(tile: Tile, options: { terrainOnly?: boolean; skipBaseTerrain?: boolean } = {}): TileGeometry {
  if (options.terrainOnly) return buildTerrainOnly(tile);
  const result = coreBuildTile(tile, { skipBaseTerrain: options.skipBaseTerrain }),
    layers: LayerBuilders = { structures: new Builder(), nature: new Builder(), detail: new Builder(), closeDetail: new Builder(), nightGlow: new Builder(), lampPools: new Builder(), streetTrees: new Builder() },
    all = Object.values(layers), originX = tile.minX + tile.size / 2, originZ = tile.minZ + tile.size / 2;
  if (tile.size <= 512) for (const feature of featuresFor(tile) as any[]) {
    const physical = feature.widthM !== undefined || feature.kind === "roadside-tree";
    for (const builder of all) builder.placeAt(feature.x - originX, elevationToRenderY(feature.y), feature.z - originZ, feature.z, physical);
    drawFeature(feature, tile.size, layers);
  }
  return {
    terrain: result.terrain,
    structures: mergeGeometry(result.structures, layers.structures.finish()),
    nature: mergeGeometry(result.nature, layers.nature.finish()),
    streetTrees: layers.streetTrees.finish(),
    detail: mergeGeometry(result.detail, layers.detail.finish()),
    ...(tile.size<=8?{closeDetail:layers.closeDetail.finish(),nightGlow:layers.nightGlow.finish(),lampPools:layers.lampPools.finish()}:{}),
  };
}
