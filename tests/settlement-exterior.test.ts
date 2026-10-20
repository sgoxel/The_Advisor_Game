import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, macroPopulationSummary, places, roadDistanceAt, roads, villages } from "../src/geography.ts";
import { wrapSourceX } from "../src/planet.ts";
import { residentFoundationAt } from "../src/simulation.ts";
import {
  canonicalSettlementPopulation,
  SETTLEMENT_EXTERIOR_CACHE_LIMIT,
  settlementExteriorCacheSize,
  settlementExteriorFor,
  settlementExteriorSummary,
  settlementHomeFor,
  visibleSettlementStreetSegments,
} from "../src/settlement-exterior.ts";
import { featuresFor, settlementPresentationCacheState, tileForPosition } from "../src/world.ts";

const samples = [cities[0], cities[Math.floor(cities.length / 2)], villages[0], villages[Math.floor(villages.length / 3)], villages[Math.floor(villages.length * 2 / 3)]].filter(Boolean);

function distanceToBorder(place: (typeof places)[number], plan: ReturnType<typeof settlementExteriorFor>, x: number, z: number) {
  const qx = wrapSourceX(x - place.x), qz = z - place.z;
  let distance = Infinity;
  for (let index = 0; index < plan.border.length; index++) {
    const a = plan.border[index], b = plan.border[(index + 1) % plan.border.length],
      ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
      bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z,
      dx = bx - ax, dz = bz - az, denominator = dx * dx + dz * dz || 1,
      t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qz - az) * dz) / denominator));
    distance = Math.min(distance, Math.hypot(qx - (ax + dx * t), qz - (az + dz * t)));
  }
  return distance;
}
function roadCrossesBorder(place: (typeof places)[number], plan: ReturnType<typeof settlementExteriorFor>, road: (typeof roads)[number]) {
  const points = road.centerline;
  if (!points || points.length < 2) return false;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[segment], b = points[segment + 1],
      ax = wrapSourceX(a.x - place.x), az = a.z - place.z,
      bx = ax + wrapSourceX(b.x - a.x), bz = b.z - place.z,
      rx = bx - ax, rz = bz - az;
    for (let edge = 0; edge < plan.border.length; edge++) {
      const c = plan.border[edge], d = plan.border[(edge + 1) % plan.border.length],
        cx = wrapSourceX(c.x - place.x), cz = c.z - place.z,
        dx = cx + wrapSourceX(d.x - c.x), dz = d.z - place.z,
        sx = dx - cx, sz = dz - cz,
        denominator = rx * sz - rz * sx;
      if (Math.abs(denominator) < 1e-9) continue;
      const qx = cx - ax, qz = cz - az,
        t = (qx * sz - qz * sx) / denominator,
        u = (qx * rz - qz * rx) / denominator;
      if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return true;
    }
  }
  return false;
}

test("macro settlement density remains the current area-driven authority", () => {
  assert.equal(new Set(countries.map((country) => country.continent)).size, 3);
  assert.ok(countries.length >= 30);
  assert.ok(cities.length >= 90);
  assert.ok(villages.length >= 270);
  assert.ok(macroPopulationSummary.countries.some((entry) => entry.cities > 3), "no country exceeds the old three-city quota");
  assert.ok(macroPopulationSummary.countries.some((entry) => entry.villages > 9), "no country exceeds the rural minimum");
});

test("every canonical resident has one distinct persistent one-person home identity", () => {
  for (const place of samples) {
    const plan = settlementExteriorFor(place), population = canonicalSettlementPopulation(place), ids = new Set<string>(), owners = new Set<string>();
    assert.equal(plan.residentHomeCount, population);
    assert.equal(plan.plots.some((plot) => plot.kind === "house"), false, "detailed homes must not be eagerly materialized into the settlement plan");
    for (let index = 0; index < population; index++) {
      const home = settlementHomeFor(place, index, plan);
      ids.add(home.id); owners.add(home.ownerId || "");
      if (index === 0 || index === 1 || index === Math.floor(population / 2) || index === population - 1) {
        const resident = residentFoundationAt(place, index);
        assert.equal(home.id, resident.homeBuilding);
        assert.equal(home.ownerId, resident.homeOwner);
        assert.equal(home.capacity, 1);
        assert.equal(home.residents, 1);
        assert.ok(home.width > 0 && home.depth > 0 && home.clearanceRadius > 0);
        assert.ok(home.candidates.length >= 5);
      }
    }
    assert.equal(ids.size, population);
    assert.equal(owners.size, population);
  }
});

test("canonical primary home ribbons do not overlap in representative city and villages", () => {
  for (const place of [cities[0], villages[0], villages[Math.floor(villages.length / 2)]]) {
    const plan = settlementExteriorFor(place), bucketSize = 4, buckets = new Map<string, { x: number; z: number; radius: number; id: string }[]>();
    for (let index = 0; index < plan.residentHomeCount; index++) {
      const home = settlementHomeFor(place, index, plan), point = home.candidates[0], bx = Math.floor(point.x / bucketSize), bz = Math.floor(point.z / bucketSize), reach = Math.ceil((home.clearanceRadius * 2) / bucketSize) + 1;
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) for (const other of buckets.get(`${bx + dx}/${bz + dz}`) || []) {
        const distance = Math.hypot(wrapSourceX(point.x - other.x), point.z - other.z);
        assert.ok(distance >= home.clearanceRadius + other.radius, `${place.code}: ${home.id} overlaps ${other.id}`);
      }
      const key = `${bx}/${bz}`, bucket = buckets.get(key) || [];
      bucket.push({ x: point.x, z: point.z, radius: home.clearanceRadius, id: home.id }); buckets.set(key, bucket);
    }
  }
});

