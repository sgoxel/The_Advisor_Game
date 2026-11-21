import type { Tile } from "./world.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import { isGeometryLayer } from "./geometry-core.ts";
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

/** The first actual composed-surface ray hit, including a narrow cliff lip.
 * A fixed 8-render-unit stride jumped more than a kilometre at character scale
 * and could skip the entire original steep SEED face. Advance by the current
 * ray-to-final-surface clearance instead; near a face, probes become metre-scale.
 * This is only a click-time hit query: no camera, world or Simulation mutation. */
export function firstComposedSurfaceRayHitDistance(
  farDistance: number, clearanceAt: (distance: number) => number,
): number | null {
  if (!Number.isFinite(farDistance) || farDistance <= 0) return null;
  let before = 0, distance = 0;
  for (;;) {
    // At the pole or a missing canonical cell, a query can fail instead of
    // returning a height. A canvas click must fail closed, not throw through
    // the pointer handler and leave a stale or invented selected point.
    let clearance: number;
    try { clearance = clearanceAt(distance); }
    catch { return null; }
    if (!Number.isFinite(clearance)) return null;
    if (clearance <= 0) {
      let hit = distance;
      for (let i = 0; i < 18; i++) {
        const midpoint = (before + hit) / 2;
        let middleClearance: number;
        try { middleClearance = clearanceAt(midpoint); }
        catch { return null; }
        if (!Number.isFinite(middleClearance)) return null;
        if (middleClearance > 0) before = midpoint;
        else hit = midpoint;
      }
      return hit;
    }
    if (distance >= farDistance) return null;
    before = distance;
    // The canonical cliff's thin, high wall needs a much shorter final
    // stride than a flat camera-depth clip. Far from the ground stays coarse;
    // close to actual visible top, steps approach physical metres.
    distance = Math.min(farDistance, distance + Math.max(0.02, Math.min(8, clearance / 8)));
  }
}

/** Detailed GPU coordinates must remain inside this canonical-metre envelope. */
export const GPU_LOCAL_LIMIT_M = 8_192;
/** Move the presentation origin before the focus drifts far enough to lose precision. */
export const REBASE_THRESHOLD_M = 2_048;

/** Correct the existing focus-height plane pick only where the actual final
 * surface varies smoothly. This is a bounded presentation ray correction,
 * not a new terrain/collision authority. A cliff, invalid sample or unstable
 * iteration falls back to the original pick rather than inventing a crossing. */
export function tiltedGroundPickDistance(
  initialDistance: number,
  farDistance: number,
  rayDirectionY: number,
  rayYAt: (distance: number) => number,
  groundedYAt: (distance: number) => number,
): number {
  if (!Number.isFinite(initialDistance) || initialDistance < 0 ||
      !Number.isFinite(farDistance) || farDistance <= initialDistance ||
      !Number.isFinite(rayDirectionY) || rayDirectionY >= -1e-6)
    return initialDistance;
  let distance = initialDistance, previousDistance = NaN, previousGap = NaN;
  for (let i = 0; i < 6; i++) {
    let surfaceY: number;
    try { surfaceY = groundedYAt(distance); }
    catch { return initialDistance; }
    if (!Number.isFinite(surfaceY)) return initialDistance;
    const gap = rayYAt(distance) - surfaceY;
    if (!Number.isFinite(gap)) return initialDistance;
    if (Math.abs(gap) < 1e-4) return distance;
    // One secant update solves a uniformly graded road exactly. Unlike an
    // unbounded fixed-point chase, a discontinuous cliff or a nonconvergent
    // sample never becomes a claimed new ground intersection.
    const grade = Number.isFinite(previousDistance) && distance !== previousDistance
      ? (gap - previousGap) / (distance - previousDistance) : rayDirectionY;
    if (!Number.isFinite(grade) || Math.abs(grade) < 1e-6) return initialDistance;
    const next = distance - gap / grade;
    if (!Number.isFinite(next) || next < 0 || next > farDistance ||
        Math.abs(next - previousDistance) < 1e-4) return initialDistance;
    previousDistance = distance;
    previousGap = gap;
    distance = next;
  }
  return initialDistance;
}

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

