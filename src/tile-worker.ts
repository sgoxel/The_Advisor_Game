import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { buildSettlementGeometry } from "./settlement-render.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import type { Tile } from "./world.ts";

self.onmessage = (event: MessageEvent<Tile>) => {
  const tile = event.data;
  try {
    const data = buildTile(tile),
      vegetation = buildVegetationGeometry(tile),
      settlement = buildSettlementGeometry(tile);
    // Settlement topology/buildings stay one merged structure mesh plus one merged
    // detail mesh per tile. Logical building identities live in settlements.ts and
    // are not multiplied by renderer/device class.
    data.structures = settlement.structures;
    data.detail = settlement.detail;
    data.nature = vegetation.geometry;
    const precision = convertTileGeometryToEnu(tile, data);
    const transfer: Transferable[] = [];
    for (const geometry of Object.values(data)) {
      transfer.push(
        geometry.positions.buffer,
        geometry.normals.buffer,
        geometry.colors.buffer,
        geometry.indices.buffer,
      );
      if (geometry.uvs) transfer.push(geometry.uvs.buffer);
    }
    self.postMessage(
      { tile, data, precision, vegetation: vegetation.telemetry },
      { transfer },
    );
  } catch (error) {
    self.postMessage({ tile, error: String(error) });
  }
};
