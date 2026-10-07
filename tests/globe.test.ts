import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGlobeSurface, globeSurfaceColor } from "../src/globe-surface.ts";
import { terrainTint } from "../src/geometry.ts";
import { continents } from "../src/geography.ts";
import { flatToLonLat, lonLatToFlat } from "../src/planet.ts";
import { heightAt } from "../src/world.ts";

// The texture contract, written out independently of the implementation.
const texelFlat = (i: number, j: number, width: number, height: number) =>
  lonLatToFlat(
    ((i + 0.5) / width) * 2 * Math.PI - Math.PI,
    Math.PI / 2 - ((j + 0.5) / height) * Math.PI,
  );
const texelOf = (x: number, z: number, width: number, height: number) => {
  const { lon, lat } = flatToLonLat(x, z);
  return [
    Math.floor(((lon + Math.PI) / (2 * Math.PI)) * width),
    Math.floor(((Math.PI / 2 - lat) / Math.PI) * height),
  ];
};
const pixel = (
  s: { width: number; pixels: Uint8Array },
  i: number,
  j: number,
) => [...s.pixels.subarray((j * s.width + i) * 4, (j * s.width + i) * 4 + 3)];
/** The flat terrain mesh stores its tint through this same conversion. */
const flatTint = (x: number, z: number) => [
  ...new Uint8Array(terrainTint(x, z)),
];
// Far from every continent and island belt.
const MID_OCEAN = { x: 40000, z: -50000 };
const OCEAN = flatTint(MID_OCEAN.x, MID_OCEAN.z);
// Shared by several tests to keep the file fast; every build is deterministic.
const WIDTH = 256,
  HEIGHT = 128,
  flat = buildGlobeSurface(WIDTH, HEIGHT, { samples: 1, relief: 0 }),
  shaded = buildGlobeSurface(WIDTH, HEIGHT, { samples: 1, relief: 1 });
const isOcean = (i: number, j: number) =>
  pixel(flat, i, j).join() === OCEAN.join();

