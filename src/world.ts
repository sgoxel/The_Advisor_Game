/** World authority. Pure coordinate functions; no RNG, mutable sequence or wall clock. */
import { WORLD_FOUNDATION_VERSION, WORLD_SEED, COARSE_GEOGRAPHY_VERSION } from "./config.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  canonicalCellId,
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import { streamingBudgetForViewport } from "./streaming.ts";
import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";
import { settlementExteriorFor, type SettlementPlotPlan, type SettlementService } from "./settlement-exterior.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { freshwaterCrossingAt, drainageCoarseSegments, naturalSurfaceAt } from "./hydrology.ts";
import {
  WORLD_BUILDING_PRIORITIES,
  compareSurfaceModifiers,
  composeFinalSurface,
  type FinalSurface,
  type SurfaceBase,
  type SurfaceMaterial,
  type SurfaceModifier,
} from "./final-surface.ts";
export { WORLD_SEED } from "./config.ts";
export const GENERATOR_VERSION = WORLD_FOUNDATION_VERSION;
export const WORLD_SIZE = 262144;
export const WORLD_MIN = -WORLD_SIZE / 2;
export const CELL_SIZE = 2;
export const MAX_LEVEL = 17; // Finest render tile and logical cell are both 2 × 2 source units.
export type Tile = {
  level: number;
  x: number;
  z: number;
  key: string;
  size: number;
  minX: number;
  minZ: number;
};
export type Feature = {
  kind: "house" | "keep" | "tree" | "rock" | "field" | "well" | "service" | "street" | "border" | "gate" | "guard-post";
  x: number;
  z: number;
  y: number;
  code: string;
  variant: number;
  service?: SettlementService;
  ownerId?: string;
  capacity?: number;
  residents?: number;
  label?: string;
  entranceX?: number;
  entranceZ?: number;
};
export type Cell = {
  code: string;
  x: number;
  z: number;
  elevation: number;
  biome: string;
  walkable: boolean;
  tile: string;
};
export type ProvinceSeed = {
  code: string;
  x: number;
  z: number;
  domain: "Mainland" | "Archipelago";
  elevationLimit: number;
};
export type RegionSeed = {
  code: string;
  x: number;
  z: number;
  landform: "Mainland" | "Island" | "Ocean" | "Lake";
  radius: number;
  elevationLimit: number;
  parent: ProvinceSeed;
};
export type DistrictSeed = {
  code: string;
  x: number;
  z: number;
  parent: RegionSeed;
  coastOffset: number;
  beachWidth: number;
};
export type PatchSeed = {
  code: string;
  x: number;
  z: number;
  parent: DistrictSeed;
  grain: number;
};

/** Stable integer coordinate digest. A content lookup, never a pseudorandom stream.
 * Digests can collide; coordinate-containing canonical codes are the actual identities. */
