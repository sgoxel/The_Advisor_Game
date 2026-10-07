import { WORLD_SEED } from "./config.ts";

/**
 * Canonical physical world authority for S002.
 *
 * The 262,144-wide S001 plane still exists temporarily as a render/generation
 * source domain, but it is not a physical distance or a stable world identity.
 * All authoritative positions and IDs in S002 are derived from longitude,
 * latitude, elevation and the constants below.
 */
export const CANONICAL_PLANET_RADIUS = 637_100;
export const CANONICAL_PLANET_DIAMETER = CANONICAL_PLANET_RADIUS * 2;
export const CANONICAL_PLANET_CIRCUMFERENCE =
  2 * Math.PI * CANONICAL_PLANET_RADIUS;
export const CANONICAL_POLE_DISTANCE =
  (Math.PI / 2) * CANONICAL_PLANET_RADIUS;

/** Transitional S001 source/render domain. Never use these as physical metres. */
export const SOURCE_PRESENTATION_WIDTH = 262_144;
export const SOURCE_PRESENTATION_RADIUS =
  SOURCE_PRESENTATION_WIDTH / (2 * Math.PI);
export const SOURCE_PRESENTATION_POLE_DISTANCE = SOURCE_PRESENTATION_WIDTH / 4;
export const CANONICAL_METRES_PER_SOURCE_UNIT =
  CANONICAL_PLANET_CIRCUMFERENCE / SOURCE_PRESENTATION_WIDTH;

/** Explicit render values used by the current globe/local presentation only. */
export const RENDER_PLANET_RADIUS = SOURCE_PRESENTATION_RADIUS;
export const RENDER_POLE_DISTANCE = SOURCE_PRESENTATION_POLE_DISTANCE;

/**
 * Temporary compatibility aliases for existing rendering/navigation modules.
 * These names describe presentation/source units only and MUST NOT be used as
 * canonical physical scale or stable identity inputs.
 */
export const PLANET_CIRCUMFERENCE = SOURCE_PRESENTATION_WIDTH;
export const PLANET_RADIUS = RENDER_PLANET_RADIUS;
export const POLE_DISTANCE = RENDER_POLE_DISTANCE;
export const CANONICAL_METRES_PER_SOURCE_METRE = CANONICAL_METRES_PER_SOURCE_UNIT;

/** Radians. Longitude is east-positive in [-π, π); latitude is north-positive. */
export type LonLat = { lon: number; lat: number };
export type CanonicalPosition = LonLat & { elevation: number };
export type PlanetMeters = { wrappedX: number; northM: number; elevation: number };
export type Cartesian = { x: number; y: number; z: number };
export type Unit = [number, number, number];
export type Enu = { east: number; north: number; up: number };
export type CubeFace = 0 | 1 | 2 | 3 | 4 | 5;
export type CubeCell = {
  face: CubeFace;
  level: number;
  u: number;
  v: number;
  id: string;
};

export function normalizeLongitude(lon: number): number {
  if (!Number.isFinite(lon)) throw new RangeError("Longitude must be finite");
  const turn = Math.PI * 2;
  const wrapped = ((lon + Math.PI) % turn + turn) % turn - Math.PI;
  // Keep the contract half-open even when floating-point modulo produces +π.
  return wrapped >= Math.PI ? -Math.PI : wrapped;
}

export function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) throw new RangeError("Latitude must be finite");
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat));
}

/** Canonical east-west helper coordinate in [-C/2, C/2). */
export function wrapCanonicalX(wrappedX: number): number {
  if (!Number.isFinite(wrappedX))
    throw new RangeError("Wrapped planet X must be finite");
  const half = CANONICAL_PLANET_CIRCUMFERENCE / 2,
    wrapped =
      ((((wrappedX + half) % CANONICAL_PLANET_CIRCUMFERENCE) +
        CANONICAL_PLANET_CIRCUMFERENCE) %
        CANONICAL_PLANET_CIRCUMFERENCE) -
      half,
    seamTolerance = CANONICAL_PLANET_CIRCUMFERENCE * Number.EPSILON * 8;
  // Floating point may land an exact full-turn input a few ulps below +C/2.
  // Collapse that numerical representation to the canonical half-open -C/2 seam.
  return Math.abs(wrapped - half) <= seamTolerance ? -half : wrapped;
}

export function lonLatToMeters(
  lon: number,
  lat: number,
  elevation = 0,
): PlanetMeters {
  return {
    wrappedX: CANONICAL_PLANET_RADIUS * normalizeLongitude(lon),
    northM: CANONICAL_PLANET_RADIUS * clampLatitude(lat),
    elevation,
  };
}

export function metersToLonLat(wrappedX: number, northM: number): LonLat {
  return {
    lon: normalizeLongitude(wrapCanonicalX(wrappedX) / CANONICAL_PLANET_RADIUS),
    lat: clampLatitude(northM / CANONICAL_PLANET_RADIUS),
  };
}

