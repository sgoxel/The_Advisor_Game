/**
 * Character campaign state: conversation must be able to shade a character's
 * mood and the Advisor relationship, be saved per character, and never touch
 * world truth (position, resources, ownership, rank).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARACTER_STATE_VERSION,
  MEMORY_LIMIT,
  MOOD_DELTA_LIMIT,
  MOOD_DECAY_PER_DAY,
  TRUST_MAX,
  TRUST_MIN,
  TRUST_NEUTRAL,
  applyExchange,
  clampMoodDelta,
  createMemoryCharacterStore,
  decayState,
  effectiveMoodValue,
  effectFor,
  isResidentCode,
  loadCharacter,
  moodLabelFor,
  neutralState,
  saveCharacter,
  setCharacterStore,
  statusOf,
  storageKeyFor,
  trustLabel,
  validateCharacterState,
  type CharacterState,
} from "../src/character-state.ts";

const CODE = "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/VILLAGE/0/RESIDENT/7";

/** Minimal localStorage so persistence is genuinely exercised. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
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

const state = (overrides: Partial<CharacterState> = {}): CharacterState => ({ ...neutralState(CODE, 1), ...overrides });

test("a new character starts neutral and unremarkable", () => {
  const fresh = neutralState(CODE, 3);
  assert.equal(fresh.trust, TRUST_NEUTRAL);
  assert.equal(fresh.moodDelta, 0);
  assert.deepEqual([...fresh.memories], []);
  assert.equal(fresh.version, CHARACTER_STATE_VERSION);
});

test("attentive questions raise trust and lift mood a little", () => {
  const outcome = applyExchange(state(), { tag: "feeling", day: 1, moodBand: "calm" });
  assert.ok(outcome.trustDelta > 0, "asking how they are should build regard");
  assert.ok(outcome.moodDelta > 0);
  assert.ok(outcome.state.trust > TRUST_NEUTRAL);
});

test("offering help is the strongest trust builder", () => {
  const help = effectFor("help", { trust: 50, moodBand: "calm" });
  const feeling = effectFor("feeling", { trust: 50, moodBand: "calm" });
  assert.ok(help.trust > feeling.trust);
});

test("prying costs trust when the relationship is still cold", () => {
  const cold = effectFor("secrets", { trust: 20, moodBand: "calm" });
  assert.ok(cold.trust < 0, "intrusive questions should cost trust when trust is low");
  assert.ok(cold.mood < 0);
  // The same question is tolerated once the character trusts you.
  const warm = effectFor("secrets", { trust: 80, moodBand: "calm" });
  assert.ok(warm.trust >= 0, "a trusted advisor may ask");
});

test("declining advice is honest, not betrayal", () => {
  const refused = effectFor("advice", { trust: 50, moodBand: "calm", refused: true });
  assert.ok(refused.trust >= 0, "refusing advice must not punish the player");
  assert.equal(refused.mood, 0);
});

test("attention cannot be farmed: the same tag credits once per day", () => {
  let current = state();
  const first = applyExchange(current, { tag: "feeling", day: 5, moodBand: "calm" });
  current = first.state;
  const trustAfterFirst = current.trust;
  const second = applyExchange(current, { tag: "feeling", day: 5, moodBand: "calm" });
  assert.equal(second.repeated, true);
  assert.equal(second.trustDelta, 0);
  assert.equal(second.state.trust, trustAfterFirst, "repeating must not raise trust");
  // A different subject still counts.
  const third = applyExchange(second.state, { tag: "home", day: 5, moodBand: "calm" });
  assert.equal(third.repeated, false);
  assert.ok(third.state.trust > trustAfterFirst);
  // The next day reopens the same tag.
  const nextDay = applyExchange(third.state, { tag: "feeling", day: 6, moodBand: "calm" });
  assert.equal(nextDay.repeated, false);
});

test("trust and mood stay inside their bounds", () => {
  let current = state();
  for (let turn = 0; turn < 200; turn++) {
    current = applyExchange(current, { tag: "help", day: turn, moodBand: "calm" }).state;
  }
  assert.ok(current.trust <= TRUST_MAX, `trust escaped the cap: ${current.trust}`);
  assert.ok(current.moodDelta <= MOOD_DELTA_LIMIT + 1e-9, `mood escaped the cap: ${current.moodDelta}`);

  let hostile = state({ trust: 5 });
  for (let turn = 0; turn < 200; turn++) {
    hostile = applyExchange(hostile, { tag: "secrets", day: turn, moodBand: "calm" }).state;
  }
  assert.ok(hostile.trust >= TRUST_MIN, `trust fell below the floor: ${hostile.trust}`);
  assert.ok(hostile.moodDelta >= -MOOD_DELTA_LIMIT - 1e-9);
});

test("mood decays back toward the SEED baseline over fantasy days", () => {
  const lifted = state({ moodDelta: 0.3, updatedDay: 1 });
  const later = decayState(lifted, 1 + 4);
  assert.ok(later.moodDelta < lifted.moodDelta);
  assert.ok(Math.abs(later.moodDelta - (0.3 - MOOD_DECAY_PER_DAY * 4)) < 1e-6);
  // It approaches zero but is applied to a bounded range.
  const muchLater = decayState(lifted, 100);
  assert.ok(Math.abs(muchLater.moodDelta) <= MOOD_DELTA_LIMIT);
  assert.ok(muchLater.moodDelta <= 0);
});

test("the mood offset is a bounded overlay on the seeded baseline", () => {
  assert.equal(effectiveMoodValue(0.2, 0.1), 0.3);
  assert.equal(effectiveMoodValue(0.9, 0.4), 1, "clamped at 1");
  assert.equal(effectiveMoodValue(-0.9, -0.4), -1, "clamped at -1");
  assert.equal(clampMoodDelta(5), MOOD_DELTA_LIMIT);
  assert.equal(clampMoodDelta(-5), -MOOD_DELTA_LIMIT);
});

test("effective mood maps back to the canonical mood labels", () => {
  assert.equal(moodLabelFor(0.8, 12), "cheerful");
  assert.equal(moodLabelFor(0.3, 12), "content");
  assert.equal(moodLabelFor(0, 12), "calm");
  assert.equal(moodLabelFor(-0.3, 12), "grumpy");
  assert.equal(moodLabelFor(-0.3, 23), "tired");
  assert.equal(moodLabelFor(-0.8, 12), "miserable");
});

test("status marks reflect the saved relationship", () => {
  assert.equal(statusOf(state({ trust: 10 })), "wary");
  assert.equal(statusOf(state({ trust: 90 })), "confiding");
  assert.equal(statusOf(state({ trust: 50, moodDelta: 0.25 })), "hopeful");
  assert.equal(statusOf(state({ trust: 50, moodDelta: -0.25 })), "low");
  assert.equal(statusOf(state({ trust: 50, moodDelta: 0 })), undefined);
});

test("trust reads as a human label", () => {
  assert.equal(trustLabel(90), "devoted");
  assert.equal(trustLabel(50), "neutral");
  assert.equal(trustLabel(10), "hostile");
});

test("memories are kept, capped, and record what was asked", () => {
  let current = state();
  for (let day = 0; day < MEMORY_LIMIT + 6; day++) {
    current = applyExchange(current, { tag: "feeling", day, moodBand: "calm" }).state;
  }
  assert.equal(current.memories.length, MEMORY_LIMIT, "memory must be bounded");
  assert.equal(current.memories.at(-1)?.tag, "feeling");
  assert.ok(current.memories.every((memory) => typeof memory.day === "number"));
});

test("intents are recorded and replaced per kind, so advice leaves a trace", () => {
  let current = applyExchange(state(), { tag: "advice", day: 2, moodBand: "calm", intent: { kind: "travel", target: "Greyfield" } }).state;
  assert.equal(current.intents.length, 1);
  current = applyExchange(current, { tag: "advice", day: 3, moodBand: "calm", intent: { kind: "travel", target: "Alderwick" } }).state;
  assert.equal(current.intents.length, 1, "a newer travel intent replaces the older one");
  assert.equal(current.intents[0].target, "Alderwick");
  current = applyExchange(current, { tag: "advice", day: 4, moodBand: "calm", intent: { kind: "rest", target: "" } }).state;
  assert.equal(current.intents.length, 2);
});

/* ---------------------------------------------------------------- */
/* Persistence                                                       */
/* ---------------------------------------------------------------- */

