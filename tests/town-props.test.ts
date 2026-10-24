import test from "node:test";
import assert from "node:assert/strict";
import { cities, villages, type Place } from "../src/geography.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { wrapSourceX } from "../src/planet.ts";
import { settlementExteriorFor, settlementShopFor, visibleSettlementStreetSegments } from "../src/settlement-exterior.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";
import { metresToSource } from "../src/physical-scale.ts";
import { parkFootprintFor } from "../src/settlement-exterior-core.ts";

type Feature = ReturnType<typeof featuresFor>[number];
type Footprint = { x: number; z: number; yawRad: number; widthM: number; depthM: number };

/** Metre containment in a yawed rectangle: width across the yaw, depth along it (the house and lamp convention). */
function insideFootprint(f: Footprint, x: number, z: number, margin = 0) {
  const metric = sourceUnitsPerMetreAt(f.z), dx = wrapSourceX(x - f.x) / metric.x, dz = (z - f.z) / metric.z,
    c = Math.cos(f.yawRad), s = Math.sin(f.yawRad);
  return Math.abs(dx * c - dz * s) < f.widthM / 2 + margin && Math.abs(dx * s + dz * c) < f.depthM / 2 + margin;
}

/** Every distinct tile in a square of `radius` tiles around a place, at one LOD level. */
function tilesAround(place: Place, level: number, radius: number) {
  const size = tileForPosition(place.x, place.z, level).size, tiles = new Map<string, ReturnType<typeof tileForPosition>>();
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const tile = tileForPosition(place.x + dx * size, place.z + dz * size, level);
    tiles.set(tile.key, tile);
  }
  return [...tiles.values()];
}

/** Town features of a place over a tile square. Residences are emitted by every tile near them, so they are de-duplicated by code. */
function townFeatures(place: Place, level: number, radius: number) {
  const seen = new Map<string, Feature>();
  for (const tile of tilesAround(place, level, radius))
    for (const feature of featuresFor(tile)) if (feature.code.includes(`/F/${place.id}/`)) seen.set(feature.code, feature);
  return [...seen.values()];
}

const TOWN_STREET_KINDS = ["bench", "planter"];
const city = cities[0], village = villages[0];
const townCache = new Map<string, Feature[]>();
/** Town features over the 5x5 size-8 tiles around a place (cached: the city is the costly one). */
function townAround(place: Place) {
  let features = townCache.get(place.code);
  if (!features) townCache.set(place.code, (features = townFeatures(place, 15, 2)));
  return features;
}

test("every settlement lays out its squares, playgrounds and flower gardens", () => {
  const expected = new Map<Place, Record<string, number>>([
    [cities[0], { square: 1, playground: 2, "flower-garden": 3 }],
    [cities[Math.floor(cities.length / 2)], { square: 1, playground: 2, "flower-garden": 3 }],
    [villages[0], { square: 1, playground: 1, "flower-garden": 2 }],
    [villages[Math.floor(villages.length / 2)], { square: 1, playground: 1, "flower-garden": 2 }],
  ]);
  for (const [place, counts] of expected) {
    const parks = settlementExteriorFor(place).plots.filter((plot) => plot.kind === "park"), tally: Record<string, number> = {};
    for (const park of parks) tally[park.park!] = (tally[park.park!] || 0) + 1;
    assert.deepEqual(tally, counts, `${place.name} park plan`);
    const square = parks.find((park) => park.park === "square")!, city = place.kind === "city";
    const [widths, depths] = city ? [[24, 38], [18, 28]] : [[16, 26], [12, 20]];
    assert.ok(square.widthM! >= widths[0] && square.widthM! <= widths[1], `${place.name} square width ${square.widthM} m`);
    assert.ok(square.depthM! >= depths[0] && square.depthM! <= depths[1], `${place.name} square depth ${square.depthM} m`);
    assert.ok(square.depthM! <= square.widthM!, `${place.name} square depth never exceeds its width`);
    assert.equal(square.capacity, Math.max(4, Math.round(square.widthM! * square.depthM! / (city ? 12 : 18))), `${place.name} square capacity`);
    assert.equal(square.residents, 0);
  }
});

