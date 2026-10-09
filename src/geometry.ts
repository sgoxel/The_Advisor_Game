import { biomeAt, featuresFor, field, heightAt, type Tile } from "./world.ts";
import { nearestPlace, roadAt, roads } from "./geography.ts";
import { biomeSampleAtSource } from "./biome.ts";
import { wrapSourceX } from "./planet.ts";
type RGB = [number, number, number];
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
const color = (r: number, g: number, b: number): RGB => [r, g, b];
class Builder {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal) || 1;
    const start = this.p.length / 3;
    for (const point of [a, b, c]) {
      this.p.push(...point);
      this.n.push(...normal.map((n) => n / length));
      this.c.push(...tint, 255);
    }
    this.i.push(start, start + 1, start + 2);
  }
  quad(a: Point, b: Point, c: Point, d: Point, tint: RGB) {
    this.triangle(a, b, c, tint);
    this.triangle(a, c, d, tint);
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

/** One semantic material palette is used by Realm and every flat LOD. */
export function terrainTint(x: number, z: number, scale = 32): RGB {
  if (scale <= 512) {
    const s = nearestPlace(x, z),
      dx = s ? Math.abs(wrapSourceX(x - s.x)) : 1000,
      dz = s ? Math.abs(z - s.z) : 1000,
      urbanRoad =
        s?.kind === "city" && (Math.abs(dx % 29) < 3 || Math.abs(dz % 29) < 3);
    if (
      (s &&
        Math.hypot(dx, dz) < (s.kind === "city" ? 420 : 66) &&
        (dx < 4 || dz < 4 || Math.hypot(dx, dz) < 11 || urbanRoad)) ||
      (roadAt(x, z) && Math.abs(z - roadAt(x, z)!.z) < 5)
    )
      return color(170, 151, 113);
  }
  const h = scale > 512 ? undefined : heightAt(x, z),
    sample = biomeSampleAtSource(x, z, h === undefined ? {} : { elevationM: h }),
    base = sample.material.color,
    grain = field(x, z, scale > 512 ? 7600 : sample.material.rock ? 45 : 72, 44) - 0.5,
    amount = scale > 512 ? 8 : sample.material.frozen ? 7 : sample.material.water ? 4 : 13;
  return color(
    Math.max(0, Math.min(255, base[0] + grain * amount)),
    Math.max(0, Math.min(255, base[1] + grain * amount)),
    Math.max(0, Math.min(255, base[2] + grain * amount)),
  );
}

function waterTint(x: number, z: number): RGB {
  const sample = biomeSampleAtSource(x, z);
  if (sample.biome === "polar-sea-ice") return [...sample.material.color];
  if (sample.macro.domain === "Lake") return [72, 126, 148];
  return [70, 126, 132];
}

/** Worker-generated tile meshes. Skirts cover cracks between terrain LOD levels. */
export function buildTile(t: Tile): TileGeometry {
  const terrain = new Builder(),
    structures = new Builder(),
    nature = new Builder(),
    detail = new Builder();
  const resolution = Math.min(16, t.size / 2),
    step = t.size / resolution;
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = t.minX + x * step,
        az = t.minZ + z * step;
      const point = (px: number, pz: number): Point => [
        px,
        heightAt(px, pz),
        pz,
      ];
      const a = point(ax, az),
        b = point(ax, az + step),
        c = point(ax + step, az + step),
        d = point(ax + step, az);
      if (Math.max(a[1], b[1], c[1], d[1]) > 0)
        terrain.quad(
          a,
          b,
          c,
          d,
          terrainTint(ax + step / 2, az + step / 2, t.size),
        );
      if (z === 0)
        terrain.quad(
          a,
          d,
          [d[0], d[1] - 12, d[2]],
          [a[0], a[1] - 12, a[2]],
          terrainTint(ax, az),
        );
      if (z === resolution - 1)
        terrain.quad(
          c,
          b,
          [b[0], b[1] - 12, b[2]],
          [c[0], c[1] - 12, c[2]],
          terrainTint(ax, az),
        );
      if (x === 0)
        terrain.quad(
          b,
          a,
          [a[0], a[1] - 12, a[2]],
          [b[0], b[1] - 12, b[2]],
          terrainTint(ax, az),
        );
      if (x === resolution - 1)
        terrain.quad(
          d,
          c,
          [c[0], c[1] - 12, c[2]],
          [d[0], d[1] - 12, d[2]],
          terrainTint(ax, az),
        );
    }
  // Water uses the same climate authority, so polar sea ice remains frozen locally.
  terrain.quad(
    [t.minX, 0, t.minZ],
    [t.minX, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ],
    waterTint(t.minX + t.size / 2, t.minZ + t.size / 2),
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
        const sample = biomeSampleAtSource(x, z, { elevationM: y }),
          family = sample.forestFamily,
          baseH = family === "boreal" ? 10 : family === "warm-woodland" ? 6 : 8,
          h = baseH + (v % 5),
          r = family === "boreal" ? 2.0 + (v % 6) / 12 : family === "warm-woodland" ? 3.1 + (v % 8) / 10 : 2.7 + (v % 9) / 10,
          trunk = family === "warm-woodland" ? color(91, 66, 44) : timber,
          low = family === "boreal" ? color(37, 70, 57) : family === "warm-woodland" ? color(82, 99, 55) : color(48, 91, 55),
          high = family === "boreal" ? color(48, 86, 66) : family === "warm-woodland" ? color(100, 113, 62) : color(65, 111, 63);
        nature.box(x, y - 0.1, z, family === "warm-woodland" ? 0.9 : 0.7, h * 0.5, family === "warm-woodland" ? 0.9 : 0.7, trunk);
        nature.cone(x, y + (family === "boreal" ? 1.2 : 2), z, r, h * (family === "boreal" ? 0.9 : 0.72), low, family === "warm-woodland" ? 8 : 6);
        nature.cone(x, y + h * (family === "boreal" ? 0.42 : 0.38), z, r * (family === "boreal" ? 0.68 : 0.82), h * 0.58, high, family === "warm-woodland" ? 8 : 6);
        if (t.size <= 32 && family !== "boreal")
          detail.cone(x, y + h * 0.68, z, r * 0.48, h * 0.34, high, family === "warm-woodland" ? 8 : 6);
      } else if (f.kind === "rock") {
        const sample = biomeSampleAtSource(x, z, { elevationM: y }),
          base = sample.material.rock ? sample.material.color : [133, 143, 123] as const;
        nature.box(
          x,
          y - 0.2,
          z,
          1.5 + (v % 3),
          1 + (v % 2),
          1.9,
          color(base[0], base[1], base[2]),
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
