/**
 * One item hand-over, end to end (WP-S010-004-003).
 *
 * This is the seam between three separate authorities, kept explicit so each
 * can be proven on its own:
 *
 *  - Simulation decides whether two people are physically able to exchange
 *    something (`itemExchangeLegalBetween` — grounded, outdoors, same
 *    settlement, within a few paces).
 *  - The inventory record decides who currently owns the item and is the only
 *    thing that may change a holder.
 *  - This function only sequences them and words the truthful result.
 *
 * A refusal always returns the input state unchanged, so "nothing happened" is
 * a fact the caller can assert, not a hope.
 */
import {
  applyTransfer, canTransfer, itemsHeldBy,
  type InventoryState,
} from "./inventory.ts";
import type { TransferVerdict } from "./inventory.ts";

export type ItemHolder = {
  readonly code: string;
  readonly name: string;
  readonly settlement: string;
  readonly grounded: boolean;
  readonly indoors: boolean;
  readonly position: { readonly lon: number; readonly lat: number; readonly elevation: number };
};

export type TransferOutcome = {
  readonly accepted: boolean;
  readonly message: string;
  /** Unchanged on refusal, so callers persist only real changes. */
  readonly state: InventoryState;
  readonly itemName?: string;
};

/**
 * Offer the giver's first real belonging to the receiver.
 * `legal` is injected so tests can prove the wiring without a world, while the
 * game always passes Simulation's own verdict.
 */
export function performItemTransfer(
  inventory: InventoryState,
  giver: ItemHolder,
  receiver: ItemHolder,
  day: number,
  legal: (giver: ItemHolder, receiver: ItemHolder) => TransferVerdict,
): TransferOutcome {
  const held = itemsHeldBy(inventory, giver.code);
  if (!held.length)
    return { accepted: false, message: `${giver.name} is carrying nothing they could offer.`, state: inventory };
  const item = held[0];

  const physical = legal(giver, receiver);
  if (!physical.ok)
    return { accepted: false, message: `${receiver.name} cannot take it: ${physical.reason}`, state: inventory, itemName: item.name };

  const ownership = canTransfer(inventory, item.code, giver.code, receiver.code);
  if (!ownership.ok)
    return { accepted: false, message: ownership.reason, state: inventory, itemName: item.name };

  const applied = applyTransfer(inventory, item.code, giver.code, receiver.code, day);
  if (!applied)
    return { accepted: false, message: "The hand-over was refused; nothing changed.", state: inventory, itemName: item.name };

  return {
    accepted: true,
    message: `${receiver.name} accepts the ${item.name.toLowerCase()}. It is theirs now.`,
    state: applied.state,
    itemName: item.name,
  };
}