export function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export const SEED_VALUE = digest(`${WORLD_SEED}/${GENERATOR_VERSION}`);
const COORDINATE_LAYOUT_SEED_VALUE = digest(`${WORLD_SEED}/${COARSE_GEOGRAPHY_VERSION}`);
/** Five nested source-detail levels. Macro landform authority lives above them. */
export function provinceSeed(cx: number, cz: number): ProvinceSeed {
  const x = Math.floor(cx / 1000),
    z = Math.floor(cz / 1000),
    code = `${WORLD_SEED}/${GENERATOR_VERSION}/L1/${x}/${z}`,
    macro = macroSampleAt(sourceToLonLat(x * 2000 + 1000, z * 2000 + 1000));
  return {
    code,
    x,
    z,
    domain: macro.domain === "Mainland" ? "Mainland" : "Archipelago",
    elevationLimit: 620,
  };
}
// Neighbouring samples almost always share a region: remember the last one built.
let lastRegion: RegionSeed | undefined;
export function regionSeed(cx: number, cz: number): RegionSeed {
  const x = Math.floor(cx / 100),
    z = Math.floor(cz / 100);
  if (lastRegion && lastRegion.x === x && lastRegion.z === z) return lastRegion;
  const parent = provinceSeed(cx, cz),
    code = `${parent.code}/L2/${x - parent.x * 10}/${z - parent.z * 10}`,
    macro = macroSampleAt(sourceToLonLat(x * 200 + 100, z * 200 + 100));
  return (lastRegion = {
    code,
    x,
    z,
    landform: macro.domain,
    // Retained only as source-detail metadata; it no longer controls island geometry.
    radius: 64 + (digest(code) % 12),
    elevationLimit:
      macro.domain === "Mainland" ? 620 : macro.domain === "Island" ? 180 : 0,
    parent,
  });
}
export function districtSeed(cx: number, cz: number): DistrictSeed {
  const parent = regionSeed(cx, cz),
    x = Math.floor(cx / 10) - parent.x * 10,
    z = Math.floor(cz / 10) - parent.z * 10;
  const code = `${parent.code}/L3/${x}/${z}`,
    value = digest(code);
  return {
    code,
    x,
    z,
    parent,
    coastOffset: (value % 13) - 6,
    beachWidth: 3 + ((value >>> 8) % 4),
  };
}
export function patchSeed(cx: number, cz: number): PatchSeed {
  const parent = districtSeed(cx, cz),
    x = Math.floor(cx / 2) - (parent.parent.x * 50 + parent.x * 5),
    z = Math.floor(cz / 2) - (parent.parent.z * 50 + parent.z * 5);
  const code = `${parent.code}/L4/${x}/${z}`;
  return { code, x, z, parent, grain: digest(code) % 5 };
}
export function cellSeed(cx: number, cz: number) {
  const parent = patchSeed(cx, cz),
    x = cx - Math.floor(cx / 2) * 2,
    z = cz - Math.floor(cz / 2) * 2;
  const code = `${parent.code}/L5/${x}/${z}`;
  return {
    code,
    x,
    z,
    parent,
    surface: (parent.grain + (digest(code) % 3)) % 5,
  };
}
/** Signed macro coast margin in source/render units. Positive is dry land. */
export function islandCoast(x: number, z: number, _region?: RegionSeed) {
  return macroSampleAt(sourceToLonLat(x, z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}
export function coordinateValue(x: number, z: number, layer: number): number {
  let n =
    COORDINATE_LAYOUT_SEED_VALUE ^
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(layer, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export function field(
  x: number,
  z: number,
  spacing: number,
  layer: number,
): number {
  const gx = Math.floor(x / spacing),
    gz = Math.floor(z / spacing);
  const tx = smooth(x / spacing - gx),
    tz = smooth(z / spacing - gz);
  const at = (a: number, b: number) =>
    (coordinateValue(a, b, layer) % 10001) / 10000;
  return lerp(
    lerp(at(gx, gz), at(gx + 1, gz), tx),
    lerp(at(gx, gz + 1), at(gx + 1, gz + 1), tx),
    tz,
  );
}
export function settlement(
  sx: number,
  sz: number,
): { x: number; z: number; name: string } {
  const v = coordinateValue(sx, sz, 10);
  return {
    x: sx * 512,
    z: sz * 512,
    name:
      sx === 0 && sz === 0
        ? "Alderwick"
        : [
            "Briarford",
            "Greyhaven",
            "Oakmere",
            "Westwatch",
            "Ashbourne",
            "Thornfield",
          ][v % 6],
  };
}

/** Explicit crossings use existing priority-4 water, never water invented for roads. */
export const RURAL_BRIDGE_MAX_LENGTH_M = 120;
let evidenceAnchors: {bridge:{x:number;z:number};road:{x:number;z:number};terrace:{x:number;z:number};vegetationBoundary:{x:number;z:number};roadCode:string;villageCode:string;bridgeSpanM:number}|undefined;
export function finalSurfaceEvidenceAnchors() {
  if(evidenceAnchors)return evidenceAnchors;
  const village=places.find(p=>p.kind==='village')!;
  for(const road of roads){
    const path=road.centerline || [{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}];
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],rx=wrapSourceX(b.x-a.x),rz=b.z-a.z;
      for(const stream of drainageCoarseSegments){
        const sx=wrapSourceX(stream.bx-stream.ax),sz=stream.bz-stream.az,qx=wrapSourceX(stream.ax-a.x),qz=stream.az-a.z,den=rx*sz-rz*sx;
        if(Math.abs(den)<1e-9)continue;
        const t=(qx*sz-qz*sx)/den,u=(qx*rz-qz*rx)/den;
        if(t<0||t>1||u<0||u>1)continue;
        const bridge={x:wrapSourceX(a.x+rx*t),z:a.z+rz*t},surface=finalSurfaceAt(bridge.x,bridge.z),crossing=freshwaterCrossingAt(bridge.x,bridge.z,rx,rz);
        if(surface.water.kind!=='river'||surface.deckHeight===null||!crossing||crossing.spanM>RURAL_BRIDGE_MAX_LENGTH_M)continue;
        const length=Math.hypot(rx,rz)||1;
        evidenceAnchors={bridge,road:{x:bridge.x+rx/length*40,z:bridge.z+rz/length*40},terrace:{x:village.x,z:village.z},vegetationBoundary:{x:village.x+102,z:village.z},roadCode:road.code,villageCode:village.code,bridgeSpanM:crossing.spanM};
        return evidenceAnchors;
      }
    }
  }
  throw new Error('No legal existing natural river crossing available for evidence');
}
function naturalSurfaceBaseAt(x:number,z:number):SurfaceBase {
  const natural=naturalSurfaceAt(x,z);
  return {groundHeight:natural.groundHeight,material:natural.material,water:natural.water,walkable:natural.walkable,vegetationDensityScale:natural.vegetationDensityScale,reservedUse:null};
}

const ROAD_SUPPORT_RADIUS = 12;
const ROAD_BUCKET_SIZE = 2048;
const surfaceRoadBuckets = new Map<string, Road[]>();
const roadBucketKey = (bx: number, bz: number) => `${bx}/${bz}`;
for (const road of roads) {
  for (const shiftX of [-WORLD_SIZE, 0, WORLD_SIZE]) {
    const minBX = Math.floor((road.minX + shiftX - ROAD_SUPPORT_RADIUS) / ROAD_BUCKET_SIZE),
      maxBX = Math.floor((road.maxX + shiftX + ROAD_SUPPORT_RADIUS) / ROAD_BUCKET_SIZE),
      minBZ = Math.floor((road.minZ - ROAD_SUPPORT_RADIUS) / ROAD_BUCKET_SIZE),
      maxBZ = Math.floor((road.maxZ + ROAD_SUPPORT_RADIUS) / ROAD_BUCKET_SIZE);
    for (let bz = minBZ; bz <= maxBZ; bz++)
      for (let bx = minBX; bx <= maxBX; bx++) {
        const key = roadBucketKey(bx, bz),
          bucket = surfaceRoadBuckets.get(key) || [];
        bucket.push(road);
        surfaceRoadBuckets.set(key, bucket);
      }
  }
}
for (const bucket of surfaceRoadBuckets.values())
  bucket.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

function surfaceRoadAt(x: number, z: number, clearance = ROAD_SUPPORT_RADIUS) {
  const wrappedX = wrapSourceX(x),
    bx = Math.floor(wrappedX / ROAD_BUCKET_SIZE),
    bz = Math.floor(z / ROAD_BUCKET_SIZE),
    reach = clearance > ROAD_SUPPORT_RADIUS ? Math.ceil(clearance / ROAD_BUCKET_SIZE) : 0;
  let bucket = surfaceRoadBuckets.get(roadBucketKey(bx, bz)) || [];
  if (reach) {
    const candidates = new Set<Road>();
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++)
        for (const road of surfaceRoadBuckets.get(roadBucketKey(bx + dx, bz + dz)) || [])
          candidates.add(road);
    bucket = [...candidates];
  }
  let road: Road | undefined,
    distance = clearance;
  for (const candidate of bucket) {
    const candidateDistance = roadDistanceAt(wrappedX, z, candidate);
    if (
      candidateDistance < distance ||
      (candidateDistance === distance && (!road || candidate.code < road.code))
    ) {
      road = candidate;
      distance = candidateDistance;
    }
  }
  // A search bound is not a measured distance to a road. Returning the bound
  // here rejected every house/field whose clearance was >= that bound.
  return { road, distance: road ? distance : Infinity, candidateCount: bucket.length };
}

const settlementTerraceHeights = new Map<string, number>();
function settlementTerraceHeight(place: Place) {
  let value = settlementTerraceHeights.get(place.code);
  if (value === undefined) {
    value = naturalSurfaceBaseAt(place.x, place.z).groundHeight;
    settlementTerraceHeights.set(place.code, value);
  }
  return value;
}

function roadTangentAt(x:number,z:number,road:Road) {
  const path=road.centerline || [{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}];
  let best=Infinity,result={x:wrapSourceX(road.toX-road.fromX),z:road.toZ-road.fromZ,cx:x,cz:z};
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,qx=wrapSourceX(x-a.x),qz=z-a.z,t=Math.max(0,Math.min(1,(qx*dx+qz*dz)/(dx*dx+dz*dz||1))),distance=Math.hypot(qx-dx*t,qz-dz*t);
    if(distance<best){best=distance;result={x:dx,z:dz,cx:wrapSourceX(a.x+dx*t),cz:a.z+dz*t};}
  }
  return result;
}
const roadProfileHeights = new Map<string, readonly [number, number]>();
function roadProfileHeightAt(x: number, z: number, road: Road) {
  let profile = roadProfileHeights.get(road.code);
  if (!profile) {
    profile = [
      naturalSurfaceBaseAt(road.fromX, road.fromZ).groundHeight,
      naturalSurfaceBaseAt(road.toX, road.toZ).groundHeight,
    ];
    roadProfileHeights.set(road.code, profile);
  }
  const px = road.fromX + wrapSourceX(x - road.fromX),
    vx = road.toX - road.fromX,
    vz = road.toZ - road.fromZ,
    lengthSq = vx * vx + vz * vz,
    t = lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - road.fromX) * vx + (z - road.fromZ) * vz) / lengthSq),
        );
  return lerp(profile[0], profile[1], t);
}

