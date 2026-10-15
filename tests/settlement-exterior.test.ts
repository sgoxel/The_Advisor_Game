import assert from "node:assert/strict";
import test from "node:test";
import { places } from "../src/geography.ts";
import { settlementExteriorFor, settlementExteriorSummary } from "../src/settlement-exterior.ts";

const REQUIRED_SERVICES = ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead"] as const;

test("every generated settlement has deterministic non-grid exterior morphology and services", () => {
  for (const place of places) {
    const plan = settlementExteriorFor(place),
      again = settlementExteriorFor(place),
      services = new Set(plan.plots.flatMap((plot) => plot.service ? [plot.service] : [])),
      homes = plan.plots.filter((plot) => plot.kind === "house");
    assert.equal(plan, again, "lazy cache must preserve canonical plan identity");
    assert.deepEqual([...services].sort(), [...REQUIRED_SERVICES].sort(), `${place.code} missing service`);
    assert.ok(homes.length >= (place.kind === "city" ? 80 : 20));
    assert.ok(plan.plots.filter((plot) => plot.kind === "field").length >= (place.kind === "city" ? 8 : 4));
    assert.equal(plan.plots.filter((plot) => plot.kind === "keep").length, 1);
    assert.equal(plan.plots.filter((plot) => plot.kind === "well").length, 1);
    assert.ok(plan.border.length >= (place.kind === "city" ? 40 : 20));
    assert.ok(plan.gates.length >= 1 && plan.gates.length <= 2);
    for (const gate of plan.gates) assert.ok(gate.guardPosts.length >= 1 && gate.guardPosts.length <= 2);
    for (const home of homes) {
      assert.ok(home.ownerId?.startsWith(`${place.code}/HOUSEHOLD/`), `${home.id} missing canonical owner`);
      assert.ok(home.capacity >= home.residents);
      assert.ok(home.residents >= 2);
    }
    assert.equal(new Set(homes.map((home) => home.ownerId)).size, homes.length);
    assert.ok(plan.streets.length >= 2);
    assert.ok(plan.streets.some((street) => {
      const a = street.points[0], b = street.points[street.points.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
      return street.points.slice(1, -1).some((point) => Math.abs((point.x-a.x)*dz-(point.z-a.z)*dx)/length > 1);
    }), `${place.code} streets collapsed to a straight grid`);
  }
});

test("settlement exterior summary is bounded to the canonical registry", () => {
  const summary = settlementExteriorSummary();
  assert.equal(summary.plans, places.length);
  assert.ok(summary.plots < places.length * 140);
  assert.ok(summary.streets <= places.length * 4);
  assert.ok(summary.borderPoints <= places.length * 48);
  assert.equal(summary.cachedPlans, places.length);
});