/**
 * Transitional source/render adapter. x/z are S001 source units, not metres.
 * North is -Z so travelling north raises latitude.
 */
export function sourceToLonLat(x: number, z: number): LonLat {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const wrappedX =
    ((((x + half) % SOURCE_PRESENTATION_WIDTH) + SOURCE_PRESENTATION_WIDTH) %
      SOURCE_PRESENTATION_WIDTH) -
    half;
  const clampedZ = Math.max(
    -SOURCE_PRESENTATION_POLE_DISTANCE,
    Math.min(SOURCE_PRESENTATION_POLE_DISTANCE, z),
  );
  return {
    lon: normalizeLongitude(wrappedX / SOURCE_PRESENTATION_RADIUS),
    lat: clampLatitude(-clampedZ / SOURCE_PRESENTATION_RADIUS),
  };
}

export function lonLatToSource(
  lon: number,
  lat: number,
): { x: number; z: number } {
  const normalized = normalizeLongitude(lon),
    bounded = clampLatitude(lat),
    x = normalized * SOURCE_PRESENTATION_RADIUS,
    z = -bounded * SOURCE_PRESENTATION_RADIUS;
  return {
    x:
      x >= SOURCE_PRESENTATION_WIDTH / 2
        ? x - SOURCE_PRESENTATION_WIDTH
        : x,
    z: Math.max(
      -SOURCE_PRESENTATION_POLE_DISTANCE,
      Math.min(SOURCE_PRESENTATION_POLE_DISTANCE, z),
    ),
  };
}

/** Backward-compatible presentation names. They are source adapters, not authority. */
export const flatToLonLat = sourceToLonLat;
export const lonLatToFlat = lonLatToSource;
export function wrapSourceX(x: number): number {
  return lonLatToSource(sourceToLonLat(x, 0).lon, 0).x;
}
export const wrapX = wrapSourceX;

export const canonicalFootprintForHalfHeight = (halfHeight: number) =>
  halfHeight * 2 * CANONICAL_METRES_PER_SOURCE_UNIT;
export const halfHeightForCanonicalFootprint = (footprint: number) =>
  footprint / (2 * CANONICAL_METRES_PER_SOURCE_UNIT);

/** Globe-local unit vector: north pole +Y, longitude 0 at +Z, east toward +X. */
export function lonLatToUnit(lon: number, lat: number): Unit {
  const canonicalLon = normalizeLongitude(lon),
    canonicalLat = clampLatitude(lat),
    poleDelta = Math.abs(Math.abs(canonicalLat) - Math.PI / 2);
  // Longitude is undefined at a pole. Pin exact/numerically exact poles to one
  // vector so every longitude path resolves to identical cube ownership and ID.
  if (poleDelta <= Number.EPSILON * 4)
    return [0, canonicalLat < 0 ? -1 : 1, 0];
  const c = Math.cos(canonicalLat);
  return [
    c * Math.sin(canonicalLon),
    Math.sin(canonicalLat),
    c * Math.cos(canonicalLon),
  ];
}

export function unitToLonLat([x, y, z]: Unit): LonLat {
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) throw new RangeError("Unit vector must be non-zero");
  return {
    lon: normalizeLongitude(Math.atan2(x, z)),
    lat: clampLatitude(Math.asin(Math.max(-1, Math.min(1, y / length)))),
  };
}

export function lonLatToCartesian(
  lon: number,
  lat: number,
  elevation = 0,
): Cartesian {
  const [x, y, z] = lonLatToUnit(lon, lat),
    radius = CANONICAL_PLANET_RADIUS + elevation;
  return { x: x * radius, y: y * radius, z: z * radius };
}

export function cartesianToPosition({ x, y, z }: Cartesian): CanonicalPosition {
  const radius = Math.hypot(x, y, z);
  if (!(radius > 0)) throw new RangeError("Planet-centred position must be non-zero");
  const { lon, lat } = unitToLonLat([x / radius, y / radius, z / radius]);
  return { lon, lat, elevation: radius - CANONICAL_PLANET_RADIUS };
}

