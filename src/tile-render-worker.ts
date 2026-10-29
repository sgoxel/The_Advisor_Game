import { appendWildernessGeometry } from "./wilderness-geometry.ts";
import { appendCriticalSiteGeometry } from "./site-geometry.ts";
import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { refineTileSurfacePresentation } from "./surface-refinement.ts";
import { rebuildNaturalSurface, NATURAL_MESH_LIMITS } from "./natural-surface-mesh.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import { tileJobKey, type TileJob } from "./streaming-coverage.ts";
import { continuityTelemetry, registerContinuityPatch } from "./continuity-runtime.ts";
import { loadAssetMeshes } from "./asset-meshes.ts";
// Loaded only when a worker receives its first real terrain tile. A worker
// processing resident-only Simulation facts does not load expensive mesh,
// lighting, wilderness, vegetation or optional model modules.
const emptyTerrain = { positions:new Float32Array(), normals:new Float32Array(),
  colors:new Uint8Array(), indices:new Uint32Array() };

export async function renderTileJob(job: TileJob, started: number) {
  const tile = job.tile, jobKey = tileJobKey(job);
  try {
    let base: ReturnType<typeof buildTile>, natural = {
      replaced:false,leaves:0,samples:0,cpuScratchBytesEstimated:0,
      waterBoundary4: undefined as boolean | undefined,
    };
    let baseMs: number;
    let naturalMs: number | undefined, surfaceRefinementMs: number | undefined;
    if (job.kind === 'detail') {
      // Detail meshes must still use the complete Blender asset registry.
      // Coverage and resident facts have no model dependency and need not
      // wait for nine separate optional GLB network requests.
      await meshAssetsReady;
      // Original detail building registered this canonical region before the
      // adaptive pass. Keep that order and retain coarse ground when replacement
      // is unnecessary; plain tiles must never become blank.
      registerContinuityPatch(tile.minX+tile.size/2,tile.minZ+tile.size/2);
      const naturalStarted = performance.now();
      const proposed = rebuildNaturalSurface(tile, emptyTerrain);
      naturalMs = performance.now() - naturalStarted;
      natural = proposed;
      const buildStarted = performance.now();
      base = buildTile(tile, {skipBaseTerrain:proposed.replaced});
      baseMs = performance.now()-buildStarted;
      if (proposed.replaced) base.terrain = proposed.geometry;
    } else {
      const buildStarted = performance.now();
      base = buildTile(tile, {terrainOnly:true});
      baseMs = performance.now()-buildStarted;
    }
    const refinementStarted = performance.now();
    const data = job.kind === 'detail'
      ? refineTileSurfacePresentation(tile,base,natural.replaced,natural.waterBoundary4) : base;
    if (job.kind === 'detail') surfaceRefinementMs = performance.now() - refinementStarted;
    const groundDone = performance.now();
    let vegetation;
    if(job.kind==='detail'){vegetation=buildVegetationGeometry(tile);data.nature=vegetation.geometry;}
    if(job.kind==='detail'){ appendCriticalSiteGeometry(tile,data); appendWildernessGeometry(tile,data); }
    const precision = convertTileGeometryToEnu(tile, data), transfer: Transferable[] = [];
    for (const g of Object.values(data)) {
      transfer.push(g.positions.buffer,g.normals.buffer,g.colors.buffer,g.indices.buffer);
      if (g.uvs) transfer.push(g.uvs.buffer);
    }
    self.postMessage({tile,data,precision,kind:job.kind,jobKey,vegetation:vegetation?.telemetry,continuity:continuityTelemetry(),
      timing:{baseMs,groundRefinementMs:groundDone-started-baseMs,naturalMs,surfaceRefinementMs,
        decorationMs:performance.now()-groundDone,totalMs:performance.now()-started},
      natural:{replaced:natural.replaced,leaves:natural.leaves,samples:natural.samples,cpuScratchBytesEstimated:natural.cpuScratchBytesEstimated}}, {transfer});
  } catch(error){self.postMessage({tile,kind:job.kind,jobKey,error:String(error)});}
}

// Detail geometry still waits for the exact complete Blender registry. A
// resident-only worker never fetches optional GLBs unnecessarily.
const meshAssetsReady = loadAssetMeshes().catch(() => undefined);

