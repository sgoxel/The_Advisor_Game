/**
 * Advisor dialogue pipeline (WP-S010-007-002, extended for dialogue trees).
 *
 * Pure by design: it takes an interpretation plus a read-only snapshot of the
 * protagonist and returns a reply with an explicit state. It never mutates the
 * Simulation, never invents a fact and never claims an action happened.
 *
 * Chains: `Conversation` remembers the answer it just gave, so a bare "why?"
 * is answered from that answer's own cause, and "tell me more" continues along
 * the topic's declared follow-ups. A stateless `respond()` still works and
 * honestly reports that nothing has been asked yet.
 */
import {
  interpret,
  intentMayPropose,
  normalizeMessage,
  SENTENCE_LIBRARY_VERSION,
  type Candidate,
  type IntentId,
  type Interpretation,
} from "./sentence-library.ts";
import {
  answerTopic,
  bandOf,
  canonicalQuestion,
  fillPlaceholders,
  matchesWhen,
  moodBandOf,
  roleGroupOf,
  temperBandOf,
  timeBandOf,
  TOPICS,
  type DialogueContextFacts,
  type TopicAnswer,
  type TopicId,
} from "./dialogue-topics.ts";
import { FOLLOWUP_BY_ID, type FollowUpId } from "./dialogue-followups.ts";
import { effectiveMoodValue, type CharacterState } from "./character-state.ts";

export type DialogueState = "answered" | "proposed" | "refused" | "ambiguous" | "unknown" | "pending";

/** Read-only facts the dialogue layer is allowed to speak from. */
export type AdvisorFacts = {
  readonly name: string;
  readonly role: string;
  readonly settlement: string;
  readonly homeName: string;
  readonly workName: string;
  readonly task: string;
  readonly activity: string;
  readonly indoors: boolean;
  readonly mood: string;
  /** Mood value in -1..1 from the canonical Mood record; used to band the answer. */
  readonly moodValue?: number;
  /** Already-formatted local clock label, e.g. "14:20". */
  readonly clockLabel: string;
  readonly daylightPhase: string;
  /** True when the protagonist is currently walking between places. */
  readonly travelling: boolean;
  /** Known place names the protagonist could be advised to travel to. */
  readonly knownPlaces: readonly { readonly id: string; readonly name: string }[];
  /** Known people the protagonist could be advised to talk to. */
  readonly knownPeople: readonly { readonly id: string; readonly name: string }[];
  /** Set when the protagonist has no grounded position; all claims are withheld. */
  readonly unavailableReason?: string;

  /* Optional enrichment. Absent values fall back to neutral bands. */
  readonly hour?: number;
  readonly region?: string;
  readonly placeKind?: "village" | "city" | "wilds";
  readonly ageGroup?: string;
  readonly activityKey?: string;
  readonly guardShift?: 0 | 1;
  readonly day?: number;
  /** Canonical code of the character being advised, so the caller can save state. */
  readonly characterCode?: string;
  /** Saved campaign relationship for this character (trust, mood offset, memory). */
  readonly character?: CharacterState;
  readonly personality?: {
    readonly diligence: number;
    readonly sociability: number;
    readonly piety: number;
    readonly temper: number;
    readonly curiosity: number;
  };
};

/** A suggested next question, so chains are discoverable and accessible. */
export type FollowUpPrompt = { readonly label: string; readonly message: string };

export type DialogueReply = {
  readonly state: DialogueState;
  readonly text: string;
  /** Matched intent, kept so the UI can explain "why". */
  readonly intent?: IntentId;
  readonly confidence?: number;
  readonly libraryVersion: string;
  /** Topic answered, when the question reached the topic tree. */
  readonly topic?: TopicId;
  /** Contextual next questions for this exact answer. */
  readonly followUps?: readonly FollowUpPrompt[];
  /** Present only for proposals the character refused; never an executed action. */
  readonly proposal?: { readonly intent: IntentId; readonly targetId?: string; readonly targetName?: string };
  /**
   * What this exchange should record. The caller applies it via
   * `applyExchange` and saves; the dialogue layer itself stays pure.
   */
  readonly exchange?: {
    readonly tag: string;
    readonly day: number;
    readonly refused?: boolean;
    readonly intent?: { readonly kind: string; readonly target: string };
  };
  /** Relationship context at the time of the answer, for the panel. */
  readonly trust?: number;
  readonly status?: string;
};

