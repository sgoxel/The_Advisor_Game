import { roadWidthM, roadNormalSource } from "./road-dimensions.ts";
import {elevationToRenderY} from "./render-frame.ts";
import type { Geometry, TileGeometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { roads, type Road } from "./geography.ts";
import { siteAccessRoads } from "./sites.ts";
import { roadFragmentsInBounds, clippedStationRange } from "./continuity-corridor.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { finalSurfaceAt, finalSurfaceRenderChannelsAt, type Tile } from "./world.ts";

/**
 * Fine presentation refinement for player-relevant prepared/water boundaries.
 *
 * The canonical surface remains finalSurfaceAt(). This module only resamples that
 * authority more densely where the coarse streaming mesh visibly aliases a road,
 * bank or bridge. It never invents terrain height, material, water or walkability.
 */
const LEGACY_BRIDGE_RGB = [115, 88, 56] as const;
export const REFINED_BRIDGE_RGB = [108, 79, 45] as const;
export const REFINED_ROAD_RGB = [143, 122, 84] as const;
export const REFINED_BRIDGE_HALF_WIDTH_SOURCE = 7 / CANONICAL_METRES_PER_SOURCE_UNIT;
export const REFINED_ROAD_HALF_WIDTH_SOURCE = 3 / CANONICAL_METRES_PER_SOURCE_UNIT;
// The canonical terrain shader hides road coverage outside ground-view scales.
const ROAD_COVERAGE_RGB: RGB = [112, 92, 62];
const GROUND_EPSILON = 0.025;
const BRIDGE_EPSILON = 0.1;

type Point = [number, number, number];
type RGB = readonly [number, number, number];

type ExtraGeometry = {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  uvs?: number[];
};

function emptyExtra(withUvs = false): ExtraGeometry {
  return {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    uvs: withUvs ? [] : undefined,
  };
}

function normalFor(a: Point, b: Point, c: Point): Point {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  return [nx, ny, nz];
}

function pushTriangle(
  extra: ExtraGeometry,
  tile: Tile,
  a: Point,
  b: Point,
  c: Point,
  tintA: RGB,
  tintB: RGB = tintA,
  tintC: RGB = tintA,
) {
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    n = normalFor(a, b, c),
    base = extra.positions.length / 3,
    points = [a, b, c] as const,
    tints = [tintA, tintB, tintC] as const;
  for (let i = 0; i < 3; i++) {
    const point = points[i];
    extra.positions.push(point[0] - originX, extra.uvs ? point[1] : elevationToRenderY(point[1]), point[2] - originZ);
    extra.normals.push(...n);
    const road=Boolean(extra.uvs)&&tints[i][0]===ROAD_COVERAGE_RGB[0]&&tints[i][1]===ROAD_COVERAGE_RGB[1]&&tints[i][2]===ROAD_COVERAGE_RGB[2],
      tint=road?terrainTint(point[0],point[2],32,undefined,0,false):tints[i];
    extra.colors.push(tint[0],tint[1],tint[2],extra.uvs?(road?255:0):255);
    if (extra.uvs)
      extra.uvs.push(
        point[0] / SOURCE_PRESENTATION_WIDTH + 0.5,
        Math.max(0, Math.min(1, 0.5 + (point[2] * 2) / SOURCE_PRESENTATION_WIDTH)),
      );
  }
  extra.indices.push(base, base + 1, base + 2);
}

function pushQuad(
  extra: ExtraGeometry,
  tile: Tile,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tintA: RGB,
  tintB: RGB = tintA,
  tintC: RGB = tintA,
  tintD: RGB = tintA,
) {
  pushTriangle(extra, tile, a, b, c, tintA, tintB, tintC);
  pushTriangle(extra, tile, a, c, d, tintA, tintC, tintD);
}

function mergeGeometry(base: Geometry, extra: ExtraGeometry): Geometry {
  if (!extra.positions.length) return base;
  const vertexOffset = base.positions.length / 3,
    positions = new Float32Array(base.positions.length + extra.positions.length),
    normals = new Float32Array(base.normals.length + extra.normals.length),
    colors = new Uint8Array(base.colors.length + extra.colors.length),
    indices = new Uint32Array(base.indices.length + extra.indices.length);
  positions.set(base.positions);
  positions.set(extra.positions, base.positions.length);
  normals.set(base.normals);
  normals.set(extra.normals, base.normals.length);
  colors.set(base.colors);
  colors.set(extra.colors, base.colors.length);
  indices.set(base.indices);
  for (let i = 0; i < extra.indices.length; i++)
    indices[base.indices.length + i] = extra.indices[i] + vertexOffset;

  let uvs = base.uvs;
  if (base.uvs || extra.uvs) {
    const baseUvs = base.uvs || new Float32Array(vertexOffset * 2),
      addedUvs = extra.uvs || new Array((extra.positions.length / 3) * 2).fill(0),
      combined = new Float32Array(baseUvs.length + addedUvs.length);
    combined.set(baseUvs);
    combined.set(addedUvs, baseUvs.length);
    uvs = combined;
  }
  return { positions, normals, colors, indices, uvs };
}

function isLegacyBridgeTriangle(geometry: Geometry, triangleOffset: number) {
  for (let corner = 0; corner < 3; corner++) {
    const vertex = geometry.indices[triangleOffset + corner],
      colorOffset = vertex * 4;
    if (
      geometry.colors[colorOffset] !== LEGACY_BRIDGE_RGB[0] ||
      geometry.colors[colorOffset + 1] !== LEGACY_BRIDGE_RGB[1] ||
      geometry.colors[colorOffset + 2] !== LEGACY_BRIDGE_RGB[2]
    )
      return false;
  }
  return true;
}

/** Remove the old 10-source-unit-wide deck before adding the authority-shaped deck. */
export function stripLegacyBridgeDeck(geometry: Geometry): Geometry {
  // Most fine tiles have no legacy bridge slabs. Avoid allocating and copying
  // every triangle into temporary JS arrays just to return the original mesh.
  // Inspect the exact same indexed RGB triplets as the removal pass: a partial
  // color match cannot trigger this path and no SEED/surface fact changes.
  let hasLegacyDeck = false;
  for (let i = 0; i < geometry.indices.length; i += 3)
    if (isLegacyBridgeTriangle(geometry, i)) {
      hasLegacyDeck = true;
      break;
    }
  if (!hasLegacyDeck) return geometry;

  let removed = false;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) {
    if (isLegacyBridgeTriangle(geometry, i)) {
      removed = true;
      continue;
    }
    for (let corner = 0; corner < 3; corner++) {
      const sourceVertex = geometry.indices[i + corner],
        targetVertex = positions.length / 3,
        p = sourceVertex * 3,
        c = sourceVertex * 4;
      positions.push(
        geometry.positions[p],
        geometry.positions[p + 1],
        geometry.positions[p + 2],
      );
      normals.push(
        geometry.normals[p],
        geometry.normals[p + 1],
        geometry.normals[p + 2],
      );
      colors.push(
        geometry.colors[c],
        geometry.colors[c + 1],
        geometry.colors[c + 2],
        geometry.colors[c + 3],
      );
      indices.push(targetVertex);
    }
  }
  if (!removed) return geometry;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
  };
}

