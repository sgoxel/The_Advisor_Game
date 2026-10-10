import type { Geometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { settlementStreetAtSource } from "./settlements.ts";
import { heightAt, type Tile } from "./world.ts";

const LEGACY_ROAD = [170, 151, 113] as const;
const OFFSETS = [
  [13.7, 8.1],
  [-11.2, 17.4],
  [19.3, -7.7],
  [-21.1, -12.6],
] as const;

function legacyRoadTint(colors: Uint8Array, offset: number) {
  return (
    colors[offset] === LEGACY_ROAD[0] &&
    colors[offset + 1] === LEGACY_ROAD[1] &&
    colors[offset + 2] === LEGACY_ROAD[2]
  );
}

/**
 * The S001 terrain material still contains the retired 20×20-city-grid/central-cross
 * road tint. WP009 owns settlement presentation, so strip only that legacy tint from
 * settlement ground while preserving real geography roads and the new canonical
 * internal street ribbons. This is presentation-only and cannot affect routing.
 */
export function removeLegacySettlementGridTint(tile: Tile, terrain: Geometry) {
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  for (let vertex = 0, colorOffset = 0; vertex < terrain.positions.length; vertex += 3, colorOffset += 4) {
    if (!legacyRoadTint(terrain.colors, colorOffset)) continue;
    const x = terrain.positions[vertex] + originX,
      z = terrain.positions[vertex + 2] + originZ,
      place = nearestPlace(x, z);
    if (!place) continue;
    const settlementRadius = place.kind === "city" ? 450 : 100;
    if (Math.hypot(x - place.x, z - place.z) > settlementRadius) continue;
    const externalRoad = roadAt(x, z);
    if (
      settlementStreetAtSource(x, z) ||
      (externalRoad && roadDistanceAt(x, z, externalRoad) <= 5)
    )
      continue;

    const targetElevation = heightAt(x, z);
    for (const [dx, dz] of OFFSETS) {
      if (heightAt(x + dx, z + dz) <= 0.1) continue;
      const replacement = terrainTint(x + dx, z + dz, tile.size, targetElevation);
      if (
        replacement[0] === LEGACY_ROAD[0] &&
        replacement[1] === LEGACY_ROAD[1] &&
        replacement[2] === LEGACY_ROAD[2]
      )
        continue;
      terrain.colors[colorOffset] = replacement[0];
      terrain.colors[colorOffset + 1] = replacement[1];
      terrain.colors[colorOffset + 2] = replacement[2];
      break;
    }
  }
}
