#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { exportAtlas } from './split_tile_atlas.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'design/source/buildings');
const OUTPUT_ROOT = path.join(ROOT, 'textures/tiles/building');
const FAMILIES = Object.freeze([
  'home', 'inn', 'village_hall', 'bakery', 'market', 'smithy',
  'workshop', 'guard_post', 'mill', 'farmstead', 'storage', 'well',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exportFamily(family) {
  const atlasPath = path.join(SOURCE_DIR, `${family}_starter_1024.png`);
  const manifestPath = path.join(SOURCE_DIR, `${family}_starter_1024.cells.json`);
  const outputDir = path.join(OUTPUT_ROOT, family);
  assert(fs.existsSync(atlasPath), `Missing verified atlas: ${atlasPath}`);
  assert(fs.existsSync(manifestPath), `Missing verified semantic map: ${manifestPath}`);
  const result = exportAtlas({ atlasPath, manifestPath, outputDir });
  assert(result.family === family, `Manifest family mismatch for ${family}: ${result.family}`);
  assert(result.outputs.length === 12, `${family} must export exactly 12 occupied semantic cells.`);
  return result;
}

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
const expectedDirectories = new Set(FAMILIES);
for (const entry of fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true })) {
  if (entry.isDirectory() && !expectedDirectories.has(entry.name)) {
    fs.rmSync(path.join(OUTPUT_ROOT, entry.name), { recursive: true, force: true });
  }
}

const results = FAMILIES.map(exportFamily);
const index = {
  version: 1,
  tileSize: 256,
  source: 'design/source/buildings',
  families: results.map((result) => ({
    family: result.family,
    manifest: `${result.family}/${result.manifestName}`,
    tiles: result.outputs.map(({ type, filename, sha256 }) => ({ type, filename: `${result.family}/${filename}`, sha256 })),
  })),
};
fs.writeFileSync(path.join(OUTPUT_ROOT, 'starter_village_building_tiles.index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Exported ${results.length} starter-village building families (${results.reduce((sum, result) => sum + result.outputs.length, 0)} tiles).`);
