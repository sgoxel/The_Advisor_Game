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
import type { ResidentQueryJob } from "./resident-query.ts";
// The adaptive builder never mutates this disposable empty fallback mesh.
const emptyTerrain = { positions:new Float32Array(), normals:new Float32Array(),
  colors:new Uint8Array(), indices:new Uint32Array() };
let residentSimulation: Promise<import("./simulation.ts").LazySimulation> | undefined;
self.onmessage = async (event: MessageEvent<TileJob | ResidentQueryJob>) => {
  if (event.data.kind === "residents") {
    const job = event.data, started = performance.now(), workerReceiveEpochMs = performance.timeOrigin + started;
    try {
      // One observation-only start notice. The main thread can measure its
      // receipt against its OWN send clock without comparing worker epochs.
      self.postMessage({ kind:"resident-started", id:job.id, shard:job.shard?.index,
        mainSentEpochMs:job.mainSentEpochMs });
      residentSimulation ??= import("./simulation.ts").then(({ LazySimulation }) => new LazySimulation());
      const simulation = await residentSimulation, { places } = await import("./geography.ts"),
        place = places.find(place => place.code === job.placeCode);
      if (!place) throw new Error("Unknown resident settlement");
      const preparedAt = performance.now();
      simulation.setFocus(place);
      simulation.advance(job.tick);
      // Optional instrumentation only in resident worker queries; zero
      // influence on canonical positions, routing or authoritative results.
      const phases = { candidateLookupMs: 0, foundationMs: 0, doorMs: 0, scheduleMs: 0, overnightRiskMs: 0, groundingMs: 0, evaluated: 0 };
      const residents = simulation.focusedResidents(job.x, job.z, job.radius, job.limit, job.shard, job.actors === true, phases,
        first => self.postMessage({ kind: "resident-first-fact", id: job.id, shard: job.shard?.index, resident: first }));
      const completedAt = performance.now(), workerSendEpochMs = performance.timeOrigin + completedAt;
      self.postMessage({ kind: "residents", id: job.id, shard: job.shard?.index, residents, query: simulation.stats.query,
        residentTiming: { preparationMs: preparedAt - started, queryMs: completedAt - preparedAt,
          indexBuildMs: simulation.residentIndexBuildMs, ...phases,
          mainSentEpochMs: job.mainSentEpochMs, workerReceiveEpochMs, workerSendEpochMs } });
    } catch (error) { self.postMessage({ kind: "residents", id: job.id, error: String(error) }); }
    return;
  }
  const job = event.data, tile = job.tile, jobKey = tileJobKey(job), started = performance.now();
  try {
    let base: ReturnType<typeof buildTile>, natural = {
      replaced:false,leaves:0,samples:0,cpuScratchBytesEstimated:0,
      waterBoundary4: undefined as boolean | undefined,
    };
    let baseMs: number;
    let naturalMs: number | undefined, surfaceRefinementMs: number | undefined;
    if (job.kind === 'detail') {
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
};
// Blender-made assets (src/models) are loaded once before the worker accepts jobs; a failure only
// logs a warning and leaves the procedural kits in place.
// (A promise chain, not top-level await: the worker bundle is iife.)
void loadAssetMeshes().catch(() => undefined).then(() => self.postMessage({ready:true}));