const boundedEarthwork = (
  desired: number,
  existing: number,
  maxCut: number,
  maxFill: number,
) => Math.max(existing - maxCut, Math.min(existing + maxFill, desired));

function surfaceModifiersAt(x: number, z: number, base: SurfaceBase) {
  const modifiers: SurfaceModifier[] = [],
    place = nearestPlace(x, z),
    roadMatch = surfaceRoadAt(x, z);
  if (place) {
    const dx = wrapSourceX(x - place.x),
      dz = z - place.z,
      distance = Math.hypot(dx, dz),
      radius = place.kind === "city" ? 430 : 90,
      weight = 1 - smooth(clamp01((distance - radius) / 80)),
      terraceHeight = boundedEarthwork(
        settlementTerraceHeight(place),
        base.groundHeight,
        3,
        3,
      );
    if (weight > 0)
      modifiers.push({
        id: `${place.code}/PAD`,
        priority:
          place.kind === "city"
            ? WORLD_BUILDING_PRIORITIES.city
            : WORLD_BUILDING_PRIORITIES.village,
        weight,
        targetGroundHeight: terraceHeight,
        material: "Settlement",
        walkable: true,
        vegetationDensityScale: 0,
        reservedUse: place.code,
      });

    // The existing seeded keep is the representative priority-9 critical site.
    // It has its own small pad/reservation and therefore proves that sites can
    // deterministically override city/village/road ownership without a second
    // height/material authority.
    const siteX = place.x - 30,
      siteZ = place.z - 28,
      siteDistance = Math.hypot(wrapSourceX(x - siteX), z - siteZ),
      siteWeight = 1 - smooth(clamp01((siteDistance - 10) / 6));
    if (siteWeight > 0)
      modifiers.push({
        id: `${place.code}/SITE/KEEP`,
        priority: WORLD_BUILDING_PRIORITIES.site,
        weight: siteWeight,
        targetGroundHeight: terraceHeight,
        material: "Settlement",
        walkable: true,
        vegetationDensityScale: 0,
        reservedUse: `${place.code}/SITE/KEEP`,
      });
  }

  const road = roadMatch.road;
  if (road) {
    const distance = roadMatch.distance,
      weight = 1 - smooth(clamp01((distance - 5) / 7)),
      initialRoadHeight = boundedEarthwork(
        roadProfileHeightAt(x, z, road),
        base.groundHeight,
        4,
        3,
      ),
      tangent = roadTangentAt(x,z,road),
      crossing = freshwaterCrossingAt(tangent.cx,tangent.cz,tangent.x,tangent.z),
      pierM = crossing ? Math.min(5,(RURAL_BRIDGE_MAX_LENGTH_M-crossing.spanM)/2) : 0;
    let roadHeight=initialRoadHeight,deckHeight:number|undefined;
    if(crossing&&distance<=5){
      const left=crossing.lo-pierM/crossing.metresPerUnit,right=crossing.hi+pierM/crossing.metresPerUnit,
        support=(t:number)=>{const px=tangent.cx+crossing.ux*t,pz=tangent.cz+crossing.uz*t,surface=naturalSurfaceBaseAt(px,pz);return {surface,height:Math.max(crossing.waterLevel+1,boundedEarthwork(roadProfileHeightAt(px,pz,road),surface.groundHeight,4,3))};},
        a=support(left),b=support(right),legal=a.surface.water.kind==='none'&&b.surface.water.kind==='none'&&a.height<=a.surface.groundHeight+3&&b.height<=b.surface.groundHeight+3&&Math.abs(b.height-a.height)/((right-left)*crossing.metresPerUnit)<=.08;
      if(legal){
        if(left<=0&&right>=0)deckHeight=lerp(a.height,b.height,-left/(right-left));
        else if(base.water.kind==='none'){
          const gapM=Math.max(left,-right)*crossing.metresPerUnit;
          if(gapM<24){const supportHeight=left>0?a.height:b.height;roadHeight=boundedEarthwork(lerp(supportHeight,roadHeight,smooth(clamp01(gapM/24))),base.groundHeight,4,3);}
        }
      }
    }
    if (weight > 0)
      modifiers.push({
        id: road.code,
        priority: WORLD_BUILDING_PRIORITIES.road,
        weight,
        targetGroundHeight: roadHeight,
        material: "Road",
        walkable: true,
        vegetationDensityScale: 0,
        reservedUse: road.code,
        deckHeight: deckHeight !== undefined && deckHeight >= base.groundHeight ? deckHeight : undefined,
      });
  }
  return {
    modifiers,
    candidateCount: roadMatch.candidateCount + (place ? 2 : 0),
  };
}

