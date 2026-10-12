import test from "node:test";
import { buildGlobeSurface } from "../src/globe-surface.ts";
import { lonLatToFlat } from "../src/planet.ts";
import { heightAt } from "../src/world.ts";

const WIDTH = 256,
  HEIGHT = 128;
const texelFlat = (i: number, j: number) =>
  lonLatToFlat(
    ((i + 0.5) / WIDTH) * 2 * Math.PI - Math.PI,
    Math.PI / 2 - ((j + 0.5) / HEIGHT) * Math.PI,
  );
const pixel = (surface: { width: number; pixels: Uint8Array }, i: number, j: number) =>
  surface.pixels.subarray((j * surface.width + i) * 4, (j * surface.width + i) * 4 + 3);

test("diagnose final-surface globe relief coverage", () => {
  const flat = buildGlobeSurface(WIDTH, HEIGHT, { samples: 1, relief: 0 }),
    shaded = buildGlobeSurface(WIDTH, HEIGHT, { samples: 1, relief: 1 }),
    stronger = buildGlobeSurface(WIDTH, HEIGHT, { samples: 1, relief: 2 });
  let land = 0,
    changed = 0,
    brighter = 0,
    darker = 0,
    further = 0,
    lowLand = 0;
  for (let j = 0; j < HEIGHT; j++)
    for (let i = 0; i < WIDTH; i++) {
      const point = texelFlat(i, j),
        elevation = heightAt(point.x, point.z);
      if (elevation <= 0.1) continue;
      land++;
      if (elevation < 6) lowLand++;
      const before = pixel(flat, i, j),
        after = pixel(shaded, i, j),
        strong = pixel(stronger, i, j);
      if (after[0] !== before[0] || after[1] !== before[1] || after[2] !== before[2]) changed++;
      if (after[1] > before[1]) brighter++;
      if (after[1] < before[1]) darker++;
      if (Math.abs(strong[1] - before[1]) > Math.abs(after[1] - before[1])) further++;
    }
  console.log("WP-S003-001-001 globe relief diagnostic", {
    land,
    changed,
    changedRatio: changed / land,
    brighter,
    darker,
    further,
    lowLand,
  });
});
