/**
 * Campaign event journal (WP-S010-008-003).
 *
 * Authority rules from docs/README.md, restated because this module is the one
 * place they can be broken cheaply:
 *
 *  - Only Simulation-approved changes become events. This module never decides
 *    whether a change is legal; it stores what Simulation already validated and
 *    refuses anything that does not carry a verifiable identity.
 *  - An event's id is *derived* from its content (campaign, type, fantasy tick,
 *    subject, detail). A caller cannot invent an id that does not match what it
 *    is claiming, and replaying the same change twice produces the same id, so
 *    exactly-once delivery is a property of the format rather than a promise.
 *  - Fantasy time is integer seconds. Milliseconds, entropy, camera transforms
 *    and renderer state are not representable, so they can never leak in.
 *  - Browser storage is treated as unreliable: every read is validated and
 *    checksummed, and a commit is written to a pending key, read back, verified,
 *    and only then promoted. A leftover pending record is recovered on load
 *    rather than silently dropped. This is honest verified promotion, not a
 *    claim of transactional durability.
 */
import { DEFAULT_WORLD_SEED, WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";

export const JOURNAL_VERSION = "campaign-journal-v1";
export const EVENT_VERSION = "campaign-event-v1";
/** Bounded so a corrupt or hostile payload can never be parsed unboundedly. */
export const MAX_JOURNAL_EVENTS = 512;
export const MAX_EVENT_DETAIL = 4096;
export const MAX_JOURNAL_BYTES = 384 * 1024;
const MAX_SUBJECT = 256;

/** Only change types this WP may persist. */
export const CAMPAIGN_EVENT_TYPES = Object.freeze([
  "site-visit-decided",
  "site-visit-returned",
] as const);
export type CampaignEventType = (typeof CAMPAIGN_EVENT_TYPES)[number];

/** One Simulation-approved change, identified by its own content. */
export type CampaignEvent = {
  readonly version: string;
  readonly id: string;
  readonly campaignId: string;
  readonly type: CampaignEventType;
  readonly tick: number;
  readonly subject: string;
  readonly detail: string;
};

export type CampaignJournal = {
  readonly version: string;
  readonly campaignId: string;
  /** Always in replay order: by fantasy tick, then by id. */
  readonly events: readonly CampaignEvent[];
};

export type EventParts = {
  readonly type: CampaignEventType;
  readonly tick: number;
  readonly subject: string;
  readonly detail: string;
};

export type CreateEventResult =
  | { readonly ok: true; readonly event: CampaignEvent }
  | { readonly ok: false; readonly reason: string };

export type AppendResult =
  | { readonly applied: true; readonly journal: CampaignJournal; readonly event: CampaignEvent }
  | {
      readonly applied: false;
      readonly journal: CampaignJournal;
      readonly reason: string;
      /** True when the change is already present, which is not an error. */
      readonly duplicate: boolean;
    };

/** FNV-1a over UTF-16 code units; deterministic and dependency free. */
function digest(text: string): string {
  let a = 2166136261;
  let b = 3166136261;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ (code + 31 * index), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The id an event *must* have. Content-addressed, so a fabricated id fails
 * validation and an identical repeat is detectable as a duplicate.
 */
export function campaignEventId(campaignId: string, parts: EventParts): string {
  return `evt-${digest([
    campaignId, parts.type, String(parts.tick), parts.subject, parts.detail,
  ].join("\u0001"))}`;
}

function isEventType(value: unknown): value is CampaignEventType {
  return typeof value === "string" &&
    (CAMPAIGN_EVENT_TYPES as readonly string[]).includes(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/**
 * Structural validation of the detail payload per type. A change must describe
 * itself completely enough to be replayed without the session that wrote it.
 */
function validDetail(type: CampaignEventType, detail: string): boolean {
  if (!boundedText(detail, MAX_EVENT_DETAIL)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  if (type === "site-visit-decided") {
    const edges = record.edgeCodes;
    return Number.isSafeInteger(record.decidedTick) && (record.decidedTick as number) >= 0 &&
      boundedText(record.from, MAX_SUBJECT) && boundedText(record.to, MAX_SUBJECT) &&
      Array.isArray(edges) && edges.length >= 2 && edges.length <= 12 &&
      edges.every((code) => boundedText(code, MAX_SUBJECT));
  }
  return Number.isSafeInteger(record.homeReturnTick) &&
    (record.homeReturnTick as number) >= 0;
}

/** True only for an event whose id matches its own content. */
export function validateCampaignEvent(value: unknown, campaignId?: string): value is CampaignEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<CampaignEvent>;
  if (event.version !== EVENT_VERSION) return false;
  if (!boundedText(event.campaignId, MAX_SUBJECT)) return false;
  if (campaignId !== undefined && event.campaignId !== campaignId) return false;
  if (!isEventType(event.type)) return false;
  if (!Number.isSafeInteger(event.tick) || (event.tick as number) < 0) return false;
  if (!boundedText(event.subject, MAX_SUBJECT)) return false;
  if (!validDetail(event.type, event.detail as string)) return false;
  const expected = campaignEventId(event.campaignId, {
    type: event.type,
    tick: event.tick as number,
    subject: event.subject,
    detail: event.detail as string,
  });
  return event.id === expected;
}

/** Replay order: fantasy time first, id as the deterministic tie-break. */
function compareEvents(a: CampaignEvent, b: CampaignEvent): number {
  return a.tick - b.tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function emptyJournal(campaignId: string): CampaignJournal {
  return Object.freeze({ version: JOURNAL_VERSION, campaignId, events: Object.freeze([]) });
}

/** Builds an event from validated parts, deriving its identity. */
export function createCampaignEvent(campaignId: string, parts: EventParts): CreateEventResult {
  if (!boundedText(campaignId, MAX_SUBJECT)) return { ok: false, reason: "This campaign has no identity to attach the change to." };
  if (!isEventType(parts.type)) return { ok: false, reason: "That change type cannot be persisted." };
  if (!Number.isSafeInteger(parts.tick) || parts.tick < 0)
    return { ok: false, reason: "Fantasy time must be a whole number of seconds." };
  if (!boundedText(parts.subject, MAX_SUBJECT))
    return { ok: false, reason: "The change has no identifiable subject." };
  if (!validDetail(parts.type, parts.detail))
    return { ok: false, reason: "The change does not describe itself well enough to replay." };
  return {
    ok: true,
    event: Object.freeze({
      version: EVENT_VERSION,
      id: campaignEventId(campaignId, parts),
      campaignId,
      type: parts.type,
      tick: parts.tick,
      subject: parts.subject,
      detail: parts.detail,
    }),
  };
}

/**
 * Appends one Simulation-approved change. A repeat of an already recorded change
 * is refused as a duplicate and leaves the journal byte-identical, which is what
 * "exactly once" means operationally.
 */
export function appendCampaignEvent(journal: CampaignJournal, candidate: unknown): AppendResult {
  if (journal.version !== JOURNAL_VERSION)
    return { applied: false, journal, reason: "This journal version is not understood.", duplicate: false };
  if (!validateCampaignEvent(candidate, journal.campaignId))
    return { applied: false, journal, reason: "The change failed validation and was not stored.", duplicate: false };
  const event = candidate;
  if (journal.events.some((existing) => existing.id === event.id))
    return { applied: false, journal, reason: "That change is already recorded.", duplicate: true };
  if (journal.events.length >= MAX_JOURNAL_EVENTS)
    return { applied: false, journal, reason: "The campaign history is full.", duplicate: false };
  const events = [...journal.events, event].sort(compareEvents);
  return {
    applied: true,
    event,
    journal: Object.freeze({
      version: JOURNAL_VERSION,
      campaignId: journal.campaignId,
      events: Object.freeze(events),
    }),
  };
}

function journalChecksum(campaignId: string, events: readonly CampaignEvent[]): string {
  return digest(`${campaignId}\u0002${events.map((event) => event.id).join(",")}`);
}

export type SerializeResult =
  | { readonly ok: true; readonly payload: string }
  | { readonly ok: false; readonly reason: string };

/** Serialises with a checksum, refusing anything larger than the bounded quota. */
export function serializeJournal(journal: CampaignJournal): SerializeResult {
  const payload = JSON.stringify({
    version: JOURNAL_VERSION,
    campaignId: journal.campaignId,
    events: journal.events,
    checksum: journalChecksum(journal.campaignId, journal.events),
  });
  if (payload.length > MAX_JOURNAL_BYTES)
    return { ok: false, reason: "The campaign history is larger than its storage bound." };
  return { ok: true, payload };
}

export type ParseResult =
  | { readonly ok: true; readonly journal: CampaignJournal }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses and fully verifies a payload. Corruption, tampering, truncation, a
 * mismatched campaign and any duplicate identity are all refused rather than
 * repaired silently.
 */
export function parseJournal(raw: unknown, campaignId: string): ParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "The stored campaign history is missing." };
  if (raw.length > MAX_JOURNAL_BYTES) return { ok: false, reason: "The stored campaign history was rejected as implausible." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The stored campaign history is corrupt and was not used." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, reason: "The stored campaign history is invalid and was not used." };
  const record = parsed as Record<string, unknown>;
  if (record.version !== JOURNAL_VERSION)
    return { ok: false, reason: "The stored campaign history uses an unknown version." };
  if (record.campaignId !== campaignId)
    return { ok: false, reason: "The stored campaign history belongs to a different campaign." };
  const rawEvents = record.events;
  if (!Array.isArray(rawEvents) || rawEvents.length > MAX_JOURNAL_EVENTS)
    return { ok: false, reason: "The stored campaign history is invalid and was not used." };
  const seen = new Set<string>();
  const events: CampaignEvent[] = [];
  for (const rawEvent of rawEvents) {
    if (!validateCampaignEvent(rawEvent, campaignId))
      return { ok: false, reason: "The stored campaign history contains an invalid change." };
    if (seen.has(rawEvent.id))
      return { ok: false, reason: "The stored campaign history contains a duplicate change." };
    seen.add(rawEvent.id);
    events.push(rawEvent);
  }
  if (record.checksum !== journalChecksum(campaignId, events))
    return { ok: false, reason: "The stored campaign history failed its integrity check." };
  events.sort(compareEvents);
  return { ok: true, journal: Object.freeze({ version: JOURNAL_VERSION, campaignId, events: Object.freeze(events) }) };
}

/** Storage surface this module needs; the browser satisfies it directly. */
export type JournalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function journalStorageKey(campaignId: string): string {
  return `advisor.campaign.journal.v1.${campaignId}`;
}

/** Written first and promoted only after a verified read-back. */
export function journalPendingKey(campaignId: string): string {
  return `advisor.campaign.journal.v1.${campaignId}.pending`;
}

/** Storage name of a world SEED inside the old per-seed keys. The default seed keeps its original "ALDERWICK" name. */
export function legacySeedTag(seed: string): string {
  return seed === DEFAULT_WORLD_SEED ? "ALDERWICK" : seed;
}

/**
 * Legacy single-blob site-visit key, kept only so an existing player's history
 * is imported once instead of silently discarded. It names the SEED, so a campaign
 * in another world never finds the default world's blob.
 */
export function legacySiteVisitsKey(seed: string): string {
  return `advisor-game:s005:${legacySeedTag(seed)}:${WORLD_FOUNDATION_VERSION}:site-visits`;
}
export const LEGACY_SITE_VISITS_KEY = legacySiteVisitsKey(WORLD_SEED);

/** Per-seed inventory key used before inventories were campaign-scoped. */
export function legacyInventoryKey(seed: string): string {
  return `advisor-game:s010:${legacySeedTag(seed)}:v1:inventory`;
}

/** Each campaign owns its inventory, so a new campaign never inherits the previous one's belongings. */
export function inventoryStorageKey(campaignId: string): string {
  return `advisor-game:s010:v1:inventory.${campaignId}`;
}

export type CommitResult =
  | { readonly ok: true; readonly recovered?: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Verified promotion: write pending, read it back and verify, write live, verify
 * the live read-back, then clear pending. If any step fails the pending record
 * is deliberately left in place so the next load can recover it.
 */
export function commitJournal(storage: JournalStorage, journal: CampaignJournal): CommitResult {
  const serialised = serializeJournal(journal);
  if (!serialised.ok) return { ok: false, reason: serialised.reason };
  const liveKey = journalStorageKey(journal.campaignId);
  const pendingKey = journalPendingKey(journal.campaignId);
  try {
    storage.setItem(pendingKey, serialised.payload);
    const written = parseJournal(storage.getItem(pendingKey), journal.campaignId);
    if (!written.ok || written.journal.events.length !== journal.events.length) {
      storage.removeItem(pendingKey);
      return { ok: false, reason: "The campaign history could not be verified after writing." };
    }
    storage.setItem(liveKey, serialised.payload);
    const promoted = parseJournal(storage.getItem(liveKey), journal.campaignId);
    if (!promoted.ok || promoted.journal.events.length !== journal.events.length)
      return { ok: false, reason: "The campaign history could not be verified after promotion." };
    storage.removeItem(pendingKey);
    return { ok: true };
  } catch {
    return { ok: false, reason: "Browser storage refused to save the campaign history." };
  }
}

export type LoadResult =
  | {
      readonly journal: CampaignJournal;
      /** Set when an interrupted commit was completed on this load. */
      readonly recovered?: string;
    }
  | { readonly journal?: undefined; readonly problem: string };

/**
 * Loads the authoritative journal. A valid pending record that was never
 * promoted is completed here, because that is exactly the torn state a failed
 * promotion leaves behind; nothing is invented to fill a gap.
 */
export function loadJournal(storage: JournalStorage, campaignId: string): LoadResult {
  const liveKey = journalStorageKey(campaignId);
  const pendingKey = journalPendingKey(campaignId);
  let liveRaw: string | null = null;
  let pendingRaw: string | null = null;
  try {
    liveRaw = storage.getItem(liveKey);
    pendingRaw = storage.getItem(pendingKey);
  } catch {
    return { problem: "Browser storage could not be read." };
  }
  const live = liveRaw === null || liveRaw === undefined
    ? undefined : parseJournal(liveRaw, campaignId);
  const pending = pendingRaw === null || pendingRaw === undefined
    ? undefined : parseJournal(pendingRaw, campaignId);
  if (live?.ok) {
    // A stale pending record after a successful promotion is debris, not data.
    if (pendingRaw !== null && pendingRaw !== undefined) {
      try { storage.removeItem(pendingKey); } catch { /* harmless */ }
    }
    return { journal: live.journal };
  }
  if (pending?.ok) {
    const committed = commitJournal(storage, pending.journal);
    return {
      journal: pending.journal,
      recovered: committed.ok
        ? "An interrupted save was completed from its pending record."
        : "An interrupted save was recovered for this session but could not be re-saved.",
    };
  }
  // Something was stored and nothing valid could be read: say so plainly.
  if (liveRaw !== null && liveRaw !== undefined)
    return { problem: live?.ok === false ? live.reason : "The stored campaign history is invalid and was not used." };
  return { journal: emptyJournal(campaignId) };
}

/** The site-visit record shape Simulation revalidates on replay. */
export type ReplayedSiteVisit = {
  readonly residentCode: string;
  readonly decidedTick: number;
  readonly from: string;
  readonly to: string;
  readonly edgeCodes: readonly string[];
  readonly homeReturnTick?: number;
};

/**
 * Rebuilds Simulation's site-visit history from the journal. Each resident is
 * assembled from at most one decision and at most one return, so replaying the
 * journal any number of times yields the same list.
 */
export function projectSiteVisits(journal: CampaignJournal): ReplayedSiteVisit[] {
  const bySubject = new Map<string, { decided?: ReplayedSiteVisit; returned?: number }>();
  for (const event of journal.events) {
    const slot = bySubject.get(event.subject) ?? {};
    if (event.type === "site-visit-decided") {
      if (slot.decided) continue;
      const detail = JSON.parse(event.detail) as { decidedTick: number; from: string; to: string; edgeCodes: string[] };
      slot.decided = {
        residentCode: event.subject,
        decidedTick: detail.decidedTick,
        from: detail.from,
        to: detail.to,
        edgeCodes: detail.edgeCodes,
      };
    } else if (slot.returned === undefined) {
      slot.returned = (JSON.parse(event.detail) as { homeReturnTick: number }).homeReturnTick;
    }
    bySubject.set(event.subject, slot);
  }
  return [...bySubject.values()]
    .filter((slot) => slot.decided !== undefined)
    .map((slot) => slot.returned === undefined
      ? slot.decided!
      : { ...slot.decided!, homeReturnTick: slot.returned })
    .sort((a, b) => a.decidedTick - b.decidedTick || (a.residentCode < b.residentCode ? -1 : 1));
}

export type RecordResult = {
  readonly journal: CampaignJournal;
  readonly added: number;
  readonly skipped: number;
};

/**
 * Records whatever Simulation currently considers approved, appending only the
 * events that are not present yet. Because identity is content-derived, calling
 * this again with the same history adds nothing; a partially applied set is
 * completed rather than duplicated.
 */
export function recordSiteVisits(journal: CampaignJournal, visits: unknown): RecordResult {
  if (!Array.isArray(visits) || visits.length > 64)
    return { journal, added: 0, skipped: Array.isArray(visits) ? visits.length : 0 };
  let working = journal, added = 0, skipped = 0;
  for (const raw of visits) {
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const visit = raw as Record<string, unknown>;
    const decidedTick = Number(visit.decidedTick);
    const created = createCampaignEvent(journal.campaignId, {
      type: "site-visit-decided",
      tick: decidedTick,
      subject: String(visit.residentCode ?? ""),
      detail: JSON.stringify({
        decidedTick,
        from: visit.from,
        to: visit.to,
        edgeCodes: visit.edgeCodes,
      }),
    });
    if (!created.ok) { skipped++; continue; }
    const appended = appendCampaignEvent(working, created.event);
    if (appended.applied) { working = appended.journal; added++; }
    else if (!appended.duplicate) { skipped++; continue; }
    if (visit.homeReturnTick === undefined) continue;
    const returnTick = Number(visit.homeReturnTick);
    const returned = createCampaignEvent(journal.campaignId, {
      type: "site-visit-returned",
      tick: returnTick,
      subject: String(visit.residentCode ?? ""),
      detail: JSON.stringify({ homeReturnTick: returnTick }),
    });
    if (!returned.ok) { skipped++; continue; }
    const applied = appendCampaignEvent(working, returned.event);
    if (applied.applied) { working = applied.journal; added++; }
    else if (!applied.duplicate) skipped++;
  }
  return { journal: working, added, skipped };
}

/**
 * One-time import of the pre-journal site-visit blob. Used only when the journal
 * is empty, so a live journal is never overwritten by older storage.
 */
export function importLegacySiteVisits(journal: CampaignJournal, legacy: unknown): { readonly journal: CampaignJournal; readonly imported: number; readonly skipped: number } {
  if (journal.events.length > 0 || !legacy || typeof legacy !== "object")
    return { journal, imported: 0, skipped: 0 };
  const recorded = recordSiteVisits(journal, (legacy as Record<string, unknown>).visits);
  return { journal: recorded.journal, imported: recorded.added, skipped: recorded.skipped };
}
