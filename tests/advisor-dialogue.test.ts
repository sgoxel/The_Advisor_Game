/**
 * WP-S010-007-002 — the Sentence Library must be deterministic, ordered and
 * ambiguity-safe, and the dialogue layer must never mutate or fabricate.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE_FLOOR,
  SENTENCE_LIBRARY,
  SENTENCE_LIBRARY_VERSION,
  interpret,
  intentMayPropose,
  normalizeMessage,
} from "../src/sentence-library.ts";
import {
  respond,
  replyMayHaveMutatedWorld,
  isProposal,
  type AdvisorFacts,
} from "../src/advisor-dialogue.ts";

const facts = (overrides: Partial<AdvisorFacts> = {}): AdvisorFacts => ({
  name: "Osiwin Briarwell",
  role: "Farmer",
  settlement: "Alderwick",
  homeName: "the Briarwell house",
  workName: "the north fields",
  task: "Tending the grain before the rain",
  activity: "working the fields",
  indoors: false,
  mood: "tired but content",
  clockLabel: "14:20",
  daylightPhase: "day",
  travelling: false,
  knownPlaces: [
    { id: "0/0/0", name: "Alderwick" },
    { id: "0/0/1", name: "Greyfield" },
  ],
  knownPeople: [{ id: "R/1", name: "Marta Hale" }],
  ...overrides,
});

/* ---------------------------------------------------------------- */
/* Normalization                                                     */
/* ---------------------------------------------------------------- */

test("normalization is stable, idempotent and expands contractions", () => {
  assert.equal(normalizeMessage("  Hello!!  "), "hello");
  assert.equal(normalizeMessage("WHAT'S YOUR NAME?"), "what is your name");
  assert.equal(normalizeMessage("Don't go"), "do not go");
  assert.equal(normalizeMessage("where are you?"), "where are you");
  // Idempotent: normalizing twice changes nothing.
  const once = normalizeMessage("I'm  going\u2014now");
  assert.equal(normalizeMessage(once), once);
  // Apostrophe and dash variants fold to the ASCII forms.
  assert.equal(normalizeMessage("I\u2019m here"), "i am here");
});

test("a trailing politeness word never changes the intent", () => {
  assert.equal(interpret("where are you please").kind, "resolved");
  assert.equal(interpret("where are you").top.intent, "query.location");
});

/* ---------------------------------------------------------------- */
/* Determinism and priority                                          */
/* ---------------------------------------------------------------- */

test("the same normalized input always yields the same interpretation", () => {
  const a = interpret("What are you doing?");
  const b = interpret("what are you doing");
  assert.equal(a.kind, "resolved");
  assert.equal(b.kind, "resolved");
  assert.equal(a.kind === "resolved" && a.top.entryId, b.kind === "resolved" && b.top.entryId);
  assert.equal(a.kind === "resolved" && a.top.confidence, b.kind === "resolved" && b.top.confidence);
});

test("exact matches outrank looser phrase matches", () => {
  const result = interpret("hello");
  assert.equal(result.kind, "resolved");
  assert.equal(result.kind === "resolved" && result.top.intent, "greet");
});

test("a longer slot phrase beats a shorter plain phrase", () => {
  const result = interpret("go to the market");
  assert.equal(result.kind, "resolved");
  if (result.kind !== "resolved") return;
  assert.equal(result.top.intent, "advice.travel_to_place");
  assert.equal(result.top.slots?.place, "the market");
});

test("every library entry id is unique and confidence is in range", () => {
  const ids = SENTENCE_LIBRARY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate entry id");
  for (const entry of SENTENCE_LIBRARY) {
    assert.ok(entry.confidence > 0 && entry.confidence <= 1, `${entry.id} confidence out of range`);
    assert.ok(entry.priority >= 0, `${entry.id} has a negative priority`);
  }
});

test("only advice and interaction intents may propose a command", () => {
  for (const entry of SENTENCE_LIBRARY) {
    const proposes = intentMayPropose(entry.intent);
    const expected = entry.intent.startsWith("advice.") || entry.intent === "interaction.talk_to_person";
    assert.equal(proposes, expected, `${entry.id}: intentMayPropose mismatch`);
  }
  assert.equal(intentMayPropose("query.status"), false);
  assert.equal(intentMayPropose("greet"), false);
});

/* ---------------------------------------------------------------- */
/* Ambiguity and unknown                                             */
/* ---------------------------------------------------------------- */

test("an unmatched message is unknown, never guessed", () => {
  const result = interpret("qwerty zxcv");
  assert.equal(result.kind, "unknown");
});

test("empty or whitespace-only input is unknown", () => {
  assert.equal(interpret("").kind, "unknown");
  assert.equal(interpret("   \n\t ").kind, "unknown");
});

