/**
 * Dialogue tree (owner request): 100+ ready-made questions, answers that depend
 * on NPC state, and chains that continue or change with those states.
 *
 * The tests pin the guarantees the feature must keep:
 *  - the shipped library really contains at least 100 distinct questions;
 *  - every topic is reachable and every topic has an unconditional fallback;
 *  - answers change with mood, time, role, place and personality;
 *  - "why?" answers from the cause of the answer just heard;
 *  - chains continue deterministically and never invent world facts.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SENTENCE_LIBRARY,
  interpret,
  normalizeMessage,
} from "../src/sentence-library.ts";
import {
  TOPICS,
  TOPIC_IDS,
  answerTopic,
  bandOf,
  canonicalQuestion,
  moodBandOf,
  roleGroupOf,
  temperBandOf,
  timeBandOf,
  type DialogueContextFacts,
  type TopicId,
} from "../src/dialogue-topics.ts";
import { Conversation, contextFromFacts, respond, type AdvisorFacts } from "../src/advisor-dialogue.ts";

const facts = (overrides: Partial<AdvisorFacts> = {}): AdvisorFacts => ({
  name: "Wynriwald Lakewell",
  role: "farmer",
  settlement: "Alderwick",
  homeName: "Lakewell House",
  workName: "the north fields",
  task: "Tending the grain",
  activity: "in the fields",
  indoors: false,
  mood: "miserable",
  moodValue: -0.6,
  clockLabel: "09:47",
  daylightPhase: "day",
  travelling: false,
  knownPlaces: [{ id: "0/0/2/0", name: "Greyfield" }],
  knownPeople: [],
  hour: 9.8,
  region: "the Verdant Marches",
  placeKind: "village",
  ageGroup: "adult",
  personality: { diligence: 0.8, sociability: 0.3, piety: 0.5, temper: 0.7, curiosity: 0.4 },
  ...overrides,
});

const context = (overrides: Partial<DialogueContextFacts> = {}): DialogueContextFacts =>
  ({ ...contextFromFacts(facts()), ...overrides });

/* ---------------------------------------------------------------- */
/* Size and coverage                                                 */
/* ---------------------------------------------------------------- */

test("the library ships at least 100 distinct ready-made questions", () => {
  const questions = SENTENCE_LIBRARY.filter((entry) => entry.intent === "query.topic" || entry.intent.startsWith("followup."));
  assert.ok(questions.length >= 100, `expected at least 100 questions, found ${questions.length}`);
  const distinct = new Set(questions.map((entry) => normalizeMessage(entry.match)));
  assert.ok(distinct.size >= 100, `expected at least 100 distinct question texts, found ${distinct.size}`);
});

test("the topic tree covers many personal and practical subjects", () => {
  assert.ok(TOPICS.length >= 25, `expected at least 25 topics, found ${TOPICS.length}`);
  for (const required of ["feeling", "work", "home", "family", "food", "pay", "danger", "lord", "faith", "plans", "regret", "hope", "trust", "secrets"]) {
    assert.ok(TOPIC_IDS.includes(required as TopicId), `missing topic "${required}"`);
  }
});

test("no question text is declared twice, so no phrase resolves two ways", () => {
  const matches = SENTENCE_LIBRARY.map((entry) => normalizeMessage(entry.match));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const match of matches) {
    if (seen.has(match)) duplicates.push(match);
    seen.add(match);
  }
  assert.deepEqual(duplicates, []);
});

test("every topic has an unconditional fallback variant and a non-empty question list", () => {
  for (const topic of TOPICS) {
    assert.ok(topic.asks.length > 0, `${topic.id} has no questions`);
    const last = topic.variants[topic.variants.length - 1];
    assert.equal(last.when, undefined, `${topic.id} must end with an unconditional fallback`);
    for (const variant of topic.variants) assert.ok(variant.text.length > 0, `${topic.id} has an empty answer`);
  }
});

test("every declared follow-up points at a real topic", () => {
  for (const topic of TOPICS) {
    for (const next of topic.followUps) assert.ok(TOPIC_IDS.includes(next), `${topic.id} follows up to unknown "${next}"`);
  }
});

test("every topic is reachable by typing one of its questions", () => {
  for (const topic of TOPICS) {
    const result = interpret(topic.asks[0]);
    assert.equal(result.kind, "resolved", `"${topic.asks[0]}" did not resolve`);
    if (result.kind !== "resolved") continue;
    assert.equal(result.top.intent, "query.topic", `"${topic.asks[0]}" did not reach the topic tree`);
  }
});

/* ---------------------------------------------------------------- */
/* State-dependent answers                                           */
/* ---------------------------------------------------------------- */

