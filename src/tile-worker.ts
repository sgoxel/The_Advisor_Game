import { buildTile } from "./geometry.ts";
import type { Tile } from "./world.ts";
self.onmessage = (event: MessageEvent<Tile>) => {
  const tile = event.data;
  try {
    const data = buildTile(tile);
    const transfer: Transferable[] = [];
    for (const g of Object.values(data))
      transfer.push(
        g.positions.buffer,
        g.normals.buffer,
        g.colors.buffer,
        g.indices.buffer,
      );
    self.postMessage({ tile, data }, { transfer });
  } catch (error) {
    self.postMessage({ tile, error: String(error) });
  }
};
