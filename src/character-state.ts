/**
 * Per-character campaign state produced by Advisor conversation.
 *
 * `docs/README.md` allows conversation to influence "beliefs, intentions, trust,
 * memory, priorities and future choices", while the Simulation remains the only
 * authority over world truth. This module owns exactly that permitted slice:
 *
 *   - Advisor trust (0..100)
 *   - a mood offset layered on top of the deterministic `moodAt()` baseline
 *   - remembered exchanges, so the character can refer back
 *   - persistent status marks (wary, confiding, hopeful, …)
 *   - declared intentions from advice the character weighed
 *
 * It NEVER moves, creates, renames or re-equips anyone, and it never changes
 * resources, rank, ownership, position or world facts. Base mood stays a pure
 * function of SEED + fantasy time; this is a bounded campaign overlay on it.
 *
 * The state is saved per canonical resident code, so every NPC keeps its own
 * history with the Advisor.
 */

/** Canonical SEED resident code: "<place code>/RESIDENT/<index>". */
const RESIDENT_CODE = /^.+?\/RESIDENT\/(0|[1-9][0-9]*)$/;

export const CHARACTER_STATE_STORAGE_PREFIX = "advisor.character.v1.";
export const CHARACTER_STATE_VERSION = "character-v1";

/** Neutral trust: neither friend nor stranger. */
export const TRUST_NEUTRAL = 50;
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;
/** Mood offset is bounded so conversation can shade a day, never rewrite it. */
export const MOOD_DELTA_LIMIT = 0.45;
/** Mood offset relaxes toward the SEED baseline this much per fantasy day. */
export const MOOD_DECAY_PER_DAY = 0.05;
/** Memories kept per character (oldest dropped). */
export const MEMORY_LIMIT = 24;
/** How many recent exchanges the character can refer to in dialogue. */
export const RECALL_DEPTH = 6;

export type CharacterStatus =
  | "wary"
  | "confiding"
  | "hopeful"
  | "low"
  | "encouraged"
  | "resentful";

export type CharacterMemory = {
  /** Dialogue topic or follow-up move id. */
  readonly tag: string;
  /** Fantasy day index the exchange happened. */
  readonly day: number;
  readonly trustDelta: number;
  readonly moodDelta: number;
};

export type EveningDestination = "inn" | "market" | "home";

/**
 * A standing preference the Advisor persuaded the character to adopt: where to
 * spend the evening after work. It changes ONE anchor in the day plan, never the
 * routine structure, and the character may still decline it (see adviceVerdict).
 */
export type EveningPlan = {
  readonly destination: EveningDestination;
  /** Fantasy day the advice was given, kept for transparency. */
  readonly day: number;
};

export type CharacterIntent = {
  /** "travel" | "rest" | "talk" — what the Advisor suggested. */
  readonly kind: string;
  /** Canonical target id when one was resolved, else a description. */
  readonly target: string;
  readonly day: number;
};

export type CharacterState = {
  readonly code: string;
  readonly version: string;
  readonly trust: number;
  readonly moodDelta: number;
  readonly memories: readonly CharacterMemory[];
  /** Topics already credited today, so attention cannot be farmed. */
  readonly creditedDay: number;
  readonly creditedTags: readonly string[];
  readonly intents: readonly CharacterIntent[];
  /** Saved post-duty destination the Advisor influenced, if any. */
  readonly evening?: EveningPlan;
  readonly updatedDay: number;
};

export function isResidentCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && RESIDENT_CODE.test(value);
}

export function neutralState(code: string, day = 0): CharacterState {
  return {
    code,
    version: CHARACTER_STATE_VERSION,
    trust: TRUST_NEUTRAL,
    moodDelta: 0,
    memories: [],
    creditedDay: day,
    creditedTags: [],
    intents: [],
    updatedDay: day,
  };
}