export const ADVISOR_DIALOGUE_VERSION = "dialogue-v2";

const pick = <T,>(items: readonly T[], seed: number): T => items[Math.abs(seed) % items.length];

function firstName(full: string): string {
  return full.split(" ")[0] ?? full;
}

/** Resolves a captured slot against authoritative known ids/names. Never invents one. */
function resolveKnown<T extends { id: string; name: string }>(
  text: string | undefined,
  known: readonly T[],
): T | undefined {
  if (!text) return undefined;
  const wanted = normalizeMessage(text);
  if (!wanted) return undefined;
  return (
    known.find((item) => normalizeMessage(item.name) === wanted) ??
    known.find((item) => normalizeMessage(item.name).includes(wanted)) ??
    known.find((item) => wanted.includes(normalizeMessage(item.name)))
  );
}

/** Parses "HH:MM" so a missing `hour` still bands the day correctly. */
function hourOf(facts: AdvisorFacts): number {
  if (typeof facts.hour === "number" && Number.isFinite(facts.hour)) return facts.hour;
  const match = /^(\d{1,2}):(\d{2})$/.exec(facts.clockLabel.trim());
  if (!match) return 12;
  return Number(match[1]) + Number(match[2]) / 60;
}

const NEUTRAL = 0.5;

/** Converts the loose fact bag into the normalized bands the topic tree uses. */
export function contextFromFacts(facts: AdvisorFacts): DialogueContextFacts {
  const personality = facts.personality;
  // Campaign mood offset from conversation shades the SEED baseline; the base
  // itself stays a pure function of seed + fantasy time.
  const baseMood = facts.moodValue ?? 0;
  const moodValue = effectiveMoodValue(baseMood, facts.character?.moodDelta ?? 0);
  return {
    mood: moodBandOf(facts.mood, moodValue),
    moodValue,
    time: timeBandOf(hourOf(facts)),
    role: roleGroupOf(facts.role),
    place: facts.placeKind ?? "village",
    indoors: facts.indoors,
    travelling: facts.travelling,
    sociability: bandOf(personality?.sociability ?? NEUTRAL),
    temper: temperBandOf(personality?.temper ?? NEUTRAL),
    diligence: bandOf(personality?.diligence ?? NEUTRAL),
    piety: bandOf(personality?.piety ?? NEUTRAL),
    curiosity: bandOf(personality?.curiosity ?? NEUTRAL),
    region: facts.region ?? "these lands",
    settlement: facts.settlement,
    homeName: facts.homeName,
    workName: facts.workName,
    activity: facts.activity,
    activityKey: facts.activityKey ?? facts.activity,
    ageGroup: facts.ageGroup ?? "adult",
    guardShift: facts.guardShift,
  };
}

/**
 * Builds the "next questions" chips for one answer.
 *
 * The chips must not read like a form. Rather than always offering a bare
 * "Why?", this picks a varied set of conversational moves that suit the current
 * mood and the topic just answered, uses natural phrasings, and never offers the
 * same phrase twice in a row. `asked` lets a chain avoid repeating itself.
 */
