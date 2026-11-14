/**
 * WP-S010-008-002 — the campaign panel.
 *
 * The WP's remaining acceptance is behavioural, not visual: the player must be
 * able to see which campaign they are in, accept it explicitly, and a broken save
 * must fail honestly with no silent replacement.
 *
 * These tests run against a tiny DOM stand-in so the real panel logic is
 * exercised without a browser.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CAMPAIGN_STORAGE_KEY, createCampaign, readCampaign } from "../src/campaign.ts";
import { CampaignPanel, fantasyDateOf, fantasyYearRule } from "../src/campaign-panel.ts";

/* ------------------------------------------------------------------ */
/* Minimal DOM so the panel's own code is the thing under test         */
/* ------------------------------------------------------------------ */

type FakeEl = {
  hidden: boolean;
  innerHTML: string;
  dataset: Record<string, string>;
  textContent: string;
  readonly handlers: Map<string, () => void>;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): FakeEl | null;
  querySelectorAll(selector: string): FakeEl[];
  addEventListener(type: string, handler: () => void): void;
  focus(): void;
};

/**
 * Parses enough of the rendered markup to find `data-*` buttons, so click
 * handlers are attached to elements that actually exist.
 */
function fakeRoot(): FakeEl {
  const element = (): FakeEl => ({
    hidden: false,
    innerHTML: "",
    dataset: {},
    textContent: "",
    handlers: new Map(),
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) { this.handlers.set(type, handler); },
    focus() {},
  });

  const root = element();
  const buttons = new Map<string, FakeEl>();

  root.querySelector = (selector: string) => {
    const match = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!match) return null;
    return buttons.get(match[1]) ?? null;
  };
  root.querySelectorAll = () => [];

  // After each render, discover the data-* buttons present in the markup.
  const originalSet = Object.getOwnPropertyDescriptor(root, "innerHTML");
  void originalSet;
  let markup = "";
  Object.defineProperty(root, "innerHTML", {
    get() { return markup; },
    set(value: string) {
      markup = value;
      // Rebuild the button map for this render.
      const seen = new Set<string>();
      for (const m of value.matchAll(/data-([a-z-]+)/g)) {
        const key = m[1];
        if (seen.has(key)) continue;
        seen.add(key);
        if (!buttons.has(key)) buttons.set(key, element());
        else buttons.set(key, element()); // fresh handlers each render
      }
      // Attach click handlers by re-querying after the panel sets them.
      queueMicrotask(() => {});
    },
  });

  return root;
}

/**
 * The panel attaches handlers via `root.querySelector(...).addEventListener`, so
 * the fake root must hand back the same element instance the panel later finds.
 * This helper returns both the root and the button registry.
 */
function makeDom() {
  const registry = new Map<string, FakeEl>();
  const make = (): FakeEl => ({
    hidden: false,
    innerHTML: "",
    dataset: {},
    textContent: "",
    handlers: new Map(),
    setAttribute() {},
    querySelector: (selector: string) => {
      const m = /^\[data-([a-z-]+)\]$/.exec(selector);
      return m ? registry.get(m[1]) ?? null : null;
    },
    querySelectorAll: () => [],
    addEventListener(type, handler) { this.handlers.set(type, handler); },
    focus() {},
  });
  const root = make();
  let markup = "";
  Object.defineProperty(root, "innerHTML", {
    get() { return markup; },
    set(value: string) {
      markup = value;
      for (const m of value.matchAll(/data-([a-z-]+)/g)) {
        const key = m[1];
        registry.set(key, registry.get(key) ?? make());
        registry.get(key)!.handlers.clear();
      }
    },
  });
  return { root, registry, click: (key: string) => registry.get(key)?.handlers.get("click")?.() };
}

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

const T0 = Date.parse("2026-11-11T10:00:00Z");

/* ------------------------------------------------------------------ */
/* Presentation                                                       */
/* ------------------------------------------------------------------ */

test("the creation-derived fantasy date follows the year-1900 rule", () => {
  const record = createCampaign(Date.parse("2026-11-11T10:00:00Z"));
  const label = fantasyDateOf(record);
  assert.match(label, /^\d{2}\.\d{2}\.0126$/, `unexpected fantasy date: ${label}`);
  assert.match(fantasyYearRule(), /minus 1900/);
});

/* ------------------------------------------------------------------ */
/* States                                                             */
/* ------------------------------------------------------------------ */

test("a first run offers to begin a campaign", () => {
  installStorage();
  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  assert.equal(panel.current.kind, "new");
  assert.match(root.innerHTML, /Begin this campaign/);
  assert.match(root.innerHTML, /A new realm awaits/);
});

test("a returning player is offered to continue the same campaign", () => {
  const store = installStorage();
  const first = makeDom();
  new CampaignPanel(first.root, { now: () => T0 }).accept();
  assert.ok(store.has(CAMPAIGN_STORAGE_KEY));

  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 + 60_000 });
  assert.equal(panel.current.kind, "resumed");
  assert.match(root.innerHTML, /Continue this campaign/);
  assert.match(root.innerHTML, /Welcome back/);
  // The campaign identity shown must be the stored one, not a new one.
  assert.equal(panel.current.record?.id ?? (panel.current as { record: { id: string } }).record.id, readCampaign().record!.id);
});

