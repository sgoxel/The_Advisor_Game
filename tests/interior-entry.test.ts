import { strict as assert } from "node:assert";
import { test } from "node:test";
import { villages } from "../src/geography.ts";
import { InteriorResidency } from "../src/building-interior.ts";
import {
  characterDecideInteriorEntry,
  resolveInteriorEntry,
  simulationValidateInteriorEntry,
} from "../src/interior-entry.ts";
import { settlementLayout, type Building } from "../src/settlement-layout.ts";

function building(role = "home") {
  const layout = settlementLayout(villages[0]),
    found = layout.buildings.find((candidate) => candidate.role === role);
  assert.ok(found, `missing ${role}`);
  return found;
}

test("building entry follows Character decision then Simulation validation", () => {
  for (const role of ["home", "inn", "market", "blacksmith", "farmstead", "butcher", "guard-office"]) {
    const resolution = resolveInteriorEntry(building(role), 12345);
    assert.equal(resolution.request.intent, "enter-building");
    assert.equal(resolution.request.fantasySecond, 12345);
    assert.equal(resolution.character.accepted, true);
    assert.equal(resolution.simulation.valid, true, resolution.simulation.reason);
    assert.equal(resolution.simulation.identityMatches, true);
    assert.equal(resolution.simulation.entranceDry, true);
    assert.equal(resolution.simulation.accessDry, true);
    assert.equal(resolution.simulation.accessConnected, true);
    assert.equal(resolution.approved, true);
  }
});

test("atlas selection/entry validation does not materialize an interior by itself", () => {
  const home = building(),
    residency = new InteriorResidency(1);
  assert.equal(residency.stats().materializations, 0);
  const resolution = resolveInteriorEntry(home, 0);
  assert.equal(resolution.approved, true);
  assert.deepEqual(residency.stats(), {
    active: 0,
    materializations: 0,
    evictions: 0,
    activeBuildings: [],
  });
});

test("Simulation rejects a disconnected forged access point", () => {
  const real = building(),
    forged: Building = {
      ...real,
      access: { x: real.access.x + 300, z: real.access.z + 300 },
    },
    request = { building: forged, fantasySecond: 0, intent: "enter-building" as const },
    character = characterDecideInteriorEntry(request),
    validation = simulationValidateInteriorEntry(request, character);
  assert.equal(character.accepted, true);
  assert.equal(validation.accessConnected, false);
  assert.equal(validation.valid, false);
});

test("Character rejects a malformed building identity before interior realization", () => {
  const malformed: Building = { ...building(), code: "" },
    request = { building: malformed, fantasySecond: 0, intent: "enter-building" as const },
    decision = characterDecideInteriorEntry(request);
  assert.equal(decision.accepted, false);
  const validation = simulationValidateInteriorEntry(request, decision);
  assert.equal(validation.valid, false);
});
