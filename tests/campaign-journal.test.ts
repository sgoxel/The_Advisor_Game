import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_JOURNAL_EVENTS,
  appendCampaignEvent,
  campaignEventId,
  commitJournal,
  createCampaignEvent,
  emptyJournal,
  importLegacySiteVisits,
  inventoryStorageKey,
  legacyInventoryKey,
  legacySiteVisitsKey,
  journalPendingKey,
  journalStorageKey,
  loadJournal,
  parseJournal,
  projectSiteVisits,
  serializeJournal,
  validateCampaignEvent,
  type CampaignEvent,
  type CampaignJournal,
  type JournalStorage,
} from "../src/campaign-journal.ts";
import { DEFAULT_WORLD_SEED, WORLD_FOUNDATION_VERSION } from "../src/config.ts";

const CAMPAIGN = "545b780a579db8d4";
const OTHER = "9f8e7d6c5b4a3210";

function memoryStorage(): JournalStorage & { readonly dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key) => dump.get(key) ?? null,
    setItem: (key, value) => { dump.set(key, value); },
    removeItem: (key) => { dump.delete(key); },
  };
}

function decision(tick: number, subject = "resident/one", from = "home", to = "market") {
  return createCampaignEvent(CAMPAIGN, {
    type: "site-visit-decided",
    tick,
    subject,
    detail: JSON.stringify({ decidedTick: tick, from, to, edgeCodes: ["edge/a", "edge/b"] }),
  });
}

function event(tick: number, subject = "resident/one"): CampaignEvent {
  const created = decision(tick, subject);
  assert.equal(created.ok, true);
  return (created as { ok: true; event: CampaignEvent }).event;
}

function journalWith(events: readonly CampaignEvent[]): CampaignJournal {
  return { version: "campaign-journal-v1", campaignId: CAMPAIGN, events };
}

test("an event's id is derived from its own content, so fabricated ids cannot pass", () => {
  const created = decision(120);
  assert.equal(created.ok, true);
  const real = (created as { ok: true; event: CampaignEvent }).event;
  assert.equal(validateCampaignEvent(real), true);
  assert.equal(real.id, campaignEventId(CAMPAIGN, {
    type: real.type, tick: real.tick, subject: real.subject, detail: real.detail,
  }));

  // Same content, different claimed identity: rejected.
  assert.equal(validateCampaignEvent({ ...real, id: "evt-0000000000000000" }), false);
  // Same id, tampered payload: rejected.
  assert.equal(validateCampaignEvent({ ...real, tick: real.tick + 1 }), false);
  // Belongs to another campaign: rejected for this one.
  assert.equal(validateCampaignEvent(real, OTHER), false);
});

test("the same change produces the same identity, which makes duplicate detection exact", () => {
  assert.equal(event(120).id, event(120).id);
  assert.notEqual(event(120).id, event(121).id);
  assert.notEqual(event(120, "resident/one").id, event(120, "resident/two").id);
});

test("appending is exactly-once: a repeat leaves the journal byte-identical", () => {
  const first = appendCampaignEvent(emptyJournal(CAMPAIGN), event(120));
  assert.equal(first.applied, true);
  const before = JSON.stringify(first.journal);

  const repeat = appendCampaignEvent(first.journal, event(120));
  assert.equal(repeat.applied, false);
  assert.equal(repeat.applied === false && repeat.duplicate, true, "a repeat is a duplicate, not an error");
  assert.equal(JSON.stringify(repeat.journal), before, "nothing was written for a duplicate");
  assert.equal(repeat.journal.events.length, 1);
});

test("changes that cannot be replayed are refused instead of stored", () => {
  const base = emptyJournal(CAMPAIGN);
  const fake = (parts: Record<string, unknown>) => {
    const created = createCampaignEvent(CAMPAIGN, parts as never);
    return created.ok;
  };
  assert.equal(fake({ type: "site-visit-decided", tick: 1.5, subject: "a", detail: JSON.stringify({ decidedTick: 1, from: "x", to: "y", edgeCodes: ["a", "b"] }) }), false, "fractional seconds are not fantasy time");
  assert.equal(fake({ type: "site-visit-decided", tick: -1, subject: "a", detail: JSON.stringify({ decidedTick: 1, from: "x", to: "y", edgeCodes: ["a", "b"] }) }), false, "negative fantasy time");
  assert.equal(fake({ type: "not-a-real-type", tick: 1, subject: "a", detail: "{}" }), false, "unknown change types");
  assert.equal(fake({ type: "site-visit-decided", tick: 1, subject: "", detail: JSON.stringify({ decidedTick: 1, from: "x", to: "y", edgeCodes: ["a", "b"] }) }), false, "no subject");
  assert.equal(fake({ type: "site-visit-decided", tick: 1, subject: "a", detail: "not json" }), false, "unparseable detail");
  assert.equal(fake({ type: "site-visit-decided", tick: 1, subject: "a", detail: JSON.stringify({ decidedTick: 1, from: "x", to: "y", edgeCodes: ["only-one"] }) }), false, "a journey needs real edges");

  // A well-formed but foreign object is refused by append rather than trusted.
  assert.equal(appendCampaignEvent(base, { ...event(5), campaignId: OTHER }).applied, false);
  assert.equal(appendCampaignEvent(base, "not an event").applied, false);
  assert.equal(appendCampaignEvent(base, { id: "evt-x" }).applied, false);
});

