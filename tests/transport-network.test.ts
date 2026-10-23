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
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { roadFragmentsInBounds } from "../src/continuity-corridor.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_WIDTH, greatCircleDistance, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { polylineTouchesViewport } from "../src/transport-viewport.ts";
import { roadRepresentationAtScale, roadVisibleAtScale } from "../src/surface-presentation.ts";
import { sampledBridgeCrossingPass, sampledBridgeTopFailure, selectedRoadBridgeDeckWalkable, transportRoadIntervalGradeEvidence, transportBridgeSpanAt, transportBridgeSurfaceAt, transportBankApproachGrade, transportRoadArcStations, transportRoadBankApproaches, transportRoadWetStations } from "../src/transport-bridge-surface.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt } from "../src/world-core.ts";
import { createTransportJunctionLookup } from "../src/transport-junction-index.ts";
import { createSiteRouteTimings, SITE_ROUTE_MEASURED_SCALES, SITE_ROUTE_TIMING_LIMIT } from "../src/transport-answer-timings.ts";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { criticalSites } from "../src/sites.ts";
import { createTransportWalkingIndex, nearestWalkingRoadEndpoint, selectedWalkingPreviewOrigin, selectedBridgePreviewDestinationBank, transportWalkingDetourAfterUnsafeRoad, transportWalkingRoute, transportWalkingRouteThroughEdge, transportWalkingRouteViaRequiredEdge, transportWalkingRequiredBridgeCut, transportWalkingRouteToNearest, visibleWalkingPreviewEdgeCodes } from "../src/transport-walking-route.ts";
import { SITE_ACCESS_STATION_LIMIT, roadEndpointMeetsTerminal, siteAccessBranchOnRoute, siteAccessParentRoadCode, siteAccessRoadStations, siteAccessSampleVerdict } from "../src/transport-site-access.ts";
import { planTransportRouteCorridor, planTransportRouteCorridorByLeg, ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT, ROUTE_CORRIDOR_STATION_LIMIT, TRANSPORT_PROBE_FRAME_BUDGET_MS, corridorUnsafeRoadExclusion, sampledCorridorStationFailure, sampledCorridorStationPass, transportProbeFrameBudgetReached } from "../src/transport-route-corridor.ts";
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
  const parentRoad = network.roadEdges.find(edge => edge.code === crossing!.roadCode)!,
    oppositeCamera = parentRoad.centerline.at(-1)!.position,
    borderOrigin = nearestWalkingRoadEndpoint(parentRoad, nodes, crossing!.position);
  assert.ok(borderOrigin, "a selected border must resolve a legal crossing bank");
  for (const camera of [parentRoad.centerline[0].position, oppositeCamera, focus])
    assert.equal(selectedWalkingPreviewOrigin(
      { kind: "border", code: crossing!.code }, camera, network, nodes, unrelated,
    )?.code, borderOrigin.code, "panning cannot flip the selected SEED border's starting bank");
  const selectedBridge = {
    code: "SELECTED/BRIDGE/1", roadCode: parentRoad.code, position: parentRoad.centerline[0].position,
  };
  for (const camera of [parentRoad.centerline[0].position, oppositeCamera, focus]) {
    const start = selectedWalkingPreviewOrigin(
      { kind: "bridge", code: selectedBridge.code }, camera,
      network, nodes, unrelated, selectedBridge,
    );
    assert.equal(start?.code, parentRoad.from,
      "a selected bridge must start from its SEED-owned bank, not the panned camera");
  }
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "bridge", code: selectedBridge.code }, focus, network, nodes, unrelated,
  ), undefined, "missing physical bridge owner fails closed");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "bridge", code: "OTHER/BRIDGE" }, focus, network, nodes, unrelated, selectedBridge,
  ), undefined, "a different crossing cannot borrow the selected bridge anchor");
  assert.equal(selectedWalkingPreviewOrigin(
    undefined, focus, network, nodes, unrelated,
  )?.code, nearestWalkingRoadEndpoint(unrelated, nodes, focus)?.code,
  "unselected preview preserves the nearest-road fallback");
});

