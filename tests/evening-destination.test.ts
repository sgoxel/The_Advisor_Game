/**
 * Post-duty destination advice (owner request): after duty the protagonist would
 * normally go home, but a trusted Advisor can persuade them to the inn or the
 * market instead. This must change the day plan, persist, and be trust-gated.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { dailyPlan, type Activity, type EveningAdvice } from "../src/routines.ts";
import {
  ADVICE_TRUST_FLOOR,
  ADVICE_TRUST_SURE,
  applyExchange,
  clearEveningPlan,
  createMemoryCharacterStore,
  eveningAdviceFor,
  loadCharacter,
  neutralState,
  saveCharacter,
  setCharacterStore,
  setEveningPlan,
  validateCharacterState,
  type CharacterState,
} from "../src/character-state.ts";
import { respond, type AdvisorFacts } from "../src/advisor-dialogue.ts";

const CODE = "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/VILLAGE/0/RESIDENT/12";
const TRAITS = { personality: { diligence: 0.81, sociability: 0.34, piety: 0.52, temper: 0.72, curiosity: 0.41 } };
const GUARD = { code: CODE, role: "guard" as const, ageGroup: "adult" as const, guardShift: 0 as const };

const eveningOf = (plan: readonly Activity[]) =>
  plan.filter((entry) => entry.start >= 17 * 3600 && entry.start < 23 * 3600);

const anchorsOf = (plan: readonly Activity[]) => eveningOf(plan).map((entry) => entry.anchor);

const facts = (trust: number, over: Partial<AdvisorFacts> = {}): AdvisorFacts => ({
  name: "Osiwin Briarwell",
  role: "guard",
  settlement: "Alderwick",
  homeName: "Briarwell House",
  workName: "Alderwick gate post",
  task: "Standing the dusk watch",
  activity: "on guard duty",
  indoors: false,
  mood: "calm",
  moodValue: 0,
  clockLabel: "14:20",
  daylightPhase: "day",
  travelling: false,
  knownPlaces: [{ id: "0/0/2/0", name: "Greyfield" }],
  knownPeople: [],
  hour: 14.3,
  region: "Dunmarch",
  placeKind: "village",
  ageGroup: "adult",
  personality: TRAITS.personality,
  characterCode: CODE,
  day: 10,
  character: { ...neutralState(CODE, 10), trust },
  ...over,
});

/* ---------------------------------------------------------------- */
/* The day plan really changes                                       */
/* ---------------------------------------------------------------- */

test("without advice a guard's evening is their own seeded choice", () => {
  const plan = dailyPlan(GUARD, TRAITS, 200, 2, false);
  const anchors = anchorsOf(plan);
  assert.ok(anchors.includes("home"), "an unadvised evening resolves somewhere, and sleep stays at home");
  // Sleep is never removed by any advice.
  assert.ok(plan.some((entry) => entry.kind === "sleep" && entry.anchor === "home"));
});

test("advising the inn puts the guard at the inn after duty", () => {
  const plan = dailyPlan(GUARD, TRAITS, 200, 2, false, { destination: "inn" });
  const evening = eveningOf(plan);
  assert.ok(evening.some((entry) => entry.anchor === "inn" && entry.kind === "commute"));
  assert.ok(evening.some((entry) => entry.anchor === "inn" && entry.kind === "dinner"));
  assert.ok(evening.some((entry) => entry.anchor === "inn" && entry.kind === "socialise"));
  // Still home to sleep.
  assert.ok(plan.some((entry) => entry.kind === "sleep" && entry.anchor === "home"));
});

test("advising the market sends the guard to the market, then home", () => {
  const plan = dailyPlan(GUARD, TRAITS, 200, 2, false, { destination: "market" });
  const evening = eveningOf(plan);
  assert.ok(evening.some((entry) => entry.anchor === "market" && entry.kind === "commute"));
  assert.ok(evening.some((entry) => entry.anchor === "market" && entry.kind === "errand"));
  const marketIndex = evening.findIndex((entry) => entry.anchor === "market");
  const homeDinner = evening.findIndex((entry) => entry.anchor === "home" && entry.kind === "dinner");
  assert.ok(homeDinner > marketIndex, "they eat at home after the market");
});

test("advising home removes the inn trip entirely", () => {
  const plan = dailyPlan(GUARD, TRAITS, 200, 2, false, { destination: "home" });
  assert.equal(anchorsOf(plan).includes("inn"), false, "no inn appears when told to go home");
  assert.ok(plan.some((entry) => entry.kind === "dinner" && entry.anchor === "home"));
});

test("work hours, sleep and the rest of the day are untouched by evening advice", () => {
  const base = dailyPlan(GUARD, TRAITS, 200, 2, false);
  for (const destination of ["inn", "market", "home"] as const) {
    const advised = dailyPlan(GUARD, TRAITS, 200, 2, false, { destination });
    // Guard duty must start at the same minute.
    const duty = (plan: readonly Activity[]) => plan.find((entry) => entry.kind === "guard")?.start;
    assert.equal(duty(advised), duty(base), `guard duty moved for ${destination}`);
    // Bedtime must be unchanged.
    const bed = (plan: readonly Activity[]) => plan.find((entry) => entry.kind === "sleep")?.start;
    assert.equal(bed(advised), bed(base), `bedtime moved for ${destination}`);
  }
});