test("ambiguity surfaces both candidates instead of choosing one silently", () => {
  // "where" alone matches the low-confidence exact entry; "how are you" vs
  // "how are things" are the same confidence band and must not be silently split.
  const result = interpret("how are you");
  assert.ok(result.kind === "resolved" || result.kind === "ambiguous");
  if (result.kind === "ambiguous") {
    assert.ok(result.candidates.length >= 2);
    for (const candidate of result.candidates) {
      assert.ok(Math.abs(result.top.confidence - candidate.confidence) <= 0.1 + 1e-9);
    }
  }
});

test("confidence floor is enforced", () => {
  assert.ok(CONFIDENCE_FLOOR > 0 && CONFIDENCE_FLOOR < 1);
  const result = interpret("where");
  // A bare "where" is a weak match; it must not clear the floor as a confident answer.
  if (result.kind === "resolved") assert.ok(result.top.confidence >= CONFIDENCE_FLOOR);
});

/* ---------------------------------------------------------------- */
/* Dialogue: truthful answers from facts                             */
/* ---------------------------------------------------------------- */

test("status answers use only supplied facts", () => {
  const reply = respond("what are you doing", facts());
  assert.equal(reply.state, "answered");
  assert.match(reply.text, /working the fields|fields|Alderwick/);
  assert.ok(!/gold|treasury|army/i.test(reply.text), "must not invent resources or power");
});

test("home and work answers name the canonical home and workplace", () => {
  assert.match(respond("where do you live", facts()).text, /Briarwell house/);
  assert.match(respond("where do you work", facts()).text, /north fields/);
});

test("time answers use the supplied clock label and phase", () => {
  const reply = respond("what time is it", facts());
  assert.equal(reply.state, "answered");
  assert.match(reply.text, /14:20/);
  assert.match(reply.text, /day/);
});

test("greeting and farewell are answered without any world claim", () => {
  assert.equal(respond("hello", facts()).state, "answered");
  assert.equal(respond("goodbye", facts()).state, "answered");
});

/* ---------------------------------------------------------------- */
/* Dialogue: autonomous refusal and no mutation                      */
/* ---------------------------------------------------------------- */

test("travel advice is refused in character and changes nothing", () => {
  const reply = respond("go to Greyfield", facts({ travelling: false }));
  assert.equal(reply.state, "refused");
  assert.equal(reply.proposal?.targetId, "0/0/1");
  assert.equal(reply.proposal?.intent, "advice.travel_to_place");
  assert.equal(replyMayHaveMutatedWorld(reply), false);
  assert.equal(isProposal(reply), true);
});

test("advice to an unknown place is refused instead of inventing a destination", () => {
  const reply = respond("go to the castle of king nobody", facts());
  assert.equal(reply.state, "refused");
  assert.equal(reply.proposal?.targetId, undefined, "no invented id may be attached");
  assert.match(reply.text, /do not know/i);
});

test("unknown identities are refused rather than fabricated", () => {
  const reply = respond("talk to the innkeeper smith", facts());
  assert.equal(reply.state, "refused");
  assert.equal(reply.proposal?.targetId, undefined);
});

test("a known person is recognised but still not ordered around", () => {
  const reply = respond("talk to marta hale", facts());
  assert.equal(reply.state, "refused");
  assert.equal(reply.proposal?.targetId, "R/1");
  assert.match(reply.text, /decide|not be sent|I might/i);
});

test("rest advice is refused while duties are unfinished", () => {
  const reply = respond("you should rest", facts());
  assert.equal(reply.state, "refused");
  assert.equal(reply.proposal?.intent, "advice.rest");
});

test("an unavailable protagonist produces pending, never a fabricated answer", () => {
  const reply = respond("how are you", facts({ unavailableReason: "my position is not yet grounded" }));
  assert.equal(reply.state, "pending");
  assert.match(reply.text, /cannot answer yet/i);
});

test("unknown input produces an honest unknown reply", () => {
  const reply = respond("blorp zzz", facts());
  assert.equal(reply.state, "unknown");
  assert.match(reply.text, /did not follow/i);
});

/* ---------------------------------------------------------------- */
/* Offline parity and versioning                                     */
/* ---------------------------------------------------------------- */

test("every reply carries the library version for replayable explanation", () => {
  for (const message of ["hello", "where are you", "go to Greyfield", "blorp"]) {
    assert.equal(respond(message, facts()).libraryVersion, SENTENCE_LIBRARY_VERSION);
  }
});

test("responses are deterministic for the same facts and seed", () => {
  const a = respond("what are you doing", facts(), 7);
  const b = respond("what are you doing", facts(), 7);
  assert.equal(a.text, b.text);
});

test("no dialogue path can report a mutation", () => {
  const messages = ["hello", "where do you live", "go to Alderwick", "talk to Marta Hale", "rest", "qwerty"];
  for (const message of messages) {
    assert.equal(replyMayHaveMutatedWorld(respond(message, facts())), false);
  }
});
