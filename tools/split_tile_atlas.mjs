#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CANONICAL_SIZE = 1024;
const GRID_SIZE = 4;
const CELL_SIZE = 256;
const BYTES_PER_PIXEL = 4;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

export function encodeRgbaPng(width, height, rgba) {
  assert(Number.isInteger(width) && width > 0, 'PNG width must be a positive integer.');
  assert(Number.isInteger(height) && height > 0, 'PNG height must be a positive integer.');
  assert(Buffer.isBuffer(rgba), 'RGBA source must be a Buffer.');
  assert(rgba.length === width * height * BYTES_PER_PIXEL, 'RGBA byte length does not match dimensions.');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (rowBytes + 1);
    raw[rawOffset] = 0;
    rgba.copy(raw, rawOffset + 1, row * rowBytes, (row + 1) * rowBytes);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodeRgbaPng(buffer) {
  assert(Buffer.isBuffer(buffer), 'PNG input must be a Buffer.');
  assert(buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE), 'Invalid PNG signature.');

  let offset = 8;
  let width = null;
  let height = null;
  const idatParts = [];

  while (offset < buffer.length) {
    assert(offset + 12 <= buffer.length, 'Truncated PNG chunk.');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    assert(crcEnd <= buffer.length, `Truncated PNG ${type} chunk.`);
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      assert(length === 13, 'Invalid PNG IHDR length.');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert(data[8] === 8, 'Canonical atlas PNG must use 8-bit channels.');
      assert(data[9] === 6, 'Canonical atlas PNG must be RGBA (color type 6).');
      assert(data[10] === 0 && data[11] === 0, 'Unsupported PNG compression/filter method.');
      assert(data[12] === 0, 'Interlaced PNG atlases are not supported by the canonical splitter.');
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = crcEnd;
  }

  assert(width !== null && height !== null, 'PNG is missing IHDR.');
  assert(idatParts.length > 0, 'PNG is missing IDAT data.');

  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const rowBytes = width * BYTES_PER_PIXEL;
  assert(inflated.length === (rowBytes + 1) * height, 'Unexpected PNG scanline byte length.');

  const rgba = Buffer.alloc(width * height * BYTES_PER_PIXEL);
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowBytes + 1);
    const filter = inflated[sourceOffset];
    const source = inflated.subarray(sourceOffset + 1, sourceOffset + 1 + rowBytes);

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = source[x];
      const left = x >= BYTES_PER_PIXEL ? current[x - BYTES_PER_PIXEL] : 0;
      const up = previous[x];
      const upLeft = x >= BYTES_PER_PIXEL ? previous[x - BYTES_PER_PIXEL] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = (raw + left) & 0xff;
      else if (filter === 2) value = (raw + up) & 0xff;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter type ${filter}.`);
      current[x] = value;
    }

    current.copy(rgba, row * rowBytes);
    current.copy(previous);
  }

  return { width, height, rgba };
}

function normalizeToken(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label} must be a non-empty string.`);
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  assert(normalized, `${label} has no usable semantic characters.`);
  return normalized;
}

export function validateManifest(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Manifest must be a JSON object.');
  const family = normalizeToken(manifest.family, 'Manifest family');
  assert(Array.isArray(manifest.cells) && manifest.cells.length > 0, 'Manifest cells must be a non-empty array.');
  assert(manifest.cells.length <= GRID_SIZE * GRID_SIZE, 'Manifest cannot define more than 16 cells.');

  const coordinates = new Set();
  const semanticIds = new Set();
  const cells = manifest.cells.map((cell, index) => {
    assert(cell && typeof cell === 'object', `Manifest cell ${index} must be an object.`);
    assert(Number.isInteger(cell.row) && cell.row >= 0 && cell.row < GRID_SIZE, `Manifest cell ${index} row must be 0..3.`);
    assert(Number.isInteger(cell.col) && cell.col >= 0 && cell.col < GRID_SIZE, `Manifest cell ${index} col must be 0..3.`);
    const type = normalizeToken(cell.type, `Manifest cell ${index} type`);
    const coordinateKey = `${cell.row},${cell.col}`;
    assert(!coordinates.has(coordinateKey), `Duplicate manifest coordinate ${coordinateKey}.`);
    assert(!semanticIds.has(type), `Duplicate manifest semantic type ${type}.`);
    coordinates.add(coordinateKey);
    semanticIds.add(type);
    return { row: cell.row, col: cell.col, type };
  });

  cells.sort((a, b) => (a.row - b.row) || (a.col - b.col) || a.type.localeCompare(b.type));
  return { family, cells };
}

