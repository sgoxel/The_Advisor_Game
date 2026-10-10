import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { buildSettlementGeometry } from "./settlement-render.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import type { Tile } from "./world.ts";
self.onmessage = (event: MessageEvent<Tile>) => {
  const tile = event.data;
  try {
    const data = buildTile(tile),
      settlement = buildSettlementGeometry(tile),
      vegetation = buildVegetationGeometry(tile);
    // Settlement geometry owns local buildings/streets/walls/gates so the legacy fixed-row
    // structure pass cannot remain visible underneath the canonical organic layout. Terrain and
    // canonical vegetation stay in their existing shared render paths.
    if (settlement) {
      data.structures = settlement.structures;
      data.detail = settlement.detail;
    }
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
      { tile, data, precision, vegetation: vegetation.telemetry },
      { transfer },
    );
  } catch (error) {
    self.postMessage({ tile, error: String(error) });
  }
};
