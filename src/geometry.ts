import {elevationToRenderY} from "./render-frame.ts";
import { featuresFor, field, type Tile } from "./world.ts";
import { continuitySurfaceAt as finalSurfaceAt, continuityHeightAt as heightAt, registerContinuityPatch } from "./continuity-runtime.ts";
import { roads } from "./geography.ts";
import { roadFragmentsInBounds, clippedStationRange } from "./continuity-corridor.ts";
import { naturalElevationAt, naturalSurfaceAt, freshwaterCrossingSpanMAt } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { sourceToLonLat, SOURCE_PRESENTATION_WIDTH, CANONICAL_METRES_PER_SOURCE_UNIT } from "./planet.ts";
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
  boxYaw(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    yaw: number,
    tint: RGB,
  ) {
    const c = Math.cos(yaw), s = Math.sin(yaw), t = y + h,
      at = (lx: number, lz: number, yy: number): Point => [x + lx * c + lz * s, yy, z - lx * s + lz * c],
      a = at(-w / 2, -d / 2, y), b = at(w / 2, -d / 2, y),
      c0 = at(w / 2, d / 2, y), d0 = at(-w / 2, d / 2, y),
      A = at(-w / 2, -d / 2, t), B = at(w / 2, -d / 2, t),
      C = at(w / 2, d / 2, t), D = at(-w / 2, d / 2, t);
    this.quad(a, A, B, b, tint);
    this.quad(b, B, C, c0, tint);
    this.quad(c0, C, D, d0, tint);
    this.quad(d0, D, A, a, tint);
    this.quad(A, D, C, B, tint);
  }
  roofYaw(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    yaw: number,
    tint: RGB,
  ) {
    const c = Math.cos(yaw), s = Math.sin(yaw),
      at = (lx: number, lz: number, yy: number): Point => [x + lx * c + lz * s, yy, z - lx * s + lz * c],
      l0 = at(-w / 2, -d / 2, y), l1 = at(-w / 2, d / 2, y),
      r0 = at(w / 2, -d / 2, y), r1 = at(w / 2, d / 2, y),
      p0 = at(0, -d / 2, y + h), p1 = at(0, d / 2, y + h);
    this.quad(l0, p0, p1, l1, tint);
    this.quad(r1, p1, p0, r0, tint);
    this.triangle(l0, r0, p0, tint);
    this.triangle(r1, l1, p1, tint);
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
 * Shared semantic material lookup. Realm and local LODs use the same final
 * surface channels; only bounded seed-derived detail frequency changes.
 */
export function terrainTint(
  x: number,
  z: number,
  scale = 32,
  elevationM?: number,
  featureFootprintSource = 0,
): [number, number, number] {
  const position = sourceToLonLat(x, z),
    macro = macroSampleAt(position),
    surface = finalSurfaceAt(x, z),
    elevation = elevationM ?? surface.groundHeight,
    sample = climateSampleAt(position, elevation);

  // Hydrology and prepared ground come from the composed surface, never from a
  // parallel river/road/settlement hit test in presentation code.
  if (surface.water.kind === "river" && !featureFootprintSource) return color(76, 128, 148);

  if (surface.water.kind === "none" && surface.groundMaterial === "Road")
    return color(112, 92, 62);

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
  // A village reservation clears vegetation but does not paint a bare dirt disc.
  // Its soil retains the natural palette; actual streets are painted separately.
  let result=tint;
  if(surface.groundMaterial==='Riverbank'){
    const natural=naturalSurfaceAt(x,z),bankWeight=Math.max(0,Math.min(1,(.9-natural.vegetationDensityScale)/.56));
    result=blendColor(result,color(151,143,99),bankWeight*.75);
    result=blendColor(result,TERRAIN_PALETTE.cliff,smoothstep(.25,.68,natural.slope)*.6);
  }
  if(surface.water.kind==='river'){
    // A sub-texel channel occupies a fraction of a coarse albedo texel; it must
    // not become a full lake-sized blue dot. This filters presentation only.
    const coverage=Math.min(1,freshwaterCrossingSpanMAt(x,z)/(CANONICAL_METRES_PER_SOURCE_UNIT*Math.max(1,featureFootprintSource)));
    result=blendColor(result,color(76,128,148),coverage);
  }
  if(macro.mountainIntensity>.15&&surface.water.kind==='none'){
    // Fixed coordinate hill shading reads the same natural relief at every LOD.
    const h=12,east=(naturalElevationAt(x+h,z)-naturalElevationAt(x-h,z))/(2*h*CANONICAL_METRES_PER_SOURCE_UNIT*Math.max(.1,Math.cos(position.lat))),
      south=(naturalElevationAt(x,z+h)-naturalElevationAt(x,z-h))/(2*h*CANONICAL_METRES_PER_SOURCE_UNIT),
      // Fixed cartographic relief lighting: exaggeration improves top-down
      // readability, while normalization avoids broad clipped light patches.
      gx=east*40,gz=south*40,
      shade=Math.max(.58,Math.min(1.25,(Math.SQRT1_2-(gx+gz)*.5)/(Math.SQRT1_2*Math.sqrt(1+gx*gx+gz*gz))));
    const reliefWeight=smoothstep(.15,.4,macro.mountainIntensity);
    result=result.map(v=>Math.max(0,Math.min(255,v*(1+(shade-1)*reliefWeight)))) as [number,number,number];
  }
  return result;
}

/** Worker-generated tile meshes. Skirts cover cracks between terrain LOD levels. */
export function buildTile(t: Tile): TileGeometry {
  registerContinuityPatch(t.minX + t.size / 2, t.minZ + t.size / 2);
  const terrain = new Builder(),
    structures = new Builder(),
    nature = new Builder(),
    detail = new Builder();
  // Prepared-surface refinement is owned by the common worker adapter.
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
    // Visible water follows the final hydrology channel even beneath bridge decks.
    if (finalSurfaceAt(x, z).water.kind !== "none") return terrainTint(x, z);
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
      const { x, z, variant: v } = f, y = elevationToRenderY(f.y);
      const stone = color(167, 165, 144),
        timber = color(75, 58, 43),
        plaster = color(210, 190, 145);
      if (f.kind === "house") {
        const yaw = f.yawRad || 0, w = f.footprintWidth || 6 + (v % 3), d = f.footprintDepth || 7 + ((v >>> 4) % 3),
          h = 3.8 + (v % 3) * .85, wall = (v & 4) ? color(196, 177, 137) : plaster;
        structures.boxYaw(x, y - .3, z, w, h + .3, d, yaw, wall);
        structures.roofYaw(x, y + h, z, w + 1, d + 1, 2.3 + (v % 4) * .25, yaw, color(104 + (v % 31), 62 + (v % 17), 45));
        if (t.size <= 64) {
          const c = Math.cos(yaw), s = Math.sin(yaw), off = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
          const door = off(0, d / 2 + .08), chimney = off(w * .3, -d * .22);
          detail.boxYaw(door.x, y, door.z, 1.15, 2.2, .16, yaw, timber);
          detail.boxYaw(chimney.x, y + h, chimney.z, .75, 1.7, .75, yaw, stone);
          for (const lx of [-w * .3, w * .3]) { const q = off(lx, d / 2 + .1); detail.boxYaw(q.x, y + 2.1, q.z, .85, .9, .12, yaw, color(57, 70, 61)); }
        }
      } else if (f.kind === "service") {
        const yaw = f.yawRad || 0, market = f.service === "market", smith = f.service === "blacksmith", inn = f.service === "inn",
          butcher = f.service === "butcher", guard = f.service === "guard-office", farm = f.service === "farmstead",
          w = f.footprintWidth || (market ? 18 : inn ? 13 : smith ? 13 : farm ? 18 : 10),
          d = f.footprintDepth || (market ? 13 : inn ? 16 : smith ? 12 : farm ? 15 : 11),
          h = market ? 3.4 : inn ? 7.1 : smith ? 4.8 : guard ? 6.7 : farm ? 4.2 : 4.6,
          wall = smith ? color(151, 144, 126) : guard ? stone : farm ? color(181, 158, 112) : plaster,
          roof = smith ? color(58, 63, 64) : guard ? color(67, 76, 80) : farm ? color(105, 72, 47) : color(128 + (v % 15), 72, 50);
        structures.boxYaw(x, y - .25, z, w, h + .25, d, yaw, wall);
        structures.roofYaw(x, y + h, z, w + 1.2, d + 1.2, market ? 1.8 : 2.5, yaw, roof);
        const c = Math.cos(yaw), s = Math.sin(yaw), off = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
        if (market) {
          for (const lx of [-5, 0, 5]) { const q = off(lx, d / 2 + 2.2); structures.boxYaw(q.x, y + .05, q.z, 3.6, 1.5, 2.8, yaw, color(169, 123 + (v % 18), 65)); }
          const pole = off(0, d / 2 + 4); detail.boxYaw(pole.x, y, pole.z, .18, 5.5, .18, yaw, timber);
        } else if (smith) {
          const yard = off(w / 2 + 3.2, 0), anvil = off(w / 2 + 2.2, d * .18), chimney = off(-w * .3, -d * .28);
          structures.boxYaw(yard.x, y + .02, yard.z, 5.4, .12, 6.4, yaw, color(103, 96, 79));
          detail.boxYaw(anvil.x, y + .2, anvil.z, 1.7, 1.1, 1.1, yaw, color(69, 72, 69));
          structures.boxYaw(chimney.x, y + h, chimney.z, 1.2, 3.8, 1.2, yaw, color(92, 91, 82));
        } else if (inn) {
          const wing = off(w * .42, -d * .2), sign = off(-w / 2 - .5, d * .28);
          structures.boxYaw(wing.x, y, wing.z, w * .55, 4.4, d * .55, yaw, color(202, 182, 137));
          detail.boxYaw(sign.x, y + 2.2, sign.z, .15, 3.5, .15, yaw, timber);
          detail.boxYaw(sign.x, y + 4.5, sign.z, 2.4, 1.1, .15, yaw, color(91, 67, 42));
        } else if (butcher) {
          const awning = off(0, d / 2 + 1.15);
          structures.boxYaw(awning.x, y + 2.7, awning.z, w * .8, .16, 2.2, yaw, color(152, 79, 63));
          for (const lx of [-w * .32, w * .32]) { const q = off(lx, d / 2 + 1.5); detail.boxYaw(q.x, y, q.z, .14, 2.8, .14, yaw, timber); }
        } else if (guard) {
          const tower = off(0, -d * .18);
          structures.boxYaw(tower.x, y + h * .45, tower.z, w * .62, 4.2, d * .62, yaw, stone);
          structures.cone(tower.x, y + h + 4.2, tower.z, Math.max(w, d) * .42, 2.8, color(70, 78, 81), 4);
        } else if (farm) {
          const barn = off(w * .55, -d * .2), shed = off(-w * .58, d * .22);
          structures.boxYaw(barn.x, y, barn.z, w * .72, 4.7, d * .82, yaw, color(132, 93, 58));
          structures.roofYaw(barn.x, y + 4.7, barn.z, w * .78, d * .9, 2.2, yaw, color(93, 64, 43));
          structures.boxYaw(shed.x, y, shed.z, w * .42, 2.9, d * .46, yaw, color(145, 113, 71));
        }
      } else if (f.kind === "street") {
        structures.boxYaw(x, y + .01, z, f.footprintWidth || Math.max(4, v / 10), .07, f.length || f.footprintDepth || 8, f.yawRad || 0, color(118, 96, 64));
      } else if (f.kind === "border") {
        const cityWall = v === 1;
        structures.boxYaw(x, y - .05, z, f.footprintWidth || (cityWall ? 1.6 : .9), cityWall ? 3.2 : 1.55, f.length || f.footprintDepth || 8, f.yawRad || 0, cityWall ? stone : timber);
      } else if (f.kind === "gate") {
        const yaw = f.yawRad || 0, c = Math.cos(yaw), s = Math.sin(yaw), off = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
        for (const lx of [-4.5, 4.5]) { const q = off(lx, 0); structures.boxYaw(q.x, y - .2, q.z, 1.5, 7.2, 1.5, yaw, stone); }
        structures.boxYaw(x, y + 5.7, z, 10.5, 1.3, 1.5, yaw, timber);
      } else if (f.kind === "guard-post") {
        const yaw = f.yawRad || 0;
        structures.boxYaw(x, y - .2, z, 4.5, 6.2, 4.5, yaw, stone);
        structures.roofYaw(x, y + 6, z, 5.2, 5.2, 2.2, yaw, color(72, 80, 82));
      } else if (f.kind === "keep") {
        const yaw = f.yawRad || 0, w = f.footprintWidth || 15, d = f.footprintDepth || 14;
        structures.boxYaw(x, y - .3, z, w, 10.3, d, yaw, stone);
        structures.roofYaw(x, y + 10, z, w + 1, d + 1, 4, yaw, color(65, 81, 88));
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
        const yaw = f.yawRad || 0, w = f.footprintWidth || 18, d = f.footprintDepth || 18, form = f.fieldForm || "strip",
          base = form === "pasture" ? color(125, 143, 78) : form === "orchard" ? color(126, 137, 70) : form === "vegetable" ? color(137, 121, 65) : color(158, 132, 66);
        structures.boxYaw(x, y + .03, z, w, .13, d, yaw, base);
        if (t.size <= 64) {
          const c = Math.cos(yaw), s = Math.sin(yaw), off = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
          if (form === "orchard") {
            for (let lx = -w * .32; lx <= w * .32; lx += Math.max(4, w / 4)) for (let lz = -d * .3; lz <= d * .3; lz += Math.max(4, d / 4)) { const q = off(lx, lz); detail.boxYaw(q.x, y + .08, q.z, .32, 1.6, .32, yaw, timber); detail.cone(q.x, y + 1.2, q.z, 1.2, 1.8, color(82, 120, 64), 6); }
          } else if (form === "pasture" || form === "paddock") {
            for (const lz of [-d / 2, d / 2]) { const q = off(0, lz); detail.boxYaw(q.x, y + .1, q.z, w, .18, .18, yaw, timber); }
            for (const lx of [-w / 2, w / 2]) { const q = off(lx, 0); detail.boxYaw(q.x, y + .1, q.z, .18, .18, d, yaw, timber); }
          } else {
            const rows = Math.max(4, Math.min(10, Math.floor(w / 2.2)));
            for (let row = 0; row < rows; row++) { const lx = -w * .42 + (row / Math.max(1, rows - 1)) * w * .84, q = off(lx, 0); detail.boxYaw(q.x, y + .16, q.z, .5, .38, d * .86, yaw, color(184, 158, 83)); }
          }
        }
      } else if (f.kind === "well" && t.size <= 64) {
        structures.box(x, y, z, 2.3, 1, 2.3, stone);
        detail.box(x, y + 1.02, z, 1.4, 0.04, 1.4, color(39, 59, 56));
        for (const ox of [-1.2, 1.2])
          detail.box(x + ox, y, z, 0.18, 3, 0.18, timber);
        detail.roof(x, y + 3, z, 3, 3, 1, color(116, 69, 47));
      }
    }
  // Bridge deck geometry is driven by the final deck channel. Ground/water stay
  // untouched, so a crossing cannot be accidentally rendered as a filled river.
  if (t.size <= 512)
    for (const road of roadFragmentsInBounds(roads,t.minX,t.minZ,t.size)) {
      const vx = road.toX - road.fromX,
        vz = road.toZ - road.fromZ,
        length = Math.hypot(vx, vz);
      if (!length) continue;
      const segmentCount = Math.max(1, Math.ceil(length / 2)),
        nx = (-vz / length) * 5,
        nz = (vx / length) * 5;
      for (const shiftX of [-SOURCE_PRESENTATION_WIDTH, 0, SOURCE_PRESENTATION_WIDTH]) {
        const minX = road.minX + shiftX,
          maxX = road.maxX + shiftX;
        if (
          maxX < t.minX - 6 ||
          minX > t.minX + t.size + 6 ||
          road.maxZ < t.minZ - 6 ||
          road.minZ > t.minZ + t.size + 6
        )
          continue;
        const [begin,end]=clippedStationRange(road.fromX+shiftX,road.fromZ,road.toX+shiftX,road.toZ,t.minX,t.minZ,t.size,segmentCount);
        for (let index = begin; index < end; index++) {
          const t0 = index / segmentCount,
            t1 = (index + 1) / segmentCount,
            x0 = road.fromX + shiftX + vx * t0,
            z0 = road.fromZ + vz * t0,
            x1 = road.fromX + shiftX + vx * t1,
            z1 = road.fromZ + vz * t1,
            mx = (x0 + x1) / 2,
            mz = (z0 + z1) / 2;
          if (
            mx < t.minX ||
            mx >= t.minX + t.size ||
            mz < t.minZ ||
            mz >= t.minZ + t.size
          )
            continue;
          const surface = finalSurfaceAt(mx, mz);
          if (surface.deckHeight === null) continue;
          const y = elevationToRenderY(surface.deckHeight + 0.1),
            deck = color(115, 88, 56);
          structures.quad(
            [x0 + nx, y, z0 + nz],
            [x1 + nx, y, z1 + nz],
            [x1 - nx, y, z1 - nz],
            [x0 - nx, y, z0 - nz],
            deck,
          );
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
