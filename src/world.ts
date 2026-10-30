import { mainStreetLampAnchors } from "./street-lighting.ts";
import { roadWidthM } from "./road-dimensions.ts";
export * from "./world-core.ts";
import { buildingName, familyName, gateName, streetNames, wallName, type BuildingKind } from "./names.ts";

import {
  featuresFor as coreFeaturesFor,
  finalSurfaceAt,
  digest,
  WORLD_SEED,
  WORLD_SIZE,
  GENERATOR_VERSION,
  type Feature as CoreFeature,
  type Tile,
} from "./world-core.ts";
import { nearbyPlaces, roadDistanceAt, roads, type Place } from "./geography.ts";
import { settlementHomeIndicesNear, settlementLotCount, SETTLEMENT_POPULATION } from "./settlement-exterior-core.ts";
import { settlementExteriorFor, settlementHomeFor, settlementSpareHomeFor, settlementShopFor, visibleSettlementStreetSegments, GUARD_POST_BUILDING_WIDTH_M, type SettlementExteriorPlan, type SettlementPlotPlan } from "./settlement-exterior.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
import { wrapSourceX } from "./planet.ts";
import { canonicalRoadBucketCells, canonicalRoadBucketX } from "./road-spatial-index.ts";
import { metresToSource, sourceUnitsPerMetreAt, physicalFootprintRadius, type HouseDimensions } from "./physical-scale.ts";

type MorphologyKind = CoreFeature["kind"] | "residence" | "service" | "street" | "street-joint" | "border" | "gate" | "guard-post" | "garden" | "path" | "roadside-tree" | "street-lamp" | "bench" | "planter" | "park" | "yard-prop";
type MorphologyFeature = {
  kind: MorphologyKind;
  x: number;
  z: number;
  y: number;
  code: string;
  variant: number;
  service?: string;
  ownerId?: string;
  /** Street and street-joint only: pavement width on each side (source units). */
  pavementWidth?: number;
  /** Café or restaurant run from a resident home (residence features only). */
  shop?: "cafe" | "restaurant";
  capacity?: number;
  residents?: number;
  label?: string;
  entranceX?: number;
  entranceZ?: number;
  yawRad?: number;
  footprintWidth?: number;
  footprintDepth?: number;
  length?: number;
  fieldForm?: string;
  urban?: boolean;
  widthM?: number;
  depthM?: number;
  /** Park only: seeded outline ("rect" | "cut" | "octagon" | "round"); the footprint stays the widthM × depthM rectangle. */
  parkShape?: string;
  house?: HouseDimensions;
  /** Seeded proper name (names.ts): "The Gilded Boar", "Tanner's Lane", "Ashford House"… */
  name?: string;
};
type StreetHit = { id: string; width: number; distance: number; x: number; z: number };
type Resolved = { x: number; z: number } | null;
type Occupant = { x: number; z: number; radius: number };
type ResolvedSettlement = { staticAnchors: Map<string, Resolved>; staticOccupants: Occupant[]; homes: Map<string, Resolved>; homePlots?: Map<number, SettlementPlotPlan>; guardsReady?: boolean };

export const SETTLEMENT_PRESENTATION_CACHE_LIMIT = 12;
const MAX_CACHED_HOME_ANCHORS = 2560;
const resolvedSettlements = new Map<string, ResolvedSettlement>();
const ROAD_BUCKET_SIZE = 2048;
const ROAD_CLEARANCE_SUPPORT = 64;
/** A bend turns a street joint on only beyond this angle (2 degrees). */
const JOINT_TURN = Math.PI / 90;
/** Benches and planters alternate every 28 m along the main street and the first city ring. */
const FURNITURE_SPACING_M = 28;
/** Pavement on each side of city streets and village main streets, drawn as part of the street. */
const PAVEMENT_WIDTH_M = 1.8;
/** Household yard objects (metres, width across × depth along the object's own +z). Drawn by geometry.ts addYardProp. */
const YARD_PROP_SIZES = {
  woodpile: [1.9, 1.1], barrels: [1.3, .9], cart: [1.5, 2.4], washline: [3.2, .5], coop: [2.6, 2.2], "door-bench": [2.6, .6],
} as const;
type YardPropKind = keyof typeof YARD_PROP_SIZES;
const YARD_PROP_NAMES: Record<YardPropKind, string> = {
  woodpile: "Woodpile and chopping block", barrels: "Barrels", cart: "Hand cart", washline: "Washing line", coop: "Chicken coop", "door-bench": "Bench by the door",
};
/** Seeded yard choices per slot: [probability that the slot is used, weighted kinds]. Villages are busier than cities. */
const YARD_SLOTS: Record<"city" | "village", Record<"front" | "side" | "back", [number, [YardPropKind, number][]]>> = {
  village: { front: [.35, [["door-bench", 1]]], side: [.75, [["woodpile", .45], ["barrels", .3], ["cart", .25]]], back: [.7, [["washline", .45], ["coop", .35], ["cart", .2]]] },
  city: { front: [.2, [["door-bench", 1]]], side: [.5, [["barrels", .5], ["woodpile", .3], ["cart", .2]]], back: [.5, [["washline", .7], ["cart", .2], ["coop", .1]]] },
};
const externalRoadBuckets = new Map<string, (typeof roads)[number][]>();
const roadBucketKey = (bx: number, bz: number) => `${bx}/${bz}`;
for (const road of roads) {
  // Settlement clearance uses the same canonical, shortest-seam path as transport queries.
  // Index actual supported segments, never the empty middle of a long bounding rectangle.
  for (const [bx, bz] of canonicalRoadBucketCells(road, ROAD_BUCKET_SIZE, ROAD_CLEARANCE_SUPPORT, WORLD_SIZE)) {
    const key = roadBucketKey(bx, bz), bucket = externalRoadBuckets.get(key) || [];
    bucket.push(road); externalRoadBuckets.set(key, bucket);
  }
}

function closestPointOnSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = wrapSourceX(bx - ax), dz = bz - az, qx = wrapSourceX(x - ax), qz = z - az,
    denominator = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / denominator));
  return { x: wrapSourceX(ax + dx * t), z: az + dz * t, distance: Math.hypot(qx - dx * t, qz - dz * t) };
}
/**
 * Nearest settlement street. Searches the plan's 16 m street grid outward ring by ring and stops once
 * the covered radius exceeds the best distance; falls back to a full scan beyond four rings.
 */
