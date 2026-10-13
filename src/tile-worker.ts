import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { refineTileSurfacePresentation } from "./surface-refinement.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import type { Tile } from "./world.ts";
import { continuityTelemetry } from "./continuity-runtime.ts";
self.onmessage = (event: MessageEvent<Tile>) => {
  const tile = event.data;
  try {
    const data = refineTileSurfacePresentation(tile, buildTile(tile)),
      vegetation = buildVegetationGeometry(tile);
    data.nature = vegetation.geometry;
    const precision = convertTileGeometryToEnu(tile, data);
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
      { tile, data, precision, vegetation: vegetation.telemetry, continuity: continuityTelemetry() },
      { transfer },
    );
  } catch (error) {
    self.postMessage({ tile, error: String(error) });
  }
};