// Refine the same physical road sources as final-surface and coarse tile rendering.
// Compose once rather than allocating a combined registry on every fine tile.
const refinementRoads: readonly Road[] = Object.freeze([...roads, ...siteAccessRoads]);

function shiftedRoadsIntersecting(tile: Tile): { road: Road; shiftX: number }[] {
  const matches: { road: Road; shiftX: number }[] = [];
  for (const road of roadFragmentsInBounds(refinementRoads, tile.minX, tile.minZ, tile.size))
    for (const shiftX of [-SOURCE_PRESENTATION_WIDTH, 0, SOURCE_PRESENTATION_WIDTH]) {
      const margin = 14,
        minX = road.minX + shiftX,
        maxX = road.maxX + shiftX;
      if (
        maxX < tile.minX - margin ||
        minX > tile.minX + tile.size + margin ||
        road.maxZ < tile.minZ - margin ||
        road.minZ > tile.minZ + tile.size + margin
      )
        continue;
      matches.push({ road, shiftX });
    }
  return matches;
}

function hasWaterBoundary(tile: Tile) {
  let wet = false,
    dry = false;
  for (let z = 0; z <= 4; z++)
    for (let x = 0; x <= 4; x++) {
      const surface = finalSurfaceRenderChannelsAt(
        tile.minX + (tile.size * x) / 4,
        tile.minZ + (tile.size * z) / 4,
      );
      if (surface.water.kind === "none") dry = true;
      else wet = true;
      if (wet && dry) return true;
    }
  return false;
}

