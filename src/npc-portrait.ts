import { CHARACTER_TYPES } from "./characters.ts";

/** A resident portrait is their existing SEED-selected illustrated character,
 * not a second PlayCanvas scene or a second GPU device competing with the world.
 * One cached image per surface survives the once-per-second popup refresh. */
const portraits = new Map<string, HTMLImageElement>();
export function mountNpcPortrait(slot: HTMLElement, key: string, name: string, channel = "popup") {
  let portrait = portraits.get(channel);
  if (!portrait) {
    portrait = document.createElement("img");
    portrait.className = "npc-picture";
    portrait.width = 74;
    portrait.height = 96;
    portrait.decoding = "async";
    portrait.loading = "eager";
    portraits.set(channel, portrait);
  }
  const art = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
  const url = new URL(`characters/${art}.webp`, document.baseURI).href;
  if (portrait.src !== url) portrait.src = url;
  portrait.alt = `Illustration of ${name}`;
  portrait.dataset.character = art;
  slot.replaceChildren(portrait);
}
