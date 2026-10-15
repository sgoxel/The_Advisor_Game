import { test } from "node:test";
import assert from "node:assert/strict";
// S005 acceptance runs against the same installed road authority used by world/routing.
import "../src/world.ts";
import { cities, countries, roads, villages } from "../src/geography.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import {
  TRANSPORT_LIMITS,
  buildTransportNetwork,
  transportAcceptanceSummary,
  transportNetwork,
  transportRoadsNear,
  transportSurfaceRoads,
} from "../src/transport-network.ts";

function adjacency(countryCode?: string) {
  const result = new Map<string, string[]>();
  for (const edge of transportNetwork.roadEdges) {
    if (countryCode && !edge.countryCodes.includes(countryCode)) continue;
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const list = result.get(from) ?? [];
      list.push(to);
      result.set(from, list);
    }
  }
  return result;
}

function reachable(start: string, graph: Map<string, string[]>) {
  const seen = new Set([start]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of graph.get(queue[cursor]) ?? []) if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

test("canonical transport topology covers every generated settlement with real shared junctions", () => {
  const summary = transportAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.cities, cities.length);
  assert.equal(summary.villages, villages.length);
  assert.equal(summary.uncoveredNodeCodes.length, 0);
  assert.equal(summary.mandatoryNodes, cities.length + villages.length);
  assert.ok(summary.junctions >= cities.length, "city approaches should create shared canonical junctions");

  const nodeBySource = new Map(transportNetwork.nodes.map((node) => [node.sourceId, node]));
  for (const country of countries) {
    const cityNodes = cities.filter((city) => city.continent === country.continent && city.country === country.id).map((city) => nodeBySource.get(city.id)!);
    const villageNodes = villages.filter((village) => village.continent === country.continent && village.country === country.id).map((village) => nodeBySource.get(village.id)!);
    const graph = adjacency(country.code), seen = reachable(cityNodes[0].code, graph);
    for (const node of [...cityNodes, ...villageNodes]) assert.ok(seen.has(node.code), `${node.code} must join ${country.code}'s road network`);
  }

  for (const junction of transportNetwork.junctions) {
    assert.ok(junction.edgeCodes.length >= 3);
    const incident = transportNetwork.roadEdges.filter((edge) => edge.from === junction.nodeCode || edge.to === junction.nodeCode);
    assert.ok(incident.length >= 3);
    const node = transportNetwork.nodes.find((candidate) => candidate.code === junction.nodeCode)!;
    for (const edge of incident) {
      const endpoint = edge.from === node.code ? edge.centerline[0] : edge.centerline.at(-1)!;
      assert.equal(endpoint.position.lon, node.position.lon);
      assert.equal(endpoint.position.lat, node.position.lat);
    }
  }
});

test("every country capital has a same-continent international main-road and explicit border crossing", () => {
  const capitalByCountry = new Map(transportNetwork.nodes.filter((node) => node.kind === "capital").map((node) => [node.countryCode, node]));
  for (const country of countries) {
    const capital = capitalByCountry.get(country.code)!;
    const foreign = transportNetwork.roadEdges.filter((edge) => edge.roadClass === "main" && (edge.from === capital.code || edge.to === capital.code) && edge.countryCodes.length === 2);
    assert.ok(foreign.length > 0, `${country.code} needs an international capital link`);
    assert.ok(foreign.some((edge) => edge.borderCrossingCode));
    for (const edge of foreign) {
      const otherCode = edge.countryCodes.find((code) => code !== country.code)!;
      const other = countries.find((candidate) => candidate.code === otherCode)!;
      assert.equal(other.continent, country.continent);
      assert.ok(edge.borderCrossingCode && transportNetwork.borderCrossings.some((crossing) => crossing.code === edge.borderCrossingCode));
    }
  }
});

test("roads avoid open water, river crossings are typed bridges and ferries alone connect continents", () => {
  assert.equal(transportNetwork.harbors.length, 3);
  assert.equal(transportNetwork.ferryEdges.length, 2);
  assert.ok(transportNetwork.bridges.length > 0, "generated road network should encounter explicit legal river bridges");
  for (const bridge of transportNetwork.bridges) {
    assert.ok(bridge.spanM > 0 && bridge.spanM <= TRANSPORT_LIMITS.ruralBridgeMaxM);
    assert.ok(transportNetwork.roadEdges.some((edge) => edge.code === bridge.roadCode && edge.bridgeCodes.includes(bridge.code)));
  }
  const harborCodes = new Set(transportNetwork.harbors.map((harbor) => harbor.nodeCode));
  for (const ferry of transportNetwork.ferryEdges) {
    assert.ok(harborCodes.has(ferry.from) && harborCodes.has(ferry.to));
    const from = transportNetwork.nodes.find((node) => node.code === ferry.from)!, to = transportNetwork.nodes.find((node) => node.code === ferry.to)!;
    assert.notEqual(from.continent, to.continent);
  }
  for (const edge of transportNetwork.roadEdges) {
    const from = transportNetwork.nodes.find((node) => node.code === edge.from)!, to = transportNetwork.nodes.find((node) => node.code === edge.to)!;
    assert.equal(from.continent, to.continent, `${edge.code} cannot fake an intercontinental land road`);
    for (let segment = 1; segment < edge.centerline.length; segment++) {
      const a = edge.centerline[segment - 1], b = edge.centerline[segment], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z;
      for (let step = 0; step <= 8; step++) {
        const t = step / 8, x = a.x + dx * t, z = a.z + dz * t, surface = naturalSurfaceAt(x, z);
        assert.notEqual(surface.water.kind, "lake", `${edge.code} crosses a lake`);
        assert.notEqual(surface.water.kind, "ocean", `${edge.code} crosses ocean`);
      }
    }
  }
});

test("transport road records are the final shared geography roads with deterministic lengths and hierarchy", () => {
  const installed = new Set(roads.map((road) => road.code));
  for (const road of transportSurfaceRoads) assert.ok(installed.has(road.code));
  assert.equal(new Set(transportSurfaceRoads.map((road) => road.code)).size, transportSurfaceRoads.length);
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.roadClass === "main"));
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.roadClass === "regional"));
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.roadClass === "access"));
  for (const road of transportSurfaceRoads) {
    assert.ok(road.centerline && road.centerline.length >= 2);
    const length = road.centerline.slice(1).reduce((sum, point, index) => sum + greatCircleDistance(sourceToLonLat(road.centerline![index].x, road.centerline![index].z), sourceToLonLat(point.x, point.z)), 0);
    assert.ok(Math.abs(length - road.surfaceLengthM) < 1e-6);
    assert.ok(road.surfaceLengthM >= 3_600);
  }
});

test("same seed rebuilds identical topology/profile digest and bounded focus queries stay capped", () => {
  const rebuilt = buildTransportNetwork();
  assert.equal(rebuilt.digest, transportNetwork.digest);
  assert.deepEqual(rebuilt.roadEdges.map((edge) => [edge.code, edge.routeCandidate, edge.centerline.map((point) => [point.x, point.z, point.elevationM])]), transportNetwork.roadEdges.map((edge) => [edge.code, edge.routeCandidate, edge.centerline.map((point) => [point.x, point.z, point.elevationM])]));
  const focus = transportNetwork.nodes[0], local = transportRoadsNear(focus.x, focus.z, 4_000);
  assert.ok(local.length > 0 && local.length <= TRANSPORT_LIMITS.queryRoadLimit);
  assert.throws(() => transportRoadsNear(focus.x, focus.z, 20_000), RangeError);
});