test("S005 explicit canonical road can answer walking graph before renderer/map focus exists", () => {
  const network = siteTransportNetwork,
    index = createTransportWalkingIndex(network),
    nodes = new Map(network.nodes.map(node => [node.code, node])),
    branch = network.roadEdges.find(edge => edge.roadClass === "access" &&
      edge.from.includes("/NODE/SITE/"))!;
  assert.ok(branch, "a SEED-owned site access branch supplies renderer-independent graph evidence");
  const focus = branch.centerline[Math.floor(branch.centerline.length / 2)].position;
  // This is the selected item's canonical point, NOT a camera state.
  const from = selectedWalkingPreviewOrigin(
    { kind: "road", code: branch.code }, focus, network, nodes,
  );
  assert.ok(from && (from.code === branch.from || from.code === branch.to));
  const destination = from!.code === branch.from ? branch.to : branch.from;
  const route = transportWalkingRoute(index, from!.code, destination);
  assert.deepEqual(route?.edgeCodes, [branch.code],
    "selected SEED route distance/Fantasy-Time can resolve without WebGPU/WebGL2 or a camera");
  assert.equal(route!.distanceM, branch.surfaceLengthM);
  assert.equal(route!.fantasyWalkSeconds, branch.fantasyWalkSeconds);
  assert.equal(selectedWalkingPreviewOrigin(undefined, focus, network, nodes), undefined,
    "without a renderer map focus, an unselected route cannot invent a nearest road");
  assert.equal(selectedWalkingPreviewOrigin(
    { kind: "road", code: "NONEXISTENT" }, focus, network, nodes,
  ), undefined, "an invalid selected source does not borrow another road");
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

test("S005 bank approach measures true geodesic grade on the traversed bridge-deck surface", () => {
  const bank = (heights: readonly number[], groundAtNearBank: number) =>
    heights.map((surfaceHeight, index) => ({
      surfaceHeight,
      groundHeight: index === 0 ? groundAtNearBank : surfaceHeight,
    }));
  const positions = (metres: readonly number[]) =>
    metres.map(metres => ({ x: 0, z: metres / CANONICAL_METRES_PER_SOURCE_UNIT }));
  const actualStations = [positions([0, 4, 8, 12, 16]), positions([40, 44, 48, 52, 56])],
    left = bank([10, 10.2, 10.4, 10.6, 10.8], 4),
    right = bank([10.8, 10.6, 10.4, 10.2, 10], 3),
    measured = transportBankApproachGrade([left, right], actualStations);
  assert.ok(measured !== null && Math.abs(measured - .05) < 1e-8,
    "a dry-bank bridge deck grades from its walkable top over measured 4m, never bare earth underneath");
  assert.ok(transportBankApproachGrade([left, bank([10.8, 10.6, 10.4, 9.4, 9.2], 3)], actualStations)! > .08,
    "steep actual deck-to-ground transitions must still fail the eight-percent limit");
  const shorterBank = bank([10, 10.27, 10.54, 10.81, 11.08], 4),
    shorterStations = [positions([0, 3, 6, 9, 12]), actualStations[1]];
  assert.ok(transportBankApproachGrade([shorterBank, right], shorterStations)! > .08,
    "a physical 3m step rising 0.27m is 9%, not a falsely accepted nominal-4m 6.75%");
  assert.equal(transportBankApproachGrade([left, right.slice(1)], actualStations), null,
    "missing road surface stations cannot certify a bank");
  assert.equal(transportBankApproachGrade([left, right], [actualStations[0].slice(1), actualStations[1]]), null,
    "missing physical positions cannot certify a bank");
  assert.equal(transportBankApproachGrade([left, right], [actualStations[0].map(p => actualStations[0][0]), actualStations[1]]), null,
    "a zero-distance physical step cannot certify a bank");
});

test("S005 route previews fail closed when finite edge costs overflow their accumulated path", () => {
  const network = (firstDistance: number, secondDistance: number, firstTime: number, secondTime: number) =>
    ({
      nodes: ["start", "bank", "site"].map(code => ({ code })),
      roadEdges: [
        { code: "selected-bridge-road", from: "start", to: "bank",
          surfaceLengthM: firstDistance, fantasyWalkSeconds: firstTime },
        { code: "site-road", from: "bank", to: "site",
          surfaceLengthM: secondDistance, fantasyWalkSeconds: secondTime },
      ],
    }) as unknown as TransportNetwork;
  for (const unsafe of [network(1e308, 1e308, 1, 1), network(1, 1, 1e308, 1e308)]) {
    const graph = createTransportWalkingIndex(unsafe);
    assert.equal(transportWalkingRoute(graph, "start", "site"), null,
      "overflow cannot become a numeric walking distance or Fantasy-Time");
    assert.equal(transportWalkingRouteToNearest(graph, "start", ["site"]), null,
      "first-route preview must never report infinite canonical facts");
    assert.equal(transportWalkingRouteThroughEdge(graph, "start", unsafe.roadEdges[0], ["site"]), null,
      "a selected bridge cannot combine finite legs into an infinite route");
  }
  const valid = network(12, 18, 40, 60);
  const graph = createTransportWalkingIndex(valid);
  assert.deepEqual(transportWalkingRoute(graph, "start", "site"), {
    from: "start", to: "site", edgeCodes: ["selected-bridge-road", "site-road"],
    distanceM: 30, fantasyWalkSeconds: 100, exploredNodes: 3,
  }, "ordinary seeded graph answers remain unchanged");
  assert.equal(transportWalkingRouteThroughEdge(graph, "start", valid.roadEdges[0], ["site"])?.distanceM, 30);
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
  assert.strictEqual(transportWalkingRouteToNearest(index, "start", [...sites].reverse()), route,
    "repeated cross-scale selections reuse one immutable route despite destination ordering");
  assert.strictEqual(transportWalkingRouteToNearest(index, "start",
    ["far-by-map", "far-by-map", "long-by-road", "near-but-disconnected"]), route,
    "duplicate target codes cannot invalidate canonical preview reuse");
  assert.equal(transportWalkingRouteToNearest(index, "start", ["near-but-disconnected"]), null);
  assert.equal(transportWalkingRoute(index, "start", "near-but-disconnected"), null);
});

test("S005 preview cache is finite and never reuses a different canonical endpoint", () => {
  const roadEdges = Array.from({ length: 14 }, (_, i) => ({
    code: `edge-${i}`, from: "origin", to: `site-${i}`,
    surfaceLengthM: i + 1, fantasyWalkSeconds: (i + 1) * 10,
  }));
  const index = createTransportWalkingIndex({
    nodes: ["origin", ...roadEdges.map(edge => edge.to)].map(code => ({ code })),
    roadEdges,
  } as unknown as TransportNetwork);
  const first = transportWalkingRoute(index, "origin", "site-0");
  assert.ok(first);
  assert.strictEqual(transportWalkingRoute(index, "origin", "site-0"), first,
    "the second same-SEED query returns its cached immutable graph answer");
  for (let i = 1; i < 14; i++) {
    const route = transportWalkingRoute(index, "origin", `site-${i}`);
    assert.equal(route?.to, `site-${i}`, "different endpoints never alias cached answers");
  }
  const rebuilt = transportWalkingRoute(index, "origin", "site-0");
  assert.deepEqual(rebuilt, first, "eviction changes no deterministic route facts");
  assert.notStrictEqual(rebuilt, first, "the oldest result was evicted from the 12-entry cache");
  assert.strictEqual(transportWalkingRoute(index, "origin", "site-0"), rebuilt,
    "recently revisited routes are reused again without graph search");
});

test("S005 walking previews reject duplicated canonical node identity", () => {
  const duplicated = {
    nodes: [
      { code: "A", x: 0, z: 0 },
      { code: "B", x: 1, z: 0 },
      { code: "B", x: 99, z: 0 },
    ],
    roadEdges: [{ code: "SEED/ROAD", from: "A", to: "B", surfaceLengthM: 10, fantasyWalkSeconds: 20 }],
  } as unknown as TransportNetwork;
  assert.throws(() => createTransportWalkingIndex(duplicated),
    /Duplicate canonical walking node B/,
    "distinct physical graph positions cannot silently share a walking identity");
  const unique = { ...duplicated, nodes: duplicated.nodes.map((node, index) =>
    index === 2 ? { ...node, code: "C" } : node) } as TransportNetwork;
  const index = createTransportWalkingIndex(unique);
  assert.equal(index.nodeCount, 3);
  assert.ok(transportWalkingRoute(index, "A", "B"), "unique nodes preserve legal routes");
});

test("S005 walking previews reject ambiguous duplicate physical road identity", () => {
  const duplicated = {
    nodes: ["A", "B", "C"].map(code => ({ code })),
    roadEdges: [
      { code: "SEED/DUPLICATE", from: "A", to: "B", surfaceLengthM: 12, fantasyWalkSeconds: 25 },
      { code: "SEED/DUPLICATE", from: "B", to: "C", surfaceLengthM: 14, fantasyWalkSeconds: 30 },
    ],
  } as unknown as TransportNetwork;
  assert.throws(() => createTransportWalkingIndex(duplicated),
    /Duplicate canonical walking edge SEED\/DUPLICATE/,
    "duplicate canonical codes cannot resolve two different physical road centerlines");
  assert.ok(createTransportWalkingIndex({
    ...duplicated, roadEdges: duplicated.roadEdges.map((edge, index) =>
      ({ ...edge, code: `SEED/EDGE/${index}` })),
  } as TransportNetwork), "uniquely owned roads remain valid preview input");
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
  assert.ok(transportWalkingRoute(index, "bank-b", "near-site"),
    "ordinary walking graph searches may legitimately reach the opposite bank");
  assert.equal(transportWalkingRouteThroughEdge(index, "bank-a", selected, ["near-site"]), null,
    "bridge-selected preview may not cross then loop by a different road to its starting bank");
  assert.equal(transportWalkingRouteThroughEdge(index, "bank-b", selected, ["far-site"]), null,
    "reverse bridge selection also refuses return-bank cycles");
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

test("S005 unsafe canonical roads can be excluded without inventing a physically certified detour", () => {
  const network = {
    nodes: ["A", "B", "C", "SITE"].map(code => ({ code })),
    roadEdges: [
      { code: "short", from: "A", to: "B", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "unsafe", from: "B", to: "SITE", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "detour-a", from: "A", to: "C", surfaceLengthM: 4, fantasyWalkSeconds: 40 },
      { code: "detour-b", from: "C", to: "SITE", surfaceLengthM: 3, fantasyWalkSeconds: 30 },
      { code: "bridge", from: "B", to: "C", surfaceLengthM: 2, fantasyWalkSeconds: 20 },
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network);
  const original = transportWalkingRoute(index, "A", "SITE");
  assert.deepEqual(original?.edgeCodes, ["short", "unsafe"]);
  const excluded = new Set(["unsafe"]);
  const alternate = transportWalkingRoute(index, "A", "SITE", excluded);
  assert.deepEqual(alternate?.edgeCodes, ["short", "bridge", "detour-b"]);
  assert.equal(alternate?.distanceM, 6);
  assert.equal(alternate?.fantasyWalkSeconds, 60);
  assert.strictEqual(transportWalkingRoute(index, "A", "SITE", new Set(["unsafe"])), alternate,
    "normalized canonical exclusions reuse the bounded per-index cache");
  assert.strictEqual(transportWalkingRoute(index, "A", "SITE"), original,
    "a physically unsafe exclusion must not poison ordinary preview cache entries");
  assert.deepEqual(transportWalkingRoute(index, "A", "SITE",
    new Set(["bridge", "unsafe"]))?.edgeCodes, ["detour-a", "detour-b"],
    "two excluded roads cannot return through a shared junction as a fake shortcut");
  assert.equal(transportWalkingRoute(index, "A", "SITE",
    new Set(["unsafe", "bridge", "detour-a"])), null,
    "no source-owned graph detour is UNAVAILABLE, not a fabricated walk");
  assert.deepEqual(transportWalkingRouteToNearest(index, "A", ["SITE"],
    new Set(["unsafe"]))?.edgeCodes, alternate?.edgeCodes);
  const selectedBridge = network.roadEdges.find(edge => edge.code === "bridge")!;
  assert.deepEqual(transportWalkingRouteThroughEdge(index, "B", selectedBridge,
    ["SITE"], new Set(["unsafe"]))?.edgeCodes, ["bridge", "detour-b"],
    "selected bridge is still a required real road even when avoiding a different unsafe one");
  assert.equal(transportWalkingRouteThroughEdge(index, "B", selectedBridge,
    ["SITE"], new Set(["bridge"])), null,
    "a required bridge cannot be physically accepted after its own road was excluded");
  assert.equal(transportWalkingRoute(index, "A", "SITE",
    new Set(Array.from({ length: 13 }, (_item, i) => `unsafe-${i}`))), null,
    "unbounded caller-supplied exclusion sets must fail closed before a graph search");
  assert.ok((alternate?.exploredNodes ?? Infinity) <= index.nodeCount,
    "an alternative remains one finite Dijkstra graph preview, not a physical PASS");
});

test("S005 bounded gate-to-site candidate retains the required bridge without unsafe road retracing", () => {
  const network = {
    nodes: ["G", "Y", "L", "R", "S"].map(code => ({ code })),
    roadEdges: [
      { code: "gate", from: "G", to: "Y", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "unsafe", from: "Y", to: "L", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "safe", from: "G", to: "L", surfaceLengthM: 7, fantasyWalkSeconds: 70 },
      { code: "bridge", from: "L", to: "R", surfaceLengthM: 2, fantasyWalkSeconds: 20 },
      { code: "site", from: "R", to: "S", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
      { code: "bypass", from: "G", to: "S", surfaceLengthM: 1, fantasyWalkSeconds: 10 },
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network), bridge = network.roadEdges[3];
  assert.deepEqual(transportWalkingRoute(index, "G", "S")?.edgeCodes, ["bypass"],
    "ordinary shortest graph route may bypass the required owned bridge");
  assert.deepEqual(transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge)?.edgeCodes,
    ["gate", "unsafe", "bridge", "site"],
    "without safety evidence the cheaper constrained graph route can still contain unsafe road");
  const exclusions = new Set(["unsafe"]);
  const retained = transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge, exclusions);
  assert.deepEqual(retained?.edgeCodes, ["safe", "bridge", "site"],
    "unsafe-road exclusion must still cross the exact requested bridge once");
  assert.equal(retained?.distanceM, 10);
  assert.equal(retained?.fantasyWalkSeconds, 100);
  assert.ok((retained?.exploredNodes ?? Infinity) <= 4096);
  assert.deepEqual(transportWalkingDetourAfterUnsafeRoad(index, "G", "S", "unsafe")?.edgeCodes,
    ["bypass"], "ordinary shortest fallback may avoid the selected bridge");
  assert.deepEqual(transportWalkingDetourAfterUnsafeRoad(index, "G", "S", "unsafe", bridge)?.edgeCodes,
    ["safe", "bridge", "site"],
    "on-demand fallback for a selected bridge must preserve that exact crossing once");
  assert.equal(transportWalkingDetourAfterUnsafeRoad(index, "G", "S", "bridge", bridge), null,
    "a physically unsafe required bridge cannot be relabeled as a legal detour");
  assert.equal(transportWalkingDetourAfterUnsafeRoad(index, "G", "S", "unsafe",
    { ...bridge, code: "invented" }), null, "no invented required bridge can satisfy a fallback");
  assert.deepEqual(transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge,
    new Set(["unsafe"])), retained, "graph candidate is stable across repeated immutable exclusions");
  assert.deepEqual([...exclusions], ["unsafe"], "search must never mutate caller exclusions");
  assert.equal(transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge,
    new Set(["bridge"])), null, "excluded mandatory bridge must fail closed");
  assert.equal(transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge,
    new Set(["unsafe", "safe"])), null, "no accepted non-retracing required bridge candidate");
  assert.equal(transportWalkingRouteViaRequiredEdge(index, "G", "S",
    { ...bridge, code: "fabricated" }), null, "invented bridge identity is not accepted");
  assert.equal(transportWalkingRouteViaRequiredEdge(index, "G", "S", bridge,
    new Set(Array.from({ length: 13 }, (_, i) => `unsafe-${i}`))), null,
    "bridge-constrained attempts preserve existing finite exclusion budget");
});

test("S005 required bridge searches longer simple approaches if the shortest prefix blocks the far bank", () => {
  const edge = (code: string, from: string, to: string, metres: number) => ({
    code, from, to, surfaceLengthM: metres, fantasyWalkSeconds: metres * 10,
  });
  // The two shortest prefixes overlap the only useful far-bank continuation.
  // A longer G→X→N prefix enables the non-retracing N→F→R→Q→P→S route.
  const network = {
    nodes: ["G", "P", "Q", "N", "F", "R", "S", "X"].map(code => ({ code })),
    roadEdges: [
      edge("a", "G", "P", 1), edge("b", "P", "Q", 1),
      edge("c", "Q", "N", 1), edge("d", "G", "X", 5),
      edge("e", "X", "N", 5), edge("required", "N", "F", 1),
      edge("f", "F", "R", 1), edge("g", "R", "Q", 1),
      edge("h", "P", "S", 1),
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network), required = network.roadEdges[5];
  const route = transportWalkingRouteViaRequiredEdge(index, "G", "S", required);
  assert.deepEqual(route?.edgeCodes, ["d", "e", "required", "f", "g", "b", "h"],
    "a bounded simple-path search must find the longer canonical prefix rather than repeatedly tracing the shortest");
  assert.equal(route?.distanceM, 15);
  assert.equal(route?.fantasyWalkSeconds, 150);
  assert.ok((route?.exploredNodes ?? Infinity) <= 4096);
  assert.deepEqual(transportWalkingRouteViaRequiredEdge(index, "G", "S", required)?.edgeCodes,
    route?.edgeCodes, "candidate remains deterministic across identical queries");
  assert.equal(transportWalkingRouteViaRequiredEdge(index, "G", "S", required,
    new Set(["e"])), null, "known unsafe approach must never sneak into a bridge candidate");
  // A detour exceeding the bounded on-demand 12-road physical corridor must
  // refuse instead of claiming a complete, uninspectable graph candidate.
  const long = {
    nodes: Array.from({ length: 15 }, (_, i) => ({ code: `N${i}` })),
    roadEdges: Array.from({ length: 14 }, (_, i) =>
      edge(`R${i}`, `N${i}`, `N${i + 1}`, 1)),
  } as unknown as TransportNetwork;
  assert.equal(transportWalkingRouteViaRequiredEdge(createTransportWalkingIndex(long),
    "N0", "N14", long.roadEdges[7]), null,
  "13+ road journeys cannot bypass the bounded physical corridor's 12-road ceiling");
});

test("S005 required bridge exclusion yields definitive cuts or only necessary reachability", () => {
  const edge = (code: string, from: string, to: string) => ({
    code, from, to, surfaceLengthM: 1, fantasyWalkSeconds: 1,
  });
  const network = {
    nodes: ["G", "L", "R", "S", "X"].map(code => ({ code })),
    roadEdges: [
      edge("unsafe", "G", "L"),
      edge("bridge", "L", "R"),
      edge("site", "R", "S"),
      edge("bypass", "G", "S"),
      edge("detour-a", "G", "X"),
      edge("detour-b", "X", "L"),
    ],
  } as unknown as TransportNetwork;
  const index = createTransportWalkingIndex(network), bridge = network.roadEdges[1];
  const original = transportWalkingRequiredBridgeCut(index, "G", "S", bridge);
  assert.equal(original.status, "not-proven",
    "reachable banks are a necessary condition, not proof of a simple physical crossing");
  assert.equal(original.orientation, "both",
    "a bypass joining the other bank does not invent a physical traversal");
  const alternate = transportWalkingRequiredBridgeCut(index, "G", "S", bridge, new Set(["unsafe"]));
  assert.equal(alternate.status, "not-proven",
    "an actual alternative approach must not be declared disconnected");
  assert.ok(alternate.exploredNodes <= index.nodeCount);
  const excluded = new Set(["unsafe", "detour-b"]);
  const cut = transportWalkingRequiredBridgeCut(index, "G", "S", bridge, excluded);
  assert.deepEqual({ status: cut.status, orientation: cut.orientation },
    { status: "graph-cut", orientation: "none" },
    "no gate-side access to one bridge bank proves impossibility with these exclusions");
  assert.ok(cut.exploredNodes <= index.nodeCount);
  assert.deepEqual([...excluded], ["unsafe", "detour-b"],
    "graph proof cannot mutate caller exclusions");
  assert.deepEqual(transportWalkingRequiredBridgeCut(index, "G", "S", bridge, excluded), cut,
    "component proof is deterministic across repeated calls");
  assert.equal(transportWalkingRequiredBridgeCut(index, "G", "S", bridge, new Set(["bridge"])).status,
    "invalid", "excluded mandatory bridge cannot be valid evidence");
  assert.equal(transportWalkingRequiredBridgeCut(index, "G", "S",
    { ...bridge, code: "invented" }).status, "invalid");
  assert.equal(transportWalkingRequiredBridgeCut(index, "G", "S", bridge,
    new Set(Array.from({ length: 13 }, (_, i) => `blocked-${i}`))).status,
    "invalid", "proof uses the existing bounded unsafe-road set");
});

test("S005 selected border bridge previews the far-bank country's site rather than retracing the crossing", () => {
  const bankA = { code: "bank-a", countryCode: "A", continent: 0 } as TransportNode,
    bankB = { code: "bank-b", countryCode: "B", continent: 0 } as TransportNode,
    siteA = { code: "site-a", countryCode: "A", continent: 0 } as TransportNode,
    siteB = { code: "site-b", countryCode: "B", continent: 0 } as TransportNode,
    nodes = new Map([bankA, bankB, siteA, siteB].map(node => [node.code, node])),
    network = {
      nodes: [...nodes.values()],
      roadEdges: [
        { code: "bridge", from: bankA.code, to: bankB.code, surfaceLengthM: 10, fantasyWalkSeconds: 100 },
        { code: "bank-a-access", from: bankA.code, to: siteA.code, surfaceLengthM: 1, fantasyWalkSeconds: 10 },
        { code: "bank-b-access", from: bankB.code, to: siteB.code, surfaceLengthM: 2, fantasyWalkSeconds: 20 },
      ],
    } as TransportNetwork,
    index = createTransportWalkingIndex(network),
    bridge = network.roadEdges[0];
  const forwardBank = selectedBridgePreviewDestinationBank(bankA, bridge, nodes);
  assert.equal(forwardBank?.countryCode, "B");
  const forwardSites = [...nodes.values()].filter(node =>
    node.code.startsWith("site-") && node.countryCode === forwardBank?.countryCode).map(node => node.code);
  assert.deepEqual(transportWalkingRouteThroughEdge(index, bankA.code, bridge, forwardSites)?.edgeCodes,
    ["bridge", "bank-b-access"], "route must end on far bank without retracing selected bridge");
  const reverseBank = selectedBridgePreviewDestinationBank(bankB, bridge, nodes);
  assert.equal(reverseBank?.countryCode, "A");
  const reverseSites = [...nodes.values()].filter(node =>
    node.code.startsWith("site-") && node.countryCode === reverseBank?.countryCode).map(node => node.code);
  assert.deepEqual(transportWalkingRouteThroughEdge(index, bankB.code, bridge, reverseSites)?.edgeCodes,
    ["bridge", "bank-a-access"]);
  assert.equal(selectedBridgePreviewDestinationBank(siteA, bridge, nodes), undefined,
    "an unrelated graph node cannot invent a far bank");
  assert.equal(selectedBridgePreviewDestinationBank(bankA, bridge, new Map([[bankA.code, bankA]])), undefined,
    "an absent canonical far-bank node cannot support a site preview");
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
  // Duplicate consecutive source vertices are zero travel, not zero-distance
  // grade samples. Preserve the exact road ownership, stations and Y join.
  const repeatedA = { ...a, centerline: [
    { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 0 },
  ] } as TransportRoadEdge;
  const repeatedB = { ...b, centerline: [
    { x: 3, z: 0 }, { x: 3, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 0 },
  ] } as TransportRoadEdge;
  const repeatedRoads = new Map([repeatedA, repeatedB].map(edge => [edge.code, edge]));
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] }, repeatedRoads, nodes,
  ), result, "redundant source points cannot create false infinite grade at the junction");
  const nearDuplicateA = { ...a, centerline: [
    { x: 0, z: 0 }, { x: 1e-8, z: 0 }, { x: 3, z: 0 },
    { x: 3 + 1e-8, z: 0 }, { x: 3, z: 0 },
  ] } as TransportRoadEdge;
  const nearDuplicateB = { ...b, centerline: [
    { x: 3, z: 0 }, { x: 3 + 1e-8, z: 0 }, { x: 5, z: 0 },
  ] } as TransportRoadEdge;
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] },
    new Map([nearDuplicateA, nearDuplicateB].map(edge => [edge.code, edge])),
    nodes,
  ), result, "sub-millimetre duplicate vertices must not invent near-zero walking intervals or false local grade");
  // Each raw step is tiny, but their cumulative displacement is not. Comparing
  // only adjacent raw vertices used to drop the real bend and reject the same
  // physical road when walked in reverse (its last retained point missed A).
  const accumulated = { ...a, centerline: [
    { x: 0, z: 0 }, { x: 0.00006, z: 0 }, { x: 0.00012, z: 0 },
    { x: 0.00018, z: 0 }, { x: 3, z: 0 },
  ] } as TransportRoadEdge;
  const accumulatedRoads = new Map([[accumulated.code, accumulated]]);
  const forwardAccumulated = planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [accumulated.code] },
    accumulatedRoads, nodes,
  );
  assert.equal(forwardAccumulated.status, "ready");
  assert.ok(forwardAccumulated.stations.some(station => station.x > 0 && station.x < 0.001),
    "cumulative micro-offsets cannot erase a real intermediate canonical source waypoint");
  const reverseAccumulated = planTransportRouteCorridor(
    { from: "B", to: "A", edgeCodes: [accumulated.code] },
    accumulatedRoads, nodes,
  );
  assert.equal(reverseAccumulated.status, "ready",
    "reversing a SEED-owned path cannot fail because cumulative tiny waypoint offsets were skipped");
  assert.ok(Math.abs(reverseAccumulated.stations.at(-1)!.x) <= 1e-7,
    "wrapped floating-point source coordinates must terminate within canonical A endpoint precision");
  const collapsed = { ...a, centerline: [{ x: 0, z: 0 }, { x: 0, z: 0 }] } as TransportRoadEdge;
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [collapsed.code] },
    new Map([[collapsed.code, collapsed]]),
    new Map([["A", { x: 0, z: 0 }], ["B", { x: 0, z: 0 }]]),
  ).status, "invalid", "an entirely stationary source road must not certify physical passage");
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
  // Diagonal roads must obey Euclidean source-space spacing, not just an
  // axis-aligned bound that leaves >1-unit gaps between surface samples.
  const diagonal = { ...makeEdge("diagonal", "A", "D", 0, 3),
    centerline: [{ x: 0, z: 0 }, { x: 3, z: 4 }],
  } as TransportRoadEdge;
  const diagonalPlan = planTransportRouteCorridor(
    { from: "A", to: "D", edgeCodes: [diagonal.code] },
    new Map([[diagonal.code, diagonal]]),
    new Map([["A", { x: 0, z: 0 }], ["D", { x: 3, z: 4 }]]),
  );
  assert.equal(diagonalPlan.status, "ready");
  assert.equal(diagonalPlan.stations.length, 6,
    "a 3/4/5 diagonal needs five <=1 source-unit steps, not four axis-only steps");
  for (let index = 1; index < diagonalPlan.stations.length; index++) {
    const previous = diagonalPlan.stations[index - 1], current = diagonalPlan.stations[index];
    assert.ok(Math.hypot(current.x - previous.x, current.z - previous.z) <= 1 + 1e-7,
      "successive on-demand stations may never exceed one source unit");
  }
  const oversizedDiagonal = { ...makeEdge("large-diagonal", "A", "D", 0, 2900),
    centerline: [{ x: 0, z: 0 }, { x: 2900, z: 2900 }],
  } as TransportRoadEdge;
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "D", edgeCodes: [oversizedDiagonal.code] },
    new Map([[oversizedDiagonal.code, oversizedDiagonal]]),
    new Map([["A", { x: 0, z: 0 }], ["D", { x: 2900, z: 2900 }]]),
  ).status, "over-budget", "diagonal distance must count toward the same 4096-station cap");
  const huge = makeEdge("huge", "A", "C", 0, ROUTE_CORRIDOR_STATION_LIMIT + 1);
  const over = planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [huge.code] }, new Map([[huge.code, huge]]),
    new Map([["A", { x: 0, z: 0 }], ["C", { x: ROUTE_CORRIDOR_STATION_LIMIT + 1, z: 0 }]]));
  assert.deepEqual(over, { status: "over-budget", reason: "sample-stations",
    edgeCode: huge.code, stations: [] },
    "oversized physical arc must report the station limit and owning road");
  assert.equal(over.stations.length, 0,
    "oversized diagnostic must reject the route without truncating it into a false positive");
  // A large first road must never hide invalid later SEED endpoint joins or
  // a path aimed at the wrong site: both are cheap source-only preflight facts.
  const longFirst = makeEdge("long-first", "A", "L", 0, ROUTE_CORRIDOR_STATION_LIMIT + 1),
    detachedTail = makeEdge("detached-tail", "L", "Z",
      ROUTE_CORRIDOR_STATION_LIMIT + 2, ROUTE_CORRIDOR_STATION_LIMIT + 3),
    connectedTail = makeEdge("connected-tail", "L", "Z",
      ROUTE_CORRIDOR_STATION_LIMIT + 1, ROUTE_CORRIDOR_STATION_LIMIT + 3),
    longNodes = new Map([
      ["A", { x: 0, z: 0 }],
      ["L", { x: ROUTE_CORRIDOR_STATION_LIMIT + 1, z: 0 }],
      ["Z", { x: ROUTE_CORRIDOR_STATION_LIMIT + 3, z: 0 }],
    ]);
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "Z", edgeCodes: [longFirst.code, detachedTail.code] },
    new Map([longFirst, detachedTail].map(edge => [edge.code, edge])), longNodes,
  ), { status: "invalid", reason: "source-chain", edgeCode: detachedTail.code, stations: [] },
  "oversized first road must name the detached later source edge before refusing the route");
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "A", edgeCodes: [longFirst.code, connectedTail.code] },
    new Map([longFirst, connectedTail].map(edge => [edge.code, edge])), longNodes,
  ), { status: "invalid", reason: "source-chain", edgeCode: connectedTail.code, stations: [] },
  "an oversized valid source chain ending at the wrong site must name its terminal road");
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "Z", edgeCodes: [longFirst.code, connectedTail.code] },
    new Map([longFirst, connectedTail].map(edge => [edge.code, edge])), longNodes,
  ), { status: "over-budget", reason: "sample-stations",
    edgeCode: longFirst.code, stations: [] },
  "valid source endpoints keep the unchanged fixed 4096-station physical refusal");
  // Thousands of repeated raw SEED points can collapse to two sampled
  // stations. The raw input must also have a finite cumulative planning cap.
  const rawOverflow = { ...a, centerline: [
    { x: 0, z: 0 },
    ...Array.from({ length: ROUTE_CORRIDOR_STATION_LIMIT * 2 }, () => ({ x: 0, z: 0 })),
    { x: 3, z: 0 },
  ] } as TransportRoadEdge;
  const rawOver = planTransportRouteCorridor(
    { from: "A", to: "B", edgeCodes: [a.code] },
    new Map([[a.code, rawOverflow]]), nodes,
  );
  assert.deepEqual(rawOver, { status: "over-budget", reason: "raw-source-waypoints",
    edgeCode: a.code, stations: [] },
    "source centerline input must report its REAL budget cause and selected road");
  assert.equal(rawOver.stations.length, 0,
    "source-waypoint budget must fail closed without claiming partial traversal");
  const splitOverflow = (edge: TransportRoadEdge) => ({
    ...edge, centerline: [
      edge.centerline[0],
      ...Array.from({ length: ROUTE_CORRIDOR_STATION_LIMIT }, () => edge.centerline[0]),
      edge.centerline.at(-1)!,
    ],
  }) as TransportRoadEdge;
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] },
    new Map([a, b].map(edge => [edge.code, splitOverflow(edge)])), nodes,
  ), { status: "over-budget", reason: "raw-source-waypoints", edgeCode: b.code, stations: [] },
  "separate short graph legs share ONE cumulative raw waypoint budget; name the first offending road");
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
  // Actual final-surface owner at a Y may be a THIRD physically incident
  // road even though the selected route follows only a -> b. Only source
  // registry + graph incidence + exact physical terminal may authorize it.
  const otherIncident = makeEdge("road/c", "B", "D", 3, 6),
    detachedIncident = makeEdge("road/detached", "B", "D", 4, 6),
    unrelatedCrossing = makeEdge("road/unrelated", "X", "Y", 3, 8),
    registry = new Map([a, b, otherIncident, detachedIncident, unrelatedCrossing]
      .map(edge => [edge.code, edge])),
    physicalY = new Map([
      ["A", [{ edge: a }]],
      ["B", [a, b, otherIncident, detachedIncident, unrelatedCrossing]
        .map(edge => ({ edge }))],
      ["C", [{ edge: b }]],
    ]),
    withOwner = planTransportRouteCorridor(
      { from: "A", to: "C", edgeCodes: [a.code, b.code] },
      registry, nodes, physicalY,
    );
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "A", edgeCodes: [a.code, a.code] }, registry, nodes,
  ), { status: "invalid", reason: "repeated-road", edgeCode: a.code, stations: [] },
  "walking out and back must name its first repeated SEED road and sample no false physical passage");
  assert.deepEqual(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code, a.code, b.code] }, registry, nodes,
  ), { status: "invalid", reason: "repeated-road", edgeCode: a.code, stations: [] },
  "a longer graph walk must name the FIRST duplicate road deterministically");
  // Four unique graph roads can still revisit the departure node through a Y cycle.
  const back = makeEdge("road/back", "C", "A", 5, 0),
    exit = makeEdge("road/exit", "A", "E", 0, -2),
    loopRoads = new Map([a, b, back, exit].map(edge => [edge.code, edge])),
    loopNodes = new Map(nodes);
  loopNodes.set("E", { x: -2, z: 0 });
  const loop = { from: "A", to: "E", edgeCodes: [a.code, b.code, back.code, exit.code] };
  const rejection = { status: "invalid", reason: "repeated-node", edgeCode: back.code, stations: [] };
  assert.deepEqual(planTransportRouteCorridor(loop, loopRoads, loopNodes), rejection,
    "a different road returning to an already visited graph node cannot certify non-retracing passage");
  assert.deepEqual(planTransportRouteCorridorByLeg(loop, loopRoads, loopNodes), rejection,
    "the bounded on-demand wrapper must also reject repeated graph nodes before physical sampling");
  assert.equal(withOwner.status, "ready");
  const joined = withOwner.stations[3];
  assert.deepEqual(joined.junctionOwnerCodes, [a.code, b.code, otherIncident.code],
    "shared Y owner candidates require registered source edge, graph incidence and exact endpoint");
  assert.equal(corridorUnsafeRoadExclusion(station), a.code,
    "an interior failed sample identifies one source-owned road for a bounded detour");
  assert.equal(corridorUnsafeRoadExclusion(joined), null,
    "a shared Y failure must not blame the incoming road or generate a false road exclusion");
  assert.equal(sampledCorridorStationPass(joined, {
    ...dry, contributingModifierIds: [otherIncident.code],
  }), true, "an actual third graph-incident Y winner may own the single sampled junction");
  assert.equal(sampledCorridorStationPass(joined, {
    ...dry, groundMaterialOwnerId: otherIncident.code,
    contributingModifierIds: [a.code, otherIncident.code],
  }), true, "the actual physically incident third road may win the top material at a shared Y");
  assert.equal(sampledCorridorStationFailure(station, {
    ...dry, groundMaterialOwnerId: unrelatedCrossing.code,
    contributingModifierIds: [a.code, unrelatedCrossing.code],
  }), "unrelated winning road surface",
  "a lower selected road modifier cannot make an unrelated top road traversable");
  assert.equal(sampledCorridorStationPass(result.stations[3], {
    ...dry, contributingModifierIds: [otherIncident.code],
  }), false, "the legacy two-route-edge verdict cannot infer an unregistered junction");
  for (const code of [detachedIncident.code, unrelatedCrossing.code, "missing-modifier"]) {
    assert.equal(sampledCorridorStationPass(joined, {
      ...dry, contributingModifierIds: [code],
    }), false, "overlap, detached road endpoint or unknown owner never implies a joined route");
  }
  assert.equal(sampledCorridorStationPass(withOwner.stations[4], {
    ...dry, contributingModifierIds: [otherIncident.code],
  }), false, "the next station must still belong to the selected outgoing road");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] }, registry, nodes,
    new Map([["B", [{ edge: a }, { edge: otherIncident }]]]),
  ).status, "invalid", "missing selected outgoing graph incidence cannot certify a Y");
  // Start and destination nodes are canonical shared terminals too. Their
  // final-surface winner may be another legitimately incident edge, but never
  // a road merely crossing nearby or detached from the SEED endpoint.
  const originRoad = makeEdge("road/origin", "A", "E", 0, -2),
    destinationRoad = makeEdge("road/destination", "C", "F", 5, 7),
    detachedOrigin = makeEdge("road/detached-origin", "A", "E", .5, -2),
    crossOrigin = makeEdge("road/cross-origin", "X", "Y", 0, 8),
    terminalRegistry = new Map([a, b, otherIncident, originRoad,
      destinationRoad, detachedOrigin, crossOrigin].map(edge => [edge.code, edge])),
    terminalIncidence = new Map([
      ["A", [a, originRoad, detachedOrigin, crossOrigin].map(edge => ({ edge }))],
      ["B", [a, b, otherIncident].map(edge => ({ edge }))],
      ["C", [b, destinationRoad].map(edge => ({ edge }))],
    ]),
    terminalPlan = planTransportRouteCorridor(
      { from: "A", to: "C", edgeCodes: [a.code, b.code] },
      terminalRegistry, nodes, terminalIncidence,
    );
  assert.equal(terminalPlan.status, "ready");
  assert.equal(terminalPlan.stations.length, result.stations.length,
    "source-owned start/destination checks reuse the same bounded station positions");
  assert.deepEqual(terminalPlan.stations[0].junctionOwnerCodes, [a.code, originRoad.code],
    "start owners require registered graph incidence and exact canonical endpoint geometry");
  assert.equal(corridorUnsafeRoadExclusion(terminalPlan.stations[0]), null,
    "a shared origin failure also cannot be assigned to a unique incoming road");
  assert.equal(corridorUnsafeRoadExclusion(terminalPlan.stations[1]), a.code,
    "the next ordinary road station keeps its deterministic single-road exclusion");
  assert.deepEqual(terminalPlan.stations.at(-1)?.junctionOwnerCodes, [b.code, destinationRoad.code],
    "destination owners require the identical physical endpoint proof");
  assert.equal(sampledCorridorStationPass(terminalPlan.stations[0], {
    ...dry, contributingModifierIds: [originRoad.code],
  }), true, "a legal road sharing the start node may own its top surface");
  assert.equal(sampledCorridorStationPass(terminalPlan.stations.at(-1)!, {
    ...dry, contributingModifierIds: [destinationRoad.code],
  }), true, "a legal road sharing the destination node may own its top surface");
  assert.equal(sampledCorridorStationPass(terminalPlan.stations[1], {
    ...dry, contributingModifierIds: [originRoad.code],
  }), false, "origin owner cannot mask an invalid next station on the selected road");
  assert.equal(sampledCorridorStationPass(terminalPlan.stations.at(-2)!, {
    ...dry, contributingModifierIds: [destinationRoad.code],
  }), false, "destination owner cannot mask an invalid penultimate road station");
  for (const code of [detachedOrigin.code, crossOrigin.code, "unknown-road"]) {
    assert.equal(sampledCorridorStationPass(terminalPlan.stations[0], {
      ...dry, contributingModifierIds: [code],
    }), false, "detached, crossing or unregistered origins never become walking-road joins");
  }
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] }, terminalRegistry, nodes,
    new Map([...terminalIncidence, ["A", [{ edge: originRoad }]]]),
  ).status, "invalid", "a missing selected start-road incidence is not a legal origin");
  assert.equal(planTransportRouteCorridor(
    { from: "A", to: "C", edgeCodes: [a.code, b.code] }, terminalRegistry, nodes,
    new Map([...terminalIncidence, ["C", [{ edge: destinationRoad }]]]),
  ).status, "invalid", "a missing selected destination-road incidence is not a legal endpoint");
  assert.equal(sampledCorridorStationPass(terminalPlan.stations.at(-1)!, {
    ...dry, traversal: "bridge", deckHeight: 4, deckOwnerIds: ["unrelated-overpass"],
    contributingModifierIds: [destinationRoad.code],
  }), false, "the endpoint cannot borrow a foreign high deck even at an actual node");
  for (const absent of ["A", "B", "C"]) {
    const incomplete = new Map(terminalIncidence);
    incomplete.delete(absent);
    assert.equal(planTransportRouteCorridor(
      { from: "A", to: "C", edgeCodes: [a.code, b.code] },
      terminalRegistry, nodes, incomplete,
    ).status, "invalid",
    `a supplied walking index missing canonical node ${absent} cannot skip ownership checks`);
  }
  const sourceFailureCases = [
    [dry, null],
    [{ ...dry, walkable: false }, "blocked final surface"],
    [{ ...dry, contributingModifierIds: ["unrelated"] }, "selected road modifier absent"],
    [{ ...dry, water: { ...dry.water, kind: "river" } }, "water without owned bridge deck"],
    [{ ...dry, traversal: "difficult" }, "unsafe local road slope"],
    [{ ...dry, traversal: "blocked" }, "non-road traversal"],
    [{ ...dry, deckHeight: 4, traversal: "bridge", deckOwnerIds: [a.code] }, null],
    [{ ...dry, deckHeight: 4, traversal: "bridge", deckOwnerIds: ["unrelated"] }, "unrelated higher bridge deck"],
    [{ ...dry, deckHeight: 4, traversal: "road", deckOwnerIds: [a.code] }, "inconsistent top-deck traversal"],
    [{ ...dry, deckHeight: 4, traversal: "bridge", deckOwnerIds: [a.code],
      water: { ...dry.water, kind: "lake" } }, "unsupported water under bridge deck"],
  ] as const;
  for (const [surface, reason] of sourceFailureCases) {
    assert.equal(sampledCorridorStationFailure(station, surface as FinalSurface), reason,
      "first-failure reason must identify the actual final-surface rejection");
    assert.equal(sampledCorridorStationPass(station, surface as FinalSurface), reason === null,
      "existing sampled verdict must agree exactly with the reported failure");
  }
  assert.equal(sampledCorridorStationFailure(result.stations[3], { ...dry,
    contributingModifierIds: [b.code],
  }), null, "the outgoing actual Y modifier is legal at its single shared graph station");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "difficult" }), false,
    "canonical road grade above 8% cannot be reported as a legal sampled crossing");
  assert.equal(sampledCorridorStationFailure(station, { ...dry, traversal: "open" }),
    "local road slope not sampled",
    "a walkable open-ground road cannot be certified without canonical local grade evidence");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "open" }), false,
    "missing slope fails closed even when graph ownership and walkability agree");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "open" }, .08), true,
    "an open junction at the exact local road grade limit is still safe");
  assert.equal(sampledCorridorStationFailure(station, { ...dry, traversal: "open" }, .081),
    "unsafe local road slope", "open final-surface traversal cannot hide an 8–15% road grade");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "open" }, Infinity), false,
    "nonfinite local road grade fails closed instead of certifying the selected passage");
  assert.equal(sampledCorridorStationFailure(station, { ...dry, traversal: "open" }, -.01),
    "unsafe local road slope", "signed negative local grade is invalid measurement, not legal ascent");
  assert.equal(sampledCorridorStationPass(station, { ...dry, traversal: "open" }, -.01), false,
    "a malformed negative grade must not certify selected road surface");
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
    ...dry, water: { ...dry.water, kind: "river", level: 0 }, traversal: "bridge",
    deckHeight: 4, deckOwnerIds: [a.code],
  }), true, "one source-owned top deck is sufficient at a real shared wet endpoint");
  assert.equal(sampledCorridorStationPass(junction, {
    ...dry, contributingModifierIds: [b.code],
    water: { ...dry.water, kind: "river", level: 0 }, traversal: "bridge",
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
    ...dry, water: { ...dry.water, kind: "river", level: 0 }, traversal: "bridge",
    deckHeight: 4, deckOwnerIds: [a.code],
  }), true, "only the actual selected road deck certifies a wet sample");
  assert.equal(sampledCorridorStationPass(station, {
    ...dry, walkable: false,
  }), false, "a contributing road never overrides Simulation walkability");
});

