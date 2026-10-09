import { biomeAt, featuresFor, field, heightAt, type Tile } from "./world.ts";
import { nearestPlace, roadAt, roads } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { sourceToLonLat, wrapSourceX } from "./planet.ts";
import {
  climateSampleAt,
  frozenLatitudeAt,
  TERRAIN_PALETTE,
  type RGB,
} from "./climate.ts";
type Point = [number, number, number];
export type Geometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
};
export type TileGeometry = {
  terrain: Geometry;
  structures: Geometry;
  nature: Geometry;
  detail: Geometry;
};
const color = (r: number, g: number, b: number): [number, number, number] => [r, g, b];
const blendColor = (a: RGB, b: RGB, amount: number): [number, number, number] => {
  const t = Math.max(0, Math.min(1, amount));
  return color(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
};
const varyColor = (base: RGB, amount: number): [number, number, number] =>
  color(
    Math.max(0, Math.min(255, base[0] + amount)),
    Math.max(0, Math.min(255, base[1] + amount)),
    Math.max(0, Math.min(255, base[2] + amount)),
  );
class Builder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    this.triangleGradient(a, b, c, tint, tint, tint);
  }
  triangleGradient(a: Point, b: Point, c: Point, tintA: RGB, tintB: RGB, tintC: RGB) {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal) || 1;
    const start = this.p.length / 3,
      points = [a, b, c],
      tints = [tintA, tintB, tintC];
    for (let index = 0; index < points.length; index++) {
      this.p.push(...points[index]);
      this.n.push(...normal.map((n) => n / length));
      this.c.push(...tints[index], 255);
    }
    this.i.push(start, start + 1, start + 2);
  }
  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
  }
  quadGradient(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    tintA: RGB,
    tintB: RGB,
    tintC: RGB,
    tintD: RGB,
  ) {
    this.triangleGradient(a, b, c, tintA, tintB, tintC);
    this.triangleGradient(a, c, d, tintA, tintC, tintD);
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    tint: RGB,
  ) {
    const a = x - w / 2,
      b = x + w / 2,
      c = z - d / 2,
      e = z + d / 2,
      t = y + h;
    this.quad([a, y, c], [a, t, c], [b, t, c], [b, y, c], tint);
    this.quad([b, y, e], [b, t, e], [a, t, e], [a, y, e], tint);
    this.quad([a, y, e], [a, t, e], [a, t, c], [a, y, c], tint);
    this.quad([b, y, c], [b, t, c], [b, t, e], [b, y, e], tint);
    this.quad([a, t, c], [a, t, e], [b, t, e], [b, t, c], tint);
  }
  cone(
    x: number,
    y: number,
    z: number,
    radius: number,
    h: number,
    tint: RGB,
    sides = 6,
  ) {
    for (let i = 0; i < sides; i++) {
      const a = (i * Math.PI * 2) / sides,
        b = ((i + 1) * Math.PI * 2) / sides;
      this.triangle(
        [x + Math.cos(b) * radius, y, z + Math.sin(b) * radius],
        [x, y + h, z],
        [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius],
        tint,
      );
    }
  }
  roof(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    tint: RGB,
  ) {
    this.quad(
      [x - w / 2, y, z - d / 2],
      [x, y + h, z - d / 2],
      [x, y + h, z + d / 2],
      [x - w / 2, y, z + d / 2],
      tint,
    );
    this.quad(
      [x + w / 2, y, z + d / 2],
      [x, y + h, z + d / 2],
      [x, y + h, z - d / 2],
      [x + w / 2, y, z - d / 2],
      tint,
    );
    this.triangle(
      [x - w / 2, y, z - d / 2],
      [x + w / 2, y, z - d / 2],
      [x, y + h, z - d / 2],
      tint,
    );
    this.triangle(
      [x + w / 2, y, z + d / 2],
      [x - w / 2, y, z + d / 2],
      [x, y + h, z + d / 2],
      tint,
    );
  }
  /** Keep large source coordinates out of Float32 before the worker converts to ENU. */
  relativeTo(x: number, z: number) {
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] -= x;
      this.p[i + 2] -= z;
    }
  }
  finish(): Geometry {
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Uint8Array(this.c),
      indices: new Uint32Array(this.i),
    };
  }
}