function composePointAt(x: number, z: number) {
  const base = naturalSurfaceBaseAt(x, z),
    modifierQuery = surfaceModifiersAt(x, z, base);
  return {
    base,
    modifiers: modifierQuery.modifiers,
    candidateCount: modifierQuery.candidateCount,
    final: composeFinalSurface(base, modifierQuery.modifiers),
  };
}

const FINAL_SURFACE_CACHE_LIMIT = 4096;
const finalSurfaceCache = new Map<string, FinalSurface>();
let finalSurfaceQueries = 0,
  finalSurfaceCacheHits = 0,
  finalSurfaceCacheMisses = 0,
  finalSurfaceModifierCandidates = 0,
  finalSurfaceWorstCandidates = 0;

function surfaceCacheKey(x: number, z: number) {
  return `${GENERATOR_VERSION}/${x}/${z}`;
}

/** One player-relevant final surface for render, collision, vegetation and routing. */
export function finalSurfaceAt(x: number, z: number): FinalSurface {
  finalSurfaceQueries++;
  const key = surfaceCacheKey(x, z),
    cached = finalSurfaceCache.get(key);
  if (cached) {
    finalSurfaceCacheHits++;
    return cached;
  }
  finalSurfaceCacheMisses++;
  const point = composePointAt(x, z);
  finalSurfaceModifierCandidates += point.candidateCount;
  finalSurfaceWorstCandidates = Math.max(finalSurfaceWorstCandidates, point.candidateCount);

  const sx = composePointAt(x + 1, z).final.groundHeight - composePointAt(x - 1, z).final.groundHeight,
    sz = composePointAt(x, z + 1).final.groundHeight - composePointAt(x, z - 1).final.groundHeight,
    latitude=sourceToLonLat(x,z).lat,
    slope = Math.hypot(sx/Math.max(.1,Math.abs(Math.cos(latitude))),sz)/(2*CANONICAL_METRES_PER_SOURCE_UNIT),
    walkable =
      point.final.water.kind === "none"
        ? point.final.walkable && (point.final.deckHeight!==null || slope < .68)
        : point.final.deckHeight !== null && point.final.walkable;
  const result: FinalSurface = {
    ...point.final,
    walkable,
    traversal: !walkable?"blocked":(point.final.traversal==="open"&&slope>.15)||(point.final.traversal==="road"&&slope>.08)?"difficult":point.final.traversal,
  };
  finalSurfaceCache.set(key, result);
  if (finalSurfaceCache.size > FINAL_SURFACE_CACHE_LIMIT)
    finalSurfaceCache.delete(finalSurfaceCache.keys().next().value!);
  return result;
}