test("S005 on-demand segmented corridor validates continuous multi-road route within finite budgets", () => {
  const makeChain = (count: number, span: number) => {
    const edges = Array.from({ length: count }, (_, i) => ({
      code: `road/${i}`, from: `N${i}`, to: `N${i + 1}`,
      centerline: [{ x: 0, z: i * span }, { x: 0, z: (i + 1) * span }],
    })) as TransportRoadEdge[];
    const nodes = new Map(Array.from({ length: count + 1 }, (_, i) =>
      [`N${i}`, { x: 0, z: i * span }] as const));
    const roads = new Map(edges.map(edge => [edge.code, edge]));
    const incident = new Map([...nodes.keys()].map(node => [
      node, edges.filter(edge => edge.from === node || edge.to === node).map(edge => ({ edge })),
    ] as const));
    return { edges, nodes, roads, incident,
      route: { from: "N0", to: `N${count}`, edgeCodes: edges.map(edge => edge.code) } };
  };
  const chain = makeChain(9, 600);
  assert.equal(planTransportRouteCorridor(chain.route, chain.roads, chain.nodes, chain.incident).status,
    "over-budget", "the existing 4096-station whole-route limit is unchanged");
  const full = planTransportRouteCorridorByLeg(chain.route, chain.roads, chain.nodes, chain.incident);
  assert.equal(full.status, "ready", "nine physically joined SEED roads may be probed on demand");
  assert.equal(full.stations.length, 5401, "each shared Y must be sampled exactly once");
  assert.equal(full.stations[600].joinedEdgeCode, "road/1");
  assert.deepEqual(full.stations[600].junctionOwnerCodes, ["road/0", "road/1"]);
  assert.equal(full.stations.at(-1)?.edgeCode, "road/8");
  assert.equal(planTransportRouteCorridorByLeg(chain.route, chain.roads, chain.nodes).status, "ready",
    "an optional walking index cannot fabricate an invalid join on physically matched SEED endpoints");
  assert.ok(full.stations.every(station => Number.isFinite(station.x) && Number.isFinite(station.z)));
  const dry = { water: { kind: "none" }, walkable: true, traversal: "road",
    deckHeight: null, deckOwnerIds: [] } as unknown as FinalSurface;
  assert.equal(sampledCorridorStationPass(full.stations[600], {
    ...dry, contributingModifierIds: ["road/1"],
  }), true, "real SEED shared-junction outgoing owner remains legal");
  assert.equal(sampledCorridorStationPass(full.stations[601], {
    ...dry, contributingModifierIds: ["road/0"],
  }), false, "an incoming road cannot impersonate the outgoing segment");
  const detached = { ...chain.edges[8], centerline: [
    { x: 0, z: 8 * 600 + 1 }, { x: 0, z: 9 * 600 },
  ] } as TransportRoadEdge;
  assert.equal(planTransportRouteCorridorByLeg(chain.route,
    new Map([...chain.edges.slice(0, 8), detached].map(edge => [edge.code, edge])),
    chain.nodes, chain.incident).status, "invalid",
  "one detached late source-owned road cannot borrow an earlier road's sampled evidence");
  const tooMany = makeChain(13, 600);
  assert.deepEqual(planTransportRouteCorridorByLeg(tooMany.route, tooMany.roads,
    tooMany.nodes, tooMany.incident), { status: "over-budget", reason: "route-legs",
      edgeCode: "road/12", stations: [] },
  "more than twelve long legs must fail with no partial certified stations");
  const shortOverflow = makeChain(13, 2);
  assert.equal(planTransportRouteCorridor(shortOverflow.route, shortOverflow.roads,
    shortOverflow.nodes, shortOverflow.incident).status, "ready",
  "the short-route 4096-station fast path is reachable and exposes this budget regression");
  assert.deepEqual(planTransportRouteCorridorByLeg(shortOverflow.route, shortOverflow.roads,
    shortOverflow.nodes, shortOverflow.incident), { status: "over-budget", reason: "route-legs",
      edgeCode: "road/12", stations: [] },
  "13 short graph roads must not bypass the on-demand 12-road cap or report a partial physical PASS");
  const shortBoundary = makeChain(12, 2);
  assert.equal(planTransportRouteCorridorByLeg(shortBoundary.route, shortBoundary.roads,
    shortBoundary.nodes, shortBoundary.incident).status, "ready",
  "exactly 12 short source-owned roads remain inspectable");
  const tooLong = makeChain(9, 2000);
  const refused = planTransportRouteCorridorByLeg(tooLong.route, tooLong.roads,
    tooLong.nodes, tooLong.incident);
  assert.deepEqual(refused, { status: "over-budget", reason: "route-stations",
    edgeCode: "road/8", stations: [] },
  "extended total must name the first excluded road with its distinct whole-route budget");
  const oneLongLeg = makeChain(2, ROUTE_CORRIDOR_STATION_LIMIT + 2);
  assert.deepEqual(planTransportRouteCorridorByLeg(oneLongLeg.route, oneLongLeg.roads,
    oneLongLeg.nodes, oneLongLeg.incident), { status: "over-budget", reason: "sample-stations",
      edgeCode: "road/0", stations: [] },
  "individual overlong road keeps the original per-road limit rather than posing as a route-wide failure");
  assert.equal(refused.stations.length, 0,
    "complete-route budget refusal cannot leave partial physical approval");
  assert.equal(ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT, ROUTE_CORRIDOR_STATION_LIMIT * 4);
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
    assert.equal(siteAccessBranchOnRoute({ to: edge.from, edgeCodes: [edge.code] }, accessBranches)?.code,
      edge.code, "the selected route's own final branch must be probed");
    assert.equal(siteAccessBranchOnRoute({ to: edge.from, edgeCodes: ["not-selected-edge"] }, accessBranches),
      undefined, "an unrelated access branch must never certify a selected route");
    assert.equal(siteAccessBranchOnRoute({ to: edge.to, edgeCodes: [edge.code] }, accessBranches),
      undefined, "the sampled branch must end at the selected site node");
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
  assert.equal(geometryOnly.sampledPass, false,
    "an unrelated surface winner cannot certify source-owned site access, even with exact parent geometry");
  assert.deepEqual([geometryOnly.firstUnsafeStation, geometryOnly.firstUnsafeCause],
    [realStations.length, "terminal has no registered top road owner"],
    "exact parent geometry alone must identify the first unowned final-surface terminal");
  const tip = actual.centerline.at(-1)!,
    detachedTip = { ...tip, x: tip.x + 0.012, z: tip.z + 0.019 },
    detachedBranch = { ...actual, centerline: [...actual.centerline.slice(0, -1), detachedTip] },
    parentRoad = roads.find(road => road.code === parentCode)!;
  assert.ok(roadDistanceAt(detachedTip.x, detachedTip.z, parentRoad) > 1e-6,
    "corrupt terminal must miss the SEED-named parent, not merely its modifier");
  assert.equal(siteAccessRoadStations(detachedBranch).length, realStations.length,
    "moved endpoint remains within the finite probe so only junction truth changes");
  const falseIncident = siteAccessSampleVerdict(detachedBranch, unrelatedTerminal,
    new Set([parentCode, "UNRELATED/CROSSING"]));
  assert.equal(falseIncident.onRecordedRoad, false,
    "another incident road cannot certify a site branch detached from its named parent");
  assert.equal(falseIncident.sampledPass, false,
    "detached physical terminal must fail closed despite otherwise walkable samples");
  assert.deepEqual([falseIncident.firstUnsafeStation, falseIncident.firstUnsafeCause],
    [realStations.length, "site branch misses its registered parent junction"]);
  const parentWinner = siteAccessSampleVerdict(actual, realSurfaces.map((surface, index) =>
    index === realSurfaces.length - 1
      ? { ...surface, contributingModifierIds: [parentCode] } : surface), realParents);
  assert.equal(parentWinner.sampledPass, true,
    "the actual parent road may own the shared terminal without the branch modifier");
  assert.equal(parentWinner.terminalGeometryOnly, false,
    "an incident parent modifier removes the geometry-only evidence caveat");
  const ownedParentTop = siteAccessSampleVerdict(actual, realSurfaces.map((surface, index) =>
    index === realSurfaces.length - 1
      ? { ...surface, contributingModifierIds: [parentCode], groundMaterialOwnerId: parentCode }
      : { ...surface, groundMaterialOwnerId: actual.code }), realParents);
  assert.equal(ownedParentTop.sampledPass, true,
    "the actual SEED parent may own the visible road at the exact shared site junction");
  const hiddenBranch = siteAccessSampleVerdict(actual, realSurfaces.map((surface, index) =>
    index === 1
      ? { ...surface, contributingModifierIds: [actual.code, "UNRELATED/OVERPASS"],
          groundMaterialOwnerId: "UNRELATED/OVERPASS" }
      : { ...surface, groundMaterialOwnerId: actual.code }), realParents);
  assert.equal(hiddenBranch.topSurfaceOwned, false);
  assert.equal(hiddenBranch.sampledPass, false,
    "a contributing buried branch cannot certify a different road's visible top material");
  assert.deepEqual([hiddenBranch.firstUnsafeStation, hiddenBranch.firstUnsafeCause],
    [2, "unrelated winning site-access road surface"],
    "first hidden interior road station must be named without extra final-surface probes");
  const hiddenTerminal = siteAccessSampleVerdict(actual, realSurfaces.map((surface, index) =>
    index === realSurfaces.length - 1
      ? { ...surface, contributingModifierIds: [actual.code, "UNRELATED/OVERPASS"],
          groundMaterialOwnerId: "UNRELATED/OVERPASS" }
      : { ...surface, groundMaterialOwnerId: actual.code }), realParents);
  assert.equal(hiddenTerminal.sampledPass, false,
    "a registered parent join cannot legalize an unrelated visible terminal road");
  assert.deepEqual([hiddenTerminal.firstUnsafeStation, hiddenTerminal.firstUnsafeCause],
    [realSurfaces.length, "unrelated winning site-access road surface"]);

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
  assert.equal(good.firstUnsafeStation, null);
  assert.equal(good.firstUnsafeCause, null);
  assert.equal(good.stationCount, 5);
  assert.equal(good.expectedStations, 5);
  assert.equal(good.onRecordedRoad, true);
  assert.equal(good.topSurfaceOwned, true);
  assert.equal(good.terminalGeometryOnly, false);
  // Contradictory world evidence must never let a site approach claim legal
  // passage: the route inspector already rejects blocked non-road traversal.
  const blockedTraversal = siteAccessSampleVerdict(edge,
    connectedSurfaces.map((surface, i) => i === 0
      ? { ...surface, traversal: "blocked" as const } : surface), junctionRoadCodes);
  assert.equal(blockedTraversal.walkable, true,
    "fixture isolates a contradictory traversal label from the walkable flag");
  assert.equal(blockedTraversal.topSurfaceOwned, false);
  assert.equal(blockedTraversal.sampledPass, false);
  assert.deepEqual([blockedTraversal.firstUnsafeStation, blockedTraversal.firstUnsafeCause],
    [1, "non-road site-access traversal"],
    "the first blocked label is not a legal road or open final surface");
  const invalidFirstHeight = siteAccessSampleVerdict(edge,
    connectedSurfaces.map((surface, i) => i === 0
      ? { ...surface, surfaceHeight: NaN } : surface), junctionRoadCodes);
  assert.equal(invalidFirstHeight.sampledPass, false);
  assert.deepEqual([invalidFirstHeight.firstUnsafeStation, invalidFirstHeight.firstUnsafeCause],
    [1, "invalid final-surface height"],
    "a malformed first top cannot be reported only as a later bad interval");
  const deckSample = (owner: string) => connectedSurfaces.map((surface, index) => index === 2 ?
    { ...surface, traversal: "bridge", deckHeight: surface.surfaceHeight, deckOwnerIds: [owner] } : surface);
  const wrongTop = siteAccessSampleVerdict(edge, deckSample("UNRELATED/OVERPASS"), junctionRoadCodes);
  assert.equal(wrongTop.onRecordedRoad, true,
    "the chosen road may contribute below a higher unrelated bridge");
  assert.equal(wrongTop.topSurfaceOwned, false);
  assert.equal(wrongTop.sampledPass, false,
    "site access cannot be certified by a road hidden under an unrelated top deck");
  assert.deepEqual([wrongTop.firstUnsafeStation, wrongTop.firstUnsafeCause],
    [3, "unrelated or invalid top bridge deck"]);
  assert.equal(siteAccessSampleVerdict(edge, deckSample(edge.code), junctionRoadCodes).sampledPass, true,
    "the site branch's own bridge deck is legal when sampled grade remains safe");
  const riverBridge = deckSample(edge.code).map((surface, index) => index === 2
    ? { ...surface, water: { ...surface.water, kind: "river" as const, level: 0 } } : surface);
  const bridged = siteAccessSampleVerdict(edge, riverBridge, junctionRoadCodes);
  assert.equal(bridged.dry, false, "river water remains authoritative below a bridge");
  assert.equal(bridged.supportedWater, true, "the river deck is a supported crossing, not open water");
  assert.equal(bridged.sampledPass, true,
    "the selected road's actual walkable top deck may cross a river at a sampled access station");
  for (const level of [0.2, 0.3, NaN]) {
    const submerged = riverBridge.map((surface, index) => index === 2
      ? { ...surface, water: { ...surface.water, level } } : surface);
    const verdict = siteAccessSampleVerdict(edge, submerged, junctionRoadCodes);
    assert.equal(verdict.sampledPass, false, "submerged or invalid river deck is not site access");
    assert.deepEqual([verdict.firstUnsafeStation, verdict.firstUnsafeCause],
      [3, "submerged or invalid river bridge deck"]);
  }
  for (const kind of ["lake", "ocean"] as const) {
    const unsupported = siteAccessSampleVerdict(edge, riverBridge.map((surface, index) => index === 2
      ? { ...surface, water: { ...surface.water, kind } } : surface), junctionRoadCodes);
    assert.equal(unsupported.sampledPass, false, "non-river water cannot borrow a bridge deck");
    assert.deepEqual([unsupported.firstUnsafeStation, unsupported.firstUnsafeCause],
      [3, "unsupported water under site-access deck"]);
  }
  const exposedRiver = siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, index) => index === 2
    ? { ...surface, water: { ...surface.water, kind: "river" as const } } : surface), junctionRoadCodes);
  assert.equal(exposedRiver.sampledPass, false, "a road without a physical deck cannot cross a river");
  assert.deepEqual([exposedRiver.firstUnsafeStation, exposedRiver.firstUnsafeCause],
    [3, "wet site-access surface"]);
  for (const mismatched of [0.05, -0.05]) {
    const invalidTop = deckSample(edge.code).map((surface, index) => index === 2
      ? { ...surface, deckHeight: surface.surfaceHeight + mismatched } : surface);
    const verdict = siteAccessSampleVerdict(edge, invalidTop, junctionRoadCodes);
    assert.equal(verdict.topSurfaceOwned, false,
      "a finite but contradictory final bridge top is not selected-road-owned passage");
    assert.equal(verdict.sampledPass, false,
      "sampled safe grades alone cannot certify an inconsistent top and deck");
  }
  for (const invalidHeight of [NaN, Infinity, -Infinity]) {
    const malformed = connectedSurfaces.map((surface, index) => index === 2
      ? { ...surface, traversal: "bridge", deckHeight: invalidHeight, deckOwnerIds: [edge.code] }
      : surface);
    const verdict = siteAccessSampleVerdict(edge, malformed, junctionRoadCodes);
    assert.equal(verdict.topSurfaceOwned, false,
      "a nonfinite bridge elevation cannot establish physical site-deck ownership");
    assert.equal(verdict.sampledPass, false,
      "a nonfinite owned deck must not certify the selected site approach");
  }
  assert.equal(siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, index) => index === 2 ?
    { ...surface, traversal: "bridge" } : surface), junctionRoadCodes).sampledPass, false,
    "a bridge classification without a physical top deck is not a valid sample");
  assert.ok(good.maximumGrade !== null && good.maximumGrade < .08);
  const steep = siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, i) => i === 2 ?
    { ...surface, traversal: "difficult" } : surface), junctionRoadCodes);
  assert.equal(steep.sampledPass, false,
    "a steep local road surface cannot pass on averaged grade and walkability alone");
  assert.equal(steep.gradeWithinLimit, false);
  assert.deepEqual([steep.firstUnsafeStation, steep.firstUnsafeCause],
    [3, "unsafe local site-access slope"]);
  assert.ok(steep.maximumGrade !== null && steep.maximumGrade < .08,
    "the local slope rejection is independent of a low sampled span average");
  assert.deepEqual((({ firstUnsafeStation, firstUnsafeCause, sampledPass }) =>
    [firstUnsafeStation, firstUnsafeCause, sampledPass])(
      siteAccessSampleVerdict(edge, connectedSurfaces.map((surface, i) => i === 2 ?
        { ...surface, traversal: "open" } : surface), junctionRoadCodes)),
    [3, "local site-access slope not sampled", false],
    "walkable open site pads without a measured canonical local grade cannot receive a false PASS");
  // An "open" pad remains Simulation-walkable up to 15%, but the
  // selected access-road physical proof must enforce the stricter 8%.
  const openPad = connectedSurfaces.map((surface, i) => i === 2 ?
    { ...surface, traversal: "open" as const } : surface);
  const safeSlopes = [null, null, .08, null, null];
  assert.equal(siteAccessSampleVerdict(edge, openPad, junctionRoadCodes, safeSlopes).sampledPass, true);
  const negativeSlopes = [null, null, -.01, null, null];
  const negativeVerdict = siteAccessSampleVerdict(edge, openPad, junctionRoadCodes, negativeSlopes);
  assert.equal(negativeVerdict.gradeWithinLimit, false,
    "negative local site slope is invalid physical evidence, not a safe road grade");
  assert.equal(negativeVerdict.sampledPass, false);
  assert.deepEqual([negativeVerdict.firstUnsafeStation, negativeVerdict.firstUnsafeCause],
    [3, "unsafe local site-access slope"]);
  const overSlopes = [null, null, .081, null, null];
  const overVerdict = siteAccessSampleVerdict(edge, openPad, junctionRoadCodes, overSlopes);
  assert.equal(overVerdict.gradeWithinLimit, false);
  assert.equal(overVerdict.sampledPass, false);
  assert.deepEqual([overVerdict.firstUnsafeStation, overVerdict.firstUnsafeCause],
    [3, "unsafe local site-access slope"],
    "a locally steep open pad must not hide behind short low-grade intervals");
  assert.equal(siteAccessSampleVerdict(edge, openPad, junctionRoadCodes,
    [null, null, Infinity, null, null]).sampledPass, false,
    "nonfinite open-pad local gradient cannot certify the selected site approach");
  const unmeasured = siteAccessSampleVerdict(edge, openPad, junctionRoadCodes,
    [null, null, null, null, null]);
  assert.equal(unmeasured.sampledPass, false,
    "a supplied but missing open-pad slope cannot be treated as zero");
  assert.deepEqual([unmeasured.firstUnsafeStation, unmeasured.firstUnsafeCause],
    [3, "local site-access slope not sampled"],
    "the first missing local grade must remain distinguishable from a measured unsafe slope");
  assert.deepEqual(siteAccessSampleVerdict(edge, connectedSurfaces, junctionRoadCodes), good);
  const incomplete = siteAccessSampleVerdict(edge, connectedSurfaces.slice(1), junctionRoadCodes);
  assert.equal(incomplete.sampledPass, false,
    "missing selected final-surface station must never produce a pass");
  assert.deepEqual([incomplete.firstUnsafeStation, incomplete.firstUnsafeCause],
    [null, "incomplete or invalid access profile"]);
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
  const unsafeGrade = siteAccessSampleVerdict(edge, connectedSurfaces.map((s, i) => i === 4 ?
    { ...s, surfaceHeight: 30 } : s), junctionRoadCodes);
  assert.equal(unsafeGrade.gradeWithinLimit, false);
  assert.deepEqual([unsafeGrade.firstUnsafeStation, unsafeGrade.firstUnsafeCause],
    [5, "sampled site-access grade exceeds 8%"]);
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

