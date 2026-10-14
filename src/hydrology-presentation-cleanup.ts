import type { Geometry } from "./geometry.ts";
import { finalSurfaceAt, type Tile } from "./world.ts";

/**
 * Removes the obsolete dry river-bank mask from refined terrain geometry.
 * Canonical water, ground, traversal and routing truth are never changed here.
 */
const LEGACY_BANK_EPSILON = 0.12;
const LEGACY_BANK_TOLERANCE = 0.025;
const RIVER_REFINEMENT_MAX_TILE = 512;

function isLegacyBankVertex(tile: Tile, geometry: Geometry, vertex: number) {
  const p = vertex * 3,
    worldX = geometry.positions[p] + tile.minX + tile.size * 0.5,
    y = geometry.positions[p + 1],
    worldZ = geometry.positions[p + 2] + tile.minZ + tile.size * 0.5,
    surface = finalSurfaceAt(worldX, worldZ);
  return Math.abs(y - surface.groundHeight - LEGACY_BANK_EPSILON) <= LEGACY_BANK_TOLERANCE;
}

export function stripLegacyRiverBankMask(
  tile: Tile,
  geometry: Geometry,
  canonicalVertexCount: number,
): Geometry {
  if (tile.size > RIVER_REFINEMENT_MAX_TILE) return geometry;
  const kept: number[] = [];
  let removedTriangles = 0;
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const a = geometry.indices[offset], b = geometry.indices[offset + 1], c = geometry.indices[offset + 2],
      presentationOnly = a >= canonicalVertexCount && b >= canonicalVertexCount && c >= canonicalVertexCount,
      legacyBank = presentationOnly &&
        isLegacyBankVertex(tile, geometry, a) &&
        isLegacyBankVertex(tile, geometry, b) &&
        isLegacyBankVertex(tile, geometry, c);
    if (legacyBank) {
      removedTriangles++;
      continue;
    }
    kept.push(a, b, c);
  }
  if (!removedTriangles) return geometry;
  return {
    positions: geometry.positions,
    normals: geometry.normals,
    colors: geometry.colors,
    indices: new Uint32Array(kept),
    uvs: geometry.uvs,
  };
}
