import assert from "node:assert/strict";
import test from "node:test";
import { places } from "../src/geography.ts";
import { wrapSourceX } from "../src/planet.ts";
import {
  settlementExteriorFor,
  settlementExteriorSummary,
  type SettlementArchetype,
} from "../src/settlement-exterior.ts";

const REQUIRED_SERVICES = ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead"] as const;

function topologySignature(placeCode: string) {
  const place = places.find((candidate) => candidate.code === placeCode)!;
  const plan = settlementExteriorFor(place);
  return JSON.stringify({
    archetype: plan.archetype,
    streets: plan.streets.map((street) => ({
      points: street.points.length,
      width: Math.round(street.width * 10),
      dx: Math.round(wrapSourceX(street.points.at(-1)!.x - street.points[0].x)),
      dz: Math.round(street.points.at(-1)!.z - street.points[0].z),
    })),
    border: plan.border.length,
    gates: plan.gates.length,
    fields: plan.plots.filter((plot) => plot.kind === "field").map((plot) => plot.fieldForm),
  });
}

test("every generated settlement has deterministic terrain/access-shaped exterior morphology and services", () => {
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
      assert.ok(home.clearanceRadius > 5);
      assert.ok(home.width !== homes[0].width || home.depth !== homes[0].depth || home === homes[0] || homes.length < 2);
    }
    assert.equal(new Set(homes.map((home) => home.ownerId)).size, homes.length);
    assert.ok(plan.streets.length >= 2);
    assert.ok(plan.streets.some((street) => {
      const a = street.points[0], b = street.points[street.points.length - 1];
      const dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
      return street.points.slice(1, -1).some((point) => {
        const px = wrapSourceX(point.x - a.x), pz = point.z - a.z;
        return Math.abs(px * dz - pz * dx) / length > 1;
      });
    }), `${place.code} streets collapsed to a straight stamp`);
  }
});

test("villages materially vary topology, frontage programs, agriculture and perimeter form", () => {
  const villages = places.filter((place) => place.kind === "village"),
    archetypes = new Set<SettlementArchetype>(),
    signatures = new Set<string>(),
    fieldForms = new Set<string>();
  for (const village of villages) {
    const plan = settlementExteriorFor(village);
    archetypes.add(plan.archetype);
    signatures.add(topologySignature(village.code));
    for (const field of plan.plots.filter((plot) => plot.kind === "field"))
      if (field.fieldForm) fieldForms.add(field.fieldForm);
  }
  assert.ok(archetypes.size >= 5, `expected at least five village archetypes, got ${[...archetypes].join(", ")}`);
  assert.ok(signatures.size >= Math.min(48, villages.length), "village topology still repeats as a small stamped set");
  assert.ok(fieldForms.size >= 4, "agriculture lacks form diversity");
});

test("settlement exterior summary remains bounded to the canonical registry", () => {
  const summary = settlementExteriorSummary();
  assert.equal(summary.plans, places.length);
  assert.ok(summary.plots < places.length * 160);
  assert.ok(summary.streets <= places.length * 5);
  assert.ok(summary.borderPoints <= places.length * 48);
  assert.ok(Object.keys(summary.archetypes).length >= 5);
  assert.equal(summary.cachedPlans, places.length);
});
