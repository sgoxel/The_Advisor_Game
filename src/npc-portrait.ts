import { CHARACTER_TYPES } from "./characters.ts";

/** A resident portrait is their existing SEED-selected illustrated character,
 * not a second PlayCanvas scene or a second GPU device competing with the world.
 * One cached image per surface survives the once-per-second popup refresh. */
const portraits = new Map<string, HTMLImageElement>();
// A missing specialist must not be fetched again on every popup refresh.
const unavailablePortraits = new Set<string>();
export function mountNpcPortrait(slot: HTMLElement, key: string, name: string, channel = "popup") {
  let portrait = portraits.get(channel);
  if (!portrait) {
    portrait = document.createElement("img");
    portrait.className = "npc-picture";
    portrait.width = 74;
    portrait.height = 96;
    portrait.decoding = "async";
    portrait.loading = "eager";
    portrait.onerror = () => {
      // Match the real world's per-character 2D fallback. Never loop on an
      // unavailable default or let a recycled portrait show the wrong person.
      const failed = portrait!.dataset.character;
      if (!failed || failed === "default") return;
      if (portrait!.src !== new URL(`characters/${failed}.webp`, document.baseURI).href) return;
      unavailablePortraits.add(failed);
      portrait!.dataset.character = "default";
      portrait!.src = new URL("characters/default.webp", document.baseURI).href;
    };
    portraits.set(channel, portrait);
  }
  const preferred = Object.hasOwn(CHARACTER_TYPES, key) ? key : "default";
  const art = unavailablePortraits.has(preferred) ? "default" : preferred;
  const url = new URL(`characters/${art}.webp`, document.baseURI).href;
  portrait.dataset.character = art;
  if (portrait.src !== url) portrait.src = url;
  portrait.alt = `Illustration of ${name}`;
  slot.replaceChildren(portrait);
}
