import { strict as assert } from "node:assert";
import { test } from "node:test";
import { places } from "../src/geography.ts";
import { settlementLayout, type Building } from "../src/settlement-layout.ts";
import {
  interiorBaseForBuilding,
  InteriorResidency,
  type InteriorBase,
} from "../src/building-interior.ts";

function sampleVillage() {
  const place = places.find((candidate) => candidate.kind === "village");
  assert.ok(place, "generated world must include a village");
  return settlementLayout(place);
}

function graphReachable(base: InteriorBase): Set<string> {
  const edges = new Map<string, string[]>();
  for (const room of base.rooms) edges.set(room.code, []);
  for (const door of base.doors) {
    edges.get(door.from)?.push(door.to);
    edges.get(door.to)?.push(door.from);
  }
  const entryRoom = base.anchors.find((anchor) => anchor.kind === "entry")?.room;
  assert.ok(entryRoom);
  const seen = new Set<string>([entryRoom]),
    queue = [entryRoom];
  while (queue.length) {
    const code = queue.shift()!;
    for (const next of edges.get(code) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return seen;
}

function geometryFingerprint(building: Building): string {
  const base = interiorBaseForBuilding(building);
  return base.rooms
    .map((room) => `${room.name}:${room.x.toFixed(2)},${room.z.toFixed(2)},${room.width.toFixed(2)},${room.depth.toFixed(2)}`)
    .join("|");
}

test("interior base preserves every required functional room and connected circulation", () => {
  const layout = sampleVillage();
  const requiredRoles = ["home", "inn", "market", "blacksmith", "farmstead", "barn", "butcher", "guard-office"];
  for (const role of requiredRoles) {
    const building = layout.buildings.find((candidate) => candidate.role === role);
    assert.ok(building, `missing ${role}`);
    const base = interiorBaseForBuilding(building);
    assert.deepEqual(
      new Set(base.rooms.map((room) => room.name)),
      new Set(building.rooms.map((room) => room.name)),
      `${role} must retain its program rooms`,
    );
    const requested = building.rooms.reduce((sum, room) => sum + room.areaM2, 0),
      realized = base.rooms.reduce((sum, room) => sum + room.areaM2, 0);
    assert.ok(realized + 1e-6 >= requested, `${role} interior may not shrink below its program area`);
    assert.equal(graphReachable(base).size, base.rooms.length, `${role} rooms must all be reachable from entry`);
    assert.equal(base.doors.length, Math.max(0, base.rooms.length - 1));
    assert.ok(base.anchors.some((anchor) => anchor.kind === "entry"));
  }
});

test("every interior doorway lies on the exact shared wall", () => {
  for (const building of sampleVillage().buildings.slice(0, 24)) {
    const base = interiorBaseForBuilding(building),
      byCode = new Map(base.rooms.map((room) => [room.code, room] as const));
    for (const door of base.doors) {
      const a = byCode.get(door.from),
        b = byCode.get(door.to);
      assert.ok(a && b);
      const aLeft = a.x - a.width / 2,
        aRight = a.x + a.width / 2,
        bLeft = b.x - b.width / 2,
        bRight = b.x + b.width / 2,
        aTop = a.z - a.depth / 2,
        aBottom = a.z + a.depth / 2,
        bTop = b.z - b.depth / 2,
        bBottom = b.z + b.depth / 2,
        sharedVertical = Math.min(Math.abs(aRight - bLeft), Math.abs(bRight - aLeft)),
        sharedHorizontal = Math.min(Math.abs(aBottom - bTop), Math.abs(bBottom - aTop));
      if (sharedVertical < sharedHorizontal) {
        const wallX = Math.abs(aRight - bLeft) < Math.abs(bRight - aLeft) ? aRight : aLeft;
        assert.ok(Math.abs(door.x - wallX) < 1e-6, `${building.code}: door misses vertical shared wall`);
        assert.ok(door.z >= Math.max(aTop, bTop) - 1e-6 && door.z <= Math.min(aBottom, bBottom) + 1e-6);
      } else {
        const wallZ = Math.abs(aBottom - bTop) < Math.abs(bBottom - aTop) ? aBottom : aTop;
        assert.ok(Math.abs(door.z - wallZ) < 1e-6, `${building.code}: door misses horizontal shared wall`);
        assert.ok(door.x >= Math.max(aLeft, bLeft) - 1e-6 && door.x <= Math.min(aRight, bRight) + 1e-6);
      }
    }
  }
});

test("home exposes sleeping, sanitation and social destinations", () => {
  const home = sampleVillage().buildings.find((building) => building.role === "home");
  assert.ok(home);
  const base = interiorBaseForBuilding(home),
    kinds = new Set(base.anchors.map((anchor) => anchor.kind));
  assert.ok(kinds.has("sleep"));
  assert.ok(kinds.has("sanitation"));
  assert.ok(kinds.has("social"));
});

test("interiors materialize only on explicit entry and residency stays bounded", () => {
  const buildings = sampleVillage().buildings.filter((building) => building.role !== "keep").slice(0, 5);
  assert.ok(buildings.length >= 3);
  const residency = new InteriorResidency(2);
  assert.deepEqual(residency.stats(), {
    active: 0,
    materializations: 0,
    evictions: 0,
    activeBuildings: [],
  });
  for (const building of buildings) residency.enter(building);
  const stats = residency.stats();
  assert.equal(stats.active, 2);
  assert.equal(stats.materializations, buildings.length);
  assert.equal(stats.evictions, buildings.length - 2);
  assert.deepEqual(stats.activeBuildings, buildings.slice(-2).map((building) => building.code));
});

test("evicting and re-entering reconstructs the identical canonical base", () => {
  const building = sampleVillage().buildings.find((candidate) => candidate.role === "inn");
  assert.ok(building);
  const residency = new InteriorResidency(1),
    first = residency.enter(building);
  assert.equal(residency.evict(building.code), true);
  assert.equal(residency.has(building.code), false);
  const second = residency.enter(building);
  assert.notEqual(first, second, "eviction must drop the realized object rather than retain it");
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.rooms, second.rooms);
  assert.deepEqual(first.doors, second.doors);
  assert.deepEqual(first.anchors, second.anchors);
});

test("same-archetype buildings have deterministic structural variation", () => {
  const homes = sampleVillage().buildings.filter((building) => building.role === "home").slice(0, 12);
  assert.ok(homes.length >= 4);
  const first = homes.map((building) => geometryFingerprint(building)),
    second = homes.map((building) => geometryFingerprint(building));
  assert.deepEqual(first, second);
  assert.ok(new Set(first).size > 1, "homes should not all reconstruct the same room geometry");
});
