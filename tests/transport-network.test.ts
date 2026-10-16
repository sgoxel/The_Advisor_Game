import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPORT_LIMITS,
  buildTransportNetwork,
  transportAcceptanceSummary,
  transportNetwork,
  transportRoadsNear,
  transportSurfaceRoads,
} from "../src/transport-network.ts";
import "../src/world.ts";
import {
  cities,
  continuityCorridor,
  countries,
  roadJunctions,
  roads,
  villages,
} from "../src/geography.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import { greatCircleDistance, wrapSourceX } from "../src/planet.ts";
import { politicalBorderGateways } from "../src/political-settlement-access.ts";

function adjacency(countryCode?: string) {
  const result = new Map<string, string[]>();
  for (const edge of transportNetwork.roadEdges) {
    if (countryCode && !edge.countryCodes.includes(countryCode)) continue;
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      const list = result.get(from) ?? [];
      list.push(to);
      result.set(from, list);
    }
  }
  return result;
}

function reachable(start: string, graph: Map<string, string[]>) {
  const seen = new Set([start]),
    queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++)
    for (const next of graph.get(queue[cursor]) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
}

test("canonical transport reuses every macro road/Y junction and covers every settlement", () => {
  const summary = transportAcceptanceSummary();
  assert.equal(summary.countries, countries.length);
  assert.equal(summary.cities, cities.length);
  assert.equal(summary.villages, villages.length);
  assert.equal(summary.uncoveredNodeCodes.length, 0);
  assert.equal(summary.mandatoryNodes, cities.length + villages.length);
  assert.ok(
    summary.junctions >= roadJunctions.length,
    "all real macro Y junctions must remain graph junctions",
  );

  const nodeBySource = new Map(
    transportNetwork.nodes.map((node) => [node.sourceId, node]),
  );
  for (const country of countries) {
    const local = [...cities, ...villages]
      .filter(
        (place) =>
          place.continent === country.continent && place.country === country.id,
      )
      .map((place) => nodeBySource.get(place.id)!);
    assert.ok(local.length > 0);
    const seen = reachable(local[0].code, adjacency(country.code));
    for (const node of local)
      assert.ok(
        seen.has(node.code),
        `${node.sourceId} must join ${country.code}'s road network`,
      );
  }

  for (const junction of roadJunctions) {
    const node = nodeBySource.get(junction.id)!,
      record = transportNetwork.junctions.find(
        (candidate) => candidate.nodeCode === node.code,
      );
    assert.ok(record, junction.code);
    assert.ok(record!.edgeCodes.length >= 3);
  }
});

test("every capital has a direct canonical main-road link to a foreign capital", () => {
  const capitals = transportNetwork.nodes.filter((node) => node.kind === "capital"),
    international = transportNetwork.roadEdges.filter(
      (edge) => edge.roadClass === "main" && edge.countryCodes.length === 2,
    ),
    physicalPairs = new Set<string>();
  assert.equal(capitals.length, countries.length);
  assert.equal(transportAcceptanceSummary().internationalCapitalLinks, international.length);

  for (const edge of international) {
    const from = transportNetwork.nodes.find((node) => node.code === edge.from)!,
      to = transportNetwork.nodes.find((node) => node.code === edge.to)!,
      pair = edge.countryCodes.join("|");
    assert.equal(from.kind, "capital", `${edge.code} must begin at a capital`);
    assert.equal(to.kind, "capital", `${edge.code} must end at a capital`);
    assert.notEqual(from.countryCode, to.countryCode);
    assert.ok(!physicalPairs.has(pair), `duplicate independent capital line for ${pair}`);
    physicalPairs.add(pair);

    const crossing = transportNetwork.borderCrossings.find(
      (candidate) => candidate.code === edge.borderCrossingCode,
    );
    assert.ok(crossing, edge.code);
    assert.ok(
      politicalBorderGateways.some(
        (gateway) =>
          [gateway.countryCode, gateway.neighbourCountryCode]
            .sort()
            .join("|") === crossing!.countries.join("|"),
      ),
      `${edge.code} must use a canonical political gateway`,
    );
  }

  for (const capital of capitals) {
    const incident = international.filter(
      (edge) => edge.from === capital.code || edge.to === capital.code,
    );
    assert.ok(
      incident.length >= 1,
      `${capital.countryCode} needs a direct foreign-capital main road`,
    );
  }
});