function cropCell(rgba, atlasWidth, row, col) {
  const cell = Buffer.alloc(CELL_SIZE * CELL_SIZE * BYTES_PER_PIXEL);
  const atlasRowBytes = atlasWidth * BYTES_PER_PIXEL;
  const cellRowBytes = CELL_SIZE * BYTES_PER_PIXEL;
  for (let y = 0; y < CELL_SIZE; y += 1) {
    const sourceStart = ((row * CELL_SIZE + y) * atlasRowBytes) + (col * cellRowBytes);
    rgba.copy(cell, y * cellRowBytes, sourceStart, sourceStart + cellRowBytes);
  }
  return cell;
}

function hasVisiblePixel(rgba) {
  for (let index = 3; index < rgba.length; index += BYTES_PER_PIXEL) {
    if (rgba[index] !== 0) return true;
  }
  return false;
}

function fileSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function planAtlasExport(atlasBuffer, rawManifest) {
  const decoded = decodeRgbaPng(atlasBuffer);
  assert(decoded.width === CANONICAL_SIZE && decoded.height === CANONICAL_SIZE,
    `Canonical atlas must be exactly ${CANONICAL_SIZE}x${CANONICAL_SIZE}; received ${decoded.width}x${decoded.height}.`);
  const manifest = validateManifest(rawManifest);
  const declared = new Map(manifest.cells.map((cell) => [`${cell.row},${cell.col}`, cell]));
  const outputs = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const key = `${row},${col}`;
      const cellRgba = cropCell(decoded.rgba, decoded.width, row, col);
      const visible = hasVisiblePixel(cellRgba);
      const descriptor = declared.get(key);
      if (descriptor) {
        assert(visible, `Manifest cell ${key} (${descriptor.type}) is fully transparent.`);
        const filename = `${manifest.family}_${descriptor.type}_${CELL_SIZE}px.png`;
        const png = encodeRgbaPng(CELL_SIZE, CELL_SIZE, cellRgba);
        outputs.push({ ...descriptor, filename, png, sha256: fileSha256(png) });
      } else {
        assert(!visible, `Unused cell ${key} contains visible pixels but is not declared in the manifest.`);
      }
    }
  }

  assert(outputs.length === manifest.cells.length, 'Export plan did not include every declared cell.');
  return { family: manifest.family, outputs };
}

export function exportAtlas({ atlasPath, manifestPath, outputDir }) {
  const atlasBuffer = fs.readFileSync(atlasPath);
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const plan = planAtlasExport(atlasBuffer, rawManifest);

  fs.mkdirSync(outputDir, { recursive: true });
  const expected = new Set(plan.outputs.map((output) => output.filename));
  const familyPrefix = `${plan.family}_`;
  for (const name of fs.readdirSync(outputDir)) {
    if (name.startsWith(familyPrefix) && name.endsWith(`_${CELL_SIZE}px.png`) && !expected.has(name)) {
      fs.rmSync(path.join(outputDir, name), { force: true });
    }
  }

  for (const output of plan.outputs) {
    const target = path.join(outputDir, output.filename);
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, output.png);
    fs.renameSync(temp, target);
  }

  const exportManifest = {
    version: 1,
    family: plan.family,
    atlas: { width: CANONICAL_SIZE, height: CANONICAL_SIZE, columns: GRID_SIZE, rows: GRID_SIZE, cellSize: CELL_SIZE },
    tiles: plan.outputs.map(({ row, col, type, filename, sha256 }) => ({ row, col, type, filename, sha256 })),
  };
  const manifestName = `${plan.family}_tiles.manifest.json`;
  fs.writeFileSync(path.join(outputDir, manifestName), `${JSON.stringify(exportManifest, null, 2)}\n`);
  return { ...plan, manifestName, exportManifest };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  assert(args.atlas && args.manifest && args.output, 'Usage: node tools/split_tile_atlas.mjs --atlas <png> --manifest <json> --output <directory>');
  return { atlasPath: args.atlas, manifestPath: args.manifest, outputDir: args.output };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = exportAtlas(options);
    console.log(`Exported ${result.outputs.length} ${result.family} tile(s) to ${path.resolve(options.outputDir)}.`);
  } catch (error) {
    console.error(`Tile atlas export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
