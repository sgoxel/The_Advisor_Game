import test from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_VERSION, ITEM_CATALOG, ITEM_GIVING_REACH_M, MAX_ITEMS_PER_HOLDER, MAX_JOURNAL_ENTRIES,
  applyTransfer, canTransfer, emptyInventory, holderOf, itemExchangeLegal, itemFromCode, itemsHeldBy,
  parseInventory, replayTransfers, seedInventory, seededItems, serializeInventory, validateInventory,
} from "../src/inventory.ts";
import { itemExchangeLegalBetween } from "../src/simulation.ts";
import { performItemTransfer } from "../src/item-transfer.ts";
import { LazySimulation } from "../src/simulation.ts";
import { villages } from "../src/geography.ts";
import { localDayIndex } from "../src/clock.ts";

const MIRA = "W/P/RESIDENT/7";
const ODA = "W/P/RESIDENT/9";
const FAR = "W/P/RESIDENT/11";

test("SEED idly decides which belongings a resident owns, deterministically", () => {
  const first = seededItems(MIRA), second = seededItems(MIRA);
  assert.deepEqual(first, second, "the same resident code must always own the same items");
  assert.ok(first.length >= 1 && first.length <= 3, `unexpected item count ${first.length}`);
  assert.equal(new Set(first.map((item) => item.kind)).size, first.length, "a holder must not own two identical kinds");
  for (const item of first) {
    assert.equal(item.code, `${MIRA}/ITEM/${first.indexOf(item)}`);
    assert.ok(ITEM_CATALOG.some((kind) => kind.id === item.kind), `invented kind ${item.kind}`);
    assert.ok(item.grams > 0);
  }
  // Different people do not all own the same thing.
  const kinds = new Set([MIRA, ODA, FAR, "W/P/RESIDENT/21", "W/P/RESIDENT/33"]
    .flatMap((code) => seededItems(code).map((item) => item.kind)));
  assert.ok(kinds.size >= 3, `suspiciously uniform belongings: ${[...kinds].join(",")}`);
});

test("an item's identity can be rebuilt from its canonical code alone", () => {
  for (const item of seededItems(MIRA)) {
    const rebuilt = itemFromCode(item.code);
    assert.deepEqual(rebuilt, item, "item identity must not depend on a separate registry");
  }
  assert.equal(itemFromCode("W/P/RESIDENT/7/ITEM/99"), undefined, "an out-of-range ordinal is not an item");
  assert.equal(itemFromCode("nonsense"), undefined);
});

test("ownership starts empty and is only filled by the SEED scheme", () => {
  const state = emptyInventory();
  assert.equal(state.version, INVENTORY_VERSION);
  assert.deepEqual(itemsHeldBy(state, MIRA), []);
  assert.equal(holderOf(state, `${MIRA}/ITEM/0`), undefined);

  const seeded = seedInventory([MIRA, ODA]);
  assert.deepEqual(itemsHeldBy(seeded, MIRA).map((item) => item.code),
    seededItems(MIRA).map((item) => item.code), "seeded holder must own exactly their SEED items");
  assert.equal(holderOf(seeded, `${MIRA}/ITEM/0`), MIRA);
});

test("a refused proposal leaves ownership exactly as it was", () => {
  const state = seedInventory([MIRA, ODA]);
  const item = seededItems(MIRA)[0];

  // Someone else's item cannot be given away.
  const stolen = canTransfer(state, item.code, ODA, MIRA);
  assert.equal(stolen.ok, false);
  assert.match(stolen.reason, /not carrying/i);

  // An invented item never passes.
  assert.equal(canTransfer(state, `${MIRA}/ITEM/97`, MIRA, ODA).ok, false);

  // A person cannot hand something to themselves.
  assert.equal(canTransfer(state, item.code, MIRA, MIRA).ok, false);

  // Applying a refused transfer changes nothing at all.
  assert.equal(applyTransfer(state, item.code, ODA, MIRA, 3), undefined);
  assert.equal(holderOf(state, item.code), MIRA);
  assert.equal(state.journal.length, 0);
});

