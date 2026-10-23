/** Presentation symbols for canonical places; never create sites or world identity. */
export type PlaceSymbolKind = "city" | "village" | "castle" | "ruin" | "landmark" | "forest" | "lake" | "cave" | "mine" | "dungeon" | "hill" | "cliff" | "waterfall";
const paths: Record<PlaceSymbolKind, string> = {
  forest: '<path d="m8 3-5 8h3l-4 6h5v4m1-10 5 7h-4m5-15-4 7h3l-3 5h5v6m0-6h5l-4-5h3l-4-7"/>',
  lake: '<path d="m3 11 4-7 4 7m2-1 3-6 5 8M2 16q3-3 6 0t6 0 8 0M2 21q3-3 6 0t6 0 8 0"/>',
  cave: '<path d="m2 21 3-12 7-7 7 7 3 12ZM8 21v-6a4 4 0 0 1 8 0v6"/>',
  mine: '<path d="m4 4 16 16M3 11Q8 1 19 3M3 21V11m18 10V11M3 11h18"/>',
  dungeon: '<path d="M3 21V8l9-6 9 6v13M7 21v-8a5 5 0 0 1 10 0v8M8 17h8m-6 2h6m-4 2h4"/>',
  hill: '<path d="M2 21Q4 7 9 9T22 21ZM10 15q3-8 6-11 4 4 6 13"/>',
  cliff: '<path d="m3 21 2-15 7-3 8 4 1 14M5 6l6 4-1 11M12 3l4 10-2 8"/>',
  waterfall: '<path d="M2 4h11v12m-5-12v10m10-10v12M2 21q3-3 6 0t6 0 8 0M2 12h5m12 0h3"/>',
  village: '<path d="M3 12 8 7l5 5v8H3zM13 10l4-4 4 4v10h-8M7 20v-5h3v5M16 13h2"/>',
  city: '<path d="M3 20V8h4V4h3v4h4V4h3v4h4v12ZM8 20v-6h8v6M6 11h2m8 0h2"/>',
  castle: '<path d="M3 20V5h3v3h3V5h3v3h3V5h3v3h3v12ZM9 20v-6a3 3 0 0 1 6 0v6"/>',
  ruin: '<path d="M4 20V9l4-4 2 5 3-3 2 7 5-3v9M2 20h20M7 14v3m10-1v2"/>',
  landmark: '<path d="m12 3 8 9-8 9-8-9ZM12 8v5m0 3v1"/>',
};
export function placeSymbol(kind: PlaceSymbolKind): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${paths[kind]}</svg>`;
}
