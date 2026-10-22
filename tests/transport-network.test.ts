import { test } from "node:test";
import { buildTile } from "../src/geometry.ts";
import { rebuildNaturalSurface, NATURAL_MESH_LIMITS } from "../src/natural-surface-mesh.ts";
import { finalSurfaceEvidenceAnchors, tileForPosition } from "../src/world.ts";
import { refineTileSurfacePresentation, refinementResolutionForTile } from "../src/surface-refinement.ts";
import assert from "node:assert/strict";
import {
  cities,
  continuityCorridor,
  countries,
  countryAtPosition,
  roadConnections,
  roadJunctions,
  roadNetworkTelemetry,
  roadDistanceAt,
  roads,
  villages,
} from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { roadFragmentsInBounds } from "../src/continuity-corridor.ts";
import { SOURCE_PRESENTATION_WIDTH, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { polylineTouchesViewport } from "../src/transport-viewport.ts";
import { roadRepresentationAtScale, roadVisibleAtScale } from "../src/surface-presentation.ts";
import { sampledBridgeCrossingPass, transportBridgeSpanAt, transportBridgeSurfaceAt, transportBankApproachGrade, transportRoadArcStations, transportRoadBankApproaches, transportRoadWetStations } from "../src/transport-bridge-surface.ts";
import { finalSurfaceAt } from "../src/world-core.ts";
import { createTransportJunctionLookup } from "../src/transport-junction-index.ts";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { criticalSites } from "../src/sites.ts";
import { createTransportWalkingIndex, nearestWalkingRoadEndpoint, selectedWalkingPreviewOrigin, transportWalkingRoute, transportWalkingRouteThroughEdge, transportWalkingRouteToNearest, visibleWalkingPreviewEdgeCodes } from "../src/transport-walking-route.ts";
import { SITE_ACCESS_STATION_LIMIT, siteAccessParentRoadCode, siteAccessRoadStations, siteAccessSampleVerdict } from "../src/transport-site-access.ts";
import { planTransportRouteCorridor, ROUTE_CORRIDOR_STATION_LIMIT, sampledCorridorStationPass } from "../src/transport-route-corridor.ts";
import type { FinalSurface } from "../src/final-surface.ts";
import {
  TRANSPORT_LIMITS,
  type TransportNetwork,
  type TransportNode,
  buildTransportNetwork,
  ensureTransportBridgeEvidence,
  transportBridgeByCode,
  transportAcceptanceSummary,
  transportGenerationTelemetry,
  transportNetwork,
  transportPolylineDistance,
  transportRoadsNear,
  transportSegmentIntersection,
  transportSurfaceRoads,
} from "../src/transport-network.ts";

function adjacency(countryCode?: string) {
  const result = new Map<string, string[]>();
  for (const edge of transportNetwork.roadEdges) {
    if (countryCode && !edge.countryCodes.includes(countryCode)) continue;
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
      const list = result.get(from) ?? [];
      list.push(to);
      result.set(from, list);
    }
  }
  return result;
}

function reachable(start: string, graph: Map<string, string[]>) {
  const seen = new Set([start]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++)
    for (const next of graph.get(queue[cursor]) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
}

test("S005 preview starts at selected canonical Y/harbor rather than unrelated map road", () => {
  const network = siteTransportNetwork,
    nodes = new Map(network.nodes.map(node => [node.code, node])),
    junction = network.junctions[0], harbor = network.harbors[0],
    unrelated = network.roadEdges.find(edge =>
      ![junction.nodeCode, harbor.nodeCode].includes(edge.from) &&
      ![junction.nodeCode, harbor.nodeCode].includes(edge.to))!;
  assert.ok(junction && harbor && unrelated);
  const focus = unrelated.centerline[0].position;
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "junction", code: junction.code }, focus, network, nodes, unrelated,
  )?.code, junction.nodeCode, "selected Y must win even if map focus is near another road");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "harbor", code: harbor.code }, focus, network, nodes, unrelated,
  )?.code, harbor.nodeCode, "selected harbor is a real walkable on-road terminal");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "ferry", code: network.ferryEdges[0].code }, focus, network, nodes, unrelated,
  ), undefined, "ferry-only selection must not silently start a land route");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "junction", code: "MISSING" }, focus, network, nodes, unrelated,
  ), undefined, "invalid selection must never fall back to an unrelated road");

  const road = network.roadEdges.find(edge => edge.from !== harbor.nodeCode && edge.to !== harbor.nodeCode)!;
  assert.ok(road);
  const atRoad = selectedWalkingPreviewOrigin(
    { kind: "road", code: road.code }, road.centerline[0].position, network, nodes, unrelated,
  );
  assert.equal(atRoad?.code, road.from, "selected road takes its own physically nearest endpoint");
  const crossing = network.borderCrossings.find(item => network.roadEdges.some(edge => edge.code === item.roadCode));
  assert.ok(crossing);
  const parentRoad = network.roadEdges.find(edge => edge.code === crossing!.roadCode)!;
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "border", code: crossing!.code }, parentRoad.centerline[0].position,
    network, nodes, unrelated,
  )?.code, parentRoad.from, "selected border crossing must remain attached to its owning road");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "bridge", code: "SELECTED/BRIDGE/1" }, parentRoad.centerline[0].position,
    network, nodes, unrelated, parentRoad.code,
  )?.code, parentRoad.from, "selected bridge uses the resolved owner, not the focus road");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "bridge", code: "SELECTED/BRIDGE/1" }, focus, network, nodes, unrelated,
  ), undefined, "missing physical bridge owner fails closed");
  assert.equal(selectedWalkingPreviewOrigin(
    undefined, focus, network, nodes, unrelated,
  )?.code, nearestWalkingRoadEndpoint(unrelated, nodes, focus)?.code,
  "unselected preview preserves the nearest-road fallback");
});

test("S005 route preview projects only real nearby walking edge identities", () => {
  const nearby = [{ code: "EDGE/B" }, { code: "EDGE/D" }, { code: "EDGE/A" }];
  assert.deepEqual([...visibleWalkingPreviewEdgeCodes(
    { edgeCodes: ["EDGE/A", "FERRY/X", "EDGE/B", "EDGE/B", "EDGE/C"] }, nearby,
  )], ["EDGE/B", "EDGE/A"], "highlight only in-view canonical roads in their stable draw order");
  assert.equal(visibleWalkingPreviewEdgeCodes(null, nearby).size, 0,
    "cleared preview must not keep stale road highlights");
  assert.equal(visibleWalkingPreviewEdgeCodes({ edgeCodes: ["EDGE/C"] }, nearby).size, 0,
    "offscreen path segments must not force additional geometry");
});

test("S005 site preview chooses nearest physical graph endpoint at high latitude and seam", () => {
  const base = siteTransportNetwork.nodes.find(node => node.kind !== "site")!;
  const deg = Math.PI / 180;
  const node = (code: string, longitude: number, latitude: number, kind: TransportNode["kind"] = "village"): TransportNode =>
    ({ ...base, code, kind, position: { lon: longitude * deg, lat: latitude * deg, elevation: 0 } });
  const nodes = new Map<string, TransportNode>([
    ["E", node("E", 6, 80)],
    ["N", node("N", 0, 78)],
  ]);
  const edge = { from: "E", to: "N" };
  assert.equal(nearestWalkingRoadEndpoint(edge, nodes, { lon: 0, lat: 80 * deg })?.code, "E",
    "six degrees east at 80°N is physically closer than two degrees south");
  assert.equal(nearestWalkingRoadEndpoint(edge, nodes, { lon: 0, lat: 0 })?.code, "N",
    "equatorial control must not prefer latitude-scaled longitude blindly");
  const seam = new Map<string, TransportNode>([
    ["WEST", node("WEST", -179.8, 0)],
    ["EAST", node("EAST", 179.0, 0)],
  ]);
  assert.equal(nearestWalkingRoadEndpoint({ from: "WEST", to: "EAST" }, seam,
    { lon: 179.9 * deg, lat: 0 })?.code, "WEST", "seam crossing uses shortest planet arc");
  const tied = new Map<string, TransportNode>([
    ["N", node("N", 0, 0)],
    ["E", node("E", 0, 0)],
    ["SITE", node("SITE", 0, 0, "site")],
  ]);
  assert.equal(nearestWalkingRoadEndpoint({ from: "N", to: "E" }, tied,
    { lon: 0, lat: 0 })?.code, "E", "equal physical distances use stable canonical code");
  assert.equal(nearestWalkingRoadEndpoint({ from: "SITE", to: "N" }, tied,
    { lon: 0, lat: 0 })?.code, "N", "the map preview must not originate at a site endpoint");
  assert.equal(nearestWalkingRoadEndpoint({ from: "SITE", to: "MISSING" }, tied,
    { lon: 0, lat: 0 }), undefined, "no legal endpoint means no invented route");
});