/**
 * Shared semantic material lookup. Realm and local LODs use the same climate
 * identity and palette; only bounded seed-derived detail frequency changes.
 */
export function terrainTint(
  x: number,
  z: number,
  scale = 32,
  elevationM?: number,
): [number, number, number] {
  const position = sourceToLonLat(x, z),
    macro = macroSampleAt(position),
    sample = climateSampleAt(position, elevationM ?? macro.reliefM),
    legacy = scale <= 512 ? biomeAt(x, z) : "";

  if (legacy === "River") return color(76, 128, 148);
  if (legacy === "Riverbank") return color(151, 143, 99);

  const s = scale <= 512 ? nearestPlace(x, z) : undefined,
    dx = s ? Math.abs(wrapSourceX(x - s.x)) : 1000,
    dz = s ? Math.abs(z - s.z) : 1000,
    urbanRoad =
      s?.kind === "city" && (Math.abs(dx % 29) < 3 || Math.abs(dz % 29) < 3);
  if (
    scale <= 512 &&
    ((s &&
      Math.hypot(dx, dz) < (s.kind === "city" ? 420 : 66) &&
      (dx < 4 || dz < 4 || Math.hypot(dx, dz) < 11 || urbanRoad)) ||
      (roadAt(x, z) && Math.abs(z - roadAt(x, z)!.z) < 5))
  )
    return color(170, 151, 113);

  const base = TERRAIN_PALETTE[sample.terrainClass],
    detailScale = scale > 512 ? 9000 : sample.terrainClass.includes("forest") ? 42 : 68,
    variation = (field(x, z, detailScale, 44) - 0.5) * (scale > 512 ? 7 : 15),
    protectedSurface = ["ocean", "lake", "sea-ice", "polar-ice", "snowy-mountain"].includes(
      sample.terrainClass,
    ),
    tint = varyColor(base, variation * (protectedSurface ? 0.35 : 1));

  // Keep high relief readable without replacing the semantic biome palette.
  if (macro.mountainIntensity > 0.04 && !protectedSurface) {
    const rock = macro.volcanic ? TERRAIN_PALETTE.volcanic : TERRAIN_PALETTE.highland,
      weight = Math.min(0.38, Math.max(0, macro.mountainIntensity - 0.04) * 0.42);
    return blendColor(tint, rock, weight);
  }
  return tint;
}

