import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, macroPopulationSummary, places, villages } from "../src/geography.ts";
import { wrapSourceX } from "../src/planet.ts";
import { residentFoundationAt } from "../src/simulation.ts";
import {
  canonicalSettlementPopulation,
  SETTLEMENT_EXTERIOR_CACHE_LIMIT,
  settlementExteriorCacheSize,
  settlementExteriorFor,
  settlementExteriorSummary,
  settlementHomeFor,
} from "../src/settlement-exterior.ts";
import { featuresFor, settlementPresentationCacheState, tileForPosition } from "../src/world.ts";

const samples = [cities[0], cities[Math.floor(cities.length / 2)], villages[0], villages[Math.floor(villages.length / 3)], villages[Math.floor(villages.length * 2 / 3)]].filter(Boolean);

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