test("S005 bank approach uses the traversed bridge-deck surface height", () => {
  const bank = (heights: readonly number[], groundAtNearBank: number) =>
    heights.map((surfaceHeight, index) => ({
      surfaceHeight,
      groundHeight: index === 0 ? groundAtNearBank : surfaceHeight,
    }));
  const left = bank([10, 10.2, 10.4, 10.6, 10.8], 4),
    right = bank([10.8, 10.6, 10.4, 10.2, 10], 3),
    measured = transportBankApproachGrade([left, right]);
  assert.ok(measured !== null && Math.abs(measured - .05) < 1e-9,
    "a dry-bank bridge deck grades from its walkable top, never bare earth underneath");
  assert.ok(transportBankApproachGrade([left, bank([10.8, 10.6, 10.4, 9.4, 9.2], 3)])! > .08,
    "steep actual deck-to-ground transitions must still fail the eight-percent limit");
  assert.equal(transportBankApproachGrade([left, right.slice(1)]), null,
    "missing road stations cannot certify a bank");
});

test("S005 walking preview reuses actual site branches, stays deterministic, excludes ferries", () => {
  const graph = createTransportWalkingIndex(siteTransportNetwork);
  const siteBranches = siteTransportNetwork.roadEdges.filter(edge => edge.from.includes("/NODE/SITE/"));
  assert.ok(siteBranches.length > 0, "canonical critical-site access branches must be present");
  const sampled = siteBranches.filter((edge, index) => index === 0 ||
    index === Math.floor(siteBranches.length / 2) || index === siteBranches.length - 1);
  for (const branch of sampled) {
    const route = transportWalkingRoute(graph, branch.to, branch.from);
    assert.ok(route, `missing walking preview for ${branch.code}`);
    assert.deepEqual(route!.edgeCodes, [branch.code], "site's sole canonical access is its existing edge");
    assert.equal(route!.distanceM, branch.surfaceLengthM);
    assert.equal(route!.fantasyWalkSeconds, branch.fantasyWalkSeconds);
    assert.deepEqual(transportWalkingRoute(graph, branch.to, branch.from), route,
      "visit order and query repetition must not change graph route facts");
    assert.ok(route!.exploredNodes <= graph.nodeCount);
  }
  const ferry = siteTransportNetwork.ferryEdges[0];
  assert.ok(ferry, "representative maritime transfer is required");
  assert.equal(transportWalkingRoute(graph, ferry.from, ferry.to), null,
    "a ferry must never become an imaginary intercontinental walking connection");
  assert.equal(transportWalkingRoute(graph, "absent-node", sampled[0].from), null);
});