test("an accepted hand-over moves exactly one item and journals it", () => {
  const state = seedInventory([MIRA, ODA]);
  const item = seededItems(MIRA)[0];
  const receiverBefore = itemsHeldBy(state, ODA).length;

  const applied = applyTransfer(state, item.code, MIRA, ODA, 12);
  assert.ok(applied);
  assert.equal(holderOf(applied.state, item.code), ODA, "ownership must move to the receiver");
  assert.equal(itemsHeldBy(applied.state, MIRA).length, seededItems(MIRA).length - 1);
  assert.equal(itemsHeldBy(applied.state, ODA).length, receiverBefore + 1);
  assert.equal(applied.state.journal.length, 1);
  assert.equal(applied.event.itemName, item.name);
  assert.equal(applied.event.from, MIRA);
  assert.equal(applied.event.to, ODA);
  // The original state is untouched (pure update, no aliasing surprise).
  assert.equal(holderOf(state, item.code), MIRA);
});

test("a receiver at capacity refuses politely instead of silently dropping stock", () => {
  let state = seedInventory([MIRA, ODA, FAR]);
  // Fill ODA to the cap using other people's items.
  const donors = seededItems(MIRA).concat(seededItems(FAR));
  for (const item of donors.slice(0, MAX_ITEMS_PER_HOLDER)) {
    const from = holderOf(state, item.code)!;
    const applied = applyTransfer(state, item.code, from, ODA, 2);
    if (applied) state = applied.state;
  }
  assert.equal(itemsHeldBy(state, ODA).length, MAX_ITEMS_PER_HOLDER);
  const extra = donors[MAX_ITEMS_PER_HOLDER] ?? seededItems("W/P/RESIDENT/44")[0];
  const verdict = canTransfer(state, extra.code, holderOf(state, extra.code)!, ODA);
  if (holderOf(state, extra.code)) assert.equal(verdict.ok, false, "capacity must refuse the extra item");
});

test("accepted transfers replay exactly once across a reload", () => {
  const state = seedInventory([MIRA, ODA]);
  const item = seededItems(MIRA)[0];
  const applied = applyTransfer(state, item.code, MIRA, ODA, 5)!;
  const persisted = serializeInventory(applied.state);

  // A reload parses the same record and replays the same journal.
  const reloaded = parseInventory(persisted)!;
  assert.ok(reloaded);
  const replayed = replayTransfers(reloaded, reloaded.journal);
  assert.equal(holderOf(replayed, item.code), ODA, "replay must not undo a valid transfer");
  assert.equal(replayed.journal.length, 1, "replaying an already-applied event must not duplicate it");

  // Re-sending the same event again is still a no-op.
  const again = replayTransfers(replayed, [applied.event, applied.event]);
  assert.equal(again.journal.length, 1);
  assert.equal(holderOf(again, item.code), ODA);
});

test("a journal event whose giver no longer holds the item is ignored", () => {
  const state = seedInventory([MIRA, ODA]);
  const item = seededItems(MIRA)[0];
  // Someone who never held it claims to have given it away.
  const foreign = {
    id: `${item.code}>${FAR}>1`, item: item.code, itemName: item.name,
    from: ODA, to: FAR, day: 1,
  };
  const replayed = replayTransfers(state, [foreign]);
  assert.equal(holderOf(replayed, item.code), MIRA, "a foreign event must not move the item");
  assert.equal(replayed.journal.length, 0, "an ignored event must not be journalled");
});

test("a corrupt or hand-edited save is refused, never trusted", () => {
  const good = seedInventory([MIRA]);
  assert.ok(validateInventory(good));
  assert.ok(parseInventory(serializeInventory(good)));

  assert.equal(parseInventory("not json"), undefined);
  assert.equal(parseInventory(null), undefined);
  assert.equal(parseInventory("x".repeat(70_000)), undefined, "oversized saves are refused");

  const badVersion = { ...good, version: "inventory-v99" };
  assert.equal(validateInventory(badVersion), false);

  const unknownItem = {
    version: INVENTORY_VERSION,
    holders: { "W/P/RESIDENT/7/ITEM/0": "made-up-item-code" },
    journal: [],
  };
  assert.equal(validateInventory(unknownItem), false, "an item the SEED scheme cannot produce is refused");

  const tooMany = {
    version: INVENTORY_VERSION, holders: {},
    journal: Array.from({ length: MAX_JOURNAL_ENTRIES + 1 }, (_, i) => ({
      id: `e${i}`, item: `${MIRA}/ITEM/0`, itemName: "x", from: MIRA, to: ODA, day: i,
    })),
  };
  assert.equal(validateInventory(tooMany), false, "the journal must stay bounded");

  const badHolder = { version: INVENTORY_VERSION, holders: { [`${MIRA}/ITEM/0`]: 42 }, journal: [] };
  assert.equal(validateInventory(badHolder), false);
});