export function greatCircleDistance(
  a: LonLat,
  b: LonLat,
  radius = CANONICAL_PLANET_RADIUS,
): number {
  const dLat = clampLatitude(b.lat) - clampLatitude(a.lat),
    dLon = normalizeLongitude(b.lon - a.lon),
    sinLat = Math.sin(dLat / 2),
    sinLon = Math.sin(dLon / 2),
    h =
      sinLat * sinLat +
      Math.cos(clampLatitude(a.lat)) *
        Math.cos(clampLatitude(b.lat)) *
        sinLon *
        sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

/** Shortest wrap-aware eastward angular delta from a to b. */
export function longitudeDelta(a: number, b: number): number {
  return normalizeLongitude(b - a);
}

function enuBasis(origin: LonLat) {
  const lon = normalizeLongitude(origin.lon),
    lat = clampLatitude(origin.lat),
    sinLon = Math.sin(lon),
    cosLon = Math.cos(lon),
    sinLat = Math.sin(lat),
    cosLat = Math.cos(lat);
  return {
    east: { x: cosLon, y: 0, z: -sinLon },
    north: {
      x: -sinLat * sinLon,
      y: cosLat,
      z: -sinLat * cosLon,
    },
    up: { x: cosLat * sinLon, y: sinLat, z: cosLat * cosLon },
  };
}

export function positionToEnu(
  position: CanonicalPosition,
  origin: CanonicalPosition,
): Enu {
  const p = lonLatToCartesian(position.lon, position.lat, position.elevation),
    o = lonLatToCartesian(origin.lon, origin.lat, origin.elevation),
    dx = p.x - o.x,
    dy = p.y - o.y,
    dz = p.z - o.z,
    basis = enuBasis(origin);
  return {
    east: dx * basis.east.x + dy * basis.east.y + dz * basis.east.z,
    north: dx * basis.north.x + dy * basis.north.y + dz * basis.north.z,
    up: dx * basis.up.x + dy * basis.up.y + dz * basis.up.z,
  };
}

export function enuToPosition(enu: Enu, origin: CanonicalPosition): CanonicalPosition {
  const o = lonLatToCartesian(origin.lon, origin.lat, origin.elevation),
    basis = enuBasis(origin),
    point = {
      x:
        o.x +
        enu.east * basis.east.x +
        enu.north * basis.north.x +
        enu.up * basis.up.x,
      y:
        o.y +
        enu.east * basis.east.y +
        enu.north * basis.north.y +
        enu.up * basis.up.y,
      z:
        o.z +
        enu.east * basis.east.z +
        enu.north * basis.north.z +
        enu.up * basis.up.z,
    };
  return cartesianToPosition(point);
}

/**
 * Deterministic six-face cube mapping. Exact edge/corner ties are owned in
 * X-before-Y-before-Z order, so every direction has one and only one face.
 */
export function unitToCubeFace([x, y, z]: Unit): {
  face: CubeFace;
  u: number;
  v: number;
} {
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z);
  if (!(ax > 0 || ay > 0 || az > 0))
    throw new RangeError("Cube direction must be non-zero");
  if (ax >= ay && ax >= az) {
    if (x >= 0) return { face: 0, u: -z / ax, v: y / ax };
    return { face: 1, u: z / ax, v: y / ax };
  }
  if (ay >= az) {
    if (y >= 0) return { face: 2, u: x / ay, v: -z / ay };
    return { face: 3, u: x / ay, v: z / ay };
  }
  if (z >= 0) return { face: 4, u: x / az, v: y / az };
  return { face: 5, u: -x / az, v: y / az };
}

export function cubeFaceToUnit(face: CubeFace, u: number, v: number): Unit {
  let vector: Unit;
  switch (face) {
    case 0:
      vector = [1, v, -u];
      break;
    case 1:
      vector = [-1, v, u];
      break;
    case 2:
      vector = [u, 1, -v];
      break;
    case 3:
      vector = [u, -1, v];
      break;
    case 4:
      vector = [u, v, 1];
      break;
    case 5:
      vector = [-u, v, -1];
      break;
  }
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function canonicalCell(
  lon: number,
  lat: number,
  level = 20,
  seed = WORLD_SEED,
  generation = "v1",
): CubeCell {
  if (!Number.isInteger(level) || level < 0 || level > 24)
    throw new RangeError("Canonical cube level must be an integer from 0 to 24");
  const mapped = unitToCubeFace(lonLatToUnit(lon, lat)),
    count = 2 ** level,
    index = (value: number) =>
      Math.max(
        0,
        Math.min(
          count - 1,
          Math.floor(
            ((Math.max(-1, Math.min(1, value)) + 1) / 2) * count,
          ),
        ),
      ),
    u = index(mapped.u),
    v = index(mapped.v);
  return {
    face: mapped.face,
    level,
    u,
    v,
    id: `${seed}/PLANET/${generation}/F${mapped.face}/L${level}/${u}/${v}`,
  };
}

export function canonicalCellId(
  lon: number,
  lat: number,
  level = 20,
  seed = WORLD_SEED,
  generation = "v1",
): string {
  return canonicalCell(lon, lat, level, seed, generation).id;
}

export const PLANET_AUTHORITY = Object.freeze({
  radiusM: CANONICAL_PLANET_RADIUS,
  diameterM: CANONICAL_PLANET_DIAMETER,
  circumferenceM: CANONICAL_PLANET_CIRCUMFERENCE,
  poleDistanceM: CANONICAL_POLE_DISTANCE,
  identity: "cube-sphere-quadtree",
  authoritativeCoordinates: "lon-lat-elevation",
  sourcePresentationWidth: SOURCE_PRESENTATION_WIDTH,
});