test("S005 site preview picks shortest reachable road path rather than nearer disconnected or longer site", () => {
  const network = {
    nodes: ["start", "junction", "near-but-disconnected", "far-by-map", "long-by-road"]
      .map(code => ({ code })),
    roadEdges: [
      { code: "a", from: "start", to: "junction", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "b", from: "junction", to: "far-by-map", surfaceLengthM: 2, fantasyWalkSeconds: 20 },
      { code: "c", from: "start", to: "long-by-road", surfaceLengthM: 30, fantasyWalkSeconds: 300 },
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network);
  const sites = ["near-but-disconnected", "long-by-road", "far-by-map"];
  const route = transportWalkingRouteToNearest(index, "start", sites);
  assert.ok(route);
  assert.equal(route!.to, "far-by-map");
  assert.deepEqual(route!.edgeCodes, ["a", "b"]);
  assert.equal(route!.distanceM, 3);
  assert.equal(route!.fantasyWalkSeconds, 30);
  assert.deepEqual(transportWalkingRouteToNearest(index, "start", [...sites].reverse()), route);
  assert.equal(transportWalkingRouteToNearest(index, "start", ["near-but-disconnected"]), null);
  assert.equal(transportWalkingRoute(index, "start", "near-but-disconnected"), null);
});

test("S005 bridge-selected site preview must traverse its actual road rather than the nearer bypass", () => {
  const network = {
    nodes: ["bank-a", "bank-b", "near-site", "far-site", "bypass"].map(code => ({ code })),
    roadEdges: [
      { code: "bridge-road", from: "bank-a", to: "bank-b", surfaceLengthM: 10, fantasyWalkSeconds: 100 },
      { code: "near", from: "bank-a", to: "near-site", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "far", from: "bank-b", to: "far-site", surfaceLengthM: 2, fantasyWalkSeconds: 20 },
      { code: "detour-a", from: "bank-b", to: "bypass", surfaceLengthM: 10, fantasyWalkSeconds: 100 },
      { code: "detour-b", from: "bypass", to: "bank-a", surfaceLengthM: 10, fantasyWalkSeconds: 100 },
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network);
  const selected = network.roadEdges[0];
  const sites = ["near-site", "far-site"];
  assert.deepEqual(transportWalkingRouteToNearest(index, "bank-a", sites)?.edgeCodes, ["near"],
    "ordinary shortest path should be allowed to bypass a bridge");
  const through = transportWalkingRouteThroughEdge(index, "bank-a", selected, sites);
  assert.ok(through, "selected bridge must have a route continuing from the other bank");
  assert.deepEqual(through!.edgeCodes, ["bridge-road", "far"]);
  assert.equal(through!.to, "far-site");
  assert.equal(through!.distanceM, 12);
  assert.equal(through!.fantasyWalkSeconds, 120);
  assert.ok(through!.exploredNodes <= index.nodeCount);
  assert.deepEqual(transportWalkingRouteThroughEdge(index, "bank-a", selected, [...sites].reverse()), through,
    "changing destination input order never changes the canonical route");
  assert.deepEqual(transportWalkingRouteThroughEdge(index, "bank-b", selected, sites)?.edgeCodes,
    ["bridge-road", "near"], "reverse-bank selection must also traverse the chosen bridge road once");
  assert.equal(transportWalkingRouteThroughEdge(index, "absent", selected, sites), null);
  assert.equal(transportWalkingRouteThroughEdge(index, "bank-a",
    { ...selected, code: "not-a-real-bridge-road" }, sites), null,
  "invented owner must fail closed rather than accepting a nearby graph edge");

  const disconnected = createTransportWalkingIndex({
    ...network, roadEdges: network.roadEdges.slice(0, 2),
  } as TransportNetwork);
  assert.equal(transportWalkingRouteThroughEdge(disconnected, "bank-a", selected, ["near-site"]), null,
    "do not silently retrace the selected bridge if the far bank has no other walking way to a site");
});

test("S005 physical walking-route diagnostic samples actual oriented SEED roads or fails its fixed budget", () => {
  const makeEdge = (code: string, from: string, to: string, ax: number, bx: number) => ({
    code, from, to, centerline: [
      { x: ax, z: 0 }, { x: bx, z: 0 },
    ],
  }) as unknown as TransportRoadEdge;
  const a = makeEdge("road/a", "A", "B", 0, 3),
    b = makeEdge("road/b", "B", "C", 3, 5),
    roads = new Map([a, b].map(edge => [edge.code, edge])),
    nodes = new Map([
      ["A", { x: 0, z: 0 }], ["B", { x: 3, z: 0 }], ["C", { x: 5, z: 0 }],
    ]);
  const result = planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] }, roads, nodes,
  );
  assert.equal(result.status, "ready");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [a.code, b.code] }, roads, nodes,
  ).status, "invalid", "a connected route ending at C cannot certify requested site B");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code] }, roads, nodes,
  ).status, "invalid", "a physically valid partial route cannot claim it reaches site C");

  assert.deepEqual(result.stations.map(station => station.edgeCode), [
    "road/a", "road/a", "road/a", "road/a", "road/b", "road/b",
  ], "shared Y must not duplicate a terminal station and falsely create a zero-grade interval");
  assert.equal(result.stations[3].joinedEdgeCode, b.code,
    "the shared physical graph point records both incident roads without duplicate sampling");
  for (const [i, station] of result.stations.entries())
    assert.ok(Math.abs(station.x - i) < 1e-6, "source-coordinate wrap roundoff never alters the real station");
  const reverse = planTransportRouteCorridor(
    { from: "C", to: "A", edgeCodes: [b.code, a.code] }, roads, nodes,
  );
  assert.equal(reverse.status, "ready");
  assert.equal(reverse.stations.length, 6);
  assert.equal(reverse.stations[2].joinedEdgeCode, a.code,
    "reverse walking direction keeps the next canonical road identity at the single junction");
  for (const [i, station] of reverse.stations.entries())
    assert.ok(Math.abs(station.x - (5 - i)) < 1e-6,
      "walking direction must reflect the actual source-owned graph sequence");
  assert.equal(planTransportRouteCorridor({ from: "A", to: "C", edgeCodes: [b.code] }, roads, nodes).status, "invalid",
    "disconnected abstract codes never construct physical corridor samples");
  assert.equal(planTransportRouteCorridor({ from: "A", to: "C", edgeCodes: ["fabricated"] }, roads, nodes).status, "invalid");
  const gap = makeEdge("gap", "B", "C", 4, 5);
  assert.equal(planTransportRouteCorridor({ from: "A", to: "C", edgeCodes: [a.code, gap.code] },
    new Map([a, gap].map(edge => [edge.code, edge])), nodes).status, "invalid",
  "matching graph nodes cannot hide separated physical source geometry");
  const huge = makeEdge("huge", "A", "C", 0, ROUTE_CORRIDOR_STATION_LIMIT + 1);
  const over = planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [huge.code] }, new Map([[huge.code, huge]]),
    new Map([["A", { x: 0, z: 0 }], ["C", { x: ROUTE_CORRIDOR_STATION_LIMIT + 1, z: 0 }]]));
  assert.equal(over.status, "over-budget");
  assert.equal(over.stations.length, 0,
    "oversized diagnostic must reject the route without truncating it into a false positive");
  assert.deepEqual(planTransportRouteCorridor({ from: "A", to: "C", edgeCodes: [a.code, b.code] }, roads, nodes), result);
  for (const centerline of [
    [null, { x: 3, z: 0 }],
    [{ x: 0, z: 0 }, null],
    [{ x: 0, z: 0 }, null, { x: 3, z: 0 }],
  ]) {
    const malformed = { ...a, centerline } as unknown as TransportRoadEdge;
    assert.equal(planTransportRouteCorridor(
      { from: "A", to: "B", edgeCodes: [a.code] },
      new Map([[a.code, malformed]]), nodes,
    ).status, "invalid", "corrupt source waypoints must fail closed without throwing");
  }
  const detached = makeEdge("detached", "A", "B", 20, 23),
    short = makeEdge("short", "A", "B", 0, 2);
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [detached.code] },
    new Map([[detached.code, detached]]), nodes,
  ).status, "invalid", "a lone graph-connected but displaced road must not pass physical inspection");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [short.code] },
    new Map([[short.code, short]]), nodes,
  ).status, "invalid", "physical route must meet its canonical terminal node, not stop short");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [a.code] }, roads, new Map([["A", { x: 0, z: 0 }]]),
  ).status, "invalid", "missing authoritative destination node fails closed");
  assert.equal(planTransportRouteCorridor(
    { from: "B", to: "A", edgeCodes: [a.code] }, roads, nodes,
  ).status, "ready", "reverse graph ownership must use the correct oriented endpoint positions");

  const station = result.stations[0], dry = {
    walkable: true, traversal: "road", water: { kind: "none" },
    deckHeight: null, deckOwnerIds: [], contributingModifierIds: [a.code],
  } as unknown as FinalSurface;
  assert.equal(sampledCorridorStationPass(station, dry), true);
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "difficult" }), false,
    "canonical road grade above 8% cannot be reported as a legal sampled crossing");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "open" }), true,
    "walkable site/settlement transition with the selected road modifier remains legal");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, deckHeight: 7, traversal: "bridge", deckOwnerIds: ["unrelated-overpass"],
  }), false, "unrelated upper bridge deck must never certify a road below a dry overpass");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, deckHeight: 7, traversal: "bridge", deckOwnerIds: [a.code],
  }), true, "the selected road's own dry bridge deck remains valid");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, deckHeight: 7, traversal: "road", deckOwnerIds: [a.code],
  }), false, "inconsistent top-deck traversal cannot certify passage");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, traversal: "bridge",
  }), false, "a bridge traversal without an actual top deck is not certified");
  const junction = result.stations[3], outgoing = result.stations[4];
  assert.equal(sampledCorridorStationPass(junction, dry), true,
    "the actual single winning incoming modifier must not falsely reject a shared Y");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, contributingModifierIds: [b.code],
  }), true, "the single winning outgoing modifier at the same node is also legal");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, contributingModifierIds: ["unrelated-crossing"],
  }), false, "an unrelated road intersection never creates a canonical junction");
  assert.equal(sampledCorridorStationPass(outgoing, dry), false,
    "the station after the Y must prove the outgoing road independently");
  assert.equal(sampledCorridorStationPass(outgoing, {
    ...dry, contributingModifierIds: [b.code],
  }), true, "the outgoing road's own next physical station passes");
  assert.equal(sampledCorridorStationPass(reverse.stations[3], {
    ...dry, contributingModifierIds: [b.code],
  }), false, "reverse traversal also checks the next separate edge");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, water: { ...dry.water, kind: "river" }, traversal: "bridge",
    deckHeight: 4, deckOwnerIds: [a.code],
  }), true, "one source-owned top deck is sufficient at a real shared wet endpoint");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, contributingModifierIds: [b.code],
    water: { ...dry.water, kind: "river" }, traversal: "bridge",
    deckHeight: 4, deckOwnerIds: [a.code],
  }), false, "the bridge deck must be owned by the SAME contributing incident road");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, traversal: "bridge", deckHeight: 4, deckOwnerIds: [a.code],
  }), true, "an incident road-owned dry deck is legal at the shared endpoint");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, traversal: "bridge", deckHeight: 4, deckOwnerIds: ["unrelated-overpass"],
  }), false, "an unrelated upper deck may not impersonate either Y-joined road");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, contributingModifierIds: ["unrelated-road"],
  }), false, "dry unrelated roads cannot certify selected source ownership");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, water: { ...dry.water, kind: "river" },
  }), false, "unbridged water must fail closed");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, water: { ...dry.water, kind: "river" }, traversal: "bridge",
    deckHeight: 4, deckOwnerIds: [a.code],
  }), true, "only the actual selected road deck certifies a wet sample");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, walkable: false,
  }), false, "a contributing road never overrides Simulation walkability");
});