test("mood changes the answer to the same question", () => {
  const miserable = answerTopic("feeling", context({ mood: "miserable" }));
  const cheerful = answerTopic("feeling", context({ mood: "cheerful" }));
  assert.ok(miserable && cheerful);
  assert.notEqual(miserable.text, cheerful.text);
  assert.match(miserable.text, /Miserable/i);
  assert.match(cheerful.text, /smile|suits me/i);
});

test("time of day changes the answer", () => {
  const night = answerTopic("sleep", context({ time: "night" }));
  const morning = answerTopic("sleep", context({ time: "morning", role: "farmer" }));
  assert.ok(night && morning);
  assert.notEqual(night.text, morning.text);
  assert.match(night.text, /asleep/i);
});

test("role changes the answer", () => {
  const guard = answerTopic("work", context({ role: "guard" }));
  const farmer = answerTopic("work", context({ role: "farmer" }));
  const artisan = answerTopic("work", context({ role: "artisan" }));
  assert.ok(guard && farmer && artisan);
  assert.equal(new Set([guard.text, farmer.text, artisan.text]).size, 3);
  assert.match(guard.text, /gate/i);
  assert.match(farmer.text, /Farming/i);
});

test("place kind and personality change the answer", () => {
  const city = answerTopic("place", context({ place: "city" }));
  const village = answerTopic("place", context({ place: "village", mood: "calm" }));
  assert.ok(city && village);
  assert.notEqual(city.text, village.text);

  const social = answerTopic("friends", context({ sociability: "high" }));
  const solitary = answerTopic("friends", context({ sociability: "low" }));
  assert.ok(social && solitary);
  assert.notEqual(social.text, solitary.text);
});

test("age and temper change the answer", () => {
  const elder = answerTopic("childhood", context({ ageGroup: "elder" }));
  const adult = answerTopic("childhood", context({ ageGroup: "adult", curiosity: "mid" }));
  assert.ok(elder && adult);
  assert.notEqual(elder.text, adult.text);

  const hot = answerTopic("lord", context({ temper: "hot" }));
  const even = answerTopic("lord", context({ temper: "even" }));
  assert.ok(hot && even);
  assert.notEqual(hot.text, even.text);
});

test("the same facts always produce the same answer", () => {
  const a = answerTopic("work", context());
  const b = answerTopic("work", context());
  assert.deepEqual(a, b);
});

test("band helpers classify their inputs", () => {
  assert.equal(moodBandOf("miserable", -0.9), "miserable");
  assert.equal(moodBandOf("cheerful", 0.9), "cheerful");
  assert.equal(moodBandOf("calm", 0), "calm");
  assert.equal(timeBandOf(2), "night");
  assert.equal(timeBandOf(5.5), "dawn");
  assert.equal(timeBandOf(10), "morning");
  assert.equal(timeBandOf(12), "midday");
  assert.equal(timeBandOf(16), "afternoon");
  assert.equal(timeBandOf(19), "evening");
  assert.equal(timeBandOf(23), "night");
  assert.equal(roleGroupOf("guard"), "guard");
  assert.equal(roleGroupOf("blacksmith"), "artisan");
  assert.equal(roleGroupOf("merchant"), "trader");
  assert.equal(roleGroupOf("farmer"), "farmer");
  assert.equal(bandOf(0.1), "low");
  assert.equal(bandOf(0.5), "mid");
  assert.equal(bandOf(0.9), "high");
  assert.equal(temperBandOf(0.1), "even");
  assert.equal(temperBandOf(0.9), "hot");
});

/* ---------------------------------------------------------------- */
/* Chains                                                            */
/* ---------------------------------------------------------------- */

test("a chain continues from the answer just heard: feeling -> why", () => {
  const conversation = new Conversation();
  const first = conversation.ask("how do you feel", facts());
  assert.equal(first.state, "answered");
  assert.match(first.text, /Miserable/i);
  // The chips must offer a reason move, but phrased like a person talking.
  assert.ok(
    first.followUps?.some((prompt) => /why|how come|makes you say/i.test(prompt.message)),
    "no reason follow-up offered",
  );
  assert.ok(first.followUps!.length >= 3, "too few follow-up options offered");

  const second = conversation.ask("why", facts());
  assert.equal(second.state, "answered");
  assert.notEqual(second.text, first.text);
  assert.match(second.text, /Because/i);
  assert.equal(conversation.lastTopic, "feeling");
});