export function followUpPrompts(
  answer: TopicAnswer,
  context?: DialogueContextFacts,
  asked: ReadonlySet<string> = new Set(),
  limit = 4,
): readonly FollowUpPrompt[] {
  const prompts: FollowUpPrompt[] = [];
  const seen = new Set<string>([...asked].map((entry) => entry.toLowerCase()));

  // Which moves make sense for this answer, in a stable priority order.
  const moves: FollowUpId[] = [];
  if (answer.cause) moves.push("reason");
  moves.push("detail");
  const badMood = context ? context.mood === "miserable" || context.mood === "grumpy" : false;
  if (badMood) moves.push("help", "feelings");
  else moves.push("feelings", "help");
  moves.push("need", "others", "duration", "past", "blame", "consequence");

  for (const move of moves) {
    if (prompts.length >= limit) break;
    const def = FOLLOWUP_BY_ID.get(move);
    if (!def) continue;
    // Skip a move the player has already used, so a chain keeps moving forward
    // instead of asking "what do you need" three turns running.
    // A move is exhausted once any of its phrasings has been seen, so offered
    // chips never circle back to a question the player already answered.
    if (def.asks.some((ask) => seen.has(ask.toLowerCase()))) continue;
    // Rotate which phrasing is shown as the conversation advances, so the same
    // move does not read identically every turn. Skipped phrasings stay
    // available; only questions actually asked are excluded.
    const rotation = asked.size;
    const ordered = def.asks.map((_, index) => def.asks[(rotation + index) % def.asks.length]);
    const phrasing = ordered.find((ask) => !seen.has(ask.toLowerCase()));
    if (!phrasing) continue;
    seen.add(phrasing.toLowerCase());
    prompts.push({ label: phrasing.charAt(0).toUpperCase() + phrasing.slice(1), message: phrasing });
  }

  // No topic-fill fallback: the ten moves carry ~80 distinct phrasings, so a
  // chain never has to re-offer a question it already asked.
  return prompts;
}

function topicReply(
  answer: TopicAnswer,
  facts: AdvisorFacts,
  confidence: number,
  intent: IntentId,
  context: DialogueContextFacts,
  asked: ReadonlySet<string>,
): DialogueReply {
  return {
    state: "answered",
    text: answer.text,
    intent,
    confidence,
    libraryVersion: SENTENCE_LIBRARY_VERSION,
    topic: answer.topic,
    followUps: followUpPrompts(answer, context, asked),
  };
}

function statusAnswer(facts: AdvisorFacts, seed: number): string {
  const where = facts.indoors ? `inside ${facts.workName || facts.homeName}` : `in ${facts.settlement}`;
  const doing = facts.travelling ? "walking" : facts.activity;
  return pick(
    [
      `I am ${doing}, ${where}. ${facts.task}.`,
      `${where.charAt(0).toUpperCase()}${where.slice(1)} — ${doing}. ${facts.task}.`,
      `Working through the day: ${doing}, ${where}.`,
    ],
    seed,
  );
}

function locationAnswer(facts: AdvisorFacts): string {
  if (facts.travelling) return `On the road through ${facts.settlement} just now.`;
  return facts.indoors
    ? `Inside ${facts.workName || facts.homeName}, in ${facts.settlement}.`
    : `In ${facts.settlement}, near ${facts.workName || "the market"}.`;
}

function scheduleAnswer(facts: AdvisorFacts): string {
  return `After this I go back to ${facts.homeName}. The day ends at ${facts.clockLabel}.`;
}

function timeAnswer(facts: AdvisorFacts): string {
  return `By my reckoning it is ${facts.clockLabel} — ${facts.daylightPhase}.`;
}

function placeAnswer(facts: AdvisorFacts, placeName: string): DialogueReply {
  const place = resolveKnown(placeName, facts.knownPlaces);
  if (!place) {
    return {
      state: "refused",
      text: `I could not name a place like "${placeName.trim()}" that I know of.`,
      intent: "query.world.place",
      libraryVersion: SENTENCE_LIBRARY_VERSION,
    };
  }
  return {
    state: "answered",
    text: `${place.name} — I know it. Whether I set out is my choice, not an order.`,
    intent: "query.world.place",
    libraryVersion: SENTENCE_LIBRARY_VERSION,
  };
}

/** Refuses an advice/interaction proposal in character; the world does not change. */
function refuseProposal(
  intent: IntentId,
  targetName: string | undefined,
  facts: AdvisorFacts,
  reason: string,
  targetId?: string,
): DialogueReply {
  return {
    state: "refused",
    text: reason,
    intent,
    libraryVersion: SENTENCE_LIBRARY_VERSION,
    proposal: { intent, targetId, targetName },
  };
}

