import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import type { FinalSurface } from "./final-surface.ts";
import type { TransportRoadEdge } from "./transport-network.ts";
import { ACCESS_PROFILE_SEGMENT_MAX_M, criticalSites } from "./sites.ts";

/**
 * On-demand physical evidence for a real critical-site access branch, not a
 * new traversal authority. Every existing <=75m profile span is sampled at
 * both ends and its midpoint. Never truncate a longer branch into a false pass.
 */
export const SITE_ACCESS_STATION_LIMIT = 49;

// The owning SEED site names exactly one parent road, not just any incident
// modifier at a shared node. Do not certify an unrelated crossing as its join.
const siteParents = new Map(criticalSites.map(site => [site.access.branchCode, {
  siteCode: site.code, parentCode: site.access.roadCode,
}]));
export function siteAccessParentRoadCode(edge: TransportRoadEdge): string | undefined {
  const site = siteParents.get(edge.code);
  return site && edge.roadClass === "access" &&
    edge.from.endsWith(`/NODE/SITE/${site.siteCode}`) ? site.parentCode : undefined;
}

export function siteAccessRoadStations(edge: TransportRoadEdge) {
  const points = edge.centerline;
  if (edge.roadClass !== "access" || !edge.from.includes("/NODE/SITE/") ||
      !Array.isArray(points) || points.length < 2 ||
      points.length * 2 - 1 > SITE_ACCESS_STATION_LIMIT)
    return Object.freeze([] as { x: number; z: number }[]);
  // Canonical conversion throws on invalid coordinates: fail closed before
  // wrapping or measuring any station from a malformed access profile.
  for (const point of points)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z))
      return Object.freeze([] as { x: number; z: number }[]);
  const stations: { x: number; z: number }[] = [
    { x: wrapSourceX(points[0].x), z: points[0].z },
  ];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i],
      dx = wrapSourceX(b.x - a.x), dz = b.z - a.z;
    // The SEED owner specifies <=75 m spans. A short array with a long
    // interval must not pass by checking only its ends and midpoint.
    const spanM = greatCircleDistance(sourceToLonLat(a.x, a.z), sourceToLonLat(b.x, b.z));
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || !Number.isFinite(spanM) ||
        spanM <= 0 || spanM > ACCESS_PROFILE_SEGMENT_MAX_M + 0.01)
      return Object.freeze([] as { x: number; z: number }[]);
    stations.push(
      { x: wrapSourceX(a.x + dx * 0.5), z: a.z + dz * 0.5 },
      { x: wrapSourceX(b.x), z: b.z },
    );
  }
  return Object.freeze(stations);
}

/** Assessment only: sampled stations never prove unsampled continuity or actor movement. */
export function siteAccessSampleVerdict(
  edge: TransportRoadEdge, surfaces: readonly FinalSurface[],
  junctionRoadCodes: ReadonlySet<string> = new Set(),
) {
  const stations = siteAccessRoadStations(edge), full = stations.length > 0 &&
    stations.length === surfaces.length,
    dry = full && surfaces.every(surface => surface.water.kind === "none"),
    walkable = full && surfaces.every(surface => surface.walkable),
    // The shared surface can resolve both access and parent modifiers at the
    // shared junction. Interior samples need this access edge; the terminal
    // needs a distinct incident road, not only this edge or arbitrary ground.
    onRecordedRoad = full && surfaces.every((surface, index) =>
      index === surfaces.length - 1
        ? surface.contributingModifierIds.some(code => code !== edge.code && junctionRoadCodes.has(code))
        : surface.contributingModifierIds.includes(edge.code));
  let maximumGrade: number | null = null;
  if (full) {
    maximumGrade = 0;
    for (let i = 1; i < stations.length; i++) {
      const length = greatCircleDistance(
        sourceToLonLat(stations[i - 1].x, stations[i - 1].z),
        sourceToLonLat(stations[i].x, stations[i].z),
      );
      const grade = length > 0
        ? Math.abs(surfaces[i].surfaceHeight - surfaces[i - 1].surfaceHeight) / length
        : Infinity;
      if (!Number.isFinite(grade)) { maximumGrade = Infinity; break; }
      maximumGrade = Math.max(maximumGrade, grade);
    }
  }
  const gradeWithinLimit = maximumGrade !== null && maximumGrade <= 0.08;
  return Object.freeze({
    stationCount: surfaces.length,
    expectedStations: stations.length,
    onRecordedRoad, dry, walkable,
    maximumGrade, gradeWithinLimit,
    sampledPass: full && onRecordedRoad && dry && walkable && gradeWithinLimit,
  });
}
