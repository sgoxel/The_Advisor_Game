/**
 * New-campaign seed choice: seed validation and normalisation, the suggestion
 * format, the fantasy year rule, and the module-init seed selection in config.ts.
 * Pure rules only (no DOM): the dialog itself is verified in the browser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  campaignNeedsChoice,
  createCampaign,
  fantasyYearAt,
  generateFantasyName,
  normaliseSeedInput,
  readCampaign,
  saveNewCampaign,
  suggestSeed,
} from "../src/campaign.ts";
import { CAMPAIGN_STORAGE_KEY, DEFAULT_WORLD_SEED, isValidSeedCode, resolveWorldSeed } from "../src/config.ts";
import { fantasyOrigin } from "../src/clock.ts";

function installStorage(initial?: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

/** A small deterministic random source in [0, 1) for repeatable name checks. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const SUGGESTION = /^ADVISOR-\d{4}-[A-Z]{3,}$/;

test("typed seeds are trimmed, upper-cased and spaces become hyphens", () => {
  assert.deepEqual(normaliseSeedInput("  advisor 0126  thornmere "), { seed: "ADVISOR-0126-THORNMERE" });
  assert.deepEqual(normaliseSeedInput("advisor-0126-alderwick"), { seed: "ADVISOR-0126-ALDERWICK" });
  assert.deepEqual(normaliseSeedInput("a"), { seed: "A" });
});

test("an empty seed is refused with a message the dialog can show", () => {
  const result = normaliseSeedInput("   ");
  assert.equal(result.seed, undefined);
  assert.match(result.error ?? "", /Enter a seed code/);
});

test("a seed longer than 96 characters is refused", () => {
  const result = normaliseSeedInput("A".repeat(97));
  assert.match(result.error ?? "", /96 characters/);
  assert.equal(normaliseSeedInput("A".repeat(96)).seed, "A".repeat(96));
});

test("seeds may contain only letters, numbers and hyphens", () => {
  for (const bad of ["SEED_1", "SEED.1", "SEED/1", "ÆTHER", "SEED!", "SEED+1"]) {
    const result = normaliseSeedInput(bad);
    assert.equal(result.seed, undefined, `${bad} must be refused`);
    assert.match(result.error ?? "", /letters, numbers and hyphens/);
  }
  assert.equal(normaliseSeedInput("seed-42").seed, "SEED-42");
});

test("the seed validator agrees with the normaliser", () => {
  assert.equal(isValidSeedCode("ADVISOR-0126-ALDERWICK"), true);
  assert.equal(isValidSeedCode(""), false);
  assert.equal(isValidSeedCode("x".repeat(97)), false);
  assert.equal(isValidSeedCode(42), false);
  assert.equal(isValidSeedCode(undefined), false);
});

test("the fantasy year is the Istanbul year minus 1900, matching the clock's origin", () => {
  // Instants chosen around the Istanbul new-year boundary (UTC+3) and mid-year.
  const instants = [
    Date.parse("2026-11-14T12:00:00Z"),
    Date.parse("2026-12-31T20:59:00Z"), // still 2026 in Istanbul
    Date.parse("2026-12-31T21:00:00Z"), // 2027 in Istanbul already
    Date.parse("2026-01-01T00:00:00Z"),
    Date.parse("2030-06-15T06:30:00Z"),
  ];
  for (const ms of instants) {
    assert.equal(fantasyYearAt(ms), new Date(fantasyOrigin(ms)).getUTCFullYear(), `year at ${new Date(ms).toISOString()}`);
  }
  assert.equal(fantasyYearAt(Date.parse("2026-12-31T21:00:00Z")), 127);
  assert.equal(fantasyYearAt(Date.parse("2026-11-14T12:00:00Z")), 126);
});

test("a suggestion follows ADVISOR-<YYYY>-<NAME> with the campaign's fantasy year", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  for (let i = 0; i < 200; i++) {
    const seed = suggestSeed(now, lcg(i + 1));
    assert.match(seed, SUGGESTION, `${seed} must match the seed style`);
    assert.equal(seed.slice("ADVISOR-".length, "ADVISOR-0126".length), "0126");
    assert.equal(isValidSeedCode(seed), true, `${seed} must be a valid seed code`);
  }
  const year = new Date(fantasyOrigin(now)).getUTCFullYear();
  assert.equal(suggestSeed(now, lcg(9)).slice(8, 12), String(year).padStart(4, "0"));
});

test("generated names are uppercase ASCII letters of at least three characters, with variety", () => {
  const names = new Set<string>();
  const random = lcg(7);
  for (let i = 0; i < 400; i++) {
    const name = generateFantasyName(random);
    assert.match(name, /^[A-Z]{3,}$/, `${name} must be letters only`);
    names.add(name);
  }
  assert.ok(names.size > 200, `expected varied names, got ${names.size} distinct of 400`);
});

test("suggestions use Math.random by default and always produce a valid seed", () => {
  for (let i = 0; i < 50; i++) assert.match(suggestSeed(), SUGGESTION);
});

test("a campaign keeps exactly the seed it was created with", () => {
  const record = createCampaign(Date.parse("2026-11-14T12:00:00Z"), "ADVISOR-0126-THORNMERE");
  assert.equal(record.seed, "ADVISOR-0126-THORNMERE");
  const other = createCampaign(Date.parse("2026-11-14T12:00:00Z"), DEFAULT_WORLD_SEED);
  assert.notEqual(record.id, other.id, "a different seed is a different campaign identity");
});

test("saving a new campaign stores it and reads back the same seed", () => {
  const store = installStorage();
  assert.equal(campaignNeedsChoice(), true, "empty storage must ask for a seed");
  assert.equal(saveNewCampaign("ADVISOR-0126-THORNMERE", Date.parse("2026-11-14T12:00:00Z")), true);
  assert.equal(store.has(CAMPAIGN_STORAGE_KEY), true);
  assert.equal(readCampaign().record?.seed, "ADVISOR-0126-THORNMERE");
  assert.equal(campaignNeedsChoice(), false, "a stored campaign is never asked for again");
});

test("unavailable storage is not a reason to ask, and a refused save is reported", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  assert.equal(campaignNeedsChoice(), false);
  assert.equal(saveNewCampaign("ADVISOR-0126-THORNMERE"), false);
});

test("a write that storage quietly drops is reported as not saved", () => {
  const store = installStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem = () => { /* dropped */ };
  assert.equal(saveNewCampaign("ADVISOR-0126-THORNMERE"), false);
  assert.equal(store.size, 0);
});

