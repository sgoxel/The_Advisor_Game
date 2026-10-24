import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LazySimulation, residentAt } from "../src/simulation.ts";
import { villages } from "../src/geography.ts";

test("a house click reads the owner's identity without simulating anyone", () => {
  const simulation = new LazySimulation(), place = villages[0], code = `${place.code}/RESIDENT/3`;
  const started = performance.now(), identity = simulation.residentIdentityByCode(code), elapsed = performance.now() - started;
  const full = residentAt(place, 3, 12 * 3600);
  assert.ok(identity, "identity resolved");
  assert.equal(identity!.name, full.name);
  assert.equal(identity!.role, full.role);
  assert.equal(identity!.code, full.code);
  assert.ok(elapsed < 250, `identity lookup took ${elapsed.toFixed(0)} ms`);
  assert.equal(simulation.residentIdentityByCode("nonsense"), undefined);
  assert.equal(simulation.residentIdentityByCode(`${place.code}/RESIDENT/999999`), undefined);
});

test("the building click path never re-simulates the neighbourhood on the UI thread", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const start = main.indexOf("function openGameInfoAt("), end = main.indexOf("\nfunction ", start + 10);
  assert.ok(start > 0 && end > start, "openGameInfoAt found");
  const body = main.slice(start, end);
  assert.doesNotMatch(body, /focusedResidents\(|residentByCode\(/, "house cards use the worker snapshot and seeded identity only");
  assert.match(body, /residentQueries\.current/);
});
