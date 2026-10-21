import assert from "node:assert/strict";
import test from "node:test";
import {naturalSurfaceAt} from "../src/hydrology.ts";
import { places, roads, villages } from "../src/geography.ts";
import { WORLD_BUILDING_PRIORITIES } from "../src/final-surface.ts";
import { transportBridgeSpanAt, transportBridgeSurfaceAt } from "../src/transport-bridge-surface.ts";
import { freshwaterCrossingAt } from "../src/hydrology.ts";
import { transportNetwork } from "../src/transport-network.ts";
import { sourceToLonLat, CANONICAL_METRES_PER_SOURCE_UNIT } from "../src/planet.ts";
import {
  RURAL_BRIDGE_MAX_LENGTH_M,
  finalSurfaceEvidenceAnchors,
  finalSurfaceAt,
  finalSurfaceDebugAt,
  finalSurfaceTelemetry,
  resetFinalSurfaceTelemetry,
} from "../src/world.ts";

const EPS = 1e-9;

test("settlement terraces use one bounded priority-7 final-surface modifier", () => {
  const village = villages[0];
  assert.ok(village);
  const debug = finalSurfaceDebugAt(village.x, village.z),
    pad = debug.modifiers.find((modifier) => modifier.id === `${village.code}/PAD`);
  assert.ok(pad, "village centre must expose its canonical pad modifier");
  assert.equal(pad.priority, WORLD_BUILDING_PRIORITIES.village);
  const delta = debug.final.groundHeight - debug.base.groundHeight;
  assert.ok(delta >= -3 - EPS && delta <= 3 + EPS, `village terrace delta ${delta} exceeded ±3m`);
  assert.equal(debug.final.vegetationDensityScale, 0);
});

test("priority-9 keep site is inspectable and wins the reserved-use channel", () => {
  const place = places[0];
  assert.ok(place);
  const debug = finalSurfaceDebugAt(place.x - 30, place.z - 28),
    site = debug.modifiers.find((modifier) => modifier.id === `${place.code}/SITE/KEEP`);
  assert.ok(site, "representative keep must expose a priority-9 site modifier");
  assert.equal(site.priority, WORLD_BUILDING_PRIORITIES.site);
  assert.equal(debug.final.reservedUse, `${place.code}/SITE/KEEP`);
  assert.equal(debug.final.vegetationDensityScale, 0);
});

test("road cut/fill is bounded, priority-8, and includes real cut evidence", () => {
  let checked = 0,
    deepestCut = 0,
    highestFill = 0;
  for (const road of roads.slice(0, 24)) {
    for (let index = 1; index < 10; index++) {
      const t = index / 10,
        x = road.fromX + (road.toX - road.fromX) * t,
        z = road.fromZ + (road.toZ - road.fromZ) * t,
        debug = finalSurfaceDebugAt(x, z),
        modifier = debug.modifiers.find((candidate) => candidate.id === road.code);
      if (!modifier || debug.base.water.kind !== "none") continue;
      assert.equal(modifier.priority, WORLD_BUILDING_PRIORITIES.road);
      const delta = debug.final.groundHeight - debug.base.groundHeight;
      assert.ok(delta >= -4 - EPS, `road cut ${delta} exceeded 4m at ${road.code}`);
      assert.ok(delta <= 3 + EPS, `road fill ${delta} exceeded 3m at ${road.code}`);
      deepestCut = Math.min(deepestCut, delta);
      highestFill = Math.max(highestFill, delta);
      checked++;
    }
  }
  assert.ok(checked >= 24, `expected representative dry road samples, got ${checked}`);
  assert.ok(deepestCut < -0.05, `expected a visible road cut, deepest was ${deepestCut}m`);
  assert.ok(highestFill >= 0, "road earthwork scan must remain numerically sane");
});

test("bridge deck preserves authoritative water and obeys the 120m rural cap", () => {
  const anchors=finalSurfaceEvidenceAnchors();
  assert.ok(anchors.bridgeSpanM>0&&anchors.bridgeSpanM<=RURAL_BRIDGE_MAX_LENGTH_M);
  const bridge=finalSurfaceDebugAt(anchors.bridge.x,anchors.bridge.z);
  assert.notEqual(bridge.base.water.kind, "none");
  assert.equal(bridge.final.water.kind, bridge.base.water.kind);
  assert.equal(bridge.final.groundHeight, bridge.base.groundHeight);
  assert.equal(bridge.final.groundMaterial, bridge.base.material);
  assert.equal(bridge.final.material, "Bridge");
  assert.equal(bridge.final.deckMaterial, "Bridge");
  assert.equal(bridge.final.traversal, "bridge");
  assert.ok(bridge.final.deckHeight! >= bridge.base.water.level + 1);
});

