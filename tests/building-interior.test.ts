import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { settlementLayout } from "../src/settlement-layout.ts";
import { ProtagonistInteriorCache, interiorPlanFor } from "../src/building-interior.ts";

const layout = settlementLayout(villages[0]);
const byRole = (role: string) => {
  const building = layout.buildings.find((candidate) => candidate.role === role);
  assert.ok(building, `missing ${role}`);
  return building;
};

test("settlement inspection does not realize interiors", () => {
  const cache = new ProtagonistInteriorCache(2);
  void settlementLayout(villages[0]);
  void settlementLayout(villages[1]);
  assert.deepEqual(cache.stats(), { active: 0, cached: 0, bytes: 0, materializations: 0, evictions: 0 });
});

test("protagonist entry realizes only the entered building and re-entry is deterministic after eviction", () => {
  const cache = new ProtagonistInteriorCache(2),
    home = byRole("home"),
    first = cache.enter(home),
    firstSignature = first.signature;
  assert.equal(cache.stats().active, 1);
  assert.equal(cache.stats().cached, 1);
  assert.equal(cache.stats().materializations, 1);
  assert.equal(first.exteriorEntrance.x, home.entrance.x);
  assert.equal(first.exteriorEntrance.z, home.entrance.z);
  assert.equal(first.doors[0]?.kind, "door");
  assert.equal(first.doors[0]?.from, "EXTERIOR");
  assert.equal(first.doors[0]?.to, first.rooms[0]?.code);
  cache.exit(home.code);
  assert.equal(cache.evict(home.code), true);
  assert.equal(cache.stats().cached, 0);
  const second = cache.enter(home);
  assert.equal(second.signature, firstSignature);
  assert.deepEqual(second, first);
  assert.equal(cache.stats().materializations, 2);
  assert.equal(cache.stats().evictions, 1);
});

test("required home rooms and service programs become connected usable interior anchors", () => {
  const home = interiorPlanFor(byRole("home"));
  for (const required of ["bedroom", "latrine", "living room"])
    assert.ok(home.rooms.some((room) => room.name === required), `home lacks ${required}`);
  assert.ok(home.anchors.some((anchor) => anchor.kind === "bed"));
  assert.ok(home.anchors.some((anchor) => anchor.kind === "latrine"));
  assert.equal(home.doors.length, home.rooms.length);

  const roles = ["inn", "market", "blacksmith", "farmstead", "barn", "butcher", "guard-office"];
  const signatures = new Set<string>();
  for (const role of roles) {
    const building = byRole(role),
      plan = interiorPlanFor(building);
    signatures.add(plan.signature);
    assert.equal(plan.building, building.code);
    assert.ok(plan.rooms.length > 0, `${role}: no rooms`);
    assert.equal(plan.doors.length, plan.rooms.length, `${role}: disconnected room chain`);
    assert.ok(plan.anchors.some((anchor) => anchor.kind === "entrance"), `${role}: no entry anchor`);
    assert.ok(plan.estimatedBytes > 0, `${role}: no resource accounting`);
    for (const room of plan.rooms) {
      assert.ok(room.widthM * room.depthM + 1e-6 >= Math.min(room.areaM2, (building.width - 0.6) * (building.depth - 0.6)), `${role}/${room.name}: undersized realization`);
      assert.ok(room.floor >= 0 && room.floor < building.floors, `${role}/${room.name}: invalid floor`);
    }
  }
  assert.ok(signatures.size >= 6, `service interiors insufficiently diverse: ${signatures.size}/${roles.length}`);
});

test("multi-floor interiors contain explicit deterministic stair circulation", () => {
  const building = layout.buildings.find((candidate) => candidate.floors > 1 && candidate.rooms.length > 1);
  assert.ok(building, "fixture settlement has no multi-floor building");
  const first = interiorPlanFor(building),
    second = interiorPlanFor(building),
    usedFloors = new Set(first.rooms.map((room) => room.floor)),
    stairs = first.doors.filter((door) => door.kind === "stair");
  assert.ok(usedFloors.size >= 2, `${building.code}: upper floor never populated`);
  assert.ok(stairs.length >= 1, `${building.code}: no explicit stair connection`);
  assert.ok(first.anchors.some((anchor) => anchor.kind === "stairs"), `${building.code}: no usable stair anchor`);
  for (const stair of stairs) {
    const from = first.rooms.find((room) => room.code === stair.from),
      to = first.rooms.find((room) => room.code === stair.to);
    assert.ok(from && to, `${stair.code}: stair endpoint missing`);
    assert.notEqual(from.floor, to.floor, `${stair.code}: stair does not change floor`);
  }
  assert.deepEqual(second, first, `${building.code}: stair topology changed on reconstruction`);
});

test("seeded settlement context and local climate produce deterministic interior style diversity", () => {
  const plans = villages.slice(0, 10).map((village) => {
    const home = settlementLayout(village).buildings.find((building) => building.role === "home");
    assert.ok(home, `${village.id}: no home`);
    const first = interiorPlanFor(home),
      second = interiorPlanFor(home);
    assert.deepEqual(second.style, first.style, `${village.id}: style changed on reconstruction`);
    assert.deepEqual(second, first, `${village.id}: plan changed on reconstruction`);
    return first;
  });
  const cultures = new Set(plans.map((plan) => plan.style.culture)),
    styleSignatures = new Set(plans.map((plan) => JSON.stringify(plan.style)));
  assert.ok(cultures.size >= 2, `settlement culture diversity too low: ${cultures.size}`);
  assert.ok(styleSignatures.size >= 2, `environment/style diversity too low: ${styleSignatures.size}`);

  const serviceStyles = ["inn", "market", "blacksmith", "farmstead", "butcher", "guard-office"].map((role) => interiorPlanFor(byRole(role)).style.furniture);
  assert.ok(new Set(serviceStyles).size >= 4, "functional furniture families collapsed into one template");
});

test("bounded cache never evicts an active protagonist interior and evicts inactive LRU entries", () => {
  const cache = new ProtagonistInteriorCache(2),
    home = byRole("home"),
    inn = byRole("inn"),
    market = byRole("market");
  cache.enter(home);
  cache.enter(inn);
  cache.exit(home.code);
  cache.enter(market);
  assert.equal(cache.has(home.code), false);
  assert.equal(cache.has(inn.code), true);
  assert.equal(cache.has(market.code), true);
  assert.equal(cache.stats().active, 2);
  assert.equal(cache.stats().cached, 2);
  assert.equal(cache.stats().evictions, 1);
});
