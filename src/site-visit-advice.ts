import { wrapSourceX } from "./planet.ts";
import type { TransportNetwork } from "./transport-network.ts";
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
  const bridgeRoads = [...new Set(network.bridges.map(bridge => bridge.roadCode))]
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
  for (const site of sites) for (const bridge of bridgeRoads) {
    const route = transportWalkingRouteViaRequiredEdge(index, origin.code, site.code, bridge);
    if (!route || route.edgeCodes.length < 2 || route.edgeCodes.length > 12) continue;
    const key = route.edgeCodes.join("|");
    if (unique.has(key)) continue;
    unique.add(key);
    found.push(Object.freeze({
      from: route.from, to: route.to,
      edgeCodes: Object.freeze([...route.edgeCodes]),
    }));
    if (found.length >= 6) return Object.freeze(found);
  }
  return Object.freeze(found);
}