function handleAdvice(candidate: Candidate, facts: AdvisorFacts): DialogueReply {
  if (candidate.intent === "advice.travel_to_place") {
    const wanted = candidate.slots?.place;
    const place = resolveKnown(wanted, facts.knownPlaces);
    if (!place) {
      return refuseProposal(
        candidate.intent,
        wanted,
        facts,
        `I do not know a place called "${(wanted ?? "").trim()}". Guide me to somewhere real and I will weigh it.`,
      );
    }
    if (facts.travelling) {
      return refuseProposal(candidate.intent, place.name, facts, `I am already on the road — ask me again when I arrive.`, place.id);
    }
    return refuseProposal(
      candidate.intent,
      place.name,
      facts,
      pick(
        [
          `${place.name}, is it? Not before my work is done — ask me this evening.`,
          `I hear you. I will think on ${place.name} when the day's duties are finished.`,
          `To ${place.name}? A long walk. I will consider it, but I am not leaving my post this hour.`,
        ],
        place.name.length + facts.task.length,
      ),
      place.id,
    );
  }
  if (candidate.intent === "advice.rest") {
    return refuseProposal(
      candidate.intent,
      undefined,
      facts,
      `Rest would be welcome, but not while ${facts.task.toLowerCase()}. Ask me after dark.`,
    );
  }
  return refuseProposal(
    candidate.intent,
    undefined,
    facts,
    `I have heard you. I will decide whether it is worth doing — advice is not a command.`,
  );
}

function handleInteraction(candidate: Candidate, facts: AdvisorFacts): DialogueReply {
  const wanted = candidate.slots?.person;
  const person = resolveKnown(wanted, facts.knownPeople);
  if (!person) {
    return refuseProposal(
      candidate.intent,
      wanted,
      facts,
      `I do not know anyone called "${(wanted ?? "").trim()}".`,
    );
  }
  return refuseProposal(
    candidate.intent,
    person.name,
    facts,
    `I might speak with ${firstName(person.name)} later — but I decide when, and I will not be sent.`,
    person.id,
  );
}

const ANSWER_ONLY = "I have not told you anything yet — ask me something first, and then I can explain.";

/** Resolves a follow-up intent against the answer the player just heard. */
function handleFollowUp(intent: IntentId, last: TopicAnswer | undefined, facts: AdvisorFacts, context: DialogueContextFacts, asked: ReadonlySet<string>): DialogueReply {
  if (!last) {
    return { state: "unknown", text: ANSWER_ONLY, intent, libraryVersion: SENTENCE_LIBRARY_VERSION };
  }
  const id = intent.replace("followup.", "") as FollowUpId;
  // "why?" prefers the precision of the cause that produced this exact answer.
  if (id === "reason" && last.cause) {
    return {
      state: "answered",
      text: last.cause,
      intent,
      libraryVersion: SENTENCE_LIBRARY_VERSION,
      topic: last.topic,
      followUps: followUpPrompts(last, context, asked),
    };
  }
  const def = FOLLOWUP_BY_ID.get(id);
  if (!def) {
    return { state: "unknown", text: "I am not sure what to add to that.", intent, libraryVersion: SENTENCE_LIBRARY_VERSION };
  }
  const variant = def.variants.find((candidate) => matchesWhen(candidate.when, context)) ?? def.variants[def.variants.length - 1];
  const answer: TopicAnswer = {
    topic: last.topic,
    text: fillPlaceholders(variant.text, context, facts.name),
    cause: variant.cause ? fillPlaceholders(variant.cause, context, facts.name) : undefined,
    tags: variant.tags ?? [],
    followUps: last.followUps,
  };
  return {
    state: "answered",
    text: answer.text,
    intent,
    libraryVersion: SENTENCE_LIBRARY_VERSION,
    topic: answer.topic,
    followUps: followUpPrompts(answer, context, asked),
  };
}

type ConversationContext = { last: TopicAnswer | undefined; asked: Set<string>; opened: boolean };

/**
 * Adds the relationship layer to an otherwise complete reply: what to record,
 * plus the small ways a long acquaintance or a cold one changes the wording.
 * It never invents a fact, and never alters trust itself — the caller applies
 * and saves the recorded exchange.
 */