test("S005 selected bridge diagnostics fail closed for malformed source road waypoints", () => {
  const good = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 16, z: 0 }];
  assert.equal(transportRoadArcStations(good, 8, 0, -20, 20, 4).length, 5,
    "valid canonical road remains sampleable");
  for (const corrupt of [
    [...good.slice(0, 2), { x: NaN, z: 0 }],
    [good[0], null, good[2]],
    [{ x: Infinity, z: 0 }, ...good.slice(1)],
  ]) {
    const bad = corrupt as { x: number; z: number }[];
    assert.deepEqual(transportRoadArcStations(bad, 8, 0, -20, 20, 4), [],
      "one invalid source segment must invalidate the whole bridge road arc");
  }
  assert.deepEqual(transportRoadArcStations(good, NaN, 0, -20, 20, 4), [],
    "non-finite bridge anchor never generates candidate crossing stations");
  // A synthetic invalid inspection target avoids materializing lazy SEED
  // bridges ahead of the separate demand-only cache regression below.
  const edge = siteTransportNetwork.roadEdges[0];
  assert.ok(edge && edge.centerline.length >= 2, "canonical road fixture required");
  const bridge = { x: edge.centerline[0].x, z: edge.centerline[0].z,
    roadCode: edge.code, drainageCode: "INVALID/CROSSING", spanM: 10
  } as Parameters<typeof transportBridgeSpanAt>[0];
  const invalidRoad = { ...edge, centerline: [edge.centerline[0], null, ...edge.centerline.slice(1)] } as unknown as typeof edge;
  assert.equal(transportBridgeSpanAt(bridge, invalidRoad).matchingCrossing, false,
    "malformed selected physical bridge must fail closed without sampling water or throwing");
  // A finite 49-station output must not hide an unbounded synchronous scan
  // of raw bridge road vertices. Poison an oversized array element to prove
  // the two entry points reject it BEFORE accessing source coordinates.
  const oversized = Array.from({ length: ROUTE_CORRIDOR_STATION_LIMIT * 2 + 1 },
    () => ({ x: 8, z: 0 }));
  Object.defineProperty(oversized, 1, {
    get: () => { throw new Error("oversized bridge centerline must not be scanned"); },
  });
  assert.deepEqual(transportRoadArcStations(oversized, 8, 0, -20, 20, 4), [],
    "arc sampler must refuse excessive raw source work before reading waypoints");
  assert.equal(transportBridgeSpanAt(bridge, { ...edge, centerline: oversized }).matchingCrossing, false,
    "bridge anchor must reject oversized source data before any road scan or water query");
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

