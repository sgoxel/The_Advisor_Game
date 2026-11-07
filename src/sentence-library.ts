/**
 * Versioned deterministic Sentence Library (WP-S010-007-002).
 *
 * This is the local interpretation layer defined by
 * `docs/ADVISOR_CONVERSATION_ARCHITECTURE.md` §4. It is pure: no DOM, no clock,
 * no randomness, no world state. It only turns a normalized player message into
 * ranked intent candidates. It can never mutate the Simulation.
 */

/** Bump on any content or rule change; participates in reproducibility checks. */
import { TOPICS, type TopicId } from "./dialogue-topics.ts";
export const SENTENCE_LIBRARY_VERSION = "library-v2";
/** Bump when an intent's meaning or parameter contract changes. */
export const INTENT_VERSION = "intent-v1";

export type IntentId =
  | "greet"
  | "thanks"
  | "farewell"
  | "query.status"
  | "query.location"
  | "query.schedule"
  | "query.mood"
  | "query.home"
  | "query.work"
  | "query.world.place"
  | "query.world.time"
  | "query.topic"
  | "followup.why"
  | "followup.more"
  | "followup.plan"
  | "followup.who"
  | "followup.when"
  | "followup.how"
  | "advice.travel_to_place"
  | "advice.rest"
  | "advice.generic"
  | "interaction.talk_to_person"
  | "meta.smalltalk";

/** Only these intent classes may ever become a command proposal. */
export const COMMAND_INTENTS: ReadonlySet<IntentId> = new Set<IntentId>([
  "advice.travel_to_place",
  "advice.rest",
  "advice.generic",
  "interaction.talk_to_person",
]);

export type SlotKind = "person" | "place" | "topic";

export type SentenceEntry = {
  readonly id: string;
  readonly intent: IntentId;
  readonly kind: "exact" | "normalized" | "phrase";
  /** Normalized literal text or phrase; matched against normalized input. */
  readonly match: string;
  readonly slots?: readonly SlotKind[];
  /** Set for `query.topic` entries: which dialogue topic the question reaches. */
  readonly topic?: TopicId;
  /** Higher wins when matches overlap; ties break by match length, then id. */
  readonly priority: number;
  /** Base confidence 0..1 for a clean match. */
  readonly confidence: number;
  /** Entries that must not silently disagree when both match. */
  readonly ambiguityGroup?: string;
  /** Optional local reply direction; never a world statement. */
  readonly reply?: string;
};

/* ------------------------------------------------------------------ */
/* Topic questions (100+ reviewed phrasings across the topic tree)      */
/* ------------------------------------------------------------------ */

/**
 * Follow-up questions. These are only meaningful with a conversation context;
 * without one they resolve to a truthful "asked nothing yet" reply.
 */
const FOLLOW_UP_ENTRIES: readonly SentenceEntry[] = Object.freeze([
  { id: "followup.why", intent: "followup.why", kind: "exact", match: "why", priority: 30, confidence: 0.98 },
  { id: "followup.why2", intent: "followup.why", kind: "exact", match: "why is that", priority: 30, confidence: 0.97 },
  { id: "followup.why3", intent: "followup.why", kind: "exact", match: "why so", priority: 28, confidence: 0.95 },
  { id: "followup.why4", intent: "followup.why", kind: "phrase", match: "what makes you say that", priority: 29, confidence: 0.95 },
  { id: "followup.why5", intent: "followup.why", kind: "phrase", match: "why do you feel that way", priority: 29, confidence: 0.96 },
  { id: "followup.more", intent: "followup.more", kind: "phrase", match: "tell me more", priority: 28, confidence: 0.97 },
  { id: "followup.more2", intent: "followup.more", kind: "phrase", match: "go on", priority: 27, confidence: 0.95 },
  { id: "followup.more3", intent: "followup.more", kind: "exact", match: "and", priority: 12, confidence: 0.88 },
  { id: "followup.more4", intent: "followup.more", kind: "phrase", match: "explain that", priority: 27, confidence: 0.95 },
  { id: "followup.plan", intent: "followup.plan", kind: "phrase", match: "what will you do about it", priority: 29, confidence: 0.96 },
  { id: "followup.plan2", intent: "followup.plan", kind: "phrase", match: "what happens next", priority: 28, confidence: 0.94 },
  { id: "followup.who", intent: "followup.who", kind: "phrase", match: "who is that", priority: 27, confidence: 0.94 },
  { id: "followup.who2", intent: "followup.who", kind: "phrase", match: "who did that", priority: 27, confidence: 0.94 },
  { id: "followup.when", intent: "followup.when", kind: "phrase", match: "when did that happen", priority: 27, confidence: 0.94 },
  { id: "followup.when2", intent: "followup.when", kind: "exact", match: "since when", priority: 26, confidence: 0.92 },
  { id: "followup.how", intent: "followup.how", kind: "phrase", match: "how do you know", priority: 27, confidence: 0.94 },
  { id: "followup.how2", intent: "followup.how", kind: "phrase", match: "how so", priority: 26, confidence: 0.93 },
]);