function replyFor(message: string, facts: AdvisorFacts, seed: number, state: ConversationContext): DialogueReply {
  const reply = computeReply(message, facts, seed, state);
  const character = facts.character;
  const trust = character?.trust ?? 50;
  const day = facts.day ?? character?.updatedDay ?? 0;

  // What this exchange should record, when it is a real answer.
  // A follow-up move is credited as its own exchange, not as the topic it
  // elaborated on. Otherwise "why?", "what do you need" and "who else knows"
  // would all be recorded as the same subject and never build anything.
  const moveId = reply.intent && String(reply.intent).startsWith("followup.")
    ? String(reply.intent).replace("followup.", "")
    : undefined;
  const tag = moveId ?? reply.topic ?? (reply.intent ? String(reply.intent) : undefined);
  // Store the readable name for a saved intent; never a raw SEED id in prose.
  const intent = reply.proposal
    ? { kind: String(reply.proposal.intent), target: reply.proposal.targetName ?? reply.proposal.targetId ?? "" }
    : undefined;
  const exchange = tag && (reply.state === "answered" || reply.state === "refused")
    ? { tag, day, refused: reply.state === "refused", intent }
    : undefined;

  if (!exchange) return { ...reply, trust };

  // A character remembers that you asked this before, and says so occasionally.
  const recalled = character?.memories.some((memory) => memory.tag === exchange.tag && memory.day < day);
  // Relationship shapes the opening only once per conversation, so it reads as
  // the mood of the moment rather than a catchphrase.
  const opener = reply.state !== "answered" || state.opened
    ? ""
    : trust >= 70 ? "You have been a good friend to me, so I will speak plainly. "
      : trust <= 25 ? "I will answer, though I owe you no more than that. "
        : "";
  const recall = recalled && reply.state === "answered" && !opener ? "You have asked me this before, and my answer has not changed. " : "";

  state.opened = true;
  // A recorded intent is a promise the player made: the character refers to it
  // when talking about plans, so advice leaves a visible, saved trace.
  const savedIntent = character?.intents.at(-1);
  const intentNote = reply.state === "answered" && reply.topic === "plans" && savedIntent && savedIntent.target
    ? ` And I still have ${savedIntent.target} in mind, since you raised it.`
    : "";
  return {
    ...reply,
    text: `${opener}${recall}${reply.text}${intentNote}`,
    exchange,
    trust,
  };
}