test("park sizes, outlines and capacities are seeded per park and deterministic", () => {
  for (const place of [cities[0], villages[0], cities[1], villages[1]]) {
    const plots = settlementExteriorFor(place).plots.filter((plot) => plot.kind === "park");
    assert.equal(JSON.stringify(settlementExteriorFor(place).plots.filter((plot) => plot.kind === "park")), JSON.stringify(plots), `${place.name} parks are deterministic`);
    for (const plot of plots) {
      const id = plot.id.slice(`${place.code}/PLOT/`.length), expected = parkFootprintFor(place.code, id, plot.park!, place.kind === "city");
      assert.deepEqual([plot.widthM, plot.depthM, plot.parkShape], [expected.width, expected.depth, expected.shape], `${plot.id} seeded size and outline`);
    }
  }
});

test("squares differ in size and outline across the first eight cities and villages", () => {
  const squares = [...cities.slice(0, 8), ...villages.slice(0, 8)].map((place) => settlementExteriorFor(place).plots.find((plot) => plot.kind === "park" && plot.park === "square")!);
  assert.equal(squares.length, 16);
  const sizes = new Set(squares.map((square) => `${square.widthM}x${square.depthM}`)), shapes = new Set(squares.map((square) => square.parkShape));
  assert.ok(sizes.size > 1, "the squares do not all share one size");
  assert.ok(shapes.size >= 3, `at least 3 distinct square outlines (saw ${[...shapes].join(", ")})`);
});

test("every park feature near the centre of a city and a village carries a valid outline", () => {
  const shapes = ["rect", "cut", "octagon", "round"];
  for (const place of [city, village]) {
    const parks = townAround(place).filter((feature) => feature.kind === "park");
    assert.ok(parks.length > 0, `${place.name}: has parks`);
    for (const park of parks) assert.ok(shapes.includes(park.parkShape!), `${place.name}: ${park.code} parkShape ${park.parkShape}`);
  }
});

test("street furniture stands clear of houses and parks, and the town square is emitted", () => {
  for (const place of [city, village]) {
    const features = townAround(place), residences = features.filter((feature) => feature.kind === "residence"),
      parks = features.filter((feature) => feature.kind === "park");
    for (const kind of ["street-joint", ...TOWN_STREET_KINDS]) assert.ok(features.some((feature) => feature.kind === kind), `${place.name}: ${kind} emitted`);
    assert.ok(parks.some((park) => park.label === "square"), `${place.name}: the town square is emitted`);
    assert.ok(!features.some((feature) => feature.kind === "path" && feature.code.includes("/PLOT/PARK/")), `${place.name}: parks have no access path`);
    for (const feature of features) {
      if (!TOWN_STREET_KINDS.includes(feature.kind)) continue;
      for (const residence of residences) assert.ok(!insideFootprint(residence as Footprint, feature.x, feature.z), `${feature.kind} ${feature.code} inside a house`);
      for (const park of parks) assert.ok(!insideFootprint(park as Footprint, feature.x, feature.z), `${feature.kind} ${feature.code} inside a park`);
    }
  }
});

test("a size-8 tile on the centre of a city shows paved streets, joints, benches and planters", () => {
  const tile = tilesAround(city, 15, 0)[0];
  assert.equal(tile.size, 8);
  const features = featuresFor(tile), kinds = new Set(features.map((feature) => feature.kind));
  for (const kind of ["street-joint", "bench", "planter"]) assert.ok(kinds.has(kind), `centre tile shows ${kind}`);
  assert.ok(!kinds.has("pavement" as never), "pavements are part of the street, not separate features");
  assert.ok(features.filter((feature) => feature.kind === "street").every((street) => (street as { pavementWidth?: number }).pavementWidth! > 0), "every city street carries a pavement");
});

test("only a village's main street carries a pavement", () => {
  const streets = townAround(village).filter((feature) => feature.kind === "street");
  assert.ok(streets.some((street) => (street as { pavementWidth?: number }).pavementWidth));
  assert.ok(streets.some((street) => !(street as { pavementWidth?: number }).pavementWidth));
});

