/**
 * Simulation-owned household belongings (WP-S010-004-003).
 *
 * Invariants from docs/README.md:
 *  - Campaign SEED alone decides what an item IS and who starts out holding it.
 *  - Only a validated Simulation event can move an item between holders.
 *  - A UI, camera or language model may *propose* a hand-over; it can never
 *    manufacture an item, change a holder, or claim success on its own.
 *  - Accepted changes are journalled and replayed exactly once, so ownership
 *    survives a reload without ever being applied twice.
 *
 * Pure by construction: no DOM, no `Date`, no randomness. Everything derives
 * from `digest`-style hashing of stable canonical codes.
 */

export const INVENTORY_VERSION = "inventory-v1";
export const INVENTORY_STORAGE_PREFIX = "advisor.inventory.v1.";
/** Bounded so a corrupt or hostile save cannot grow without limit. */
export const MAX_JOURNAL_ENTRIES = 96;
export const MAX_ITEMS_PER_HOLDER = 4;
/** A hand-over needs the two people genuinely close together, in metres. */
export const ITEM_GIVING_REACH_M = 4;

export type ItemCategory = "food" | "tool" | "clothing" | "craft";

export type ItemKind = {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  /** Whole grams, so serialized numbers stay exact. */
  readonly grams: number;
};

/** Small authored catalogue: household goods a medieval villager plausibly owns. */
export const ITEM_CATALOG: readonly ItemKind[] = Object.freeze([
  { id: "oat-loaf", name: "Oat loaf", category: "food", grams: 700 },
  { id: "rye-sack", name: "Sack of rye", category: "food", grams: 4200 },
  { id: "cheese-wheel", name: "Cheese wheel", category: "food", grams: 1600 },
  { id: "clay-jug", name: "Clay jug", category: "craft", grams: 900 },
  { id: "wool-cloak", name: "Wool cloak", category: "clothing", grams: 2100 },
  { id: "leather-strap", name: "Leather strap", category: "craft", grams: 260 },
  { id: "iron-nails", name: "Bundle of nails", category: "tool", grams: 480 },
  { id: "wooden-spoon", name: "Carved spoon", category: "craft", grams: 90 },
  { id: "beeswax-candle", name: "Beeswax candle", category: "craft", grams: 140 },
  { id: "herb-pouch", name: "Pouch of herbs", category: "food", grams: 120 },
  { id: "whetstone", name: "Whetstone", category: "tool", grams: 640 },
  { id: "seed-pouch", name: "Pouch of seed corn", category: "food", grams: 800 },
]);

const kindById = new Map(ITEM_CATALOG.map((kind) => [kind.id, kind]));

/** Stable 32-bit hash (FNV-1a), identical to the other presentation helpers. */
export function inventoryDigest(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type Item = {
  /** Canonical item identity: stable for the same holder and ordinal. */
  readonly code: string;
  readonly kind: string;
  readonly name: string;
  readonly category: ItemCategory;
  readonly grams: number;
};

export function itemKind(id: string): ItemKind | undefined {
  return kindById.get(id);
}

/**
 * The belongings a resident SEED-owns. Deterministic: the same resident code
 * always yields the same items, in the same order, forever.
 */
export function seededItems(residentCode: string): Item[] {
  if (!residentCode) return [];
  const count = 1 + (inventoryDigest(`${residentCode}/ITEMS/COUNT`) % 3);
  const items: Item[] = [];
  const used = new Set<string>();
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const roll = inventoryDigest(`${residentCode}/ITEMS/${ordinal}`);
    // Walk the catalogue deterministically until an unused kind is found, so a
    // single holder never owns two identical entries.
    for (let step = 0; step < ITEM_CATALOG.length; step++) {
      const kind = ITEM_CATALOG[(roll + step) % ITEM_CATALOG.length];
      if (used.has(kind.id)) continue;
      used.add(kind.id);
      items.push({
        code: `${residentCode}/ITEM/${ordinal}`,
        kind: kind.id, name: kind.name, category: kind.category, grams: kind.grams,
      });
      break;
    }
  }
  return items;
}

/** One accepted hand-over, journalled for exactly-once replay. */
export type TransferEvent = {
  /** Deterministic identity of this transfer: replays dedupe on it. */
  readonly id: string;
  readonly item: string;
  readonly itemName: string;
  readonly from: string;
  readonly to: string;
  /** Fantasy day of the accepted hand-over (informational). */
  readonly day: number;
};

export type InventoryState = {
  readonly version: string;
  /** itemCode -> holder resident code. Only accepted transfers change this. */
  readonly holders: Readonly<Record<string, string>>;
  readonly journal: readonly TransferEvent[];
};

export type TransferVerdict = {
  readonly ok: boolean;
  /** Always worded for the player; never a raw code. */
  readonly reason: string;
};

export function emptyInventory(): InventoryState {
  return { version: INVENTORY_VERSION, holders: {}, journal: [] };
}

/** Seed every holder that is known, leaving already-known items untouched. */
export function seedInventory(residents: readonly string[]): InventoryState {
  const holders: Record<string, string> = {};
  for (const code of residents)
    for (const item of seededItems(code)) holders[item.code] = code;
  return { version: INVENTORY_VERSION, holders, journal: [] };
}

export function holderOf(state: InventoryState, itemCode: string): string | undefined {
  return state.holders[itemCode];
}

