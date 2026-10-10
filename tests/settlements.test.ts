import assert from "node:assert/strict";
import test from "node:test";
import { places } from "../src/geography.ts";
import { macroSampleAt } from "../src/macro-geography.ts";
import { positionToEnu } from "../src/planet.ts";
import { settlementEntranceAccess } from "../src/settlement-access.ts";
import {
  settlementPlan,
  settlementPlanFingerprint,
  settlementPlans,
  type BuildingUse,
} from "../src/settlements.ts";
import { generateInterior, InteriorRuntime } from "../src/interiors.ts";

const REQUIRED: BuildingUse[] = [
  "inn",
  "market",
  "blacksmith",
  "farmstead",
  "barn",
  "butcher",
  "guard-office",
  "well",
];
const REQUIRED_PROFESSIONS = ["innkeeper", "merchant", "blacksmith", "farmer", "butcher", "guard"];

function buildingLocal(plan: ReturnType<typeof settlementPlan>, code: string) {
  const building = plan.buildings.find((candidate) => candidate.code === code)!;
  return positionToEnu(building.position, plan.site.centre);
}

function minimumSeparation(a: ReturnType<typeof settlementPlan>["buildings"][number], b: ReturnType<typeof settlementPlan>["buildings"][number]) {
  const ar = Math.hypot(a.widthM, a.depthM) * 0.5,
    br = Math.hypot(b.widthM, b.depthM) * 0.5;
  return Math.max(2, (ar + br) * 0.54);
}

test("every generated settlement has required services, homes, guarded gates and dry non-overlapping entrance-connected plots", () => {
  const plans = settlementPlans();
  assert.equal(plans.length, places.length);
  assert.ok(plans.length >= 360, `expected variable registry, got ${plans.length}`);
  for (const plan of plans) {
    const uses = new Set(plan.buildings.map((building) => building.use));
    for (const use of REQUIRED) assert.ok(uses.has(use), `${plan.placeId} missing ${use}`);
    assert.ok(plan.gates.length === 1 || plan.gates.length === 2, `${plan.placeId} gate count`);
    for (const gate of plan.gates) {
      assert.ok(gate.guardPostCodes.length === 1 || gate.guardPostCodes.length === 2);
      for (const code of gate.guardPostCodes)
        assert.ok(plan.buildings.some((building) => building.code === code && building.use === "guard-post"));
    }
    const homes = plan.buildings.filter((building) => building.use === "home");
    assert.equal(homes.length, plan.population, `${plan.placeId} home capacity`);
    assert.equal(plan.residents.length, plan.population, `${plan.placeId} resident capacity`);
    assert.equal(new Set(plan.residents.map((resident) => resident.homeCode)).size, plan.population);
    for (const resident of plan.residents)
      assert.ok(homes.some((home) => home.code === resident.homeCode), `${resident.code} missing home`);
    for (const profession of REQUIRED_PROFESSIONS)
      assert.ok(plan.residents.some((resident) => resident.profession === profession), `${plan.placeId} missing ${profession}`);
    for (const building of plan.buildings) {
      const macro = macroSampleAt(building.position);
      assert.ok(macro.land && macro.domain !== "Lake", `${building.code} on water`);
      if (building.use !== "well") {
        const entranceMacro = macroSampleAt(building.entrance),
          access = settlementEntranceAccess(building, plan);
        assert.ok(entranceMacro.land && entranceMacro.domain !== "Lake", `${building.code} entrance on water`);
        assert.equal(access.buildingCode, building.code);
        assert.ok(plan.streets.some((street) => street.code === access.streetCode), `${building.code} missing street endpoint`);
        assert.ok(Number.isFinite(access.lengthM) && access.lengthM >= 0, `${building.code} invalid access length`);
        assert.ok(access.lengthM <= plan.site.envelopeRadiusM * 2.2, `${building.code} access leaves settlement envelope`);
        assert.deepEqual(access.sourcePoints[0], { x: building.entranceX, z: building.entranceZ });
      }
      if (building.use === "barn") assert.ok(building.widthM * building.depthM >= 6);
      if (building.use === "home") {
        assert.ok(building.rooms.includes("living/common"));
        assert.ok(building.rooms.includes("bedroom"));
        assert.ok(building.rooms.includes("latrine"));
      }
    }
    for (let i = 0; i < plan.buildings.length; i++) {
      if (plan.buildings[i].use === "well") continue;
      const a = buildingLocal(plan, plan.buildings[i].code);
      for (let j = i + 1; j < plan.buildings.length; j++) {
        if (plan.buildings[j].use === "well") continue;
        const b = buildingLocal(plan, plan.buildings[j].code);
        assert.ok(
          Math.hypot(a.east - b.east, a.north - b.north) >= minimumSeparation(plan.buildings[i], plan.buildings[j]),
          `${plan.buildings[i].code} overlaps ${plan.buildings[j].code}`,
        );
      }
    }
  }
});