/** Faces with |ny| / length below this are tile skirts / walls, never top surface. */
const VERTICAL_FACE_RATIO = 0.05;

/**
 * Recompute normals in the right-handed render frame: east, up, south.
 *
 * Non-terrain layers accumulate area-weighted face normals per vertex INDEX, so
 * indexed meshes smooth and non-indexed meshes stay flat.
 *
 * Terrain (`weld`) is built non-indexed (each triangle owns its 3 vertices), which
 * would render flat-shaded with a hard light/dark "X" where the base-grid centre
 * fans meet. Coincident vertices from adjacent triangles carry bit-identical
 * Float32 positions, so terrain additionally welds by exact position (typed-array
 * open-addressing hash, no string keys) and shares one smooth area-weighted
 * normal across the group. Near-vertical faces (skirts) are excluded from the
 * shared sum so they keep their own face normal and never bend the top surface.
 */
function recomputeNormals(geometry: Geometry, weld = false) {
  const { positions, normals, indices } = geometry;
  normals.fill(0);
  const vertexCount = positions.length / 3;
  // Per-index accumulation of every face (current behaviour), plus a second
  // accumulation of non-vertical faces only when welding.
  const top = weld ? new Float32Array(vertexCount * 3) : null;
  const hasTop = weld ? new Uint8Array(vertexCount) : null;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2],
      ia = a * 3,
      ib = b * 3,
      ic = c * 3,
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
    if (top && hasTop) {
      const length = Math.hypot(nx, ny, nz);
      if (length > 0 && Math.abs(ny) / length >= VERTICAL_FACE_RATIO) {
        top[ia] += nx; top[ia + 1] += ny; top[ia + 2] += nz;
        top[ib] += nx; top[ib + 1] += ny; top[ib + 2] += nz;
        top[ic] += nx; top[ic + 1] += ny; top[ic + 2] += nz;
        hasTop[a] = 1; hasTop[b] = 1; hasTop[c] = 1;
      }
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length === 0) continue;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  if (!top || !hasTop) return;

  // Weld: open-addressing hash over the exact Float32 bit pattern of positions.
  // -0 is canonicalised to +0 so equal coordinates always share a group.
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const coord = (k: number) => (bits[k] === 0x80000000 ? 0 : bits[k]);
  let capacity = 16;
  while (capacity < vertexCount * 2) capacity <<= 1;
  const mask = capacity - 1;
  const slots = new Int32Array(capacity).fill(-1); // representative vertex per slot
  const group = new Int32Array(vertexCount);
  const sum = new Float32Array(vertexCount * 3); // indexed by representative
  for (let v = 0; v < vertexCount; v++) {
    const k = v * 3,
      x = coord(k), y = coord(k + 1), z = coord(k + 2);
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    let slot = h & mask;
    for (;;) {
      const rep = slots[slot];
      if (rep < 0) {
        slots[slot] = v;
        group[v] = v;
        break;
      }
      const r = rep * 3;
      if (coord(r) === x && coord(r + 1) === y && coord(r + 2) === z) {
        group[v] = rep;
        break;
      }
      slot = (slot + 1) & mask;
    }
    const g = group[v] * 3;
    sum[g] += top[k];
    sum[g + 1] += top[k + 1];
    sum[g + 2] += top[k + 2];
  }
  for (let v = 0; v < vertexCount; v++) {
    if (!hasTop[v]) continue;
    const g = group[v] * 3,
      length = Math.hypot(sum[g], sum[g + 1], sum[g + 2]);
    if (length === 0) continue;
    const k = v * 3;
    normals[k] = sum[g] / length;
    normals[k + 1] = sum[g + 1] / length;
    normals[k + 2] = sum[g + 2] / length;
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
    if (!isGeometryLayer(geometry)) continue;
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
    recomputeNormals(geometry, kind === "terrain");
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