test("seed resolution: the test hook wins, then the stored campaign, then the default", () => {
  const stored = JSON.stringify({ version: "campaign-v1", id: "abc", seed: "ADVISOR-0126-THORNMERE", createdAtMs: 1 });
  assert.equal(resolveWorldSeed("ADVISOR-0126-HOOK", stored), "ADVISOR-0126-HOOK");
  assert.equal(resolveWorldSeed(undefined, stored), "ADVISOR-0126-THORNMERE");
  assert.equal(resolveWorldSeed("bad seed!", stored), "ADVISOR-0126-THORNMERE", "an invalid hook is ignored");
  assert.equal(resolveWorldSeed(undefined, null), DEFAULT_WORLD_SEED, "no storage gives the default");
  assert.equal(resolveWorldSeed(undefined, undefined), DEFAULT_WORLD_SEED);
});

test("seed resolution falls back to the default for corrupt, empty or implausible records", () => {
  assert.equal(resolveWorldSeed(undefined, "{not json"), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, "null"), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, JSON.stringify({ seed: "" })), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, JSON.stringify({ seed: "has space" })), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, JSON.stringify({ seed: 7 })), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, JSON.stringify({ seed: "A".repeat(97) })), DEFAULT_WORLD_SEED);
  assert.equal(resolveWorldSeed(undefined, "x".repeat(5000)), DEFAULT_WORLD_SEED);
});

test("config.ts evaluates WORLD_SEED from the hook and from storage at module init", () => {
  // A child process imports config.ts fresh, so the module-init path is exercised
  // exactly as the browser runs it. Node has no localStorage, so storage is simulated.
  const configUrl = new URL("../src/config.ts", import.meta.url).href;
  const run = (setup: string): string => {
    const code = `${setup}\nconst m = await import(${JSON.stringify(configUrl)});\nconsole.log(m.WORLD_SEED);`;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(run(""), DEFAULT_WORLD_SEED, "no storage and no hook gives the reference scenario");
  assert.equal(run(`globalThis.__ADVISOR_SEED__ = "ADVISOR-0126-THORNMERE";`), "ADVISOR-0126-THORNMERE");
  const stored = JSON.stringify({ version: "campaign-v1", id: "abc", seed: "ADVISOR-0127-BRAMHOLM", createdAtMs: 1 });
  assert.equal(
    run(`globalThis.localStorage = { getItem: (k) => (k === ${JSON.stringify(CAMPAIGN_STORAGE_KEY)} ? ${JSON.stringify(stored)} : null) };`),
    "ADVISOR-0127-BRAMHOLM",
    "the stored campaign's seed is the world seed",
  );
  assert.equal(
    run(`globalThis.localStorage = { getItem: () => { throw new Error("denied"); } };`),
    DEFAULT_WORLD_SEED,
    "a throwing storage falls back to the default",
  );
});