test("state saves and reloads per character, so each NPC keeps their own history", () => {
  installStorage();
  setCharacterStore(undefined);
  const other = CODE.replace(/\/RESIDENT\/7$/, "/RESIDENT/9");

  const first = applyExchange(loadCharacter(CODE, 1), { tag: "help", day: 1, moodBand: "calm" });
  saveCharacter(first.state);
  const second = applyExchange(loadCharacter(other, 1), { tag: "secrets", day: 1, moodBand: "calm" });
  saveCharacter(second.state);

  const reloaded = loadCharacter(CODE, 1);
  assert.equal(reloaded.code, CODE);
  assert.equal(reloaded.trust, first.state.trust);
  assert.notEqual(reloaded.trust, loadCharacter(other, 1).trust, "characters must not share a history");
});

test("an unsaved character loads neutral rather than borrowing another's state", () => {
  installStorage();
  setCharacterStore(undefined);
  const fresh = loadCharacter(CODE, 4);
  assert.equal(fresh.trust, TRUST_NEUTRAL);
  assert.deepEqual([...fresh.memories], []);
});

test("a corrupt or hand-edited save is rejected", () => {
  const store = installStorage();
  const key = storageKeyFor(CODE);
  store.set(key, "{not json");
  assert.equal(loadCharacter(CODE, 1).trust, TRUST_NEUTRAL);

  store.set(key, JSON.stringify({ ...neutralState(CODE, 1), trust: 9999 }));
  assert.equal(loadCharacter(CODE, 1).trust, TRUST_NEUTRAL, "out-of-range trust must be refused");

  store.set(key, JSON.stringify({ ...neutralState(CODE, 1), code: "somebody-else/RESIDENT/1" }));
  assert.equal(loadCharacter(CODE, 1).trust, TRUST_NEUTRAL, "a save for another character must be refused");
});