/** Shape + range validation; a malformed save is discarded, never trusted. */
export function validateCharacterState(value: unknown, code?: string): boolean {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<CharacterState>;
  if (typeof state.code !== "string" || !isResidentCode(state.code)) return false;
  if (code !== undefined && state.code !== code) return false;
  if (state.version !== CHARACTER_STATE_VERSION) return false;
  if (typeof state.trust !== "number" || !Number.isFinite(state.trust)) return false;
  if (state.trust < TRUST_MIN || state.trust > TRUST_MAX) return false;
  if (typeof state.moodDelta !== "number" || !Number.isFinite(state.moodDelta)) return false;
  if (Math.abs(state.moodDelta) > MOOD_DELTA_LIMIT + 1e-9) return false;
  if (!Array.isArray(state.memories) || state.memories.length > MEMORY_LIMIT) return false;
  for (const memory of state.memories) {
    if (!memory || typeof memory.tag !== "string" || typeof memory.day !== "number") return false;
  }
  if (!Array.isArray(state.intents) || state.intents.length > 12) return false;
  if (!Array.isArray(state.creditedTags)) return false;
  if (state.evening !== undefined) {
    const evening = state.evening as Partial<EveningPlan> | null;
    if (!evening || typeof evening !== "object") return false;
    if (evening.destination !== "inn" && evening.destination !== "market" && evening.destination !== "home") return false;
    if (typeof evening.day !== "number" || !Number.isFinite(evening.day)) return false;
  }
  return true;
}

export const clampTrust = (value: number) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, Math.round(value * 100) / 100));
export const clampMoodDelta = (value: number) =>
  Math.max(-MOOD_DELTA_LIMIT, Math.min(MOOD_DELTA_LIMIT, Math.round(value * 1000) / 1000));

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

/**
 * How one exchange moves the relationship. Values are intentionally small: a
 * conversation should shade a character, and many of them accumulate slowly.
 */
export type ExchangeEffect = {
  readonly trust: number;
  readonly mood: number;
  readonly status?: CharacterStatus;
  readonly intent?: { readonly kind: string; readonly target: string };
};

/**
 * Deterministic effect rules. `kind` is the topic id or follow-up move id that
 * was answered. Nothing here is random and nothing here depends on the camera.
 */
export function effectFor(
  kind: string,
  context: { readonly trust: number; readonly moodBand: string; readonly refused?: boolean },
): ExchangeEffect {
  // Being asked how they are, and being listened to, builds regard.
  const attentive = new Set(["feeling", "health", "sleep", "family", "home", "hope", "regret", "childhood"]);
  // Offering help and asking what they need is the strongest trust builder.
  const supportive = new Set(["help", "need", "advice", "consequence", "past"]);
  // Prying reads as pressure on someone who does not trust you yet.
  const intrusive = new Set(["secrets", "blame", "pay", "lord"]);
  // Curiosity about the world is neutral-to-warm.
  const curious = new Set(["detail", "others", "duration", "place", "roads", "weather", "animals", "harvest"]);

  if (context.refused) {
    // Weighing advice and declining it is honest, not betrayal. It costs nothing
    // but leaves the character thoughtful.
    return { trust: 0.5, mood: 0, status: "wary", intent: undefined };
  }
  if (supportive.has(kind)) {
    return { trust: 2, mood: 0.06, status: "encouraged" };
  }
  if (attentive.has(kind)) {
    return context.trust < 35
      ? { trust: 1, mood: 0.03 }
      : { trust: 1.5, mood: 0.05, status: "confiding" };
  }
  if (intrusive.has(kind)) {
    return context.trust < 40
      ? { trust: -1.5, mood: -0.05, status: "wary" }
      : { trust: 0.5, mood: 0, status: "confiding" };
  }
  if (curious.has(kind)) {
    return { trust: 0.5, mood: 0.01 };
  }
  return { trust: 0.25, mood: 0 };
}

/** Applies decay toward the SEED baseline as fantasy days pass. */
export function decayState(state: CharacterState, day: number): CharacterState {
  const elapsed = Math.max(0, day - state.updatedDay);
  if (elapsed <= 0) return state;
  const moodDelta = clampMoodDelta(state.moodDelta - MOOD_DECAY_PER_DAY * elapsed);
  return { ...state, moodDelta, updatedDay: day };
}

export type ExchangeOutcome = {
  readonly state: CharacterState;
  readonly trustDelta: number;
  readonly moodDelta: number;
  readonly status?: CharacterStatus;
  /** True when the exchange was already credited today (diminishing returns). */
  readonly repeated: boolean;
};

/**
 * Records one exchange. Attention is credited at most once per tag per fantasy
 * day, so a player cannot farm trust by repeating one question forever.
 */