function settlementStreetAt(plan: SettlementExteriorPlan, x: number, z: number): StreetHit | undefined {
  const grid = streetSegmentGrid(plan), rx = wrapSourceX(x - plan.centre.x), rz = z - plan.centre.z,
    cx = Math.floor(rx / STREET_CELL), cz = Math.floor(rz / STREET_CELL);
  let best: (StreetHit & { rx: number; rz: number }) | undefined;
  for (let ring = 0; ring <= 4; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      for (const entry of grid.get(streetCellKey(cx + dx, cz + dz)) || []) {
        const point = closestPointOnSegment(rx, rz, entry.ax, entry.az, entry.bx, entry.bz);
        if (!best || point.distance < best.distance || (point.distance === best.distance && entry.id < best.id))
          best = { id: entry.id, width: entry.reach * 2, distance: point.distance, x: 0, z: 0, rx: point.x, rz: point.z };
      }
    }
    // Every point closer than `ring` whole cells has been searched.
    if (best && best.distance <= ring * STREET_CELL) break;
  }
  if (!best || best.distance > 4 * STREET_CELL) return settlementStreetAtFull(plan, x, z);
  return { id: best.id, width: best.width, distance: best.distance, x: wrapSourceX(plan.centre.x + best.rx), z: plan.centre.z + best.rz };
}
function settlementStreetAtFull(plan: SettlementExteriorPlan, x: number, z: number): StreetHit | undefined {
  let best: StreetHit | undefined;
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], point = closestPointOnSegment(x, z, a.x, a.z, b.x, b.z);
    if (!best || point.distance < best.distance || (point.distance === best.distance && street.id < best.id)) best = { id: street.id, width: street.width, ...point };
  }
  return best;
}
function externalRoadClear(x: number, z: number, radius: number, includeCarriageway=false) {
  const wrappedX = wrapSourceX(x), bx = Math.floor(wrappedX / ROAD_BUCKET_SIZE), bz = Math.floor(z / ROAD_BUCKET_SIZE),
    reach = Math.max(0, Math.ceil(radius / ROAD_BUCKET_SIZE)), candidates = new Set<(typeof roads)[number]>();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++)
    for (const road of externalRoadBuckets.get(roadBucketKey(canonicalRoadBucketX(bx + dx, ROAD_BUCKET_SIZE, WORLD_SIZE), bz + dz)) || []) candidates.add(road);
  return [...candidates].every((road) => roadDistanceAt(wrappedX, z, road) > radius+(includeCarriageway?metresToSource(roadWidthM(road)/2):0));
}
function roadsideClear(plan:SettlementExteriorPlan,x:number,z:number,radiusM:number){
  const radius=metresToSource(radiusM),street=settlementStreetAt(plan,x,z);
  return (!street||street.distance>street.width/2+radius)&&externalRoadClear(x,z,radius,true);
}
function borderClearance(place: Place, plan: SettlementExteriorPlan, x: number, z: number) {
  const qx = wrapSourceX(x - place.x), qz = z - place.z, polygon = plan.border.map((point) => ({ x: wrapSourceX(point.x - place.x), z: point.z - place.z }));
  let inside = false, distance = Infinity;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length], dx = b.x - a.x, dz = b.z - a.z,
      denominator = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((qx - a.x) * dx + (qz - a.z) * dz) / denominator));
    distance = Math.min(distance, Math.hypot(qx - (a.x + dx * t), qz - (a.z + dz * t)));
    if ((a.z > qz) !== (b.z > qz)) {
      const crossingX = a.x + (qz - a.z) * dx / (b.z - a.z);
      if (qx < crossingX) inside = !inside;
    }
  }
  return inside ? distance : -distance;
}
/** A park's whole outline (every ~3 m plus the corners) must keep its street, a 1.8 m pavement and a 0.5 m margin away. */
function parkPerimeterClear(plan: SettlementExteriorPlan, widthM: number, depthM: number, yawRad: number, centre: { x: number; z: number }) {
  const metric = sourceUnitsPerMetreAt(centre.z), c = Math.cos(yawRad), s = Math.sin(yawRad), pavement = metresToSource(PAVEMENT_WIDTH_M + .5),
    clear = (u: number, v: number) => {
      // Local width coordinate u and depth coordinate v (metres) back to source units, the inverse of insideYawedRect.
      const street = settlementStreetAt(plan, wrapSourceX(centre.x + (u * c + v * s) * metric.x), centre.z + (-u * s + v * c) * metric.z);
      return !street || street.distance >= street.width * .5 + pavement;
    }, hw = widthM / 2, hd = depthM / 2, stepsU = Math.max(1, Math.ceil(widthM / 3)), stepsV = Math.max(1, Math.ceil(depthM / 3));
  for (let i = 0; i <= stepsU; i++) {
    const u = -hw + widthM * i / stepsU;
    if (!clear(u, -hd) || !clear(u, hd)) return false;
  }
  for (let i = 1; i < stepsV; i++) {
    const v = -hd + depthM * i / stepsV;
    if (!clear(-hw, v) || !clear(hw, v)) return false;
  }
  return true;
}
function candidateLegal(place: Place, plan: SettlementExteriorPlan, plot: SettlementPlotPlan, candidate: { x: number; z: number }) {
  const surface = finalSurfaceAt(candidate.x, candidate.z);
  if (surface.groundHeight < .2 || surface.water.kind !== "none" || !surface.walkable) return false;
  const radius = plot.clearanceRadius,
    // A park is a flat footprint: its reach from roads and streets is half its depth, not the circumscribed circle.
    reach = plot.kind === "park" && plot.depthM !== undefined ? metresToSource(plot.depthM * .5) : radius,
    roadReserve = reach + metresToSource(plot.kind === "house" ? 2 : 6);
  if (!externalRoadClear(candidate.x, candidate.z, roadReserve)) return false;
  const street = settlementStreetAt(plan, candidate.x, candidate.z);
  if (street && street.distance < street.width * .5 + (plot.kind === "park" ? reach : radius * .78)) return false;
  if (plot.kind === "park" && plot.widthM !== undefined && plot.depthM !== undefined && !parkPerimeterClear(plan, plot.widthM, plot.depthM, plot.yawRad, candidate)) return false;
  if (plot.kind !== "field" && plan.gates.some((gate) => Math.hypot(wrapSourceX(candidate.x - gate.x), candidate.z - gate.z) < radius + metresToSource(12))) return false;
  if (plot.kind !== "field" && borderClearance(place, plan, candidate.x, candidate.z) < radius + metresToSource(3)) return false;
  const sampleRadius = plot.kind === "house" ? Math.max(.24, Math.min(.58, radius * .62)) : plot.kind === "field" ? metresToSource(14) : Math.min(metresToSource(20), Math.max(metresToSource(4), radius * .55)),
    samples = plot.kind === "house" ? [[0, 0], [-sampleRadius, -sampleRadius], [sampleRadius, sampleRadius]] : [[0,0],[-sampleRadius,-sampleRadius],[-sampleRadius,sampleRadius],[sampleRadius,-sampleRadius],[sampleRadius,sampleRadius]];
  for (const [dx, dz] of samples) {
    const point = finalSurfaceAt(candidate.x + dx, candidate.z + dz);
    if (point.water.kind !== "none" || !point.walkable || Math.abs(point.groundHeight - surface.groundHeight) > (plot.kind === "field" ? .1 : .28)) return false;
  }
  if ((plot.kind === "house" || plot.kind === "service" || plot.kind === "park" || plot.kind === "keep") && street) {
    const midpoint = { x: wrapSourceX((candidate.x + street.x) * .5), z: (candidate.z + street.z) * .5 }, point = finalSurfaceAt(midpoint.x, midpoint.z);
    if (point.water.kind !== "none" || !point.walkable) return false;
  }
  return true;
}
function overlaps(occupants: readonly Occupant[], x: number, z: number, radius: number) {
  return occupants.some((other) => Math.hypot(wrapSourceX(x - other.x), z - other.z) < radius + other.radius);
}
type StreetSegmentEntry = { id: string; reach: number; ax: number; az: number; bx: number; bz: number };
const STREET_CELL = metresToSource(16);
const streetSegmentGrids = new WeakMap<SettlementExteriorPlan, Map<number, StreetSegmentEntry[]>>();
const streetCellKey = (cx: number, cz: number) => (cx + 1_000_000) * 2_000_003 + cz + 1_000_000;
/** Every street segment of a plan bucketed in 16 m cells, relative to the settlement centre. Cached per plan. */
function streetSegmentGrid(plan: SettlementExteriorPlan) {
  const cached = streetSegmentGrids.get(plan);
  if (cached) return cached;
  const grid = new Map<number, StreetSegmentEntry[]>();
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index],
      ax = wrapSourceX(a.x - plan.centre.x), az = a.z - plan.centre.z, bx = ax + wrapSourceX(b.x - a.x), bz = b.z - plan.centre.z,
      entry: StreetSegmentEntry = { id: street.id, reach: street.width * .5, ax, az, bx, bz };
    for (let cx = Math.floor(Math.min(ax, bx) / STREET_CELL); cx <= Math.floor(Math.max(ax, bx) / STREET_CELL); cx++)
      for (let cz = Math.floor(Math.min(az, bz) / STREET_CELL); cz <= Math.floor(Math.max(az, bz) / STREET_CELL); cz++) {
        const key = streetCellKey(cx, cz), bucket = grid.get(key) || [];
        bucket.push(entry);
        grid.set(key, bucket);
      }
  }
  streetSegmentGrids.set(plan, grid);
  return grid;
}
/** True when a point is closer than a street's half-width plus `slack` to any street of the plan other than `ownId`. */
function nearOtherStreet(plan: SettlementExteriorPlan, ownId: string, x: number, z: number, slack: number) {
  const grid = streetSegmentGrid(plan), rx = wrapSourceX(x - plan.centre.x), rz = z - plan.centre.z,
    cx = Math.floor(rx / STREET_CELL), cz = Math.floor(rz / STREET_CELL);
  // Reach (under 0.4 source units) is far below one cell, so the 3x3 neighbourhood holds every candidate segment.
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    for (const entry of grid.get(streetCellKey(cx + dx, cz + dz)) || []) {
      if (entry.id !== ownId && closestPointOnSegment(rx, rz, entry.ax, entry.az, entry.bx, entry.bz).distance < entry.reach + slack) return true;
    }
  return false;
}
/** Metre containment in a rectangle yawed by `yawRad` (depth along the yaw, width across it), as the lamp and house tests use. */
function insideYawedRect(x: number, z: number, cx: number, cz: number, yawRad: number, widthM: number, depthM: number, marginM: number) {
  const metric = sourceUnitsPerMetreAt(cz), dx = wrapSourceX(x - cx) / metric.x, dz = (z - cz) / metric.z, c = Math.cos(yawRad), s = Math.sin(yawRad);
  return Math.abs(dx * c - dz * s) < widthM / 2 + marginM && Math.abs(dx * s + dz * c) < depthM / 2 + marginM;
}
/** True when a point lies within `marginM` of a resident house footprint. Only homes near the point are resolved. */
function homeFootprintHit(place: Place, plan: SettlementExteriorPlan, resolution: ResolvedSettlement, x: number, z: number, marginM: number) {
  const metric = sourceUnitsPerMetreAt(z), reachX = 16 * metric.x, reachZ = 16 * metric.z;
  for (const index of settlementHomeIndicesNear(place, x - reachX, x + reachX, z - reachZ, z + reachZ)) {
    const plot = resolveHome(place, plan, resolution, index), home = resolution.homes.get(plot.id);
    if (home && plot.widthM !== undefined && plot.depthM !== undefined && insideYawedRect(x, z, home.x, home.z, plot.yawRad, plot.widthM, plot.depthM, marginM)) return true;
  }
  return false;
}
function rememberResolution(placeCode: string, resolution: ResolvedSettlement) {
  resolvedSettlements.delete(placeCode);
  resolvedSettlements.set(placeCode, resolution);
  while (resolvedSettlements.size > SETTLEMENT_PRESENTATION_CACHE_LIMIT) resolvedSettlements.delete(resolvedSettlements.keys().next().value!);
  return resolution;
}
function resolveStaticPlan(place: Place, plan: SettlementExteriorPlan) {
  const cached = resolvedSettlements.get(place.code);
  if (cached) return rememberResolution(place.code, cached);
  const staticAnchors = new Map<string, Resolved>(), staticOccupants: Occupant[] = [];
  for (const plot of plan.plots) {
    let chosen: Resolved = null;
    for (const candidate of plot.candidates) {
      if (!candidateLegal(place, plan, plot, candidate) || overlaps(staticOccupants, candidate.x, candidate.z, plot.clearanceRadius)) continue;
      chosen = candidate; staticOccupants.push({ x: candidate.x, z: candidate.z, radius: plot.clearanceRadius }); break;
    }
    staticAnchors.set(plot.id, chosen);
  }
  return rememberResolution(place.code, { staticAnchors, staticOccupants, homes: new Map() });
}
/** Extra frontage options must not extend through a different resident's
 * original owned house. Only nearby SEED lots are examined. */
