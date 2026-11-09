import test from "node:test";
import assert from "node:assert/strict";
import {
  NIGHT_END_SECOND, NIGHT_START_SECOND, SECONDS_PER_DAY,
  isNightSecond, litBuildingCodes, litSetKey, mergeGlowGeometry, residentLightsBuilding,
  type LitBuilding, type LitResident,
} from "../src/night-lighting.ts";
import { daylightAt } from "../src/daylight.ts";
import { residentInsideRenderedService, residentOccupiesBuilding } from "../src/simulation.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { buildTile } from "../src/geometry.ts";
import { villages } from "../src/geography.ts";
import { tileForPosition } from "../src/world.ts";

const H = 3600;
const at = (hour: number) => Math.round(hour * H);

test("canonical darkness is exactly 22:00-04:59 local and never earlier", () => {
  assert.equal(NIGHT_START_SECOND, at(22));
  assert.equal(NIGHT_END_SECOND, at(5));
  assert.equal(isNightSecond(at(21.99)), false, "21:59 is still cosmetic dusk");
  assert.equal(isNightSecond(at(22)), true, "22:00 begins authoritative darkness");
  assert.equal(isNightSecond(at(23.5)), true);
  assert.equal(isNightSecond(0), true);
  assert.equal(isNightSecond(at(4.99)), true, "04:59 is still night");
  assert.equal(isNightSecond(at(5)), false, "05:00 is dawn");
  assert.equal(isNightSecond(at(12)), false);
  assert.equal(isNightSecond(at(20.5)), false, "the old 20:30 night label is gone");
  // Wrap-safe: the same second on another day and negative ticks agree.
  assert.equal(isNightSecond(at(22) + SECONDS_PER_DAY), true);
  assert.equal(isNightSecond(at(22) - SECONDS_PER_DAY), true);
  assert.equal(isNightSecond(Number.NaN), false);
});

test("daylight reports the canonical night flag and an honest phase label", () => {
  assert.equal(daylightAt(at(21.99)).night, false);
  assert.equal(daylightAt(at(22)).night, true);
  assert.equal(daylightAt(at(4.99)).night, true);
  assert.equal(daylightAt(at(5)).night, false);
  // Phase may be artistically "dusk" before 22:00, but "night" only inside the window.
  assert.equal(daylightAt(at(20.5)).phase, "dusk");
  assert.equal(daylightAt(at(22)).phase, "night");
  assert.equal(daylightAt(at(12)).phase, "day");
  assert.equal(daylightAt(at(5.5)).phase, "dawn");
});

const home: LitBuilding = {
  code: "W/P/RESIDENCE/7", kind: "residence", x: 100, z: 50,
  widthM: 6, depthM: 8, yawRad: 0,
};
const neighbour: LitBuilding = { ...home, code: "W/P/RESIDENCE/8" };

const resident = (over: Partial<LitResident> = {}): LitResident => ({
  indoors: true, route: "P/RESIDENCE/7/ENTRANCE", homeBuilding: "P/RESIDENCE/7",
  homeEntrance: "P/RESIDENCE/7/ENTRANCE", workplace: "P/SERVICE/FARMSTEAD",
  x: 100, z: 50, ...over,
});

test("an empty house is dark at every hour of the night window", () => {
  for (const hour of [22, 23, 0, 3, 4.99])
    assert.equal(litBuildingCodes([], [home], at(hour)).size, 0, `empty house lit at ${hour}`);
});

test("a resident home indoors lights only their own house, only inside 22:00-05:00", () => {
  const people = [resident()];
  for (const hour of [22, 23, 0, 3, 4.99]) {
    const lit = litBuildingCodes(people, [home, neighbour], at(hour));
    assert.deepEqual([...lit], [home.code], `house light wrong at ${hour}:00`);
  }
  for (const hour of [21.99, 5, 12, 20.5])
    assert.equal(litBuildingCodes(people, [home, neighbour], at(hour)).size, 0,
      `occupancy light leaked outside the night window at ${hour}`);
});

test("the absent owner, a doorstep resident and a blocked route do not light a house", () => {
  assert.equal(litBuildingCodes([resident({ indoors: false })], [home], at(23)).size, 0, "outdoors owner lit the house");
  assert.equal(litBuildingCodes([resident({ route: "P/RESIDENCE/8/ENTRANCE" })], [home], at(23)).size, 0, "wrong house lit");
  assert.equal(litBuildingCodes([resident({ route: "BLOCKED:P/RESIDENCE/7/ENTRANCE" })], [home], at(23)).size, 0, "blocked route lit");
  // An empty settlement with an unresolved resident list is dark, never glowing.
  assert.equal(litBuildingCodes([], [home, neighbour], at(23)).size, 0);
});