test("globe surface honours the texture contract", () => {
  const surface = buildGlobeSurface(128, 64, { samples: 2 });
  assert.equal(surface.width, 128);
  assert.equal(surface.height, 64);
  assert.ok(surface.pixels instanceof Uint8Array);
  assert.equal(surface.pixels.length, 128 * 64 * 4);
  for (let i = 3; i < surface.pixels.length; i += 4)
    assert.equal(surface.pixels[i], 255);
  for (const [x, z] of [
    [0, 6500],
    [MID_OCEAN.x, MID_OCEAN.z],
    [-131072, -65536],
    [131071.5, 65536],
    [125, 14],
    [200000, 120000],
  ])
    for (const channel of globeSurfaceColor(x, z))
      assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
  for (const bad of [
    () => buildGlobeSurface(0, 0),
    () => buildGlobeSurface(128.5, 64),
    () => buildGlobeSurface(128, 64, { samples: 0 }),
    () => buildGlobeSurface(128, 64, { relief: NaN }),
    () => buildGlobeSurface(128, 64, { rows: [10, 65] }),
  ])
    assert.throws(bad, RangeError);
});
test("unshaded centre samples are exactly the flat terrain's own colours", () => {
  const width = WIDTH,
    height = HEIGHT,
    surface = flat;
  let land = 0,
    ocean = 0;
  for (let j = 0; j < height; j += 3)
    for (let i = j % 2; i < width; i += 5) {
      const { x, z } = texelFlat(i, j, width, height),
        expected = flatTint(x, z);
      assert.deepEqual(pixel(surface, i, j), expected);
      assert.deepEqual(globeSurfaceColor(x, z), expected);
      if (expected.join() === OCEAN.join()) ocean++;
      else land++;
    }
  // The spread crosses both the ocean shortcut and the detailed terrain path.
  assert.ok(land > 200 && ocean > 1000);
  // The shortcut's single ocean height is the shared height everywhere it applies.
  for (let j = 1; j < height; j += 9)
    for (let i = 0; i < width; i += 11) {
      const { x, z } = texelFlat(i, j, width, height);
      if (pixel(surface, i, j).join() === OCEAN.join() && heightAt(x, z) < 0)
        assert.equal(heightAt(x, z), heightAt(MID_OCEAN.x, MID_OCEAN.z));
    }
});
test("globe surface is deterministic and can be built in row pieces", () => {
  const options = { samples: 2, relief: 1 };
  const whole = buildGlobeSurface(128, 64, options);
  assert.deepEqual(buildGlobeSurface(128, 64, options).pixels, whole.pixels);
  const pieces = new Uint8Array(whole.pixels.length);
  // Reverse order, uneven pieces, one single row and one empty range.
  for (const rows of [
    [40, 64],
    [27, 40],
    [26, 27],
    [26, 26],
    [0, 26],
  ] as [number, number][]) {
    const part = buildGlobeSurface(128, 64, { ...options, rows }).pixels;
    part.forEach((value, index) => {
      const row = Math.floor(index / (128 * 4));
      if (row >= rows[0] && row < rows[1]) pieces[index] = value;
      else assert.equal(value, 0);
    });
  }
  assert.deepEqual(pieces, whole.pixels);
});
test("continents are land and the open ocean is ocean", () => {
  const smooth = buildGlobeSurface(128, 64, { samples: 2, relief: 1 });
  for (const surface of [flat, shaded, smooth]) {
    const { width, height } = surface;
    for (const continent of continents) {
      const [i, j] = texelOf(continent.x, continent.z, width, height),
        [r, g, b] = pixel(surface, i, j);
      assert.notDeepEqual([r, g, b], OCEAN);
      assert.ok(g > r && g > b, `${continent.name} is green land`);
      assert.notDeepEqual(globeSurfaceColor(continent.x, continent.z), OCEAN);
    }
    const [i, j] = texelOf(MID_OCEAN.x, MID_OCEAN.z, width, height);
    assert.deepEqual(pixel(surface, i, j), OCEAN);
    // East and west edges meet in open ocean, as do both poles.
    for (const [x, y] of [
      [0, height / 2],
      [width - 1, height / 2],
      [width / 2, 0],
      [width / 2, height - 1],
    ])
      assert.deepEqual(pixel(surface, x, y), OCEAN);
  }
  assert.deepEqual(globeSurfaceColor(MID_OCEAN.x, MID_OCEAN.z), OCEAN);
});
test("relief shades land from real heights and leaves water untouched", () => {
  const stronger = buildGlobeSurface(WIDTH, HEIGHT, { relief: 2 });
  let changed = 0,
    land = 0,
    brighter = 0,
    darker = 0,
    further = 0;
  for (let j = 0; j < HEIGHT; j++)
    for (let i = 0; i < WIDTH; i++) {
      const before = pixel(flat, i, j),
        after = pixel(shaded, i, j);
      if (isOcean(i, j)) {
        assert.deepEqual(after, OCEAN);
        assert.deepEqual(pixel(stronger, i, j), OCEAN);
        continue;
      }
      land++;
      if (after.join() !== before.join()) changed++;
      if (after[1] > before[1]) brighter++;
      if (after[1] < before[1]) darker++;
      if (
        Math.abs(pixel(stronger, i, j)[1] - before[1]) >
        Math.abs(after[1] - before[1])
      )
        further++;
    }
  assert.ok(land > 5000);
  assert.ok(changed > land / 2);
  // Slopes face both toward and away from the light.
  assert.ok(brighter > land / 10 && darker > land / 10);
  assert.ok(further > changed / 2);
});
test("light comes from the north-west", () => {
  // Every continent stands above the sea, so its north-west coast faces the
  // light and its south-east coast faces away.
  let lit = 0,
    shadowed = 0;
  for (let j = 1; j < HEIGHT - 1; j++)
    for (let i = 1; i < WIDTH - 1; i++) {
      if (isOcean(i, j)) continue;
      const change = pixel(shaded, i, j)[1] - pixel(flat, i, j)[1];
      // Sea to the north and west, land to the south and east: a north-west shore.
      if (
        isOcean(i - 1, j) &&
        isOcean(i, j - 1) &&
        !isOcean(i + 1, j) &&
        !isOcean(i, j + 1)
      )
        lit += Math.sign(change);
      if (
        isOcean(i + 1, j) &&
        isOcean(i, j + 1) &&
        !isOcean(i - 1, j) &&
        !isOcean(i, j - 1)
      )
        shadowed += Math.sign(change);
    }
  assert.ok(lit > 10, `north-west shores brighten (${lit})`);
  assert.ok(shadowed < -10, `south-east shores darken (${shadowed})`);
});
test("the globe worker answers with a transferred surface or an error", async () => {
  const sent: [Record<string, unknown>, { transfer?: unknown[] }?][] = [];
  const scope = globalThis as unknown as {
    self?: unknown;
  };
  const previous = scope.self;
  const worker: {
    onmessage?: (event: { data: unknown }) => void;
    postMessage: (message: Record<string, unknown>, options?: object) => void;
  } = { postMessage: (message, options) => sent.push([message, options]) };
  scope.self = worker;
  try {
    await import("../src/globe-worker.ts");
    worker.onmessage!({
      data: { id: 7, width: 64, height: 32, samples: 2, relief: 1 },
    });
    worker.onmessage!({ data: { id: 8, width: 64, height: -1 } });
  } finally {
    scope.self = previous;
  }
  const [message, options] = sent[0];
  assert.deepEqual(Object.keys(message), ["id", "width", "height", "pixels"]);
  assert.equal(message.id, 7);
  assert.deepEqual(
    message.pixels,
    buildGlobeSurface(64, 32, { samples: 2, relief: 1 }).pixels,
  );
  assert.deepEqual(options?.transfer, [(message.pixels as Uint8Array).buffer]);
  assert.deepEqual(Object.keys(sent[1][0]), ["id", "error"]);
  assert.equal(sent[1][0].id, 8);
  assert.match(String(sent[1][0].error), /RangeError/);
});
test("globe sources use no random-number API or clock", () => {
  for (const file of ["globe-surface.ts", "globe-worker.ts"]) {
    const source = readFileSync(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /Math\.random\s*\(|getRandomValues\s*\(|randomUUID\s*\(/,
    );
    assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(|performance\./);
  }
});
