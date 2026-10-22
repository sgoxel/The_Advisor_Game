import test from "node:test";
import assert from "node:assert/strict";
import { cities, villages, type Place } from "../src/geography.ts";
import { wrapSourceX } from "../src/planet.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";

const reported = cities.reduce((a, b) => {
  const distance = (p: Place) => Math.hypot(p.canonicalPosition.lon - 12.99310 * Math.PI / 180, p.canonicalPosition.lat - 11.50972 * Math.PI / 180);
  return distance(a) < distance(b) ? a : b;
});

function buildings(place: Place, level: number, radius: number) {
  const size = 262144 / 2 ** level, tiles = new Map<string, ReturnType<typeof tileForPosition>>();
  for (let z = place.z - radius; z <= place.z + radius + size; z += size)
    for (let x = place.x - radius; x <= place.x + radius + size; x += size) {
      const tile = tileForPosition(x, z, level);
      tiles.set(tile.key, tile);
    }
  return [...tiles.values()].flatMap(featuresFor).filter(f =>
    f.code.includes(`/F/${place.id}/`) && ["residence", "service", "keep"].includes(f.kind));
}

// Independent separating-axis check of the rendered roof rectangles, including
// yaw and overhang; canonical home-centre spacing alone cannot prove this.
function roofIntersects(a: ReturnType<typeof buildings>[number], b: typeof a) {
  const axes = (f: typeof a) => [[Math.cos(f.yawRad || 0), -Math.sin(f.yawRad || 0)], [Math.sin(f.yawRad || 0), Math.cos(f.yawRad || 0)]];
  const aa = axes(a), bb = axes(b), dx = wrapSourceX(b.x - a.x), dz = b.z - a.z;
  const halves = (f: typeof a) => {
    const overhang = f.kind === "residence" ? (f.urban ? .42 : .28) : 0;
    const scale = f.kind === "service" ? 1.06 : 1;
    return [((f.footprintWidth || 15) * scale + overhang) / 2, ((f.footprintDepth || 14) * scale + overhang) / 2];
  };
  const ah = halves(a), bh = halves(b);
  return [...aa, ...bb].every(([x, z]) => {
    const support = (basis: number[][], half: number[]) => half.reduce((sum, h, i) => sum + h * Math.abs(basis[i][0] * x + basis[i][1] * z), 0);
    return Math.abs(dx * x + dz * z) < support(aa, ah) + support(bb, bh) - 1e-6;
  });
}

test("rendered city and village roofs do not intersect across neighbouring tiles", () => {
  for (const place of [reported, cities[0], villages[0]]) {
    const visible = buildings(place, 9, place.kind === "city" ? 360 : 90);
    assert.ok(visible.filter(f => f.kind === "residence").length >= (place.kind === "city" ? 8 : 2), `${place.name}: missing neighbourhood`);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      assert.notEqual(visible[i].code, visible[j].code, "tile ownership duplicated a building");
      assert.ok(!roofIntersects(visible[i], visible[j]), `${place.name}: ${visible[i].code} intersects ${visible[j].code}`);
    }
  }
});

test("shared city homes keep their locations when zoom changes", () => {
  const coarse = buildings(reported, 9, 90), fine = buildings(reported, 12, 45), byCode = new Map(coarse.map(f => [f.code, f]));
  let shared = 0;
  for (const feature of fine) {
    const previous = byCode.get(feature.code);
    if (!previous || feature.kind !== "residence") continue;
    shared++;
    assert.deepEqual([feature.x, feature.z, feature.yawRad, feature.footprintWidth, feature.footprintDepth],
      [previous.x, previous.z, previous.yawRad, previous.footprintWidth, previous.footprintDepth]);
  }
  assert.ok(shared > 0, "fixture must include shared homes across LODs");
});