test("tiles larger than 8 source units carry no benches or planters", () => {
  for (const place of [city, villages[0]]) {
    const large = tilesAround(place, 14, 1);
    assert.ok(large.every((tile) => tile.size > 8));
    for (const tile of large) assert.ok(!featuresFor(tile).some((feature) => TOWN_STREET_KINDS.includes(feature.kind)), `${place.name} large tile`);
  }
});

test("street features are deterministic for the same tile", () => {
  const tile = tilesAround(city, 15, 0)[0];
  assert.equal(JSON.stringify(featuresFor(tile)), JSON.stringify(featuresFor(tile)));
  const village = tilesAround(villages[0], 15, 1)[0];
  assert.equal(JSON.stringify(featuresFor(village)), JSON.stringify(featuresFor(village)));
});

test("cafés and restaurants are seeded, deterministic and sparse", () => {
  const shopsOf = (place: Place, homes: number) => Array.from({ length: homes }, (_, index) => settlementShopFor(place, index));
  for (const place of [cities[0], cities[1]]) {
    const shops = shopsOf(place, 2400), count = shops.filter(Boolean).length;
    assert.ok(count >= 30 && count <= 90, `${place.name} has ${count} shops`);
    assert.deepEqual(shops, shopsOf(place, 2400), `${place.name} shops are deterministic`);
  }
  const village = shopsOf(villages[0], 80);
  assert.deepEqual(village.flatMap((shop, index) => (shop ? [index] : [])), [3, 43]);
  assert.equal(village[3], "cafe");
  assert.equal(settlementShopFor(villages[0], 80), undefined, "out-of-range homes have no shop");
});

/** Distance from a point to the nearest street segment of the plan (source units), with that street's width. */
function streetBand(place: Place, x: number, z: number) {
  const plan = settlementExteriorFor(place);
  let best = { distance: Infinity, width: 0 };
  for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
    const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, qx = wrapSourceX(x - a.x), qz = z - a.z,
      t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / (dx * dx + dz * dz || 1))), distance = Math.hypot(qx - dx * t, qz - dz * t);
    if (distance < best.distance) best = { distance, width: street.width };
  }
  return best;
}

test("no park outline comes within a street and its pavement, and no roadside tree stands on a street or in a park", () => {
  for (const place of [city, village]) {
    const features = townAround(place), parks = features.filter((feature) => feature.kind === "park") as unknown as (Footprint & { code: string; label?: string })[],
      band = (width: number) => width / 2 + metresToSource(1.8 + .5);
    assert.ok(parks.some((park) => park.label === "square"), `${place.name}: square emitted`);
    for (const park of parks) {
      const metric = sourceUnitsPerMetreAt(park.z), c = Math.cos(park.yawRad), s = Math.sin(park.yawRad);
      const samples: [number, number][] = [];
      for (let i = 0; i <= 20; i++) for (const sign of [-1, 1]) {
        samples.push([-park.widthM / 2 + park.widthM * i / 20, sign * park.depthM / 2], [sign * park.widthM / 2, -park.depthM / 2 + park.depthM * i / 20]);
      }
      for (const [u, v] of samples) {
        const x = wrapSourceX(park.x + (u * c + v * s) * metric.x), z = park.z + (-u * s + v * c) * metric.z, street = streetBand(place, x, z);
        assert.ok(street.distance >= band(street.width) - 1e-9, `${place.name}: ${park.code} outline at (${u.toFixed(1)}, ${v.toFixed(1)}) m is ${(street.distance / metresToSource(1)).toFixed(2)} m from a street`);
      }
    }
    const trees = features.filter((feature) => feature.kind === "roadside-tree");
    assert.ok(trees.length > 0, `${place.name}: has roadside trees`);
    for (const tree of trees) {
      const street = streetBand(place, tree.x, tree.z);
      assert.ok(street.distance >= street.width / 2 + metresToSource(1.8 + 1.2) - 1e-9, `${place.name}: ${tree.code} on a street or pavement`);
      for (const park of parks) assert.ok(!insideFootprint(park, tree.x, tree.z, 1.5), `${place.name}: ${tree.code} inside ${park.code}`);
    }
  }
});