function computeReply(message: string, facts: AdvisorFacts, seed: number, state: ConversationContext): DialogueReply {
  // Only questions the player actually asked are "used". Merely seeing a chip
  // does not consume it, so the remaining options stay available next turn.
  const asked: ReadonlySet<string> = state.asked;
  const consumeOffered = (reply: DialogueReply): DialogueReply => reply;
  if (facts.unavailableReason) {
    return {
      state: "pending",
      text: `I cannot answer yet — ${facts.unavailableReason}.`,
      libraryVersion: SENTENCE_LIBRARY_VERSION,
    };
  }
  const interpretation: Interpretation = interpret(message);

  if (interpretation.kind === "unknown") {
    return {
      state: "unknown",
      text: `I did not follow that. Ask me how I am, about my work, or where a place is.`,
      libraryVersion: SENTENCE_LIBRARY_VERSION,
    };
  }
  if (interpretation.kind === "ambiguous") {
    const options = interpretation.candidates.map((candidate) => `"${candidate.match}"`).join(" or ");
    return {
      state: "ambiguous",
      text: `I am not certain what you mean — did you mean ${options}?`,
      intent: interpretation.top.intent,
      confidence: interpretation.top.confidence,
      libraryVersion: SENTENCE_LIBRARY_VERSION,
    };
  }

  const candidate = interpretation.top;
  // Record the question before any chips are computed, so a move the player just
  // used is never offered straight back to them.
  state.asked.add(normalizeMessage(message));
  const context = contextFromFacts(facts);
  const base = { intent: candidate.intent, confidence: candidate.confidence, libraryVersion: SENTENCE_LIBRARY_VERSION } as const;
  const seedShift = seed + candidate.entryId.length;

  // Bare follow-ups first: they only mean something in context.
  if (candidate.intent.startsWith("followup.")) {
    const reply = consumeOffered(handleFollowUp(candidate.intent, state.last, facts, context, asked));
    if (reply.topic) state.last = answerTopic(reply.topic, context, facts.name) ?? state.last;
    return reply;
  }

  // Topic questions come from the expanded 191-question tree.
  const topicId = TOPICS.find((topic) => topic.asks.includes(normalizeMessage(message)))?.id;
  if (candidate.intent === "query.topic" || (!candidate.intent.startsWith("followup.") && topicId)) {
    const answer = answerTopic(topicId ?? "feeling", context, facts.name);
    if (answer) {
      state.last = answer;
      return consumeOffered(topicReply(answer, facts, candidate.confidence, "query.topic", context, asked));
    }
  }

  switch (candidate.intent) {
    case "greet":
      return { state: "answered", text: pick([`Well met, Advisor.`, `Advisor. Good to see you.`, `Ah — you. What is it?`], seedShift), ...base };
    case "thanks":
      return { state: "answered", text: pick([`You are welcome.`, `Hm. Thank me when it works.`], seedShift), ...base };
    case "farewell":
      return { state: "answered", text: `Safe roads, Advisor.`, ...base };
    case "meta.smalltalk":
      return { state: "answered", text: pick([`Tolerable. The work keeps me busy.`, `Well enough, thank you.`], seedShift), ...base };
    case "query.status":
      return { state: "answered", text: statusAnswer(facts, seedShift), ...base };
    case "query.location":
      return { state: "answered", text: locationAnswer(facts), ...base };
    case "query.schedule":
      return { state: "answered", text: scheduleAnswer(facts), ...base };
    case "query.mood": {
      const answer = answerTopic("feeling", context, facts.name);
      if (answer) { state.last = answer; return consumeOffered(topicReply(answer, facts, candidate.confidence, candidate.intent, context, asked)); }
      return { state: "answered", text: `I am ${facts.mood}.`, ...base };
    }
    case "query.home": {
      const answer = answerTopic("home", context, facts.name);
      if (answer) { state.last = answer; return consumeOffered(topicReply(answer, facts, candidate.confidence, candidate.intent, context, asked)); }
      return { state: "answered", text: `My house is ${facts.homeName}, here in ${facts.settlement}.`, ...base };
    }
    case "query.work": {
      const answer = answerTopic("work", context, facts.name);
      if (answer) { state.last = answer; return consumeOffered(topicReply(answer, facts, candidate.confidence, candidate.intent, context, asked)); }
      return { state: "answered", text: `I am ${facts.role.toLowerCase()}. My work is at ${facts.workName}.`, ...base };
    }
    case "query.world.time":
      return { state: "answered", text: timeAnswer(facts), ...base };
    case "query.world.place":
      return { ...placeAnswer(facts, candidate.slots?.place ?? ""), intent: candidate.intent, confidence: candidate.confidence };
    case "advice.travel_to_place":
    case "advice.rest":
    case "advice.generic":
      return handleAdvice(candidate, facts);
    case "interaction.talk_to_person":
      return handleInteraction(candidate, facts);
    default:
      return { state: "unknown", text: `I have nothing to say to that.`, ...base };
  }
}

/**
 * Stateless convenience wrapper: no conversation memory, so follow-up questions
 * truthfully report that nothing has been asked. Kept for existing callers.
 */
export function respond(message: string, facts: AdvisorFacts, seed = 0): DialogueReply {
  return replyFor(message, facts, seed, { last: undefined, asked: new Set(), opened: false });
}

/**
 * A conversation with memory. Each `ask` may use the previous answer, which is
 * how "how do you feel" → "miserable" → "why?" → cause chains work.
 */
export class Conversation {
  private state: ConversationContext = { last: undefined, asked: new Set(), opened: false };
  private turns = 0;

  ask(message: string, facts: AdvisorFacts, seed = 0): DialogueReply {
    const reply = replyFor(message, facts, seed + this.turns, this.state);
    this.turns += 1;
    return reply;
  }

  /** The topic of the last answer, for UI/tests. */
  get lastTopic(): TopicId | undefined {
    return this.state.last?.topic;
  }

  reset(): void {
    this.state = { last: undefined, asked: new Set(), opened: false };
    this.turns = 0;
  }
}

/** True when this reply represents a proposal the character weighed. */
export function isProposal(reply: DialogueReply): boolean {
  return reply.state === "proposed" || (reply.state === "refused" && reply.proposal !== undefined);
}

/** Every intent that reached the pipeline is either a query or a bounded proposal. */
export function replyMayHaveMutatedWorld(reply: DialogueReply): false {
  void reply;
  return false;
}

export { intentMayPropose };
export type { IntentId, Interpretation, Candidate };