test("S005 selected site access probe stays bounded and reports sampled physical facts without inventing traversal", () => {
  const accessBranches = siteTransportNetwork.roadEdges.filter(edge =>
    edge.roadClass === "access" && edge.from.includes("/NODE/SITE/"));
  assert.ok(accessBranches.length > 0);
  for (const edge of accessBranches) {
    const site = criticalSites.find(site => site.access.branchCode === edge.code);
    assert.ok(site, `missing SEED owner for ${edge.code}`);
    assert.equal(siteAccessParentRoadCode(edge), site.access.roadCode,
      "site branch must name its SEED-assigned parent rather than an arbitrary incident road");
    assert.equal(siteAccessParentRoadCode({ ...edge, from: "S005/NODE/SITE/WRONG" }), undefined,
      "misowned site branch must never certify a different site's road");
    assert.equal(siteAccessParentRoadCode({ ...edge, roadClass: "main" }), undefined,
      "non-access edge must not claim a critical-site parent");
    const stations = siteAccessRoadStations(edge);
    assert.equal(stations.length, edge.centerline.length * 2 - 1, edge.code);
    assert.ok(stations.length <= SITE_ACCESS_STATION_LIMIT, edge.code);
    assert.deepEqual(siteAccessRoadStations(edge), stations);
  }

  // Use a real SEED parent/branch join: geometry can be exact while the
  // final surface reports only an unrelated crossing as the top road.
  const actual = accessBranches[0], realStations = siteAccessRoadStations(actual),
    parentCode = siteAccessParentRoadCode(actual)!,
    realSurfaces = realStations.map(() => ({
      surfaceHeight: 0, water: { kind: "none" }, walkable: true,
      traversal: "road", deckHeight: null, deckOwnerIds: [],
      contributingModifierIds: [actual.code],
    } as unknown as FinalSurface)),
    realParents = new Set([parentCode]);
  assert.equal(siteAccessSampleVerdict(actual, realSurfaces, realParents).sampledPass, true,
    "a real geometrically joined site branch remains legal when its road owns the terminal");
  const unrelatedTerminal = realSurfaces.map((surface, index) => index === realSurfaces.length - 1
    ? { ...surface, contributingModifierIds: ["UNRELATED/CROSSING"] } : surface);
  const geometryOnly = siteAccessSampleVerdict(actual, unrelatedTerminal, realParents);
  assert.equal(geometryOnly.onRecordedRoad, true,
    "actual SEED parent geometry remains a real graph connection");
  assert.equal(geometryOnly.terminalGeometryOnly, true,
    "unrelated terminal contributor must not be mislabeled final-surface ownership proof");
  assert.equal(geometryOnly.sampledPass, true,
    "legacy sampled grade and geometry verdict stays distinct from surface-owner certification");
  const parentWinner = siteAccessSampleVerdict(actual, realSurfaces.map((surface, index) =>
    index === realSurfaces.length - 1
      ? { ...surface, contributingModifierIds: [parentCode] } : surface), realParents);
  assert.equal(parentWinner.sampledPass, true,
    "the actual parent road may own the shared terminal without the branch modifier");
  assert.equal(parentWinner.terminalGeometryOnly, false,
    "an incident parent modifier removes the geometry-only evidence caveat");

  const edge = {
    code: "S005/SITE/ACCESS", from: "S005/NODE/SITE/EXAMPLE", roadClass: "access",
    centerline: [{ x: 0, z: 0 }, { x: 0.25, z: 0 }, { x: 0.5, z: 0 }],
  } as unknown as TransportRoadEdge;
  const stations = siteAccessRoadStations(edge);
  assert.equal(stations.length, 5);
  const surfaces = stations.map((_, i) => ({
    surfaceHeight: i * 0.1,
    water: { kind: "none" },
    walkable: true,
    traversal: "road",
    contributingModifierIds: [edge.code],
  } as unknown as FinalSurface));
  const junctionRoadCodes = new Set([edge.code, "PARENT/ROAD"]),
    connectedSurfaces = surfaces.map((surface, i) => i === 4 ?
      { ...surface, contributingModifierIds: [edge.code, "PARENT/ROAD"] } : surface);
  assert.equal(siteAccessSampleVerdict(edge, surfaces, junctionRoadCodes).sampledPass, false,
    "a site branch alone at the terminal cannot certify its parent road connection");
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces).sampledPass, false,
    "missing recorded incident-road evidence must not default to a pass");
  const good = siteAccessSampleVerdict(edge, connectedSurfaces, junctionRoadCodes);
  assert.equal(good.sampledPass, true);
  assert.equal(good.stationCount, 5);
  assert.equal(good.expectedStations, 5);
  assert.equal(good.onRecordedRoad, true);
  assert.equal(good.topSurfaceOwned, true);
  assert.equal(good.terminalGeometryOnly, false);
  const deckSample = (owner: string) => connectedSurfaces.map((surface, index) => index === 2 ?
    { ...surface, traversal: "bridge", deckHeight: surface.surfaceHeight, deckOwnerIds: [owner] } : surface);
  const wrongTop = siteAccessSampleVerdict(edge, deckSample("UNRELATED/OVERPASS"), junctionRoadCodes);
  assert.equal(wrongTop.onRecordedRoad, true,
    "the chosen road may contribute below a higher unrelated bridge");
  assert.equal(wrongTop.topSurfaceOwned, false);
  assert.equal(wrongTop.sampledPass, false,
    "site access cannot be certified by a road hidden under an unrelated top deck");
  assert.equal(siteAccessSampleVerdict(edge, deckSample(edge.code), junctionRoadCodes).sampledPass, true,
    "the site branch's own bridge deck is legal when sampled grade remains safe");
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, index) => index === 2 ?
    { ...surface, traversal: "bridge" } : surface), junctionRoadCodes).sampledPass, false,
    "a bridge classification without a physical top deck is not a valid sample");
  assert.ok(good.maximumGrade !== null && good.maximumGrade < .08);
  const steep = siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, i) => i === 2 ?
    { ...surface, traversal: "difficult" } : surface), junctionRoadCodes);
  assert.equal(steep.sampledPass, false,
    "a steep local road surface cannot pass on averaged grade and walkability alone");
  assert.equal(steep.gradeWithinLimit, false);
  assert.ok(steep.maximumGrade !== null && steep.maximumGrade < .08,
    "the local slope rejection is independent of a low sampled span average");
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, i) => i === 2 ?
    { ...surface, traversal: "open" } : surface), junctionRoadCodes).sampledPass, true,
    "a dry walkable site-pad transition remains legal when local slope is safe");
  assert.deepEqual(siteAccessSampleVerdict(edge, connectedSurfaces, junctionRoadCodes), good);
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.slice(1), junctionRoadCodes).sampledPass, false,
    "missing selected final-surface station must never produce a pass");
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.map((s, i) => i === 2 ?
    { ...s, water: { ...s.water, kind: "river" } } as FinalSurface : s), junctionRoadCodes).sampledPass, false);
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.map((s, i) => i === 2 ?
    { ...s, contributingModifierIds: [] } : s), junctionRoadCodes).sampledPass, false,
    "the canonical site branch must own sampled road interior");
  const parentAtJunction = surfaces.map((s, i) => i === 4 ?
    { ...s, contributingModifierIds: ["PARENT/ROAD"] } : s);
  assert.equal(siteAccessSampleVerdict(edge, parentAtJunction,
    new Set([edge.code, "PARENT/ROAD"])).sampledPass, true,
    "the physical junction can legitimately be owned by its incident parent road");
  assert.equal(siteAccessSampleVerdict(edge, parentAtJunction,
    new Set([edge.code, "UNRELATED/ROAD"])).sampledPass, false,
    "unrelated dry road is not a legal physical junction with the site branch");
  assert.equal(siteAccessSampleVerdict(edge, surfaces.map((s, i) => i === 4 ?
    { ...s, surfaceHeight: 30 } : s)).gradeWithinLimit, false);
  assert.equal(siteAccessRoadStations({ ...edge, roadClass: "main" }).length, 0);
  const sparse = { ...edge, centerline: [
    { x: 0, z: 0 }, { x: 0.25, z: 0 }, { x: 7, z: 0 },
  ] };
  assert.equal(siteAccessRoadStations(sparse).length, 0,
    "a >75 m unexamined centerline interval cannot certify a physical site access branch");
  assert.equal(siteAccessSampleVerdict(sparse, connectedSurfaces, junctionRoadCodes).sampledPass, false,
    "passing stations from a different profile cannot certify a sparse unsafe gap");
  for (const invalid of [
    { ...edge, centerline: [{ x: NaN, z: 0 }, { x: 0.25, z: 0 }] },
    { ...edge, centerline: [{ x: 0, z: 0 }, { x: Infinity, z: 0 }] },
  ]) {
    assert.equal(siteAccessRoadStations(invalid).length, 0,
      "nonfinite access profile coordinates must fail closed without throwing");
    assert.equal(siteAccessSampleVerdict(invalid, connectedSurfaces, junctionRoadCodes).sampledPass, false);
  }
  assert.equal(siteAccessRoadStations({ ...edge, centerline: undefined } as unknown as TransportRoadEdge).length, 0,
    "missing access centerline must fail closed without throwing");
  assert.ok(siteAccessRoadStations({
    ...edge, centerline: [{ x: 0, z: 0 }, { x: 0.4, z: 0 }],
  }).length > 0, "short bounded intervals remain inspectable");
  assert.equal(siteAccessRoadStations({
    ...edge,
    centerline: Array.from({ length: SITE_ACCESS_STATION_LIMIT }, (_, x) => ({ x, z: 0 })),
  }).length, 0, "never silently truncate a source branch to meet the budget");
});

test("S005 source-polyline distance uses the shortest wrapped segment at the longitude seam", () => {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const seamRoad = [{ x: half - 8, z: 100 }, { x: -half + 8, z: 100 }];
  assert.ok(Math.abs(transportPolylineDistance(seamRoad, -half + 3, 100)) < 1e-6);
  assert.ok(Math.abs(transportPolylineDistance(seamRoad, half - 3, 100)) < 1e-6);
  assert.ok(Math.abs(transportPolylineDistance(seamRoad, -half + 3, 107) - 7) < 1e-6);
  assert.ok(Math.abs(transportPolylineDistance(seamRoad, half - 3, 107) - 7) < 1e-6);
  assert.ok(Math.abs(transportPolylineDistance([...seamRoad].reverse(), -half + 3, 107) - 7) < 1e-6);
});

