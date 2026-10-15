// Register deterministic site access/pad records before world/geometry modules
// construct their bounded road indexes in this worker.
import "./sites.ts";
import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { refineTileSurfacePresentation } from "./surface-refinement.ts";
import { rebuildNaturalSurface } from "./natural-surface-mesh.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import { appendCriticalSiteGeometry } from "./site-geometry.ts";
import type { Tile } from "./world.ts";
import { continuityTelemetry } from "./continuity-runtime.ts";
self.onmessage = (event: MessageEvent<Tile>) => {
  const tile = event.data;
  try {
    const base = buildTile(tile),natural = rebuildNaturalSurface(tile,base.terrain);
    base.terrain=natural.geometry;
    const data = refineTileSurfacePresentation(tile, base,natural.replaced),
      vegetation = buildVegetationGeometry(tile);
    data.nature = vegetation.geometry;
    const sites = appendCriticalSiteGeometry(tile, data),
      precision = convertTileGeometryToEnu(tile, data);
    const transfer: Transferable[] = [];
    for (const g of Object.values(data)) {
      transfer.push(
        g.positions.buffer,
        g.normals.buffer,
        g.colors.buffer,
        g.indices.buffer,
      );
      if (g.uvs) transfer.push(g.uvs.buffer);
    }
    self.postMessage(
      { tile, data, precision, vegetation: vegetation.telemetry, sites, continuity: continuityTelemetry(), natural: {replaced:natural.replaced,leaves:natural.leaves,samples:natural.samples,cpuScratchBytesEstimated:natural.cpuScratchBytesEstimated} },
      { transfer },
    );
  } catch (error) {
    self.postMessage({ tile, error: String(error) });
  }
};