test("an indoor service worker lights only the plot they actually occupy", () => {
  const metric = sourceUnitsPerMetreAt(80);
  const service: LitBuilding = {
    code: "W/P/PLOT/INN", kind: "service", service: "inn",
    x: 300, z: 80, widthM: 10, depthM: 9, yawRad: 0,
  };
  const worker = resident({
    homeBuilding: "P/RESIDENCE/3", route: "P/INN", workplace: "P/SERVICE/INN",
    x: 300, z: 80,
  });
  assert.ok(residentLightsBuilding(worker, service), "an inn worker inside the inn should light it");
  const elsewhere = resident({
    homeBuilding: "P/RESIDENCE/3", route: "P/INN", workplace: "P/SERVICE/INN",
    x: 300 + metric.x * 40, z: 80,
  });
  assert.equal(residentLightsBuilding(elsewhere, service), false, "a distant indoor worker lit the inn");
  assert.equal(litBuildingCodes([worker], [home, service], at(23)).size, 1);
});

test("the light rule matches Simulation's own occupancy verdicts", () => {
  const cases: { resident: LitResident; building: LitBuilding }[] = [
    { resident: resident(), building: home },
    { resident: resident({ indoors: false }), building: home },
    { resident: resident(), building: neighbour },
    {
      resident: resident({
        homeBuilding: "P/RESIDENCE/3", route: "P/INN", workplace: "P/SERVICE/INN", x: 300, z: 80,
      }),
      building: { code: "W/P/PLOT/INN", kind: "service", service: "inn", x: 300, z: 80, widthM: 10, depthM: 9, yawRad: 0 },
    },
    {
      resident: resident({
        homeBuilding: "P/RESIDENCE/3", route: "P/INN", workplace: "P/SERVICE/INN", x: 9000, z: 80,
      }),
      building: { code: "W/P/PLOT/INN", kind: "service", service: "inn", x: 300, z: 80, widthM: 10, depthM: 9, yawRad: 0 },
    },
  ];
  for (const { resident: person, building } of cases) {
    const simulationSays =
      residentOccupiesBuilding(person as never, building as never) &&
      (building.kind !== "service" || residentInsideRenderedService(person as never, building as never));
    assert.equal(residentLightsBuilding(person, building), simulationSays,
      `night lighting drifted from Simulation for ${building.code}`);
  }
});

test("the lit-set key is order independent so callers only rebuild on real change", () => {
  assert.equal(litSetKey([]), "");
  assert.equal(litSetKey(["b", "a"]), litSetKey(["a", "b"]));
  assert.notEqual(litSetKey(["a"]), litSetKey(["a", "b"]));
});

const quad = (offset: number) => ({
  positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  colors: new Uint8Array([255, 186, 82, 255, 255, 186, 82, 255, 255, 186, 82, 255]),
  indices: new Uint32Array([0, 1, 2]),
});

test("merged glow concatenates only the lit buildings and offsets their indices", () => {
  assert.equal(mergeGlowGeometry([]), undefined);
  assert.equal(mergeGlowGeometry([{ ...quad(0), positions: new Float32Array(0), normals: new Float32Array(0), colors: new Uint8Array(0), indices: new Uint32Array(0) }]), undefined);
  const merged = mergeGlowGeometry([quad(0), quad(10)]);
  assert.ok(merged);
  assert.equal(merged.positions.length, 18);
  assert.equal(merged.colors.length, 24);
  assert.deepEqual([...merged.indices], [0, 1, 2, 3, 4, 5]);
  assert.equal(merged.positions[9], 10, "second quad keeps its own offsets");
});

test("close LOD emits per-building window glow and keeps only lamps in the shared layer", () => {
  const place = villages[0],
    close = buildTile(tileForPosition(place.x, place.z, 15)),
    far = buildTile(tileForPosition(place.x, place.z, 12)),
    buildings = close.nightGlowByBuilding ?? [];
  assert.ok(buildings.length > 0, "close LOD must expose per-building glow");
  for (const building of buildings) {
    assert.ok(building.code.length > 0);
    assert.ok(["residence", "service", "keep", "guard-post"].includes(building.kind), building.kind);
    assert.ok(building.widthM > 0 && building.depthM > 0);
    assert.ok(building.geometry.positions.length > 0, "empty glow entry shipped");
  }
  // Windows left the shared tile glow, which now only holds street lamps.
  const shared = close.nightGlow?.indices.length ?? 0,
    perBuilding = buildings.reduce((sum, building) => sum + building.geometry.indices.length, 0);
  assert.ok(perBuilding > shared, "window glow still dominates the ungated layer");
  assert.equal(far.nightGlowByBuilding, undefined, "coarse LOD must not ship close-only glow");
});