/** Worker-generated tile meshes. Skirts cover cracks between terrain LOD levels. */
export function buildTile(t: Tile): TileGeometry {
  const terrain = new Builder(),
    structures = new Builder(),
    nature = new Builder(),
    detail = new Builder();
  // Vertex tint interpolation fixes material blocks without increasing the existing
  // tile triangle budget; performance remains bounded by the established mesh LOD.
  const resolution = Math.min(16, t.size / 2),
    step = t.size / resolution;
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = t.minX + x * step,
        az = t.minZ + z * step;
      const point = (px: number, pz: number): Point => [px, heightAt(px, pz), pz];
      const a = point(ax, az),
        b = point(ax, az + step),
        c = point(ax + step, az + step),
        d = point(ax + step, az);
      if (Math.max(a[1], b[1], c[1], d[1]) > 0)
        terrain.quadGradient(
          a,
          b,
          c,
          d,
          terrainTint(a[0], a[2], t.size, a[1]),
          terrainTint(b[0], b[2], t.size, b[1]),
          terrainTint(c[0], c[2], t.size, c[1]),
          terrainTint(d[0], d[2], t.size, d[1]),
        );
      if (z === 0)
        terrain.quad(
          a,
          d,
          [d[0], d[1] - 12, d[2]],
          [a[0], a[1] - 12, a[2]],
          terrainTint(ax, az, t.size, a[1]),
        );
      if (z === resolution - 1)
        terrain.quad(
          c,
          b,
          [b[0], b[1] - 12, b[2]],
          [c[0], c[1] - 12, c[2]],
          terrainTint(ax, az, t.size, c[1]),
        );
      if (x === 0)
        terrain.quad(
          b,
          a,
          [a[0], a[1] - 12, a[2]],
          [b[0], b[1] - 12, b[2]],
          terrainTint(ax, az, t.size, b[1]),
        );
      if (x === resolution - 1)
        terrain.quad(
          d,
          c,
          [c[0], c[1] - 12, c[2]],
          [d[0], d[1] - 12, d[2]],
          terrainTint(ax, az, t.size, d[1]),
        );
    }
  // The water/ice plane is presentation-only and sits beneath land. Sample the same
  // canonical polar boundary at each corner so a tile cannot expose a rectangular ice edge.
  const waterTint = (x: number, z: number) =>
    frozenLatitudeAt(sourceToLonLat(x, z)) ? TERRAIN_PALETTE["sea-ice"] : TERRAIN_PALETTE.ocean;
  terrain.quadGradient(
    [t.minX, 0, t.minZ],
    [t.minX, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ],
    waterTint(t.minX, t.minZ),
    waterTint(t.minX, t.minZ + t.size),
    waterTint(t.minX + t.size, t.minZ + t.size),
    waterTint(t.minX + t.size, t.minZ),
  );
  if (t.size <= 512)
    for (const f of featuresFor(t)) {
      const { x, y, z, variant: v } = f;
      const stone = color(167, 165, 144),
        timber = color(75, 58, 43),
        plaster = color(210, 190, 145);
      if (f.kind === "house") {
        const w = 6 + (v % 3),
          d = 7 + ((v >>> 4) % 3),
          h = 4.1 + (v % 2) * 1.2;
        structures.box(x, y - 0.3, z, w, h + 0.3, d, plaster);
        structures.roof(
          x,
          y + h,
          z,
          w + 1,
          d + 1,
          2.8,
          color(113 + (v % 25), 65 + (v % 16), 48),
        );
        if (t.size <= 64) {
          for (const offset of [-w / 2 + 0.15, 0, w / 2 - 0.15])
            detail.box(
              x + offset,
              y,
              z,
              w === 0 ? 0.1 : 0.22,
              h,
              d + 0.06,
              timber,
            );
          detail.box(x, y + h * 0.55, z, w + 0.06, 0.22, d + 0.1, timber);
          detail.box(x, y, z + d / 2 + 0.07, 1.2, 2.3, 0.15, timber);
          for (const offset of [-1.9, 1.9])
            detail.box(
              x + offset,
              y + 2.4,
              z + d / 2 + 0.1,
              0.9,
              1,
              0.15,
              color(54, 64, 53),
            );
          detail.box(x + w / 3, y + h + 1, z - d / 4, 0.8, 1.8, 0.8, stone);
        }
      } else if (f.kind === "keep") {
        structures.box(x, y - 0.3, z, 15, 10.3, 14, stone);
        structures.roof(x, y + 10, z, 16, 15, 4, color(65, 81, 88));
        for (const ox of [-9, 9])
          for (const oz of [-8, 8]) {
            structures.box(
              x + ox,
              y - 0.3,
              z + oz,
              4.2,
              13.3,
              4.2,
              color(154, 154, 135),
            );
            structures.cone(
              x + ox,
              y + 13,
              z + oz,
              3.6,
              5,
              color(62, 80, 87),
              4,
            );
            if (t.size <= 64)
              detail.box(x + ox, y + 9, z + oz + 2.13, 0.6, 1.9, 0.08, timber);
          }
        if (t.size <= 64) {
          detail.box(x, y, z + 7.1, 2.8, 4.2, 0.2, timber);
          for (let i = -2; i <= 2; i++)
            detail.box(
              x + i * 2.5,
              y + 7,
              z + 7.1,
              0.6,
              1.8,
              0.15,
              color(53, 63, 56),
            );
          detail.box(x, y + 14, z, 0.12, 5, 0.12, timber);
          detail.box(x + 1.3, y + 17, z, 2.5, 1.4, 0.07, color(171, 78, 49));
        }
      } else if (f.kind === "tree") {
        const climate = climateSampleAt(sourceToLonLat(x, z), y),
          family = climate.forestFamily;
        if (!family) continue;
        const h = 7 + (v % 5),
          r = 2.4 + (v % 9) / 10;
        if (family === "conifer-boreal") {
          nature.box(x, y - 0.1, z, 0.62, h * 0.54, 0.62, timber);
          nature.cone(x, y + 1.2, z, r, h * 0.78, color(39 + (v % 10), 76 + (v % 13), 58), 6);
          nature.cone(x, y + h * 0.4, z, r * 0.76, h * 0.58, color(49 + (v % 9), 88 + (v % 12), 62), 6);
          if (t.size <= 32)
            detail.cone(x, y + h * 0.68, z, r * 0.42, h * 0.34, color(65, 103, 69), 6);
        } else if (family === "temperate-deciduous-mixed") {
          nature.box(x, y - 0.1, z, 0.78, h * 0.58, 0.78, timber);
          nature.cone(x, y + h * 0.34, z, r * 1.2, h * 0.46, color(65 + (v % 15), 111 + (v % 17), 62), 8);
          nature.cone(x - r * 0.28, y + h * 0.48, z, r * 0.78, h * 0.32, color(78 + (v % 13), 126 + (v % 15), 68), 7);
          nature.cone(x + r * 0.3, y + h * 0.47, z + r * 0.08, r * 0.72, h * 0.3, color(71 + (v % 12), 119 + (v % 16), 64), 7);
        } else {
          // Warm/dry woodland is intentionally sparser and lower, with an open umbrella crown.
          if (v % 3 !== 0) continue;
          const shortH = h * 0.72;
          nature.box(x, y - 0.1, z, 0.72, shortH * 0.62, 0.72, color(88, 67, 45));
          nature.cone(x, y + shortH * 0.46, z, r * 1.15, shortH * 0.34, color(103 + (v % 12), 119 + (v % 12), 68), 7);
          nature.cone(x + r * 0.36, y + shortH * 0.49, z - r * 0.14, r * 0.62, shortH * 0.25, color(118, 128, 72), 6);
        }
      } else if (f.kind === "rock") {
        nature.box(
          x,
          y - 0.2,
          z,
          1.5 + (v % 3),
          1 + (v % 2),
          1.9,
          color(133, 143, 123),
        );
      } else if (f.kind === "field") {
        nature.box(x, y + 0.03, z, 18, 0.15, 18, color(158, 132, 66));
        if (t.size <= 64)
          for (let row = 0; row < 8; row++)
            detail.box(
              x - 7 + row * 2,
              y + 0.2,
              z,
              0.65,
              0.45,
              16,
              color(184, 158, 83),
            );
        if (t.size <= 32)
          for (const oz of [-9, 9]) {
            detail.box(x, y + 1, z + oz, 18, 0.18, 0.18, timber);
            for (let i = -9; i <= 9; i += 3)
              detail.box(x + i, y, z + oz, 0.16, 1.3, 0.16, timber);
          }
      } else if (f.kind === "well" && t.size <= 64) {
        structures.box(x, y, z, 2.3, 1, 2.3, stone);
        detail.box(x, y + 1.02, z, 1.4, 0.04, 1.4, color(39, 59, 56));
        for (const ox of [-1.2, 1.2])
          detail.box(x + ox, y, z, 0.18, 3, 0.18, timber);
        detail.roof(x, y + 3, z, 3, 3, 1, color(116, 69, 47));
      }
    }
  // Tile-clipped bridges preserve walking routes where the river crosses them.
  if (t.size <= 512)
    for (const road of roads) {
      if (road.z < t.minZ || road.z >= t.minZ + t.size) continue;
      for (
        let x = Math.max(t.minX, Math.ceil(road.minX / 2) * 2);
        x < Math.min(t.minX + t.size, road.maxX);
        x += 2
      ) {
        if (heightAt(x, road.z) < 2.9) {
          structures.box(x + 1, 2.8, road.z, 2, 0.2, 10, color(115, 88, 56));
          if (t.size <= 64)
            for (const oz of [-4.5, 4.5]) {
              detail.box(
                x + 1,
                3.9,
                road.z + oz,
                2,
                0.18,
                0.18,
                color(83, 65, 46),
              );
              detail.box(x, 3, road.z + oz, 0.2, 1.2, 0.2, color(83, 65, 46));
            }
        }
      }
    }
  // Preserve full precision until after the large source anchor is removed.
  const originX = t.minX + t.size / 2,
    originZ = t.minZ + t.size / 2;
  for (const builder of [terrain, structures, nature, detail])
    builder.relativeTo(originX, originZ);
  return {
    terrain: terrain.finish(),
    structures: structures.finish(),
    nature: nature.finish(),
    detail: detail.finish(),
  };
}
