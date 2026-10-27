import { appendWildernessGeometry } from "./wilderness-geometry.ts";
import { appendCriticalSiteGeometry } from "./site-geometry.ts";
import { buildTile } from "./geometry.ts";
import { convertTileGeometryToEnu } from "./render-frame.ts";
import { refineTileSurfacePresentation } from "./surface-refinement.ts";
import { rebuildNaturalSurface } from "./natural-surface-mesh.ts";
import { buildVegetationGeometry } from "./vegetation-render.ts";
import { tileJobKey, type TileJob } from "./streaming-coverage.ts";
import { continuityTelemetry } from "./continuity-runtime.ts";
import { loadAssetMeshes } from "./asset-meshes.ts";
import type { ResidentQueryJob } from "./resident-query.ts";
let residentSimulation: Promise<import("./simulation.ts").LazySimulation> | undefined;
self.onmessage = async (event: MessageEvent<TileJob | ResidentQueryJob>) => {
  if (event.data.kind === "residents") {
    const job = event.data, started = performance.now();
    try {
      residentSimulation ??= import("./simulation.ts").then(({ LazySimulation }) => new LazySimulation());
      const simulation = await residentSimulation, { places } = await import("./geography.ts"),
        place = places.find(place => place.code === job.placeCode);
      if (!place) throw new Error("Unknown resident settlement");
      const preparedAt = performance.now();
      simulation.setFocus(place);
      simulation.advance(job.tick);
      // Optional instrumentation only in resident worker queries; zero
      // influence on canonical positions, routing or authoritative results.
      const phases = { candidateLookupMs: 0, foundationMs: 0, doorMs: 0, scheduleMs: 0, groundingMs: 0, evaluated: 0 };
      const residents = simulation.focusedResidents(job.x, job.z, job.radius, job.limit, job.shard, job.actors === true, phases);
      const completedAt = performance.now();
      self.postMessage({ kind: "residents", id: job.id, shard: job.shard?.index, residents, query: simulation.stats.query,
        residentTiming: { preparationMs: preparedAt - started, queryMs: completedAt - preparedAt,
          indexBuildMs: simulation.residentIndexBuildMs, ...phases } });
    } catch (error) { self.postMessage({ kind: "residents", id: job.id, error: String(error) }); }
    return;
  }
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
    if(job.kind==='detail'){ appendCriticalSiteGeometry(tile,data); appendWildernessGeometry(tile,data); }
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
// Blender-made assets (src/models) are loaded once before the worker accepts jobs; a failure only
// logs a warning and leaves the procedural kits in place.
// (A promise chain, not top-level await: the worker bundle is iife.)
void loadAssetMeshes().catch(() => undefined).then(() => self.postMessage({ready:true}));
