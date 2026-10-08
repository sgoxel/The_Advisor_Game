import type { Tile } from "./world.ts";

type TileResult = {
  tile: Tile;
  data?: Record<string, {
    positions: Float32Array;
    normals: Float32Array;
    colors: Uint8Array;
    indices: Uint32Array;
  }>;
  precision?: unknown;
  error?: string;
};

const POOL_SIZE = 2;
const queued: Tile[] = [];
const idle: Worker[] = [];
const busy = new Map<Worker, Tile>();

function transferFor(result: TileResult): Transferable[] {
  if (!result.data) return [];
  const transfer: Transferable[] = [];
  for (const g of Object.values(result.data))
    transfer.push(
      g.positions.buffer,
      g.normals.buffer,
      g.colors.buffer,
      g.indices.buffer,
    );
  return transfer;
}

function dispatch() {
  while (queued.length && idle.length) {
    const worker = idle.pop()!;
    const tile = queued.shift()!;
    busy.set(worker, tile);
    worker.postMessage(tile);
  }
}

function createBuildWorker() {
  const worker = new Worker(new URL("./tile-worker-build.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<TileResult>) => {
    busy.delete(worker);
    const result = event.data;
    self.postMessage(result, { transfer: transferFor(result) });
    idle.push(worker);
    dispatch();
  };
  worker.onerror = (event) => {
    const tile = busy.get(worker);
    busy.delete(worker);
    if (tile)
      self.postMessage({
        tile,
        error: `Tile generation worker failed: ${event.message}`,
      });
    worker.terminate();
  };
  idle.push(worker);
}

for (let i = 0; i < POOL_SIZE; i++) createBuildWorker();

self.onmessage = (event: MessageEvent<Tile>) => {
  queued.push(event.data);
  dispatch();
};
