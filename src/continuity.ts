import { WORLD_SEED, WORLD_FOUNDATION_VERSION } from "./config.ts";
import { canonicalCell, cubeFaceToUnit, unitToLonLat, lonLatToUnit, normalizeLongitude, clampLatitude, type CubeCell, type LonLat, type Unit } from "./planet.ts";

export const CONTINUITY_LIMITS = Object.freeze({ level: 7, samples: 81, step: 8, queries: 4, cacheRegions: 32, cachePorts: 256, brackets: 16, bisections: 48 });
export const CONTINUITY_VERSION = `${WORLD_FOUNDATION_VERSION}/continuity-1`;
export type Boundary = { id: string; owner: string; a: Unit; b: Unit; vertices: readonly [string, string] };
const key = (parts: unknown[]) => JSON.stringify(parts);
export function recipeKey(domain: string, address: string, revision = "0", seed = WORLD_SEED) {
  return key([seed, CONTINUITY_VERSION, domain, address, revision]);
}
export function addressedSample(domain: string, address: string, slot: number, seed = WORLD_SEED) {
  if(!Number.isSafeInteger(slot)||slot<0)throw new RangeError("Feature slots must be nonnegative safe integers");
  const text = key([seed, CONTINUITY_VERSION, domain, address, slot]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
export function quantizedPosition(point: LonLat): LonLat {
  const lat = Math.round(clampLatitude(point.lat) * 1e10) / 1e10;
  return { lon: Math.abs(lat) >= Math.PI / 2 - 1e-10 ? 0 : Math.round(normalizeLongitude(point.lon) * 1e10) / 1e10, lat };
}
export function logicalRegion(point: LonLat, seed = WORLD_SEED) {
  const p = quantizedPosition(point);
  return canonicalCell(p.lon, p.lat, CONTINUITY_LIMITS.level, seed, CONTINUITY_VERSION);
}
function vertex(cell: CubeCell, u: number, v: number) {
  const n = 2 ** cell.level, unit = cubeFaceToUnit(cell.face, u * 2 / n - 1, v * 2 / n - 1),
    scale = n / Math.max(...unit.map(Math.abs)), integers = unit.map(value => Math.round(value * scale));
  return { id: integers.join(","), unit };
}
/** Exact integer cube vertices identify the geometric edge across all faces. */
export function regionBoundaries(cell: CubeCell, seed = WORLD_SEED): Boundary[] {
  const corners = [vertex(cell, cell.u, cell.v), vertex(cell, cell.u + 1, cell.v), vertex(cell, cell.u + 1, cell.v + 1), vertex(cell, cell.u, cell.v + 1)];
  return corners.map((start, i) => {
    const end = corners[(i + 1) % 4], pair = [start, end].sort((a, b) => a.id < b.id ? -1 : 1),
      vertices = [pair[0].id, pair[1].id] as const;
    return { id: recipeKey("EDGE", key([cell.level, vertices]), "0", seed), owner: vertices[0], a: pair[0].unit, b: pair[1].unit, vertices };
  });
}
export function boundaryPoint(edge: Boundary, t: number) {
  const p = edge.a.map((a, i) => a + (edge.b[i] - a) * t) as Unit, length = Math.hypot(...p);
  return quantizedPosition(unitToLonLat(p.map(v => v / length) as Unit));
}
const dot = (a: Unit, b: Unit) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const angle = (a: Unit, b: Unit) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
/** A pre-existing connected centerline supplies crossings; never invent a through-road. */
export function boundaryIntersections(edge: Boundary, pointAt: (t: number) => LonLat) {
  const [a, b] = [edge.a, edge.b], normal: Unit = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
    value = (t: number) => { const p = pointAt(t); return dot(normal, lonLatToUnit(p.lon, p.lat)); }, result: LonLat[] = [];
  const tolerance=Math.hypot(...normal)*1e-12;
  if([0,.5,1].every(t=>Math.abs(value(t))<=tolerance)) {
    const first=pointAt(0),last=pointAt(1),from=lonLatToUnit(first.lon,first.lat),to=lonLatToUnit(last.lon,last.lat),
      onArc=(p:Unit,start:Unit,end:Unit)=>Math.abs(angle(start,p)+angle(p,end)-angle(start,end))<=1e-8;
    return [first,last,boundaryPoint(edge,0),boundaryPoint(edge,1)].map(quantizedPosition)
      .filter((p,i,all)=>onArc(lonLatToUnit(p.lon,p.lat),a,b)&&onArc(lonLatToUnit(p.lon,p.lat),from,to)&&all.findIndex(q=>q.lon===p.lon&&q.lat===p.lat)===i);
  }
  for (let i = 0; i < CONTINUITY_LIMITS.brackets; i++) {
    let low = i / CONTINUITY_LIMITS.brackets, high = (i + 1) / CONTINUITY_LIMITS.brackets, sign = value(low);
    if (sign * value(high) > 0) continue;
    for (let j = 0; j < CONTINUITY_LIMITS.bisections; j++) {
      const middle = (low + high) / 2;
      if (sign * value(middle) <= 0) high = middle;
      else { low = middle; sign = value(low); }
    }
    const point = quantizedPosition(pointAt((low + high) / 2)), unit = lonLatToUnit(point.lon, point.lat);
    if (Math.abs(angle(a, unit) + angle(unit, b) - angle(a, b)) > 1e-8) continue;
    if (!result.some(p => p.lon === point.lon && p.lat === point.lat)) result.push(point);
  }
  return result;
}

export type Query<T> = Readonly<{ id: string; positions: readonly LonLat[]; cursor: number; values: readonly T[]; status: "pending" | "complete" }>;
export function beginQuery<T>(address: string, positions: readonly LonLat[], revision = "0", seed = WORLD_SEED): Query<T> {
  if (!positions.length || positions.length > CONTINUITY_LIMITS.samples) throw new RangeError("Query requires 1..81 points; split oversized requests canonically");
  const canonicalPositions = positions.map(quantizedPosition);
  return Object.freeze({ id: recipeKey("QUERY", JSON.stringify([address,canonicalPositions]), revision, seed), positions: Object.freeze(canonicalPositions.map(p=>Object.freeze(p))), cursor: 0, values: Object.freeze([]), status: "pending" });
}
/** Execution quota only advances a cursor. It cannot change recipe or fallback. */
export function advanceQuery<T>(query: Query<T>, sample: (point: LonLat) => T, quota: number = CONTINUITY_LIMITS.step): Query<T> {
  if (!Number.isInteger(quota) || quota < 1 || quota > CONTINUITY_LIMITS.samples) throw new RangeError("Continuation quota must be 1..81");
  if (!Number.isInteger(query.cursor) || query.cursor < 0 || query.cursor > query.positions.length || query.values.length !== query.cursor) throw new RangeError("Invalid continuation cursor");
  const end = Math.min(query.positions.length, query.cursor + quota), values = [...query.values];
  for (let i = query.cursor; i < end; i++) values.push(sample(query.positions[i]));
  return Object.freeze({ ...query, values: Object.freeze(values), cursor: end, status: end === query.positions.length ? "complete" : "pending" });
}