/** Every distinct feature (town or not) over a tile square, by code. */
function everyFeature(place: Place, level: number, radius: number) {
  const seen = new Map<string, Feature>();
  for (const tile of tilesAround(place, level, radius)) for (const feature of featuresFor(tile)) seen.set(feature.code, feature);
  return [...seen.values()];
}

test("trees and rocks never stand on a street or its pavement, in a park or plaza, or on a house", () => {
  for (const place of [city, village]) {
    const features = everyFeature(place, 14, 3), parks = features.filter((feature) => feature.kind === "park") as unknown as Footprint[],
      residences = townAround(place).filter((feature) => feature.kind === "residence") as unknown as Footprint[],
      plants = features.filter((feature) => (feature.kind === "tree" || feature.kind === "rock" || feature.kind === "roadside-tree") && !feature.code.includes("/F/site/"));
    assert.ok(plants.some((feature) => feature.kind === "roadside-tree"), `${place.name}: has roadside trees`);
    for (const plant of plants) {
      const street = streetBand(place, plant.x, plant.z);
      assert.ok(street.distance >= street.width / 2 + metresToSource(1.8 + 1.5) - 1e-9, `${place.name}: ${plant.code} within the street and pavement band`);
      for (const park of parks) assert.ok(!insideFootprint(park, plant.x, plant.z, 2), `${place.name}: ${plant.code} inside ${park.code}`);
      for (const residence of residences) assert.ok(!insideFootprint(residence, plant.x, plant.z, 2), `${place.name}: ${plant.code} on a house`);
    }
  }
});

/** Distance from a point to the centre line of every street except `ownId` (source units). */
function otherStreetDistance(place: Place, ownId: string, x: number, z: number) {
  let best = Infinity;
  for (const street of settlementExteriorFor(place).streets) {
    if (street.id === ownId) continue;
    for (let index = 1; index < street.points.length; index++) {
      const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, qx = wrapSourceX(x - a.x), qz = z - a.z,
        t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(qx - dx * t, qz - dz * t));
    }
  }
  return best;
}

test("a street that dead-ends inside the town is capped with a round joint", () => {
  let deadEnds = 0;
  for (const place of [city, village]) {
    const plan = settlementExteriorFor(place), joints = everyFeature(place, 14, 3).filter((feature) => feature.kind === "street-joint");
    for (const street of plan.streets) {
      const first = street.points[0], last = street.points[street.points.length - 1];
      for (const [end, vertex, neighbour] of [[0, first, street.points[1]], [street.points.length - 1, last, street.points[street.points.length - 2]]] as const) {
        if (end !== 0 && Math.hypot(wrapSourceX(first.x - last.x), first.z - last.z) < metresToSource(3)) continue; // closed ring
        if (otherStreetDistance(place, street.id, vertex.x, vertex.z) < metresToSource(3) || plan.gates.some((gate) => Math.hypot(wrapSourceX(gate.x - vertex.x), gate.z - vertex.z) < metresToSource(12))) continue;
        // A street end on a piece shared with a main road is drawn by the road itself: no cap.
        if ((street as { sharedSegments?: number[] }).sharedSegments?.includes(end === 0 ? 1 : street.points.length - 1)) continue;
        const segment = end === 0 ? [vertex, neighbour] : [neighbour, vertex],
          visible = visibleSettlementStreetSegments(place, plan, segment[0], segment[1]).some(([p, q]) => [p, q].some((point) => Math.abs(wrapSourceX(point.x - vertex.x)) < 1e-9 && Math.abs(point.z - vertex.z) < 1e-9));
        if (!visible) continue;
        deadEnds++;
        const joint = joints.find((feature) => Math.abs(wrapSourceX(feature.x - vertex.x)) < 1e-9 && Math.abs(feature.z - vertex.z) < 1e-9);
        assert.ok(joint, `${place.name}: dead end of ${street.id} (point ${end}) has no joint`);
        assert.equal((joint as unknown as { footprintWidth: number }).footprintWidth, street.width);
      }
    }
  }
  assert.ok(deadEnds > 0, "the test settlements have dead-end streets");
});
