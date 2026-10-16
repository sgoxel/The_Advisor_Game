import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, macroPopulationSummary, places, villages } from "../src/geography.ts";
import { residentFoundationAt } from "../src/simulation.ts";
import { canonicalSettlementPopulation, settlementExteriorCacheSize, settlementExteriorFor, settlementExteriorSummary } from "../src/settlement-exterior.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";

const samples = [cities[0], cities[Math.floor(cities.length / 2)], villages[0], villages[Math.floor(villages.length / 3)], villages[Math.floor(villages.length * 2 / 3)]].filter(Boolean);

test("macro settlement density remains the current area-driven authority", () => {
  assert.equal(new Set(countries.map((country) => country.continent)).size, 3);
  assert.ok(countries.length >= 30);
  assert.ok(cities.length >= 90);
  assert.ok(villages.length >= 270);
  assert.ok(macroPopulationSummary.countries.some((entry) => entry.cities > 3), "no country exceeds the old three-city quota");
  assert.ok(macroPopulationSummary.countries.some((entry) => entry.villages > 9), "no country exceeds the rural minimum");
});

test("every canonical resident has one distinct persistent exterior home identity", () => {
  for (const place of samples) {
    const plan = settlementExteriorFor(place), population = canonicalSettlementPopulation(place), homes = plan.plots.filter((plot) => plot.kind === "house");
    assert.equal(homes.length, population, `${place.code} must expose one home per resident`);
    assert.equal(new Set(homes.map((home) => home.id)).size, population);
    assert.equal(new Set(homes.map((home) => home.ownerId)).size, population);
    for (const index of [0, 1, Math.floor(population / 2), population - 1]) {
      const home = homes[index], resident = residentFoundationAt(place, index);
      assert.equal(home.id, resident.homeBuilding);
      assert.equal(home.ownerId, resident.homeOwner);
      assert.equal(home.capacity, 1);
      assert.equal(home.residents, 1);
      assert.ok(home.width > 0 && home.depth > 0 && home.clearanceRadius > 0);
      assert.ok(home.candidates.length >= 5);
    }
  }
});

test("services, varied morphology, gates and farms remain present without eager full-world detail", () => {
  const before = settlementExteriorCacheSize();
  for (const place of samples) {
    const plan = settlementExteriorFor(place), services = new Set(plan.plots.filter((plot) => plot.kind === "service").map((plot) => plot.service));
    for (const service of ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead"]) assert.ok(services.has(service as any), `${place.code} missing ${service}`);
    assert.ok(plan.streets.length >= 2);
    assert.ok(plan.plots.filter((plot) => plot.kind === "field").length >= 4);
    assert.ok(plan.gates.length >= 1 && plan.gates.length <= 2);
    assert.ok(plan.gates.every((gate) => gate.guardPosts.length >= 1 && gate.guardPosts.length <= 2));
  }
  const summary = settlementExteriorSummary();
  assert.equal(summary.plans, places.length);
  assert.ok(summary.plots > cities.length * 2400 + villages.length * 80, "summary must count canonical homes plus public/service plots");
  assert.ok(settlementExteriorCacheSize() < places.length, "summary must not eagerly realize every detailed settlement");
  assert.ok(settlementExteriorCacheSize() >= before);
});

test("focused settlement presentation is bounded while retaining canonical owner metadata", () => {
  const place = villages[0], population = canonicalSettlementPopulation(place), tile = tileForPosition(place.x, place.z, 10),
    features = featuresFor(tile) as any[], local = features.filter((feature) => feature.code.includes(`/F/${place.id}/`)),
    homes = local.filter((feature) => feature.kind === "house");
  assert.ok(local.some((feature) => feature.kind === "street"));
  assert.ok(local.some((feature) => feature.kind === "service"));
  assert.ok(local.some((feature) => feature.kind === "gate"));
  assert.ok(homes.length > 0 && homes.length < population, "visible home proxies must remain bounded below canonical population");
  assert.ok(homes.every((home) => typeof home.ownerId === "string" && home.ownerId.startsWith(`${place.code}/RESIDENT/`)));
});