export function applyExchange(
  state: CharacterState,
  exchange: {
    readonly tag: string;
    readonly day: number;
    readonly moodBand: string;
    readonly refused?: boolean;
    readonly intent?: { readonly kind: string; readonly target: string };
  },
): ExchangeOutcome {
  const decayed = decayState(state, exchange.day);
  const sameDay = decayed.creditedDay === exchange.day;
  const creditedTags = sameDay ? [...decayed.creditedTags] : [];
  const repeated = creditedTags.includes(exchange.tag);

  const raw = effectFor(exchange.tag, { trust: decayed.trust, moodBand: exchange.moodBand, refused: exchange.refused });
  // Repeated questions still leave a memory, but earn no further credit.
  const effect: ExchangeEffect = repeated ? { trust: 0, mood: 0 } : raw;

  const trust = clampTrust(decayed.trust + effect.trust);
  const moodDelta = clampMoodDelta(decayed.moodDelta + effect.mood);

  if (!repeated) creditedTags.push(exchange.tag);

  const memories = [
    ...decayed.memories,
    { tag: exchange.tag, day: exchange.day, trustDelta: effect.trust, moodDelta: effect.mood },
  ].slice(-MEMORY_LIMIT);

  const intents = exchange.intent
    ? [...decayed.intents.filter((entry) => entry.kind !== exchange.intent!.kind), { ...exchange.intent, day: exchange.day }].slice(-12)
    : decayed.intents;

  const next: CharacterState = {
    ...decayed,
    trust,
    moodDelta,
    memories,
    creditedDay: exchange.day,
    creditedTags,
    intents,
    updatedDay: exchange.day,
  };

  return {
    state: next,
    trustDelta: effect.trust,
    moodDelta: effect.mood,
    status: effect.status ?? statusOf(next),
    repeated,
  };
}

/** Status marks derived from the persisted relationship, not from mood alone. */
export function statusOf(state: CharacterState): CharacterStatus | undefined {
  if (state.trust <= 25) return "wary";
  if (state.trust >= 75) return "confiding";
  if (state.moodDelta >= 0.15) return "hopeful";
  if (state.moodDelta <= -0.15) return "low";
  return undefined;
}

/** Human label for the relationship, shown in the panel. */
export function trustLabel(trust: number): string {
  if (trust >= 85) return "devoted";
  if (trust >= 70) return "trusting";
  if (trust >= 58) return "warm";
  if (trust > 42) return "neutral";
  if (trust > 28) return "doubtful";
  if (trust > 15) return "wary";
  return "hostile";
}

/** Applies the persisted mood offset to the SEED baseline, in -1..1. */
export function effectiveMoodValue(base: number, moodDelta: number): number {
  return Math.max(-1, Math.min(1, Math.round((base + moodDelta) * 1000) / 1000));
}

/** Maps an effective mood value back to the canonical labels `moodAt` uses. */
export function moodLabelFor(value: number, hour: number): string {
  return value > 0.45 ? "cheerful"
    : value > 0.15 ? "content"
      : value > -0.15 ? "calm"
        : value > -0.45 ? (hour > 20 || hour < 6 ? "tired" : "grumpy")
          : "miserable";
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export type CharacterStore = {
  read(code: string): CharacterState | undefined;
  write(state: CharacterState): void;
  remove(code: string): void;
  codes(): string[];
};

/** In-memory store: tests, and the fallback when browser storage is unavailable. */
export function createMemoryCharacterStore(): CharacterStore {
  const map = new Map<string, CharacterState>();
  return {
    read: (code) => map.get(code),
    write: (state) => { map.set(state.code, state); },
    remove: (code) => { map.delete(code); },
    codes: () => [...map.keys()],
  };
}

export function storageKeyFor(code: string): string {
  return `${CHARACTER_STATE_STORAGE_PREFIX}${code}`;
}

/**
 * localStorage-backed store. Every read is validated, so a corrupt or
 * hand-edited save can never become a character's history.
 */
export function createBrowserCharacterStore(): CharacterStore {
  const read = (code: string): CharacterState | undefined => {
    try {
      const raw = globalThis.localStorage?.getItem(storageKeyFor(code));
      if (!raw || raw.length > 32_768) return undefined;
      const parsed: unknown = JSON.parse(raw);
      return validateCharacterState(parsed, code) ? (parsed as CharacterState) : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    read,
    write(state) {
      try { globalThis.localStorage?.setItem(storageKeyFor(state.code), JSON.stringify(state)); }
      catch { /* storage disabled: the session keeps its in-memory copy */ }
    },
    remove(code) {
      try { globalThis.localStorage?.removeItem(storageKeyFor(code)); } catch { /* ignore */ }
    },
    codes() {
      const result: string[] = [];
      try {
        const storage = globalThis.localStorage;
        if (!storage) return result;
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key?.startsWith(CHARACTER_STATE_STORAGE_PREFIX)) result.push(key.slice(CHARACTER_STATE_STORAGE_PREFIX.length));
        }
      } catch { /* ignore */ }
      return result;
    },
  };
}

