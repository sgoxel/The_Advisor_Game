import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { refineTileSurfacePresentation } from "./surface-refinement.ts";
import { rebuildNaturalSurface } from "./natural-surface-mesh.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import { tileJobKey, type TileJob } from "./streaming-coverage.ts";
import { continuityTelemetry } from "./continuity-runtime.ts";
self.onmessage = (event: MessageEvent<TileJob>) => {
  const job = event.data, tile = job.tile, jobKey = tileJobKey(job), started = performance.now();
  try {
    const base = buildTile(tile, {terrainOnly:job.kind==='coverage'}), baseDone = performance.now();
    let natural = {replaced:false,leaves:0,samples:0,cpuScratchBytesEstimated:0};
    let data = base;
    if(job.kind==='detail'){
      const rebuilt = rebuildNaturalSurface(tile,base.terrain);base.terrain=rebuilt.geometry;natural=rebuilt;
      data=refineTileSurfacePresentation(tile,base,natural.replaced);
    }
    const groundDone=performance.now();
    let vegetation;
    if(job.kind==='detail'){vegetation=buildVegetationGeometry(tile);data.nature=vegetation.geometry;}
    const precision = convertTileGeometryToEnu(tile, data), transfer: Transferable[] = [];
    for (const g of Object.values(data)) {
      transfer.push(g.positions.buffer,g.normals.buffer,g.colors.buffer,g.indices.buffer);
      if (g.uvs) transfer.push(g.uvs.buffer);
    }
    self.postMessage({tile,data,precision,kind:job.kind,jobKey,vegetation:vegetation?.telemetry,continuity:continuityTelemetry(),
      timing:{baseMs:baseDone-started,groundRefinementMs:groundDone-baseDone,decorationMs:performance.now()-groundDone,totalMs:performance.now()-started},
      natural:{replaced:natural.replaced,leaves:natural.leaves,samples:natural.samples,cpuScratchBytesEstimated:natural.cpuScratchBytesEstimated}}, {transfer});
  } catch(error){self.postMessage({tile,kind:job.kind,jobKey,error:String(error)});}
};
self.postMessage({ready:true});
