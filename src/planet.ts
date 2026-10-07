import { WORLD_SIZE } from "./world.ts";

/** Planet presentation contract. The flat world is the authority; the globe is a
 * view of it. East–west the flat width is one full turn of the planet. North is -Z. */
export const PLANET_CIRCUMFERENCE = WORLD_SIZE;
export const PLANET_RADIUS = PLANET_CIRCUMFERENCE / (2 * Math.PI);
/** Flat metres from the equator (z = 0) to either pole. */
export const POLE_DISTANCE = PLANET_CIRCUMFERENCE / 4;

/** Binding S002 physical planet scale. The S001 source coordinate domain is intentionally
 * kept separate until WP-S002-004-002 performs the runtime world rescale. */
export const CANONICAL_PLANET_RADIUS = 637_100;
export const CANONICAL_PLANET_CIRCUMFERENCE = 2 * Math.PI * CANONICAL_PLANET_RADIUS;
export const CANONICAL_PLANET_DIAMETER = 2 * CANONICAL_PLANET_RADIUS;
/** Physical metres represented by one transitional S001 source-coordinate metre. */
export const CANONICAL_METRES_PER_SOURCE_METRE = CANONICAL_PLANET_CIRCUMFERENCE / WORLD_SIZE;
export const canonicalFootprintForHalfHeight = (halfHeight: number) =>
  halfHeight * 2 * CANONICAL_METRES_PER_SOURCE_METRE;
export const halfHeightForCanonicalFootprint = (footprint: number) =>
  footprint / (2 * CANONICAL_METRES_PER_SOURCE_METRE);

/** Radians. Longitude is east-positive in [-π, π); latitude is north-positive. */
export type LonLat = { lon: number; lat: number };
export type Unit = [number, number, number];

/** Canonical east–west position in [-circumference / 2, circumference / 2). */
export function wrapX(x: number): number {
  const half = PLANET_CIRCUMFERENCE / 2;
  return (
    ((((x + half) % PLANET_CIRCUMFERENCE) + PLANET_CIRCUMFERENCE) %
      PLANET_CIRCUMFERENCE) -
    half
  );
}
/** Flat position clamped to the latitudes the planet has. */
export function clampZ(z: number): number {
  return Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, z));
}
export function flatToLonLat(x: number, z: number): LonLat {
  return { lon: wrapX(x) / PLANET_RADIUS, lat: -clampZ(z) / PLANET_RADIUS };
}
export function lonLatToFlat(
  lon: number,
  lat: number,
): { x: number; z: number } {
  return { x: wrapX(lon * PLANET_RADIUS), z: clampZ(-lat * PLANET_RADIUS) };
}
/** Globe-local unit vector: north pole +Y, longitude 0 at +Z, east toward +X. */
export function lonLatToUnit(lon: number, lat: number): Unit {
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}
export function unitToLonLat([x, y, z]: Unit): LonLat {
  return {
    lon: Math.atan2(x, z),
    lat: Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z)))),
  };
}