/** Inspector/debug view of the exact before/modifier/final data for one coordinate. */
export function finalSurfaceDebugAt(x: number, z: number) {
  const point = composePointAt(x, z);
  return {
    base: point.base,
    modifiers: [...point.modifiers].sort(compareSurfaceModifiers),
    final: finalSurfaceAt(x, z),
    candidateCount: point.candidateCount,
  };
}

export function finalSurfaceTelemetry() {
  return {
    queries: finalSurfaceQueries,
    cacheHits: finalSurfaceCacheHits,
    cacheMisses: finalSurfaceCacheMisses,
    cacheSize: finalSurfaceCache.size,
    cacheLimit: FINAL_SURFACE_CACHE_LIMIT,
    modifierCandidatesExamined: finalSurfaceModifierCandidates,
    worstModifierCandidates: finalSurfaceWorstCandidates,
  };
}

export function resetFinalSurfaceTelemetry() {
  finalSurfaceQueries = 0;
  finalSurfaceCacheHits = 0;
  finalSurfaceCacheMisses = 0;
  finalSurfaceModifierCandidates = 0;
  finalSurfaceWorstCandidates = 0;
}

/** Ground mesh height. Explicit bridge decks are exposed by finalSurfaceAt/cellAt. */
export function heightAt(x: number, z: number): number {
  return finalSurfaceAt(x, z).groundHeight;
}
export function biomeAt(x: number, z: number): string {
  return finalSurfaceAt(x, z).material;
}