test("services, varied morphology, gates and farms remain present with bounded detail caches", () => {
  for (const place of samples) {
    const plan = settlementExteriorFor(place), services = new Set(plan.plots.filter((plot) => plot.kind === "service").map((plot) => plot.service));
    for (const service of ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead"]) assert.ok(services.has(service as any), `${place.code} missing ${service}`);
    assert.ok(plan.streets.length >= 2);
    assert.ok(plan.plots.filter((plot) => plot.kind === "field").length >= 4);
    assert.ok(plan.gates.length >= 1 && plan.gates.length <= 2);
    assert.ok(plan.gates.every((gate) => gate.guardPosts.length >= 1 && gate.guardPosts.length <= 2));
  }
  for (const place of places.slice(0, SETTLEMENT_EXTERIOR_CACHE_LIMIT + 5)) settlementExteriorFor(place);
  assert.ok(settlementExteriorCacheSize() <= SETTLEMENT_EXTERIOR_CACHE_LIMIT);
  const summary = settlementExteriorSummary();
  assert.equal(summary.plans, places.length);
  assert.ok(summary.plots > cities.length * 2400 + villages.length * 80, "summary must count canonical homes plus public/service plots");
  assert.ok(settlementExteriorCacheSize() <= SETTLEMENT_EXTERIOR_CACHE_LIMIT, "summary must not fill the detailed-plan cache");
});

test("every village external road crossing uses one of at most two canonical enclosure gates", () => {
  for (const place of villages) {
    const plan = settlementExteriorFor(place), crossingRoads = roads.filter((road) =>
      road.networkKind !== "detour" && road.centerline && road.centerline.length >= 2 &&
      roadDistanceAt(place.x, place.z, road) <= plan.radius * 1.7 && roadCrossesBorder(place, plan, road),
    ).sort((a, b) => a.code.localeCompare(b.code));
    assert.ok(crossingRoads.length >= 1, `${place.code} has no external road crossing`);
    assert.ok(plan.gates.length >= 1 && plan.gates.length <= 2, `${place.code} must expose one or two gates`);
    for (const road of crossingRoads) {
      const gate = plan.gates.find((candidate) => roadDistanceAt(candidate.x, candidate.z, road) < .05 && distanceToBorder(place, plan, candidate.x, candidate.z) < .05);
      assert.ok(gate, `${place.code} road ${road.code} crosses the enclosure away from a gate`);
    }
    for (const gate of plan.gates) {
      assert.ok(distanceToBorder(place, plan, gate.x, gate.z) < .05, `${place.code} gate ${gate.id} is not on the enclosure`);
      assert.ok(crossingRoads.some((road) => roadDistanceAt(gate.x, gate.z, road) < .05), `${place.code} gate ${gate.id} is not used by an external road`);
    }
  }
});

test("village presentation streets end at the enclosure instead of drawing false exterior junctions", () => {
  let clipped = 0;
  for (const place of villages) {
    const plan = settlementExteriorFor(place);
    for (const street of plan.streets) for (let index = 1; index < street.points.length; index++) {
      const a = street.points[index - 1], b = street.points[index],
        segments = visibleSettlementStreetSegments(place, plan, a, b);
      for (const [from, to] of segments) {
        const midpoint = { x: wrapSourceX(from.x + wrapSourceX(to.x - from.x) / 2), z: (from.z + to.z) / 2 };
        // Independent point-in-polygon check, using the same canonical border.
        let inside = false;
        for (let edge = 0, prev = plan.border.length - 1; edge < plan.border.length; prev = edge++) {
          const p = plan.border[edge], q = plan.border[prev],
            px = wrapSourceX(p.x - place.x), qx = wrapSourceX(q.x - place.x),
            x = wrapSourceX(midpoint.x - place.x), z = midpoint.z - place.z, pz = p.z - place.z, qz = q.z - place.z;
          if ((pz > z) !== (qz > z) && x < (qx - px) * (z - pz) / (qz - pz) + px) inside = !inside;
        }
        assert.ok(inside, `${place.code}/${street.id} draws a street outside its enclosure`);
      }
      if (segments.length === 0 || segments.some(([from, to]) =>
        Math.hypot(wrapSourceX(from.x - a.x), from.z - a.z) > 1e-5 ||
        Math.hypot(wrapSourceX(to.x - b.x), to.z - b.z) > 1e-5)) clipped++;
    }
  }
  assert.ok(clipped > 0, "at least one exterior synthetic street must be clipped");
});

test("focused settlement presentation is bounded while retaining canonical owner metadata", () => {
  const place = villages[0], population = canonicalSettlementPopulation(place), tile = tileForPosition(place.x, place.z, 10),
    features = featuresFor(tile) as any[], local = features.filter((feature) => feature.code.includes(`/F/${place.id}/`)),
    homes = local.filter((feature) => feature.kind === "residence");
  assert.ok(local.some((feature) => feature.kind === "street"));
  assert.ok(local.some((feature) => feature.kind === "service"));
  assert.ok(local.some((feature) => feature.kind === "gate"));
  assert.ok(homes.length > 0 && homes.length < population, "visible home meshes must remain bounded below canonical population");
  assert.ok(homes.every((home) => typeof home.ownerId === "string" && home.ownerId.startsWith(`${place.code}/RESIDENT/`)));
  const state = settlementPresentationCacheState();
  assert.ok(state.settlements <= state.maxSettlements);
  assert.ok(state.homeAnchors <= state.settlements * state.maxHomeAnchorsPerSettlement);
});