test("no campaign is accepted until the player explicitly accepts it", () => {
  const store = installStorage();
  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  assert.equal(panel.isAccepted, false);
  // Constructing the panel does not persist a campaign.
  assert.equal(store.has(CAMPAIGN_STORAGE_KEY), false, "the panel must not silently accept");
});

test("accepting persists the campaign and reports the mode", () => {
  const store = installStorage();
  const { root, click } = makeDom();
  const seen: string[] = [];
  new CampaignPanel(root, { now: () => T0, onAccepted: (_r, mode) => seen.push(mode) });
  click("campaign-accept");
  assert.ok(store.has(CAMPAIGN_STORAGE_KEY), "accept must persist the campaign");
  assert.deepEqual(seen, ["created"]);
  assert.equal(readCampaign().record?.createdAtMs, T0);
});

test("continuing a resumed campaign reports 'continued' and keeps the id", () => {
  installStorage();
  const first = makeDom();
  new CampaignPanel(first.root, { now: () => T0 }).accept();
  const storedId = readCampaign().record!.id;

  const { root, click } = makeDom();
  const seen: string[] = [];
  new CampaignPanel(root, { now: () => T0 + 120_000, onAccepted: (_r, mode) => seen.push(mode) });
  click("campaign-accept");
  assert.deepEqual(seen, ["continued"]);
  assert.equal(readCampaign().record!.id, storedId, "continuing must not mint a new campaign");
});

/* ------------------------------------------------------------------ */
/* Honest failure                                                     */
/* ------------------------------------------------------------------ */

test("a corrupt save is reported and nothing is replaced automatically", () => {
  const store = installStorage({ [CAMPAIGN_STORAGE_KEY]: "{broken" });
  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  assert.equal(panel.current.kind, "unreadable");
  assert.match(root.innerHTML, /could not be read/i);
  assert.match(root.innerHTML, /not modified/i);
  assert.equal(store.get(CAMPAIGN_STORAGE_KEY), "{broken", "the broken record must be left untouched");
  // A broken save offers no 'continue' action at all.
  assert.doesNotMatch(root.innerHTML, /Continue this campaign/);
});

test("an unreadable save cannot be accepted through the normal action", () => {
  installStorage({ [CAMPAIGN_STORAGE_KEY]: "{broken" });
  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  assert.equal(panel.accept(), false, "a broken campaign must not be accepted as if valid");
  assert.equal(panel.isAccepted, false);
});

test("starting a new campaign after a broken save is an explicit, separate action", () => {
  const store = installStorage({ [CAMPAIGN_STORAGE_KEY]: "{broken" });
  const { root, click } = makeDom();
  new CampaignPanel(root, { now: () => T0 });
  // Step 1: explicitly discard the unreadable record and show a fresh campaign.
  click("campaign-new");
  assert.doesNotMatch(root.innerHTML, /could not be read/i, "the failure view is replaced by a new campaign");
  assert.match(root.innerHTML, /Begin this campaign/);
  // Step 2: the player still has to accept it before anything is persisted.
  click("campaign-accept");
  assert.notEqual(store.get(CAMPAIGN_STORAGE_KEY), "{broken");
  assert.equal(readCampaign().record?.createdAtMs, T0);
});

test("with storage unavailable the panel says the campaign will not persist", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  const { root } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  assert.equal(panel.current.kind, "unavailable");
  assert.match(root.innerHTML, /cannot be saved/i);
});

test("accepting with storage unavailable fails honestly rather than claiming success", () => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage = undefined;
  const { root, click } = makeDom();
  const panel = new CampaignPanel(root, { now: () => T0 });
  click("campaign-accept");
  assert.equal(panel.isAccepted, false, "a campaign that cannot be saved is not accepted silently");
});

test("with a new-campaign entry supplied, Start a new campaign defers to it and changes nothing itself", () => {
  const store = installStorage();
  new CampaignPanel(makeDom().root, { now: () => T0 }).accept();
  const stored = store.get(CAMPAIGN_STORAGE_KEY);
  const { root, click } = makeDom();
  let calls = 0;
  new CampaignPanel(root, { now: () => T0 + 60_000, onStartNew: () => { calls++; } });
  click("campaign-new");
  assert.equal(calls, 1);
  assert.equal(store.get(CAMPAIGN_STORAGE_KEY), stored, "the seed dialog flow, not the panel, replaces the campaign");
});

test("after a broken save the new-campaign entry is the same seed-dialog path", () => {
  const store = installStorage({ [CAMPAIGN_STORAGE_KEY]: "{broken" });
  const { root, click } = makeDom();
  let calls = 0;
  new CampaignPanel(root, { now: () => T0, onStartNew: () => { calls++; } });
  click("campaign-new");
  assert.equal(calls, 1);
  assert.equal(store.get(CAMPAIGN_STORAGE_KEY), "{broken");
});
