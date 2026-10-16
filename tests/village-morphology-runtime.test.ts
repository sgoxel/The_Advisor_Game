import test from "node:test";
import assert from "node:assert/strict";
import { cities, villages, roadDistanceAt, roads, type Place } from "../src/geography.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { featuresFor, finalSurfaceAt, tileForPosition } from "../src/world.ts";
import { wrapSourceX } from "../src/planet.ts";

const REQUIRED_SERVICES = [
  "market",
  "inn",
  "blacksmith",
  "butcher",
  "guard-office",
  "farmstead",
  "merchant",
  "headman",
] as const;

function segmentDistance(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = wrapSourceX(bx - ax),
    dz = bz - az,
    px = wrapSourceX(x - ax),
    pz = z - az,
    denominator = dx * dx + dz * dz,
    t = denominator ? Math.max(0, Math.min(1, (px * dx + pz * dz) / denominator)) : 0;
  return Math.hypot(px - dx * t, pz - dz * t);
}

function runtimeFeatures(place: Place) {
  const plan = settlementExteriorFor(place),
    tiles = new Map<string, ReturnType<typeof tileForPosition>>(),
    include = (x: number, z: number) => {
      const tile = tileForPosition(x, z, 8);
      tiles.set(tile.key, tile);
    };
  include(place.x, place.z);
  for (const street of plan.streets) for (const point of street.points) include(point.x, point.z);
  for (const gate of plan.gates) include(gate.x, gate.z);
  for (const plot of plan.plots) for (const candidate of plot.candidates) include(candidate.x, candidate.z);
  const marker = `/F/${place.id}/`, unique = new Map<string, ReturnType<typeof featuresFor>[number]>();
  for (const feature of [...tiles.values()].flatMap((tile) => featuresFor(tile)))
    if (feature.code.includes(marker)) unique.set(feature.code, feature);
  return [...unique.values()];
}

function assertResolvedBuildingLegal(place: Place, feature: ReturnType<typeof featuresFor>[number]) {
  assert.ok(Number.isFinite(feature.entranceX) && Number.isFinite(feature.entranceZ), `${feature.code} lacks a stable entrance`);
  const radius = Math.hypot(feature.footprintWidth || 1, feature.footprintDepth || 1) * .5,
    plan = settlementExteriorFor(place);
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index],
      distance = segmentDistance(feature.x, feature.z, a.x, a.z, b.x, b.z);
    assert.ok(distance >= street.width * .5 + radius, `${feature.code} intrudes into ${street.id}`);
  }
  assert.ok(roads.every((road) => roadDistanceAt(feature.x, feature.z, road) > radius + 5), `${feature.code} intrudes into an external road reserve`);

  const halfWidth = (feature.footprintWidth || 1) * .5,
    halfDepth = (feature.footprintDepth || 1) * .5,
    yaw = feature.yawRad || 0,
    sin = Math.sin(yaw), cos = Math.cos(yaw),
    centre = finalSurfaceAt(feature.x, feature.z);
  for (const [localX, localZ] of [[-halfWidth, -halfDepth], [-halfWidth, halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth]] as const) {
    const x = wrapSourceX(feature.x + localX * cos + localZ * sin),
      z = feature.z - localX * sin + localZ * cos,
      corner = finalSurfaceAt(x, z);
    assert.equal(corner.water.kind, "none", `${feature.code} footprint reaches water`);
    assert.ok(corner.walkable, `${feature.code} footprint reaches non-walkable terrain`);
    assert.ok(Math.abs(corner.groundHeight - centre.groundHeight) <= .34, `${feature.code} footprint exceeds legal grade`);
  }
}

test("every generated village resolves required roles and legal building-road clearance", () => {
  let withRoadsideVegetation = 0,
    withPedestrianEdge = 0,
    gardens = 0;
  for (const place of villages) {
    const features = runtimeFeatures(place),
      services = new Set(features.filter((feature) => feature.kind === "service").map((feature) => feature.service));
    for (const role of REQUIRED_SERVICES)
      assert.ok(services.has(role), `${place.code} did not resolve ${role}`);

    assert.ok(features.some((feature) => feature.kind === "house"), `${place.code} has no resolved homes`);
    assert.ok(features.some((feature) => feature.kind === "garden" && feature.ownerId), `${place.code} has no resolved household garden`);
    assert.ok(features.some((feature) => feature.kind === "path"), `${place.code} has no resolved building access path`);
    if (features.some((feature) => feature.kind === "pavement")) withPedestrianEdge++;
    if (features.some((feature) => feature.kind === "roadside-tree")) withRoadsideVegetation++;
    gardens += features.filter((feature) => feature.kind === "garden").length;

    for (const feature of features.filter((feature) => ["house", "keep", "service"].includes(feature.kind)))
      assertResolvedBuildingLegal(place, feature);
  }
  assert.ok(villages.length >= 270);
  assert.ok(gardens >= villages.length, "generated villages should retain household garden records");
  assert.ok(withPedestrianEdge >= Math.ceil(villages.length * 0.8), "pedestrian/public edges should survive terrain in representative villages");
  assert.ok(withRoadsideVegetation >= Math.ceil(villages.length * 0.45), "roadside vegetation should survive in representative villages");
});

test("every generated city resolves services and enough legal housing for its canonical population", () => {
  for (const place of cities) {
    const features = runtimeFeatures(place),
      services = new Set(features.filter((feature) => feature.kind === "service").map((feature) => feature.service)),
      homes = features.filter((feature) => feature.kind === "house");
    for (const role of REQUIRED_SERVICES)
      assert.ok(services.has(role), `${place.code} did not resolve ${role}`);
    assert.ok(homes.length >= 80, `${place.code} resolved only ${homes.length} homes`);
    assert.equal(homes.reduce((sum, home) => sum + (home.residents || 0), 0), 2400, `${place.code} rendered homes do not account for canonical residents`);
    assert.ok(homes.reduce((sum, home) => sum + (home.capacity || 0), 0) >= 2400, `${place.code} rendered housing capacity is below canonical population`);
    for (const feature of features.filter((feature) => ["house", "keep", "service"].includes(feature.kind)))
      assertResolvedBuildingLegal(place, feature);
  }
  assert.ok(cities.length >= 90);
});

test("runtime village morphology is visit-order stable for representative archetypes", () => {
  const samples = villages.slice(0, Math.min(16, villages.length)),
    fingerprint = (place: Place) => runtimeFeatures(place)
      .map((feature) => [feature.code, feature.kind, feature.service || "", feature.x, feature.z, feature.yawRad || 0, feature.footprintWidth || 0, feature.footprintDepth || 0].join("|"))
      .sort();
  const baseline = new Map(samples.map((place) => [place.id, fingerprint(place)]));
  for (const place of [...samples].reverse())
    assert.deepEqual(fingerprint(place), baseline.get(place.id), `${place.code} changed after reversed visit order`);
});
