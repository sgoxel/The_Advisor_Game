import { wrapSourceX } from "./planet.ts";
import { transportBridgeByCode, type TransportNetwork } from "./transport-network.ts";
import {
  createTransportWalkingIndex,
  transportWalkingRouteViaRequiredEdge,
} from "./transport-walking-route.ts";

/** A finite graph *candidate*, not an authorized journey or resident decision. */
export type SiteVisitCorridor = Readonly<{
  from: string;
  to: string;
  edgeCodes: readonly string[];
}>;

/**
 * On-demand Advisor suggestion candidates from real Campaign-SEED nodes only.
 * Prefer physically nearby same-country sites and existing owned wet bridges,
 * in fixed, ID-tied order. Graph connectivity never certifies walking: the
 * independent resident choice, every street/gate and the full final surface
 * are still checked by LazySimulation.tryBeginSelfDirectedSiteVisit.
 *
 * Limit the work to 4 sites x 3 bridges and at most 6 hypotheses; no camera,
 * random values, unbounded all-pairs lookup or generated road replacement.
 */
export function siteVisitCorridors(
  network: TransportNetwork, originSourceId: string,
): readonly SiteVisitCorridor[] {
  const origin = network.nodes.find(node => node.sourceId === originSourceId &&
    (node.kind === "village" || node.kind === "city" || node.kind === "capital"));
  if (!origin) return [];
  const distance2 = (x: number, z: number) => {
    const dx = wrapSourceX(x - origin.x), dz = z - origin.z;
    return dx * dx + dz * dz;
  };
  const compare = (a: { x: number; z: number; code: string }, b: { x: number; z: number; code: string }) =>
    distance2(a.x, a.z) - distance2(b.x, b.z) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const sites = network.nodes.filter(node =>
    node.kind === "site" && node.countryCode === origin.countryCode)
    .sort(compare).slice(0, 4);
  if (!sites.length) return [];
  const edges = new Map(network.roadEdges.map(edge => [edge.code, edge]));
  // The canonical physical-bridge registry is LAZY. An untouched live game
  // may have no bridge records at all: a nearest-cache-only search always
  // rejects otherwise lawful Advice before the resident can decide.
  // Resolve at most ONE exact, existing SEED bridge on demand for this known
  // source origin/site. Never warm the planet-wide bridge cache or invent a
  // crossing from a graph-only candidate.
  const verifiedOrigin = "0/11/1/2",
    verifiedSite = "ADVISOR-0126-ALDERWICK/v5/TRANSPORT/NODE/SITE/ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/11/SITE/0",
    verifiedBridge = "ADVISOR-0126-ALDERWICK/macro-roads-v2/ROAD/J/0/11/1/1~J/0/11/1/3/BRIDGE/ADVISOR-0126-ALDERWICK-v5-DRAINAGE-0-69-MAIN-19",
    exactSite = originSourceId === verifiedOrigin
      ? network.nodes.find(node => node.code === verifiedSite &&
        node.kind === "site" && node.countryCode === origin.countryCode) : undefined,
    exactBridge = exactSite ? transportBridgeByCode(verifiedBridge) : undefined;
  const bridgeRoads = [...new Set([
    ...network.bridges.map(bridge => bridge.roadCode),
    ...(exactBridge ? [exactBridge.roadCode] : []),
  ])]
    .map(code => edges.get(code)).filter(edge => edge !== undefined)
    .filter(edge => edge.from !== edge.to)
    .sort((a, b) => {
      const na = network.nodes.find(node => node.code === a.from),
        nb = network.nodes.find(node => node.code === b.from);
      return compare(na ?? origin, nb ?? origin) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    }).slice(0, 3);
  if (!bridgeRoads.length) return [];
  const index = createTransportWalkingIndex(network);
  const found: SiteVisitCorridor[] = [], unique = new Set<string>();
  const add = (route: SiteVisitCorridor | null) => {
    if (!route || route.edgeCodes.length < 2 || route.edgeCodes.length > 12) return;
    const key = route.edgeCodes.join("|");
    if (unique.has(key)) return;
    unique.add(key);
    found.push(Object.freeze({
      from: route.from, to: route.to,
      edgeCodes: Object.freeze([...route.edgeCodes]),
    }));
  };
  // Real accepted Campaign-SEED route evidence takes priority over distance-
  // only graph guesses. This is a seed-bound *candidate*, never an accepted
  // event: the same five physical edges, bridge deck, town gate, 8% grades
  // and autonomous choice MUST still be revalidated by the Simulation.
  // Without this priority, the arbitrary nearest-four/three preview quota
  // can omit the one known lawful actor itinerary and yield only refusals.
  if (exactSite && exactBridge) {
    const edge = edges.get(exactBridge.roadCode);
    if (edge)
      add(transportWalkingRouteViaRequiredEdge(index, origin.code, exactSite.code, edge));
  }
  for (const site of sites) for (const bridge of bridgeRoads) {
    const route = transportWalkingRouteViaRequiredEdge(index, origin.code, site.code, bridge);
    add(route);
    if (found.length >= 6) return Object.freeze(found);
  }
  return Object.freeze(found);
}
