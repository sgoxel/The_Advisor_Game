/**
 * Advisor dialogue pipeline (WP-S010-007-002).
 *
 * Pure by design: it takes an interpretation plus a read-only snapshot of the
 * protagonist and world facts and returns a reply with an explicit state. It
 * never mutates the Simulation, never invents a fact and never claims an action
 * happened. Anything that would change the world is returned as a *proposal*
 * that the character may refuse.
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
};

export type DialogueReply = {
  readonly state: DialogueState;
  readonly text: string;
  /** Matched intent, kept so the UI can explain "why". */
  readonly intent?: IntentId;
  readonly confidence?: number;
  readonly libraryVersion: string;
  /** Present only for proposals the character refused; never an executed action. */
  readonly proposal?: { readonly intent: IntentId; readonly targetId?: string; readonly targetName?: string };
};

export const ADVISOR_DIALOGUE_VERSION = "dialogue-v1";

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

function moodAnswer(facts: AdvisorFacts): string {
  const mood = facts.mood;
  return pick(
    [
      `I am ${mood}. The work keeps me busy.`,
      `Honestly? ${mood.charAt(0).toUpperCase()}${mood.slice(1)}.`,
    ],
    mood.length,
  );
}

function homeAnswer(facts: AdvisorFacts): string {
  return `My house is ${facts.homeName}, here in ${facts.settlement}.`;
}

function workAnswer(facts: AdvisorFacts): string {
  return `I am ${facts.role.toLowerCase()}. My work is at ${facts.workName}.`;
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

/**
 * Interprets one player message and produces a truthful reply.
 * `seed` only varies wording; it never changes which intent matched.
 */
export function respond(message: string, facts: AdvisorFacts, seed = 0): DialogueReply {
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
      text: `I did not follow that. Try asking what I am doing, where I live, or where a place is.`,
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
  const base = { intent: candidate.intent, confidence: candidate.confidence, libraryVersion: SENTENCE_LIBRARY_VERSION } as const;
  const seedShift = seed + candidate.entryId.length;

  switch (candidate.intent) {
    case "greet":
      return { state: "answered", text: pick([`Well met, Advisor.`, `Advisor. Good to see you.`, `Ah — you. What is it?`], seedShift), ...base };
    case "thanks":
      return { state: "answered", text: pick([`You are welcome.`, `Hm. Thank me when it works.`], seedShift), ...base };
    case "farewell":
      return { state: "answered", text: `Safe roads, Advisor.`, ...base };
    case "meta.smalltalk":
      return { state: "answered", text: `${moodAnswer(facts)}`, ...base };
    case "query.status":
      return { state: "answered", text: statusAnswer(facts, seedShift), ...base };
    case "query.location":
      return { state: "answered", text: locationAnswer(facts), ...base };
    case "query.schedule":
      return { state: "answered", text: scheduleAnswer(facts), ...base };
    case "query.mood":
      return { state: "answered", text: moodAnswer(facts), ...base };
    case "query.home":
      return { state: "answered", text: homeAnswer(facts), ...base };
    case "query.work":
      return { state: "answered", text: workAnswer(facts), ...base };
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

/** True when this reply represents a proposal the character weighed. */
export function isProposal(reply: DialogueReply): boolean {
  return reply.state === "proposed" || (reply.state === "refused" && reply.proposal !== undefined);
}

/** Every intent that reached the pipeline is either a query or a bounded proposal. */
export function replyMayHaveMutatedWorld(reply: DialogueReply): false {
  // By construction the dialogue layer cannot write world state. Kept as an
  // explicit, testable statement of that invariant.
  void reply;
  return false;
}

export { intentMayPropose };
export type { IntentId, Interpretation, Candidate };
