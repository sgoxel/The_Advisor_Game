import { nearbyWilderness } from "./wilderness.ts";
import { climateSampleAt, type ForestFamily } from "./climate.ts";
import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { coordinateValue, finalSurfaceAt, WORLD_SEED, type Tile } from "./world.ts";

export type ForestCover = { code: string; x: number; z: number; y: number; radiusM: number; heightM: number; family: ForestFamily; variant: number };
/** Fine trees have fixed world addresses. Distant crowns summarize the same forest habitat. */
export function forestCoverForTile(tile: Tile) {
  const fine = tile.size <= 8, spacing = fine ? .5 : Math.max(2, Math.min(16, tile.size / 8)),
    patches: ForestCover[] = [];
  if (tile.size > 256) return { patches, fine };
  const clearings = nearbyWilderness(tile.minX+tile.size/2,tile.minZ+tile.size/2,tile.size+8,24)
    .filter(site=>!["forest","lake","waterfall","hill"].includes(site.kind));
  for (let gz = Math.floor(tile.minZ / spacing); gz < Math.ceil((tile.minZ + tile.size) / spacing); gz++) {
    const latitude = sourceToLonLat(0, (gz + .5) * spacing).lat,
      columns = Math.max(1, Math.floor(SOURCE_PRESENTATION_WIDTH * (fine ? Math.max(.15, Math.cos(latitude)) : 1) / spacing)),
      stepX = SOURCE_PRESENTATION_WIDTH / columns;
    for (let gx = Math.floor(tile.minX / stepX); gx < Math.ceil((tile.minX + tile.size) / stepX); gx++) {
      const address = ((gx % columns) + columns) % columns, variant = coordinateValue(address, gz, fine ? 930 : 931),
        jitter = (salt: number) => (coordinateValue(address, gz, salt) / 4294967296 - .5) * (fine ? .8 : .25),
        x = (gx + .5 + jitter(932)) * stepX, z = (gz + .5 + jitter(933)) * spacing;
      if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) continue;
      const surface = finalSurfaceAt(wrapSourceX(x), z);
      if (!surface.walkable || surface.water.kind !== "none" || surface.vegetationDensityScale < .6) continue;
      const climate = climateSampleAt(sourceToLonLat(x, z), surface.groundHeight);
      if (!climate.forestFamily || variant / 4294967296 > (climate.forestFamily === "warm-dry-woodland" ? .74 : .94)) continue;
      const radiusM = fine ? 3.3 + (variant % 16) * .1 : spacing / sourceUnitsPerMetreAt(z).z * .69;
      // Crowns stay clear of rivers, roadbeds and inhabited land, even when simplified.
      const metric = sourceUnitsPerMetreAt(z);
      if(clearings.some(site=>Math.hypot(wrapSourceX(site.x-x)/metric.x,(site.z-z)/metric.z)<site.radiusM+radiusM))continue;
      const edge = fine ? radiusM * .6 : radiusM * .75;
      if ([0, 1, 2, 3].some(i => {
        const a = i * Math.PI / 2, p = finalSurfaceAt(wrapSourceX(x + Math.cos(a) * edge * metric.x), z + Math.sin(a) * edge * metric.z);
        return p.water.kind !== "none" || p.vegetationDensityScale < .4;
      })) continue;
      patches.push({ code: `${WORLD_SEED}/FOREST/${fine ? "TREE" : `CANOPY/${spacing}`}/${gz}/${address}`,
        x, z, y: surface.groundHeight, radiusM, heightM: 9 + (variant % 70) * .1, family: climate.forestFamily, variant });
    }
  }
  return { patches, fine };
}
