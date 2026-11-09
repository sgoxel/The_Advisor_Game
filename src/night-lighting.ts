/**
 * Occupancy-driven building light (WP-S010-005-005).
 *
 * Presentation only: this module decides which already-existing building window
 * glow may be drawn. It never moves a resident, never changes a building and
 * never advances the clock.
 *
 * Two different questions are answered here and must not be confused:
 *
 * 1. `isNightSecond` — canonical darkness from docs/README.md (22:00–05:00).
 *    Only this window may light an occupied building.
 * 2. `litBuildingCodes` — of the buildings the player can see, which have a
 *    genuinely `indoors` resident of that exact building right now. Unknown or
 *    unresolved occupancy always fails dark.
 *
 * The artistic dusk/dawn gradient stays in `daylight.ts` and is cosmetic; it
 * can never light a building on its own.
 */
import type { Geometry } from "./geometry-core.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { wrapSourceX } from "./planet.ts";

/** Canonical night start, local Fantasy Time (docs/README.md: darkness at 22:00). */
export const NIGHT_START_SECOND = 22 * 3600;
/** Canonical night end: dawn/daylight begins at 05:00. */
export const NIGHT_END_SECOND = 5 * 3600;
export const SECONDS_PER_DAY = 86_400;

/** True inside the authoritative 22:00–04:59 darkness window. */
export function isNightSecond(localSecondOfDay: number): boolean {
  if (!Number.isFinite(localSecondOfDay)) return false;
  const second = ((localSecondOfDay % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return second >= NIGHT_START_SECOND || second < NIGHT_END_SECOND;
}

/** The subset of a rendered building the light decision needs. */
export type LitBuilding = {
  readonly code: string;
  readonly kind: string;
  readonly service?: string;
  readonly x: number;
  readonly z: number;
  readonly widthM?: number;
  readonly depthM?: number;
  readonly yawRad?: number;
};

/** The subset of a resident the light decision needs. */
export type LitResident = {
  readonly indoors: boolean;
  readonly route: string;
  readonly homeBuilding: string;
  readonly homeEntrance: string;
  readonly workplace: string;
  readonly x: number;
  readonly z: number;
};

/**
 * Same rule as `residentOccupiesBuilding` + `residentInsideRenderedService` in
 * Simulation, kept local so this decision is a cheap pure function and can be
 * unit-tested without building the whole Simulation. A parity test pins it to
 * the Simulation exports.
 */
export function residentLightsBuilding(resident: LitResident, building: LitBuilding): boolean {
  if (!resident.indoors || resident.route.startsWith("BLOCKED:")) return false;
  if (building.kind === "residence")
    return building.code.endsWith(`/${resident.homeBuilding}`) &&
      (resident.route === resident.homeEntrance || resident.route.startsWith(`${resident.homeBuilding}/`));
  if (building.kind !== "service" || !building.service) return false;
  const settlementCode = resident.homeBuilding.split("/RESIDENCE/")[0];
  if (!building.code.includes(`/${settlementCode}/PLOT/`)) return false;
  const site = building.service.replaceAll("-", "_").toUpperCase();
  if (!(resident.route === `${settlementCode}/${site}` ||
    (resident.route === resident.workplace && resident.workplace === `${settlementCode}/SERVICE/${site}`))) return false;
  return insideRenderedPlot(resident, building);
}

/** Canonical metres inside the rendered plot, using the world footprint yaw convention (identical to Simulation). */
function insideRenderedPlot(resident: Pick<LitResident, "x" | "z">, building: LitBuilding): boolean {
  const { widthM, depthM } = building;
  if (!widthM || !depthM || widthM <= 0 || depthM <= 0) return false;
  const metric = sourceUnitsPerMetreAt(building.z),
    dx = wrapSourceX(resident.x - building.x) / metric.x,
    dz = (resident.z - building.z) / metric.z,
    yaw = building.yawRad ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return Math.abs(dx * c - dz * s) <= widthM / 2 && Math.abs(dx * s + dz * c) <= depthM / 2;
}

/**
 * Codes of the visible buildings that may show occupancy light at this local
 * second. Deterministic given the resident facts; an empty or missing resident
 * list lights nothing (fail dark), never an invented occupant.
 */
export function litBuildingCodes(
  residents: readonly LitResident[],
  buildings: readonly LitBuilding[],
  localSecondOfDay: number,
): Set<string> {
  const lit = new Set<string>();
  if (!isNightSecond(localSecondOfDay)) return lit;
  for (const building of buildings)
    for (const resident of residents)
      if (residentLightsBuilding(resident, building)) { lit.add(building.code); break; }
  return lit;
}

/** Stable key for a lit set, so callers rebuild only on a real change. */
export function litSetKey(codes: Iterable<string>): string {
  return [...codes].sort().join("|");
}

/** Concatenate window-glow geometries; undefined when nothing is lit. */
export function mergeGlowGeometry(parts: readonly Geometry[]): Geometry | undefined {
  let vertexCount = 0, indexCount = 0;
  for (const part of parts) { vertexCount += part.positions.length / 3; indexCount += part.indices.length; }
  if (!vertexCount || !indexCount) return undefined;
  const positions = new Float32Array(vertexCount * 3),
    normals = new Float32Array(vertexCount * 3),
    colors = new Uint8Array(vertexCount * 4),
    indices = new Uint32Array(indexCount);
  let vertexOffset = 0, indexOffset = 0;
  for (const part of parts) {
    positions.set(part.positions, vertexOffset * 3);
    normals.set(part.normals, vertexOffset * 3);
    colors.set(part.colors, vertexOffset * 4);
    for (let i = 0; i < part.indices.length; i++) indices[indexOffset + i] = part.indices[i] + vertexOffset;
    vertexOffset += part.positions.length / 3;
    indexOffset += part.indices.length;
  }
  return { positions, normals, colors, indices };
}
