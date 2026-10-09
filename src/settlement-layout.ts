/**
 * Settlement layout authority (WP-S002-004-009). Pure and SEED-addressed: no RNG, wall clock,
 * camera, zoom or visit order. One logical registry per inhabited place drives rendering,
 * inspection and resident homes/work. Coordinates are absolute source units (about 1 m near a
 * settlement); every identity is a canonical code independent of the owning render tile.
 */
import { SETTLEMENT_LAYOUT_VERSION, WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { nearestPlace, roads } from "./geography.ts";
import type { Place } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import { heightAt, riverX } from "./world.ts";

export type Point = { x: number; z: number };
export type BuildingRole =
  | "home"
  | "inn"
  | "market"
  | "blacksmith"
  | "farmstead"
  | "barn"
  | "butcher"
  | "guard-office"
  | "keep";
export type Room = { name: string; areaM2: number };
export type Building = {
  code: string;
  role: BuildingRole;
  /** Footprint centre. */
  x: number;
  z: number;
  /** Yaw in radians: local +z (the front/entrance side) points along (sin(angle), cos(angle)). */
  angle: number;
  /** Footprint along local x and local z. */
  width: number;
  depth: number;
  floors: number;
  /** Door point on the front wall; joined to its street by an access path. */
  entrance: Point;
  /** Point on the street centreline that the access path reaches. */
  access: Point;
  rooms: Room[];
  /** Sleeping places (homes, inn guests) or worker places (services). */
  capacity: number;
  /** "castle" for keep-side residential homes in cities, otherwise "town". */
  district: "town" | "castle";
  street: string;
};
export type Street = { code: string; points: Point[]; width: number };
export type GuardPost = { code: string; x: number; z: number; gate: string };
export type Gate = {
  code: string;
  x: number;
  z: number;
  /** Yaw of the street passing through the opening. */
  angle: number;
  openingWidth: number;
  street: string;
  guardPosts: GuardPost[];
};
/** Closed polygon (last point joins the first); gaps at gates are border-wall openings. */
export type Border = { code: string; points: Point[] };
export type FieldPlot = { code: string; x: number; z: number; angle: number; width: number; depth: number; farm: string };
export type Profession = "innkeeper" | "merchant" | "blacksmith" | "farmer" | "butcher" | "guard" | "lord" | "resident";
export type Resident = { code: string; profession: Profession; home: string; work?: string };
export type SettlementArchetype = "roadside" | "green" | "crossroads" | "riverside";
export type SettlementLayout = {
  place: string;
  code: string;
  archetype: SettlementArchetype;
  center: Point;
  well: Point;
  streets: Street[];
  buildings: Building[];
  border: Border;
  gates: Gate[];
  fields: FieldPlot[];
  residents: Resident[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
/** heightAt at or below this is water for settlement purposes. */
const DRY = 0.3;
const BORDER_BINS = 28;
const BORDER_STEP = TAU / BORDER_BINS;
/** Vertex radius = polygon radius / cos(half step), so chords never cut inside the target radius. */
const BORDER_CHORD = Math.cos(Math.PI / BORDER_BINS);
const WELL_CLEARANCE = 4;
const SPINE_SPACING = 18;
const FIELD_ROAD_BAND = 9;

const VILLAGE = { start: 64, cap: 76, fieldRadius: 150, residents: [18, 40] as const };
const CITY = { start: 340, cap: 400, fieldRadius: 470, residents: [380, 520] as const };

/** Object-level exception used to grow the envelope and retry a whole layout. */
class Shortfall extends Error {}

// ---------------------------------------------------------------------------
// Seeded variation (FNV-1a digest, identical to world.ts digest)
// ---------------------------------------------------------------------------

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
type Rand = (purpose: string, index?: number) => number;
function randFor(place: Place): Rand {
  return (purpose, index = 0) =>
    digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${SETTLEMENT_LAYOUT_VERSION}/${place.code}/LAYOUT/${purpose}/${index}`) /
    4294967296;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Oriented footprint. Local +z (front) is (sin a, cos a); local +x is (cos a, -sin a). */
type Rect = {
  cx: number;
  cz: number;
  w: number;
  d: number;
  angle: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  corners: Point[];
};

function makeRect(cx: number, cz: number, w: number, d: number, angle: number): Rect {
  const vx = Math.sin(angle),
    vz = Math.cos(angle),
    ux = Math.cos(angle),
    uz = -Math.sin(angle),
    hw = w / 2,
    hd = d / 2;
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([a, b]) => ({ x: cx + ux * a + vx * b, z: cz + uz * a + vz * b }));
  return { cx, cz, w, d, angle, ux, uz, vx, vz, corners };
}

/** Separating-axis test. pad > 0 requires that gap along some separating axis. */
function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  const axes: [number, number][] = [
    [a.ux, a.uz],
    [a.vx, a.vz],
    [b.ux, b.uz],
    [b.vx, b.vz],
  ];
  for (const [nx, nz] of axes) {
    const separation = Math.abs((a.cx - b.cx) * nx + (a.cz - b.cz) * nz);
    const ra =
      (a.w / 2) * Math.abs(a.ux * nx + a.uz * nz) + (a.d / 2) * Math.abs(a.vx * nx + a.vz * nz);
    const rb =
      (b.w / 2) * Math.abs(b.ux * nx + b.uz * nz) + (b.d / 2) * Math.abs(b.vx * nx + b.vz * nz);
    if (separation >= ra + rb + pad) return false;
  }
  return true;
}

function pointInRect(p: Point, r: Rect): boolean {
  const dx = p.x - r.cx,
    dz = p.z - r.cz,
    lx = dx * r.ux + dz * r.uz,
    lz = dx * r.vx + dz * r.vz;
  return Math.abs(lx) <= r.w / 2 && Math.abs(lz) <= r.d / 2;
}

function distPointSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** Touching counts as intersecting (conservative for legality checks). */
function segsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = orient(q1, q2, p1),
    d2 = orient(q1, q2, p2),
    d3 = orient(p1, p2, q1),
    d4 = orient(p1, p2, q2);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/** True polygon-to-segment distance: 0 when the segment touches or enters the footprint. */
function rectSegDistance(r: Rect, a: Point, b: Point): number {
  if (pointInRect(a, r) || pointInRect(b, r)) return 0;
  const c = r.corners;
  for (let i = 0; i < 4; i++) if (segsIntersect(a, b, c[i], c[(i + 1) % 4])) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    best = Math.min(best, distPointSeg(c[i], a, b));
    best = Math.min(best, distPointSeg(a, c[i], c[(i + 1) % 4]));
    best = Math.min(best, distPointSeg(b, c[i], c[(i + 1) % 4]));
  }
  return best;
}

function rectPointDistance(r: Rect, p: Point): number {
  if (pointInRect(p, r)) return 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) best = Math.min(best, distPointSeg(p, r.corners[i], r.corners[(i + 1) % 4]));
  return best;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}

function bbox(points: Point[], pad: number) {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

/** Coarse bucket grid over absolute source units. Insert/query order is deterministic. */
class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  private readonly size: number;
  constructor(size = 16) {
    this.size = size;
  }
  private key(ix: number, iz: number): number {
    return (ix + 100000) * 200003 + (iz + 100000);
  }
  insert(box: { minX: number; minZ: number; maxX: number; maxZ: number }, item: T): void {
    for (let ix = Math.floor(box.minX / this.size); ix <= Math.floor(box.maxX / this.size); ix++)
      for (let iz = Math.floor(box.minZ / this.size); iz <= Math.floor(box.maxZ / this.size); iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
  }
  query(box: { minX: number; minZ: number; maxX: number; maxZ: number }): T[] {
    const found = new Set<T>();
    for (let ix = Math.floor(box.minX / this.size); ix <= Math.floor(box.maxX / this.size); ix++)
      for (let iz = Math.floor(box.minZ / this.size); iz <= Math.floor(box.maxZ / this.size); iz++)
        for (const item of this.cells.get(this.key(ix, iz)) ?? []) found.add(item);
    return [...found];
  }
}

/** Point and unit direction at arc-length fraction f (0..1) along a polyline. */
function pointOnPolyline(points: Point[], f: number): { p: Point; dir: Point } {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  let target = total * f;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1],
      len = Math.hypot(b.x - a.x, b.z - a.z);
    if (target <= len || i + 2 === points.length) {
      const t = len > 0 ? Math.min(1, target / len) : 0;
      return {
        p: { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) },
        dir: len > 0 ? { x: (b.x - a.x) / len, z: (b.z - a.z) / len } : { x: 1, z: 0 },
      };
    }
    target -= len;
  }
  return { p: points[0], dir: { x: 1, z: 0 } };
}

function rotate(d: Point, angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: d.x * c - d.z * s, z: d.x * s + d.z * c };
}

/** Trim a polyline at the envelope circle around (cx, cz). Returns [] when nothing remains. */
function clipToRadius(points: Point[], cx: number, cz: number, radius: number): Point[] {
  const out: Point[] = [];
  const inside = (p: Point) => Math.hypot(p.x - cx, p.z - cz) <= radius;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) {
      if (!inside(p)) return [];
      out.push(p);
      continue;
    }
    const prev = points[i - 1];
    if (inside(p)) {
      out.push(p);
      continue;
    }
    // Solve |prev + t (p - prev) - c| = radius for the first exit point.
    const dx = p.x - prev.x,
      dz = p.z - prev.z,
      fx = prev.x - cx,
      fz = prev.z - cz,
      a = dx * dx + dz * dz,
      b = 2 * (fx * dx + fz * dz),
      c = fx * fx + fz * fz - radius * radius,
      disc = b * b - 4 * a * c,
      t = disc >= 0 && a > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : 0;
    out.push({ x: prev.x + dx * t, z: prev.z + dz * t });
    break;
  }
  return out.length >= 2 ? out : [];
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return total;
}

// ---------------------------------------------------------------------------
// Building programs: room lists define a minimum footprint (sum * 1.3).
// ---------------------------------------------------------------------------

type Program = {
  role: BuildingRole;
  rooms: Room[];
  floors: number;
  capacity: number;
  width: number;
  depth: number;
  district: "town" | "castle";
};

function roomProgram(role: BuildingRole, u: (k: number) => number): { rooms: Room[]; floors: number; capacity: number } {
  const room = (name: string, areaM2: number): Room => ({ name, areaM2 });
  switch (role) {
    case "home": {
      const household = 2 + Math.floor(u(0) * 4),
        extraBedrooms = Math.floor(Math.max(0, household - 2) / 2);
      const rooms = [room("bedroom", 9), room("latrine", 2), room("living room", 12)];
      for (let i = 0; i < extraBedrooms; i++) rooms.push(room("bedroom", 8));
      return { rooms, floors: 1 + Math.floor(u(1) * 2), capacity: household };
    }
    case "inn": {
      const guestRooms = 4 + Math.floor(u(0) * 3);
      const rooms = [room("common room", 40), room("kitchen", 12)];
      for (let i = 0; i < guestRooms; i++) rooms.push(room("guest room", 9));
      return { rooms, floors: 2, capacity: guestRooms * 2 };
    }
    case "market":
      return {
        rooms: [room("stall hall", 60), room("storage", 15)],
        floors: 1,
        capacity: 2 + Math.floor(u(0) * 2),
      };
    case "blacksmith":
      return { rooms: [room("forge", 20), room("clearance", 10), room("store", 8)], floors: 1, capacity: 2 };
    case "farmstead":
      return { rooms: [room("dwelling", 22), room("work yard", 20), room("store", 10)], floors: 1, capacity: 1 };
    case "barn":
      return { rooms: [room("animal store", 30 + 30 * u(0))], floors: 1, capacity: 1 };
    case "butcher":
      return { rooms: [room("work", 12), room("sales", 8), room("cold store", 6)], floors: 1, capacity: 2 };
    case "guard-office":
      return { rooms: [room("duty", 10), room("shelter", 8), room("store", 4)], floors: 1, capacity: 1 };
    case "keep":
      return { rooms: [room("hall", 120), room("chambers", 80), room("store", 30)], floors: 3, capacity: 6 };
  }
}

// ---------------------------------------------------------------------------
// Working state for one layout attempt.
// ---------------------------------------------------------------------------

type Seg = { a: Point; b: Point; width: number; street: number };
type Placed = { building: Building; rect: Rect };
type Anchor = {
  id: number;
  street: number;
  a: Point;
  b: Point;
  p: Point;
  /** Unit normal pointing from the street toward the plot side. */
  nx: number;
  nz: number;
  yawJit: number;
  setback: number;
  noise: number;
};
type GateEnd = { side: 1 | -1; end: Point; street: number; open: boolean };
type Work = {
  place: Place;
  rand: Rand;
  prefix: string;
  city: boolean;
  cx: number;
  cz: number;
  env: number;
  archetype: SettlementArchetype;
  well: Point;
  streets: Street[];
  segGrid: Grid<Seg>;
  ring: Point[] | undefined;
  placed: Placed[];
  rectGrid: Grid<Placed>;
  /** Lazily generated candidate passes (index = pass); reset when a street is added. */
  anchorPasses: (Anchor[] | undefined)[];
  anchorSpacing: number;
  gateEnds: GateEnd[];
};

function addStreet(w: Work, points: Point[], width: number): number {
  const index = w.streets.length;
  w.streets.push({ code: `${w.prefix}/street/${index}`, points, width });
  w.anchorPasses = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const seg: Seg = { a: points[i], b: points[i + 1], width, street: index };
    w.segGrid.insert(bbox([seg.a, seg.b], 0), seg);
  }
  return index;
}

function programFor(w: Work, role: BuildingRole, ordinal: number): Program {
  const u = (k: number) => w.rand(`program/${role}/${k}`, ordinal);
  const { rooms, floors, capacity } = roomProgram(role, u);
  const minArea = rooms.reduce((sum, r) => sum + r.areaM2, 0) * 1.3;
  const area = minArea * (1 + 0.15 * u(2)),
    aspect = lerpAspect(u(3)),
    width = Math.ceil(Math.sqrt(area * aspect) * 10) / 10,
    depth = Math.ceil((area / width) * 10) / 10;
  return { role, rooms, floors, capacity, width, depth, district: "town" };
}
const lerpAspect = (t: number) => 0.75 + (1.33 - 0.75) * t;

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

/** Plot anchors: seeded spacing along every street, both sides. Pass 1 is denser with more setback. */
function makeAnchors(w: Work, spacing: number, extraSetback: number, pass: number, tight = false): Anchor[] {
  const out: Anchor[] = [];
  w.streets.forEach((street, si) => {
    for (let j = 0; j + 1 < street.points.length; j++) {
      const a = street.points[j],
        b = street.points[j + 1],
        len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1) continue;
      const dx = (b.x - a.x) / len,
        dz = (b.z - a.z) / len,
        start = w.rand(`anchor-offset/${pass}`, si * 1000 + j) * spacing;
      for (let s = start; s < len; s += spacing) {
        const p = { x: a.x + dx * s, z: a.z + dz * s };
        for (const side of [1, -1]) {
          const id = pass * 100000 + out.length;
          out.push({
            id,
            street: si,
            a,
            b,
            p,
            nx: -dz * side,
            nz: dx * side,
            yawJit: (w.rand(`anchor-yaw/${pass}`, id) - 0.5) * (tight ? 0.12 : 0.3),
            // Tight pass: setback down to the legal street clearance (half width + 0.5) plus yaw slack.
            setback: tight
              ? street.width / 2 + 1.1 + 1.2 * w.rand(`anchor-setback/${pass}`, id)
              : street.width / 2 + 1.5 + extraSetback + 3 * w.rand(`anchor-setback/${pass}`, id),
            noise: w.rand(`anchor-noise/${pass}`, id),
          });
        }
      }
    }
  });
  return out;
}

/** Front wall faces the street: local +z = -normal, so angle = atan2(-nx, -nz) (+ seeded jitter). */
function tryPlace(w: Work, prog: Program, an: Anchor): Building | undefined {
  const { width, depth } = prog;
  const dist = an.setback + depth / 2,
    cx = an.p.x + an.nx * dist,
    cz = an.p.z + an.nz * dist,
    angle = Math.atan2(-an.nx, -an.nz) + an.yawJit,
    rect = makeRect(cx, cz, width, depth, angle);

  // Envelope: corners stay inside the envelope minus the border margin.
  const envLimit = w.env - 5;
  for (const c of rect.corners) if (Math.hypot(c.x - w.cx, c.z - w.cz) > envLimit) return undefined;
  // Green interior stays empty.
  if (w.ring && pointInPolygon({ x: cx, z: cz }, w.ring)) return undefined;
  // No overlap with accepted footprints (inflated by 1 unit).
  for (const other of w.rectGrid.query(bbox(rect.corners, 1)))
    if (rectsOverlap(rect, other.rect, 1)) return undefined;
  // Street clearance: true polygon-to-segment distance.
  for (const seg of w.segGrid.query(bbox(rect.corners, 14)))
    if (rectSegDistance(rect, seg.a, seg.b) < seg.width / 2 + 0.5) return undefined;
  // Well clearance.
  if (rectPointDistance(rect, w.well) < WELL_CLEARANCE) return undefined;
  // Terrain: centre and corners must be dry.
  if (heightAt(cx, cz) <= DRY) return undefined;
  for (const c of rect.corners) if (heightAt(c.x, c.z) <= DRY) return undefined;
  // Access path from the front door to the street must not cross another footprint.
  const entrance = { x: cx + rect.vx * (depth / 2), z: cz + rect.vz * (depth / 2) },
    access = closestOnSegment(entrance, an.a, an.b);
  for (const other of w.rectGrid.query(bbox([entrance, access], 1)))
    if (rectSegDistance(other.rect, entrance, access) === 0) return undefined;

  const building: Building = {
    code: `${w.prefix}/building/${w.placed.length}`,
    role: prog.role,
    x: cx,
    z: cz,
    angle,
    width,
    depth,
    floors: prog.floors,
    entrance,
    access,
    rooms: prog.rooms.map((r) => ({ ...r })),
    capacity: prog.capacity,
    district: prog.district,
    street: w.streets[an.street].code,
  };
  const placed: Placed = { building, rect };
  w.placed.push(placed);
  w.rectGrid.insert(bbox(rect.corners, 0), placed);
  return building;
}

const ANCHOR_PASSES = 4;
/** Pass 0 base spacing; 1 and 2 denser with more setback; 3 densest with the minimum legal setback. */
function anchorPass(w: Work, pass: number): Anchor[] {
  let anchors = w.anchorPasses[pass];
  if (!anchors) {
    const spacing = w.anchorSpacing;
    anchors =
      pass === 0
        ? makeAnchors(w, spacing, 0, 0)
        : pass === 1
          ? makeAnchors(w, spacing * 0.6, 3, 1)
          : pass === 2
            ? makeAnchors(w, spacing * 0.4, 6, 2)
            : makeAnchors(w, spacing * 0.3, 0, 3, true);
    w.anchorPasses[pass] = anchors;
  }
  return anchors;
}

/** First legal anchor in score order; sparse pass first, then ever denser passes. */
function placeRole(
  w: Work,
  prog: Program,
  score: (an: Anchor) => number,
  filter?: (an: Anchor) => boolean,
): Building | undefined {
  for (let pass = 0; pass < ANCHOR_PASSES; pass++) {
    const anchors = anchorPass(w, pass);
    const order = anchors
      .filter((an) => !filter || filter(an))
      .map((an) => ({ an, s: score(an) }))
      .sort((x, y) => x.s - y.s || x.an.id - y.an.id);
    for (const { an } of order) {
      const building = tryPlace(w, prog, an);
      if (building) return building;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Streets: spine on the external road axis (z = place.z at both ends), archetype
// geometry and seeded branching lanes.
// ---------------------------------------------------------------------------

function dryPolyline(points: Point[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    for (const p of [a, b, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }])
      if (heightAt(p.x, p.z) <= DRY) return false;
  }
  return true;
}

/** Streets keep only their dry runs (8 unit sampling); a wet stretch splits the street. */
function addDryRuns(w: Work, points: Point[], width: number): void {
  let run: Point[] = [];
  const flush = () => {
    if (run.length >= 2) addStreet(w, run, width);
    run = [];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1],
      steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
    for (let s = i > 0 ? 1 : 0; s <= steps; s++) {
      const p = { x: lerp(a.x, b.x, s / steps), z: lerp(a.z, b.z, s / steps) };
      if (heightAt(p.x, p.z) <= DRY) flush();
      else run.push(p);
    }
  }
  flush();
}

/** Smooth seeded spine: both ends exactly on z = place.z; interior offsets up to +-10. */
function makeSpine(w: Work, west: number, east: number, bend: number): Point[] {
  const span = east - west,
    n = Math.max(2, Math.ceil(span / SPINE_SPACING)),
    a1 = w.rand("spine/amp", 0) * 2 - 1,
    a2 = w.rand("spine/amp", 1) * 2 - 1,
    points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      off =
        i === 0 || i === n
          ? 0
          : (bend * (a1 * Math.sin(Math.PI * t) + 0.5 * a2 * Math.sin(2 * Math.PI * t))) / 1.5;
    points.push({ x: w.cx + west + span * t, z: w.cz + off });
  }
  return points;
}

/** Point and unit direction where a polyline crosses x = atX. */
function pointAtX(points: Point[], atX: number): { p: Point; dir: Point } {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    if ((a.x - atX) * (b.x - atX) <= 0 && a.x !== b.x) {
      const t = (atX - a.x) / (b.x - a.x),
        len = Math.hypot(b.x - a.x, b.z - a.z);
      return {
        p: { x: atX, z: lerp(a.z, b.z, t) },
        dir: { x: (b.x - a.x) / len, z: (b.z - a.z) / len },
      };
    }
  }
  return { p: { x: atX, z: points[0].z }, dir: { x: 1, z: 0 } };
}

function addLane(w: Work, k: number, width: number, minLen: number, maxLen: number): boolean {
  const parent = w.streets[Math.floor(w.rand("lane/parent", k) * w.streets.length)].points,
    { p, dir } = pointOnPolyline(parent, 0.15 + 0.7 * w.rand("lane/fraction", k)),
    side = w.rand("lane/side", k) < 0.5 ? -1 : 1,
    theta = ((35 + 110 * w.rand("lane/angle", k)) * Math.PI * side) / 180,
    d1 = rotate(dir, theta),
    length = minLen + (maxLen - minLen) * w.rand("lane/length", k),
    points: Point[] = [p, { x: p.x + d1.x * length, z: p.z + d1.z * length }];
  if (w.rand("lane/bend", k) < 0.5) {
    const bendSign = w.rand("lane/bend-sign", k) < 0.5 ? -1 : 1,
      d2 = rotate(d1, (bendSign * (15 + 20 * w.rand("lane/bend-angle", k)) * Math.PI) / 180),
      last = points[points.length - 1],
      extra = 10 + 12 * w.rand("lane/bend-length", k);
    points.push({ x: last.x + d2.x * extra, z: last.z + d2.z * extra });
  }
  const clipped = clipToRadius(points, w.cx, w.cz, w.env - 1);
  if (clipped.length < 2 || polylineLength(clipped) < 8 || !dryPolyline(clipped)) return false;
  // A lane added after buildings exist must keep the same clearance the buildings were placed with.
  for (let i = 0; i + 1 < clipped.length; i++)
    for (const other of w.rectGrid.query(bbox([clipped[i], clipped[i + 1]], 14)))
      if (rectSegDistance(other.rect, clipped[i], clipped[i + 1]) < width / 2 + 0.5) return false;
  addStreet(w, clipped, width);
  return true;
}

function buildStreets(w: Work, gateEast: boolean, gateWest: boolean): void {
  const spineWidth = w.city ? 7 : 5,
    laneWidth = w.city ? 4.5 : 3.5,
    bend = w.archetype === "green" ? 0 : w.archetype === "riverside" ? 14 : 10,
    east = gateEast ? w.env : w.env - 6,
    west = -(gateWest ? w.env : w.env - 6),
    spine = makeSpine(w, west, east, bend),
    spineIndex = addStreet(w, spine, spineWidth);
  w.gateEnds = [];
  if (gateWest) w.gateEnds.push({ side: -1, end: spine[0], street: spineIndex, open: true });
  if (gateEast) w.gateEnds.push({ side: 1, end: spine[spine.length - 1], street: spineIndex, open: true });

  const u = (k: number) => w.rand("archetype-shape", k);
  if (w.archetype === "riverside") {
    // Quay lane parallel to the river, on the dry side of the bank.
    const side = w.cx - riverX(w.cz) >= 0 ? 1 : -1,
      offset = 24 + 6 * u(0),
      quay: Point[] = [];
    for (let z = w.cz - 40; z <= w.cz + 40 + 1e-9; z += 10)
      quay.push({ x: riverX(z) + side * offset, z });
    const clipped = clipToRadius(quay, w.cx, w.cz, w.env - 1);
    if (clipped.length >= 2 && dryPolyline(clipped)) addStreet(w, clipped, laneWidth);
  }
  if (w.archetype === "green") {
    // Closed irregular ring around a central green with the well.
    const n = 8 + Math.floor(u(1) * 3),
      radius = 18 + 8 * u(2),
      ring: Point[] = [];
    for (let k = 0; k < n; k++) {
      const theta = (TAU * k) / n + (u(10 + k) - 0.5) * 0.3,
        r = radius * (0.9 + 0.2 * u(30 + k));
      ring.push({ x: w.cx + r * Math.cos(theta), z: w.cz + r * Math.sin(theta) });
    }
    w.ring = ring;
    addStreet(w, [...ring, ring[0]], laneWidth);
  }
  if (w.archetype === "crossroads") {
    // Second long street crossing the spine near the centre.
    const hub = pointAtX(spine, w.cx),
      angle = ((50 + 80 * u(3)) * Math.PI) / 180 * (u(4) < 0.5 ? -1 : 1),
      cross = rotate(hub.dir, angle),
      reach = w.env * 0.7,
      armA = clipToRadius([hub.p, { x: hub.p.x + cross.x * reach, z: hub.p.z + cross.z * reach }], w.cx, w.cz, w.env - 1),
      armB = clipToRadius([hub.p, { x: hub.p.x - cross.x * reach, z: hub.p.z - cross.z * reach }], w.cx, w.cz, w.env - 1);
    const points = [...armB.slice().reverse(), ...armA.slice(1)];
    if (points.length >= 2 && dryPolyline(points)) addStreet(w, points, laneWidth);
  }
  if (w.city) {
    // Ring road around the core.
    const n = 12 + Math.floor(u(5) * 3),
      radius = 118 + 16 * u(6),
      ring: Point[] = [];
    for (let k = 0; k < n; k++) {
      const theta = (TAU * k) / n + (u(40 + k) - 0.5) * 0.2;
      ring.push({ x: w.cx + radius * Math.cos(theta), z: w.cz + radius * Math.sin(theta) });
    }
    addDryRuns(w, [...ring, ring[0]], laneWidth);
    // Outer ring gives the outskirts frontage for the city's residential growth.
    const outerN = 16 + Math.floor(u(9) * 5),
      outerRadius = 250 + 20 * u(10),
      outer: Point[] = [];
    for (let k = 0; k < outerN; k++) {
      const theta = (TAU * k) / outerN + (u(60 + k) - 0.5) * 0.15;
      outer.push({ x: w.cx + outerRadius * Math.cos(theta), z: w.cz + outerRadius * Math.sin(theta) });
    }
    if (outerRadius < w.env - 1) addDryRuns(w, [...outer, outer[0]], laneWidth);
    const lanes = 14 + Math.floor(u(7) * 9);
    for (let k = 0, added = 0; added < lanes && k < lanes * 4; k++)
      if (addLane(w, k, laneWidth, 40, 90)) added++;
  } else {
    const lanes = 2 + Math.floor(u(8) * 3);
    for (let k = 0, added = 0; added < lanes && k < lanes * 4; k++)
      if (addLane(w, k, laneWidth, 18, 34)) added++;
  }
}

// ---------------------------------------------------------------------------
// Border, gates, guard posts and fields.
// ---------------------------------------------------------------------------

function binOf(angle: number): number {
  return Math.round(((angle % TAU) + TAU) % TAU / BORDER_STEP) % BORDER_BINS;
}

/**
 * Border polygon: per angular bin, the radius covers every building corner in the bin and its
 * neighbours plus a 6 unit margin, is smoothed with a seeded base, and never exceeds env - 4.
 * Vertices are scaled by 1 / cos(half step) so chords stay outside the target radius.
 * Non-gate directions get a radius that keeps the spine dead end inside.
 */
function buildBorder(w: Work, gateEast: boolean, gateWest: boolean): Point[] {
  const cap = w.env - 4,
    maxDist = new Array<number>(BORDER_BINS).fill(0);
  for (const { rect } of w.placed)
    for (const c of rect.corners) {
      const dist = Math.hypot(c.x - w.cx, c.z - w.cz),
        k = binOf(Math.atan2(c.z - w.cz, c.x - w.cx));
      maxDist[k] = Math.max(maxDist[k], dist);
    }
  const base = Array.from({ length: BORDER_BINS }, (_, k) => w.env * (0.8 + 0.2 * w.rand("border/base", k)));
  const radius: number[] = [];
  for (let k = 0; k < BORDER_BINS; k++) {
    const prev = (k + BORDER_BINS - 1) % BORDER_BINS,
      next = (k + 1) % BORDER_BINS,
      need = Math.max(maxDist[prev], maxDist[k], maxDist[next]),
      smooth = (base[prev] + 2 * base[k] + base[next]) / 4,
      r = Math.min(cap, Math.max(need > 0 ? need + 6 : 0, smooth));
    radius.push(r);
  }
  if (!gateEast) radius[0] = cap;
  if (!gateWest) radius[BORDER_BINS / 2] = cap;
  const points = radius.map((r, k) => {
    const v = r / BORDER_CHORD,
      theta = k * BORDER_STEP;
    return { x: w.cx + v * Math.cos(theta), z: w.cz + v * Math.sin(theta) };
  });
  return points;
}

function gatesFromSpine(
  w: Work,
  border: Point[],
): { code: string; x: number; z: number; angle: number; openingWidth: number; street: string; guardPosts: GuardPost[]; dir: Point; inward: Point }[] {
  const inside = (p: Point) => pointInPolygon(p, border);
  const result: { code: string; x: number; z: number; angle: number; openingWidth: number; street: string; guardPosts: GuardPost[]; dir: Point; inward: Point }[] = [];
  for (const end of w.gateEnds) {
    if (!end.open) continue;
    const points = w.streets[end.street].points;
    let a: Point, b: Point; // a inside, b outside
    if (end.side === 1) {
      let i = points.length - 2;
      while (i >= 0 && !inside(points[i])) i--;
      if (i < 0) throw new Shortfall(`gate ${end.side} does not cross border`);
      a = points[i];
      b = points[i + 1];
    } else {
      let i = 1;
      while (i < points.length && !inside(points[i])) i++;
      if (i >= points.length) throw new Shortfall(`gate ${end.side} does not cross border`);
      a = points[i];
      b = points[i - 1];
    }
    let lo = a,
      hi = b;
    for (let it = 0; it < 40; it++) {
      const mid = { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 };
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    const gp = { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 },
      len = Math.hypot(hi.x - lo.x, hi.z - lo.z) || 1,
      dir = { x: (hi.x - lo.x) / len, z: (hi.z - lo.z) / len },
      index = result.length;
    result.push({
      code: `${w.prefix}/gate/${index}`,
      x: gp.x,
      z: gp.z,
      angle: Math.atan2(dir.x, dir.z),
      openingWidth: w.streets[end.street].width + 2,
      street: w.streets[end.street].code,
      guardPosts: [],
      dir,
      inward: { x: -dir.x, z: -dir.z },
    });
  }
  return result;
}

/** Posts sit just inside the wall beside the opening; they must clear buildings and streets. */
function placeGuardPosts(
  w: Work,
  gate: ReturnType<typeof gatesFromSpine>[number],
  count: number,
  border: Point[],
  final: boolean,
): GuardPost[] {
  const tangent = { x: -gate.dir.z, z: gate.dir.x },
    half = gate.openingWidth / 2 + 2,
    posts: GuardPost[] = [];
  const candidates: Point[] = [];
  for (const depth of [2, 4, 6])
    for (const sign of [1, -1])
      candidates.push({
        x: gate.x + gate.inward.x * depth + tangent.x * sign * half,
        z: gate.z + gate.inward.z * depth + tangent.z * sign * half,
      });
  for (const p of candidates) {
    if (posts.length >= count) break;
    if (!pointInPolygon(p, border)) continue;
    if (w.rectGrid.query({ minX: p.x - 1, minZ: p.z - 1, maxX: p.x + 1, maxZ: p.z + 1 }).some((q) => rectPointDistance(q.rect, p) < 1)) continue;
    const near = w.segGrid.query({ minX: p.x - 8, minZ: p.z - 8, maxX: p.x + 8, maxZ: p.z + 8 });
    if (near.some((seg) => distPointSeg(p, seg.a, seg.b) < seg.width / 2 + 1)) continue;
    posts.push({ code: `${gate.code}/post/${posts.length}`, x: p.x, z: p.z, gate: gate.code });
  }
  if (posts.length < 1 && final) {
    // Envelope exhausted, last resort: deeper and wider candidates with the building clearance relaxed to 0.5.
    for (const depth of [2, 4, 6, 8, 10, 12, 15])
      for (const lateral of [half, half + 2, half + 4, half + 7])
        for (const sign of [1, -1]) {
          if (posts.length >= 1) break;
          const p = {
            x: gate.x + gate.inward.x * depth + tangent.x * sign * lateral,
            z: gate.z + gate.inward.z * depth + tangent.z * sign * lateral,
          };
          if (!pointInPolygon(p, border)) continue;
          if (w.rectGrid.query({ minX: p.x - 1, minZ: p.z - 1, maxX: p.x + 1, maxZ: p.z + 1 }).some((q) => rectPointDistance(q.rect, p) < 0.5)) continue;
          const near = w.segGrid.query({ minX: p.x - 8, minZ: p.z - 8, maxX: p.x + 8, maxZ: p.z + 8 });
          if (near.some((seg) => distPointSeg(p, seg.a, seg.b) < seg.width / 2 + 0.5)) continue;
          posts.push({ code: `${gate.code}/post/${posts.length}`, x: p.x, z: p.z, gate: gate.code });
        }
  }
  if (posts.length < 1) throw new Shortfall(`guard post at ${gate.code}`);
  return posts;
}

/** Farm plots outside the wall, away from the road band and water. */
function placeFields(w: Work, border: Point[], farm: string, target: number, radiusCap: number): FieldPlot[] {
  const fields: FieldPlot[] = [],
    rects: Rect[] = [];
  for (let i = 0; fields.length < target && i < target * 12; i++) {
    const theta = TAU * w.rand("field/angle", i),
      k = binOf(theta),
      reach = border.length ? Math.hypot(border[k].x - w.cx, border[k].z - w.cz) : w.env,
      r = reach + 4 + 25 * w.rand("field/radius", i),
      x = w.cx + r * Math.cos(theta),
      z = w.cz + r * Math.sin(theta),
      width = 18 + 8 * w.rand("field/width", i),
      depth = 12 + 6 * w.rand("field/depth", i),
      angle = Math.PI / 2 - theta + (w.rand("field/yaw", i) - 0.5) * 0.2,
      rect = makeRect(x, z, width, depth, angle);
    if (rect.corners.some((c) => Math.hypot(c.x - w.cx, c.z - w.cz) > radiusCap)) continue;
    if (rect.corners.some((c) => pointInPolygon(c, border))) continue;
    const zs = rect.corners.map((c) => c.z);
    if (Math.max(...zs) > w.cz - FIELD_ROAD_BAND && Math.min(...zs) < w.cz + FIELD_ROAD_BAND) continue;
    if (rect.corners.some((c) => heightAt(c.x, c.z) <= DRY) || heightAt(x, z) <= DRY) continue;
    if (rects.some((other) => rectsOverlap(rect, other, 1))) continue;
    if (w.rectGrid.query(bbox(rect.corners, 2)).some((q) => rectsOverlap(rect, q.rect, 2))) continue;
    if (w.segGrid.query(bbox(rect.corners, 12)).some((seg) => rectSegDistance(rect, seg.a, seg.b) < seg.width / 2 + 2)) continue;
    rects.push(rect);
    fields.push({ code: `${w.prefix}/field/${fields.length}`, x, z, angle, width, depth, farm });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Orchestration: placement order, residents, retry with a larger envelope.
// ---------------------------------------------------------------------------

function buildLayout(place: Place, env: number, city: boolean, final: boolean): SettlementLayout {
  const rand = randFor(place),
    prefix = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${SETTLEMENT_LAYOUT_VERSION}/S/${place.id}`,
    cx = place.x,
    cz = place.z,
    riverside = Math.abs(wrapSourceX(place.x - riverX(place.z))) < 120,
    archetype: SettlementArchetype = riverside
      ? "riverside"
      : (["roadside", "green", "crossroads"] as const)[Math.floor(rand("archetype") * 3)];

  // External roads decide the gates: a village with two roads gets both ends; with one road
  // the far end is a second gate by seed. Cities have gates on the east and west.
  let gateEast = city,
    gateWest = city;
  if (!city) {
    for (const road of roads) {
      if (road.from !== place.id && road.to !== place.id) continue;
      const otherX = road.from === place.id ? road.toX : road.fromX;
      if (wrapSourceX(otherX - place.x) > 0) gateEast = true;
      else gateWest = true;
    }
    if (!gateEast && !gateWest) gateEast = true;
    if (!(gateEast && gateWest) && rand("gate/far") < 0.5) gateEast = gateWest = true;
  }

  const w: Work = {
    place,
    rand,
    prefix,
    city,
    cx,
    cz,
    env,
    archetype,
    well: { x: cx, z: cz },
    streets: [],
    segGrid: new Grid<Seg>(16),
    ring: undefined,
    placed: [],
    rectGrid: new Grid<Placed>(16),
    anchorPasses: [],
    anchorSpacing: 0,
    gateEnds: [],
  };
  buildStreets(w, gateEast, gateWest);
  const spacing = city ? 12 + 6 * rand("anchor/spacing") : 12 + 4 * rand("anchor/spacing");
  w.anchorSpacing = spacing;

  const range = city ? CITY.residents : VILLAGE.residents;
  let residentTotal = range[0] + Math.floor(rand("residents") * (range[1] - range[0] + 1));

  const centreDist = (p: Point) => Math.hypot(p.x - cx, p.z - cz),
    gateDist = (p: Point, g: GateEnd) => Math.hypot(p.x - g.end.x, p.z - g.end.z),
    tryPut = (
      role: BuildingRole,
      score: (an: Anchor) => number,
      filter?: (an: Anchor) => boolean,
      district?: "town" | "castle",
    ): Building | undefined => {
      const prog = programFor(w, role, w.placed.length);
      if (district) prog.district = district;
      return placeRole(w, prog, score, filter);
    },
    put = (
      role: BuildingRole,
      score: (an: Anchor) => number,
      filter?: (an: Anchor) => boolean,
      district?: "town" | "castle",
    ): Building => {
      const building = tryPut(role, score, filter, district);
      if (!building) throw new Shortfall(`${role} after ${w.placed.length} buildings`);
      return building;
    };

  // Placement order: market, inn, blacksmith, butcher, guard-office, farmstead, barn,
  // [city: keep, castle-district homes], then homes until capacity covers residents.
  const markets = Array.from({ length: city ? 3 : 1 }, (_, i) =>
    put("market", (an) => centreDist(an.p) + (i ? 30 * an.noise : 0)),
  );
  const inns = Array.from({ length: city ? 2 : 1 }, (_, i) =>
    put("inn", (an) => centreDist(an.p) + (i ? 30 * an.noise : 0)),
  );
  const smiths = Array.from({ length: city ? 2 : 1 }, (_, i) =>
    put("blacksmith", (an) => centreDist(an.p) + 40 * an.noise + (i ? 30 : 0)),
  );
  const butchers = [put("butcher", (an) => centreDist(an.p) + 40 * an.noise)];
  const offices = Array.from({ length: city ? w.gateEnds.length : 1 }, (_, i) =>
    put("guard-office", (an) =>
      city ? gateDist(an.p, w.gateEnds[i]) : Math.min(...w.gateEnds.map((g) => gateDist(an.p, g))),
    ),
  );
  const farmstead = put("farmstead", (an) => -centreDist(an.p));
  const barn = put("barn", (an) => Math.hypot(an.p.x - farmstead.x, an.p.z - farmstead.z));
  let keep: Building | undefined;
  if (city) keep = put("keep", (an) => centreDist(an.p));

  // Population and homes are planned together: the upper bound of required workers (one per
  // service plus one guard per post) plus one non-worker household is the minimum we must house.
  const gateCount = w.gateEnds.length,
    postBound = Array.from({ length: gateCount }, (_, gi) => 1 + Math.floor(rand("guard/count", gi) * 2)),
    serviceWorkers = markets.length + inns.length + smiths.length + butchers.length + 1 /* farmer */,
    minHomeCapacity = serviceWorkers + postBound.reduce((a, b) => a + b, 0) + 1;

  const homes: Building[] = [];
  let homeCapacity = 0;
  const addHome = (
    score: (an: Anchor) => number,
    filter?: (an: Anchor) => boolean,
    district?: "town" | "castle",
  ): boolean => {
    const home = tryPut("home", score, filter, district);
    if (!home) return false;
    homes.push(home);
    homeCapacity += home.capacity;
    return true;
  };
  if (keep) {
    const castleHomes = 8 + Math.floor(rand("castle/count") * 5),
      keepRef = keep;
    for (let i = 0; i < castleHomes; i++)
      if (
        !addHome(
          (an) => Math.hypot(an.p.x - keepRef.x, an.p.z - keepRef.z),
          (an) => Math.hypot(an.p.x - keepRef.x, an.p.z - keepRef.z) <= 70,
          "castle",
        )
      )
        throw new Shortfall(`castle home after ${w.placed.length} buildings`);
  }
  let extraLanes = 0,
    laneProbe = 0;
  while (homeCapacity < residentTotal) {
    if (homes.length > 600) throw new Shortfall("home capacity");
    if (addHome((an) => centreDist(an.p) + 12 * an.noise)) continue;
    // Candidates ran out. Before the envelope is exhausted, grow it (retry the whole layout).
    if (!final) throw new Shortfall(`home after ${w.placed.length} buildings`);
    // Envelope exhausted: accept the homes we have if they house the minimum population;
    // otherwise add short lanes for more frontage and try again.
    if (homeCapacity >= minHomeCapacity) break;
    let added = false;
    while (!added && laneProbe < 40) added = addLane(w, 1000 + laneProbe++, w.city ? 4.5 : 3.5, city ? 40 : 18, city ? 90 : 34);
    if (!added || ++extraLanes > 8) throw new Shortfall(`minimum home capacity ${homeCapacity}/${minHomeCapacity}`);
  }

  // Border, gates and guard posts.
  const border = buildBorder(w, gateEast, gateWest),
    gateData = gatesFromSpine(w, border);
  const postCounts = postBound.slice(0, gateData.length);
  gateData.forEach((gate, gi) => {
    gate.guardPosts = placeGuardPosts(w, gate, postCounts[gi], border, final);
  });
  const totalPosts = gateData.reduce((sum, g) => sum + g.guardPosts.length, 0);
  offices.forEach((office, i) => {
    office.capacity = Math.max(1, city ? gateData[i]?.guardPosts.length ?? 1 : totalPosts);
  });

  const farm = farmstead.code,
    fieldTarget = city ? 14 + Math.floor(rand("fields/count") * 7) : 6 + Math.floor(rand("fields/count") * 5),
    fields = placeFields(w, border, farm, fieldTarget, city ? CITY.fieldRadius : VILLAGE.fieldRadius);

  // Residents: every service gets a worker with the right profession; the rest are plain residents.
  const workers: { profession: Profession; work?: Building; home?: Building }[] = [];
  for (const inn of inns) workers.push({ profession: "innkeeper", work: inn });
  for (const market of markets) workers.push({ profession: "merchant", work: market });
  for (const smith of smiths) workers.push({ profession: "blacksmith", work: smith });
  for (const butcher of butchers) workers.push({ profession: "butcher", work: butcher });
  workers.push({ profession: "farmer", work: farmstead });
  offices.forEach((office, i) => {
    const posts = city ? (gateData[i]?.guardPosts ?? []) : gateData.flatMap((g) => g.guardPosts);
    for (let p = 0; p < posts.length; p++) workers.push({ profession: "guard", work: office });
  });
  if (keep) workers.push({ profession: "lord", work: keep, home: keep });
  // Population is sized to the homes that exist: never more residents than beds (the lord sleeps
  // in the keep), never fewer than every worker plus one non-worker household.
  const lords = keep ? 1 : 0;
  residentTotal = Math.min(residentTotal, homeCapacity + lords);
  residentTotal = Math.max(residentTotal, workers.length + 1);
  if (residentTotal - lords > homeCapacity) throw new Shortfall(`homes for ${residentTotal} residents`);
  while (workers.length < residentTotal) workers.push({ profession: "resident" });

  const remaining = new Map(homes.map((h) => [h.code, h.capacity] as const));
  let cursor = 0;
  const homeFor = (): string => {
    while (cursor < homes.length && remaining.get(homes[cursor].code) === 0) cursor++;
    if (cursor >= homes.length) throw new Shortfall("resident home capacity");
    const home = homes[cursor];
    remaining.set(home.code, (remaining.get(home.code) ?? 0) - 1);
    return home.code;
  };
  const residents: Resident[] = workers.map((entry, i) => ({
    code: `${prefix}/resident/${i}`,
    profession: entry.profession,
    home: entry.home ? entry.home.code : homeFor(),
    ...(entry.work ? { work: entry.work.code } : {}),
  }));

  const gates: Gate[] = gateData.map((g) => ({
    code: g.code,
    x: g.x,
    z: g.z,
    angle: g.angle,
    openingWidth: g.openingWidth,
    street: g.street,
    guardPosts: g.guardPosts,
  }));
  return {
    place: place.id,
    code: place.code,
    archetype,
    center: { x: cx, z: cz },
    well: { x: cx, z: cz },
    streets: w.streets,
    buildings: w.placed.map((p) => p.building),
    border: { code: `${prefix}/border`, points: border },
    gates,
    fields,
    residents,
  };
}

/** Uncached layout. The envelope grows by 8 units (up to the cap) when a required role cannot fit. */
export function computeSettlementLayout(place: Place): SettlementLayout {
  const city = place.kind === "city",
    cap = city ? CITY.cap : VILLAGE.cap;
  let env = city ? CITY.start : VILLAGE.start;
  for (;;) {
    try {
      return buildLayout(place, env, city, env >= cap);
    } catch (error) {
      if (!(error instanceof Shortfall)) throw error;
      if (env >= cap)
        throw new Error(`settlement ${place.id} (${place.kind}) could not place ${error.message} within radius ${cap}`);
      env = Math.min(cap, env + 8);
    }
  }
}

const layouts = new Map<string, SettlementLayout>();

/** Memoised per place; the same place always returns the identical object. */
export function settlementLayout(place: Place): SettlementLayout {
  let layout = layouts.get(place.id);
  if (!layout) {
    layout = computeSettlementLayout(place);
    layouts.set(place.id, layout);
  }
  return layout;
}

type LayoutIndex = {
  segs: Grid<{ a: Point; b: Point; width: number }>;
  buildings: Grid<{ building: Building; rect: Rect }>;
};
const indexes = new Map<string, LayoutIndex>();
function indexFor(place: Place): LayoutIndex {
  let index = indexes.get(place.id);
  if (!index) {
    const layout = settlementLayout(place),
      segs = new Grid<{ a: Point; b: Point; width: number }>(16),
      buildings = new Grid<{ building: Building; rect: Rect }>(16);
    for (const street of layout.streets)
      for (let i = 0; i + 1 < street.points.length; i++) {
        const a = street.points[i],
          b = street.points[i + 1];
        segs.insert(bbox([a, b], 0), { a, b, width: street.width });
      }
    for (const building of layout.buildings) {
      const rect = makeRect(building.x, building.z, building.width, building.depth, building.angle);
      buildings.insert(bbox(rect.corners, 0), { building, rect });
    }
    index = { segs, buildings };
    indexes.set(place.id, index);
  }
  return index;
}

/** Local lookup radius: villages 110 and cities 460 source units from their centre. */
function localPlace(x: number, z: number): { place: Place; px: number } | undefined {
  const place = nearestPlace(x, z);
  if (!place) return undefined;
  const dx = wrapSourceX(x - place.x),
    limit = place.kind === "city" ? 460 : 110;
  if (Math.hypot(dx, z - place.z) > limit) return undefined;
  return { place, px: place.x + dx };
}

/** Distance from (x, z) to the nearest street centreline of the nearest settlement; Infinity when none. */
export function streetDistanceAt(x: number, z: number): number {
  const local = localPlace(x, z);
  if (!local) return Infinity;
  const { place, px } = local,
    index = indexFor(place),
    limit = place.kind === "city" ? 460 : 110;
  // Grow the search box until the nearest segment is provably inside it.
  for (let r = 16; r <= limit * 2; r *= 2) {
    let best = Infinity;
    for (const seg of index.segs.query({ minX: px - r, minZ: z - r, maxX: px + r, maxZ: z + r }))
      best = Math.min(best, distPointSeg({ x: px, z }, seg.a, seg.b));
    if (best <= r) return best;
  }
  return Infinity;
}

/** Building whose footprint contains (x, z), if any. */
export function buildingAt(x: number, z: number): Building | undefined {
  const local = localPlace(x, z);
  if (!local) return undefined;
  const { place, px } = local,
    point = { x: px, z };
  for (const hit of indexFor(place).buildings.query({ minX: px, minZ: z, maxX: px, maxZ: z }))
    if (pointInRect(point, hit.rect)) return hit.building;
  return undefined;
}
