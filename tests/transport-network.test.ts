import { test } from "node:test";
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
import { SOURCE_PRESENTATION_WIDTH, sourceToLonLat } from "../src/planet.ts";
import { polylineTouchesViewport } from "../src/transport-viewport.ts";
import { transportRoadArcStations, transportRoadBankApproaches } from "../src/transport-bridge-surface.ts";
import { createTransportJunctionLookup } from "../src/transport-junction-index.ts";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { createTransportWalkingIndex, transportWalkingRoute, transportWalkingRouteToNearest } from "../src/transport-walking-route.ts";
import { SITE_ACCESS_STATION_LIMIT, siteAccessRoadStations, siteAccessSampleVerdict } from "../src/transport-site-access.ts";
import type { FinalSurface } from "../src/final-surface.ts";
import {
  TRANSPORT_LIMITS,
  type TransportNetwork,
  buildTransportNetwork,
  ensureTransportBridgeEvidence,
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

test("S005 selected site access probe stays bounded and reports sampled physical facts without inventing traversal", () => {
  const accessBranches = siteTransportNetwork.roadEdges.filter(edge =>
    edge.roadClass === "access" && edge.from.includes("/NODE/SITE/"));
  assert.ok(accessBranches.length > 0);
  for (const edge of accessBranches) {
    const stations = siteAccessRoadStations(edge);
    assert.equal(stations.length, edge.centerline.length * 2 - 1, edge.code);
    assert.ok(stations.length <= SITE_ACCESS_STATION_LIMIT, edge.code);
    assert.deepEqual(siteAccessRoadStations(edge), stations);
  }

  const edge = {
    code: "S005/SITE/ACCESS", from: "S005/NODE/SITE/EXAMPLE", roadClass: "access",
    centerline: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
  } as unknown as TransportRoadEdge;
  const stations = siteAccessRoadStations(edge);
  assert.equal(stations.length, 5);
  const surfaces = stations.map((_, i) => ({
    surfaceHeight: i * 0.1,
    water: { kind: "none" },
    walkable: true,
    contributingModifierIds: [edge.code],
  } as unknown as FinalSurface));
  const good = siteAccessSampleVerdict(edge, surfaces);
  assert.equal(good.sampledPass, true);
  assert.equal(good.stationCount, 5);
  assert.equal(good.expectedStations, 5);
  assert.equal(good.onRecordedRoad, true);
  assert.ok(good.maximumGrade !== null && good.maximumGrade < .08);
  assert.deepEqual(siteAccessSampleVerdict(edge, surfaces), good);
  assert.equal(siteAccessSampleVerdict(edge, surfaces.slice(1)).sampledPass, false,
    "missing selected final-surface station must never produce a pass");
  assert.equal(siteAccessSampleVerdict(edge, surfaces.map((s, i) => i === 2 ?
    { ...s, water: { ...s.water, kind: "river" } } as FinalSurface : s)).sampledPass, false);
  assert.equal(siteAccessSampleVerdict(edge, surfaces.map((s, i) => i === 2 ?
    { ...s, contributingModifierIds: [] } : s)).sampledPass, false,
    "the canonical site branch must own sampled road interior");
  assert.equal(siteAccessSampleVerdict(edge, surfaces.map((s, i) => i === 4 ?
    { ...s, contributingModifierIds: ["PARENT/ROAD"] } : s)).sampledPass, true,
    "the physical junction can legitimately be owned by the adjoining parent road");
  assert.equal(siteAccessSampleVerdict(edge, surfaces.map((s, i) => i === 4 ?
    { ...s, surfaceHeight: 30 } : s)).gradeWithinLimit, false);
  assert.equal(siteAccessRoadStations({ ...edge, roadClass: "main" }).length, 0);
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
  const after = transportGenerationTelemetry();
  const afterSummary = transportAcceptanceSummary();
  assert.ok(after.bridgeCacheRoads > 0 && after.bridgeCacheRoads <= after.bridgeCacheLimit);
  assert.ok(after.materializedBridges > 0);
  assert.equal(afterSummary.bridges, after.materializedBridges, "live bridge count must not be cached");
  assert.equal(afterSummary.roads, beforeSummary.roads, "static topology coverage must remain unchanged");
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