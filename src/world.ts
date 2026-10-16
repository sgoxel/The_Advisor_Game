export * from "./world-core.ts";

import {
  featuresFor as coreFeaturesFor,
  finalSurfaceAt,
  digest,
  WORLD_SEED,
  GENERATOR_VERSION,
  type Feature as CoreFeature,
  type Tile,
} from "./world-core.ts";
import { nearbyPlaces, places, roadDistanceAt, roads, type Place } from "./geography.ts";
import { settlementExteriorFor, type SettlementExteriorPlan, type SettlementPlotPlan } from "./settlement-exterior.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
import { wrapSourceX } from "./planet.ts";

type MorphologyKind = CoreFeature["kind"] | "garden" | "path" | "pavement" | "roadside-tree";
type MorphologyFeature = Omit<CoreFeature, "kind"> & { kind: MorphologyKind };

type StreetHit = { id: string; width: number; distance: number; x: number; z: number };
const resolvedPlots = new Map<string, Map<string, { x: number; z: number } | null>>();

function closestPointOnSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = wrapSourceX(bx - ax), dz = bz - az, qx = wrapSourceX(x - ax), qz = z - az,
    denominator = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / denominator));
  return { x: wrapSourceX(ax + dx * t), z: az + dz * t, distance: Math.hypot(qx - dx * t, qz - dz * t) };
}

function settlementStreetAt(place: Place, x: number, z: number): StreetHit | undefined {
  const plan = settlementExteriorFor(place);
  let best: StreetHit | undefined;
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], point = closestPointOnSegment(x, z, a.x, a.z, b.x, b.z);
    if (!best || point.distance < best.distance || (point.distance === best.distance && street.id < best.id))
      best = { id: street.id, width: street.width, ...point };
  }
  return best;
}

function externalRoadClear(x: number, z: number, radius: number) {
  return roads.every((road) => roadDistanceAt(x, z, road) > radius + 6);
}
function candidateLegal(place: Place, plan: SettlementExteriorPlan, plot: SettlementPlotPlan, candidate: { x: number; z: number }) {
  const surface = finalSurfaceAt(candidate.x, candidate.z);
  if (surface.groundHeight < .2 || surface.water.kind !== "none" || !surface.walkable) return false;
  const radius = plot.clearanceRadius;
  if (!externalRoadClear(candidate.x, candidate.z, radius)) return false;
  const street = settlementStreetAt(place, candidate.x, candidate.z);
  if (street && street.distance < street.width * .5 + radius) return false;
  if (plot.kind !== "field" && plan.gates.some((gate) => Math.hypot(wrapSourceX(candidate.x - gate.x), candidate.z - gate.z) < radius + 12)) return false;
  const sampleRadius = plot.kind === "keep" ? 15 : plot.kind === "field" ? 13 : plot.kind === "house" ? 7 : plot.kind === "service" ? 8 : plot.kind === "garden" ? 4 : 2;
  for (const [dx, dz] of [[0,0],[-sampleRadius,-sampleRadius],[-sampleRadius,sampleRadius],[sampleRadius,-sampleRadius],[sampleRadius,sampleRadius]]) {
    const point = finalSurfaceAt(candidate.x + dx, candidate.z + dz);
    if (point.water.kind !== "none" || !point.walkable || Math.abs(point.groundHeight - surface.groundHeight) > (plot.kind === "field" ? .1 : .28)) return false;
  }
  if (["house", "keep", "service"].includes(plot.kind)) {
    const entrance = street || settlementStreetAt(place, place.x, place.z);
    if (!entrance) return false;
    const dx = wrapSourceX(entrance.x - candidate.x), dz = entrance.z - candidate.z, length = Math.hypot(dx, dz), steps = Math.max(2, Math.ceil(length / 3));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, point = finalSurfaceAt(wrapSourceX(candidate.x + dx * t), candidate.z + dz * t);
      if (point.water.kind !== "none" || !point.walkable) return false;
    }
  }
  return true;
}
function expandedCandidates(place: Place, plot: SettlementPlotPlan) {
  const expanded: { x: number; z: number }[] = [];
  for (const candidate of plot.candidates) {
    expanded.push(candidate);
    const street = settlementStreetAt(place, candidate.x, candidate.z);
    if (!street || street.distance < .1) continue;
    const dx = wrapSourceX(candidate.x - street.x), dz = candidate.z - street.z, length = Math.hypot(dx, dz) || 1;
    for (const extra of [8, 16, 24, 32]) expanded.push({ x: wrapSourceX(candidate.x + dx / length * extra), z: candidate.z + dz / length * extra });
  }
  return expanded;
}
function resolvedFor(place: Place) {
  let result = resolvedPlots.get(place.code);
  if (result) return result;
  const plan = settlementExteriorFor(place), occupied: { x: number; z: number; radius: number }[] = [];
  result = new Map();
  for (const plot of plan.plots) {
    const chosen = expandedCandidates(place, plot).find((candidate) =>
      candidateLegal(place, plan, plot, candidate) &&
      !occupied.some((other) => Math.hypot(wrapSourceX(candidate.x - other.x), candidate.z - other.z) < plot.clearanceRadius + other.radius)
    ) || null;
    result.set(plot.id, chosen);
    if (chosen) occupied.push({ ...chosen, radius: plot.clearanceRadius });
  }
  resolvedPlots.set(place.code, result);
  return result;
}
function settlementMarker(place: Place) { return `/F/${place.id}/`; }

