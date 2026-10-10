import { featuresFor, field, heightAt, type Tile } from "./world.ts";
import { nearestPlace, roadAt, roads } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { surfaceAt } from "./surface.ts";
import {
  climateSampleAt,
  polarBoundaryAt,
  TERRAIN_PALETTE,
  type RGB,
} from "./climate.ts";
type Point = [number, number, number];
export type Geometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  uvs?: Float32Array;
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
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const envelope = (value: number, enter0: number, enter1: number, exit0: number, exit1: number) =>
  smoothstep(enter0, enter1, value) * (1 - smoothstep(exit0, exit1, value));
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
    elevation = elevationM ?? heightAt(x, z),
    sample = climateSampleAt(position, elevation);

  // Exact drainage is only visible in local meshes. Broad open-ocean and
  // Country/Realm vertices keep the same SEED-owned climate/material authority
  // without paying for sub-pixel drainage. Globe land still requests scale 32, so
  // its exact local-material compatibility remains unchanged.
  if (scale <= 1024) {
    const composedSurface = surfaceAt(x, z);
    if (composedSurface.water === "river") return color(76, 128, 148);
    if (composedSurface.riverBank) return color(151, 143, 99);
  }

  const s = nearestPlace(x, z),
    dx = s ? Math.abs(wrapSourceX(x - s.x)) : 1000,
    dz = s ? Math.abs(z - s.z) : 1000,
    urbanRoad =
      s?.kind === "city" && (Math.abs(dx % 29) < 3 || Math.abs(dz % 29) < 3);
  if (
    ((s &&
      Math.hypot(dx, dz) < (s.kind === "city" ? 420 : 66) &&
      (dx < 4 || dz < 4 || Math.hypot(dx, dz) < 11 || urbanRoad)) ||
      (roadAt(x, z) && Math.abs(z - roadAt(x, z)!.z) < 5))
  )
    return color(170, 151, 113);

  // Identical coordinate inputs give identical albedo at every mesh LOD.
  // Filtering detail belongs to presentation, not a size-dependent palette.
  const detailScale = sample.forestFamily ? 42 : 68,
    variation = (field(x, z, detailScale, 44) - 0.5) * 6,
    temperature = sample.temperatureC,
    moisture = sample.moisture,
    land = !["ocean", "lake", "sea-ice"].includes(sample.terrainClass);

  // Water and sea ice use the same canonical polar boundary, but blend through a
  // narrow latitude band so a render quad never exposes an abrupt ice-palette step.
  if (!land) {
    const latitude01 = Math.abs(position.lat) / (Math.PI / 2),
      polarDelta = latitude01 - polarBoundaryAt(position),
      iceWeight = smoothstep(-0.018, 0.018, polarDelta),
      waterBase = sample.terrainClass === "lake" ? TERRAIN_PALETTE.lake : TERRAIN_PALETTE.ocean,
      base = blendColor(waterBase, TERRAIN_PALETTE["sea-ice"], iceWeight);
    return base;
  }

  // Lowland ecotones are continuous functions of the canonical climate fields.
  // The terrainClass/materialId remains discrete authority for logic/inspection;
  // presentation only interpolates the same palette around those boundaries.
  let base: [number, number, number] = [...TERRAIN_PALETTE.desert];
  base = blendColor(base, TERRAIN_PALETTE["bare-earth"], smoothstep(0.18, 0.28, moisture));
  base = blendColor(base, TERRAIN_PALETTE.dryland, smoothstep(0.25, 0.38, moisture));
  base = blendColor(base, TERRAIN_PALETTE.grassland, smoothstep(0.34, 0.52, moisture));
  base = blendColor(
    base,
    TERRAIN_PALETTE.meadow,
    smoothstep(0.58, 0.72, moisture) * smoothstep(1, 7, temperature),
  );

  const lowRelief = 1 - smoothstep(0.2, 0.48, macro.mountainIntensity),
    coniferWeight =
      envelope(temperature, -10, -3, 7, 11) * smoothstep(0.35, 0.52, moisture) * lowRelief,
    temperateWeight =
      envelope(temperature, 6, 11, 20, 24) * smoothstep(0.48, 0.64, moisture) * lowRelief,
    dryWoodWeight =
      smoothstep(15, 20, temperature) *
      smoothstep(0.3, 0.4, moisture) *
      (1 - smoothstep(0.54, 0.64, moisture)) *
      lowRelief;
  base = blendColor(base, TERRAIN_PALETTE["conifer-forest"], coniferWeight * 0.9);
  base = blendColor(base, TERRAIN_PALETTE["temperate-forest"], temperateWeight * 0.92);
  base = blendColor(base, TERRAIN_PALETTE["dry-woodland"], dryWoodWeight * 0.84);

  // Coast material is a genuinely narrow margin. Rugged coasts smoothly resolve
  // toward rock so sandy color cannot become a broad painted inland band.
  const coastDistance = Math.max(0, sample.coastDistanceM),
    coastWeight = (1 - smoothstep(35, 190, coastDistance)) * (1 - smoothstep(0.5, 0.72, sample.ruggedness)),
    cliffWeight = smoothstep(0.55, 0.79, sample.ruggedness);
  base = blendColor(base, TERRAIN_PALETTE.beach, coastWeight * 0.92);
  base = blendColor(base, TERRAIN_PALETTE.cliff, cliffWeight * 0.82);

  const highlandWeight = Math.max(
      smoothstep(130, 235, elevation),
      smoothstep(0.13, 0.34, macro.mountainIntensity),
    ),
    mountainBase = macro.volcanic ? TERRAIN_PALETTE.volcanic : TERRAIN_PALETTE.highland;
  base = blendColor(base, mountainBase, highlandWeight * (macro.volcanic ? 0.96 : 0.72));

  const snowWeight =
      (1 - smoothstep(5, 9, temperature)) * smoothstep(sample.snowLineM - 55, sample.snowLineM + 55, elevation),
    latitude01 = Math.abs(position.lat) / (Math.PI / 2),
    polarDelta = latitude01 - polarBoundaryAt(position),
    polarWeight = smoothstep(-0.025, 0.02, polarDelta),
    polarBase = temperature < -11 || elevation > Math.max(120, sample.snowLineM * 0.5)
      ? TERRAIN_PALETTE["polar-ice"]
      : TERRAIN_PALETTE.tundra;
  base = blendColor(base, TERRAIN_PALETTE["snowy-mountain"], snowWeight);
  base = blendColor(base, polarBase, polarWeight);

  const protectedSurface = snowWeight > 0.65 || polarWeight > 0.65,
    tint = varyColor(base, variation * (protectedSurface ? 0.3 : 1));
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
  const waterTint = (x: number, z: number): RGB => {
    // Visible water uses exactly the same composed color as the globe. Ground
    // below land is occluded; retain a smooth canonical ice margin there too.
    if (heightAt(x, z) <= 0) return terrainTint(x, z);
    const position = sourceToLonLat(x, z);
    return blendColor(TERRAIN_PALETTE.ocean, TERRAIN_PALETTE["sea-ice"],
      smoothstep(-0.018, 0.018, Math.abs(position.lat)/(Math.PI/2)-polarBoundaryAt(position)));
  };
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
  // Source-coordinate UVs survive ENU conversion, rebasing and patch yaw.
  // Keep seam endpoints 0/1 rather than wrapping within a triangle.
  const uvs = new Float32Array((terrain.p.length / 3) * 2);
  for (let i = 0, v = 0; i < terrain.p.length; i += 3, v += 2) {
    uvs[v] = terrain.p[i] / SOURCE_PRESENTATION_WIDTH + 0.5;
    uvs[v + 1] = Math.max(0, Math.min(1, 0.5 + terrain.p[i + 2] * 2 / SOURCE_PRESENTATION_WIDTH));
  }
  for (const builder of [terrain, structures, nature, detail])
    builder.relativeTo(originX, originZ);
  return {
    terrain: { ...terrain.finish(), uvs },
    structures: structures.finish(),
    nature: nature.finish(),
    detail: detail.finish(),
  };
}