test("the generic evening (non-guard) also honours the advice", () => {
  const farmer = { code: CODE, role: "farmer" as const, ageGroup: "adult" as const };
  const advised = dailyPlan(farmer, TRAITS, 200, 2, false, { destination: "inn" } satisfies EveningAdvice);
  assert.ok(anchorsOf(advised).includes("inn"), "a farmer told to go to the inn goes to the inn");
  const home = dailyPlan(farmer, TRAITS, 200, 2, false, { destination: "market" });
  assert.ok(anchorsOf(home).includes("market"));
});

test("the standing-only roster view is unaffected by advice", () => {
  // Standing ranks never decide from an evening preference, so timing must not change.
  const base = dailyPlan(GUARD, TRAITS, 200, 2, true);
  const advised = dailyPlan(GUARD, TRAITS, 200, 2, true, { destination: "inn" });
  assert.deepEqual(advised.length, base.length);
});

/* ---------------------------------------------------------------- */
/* Persistence                                                       */
/* ---------------------------------------------------------------- */

test("an evening preference is saved, validated and read back", () => {
  setCharacterStore(createMemoryCharacterStore());
  let state = neutralState(CODE, 10);
  state = setEveningPlan(state, "inn", 10);
  assert.equal(state.evening?.destination, "inn");
  assert.equal(validateCharacterState(state), true);
  saveCharacter(state);
  assert.equal(loadCharacter(CODE, 10).evening?.destination, "inn");
});

test("the Simulation reads the saved destination through the cached helper", () => {
  const store = createMemoryCharacterStore();
  setCharacterStore(store);
  store.write(setEveningPlan(neutralState(CODE, 10), "market", 10));
  assert.deepEqual(eveningAdviceFor(CODE), { destination: "market" });
});

test("a character with no saved preference keeps their seeded choice", () => {
  setCharacterStore(createMemoryCharacterStore());
  assert.equal(eveningAdviceFor(CODE), undefined);
});

test("a malformed evening preference invalidates the save instead of being trusted", () => {
  const bad = { ...neutralState(CODE, 1), evening: { destination: "palace", day: 1 } };
  assert.equal(validateCharacterState(bad), false);
  const badDay = { ...neutralState(CODE, 1), evening: { destination: "inn", day: "soon" } };
  assert.equal(validateCharacterState(badDay), false);
});

test("clearing the preference restores the seeded choice", () => {
  let state = setEveningPlan(neutralState(CODE, 10), "inn", 10);
  state = clearEveningPlan(state);
  assert.equal(state.evening, undefined);
  assert.equal(validateCharacterState(state), true);
});

/* ---------------------------------------------------------------- */
/* Trust gate                                                        */
/* ---------------------------------------------------------------- */

test("a low-trust character refuses to change their evening", () => {
  const reply = respond("go to the inn after work", facts(30));
  assert.equal(reply.state, "refused");
  assert.match(reply.text, /do not know you well enough/i);
  assert.match(reply.text, /more trust would help/i);
});

test("a trusted character accepts the inn and the market", () => {
  const inn = respond("go to the inn after work", facts(ADVICE_TRUST_SURE));
  assert.equal(inn.state, "proposed");
  assert.equal(inn.proposal?.intent, "advice.evening_inn");

  const market = respond("go to the market after your shift", facts(ADVICE_TRUST_SURE));
  assert.equal(market.state, "proposed");
  assert.equal(market.proposal?.intent, "advice.evening_market");

  const home = respond("go straight home after work", facts(ADVICE_TRUST_SURE));
  assert.equal(home.state, "proposed");
  assert.equal(home.proposal?.intent, "advice.evening_home");
});

test("a warm-but-not-devoted character will try it, without claiming certainty", () => {
  const reply = respond("go to the tavern after work", facts(ADVICE_TRUST_FLOOR + 2));
  assert.equal(reply.state, "proposed");
  assert.match(reply.text, /try it|will/i);
});

test("evening advice is a different intent from ordinary travel advice", () => {
  const evening = respond("go to the inn after work", facts(ADVICE_TRUST_SURE));
  const travel = respond("go to Greyfield", facts(ADVICE_TRUST_SURE));
  assert.notEqual(evening.proposal?.intent, travel.proposal?.intent);
});

test("trust earned through conversation unlocks the evening advice", () => {
  let state: CharacterState = neutralState(CODE, 10);
  const ask = (tag: string, day: number) => {
    const outcome = applyExchange(state, { tag, day, moodBand: "calm" });
    state = outcome.state;
  };
  // Earn trust over several days of supportive attention.
  for (let day = 10; day < 40; day++) {
    ask("help", day);
    ask("need", day);
    ask("feeling", day);
  }
  assert.ok(state.trust >= ADVICE_TRUST_FLOOR, `trust only reached ${state.trust}`);
  const reply = respond("go to the inn after work", facts(state.trust));
  assert.equal(reply.state, "proposed");
});
