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
        const reach = Math.hypot(buildings[i].width, buildings[i].depth) / 2 + street.width;
        if (distPointSeg({ x: buildings[i].x, z: buildings[i].z }, street.points[s], street.points[s + 1]) > reach) continue;
        const d = polySegDistance(polys[i], street.points[s], street.points[s + 1]);
        assert.ok(d >= street.width / 2, `${place.id}: ${buildings[i].code} is ${d.toFixed(2)} from ${street.code}`);
      }
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
      assert.equal(buildings[i].capacity, 1, `${place.id}: ${buildings[i].code} exposes shared home ownership capacity`);
    }
  }

  const roles = new Set(buildings.map((b) => b.role));
  for (const role of ["inn", "market", "blacksmith", "farmstead", "barn", "butcher", "guard-office"] as const)
    assert.ok(roles.has(role), `${place.id}: no ${role}`);
  if (city) assert.ok(roles.has("keep"), `${place.id}: no keep`);

  assert.ok(gates.length >= 1 && gates.length <= 2, `${place.id}: ${gates.length} gates`);
  for (const gate of gates) {
    assert.ok(gate.guardPosts.length >= 1 && gate.guardPosts.length <= 2, `${place.id}: ${gate.code} posts`);
    for (const post of gate.guardPosts)
      assert.ok(insidePolygon({ x: post.x, z: post.z }, border.points), `${place.id}: ${post.code} outside border`);
  }

  // One canonical owned home-building per resident. The lord alone owns the keep; every other
  // resident owns a distinct ordinary home, even when that structure has spare family/guest space.
  const byCode = new Map(buildings.map((b) => [b.code, b]));
  const ownedHomes = new Set<string>();
  let lords = 0;
  for (const r of residents) {
    const home = byCode.get(r.home);
    assert.ok(home, `${place.id}: ${r.code} home missing`);
    assert.ok(!ownedHomes.has(r.home), `${place.id}: ${r.home} is owned by more than one resident`);
    ownedHomes.add(r.home);
    if (r.profession === "lord") {
      lords++;
      assert.equal(home.role, "keep", `${place.id}: lord does not own the keep`);
    } else {
      assert.equal(home.role, "home", `${place.id}: ${r.code} owns ${home.role} instead of a home`);
    }
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
  }
  assert.equal(ownedHomes.size, residents.length, `${place.id}: resident ownership codes are not one-to-one`);
  const homeBuildings = buildings.filter((b) => b.role === "home");
  assert.ok(homeBuildings.length >= residents.length - lords, `${place.id}: not enough distinct homes for residents`);

  const serviceCount = buildings.filter((b) =>
    ["inn", "market", "blacksmith", "butcher", "farmstead", "keep"].includes(b.role),
  ).length;
  const postCount = gates.reduce((sum, g) => sum + g.guardPosts.length, 0);
  const requiredWorkers = serviceCount + postCount;
  assert.equal(residents.filter((r) => r.work).length, requiredWorkers, `${place.id}: worker count`);
  assert.ok(residents.length >= requiredWorkers + 1, `${place.id}: ${residents.length} residents < ${requiredWorkers} workers + 1`);
  assert.ok(residents.length <= (city ? 980 : 40), `${place.id}: ${residents.length} residents exceed the seeded range`);
  for (const b of buildings) {
    if (!["inn", "market", "blacksmith", "butcher", "farmstead", "guard-office", "keep"].includes(b.role)) continue;
    assert.ok(residents.some((r) => r.work === b.code), `${place.id}: ${b.code} (${b.role}) has no worker`);
  }

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

function alongAndSide(points: Point[], p: Point): { along: number; side: number; dist: number } {
  let best = { along: 0, side: 1, dist: Infinity },
    run = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1],
      len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / (len * len))),
      dist = distPointSeg(p, a, b);
    if (dist < best.dist) best = { along: run + t * len, side: orient(a, b, p) >= 0 ? 1 : -1, dist };
    run += len;
  }
  return best;
}

test("every city is dense, with uneven spacing along its streets", () => {
  for (const city of cities) {
    const layout = layoutOf(city);
    assert.ok(layout.buildings.length >= 250, `${city.id}: only ${layout.buildings.length} buildings`);
    const groups = new Map<string, number[]>();
    for (const b of layout.buildings) {
      if (b.role !== "home") continue;
      const street = layout.streets.find((st) => st.code === b.street)!,
        { along, side } = alongAndSide(street.points, { x: b.x, z: b.z });
      const key = `${b.street}/${side}`;
      groups.set(key, [...(groups.get(key) ?? []), along]);
    }
    const spacings: number[] = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a - b);
      for (let i = 1; i < list.length; i++) spacings.push(list[i] - list[i - 1]);
    }
    assert.ok(spacings.length >= 100, `${city.id}: only ${spacings.length} spacings`);
    const mean = spacings.reduce((a, b) => a + b, 0) / spacings.length,
      sd = Math.sqrt(spacings.reduce((a, b) => a + (b - mean) ** 2, 0) / spacings.length);
    assert.ok(sd / mean > 0.25, `${city.id}: spacing coefficient of variation ${(sd / mean).toFixed(2)} too uniform`);
  }
});