/**
 * Expands every topic's reviewed questions into library entries. Keeping this
 * generated-but-explicit means the question count and topic coverage stay in
 * step with `dialogue-topics.ts` instead of drifting apart.
 */
const TOPIC_ENTRIES: readonly SentenceEntry[] = Object.freeze(
  TOPICS.flatMap((topic) =>
    topic.asks.map((ask, index) => ({
      id: `topic.${topic.id}.${index}`,
      intent: "query.topic" as const,
      kind: "normalized" as const,
      match: ask,
      topic: topic.id,
      // Longer, more specific questions win ties against short generic ones.
      priority: 20 + Math.min(9, Math.floor(ask.length / 8)),
      confidence: 0.94,
    })),
  ),
);

/** Question phrasings already owned by a topic; the older entries yield to them. */
const TOPIC_MATCHES: ReadonlySet<string> = new Set(TOPICS.flatMap((topic) => topic.asks));

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Fixed, versioned contractions/abbreviations. No ML, no synonyms. */
const ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are",
  "it's": "it is", "that's": "that is", "what's": "what is", "where's": "where is",
  "who's": "who is", "how's": "how is", "don't": "do not", "doesn't": "does not",
  "can't": "cannot", "won't": "will not", "isn't": "is not", "aren't": "are not",
  "didn't": "did not", "let's": "let us", "i'd": "i would", "i'll": "i will",
  "pls": "please", "plz": "please", "u": "you", "ur": "your", "r": "are",
  "thx": "thanks", "ty": "thank you",
});

