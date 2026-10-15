/** Presentation symbols for canonical places; never create sites or world identity. */
export type PlaceSymbolKind = "city" | "village" | "castle" | "ruin" | "landmark";
const paths: Record<PlaceSymbolKind, string> = {
  village: '<path d="M3 12 8 7l5 5v8H3zM13 10l4-4 4 4v10h-8M7 20v-5h3v5M16 13h2"/>',
  city: '<path d="M3 20V8h4V4h3v4h4V4h3v4h4v12ZM8 20v-6h8v6M6 11h2m8 0h2"/>',
  castle: '<path d="M3 20V5h3v3h3V5h3v3h3V5h3v3h3v12ZM9 20v-6a3 3 0 0 1 6 0v6"/>',
  ruin: '<path d="M4 20V9l4-4 2 5 3-3 2 7 5-3v9M2 20h20M7 14v3m10-1v2"/>',
  landmark: '<path d="m12 3 8 9-8 9-8-9ZM12 8v5m0 3v1"/>',
};
export function placeSymbol(kind: PlaceSymbolKind): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${paths[kind]}</svg>`;
}