test("follow-up chips are varied and never re-offer a question already asked", () => {
  const conversation = new Conversation();
  const askedLabels = new Set<string>();
  const offered = new Set<string>();
  let reply = conversation.ask("how do you feel", facts());
  for (let turn = 0; turn < 4; turn++) {
    const chips = reply.followUps ?? [];
    assert.ok(chips.length >= 2, `turn ${turn} offered only ${chips.length} chips`);
    // No duplicates within one turn.
    const labels = chips.map((chip) => chip.label.toLowerCase());
    assert.equal(new Set(labels).size, labels.length, `turn ${turn} repeated a chip`);
    // Never offer a question the player has already asked.
    for (const label of labels) {
      assert.ok(!askedLabels.has(label), `turn ${turn} re-offered already-asked "${label}"`);
      offered.add(label);
    }
    const chosen = chips[0];
    askedLabels.add(chosen.label.toLowerCase());
    reply = conversation.ask(chosen.message, facts());
  }
  // Across the chain the vocabulary must be genuinely varied.
  assert.ok(offered.size >= 8, `expected a varied vocabulary, saw ${offered.size} labels`);
  assert.ok(offered.has("why so") || [...offered].some((label) => label.includes("why")), "no reason move offered");
});

test("'why?' without any prior answer is honest, not invented", () => {
  const reply = respond("why", facts());
  assert.equal(reply.state, "unknown");
  assert.match(reply.text, /have not told you anything yet/i);
});

test("the chain changes when the game state changes", () => {
  const happy = new Conversation();
  const sad = new Conversation();
  happy.ask("how do you feel", facts({ mood: "cheerful", moodValue: 0.8 }));
  sad.ask("how do you feel", facts({ mood: "miserable", moodValue: -0.8 }));
  const happyWhy = happy.ask("why", facts({ mood: "cheerful", moodValue: 0.8 }));
  const sadWhy = sad.ask("why", facts({ mood: "miserable", moodValue: -0.8 }));
  assert.notEqual(happyWhy.text, sadWhy.text);
});

test("'tell me more' gives a state-dependent detail answer about the same subject", () => {
  const conversation = new Conversation();
  conversation.ask("how do you feel", facts());
  const more = conversation.ask("tell me more", facts());
  assert.equal(more.state, "answered");
  // "Tell me more" elaborates on the answer just heard rather than jumping topic.
  assert.equal(more.topic, "feeling");
  assert.ok(more.text.length > 0);
  assert.ok(more.followUps?.length, "the chain must keep offering next questions");
});

test("a multi-step chain stays coherent and deterministic", () => {
  const run = () => {
    const conversation = new Conversation();
    return ["how do you feel", "why", "tell me more", "why", "do you have money", "why"].map((message) => {
      const reply = conversation.ask(message, facts());
      return `${reply.state}|${reply.topic ?? reply.intent}|${reply.text}`;
    });
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b, "the same chain must replay identically");
  assert.equal(a.length, 6);
  for (const line of a) assert.doesNotMatch(line, /\bundefined\b/);
});

test("follow-up chips are usable questions that resolve", () => {
  const conversation = new Conversation();
  const reply = conversation.ask("how do you feel", facts());
  assert.ok(reply.followUps?.length);
  for (const prompt of reply.followUps!) {
    const next = interpret(prompt.message);
    assert.notEqual(next.kind, "unknown", `chip "${prompt.message}" did not resolve`);
  }
});

test("every topic's first question can follow another answer", () => {
  for (const topic of TOPICS) {
    const conversation = new Conversation();
    conversation.ask("how do you feel", facts());
    const reply = conversation.ask(topic.asks[0], facts());
    assert.equal(reply.state, "answered", `"${topic.asks[0]}" failed after a prior answer`);
    assert.ok(reply.text.length > 0);
  }
});

test("canonicalQuestion is stable and reads as a question", () => {
  for (const topic of TOPICS) {
    const question = canonicalQuestion(topic);
    assert.match(question, /\?$/, `"${question}" must end with a question mark`);
    assert.equal(question, canonicalQuestion(topic));
  }
});

/* ---------------------------------------------------------------- */
/* No fabrication                                                    */
/* ---------------------------------------------------------------- */

test("no answer invents a currency amount, title or possession", () => {
  const forbidden = /\b(\d+)\s*(gold|coins?|silver|diamonds?)\b|\bI own \d|\bI am the (king|duke|lord|emperor)\b/i;
  for (const topic of TOPICS) {
    for (const mood of ["miserable", "grumpy", "calm", "content", "cheerful"] as const) {
      const answer = answerTopic(topic.id, context({ mood }));
      assert.ok(answer);
      assert.doesNotMatch(answer.text, forbidden, `${topic.id}/${mood} fabricated a fact`);
      if (answer.cause) assert.doesNotMatch(answer.cause, forbidden, `${topic.id}/${mood} cause fabricated a fact`);
    }
  }
});

test("no dialogue path can report a mutation", () => {
  const conversation = new Conversation();
  for (const message of ["how do you feel", "why", "tell me more", "do you have money", "go to Greyfield"]) {
    const reply = conversation.ask(message, facts());
    assert.equal(reply.state === "refused" || reply.state === "answered" || reply.state === "unknown" || reply.state === "ambiguous" || reply.state === "pending", true);
  }
});
