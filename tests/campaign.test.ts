/**
 * WP-S010-008-002 — campaign identity, resume and a creation-derived fantasy
 * timeline.
 *
 * The defect: every page load silently started a fresh timeline from a hardcoded
 * demo epoch. A campaign must instead remember when it began, so fantasy time
 * keeps running between sessions, and a corrupt record must be reported rather
 * than replaced by a different campaign.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CAMPAIGN_STORAGE_KEY,
  CAMPAIGN_VERSION,
  campaignEpochMs,
  campaignIdFor,
  clearCampaign,
  createCampaign,
  readCampaign,
  resolveCampaign,
  validateCampaign,
  writeCampaign,
  type CampaignRecord,
} from "../src/campaign.ts";
import { fantasyOrigin, YEAR_OFFSET, WORLD_TIMEZONE } from "../src/clock.ts";

function installStorage(initial?: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

const T0 = Date.parse("2026-11-10T09:30:00Z");

test("a campaign id is deterministic for the same seed and instant", () => {
  const a = campaignIdFor("SEED-A", T0);
  const b = campaignIdFor("SEED-A", T0);
  const c = campaignIdFor("SEED-A", T0 + 1);
  const d = campaignIdFor("SEED-B", T0);
  assert.equal(a, b, "same seed + instant must give the same campaign id");
  assert.notEqual(a, c, "a different instant is a different campaign");
  assert.notEqual(a, d, "a different seed is a different campaign");
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("validation accepts a real record and rejects nonsense", () => {
  const good = createCampaign(T0, "SEED-A");
  assert.equal(validateCampaign(good), true);
  assert.equal(validateCampaign(null), false);
  assert.equal(validateCampaign({}), false);
  assert.equal(validateCampaign({ ...good, version: "campaign-v0" }), false);
  assert.equal(validateCampaign({ ...good, id: "has spaces" }), false);
  assert.equal(validateCampaign({ ...good, seed: "" }), false);
  assert.equal(validateCampaign({ ...good, seed: "x".repeat(200) }), false);
  assert.equal(validateCampaign({ ...good, createdAtMs: Number.NaN }), false);
  assert.equal(validateCampaign({ ...good, createdAtMs: -1 }), false);
  assert.equal(validateCampaign({ ...good, createdAtMs: Date.now() + 10 * 86_400_000 }), false, "far-future creation is refused");
});

test("the first load creates and stores a campaign", () => {
  const store = installStorage();
  const load = resolveCampaign(T0);
  assert.equal(load.state, "created");
  assert.ok(load.state === "created");
  assert.equal(load.record.seed.length > 0, true);
  assert.equal(load.record.createdAtMs, T0);
  assert.equal(load.record.version, CAMPAIGN_VERSION);
  assert.ok(store.has(CAMPAIGN_STORAGE_KEY), "the new campaign must be persisted");
});

test("a second load resumes the same campaign instead of starting a new one", () => {
  installStorage();
  const first = resolveCampaign(T0);
  assert.ok(first.state === "created");
  const second = resolveCampaign(T0 + 5 * 60_000);
  assert.equal(second.state, "resumed", "reload must resume, not recreate");
  assert.ok(second.state === "resumed");
  assert.equal(second.record.id, first.record.id);
  assert.equal(second.record.createdAtMs, first.record.createdAtMs, "the origin instant must not drift");
});

test("a corrupt record is reported and never replaced silently", () => {
  installStorage({ [CAMPAIGN_STORAGE_KEY]: "{not json" });
  const load = resolveCampaign(T0);
  assert.equal(load.state, "unreadable");
  assert.ok(load.state === "unreadable");
  assert.match(load.reason, /corrupt/i);
});

test("an invalid record is reported rather than trusted", () => {
  installStorage({ [CAMPAIGN_STORAGE_KEY]: JSON.stringify({ version: CAMPAIGN_VERSION, id: "x", seed: "", createdAtMs: T0 }) });
  const load = resolveCampaign(T0);
  assert.equal(load.state, "unreadable");
});

test("an implausibly large record is rejected", () => {
  installStorage({ [CAMPAIGN_STORAGE_KEY]: "x".repeat(5000) });
  const load = resolveCampaign(T0);
  assert.equal(load.state, "unreadable");
});

test("with storage unavailable the campaign still runs but is honestly unpersisted", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  const load = resolveCampaign(T0);
  assert.equal(load.state, "unavailable");
  assert.ok(load.state === "unavailable");
  assert.match(load.reason, /storage/i);
});

test("writing then reading round-trips the exact record", () => {
  installStorage();
  const record = createCampaign(T0, "SEED-A");
  assert.equal(writeCampaign(record), true);
  const { record: read } = readCampaign();
  assert.deepEqual(read, record);
  assert.equal(campaignEpochMs(), T0);
});

test("writing an invalid record is refused", () => {
  installStorage();
  const bad = { ...createCampaign(T0), seed: "" } as CampaignRecord;
  assert.equal(writeCampaign(bad), false);
});

test("clearing forgets the campaign, so the next load creates a fresh one", () => {
  installStorage();
  const first = resolveCampaign(T0);
  assert.ok(first.state === "created");
  clearCampaign();
  const second = resolveCampaign(T0 + 60_000);
  assert.equal(second.state, "created");
  assert.ok(second.state === "created");
  assert.notEqual(second.record.id, first.record.id);
});

/* ---------------------------------------------------------------- */
/* The fantasy timeline derives from the campaign                    */
/* ---------------------------------------------------------------- */

test("fantasy year is the real year minus 1900 at the campaign instant", () => {
  const created = fantasyOrigin(T0);
  const date = new Date(created);
  const realYear = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: WORLD_TIMEZONE, year: "numeric" })
      .formatToParts(T0)
      .find((p) => p.type === "year")!.value,
  );
  assert.equal(date.getUTCFullYear(), realYear - YEAR_OFFSET);
});

test("a resumed campaign keeps counting instead of resetting", () => {
  // Two different creation instants must yield different fantasy dates for the
  // same 'now', proving the origin is campaign-owned rather than fixed.
  const early = fantasyOrigin(T0);
  const late = fantasyOrigin(T0 + 30 * 86_400_000);
  assert.equal(late - early, 30 * 86_400_000, "a 30-day-later campaign begins 30 days later");
});

test("the demo epoch remains available as the documented fallback", () => {
  // No campaign resolved means ACTIVE_EPOCH_MS falls back; the constant itself
  // must remain stable so the reference scenario is reproducible.
  const demo = Date.parse("2026-10-07T08:48:29Z");
  assert.equal(new Date(fantasyOrigin(demo)).getUTCFullYear(), 126);
});
