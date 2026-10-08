import { readFileSync, writeFileSync } from "node:fs";

const path = "src/world.ts";
let source = readFileSync(path, "utf8");
const oldSelection = `  const bounds = viewBounds(view),\n    focus = sourceToLonLat(view.x, view.z),\n    longitudeScale = Math.max(0.02, Math.abs(Math.cos(focus.lat))),\n    rx = Math.min(WORLD_SIZE / 2, bounds.rx / longitudeScale),\n    rz = bounds.rz,\n    selected = new Map<string, Tile>(),\n    centres = [view.x];\n\n  if (view.x - rx < WORLD_MIN) centres.push(view.x + WORLD_SIZE);\n  if (view.x + rx > -WORLD_MIN) centres.push(view.x - WORLD_SIZE);`;
const newSelection = `  const bounds = viewBounds(view),\n    focus = sourceToLonLat(view.x, view.z),\n    atPole = Math.abs(Math.abs(focus.lat) - Math.PI / 2) <= 1e-12,\n    streamX = atPole ? 0 : view.x,\n    longitudeScale = Math.max(0.02, Math.abs(Math.cos(focus.lat))),\n    rx = atPole\n      ? WORLD_SIZE / 2\n      : Math.min(WORLD_SIZE / 2, bounds.rx / longitudeScale),\n    rz = bounds.rz,\n    selected = new Map<string, Tile>(),\n    centres = [streamX];\n\n  if (streamX - rx < WORLD_MIN) centres.push(streamX + WORLD_SIZE);\n  if (streamX + rx > -WORLD_MIN) centres.push(streamX - WORLD_SIZE);`;
if (!source.includes(oldSelection)) throw new Error("pole selection target not found");
source = source.replace(oldSelection, newSelection);
const oldSort = "wrappedTileDistanceX(a.minX + a.size / 2, view.x)";
if (!source.includes(oldSort)) throw new Error("pole sort target not found");
source = source.replaceAll(oldSort, "wrappedTileDistanceX(a.minX + a.size / 2, streamX)");
const oldSortB = "wrappedTileDistanceX(b.minX + b.size / 2, view.x)";
if (!source.includes(oldSortB)) throw new Error("pole sort B target not found");
source = source.replaceAll(oldSortB, "wrappedTileDistanceX(b.minX + b.size / 2, streamX)");
writeFileSync(path, source);