test("validation rejects malformed shapes and accepts a real one", () => {
  assert.equal(validateCharacterState(neutralState(CODE, 1)), true);
  assert.equal(validateCharacterState(null), false);
  assert.equal(validateCharacterState({}), false);
  assert.equal(validateCharacterState({ ...neutralState(CODE, 1), trust: "high" }), false);
  assert.equal(validateCharacterState({ ...neutralState(CODE, 1), moodDelta: 9 }), false);
  assert.equal(validateCharacterState({ ...neutralState(CODE, 1), memories: "nope" }), false);
  assert.equal(validateCharacterState(neutralState(CODE, 1), CODE), true);
  assert.equal(validateCharacterState(neutralState(CODE, 1), "other/RESIDENT/1"), false);
});

test("storage-disabled play still works for the session", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  setCharacterStore(createMemoryCharacterStore());
  const outcome = applyExchange(loadCharacter(CODE, 1), { tag: "feeling", day: 1, moodBand: "calm" });
  saveCharacter(outcome.state);
  assert.equal(loadCharacter(CODE, 1).trust, outcome.state.trust);
});

test("resident code validation rejects nonsense", () => {
  assert.equal(isResidentCode(CODE), true);
  assert.equal(isResidentCode("not a code"), false);
  assert.equal(isResidentCode(""), false);
  assert.equal(isResidentCode(undefined), false);
});

test("state never contains world-truth fields", () => {
  const outcome = applyExchange(state(), { tag: "help", day: 1, moodBand: "calm" });
  for (const forbidden of ["position", "x", "z", "rank", "title", "gold", "resources", "owner", "home", "workplace"]) {
    assert.equal(Object.hasOwn(outcome.state, forbidden), false, `state must not carry "${forbidden}"`);
  }
});