function conflictsWithAssignedHome(place: Place, plan: SettlementExteriorPlan,
  index: number, candidate: { x: number; z: number }, radius: number) {
  const reach = radius + metresToSource(12);
  return settlementHomeIndicesNear(place, candidate.x - reach, candidate.x + reach,
    candidate.z - reach, candidate.z + reach).some(other => {
    if (other === index) return false;
    const home = settlementHomeFor(place, other, plan), point = home.candidates[0];
    return Math.hypot(wrapSourceX(candidate.x - point.x), candidate.z - point.z) <
      radius + home.clearanceRadius;
  });
}
function guardHomeCount(plan: SettlementExteriorPlan) {
  return plan.gates.reduce((sum, gate) => sum + gate.guardPosts.length * 2, 0);
}
/** Reserve mandatory guard homes in fixed SEED order so direct resident lookup,
 * LOD, tile emission, and unload/revisit cannot change which guard receives
 * the finite vacant frontage. Every chosen house keeps its unique owner ID. */
function resolveGuardHomes(place: Place, plan: SettlementExteriorPlan, resolution: ResolvedSettlement) {
  if (resolution.guardsReady) return;
  const plots = resolution.homePlots || (resolution.homePlots = new Map<number, SettlementPlotPlan>()),
    reserved: Occupant[] = [], usedSpare = new Set<number>(),
    count = guardHomeCount(plan);
  for (let index = 6; index < 6 + count; index++) {
    let plot = settlementHomeFor(place, index, plan), chosen: Resolved = null;
    for (const [attempt, candidate] of plot.candidates.entries()) {
      if (overlaps(resolution.staticOccupants, candidate.x, candidate.z, plot.clearanceRadius) ||
          overlaps(reserved, candidate.x, candidate.z, plot.clearanceRadius) ||
          !candidateLegal(place, plan, plot, candidate) ||
          (attempt >= 11 && conflictsWithAssignedHome(place, plan, index, candidate, plot.clearanceRadius))) continue;
      chosen = candidate; break;
    }
    if (!chosen) for (let ordinal = 0,
      vacant = Math.max(0, settlementLotCount(place) - SETTLEMENT_POPULATION[place.kind]);
      ordinal < vacant; ordinal++) {
      if (usedSpare.has(ordinal)) continue;
      const spare = settlementSpareHomeFor(place, index, ordinal, plan);
      if (!spare) continue;
      const point = spare.candidates.find(candidate =>
        !overlaps(resolution.staticOccupants, candidate.x, candidate.z, spare.clearanceRadius) &&
        !overlaps(reserved, candidate.x, candidate.z, spare.clearanceRadius) &&
        !conflictsWithAssignedHome(place, plan, index, candidate, spare.clearanceRadius) &&
        candidateLegal(place, plan, spare, candidate));
      if (!point) continue;
      plot = spare; chosen = point; usedSpare.add(ordinal); break;
    }
    plots.set(index, plot);
    resolution.homes.set(plot.id, chosen);
    if (chosen) reserved.push({ ...chosen, radius: plot.clearanceRadius });
  }
  resolution.guardsReady = true;
}
/** Resolve a unique owned frontage lazily while protecting required guard
 * reservations and exact street/water/wall/building placement constraints. */
