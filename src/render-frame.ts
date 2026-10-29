import type { Tile } from "./world.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import type { FinalSurface } from "./final-surface.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  CANONICAL_PLANET_RADIUS,
  enuToPosition,
  greatCircleDistance,
  lonLatToSource,
  positionToEnu,
  sourceToLonLat,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";

/** Canonical elevation is metres; the renderer uses the same scale on all axes. */
export const elevationToRenderY = (metres: number) => metres / CANONICAL_METRES_PER_SOURCE_UNIT;

/** The visible hit is a legal deck, water level, or exposed composed ground. */
export const visibleSurfaceElevation = (surface: Pick<FinalSurface, "deckHeight" | "groundHeight" | "water">) =>
  surface.deckHeight ?? (surface.water.kind === "none" ? surface.groundHeight :
    surface.water.level ?? surface.groundHeight);

/** Detailed GPU coordinates must remain inside this canonical-metre envelope. */
export const GPU_LOCAL_LIMIT_M = 8_192;
/** Move the presentation origin before the focus drifts far enough to lose precision. */
export const REBASE_THRESHOLD_M = 2_048;

export type RenderPoint = { x: number; y: number; z: number };
export type PatchTransform = { x: number; z: number; yawDegrees: number };
export type PatchConversionStats = {
  maxHorizontalM: number;
  maxFloat32ErrorM: number;
};

function sourcePosition(x: number, z: number): CanonicalPosition {
  const { lon, lat } = sourceToLonLat(x, z);
  return { lon, lat, elevation: 0 };
}

/** Canonical anchor shared by worker geometry and the main-thread patch transform. */
export function tilePatchOrigin(tile: Tile): CanonicalPosition {
  return sourcePosition(tile.minX + tile.size / 2, tile.minZ + tile.size / 2);
}

/**
 * Return the point on the canonical sphere whose orthographic ENU projection has
 * the requested east/north components. This exactly inverts positionToEnu for
 * the near hemisphere and keeps picking on the planet surface rather than on a
 * tangent plane floating above it.
 */
function surfacePositionFromEnu(
  east: number,
  north: number,
  origin: CanonicalPosition,
): CanonicalPosition {
  const horizontalSq = east * east + north * north;
  if (horizontalSq >= CANONICAL_PLANET_RADIUS * CANONICAL_PLANET_RADIUS)
    throw new RangeError("Local render point is outside the ENU near hemisphere");
  const up =
    Math.sqrt(CANONICAL_PLANET_RADIUS * CANONICAL_PLANET_RADIUS - horizontalSq) -
    CANONICAL_PLANET_RADIUS;
  return enuToPosition({ east, north, up }, origin);
}

/** Recompute normals in the right-handed render frame: east, up, south. */
function recomputeNormals(geometry: Geometry) {
  const { positions, normals, indices } = geometry;
  normals.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3,
      ib = indices[i + 1] * 3,
      ic = indices[i + 2] * 3,
      ux = positions[ib] - positions[ia],
      uy = positions[ib + 1] - positions[ia + 1],
      uz = positions[ib + 2] - positions[ia + 2],
      vx = positions[ic] - positions[ia],
      vy = positions[ic + 1] - positions[ia + 1],
      vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    // Adaptive natural terrain shares top vertices between triangles. Replacing
    // their normal on each face used the last triangle's slope and discarded
    // the smooth area-weighted normals constructed by the surface builder.
    // Accumulate in ENU after height scaling; skirt/structure hard edges still
    // have independent vertices and therefore retain their own face normals.
    normals[ia] += nx;
    normals[ia + 1] += ny;
    normals[ia + 2] += nz;
    normals[ib] += nx;
    normals[ib + 1] += ny;
    normals[ib + 2] += nz;
    normals[ic] += nx;
    normals[ic + 1] += ny;
    normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length === 0) continue;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
}

/**
 * Convert worker geometry from patch-relative S001 source offsets into
 * patch-relative canonical ENU coordinates. Terrain Y is canonical metres and
 * is scaled with the horizontal axes. Prop builders already convert their ground
 * anchors, retaining prototype model dimensions in presentation units.
 */
