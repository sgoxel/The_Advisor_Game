/**
 * Trust-gated advice acceptance (owner request): if the Advisor relationship is
 * good enough the character will consider changing their routine and may take a
 * single action. Below that it must refuse politely and never pretend.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADVICE_TRUST_FLOOR,
  ADVICE_TRUST_SURE,
  adviceVerdict,
  neutralState,
  trustShortfall,
  type CharacterState,
} from "../src/character-state.ts";
import { respond, type AdvisorFacts } from "../src/advisor-dialogue.ts";

const CODE = "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/VILLAGE/0/RESIDENT/12";

const state = (trust: number): CharacterState => ({ ...neutralState(CODE, 10), trust });

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
  personality: { diligence: 0.8, sociability: 0.5, piety: 0.5, temper: 0.5, curiosity: 0.5 },
  characterCode: CODE,
  day: 10,
  character: state(trust),
  ...over,
});

test("the trust floor and sure threshold are ordered and sane", () => {
  assert.ok(ADVICE_TRUST_FLOOR > 0 && ADVICE_TRUST_FLOOR < 100);
  assert.ok(ADVICE_TRUST_SURE > ADVICE_TRUST_FLOOR);
  assert.ok(ADVICE_TRUST_SURE <= 100);
});

test("adviceVerdict is a deterministic function of trust", () => {
  assert.equal(adviceVerdict(state(0)), "refuse");
  assert.equal(adviceVerdict(state(ADVICE_TRUST_FLOOR - 1)), "refuse");
  assert.equal(adviceVerdict(state(ADVICE_TRUST_FLOOR)), "consider");
  assert.equal(adviceVerdict(state(ADVICE_TRUST_SURE - 1)), "consider");
  assert.equal(adviceVerdict(state(ADVICE_TRUST_SURE)), "accept");
  assert.equal(adviceVerdict(state(100)), "accept");
  // Repeating the same query can never produce a different verdict.
  for (let i = 0; i < 10; i++) assert.equal(adviceVerdict(state(70)), "consider");
});

test("trustShortfall reports exactly what is still needed", () => {
  assert.equal(trustShortfall(state(ADVICE_TRUST_FLOOR)), 0);
  assert.equal(trustShortfall(state(ADVICE_TRUST_FLOOR - 1)), 1);
  assert.equal(trustShortfall(state(0)), ADVICE_TRUST_FLOOR);
  assert.equal(trustShortfall(state(100)), 0);
});

test("a low-trust character refuses travel advice and says what is missing", () => {
  const reply = respond("go to Greyfield", facts(30));
  assert.equal(reply.state, "refused");
  assert.match(reply.text, /know you well enough|not before my work|think on/i);
  assert.match(reply.text, /more trust would help/);
  assert.equal(reply.proposal?.targetName, "Greyfield");
});

test("an unknown place is refused at any trust level", () => {
  for (const trust of [0, 50, 100]) {
    const reply = respond("go to the castle of king nobody", facts(trust));
    assert.equal(reply.state, "refused", `trust ${trust} invented a destination`);
    assert.equal(reply.proposal?.targetId, undefined);
  }
});

test("a trusted character agrees to consider, without claiming it happened", () => {
  const reply = respond("go to Greyfield", facts(ADVICE_TRUST_SURE));
  assert.equal(reply.state, "proposed");
  assert.equal(reply.proposal?.targetName, "Greyfield");
  assert.equal(reply.proposal?.targetId, "0/0/2/0");
  // The line is a decision to weigh it, never a claim of travel.
  assert.doesNotMatch(reply.text, /\bI (have )?(arrived|left|reached)\b/i);
  assert.match(reply.text, /set out|consider|road allows/i);
});

test("a warm but not devoted character says they will consider, not that they will go", () => {
  const consider = respond("go to Greyfield", facts(ADVICE_TRUST_FLOOR + 2));
  assert.equal(consider.state, "proposed");
  assert.match(consider.text, /consider|if the day permits/i);
});

test("the acceptance decision is carried so the host can ask the Simulation", () => {
  const reply = respond("go to Greyfield", facts(90));
  assert.ok(reply.exchange, "a proposal must record an exchange");
  assert.equal(reply.exchange?.tag, "advice.travel_to_place");
  assert.equal(reply.exchange?.intent?.kind, "advice.travel_to_place");
  assert.equal(reply.exchange?.intent?.target, "Greyfield", "intent stores a readable name, not a raw id");
});

test("already travelling is refused regardless of trust", () => {
  const reply = respond("go to Greyfield", facts(100, { travelling: true }));
  assert.equal(reply.state, "refused");
  assert.match(reply.text, /already on the road/i);
});

test("advice for an unknown person is refused at any trust", () => {
  for (const trust of [10, 100]) {
    const reply = respond("talk to somebody imaginary", facts(trust));
    assert.equal(reply.state, "refused");
    assert.equal(reply.proposal?.targetId, undefined);
  }
});
