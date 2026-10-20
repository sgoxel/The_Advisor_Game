import { criticalSites, siteAccessRoads, type CriticalSite } from "./sites.ts";
import type { Road } from "./geography.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "./planet.ts";
import { canonicalRoadBucketCells, canonicalRoadBucketX } from "./road-spatial-index.ts";
import {
  TRANSPORT_LIMITS,
  networkDigest,
  transportAcceptanceSummary as baseAcceptanceSummary,
  transportNetwork as baseNetwork,
  transportPolylineDistance,
  transportRoadsNear as baseRoadsNear,
  wrapRoad,
  type TransportNetwork,
  type TransportNode,
  type TransportRoadEdge,
} from "./transport-network.ts";

/**
 * Read-only canonical transport graph including the same SEED-owned site access
 * branches used by physical rendering/final surface. No site regeneration,
 * second route authority, mutable registration or import-order dependency.
 */
function compareCode(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

export function composeSiteTransportNetwork(
  base: TransportNetwork,
  sites: readonly CriticalSite[],
  branches: readonly Road[],
): TransportNetwork {
  const siteNodes: TransportNode[] = [...sites].sort((a, b) => compareCode(a.code, b.code)).map(site =>
    Object.freeze({
      code: `${base.code}/NODE/SITE/${site.code}`,
      sourceId: site.code,
      kind: "site" as const,
      countryCode: site.countryCode,
      continent: site.continent,
      position: Object.freeze({ ...site.canonicalPosition }),
      x: site.x,
      z: site.z,
    }));
  const nodes = Object.freeze([...base.nodes, ...siteNodes]),
    nodeBySourceId = new Map(nodes.map(node => [node.sourceId, node])),
    // A single canonical index avoids a full node/edge scan for every site branch at startup.
    baseNodeBySourceId = new Map(base.nodes.map(node => [node.sourceId, node])),
    siteByCode = new Map(sites.map(site => [site.code, site])),
    baseRoadByCode = new Map(base.roadEdges.map(edge => [edge.code, edge]));
  if (nodeBySourceId.size !== nodes.length) throw new Error("Duplicate canonical transport node source");
  const additions = [...branches].sort((a, b) => compareCode(a.code, b.code)).map(road => {
    if (baseRoadByCode.has(road.code)) throw new Error(`Duplicate canonical access road ${road.code}`);
    const source = siteByCode.get(road.from);
    if (!source || road.code !== source.access.branchCode || !baseNodeBySourceId.has(road.to))
      throw new Error(`Unowned site access branch ${road.code}`);
    const parent = baseRoadByCode.get(source.access.roadCode);
    const terminal = nodeBySourceId.get(road.to);
    if (!parent || !terminal || ![parent.from, parent.to].includes(terminal.code))
      throw new Error(`Disconnected canonical site junction ${road.code}`);
    return wrapRoad(road, nodeBySourceId, new Map());
  });
  if (new Set(additions.map(edge => edge.code)).size !== additions.length)
    throw new Error("Duplicate canonical site branch");
  const roadEdges = Object.freeze([...base.roadEdges, ...additions]);
  const incident = new Map<string, string[]>();
  for (const edge of roadEdges) for (const code of [edge.from, edge.to]) {
    const edges = incident.get(code) ?? [];
    edges.push(edge.code);
    incident.set(code, edges);
  }
  const junctions = Object.freeze(nodes.filter(node => node.kind === "junction")
    .map(node => Object.freeze({
      code: `${base.code}/JUNCTION/${node.sourceId}`,
      nodeCode: node.code,
      position: node.position,
      edgeCodes: Object.freeze([...(incident.get(node.code) ?? [])].sort(compareCode)),
    })).filter(node => node.edgeCodes.length >= 3));
  const digest = networkDigest(nodes, roadEdges, base.ferryEdges, base.borderCrossings, base.harbors);
  return Object.freeze({
    code: base.code,
    nodes,
    roadEdges,
    ferryEdges: base.ferryEdges,
    get bridges() { return base.bridges; },
    borderCrossings: base.borderCrossings,
    harbors: base.harbors,
    junctions,
    digest,
  });
}

export const siteTransportNetwork = composeSiteTransportNetwork(baseNetwork, criticalSites, siteAccessRoads);
const siteEdgesByCode = new Map(siteTransportNetwork.roadEdges
  .filter(edge => edge.from.includes("/NODE/SITE/")).map(edge => [edge.code, edge]));
const siteBuckets = new Map<string, TransportRoadEdge[]>();
const bucketSize = TRANSPORT_LIMITS.spatialBucketSource;
for (const road of siteAccessRoads) {
  const edge = siteEdgesByCode.get(road.code);
  if (!edge) throw new Error(`Site access not in transport graph: ${road.code}`);
  for (const [bx, bz] of canonicalRoadBucketCells(road, bucketSize, 24, SOURCE_PRESENTATION_WIDTH)) {
    const key = `${bx}/${bz}`, bucket = siteBuckets.get(key) ?? [];
    if (!bucket.some(candidate => candidate.code === edge.code)) bucket.push(edge);
    siteBuckets.set(key, bucket);
  }
}

/** Same bounded physical-road lookup, now including authoritative site branches. */
/** Read-only site-only spatial lookup; never warms the transport bridge cache. */
export function siteAccessRoadsNear(x: number, z: number, radiusSource: number, limit: number = TRANSPORT_LIMITS.queryRoadLimit) {
  if (!Number.isFinite(radiusSource) || radiusSource <= 0 || radiusSource > 16_384)
    throw new RangeError("Site access road radius outside bounded support");
  const boundedLimit = Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit)),
    bx = canonicalRoadBucketX(Math.floor(wrapSourceX(x) / bucketSize), bucketSize, SOURCE_PRESENTATION_WIDTH),
    bz = Math.floor(z / bucketSize),
    reach = Math.ceil(radiusSource / bucketSize),
    seen = new Set<string>(),
    nearby: { edge: TransportRoadEdge; distance: number }[] = [];
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const key = `${canonicalRoadBucketX(bx + dx, bucketSize, SOURCE_PRESENTATION_WIDTH)}/${bz + dz}`;
    for (const edge of siteBuckets.get(key) ?? []) {
      if (seen.has(edge.code)) continue;
      seen.add(edge.code);
      const distance = transportPolylineDistance(edge.centerline, x, z);
      if (distance <= radiusSource) nearby.push({ edge, distance });
    }
  }
  return Object.freeze(nearby.sort((a, b) =>
    a.distance - b.distance || compareCode(a.edge.code, b.edge.code))
    .slice(0, boundedLimit).map(({ edge }) => edge));
}