test("S005 first unsafe bridge interval identifies exact grade station without claiming continuous travel", () => {
  const positions = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }];
  const safe = transportRoadIntervalGradeEvidence(positions, [0, 0, 0.2]);
  assert.equal(safe.firstUnsafeStation, null);
  assert.equal(safe.firstUnsafeGrade, null);
  assert.ok(safe.maximum !== null && safe.maximum < 0.08);
  const unsafe = transportRoadIntervalGradeEvidence(positions, [0, 0, 3]);
  assert.equal(unsafe.firstUnsafeStation, 3,
    "the first violation is the second segment's arriving station, not an arbitrary maximum");
  assert.ok(unsafe.firstUnsafeGrade !== null && unsafe.firstUnsafeGrade > 0.08);
  assert.equal(unsafe.firstUnsafeGrade, unsafe.maximum,
    "exposed first failing grade is measured using existing canonical stations");
  assert.equal(transportRoadIntervalGradeEvidence(positions, [0, 3, 6]).firstUnsafeStation, 2,
    "the earliest violating interval wins even when later sampled spans are also steep");
  const degenerate = transportRoadIntervalGradeEvidence([positions[0], positions[0]], [0, 0]);
  assert.equal(degenerate.maximum, Infinity);
  assert.equal(degenerate.firstUnsafeStation, 2,
    "zero-distance and otherwise nonfinite sample intervals must fail closed");
  assert.equal(transportRoadIntervalGradeEvidence(positions, [0, 3]).maximum, null,
    "missing profile stations cannot manufacture grade proof");
  assert.deepEqual(transportRoadIntervalGradeEvidence(positions, [0, 0, 3]), unsafe,
    "repeated static grade evidence is deterministic and independent of map/renderer");
});

