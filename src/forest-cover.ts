import { nearbyWilderness } from "./wilderness.ts";
import { climateSampleAt, type ForestFamily } from "./climate.ts";
import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { forestTextureFor } from "./forest-texture.ts";
import { coordinateValue, finalSurfaceAt, WORLD_SEED, type Tile } from "./world.ts";

export type ForestCover = { code: string; x: number; z: number; y: number; radiusM: number; heightM: number; family: ForestFamily; variant: number };
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
/** Texture density below which no tree may stand, and above which every candidate does. */
export const TREE_TEXTURE_MIN = .35, TREE_TEXTURE_FULL = .75;
/**
 * 3D trees exist only on fine tiles. Candidates sit on a fixed world grid with stable hashes; a
 * candidate becomes a tree only where the forest terrain texture (forest-texture.ts) is dark, so trees
 * pop up out of the dark stands and the light glades stay grass. Farther out the forest is just that texture.
 */
export function forestCoverForTile(tile: Tile) {
  const fine = tile.size <= 8, spacing = .5,
    patches: ForestCover[] = [];
  if (!fine) return { patches, fine };
  const clearings = nearbyWilderness(tile.minX+tile.size/2,tile.minZ+tile.size/2,tile.size+8,24)
    .filter(site=>!["forest","lake","waterfall","hill"].includes(site.kind)&&!(site.kind==='cliff'&&site.code.includes('/COUNTRYSIDE/')));
  for (let gz = Math.floor(tile.minZ / spacing); gz < Math.ceil((tile.minZ + tile.size) / spacing); gz++) {
    const latitude = sourceToLonLat(0, (gz + .5) * spacing).lat,
      columns = Math.max(1, Math.floor(SOURCE_PRESENTATION_WIDTH * Math.max(.15, Math.cos(latitude)) / spacing)),
      stepX = SOURCE_PRESENTATION_WIDTH / columns;
    for (let gx = Math.floor(tile.minX / stepX); gx < Math.ceil((tile.minX + tile.size) / stepX); gx++) {
      const address = ((gx % columns) + columns) % columns, variant = coordinateValue(address, gz, 930),
        jitter = (salt: number) => (coordinateValue(address, gz, salt) / 4294967296 - .5) * .8,
        x = (gx + .5 + jitter(932)) * stepX, z = (gz + .5 + jitter(933)) * spacing;
      if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) continue;
      const surface = finalSurfaceAt(wrapSourceX(x), z);
      if (!surface.walkable || surface.water.kind !== "none" || surface.vegetationDensityScale < .6) continue;
      // Same field as the terrain colour (forestTextureAt): the tree's own stable hash against it,
      // so a dark stand gets trees and a light glade stays grass.
      const position = sourceToLonLat(x, z), climate = climateSampleAt(position, surface.groundHeight);
      if (!climate.forestFamily) continue;
      const texture = forestTextureFor(position, climate.forestFamily, surface.vegetationDensityScale);
      if (texture < TREE_TEXTURE_MIN || coordinateValue(address, gz, 934) / 4294967296 >= smoothstep(TREE_TEXTURE_MIN, TREE_TEXTURE_FULL, texture)) continue;
      const radiusM = 3.3 + (variant % 16) * .1;
      // Crowns stay clear of rivers, roadbeds and inhabited land.
      const metric = sourceUnitsPerMetreAt(z);
      if(clearings.some(site=>Math.hypot(wrapSourceX(site.x-x)/metric.x,(site.z-z)/metric.z)<site.radiusM+radiusM))continue;
      const edge = radiusM * .6;
      if ([0, 1, 2, 3].some(i => {
        const a = i * Math.PI / 2, p = finalSurfaceAt(wrapSourceX(x + Math.cos(a) * edge * metric.x), z + Math.sin(a) * edge * metric.z);
        return p.water.kind !== "none" || p.vegetationDensityScale < .4;
      })) continue;
      patches.push({ code: `${WORLD_SEED}/FOREST/TREE/${gz}/${address}`,
        x, z, y: surface.groundHeight, radiusM, heightM: 9 + (variant % 70) * .1, family: climate.forestFamily, variant });
    }
  }
  return { patches, fine };
}