/** Shared canonical road choice, including both existing roads and true site access. */
export function siteTransportRoadsNear(x: number, z: number, radiusSource: number, limit: number = TRANSPORT_LIMITS.queryRoadLimit) {
  const boundedLimit = Math.max(1, Math.min(limit, TRANSPORT_LIMITS.queryRoadLimit)),
    base = baseRoadsNear(x, z, radiusSource, boundedLimit),
    access = siteAccessRoadsNear(x, z, radiusSource, boundedLimit),
    nearby = [...base, ...access].map(edge => ({
      edge, distance: transportPolylineDistance(edge.centerline, x, z),
    }));
  return Object.freeze(nearby.sort((a, b) =>
    a.distance - b.distance || compareCode(a.edge.code, b.edge.code))
    .slice(0, boundedLimit).map(({ edge }) => edge));
}

// The topology never changes after SEED construction. Cache static totals once;
// bridge counts still come from the live, demand-built base registry on inspection.
const siteTopologyTotals = Object.freeze({
  digest: siteTransportNetwork.digest,
  roads: siteTransportNetwork.roadEdges.length,
  junctions: siteTransportNetwork.junctions.length,
  accessRoads: siteTransportNetwork.roadEdges.filter(edge => edge.roadClass === "access").length,
  siteNodes: criticalSites.length,
  siteAccessBranches: siteAccessRoads.length,
});

export function siteTransportAcceptanceSummary() {
  return Object.freeze({ ...baseAcceptanceSummary(), ...siteTopologyTotals });
}