/**
 * Transitional equirectangular render patches are addressed by a canonical
 * cube-sphere anchor. The address is stable across wrap direction and visit
 * order; the patch rectangle remains disposable presentation data.
 */
function canonicalPatchKey(
  level: number,
  minX: number,
  minZ: number,
  size: number,
): string {
  const centre = sourceToLonLat(
      wrapSourceX(minX + size / 2),
      Math.max(
        -SOURCE_PRESENTATION_POLE_DISTANCE,
        Math.min(SOURCE_PRESENTATION_POLE_DISTANCE, minZ + size / 2),
      ),
    ),
    canonicalLevel = Math.min(24, level + 4);
  return `${canonicalCellId(
    centre.lon,
    centre.lat,
    canonicalLevel,
    WORLD_SEED,
    GENERATOR_VERSION,
  )}/PATCH`;
}

export function tileAt(level: number, x: number, z: number): Tile {
  const count = 2 ** level;
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > MAX_LEVEL ||
    !Number.isInteger(x) ||
    !Number.isInteger(z) ||
    x < 0 ||
    z < 0 ||
    x >= count ||
    z >= count
  )
    throw new RangeError("Tile outside world hierarchy");
  const size = WORLD_SIZE / count,
    minX = WORLD_MIN + x * size,
    minZ = WORLD_MIN + z * size;
  return {
    level,
    x,
    z,
    key: canonicalPatchKey(level, minX, minZ, size),
    size,
    minX,
    minZ,
  };
}
export function tileForPosition(x: number, z: number, level = MAX_LEVEL): Tile {
  if (x < WORLD_MIN || x >= -WORLD_MIN || z < WORLD_MIN || z >= -WORLD_MIN)
    throw new RangeError("Position outside generated realm");
  const size = WORLD_SIZE / 2 ** level;
  return tileAt(
    level,
    Math.floor((x - WORLD_MIN) / size),
    Math.floor((z - WORLD_MIN) / size),
  );
}
export function cellAt(x: number, z: number): Cell {
  const tile = tileForPosition(x, z),
    cx = Math.floor(x / CELL_SIZE),
    cz = Math.floor(z / CELL_SIZE),
    px = cx * CELL_SIZE + 1,
    pz = cz * CELL_SIZE + 1,
    surface = finalSurfaceAt(px, pz);
  return {
    code: cellSeed(cx, cz).code,
    x: cx,
    z: cz,
    elevation: surface.surfaceHeight,
    biome: surface.material,
    walkable: surface.walkable,
    tile: `${tile.level}/${tile.x}/${tile.z}`,
  };
}
/** Features are owned by their anchor tile; tile order/zoom never changes them. */
const settlementPlotAnchors = new Map<string, { x: number; z: number } | null>();