test("S005 bridge inspector distinguishes final-surface deck truth from a crossing record", () => {
  const anchor = finalSurfaceEvidenceAnchors().bridge;
  const valid = transportBridgeSurfaceAt(anchor.x, anchor.z);
  assert.equal(valid.centerDeckWalkable, true, "legal observed bridge must have a walkable final-surface deck");
  assert.ok(valid.deckHeight !== null);
  assert.equal(valid.traversal, "bridge");

  const village = villages[0];
  const dry = transportBridgeSurfaceAt(village.x, village.z);
  assert.equal(dry.centerDeckWalkable, false, "an ordinary dry world point must not be labeled a walkable bridge");
});

test("S005 on-demand bridge span probe matches source crossing and rejects false bridge identities", () => {
  const evidence = finalSurfaceEvidenceAnchors(), point = evidence.bridge,
    crossing = freshwaterCrossingAt(point.x, point.z, evidence.bridgeTangent.x, evidence.bridgeTangent.z),
    edge = transportNetwork.roadEdges.find(candidate => candidate.code === evidence.roadCode);
  assert.ok(crossing, "known legal bridge must have a source-owned natural crossing");
  assert.ok(edge, "known legal physical bridge must retain its graph edge");
  const bridge = {
    code: `${edge!.code}/BRIDGE/TEST`, roadCode: edge!.code,
    position: sourceToLonLat(point.x, point.z),
    x: point.x, z: point.z, spanM: crossing!.spanM, drainageCode: crossing!.code,
  };
  const observed = transportBridgeSpanAt(bridge, edge!);
  assert.equal(observed.matchingCrossing, true);
  const displacedBridge = {
    ...bridge,
    x: bridge.x - evidence.bridgeTangent.z * 0.5,
    z: bridge.z + evidence.bridgeTangent.x * 0.5,
  };
  const offRoad = transportBridgeSpanAt(displacedBridge, edge!);
  assert.equal(offRoad.matchingCrossing, false,
    "a bridge more than 2 m off its recorded road cannot pass the physical anchor match");
  assert.equal(offRoad.wetStations, 0, "off-road evidence must not sample an unrelated river deck");
  assert.equal(observed.wetStations, 5, "the selected bridge, not the full atlas, gets bounded wet-span sampling");
  assert.equal(observed.approachStations, 10, "probe only two bounded five-station bank approaches");
  assert.ok(observed.routeStations > 10 && observed.routeStations <= 49,
    "selected-bridge road/deck/bank sampling must be dense but strictly bounded");
  assert.equal(typeof observed.routeStationsOnRoad, "boolean");
  if (!observed.routeStationsOnRoad) assert.equal(observed.routeStationsWalkable, false,
    "off-road bridge stations cannot prove connected walkability");
  assert.equal(observed.routeGradeWithinLimit,
    observed.routeStationsWalkable && observed.routeMaxSampledGrade! <= .08);
  assert.ok(observed.routeMaxSampledGrade !== null && Number.isFinite(observed.routeMaxSampledGrade));
  assert.equal(typeof observed.approachStationsOnRoad, "boolean");
  if (!observed.approachStationsOnRoad) assert.equal(observed.approachStationsWalkable, false,
    "off-road tangent samples can never certify a physical road approach");
  assert.ok(observed.approachMaxSampledGrade !== null &&
    Number.isFinite(observed.approachMaxSampledGrade) && observed.approachMaxSampledGrade >= 0);
  assert.equal(observed.approachGradeWithinLimit, observed.approachStationsOnRoad && observed.approachMaxSampledGrade! <= .08);
  assert.deepEqual(transportBridgeSpanAt(bridge, edge!), observed, "sampled verdict must be deterministic");

  // A short graph segment can point across the same river without covering the
  // tangent extrapolation 18 m beyond both banks. Never certify those off-road samples.
  const tangent = evidence.bridgeTangent, magnitude = Math.hypot(tangent.x, tangent.z),
    halfUnit = .5 / CANONICAL_METRES_PER_SOURCE_UNIT,
    shortStations = [-1, 1].map(sign => {
      const x = point.x + sign * tangent.x / magnitude * halfUnit,
        z = point.z + sign * tangent.z / magnitude * halfUnit;
      return { ...edge!.centerline[0], x, z, position: sourceToLonLat(x, z) };
    }),
    shortEdge = { ...edge!, centerline: shortStations };
  const shortSpan = transportBridgeSpanAt(bridge, shortEdge);
  assert.equal(shortSpan.matchingCrossing, true, "matched river record alone cannot prove road extent");
  assert.equal(shortSpan.approachStationsOnRoad, false, "road must extend to the sampled bank stations");
  assert.equal(shortSpan.approachStationsWalkable, false, "walkable off-road ground is not a road approach");
  assert.equal(shortSpan.routeStationsOnRoad, false, "a short road cannot cover the recorded whole crossing");
  assert.equal(shortSpan.routeStationsWalkable, false, "missing source-owned road prevents sampled route certification");
  assert.equal(shortSpan.routeGradeWithinLimit, false, "off-road stations cannot certify grade");

  const falseSpan = transportBridgeSpanAt({ ...bridge, spanM: bridge.spanM + 500 }, edge!);
  assert.equal(falseSpan.matchingCrossing, false, "a wrong graph span must never be certified by a nearby deck");
  assert.equal(falseSpan.wetStations, 0);
  assert.equal(falseSpan.deckStationsWalkable, false);
  assert.equal(falseSpan.bankStationsWalkable, false);
  assert.equal(falseSpan.approachStations, 0);
  assert.equal(falseSpan.approachStationsOnRoad, false);
  assert.equal(falseSpan.routeStations, 0);
  assert.equal(falseSpan.routeStationsOnRoad, false);
  assert.equal(falseSpan.routeStationsWalkable, false);
  assert.equal(falseSpan.routeMaxSampledGrade, null);
  assert.equal(falseSpan.routeGradeWithinLimit, false);
  assert.equal(falseSpan.approachMaxSampledGrade, null);
  assert.equal(falseSpan.approachStationsWalkable, false);
  assert.equal(falseSpan.approachGradeWithinLimit, false);
});