test("serialisation is checksummed, so tampering and truncation are refused", () => {
  const journal = journalWith([event(120), event(300)]);
  const serialised = serializeJournal(journal);
  assert.equal(serialised.ok, true);
  const payload = (serialised as { ok: true; payload: string }).payload;
  assert.equal(parseJournal(payload, CAMPAIGN).ok, true);

  // Tampered tick with the stale checksum.
  const tampered = payload.replace('"tick":120', '"tick":121');
  assert.notEqual(tampered, payload);
  assert.equal(parseJournal(tampered, CAMPAIGN).ok, false);

  // Truncated write.
  assert.equal(parseJournal(payload.slice(0, Math.floor(payload.length / 2)), CAMPAIGN).ok, false);
  // Structurally valid but for another campaign.
  assert.equal(parseJournal(payload, OTHER).ok, false);
  // Absurd sizes are refused before parsing.
  assert.equal(parseJournal("x".repeat(500_000), CAMPAIGN).ok, false);
  assert.equal(parseJournal(null, CAMPAIGN).ok, false);
});

test("a duplicate identity inside a stored payload is refused, not de-duplicated silently", () => {
  const single = event(120);
  const journal = journalWith([single]);
  const payload = JSON.stringify({
    version: "campaign-journal-v1",
    campaignId: CAMPAIGN,
    events: [single, single],
    checksum: (JSON.parse((serializeJournal(journal) as { ok: true; payload: string }).payload) as { checksum: string }).checksum,
  });
  assert.equal(parseJournal(payload, CAMPAIGN).ok, false);
});

test("replay order is fantasy time first, so offline catch-up cannot reorder history", () => {
  let journal = emptyJournal(CAMPAIGN);
  const late = appendCampaignEvent(journal, event(900));
  journal = late.journal;
  const early = appendCampaignEvent(journal, event(100));
  journal = early.journal;
  const middle = appendCampaignEvent(journal, event(500));
  journal = middle.journal;
  assert.deepEqual(journal.events.map((entry) => entry.tick), [100, 500, 900]);
});

test("projecting the journal twice yields identical site-visit history", () => {
  let journal = emptyJournal(CAMPAIGN);
  journal = appendCampaignEvent(journal, event(120, "resident/one")).journal;
  journal = appendCampaignEvent(journal, event(200, "resident/two")).journal;
  const returned = createCampaignEvent(CAMPAIGN, {
    type: "site-visit-returned",
    tick: 480,
    subject: "resident/one",
    detail: JSON.stringify({ homeReturnTick: 480 }),
  });
  assert.equal(returned.ok, true);
  journal = appendCampaignEvent(journal, (returned as { ok: true; event: CampaignEvent }).event).journal;

  const first = projectSiteVisits(journal);
  const serialised = serializeJournal(journal);
  assert.equal(serialised.ok, true);
  const reparsed = parseJournal((serialised as { ok: true; payload: string }).payload, CAMPAIGN);
  assert.equal(reparsed.ok, true);
  const second = projectSiteVisits((reparsed as { ok: true; journal: CampaignJournal }).journal);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    { residentCode: "resident/one", decidedTick: 120, from: "home", to: "market", edgeCodes: ["edge/a", "edge/b"], homeReturnTick: 480 },
    { residentCode: "resident/two", decidedTick: 200, from: "home", to: "market", edgeCodes: ["edge/a", "edge/b"] },
  ]);
  // And one decision never becomes two residents.
  assert.equal(first.filter((visit) => visit.residentCode === "resident/one").length, 1);
});

test("commits are verified before promotion and leave no pending debris", () => {
  const storage = memoryStorage();
  const journal = journalWith([event(120)]);
  assert.deepEqual(commitJournal(storage, journal), { ok: true });
  assert.equal(storage.dump.has(journalPendingKey(CAMPAIGN)), false, "pending cleared after promotion");
  assert.equal(storage.dump.has(journalStorageKey(CAMPAIGN)), true);

  const loaded = loadJournal(storage, CAMPAIGN);
  assert.equal(loaded.journal?.events.length, 1);
  assert.equal(loaded.recovered, undefined);
});

test("an interrupted commit is recovered from its pending record, not dropped", () => {
  const storage = memoryStorage();
  const journal = journalWith([event(120), event(300)]);
  // Simulate a write that died between pending and promotion.
  storage.setItem(journalPendingKey(CAMPAIGN), (serializeJournal(journal) as { ok: true; payload: string }).payload);

  const loaded = loadJournal(storage, CAMPAIGN);
  assert.equal(loaded.journal?.events.length, 2);
  assert.match(loaded.recovered ?? "", /interrupted save was completed/);
  // Recovery re-committed, so the live record now exists.
  assert.equal(storage.dump.has(journalStorageKey(CAMPAIGN)), true);
  assert.equal(storage.dump.has(journalPendingKey(CAMPAIGN)), false);
});