let activeStore: CharacterStore | undefined;

/** The store the running game uses. */
export function characterStore(): CharacterStore {
  activeStore ??= createBrowserCharacterStore();
  return activeStore;
}

/** Test/embedding hook. */
export function setCharacterStore(store: CharacterStore | undefined): void {
  activeStore = store;
  stateCache.clear();
}

/** Loads a character's saved state, or a neutral one when none is saved. */
export function loadCharacter(code: string, day = 0): CharacterState {
  const stored = characterStore().read(code);
  return stored ? decayState(stored, day) : neutralState(code, day);
}

/** Persists a character's state. */
export function saveCharacter(state: CharacterState): void {
  characterStore().write(state);
  stateCache.set(state.code, state);
}

/* ------------------------------------------------------------------ */
/* Advice acceptance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Trust needed before the character will even weigh a suggestion to leave
 * their routine. Below this they are not hostile, just not persuaded.
 */
export const ADVICE_TRUST_FLOOR = 60;
/** At or above this, a character who can act will accept without convincing. */
export const ADVICE_TRUST_SURE = 78;

export type AdviceVerdict = "refuse" | "consider" | "accept";

/**
 * Deterministic gate: does this character weigh the Advisor's suggestion at all?
 * A stranger is refused politely; a warm acquaintance considers it; a trusted
 * friend is likely to act. No randomness — the same trust always decides the same
 * way, so a decisive refusal can never be rerolled by rephrasing.
 */
export function adviceVerdict(state: CharacterState): AdviceVerdict {
  if (state.trust < ADVICE_TRUST_FLOOR) return "refuse";
  if (state.trust >= ADVICE_TRUST_SURE) return "accept";
  return "consider";
}

/** How much trust is still missing before this character would consider advice. */
export function trustShortfall(state: CharacterState): number {
  return Math.max(0, Math.ceil(ADVICE_TRUST_FLOOR - state.trust));
}
/* ------------------------------------------------------------------ */
/* Cached reads                                                        */
/* ------------------------------------------------------------------ */

/**
 * The day planner asks for a resident's evening preference often, so an
 * in-memory cache keeps that O(1) instead of hitting localStorage per query.
 * It is populated on read/write and never bypasses validation on load.
 */
const stateCache = new Map<string, CharacterState>();

/** Shorthand the Simulation uses: the saved destination, or undefined. */
export function eveningAdviceFor(code: string): { destination: EveningDestination } | undefined {
  let cached = stateCache.get(code);
  if (!cached) {
    // Go through the active store so a memory store (tests, storage-disabled
    // play) behaves exactly like localStorage.
    const stored = characterStore().read(code);
    if (!stored) return undefined;
    cached = stored;
    stateCache.set(code, cached);
  }
  const destination = cached.evening?.destination;
  return destination ? { destination } : undefined;
}

/** Drops a cached entry, so the next read comes from storage. */
export function forgetCachedCharacter(code: string): void {
  stateCache.delete(code);
}

/** Records a post-duty destination the character agreed to adopt. */
export function setEveningPlan(state: CharacterState, destination: EveningDestination, day: number): CharacterState {
  return { ...state, evening: { destination, day } };
}

/** Clears the preference, returning the character to their seeded choice. */
export function clearEveningPlan(state: CharacterState): CharacterState {
  const { evening: _dropped, ...rest } = state;
  return rest as CharacterState;
}