/** Tile-owned exterior features. Plan creation is deterministic and limited to nearby settlements. */
export function featuresFor(tile: Tile): Feature[] {
  const features: Feature[] = [];
  const plotAt = (kind: Feature["kind"], x: number, z: number) => {
    const surface = finalSurfaceAt(x, z);
    if (surface.groundHeight < .2 || surface.water.kind !== "none" || !surface.walkable) return null;
    if (["house", "keep", "well", "field", "service"].includes(kind)) {
      const radius = kind === "keep" ? 15 : kind === "field" ? 13 : kind === "house" ? 7 : kind === "service" ? 8 : 2;
      if (naturalSurfaceAt(x, z).freshwaterDistanceSource <= Math.SQRT2 * radius + 3.7 || surfaceRoadAt(x, z, radius + 5).distance <= radius + 5) return null;
      for (const [dx, dz] of [[-radius,-radius],[-radius,radius],[radius,radius],[radius,-radius],[0,-radius],[0,radius],[-radius,0],[radius,0]]) {
        const corner = finalSurfaceAt(x + dx, z + dz);
        if (corner.water.kind !== "none" || !corner.walkable || Math.abs(corner.groundHeight - surface.groundHeight) > (kind === "field" ? .1 : .25)) return null;
      }
    }
    return surface;
  };
  const add = (
    kind: Feature["kind"],
    x: number,
    z: number,
    variant: number,
    id: string,
    metadata: Partial<Pick<Feature, "service" | "ownerId" | "capacity" | "residents" | "label" | "entranceX" | "entranceZ">> = {},
  ) => {
    if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) return;
    const surface = plotAt(kind, x, z);
    if (!surface) return;
    if ((kind === "tree" || kind === "rock") && surface.vegetationDensityScale <= 0) return;
    features.push({ kind, x, z, y: surface.groundHeight, variant, code: WORLD_SEED + "/" + GENERATOR_VERSION + "/F/" + id, ...metadata });
  };
  const nearestStreetPoint = (place: Place, x: number, z: number) => {
    const plan = settlementExteriorFor(place);
    let best = { x: place.x, z: place.z }, distance = Infinity;
    for (const street of plan.streets) for (const point of street.points) {
      const candidate = Math.hypot(wrapSourceX(x - point.x), z - point.z);
      if (candidate < distance) { best = point; distance = candidate; }
    }
    return best;
  };
  const acceptedPlot = (plot: SettlementPlotPlan, featureKind: Feature["kind"]) => {
    if (settlementPlotAnchors.has(plot.id)) return settlementPlotAnchors.get(plot.id)!;
    const chosen = plot.candidates.find((candidate) => Boolean(plotAt(featureKind, candidate.x, candidate.z))) || null;
    settlementPlotAnchors.set(plot.id, chosen);
    return chosen;
  };

  for (const place of places) {
    const coarseExtent = place.kind === "city" ? 456 : 178,
      tileCentreX = tile.minX + tile.size * .5,
      tileCentreZ = tile.minZ + tile.size * .5;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + coarseExtent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + coarseExtent) continue;
    const plan = settlementExteriorFor(place), sx = Math.floor(place.x / 2), sz = Math.floor(place.z / 2);
    for (const street of plan.streets) for (let index = 0; index < street.points.length; index++) {
      const point = street.points[index];
      add("street", point.x, point.z, Math.max(9, Math.round(street.width + 5)), place.id + "/street/" + street.id + "/" + index);
    }
    for (let segment = 0; segment < plan.border.length; segment++) {
      const a = plan.border[segment], b = plan.border[(segment + 1) % plan.border.length],
        dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(length / 11));
      for (let step = 0; step < steps; step++) {
        const t = (step + .5) / steps, x = wrapSourceX(a.x + dx * t), z = a.z + dz * t;
        if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 18)) continue;
        add("border", x, z, place.kind === "city" ? 1 : 0, place.id + "/border/" + segment + "/" + step);
      }
    }
    for (const plot of plan.plots) {
      const featureKind: Feature["kind"] = plot.kind === "service" ? "service" : plot.kind;
      const point = acceptedPlot(plot, featureKind);
      if (!point) continue;
      const entrance = nearestStreetPoint(place, point.x, point.z);
      add(featureKind, point.x, point.z, coordinateValue(sx, sz, 40 + (digest(plot.id) % 500)), place.id + "/" + plot.id, {
        service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind, entranceX: entrance.x, entranceZ: entrance.z,
      });
    }
    for (const gate of plan.gates) {
      add("gate", gate.x, gate.z, digest(gate.id), place.id + "/gate/" + gate.id, { label: place.name + " gate", entranceX: place.x, entranceZ: place.z });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(gate.id + "/" + index), place.id + "/guard-post/" + gate.id + "/" + index, { service: "guard-office", capacity: 4, residents: 2, label: "Guard post", entranceX: gate.x, entranceZ: gate.z });
      }
    }
  }

  if (tile.size <= 256) {
    for (let gz = Math.floor(tile.minZ / 10) - 1; gz < (tile.minZ + tile.size) / 10 + 1; gz++) {
      for (let gx = Math.floor(tile.minX / 10) - 1; gx < (tile.minX + tile.size) / 10 + 1; gx++) {
        const v = coordinateValue(gx, gz, 30), x = gx * 10 + (v % 7) - 3, z = gz * 10 + ((v >>> 5) % 7) - 3, biome = biomeAt(x, z);
        if (biome === "Woodland" && v % 4 !== 0) add("tree", x, z, v, "tree/" + gx + "/" + gz);
        else if (!["Settlement", "Ocean", "Lake", "River", "Road", "Bridge"].includes(biome) && v % 31 === 0) add("rock", x, z, v, "rock/" + gx + "/" + gz);
      }
    }
  }
  return features;
}
export type View = {
  x: number;
  z: number;
  halfHeight: number;
  aspect: number;
  yaw: number;
  pixels: number;
};
/** Viewport bounds of the tilted orthographic camera, enlarged by one tile for prefetch. */
export function viewBounds(view: View) {
  const hw = view.halfHeight * view.aspect,
    hz = view.halfHeight / Math.sin(Math.PI / 3);
  const c = Math.abs(Math.cos(view.yaw)),
    s = Math.abs(Math.sin(view.yaw));
  const margin = Math.max(4, Math.min(48, view.halfHeight * 0.35));
  return { rx: hw * c + hz * s + margin, rz: hw * s + hz * c + margin };
}

