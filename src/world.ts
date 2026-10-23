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
import { settlementHomeIndicesNear } from "./settlement-exterior-core.ts";
import { settlementExteriorFor, settlementHomeFor, visibleSettlementStreetSegments, type SettlementExteriorPlan, type SettlementPlotPlan } from "./settlement-exterior.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
import { wrapSourceX } from "./planet.ts";
import { canonicalRoadBucketCells, canonicalRoadBucketX } from "./road-spatial-index.ts";
import { metresToSource, sourceUnitsPerMetreAt, physicalFootprintRadius, type HouseDimensions } from "./physical-scale.ts";

type MorphologyKind = CoreFeature["kind"] | "residence" | "service" | "street" | "border" | "gate" | "guard-post" | "garden" | "path" | "pavement" | "roadside-tree" | "street-lamp";
type MorphologyFeature = {
  kind: MorphologyKind;
  x: number;
  z: number;
  y: number;
  code: string;
  variant: number;
  service?: string;
  ownerId?: string;
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
  house?: HouseDimensions;
  /** Seeded proper name (names.ts): "The Gilded Boar", "Tanner's Lane", "Ashford House"… */
  name?: string;
};
type StreetHit = { id: string; width: number; distance: number; x: number; z: number };
type Resolved = { x: number; z: number } | null;
type Occupant = { x: number; z: number; radius: number };
type ResolvedSettlement = { staticAnchors: Map<string, Resolved>; staticOccupants: Occupant[]; homes: Map<string, Resolved>; homePlots?: Map<number, SettlementPlotPlan> };