export function convertTileGeometryToEnu(
  tile: Tile,
  data: TileGeometry,
): PatchConversionStats {
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    origin = tilePatchOrigin(tile);
  let maxHorizontalM = 0,
    maxFloat32ErrorM = 0;
  for (const [kind, geometry] of Object.entries(data)) {
    const p = geometry.positions;
    for (let i = 0; i < p.length; i += 3) {
      const sourceX = originX + p[i],
        sourceZ = originZ + p[i + 2],
        position = sourcePosition(sourceX, sourceZ),
        enu = positionToEnu(position, origin),
        x = enu.east / CANONICAL_METRES_PER_SOURCE_UNIT,
        z = -enu.north / CANONICAL_METRES_PER_SOURCE_UNIT,
        fx = Math.fround(x),
        fz = Math.fround(z);
      maxHorizontalM = Math.max(maxHorizontalM, Math.hypot(enu.east, enu.north));
      maxFloat32ErrorM = Math.max(
        maxFloat32ErrorM,
        Math.abs(fx - x) * CANONICAL_METRES_PER_SOURCE_UNIT,
        Math.abs(fz - z) * CANONICAL_METRES_PER_SOURCE_UNIT,
      );
      p[i] = fx;
      if(kind === "terrain") p[i + 1] = Math.fround(elevationToRenderY(p[i + 1]));
      p[i + 2] = fz;
    }
    recomputeNormals(geometry);
  }
  return { maxHorizontalM, maxFloat32ErrorM };
}

/**
 * Presentation-only moving frame. Canonical identity remains lon/lat/elevation;
 * changing this origin only changes the small coordinates sent to the renderer.
 */
export class LocalRenderFrame {
  private origin: CanonicalPosition;
  readonly stats = {
    rebases: 0,
    lastRebaseDistanceM: 0,
    maxFocusDistanceM: 0,
    transformedPatches: 0,
    resourceRebuildsOnRebase: 0,
  };

  constructor(sourceX: number, sourceZ: number) {
    this.origin = sourcePosition(sourceX, sourceZ);
  }

  get canonicalOrigin(): CanonicalPosition {
    return { ...this.origin };
  }

  distanceFromOrigin(sourceX: number, sourceZ: number): number {
    const target = sourceToLonLat(sourceX, sourceZ);
    return greatCircleDistance(this.origin, target);
  }

  shouldRebase(sourceX: number, sourceZ: number): boolean {
    return this.distanceFromOrigin(sourceX, sourceZ) > REBASE_THRESHOLD_M;
  }

  rebase(sourceX: number, sourceZ: number): boolean {
    const distance = this.distanceFromOrigin(sourceX, sourceZ);
    this.stats.maxFocusDistanceM = Math.max(this.stats.maxFocusDistanceM, distance);
    if (distance <= 1e-6) return false;
    this.origin = sourcePosition(sourceX, sourceZ);
    this.stats.rebases++;
    this.stats.lastRebaseDistanceM = distance;
    return true;
  }

  maybeRebase(sourceX: number, sourceZ: number): boolean {
    const distance = this.distanceFromOrigin(sourceX, sourceZ);
    this.stats.maxFocusDistanceM = Math.max(this.stats.maxFocusDistanceM, distance);
    if (distance <= REBASE_THRESHOLD_M) return false;
    this.origin = sourcePosition(sourceX, sourceZ);
    this.stats.rebases++;
    this.stats.lastRebaseDistanceM = distance;
    return true;
  }

  sourceToRender(sourceX: number, sourceZ: number, y = 0): RenderPoint {
    const enu = positionToEnu(sourcePosition(sourceX, sourceZ), this.origin);
    return {
      x: enu.east / CANONICAL_METRES_PER_SOURCE_UNIT,
      y: elevationToRenderY(y),
      z: -enu.north / CANONICAL_METRES_PER_SOURCE_UNIT,
    };
  }

  renderToLonLat(x: number, z: number): LonLat {
    const position = surfacePositionFromEnu(
      x * CANONICAL_METRES_PER_SOURCE_UNIT,
      -z * CANONICAL_METRES_PER_SOURCE_UNIT,
      this.origin,
    );
    return { lon: position.lon, lat: position.lat };
  }

  renderToSource(x: number, z: number): { x: number; z: number } {
    const { lon, lat } = this.renderToLonLat(x, z);
    return lonLatToSource(lon, lat);
  }

  patchTransform(tile: Tile): PatchTransform {
    const patchOrigin = tilePatchOrigin(tile),
      centre = positionToEnu(patchOrigin, this.origin),
      eastTip = surfacePositionFromEnu(1, 0, patchOrigin),
      tip = positionToEnu(eastTip, this.origin),
      dx = tip.east - centre.east,
      dz = centre.north - tip.north,
      yawDegrees = (-Math.atan2(dz, dx) * 180) / Math.PI;
    this.stats.transformedPatches++;
    return {
      x: centre.east / CANONICAL_METRES_PER_SOURCE_UNIT,
      z: -centre.north / CANONICAL_METRES_PER_SOURCE_UNIT,
      yawDegrees,
    };
  }
}