function wrappedTileDistanceX(x: number, focusX: number): number {
  return Math.abs(wrapSourceX(x - focusX));
}

/** Exact-pole tangent coverage is a radial presentation ring, not world authority. */
const POLE_ACTIVE_PATCH_LIMIT = 16;

/**
 * Wrap-aware local patch selection. Near a pole, longitude convergence expands
 * the source-domain search so the tangent view receives a complete ring of
 * canonical coverage instead of a narrow equirectangular wedge.
 */
export function selectTiles(
  view: View,
  threshold = 190,
  activeLimit = streamingBudgetForViewport(
    view.pixels * view.aspect,
    view.pixels,
  ).activePatches,
): Tile[] {
  const bounds = viewBounds(view),
    focus = sourceToLonLat(view.x, view.z),
    atPole = Math.abs(Math.abs(focus.lat) - Math.PI / 2) <= 1e-12,
    selectionLimit = atPole
      ? Math.min(activeLimit, POLE_ACTIVE_PATCH_LIMIT)
      : activeLimit,
    streamX = atPole ? 0 : view.x,
    longitudeScale = Math.max(0.02, Math.abs(Math.cos(focus.lat))),
    rx = atPole
      ? WORLD_SIZE / 2
      : Math.min(WORLD_SIZE / 2, bounds.rx / longitudeScale),
    rz = bounds.rz,
    selected = new Map<string, Tile>(),
    centres = [streamX];

  if (streamX - rx < WORLD_MIN) centres.push(streamX + WORLD_SIZE);
  if (streamX + rx > -WORLD_MIN) centres.push(streamX - WORLD_SIZE);

  const visit = (t: Tile, centreX: number) => {
    const maxZ = t.minZ + t.size;
    // The S001 source plane extends past the canonical poles. Never stream
    // those invalid bands. Subdivide coarse crossing patches until the exact
    // level-2 pole boundaries can be selected without folded duplicates.
    if (
      t.minZ >= SOURCE_PRESENTATION_POLE_DISTANCE ||
      maxZ <= -SOURCE_PRESENTATION_POLE_DISTANCE
    )
      return;
    const crossesPole =
      t.minZ < -SOURCE_PRESENTATION_POLE_DISTANCE ||
      maxZ > SOURCE_PRESENTATION_POLE_DISTANCE;
    if (
      t.minX > centreX + rx ||
      t.minX + t.size < centreX - rx ||
      t.minZ > view.z + rz ||
      maxZ < view.z - rz
    )
      return;
    const projectedPixels = (t.size * view.pixels) / (view.halfHeight * 2);
    if (
      t.level < MAX_LEVEL &&
      (crossesPole || projectedPixels > threshold)
    ) {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++)
          visit(tileAt(t.level + 1, t.x * 2 + dx, t.z * 2 + dz), centreX);
    } else selected.set(t.key, t);
  };

  for (const centreX of centres) visit(tileAt(0, 0, 0), centreX);
  if (selected.size > selectionLimit)
    return selectTiles(view, threshold * 1.25, selectionLimit);

  return [...selected.values()].sort(
    (a, b) =>
      Math.hypot(
        wrappedTileDistanceX(a.minX + a.size / 2, streamX),
        a.minZ + a.size / 2 - view.z,
      ) -
      Math.hypot(
        wrappedTileDistanceX(b.minX + b.size / 2, streamX),
        b.minZ + b.size / 2 - view.z,
      ),
  );
}