test("S005 selected crossing samples the real bent road arc without inventing a tangent shortcut", () => {
  const elbow = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }];
  const stations = transportRoadArcStations(elbow, 8, 0, -30, 30, 6);
  assert.equal(stations.length, 7);
  assert.ok(stations[0].x < 8 && Math.abs(stations[0].z) < 1e-6);
  assert.ok(Math.abs(stations[3].x - 8) < 1e-6 && Math.abs(stations[3].z) < 1e-6,
    "the canonical road elbow stays within tight wrapped-coordinate tolerance");
  assert.ok(Math.abs(stations[6].x - 8) < 1e-6 && stations[6].z > 0,
    "dry-bank approach follows the bent recorded road rather than the initial tangent");
  assert.equal(transportRoadArcStations(elbow, 8, 0, -30, 400, 6).length, 0,
    "inspector cannot extend a canonical road beyond its recorded end");
  assert.equal(transportRoadArcStations(elbow, 8, 0, -30, 30, 49).length, 0,
    "selected crossing sampling must retain a strict 49-station maximum");

  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const seam = [{ x: half - 8, z: 100 }, { x: -half + 8, z: 100 }];
  const wrapped = transportRoadArcStations(seam, -half, 100, -30, 30, 6);
  assert.equal(wrapped.length, 7);
  assert.ok(Math.abs(Math.abs(wrapped[3].x) - half) < 1e-5,
    "the graph road's short seam crossing remains the sampled physical path");
  assert.ok(wrapped.every(point => Math.abs(point.z - 100) < 1e-6));
});

test("S005 bridge road-arc anchor uses canonical metre proximity at high latitude and longitude seam", () => {
  const highLatitudeZ = -SOURCE_PRESENTATION_WIDTH * (80 / 360),
    meridian = [{ x: 100, z: highLatitudeZ - 10 }, { x: 100, z: highLatitudeZ + 10 }],
    nearPhysicalRoad = transportRoadArcStations(meridian, 100.4, highLatitudeZ, -20, 20, 4);
  assert.equal(nearPhysicalRoad.length, 5,
    "0.4 source units east at 80° latitude is about 1.1 m, within the canonical 2 m anchor tolerance");
  assert.ok(nearPhysicalRoad.every(point => Math.abs(point.x - 100) < 1e-6),
    "sampling stays on the recorded road, not on the nearby query point");
  assert.deepEqual(transportRoadArcStations(meridian, 100.4, highLatitudeZ, -20, 20, 4), nearPhysicalRoad);
  assert.equal(transportRoadArcStations(meridian, 101, highLatitudeZ, -20, 20, 4).length, 0,
    "about 2.7 m lateral separation at 80° must fail the same physical tolerance");
  const equatorRoad = [{ x: 100, z: -10 }, { x: 100, z: 10 }];
  assert.equal(transportRoadArcStations(equatorRoad, 100.4, 0, -20, 20, 4).length, 0,
    "0.4 source units near the equator is over 6 m, and must not be treated as 1 m");

  const seamX = SOURCE_PRESENTATION_WIDTH / 2,
    seamRoad = [{ x: seamX - .1, z: highLatitudeZ - 10 },
      { x: seamX - .1, z: highLatitudeZ + 10 }],
    seamSamples = transportRoadArcStations(seamRoad, -seamX + .3, highLatitudeZ, -20, 20, 4);
  assert.equal(seamSamples.length, 5,
    "latitude scaling must not break physical anchor proximity across the longitude seam");
  assert.ok(seamSamples.every(point => Math.abs(point.x - (seamX - .1)) < 1e-5),
    "selected road remains the same canonical wrapped centerline");
});

test("S005 both bridge bank checks follow the actual road bend and never extrapolate missing road", () => {
  const elbow = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }];
  const metresPerUnit = 2 * Math.PI * 637100 / 262144;
  const crossing = { lo: -0.1, hi: 0.1, metresPerUnit };
  const banks = transportRoadBankApproaches(elbow, 8, 0, crossing);
  assert.equal(banks.left.length, 5);
  assert.equal(banks.right.length, 5);
  assert.ok(banks.left.every(point => point.x < 8 && Math.abs(point.z) < 1e-6),
    "incoming bank stations must stay on the horizontal source-owned road");
  assert.ok(banks.right.every(point => Math.abs(point.x - 8) < 1e-6 && point.z > 0),
    "outgoing bank stations must turn with the vertical source-owned road");
  const shortRoad = [{ x: 7.5, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 0.5 }];
  const missing = transportRoadBankApproaches(shortRoad, 8, 0, crossing);
  assert.equal(missing.left.length, 0);
  assert.equal(missing.right.length, 0);
});

test("S005 selected river deck follows the recorded bent road rather than a straight crossing tangent", () => {
  const elbow = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }],
    metresPerUnit = 2 * Math.PI * 637100 / 262144,
    crossing = { lo: -0.1, hi: 0.1, metresPerUnit };
  const wet = transportRoadWetStations(elbow, 8, 0, crossing);
  assert.equal(wet.length, 5);
  assert.ok(wet[0].x < 8 && Math.abs(wet[0].z) < 1e-6,
    "incoming wet stations must remain on the canonical horizontal road");
  assert.ok(Math.abs(wet[2].x - 8) < 1e-6 && Math.abs(wet[2].z) < 1e-6);
  assert.ok(Math.abs(wet[4].x - 8) < 1e-6 && wet[4].z > 0,
    "outgoing wet stations must turn with the actual canonical road");
  assert.deepEqual(transportRoadWetStations(elbow, 8, 0, crossing), wet,
    "identical SEED-owned road input produces identical wet evidence");
  assert.equal(transportRoadWetStations(
    [{ x: 7.98, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 0.02 }],
    8, 0, crossing).length, 0,
    "incomplete wet span cannot be falsely certified via invented road extensions");
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const seam = transportRoadWetStations(
    [{ x: half - 8, z: 100 }, { x: -half + 8, z: 100 }],
    -half, 100, crossing);
  assert.equal(seam.length, 5);
  assert.ok(seam.every(point => Math.abs(point.z - 100) < 1e-6),
    "wet crossing samples retain the source-owned wrap-safe road");
});

test("S005 physical road and bridge fragments clip against the same short seam arc as graph lookup", () => {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const east = { x: half - 8, z: 100, position: sourceToLonLat(half - 8, 100) };
  const west = { x: -half + 8, z: 100, position: sourceToLonLat(-half + 8, 100) };
  for (const [a, b] of [[east, west], [west, east]]) {
    const road = { ...roads[0], fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z, centerline: [a, b] };
    for (const tileX of [half - 12, -half - 12]) {
      const fragments = [...roadFragmentsInBounds([road], tileX, 88, 24)];
      assert.equal(fragments.length, 1, "both physical seam tile aliases must get the actual road fragment");
      assert.ok(Math.abs(Math.abs(fragments[0].toX - fragments[0].fromX) - 16) < 1e-6,
        "renderer must use the short 16-unit segment, not the long world-spanning chord");
      assert.ok(transportPolylineDistance([a, b], tileX + 12, 100) < 16,
        "canonical route proximity must refer to the same local seam arc");
    }
    assert.equal([...roadFragmentsInBounds([road], -12, 88, 24)].length, 0,
      "physical presentation must not invent a road in the middle of the world");
  }
  const localStart = { x: 50, z: 100, position: sourceToLonLat(50, 100) };
  const localEnd = { x: 70, z: 100, position: sourceToLonLat(70, 100) };
  const localRoad = { ...roads[0], centerline: [localStart, localEnd] };
  const localFragments = [...roadFragmentsInBounds([localRoad], 48, 88, 24)];
  assert.equal(localFragments.length, 1);
  assert.equal(localFragments[0].toX - localFragments[0].fromX, 20,
    "ordinary non-seam geometry must remain unchanged");
});

test("S005 bridge intersections use the local wrapped road segment at both seam aliases", () => {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const east = { x: half - 8, z: 100 }, west = { x: -half + 8, z: 100 },
    riverEast = [{ x: half, z: 90 }, { x: half, z: 110 }] as const,
    riverWest = [{ x: -half, z: 90 }, { x: -half, z: 110 }] as const,
    falseMidworld = [{ x: 0, z: 90 }, { x: 0, z: 110 }] as const;
  assert.deepEqual(transportSegmentIntersection(east, west, ...riverEast), { x: half, z: 100 });
  assert.deepEqual(transportSegmentIntersection(west, east, ...riverWest), { x: -half, z: 100 });
  assert.equal(transportSegmentIntersection(east, west, ...falseMidworld), undefined,
    "short seam route must never intersect a phantom river at the world centre");
  assert.equal(transportSegmentIntersection(west, east, ...falseMidworld), undefined);
  assert.deepEqual(
    transportSegmentIntersection({ x: 5, z: 0 }, { x: 15, z: 0 }, { x: 10, z: -5 }, { x: 10, z: 5 }),
    { x: 10, z: 0 }, "ordinary river crossing must preserve its previous local geometry",
  );
});

