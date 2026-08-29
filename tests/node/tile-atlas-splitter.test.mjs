import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeRgbaPng, encodeRgbaPng, exportAtlas, planAtlasExport } from '../../tools/split_tile_atlas.mjs';

const SIZE = 1024;
const CELL = 256;

function makeAtlas(cells) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (const { row, col, value = 80 } of cells) {
    for (let y = row * CELL + 12; y < (row + 1) * CELL - 12; y += 1) {
      for (let x = col * CELL + 12; x < (col + 1) * CELL - 12; x += 1) {
        const offset = (y * SIZE + x) * 4;
        rgba[offset] = value;
        rgba[offset + 1] = value + 10;
        rgba[offset + 2] = value + 20;
        rgba[offset + 3] = 255;
      }
    }
  }
  return encodeRgbaPng(SIZE, SIZE, rgba);
}

function eightRoadManifest() {
  return {
    family: 'road',
    cells: [
      { row: 0, col: 0, type: 'straight_vertical' },
      { row: 0, col: 1, type: 'straight_horizontal' },
      { row: 0, col: 2, type: 'cross' },
      { row: 0, col: 3, type: 'turn_ne' },
      { row: 1, col: 0, type: 'turn_es' },
      { row: 1, col: 1, type: 'turn_sw' },
      { row: 1, col: 2, type: 'turn_wn' },
      { row: 1, col: 3, type: 't_junction' },
    ],
  };
}

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('canonical road atlas exports exactly eight deterministic 256px semantic PNGs', () => {
  const cells = eightRoadManifest().cells.map(({ row, col }, index) => ({ row, col, value: 30 + index * 10 }));
  const atlas = makeAtlas(cells);
  const planned = planAtlasExport(atlas, eightRoadManifest());
  assert.equal(planned.outputs.length, 8);
  assert.deepEqual(planned.outputs.map((entry) => entry.filename), [
    'road_straight_vertical_256px.png',
    'road_straight_horizontal_256px.png',
    'road_cross_256px.png',
    'road_turn_ne_256px.png',
    'road_turn_es_256px.png',
    'road_turn_sw_256px.png',
    'road_turn_wn_256px.png',
    'road_t_junction_256px.png',
  ]);
  for (const output of planned.outputs) {
    const decoded = decodeRgbaPng(output.png);
    assert.equal(decoded.width, 256);
    assert.equal(decoded.height, 256);
  }
});

test('export is idempotent and removes stale family outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-atlas-'));
  const atlasPath = path.join(root, 'road.png');
  const manifestPath = path.join(root, 'road.json');
  const outputDir = path.join(root, 'textures', 'tiles', 'road');
  fs.writeFileSync(atlasPath, makeAtlas(eightRoadManifest().cells.map(({ row, col }, index) => ({ row, col, value: 40 + index }))));
  fs.writeFileSync(manifestPath, JSON.stringify(eightRoadManifest()));

  const first = exportAtlas({ atlasPath, manifestPath, outputDir });
  const firstHashes = Object.fromEntries(first.outputs.map((entry) => [entry.filename, sha(fs.readFileSync(path.join(outputDir, entry.filename)))]));
  fs.writeFileSync(path.join(outputDir, 'road_obsolete_256px.png'), Buffer.from('stale'));
  fs.writeFileSync(path.join(outputDir, 'keep-me.txt'), 'unrelated');
  const second = exportAtlas({ atlasPath, manifestPath, outputDir });
  const secondHashes = Object.fromEntries(second.outputs.map((entry) => [entry.filename, sha(fs.readFileSync(path.join(outputDir, entry.filename)))]));

  assert.deepEqual(secondHashes, firstHashes);
  assert.equal(fs.existsSync(path.join(outputDir, 'road_obsolete_256px.png')), false);
  assert.equal(fs.readFileSync(path.join(outputDir, 'keep-me.txt'), 'utf8'), 'unrelated');
  assert.equal(second.exportManifest.tiles.length, 8);
});

test('rejects wrong dimensions before writing outputs', () => {
  const wrong = encodeRgbaPng(256, 256, Buffer.alloc(256 * 256 * 4));
  assert.throws(() => planAtlasExport(wrong, eightRoadManifest()), /exactly 1024x1024/);
});

test('rejects visible pixels in an undeclared unused cell', () => {
  const atlas = makeAtlas([{ row: 3, col: 3, value: 100 }, ...eightRoadManifest().cells.map(({ row, col }) => ({ row, col }))]);
  assert.throws(() => planAtlasExport(atlas, eightRoadManifest()), /Unused cell 3,3 contains visible pixels/);
});

test('rejects a declared semantic cell that is fully transparent', () => {
  const visible = eightRoadManifest().cells.slice(0, 7).map(({ row, col }) => ({ row, col }));
  const atlas = makeAtlas(visible);
  assert.throws(() => planAtlasExport(atlas, eightRoadManifest()), /is fully transparent/);
});

test('rejects duplicate semantic ids and duplicate coordinates', () => {
  const manifest = eightRoadManifest();
  manifest.cells[1] = { row: 0, col: 0, type: manifest.cells[0].type };
  assert.throws(() => planAtlasExport(makeAtlas([{ row: 0, col: 0 }]), manifest), /Duplicate manifest/);
});
