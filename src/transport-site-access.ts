import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import { roads, type Road } from "./geography.ts";
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
const roadsByCode = new Map(roads.map(road => [road.code, road]));

/** A registered road meets a graph junction at a real endpoint, not a crossing along its middle. */
export function roadEndpointMeetsTerminal(
  road: Pick<Road, "fromX" | "fromZ" | "toX" | "toZ">,
  terminal: Readonly<{ x: number; z: number }>,
) {
  if (![road.fromX, road.fromZ, road.toX, road.toZ, terminal.x, terminal.z].every(Number.isFinite))
    return false;
  return Math.hypot(wrapSourceX(road.fromX - terminal.x), road.fromZ - terminal.z) <= 1e-4 ||
    Math.hypot(wrapSourceX(road.toX - terminal.x), road.toZ - terminal.z) <= 1e-4;
}
/** The physical site probe must inspect the route's actual final access edge. */
export function siteAccessBranchOnRoute<T extends Pick<TransportRoadEdge, "code" | "from" | "roadClass">>(
  route: Readonly<{ to: string; edgeCodes: readonly string[] }>, edges: readonly T[],
): T | undefined {
  const lastCode = route.edgeCodes.at(-1);
  return lastCode ? edges.find(edge =>
    edge.code === lastCode && edge.roadClass === "access" && edge.from === route.to) : undefined;
}

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
  localRoadSlopes?: readonly (number | null)[],
) {
  const stations = siteAccessRoadStations(edge), full = stations.length > 0 &&
    stations.length === surfaces.length,
    dry = full && surfaces.every(surface => surface.water.kind === "none"),
    // A recorded site road may cross a river on its own selected top deck.
    // Distinguish water under a legal bridge from unsupported wet ground;
    // road/deck ownership is still independently required below.
    supportedWater = full && surfaces.every(surface => surface.water.kind === "none" ||
      (surface.water.kind === "river" && Number.isFinite(surface.deckHeight))),
    walkable = full && surfaces.every(surface => surface.walkable),
    parentCode = siteAccessParentRoadCode(edge),
    parentRoad = parentCode && roads.find(road => road.code === parentCode),
    terminal = stations[stations.length - 1],
    // Final surface resolves overlapping roads to ONE deterministic road
    // modifier. A true junction may therefore show another incident road,
    // never both parent and branch IDs. Prove the exact SEED parent geometry
    // meets the source-owned branch endpoint instead of requiring two surface
    // modifiers at the same point. Synthetic/unowned endpoints still fail.
    exactParentJoin = full && !!parentCode && !!parentRoad &&
      junctionRoadCodes.has(parentCode) && !!terminal &&
      roadEndpointMeetsTerminal(parentRoad, terminal),
    // The SEED graph can prove a join whose final-surface road winner is
    // different at that exact coordinate. Keep geometry evidence distinct
    // from a confirmed incident final-surface contributor.
    // Final-surface chooses one winner at a shared graph node: it may be an
    // incident Y road other than the site's named parent. Accept that winner
    // only when it is an actual registered incident road meeting the *same*
    // exact terminal, while still requiring the selected SEED parent join.
    terminalIncidentRoad = full && exactParentJoin && terminal
      ? surfaces[surfaces.length - 1].contributingModifierIds.find(code => {
          const incident = roadsByCode.get(code);
          return incident && junctionRoadCodes.has(code) &&
            roadEndpointMeetsTerminal(incident, terminal);
        })
      : undefined,
    terminalSurfaceOwned = full && (
      surfaces[surfaces.length - 1].contributingModifierIds.includes(edge.code) ||
      (!!exactParentJoin && !!terminalIncidentRoad)
    ),
    terminalGeometryOnly = exactParentJoin && !terminalSurfaceOwned,
    onRecordedRoad = full && surfaces.every((surface, index) =>
      index === surfaces.length - 1
        // A SEED-owned branch cannot substitute an arbitrary incident road
        // when its specifically recorded parent misses the physical terminal.
        ? parentCode ? exactParentJoin : surface.contributingModifierIds.some(code =>
            code !== edge.code && junctionRoadCodes.has(code))
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
  // The highest traversed bridge deck must belong to this access branch,
  // or to its proven parent exactly at their shared terminal node. Merely
  // contributing a road modifier below an unrelated overpass is not passage.
  const topSurfaceOwned = full && surfaces.every((surface, index) =>
    surface.deckHeight == null
      ? surface.traversal === "road" || surface.traversal === "open"
      : Number.isFinite(surface.deckHeight) && surface.surfaceHeight === surface.deckHeight &&
        surface.traversal === "bridge" && surface.deckOwnerIds.some(id =>
          (id === edge.code || (index === surfaces.length - 1 && exactParentJoin && id === terminalIncidentRoad)) &&
          surface.contributingModifierIds.includes(id)));
  // Average span grades can hide a steep local surface between checkpoints.
  // finalSurfaceAt classifies an >8% road slope as "difficult" even when
  // its endpoints stay walkable; never report that approach as legal-grade.
  const gradeWithinLimit = maximumGrade !== null && maximumGrade <= .08 &&
    (localRoadSlopes === undefined || localRoadSlopes.length === stations.length) &&
    surfaces.every((surface, index) => surface.traversal !== "difficult" &&
      (surface.traversal !== "open" ||
        (localRoadSlopes !== undefined && Number.isFinite(localRoadSlopes[index]) &&
          localRoadSlopes[index]! >= 0 && localRoadSlopes[index]! <= .08)));
  const sampledPass = full && onRecordedRoad && (!parentCode || terminalSurfaceOwned) &&
    supportedWater && walkable && topSurfaceOwned && gradeWithinLimit;
  // On-demand diagnostic only. Reuse already sampled <=49 stations; identify
  // the FIRST failed physical gate without another final-surface query.
  let firstUnsafeStation: number | null = null;
  let firstUnsafeCause: string | null = full ? null : "incomplete or invalid access profile";
  if (full && !sampledPass) {
    for (let index = 0; index < stations.length; index++) {
      const surface = surfaces[index], terminal = index === stations.length - 1;
      const recorded = terminal
        ? parentCode ? exactParentJoin : surface.contributingModifierIds.some(code =>
            code !== edge.code && junctionRoadCodes.has(code))
        : surface.contributingModifierIds.includes(edge.code);
      const deckLegal = surface.deckHeight == null
        ? surface.traversal === "road" || surface.traversal === "open"
        : Number.isFinite(surface.deckHeight) && surface.surfaceHeight === surface.deckHeight &&
          surface.traversal === "bridge" && surface.deckOwnerIds.some(id =>
            (id === edge.code || (terminal && exactParentJoin && id === terminalIncidentRoad)) &&
            surface.contributingModifierIds.includes(id));
      let cause: string | null = null;
      if (!Number.isFinite(surface.surfaceHeight)) cause = "invalid final-surface height";
      else if (surface.water.kind !== "none" &&
        !(surface.water.kind === "river" && Number.isFinite(surface.deckHeight)))
        cause = !Number.isFinite(surface.deckHeight) ? "wet site-access surface" :
          "unsupported water under site-access deck";
      else if (!surface.walkable) cause = "blocked site-access surface";
      else if (!recorded) cause = terminal ? "site branch misses its registered parent junction" : "site branch road modifier absent";
      else if (terminal && parentCode && !terminalSurfaceOwned) cause = "terminal has no registered top road owner";
      else if (surface.traversal === "open" &&
        (localRoadSlopes === undefined || localRoadSlopes[index] == null))
        cause = "local site-access slope not sampled";
      else if (surface.traversal === "difficult" ||
        (surface.traversal === "open" &&
          (!Number.isFinite(localRoadSlopes![index]) || localRoadSlopes![index]! < 0 || localRoadSlopes![index]! > .08)))
        cause = "unsafe local site-access slope";
      else if (surface.deckHeight == null && surface.traversal !== "road" && surface.traversal !== "open")
        cause = "non-road site-access traversal";
      else if (!deckLegal) cause = "unrelated or invalid top bridge deck";
      else if (index > 0) {
        const length = greatCircleDistance(
          sourceToLonLat(stations[index - 1].x, stations[index - 1].z),
          sourceToLonLat(stations[index].x, stations[index].z));
        const grade = length > 0
          ? Math.abs(surface.surfaceHeight - surfaces[index - 1].surfaceHeight) / length : Infinity;
        if (!Number.isFinite(grade) || grade > .08) cause = "sampled site-access grade exceeds 8%";
      }
      if (cause !== null) {
        firstUnsafeStation = index + 1;
        firstUnsafeCause = cause;
        break;
      }
    }
    firstUnsafeCause ??= "sampled site-access authority not certified";
  }
  return Object.freeze({
    stationCount: surfaces.length,
    expectedStations: stations.length,
    onRecordedRoad, dry, supportedWater, walkable, topSurfaceOwned, terminalGeometryOnly,
    maximumGrade, gradeWithinLimit, firstUnsafeStation, firstUnsafeCause,
    sampledPass,
  });
}