test("S005 shared physical-road distance and transport lookup agree at the longitude seam", () => {
  const half = SOURCE_PRESENTATION_WIDTH / 2;
  const a = { x: half - 8, z: 100, position: sourceToLonLat(half - 8, 100) };
  const b = { x: -half + 8, z: 100, position: sourceToLonLat(-half + 8, 100) };
  const road = { ...roads[0], fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z, centerline: [a, b] };
  const reversed = { ...road, fromX: b.x, toX: a.x, centerline: [b, a] };
  const fallback = { ...road, centerline: undefined };
  for (const candidate of [road, reversed, fallback]) {
    for (const x of [half - 3, -half + 3]) {
      assert.ok(Math.abs(roadDistanceAt(x, 100, candidate)) < 1e-6, "seam-aligned station must be on the physical road");
      assert.ok(Math.abs(roadDistanceAt(x, 107, candidate) - 7) < 1e-6, "offset from seam-aligned road must be measured locally");
      assert.ok(Math.abs(roadDistanceAt(x, 107, candidate) - transportPolylineDistance([a, b], x, 107)) < 1e-6, "physical and inspector road distances must match");
    }
    assert.ok(roadDistanceAt(0, 100, candidate) > 1000, "seam crossing must never become a world-spanning shortcut");
  }
});

test("S005 nearby junction index preserves canonical full-scan identity, order and no duplicates", () => {
  const lookup = createTransportJunctionLookup(transportNetwork.junctions);
  const edges = transportNetwork.roadEdges;
  for (const subset of [
    [],
    edges.slice(0, 1),
    edges.slice(0, 32),
    edges.slice(Math.max(0, edges.length - 32)),
    edges.filter((_edge, index) => index % 11 === 0),
    edges,
  ]) {
    const selected = new Set(subset.map((edge) => edge.code));
    const expected = transportNetwork.junctions.filter((junction) =>
      junction.edgeCodes.some((code) => selected.has(code)),
    );
    const actual = lookup(selected);
    assert.deepEqual(actual.map((junction) => junction.code), expected.map((junction) => junction.code));
    assert.equal(new Set(actual.map((junction) => junction.code)).size, actual.length);
  }
});

test("S005 viewport clipping retains real road segments crossing the screen", () => {
  const crosses = (points: { x: number; y: number }[], margin = 0) => polylineTouchesViewport(points, 300, 200, margin);
  assert.equal(crosses([{ x: -200, y: 100 }, { x: 400, y: 100 }]), true, "horizontal segment with off-screen stations");
  assert.equal(crosses([{ x: 100, y: -40 }, { x: 100, y: 240 }]), true, "vertical segment with off-screen stations");
  assert.equal(crosses([{ x: -100, y: 20 }, { x: 20, y: -100 }]), false, "overlapping bounding boxes must not imply visible road");
  assert.equal(crosses([{ x: 301, y: 100 }]), false, "off-screen point only");
  assert.equal(crosses([{ x: 0, y: 0 }]), true, "on-screen road station");
  assert.equal(crosses([{ x: -100, y: 100 }, { x: -20, y: 100 }], 40), true, "existing marker margin preserved");
});

test("S005 extends the existing shared macro-road authority instead of replacing it", () => {
  const summary = transportAcceptanceSummary(), telemetry = transportGenerationTelemetry();
  assert.equal(summary.domesticAuthority, roadNetworkTelemetry.version);
  assert.equal(telemetry.domesticAuthority, roadNetworkTelemetry.version);
  assert.equal(telemetry.baseRoads, roadNetworkTelemetry.physicalEdges + Number(Boolean(continuityCorridor.road)));
  assert.equal(telemetry.extensionRoads, countries.length);
  assert.equal(telemetry.topologyRoads, roads.length);
  assert.deepEqual(transportSurfaceRoads.map((road) => road.code), roads.map((road) => road.code));
  assert.ok(transportNetwork.junctions.length >= 500, "owner-approved shared macro junctions must survive S005");
  assert.ok(transportNetwork.junctions.length <= roadJunctions.length);
});

test("canonical road graph covers every generated settlement and each country remains internally connected", () => {
  const summary = transportAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.cities, cities.length);
  assert.equal(summary.villages, villages.length);
  assert.equal(summary.uncoveredNodeCodes.length, 0);
  assert.equal(summary.mandatoryNodes, cities.length + villages.length);

  for (const country of countries) {
    const nodes = transportNetwork.nodes.filter(
      (node) => node.countryCode === country.code && ["capital", "city", "village"].includes(node.kind),
    );
    const capital = nodes.find((node) => node.kind === "capital");
    assert.ok(capital, `${country.code} needs a capital`);
    const seen = reachable(capital!.code, adjacency(country.code));
    for (const node of nodes) assert.ok(seen.has(node.code), `${node.code} must join ${country.code}'s road graph`);
  }
});

test("each continent is one land-road component before maritime transfer", () => {
  const graph = adjacency();
  for (const continent of [...new Set(countries.map((country) => country.continent))].sort((a, b) => a - b)) {
    const nodes = transportNetwork.nodes.filter((node) => node.continent === continent),
      start = nodes.find((node) => node.kind === "capital");
    assert.ok(start, `continent ${continent} needs a capital`);
    const seen = reachable(start!.code, graph);
    for (const node of nodes) assert.ok(seen.has(node.code), `${node.code} must be road-reachable inside continent ${continent}`);
  }
});

test("international main roads connect capitals through explicit canonical border crossings", () => {
  assert.equal(transportNetwork.borderCrossings.length, countries.length - new Set(countries.map((country) => country.continent)).size);
  for (const crossing of transportNetwork.borderCrossings) {
    const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === crossing.roadCode);
    assert.ok(edge, crossing.code);
    assert.equal(edge!.roadClass, "main");
    assert.equal(edge!.countryCodes.length, 2);
    assert.deepEqual([...edge!.countryCodes].sort(), [...crossing.countries].sort());
    const from = transportNetwork.nodes.find((node) => node.code === edge!.from)!,
      to = transportNetwork.nodes.find((node) => node.code === edge!.to)!;
    assert.equal(from.kind, "capital", `${crossing.code} must start at a canonical capital`);
    assert.equal(to.kind, "capital", `${crossing.code} must end at a canonical capital`);
    assert.notEqual(from.countryCode, to.countryCode, `${crossing.code} must connect two countries`);
    assert.deepEqual([from.countryCode, to.countryCode].sort(), [...crossing.countries].sort());
    const owner = countryAtPosition(crossing.position);
    assert.ok(owner && crossing.countries.includes(owner.code), `${crossing.code} must lie on one side of its canonical owner boundary`);
    assert.equal(from.continent, to.continent, `${crossing.code} cannot be an intercontinental walking road`);
  }

  for (const country of countries) {
    const capital = transportNetwork.nodes.find((node) => node.countryCode === country.code && node.kind === "capital");
    assert.ok(capital, `${country.code} needs a canonical capital node`);
    const borderMainRoads = transportNetwork.roadEdges.filter(
      (edge) => edge.borderCrossingCode && edge.roadClass === "main" && (edge.from === capital!.code || edge.to === capital!.code),
    );
    assert.ok(borderMainRoads.length >= 1, `${country.code} capital needs a direct international main-road link`);
  }

  for (const edge of transportNetwork.roadEdges) {
    const from = transportNetwork.nodes.find((node) => node.code === edge.from)!, to = transportNetwork.nodes.find((node) => node.code === edge.to)!;
    assert.equal(from.continent, to.continent, `${edge.code} cannot be an intercontinental walking road`);
  }
});

test("coarse stored alignment remains dry land while final profiles and bridges stay demand-driven", () => {
  const before = transportGenerationTelemetry();
  const beforeSummary = transportAcceptanceSummary();
  assert.equal(before.bridgeCacheRoads, 0);
  assert.equal(before.materializedBridges, 0);

  for (const edge of transportNetwork.roadEdges) {
    for (let segment = 1; segment < edge.centerline.length; segment++) {
      const a = edge.centerline[segment - 1], b = edge.centerline[segment];
      for (let step = 0; step <= 4; step++) {
        const t = step / 4,
          position = sourceToLonLat(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t),
          macro = macroSampleAt(position);
        assert.equal(macro.land, true, `${edge.code} coarse alignment enters ocean`);
        assert.notEqual(macro.domain, "Lake", `${edge.code} coarse alignment enters a lake`);
        assert.notEqual(macro.domain, "Ocean", `${edge.code} coarse alignment enters ocean`);
      }
    }
  }

  const bridge = ensureTransportBridgeEvidence();
  assert.ok(bridge, "explicit diagnostic demand should materialize a legal natural-river bridge record");
  assert.ok(bridge!.spanM > 0 && bridge!.spanM <= TRANSPORT_LIMITS.ruralBridgeMaxM);
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.code === bridge!.roadCode && edge.bridgeCodes.includes(bridge!.code)));
  assert.deepEqual(transportBridgeByCode(bridge!.code), bridge,
    "inspector must resolve the exact canonical selected bridge while cached");
  assert.equal(transportBridgeByCode(bridge!.roadCode + "/BRIDGE/NOT-A-REAL-CROSSING"), undefined,
    "invalid crossing must not acquire a fabricated bridge identity");
  assert.equal(transportBridgeByCode("INVALID/BRIDGE/UNKNOWN"), undefined,
    "absent graph owner cannot invent a selected bridge");
  const after = transportGenerationTelemetry();
  const afterSummary = transportAcceptanceSummary();
  assert.ok(after.bridgeCacheRoads > 0 && after.bridgeCacheRoads <= after.bridgeCacheLimit);
  assert.ok(after.materializedBridges > 0);
  assert.equal(afterSummary.bridges, after.materializedBridges, "live bridge count must not be cached");
  assert.equal(afterSummary.roads, beforeSummary.roads, "static topology coverage must remain unchanged");
});