export function itemsHeldBy(state: InventoryState, residentCode: string, itemCodes?: readonly string[]): Item[] {
  const codes = itemCodes ?? Object.keys(state.holders);
  const out: Item[] = [];
  for (const code of codes) {
    if (state.holders[code] !== residentCode) continue;
    const item = itemFromCode(code);
    if (item) out.push(item);
  }
  return out;
}

/** Rebuild an item's identity from its canonical code (no separate registry). */
export function itemFromCode(code: string): Item | undefined {
  const match = /^(.*)\/ITEM\/(\d+)$/.exec(code);
  if (!match) return undefined;
  return seededItems(match[1]).find((item) => item.code === code);
}

/**
 * Validate one proposed hand-over. Pure: no state is changed here.
 * A refused proposal leaves ownership exactly as it was.
 */
export function canTransfer(
  state: InventoryState,
  itemCode: string,
  from: string,
  to: string,
): TransferVerdict {
  if (!from || !to) return { ok: false, reason: "Both people must be known." };
  if (from === to) return { ok: false, reason: "Someone cannot hand an item to themselves." };
  const item = itemFromCode(itemCode);
  if (!item) return { ok: false, reason: "That item does not exist." };
  const holder = state.holders[itemCode];
  if (holder !== from) return { ok: false, reason: "They are not carrying that item any more." };
  const receiverCount = itemsHeldBy(state, to).length;
  if (receiverCount >= MAX_ITEMS_PER_HOLDER)
    return { ok: false, reason: "They are already carrying as much as they can." };
  return { ok: true, reason: "The item is theirs to offer." };
}

/**
 * Apply an accepted transfer. The caller must already have a passing verdict
 * and the Simulation's physical approval; this function only records facts.
 */
export function applyTransfer(
  state: InventoryState,
  itemCode: string,
  from: string,
  to: string,
  day: number,
): { state: InventoryState; event: TransferEvent } | undefined {
  const verdict = canTransfer(state, itemCode, from, to);
  if (!verdict.ok) return undefined;
  const item = itemFromCode(itemCode)!;
  const event: TransferEvent = {
    id: `${itemCode}>${to}>${day}`,
    item: itemCode, itemName: item.name, from, to, day,
  };
  const holders = { ...state.holders, [itemCode]: to };
  const journal = [...state.journal, event].slice(-MAX_JOURNAL_ENTRIES);
  return { state: { version: INVENTORY_VERSION, holders, journal }, event };
}

/**
 * Replay persisted events exactly once. Re-applying an event already present in
 * the journal is a no-op, so a reload can never move an item twice.
 */
export function replayTransfers(
  state: InventoryState,
  events: readonly TransferEvent[],
): InventoryState {
  let current = state;
  const seen = new Set(current.journal.map((event) => event.id));
  for (const event of events) {
    if (seen.has(event.id)) continue;
    const verdict = canTransfer(current, event.item, event.from, event.to);
    if (!verdict.ok) continue; // a stale event must never resurrect ownership
    seen.add(event.id);
    current = {
      version: INVENTORY_VERSION,
      holders: { ...current.holders, [event.item]: event.to },
      journal: [...current.journal, event].slice(-MAX_JOURNAL_ENTRIES),
    };
  }
  return current;
}

export function validateInventory(value: unknown): value is InventoryState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<InventoryState>;
  if (state.version !== INVENTORY_VERSION) return false;
  if (!state.holders || typeof state.holders !== "object" || Array.isArray(state.holders)) return false;
  if (!Array.isArray(state.journal) || state.journal.length > MAX_JOURNAL_ENTRIES) return false;
  for (const [code, holder] of Object.entries(state.holders)) {
    if (typeof holder !== "string" || !holder || holder.length > 512) return false;
    // A holder is always a canonical resident; anything else is a hand edit.
    if (!/\/RESIDENT\/\d+$/.test(holder)) return false;
    // Never accept an item the SEED scheme cannot produce.
    if (!itemFromCode(code)) return false;
  }
  for (const event of state.journal) {
    if (!event || typeof event !== "object") return false;
    const entry = event as Partial<TransferEvent>;
    if (typeof entry.id !== "string" || entry.id.length > 1024) return false;
    if (typeof entry.item !== "string" || !itemFromCode(entry.item)) return false;
    if (typeof entry.from !== "string" || !entry.from) return false;
    if (typeof entry.to !== "string" || !entry.to) return false;
    if (typeof entry.day !== "number" || !Number.isFinite(entry.day)) return false;
  }
  return true;
}

export function serializeInventory(state: InventoryState): string {
  return JSON.stringify(state);
}

export function parseInventory(raw: string | null | undefined): InventoryState | undefined {
  if (!raw || raw.length > 65_536) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateInventory(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Physical precondition for a hand-over: two distinct, grounded people in the
 * same settlement, genuinely close. Pure so it is testable without a world.
 * Distances are canonical metres supplied by the caller (Simulation measures).
 */
export function itemExchangeLegal(
  giver: { code: string; settlement: string; grounded: boolean },
  receiver: { code: string; settlement: string; grounded: boolean },
  distanceM: number,
): TransferVerdict {
  if (!giver.grounded || !receiver.grounded)
    return { ok: false, reason: "Both people must be standing on solid ground." };
  if (giver.code === receiver.code)
    return { ok: false, reason: "There is nobody else close enough to take it." };
  if (giver.settlement !== receiver.settlement)
    return { ok: false, reason: "They are not in the same settlement." };
  if (!Number.isFinite(distanceM) || distanceM > ITEM_GIVING_REACH_M)
    return { ok: false, reason: "They would have to be within a few paces of each other." };
  return { ok: true, reason: "They are close enough to hand something over." };
}