/** Fine tiles normally use a 2-source-unit grid. Refined authority samples use <=1. */
export function refinementResolutionForTile(tile: Tile, hasRoad: boolean, waterBoundary: boolean) {
  if (tile.size > 64 || (!hasRoad && !waterBoundary)) return 0;
  return Math.min(32, Math.max(8, Math.ceil(tile.size)));
}

function addGroundRefinement(
  tile: Tile,
  extra: ExtraGeometry,
  resolution: number,
  refineRoadBank: boolean,
) {
  if (!resolution) return;
  const step = tile.size / resolution,
    // Memoize disposable presentation samples only within this one tile.
    // Exact coordinates are never rounded or used for Simulation authority.
    surfaceCache = new Map<string, ReturnType<typeof finalSurfaceRenderChannelsAt>>(),
    tintCache = new Map<string, ReturnType<typeof terrainTint>>();
  const keyFor = (x: number, z: number) => `${x}/${z}`;
  const renderAt = (x: number, z: number) => {
    const key = keyFor(x, z), cached = surfaceCache.get(key);
    if (cached) return cached;
    const surface = finalSurfaceRenderChannelsAt(x, z);
    surfaceCache.set(key, surface);
    return surface;
  };
  const tintAt = (x: number, z: number) => {
    const key = keyFor(x, z), cached = tintCache.get(key);
    if (cached) return cached;
    const tint = terrainTint(x, z);
    tintCache.set(key, tint);
    return tint;
  };
  const emit = (ax: number, az: number, size: number, depth: number): void => {
    const samples = [
      renderAt(ax, az),
      renderAt(ax, az + size),
      renderAt(ax + size, az + size),
      renderAt(ax + size, az),
    ];
    // Only road-adjacent shore cells need finer triangles at a bridge landing.
    // The previous full-size wet/dry quad could stretch a dry triangular
    // bank across the river. Bound subdivision to two additional levels;
    // each vertex still samples exactly the same final SEED surface.
    if (refineRoadBank && depth < 2) {
      const centre = renderAt(ax + size / 2, az + size / 2).water.kind,
        wet = samples.map(surface => surface.water.kind !== "none");
      if (wet.some(value => value !== wet[0]) ||
          wet.some(value => value !== (centre !== "none"))) {
        const half = size / 2;
        emit(ax, az, half, depth + 1);
        emit(ax + half, az, half, depth + 1);
        emit(ax, az + half, half, depth + 1);
        emit(ax + half, az + half, half, depth + 1);
        return;
      }
    }
    const points: Point[] = [
      [ax, samples[0].groundHeight + GROUND_EPSILON, az],
      [ax, samples[1].groundHeight + GROUND_EPSILON, az + size],
      [ax + size, samples[2].groundHeight + GROUND_EPSILON, az + size],
      [ax + size, samples[3].groundHeight + GROUND_EPSILON, az],
    ];
    if (Math.max(...points.map(point => point[1])) <= 0.05) return;
    const tints = points.map(point => tintAt(point[0], point[2])) as RGB[];
    pushQuad(extra, tile, points[0], points[1], points[2], points[3],
      tints[0], tints[1], tints[2], tints[3]);
  };
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++)
      emit(tile.minX + x * step, tile.minZ + z * step, step, 0);
}

/** Presentation-only guard: the selected road must own its legal bridge deck. */
export function selectedRoadBridgeDeck(
  surface: Pick<ReturnType<typeof finalSurfaceAt>, "deckHeight" | "walkable" | "traversal" | "deckOwnerIds">,
  roadCode: string,
) {
  return surface.deckHeight !== null && surface.walkable &&
    surface.traversal === "bridge" && surface.deckOwnerIds.includes(roadCode);
}

/**
 * The ordinary narrow ribbon can disappear for a whole station when one
 * shoreline endpoint is wet. Fill only the source-owned DRY carriageway on
 * that station, up to the exact legal bank. Never bridge an unsampled channel
 * or claim walking authority from presentation geometry.
 */