test("S005 bridge-linked Y to critical-site chain uses one canonical walking graph", () => {
  const network = siteTransportNetwork, index = createTransportWalkingIndex(network),
    nodeByCode = new Map(network.nodes.map(node => [node.code, node])),
    edgeByCode = new Map(network.roadEdges.map(edge => [edge.code, edge])),
    bridge = ensureTransportBridgeEvidence();
  assert.ok(bridge, "the deterministic river crossing must have a real road owner");
  const crossing = edgeByCode.get(bridge!.roadCode);
  assert.ok(crossing && crossing.bridgeCodes.includes(bridge!.code),
    "the selected crossing must remain on its actual graph edge");
  const bank = nodeByCode.get(crossing!.from);
  assert.ok(bank, "crossing approach must be a canonical walking node");
  const y = network.junctions.map(junction => nodeByCode.get(junction.nodeCode))
    .find(node => node?.continent === bank!.continent);
  const site = network.nodes.find(node =>
    node.kind === "site" && node.countryCode === bank!.countryCode);
  assert.ok(y && site, "the bridge continent must have a real Y and road-linked site");
  const approach = transportWalkingRoute(index, y!.code, crossing!.from),
    continuation = transportWalkingRoute(index, crossing!.to, site!.code);
  assert.ok(approach && continuation, "Y and critical site must be connected to the chosen bridge banks");
  const chain = [...approach!.edgeCodes, crossing!.code, ...continuation!.edgeCodes];
  // Graph incidence alone can hide a disconnected rendering polyline.
  // Check that every oriented source-owned centerline meets its graph nodes
  // and that consecutive real geometry ends meet at the same SEED position.
  // This is a geometric join proof, not a full unsampled traversal verdict.
  let at = y!.code;
  let previousPhysicalEnd: { x: number; z: number } | undefined;
  const samePhysicalPoint = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(wrapSourceX(a.x - b.x), a.z - b.z) <= 1e-4;
  for (const code of chain) {
    const edge = edgeByCode.get(code);
    assert.ok(edge, `walking chain invented a road: ${code}`);
    assert.ok(edge!.from === at || edge!.to === at,
      `walking chain disconnected before ${code}`);
    assert.ok(edge!.centerline.length >= 2, `graph road has no physical polyline: ${code}`);
    const forward = edge!.from === at,
      from = nodeByCode.get(at),
      to = nodeByCode.get(forward ? edge!.to : edge!.from),
      start = edge!.centerline[forward ? 0 : edge!.centerline.length - 1],
      end = edge!.centerline[forward ? edge!.centerline.length - 1 : 0];
    assert.ok(from && to, `missing physical graph node for ${code}`);
    assert.ok(samePhysicalPoint(start, from!), `road ${code} does not start at its actual graph node`);
    assert.ok(samePhysicalPoint(end, to!), `road ${code} does not reach its actual graph node`);
    if (previousPhysicalEnd)
      assert.ok(samePhysicalPoint(previousPhysicalEnd, start),
        `canonical Y-to-site road geometry has a false junction before ${code}`);
    previousPhysicalEnd = end;
    at = to!.code;
  }
  assert.equal(at, site!.code, "chain must terminate at the actual SEED-owned site");
  assert.ok(chain.includes(crossing!.code), "the bridge crossing is a required physical graph leg");
  const access = network.roadEdges.find(edge =>
    edge.roadClass === "access" && edge.from === site!.code);
  assert.ok(access && chain.includes(access.code),
    "critical-site entry must traverse its own recorded access branch");
  // Test both endpoint physical probes in the SAME graph chain: a legal bridge
  // alone does not certify a disconnected site, and a site alone does not
  // certify an impossible river crossing. These are bounded sampled checks,
  // not a claim of unsampled metre-by-metre actor passage.
  const center = transportBridgeSurfaceAt(bridge!.x, bridge!.z, crossing!.code),
    span = transportBridgeSpanAt(bridge!, crossing!);
  assert.ok(sampledBridgeCrossingPass(center.centerDeckWalkable, span),
    "selected canonical Y-to-site chain must traverse sampled legal bridge deck and both banks");
  assert.ok(span.routeStations > 0 && span.routeStations <= 49,
    "source-owned crossing evidence must remain station bounded");
  const parentCode = siteAccessParentRoadCode(access!);
  assert.ok(parentCode && edgeByCode.has(parentCode),
    "site branch must name its actual incident parent road");
  const stations = siteAccessRoadStations(access!),
    surfaces = stations.map(point => finalSurfaceAt(point.x, point.z)),
    siteVerdict = siteAccessSampleVerdict(access!, surfaces, new Set([parentCode!]));
  assert.ok(stations.length > 0 && stations.length <= SITE_ACCESS_STATION_LIMIT,
    "selected critical-site station profile stays bounded");
  assert.ok(siteVerdict.sampledPass,
    `selected site access ${access!.code} (parent ${parentCode}) must remain dry, walkable, source-owned and grade-safe at every sampled station: ${JSON.stringify(siteVerdict)}`);
  const distance = approach!.distanceM + crossing!.surfaceLengthM + continuation!.distanceM,
    fantasySeconds = approach!.fantasyWalkSeconds + crossing!.fantasyWalkSeconds +
      continuation!.fantasyWalkSeconds;
  assert.ok(distance > crossing!.surfaceLengthM && fantasySeconds > crossing!.fantasyWalkSeconds);
  assert.ok(approach!.exploredNodes <= index.nodeCount && continuation!.exploredNodes <= index.nodeCount,
    "canonical road queries must stay graph-bounded");
  assert.deepEqual(transportWalkingRoute(index, y!.code, crossing!.from), approach);
  assert.deepEqual(transportWalkingRoute(index, crossing!.to, site!.code), continuation,
    "repeat queries cannot change seeded road identities or good-road estimates");
  // Graph connectivity only: sampled bank grade, bridge deck and uninterrupted
  // final-surface travel remain separate required acceptance evidence.
});

test("S005 1/20–1/250 view queries never change selected bridge, Y and site route identity", () => {
  const network = siteTransportNetwork, bridge = ensureTransportBridgeEvidence();
  assert.ok(bridge, "seed must expose the selected physical river crossing");
  const owner = network.roadEdges.find(edge => edge.code === bridge!.roadCode);
  assert.ok(owner, "selected crossing must keep its canonical owning graph edge");
  const nodes = new Map(network.nodes.map(node => [node.code, node])),
    selectedY = network.junctions.find(junction =>
      nodes.get(junction.nodeCode)?.continent === nodes.get(owner!.from)?.continent),
    site = network.nodes.find(node =>
      node.kind === "site" && node.countryCode === nodes.get(owner!.from)?.countryCode);
  assert.ok(selectedY && site, "seed-owned shared junction and site must exist on the bridge continent");
  const index = createTransportWalkingIndex(network),
    route = transportWalkingRoute(index, selectedY!.nodeCode, site!.code),
    identity = { digest: network.digest, bridge: bridge!.code,
      road: owner!.code, y: selectedY!.code, site: site!.code, route };
  assert.ok(route?.edgeCodes.length, "selected Y must connect to its critical site through walking roads");
  for (const [denominator, radius, representation] of [
    [20, 128, "ground"], [50, 512, "cartographic"],
    [100, 2048, "cartographic"], [250, 4096, "hidden"],
  ] as const) {
    assert.equal(roadRepresentationAtScale(denominator), representation);
    assert.equal(roadVisibleAtScale(denominator), denominator <= 100);
    const nearby = transportRoadsNear(bridge!.x, bridge!.z, radius, 96);
    assert.ok(nearby.length <= 96, "focus query must remain bounded at every zoom");
    const resolved = transportBridgeByCode(identity.bridge);
    assert.deepEqual(resolved, bridge,
      "lazy bridge recovery must retain identical SEED crossing after focus/LOD changes");
    assert.equal(network.digest, identity.digest);
    assert.equal(network.roadEdges.find(edge => edge.code === identity.road), owner);
    assert.equal(network.junctions.find(junction => junction.code === identity.y), selectedY);
    assert.deepEqual(transportWalkingRoute(index, selectedY!.nodeCode, site!.code), identity.route,
      "zoom or hidden presentation must not recalculate or disconnect a canonical walking route");
  }
  // This tests transport identity and route parity, not the visual pixels at each zoom.
});

