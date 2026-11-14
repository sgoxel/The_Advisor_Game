/**
 * Campaign identity and resume (WP-S010-008-002).
 *
 * A campaign is the player's accepted instance of the world: it fixes *when* the
 * campaign began and therefore the fantasy calendar, and it names the SEED the
 * world is built from. Without a stored campaign every page load would silently
 * start a fresh timeline, which is exactly the defect this module removes.
 *
 * Authority rules (docs/README.md):
 *  - the Campaign SEED owns world foundation; this module only records which SEED
 *    the campaign is using, it never generates world facts;
 *  - the creation timestamp is the fantasy clock origin (year − 1900), so time
 *    keeps running between sessions instead of resetting;
 *  - browser storage is a cache of the *choice*, never world truth. A corrupt or
 *    unreadable record must be reported honestly and must never silently
 *    fabricate a different campaign.
 */

import { CAMPAIGN_STORAGE_KEY, WORLD_SEED, isValidSeedCode } from "./config.ts";

export { CAMPAIGN_STORAGE_KEY };
export const CAMPAIGN_VERSION = "campaign-v1";
/** A campaign id is derived from the seed and creation instant. */
const CAMPAIGN_ID = /^[A-Za-z0-9-]{1,96}$/;
export const SEED_MAX_LENGTH = 96;
/** Mirrors clock.ts (WORLD_TIMEZONE, YEAR_OFFSET). Not imported: clock.ts reads this module at init. */
const FANTASY_TIMEZONE = "Europe/Istanbul";
const FANTASY_YEAR_OFFSET = 1900;

export type CampaignRecord = {
  readonly version: string;
  /** Stable identity for this campaign instance. */
  readonly id: string;
  /** Campaign SEED the world is generated from. */
  readonly seed: string;
  /** Real-world instant the campaign was accepted; the fantasy clock origin. */
  readonly createdAtMs: number;
};

export type CampaignLoad =
  | { readonly state: "resumed"; readonly record: CampaignRecord }
  | { readonly state: "created"; readonly record: CampaignRecord }
  | { readonly state: "unreadable"; readonly reason: string }
  | { readonly state: "unavailable"; readonly reason: string };

/** True only for a well-formed campaign record. */
export function validateCampaign(value: unknown): value is CampaignRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CampaignRecord>;
  if (record.version !== CAMPAIGN_VERSION) return false;
  if (typeof record.id !== "string" || !CAMPAIGN_ID.test(record.id)) return false;
  if (!isValidSeedCode(record.seed)) return false;
  if (typeof record.createdAtMs !== "number" || !Number.isFinite(record.createdAtMs)) return false;
  // A campaign cannot begin before this project existed, nor in the far future.
  if (record.createdAtMs < 0 || record.createdAtMs > Date.now() + 86_400_000) return false;
  return true;
}

/** Deterministic id for a seed + creation instant. */
export function campaignIdFor(seed: string, createdAtMs: number): string {
  let a = 2166136261;
  let b = 3166136261;
  const text = `${seed}|${createdAtMs}`;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ (code + 31 * index), 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** Builds a fresh campaign record. Pure: the caller supplies the instant. */
export function createCampaign(createdAtMs: number, seed = WORLD_SEED): CampaignRecord {
  return {
    version: CAMPAIGN_VERSION,
    id: campaignIdFor(seed, createdAtMs),
    seed,
    createdAtMs,
  };
}

/* ---------------------------------------------------------------- */
/* Seed codes chosen by the player                                   */
/* ---------------------------------------------------------------- */

export type SeedInputResult = { readonly seed: string; readonly error?: undefined } | { readonly seed?: undefined; readonly error: string };

/**
 * Normalises what the player typed into a seed code: trimmed, upper-cased, runs of
 * whitespace become a single hyphen. Anything that cannot be a seed is refused
 * with a message the dialog can show.
 */
export function normaliseSeedInput(text: string): SeedInputResult {
  const seed = String(text ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (seed.length === 0) return { error: "Enter a seed code, or press New suggestion." };
  if (seed.length > SEED_MAX_LENGTH) return { error: `Keep the seed to ${SEED_MAX_LENGTH} characters or fewer.` };
  if (!isValidSeedCode(seed)) return { error: "Use only letters, numbers and hyphens." };
  return { seed };
}

/**
 * The fantasy year a campaign begins in: the real year in the world timezone minus
 * 1900. Same rule as clock.ts `fantasyOrigin` (checked by tests/seed-dialog.test.ts).
 */
export function fantasyYearAt(realMs: number): number {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: FANTASY_TIMEZONE, year: "numeric" })
    .formatToParts(realMs)
    .find((p) => p.type === "year");
  return Number(part!.value) - FANTASY_YEAR_OFFSET;
}

