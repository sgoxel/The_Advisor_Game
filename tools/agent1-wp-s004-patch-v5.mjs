import fs from "node:fs";

function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

let world = fs.readFileSync("src/world.ts", "utf8");
world = replaceOnce(
  world,
  'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";',
  'import { nearestPlace, nearbyPlaces, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";',
  "bounded geography import",
);
world = replaceOnce(
  world,
  '      radius = place.kind === "city" ? 430 : 90,',
  '      radius = Math.max(place.kind === "city" ? 430 : 90, settlementExteriorFor(place).radius + (place.kind === "city" ? 24 : 18)),',
  "settlement prepared extent",
);
world = replaceOnce(
  world,
  `  for (const place of places) {\n    const coarseExtent = place.kind === "city" ? 456 : 178,\n      tileCentreX = tile.minX + tile.size * .5,\n      tileCentreZ = tile.minZ + tile.size * .5;`,
  `  const tileCentreX = tile.minX + tile.size * .5,\n    tileCentreZ = tile.minZ + tile.size * .5;\n  for (const place of nearbyPlaces(tileCentreX, tileCentreZ)) {\n    const coarseExtent = place.kind === "city" ? 456 : 178;`,
  "bounded settlement feature scan",
);
fs.writeFileSync("src/world.ts", world);
console.log("Applied WP-S004 bounded settlement runtime patch");
