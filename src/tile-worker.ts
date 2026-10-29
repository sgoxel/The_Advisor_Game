import type { TileJob } from "./streaming-coverage.ts";
import type { ResidentQueryJob } from "./resident-query.ts";

// Report readiness before loading optional terrain/mesh modules. On a
// resident-only worker, expensive render imports never run. The same worker
// may still render any later tile through its unchanged canonical renderer.
let residentSimulation: Promise<import("./simulation.ts").LazySimulation> | undefined;
let tileRendererReady: Promise<typeof import("./tile-render-worker.ts")> | undefined;
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
      const phases = { candidateLookupMs: 0, foundationMs: 0, doorMs: 0, scheduleMs: 0, overnightRiskMs: 0, overnightStopsMs: 0, overnightRoutesMs: 0, groundingMs: 0, evaluated: 0 };
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
  const job = event.data;
  try {
    tileRendererReady ??= import("./tile-render-worker.ts");
    await (await tileRendererReady).renderTileJob(job);
  } catch (error) {
    // Include the same stable key even if the renderer module itself fails.
    // No failed tile is allowed to silently occupy an admission slot.
    self.postMessage({ tile:job.tile, kind:job.kind,
      jobKey:job.kind === "coverage" ? `coverage/${job.tile.key}` : job.tile.key,
      error:String(error) });
  }
};
self.postMessage({ready:true});