const APOSTROPHES = /[\u2018\u2019\u201B\u2032`]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;

/**
 * Deterministic normalization (contract §4.3): NFKC, strip zero-width and
 * control characters, unify apostrophes/dashes, case-fold, expand the fixed
 * abbreviation table, collapse whitespace, drop trailing punctuation.
 */
export function normalizeMessage(input: string): string {
  let text = String(input ?? "");
  if (typeof text.normalize === "function") text = text.normalize("NFKC");
  text = text.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, " ");
  text = text.replace(APOSTROPHES, "'").replace(DASHES, "-");
  text = text.toLowerCase();
  // Expand abbreviations on word boundaries, longest key first so "i'm" beats "i".
  for (const key of Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`(^|[^a-z'])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z'])`, "g"), (_m, lead) => `${lead}${ABBREVIATIONS[key]}`);
  }
  text = text.replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  // A trailing "please"/"now" never changes intent, only tone.
  text = text.replace(/\s+(please|now|thanks)$/u, "").trim();
  return text;
}

/** Token-level bounded typo tolerance (contract §4.3 rule 4). Never applied to `exact`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function allowedDistance(token: string): number {
  if (token.length >= 9) return 2;
  if (token.length >= 5) return 1;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

/**
 * The shipped library. Kept small and hand-written on purpose: every entry is a
 * reviewed, testable meaning. Slot patterns use `{person}` / `{place}` / `{topic}`.
 */
const BASE_ENTRIES: readonly SentenceEntry[] = Object.freeze([
  // --- meta ---
  { id: "greet.hello", intent: "greet", kind: "exact", match: "hello", priority: 10, confidence: 0.99, reply: "greet" },
  { id: "greet.hi", intent: "greet", kind: "exact", match: "hi", priority: 10, confidence: 0.98, reply: "greet" },
  { id: "greet.morning", intent: "greet", kind: "exact", match: "good morning", priority: 12, confidence: 0.98, reply: "greet.morning" },
  { id: "greet.evening", intent: "greet", kind: "exact", match: "good evening", priority: 12, confidence: 0.98, reply: "greet.evening" },
  { id: "greet.wellmet", intent: "greet", kind: "exact", match: "well met", priority: 11, confidence: 0.95, reply: "greet" },
  { id: "thanks", intent: "thanks", kind: "exact", match: "thank you", priority: 10, confidence: 0.98, reply: "thanks" },
  { id: "thanks.short", intent: "thanks", kind: "exact", match: "thanks", priority: 10, confidence: 0.97, reply: "thanks" },
  { id: "farewell.bye", intent: "farewell", kind: "exact", match: "goodbye", priority: 10, confidence: 0.98, reply: "farewell" },
  { id: "farewell.farewell", intent: "farewell", kind: "exact", match: "farewell", priority: 10, confidence: 0.96, reply: "farewell" },
  { id: "smalltalk.day", intent: "meta.smalltalk", kind: "phrase", match: "how are you", priority: 14, confidence: 0.93 },
  { id: "smalltalk.day2", intent: "meta.smalltalk", kind: "phrase", match: "how do you do", priority: 14, confidence: 0.92 },

  // --- status / location ---
  { id: "status.how", intent: "query.status", kind: "exact", match: "how are things", priority: 14, confidence: 0.94 },
  { id: "status.doing", intent: "query.status", kind: "phrase", match: "what are you doing", priority: 16, confidence: 0.97 },
  { id: "status.doing2", intent: "query.status", kind: "phrase", match: "what are you up to", priority: 16, confidence: 0.95 },
  { id: "status.news", intent: "query.status", kind: "phrase", match: "any news", priority: 13, confidence: 0.9 },
  { id: "location.where", intent: "query.location", kind: "phrase", match: "where are you", priority: 16, confidence: 0.97 },
  { id: "location.where2", intent: "query.location", kind: "exact", match: "where", priority: 8, confidence: 0.85 },
  { id: "schedule.today", intent: "query.schedule", kind: "phrase", match: "what is your plan", priority: 16, confidence: 0.95 },
  { id: "schedule.today2", intent: "query.schedule", kind: "phrase", match: "what are your plans", priority: 16, confidence: 0.95 },
  { id: "schedule.today3", intent: "query.schedule", kind: "phrase", match: "what will you do", priority: 15, confidence: 0.93 },
  { id: "mood.feel", intent: "query.mood", kind: "phrase", match: "how do you feel", priority: 16, confidence: 0.96 },
  { id: "home.where", intent: "query.home", kind: "phrase", match: "where do you live", priority: 16, confidence: 0.97 },
  { id: "home.which", intent: "query.home", kind: "phrase", match: "where is your home", priority: 16, confidence: 0.97 },
  { id: "work.what", intent: "query.work", kind: "phrase", match: "what is your work", priority: 15, confidence: 0.94 },
  { id: "work.what2", intent: "query.work", kind: "phrase", match: "what do you do for a living", priority: 17, confidence: 0.95 },
  { id: "work.where", intent: "query.work", kind: "phrase", match: "where do you work", priority: 16, confidence: 0.96 },

  // --- world facts ---
  { id: "world.time", intent: "query.world.time", kind: "phrase", match: "what time is it", priority: 16, confidence: 0.97 },
  { id: "world.time2", intent: "query.world.time", kind: "phrase", match: "what is the time", priority: 16, confidence: 0.96 },
  { id: "world.place", intent: "query.world.place", kind: "phrase", match: "tell me about {place}", priority: 20, confidence: 0.93, slots: ["place"] },
  { id: "world.place2", intent: "query.world.place", kind: "phrase", match: "where is {place}", priority: 20, confidence: 0.94, slots: ["place"] },

  // --- advice (proposals only) ---
  { id: "advice.go", intent: "advice.travel_to_place", kind: "phrase", match: "go to {place}", priority: 22, confidence: 0.95, slots: ["place"] },
  { id: "advice.travel", intent: "advice.travel_to_place", kind: "phrase", match: "travel to {place}", priority: 22, confidence: 0.95, slots: ["place"] },
  { id: "advice.visit", intent: "advice.travel_to_place", kind: "phrase", match: "visit {place}", priority: 21, confidence: 0.94, slots: ["place"] },
  { id: "advice.head", intent: "advice.travel_to_place", kind: "phrase", match: "head to {place}", priority: 21, confidence: 0.94, slots: ["place"] },
  { id: "advice.rest", intent: "advice.rest", kind: "phrase", match: "you should rest", priority: 20, confidence: 0.92 },
  { id: "advice.rest2", intent: "advice.rest", kind: "exact", match: "rest", priority: 12, confidence: 0.9 },
  { id: "advice.generic", intent: "advice.generic", kind: "phrase", match: "you should {topic}", priority: 12, confidence: 0.88, slots: ["topic"] },

  // --- interaction ---
  { id: "talk.person", intent: "interaction.talk_to_person", kind: "phrase", match: "talk to {person}", priority: 20, confidence: 0.94, slots: ["person"] },
  { id: "talk.person2", intent: "interaction.talk_to_person", kind: "phrase", match: "speak with {person}", priority: 20, confidence: 0.94, slots: ["person"] },
  { id: "talk.person3", intent: "interaction.talk_to_person", kind: "phrase", match: "ask {person}", priority: 18, confidence: 0.9, slots: ["person"] },
]);

/**
 * The shipped library: hand-written meta/advice/question entries plus every
 * topic question and follow-up. Base entries whose exact phrasing is now owned
 * by a topic are dropped so a phrase can never resolve two different ways.
 */
export const SENTENCE_LIBRARY: readonly SentenceEntry[] = Object.freeze([
  ...BASE_ENTRIES.filter((entry) => !TOPIC_MATCHES.has(entry.match)),
  ...TOPIC_ENTRIES,
  ...FOLLOW_UP_ENTRIES,
]);

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type Candidate = {
  readonly entryId: string;
  readonly intent: IntentId;
  readonly match: string;
  readonly confidence: number;
  readonly priority: number;
  /** True when the entry contains {slot} holes; a literal match is more specific. */
  readonly template: boolean;
  /** Captured slot text, only when every slot resolved. */
  readonly slots?: Readonly<Partial<Record<SlotKind, string>>>;
};

export type Interpretation =
  | { readonly kind: "resolved"; readonly top: Candidate; readonly candidates: readonly Candidate[] }
  | { readonly kind: "ambiguous"; readonly candidates: readonly Candidate[]; readonly top: Candidate }
  | { readonly kind: "unknown"; readonly candidates: readonly Candidate[] };

/** Minimum confidence for a single-candidate local resolution (contract §4.5). */
export const CONFIDENCE_FLOOR = 0.85;
/** Candidates within this band of the top are treated as ambiguous. */
export const AMBIGUITY_BAND = 0.10;

const SLOT_PATTERN = /\{([a-z]+)\}/g;

function tokenize(text: string): string[] {
  return text.length ? text.split(" ") : [];
}

/** Compares one normalized entry against one normalized message; returns a confidence multiplier or 0. */
function scoreEntry(entry: SentenceEntry, message: string): number {
  const match = entry.match.toLowerCase();
  if (entry.kind === "exact" || entry.kind === "normalized") {
    return message === match ? 1 : 0;
  }
  // `phrase`: literal text, or a literal skeleton with {slot} holes.
  const parts = match.split(SLOT_PATTERN);
  // split with capture groups yields [literal, slotName, literal, ...]
  const literalChunks = parts.filter((_, index) => index % 2 === 0);
  const slotNames = parts.filter((_, index) => index % 2 === 1);

  if (!slotNames.length) {
    if (message === match) return 1;
    if (message.includes(match)) return 0.96;
    // Bounded typo tolerance over whole-phrase tokens.
    const want = tokenize(match);
    const have = tokenize(message);
    if (want.length !== have.length) return 0;
    let total = 0;
    for (let i = 0; i < want.length; i++) {
      const distance = want[i] === have[i] ? 0 : editDistance(want[i], have[i], allowedDistance(want[i]));
      if (distance > allowedDistance(want[i])) return 0;
      total += distance;
    }
    return total === 0 ? 1 : Math.max(0.7, 1 - total * 0.12);
  }

  // Slot-bearing phrase: anchor on the literal words, in order.
  const first = literalChunks[0]?.trim() ?? "";
  const last = literalChunks[literalChunks.length - 1]?.trim() ?? "";
  if (first && !message.startsWith(first + " ")) return 0;
  if (last && !message.endsWith(" " + last)) return 0;
  let cursor = first ? first.length : 0;
  const captured: string[] = [];
  for (let i = 1; i < literalChunks.length; i++) {
    const chunk = literalChunks[i].trim();
    if (!chunk) { captured.push(message.slice(cursor).trim()); cursor = message.length; continue; }
    const at = message.indexOf(" " + chunk, cursor);
    if (at < 0) return 0;
    captured.push(message.slice(cursor, at).trim());
    cursor = at + chunk.length + 1;
  }
  return captured.every((value) => value.length > 0) ? 1 : 0;
}

function captureSlots(entry: SentenceEntry, message: string): Partial<Record<SlotKind, string>> | undefined {
  if (!entry.slots || !entry.slots.length) return {};
  const parts = entry.match.toLowerCase().split(SLOT_PATTERN);
  const literalChunks = parts.filter((_, index) => index % 2 === 0);
  const slotNames = parts.filter((_, index) => index % 2 === 1) as SlotKind[];
  const first = literalChunks[0]?.trim() ?? "";
  let cursor = first ? first.length : 0;
  const result: Partial<Record<SlotKind, string>> = {};
  for (let i = 1; i < literalChunks.length; i++) {
    const chunk = literalChunks[i].trim();
    const slot = slotNames[i - 1];
    if (!chunk) {
      result[slot] = message.slice(cursor).trim();
      cursor = message.length;
      continue;
    }
    const at = message.indexOf(" " + chunk, cursor);
    if (at < 0) return undefined;
    result[slot] = message.slice(cursor, at).trim();
    cursor = at + chunk.length + 1;
  }
  if (!entry.slots.every((slot) => (result[slot] ?? "").length > 0)) return undefined;
  return result;
}

/**
 * Total ordering for overlapping matches (contract §4.4): literal specificity
 * first, then longer match, then higher priority, then lexicographic id. Never
 * order-dependent.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  // A literal phrase is strictly more specific than a {slot} template of similar
  // confidence, so `you should rest` beats `you should {topic}`.
  if (a.template !== b.template) return a.template ? 1 : -1;
  if (b.match.length !== a.match.length) return b.match.length - a.match.length;
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.entryId.localeCompare(b.entryId);
}

/**
 * Deterministic interpretation. Identical (libraryVersion, normalized input)
 * always yields an identical Interpretation.
 */
export function interpret(message: string, library: readonly SentenceEntry[] = SENTENCE_LIBRARY): Interpretation {
  const normalized = normalizeMessage(message);
  if (!normalized) return { kind: "unknown", candidates: [] };

  const candidates: Candidate[] = [];
  for (const entry of library) {
    const factor = scoreEntry(entry, normalized);
    if (factor <= 0) continue;
    const slots = captureSlots(entry, normalized);
    if (!slots) continue;
    candidates.push({
      entryId: entry.id,
      intent: entry.intent,
      match: entry.match,
      confidence: Math.min(0.99, entry.confidence * factor),
      priority: entry.priority,
      template: Boolean(entry.slots && entry.slots.length),
      slots,
    });
  }
  if (!candidates.length) return { kind: "unknown", candidates: [] };

  candidates.sort(compareCandidates);
  const top = candidates[0];
  const contested = candidates.filter(
    (candidate) =>
      candidate !== top &&
      Math.abs(top.confidence - candidate.confidence) <= AMBIGUITY_BAND &&
      // A fully literal match is strictly more specific than a {slot} template;
      // the template is a competitor only when nothing literal matched as well.
      !(top.template === false && candidate.template === true),
  );
  if (contested.length) {
    // Ambiguity is surfaced, never resolved to the more permissive reading.
    return { kind: "ambiguous", top, candidates: [top, ...contested] };
  }
  if (top.confidence < CONFIDENCE_FLOOR) return { kind: "unknown", candidates };
  return { kind: "resolved", top, candidates };
}

/** True when an intent may produce a command proposal at all (contract §5). */
export function intentMayPropose(intent: IntentId): boolean {
  return COMMAND_INTENTS.has(intent);
}