test("city cores are covered by streets and denser than the edge", () => {
  for (const city of cities) {
    const layout = layoutOf(city);
    let dry = 0,
      far = 0;
    for (let gx = -260; gx <= 260; gx += 20)
      for (let gz = -260; gz <= 260; gz += 20) {
        if (Math.hypot(gx, gz) > 260) continue;
        const p = { x: city.x + gx, z: city.z + gz };
        if (heightAt(p.x, p.z) <= 0.3 || !insidePolygon(p, layout.border.points)) continue;
        dry++;
        let best = Infinity;
        for (const st of layout.streets)
          for (let i = 0; i + 1 < st.points.length; i++) best = Math.min(best, distPointSeg(p, st.points[i], st.points[i + 1]));
        if (best > 50) far++;
      }
    assert.ok(far <= dry * 0.03, `${city.id}: ${far}/${dry} walled points are more than 50 from any street`);
    const area = (r0: number, r1: number) => Math.PI * (r1 * r1 - r0 * r0),
      count = (r0: number, r1: number) =>
        layout.buildings.filter((b) => {
          const d = Math.hypot(b.x - city.x, b.z - city.z);
          return d >= r0 && d < r1;
        }).length;
    const core = count(0, 150) / area(0, 150),
      edge = count(150, 400) / area(150, 400);
    assert.ok(core > edge * 2, `${city.id}: core density ${core.toExponential(2)} not above edge ${edge.toExponential(2)}`);
  }
});

test("city layouts avoid grid and row regularity", () => {
  const busiest = cities.reduce((best, c) => (layoutOf(c).buildings.length > layoutOf(best).buildings.length ? c : best));
  const buildings = layoutOf(busiest).buildings;
  const quarter = Math.PI / 2,
    yaws = new Set(buildings.map((b) => Math.floor((((b.angle % quarter) + quarter) % quarter) / 0.04)));
  assert.ok(yaws.size >= 20, `orientations collapse onto ${yaws.size} buckets`);
  const offsets = new Set(buildings.map((b) => Math.round((((b.x % 29) + 29) % 29))));
  assert.ok(offsets.size >= 20, `positions cluster on a lattice: ${offsets.size} distinct x mod 29 buckets`);
  const widths = new Set(buildings.filter((b) => b.role === "home").map((b) => b.width.toFixed(1)));
  assert.ok(widths.size >= 15, `only ${widths.size} distinct home frontages`);
});

test("city spines and rings are not straight", () => {
  for (const city of cities) {
    const spine = layoutOf(city).streets[0];
    const devs = spine.points.map((p) => Math.abs(p.z - city.z));
    assert.ok(Math.max(...devs) >= 10, `${city.id}: spine deviates only ${Math.max(...devs).toFixed(1)} from z = place.z`);
    assert.equal(spine.points[0].z, city.z);
    assert.equal(spine.points[spine.points.length - 1].z, city.z);
  }
});

test("borders hug the settlement and streets only cross them at gates", () => {
  for (const place of [...villages, ...cities]) {
    const layout = layoutOf(place),
      city = place.kind === "city",
      maxBuilding = Math.max(
        ...layout.buildings.flatMap((b) => footprint(b).map((c) => Math.hypot(c.x - place.x, c.z - place.z))),
      ),
      mean = layout.border.points.reduce((s, q) => s + Math.hypot(q.x - place.x, q.z - place.z), 0) / layout.border.points.length;
    assert.ok(
      mean <= maxBuilding + (city ? 30 : 15),
      `${place.id}: mean border radius ${mean.toFixed(1)} vs outermost building ${maxBuilding.toFixed(1)}`,
    );
    assert.ok(
      layout.border.points.every((q) => Math.hypot(q.x - place.x, q.z - place.z) >= 28),
      `${place.id}: border pinches below 28`,
    );
    const poly = layout.border.points;
    for (const street of layout.streets)
      for (let i = 0; i + 1 < street.points.length; i++)
        for (let k = 0; k < poly.length; k++) {
          const a = street.points[i],
            b = street.points[i + 1],
            c = poly[k],
            d = poly[(k + 1) % poly.length];
          if (orient(c, d, a) * orient(c, d, b) <= 0 && orient(a, b, c) * orient(a, b, d) <= 0) {
            const t = orient(c, d, a) / (orient(c, d, a) - orient(c, d, b) || 1),
              hit = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
            assert.ok(
              layout.gates.some((g) => g.street === street.code && Math.hypot(g.x - hit.x, g.z - hit.z) <= g.openingWidth),
              `${place.id}: ${street.code} cuts the border away from a gate`,
            );
          }
        }
    for (const gate of layout.gates) {
      const street = layout.streets.find((st) => st.code === gate.street)!;
      const end = Math.abs(gate.x - street.points[0].x) < Math.abs(gate.x - street.points[street.points.length - 1].x) ? street.points[0] : street.points[street.points.length - 1];
      assert.equal(end.z, place.z, `${place.id}: ${gate.code} street end is off the road line`);
      assert.ok(Math.hypot(end.x - place.x, end.z - place.z) >= Math.hypot(gate.x - place.x, gate.z - place.z), `${place.id}: gate beyond street end`);
    }
  }
});