test("S005 selected bridge deck requires both recorded owner and contributing modifier", () => {
  const edgeCode = "SEED/SELECTED/ROAD", otherCode = "SEED/FOREIGN/ROAD",
    owned = {
      water: { kind: "river", level: 0 }, walkable: true, traversal: "bridge",
      surfaceHeight: 12, deckHeight: 12, deckOwnerIds: [edgeCode],
      contributingModifierIds: [edgeCode],
    } as FinalSurface,
    station = { x: 0, z: 0, edgeCode };
  assert.equal(selectedRoadBridgeDeckWalkable(owned, edgeCode), true);
  assert.equal(sampledCorridorStationPass(station, owned), true,
    "valid selected final-surface ownership agrees with the full-route diagnostic");
  for (const invalid of [
    { ...owned, contributingModifierIds: [otherCode] },
    { ...owned, contributingModifierIds: [] },
    { ...owned, deckOwnerIds: [otherCode] },
    { ...owned, walkable: false },
    { ...owned, traversal: "road" },
    { ...owned, deckHeight: null },
    { ...owned, deckHeight: NaN },
    { ...owned, deckHeight: Infinity },
    { ...owned, deckHeight: -Infinity },
    { ...owned, surfaceHeight: NaN },
    { ...owned, surfaceHeight: Infinity },
    { ...owned, surfaceHeight: -Infinity },
    { ...owned, surfaceHeight: 13 }, // finite deck, contradictory walkable top
    { ...owned, deckHeight: 11 }, // finite top, contradictory deck
    { ...owned, water: { kind: "lake" } },
  ] as FinalSurface[]) {
    assert.equal(selectedRoadBridgeDeckWalkable(invalid, edgeCode), false,
      "a selected bridge center/wet station cannot borrow an unrelated or incomplete deck");
    assert.equal(sampledCorridorStationPass(station, invalid), false,
      "bridge-specific deck checks must agree with selected-route source ownership");
  }
  assert.equal(sampledCorridorStationFailure(station, { ...owned, surfaceHeight: 13 }),
    "bridge deck disagrees with final-surface top",
    "first unsafe selected route must name the mismatched physical bridge top");
  assert.equal(sampledBridgeTopFailure(edgeCode, { ...owned, surfaceHeight: 13 }),
    "bridge deck disagrees with final-surface top",
    "bridge and route diagnostics must report the same authoritative top-height contradiction");
  assert.equal(selectedRoadBridgeDeckWalkable(owned, otherCode), false,
    "an unrelated road code cannot claim the same selected deck");
  for (const level of [12, 12.1, NaN, Infinity]) {
    const submerged = { ...owned, water: { kind: "river" as const, level } };
    assert.equal(selectedRoadBridgeDeckWalkable(submerged, edgeCode), false,
      "wet deck must be strictly above finite authoritative river level");
    assert.equal(sampledCorridorStationFailure(station, submerged),
      "submerged or invalid river bridge deck");
    assert.equal(sampledCorridorStationPass(station, submerged), false);
    assert.equal(sampledBridgeTopFailure(edgeCode, submerged),
      "submerged or invalid river bridge deck");
  }
  assert.equal(sampledCorridorStationFailure(station, { ...owned, deckHeight: NaN }),
    "invalid final-surface bridge deck", "reject invalid selected-bridge height explicitly");
});

test("S005 selected route rejects non-finite top-surface height at the first station", () => {
  const edgeCode = "SELECTED/ROAD", station = { x: 0, z: 0, edgeCode };
  const valid = {
    surfaceHeight: 12, water: { kind: "none" }, walkable: true, traversal: "road",
    deckHeight: null, deckOwnerIds: [], contributingModifierIds: [edgeCode],
  } as FinalSurface;
  assert.equal(sampledCorridorStationFailure(station, valid), null);
  assert.equal(sampledCorridorStationPass(station, valid), true);
  for (const malformed of [NaN, Infinity, -Infinity]) {
    const surface = { ...valid, surfaceHeight: malformed } as FinalSurface;
    assert.equal(sampledCorridorStationFailure(station, surface), "invalid final-surface height",
      "do not defer a malformed first sample to a misleading next-interval grade");
    assert.equal(sampledCorridorStationPass(station, surface), false);
    assert.equal(sampledBridgeTopFailure(edgeCode, surface), "invalid final-surface height",
      "bridge and walking-route inspectors must explain identical malformed top surfaces");
  }
});