test("roads preserve water, explicit bridges cross rivers, ferries alone connect continents", () => {
  assert.equal(transportNetwork.harbors.length, 3);
  assert.equal(transportNetwork.ferryEdges.length, 2);
  assert.ok(
    transportNetwork.bridges.length > 0,
    "shared transport must expose real river bridge records",
  );
  for (const bridge of transportNetwork.bridges) {
    assert.ok(
      bridge.spanM > 0 && bridge.spanM <= TRANSPORT_LIMITS.ruralBridgeMaxM,
    );
    assert.ok(
      transportNetwork.roadEdges.some(
        (edge) =>
          edge.code === bridge.roadCode && edge.bridgeCodes.includes(bridge.code),
      ),
    );
    assert.equal(naturalSurfaceAt(bridge.x, bridge.z).water.kind, "river");
  }
  const harborNodes = new Set(
    transportNetwork.harbors.map((harbor) => harbor.nodeCode),
  );
  for (const ferry of transportNetwork.ferryEdges) {
    assert.ok(harborNodes.has(ferry.from) && harborNodes.has(ferry.to));
    const from = transportNetwork.nodes.find((node) => node.code === ferry.from)!,
      to = transportNetwork.nodes.find((node) => node.code === ferry.to)!;
    assert.notEqual(from.continent, to.continent);
  }
  for (const edge of transportNetwork.roadEdges) {
    const from = transportNetwork.nodes.find((node) => node.code === edge.from)!,
      to = transportNetwork.nodes.find((node) => node.code === edge.to)!;
    assert.equal(
      from.continent,
      to.continent,
      `${edge.code} cannot fake an intercontinental land road`,
    );
    for (let segment = 1; segment < edge.centerline.length; segment++) {
      const a = edge.centerline[segment - 1],
        b = edge.centerline[segment],
        dx = wrapSourceX(b.x - a.x),
        dz = b.z - a.z;
      for (let step = 0; step <= 12; step++) {
        const t = step / 12,
          surface = naturalSurfaceAt(a.x + dx * t, a.z + dz * t);
        assert.notEqual(surface.water.kind, "lake", `${edge.code} crosses a lake`);
        assert.notEqual(surface.water.kind, "ocean", `${edge.code} crosses ocean`);
      }
    }
  }
});

test("transport graph and rendered geography roads use the same physical road codes", () => {
  const installed = new Set(roads.map((road) => road.code)),
    graph = new Set(transportNetwork.roadEdges.map((edge) => edge.code));
  assert.equal(graph.size, transportNetwork.roadEdges.length);
  assert.deepEqual(
    transportSurfaceRoads.map((road) => road.code).sort(),
    [...graph].sort(),
  );
  for (const code of graph) assert.ok(installed.has(code), code);
  assert.ok(continuityCorridor.road && graph.has(continuityCorridor.road.code));
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.roadClass === "main"));
  assert.ok(
    transportNetwork.roadEdges.some((edge) => edge.roadClass === "regional"),
  );
  assert.ok(transportNetwork.roadEdges.some((edge) => edge.roadClass === "access"));
  for (const edge of transportNetwork.roadEdges) {
    const surface = transportSurfaceRoads.find((road) => road.code === edge.code)!,
      measured = edge.centerline
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum +
            greatCircleDistance(edge.centerline[index].position, point.position),
          0,
        );
    assert.ok(Math.abs(surface.surfaceLengthM - measured) < 1e-6);
  }
});

test("same seed rebuild is identical and bounded focus queries stay capped", () => {
  const rebuilt = buildTransportNetwork();
  assert.equal(rebuilt.digest, transportNetwork.digest);
  assert.deepEqual(
    rebuilt.roadEdges.map((edge) => [
      edge.code,
      edge.from,
      edge.to,
      edge.bridgeCodes,
    ]),
    transportNetwork.roadEdges.map((edge) => [
      edge.code,
      edge.from,
      edge.to,
      edge.bridgeCodes,
    ]),
  );
  const focus = transportNetwork.nodes.find((node) => node.kind === "village")!,
    local = transportRoadsNear(focus.x, focus.z, 4_000);
  assert.ok(local.length > 0 && local.length <= TRANSPORT_LIMITS.queryRoadLimit);
  assert.throws(() => transportRoadsNear(focus.x, focus.z, 20_000), RangeError);
});
