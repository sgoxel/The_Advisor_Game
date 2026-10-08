import { TIME_SCALE } from "./clock.ts";

/** Canonical physical travel speeds in metres per fantasy second. */
export const GOOD_ROAD_WALK_SPEED_MPS = 1; // 3.6 km / fantasy hour
export const OPEN_GROUND_WALK_SPEED_MPS = 5 / 6; // 3.0 km / fantasy hour
export const DIFFICULT_TERRAIN_WALK_SPEED_MPS = 0.5; // 1.8 km / fantasy hour
export const MIN_VILLAGE_WALK_FANTASY_SECONDS = 60 * 60;
export const MIN_VILLAGE_FASTEST_DISTANCE_M =
  GOOD_ROAD_WALK_SPEED_MPS * MIN_VILLAGE_WALK_FANTASY_SECONDS;

export type WalkSurface = "good-road" | "open-ground" | "difficult-terrain";

export function walkSpeedMps(surface: WalkSurface): number {
  if (surface === "good-road") return GOOD_ROAD_WALK_SPEED_MPS;
  if (surface === "open-ground") return OPEN_GROUND_WALK_SPEED_MPS;
  return DIFFICULT_TERRAIN_WALK_SPEED_MPS;
}

export function fantasyTravelSeconds(
  distanceM: number,
  surface: WalkSurface,
): number {
  if (!Number.isFinite(distanceM) || distanceM < 0)
    throw new RangeError("Travel distance must be a finite non-negative metre value");
  return distanceM / walkSpeedMps(surface);
}

export function realSecondsForFantasy(fantasySeconds: number): number {
  if (!Number.isFinite(fantasySeconds) || fantasySeconds < 0)
    throw new RangeError("Fantasy duration must be finite and non-negative");
  return fantasySeconds / TIME_SCALE;
}

export function travelMetrics(distanceM: number, surface: WalkSurface) {
  const fantasySeconds = fantasyTravelSeconds(distanceM, surface);
  return {
    distanceM,
    surface,
    speedMps: walkSpeedMps(surface),
    fantasySeconds,
    realSeconds: realSecondsForFantasy(fantasySeconds),
  };
}

function minutesLabel(seconds: number, suffix: string): string {
  const minutes = seconds / 60;
  const value = minutes >= 100 ? Math.round(minutes) : Number(minutes.toFixed(2));
  return `${value} ${suffix}`;
}

export const fantasyDurationLabel = (seconds: number) =>
  minutesLabel(seconds, "fantasy min");
export const realDurationLabel = (seconds: number) =>
  minutesLabel(seconds, "real min");