test("corrupt live and corrupt pending are reported, never silently replaced", () => {
  const storage = memoryStorage();
  storage.setItem(journalStorageKey(CAMPAIGN), "{ not json");
  storage.setItem(journalPendingKey(CAMPAIGN), "also broken");
  const loaded = loadJournal(storage, CAMPAIGN);
  assert.equal(loaded.journal, undefined);
  assert.ok(loaded.problem && loaded.problem.length > 0);
  // Nothing was overwritten by a fabricated empty history.
  assert.equal(storage.dump.get(journalStorageKey(CAMPAIGN)), "{ not json");
});

test("a storage that refuses writes reports failure and keeps the pending record", () => {
  const storage = memoryStorage();
  const journal = journalWith([event(120)]);
  const failing: JournalStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => { if (key === journalStorageKey(CAMPAIGN)) throw new Error("quota"); storage.setItem(key, value); },
    removeItem: (key) => storage.removeItem(key),
  };
  const result = commitJournal(failing, journal);
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; reason: string }).reason, /refused/);
  assert.equal(storage.dump.has(journalPendingKey(CAMPAIGN)), true, "pending survives so the next load can recover");
});

test("history is bounded, so a runaway journal cannot exhaust storage", () => {
  let journal = emptyJournal(CAMPAIGN);
  for (let tick = 0; tick < MAX_JOURNAL_EVENTS; tick++) {
    const appended = appendCampaignEvent(journal, event(tick));
    assert.equal(appended.applied, true);
    journal = appended.journal;
  }
  const overflow = appendCampaignEvent(journal, event(MAX_JOURNAL_EVENTS));
  assert.equal(overflow.applied, false);
  assert.match((overflow as { applied: false; reason: string }).reason, /full/);
  assert.equal(journal.events.length, MAX_JOURNAL_EVENTS);
});

test("legacy site visits are imported once and never overwrite a live journal", () => {
  const legacy = { version: 1, seed: "ADVISOR-0126-ALDERWICK", foundation: "v5", visits: [
    { residentCode: "resident/one", decidedTick: 120, from: "home", to: "market", edgeCodes: ["edge/a", "edge/b"] },
    { residentCode: "resident/two", decidedTick: 200, from: "gate", to: "inn", edgeCodes: ["edge/c", "edge/d"], homeReturnTick: 400 },
    { residentCode: "resident/bad", decidedTick: "not a tick", from: "x", to: "y", edgeCodes: ["edge/a", "edge/b"] },
  ] };

  const imported = importLegacySiteVisits(emptyJournal(CAMPAIGN), legacy);
  // Two residents became three events: one decision each, plus one home return.
  assert.equal(imported.imported, 3);
  assert.equal(imported.skipped, 1, "the malformed entry is counted, not silently dropped");
  const visits = projectSiteVisits(imported.journal);
  assert.equal(visits.length, 2);
  assert.equal(visits.find((visit) => visit.residentCode === "resident/two")?.homeReturnTick, 400);

  // Second import into the now-populated journal is a no-op.
  const again = importLegacySiteVisits(imported.journal, legacy);
  assert.equal(again.imported, 0);
  assert.equal(again.journal.events.length, imported.journal.events.length);
});

test("two campaigns cannot see each other's history", () => {
  const storage = memoryStorage();
  commitJournal(storage, journalWith([event(120)]));
  assert.equal(loadJournal(storage, CAMPAIGN).journal?.events.length, 1);
  const other = loadJournal(storage, OTHER);
  assert.equal(other.journal?.events.length, 0);
  assert.notEqual(journalStorageKey(CAMPAIGN), journalStorageKey(OTHER));
});

test("the default seed keeps its original save keys; another seed gets its own", () => {
  assert.equal(legacySiteVisitsKey(DEFAULT_WORLD_SEED), `advisor-game:s005:ALDERWICK:${WORLD_FOUNDATION_VERSION}:site-visits`);
  assert.equal(legacyInventoryKey(DEFAULT_WORLD_SEED), "advisor-game:s010:ALDERWICK:v1:inventory");
  assert.notEqual(legacySiteVisitsKey("ADVISOR-0126-THORNMERE"), legacySiteVisitsKey(DEFAULT_WORLD_SEED));
  assert.equal(legacyInventoryKey("ADVISOR-0126-THORNMERE"), "advisor-game:s010:ADVISOR-0126-THORNMERE:v1:inventory");
});

test("each campaign owns its inventory key", () => {
  assert.notEqual(inventoryStorageKey(CAMPAIGN), inventoryStorageKey(OTHER));
  assert.ok(inventoryStorageKey(CAMPAIGN).endsWith(CAMPAIGN));
});
