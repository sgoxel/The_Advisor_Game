export * from "./world-core.ts";

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
import { settlementExteriorFor, settlementHomeFor, visibleSettlementStreetSegments, type SettlementExteriorPlan, type SettlementPlotPlan } from "./settlement-exterior.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
import { wrapSourceX } from "./planet.ts";
import { canonicalRoadBucketCells, canonicalRoadBucketX } from "./road-spatial-index.ts";
import { metresToSource, physicalFootprintRadius, type HouseDimensions } from "./physical-scale.ts";

type MorphologyKind = CoreFeature["kind"] | "residence" | "service" | "street" | "border" | "gate" | "guard-post" | "garden" | "path" | "pavement" | "roadside-tree";
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
};
type StreetHit = { id: string; width: number; distance: number; x: number; z: number };
type Resolved = { x: number; z: number } | null;
type Occupant = { x: number; z: number; radius: number };
type ResolvedSettlement = { staticAnchors: Map<string, Resolved>; staticOccupants: Occupant[]; homes: Map<string, Resolved>; homePlots?: Map<number, SettlementPlotPlan> };

export const SETTLEMENT_PRESENTATION_CACHE_LIMIT = 12;
const MAX_CACHED_HOME_ANCHORS = 512;
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
function externalRoadClear(x: number, z: number, radius: number) {
  const wrappedX = wrapSourceX(x), bx = Math.floor(wrappedX / ROAD_BUCKET_SIZE), bz = Math.floor(z / ROAD_BUCKET_SIZE),
    reach = Math.max(0, Math.ceil(radius / ROAD_BUCKET_SIZE)), candidates = new Set<(typeof roads)[number]>();
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++)
    for (const road of externalRoadBuckets.get(roadBucketKey(canonicalRoadBucketX(bx + dx, ROAD_BUCKET_SIZE, WORLD_SIZE), bz + dz)) || []) candidates.add(road);
  return [...candidates].every((road) => roadDistanceAt(wrappedX, z, road) > radius);
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
  const radius = plot.clearanceRadius, roadReserve = plot.kind === "house" ? radius + .55 : radius + 3;
  if (!externalRoadClear(candidate.x, candidate.z, roadReserve)) return false;
  const street = settlementStreetAt(plan, candidate.x, candidate.z);
  if (street && street.distance < street.width * .5 + radius * .78) return false;
  if (plot.kind !== "field" && plan.gates.some((gate) => Math.hypot(wrapSourceX(candidate.x - gate.x), candidate.z - gate.z) < radius + 7)) return false;
  if (plot.kind !== "field" && borderClearance(place, plan, candidate.x, candidate.z) < radius + .25) return false;
  const sampleRadius = plot.kind === "house" ? Math.max(.24, Math.min(.58, radius * .62)) : plot.kind === "field" ? 9 : Math.min(6, Math.max(1.5, radius * .55)),
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
function resolveHomes(place: Place, plan: SettlementExteriorPlan, resolution: ResolvedSettlement) {
  if (resolution.homePlots) return;
  const plots = new Map<number, SettlementPlotPlan>(), occupants = [...resolution.staticOccupants],
    strides = HOME_STRIDES[place.kind], lots = place.kind === "city" ? cityFrontageLots(plan) : [];
  // Resolve the bounded union of all displayed LOD subsets, in resident order.
  // Never let tile visitation, current zoom, or an evicted anchor decide which
  // home wins a plot. Logical resident/home records remain unchanged.
  for (let index = 0; index < plan.residentHomeCount; index++) {
    if (!strides.some(stride => index % stride === 0)) continue;
    const canonical = settlementHomeFor(place, index, plan),
      home = place.kind === "city" ? cityPresentationHome(place, plan, canonical, index, plots.size, lots) : canonical,
      plot = { ...home, clearanceRadius: physicalFootprintRadius(home.widthM! + .5, home.depthM! + .5, place.z, .5) };
    let chosen: Resolved = null;
    for (const candidate of plot.candidates) {
      if (overlaps(occupants, candidate.x, candidate.z, plot.clearanceRadius) || !candidateLegal(place, plan, plot, candidate)) continue;
      chosen = candidate;
      occupants.push({ ...candidate, radius: plot.clearanceRadius });
      break;
    }
    plots.set(index, plot);
    resolution.homes.set(plot.id, chosen);
  }
  resolution.homePlots = plots;
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
const HOME_STRIDES = { city: [12, 18, 36], village: [2, 3, 6] } as const;
function homeStride(place: Place, tileSize: number) {
  return HOME_STRIDES[place.kind][tileSize <= 32 ? 0 : tileSize <= 64 ? 1 : 2];
}
function streetPointAtFraction(street: SettlementExteriorPlan["streets"][number], fraction: number) {
  let total = 0;
  for (let index = 1; index < street.points.length; index++) total += Math.hypot(wrapSourceX(street.points[index].x - street.points[index - 1].x), street.points[index].z - street.points[index - 1].z);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (target <= length || index + 1 === street.points.length) {
      const t = length ? Math.max(0, Math.min(1, target / length)) : 0, tangentLength = length || 1,
        tangent = { x: dx / tangentLength, z: dz / tangentLength };
      return { point: { x: wrapSourceX(a.x + dx * t), z: a.z + dz * t }, tangent, normal: { x: -tangent.z, z: tangent.x } };
    }
    target -= length;
  }
  const a = street.points[0], b = street.points[Math.min(1, street.points.length - 1)], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz) || 1,
    tangent = { x: dx / length, z: dz / length };
  return { point: a, tangent, normal: { x: -tangent.z, z: tangent.x } };
}
function cityFrontageLots(plan: SettlementExteriorPlan) {
  const lots: { street: SettlementExteriorPlan["streets"][number]; fraction: number; side: -1 | 1; block: number }[] = [];
  for (const street of plan.streets) {
    let length = 0;
    for (let i = 1; i < street.points.length; i++) length += Math.hypot(wrapSourceX(street.points[i].x - street.points[i - 1].x), street.points[i].z - street.points[i - 1].z);
    const count = Math.max(1, Math.floor(length * .86 / 13));
    for (let slot = 0; slot < count; slot++) for (const side of [-1, 1] as const)
      lots.push({ street, fraction: .07 + (slot + .5) / count * .86, side, block: Math.floor(slot / 4) });
  }
  return lots;
}
function cityPresentationHome(place: Place, plan: SettlementExteriorPlan, canonical: SettlementPlotPlan, index: number, ordinal: number, lots: ReturnType<typeof cityFrontageLots>): SettlementPlotPlan {
  // A seed-rotated, coprime walk distributes distinct lots across all streets.
  // Nearby lots share a setback rhythm; small variation follows the curved
  // frontage instead of creating random clumps or a world-aligned grid.
  let step = 17;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  while (gcd(step, lots.length) !== 1) step += 2;
  const lot = lots[(digest(`${place.code}/CITY-FRONTAGE`) + ordinal * step) % lots.length],
    { street, side } = lot,
    fraction = lot.fraction,
    base = streetPointAtFraction(street, fraction),
    width = canonical.width,
    depth = canonical.depth,
    setback = metresToSource(2 + (digest(`${street.id}/FRONTAGE/${side}/${lot.block}`) % 17) / 10 + (digest(`${canonical.id}/SETBACK`) % 5) / 10),
    lateral = side * (street.width * .5 + depth * .5 + setback),
    yawRad = Math.atan2(-base.normal.x * side, -base.normal.z * side) + ((digest(`${place.code}/CITY-PRESENTATION/${index}/YAW`) % 1001) / 1000 - .5) * .1,
    offset = (along: number, extraLateral = 0) => ({
      x: wrapSourceX(base.point.x + base.tangent.x * along + base.normal.x * (lateral + side * extraLateral)),
      z: base.point.z + base.tangent.z * along + base.normal.z * (lateral + side * extraLateral),
    }),
    candidates = [offset(0), offset(1.2), offset(-1.2), offset(.6, 2.2), offset(-.6, 4.4)];
  return { ...canonical, width, depth, yawRad, candidates };
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
      distance = Math.hypot(dx, dz), edgeOffset = Math.min(distance * .45, Math.max(.25, Math.min(plot.width, plot.depth) * .42)),
      door = street && distance > 0 ? { x: wrapSourceX(point.x + dx / distance * edgeOffset), z: point.z + dz / distance * edgeOffset } : point;
    add(kind, point.x, point.z, digest(`${plot.id}/FEATURE`), `${place.id}/${plot.id}`, { service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.house?.houseType || plot.kind, entranceX: door.x, entranceZ: door.z, yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, widthM: plot.widthM, depthM: plot.depthM, house: plot.house, fieldForm: plot.fieldForm, urban: place.kind === "city" && kind === "residence" });
    const cityHomePath = kind === "residence" && place.kind === "city";
    if ((kind === "residence" || kind === "service" || kind === "keep") && street && distance > edgeOffset + .28 && (!cityHomePath || distance <= 18)) {
      const pathDx = wrapSourceX(street.x - door.x), pathDz = street.z - door.z, pathLength = Math.hypot(pathDx, pathDz);
      add("path", wrapSourceX(door.x + pathDx * .5), door.z + pathDz * .5, digest(`${plot.id}/PATH`), `${place.id}/path/${plot.id}`, { ownerId: plot.ownerId, label: "Access path", yawRad: Math.atan2(pathDx, pathDz), footprintWidth: metresToSource(1.2), footprintDepth: pathLength, length: pathLength });
    }
  };
  for (const place of localPlaces) {
    const extent = place.kind === "city" ? 456 : 178;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + extent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + extent) continue;
    const plan = settlementExteriorFor(place), resolution = resolveStaticPlan(place, plan), enclosure = enclosureStyleFor(place, plan);
    for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
      const segments = visibleSettlementStreetSegments(place, plan, street.points[index - 1], street.points[index]);
      for (let part = 0; part < segments.length; part++) {
        const [a, b] = segments[part], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length) add("street", wrapSourceX(a.x + dx * .5), a.z + dz * .5, Math.round(street.width * 10), `${place.id}/street/${index}/${street.id}${segments.length > 1 ? `/part/${part}` : ""}`, { yawRad: Math.atan2(dx, dz), footprintWidth: street.width, footprintDepth: length, length, label: "Street" });
      }
    }
    for (let segment = 0; segment < plan.border.length; segment++) {
      const a = plan.border[segment], b = plan.border[(segment + 1) % plan.border.length], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz), pieces = Math.max(1, Math.ceil(length / 10));
      for (let piece = 0; piece < pieces; piece++) {
        const t = (piece + .5) / pieces, x = wrapSourceX(a.x + dx * t), z = a.z + dz * t, pieceLength = length / pieces;
        if (!plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 13)) add("border", x, z, enclosure.variant, `${place.id}/border/${segment}/${piece}`, { yawRad: Math.atan2(dx, dz), footprintWidth: metresToSource(enclosure.width), footprintDepth: pieceLength + .4, length: pieceLength + .4, label: enclosure.label });
      }
    }
    for (const plot of plan.plots) {
      const point = resolution.staticAnchors.get(plot.id);
      if (point) emitPlot(place, plan, plot, point);
    }
    resolveHomes(place, plan, resolution);
    const stride = homeStride(place, tile.size);
    for (let index = 0; index < plan.residentHomeCount; index += stride) {
      const plot = resolution.homePlots!.get(index)!, primary = plot.candidates[0];
      if (!nearTile(tile, primary, 12)) continue;
      const point = resolution.homes.get(plot.id);
      if (point) emitPlot(place, plan, plot, point);
    }
    for (const gate of plan.gates) {
      const gateYaw = Math.PI / 2 - gate.bearingRad;
      add("gate", gate.x, gate.z, digest(gate.id), `${place.id}/gate/${gate.id}`, { label: `${place.name} gate`, entranceX: plan.centre.x, entranceZ: plan.centre.z, yawRad: gateYaw, footprintWidth: metresToSource(11), footprintDepth: metresToSource(2), widthM: 11, depthM: 2 });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(`${gate.id}/${index}`), `${place.id}/guard-post/${gate.id}/${index}`, { service: "guard-office", capacity: 2, residents: 1, label: "Guard post", entranceX: gate.x, entranceZ: gate.z, yawRad: gateYaw, footprintWidth: metresToSource(4.5), footprintDepth: metresToSource(4.5), widthM: 4.5, depthM: 4.5 });
      }
    }
    const mainStreet = plan.streets[0];
    for (let index = 2; index < mainStreet.points.length - 1; index += 4) {
      const value = digest(`${place.code}/ROADSIDE-TREE/${index}`), anchor = mainStreet.points[index], previous = mainStreet.points[index - 1], next = mainStreet.points[index + 1],
        dx = wrapSourceX(next.x - previous.x), dz = next.z - previous.z, length = Math.hypot(dx, dz) || 1, side = (value & 1) === 0 ? -1 : 1,
        offset = mainStreet.width * .5 + 5 + ((value >>> 3) % 4), x = wrapSourceX(anchor.x - dz / length * offset * side), z = anchor.z + dx / length * offset * side;
      if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 18) || naturalSurfaceAt(x, z).freshwaterDistanceSource < 2) continue;
      add("roadside-tree", x, z, value, `${place.id}/roadside-tree/${index}`, { label: "Roadside tree" });
    }
  }
  return features;
}
