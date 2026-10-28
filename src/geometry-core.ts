import { roadWidthM, roadNormalSource } from "./road-dimensions.ts";
import { landformAt } from './wilderness-terrain.ts';
import {elevationToRenderY} from "./render-frame.ts";
import { metresToSource, sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { featuresFor, field, type Tile } from "./world.ts";
import { continuitySurfaceAt as finalSurfaceAt, registerContinuityPatch } from "./continuity-runtime.ts";
import { finalSurfaceRenderChannelsAt } from "./world-core.ts";
import { roads as geographyRoads } from "./geography.ts";
import { siteAccessRoads } from "./sites.ts";
import { forestTextureFor } from "./forest-texture.ts";
const roads = [...geographyRoads, ...siteAccessRoads];
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
  streetTrees?: Geometry;
  detail: Geometry;
  closeDetail?: Geometry;
  nightGlow?: Geometry;
  lampPools?: Geometry;
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
  origin = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 };
  placeAt(x: number, y: number, z: number, sourceZ: number, physical: boolean) {
    const scale = sourceUnitsPerMetreAt(sourceZ);
    this.origin = { x, y, z, sx: physical ? scale.x : 1, sy: metresToSource(1), sz: physical ? scale.z : 1 };
  }
  resetOrigin() { this.origin = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 }; }
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  i: number[] = [];
  triangle(a: Point, b: Point, c: Point, tint: RGB) {
    this.triangleGradient(a, b, c, tint, tint, tint);
  }
  triangleGradient(a: Point, b: Point, c: Point, tintA: RGB, tintB: RGB, tintC: RGB) {
    // The worker emits tens of thousands of triangles per tile. Keep the
    // original transform/cross-product evaluation order without allocating
    // three transformed points, a closure or temporary per-triangle vectors.
    const o = this.origin,
      ax = o.x + a[0] * o.sx, ay = o.y + a[1] * o.sy, az = o.z + a[2] * o.sz,
      bx = o.x + b[0] * o.sx, by = o.y + b[1] * o.sy, bz = o.z + b[2] * o.sz,
      cx = o.x + c[0] * o.sx, cy = o.y + c[1] * o.sy, cz = o.z + c[2] * o.sz,
      ux = bx - ax, uy = by - ay, uz = bz - az,
      vx = cx - ax, vy = cy - ay, vz = cz - az,
      nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      length = Math.hypot(nx, ny, nz) || 1,
      normalX = nx / length, normalY = ny / length, normalZ = nz / length,
      start = this.p.length / 3;
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.n.push(normalX, normalY, normalZ, normalX, normalY, normalZ, normalX, normalY, normalZ);
    this.c.push(tintA[0], tintA[1], tintA[2], 255,
      tintB[0], tintB[1], tintB[2], 255, tintC[0], tintC[1], tintC[2], 255);
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
 * Shared semantic material lookup. Realm and local LODs use the same final
 * surface channels; only bounded seed-derived detail frequency changes.
 */
export function terrainTint(
  x: number,
  z: number,
  scale = 32,
  elevationM?: number,
  featureFootprintSource = 0,
  showRoads = true,
  // Mesh sampling already owns these exact composed channels; reusing them
  // avoids a second expensive final-surface query for every emitted vertex.
  sampledSurface?: ReturnType<typeof finalSurfaceRenderChannelsAt>,
): [number, number, number] {
  const surface = sampledSurface ?? finalSurfaceRenderChannelsAt(x, z);
  // These SEED-owned materials have fixed colours. Resolve the canonical
  // surface first, and avoid expensive macro/climate fields for a result that
  // cannot use them. Nonuniform shoreline/water blends still use full climate.
  if (surface.water.kind === "river" && !featureFootprintSource) {
    const fall = landformAt(x, z);
    return fall?.f.kind === "waterfall" && Math.abs(fall.b) < 6
      ? color(211, 232, 228)
      : color(76, 128, 148);
  }
  const lakeLandform = surface.water.kind === "lake" && featureFootprintSource > 0
    ? landformAt(x, z) : undefined;
  if (surface.water.kind === "lake" && !lakeLandform) return [...TERRAIN_PALETTE.lake];
  if (showRoads && surface.water.kind === "none" && surface.groundMaterial === "Road")
    return color(112, 92, 62);

  const position = sourceToLonLat(x, z),
    macro = macroSampleAt(position),
    elevation = elevationM ?? surface.groundHeight,
    sample = climateSampleAt(position, elevation, macro);

  // Any lake with a nearby landform still needs its exact canonical forest
  // family to blend local land and water; it was not short-circuited above.
  if (surface.water.kind === "lake") {
    if (lakeLandform) {
      const coverage = Math.min(1, (lakeLandform.f.radiusM * 2 /
        (featureFootprintSource * CANONICAL_METRES_PER_SOURCE_UNIT)) ** 2 * .65),
        ground = sample.forestFamily === "conifer-boreal"
          ? TERRAIN_PALETTE["conifer-forest"]
          : sample.forestFamily ? TERRAIN_PALETTE["temperate-forest"] : TERRAIN_PALETTE.grassland;
      return blendColor(ground, TERRAIN_PALETTE.lake, coverage);
    }
    return [...TERRAIN_PALETTE.lake];
  }

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
  // The forest is terrain texture at every zoom: dark where forestTextureFor says tree stand,
  // plain grass where it says open (the 3D trees later pop up only out of the dark areas).
  // Prepared inhabited land and road/water exclusions fade the texture out through its density input.
  if(sample.forestFamily&&surface.water.kind==='none'&&surface.groundMaterial!=='Road'&&!protectedSurface){
    const stand=forestTextureFor(position,sample.forestFamily,surface.vegetationDensityScale),
      presence=smoothstep(.35,.9,surface.vegetationDensityScale),
      forest=sample.forestFamily==='conifer-boreal'?color(38,72,52):sample.forestFamily==='warm-dry-woodland'?color(92,106,60):color(54,98,52),
      open=varyColor(sample.forestFamily==='warm-dry-woodland'?TERRAIN_PALETTE.grassland:TERRAIN_PALETTE.meadow,variation);
    // Light areas fall back to grass instead of the forest-tinted climate base colour.
    result=blendColor(blendColor(result,open,(1-stand)*presence*.85),forest,stand*.9);
  }
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
  const formation=landformAt(x,z);
  if(formation&&surface.water.kind==='none'){
    const {f,a,b,r}=formation;
    if((f.kind==='cliff'||f.kind==='waterfall')&&Math.abs(b)<7)result=blendColor(result,TERRAIN_PALETTE.cliff,(1-r)*.95);
    const shade=1+(1-r)*(-a/f.radiusM*.35-b/f.radiusM*.25);
    result=result.map(v=>Math.max(0,Math.min(255,v*shade))) as [number,number,number];
  }
  return result;
}

/** Worker-generated tile meshes. Skirts cover cracks between terrain LOD levels. */
export function buildTile(t: Tile, options: {terrainOnly?:boolean;skipBaseTerrain?:boolean} = {}): TileGeometry {
  if (!options.terrainOnly) registerContinuityPatch(t.minX + t.size / 2, t.minZ + t.size / 2);
  const terrain = new Builder(),
    structures = new Builder(),
    nature = new Builder(),
    detail = new Builder();
  // Detail workers replace this coarse mesh with the complete canonical adaptive
  // natural surface. Skip only the disposable terrain pass; retain all sites,
  // structures, canonical registration and other layers unmodified.
  if (!options.skipBaseTerrain) {
  // Prepared-surface refinement is owned by the common worker adapter.
  const resolution = Math.min(options.terrainOnly ? 8 : 16, t.size / 2),
    step = t.size / resolution;
  // Each emitted grid coordinate has one exact SEED surface and one pigment.
  // The cache lives only for this tile build, with at most the bounded grid's
  // unique vertices; it never becomes world or Simulation authority.
  const gridSamples = new Map<string, {
    point: Point;
    surface: ReturnType<typeof finalSurfaceRenderChannelsAt>;
    tint?: RGB;
  }>();
  const point = (px:number,pz:number):Point => {
    const key = `${px}/${pz}`, cached = gridSamples.get(key);
    if (cached) return cached.point;
    const surface = finalSurfaceRenderChannelsAt(px,pz),
      p: Point = [px, options.terrainOnly && surface.water.kind !== 'none'
        ? surface.water.level : surface.groundHeight, pz];
    gridSamples.set(key, { point: p, surface });
    return p;
  };
  const tintAt = (p:Point):RGB => {
    // Every tint vertex was constructed by point() above: preserve the exact
    // original height, footprint and road flags for both tile kinds.
    const sampled = gridSamples.get(`${p[0]}/${p[2]}`)!;
    return sampled.tint ?? (sampled.tint = terrainTint(
      p[0], p[2], t.size, p[1], options.terrainOnly ? step : 0,
      !options.terrainOnly, sampled.surface,
    ));
  };
  // Refine only sharp material boundaries. Four bounded subdivision levels keep
  // thin shore margins from being stretched across an entire coarse quad.
  // This is presentation sampling; the detailed builder and authority stay unchanged.
  const coverageQuad = (x:number,z:number,size:number,depth=0):void => {
    const a=point(x,z),b=point(x,z+size),c=point(x+size,z+size),d=point(x+size,z);
    const colours=[tintAt(a),tintAt(b),tintAt(c),tintAt(d)];
    const range=Math.max(...[0,1,2].map(k=>Math.max(...colours.map(v=>v[k]))-Math.min(...colours.map(v=>v[k]))));
    if(depth<4 && range>10){
      const half=size/2;
      coverageQuad(x,z,half,depth+1);coverageQuad(x+half,z,half,depth+1);
      coverageQuad(x,z+half,half,depth+1);coverageQuad(x+half,z+half,half,depth+1);
    }else terrain.quadGradient(a,b,c,d,colours[0],colours[1],colours[2],colours[3]);
  };
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = t.minX + x * step,
        az = t.minZ + z * step;
      if(options.terrainOnly){coverageQuad(ax,az,step);continue;}
      const a = point(ax, az),
        b = point(ax, az + step),
        c = point(ax + step, az + step),
        d = point(ax + step, az);
      if (options.terrainOnly || Math.max(a[1], b[1], c[1], d[1]) > 0)
        terrain.quadGradient(
          a,
          b,
          c,
          d,
          tintAt(a),
          tintAt(b),
          tintAt(c),
          tintAt(d),
        );
      if (z === 0 && !options.terrainOnly)
        terrain.quad(
          a,
          d,
          [d[0], d[1] - 12, d[2]],
          [a[0], a[1] - 12, a[2]],
          tintAt(a),
        );
      if (z === resolution - 1 && !options.terrainOnly)
        terrain.quad(
          c,
          b,
          [b[0], b[1] - 12, b[2]],
          [c[0], c[1] - 12, c[2]],
          tintAt(c),
        );
      if (x === 0 && !options.terrainOnly)
        terrain.quad(
          b,
          a,
          [a[0], a[1] - 12, a[2]],
          [b[0], b[1] - 12, b[2]],
          tintAt(b),
        );
      if (x === resolution - 1 && !options.terrainOnly)
        terrain.quad(
          d,
          c,
          [c[0], c[1] - 12, c[2]],
          [d[0], d[1] - 12, d[2]],
          tintAt(d),
        );
    }
  // The water/ice plane is presentation-only and sits beneath land. Sample the same
  // canonical polar boundary at each corner so a tile cannot expose a rectangular ice edge.
  const waterTint = (x: number, z: number): RGB => {
    // Visible water follows the final hydrology channel even beneath bridge decks.
    if (finalSurfaceRenderChannelsAt(x, z).water.kind !== "none") return terrainTint(x, z);
    const position = sourceToLonLat(x, z);
    return blendColor(TERRAIN_PALETTE.ocean, TERRAIN_PALETTE["sea-ice"],
      smoothstep(-0.018, 0.018, Math.abs(position.lat)/(Math.PI/2)-polarBoundaryAt(position)));
  };
  if (!options.terrainOnly) terrain.quadGradient(
    [t.minX, 0, t.minZ],
    [t.minX, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ + t.size],
    [t.minX + t.size, 0, t.minZ],
    waterTint(t.minX, t.minZ),
    waterTint(t.minX, t.minZ + t.size),
    waterTint(t.minX + t.size, t.minZ + t.size),
    waterTint(t.minX + t.size, t.minZ),
  );
  }
  if (t.size <= 512 && !options.terrainOnly)
    // Settlement plots with physical metre sizes (widthM) are drawn by geometry.ts; never as legacy 18-unit fields.
    for (const f of featuresFor(t).filter(feature => feature.kind !== "keep" && feature.kind !== "well" && !(feature.kind === "field" && (feature as { widthM?: number }).widthM !== undefined))) {
      for (const builder of [structures, nature, detail]) builder.placeAt(f.x, elevationToRenderY(f.y), f.z, f.z, f.kind !== "field");
      const x = 0, z = 0, y = 0, v = f.variant;
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
        const climate = climateSampleAt(sourceToLonLat(f.x, f.z), f.y),
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
        // Agricultural plots are settlement geometry, not vegetation scatter.
        // The worker replaces the nature group with bounded instanced vegetation.
        structures.box(x, y + 0.03, z, 18, 0.15, 18, color(158, 132, 66));
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
  for (const builder of [structures, nature, detail]) builder.resetOrigin();
  // Bridge deck geometry is driven by the final deck channel. Ground/water stay
  // untouched, so a crossing cannot be accidentally rendered as a filled river.
  if (t.size <= 512 && !options.terrainOnly)
    for (const road of roadFragmentsInBounds(roads,t.minX,t.minZ,t.size)) {
      const vx = road.toX - road.fromX,
        vz = road.toZ - road.fromZ,
        length = Math.hypot(vx, vz);
      if (!length) continue;
      const segmentCount = Math.max(1, Math.ceil(length / 2)),
        // The same physical class width as the roadbed and transport record.
        normal = roadNormalSource(vx, vz, (road.fromZ + road.toZ) / 2, roadWidthM(road) / 2),
        nx = normal.x, nz = normal.z;
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
          // An unrelated adjacent road's legal deck must not paint a false
          // crossing for this segment. Only the source-owned road can draw it.
          if (surface.deckHeight === null || !surface.contributingModifierIds.includes(road.code)) continue;
          const start = finalSurfaceAt(x0, z0), end = finalSurfaceAt(x1, z1),
            y0 = elevationToRenderY((start.deckHeight ?? start.groundHeight) + 0.1),
            y1 = elevationToRenderY((end.deckHeight ?? end.groundHeight) + 0.1),
            deck = color(115, 88, 56);
          // Honour the real bank-to-bank gradient rather than lifting both
          // ends to the same midpoint elevation before fine refinement loads.
          structures.quad(
            [x0 + nx, y0, z0 + nz],
            [x1 + nx, y1, z1 + nz],
            [x1 - nx, y1, z1 - nz],
            [x0 - nx, y0, z0 - nz],
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
  // Terrain alpha is a presentation-only road coverage mask. RGB retains
  // natural soil so zoom can hide roads without new meshes or authority changes.
  for(let v=0;v<terrain.p.length/3;v++){
    const c=v*4,x=terrain.p[v*3],z=terrain.p[v*3+2];
    const road=!options.terrainOnly && terrain.c[c]===112&&terrain.c[c+1]===92&&terrain.c[c+2]===62&&finalSurfaceRenderChannelsAt(x,z).groundMaterial==="Road";
    if(road){const tint=terrainTint(x,z,32,undefined,0,false);terrain.c[c]=tint[0];terrain.c[c+1]=tint[1];terrain.c[c+2]=tint[2];}
    terrain.c[c+3]=road?255:0;
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