function addOwnedDryBridgeLanding(
  tile: Tile, ground: ExtraGeometry, roadCode: string,
  x0: number, z0: number, x1: number, z1: number,
  nx: number, nz: number,
) {
  const section = (t: number) => {
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t,
      left = { x: x + nx, z: z + nz }, right = { x: x - nx, z: z - nz },
      surfaces = [finalSurfaceAt(x, z), finalSurfaceAt(left.x, left.z), finalSurfaceAt(right.x, right.z)];
    if (!surfaces.every(s => s.water.kind === "none" && s.deckHeight === null &&
      s.walkable && s.groundMaterial === "Road" &&
      s.contributingModifierIds.includes(roadCode))) return null;
    return {
      left: [left.x, surfaces[1].groundHeight + GROUND_EPSILON, left.z] as Point,
      right: [right.x, surfaces[2].groundHeight + GROUND_EPSILON, right.z] as Point,
    };
  };
  const emit = (a: NonNullable<ReturnType<typeof section>>, b: NonNullable<ReturnType<typeof section>>) =>
    pushQuad(ground, tile, a.left, b.left, b.right, a.right, ROAD_COVERAGE_RGB);
  // At most eight finite quarter-road sections and six boundary bisections;
  // a centre sample guards each drawn piece against hidden river incisions.
  const divisions = 8;
  let previous = section(0);
  for (let i = 1; i <= divisions; i++) {
    const before = (i - 1) / divisions, after = i / divisions,
      next = section(after);
    if (previous && next) {
      if (section((before + after) / 2)) emit(previous, next);
    } else if (previous !== next) {
      let lo = before, hi = after;
      for (let j = 0; j < 6; j++) {
        const middle = (lo + hi) / 2;
        if (Boolean(section(middle)) === Boolean(previous)) lo = middle;
        else hi = middle;
      }
      const transition = section(previous ? lo : hi);
      if (transition) {
        if (previous && lo > before && section((before + lo) / 2)) emit(previous, transition);
        if (next && after > hi && section((hi + after) / 2)) emit(transition, next);
      }
    }
    previous = next;
  }
}

