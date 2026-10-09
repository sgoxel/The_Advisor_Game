import { test } from "node:test";
import assert from "node:assert/strict";
import { cities, villages } from "../src/geography.ts";
import type { Place } from "../src/geography.ts";
import { heightAt } from "../src/world.ts";
import {
  buildingAt,
  computeSettlementLayout,
  settlementLayout,
  streetDistanceAt,
  type Building,
  type Point,
  type SettlementLayout,
} from "../src/settlement-layout.ts";

// Independent geometry for the checks (deliberately not shared with the module).

function footprint(b: Building): Point[] {
  const vx = Math.sin(b.angle),
    vz = Math.cos(b.angle),
    ux = Math.cos(b.angle),
    uz = -Math.sin(b.angle),
    hw = b.width / 2,
    hd = b.depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([a, c]) => ({ x: b.x + ux * a + vx * c, z: b.z + uz * a + vz * c }));
}

function project(poly: Point[], nx: number, nz: number): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of poly) {
    const d = p.x * nx + p.z * nz;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** Convex SAT: true when the polygons share interior area (touching is not overlap). */
function overlaps(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        nx = -(q.z - p.z),
        nz = q.x - p.x;
      const [aLo, aHi] = project(a, nx, nz),
        [bLo, bHi] = project(b, nx, nz);
      if (aHi <= bLo + 1e-9 || bHi <= aLo + 1e-9) return false;
    }
  return true;
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distPointSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz,
    t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** Polygon-to-segment distance: 0 when the segment touches or enters the polygon. */
function polySegDistance(poly: Point[], a: Point, b: Point): number {
  if (insidePolygon(a, poly) || insidePolygon(b, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    if (orient(p, q, a) * orient(p, q, b) <= 0 && orient(a, b, p) * orient(a, b, q) <= 0) return 0;
    best = Math.min(best, distPointSeg(p, a, b), distPointSeg(a, p, q), distPointSeg(b, p, q));
  }
  return best;
}

function checkLayout(place: Place, layout: SettlementLayout): void {
  const city = place.kind === "city";
  const { buildings, streets, border, gates, residents } = layout;
  const polys = buildings.map(footprint);

  // Footprints: disjoint, dry, clear of streets, inside the border.
  for (let i = 0; i < buildings.length; i++) {
    for (const c of polys[i]) {
      assert.ok(heightAt(c.x, c.z) > 0.3, `${place.id}: ${buildings[i].code} corner in water`);
      assert.ok(insidePolygon(c, border.points), `${place.id}: ${buildings[i].code} corner outside border`);
    }
    assert.ok(heightAt(buildings[i].x, buildings[i].z) > 0.3, `${place.id}: ${buildings[i].code} centre in water`);
    for (let j = i + 1; j < buildings.length; j++)
      assert.ok(!overlaps(polys[i], polys[j]), `${place.id}: ${buildings[i].code} overlaps ${buildings[j].code}`);
    for (const street of streets)
      for (let s = 0; s + 1 < street.points.length; s++) {
        const d = polySegDistance(polys[i], street.points[s], street.points[s + 1]);
        assert.ok(
          d >= street.width / 2,
          `${place.id}: ${buildings[i].code} is ${d.toFixed(2)} from ${street.code}`,
        );
      }
    // Room minimums and the 1.3 walls/circulation rule.
    const roomArea = buildings[i].rooms.reduce((sum, r) => sum + r.areaM2, 0);
    assert.ok(
      buildings[i].width * buildings[i].depth >= roomArea * 1.3 - 1e-9,
      `${place.id}: ${buildings[i].code} footprint smaller than 1.3 x rooms`,
    );
    if (buildings[i].role === "barn") assert.ok(roomArea >= 6, `${place.id}: barn below 6 m2`);
    if (buildings[i].role === "home") {
      const names = buildings[i].rooms.map((r) => r.name);
      for (const required of ["bedroom", "latrine", "living room"])
        assert.ok(names.includes(required), `${place.id}: ${buildings[i].code} lacks ${required}`);
    }
  }

  // Required roles present.
  const roles = new Set(buildings.map((b) => b.role));
  for (const role of ["inn", "market", "blacksmith", "farmstead", "barn", "butcher", "guard-office"] as const)
    assert.ok(roles.has(role), `${place.id}: no ${role}`);
  if (city) assert.ok(roles.has("keep"), `${place.id}: no keep`);

  // Gates and guard posts.
  assert.ok(gates.length >= 1 && gates.length <= 2, `${place.id}: ${gates.length} gates`);
  for (const gate of gates) {
    assert.ok(gate.guardPosts.length >= 1 && gate.guardPosts.length <= 2, `${place.id}: ${gate.code} posts`);
    for (const post of gate.guardPosts)
      assert.ok(insidePolygon({ x: post.x, z: post.z }, border.points), `${place.id}: ${post.code} outside border`);
  }

  // Residents: professions match services, homes have room.
  const byCode = new Map(buildings.map((b) => [b.code, b]));
  const load = new Map<string, number>();
  let lords = 0;
  for (const r of residents) {
    const home = byCode.get(r.home);
    assert.ok(home, `${place.id}: ${r.code} home missing`);
    load.set(r.home, (load.get(r.home) ?? 0) + 1);
    if (r.work) {
      const work = byCode.get(r.work);
      assert.ok(work, `${place.id}: ${r.code} work missing`);
      const expected = {
        innkeeper: "inn",
        merchant: "market",
        blacksmith: "blacksmith",
        butcher: "butcher",
        farmer: "farmstead",
        guard: "guard-office",
        lord: "keep",
      } as Record<string, string>;
      assert.equal(work.role, expected[r.profession], `${place.id}: ${r.code} profession/work mismatch`);
    }
    if (r.profession === "lord") lords++;
  }
  for (const [code, count] of load) assert.ok(count <= byCode.get(code)!.capacity, `${place.id}: ${code} overfull`);
  const homeCapacity = buildings.filter((b) => b.role === "home").reduce((sum, b) => sum + b.capacity, 0);
  assert.ok(homeCapacity >= residents.length - lords, `${place.id}: homes too small for residents`);
  // Population is planned with the homes: every required worker (one per service building, one
  // guard per guard post) plus at least one non-worker household, never more residents than beds.
  const serviceCount = buildings.filter((b) =>
    ["inn", "market", "blacksmith", "butcher", "farmstead", "keep"].includes(b.role),
  ).length;
  const postCount = gates.reduce((sum, g) => sum + g.guardPosts.length, 0);
  const requiredWorkers = serviceCount + postCount;
  assert.equal(residents.filter((r) => r.work).length, requiredWorkers, `${place.id}: worker count`);
  assert.ok(
    residents.length >= requiredWorkers + 1,
    `${place.id}: ${residents.length} residents < ${requiredWorkers} workers + 1`,
  );
  assert.ok(
    homeCapacity >= residents.length - lords,
    `${place.id}: home capacity ${homeCapacity} < ${residents.length} residents`,
  );
  assert.ok(
    residents.length <= (city ? 520 : 40),
    `${place.id}: ${residents.length} residents exceed the seeded range`,
  );
  for (const b of buildings) {
    if (!["inn", "market", "blacksmith", "butcher", "farmstead", "guard-office", "keep"].includes(b.role)) continue;
    assert.ok(
      residents.some((r) => r.work === b.code),
      `${place.id}: ${b.code} (${b.role}) has no worker`,
    );
  }

  // Codes are unique.
  for (const list of [
    buildings.map((b) => b.code),
    streets.map((s) => s.code),
    gates.map((g) => g.code),
    gates.flatMap((g) => g.guardPosts.map((p) => p.code)),
    layout.fields.map((f) => f.code),
    residents.map((r) => r.code),
  ])
    assert.equal(new Set(list).size, list.length, `${place.id}: duplicate codes`);
}

const layoutCache = new Map<string, SettlementLayout>();
const layoutOf = (place: Place) => {
  let layout = layoutCache.get(place.id);
  if (!layout) {
    layout = settlementLayout(place);
    layoutCache.set(place.id, layout);
  }
  return layout;
};

test("every village layout is valid", () => {
  for (const village of villages) checkLayout(village, layoutOf(village));
});

test("city layouts are valid", () => {
  for (const city of cities) checkLayout(city, layoutOf(city));
});

test("village layouts use many non-repeating angles and off-lattice positions", () => {
  const busiest = villages.reduce((best, v) =>
    layoutOf(v).buildings.length > layoutOf(best).buildings.length ? v : best,
  );
  const buildings = layoutOf(busiest).buildings;
  const angles = new Set(buildings.map((b) => b.angle.toFixed(2)));
  assert.ok(angles.size > buildings.length * 0.5, `angles repeat: ${angles.size}/${buildings.length}`);
  // A fixed 29 unit lattice would collapse every x mod 29 onto a few buckets.
  const offsets = new Set(buildings.map((b) => Math.round((((b.x % 29) + 29) % 29))));
  assert.ok(
    offsets.size >= Math.min(buildings.length, 29) * 0.5,
    `positions cluster on a lattice: ${offsets.size} distinct x mod 29 buckets for ${buildings.length} buildings`,
  );
});

test("settlements diverge in archetype and street shape", () => {
  const archetypes = new Set(villages.map((v) => layoutOf(v).archetype));
  assert.ok(archetypes.size >= 3, `only ${[...archetypes].join(", ")}`);
  const signature = (l: SettlementLayout) => `${l.streets.length}|${JSON.stringify(l.streets.map((s) => s.points))}`;
  const alderwick = signature(layoutOf(villages[0]));
  assert.notEqual(alderwick, signature(layoutOf(villages[1])));
  assert.notEqual(alderwick, signature(layoutOf(villages[2])));
});

test("layouts are deterministic and memoised", () => {
  for (const place of [villages[0], villages[137], cities[0]]) {
    assert.deepEqual(computeSettlementLayout(place), computeSettlementLayout(place));
    assert.deepEqual(computeSettlementLayout(place), settlementLayout(place));
    assert.equal(settlementLayout(place), settlementLayout(place));
  }
});

test("street distance and building lookup", () => {
  const village = villages[0],
    layout = layoutOf(village),
    street = layout.streets[0],
    mid = street.points[Math.floor(street.points.length / 2)];
  assert.ok(streetDistanceAt(mid.x, mid.z) < 1e-6, "street point is not on the street");
  assert.equal(streetDistanceAt(village.x + 5000, village.z + 5000), Infinity);
  const building = layout.buildings[0];
  assert.equal(buildingAt(building.x, building.z)?.code, building.code);
  assert.equal(buildingAt(village.x + 5000, village.z + 5000), undefined);
});