test("S005 selected bridge and walking route give the same first unsafe final-surface reason", () => {
  const edgeCode = "SELECTED/ROAD";
  const surface = {
    walkable: true,
    contributingModifierIds: [edgeCode],
    deckOwnerIds: ["UNRELATED/OVERPASS"],
    deckHeight: 10,
    traversal: "bridge",
    water: { kind: "lake" },
  } as unknown as FinalSurface;
  for (const unsafe of [
    surface,
    { ...surface, water: { kind: "river" } },
    { ...surface, deckOwnerIds: [edgeCode], traversal: "road" },
    { ...surface, deckHeight: null, deckOwnerIds: [], water: { kind: "none" }, traversal: "difficult" },
  ]) {
    const reason = sampledCorridorStationFailure({ x: 0, z: 0, edgeCode }, unsafe as FinalSurface);
    assert.ok(reason, "fixture must be unsafe for both selected probes");
    assert.equal(sampledBridgeTopFailure(edgeCode, unsafe as FinalSurface), reason,
      "first unsafe cause may not depend on whether the player opened bridge or full-route inspector");
  }
  assert.equal(sampledBridgeTopFailure(edgeCode, surface), "unsupported water under bridge deck",
    "unsupported water must not be hidden by a competing overpass diagnosis");
  const openBank = { ...surface, water: { kind: "none" as const },
    deckHeight: null, deckOwnerIds: [], traversal: "open" as const,
    contributingModifierIds: [edgeCode], surfaceHeight: 4 };
  assert.equal(sampledBridgeTopFailure(edgeCode, openBank, .08), "physical traversal not certified",
    "an at-limit open dry bank is legal, including at a selected river crossing");
  assert.equal(sampledBridgeTopFailure(edgeCode, openBank, .081), "unsafe local road slope",
    "selected bridge bank and full-route probes agree about >8% open-ground grade");
  assert.equal(sampledBridgeTopFailure(edgeCode, openBank, NaN), "unsafe local road slope",
    "nonfinite local open-bank slope fails closed with the same first-unsafe cause");
  // Unwalkable wet surfaces are common at a missing or disconnected deck;
  // reporting only 'blocked final surface' conceals the real crossing defect.
  const exposedRiver = { ...surface, walkable: false, water: { kind: "river" },
    deckHeight: null, deckOwnerIds: [], traversal: "blocked" } as unknown as FinalSurface;
  assert.equal(sampledCorridorStationFailure({ x: 0, z: 0, edgeCode }, exposedRiver),
    "water without owned bridge deck");
  assert.equal(sampledBridgeTopFailure(edgeCode, exposedRiver),
    "water without owned bridge deck",
    "bridge and selected-route diagnostics share the same specific wet failure");
  assert.equal(sampledCorridorStationPass({ x: 0, z: 0, edgeCode }, exposedRiver), false,
    "explaining missing deck water cannot accidentally certify wet walking");
  const unsupportedLake = { ...surface, walkable: false } as FinalSurface;
  assert.equal(sampledBridgeTopFailure(edgeCode, unsupportedLake), "unsupported water under bridge deck",
    "a blocked lake under an overpass must still identify unsupported water");
  const dryBlocked = { ...exposedRiver, water: { kind: "none" } } as FinalSurface;
  assert.equal(sampledBridgeTopFailure(edgeCode, dryBlocked), "blocked final surface",
    "a dry obstruction keeps its existing first-unsafe classification");
  assert.equal(sampledCorridorStationFailure({ x: 0, z: 0, edgeCode },
    { ...dryBlocked, walkable: true, traversal: "road", contributingModifierIds: [] }),
    "selected road modifier absent", "missing-road ownership remains a separate failure");
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

test("S005 selected bridge arcs refuse self-crossing and distant hairpin ambiguity", () => {
  // The same source coordinate appears at two nonadjacent arc distances;
  // inspecting either branch as the unique bridge would be false evidence.
  const crossed = [
    { x: -8, z: -8 }, { x: 8, z: 8 },
    { x: -8, z: 8 }, { x: 8, z: -8 },
  ];
  const metresPerUnit = CANONICAL_METRES_PER_SOURCE_UNIT;
  const crossing = { lo: -0.1, hi: 0.1, metresPerUnit };
  assert.deepEqual(transportRoadArcStations(crossed, 0, 0, -8, 8, 4), [],
    "two physically intersecting but distant canonical road arcs cannot share a chosen bridge anchor");
  assert.deepEqual(transportRoadWetStations(crossed, 0, 0, crossing), [],
    "ambiguous wet-deck probes must fail closed instead of selecting an arbitrary road branch");
  assert.deepEqual(transportRoadBankApproaches(crossed, 0, 0, crossing), { left: [], right: [] },
    "both bank approaches also require a unique source-owned arc");
  const elbow = [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }];
  assert.equal(transportRoadArcStations(elbow, 8, 0, -8, 8, 4).length, 5,
    "two segments meeting at the same recorded vertex remain one unambiguous road arc");
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

test("S005 site terminal ownership requires a real registered road endpoint", () => {
  const road = { ...roads[0], fromX: -10, fromZ: 0, toX: 10, toZ: 0, centerline: [
    { x: -10, z: 0, position: sourceToLonLat(-10, 0) },
    { x: 10, z: 0, position: sourceToLonLat(10, 0) },
  ] };
  assert.ok(roadDistanceAt(0, 0, road) < 1e-6,
    "a polyline may cross a coordinate without making it a true graph endpoint");
  assert.equal(roadEndpointMeetsTerminal(road, { x: 0, z: 0 }), false,
    "an interior intersection is not a legally joined site-road terminal");
  for (const x of [-10, 10]) assert.equal(roadEndpointMeetsTerminal(road, { x, z: 0 }), true);
  assert.equal(roadEndpointMeetsTerminal(road, { x: -10, z: 0.01 }), false,
    "a physically detached endpoint cannot borrow a nearby road");
  const half = SOURCE_PRESENTATION_WIDTH / 2,
    seam = { fromX: half - 0.25, fromZ: 2, toX: half - 2, toZ: 4 };
  assert.equal(roadEndpointMeetsTerminal(seam, { x: -half - 0.25, z: 2 }), true,
    "the same canonical endpoint remains joined across the longitude seam");
  assert.equal(roadEndpointMeetsTerminal(seam, { x: -half + 0.25, z: 2 }), false,
    "the seam cannot fabricate a displaced terminal");
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

test("S005 real non-retracing gate-Y-bridge-site graph chain has exact physical endpoints", () => {
  const network = siteTransportNetwork, index = createTransportWalkingIndex(network),
    nodeByCode = new Map(network.nodes.map(node => [node.code, node])),
    edgeByCode = new Map(network.roadEdges.map(edge => [edge.code, edge])),
    bridge = ensureTransportBridgeEvidence();
  assert.ok(bridge, "the deterministic river crossing must have a real road owner");
  const crossing = edgeByCode.get(bridge!.roadCode);
  assert.ok(crossing && crossing.bridgeCodes.includes(bridge!.code),
    "the selected crossing must remain on its actual graph edge");
  // The source graph remains connected when this bridge edge is removed.
  // A naive concatenation of unrelated shortest paths can therefore visit
  // the bridge twice. Start from an actual village gate that enters a real Y
  // next to a selected bridge endpoint, then traverse the bridge exactly once
  // into a site-owned access branch. SEED order and graph edge codes decide.
  const witnesses = [crossing!.from, crossing!.to].flatMap(originCode => {
    const farCode = originCode === crossing!.from ? crossing!.to : crossing!.from,
      farNode = nodeByCode.get(farCode);
    if (!farNode) return [];
    const bridgeSiteRoutes = network.nodes.filter(node => node.kind === "site" &&
      node.continent === farNode.continent && node.countryCode === farNode.countryCode)
      .flatMap(node => {
        const route = transportWalkingRouteThroughEdge(index, originCode, crossing!, [node.code]);
        return route ? [route] : [];
      });
    return (index.adjacency.get(originCode) ?? [])
      .filter(step => step.edge.code !== crossing!.code &&
        nodeByCode.get(step.node)?.kind === "junction")
      .flatMap(toY => (index.adjacency.get(toY.node) ?? [])
        .filter(step => step.node !== originCode &&
          nodeByCode.get(step.node)?.kind === "village")
        .flatMap(fromGate => {
          const villageNode = nodeByCode.get(fromGate.node)!,
            village = villages.find(place => place.id === villageNode.sourceId),
            road = roads.find(road => road.code === fromGate.edge.code),
            gate = village && road ? settlementExteriorFor(village).gates.find(g =>
              roadDistanceAt(g.x, g.z, road) <= 1e-4) : undefined;
          if (!village || !road || !gate) return [];
          const y = nodeByCode.get(toY.node)!,
            toYRoute = transportWalkingRouteThroughEdge(index, villageNode.code,
              fromGate.edge, [y.code]);
          if (!toYRoute || toYRoute.edgeCodes.length !== 1 ||
              toYRoute.edgeCodes[0] !== fromGate.edge.code) return [];
          return bridgeSiteRoutes.flatMap(bridgeToSite => {
            const chain = [fromGate.edge.code, toY.edge.code, ...bridgeToSite.edgeCodes];
            return new Set(chain).size === chain.length
              ? [{ villageNode, gate, road, edge: fromGate.edge, toY: toYRoute,
                  y, site: nodeByCode.get(bridgeToSite.to)!, originCode, toYEdge: toY.edge,
                  bridgeToSite, chain }]
              : [];
          });
        }));
  }).filter(candidate => candidate.chain.includes(crossing!.code));
  const witness = witnesses[0];
  assert.ok(witness,
    "actual SEED village gate must reach a physical Y then the selected bridge exactly once en route to a real site");
  const { villageNode, y, site, chain } = witness!,
    gateWitness = { gate: witness!.gate, road: witness!.road,
      edge: witness!.edge, toY: witness!.toY };
  const gateSurface = finalSurfaceAt(gateWitness!.gate.x, gateWitness!.gate.z);
  assert.equal(gateSurface.water.kind, "none", "actual settlement entry gate cannot land in exposed water");
  assert.equal(gateSurface.walkable, true, "actual settlement gate must have a walkable final surface");
  assert.notEqual(gateSurface.traversal, "blocked", "actual gate is not a blocked Simulation surface");
  // A single sampled gate is a physical start witness, not an uninterrupted
  // route pass or a claim that the protagonist was moved.
  assert.equal(chain.filter(code => code === crossing!.code).length, 1,
    "chosen bridge road must occur exactly once in the same gate-to-site graph route");
  assert.equal(new Set(chain).size, chain.length,
    "one SEED walking route must not silently retrace any canonical road");
  assert.equal(chain[0], gateWitness!.edge.code,
    "the same ordered walking route must begin on the physical settlement gate road");
  assert.equal(gateWitness!.toY!.to, y!.code,
    "the gate's own first road must lead into the selected canonical Y");
  // Graph incidence alone can hide a disconnected rendering polyline.
  // Check that every oriented source-owned centerline meets its graph nodes
  // and that consecutive real geometry ends meet at the same SEED position.
  // This is a geometric join proof, not a full unsampled traversal verdict.
  let at = villageNode!.code;
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
        `canonical gate-to-site road geometry has a false junction before ${code}`);
    previousPhysicalEnd = end;
    at = to!.code;
  }
  assert.equal(at, site!.code, "chain must terminate at the actual SEED-owned site");
  assert.ok(chain.includes(crossing!.code), "the bridge crossing is a required physical graph leg");
  const access = network.roadEdges.find(edge =>
    edge.roadClass === "access" && edge.from === site!.code);
  assert.ok(access && chain.includes(access.code),
    "critical-site entry must traverse its own recorded access branch");
  // Follow the real SEED slope failure (full diagnostic station 435) through
  // the graph-only exclusion API. This is a bounded candidate search, NOT
  // proof that an alternative preserves the bridge or legal final surface.
  const firstUnsafeRoad = "ADVISOR-0126-ALDERWICK/macro-roads-v2/ROAD/0/0/2/2~J/0/0/2/1";
  assert.ok(chain.includes(firstUnsafeRoad),
    "the same real nine-road witness must retain its first previously unsafe road");
  // The original witness is graph-cut after excluding the unsafe road.
  // Reuse its already-materialized SEED gate/Y/bridge/site candidates rather
  // than inventing a destination or another route/asset generator. Consider a
  // finite prefix of alternatives; no result is an exhaustive impossibility
  // proof. A graph/source recipe is not a legal final-surface walk.
  const candidateBudget = 64;
  let examined = 0, unsafeGateY = 0, noContinuation = 0, repeatedNode = 0;
  let alternative: { from: string; to: string; edgeCodes: readonly string[];
    gateCode: string; junctionCode: string; siteCode: string } | null = null;
  for (const candidate of witnesses.slice(0, candidateBudget)) {
    examined++;
    const prefix = [candidate.edge.code, candidate.toYEdge.code];
    if (prefix.includes(firstUnsafeRoad)) { unsafeGateY++; continue; }
    const continuation = transportWalkingRouteThroughEdge(
      index, candidate.originCode, crossing!, [candidate.site.code],
      new Set([firstUnsafeRoad]));
    if (!continuation) { noContinuation++; continue; }
    const edgeCodes = [...prefix, ...continuation.edgeCodes];
    if (edgeCodes.includes(firstUnsafeRoad) ||
        edgeCodes.filter(code => code === crossing!.code).length !== 1 ||
        new Set(edgeCodes).size !== edgeCodes.length) { repeatedNode++; continue; }
    // Check node-simple incidence as well as the planner's road-simple rule.
    let current = candidate.villageNode.code;
    const seenNodes = new Set([current]);
    let valid = true;
    for (const code of edgeCodes) {
      const edge = edgeByCode.get(code);
      if (!edge || (edge.from !== current && edge.to !== current)) { valid = false; break; }
      current = edge.from === current ? edge.to : edge.from;
      if (seenNodes.has(current)) { valid = false; break; }
      seenNodes.add(current);
    }
    if (!valid || current !== candidate.site.code) { repeatedNode++; continue; }
    alternative = { from: candidate.villageNode.code, to: candidate.site.code,
      edgeCodes, gateCode: candidate.villageNode.code,
      junctionCode: candidate.y.code, siteCode: candidate.site.code };
    break;
  }
  const alternatePlan = alternative ? planTransportRouteCorridorByLeg(
    alternative, edgeByCode, nodeByCode, index.adjacency) : null;
  console.log("S005_REAL_SEED_ALTERNATE_WITNESS", JSON.stringify({
    originalUnsafeLeg: chain.indexOf(firstUnsafeRoad) + 1,
    enumerated: witnesses.length, budget: candidateBudget, examined,
    unsafeGateY, noContinuation, repeatedNode,
    graph: alternative ? "candidate" : "not-found-within-candidate-budget",
    sameOriginalGate: alternative?.gateCode === villageNode!.code,
    sameOriginalSite: alternative?.siteCode === site!.code,
    selectedBridge: alternative?.edgeCodes.includes(crossing!.code) ?? false,
    selectedY: alternative?.junctionCode ?? null,
    roadCount: alternative?.edgeCodes.length ?? 0,
    sourceRecipe: alternatePlan?.status ?? "not-available",
    sampledStations: alternatePlan?.status === "ready" ? alternatePlan.stations.length : 0,
    caveat: "only enumerated gate/Y/site prefixes; not exhaustive or physically certified",
  }));
  if (alternative) {
    assert.ok(alternative.edgeCodes.length > 0 &&
      alternative.edgeCodes.filter(code => code === crossing!.code).length === 1 &&
      !alternative.edgeCodes.includes(firstUnsafeRoad),
      "alternate real witness must cross the selected bridge once and exclude unsafe road");
    assert.notEqual(alternatePlan?.status, "invalid",
      "an alternate candidate must preserve canonical endpoint joins");
  }
  // Inspect a small, focus-bounded set of OTHER already-SEED-owned river
  // bridges. A candidate here only proves a source graph/profile recipe,
  // not safe grades, both dry banks or Simulation travel. Unlike the fixed
  // selected-bridge graph cut, this can distinguish an alternative crossing.
  const otherBridgeCodes = [...new Set(transportRoadsNear(
    bridge!.x, bridge!.z, 2048, 64).flatMap(edge => edge.bridgeCodes))]
    .filter(code => code !== bridge!.code).sort().slice(0, 4);
  let otherBridgeCandidate: {
    bridge: string; roadCount: number; sourceRecipe: string;
    sampledStations: number; firstRoad: string;
  } | null = null;
  for (const code of otherBridgeCodes) {
    const otherBridge = transportBridgeByCode(code),
      owner = otherBridge && edgeByCode.get(otherBridge.roadCode);
    if (!owner) continue;
    const route = transportWalkingRouteViaRequiredEdge(
      index, villageNode!.code, site!.code, owner, new Set([firstUnsafeRoad]));
    if (!route || !route.edgeCodes.includes(owner.code) ||
        route.edgeCodes.includes(firstUnsafeRoad)) continue;
    const recipe = planTransportRouteCorridorByLeg(
      route, edgeByCode, nodeByCode, index.adjacency);
    otherBridgeCandidate = { bridge: code, roadCount: route.edgeCodes.length,
      sourceRecipe: recipe.status, sampledStations: recipe.status === "ready" ? recipe.stations.length : 0,
      firstRoad: route.edgeCodes[0] };
    break;
  }
  console.log("S005_REAL_SEED_OTHER_BRIDGE", JSON.stringify({
    origin: villageNode!.code, site: site!.code, unsafeRoad: firstUnsafeRoad,
    scannedNearbyCrossings: otherBridgeCodes.length,
    candidate: otherBridgeCandidate,
    caveat: "bounded local bridge search; no complete final-surface or actor legal passage",
  }));
  const detour = transportWalkingRoute(index, villageNode!.code, site!.code,
    new Set([firstUnsafeRoad]));
  assert.ok(detour,
    "the same real SEED endpoints must expose a graph-only alternative when their unsafe road is excluded");
  if (detour) {
    assert.equal(detour.from, villageNode!.code);
    assert.equal(detour.to, site!.code);
    assert.ok(detour.distanceM > 0 && detour.fantasyWalkSeconds > 0,
      "an alternate graph hint reports genuine SEED road costs, not physical travel");
    assert.ok(!detour.edgeCodes.includes(firstUnsafeRoad),
      "physical-unsafe-road exclusion must never return the refused edge");
    assert.ok(detour.exploredNodes <= index.nodeCount);
    assert.equal(new Set(detour.edgeCodes).size, detour.edgeCodes.length,
      "a detour candidate must not retrace a SEED road");
  }
  const detourPlan = detour ? planTransportRouteCorridorByLeg(detour, edgeByCode,
    nodeByCode, index.adjacency) : null;
  console.log("S005_REAL_SEED_DETOUR", JSON.stringify({
    excludedRoad: firstUnsafeRoad,
    graph: detour ? "candidate" : "unavailable",
    roadCount: detour?.edgeCodes.length ?? 0,
    preservesSelectedBridge: detour?.edgeCodes.includes(crossing!.code) ?? false,
    sourceRecipe: detourPlan?.status ?? "not-available",
    ...(detourPlan?.status === "over-budget" ? { reason: detourPlan.reason,
      offendingRoad: detourPlan.edgeCode } : {}),
    sampledStations: detourPlan?.status === "ready" ? detourPlan.stations.length : 0,
    caveat: "graph/source recipe only; local grades and continuous physical travel unverified",
  }));
  const bridgeCut = transportWalkingRequiredBridgeCut(
    index, villageNode!.code, site!.code, crossing!, new Set([firstUnsafeRoad]));
  assert.ok(bridgeCut.exploredNodes <= index.nodeCount,
    "the exact-SEED graph-cut probe visits each node at most once");
  console.log("S005_REAL_SEED_BRIDGE_CUT", JSON.stringify({
    excludedRoad: firstUnsafeRoad, result: bridgeCut.status,
    orientation: bridgeCut.orientation, exploredNodes: bridgeCut.exploredNodes,
    bound: index.nodeCount,
    caveat: "graph-cut rules out required bridge route; not-proven does not certify physical walking",
  }));
  const bridgeDetour = transportWalkingRouteViaRequiredEdge(
    index, villageNode!.code, site!.code, crossing!, new Set([firstUnsafeRoad]));
  if (bridgeDetour) {
    assert.equal(bridgeDetour.edgeCodes.filter(code => code === crossing!.code).length, 1,
      "real bridge-constrained candidate must traverse the selected bridge exactly once");
    assert.ok(!bridgeDetour.edgeCodes.includes(firstUnsafeRoad),
      "selected bridge candidate may not silently reuse known unsafe source road");
    assert.equal(new Set(bridgeDetour.edgeCodes).size, bridgeDetour.edgeCodes.length);
    assert.ok(bridgeDetour.exploredNodes <= 4096);
  }
  const bridgeDetourPlan = bridgeDetour ? planTransportRouteCorridorByLeg(
    bridgeDetour, edgeByCode, nodeByCode, index.adjacency) : null;
  console.log("S005_REAL_SEED_REQUIRED_BRIDGE_DETOUR", JSON.stringify({
    excludedRoad: firstUnsafeRoad,
    graph: bridgeDetour ? "candidate" : "not-found-by-bounded-strategy",
    roads: bridgeDetour?.edgeCodes.length ?? 0,
    preservesSelectedY: bridgeDetour?.edgeCodes.includes(witness!.toYEdge.code) ?? false,
    preservesSelectedBridge: bridgeDetour?.edgeCodes.includes(crossing!.code) ?? false,
    sourceRecipe: bridgeDetourPlan?.status ?? "not-available",
    ...(bridgeDetourPlan?.status === "over-budget" ? {
      reason: bridgeDetourPlan.reason, offendingRoad: bridgeDetourPlan.edgeCode } : {}),
    sampledStations: bridgeDetourPlan?.status === "ready" ? bridgeDetourPlan.stations.length : 0,
    caveat: "bounded candidate, not exhaustive; not final-surface or actor passage",
  }));
  // Exercise the SAME real gate road -> Y -> selected river crossing -> site
  // chain in the player-facing physical corridor planner. A too-long route is honestly
  // reported as over budget, never as partially proven physical passage.
  const physicalPlan = planTransportRouteCorridor(
    { from: villageNode!.code, to: site!.code, edgeCodes: chain },
    edgeByCode, nodeByCode, index.adjacency,
  );
  assert.notEqual(physicalPlan.status, "invalid",
    "the real non-retracing gate/Y/bridge/site path must preserve physical source endpoint joins");
  if (physicalPlan.status === "ready") {
    assert.ok(physicalPlan.stations.length > 0 &&
      physicalPlan.stations.length <= ROUTE_CORRIDOR_STATION_LIMIT,
      "a bounded real corridor plan must retain every source-owned station");
    assert.equal(physicalPlan.stations[0].edgeCode, chain[0]);
    assert.equal(physicalPlan.stations.at(-1)?.edgeCode, chain.at(-1));
  } else {
    assert.equal(physicalPlan.status, "over-budget",
      "an actual too-long route must be unavailable rather than a partial physical PASS");
    assert.equal(physicalPlan.stations.length, 0,
      "do not silently truncate over-budget real-route evidence");
  }
  // Retry the same real nine-road witness in bounded, on-demand per-road
  // windows. Station readiness proves a sampling recipe, not legal passage.
  const segmented = planTransportRouteCorridorByLeg(
    { from: villageNode!.code, to: site!.code, edgeCodes: chain },
    edgeByCode, nodeByCode, index.adjacency,
  );
  assert.notEqual(segmented.status, "invalid",
    "segmented physical recipe preserves the same real SEED gate/Y/bridge/site ownership");
  // Current Campaign-SEED's real selected gate/Y/bridge/site route fits
  // the unchanged finite 12-leg / 16384-station diagnostic. A valid source
  // recipe is necessary, but not sufficient, for actual legal passage.
  assert.equal(segmented.status, "ready",
    "the real SEED-owned gate-to-site route must allow a bounded full-station physical check");
  if (segmented.status === "ready") {
    assert.ok(segmented.stations.length > ROUTE_CORRIDOR_STATION_LIMIT,
      "the same real route must exercise the bounded per-road fallback");
    // Cheap routine smoke: the first 32 canonical stations must genuinely
    // be legal under the same local-slope and great-circle interval rules as
    // the interactive diagnostic. A deliberate full-route check is opt-in.
    const full = process.env.S005_ROUTE_FULL_PROBE === "1";
    const limit = full ? segmented.stations.length : Math.min(32, segmented.stations.length);
    let previousHeight: number | null = null, maximumIntervalGrade = 0,
      firstUnsafe: { station: number; road: string; cause: string; x: number; z: number; grade?: number } | null = null;
    const started = performance.now();
    for (let i = 0; i < limit; i++) {
      if (full && performance.now() - started > 6 * 60_000) {
        const station = segmented.stations[i];
        firstUnsafe = { station: i + 1, road: station.edgeCode,
          cause: "finite diagnostic time budget exhausted; not certified",
          x: station.x, z: station.z };
        break;
      }
      if (full && i > 0 && i % 512 === 0)
        console.log("S005_REAL_ROUTE_PROGRESS", JSON.stringify({
          checked: i, total: limit, elapsedMs: performance.now() - started }));
      const station = segmented.stations[i], surface = finalSurfaceAt(station.x, station.z),
        localRoadSlope = surface.deckHeight === null && surface.traversal === "open" && surface.walkable
          ? finalSurfaceLocalSlopeAt(station.x, station.z) : undefined,
        failure = sampledCorridorStationFailure(station, surface, localRoadSlope);
      if (failure) {
        firstUnsafe = { station: i + 1, road: station.edgeCode, cause: failure,
          x: station.x, z: station.z };
        break;
      }
      if (previousHeight !== null) {
        const previous = segmented.stations[i - 1],
          distance = greatCircleDistance(sourceToLonLat(previous.x, previous.z),
            sourceToLonLat(station.x, station.z)),
          grade = distance > 0 ? Math.abs(surface.surfaceHeight - previousHeight) / distance : Infinity;
        maximumIntervalGrade = Math.max(maximumIntervalGrade, grade);
        if (!Number.isFinite(grade) || grade > .08) {
          firstUnsafe = { station: i + 1, road: station.edgeCode,
            cause: "unsafe measured surface interval grade", x: station.x, z: station.z, grade };
          break;
        }
      }
      previousHeight = surface.surfaceHeight;
    }
    if (!full)
      assert.equal(firstUnsafe, null, "first 32 stations of the real source route must retain legal top-surface passage");
    else console.log("S005_REAL_ROUTE_FULL_SURFACE", JSON.stringify({
      canonicalRoads: chain.length, stationCount: segmented.stations.length,
      checked: firstUnsafe?.station ?? limit, firstUnsafe,
      maximumIntervalGrade, elapsedMs: performance.now() - started,
      caveat: "sampled final surface only; between-station and actor passage not certified",
    }));
  }
  if (segmented.status === "ready") {
    assert.ok(segmented.stations.length > 0 &&
      segmented.stations.length <= ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT);
    assert.equal(segmented.stations[0].edgeCode, chain[0]);
    assert.equal(segmented.stations.at(-1)?.edgeCode, chain.at(-1));
  } else {
    assert.equal(segmented.status, "over-budget");
    assert.equal(segmented.stations.length, 0,
      "oversized individual SEED legs remain unproven, never truncated to a false PASS");
  }
  // Test both endpoint physical probes in the SAME graph chain: a legal bridge
  // alone does not certify a disconnected site, and a site alone does not
  // certify an impossible river crossing. These are bounded sampled checks,
  // not a claim of unsampled metre-by-metre actor passage.
  const wrongOwner = transportBridgeSpanAt({ ...bridge!, roadCode: `${crossing!.code}/FOREIGN` }, crossing!);
  assert.equal(wrongOwner.matchingCrossing, false,
    "a matching water span must not certify a bridge assigned to another SEED road");
  assert.equal(sampledBridgeCrossingPass(true, wrongOwner), false,
    "bridge ownership mismatch must fail closed before sampling a foreign road");
  const center = transportBridgeSurfaceAt(bridge!.x, bridge!.z, crossing!.code),
    span = transportBridgeSpanAt(bridge!, crossing!);
  const sampledPass = sampledBridgeCrossingPass(center.centerDeckWalkable, span),
    sampledLegal = center.centerDeckWalkable && span.matchingCrossing &&
      span.deckStationsWalkable && span.bankStationsWalkable &&
      span.approachStationsWalkable && span.approachGradeWithinLimit &&
      span.routeStationsWalkable && span.routeGradeWithinLimit &&
      span.routeStationsTopLegal && span.approachStationsTopLegal;
  assert.equal(sampledPass, sampledLegal,
    "selected bridge cannot report a legal sampled crossing while any final-surface gate fails");
  if (!sampledPass) {
    assert.ok(!span.routeStationsTopLegal || !span.approachStationsTopLegal ||
      !span.routeGradeWithinLimit || !span.approachGradeWithinLimit ||
      !center.centerDeckWalkable || !span.deckStationsWalkable ||
      !span.bankStationsWalkable || !span.routeStationsWalkable,
      "unsafe sampled bridge must retain an identifiable failed physical-surface gate");
    if (!span.routeStationsTopLegal) assert.ok(span.routeFirstUnsafeCause,
      "a top-route failure must retain the exact first unsafe source reason");
    if (!span.approachStationsTopLegal) assert.ok(span.approachFirstUnsafeCause,
      "a bank-local failure must retain its first unsafe bank cause");
  }
  assert.ok(span.routeStations > 0 && span.routeStations <= 49,
    "source-owned crossing evidence must remain station bounded");
  const parentCode = siteAccessParentRoadCode(access!);
  assert.ok(parentCode && edgeByCode.has(parentCode),
    "site branch must name its actual incident parent road");
  const stations = siteAccessRoadStations(access!),
    surfaces = stations.map(point => finalSurfaceAt(point.x, point.z)),
    // Use real canonical local gradients on this SAME gate/Y/bridge/site witness,
    // not the pre-S005 omission path that could accidentally certify open pads.
    localSlopes = stations.map((point, i) =>
      surfaces[i].deckHeight === null && surfaces[i].traversal === "open" && surfaces[i].walkable
        ? finalSurfaceLocalSlopeAt(point.x, point.z) : null),
    incidentRoadCodes = new Set((index.adjacency.get(access!.to) ?? [])
      .map(step => step.edge.code)),
    siteVerdict = siteAccessSampleVerdict(access!, surfaces, incidentRoadCodes, localSlopes);
  assert.ok(incidentRoadCodes.has(parentCode!),
    "the access branch's named parent must be incident to its actual graph junction");
  const physicalTerminal = stations.at(-1)!,
    parentRoad = roads.find(road => road.code === parentCode);
  assert.ok(parentRoad && roadEndpointMeetsTerminal(parentRoad, physicalTerminal),
    "the named parent must physically end at the registered site-branch junction");
  // Settlement pads may also contribute at a short, in-settlement Y stem.
  // Select the road owner, rather than mistaking a city/village pad for a road.
  const terminalWinner = surfaces.at(-1)?.contributingModifierIds.find(code => code !== access!.code && edgeByCode.has(code));
  assert.ok(terminalWinner && incidentRoadCodes.has(terminalWinner),
    "the final-surface junction winner must be an actual incident SEED graph road");
  assert.ok(edgeByCode.has(terminalWinner),
    "the sampled owner is a real canonical road, not a detached surface modifier");
  const winnerRoad = roads.find(road => road.code === terminalWinner);
  assert.ok(winnerRoad && roadEndpointMeetsTerminal(winnerRoad, physicalTerminal),
    "a different winning incident road must terminate at this exact SEED junction");
  assert.ok(stations.length > 0 && stations.length <= SITE_ACCESS_STATION_LIMIT,
    "selected critical-site station profile stays bounded");
  assert.ok(siteVerdict.sampledPass,
    `selected site access ${access!.code} (parent ${parentCode}) must remain dry, walkable, source-owned and grade-safe at every sampled station: ${JSON.stringify(siteVerdict)}; terminal contributors: ${JSON.stringify(surfaces.at(-1)?.contributingModifierIds)}`);
  assert.equal(siteVerdict.terminalGeometryOnly, false,
    "a sampled site PASS must have an actual joined-road surface winner, not geometric overlap alone");
  const distance = gateWitness.toY!.distanceM + witness!.toYEdge.surfaceLengthM +
      witness!.bridgeToSite.distanceM,
    fantasySeconds = gateWitness.toY!.fantasyWalkSeconds + witness!.toYEdge.fantasyWalkSeconds +
      witness!.bridgeToSite.fantasyWalkSeconds;
  assert.ok(distance > crossing!.surfaceLengthM && fantasySeconds > crossing!.fantasyWalkSeconds);
  assert.ok(witness!.bridgeToSite.exploredNodes <= index.nodeCount,
    "source graph preview must remain deterministically bounded");
  assert.deepEqual(transportWalkingRouteThroughEdge(
    index, witness!.originCode, crossing!, [site!.code]), witness!.bridgeToSite,
    "repeated queries must retain the identical selected crossing and source-owned site");
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


test("S005 first-authoritative-route timing stays bounded by scale and distinguishes display from computation", () => {
  const timings = createSiteRouteTimings();
  const unavailable = timings.record("1/50", 6, false);
  assert.ok(unavailable);
  timings.markFrame(unavailable, 13, "1/50");
  const ready = timings.record("1/50", 4, true);
  assert.ok(ready);
  timings.markFrame(ready, 14, "1/20"); // A scale switch cannot count under 1/50.
  timings.markFrame(ready, 3, "1/50"); // An impossible earlier-frame timestamp must not count.
  assert.equal(timings.record("≈ 1/50", 1, true), null,
    "interpolated zoom is not falsely reported as an exact acceptance scale");
  assert.equal(timings.record("1/250", Infinity, true), null);
  for (let i = 0; i < SITE_ROUTE_TIMING_LIMIT + 8; i++)
    timings.record("1/20", i, true);
  const snap = timings.snapshot();
  assert.deepEqual(Object.keys(snap), [...SITE_ROUTE_MEASURED_SCALES]);
  assert.equal(snap["1/20"].samples, SITE_ROUTE_TIMING_LIMIT);
  assert.equal(snap["1/20"].calculationP95Ms, SITE_ROUTE_TIMING_LIMIT + 6,
    "nearest-rank p95 must discard old samples and never grow without bound");
  assert.equal(snap["1/50"].samples, 2);
  assert.equal(snap["1/50"].ready, 1);
  assert.equal(snap["1/50"].unavailable, 1);
  assert.equal(snap["1/50"].displayOpportunities, 1,
    "a display opportunity at another scale cannot contaminate 1/50 timing");
  assert.equal(snap["1/50"].displayFrameOpportunityP95Ms, 13);
  assert.equal(snap["1/100"].calculationP95Ms, null,
    "no physical-browser samples must never be mislabeled measured PASS");
});

test("S005 on-demand surface batch always advances one station and yields after finite frame budget", () => {
  assert.equal(TRANSPORT_PROBE_FRAME_BUDGET_MS, 6);
  assert.equal(transportProbeFrameBudgetReached(0, 100), false,
    "a slow first station cannot create a zero-progress animation-frame loop");
  assert.equal(transportProbeFrameBudgetReached(1, 5.99), false);
  assert.equal(transportProbeFrameBudgetReached(1, 6), true);
  assert.equal(transportProbeFrameBudgetReached(4, 12), true);
  assert.equal(transportProbeFrameBudgetReached(8, Infinity), true,
    "invalid elapsed time cannot authorize more expensive station queries");
});