function resolveHome(place: Place, plan: SettlementExteriorPlan, resolution: ResolvedSettlement, index: number) {
  const plots = resolution.homePlots || (resolution.homePlots = new Map<number, SettlementPlotPlan>());
  if (index >= 6 && index < 6 + guardHomeCount(plan)) resolveGuardHomes(place, plan, resolution);
  let plot = plots.get(index);
  if (plot) return plot;
  plot = settlementHomeFor(place, index, plan);
  let chosen: Resolved = null;
  for (const [attempt, candidate] of plot.candidates.entries()) {
    if (overlaps(resolution.staticOccupants, candidate.x, candidate.z, plot.clearanceRadius) ||
        !candidateLegal(place, plan, plot, candidate) ||
        (attempt >= 11 && conflictsWithAssignedHome(place, plan, index, candidate, plot.clearanceRadius))) continue;
    chosen = candidate; break;
  }
  plots.set(index, plot);
  resolution.homes.set(plot.id, chosen);
  return plot;
}
/** Front-wall centre in the same physical local frame used by geometry.ts
 * for the house's painted door (local +Z after yaw). Nearest-street rays can
 * choose a crossing side street instead of the lot's assigned frontage; that
 * made the Simulation entrance disagree with the rendered wall. */
export function settlementFrontWallDoor(
  point: { x: number; z: number }, plot: Pick<SettlementPlotPlan, "depthM" | "depth" | "yawRad">,
): { x: number; z: number } {
  const halfDepthM = (plot.depthM ?? plot.depth / metresToSource(1)) * .5;
  const metric = sourceUnitsPerMetreAt(point.z);
  return {
    x: wrapSourceX(point.x + Math.sin(plot.yawRad) * metric.x * halfDepthM),
    z: point.z + Math.cos(plot.yawRad) * metric.z * halfDepthM,
  };
}

/** Draw a house's approach only OUTSIDE its actual rendered front wall.
 * A closer junction side-street must not create a fake walkway through a
 * building. Returning null is safer than depicting an impossible connector. */
export function settlementFrontDoorWalkway(
  door: { x: number; z: number }, yawRad: number,
  street?: { x: number; z: number; width: number },
): { x: number; z: number; yawRad: number; length: number } | null {
  if (!street) return null;
  const dx = wrapSourceX(street.x - door.x), dz = street.z - door.z,
    metric = sourceUnitsPerMetreAt(door.z),
    eastM = dx / metric.x, northM = dz / metric.z,
    distanceM = Math.hypot(eastM, northM);
  if (distanceM < 1e-6) return null;
  // Use the canonical physical metric (east and north differ with latitude);
  // source-space angles would choose the wrong frontage at high latitude.
  const ux = eastM / distanceM, uz = northM / distanceM;
  if (ux * Math.sin(yawRad) + uz * Math.cos(yawRad) < .65) return null;
  const lengthM = distanceM - street.width / metric.z * .5;
  if (lengthM <= 1.2 || lengthM >= 40) return null;
  const midpoint = lengthM / (2 * distanceM);
  return { x: wrapSourceX(door.x + dx * midpoint), z: door.z + dz * midpoint,
    yawRad: Math.atan2(ux, uz), length: metresToSource(lengthM) };
}

