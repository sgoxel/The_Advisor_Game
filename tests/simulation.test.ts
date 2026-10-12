import assert from "node:assert/strict";
import test from "node:test";
import { cities, countries, villages } from "../src/geography.ts";
import {
  LazySimulation,
  gateCountFor,
  guardCoverageAt,
  guardsPerGateFor,
  populationOf,
  residentAt,
  residentFoundationAt,
} from "../src/simulation.ts";

const HOUR = 3600;

test("resident foundations give every logical resident one stable distinct home", () => {
  const village = villages[0];
  const homes = new Set<string>();
  for (let index = 0; index < populationOf(village); index++) {
    const first = residentFoundationAt(village, index);
    const replay = residentFoundationAt(village, index);
    assert.deepEqual(replay, first);
    assert.equal(first.home, village.id);
    assert.equal(first.settlement, village.id);
    assert.equal(first.homeEntrance, `${first.homeBuilding}/ENTRANCE`);
    assert.match(
      first.homeBuilding,
      new RegExp(
        `${village.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/HOME\\/${index}$`,
      ),
    );
    assert.ok(first.workplace.startsWith(village.code));
    assert.ok(!homes.has(first.homeBuilding), `duplicate home ${first.homeBuilding}`);
    homes.add(first.homeBuilding);
  }
  assert.equal(homes.size, populationOf(village));
});

test("every village has required service staff and continuous seeded gate coverage", () => {
  const serviceRoles = new Set([
    "innkeeper",
    "merchant",
    "blacksmith",
    "farmer",
    "butcher",
    "guard-officer",
  ]);
  for (const village of villages) {
    const initialRoles = new Set(
      Array.from({ length: 6 }, (_, index) =>
        residentFoundationAt(village, index).role,
      ),
    );
    assert.deepEqual(initialRoles, serviceRoles, `${village.code} service roster`);
    assert.ok(gateCountFor(village) === 1 || gateCountFor(village) === 2);
    for (const tick of [0, 6 * HOUR, 12 * HOUR, 18 * HOUR, 23 * HOUR + 3599]) {
      const coverage = guardCoverageAt(village, tick);
      assert.equal(coverage.length, gateCountFor(village));
      for (const gate of coverage) {
        assert.equal(gate.required, guardsPerGateFor(village, gate.gateIndex));
        assert.equal(
          gate.onDuty,
          gate.required,
          `${village.code} gate ${gate.gateIndex} at ${tick}`,
        );
        assert.equal(new Set(gate.residentCodes).size, gate.onDuty);
      }
    }
  }
});

test("resident schedule state is analytical from absolute fantasy time", () => {
  const village = villages[0];
  const tick = 14 * HOUR + 1234;
  const direct = residentAt(village, 3, tick);
  const simulation = new LazySimulation();
  simulation.setFocus(village);
  simulation.advance(1);
  simulation.advance(8000);
  simulation.advance(tick);
  const caughtUp = simulation.residentByCode(direct.code);
  assert.deepEqual(caughtUp, direct);
  assert.equal(caughtUp?.role, "farmer");
  assert.equal(caughtUp?.task, "Working the farm");
});

test("advance never rebuilds a focused country's resident objects", () => {
  const city = cities[0];
  const country = countries.find(
    (entry) => entry.continent === city.continent && entry.id === city.country,
  )!;
  const simulation = new LazySimulation();
  simulation.setFocus(city);
  for (const tick of [1, 2, 3, 60, 3600, 7200]) {
    simulation.advance(tick);
    assert.equal(simulation.stats.liveCountries, 1);
    assert.equal(simulation.stats.activeScheduleRecords, 0);
    assert.equal(simulation.stats.residentEvaluationsSinceAdvance, 0);
    assert.ok(simulation.stats.logicalResidents >= populationOf(city));
    assert.equal(
      simulation.summaries.get(country.code)?.tier,
      "live",
      "focused country summary remains live",
    );
  }
});

test("focused resident queries are spatially bounded and actor-budget bounded", () => {
  const city = cities[0];
  const simulation = new LazySimulation();
  simulation.setFocus(city);
  simulation.advance(9 * HOUR);
  const visible = simulation.focusedResidents(city.x, city.z, 8, 96);
  const stats = simulation.stats;
  assert.ok(visible.length <= 96);
  assert.equal(stats.query.returnedResidents, visible.length);
  assert.ok(stats.query.settlements >= 1);
  assert.ok(stats.query.candidateResidents >= populationOf(city));
  assert.ok(stats.query.candidateResidents < stats.logicalResidents);
  assert.ok(stats.query.evaluatedResidents <= stats.query.candidateResidents);
  assert.ok(stats.query.evaluatedResidents < stats.logicalResidents);
  assert.equal(new Set(visible.map((resident) => resident.code)).size, visible.length);
});