function addRoadAndBridgeRibbons(
  tile: Tile,
  ground: ExtraGeometry,
  prepared: ExtraGeometry,
  matches: readonly { road: Road; shiftX: number }[],
) {
  for (const { road, shiftX } of matches) {
    const vx = road.toX - road.fromX,
      vz = road.toZ - road.fromZ,
      length = Math.hypot(vx, vz);
    if (!length) continue;
    const ux = vx / length,
      uz = vz / length,
      segmentCount = Math.max(1, Math.ceil(length)),
      normal = roadNormalSource(vx, vz, (road.fromZ + road.toZ) / 2, roadWidthM(road) / 2),
      bridgeNx = normal.x, bridgeNz = normal.z;
    const [first, last] = clippedStationRange(road.fromX + shiftX, road.fromZ, road.toX + shiftX, road.toZ, tile.minX, tile.minZ, tile.size, segmentCount);
    for (let index = first; index < last; index++) {
      const t0 = index / segmentCount,
        t1 = (index + 1) / segmentCount,
        x0 = road.fromX + shiftX + vx * t0,
        z0 = road.fromZ + vz * t0,
        x1 = road.fromX + shiftX + vx * t1,
        z1 = road.fromZ + vz * t1,
        mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      if (
        mx < tile.minX ||
        mx >= tile.minX + tile.size ||
        mz < tile.minZ ||
        mz >= tile.minZ + tile.size
      )
        continue;
      const middle = finalSurfaceAt(mx, mz);
      // The deck-midpoint test can span a mixed wet/dry bank station. The
      // original narrow road ribbon rejects that entire station on one wet
      // corner, leaving an abrupt pale wedge next to an otherwise legal deck.
      // Its bank apron uses the same physical road width and shares
      // final-surface ownership; no underwater or unowned connecting surface.
      const stationStart = finalSurfaceAt(x0, z0),
        stationEnd = finalSurfaceAt(x1, z1);
      if ([stationStart, middle, stationEnd].some(s =>
        s.water.kind === "river" || selectedRoadBridgeDeck(s, road.code))) {
        addOwnedDryBridgeLanding(tile, ground, road.code, x0, z0, x1, z1,
          bridgeNx, bridgeNz);
      }
      // A nearby crossing belonging to another road is not this segment's
      // physical bridge. Refined decks and coarse decks use the same owner.
      if (selectedRoadBridgeDeck(middle, road.code)) {
        const start = finalSurfaceAt(x0, z0), end = finalSurfaceAt(x1, z1),
          y0 = (start.deckHeight ?? start.groundHeight) + BRIDGE_EPSILON,
          y1 = (end.deckHeight ?? end.groundHeight) + BRIDGE_EPSILON,
          a: Point = [x0 + bridgeNx, y0, z0 + bridgeNz],
          b: Point = [x1 + bridgeNx, y1, z1 + bridgeNz],
          c: Point = [x1 - bridgeNx, y1, z1 - bridgeNz],
          d: Point = [x0 - bridgeNx, y0, z0 - bridgeNz];
        pushQuad(prepared, tile, a, b, c, d, REFINED_BRIDGE_RGB);
        // Contrasting timber rail surfaces stay legible against the deck in 3D.
        // Narrow edge strips make the crossing read as a bridge without adding
        // collision-only geometry or broadening its authoritative deck support.
        const rail = 0.7 / CANONICAL_METRES_PER_SOURCE_UNIT,
          railHeightM = 1.15,
          edgeTint: RGB = [181, 143, 92];
        pushQuad(
          prepared,
          tile,
          [x0 + bridgeNx, y0 + railHeightM, z0 + bridgeNz],
          [x1 + bridgeNx, y1 + railHeightM, z1 + bridgeNz],
          [x1 + bridgeNx + uz * rail, y1 + railHeightM, z1 + bridgeNz - ux * rail],
          [x0 + bridgeNx + uz * rail, y0 + railHeightM, z0 + bridgeNz - ux * rail],
          edgeTint,
        );
        pushQuad(
          prepared,
          tile,
          [x0 - bridgeNx - uz * rail, y0 + railHeightM, z0 - bridgeNz + ux * rail],
          [x1 - bridgeNx - uz * rail, y1 + railHeightM, z1 - bridgeNz + ux * rail],
          [x1 - bridgeNx, y1 + railHeightM, z1 - bridgeNz],
          [x0 - bridgeNx, y0 + railHeightM, z0 - bridgeNz],
          edgeTint,
        );
        // Physical guardrail faces are visual only: deck width, grade,
        // water and walking authority still come from finalSurfaceAt.
        pushQuad(prepared, tile,
          [x0 + bridgeNx, y0, z0 + bridgeNz],
          [x1 + bridgeNx, y1, z1 + bridgeNz],
          [x1 + bridgeNx, y1 + railHeightM, z1 + bridgeNz],
          [x0 + bridgeNx, y0 + railHeightM, z0 + bridgeNz],
          edgeTint,
        );
        pushQuad(prepared, tile,
          [x0 - bridgeNx, y0 + railHeightM, z0 - bridgeNz],
          [x1 - bridgeNx, y1 + railHeightM, z1 - bridgeNz],
          [x1 - bridgeNx, y1, z1 - bridgeNz],
          [x0 - bridgeNx, y0, z0 - bridgeNz],
          edgeTint,
        );
        // The original faces point inward toward the road. Also draw the
        // outward-facing sides so a river-side inspection never sees a
        // back-face-culled rail. No new deck/collision/walkability authority.
        const outerTint: RGB = [153, 112, 65];
        pushQuad(prepared, tile,
          [x0 + bridgeNx, y0 + railHeightM, z0 + bridgeNz],
          [x1 + bridgeNx, y1 + railHeightM, z1 + bridgeNz],
          [x1 + bridgeNx, y1, z1 + bridgeNz],
          [x0 + bridgeNx, y0, z0 + bridgeNz],
          outerTint,
        );
        pushQuad(prepared, tile,
          [x0 - bridgeNx, y0, z0 - bridgeNz],
          [x1 - bridgeNx, y1, z1 - bridgeNz],
          [x1 - bridgeNx, y1 + railHeightM, z1 - bridgeNz],
          [x0 - bridgeNx, y0 + railHeightM, z0 - bridgeNz],
          outerTint,
        );
        // Two bounded timber uprights per already-owned deck segment make
        // the 1.15m rails readable from the real 3D inspection camera.
        // No extra deck, crossing, collision, route or mutable identity.
        const postHalf = 0.55 / CANONICAL_METRES_PER_SOURCE_UNIT,
          postDepth = 0.75 / CANONICAL_METRES_PER_SOURCE_UNIT,
          postHeightM = 1.65,
          postSide: RGB = [147, 106, 61],
          postCap: RGB = [218, 180, 116],
          baseY = (y0 + y1) / 2;
        for (const side of [-1, 1]) {
          const point = (along: number, outward: number, height: number): Point => [
            mx + ux * along + side * (bridgeNx - uz * outward),
            baseY + height,
            mz + uz * along + side * (bridgeNz + ux * outward),
          ];
          const i0 = point(-postHalf, 0, 0), i1 = point(postHalf, 0, 0),
            o0 = point(-postHalf, postDepth, 0), o1 = point(postHalf, postDepth, 0),
            I0 = point(-postHalf, 0, postHeightM), I1 = point(postHalf, 0, postHeightM),
            O0 = point(-postHalf, postDepth, postHeightM),
            O1 = point(postHalf, postDepth, postHeightM);
          pushQuad(prepared, tile, i0, i1, I1, I0, postSide);
          pushQuad(prepared, tile, o0, O0, O1, o1, postSide);
          // Both river-facing orientations must remain visible under
          // back-face culling and WebGPU/WebGL2 lighting parity.
          pushQuad(prepared, tile, o1, O1, O0, o0, postSide);
          pushQuad(prepared, tile, i0, I0, O0, o0, postSide);
          pushQuad(prepared, tile, i1, o1, O1, I1, postSide);
          // Reverse the cap winding on the + bank-facing side so BOTH
          // tops face upward under back-face culling.
          if (side > 0) pushQuad(prepared, tile, O0, O1, I1, I0, postCap);
          else pushQuad(prepared, tile, I0, I1, O1, O0, postCap);
        }
        continue;
      }
      // A narrow presentation-only road strip follows the same physical
      // centerline as the inspector. Never cover water, extrapolate missing
      // roads or paint an unowned connection as a traversable junction.
      // Terrain shader coverage hides the strip at cartographic/hidden scales.
      const start = finalSurfaceAt(x0, z0), end = finalSurfaceAt(x1, z1),
        valid = [start, middle, end].every(surface =>
          surface.water.kind === "none" &&
          surface.deckHeight === null &&
          surface.walkable &&
          surface.groundMaterial === "Road" &&
          surface.contributingModifierIds.includes(road.code));
      if (!valid) continue;
      const roadNx = normal.x,
        roadNz = normal.z,
        corners = [
          { x: x0 + roadNx, z: z0 + roadNz },
          { x: x1 + roadNx, z: z1 + roadNz },
          { x: x1 - roadNx, z: z1 - roadNz },
          { x: x0 - roadNx, z: z0 - roadNz },
        ],
        edges = corners.map(point => finalSurfaceAt(point.x, point.z));
      // Side vertices must use their own actual composed ground heights. An
      // elevated flat ribbon would violate final-surface truth at a graded road.
      if (!edges.every(surface =>
        surface.water.kind === "none" && surface.deckHeight === null &&
        surface.walkable && surface.groundMaterial === "Road" &&
        surface.contributingModifierIds.includes(road.code))) continue;
      const point = (index: number): Point =>
        [corners[index].x, edges[index].groundHeight + GROUND_EPSILON, corners[index].z];
      pushQuad(ground, tile, point(0), point(1), point(2), point(3), ROAD_COVERAGE_RGB);

    }
  }
}

/**
 * Resample only the visible alias-prone prepared/water areas. Query work and
 * geometry remain bounded by tile size and intersecting road support.
 */
export function refineTileSurfacePresentation(
  tile: Tile, data: TileGeometry, preserveGround = false, canonicalWaterBoundary4?: boolean,
): TileGeometry {
  // Coarse fallback/globe coverage must not materialize every fine road station.
  if (tile.size > 64) return data;
  const matches = shiftedRoadsIntersecting(tile),
    // Adaptive natural surface already sampled the exact same 25 coordinates
    // in its canonical 8x8 probe. Standalone callers retain the full check.
    waterBoundary = canonicalWaterBoundary4 ?? hasWaterBoundary(tile),
    resolution = refinementResolutionForTile(tile, matches.length > 0, waterBoundary);
  if (!resolution && !matches.length) return data;

  const ground = emptyExtra(true),
    prepared = emptyExtra(false);
  if (!preserveGround) addGroundRefinement(tile, ground, resolution, matches.length > 0 && waterBoundary);
  addRoadAndBridgeRibbons(tile, ground, prepared, matches);
  data.terrain = mergeGeometry(data.terrain, ground);
  data.structures = mergeGeometry(stripLegacyBridgeDeck(data.structures), prepared);
  return data;
}