/** Resolve one canonical home against the same legal lot and street frontage as
 * the rendered building. Unlike candidate[0], this may be absent or shifted. */
export function resolvedSettlementHomeDoorFor(place: Place, index: number): { x: number; z: number } | undefined {
  const plan = settlementExteriorFor(place),
    resolution = resolveStaticPlan(place, plan),
    plot = resolveHome(place, plan, resolution, index),
    point = resolution.homes.get(plot.id);
  if (!point) return undefined;
  return settlementFrontWallDoor(point, plot);
}

/** Camera-only house inspection faces the exact rendered front-wall yaw.
 * Read the same resolved SEED home as the door; guard replacement lots may
 * have a different yaw from the originally assigned frontage. */
export function resolvedSettlementHomeFacingFor(place: Place, index: number): number | undefined {
  const plan = settlementExteriorFor(place),
    resolution = resolveStaticPlan(place, plan),
    plot = resolveHome(place, plan, resolution, index);
  return resolution.homes.get(plot.id) ? plot.yawRad : undefined;
}

export function settlementPresentationCacheState() {
  let homeAnchors = 0;
  for (const resolution of resolvedSettlements.values()) homeAnchors += resolution.homes.size;
  return { settlements: resolvedSettlements.size, homeAnchors, maxSettlements: SETTLEMENT_PRESENTATION_CACHE_LIMIT, maxHomeAnchorsPerSettlement: MAX_CACHED_HOME_ANCHORS } as const;
}
function enclosureStyleFor(place: Place, plan: SettlementExteriorPlan) {
  if (place.kind === "city") return { variant: 1, width: 1.6, label: "Stone city wall" };
  if (plan.archetype === "green" || plan.archetype === "dispersed-farming") return { variant: 2, width: 1.5, label: "Hedge enclosure" };
  if (plan.archetype === "roadside" || plan.archetype === "fortified-frontier") return { variant: 3, width: 1, label: "Palisade enclosure" };
  return { variant: 4, width: 1.3, label: "Stone and timber enclosure" };
}
const HOME_STRIDES = { city: [1, 2, 4], village: [1, 1, 2] } as const;
function homeStride(place: Place, tileSize: number) {
  return HOME_STRIDES[place.kind][tileSize <= 32 ? 0 : tileSize <= 64 ? 1 : 2];
}
function nearTile(tile: Tile, point: { x: number; z: number }, padding = 5) {
  return point.x >= tile.minX - padding && point.x < tile.minX + tile.size + padding && point.z >= tile.minZ - padding && point.z < tile.minZ + tile.size + padding;
}