test("road-linked harbors and ferries are explicit separate traversal semantics", () => {
  assert.equal(transportNetwork.harbors.length, 3);
  assert.equal(transportNetwork.ferryEdges.length, 2);
  const harborNodes = new Set(transportNetwork.harbors.map((harbor) => harbor.nodeCode));
  for (const harbor of transportNetwork.harbors) {
    const road = transportNetwork.roadEdges.find((edge) => edge.code === harbor.roadCode);
    assert.ok(road && road.roadClass === "main");
    assert.ok(road!.from === harbor.nodeCode || road!.to === harbor.nodeCode);
  }
  for (const ferry of transportNetwork.ferryEdges) {
    assert.ok(harborNodes.has(ferry.from) && harborNodes.has(ferry.to));
    const from = transportNetwork.nodes.find((node) => node.code === ferry.from)!, to = transportNetwork.nodes.find((node) => node.code === ferry.to)!;
    assert.notEqual(from.continent, to.continent);
    assert.ok(ferry.distanceM > 0);
  }
});

test("render roads, route connection legs and transport graph share physical edge identities", () => {
  const roadCodes = new Set(roads.map((road) => road.code)), transportCodes = new Set(transportNetwork.roadEdges.map((edge) => edge.code));
  assert.equal(roadCodes.size, roads.length);
  assert.deepEqual([...transportCodes].sort(), [...roadCodes].sort());
  // Inspector facts must use the same SEED-owned road lengths and fantasy travel estimates.
  const roadByCode = new Map(roads.map((road) => [road.code, road]));
  for (const edge of transportNetwork.roadEdges) {
    const road = roadByCode.get(edge.code)!;
    assert.ok(road, edge.code);
    assert.equal(edge.surfaceLengthM, road.surfaceLengthM, edge.code);
    assert.equal(edge.fantasyWalkSeconds, road.fantasyWalkSeconds, edge.code);
    assert.ok(edge.surfaceLengthM > 0 && edge.fantasyWalkSeconds > 0, edge.code);
  }
  const physicalRoadIds = new Set(roads.map((road) => road.networkId));
  for (const connection of roadConnections) {
    assert.ok(connection.legs.length > 0, `${connection.from} -> ${connection.to} needs physical road legs`);
    for (const leg of connection.legs) assert.ok(physicalRoadIds.has(leg.edgeId), `${leg.edgeId} must be the same physical edge used by rendering`);
  }
  assert.ok(continuityCorridor.road);
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.code === continuityCorridor.road!.code && edge.roadClass === "continuity"));
});

test("shared canonical macro junctions remain true incident graph nodes", () => {
  for (const junction of transportNetwork.junctions) {
    assert.ok(junction.edgeCodes.length >= 3);
    const incident = transportNetwork.roadEdges.filter((edge) => edge.from === junction.nodeCode || edge.to === junction.nodeCode);
    assert.deepEqual(incident.map((edge) => edge.code).sort(), [...junction.edgeCodes].sort());
    for (const edge of incident) {
      const endpoint = edge.from === junction.nodeCode ? edge.centerline[0] : edge.centerline.at(-1)!;
      assert.equal(endpoint.position.lon, junction.position.lon);
      assert.equal(endpoint.position.lat, junction.position.lat);
    }
  }
});

test("same seed rebuilds identical topology while focus queries and bridge caches remain bounded and reusable", () => {
  const rebuilt = buildTransportNetwork();
  assert.equal(rebuilt.digest, transportNetwork.digest);
  assert.deepEqual(
    rebuilt.roadEdges.map((edge) => [edge.code, edge.from, edge.to, edge.centerline.map((point) => [point.x, point.z])]),
    transportNetwork.roadEdges.map((edge) => [edge.code, edge.from, edge.to, edge.centerline.map((point) => [point.x, point.z])]),
  );

  const focus = transportNetwork.nodes.find((node) => node.kind === "village")!, first = transportRoadsNear(focus.x, focus.z, 4_000), second = transportRoadsNear(focus.x, focus.z, 4_000);
  assert.ok(first.length > 0 && first.length <= TRANSPORT_LIMITS.queryRoadLimit);
  assert.deepEqual(first.map((edge) => edge.code), second.map((edge) => edge.code));
  assert.throws(() => transportRoadsNear(focus.x, focus.z, 20_000), RangeError);
  const telemetry = transportGenerationTelemetry();
  assert.ok(telemetry.bridgeCacheRoads <= telemetry.bridgeCacheLimit);
  assert.ok(telemetry.focusQueries >= 2);
  assert.ok(telemetry.extensionRoads <= countries.length + 3);
});
test("S005 road-adjacent bridge-bank tessellation stays bounded and deterministic", () => {
  const bridge = finalSurfaceEvidenceAnchors().bridge;
  const tile = tileForPosition(bridge.x, bridge.z, 14);
  const base = buildTile(tile);
  const originalVertices = base.terrain.positions.length / 3;
  const refined = refineTileSurfacePresentation(tile, base);
  const resolution = refinementResolutionForTile(tile, true, true);
  const addedVertices = refined.terrain.positions.length / 3 - originalVertices;
  // Two refinement levels add at most 16 child quads per original
  // shoreline cell. No planet-sized expansion, new SEED or surface truth.
  assert.ok(addedVertices >= 0 && addedVertices <= resolution ** 2 * 16 * 6,
    "bridge-bank refinement must stay inside finite local geometry bounds");
  assert.equal(refined.terrain.uvs?.length, refined.terrain.positions.length / 3 * 2,
    "additional triangles must retain the same canonical projection UVs");
  const second = refineTileSurfacePresentation(tile, buildTile(tile));
  assert.deepEqual(refined.terrain.positions, second.terrain.positions,
    "the same canonical bank must reproduce identical vertices after regeneration");
});

test("S005 actual natural riverbank mesh is bounded and repeatable at selected road bridge", () => {
  const p = finalSurfaceEvidenceAnchors().bridge,
    tile = tileForPosition(p.x, p.z, 12),
    base = buildTile(tile).terrain,
    a = rebuildNaturalSurface(tile, base),
    b = rebuildNaturalSurface(tile, base);
  assert.ok(a.replaced && b.replaced,
    "the bridge bank uses the natural replacement mesh, not the skipped coarse-ground refinement");
  assert.ok(a.leaves > 0 && a.leaves <= NATURAL_MESH_LIMITS.leaves);
  assert.ok(a.samples <= NATURAL_MESH_LIMITS.samples);
  assert.ok(a.cpuScratchBytesEstimated <= 32 * 1024 * 1024);
  assert.equal(a.leaves, b.leaves);
  assert.equal(a.samples, b.samples);
  assert.deepEqual(a.geometry.positions, b.geometry.positions,
    "same SEED bridge bank must regenerate identical presentation geometry");
});


test("S005 bridge-bank approach ribbon never paints unowned water and stays deterministic", () => {
  const bridge = finalSurfaceEvidenceAnchors().bridge,
    tile = tileForPosition(bridge.x, bridge.z, 12),
    firstBase = buildTile(tile),
    baseVertices = firstBase.terrain.positions.length / 3,
    first = refineTileSurfacePresentation(tile, firstBase, true).terrain,
    second = refineTileSurfacePresentation(tile, buildTile(tile), true).terrain;
  const added = first.positions.length / 3 - baseVertices;
  assert.ok(added > 0 && added < 12000, "selected bank adds bounded physical-road geometry");
  assert.deepEqual(first.positions, second.positions,
    "same SEED road landing regenerates precisely the same visible geometry");
  assert.deepEqual(first.colors, second.colors);
  for (let i = baseVertices; i < first.positions.length / 3; i++) {
    if (first.colors[i * 4 + 3] !== 255) continue;
    const x = first.positions[i * 3] + tile.minX + tile.size / 2,
      z = first.positions[i * 3 + 2] + tile.minZ + tile.size / 2,
      surface = finalSurfaceAt(x, z);
    assert.ok(surface.water.kind === "none" && surface.walkable &&
      surface.groundMaterial === "Road" && surface.contributingModifierIds.length > 0,
    "bank apron ground vertex must be dry and canonical road-owned");
  }
});