const NAME_HEADS = ["ALDER", "ASH", "BRIAR", "BRAM", "CAER", "CRAG", "DUN", "ELDER", "FERN", "GLEN", "HAW", "HOLLOW", "IRON", "KEST", "LARK", "MOOR", "OAK", "RAVEN", "REED", "SILVER", "STONE", "THORN", "TAR", "WREN", "WYN", "ELM", "GILT", "HARROW", "IVY", "SALT"];
const NAME_TAILS = ["WICK", "MERE", "FORD", "HOLM", "DALE", "BURY", "TON", "WOLD", "HAVEN", "STEAD", "CROSS", "LEY", "HAM", "BRIDGE", "GATE", "THORPE", "FELL", "BROOK", "WORTH", "FIELD"];
const NAME_SOLO = ["ODRIN", "CAELWEN", "BRANOC", "VELTHAR", "MORWEN", "ELDRATH", "TALVEN", "ISRAEN", "KERRAN", "LYSSAN", "DRAVEN", "OSWYN", "TEVARA", "HALIVEN", "SOLVANE", "AUDRIC"];

/** Chooses one entry with the supplied random source (0 <= r < 1). */
const pickWith = <T>(list: readonly T[], random: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/**
 * A random fantasy place or person name in UPPERCASE ASCII letters only, at least
 * three letters. Used only for the player's suggestion; the world itself is never
 * built from this randomness.
 */
export function generateFantasyName(random: () => number = Math.random): string {
  if (random() < 0.25) return pickWith(NAME_SOLO, random);
  return pickWith(NAME_HEADS, random) + pickWith(NAME_TAILS, random);
}

/**
 * A suggested seed in the project's seed style, `ADVISOR-<YYYY>-<NAME>`, where YYYY
 * is the four-digit fantasy year the campaign starts in and NAME is a generated name.
 * Examples: ADVISOR-0126-THORNMERE, ADVISOR-0126-ODRIN, ADVISOR-0127-BRAMHOLM.
 */
export function suggestSeed(nowMs: number = Date.now(), random: () => number = Math.random): string {
  const year = String(fantasyYearAt(nowMs)).padStart(4, "0");
  return `ADVISOR-${year}-${generateFantasyName(random)}`;
}

/**
 * Stores a player's new campaign with the given seed and reads it back. Returns
 * false unless the exact seed is what storage now holds, so the caller never
 * reloads into a world that storage did not keep.
 */
export function saveNewCampaign(seed: string, createdAtMs: number = Date.now()): boolean {
  const record = createCampaign(createdAtMs, seed);
  if (!writeCampaign(record)) return false;
  return readCampaign().record?.seed === seed;
}

/**
 * True when browser storage works and holds no campaign yet: the player must choose
 * a seed first. Unavailable or unreadable storage is not a reason to ask (the page
 * keeps its current behaviour), and neither is an existing record.
 */
export function campaignNeedsChoice(): boolean {
  const { record, problem } = readCampaign();
  return !record && !problem;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Reads the stored campaign without creating one. Honest about corruption. */
export function readCampaign(): { record?: CampaignRecord; problem?: string } {
  const store = storage();
  if (!store) return { problem: "Browser storage is unavailable, so this campaign cannot be remembered." };
  let raw: string | null;
  try {
    raw = store.getItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    return { problem: "Browser storage could not be read." };
  }
  if (raw === null) return {};
  if (raw.length > 4096) return { problem: "The stored campaign record was rejected as implausible." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: "The stored campaign record is corrupt and was not used." };
  }
  if (!validateCampaign(parsed)) return { problem: "The stored campaign record is invalid and was not used." };
  return { record: parsed };
}

/** Persists a campaign choice. Returns false when storage refuses it. */
export function writeCampaign(record: CampaignRecord): boolean {
  if (!validateCampaign(record)) return false;
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the campaign for this page load: resume the stored one, else create
 * and store a new one. Never invents a campaign silently when a stored record is
 * corrupt — the caller receives `unreadable` and must surface it.
 */
export function resolveCampaign(nowMs: number = Date.now()): CampaignLoad {
  const { record, problem } = readCampaign();
  if (record) return { state: "resumed", record };
  // A present-but-broken record is a real failure, not a fresh start.
  if (problem && problem !== undefined && storage()?.getItem(CAMPAIGN_STORAGE_KEY) != null) {
    return { state: "unreadable", reason: problem };
  }
  const fresh = createCampaign(nowMs);
  if (!writeCampaign(fresh)) {
    return { state: "unavailable", reason: "Browser storage refused to save the campaign, so it will not persist." };
  }
  return { state: "created", record: fresh };
}

/**
 * The epoch the fantasy clock should use. Read synchronously at module load so
 * the whole world shares one consistent timeline. Falls back to the documented
 * demo epoch when no campaign can be resolved.
 */
export function campaignEpochMs(): number | undefined {
  const { record } = readCampaign();
  return record?.createdAtMs;
}

/** Test/embedding hook: forget the stored campaign. */
export function clearCampaign(): void {
  try {
    storage()?.removeItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