export const SETTLEMENT_PRESENTATION_CACHE_LIMIT = 12;
const MAX_CACHED_HOME_ANCHORS = 2560;
const resolvedSettlements = new Map<string, ResolvedSettlement>();
const ROAD_BUCKET_SIZE = 2048;
const ROAD_CLEARANCE_SUPPORT = 64;
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
function settlementStreetAt(plan: SettlementExteriorPlan, x: number, z: number): StreetHit | undefined {
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
function candidateLegal(place: Place, plan: SettlementExteriorPlan, plot: SettlementPlotPlan, candidate: { x: number; z: number }) {
  const surface = finalSurfaceAt(candidate.x, candidate.z);
  if (surface.groundHeight < .2 || surface.water.kind !== "none" || !surface.walkable) return false;
  const radius = plot.clearanceRadius, roadReserve = radius + metresToSource(plot.kind === "house" ? 2 : 6);
  if (!externalRoadClear(candidate.x, candidate.z, roadReserve)) return false;
  const street = settlementStreetAt(plan, candidate.x, candidate.z);
  if (street && street.distance < street.width * .5 + radius * .78) return false;
  if (plot.kind !== "field" && plan.gates.some((gate) => Math.hypot(wrapSourceX(candidate.x - gate.x), candidate.z - gate.z) < radius + metresToSource(12))) return false;
  if (plot.kind !== "field" && borderClearance(place, plan, candidate.x, candidate.z) < radius + metresToSource(3)) return false;
  const sampleRadius = plot.kind === "house" ? Math.max(.24, Math.min(.58, radius * .62)) : plot.kind === "field" ? metresToSource(14) : Math.min(metresToSource(20), Math.max(metresToSource(4), radius * .55)),
    samples = plot.kind === "house" ? [[0, 0], [-sampleRadius, -sampleRadius], [sampleRadius, sampleRadius]] : [[0,0],[-sampleRadius,-sampleRadius],[-sampleRadius,sampleRadius],[sampleRadius,-sampleRadius],[sampleRadius,sampleRadius]];
  for (const [dx, dz] of samples) {
    const point = finalSurfaceAt(candidate.x + dx, candidate.z + dz);
    if (point.water.kind !== "none" || !point.walkable || Math.abs(point.groundHeight - surface.groundHeight) > (plot.kind === "field" ? .1 : .28)) return false;
  }
  if ((plot.kind === "house" || plot.kind === "service" || plot.kind === "keep") && street) {
    const midpoint = { x: wrapSourceX((candidate.x + street.x) * .5), z: (candidate.z + street.z) * .5 }, point = finalSurfaceAt(midpoint.x, midpoint.z);
    if (point.water.kind !== "none" || !point.walkable) return false;
  }
  return true;
}
function overlaps(occupants: readonly Occupant[], x: number, z: number, radius: number) {
  return occupants.some((other) => Math.hypot(wrapSourceX(x - other.x), z - other.z) < radius + other.radius);
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
/** Resolve ONE home on demand. Lots never overlap each other, so only static plots and terrain decide. */
function resolveHome(place: Place, plan: SettlementExteriorPlan, resolution: ResolvedSettlement, index: number) {
  const plots = resolution.homePlots || (resolution.homePlots = new Map<number, SettlementPlotPlan>());
  let plot = plots.get(index);
  if (plot) return plot;
  plot = settlementHomeFor(place, index, plan);
  let chosen: Resolved = null;
  for (const candidate of plot.candidates) {
    if (overlaps(resolution.staticOccupants, candidate.x, candidate.z, plot.clearanceRadius) || !candidateLegal(place, plan, plot, candidate)) continue;
    chosen = candidate;
    break;
  }
  plots.set(index, plot);
  resolution.homes.set(plot.id, chosen);
  return plot;
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
  const emitPlot = (place: Place, plan: SettlementExteriorPlan, plot: SettlementPlotPlan, point: { x: number; z: number }) => {
    const kind: MorphologyKind = plot.kind === "house" ? "residence" : plot.kind === "service" ? "service" : plot.kind,
      street = settlementStreetAt(plan, point.x, point.z), dx = street ? wrapSourceX(street.x - point.x) : 0, dz = street ? street.z - point.z : 0,
      distance = Math.hypot(dx, dz),
      // The door sits on the front wall (half the depth towards the street), never inside the footprint.
      edgeOffset = Math.min(distance * .9, plot.kind === "field" ? Math.max(metresToSource(2), Math.min(plot.width, plot.depth) * .42) : plot.depth * .5),
      door = street && distance > 0 ? { x: wrapSourceX(point.x + dx / distance * edgeOffset), z: point.z + dz / distance * edgeOffset } : point;
    const owner = plot.ownerId ? familyName(plot.ownerId, place.continent) : undefined,
      buildingKind = (plot.kind === "service" ? plot.service : plot.kind) as BuildingKind,
      name = buildingName(buildingKind, plot.id, place.name, place.continent, owner, place.kind === "city");
    add(kind, point.x, point.z, digest(`${plot.id}/FEATURE`), `${place.id}/${plot.id}`, { name, service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.house?.houseType || plot.kind, entranceX: door.x, entranceZ: door.z, yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, widthM: plot.widthM, depthM: plot.depthM, house: plot.house, fieldForm: plot.fieldForm, urban: place.kind === "city" && kind === "residence" });
    // A short walkway from the door to the street edge (never across the road itself).
    const pathLength = street ? distance - edgeOffset - street.width * .5 : 0;
    if ((kind === "residence" || kind === "service" || kind === "keep") && street && pathLength > metresToSource(1.2) && pathLength < metresToSource(40)) {
      const ux = dx / distance, uz = dz / distance;
      add("path", wrapSourceX(door.x + ux * pathLength * .5), door.z + uz * pathLength * .5, digest(`${plot.id}/PATH`), `${place.id}/path/${plot.id}`, { ownerId: plot.ownerId, label: "Access path", yawRad: Math.atan2(ux, uz), footprintWidth: metresToSource(1.2), footprintDepth: pathLength, length: pathLength });
    }
  };
  for (const place of localPlaces) {
    const extent = place.kind === "city" ? 76 : 36;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + extent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + extent) continue;
    const plan = settlementExteriorFor(place), resolution = resolveStaticPlan(place, plan), enclosure = enclosureStyleFor(place, plan),
      streetNameList = streetNames(place.code, plan.streets.length, place.kind === "city"), wall = wallName(place.name, place.kind === "city");
    for (let streetIndex = 0; streetIndex < plan.streets.length; streetIndex++) for (let index = 1, street = plan.streets[streetIndex]; index < street.points.length; index++) {
      if(street.sharedSegments?.includes(index))continue;
      const segments = visibleSettlementStreetSegments(place, plan, street.points[index - 1], street.points[index]);
      for (let part = 0; part < segments.length; part++) {
        const [a, b] = segments[part], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length) add("street", wrapSourceX(a.x + dx * .5), a.z + dz * .5, Math.round(street.width * 10), `${place.id}/street/${index}/${street.id}${segments.length > 1 ? `/part/${part}` : ""}`, { name: streetNameList[streetIndex], yawRad: Math.atan2(dx, dz), footprintWidth: street.width, footprintDepth: length, length, label: "Street" });
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
    const stride = homeStride(place, tile.size), pad = metresToSource(20);
    for (const index of settlementHomeIndicesNear(place, tile.minX - pad, tile.minX + tile.size + pad, tile.minZ - pad, tile.minZ + tile.size + pad)) {
      if (index % stride !== 0) continue;
      const plot = resolveHome(place, plan, resolution, index), point = resolution.homes.get(plot.id);
      if (point && nearTile(tile, plot.candidates[0], 12)) emitPlot(place, plan, plot, point);
    }
    for (const gate of plan.gates) {
      const gateYaw = Math.PI / 2 - gate.bearingRad;
      const gateLabel = gateName(gate.bearingRad, place.name, gate.id);
      add("gate", gate.x, gate.z, digest(gate.id), `${place.id}/gate/${gate.id}`, { name: gateLabel, label: `${place.name} gate`, entranceX: plan.centre.x, entranceZ: plan.centre.z, yawRad: gateYaw, footprintWidth: metresToSource(11), footprintDepth: metresToSource(2), widthM: 11, depthM: 2 });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(`${gate.id}/${index}`), `${place.id}/guard-post/${gate.id}/${index}`, { name: `${gateLabel} guard post`, service: "guard-office", capacity: 2, residents: 1, label: "Guard post", entranceX: gate.x, entranceZ: gate.z, yawRad: gateYaw, footprintWidth: metresToSource(4.5), footprintDepth: metresToSource(4.5), widthM: 4.5, depthM: 4.5 });
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
      if (!roadsideClear(plan,x,z,3.2)||plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < metresToSource(20)) || naturalSurfaceAt(x, z).freshwaterDistanceSource < metresToSource(6)) continue;
      add("roadside-tree", x, z, value, `${place.id}/roadside-tree/${index}`, { label: "Roadside tree" });
    }
  }
  return features;
}