/** S004 settlement morphology overlay. Identity comes only from seed-derived plans and coordinates. */
export function featuresFor(tile: Tile): MorphologyFeature[] {
  const tileCentreX = tile.minX + tile.size * .5, tileCentreZ = tile.minZ + tile.size * .5,
    localPlaces = nearbyPlaces(tileCentreX, tileCentreZ), markers = localPlaces.map(settlementMarker),
    features = coreFeaturesFor(tile).filter((feature) => !markers.some((marker) => feature.code.includes(marker))) as MorphologyFeature[];
  const add = (kind: MorphologyKind, x: number, z: number, variant: number, id: string, metadata: Record<string, unknown> = {}) => {
    if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) return;
    const surface = finalSurfaceAt(x, z);
    if (surface.water.kind !== "none" || !surface.walkable) return;
    features.push({ kind, x, z, y: surface.groundHeight, variant, code: `${WORLD_SEED}/${GENERATOR_VERSION}/F/${id}`, ...metadata } as MorphologyFeature);
  };

  // `places` remains the immutable coarse registry; nearbyPlaces is only the bounded acceleration path.
  void places;
  for (const place of localPlaces) {
    const coarseExtent = place.kind === "city" ? 456 : 178;
    if (Math.abs(wrapSourceX(place.x - tileCentreX)) > tile.size * .5 + coarseExtent || Math.abs(place.z - tileCentreZ) > tile.size * .5 + coarseExtent) continue;
    const plan = settlementExteriorFor(place), anchors = resolvedFor(place);
    for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
      const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (!length) continue;
      add("street", wrapSourceX(a.x + dx * .5), a.z + dz * .5, Math.round(street.width * 10), `${place.id}/street/${street.id}/${index}`, {
        yawRad: Math.atan2(dx, dz), footprintWidth: street.width, footprintDepth: length, length, label: "Street",
      });
    }
    for (let segment = 0; segment < plan.border.length; segment++) {
      const a = plan.border[segment], b = plan.border[(segment + 1) % plan.border.length], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z,
        length = Math.hypot(dx, dz), pieces = Math.max(1, Math.ceil(length / 10));
      for (let piece = 0; piece < pieces; piece++) {
        const tm = (piece + .5) / pieces, x = wrapSourceX(a.x + dx * tm), z = a.z + dz * tm, pieceLength = length / pieces;
        if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 13)) continue;
        add("border", x, z, place.kind === "city" ? 1 : 0, `${place.id}/border/${segment}/${piece}`, {
          yawRad: Math.atan2(dx, dz), footprintWidth: place.kind === "city" ? 1.6 : .9, footprintDepth: pieceLength + .4, length: pieceLength + .4,
        });
      }
    }
    for (const plot of plan.plots) {
      const point = anchors.get(plot.id);
      if (!point) continue;
      const kind: MorphologyKind = plot.kind === "service" ? "service" : plot.kind,
        street = settlementStreetAt(place, point.x, point.z), dx = street ? wrapSourceX(street.x - point.x) : 0, dz = street ? street.z - point.z : 0,
        distance = Math.hypot(dx, dz), edgeOffset = Math.min(distance * .45, Math.max(1.4, Math.min(plot.width, plot.depth) * .42)),
        door = street && distance > 0 ? { x: wrapSourceX(point.x + dx / distance * edgeOffset), z: point.z + dz / distance * edgeOffset } : point;
      add(kind, point.x, point.z, digest(`${plot.id}/FEATURE`), `${place.id}/${plot.id}`, {
        service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind,
        entranceX: door.x, entranceZ: door.z, yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, fieldForm: plot.fieldForm,
      });
      if (["house", "service", "keep"].includes(kind) && street && distance > edgeOffset + .8) {
        const pathDx = wrapSourceX(street.x - door.x), pathDz = street.z - door.z, pathLength = Math.hypot(pathDx, pathDz);
        add("path", wrapSourceX(door.x + pathDx * .5), door.z + pathDz * .5, digest(`${plot.id}/PATH`), `${place.id}/path/${plot.id}`, {
          ownerId: plot.ownerId, label: "Access path", entranceX: door.x, entranceZ: door.z,
          yawRad: Math.atan2(pathDx, pathDz), footprintWidth: 1.25, footprintDepth: pathLength, length: pathLength,
        });
      }
    }

    const pedestrianStreets = plan.streets.slice(0, place.kind === "city" ? Math.min(2, plan.streets.length) : 1);
    for (const street of pedestrianStreets) {
      const side = (digest(`${place.code}/PAVEMENT/${street.id}/SIDE`) & 1) === 0 ? -1 : 1;
      for (let index = 1; index < street.points.length; index++) {
        const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < 1) continue;
        const nx = -dz / length, nz = dx / length, offset = side * (street.width * .5 + 2.25), x = wrapSourceX(a.x + dx * .5 + nx * offset), z = a.z + dz * .5 + nz * offset;
        if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 11)) continue;
        add("pavement", x, z, digest(`${street.id}/PAVEMENT/${index}`), `${place.id}/pavement/${street.id}/${index}`, {
          label: "Packed pedestrian edge", yawRad: Math.atan2(dx, dz), footprintWidth: 1.5, footprintDepth: length, length,
        });
      }
    }

    const mainStreet = plan.streets[0];
    for (let index = 2; index < mainStreet.points.length - 1; index += 3) {
      const value = digest(`${place.code}/ROADSIDE-TREE/${index}`), anchor = mainStreet.points[index], previous = mainStreet.points[index - 1], next = mainStreet.points[index + 1],
        dx = wrapSourceX(next.x - previous.x), dz = next.z - previous.z, length = Math.hypot(dx, dz) || 1, side = (value & 1) === 0 ? -1 : 1,
        offset = mainStreet.width * .5 + 5 + ((value >>> 3) % 5), x = wrapSourceX(anchor.x - dz / length * offset * side), z = anchor.z + dx / length * offset * side;
      if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 18)) continue;
      if (naturalSurfaceAt(x, z).freshwaterDistanceSource < 2) continue;
      const surface = finalSurfaceAt(x, z);
      if (surface.water.kind !== "none" || !surface.walkable) continue;
      add("roadside-tree", x, z, value, `${place.id}/roadside-tree/${index}`, { label: "Roadside tree" });
    }

    for (const gate of plan.gates) {
      const gateYaw = Math.PI / 2 - gate.bearingRad;
      add("gate", gate.x, gate.z, digest(gate.id), `${place.id}/gate/${gate.id}`, { label: `${place.name} gate`, entranceX: plan.centre.x, entranceZ: plan.centre.z, yawRad: gateYaw, footprintWidth: 11, footprintDepth: 2 });
      for (let index = 0; index < gate.guardPosts.length; index++) {
        const post = gate.guardPosts[index];
        add("guard-post", post.x, post.z, digest(`${gate.id}/${index}`), `${place.id}/guard-post/${gate.id}/${index}`, { service: "guard-office", capacity: 4, residents: 2, label: "Guard post", entranceX: gate.x, entranceZ: gate.z, yawRad: gateYaw, footprintWidth: 4.5, footprintDepth: 4.5 });
      }
    }
  }
  return features;
}