/** S004 morphology overlay. Canonical homes are analytical; a bounded displayed subset is resolved per focused settlement. */
export function featuresFor(tile: Tile): MorphologyFeature[] {
  const tileCentreX = tile.minX + tile.size * .5, tileCentreZ = tile.minZ + tile.size * .5, localPlaces = nearbyPlaces(tileCentreX, tileCentreZ),
    markers = localPlaces.map((place) => `/F/${place.id}/`), features = coreFeaturesFor(tile).filter((feature) => !markers.some((marker) => feature.code.includes(marker))) as MorphologyFeature[];
  const add = (kind: MorphologyKind, x: number, z: number, variant: number, id: string, metadata: Partial<MorphologyFeature> = {}) => {
    if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) return;
    const surface = finalSurfaceAt(x, z);
    if (surface.water.kind !== "none" || !surface.walkable) return;
    features.push({ kind, x, z, y: surface.groundHeight, variant, code: `${WORLD_SEED}/${GENERATOR_VERSION}/F/${id}`, ...metadata });
  };
  const emitPlot = (place: Place, plan: SettlementExteriorPlan, plot: SettlementPlotPlan, point: { x: number; z: number }, homeIndex?: number) => {
    const kind: MorphologyKind = plot.kind === "house" ? "residence" : plot.kind === "service" ? "service" : plot.kind,
      shop = homeIndex === undefined ? undefined : settlementShopFor(place, homeIndex),
      street = settlementStreetAt(plan, point.x, point.z), dx = street ? wrapSourceX(street.x - point.x) : 0, dz = street ? street.z - point.z : 0,
      distance = Math.hypot(dx, dz),
      // The door sits on the front wall (half the depth towards the street), never inside the footprint.
      edgeOffset = Math.min(distance * .9, plot.kind === "field" ? Math.max(metresToSource(2), Math.min(plot.width, plot.depth) * .42) : plot.depth * .5),
      door = plot.kind === "house" ? settlementFrontWallDoor(point, plot)
        : street && distance > 0 ? { x: wrapSourceX(point.x + dx / distance * edgeOffset), z: point.z + dz / distance * edgeOffset } : point;
    const owner = plot.ownerId ? familyName(plot.ownerId, place.continent) : undefined,
      buildingKind = (plot.kind === "service" ? plot.service : plot.kind === "park" ? plot.park : plot.kind) as BuildingKind,
      name = buildingName(shop ?? buildingKind, plot.id, place.name, place.continent, owner, place.kind === "city"),
      label = shop ? (shop === "cafe" ? "Café" : "Restaurant") : plot.service || plot.park || plot.house?.houseType || plot.kind;
    add(kind, point.x, point.z, digest(`${plot.id}/FEATURE`), `${place.id}/${plot.id}`, { name, shop, service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label, entranceX: door.x, entranceZ: door.z, yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, widthM: plot.widthM, depthM: plot.depthM, parkShape: plot.parkShape, house: plot.house, fieldForm: plot.fieldForm, urban: place.kind === "city" && kind === "residence" });
    // The home path starts at the real front-wall door, not a nearest-road
    // ray from the house centre. Reject perpendicular/rear streets at junctions.
    const houseApproach = kind === "residence"
      ? settlementFrontDoorWalkway(door, plot.yawRad, settlementStreetAt(plan, door.x, door.z)) : null;
    const pathLength = street ? distance - edgeOffset - street.width * .5 : 0;
    const ordinaryApproach = kind !== "residence" && street && distance > 0 &&
      pathLength > metresToSource(1.2) && pathLength < metresToSource(40)
      ? { x: wrapSourceX(door.x + dx / distance * pathLength * .5),
        z: door.z + dz / distance * pathLength * .5,
        yawRad: Math.atan2(dx, dz), length: pathLength } : null;
    const approach = houseApproach ?? ordinaryApproach;
    if ((kind === "residence" || kind === "service" || kind === "keep") && approach)
      add("path", approach.x, approach.z, digest(`${plot.id}/PATH`), `${place.id}/path/${plot.id}`,
        { ownerId: plot.ownerId, label: "Access path", yawRad: approach.yawRad,
          footprintWidth: metresToSource(1.2), footprintDepth: approach.length, length: approach.length });
  };
  for (const place of localPlaces) {
    const extent = place.kind === "city" ? 76 : 36;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + extent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + extent) continue;
    const plan = settlementExteriorFor(place), resolution = resolveStaticPlan(place, plan), enclosure = enclosureStyleFor(place, plan),
      streetNameList = streetNames(place.code, plan.streets.length, place.kind === "city"), wall = wallName(place.name, place.kind === "city");
    // Street detail. Streets (with their pavements) and bend joints at every scale; benches and planters close-up only (tile size 8 or finer).
    const small = tile.size <= 8, city = place.kind === "city", ringIndex = plan.streets.findIndex((street) => /\/RING-0$/.test(street.id)),
      lamps = small ? mainStreetLampAnchors(plan) : [],
      parkRects = plan.plots.flatMap((plot) => {
        const anchor = plot.kind === "park" ? resolution.staticAnchors.get(plot.id) : null;
        return anchor && plot.widthM !== undefined && plot.depthM !== undefined ? [{ x: anchor.x, z: anchor.z, yawRad: plot.yawRad, widthM: plot.widthM, depthM: plot.depthM }] : [];
      }),
      inPark = (x: number, z: number, margin: number) => parkRects.some((park) => insideYawedRect(x, z, park.x, park.z, park.yawRad, park.widthM, park.depthM, margin)),
      onStaticPlot = (x: number, z: number, margin: number) => plan.plots.some((plot) => {
        const anchor = resolution.staticAnchors.get(plot.id);
        // The inn's front terrace reaches about 5 m beyond its footprint.
        return anchor && plot.widthM !== undefined && plot.depthM !== undefined && insideYawedRect(x, z, anchor.x, anchor.z, plot.yawRad, plot.widthM, plot.depthM, plot.service === "inn" ? margin + 3 : margin);
      }),
      // A tree or rock needs the street and its 1.8 m pavement plus a 1.5 m verge, and `margin` metres around parks, plots and houses.
      plantingBlocked = (x: number, z: number, margin: number) => {
        const hit = settlementStreetAt(plan, x, z);
        return (hit !== undefined && hit.distance < hit.width * .5 + metresToSource(PAVEMENT_WIDTH_M + 1.5)) || inPark(x, z, margin) || onStaticPlot(x, z, margin) || homeFootprintHit(place, plan, resolution, x, z, margin);
      },
      nearGate = (x: number, z: number, reach: number) => plan.gates.some((gate) => Math.hypot(wrapSourceX(gate.x - x), gate.z - z) < reach),
      /**
       * Household yard life (close-up tiles only): up to three seeded objects per home — a bench by the
       * door, something on the house's right-hand side (the same side for every house, so neighbours never
       * share a gap) and something behind it. Every footprint corner must stay off streets and pavements,
       * parks, fixed plots and every house; the choice depends only on the home's ID, so it is the same
       * from any tile.
       */
      emitYard = (yardPlace: Place, yardPlan: SettlementExteriorPlan, plot: SettlementPlotPlan, home: { x: number; z: number }, shop: boolean) => {
        if (plot.widthM === undefined || plot.depthM === undefined) return;
        const w = plot.widthM, d = plot.depthM, metric = sourceUnitsPerMetreAt(home.z), c = Math.cos(plot.yawRad), s = Math.sin(plot.yawRad),
          toSource = (lx: number, lz: number) => ({ x: wrapSourceX(home.x + (lx * c + lz * s) * metric.x), z: home.z + (-lx * s + lz * c) * metric.z }),
          slots = YARD_SLOTS[yardPlace.kind === "city" ? "city" : "village"];
        const tryPlace = (slot: "front" | "side" | "back") => {
          const [chance, kinds] = slots[slot], roll = (digest(`${plot.id}/YARD/${slot}`) % 10_000) / 10_000;
          if (roll >= chance || (slot === "front" && shop)) return;
          let pickRoll = (digest(`${plot.id}/YARD/${slot}/KIND`) % 10_000) / 10_000, kind = kinds[kinds.length - 1][0];
          for (const [candidate, weight] of kinds) { if (pickRoll < weight) { kind = candidate; break; } pickRoll -= weight; }
          const [pw, pd] = YARD_PROP_SIZES[kind], gap = .45;
          // Local placement in the house frame (+z = towards the street) and the object's own turn.
          const along = (digest(`${plot.id}/YARD/${slot}/ALONG`) % 1000) / 1000 - .5,
            [lx, lz, turn] = slot === "front" ? [(along < 0 ? -1 : 1) * (w / 2 - pw / 2 - .3), d / 2 + pd / 2 + .35, 0]
              : slot === "side" ? [w / 2 + pd / 2 + gap, along * Math.max(0, d - pw), Math.PI / 2]
                : [along * Math.max(0, w - pw), -(d / 2 + pd / 2 + gap + .4), 0],
            cos = Math.cos(turn), sin = Math.sin(turn),
            corners = [[0, 0], [-pw / 2, -pd / 2], [pw / 2, -pd / 2], [pw / 2, pd / 2], [-pw / 2, pd / 2]].map(([a, b]) => toSource(lx + a * cos + b * sin, lz - a * sin + b * cos));
          for (const p of corners) {
            const street = settlementStreetAt(yardPlan, p.x, p.z);
            if (street && street.distance < street.width * .5 + metresToSource(PAVEMENT_WIDTH_M + .3)) return;
            if (inPark(p.x, p.z, .3) || onStaticPlot(p.x, p.z, .3) || homeFootprintHit(yardPlace, yardPlan, resolution, p.x, p.z, .25) || nearGate(p.x, p.z, metresToSource(8))) return;
          }
          const centre = corners[0], id = `${yardPlace.id}/yard/${plot.id}/${slot}`;
          add("yard-prop", centre.x, centre.z, digest(id), id, { label: kind, name: YARD_PROP_NAMES[kind], ownerId: plot.ownerId, yawRad: plot.yawRad + turn, widthM: pw, depthM: pd });
        };
        tryPlace("front"); tryPlace("side"); tryPlace("back");
      },
      within = (x: number, z: number) => x >= tile.minX && x < tile.minX + tile.size && z >= tile.minZ && z < tile.minZ + tile.size;
    // Natural trees and rocks of the core vegetation never stand on a street or its pavement, in a park or plaza, or on a fixed plot or house.
    const reachSource = metresToSource(plan.radiusM + 30);
    for (let i = features.length - 1; i >= 0; i--) {
      const feature = features[i];
      if ((feature.kind !== "tree" && feature.kind !== "rock") || feature.code.includes("/F/site/")) continue;
      if (Math.abs(wrapSourceX(feature.x - plan.centre.x)) > reachSource || Math.abs(feature.z - plan.centre.z) > reachSource) continue;
      if (plantingBlocked(feature.x, feature.z, 2)) features.splice(i, 1);
    }
    for (let streetIndex = 0; streetIndex < plan.streets.length; streetIndex++) {
      const street = plan.streets[streetIndex],
        // Pavements are part of the street itself: city streets and a village's main street carry one on each side.
        pavementWidth = city || streetIndex === 0 ? metresToSource(PAVEMENT_WIDTH_M) : undefined,
        furniture = small && (streetIndex === 0 || (city && streetIndex === ringIndex));
      let arc = 0, nextSlot = metresToSource(FURNITURE_SPACING_M), slot = 1;
      for (let index = 1; index < street.points.length; index++) {
        // Town streets that run along a main road are drawn by the road itself (street-road-merge).
        if (street.sharedSegments?.includes(index)) continue;
        const segments = visibleSettlementStreetSegments(place, plan, street.points[index - 1], street.points[index]);
        for (let part = 0; part < segments.length; part++) {
          const [a, b] = segments[part], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
          if (!length) continue;
          add("street", wrapSourceX(a.x + dx * .5), a.z + dz * .5, Math.round(street.width * 10), `${place.id}/street/${index}/${street.id}${segments.length > 1 ? `/part/${part}` : ""}`, { name: streetNameList[streetIndex], yawRad: Math.atan2(dx, dz), footprintWidth: street.width, footprintDepth: length, length, label: "Street", pavementWidth });
          const partStart = arc, ux = dx / length, uz = dz / length;
          arc += length;
          if (furniture) {
            // Every 28 m along the visible street: a bench, then a planter, alternating sides. Each slot is numbered even when skipped.
            const offset = street.width * .5 + metresToSource(1.6);
            while (nextSlot <= arc) {
              const t = (nextSlot - partStart) / length, px = a.x + dx * t, pz = a.z + dz * t, n = slot,
                side: -1 | 1 = Math.floor((n - 1) / 2) % 2 === 0 ? 1 : -1;
              nextSlot += metresToSource(FURNITURE_SPACING_M);
              slot++;
              const x = wrapSourceX(px - uz * side * offset), z = pz + ux * side * offset;
              if (!within(x, z) || nearGate(x, z, metresToSource(8)) || lamps.some((lamp) => lamp.candidates.some((c) => Math.hypot(wrapSourceX(c.x - x), c.z - z) < metresToSource(2)))
                || inPark(x, z, .5) || nearOtherStreet(plan, street.id, x, z, metresToSource(1)) || overlaps(resolution.staticOccupants, x, z, metresToSource(.8))
                || homeFootprintHit(place, plan, resolution, x, z, .6)) continue;
              const bench = n % 2 === 1, kind = bench ? "bench" : "planter", id = `${place.id}/${kind}/${street.id}/${n}`;
              // The front (depth axis) looks back at the street.
              add(kind, x, z, digest(id), id, { yawRad: Math.atan2(uz * side, -ux * side), widthM: bench ? 1.8 : 1.4, depthM: bench ? .6 : .7, label: bench ? "Bench" : "Flower planter" });
            }
          }
        }
        // A street that ends inside the town (a dead end or a junction; no gate within 12 m) gets a round end.
        for (const end of (index === 1 ? [0] : []).concat(index === street.points.length - 1 ? [street.points.length - 1] : [])) {
          const vertex = street.points[end], neighbour = street.points[end === 0 ? 1 : end - 1];
          if (end === street.points.length - 1 && street.points.length > 1 && Math.hypot(wrapSourceX(street.points[0].x - vertex.x), street.points[0].z - vertex.z) < metresToSource(3)) continue;
          // Ends at a gate run into the gateway. Ends that join another street keep a round joint too, so the
          // junction corner is closed (mergeStreetJunctions ends them on the other street's centreline).
          if (nearGate(vertex.x, vertex.z, metresToSource(12))) continue;
          const onVisible = segments.some(([p, q]) => (Math.abs(wrapSourceX(p.x - vertex.x)) < 1e-9 && Math.abs(p.z - vertex.z) < 1e-9) || (Math.abs(wrapSourceX(q.x - vertex.x)) < 1e-9 && Math.abs(q.z - vertex.z) < 1e-9));
          if (onVisible) add("street-joint", vertex.x, vertex.z, Math.round(street.width * 10), `${place.id}/street-joint/${streetIndex}/${end}/${street.id}`, { name: streetNameList[streetIndex], yawRad: Math.atan2(wrapSourceX(end === 0 ? neighbour.x - vertex.x : vertex.x - neighbour.x), end === 0 ? neighbour.z - vertex.z : vertex.z - neighbour.z), footprintWidth: street.width, label: "Street", pavementWidth });
        }
        // A joint at each interior vertex where the street bends by more than 2 degrees and the vertex is on visible street.
        if (index <= street.points.length - 2) {
          const before = street.points[index - 1], vertex = street.points[index], after = street.points[index + 1],
            inX = wrapSourceX(vertex.x - before.x), inZ = vertex.z - before.z, outX = wrapSourceX(after.x - vertex.x), outZ = after.z - vertex.z,
            scale = sourceUnitsPerMetreAt(vertex.z), ix = inX / scale.x, iz = inZ / scale.z, ox = outX / scale.x, oz = outZ / scale.z,
            turn = Math.abs(Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz));
          const onVisible = segments.some(([p, q]) => (Math.abs(wrapSourceX(p.x - vertex.x)) < 1e-9 && Math.abs(p.z - vertex.z) < 1e-9) || (Math.abs(wrapSourceX(q.x - vertex.x)) < 1e-9 && Math.abs(q.z - vertex.z) < 1e-9));
          if (turn > JOINT_TURN && onVisible) add("street-joint", vertex.x, vertex.z, Math.round(street.width * 10), `${place.id}/street-joint/${streetIndex}/${index}/${street.id}`, { name: streetNameList[streetIndex], yawRad: Math.atan2(inX, inZ), footprintWidth: street.width, label: "Street", pavementWidth });
        }
      }
    }
    for (let segment = 0; segment < plan.border.length; segment++) {
      const a = plan.border[segment], b = plan.border[(segment + 1) % plan.border.length], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz), pieces = Math.max(1, Math.ceil(length / metresToSource(10)));
      for (let piece = 0; piece < pieces; piece++) {
        const t = (piece + .5) / pieces, x = wrapSourceX(a.x + dx * t), z = a.z + dz * t, pieceLength = length / pieces;
        if (!plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < metresToSource(9))) add("border", x, z, enclosure.variant, `${place.id}/border/${segment}/${piece}`, { yawRad: Math.atan2(dx, dz), footprintWidth: metresToSource(enclosure.width), footprintDepth: pieceLength + metresToSource(.4), length: pieceLength + metresToSource(.4), label: enclosure.label, name: wall });
      }
    }
    for (const plot of plan.plots) {
      const point = resolution.staticAnchors.get(plot.id);
      if (point) emitPlot(place, plan, plot, point);
    }
    const stride = homeStride(place, tile.size), pad = metresToSource(20),
      nearbyHomes = new Set(settlementHomeIndicesNear(place, tile.minX - pad, tile.minX + tile.size + pad,
        tile.minZ - pad, tile.minZ + tile.size + pad)),
      guardEnd = 6 + guardHomeCount(plan);
    // A watchman's vacant replacement lot can be away from their former slot.
    // Preserve every resolved guard's SEED-owned house at intermediate LODs:
    // filtering their IDs by ordinary residence stride made legal doors visible
    // in Simulation but hid their corresponding actual building.
    for (let index = 6; index < guardEnd; index++) nearbyHomes.add(index);
    for (const index of nearbyHomes) {
      if (index % stride !== 0 && (index < 6 || index >= guardEnd)) continue;
      const plot = resolveHome(place, plan, resolution, index), point = resolution.homes.get(plot.id);
      if (point && nearTile(tile, point, 12)) {
        emitPlot(place, plan, plot, point, index);
        if (small) emitYard(place, plan, plot, point, settlementShopFor(place, index) !== undefined);
      }
    }
    for (const gate of plan.gates) {
      const gateYaw = Math.PI / 2 - gate.bearingRad;
      const gateLabel = gateName(gate.bearingRad, place.name, gate.id);
      add("gate", gate.x, gate.z, digest(gate.id), `${place.id}/gate/${gate.id}`, { name: gateLabel, label: `${place.name} gate`, entranceX: plan.centre.x, entranceZ: plan.centre.z, yawRad: gateYaw, footprintWidth: metresToSource(11), footprintDepth: metresToSource(2), widthM: 11, depthM: 2 });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(`${gate.id}/${index}`), `${place.id}/guard-post/${gate.id}/${index}`, { name: `${gateLabel} guard post`, service: "guard-office", capacity: 2, residents: 1, label: "Guard post", entranceX: gate.x, entranceZ: gate.z, yawRad: gateYaw, footprintWidth: metresToSource(GUARD_POST_BUILDING_WIDTH_M), footprintDepth: metresToSource(GUARD_POST_BUILDING_WIDTH_M), widthM: GUARD_POST_BUILDING_WIDTH_M, depthM: GUARD_POST_BUILDING_WIDTH_M });
      }
    }
    if(tile.size<=8)for(const lamp of mainStreetLampAnchors(plan)){
      if(!lamp.candidates.some(p=>nearTile(tile,p,metresToSource(1))))continue;
      const point=lamp.candidates.find(p=>{
        if(!roadsideClear(plan,p.x,p.z,.65))return false;
        if(overlaps(resolution.staticOccupants,p.x,p.z,metresToSource(.3)))return false;
        const metric=sourceUnitsPerMetreAt(p.z),range=metresToSource(16);
        for(const index of settlementHomeIndicesNear(place,p.x-range*metric.x/metric.z,p.x+range*metric.x/metric.z,p.z-range,p.z+range)){
          const plot=resolveHome(place,plan,resolution,index),home=resolution.homes.get(plot.id);if(!home)continue;
          const dx=wrapSourceX(p.x-home.x)/metric.x,dz=(p.z-home.z)/metric.z,c=Math.cos(plot.yawRad),s=Math.sin(plot.yawRad);
          if(Math.abs(dx*c-dz*s)<plot.widthM!/2+.6&&Math.abs(dx*s+dz*c)<plot.depthM!/2+.6)return false;
        }
        const ground=finalSurfaceAt(p.x,p.z);
        return ground.water.kind==='none'&&ground.walkable&&!plan.gates.some(g=>Math.hypot(wrapSourceX(g.x-p.x),g.z-p.z)<metresToSource(3));
      });
      if(point)add("street-lamp",point.x,point.z,digest(lamp.id),lamp.id,{yawRad:lamp.yaw,widthM:.6,depthM:.6,label:"Street lantern"});
    }
    const mainStreet = plan.streets[0];
    for (let index = 2; index < mainStreet.points.length - 1; index += 4) {
      const value = digest(`${place.code}/ROADSIDE-TREE/${index}`), anchor = mainStreet.points[index], previous = mainStreet.points[index - 1], next = mainStreet.points[index + 1],
        dx = wrapSourceX(next.x - previous.x), dz = next.z - previous.z, length = Math.hypot(dx, dz) || 1, side = (value & 1) === 0 ? -1 : 1,
        offset = mainStreet.width * .5 + metresToSource(4 + ((value >>> 3) % 4)), x = wrapSourceX(anchor.x - dz / length * offset * side), z = anchor.z + dx / length * offset * side;
      if (!roadsideClear(plan, x, z, 3.2) || plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < metresToSource(20)) || naturalSurfaceAt(x, z).freshwaterDistanceSource < metresToSource(6)) continue;
      // Not on a street or its pavement, not on a park or plaza (3.5 m of canopy clear of its terraces), not on a house, café frontage or other fixed plot.
      if (plantingBlocked(x, z, 3.5) || overlaps(resolution.staticOccupants, x, z, metresToSource(2))) continue;
      add("roadside-tree", x, z, value, `${place.id}/roadside-tree/${index}`, { label: "Roadside tree" });
    }
  }
  return features;
}
