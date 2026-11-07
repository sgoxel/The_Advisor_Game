/**
 * Player-chosen protagonist (owner request). The assignment is a player
 * preference, so these tests pin that it is validated, persisted, observable and
 * that it can never invent or substitute a resident.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTAGONIST_STORAGE_KEY,
  clearProtagonist,
  getProtagonistCode,
  isResidentCode,
  readStoredProtagonist,
  resetProtagonistForTest,
  restoreProtagonist,
  setProtagonistCode,
  subscribeProtagonist,
} from "../src/protagonist.ts";

const CODE = "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/VILLAGE/0/RESIDENT/7";
const OTHER = CODE.replace(/\/RESIDENT\/7$/, "/RESIDENT/9");

/** Minimal localStorage stand-in so persistence is exercised, not skipped. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

test("only canonical resident codes are valid identities", () => {
  assert.equal(isResidentCode(CODE), true);
  assert.equal(isResidentCode(""), false);
  assert.equal(isResidentCode(undefined), false);
  assert.equal(isResidentCode(null), false);
  assert.equal(isResidentCode(42), false);
  assert.equal(isResidentCode("RESIDENT/7"), false);
  assert.equal(isResidentCode("plain name"), false);
  assert.equal(isResidentCode(CODE + "/extra"), false);
  assert.equal(isResidentCode("x/RESIDENT/07"), false, "leading zeros are not canonical");
  assert.equal(isResidentCode("x".repeat(600) + "/RESIDENT/1"), false, "absurd length rejected");
});

test("assigning a protagonist exposes exactly that code", () => {
  installStorage();
  resetProtagonistForTest();
  assert.equal(getProtagonistCode(), undefined);
  assert.equal(setProtagonistCode(CODE), true);
  assert.equal(getProtagonistCode(), CODE);
});

test("an invalid code is refused and cannot displace the current protagonist", () => {
  installStorage();
  resetProtagonistForTest();
  setProtagonistCode(CODE);
  assert.equal(setProtagonistCode("not a resident"), false);
  assert.equal(setProtagonistCode(undefined as unknown as string), true, "undefined clears deliberately");
  assert.equal(getProtagonistCode(), undefined);
});

test("subscribers observe assignments with a reason", () => {
  installStorage();
  resetProtagonistForTest();
  const seen: { code: string | undefined; reason: string }[] = [];
  const stop = subscribeProtagonist((code, reason) => seen.push({ code, reason }));
  setProtagonistCode(CODE, "user");
  setProtagonistCode(CODE, "user"); // no change -> no second event
  setProtagonistCode(OTHER, "user");
  clearProtagonist();
  stop();
  setProtagonistCode(CODE, "user"); // unsubscribed
  assert.deepEqual(seen, [
    { code: CODE, reason: "user" },
    { code: OTHER, reason: "user" },
    { code: undefined, reason: "clear" },
  ]);
});

test("a throwing listener cannot break assignment", () => {
  installStorage();
  resetProtagonistForTest();
  subscribeProtagonist(() => { throw new Error("boom"); });
  assert.equal(setProtagonistCode(CODE), true);
  assert.equal(getProtagonistCode(), CODE);
});

test("the choice persists and can be read back", () => {
  const store = installStorage();
  resetProtagonistForTest();
  setProtagonistCode(CODE);
  assert.equal(store.get(PROTAGONIST_STORAGE_KEY), CODE);
  assert.equal(readStoredProtagonist(), CODE);
  clearProtagonist();
  assert.equal(store.has(PROTAGONIST_STORAGE_KEY), false);
  assert.equal(readStoredProtagonist(), undefined);
});

test("a corrupt stored value is ignored instead of becoming identity", () => {
  const store = installStorage();
  resetProtagonistForTest();
  store.set(PROTAGONIST_STORAGE_KEY, "<script>alert(1)</script>");
  assert.equal(readStoredProtagonist(), undefined);
  // restore() must also refuse it.
  assert.equal(restoreProtagonist(() => true), undefined);
  assert.equal(getProtagonistCode(), undefined);
});

test("restore keeps a code only when the world resolver confirms it exists", () => {
  installStorage();
  resetProtagonistForTest();
  setProtagonistCode(CODE);
  resetProtagonistForTest();

  // Resolver says the resident no longer exists (different SEED/campaign).
  assert.equal(restoreProtagonist(() => false), undefined);
  assert.equal(getProtagonistCode(), undefined);
  assert.equal(readStoredProtagonist(), undefined, "stale choice is forgotten, not replaced");
});

test("restore re-establishes a valid choice without a user action", () => {
  installStorage();
  resetProtagonistForTest();
  setProtagonistCode(CODE);
  resetProtagonistForTest();

  const reasons: string[] = [];
  subscribeProtagonist((_code, reason) => reasons.push(reason));
  assert.equal(restoreProtagonist((code) => code === CODE), CODE);
  assert.equal(getProtagonistCode(), CODE);
  assert.deepEqual(reasons, ["restore"], "restore must not masquerade as a user assignment");
});

test("a throwing resolver is treated as 'does not exist'", () => {
  installStorage();
  resetProtagonistForTest();
  setProtagonistCode(CODE);
  resetProtagonistForTest();
  assert.equal(restoreProtagonist(() => { throw new Error("no world yet"); }), undefined);
  assert.equal(getProtagonistCode(), undefined);
});

test("with storage disabled the choice still works for the session", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  resetProtagonistForTest();
  assert.equal(setProtagonistCode(CODE), true);
  assert.equal(getProtagonistCode(), CODE);
  assert.equal(readStoredProtagonist(), undefined, "no durable claim when storage is unavailable");
});