test("outside all modifier support, final ground/material/water channels are unchanged", () => {
  const probes = [
    [-60_000, 18_000],
    [60_000, -18_000],
    [-48_000, -32_000],
    [48_000, 32_000],
    [0, 48_000],
  ] as const;
  const debug = probes
    .map(([x, z]) => finalSurfaceDebugAt(x, z))
    .find((sample) => sample.modifiers.length === 0);
  assert.ok(debug, "expected an unmodified representative probe");
  assert.equal(debug.final.groundHeight, debug.base.groundHeight);
  assert.equal(debug.final.groundMaterial, debug.base.material);
  assert.deepEqual(debug.final.water, debug.base.water);
  assert.equal(debug.final.vegetationDensityScale, debug.base.vegetationDensityScale);
  assert.equal(debug.final.reservedUse, debug.base.reservedUse);
});

test("final-surface memoization is bounded and exposes deterministic hit/miss telemetry", () => {
  resetFinalSurfaceTelemetry();
  const first = finalSurfaceAt(12_345.25, -4_321.75),
    second = finalSurfaceAt(12_345.25, -4_321.75),
    telemetry = finalSurfaceTelemetry();
  assert.deepEqual(second, first);
  assert.equal(telemetry.queries, 2);
  assert.equal(telemetry.cacheMisses, 1);
  assert.equal(telemetry.cacheHits, 1);
  assert.ok(telemetry.cacheSize <= telemetry.cacheLimit);
  assert.ok(telemetry.worstModifierCandidates <= 128, `unbounded modifier candidates: ${telemetry.worstModifierCandidates}`);
});

test("a legal deck has one cross-road stage instead of separate side profiles", () => {
  const anchors = finalSurfaceEvidenceAnchors();
  const road = roads.find(r => r.code === anchors.roadCode)!;
  const {x:dx,z:dz}=anchors.bridgeTangent,length=1;
  const centre=finalSurfaceAt(anchors.bridge.x,anchors.bridge.z);
  for(const offset of [-1,1]) {
    const side=finalSurfaceAt(anchors.bridge.x-dz/length*offset,anchors.bridge.z+dx/length*offset);
    assert.ok(side.deckHeight!==null,"crossing width must retain its explicit deck");
    assert.ok(Math.abs(side.deckHeight!-centre.deckHeight!)<1e-6,"deck stage must agree across its width");
  }
});


test("the real crossing bank overlap cannot create a shelf over its channel", () => {
  // Fixed natural-bank regression from the pre-macro-migration accepted bridge.
  // Its drainage geometry is unchanged even when a new road becomes the first fixture.
  const p={x:-48043.193970910186,z:9479.86581568643};
  const channel=naturalSurfaceAt(p.x,p.z);
  const bank=naturalSurfaceAt(p.x+3.75,p.z+6.75);
  assert.equal(channel.water.kind,"river");
  assert.equal(bank.material,"Riverbank");
  assert.equal(bank.water.kind,"none");
  assert.ok(bank.groundHeight>=channel.water.level);
  assert.ok(bank.groundHeight<=channel.water.level+1,"overlapping banks conceal the real crossing");
});
