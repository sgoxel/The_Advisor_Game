import type { TileJob } from "./streaming-coverage.ts";
import type { ResidentQueryJob } from "./resident-query.ts";

// Report readiness before loading optional terrain/mesh modules. On a
// resident-only worker, expensive render imports never run. The same worker
// may still render any later tile through its unchanged canonical renderer.
let residentSimulation: Promise<{
  simulation: import("./simulation.ts").LazySimulation;
  beginResidentRouteProbes: typeof import("./simulation.ts").beginResidentRouteProbes;
  endResidentRouteProbes: typeof import("./simulation.ts").endResidentRouteProbes;
}> | undefined;
let tileRendererReady: Promise<typeof import("./tile-render-worker.ts")> | undefined;
self.onmessage = async (event: MessageEvent<TileJob | ResidentQueryJob>) => {
  if (event.data.kind === "residents") {
    const job = event.data, started = performance.now(), workerReceiveEpochMs = performance.timeOrigin + started;
    try {
      // One observation-only start notice. The main thread can measure its
      // receipt against its OWN send clock without comparing worker epochs.
      self.postMessage({ kind:"resident-started", id:job.id, shard:job.shard?.index,
        mainSentEpochMs:job.mainSentEpochMs });
      residentSimulation ??= import("./simulation.ts").then(module => ({
        simulation: new module.LazySimulation(),
        beginResidentRouteProbes: module.beginResidentRouteProbes,
        endResidentRouteProbes: module.endResidentRouteProbes,
      }));
      const { simulation, beginResidentRouteProbes, endResidentRouteProbes } = await residentSimulation,
        { places } = await import("./geography.ts"),
        place = places.find(place => place.code === job.placeCode);
      if (!place) throw new Error("Unknown resident settlement");
      const preparedAt = performance.now();
      simulation.setFocus(place);
      simulation.advance(job.tick);
      // Optional instrumentation only in resident worker queries; zero
      // influence on canonical positions, routing or authoritative results.
      const phases = { candidateLookupMs: 0, foundationMs: 0, doorMs: 0, scheduleMs: 0, overnightRiskMs: 0, overnightStopsMs: 0, overnightRoutesMs: 0, groundingMs: 0, evaluated: 0 };
      // Count only this synchronous resident query. Always clear the observer
      // even if a worker query fails; no mutable counter can affect decisions.
      const routeProbes = job.routeProbes === true ? beginResidentRouteProbes() : undefined;
      const residents = (() => {
        try {
          return simulation.focusedResidents(job.x, job.z, job.radius, job.limit, job.shard, job.actors === true, phases,
            first => self.postMessage({ kind: "resident-first-fact", id: job.id, shard: job.shard?.index, resident: first }));
        } finally { if (routeProbes) endResidentRouteProbes(); }
      })();
      const completedAt = performance.now(), workerSendEpochMs = performance.timeOrigin + completedAt;
      self.postMessage({ kind: "residents", id: job.id, shard: job.shard?.index, residents, query: simulation.stats.query,
        residentTiming: { preparationMs: preparedAt - started, queryMs: completedAt - preparedAt,
          indexBuildMs: simulation.residentIndexBuildMs, ...phases, routeProbes,
          mainSentEpochMs: job.mainSentEpochMs, workerReceiveEpochMs, workerSendEpochMs } });
    } catch (error) { self.postMessage({ kind: "residents", id: job.id, error: String(error) }); }
    return;
  }
  const job = event.data, started = performance.now();
  try {
    tileRendererReady ??= import("./tile-render-worker.ts");
    // Include first-use module initialization in the original end-to-end
    // worker tile duration; do not manufacture an apparent p95 speedup.
    await (await tileRendererReady).renderTileJob(job, started);
  } catch (error) {
    // Include the same stable key even if the renderer module itself fails.
    // No failed tile is allowed to silently occupy an admission slot.
    self.postMessage({ tile:job.tile, kind:job.kind,
      jobKey:job.kind === "coverage" ? `coverage/${job.tile.key}` : job.tile.key,
      error:String(error) });
  }
};
self.postMessage({ready:true});
