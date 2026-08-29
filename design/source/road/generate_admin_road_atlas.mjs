#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from '../../../tools/split_tile_atlas.mjs';

const SIZE = 1024;
const CELL = 256;
const GRID = 4;
const CENTER = 128;
const HALF_WIDTH = 43;
const FEATHER = 4.5;
const seed = 0x2862026;

const here = path.dirname(fileURLToPath(import.meta.url));
const atlasPath = path.join(here, 'road_admin_generated_1024.png');
const manifestPath = path.join(here, 'road_admin_generated_1024.cells.json');

const tiles = [
  { row: 0, col: 0, type: 'straight_vertical', links: ['N', 'S'] },
  { row: 0, col: 1, type: 'straight_horizontal', links: ['E', 'W'] },
  { row: 0, col: 2, type: 'cross', links: ['N', 'E', 'S', 'W'] },
  { row: 0, col: 3, type: 'turn_ne', links: ['N', 'E'] },
  { row: 1, col: 0, type: 'turn_es', links: ['E', 'S'] },
  { row: 1, col: 1, type: 'turn_sw', links: ['S', 'W'] },
  { row: 1, col: 2, type: 'turn_wn', links: ['W', 'N'] },
  { row: 1, col: 3, type: 't_junction', links: ['E', 'S', 'W'] }
];

function hash(x, y, salt = 0) {
  let n = (Math.imul(x + 0x9e3779b9, 374761393) ^ Math.imul(y + seed, 668265263) ^ Math.imul(salt + 17, 2246822519)) >>> 0;
  n ^= n >>> 13;
  n = Math.imul(n, 1274126177) >>> 0;
  n ^= n >>> 16;
  return n / 0xffffffff;
}

function smoothNoise(x, y, salt = 0) {
  const gx = Math.floor(x / 12), gy = Math.floor(y / 12);
  const fx = (x / 12) - gx, fy = (y / 12) - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n00 = hash(gx, gy, salt), n10 = hash(gx + 1, gy, salt);
  const n01 = hash(gx, gy + 1, salt), n11 = hash(gx + 1, gy + 1, salt);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

function clamp(value, min = 0, max = 255) { return Math.max(min, Math.min(max, value)); }
function mix(a, b, t) { return a + (b - a) * t; }

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const vv = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return Math.hypot(dx, dy);
}

function linkEnd(link) {
  if (link === 'N') return [CENTER, -8];
  if (link === 'E') return [264, CENTER];
  if (link === 'S') return [CENTER, 264];
  return [-8, CENTER];
}

function roadDistance(x, y, links) {
  let d = Infinity;
  for (const link of links) {
    const [ex, ey] = linkEnd(link);
    d = Math.min(d, segmentDistance(x, y, CENTER, CENTER, ex, ey));
  }
  d = Math.min(d, Math.hypot(x - CENTER, y - CENTER) * 0.84);
  return d;
}

function directionalRut(x, y, links) {
  let amount = 0;
  const vertical = links.includes('N') || links.includes('S');
  const horizontal = links.includes('E') || links.includes('W');
  if (vertical && Math.abs(y - CENTER) > 22) {
    const r = Math.min(Math.abs((x - CENTER) - 18), Math.abs((x - CENTER) + 18));
    amount = Math.max(amount, Math.max(0, 1 - r / 3.5));
  }
  if (horizontal && Math.abs(x - CENTER) > 22) {
    const r = Math.min(Math.abs((y - CENTER) - 18), Math.abs((y - CENTER) + 18));
    amount = Math.max(amount, Math.max(0, 1 - r / 3.5));
  }
  return amount;
}

function paintCell(atlas, tile) {
  const ox = tile.col * CELL, oy = tile.row * CELL;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const broad = smoothNoise(x + ox, y + oy, 3) - 0.5;
      const fine = hash(x + ox, y + oy, 7) - 0.5;
      const edgeWave = broad * 8 + (smoothNoise(x + ox + 71, y + oy - 29, 11) - 0.5) * 4;
      const d = roadDistance(x, y, tile.links);
      const localHalf = HALF_WIDTH + edgeWave;
      const alpha = clamp(Math.round((1 - Math.max(0, Math.min(1, (d - (localHalf - FEATHER)) / FEATHER))) * 255));
      if (alpha <= 0) continue;

      const edgeT = Math.max(0, Math.min(1, d / Math.max(1, localHalf)));
      const centerWear = 1 - edgeT;
      const rut = directionalRut(x, y, tile.links);
      const pebble = hash(x + ox, y + oy, 19) > 0.985 ? 1 : 0;
      const base = [174, 126, 79];
      const edge = [104, 73, 45];
      const light = [194, 148, 94];
      let r = mix(light[0], base[0], edgeT * 0.62);
      let g = mix(light[1], base[1], edgeT * 0.62);
      let b = mix(light[2], base[2], edgeT * 0.62);
      const edgeMix = Math.max(0, (edgeT - 0.72) / 0.28);
      r = mix(r, edge[0], edgeMix); g = mix(g, edge[1], edgeMix); b = mix(b, edge[2], edgeMix);
      const texture = broad * 19 + fine * 13 + Math.sin((x + y) * 0.18) * 2;
      r += texture + centerWear * 5 - rut * 18;
      g += texture * 0.78 + centerWear * 4 - rut * 14;
      b += texture * 0.48 + centerWear * 2 - rut * 9;
      if (pebble) { r -= 22; g -= 19; b -= 14; }

      const index = ((oy + y) * SIZE + (ox + x)) * 4;
      atlas[index] = clamp(Math.round(r));
      atlas[index + 1] = clamp(Math.round(g));
      atlas[index + 2] = clamp(Math.round(b));
      atlas[index + 3] = alpha;
    }
  }
}

const rgba = Buffer.alloc(SIZE * SIZE * 4, 0);
for (const tile of tiles) paintCell(rgba, tile);

const atlas = encodeRgbaPng(SIZE, SIZE, rgba);
fs.writeFileSync(atlasPath, atlas);
fs.writeFileSync(manifestPath, JSON.stringify({
  schemaVersion: 1,
  family: 'road',
  atlas: { width: SIZE, height: SIZE, columns: GRID, rows: GRID, cellSize: CELL },
  source: 'Admin-priority terrain-neutral dirt-road production redraw for #286/#296.',
  cells: tiles.map(({ row, col, type }) => ({ row, col, type })),
  unusedCells: [
    { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 2, col: 3 },
    { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 }
  ]
}, null, 2) + '\n');

console.log(`Generated ${atlasPath} (${atlas.length} bytes) and ${manifestPath}.`);
