import { WORLD_SEED } from "./config.ts";
import { roads, places, roadJunctions, roadConnections, continuityCorridor, type Road } from "./geography.ts";
import { finalSurfaceAt, finalSurfaceTelemetry } from "./world.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_RADIUS, lonLatToSource, sourceToLonLat, lonLatToUnit, type LonLat } from "./planet.ts";
import { CONTINUITY_LIMITS, logicalRegion, regionBoundaries, boundaryPoint, recipeKey, boundaryIntersections, beginQuery, advanceQuery } from "./continuity.ts";
import type { FinalSurface } from "./final-surface.ts";
import { hydrologyTelemetry } from "./hydrology.ts";

type Port = { id: string; edgeId: string; featureId: string; owner: string; position: LonLat; elevationM: number; widthM: number; shoulderSupportM: number; tangent: readonly [number, number]; grade: number; surface: FinalSurface; status: "legal" | "blocked"; crossing: "ground" | "bridge" };
function surfaceSnapshot(surface:FinalSurface):FinalSurface { return Object.freeze({...surface,water:Object.freeze({...surface.water}),contributingModifierIds:Object.freeze([...surface.contributingModifierIds])}); }
export function createContinuityService(seed: string, roadRecipes: readonly Road[], sampleFinalAt: typeof finalSurfaceAt, revision = "0") {
for (const road of roadRecipes) if (road.centerline && (road.centerline.length < 2 || road.centerline.length > 34)) throw new RangeError("Road recipes require 2..34 coarse stations; split oversized recipes canonically");
const portCache = new Map<string, Port[]>(), regions = new Map<string, number>();
let samples = 0, portSamples = 0, coarseChecks = 0, hits = 0, evictions = 0, pendingQueries = 0;
const q = (value: number) => Math.round(value * 100) / 100;
const portCount = () => [...portCache.values()].reduce((sum, ports) => sum + ports.length, 0);
function rememberRegion(point: LonLat) {
  const region = logicalRegion(point, seed);
  regions.set(region.id, (regions.get(region.id) || 0) + 1);
  if (regions.size > CONTINUITY_LIMITS.cacheRegions) regions.delete(regions.keys().next().value!);
  return region;
}
/** Renderer samples are the same final surface used by traversal; registration creates no neighbors. */
function continuitySurfaceAt(x: number, z: number) {
  samples++;
  return sampleFinalAt(x, z);
}
function registerContinuityPatch(x: number, z: number) { rememberRegion(sourceToLonLat(x, z)); }
const continuityHeightAt = (x: number, z: number) => continuitySurfaceAt(x, z).groundHeight;
function inspectRegion(point: LonLat) {
  const region = rememberRegion(point), edges = regionBoundaries(region, seed);
  const evaluatedPorts = edges.flatMap(edge => {
    const cacheKey = recipeKey("EDGE-EVALUATION", edge.id, revision, seed), cached = portCache.get(cacheKey);
    if (cached) { hits++; return cached; }
    const ports: Port[] = [];
    for (const road of roadRecipes) {
      coarseChecks++;
      const segments = road.centerline || [{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}],
        middle = sourceToLonLat((road.minX+road.maxX)/2,(road.minZ+road.maxZ)/2), unit = lonLatToUnit(middle.lon, middle.lat), center = edge.a.map((v, i) => (v + edge.b[i]) / 2),
        length = Math.hypot(...center), d = Math.acos(Math.max(-1, Math.min(1, unit.reduce((sum, v, i) => sum + v * center[i] / length, 0)))),
        radius = Math.acos(Math.max(-1, Math.min(1, edge.a.reduce((sum, v, i) => sum + v * center[i] / length, 0))));
      // Conservative source centerline angular envelope: no fine surface outside support.
      const span = (road.maxX-road.minX+road.maxZ-road.minZ) / SOURCE_PRESENTATION_RADIUS;
      if (d > radius + span / 2 + 1e-6) continue;
      for(let segment=0;segment<segments.length-1;segment++) {
      const from=segments[segment],to=segments[segment+1], pointAt=(t:number)=>sourceToLonLat(from.x+(to.x-from.x)*t,from.z+(to.z-from.z)*t);
      for (let position of boundaryIntersections(edge, pointAt)) {
        const unit = lonLatToUnit(position.lon, position.lat), corner = [edge.a, edge.b].findIndex(v => Math.hypot(...v.map((value, i) => value - unit[i])) < 1e-9);
        if(corner>=0)position=boundaryPoint(edge,corner);
        if(ports.some(port=>port.featureId===road.code&&port.position.lon===position.lon&&port.position.lat===position.lat))continue;
        if (ports.length >= 32) throw new RangeError("Boundary port cap exceeded; canonical split required");
        const p = lonLatToSource(position.lon, position.lat), surface = sampleFinalAt(p.x, p.z),
          dx = to.x-from.x, dz = to.z-from.z,
          tangentLength = Math.hypot(dx * Math.cos(position.lat), dz), sourceLength = Math.hypot(dx,dz),
          step = 1 / (CANONICAL_METRES_PER_SOURCE_UNIT * tangentLength),
          before = sampleFinalAt(p.x - dx * step, p.z - dz * step), after = sampleFinalAt(p.x + dx * step, p.z + dz * step),
          grade = (after.surfaceHeight - before.surfaceHeight) / 2,
          widthScale = CANONICAL_METRES_PER_SOURCE_UNIT * Math.hypot(dz / sourceLength * Math.cos(position.lat), dx / sourceLength);
        portSamples += 3;
        const junction = corner < 0 ? edge.id : recipeKey("VERTEX", edge.vertices[corner], "0", seed);
        ports.push(Object.freeze({ id: recipeKey("PORT", JSON.stringify([junction, road.code, position]), "0", seed), edgeId: junction, featureId: road.code,
          owner: corner<0 ? edge.owner : edge.vertices[corner], position:Object.freeze(position), elevationM: q(surface.surfaceHeight),
          widthM: q(10 * widthScale), shoulderSupportM: q(12 * widthScale), tangent: Object.freeze([dx * Math.cos(position.lat) / tangentLength, -dz / tangentLength] as const), grade,
          surface:surfaceSnapshot(surface), status: surface.walkable && before.walkable && after.walkable && Math.abs(grade) <= .08 && (surface.material === "Road" || surface.material === "Bridge") ? "legal" : "blocked", crossing: surface.deckHeight === null ? "ground" : "bridge" }));
      }}
    }
    ports.sort((a, b) => a.id < b.id ? -1 : 1);
    portCache.set(cacheKey, ports);
    while (portCache.size > CONTINUITY_LIMITS.cacheRegions * 4 || portCount() > CONTINUITY_LIMITS.cachePorts) { portCache.delete(portCache.keys().next().value!); evictions++; }
    return ports;
  });
  return {region,edges,ports:[...new Map(evaluatedPorts.map(port=>[port.id,port])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
}
function terrainQuery(point: LonLat, positions: readonly LonLat[], queryRevision = revision) {
  if (pendingQueries >= CONTINUITY_LIMITS.queries) throw new RangeError("Query queue full; retry the same recipe after completion");
  const request = beginQuery<FinalSurface>(logicalRegion(point, seed).id, positions, queryRevision, seed);
  pendingQueries++;
  let complete = false;
  return {
    request,
    advance(cursor = request, quota: number = CONTINUITY_LIMITS.step) {
      if (complete) throw new Error("Query completed or cancelled");
      if (cursor.id !== request.id) throw new Error("Continuation belongs to another query");
      const next = advanceQuery(cursor, position => { const p = lonLatToSource(position.lon, position.lat); return surfaceSnapshot(continuitySurfaceAt(p.x, p.z)); }, quota);
      if (next.status === "complete" && !complete) { complete = true; pendingQueries--; }
      return next;
    },
    cancel() { if (!complete) { complete = true; pendingQueries--; } },
  };
}
function clearContinuityDetail() { portCache.clear(); regions.clear(); }
function continuityTelemetry() {
  return { seed, revision, fineSamples: samples, portSamples, coarseRoadChecks: coarseChecks, coarseRoadRegistry: roadRecipes.length, recursiveRequests: 0,
    cachedRegions: regions.size, cachedEdges: portCache.size, cachedPorts: portCount(), cacheHits: hits, evictions, pendingQueries,
    // Conservative JS object/string allowance, including duplicated final channels.
    cpuBytesEstimated: regions.size * 1024 + portCache.size * 1024 + portCount() * 8192 + pendingQueries * CONTINUITY_LIMITS.samples * 4096, limits: CONTINUITY_LIMITS };
}
return { continuitySurfaceAt, registerContinuityPatch, continuityHeightAt, inspectRegion, terrainQuery, clearContinuityDetail, continuityTelemetry };
}
const runtime = createContinuityService(WORLD_SEED, roads, finalSurfaceAt);
// Measure the actual sparse index, reserving conservative JS key/array/reference
// overhead instead of charging the empty rectangle of every long/curved road.
const coarseRegistryBytesEstimated = JSON.stringify({roads,places,roadJunctions,roadConnections}).length*2 + (places.length+roadJunctions.length)*1024 + finalSurfaceTelemetry().roadIndexBytesEstimated;
export const { continuitySurfaceAt, registerContinuityPatch, continuityHeightAt, inspectRegion, terrainQuery, clearContinuityDetail } = runtime;
// Final-surface cache is shared with collision/traversal; reserve conservative object overhead.
export function continuityTelemetry() {
  const state = runtime.continuityTelemetry(), surface=finalSurfaceTelemetry(), sharedSurfaceCacheBytesEstimated = surface.cacheSize * 1024 + surface.roadProfileBytesEstimated + surface.featureRegistryBytesEstimated;
  const hydrologyCpuBytesEstimated=hydrologyTelemetry().cpuBytesEstimated;
  return { ...state, corridor: continuityCorridor.evidence, coarseRegistryBytesEstimated, sharedSurfaceCacheBytesEstimated, hydrologyCpuBytesEstimated, cpuBytesEstimated: state.cpuBytesEstimated + sharedSurfaceCacheBytesEstimated + coarseRegistryBytesEstimated + hydrologyCpuBytesEstimated };
}