test("settlement plans are deterministic, structurally diverse and not a shared grid stamp", () => {
  const sample = [
      ...places.filter((place) => place.kind === "city").slice(0, 10),
      ...places.filter((place) => place.kind === "village").slice(0, 20),
    ],
    fingerprints = sample.map((place) => settlementPlanFingerprint(settlementPlan(place.id))),
    repeated = sample.map((place) => settlementPlanFingerprint(settlementPlan(place.id)));
  assert.deepEqual(repeated, fingerprints);
  const archetypes = new Set(sample.map((place) => settlementPlan(place.id).archetype));
  assert.ok(archetypes.size >= 3, `only ${[...archetypes].join(",")}`);
  const signatures = new Set(
    sample.map((place) => {
      const plan = settlementPlan(place.id);
      return `${plan.archetype}/${plan.streets.length}/${plan.gates.length}/${plan.fields.length}/${plan.buildings
        .filter((building) => building.use === "home")
        .slice(0, 12)
        .map((building) => {
          const p = positionToEnu(building.position, plan.site.centre);
          return `${Math.round(p.east)}:${Math.round(p.north)}:${building.headingRad.toFixed(2)}`;
        })
        .join("|")}`;
    }),
  );
  assert.ok(signatures.size >= Math.floor(sample.length * 0.8), `only ${signatures.size}/${sample.length} structural signatures`);
  const axisAligned = sample.flatMap((place) => settlementPlan(place.id).buildings)
    .filter((building) => building.use === "home")
    .filter((building) => {
      const quarter = Math.PI / 2,
        offset = Math.abs(building.headingRad / quarter - Math.round(building.headingRad / quarter));
      return offset < 0.01;
    }).length;
  const homes = sample.flatMap((place) => settlementPlan(place.id).buildings).filter((building) => building.use === "home").length;
  assert.ok(axisAligned / homes < 0.25, `${axisAligned}/${homes} homes axis-aligned`);
});

test("interiors are protagonist-demand only, deterministic after eviction and functionally different", () => {
  const plan = settlementPlan(places.find((place) => place.kind === "village")!.id),
    home = plan.buildings.find((building) => building.use === "home")!,
    inn = plan.buildings.find((building) => building.use === "inn")!,
    smith = plan.buildings.find((building) => building.use === "blacksmith")!,
    runtime = new InteriorRuntime(2);
  assert.equal(runtime.stats.realized, 0);

  const homeFirst = runtime.enter(home.code);
  assert.ok(homeFirst.rooms.some((room) => room.use === "bedroom"));
  assert.ok(homeFirst.rooms.some((room) => room.use === "latrine"));
  assert.ok(homeFirst.rooms.some((room) => room.use === "living/common"));
  runtime.exit();
  assert.ok(runtime.evict(home.code));
  const homeSecond = runtime.enter(home.code);
  assert.equal(homeSecond.signature, homeFirst.signature);

  const innLayout = runtime.enter(inn.code);
  const smithLayout = runtime.enter(smith.code);
  assert.notEqual(innLayout.signature, smithLayout.signature);
  assert.ok(innLayout.rooms.some((room) => /guest/i.test(room.use)));
  assert.ok(smithLayout.rooms.some((room) => /forge/i.test(room.use)));
  assert.ok(runtime.stats.realized <= 2);

  for (const building of [home, inn, smith]) {
    const first = generateInterior(building),
      second = generateInterior(building);
    assert.equal(first.signature, second.signature);
    assert.equal(first.walkableLinks.length, Math.max(0, first.rooms.length - 1));
    assert.equal(first.anchors.length, first.rooms.length);
  }
});