test("a hand-over needs two grounded, nearby people from the same settlement", () => {
  const giver = { code: MIRA, settlement: "W/P", grounded: true };
  const taker = { code: ODA, settlement: "W/P", grounded: true };

  assert.equal(itemExchangeLegal(giver, taker, 1.2).ok, true);
  assert.equal(itemExchangeLegal(giver, taker, ITEM_GIVING_REACH_M + 0.1).ok, false, "too far");
  assert.equal(itemExchangeLegal(giver, taker, Number.NaN).ok, false, "an unmeasured distance is not proof");
  assert.equal(itemExchangeLegal({ ...giver, grounded: false }, taker, 1).ok, false, "an ungrounded resident");
  assert.equal(itemExchangeLegal(giver, { ...taker, settlement: "W/Q" }, 1).ok, false, "different settlements");
  assert.equal(itemExchangeLegal(giver, giver, 0).ok, false, "nobody to give it to");
});

test("Simulation's exchange verdict matches the inventory rule for real positions", () => {
  const person = (code: string, lon: number, lat: number, over: Record<string, unknown> = {}) => ({
    code, settlement: "W/P", grounded: true, indoors: false,
    position: { lon, lat, elevation: 0 }, ...over,
  });
  const giver = person(MIRA, 0.001, 0.001);
  const near = person(ODA, 0.0010005, 0.001);
  const far = person(FAR, 0.02, 0.001);

  assert.equal(itemExchangeLegalBetween(giver as never, near as never).ok, true);
  assert.equal(itemExchangeLegalBetween(giver as never, far as never).ok, false);
  assert.equal(itemExchangeLegalBetween(giver as never, { ...near, indoors: true } as never).ok, false,
    "a hand-over must happen outside, where the people actually are");
  assert.equal(itemExchangeLegalBetween(giver as never, { ...near, grounded: false } as never).ok, false);
});

test("the whole hand-over works on genuine Simulation residents", () => {
  // Real SEED world, real resident identities and positions — no fixtures.
  const place = villages[0];
  const simulation = new LazySimulation();
  simulation.setFocus(place);
  const lon = place.canonicalPosition.lon;
  const day = localDayIndex(simulation.tick, lon);

  // Two genuine, outdoor, grounded residents of the same settlement.
  const residents = simulation.focusedResidents(place.x, place.z, 110, 24)
    .filter((resident) => resident.grounded && !resident.indoors);
  assert.ok(residents.length >= 2, "the seed settlement must yield outdoor residents");
  const [giver, receiver] = residents;
  const inventory = seedInventory([giver.code, receiver.code]);
  const item = itemsHeldBy(inventory, giver.code)[0];
  assert.ok(item, "the giver must genuinely own a SEED item");

  // Their real positions decide the physical verdict; report it honestly.
  const verdict = itemExchangeLegalBetween(giver, receiver);
  const outcome = performItemTransfer(inventory, giver, receiver, day, itemExchangeLegalBetween);
  assert.equal(outcome.accepted, verdict.ok,
    `acceptance must match Simulation's physical verdict (${verdict.reason})`);

  if (outcome.accepted) {
    assert.equal(holderOf(outcome.state, item.code), receiver.code, "the receiver must own the item");
    assert.equal(itemsHeldBy(outcome.state, giver.code).length, itemsHeldBy(inventory, giver.code).length - 1);
    assert.equal(outcome.state.journal.length, 1, "an accepted hand-over is journalled once");
    assert.ok(outcome.message.includes(receiver.name), "the message names the receiver, never a raw code");
    assert.ok(!/[A-Z]{2,}\/\w+\/\d/.test(outcome.message), "no SEED code leaks into player text");
  } else {
    assert.equal(outcome.state, inventory, "a refusal returns the identical inventory state");
    assert.equal(holderOf(outcome.state, item.code), giver.code);
  }
  // Either way, the same inputs replay to the same decision (determinism).
  const repeat = performItemTransfer(inventory, giver, receiver, day, itemExchangeLegalBetween);
  assert.deepEqual(repeat, outcome);
});

test("a resident with nothing to offer cannot conjure an item", () => {
  const place = villages[0];
  const simulation = new LazySimulation();
  simulation.setFocus(place);
  const residents = simulation.focusedResidents(place.x, place.z, 110, 24)
    .filter((resident) => resident.grounded && !resident.indoors);
  assert.ok(residents.length >= 2);
  const empty = emptyInventory();
  const outcome = performItemTransfer(empty, residents[0], residents[1], 1, itemExchangeLegalBetween);
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.state, empty);
  assert.match(outcome.message, /carrying nothing/i);
});
