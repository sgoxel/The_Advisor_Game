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
  roads,
  villages,
} from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { sourceToLonLat } from "../src/planet.ts";
import { polylineTouchesViewport } from "../src/transport-viewport.ts";
import { createTransportJunctionLookup } from "../src/transport-junction-index.ts";
import {
  TRANSPORT_LIMITS,
  buildTransportNetwork,
  ensureTransportBridgeEvidence,
  transportAcceptanceSummary,
  transportGenerationTelemetry,
  transportNetwork,
  transportRoadsNear,
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