import assert from "node:assert/strict";
import test from "node:test";

import { villages } from "../src/geography.ts";
import {
  lonLatToFlat,
  sourceToLonLat,
  wrapSourceX,
  type LonLat,
} from "../src/planet.ts";
import { macroTerrainSampler, planRoute } from "../src/routing.ts";
import { drainageRecipesNear, surfaceAt, type DrainagePoint } from "../src/surface.ts";
import { CELL_SIZE } from "../src/world.ts";

const STEP_M = 300;
const FAILING_A = "1/2/0/1";
const FAILING_B = "1/5/1/0";

function finalSurface(position: LonLat) {
  const flat = lonLatToFlat(position.lon, position.lat),
    x = Math.floor(flat.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
    z = Math.floor(flat.z / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  return { x, z, sample: surfaceAt(x, z) };
}

function firstBlocked(points: readonly LonLat[]) {
  for (let segment = 1; segment < points.length; segment++) {
    const a = lonLatToFlat(points[segment - 1].lon, points[segment - 1].lat),
      b = lonLatToFlat(points[segment].lon, points[segment].lat),
      dx = wrapSourceX(b.x - a.x),
      dz = b.z - a.z,
      length = Math.hypot(dx, dz),
      steps = Math.max(1, Math.ceil(length / STEP_M));
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps,
        p = sourceToLonLat(wrapSourceX(a.x + dx * t), a.z + dz * t),
        state = finalSurface(p);
      if (!state.sample.walkable)
        return { segment, step, steps, t, position: p, ...state };
    }
  }
  return undefined;
}

function localDryApproaches(points: readonly LonLat[], blocked: NonNullable<ReturnType<typeof firstBlocked>>) {
  const a = lonLatToFlat(points[blocked.segment - 1].lon, points[blocked.segment - 1].lat),
    b = lonLatToFlat(points[blocked.segment].lon, points[blocked.segment].lat),
    dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    at = (step: number) => sourceToLonLat(
      wrapSourceX(a.x + dx * ((step + 0.5) / blocked.steps)),
      a.z + dz * ((step + 0.5) / blocked.steps),
    );
  let before: LonLat | undefined,
    after: LonLat | undefined;
  for (let step = blocked.step - 1; step >= 0; step--) {
    const p = at(step);
    if (finalSurface(p).sample.walkable) { before = p; break; }
  }
  for (let step = blocked.step + 1; step < blocked.steps; step++) {
    const p = at(step);
    if (finalSurface(p).sample.walkable) { after = p; break; }
  }
  return before && after ? [before, after] as const : undefined;
}

function sourceSegmentProjection(x: number, z: number, a: DrainagePoint, b: DrainagePoint) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(x - a.x),
    qz = z - a.z,
    lengthSq = dx * dx + dz * dz,
    t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / lengthSq));
  return { distance: Math.hypot(qx - dx * t, qz - dz * t), t };
}

function nearestPath(recipe: ReturnType<typeof drainageRecipesNear>[number], x: number, z: number) {
  let best: { path: readonly DrainagePoint[]; segmentIndex: number; distance: number; t: number } | undefined;
  for (const path of [recipe.points, recipe.tributary] as const)
    for (let segmentIndex = 0; segmentIndex + 1 < path.length; segmentIndex++) {
      const hit = sourceSegmentProjection(x, z, path[segmentIndex], path[segmentIndex + 1]);
      if (!best || hit.distance < best.distance) best = { path, segmentIndex, ...hit };
    }
  return best;
}

type SearchNode = { key: string; i: number; j: number };
function dryComponentSearch(
  path: readonly DrainagePoint[],
  crossingIndex: number,
  approach: LonLat,
  halo: number,
  step: number,
) {
  const head = path[0],
    next = path[1],
    dx = wrapSourceX(next.x - head.x),
    dz = next.z - head.z,
    length = Math.hypot(dx, dz) || 1,
    tangentX = dx / length,
    tangentZ = dz / length,
    goal = lonLatToFlat(approach.lon, approach.lat),
    upstream = { x: wrapSourceX(head.x - tangentX * halo * 0.65), z: head.z - tangentZ * halo * 0.65 };

  const points = [...path.slice(0, crossingIndex + 2), { x: goal.x, z: goal.z, bed: 0 }, { x: upstream.x, z: upstream.z, bed: 0 }],
    anchorX = head.x,
    localX = points.map((p) => wrapSourceX(p.x - anchorX)),
    minX = Math.min(...localX) - halo,
    maxX = Math.max(...localX) + halo,
    minZ = Math.min(...points.map((p) => p.z)) - halo,
    maxZ = Math.max(...points.map((p) => p.z)) + halo,
    width = Math.floor((maxX - minX) / step) + 1,
    height = Math.floor((maxZ - minZ) / step) + 1,
    cell = (i: number, j: number) => ({
      x: wrapSourceX(anchorX + minX + i * step),
      z: minZ + j * step,
    }),
    indexNear = (x: number, z: number) => ({
      i: Math.max(0, Math.min(width - 1, Math.round((wrapSourceX(x - anchorX) - minX) / step))),
      j: Math.max(0, Math.min(height - 1, Math.round((z - minZ) / step))),
    }),
    startIndex = indexNear(upstream.x, upstream.z),
    goalIndex = indexNear(goal.x, goal.z),
    keyOf = (i: number, j: number) => `${i}/${j}`,
    passable = (i: number, j: number) => {
      const p = cell(i, j);
      return surfaceAt(p.x, p.z).walkable;
    },
    queue: SearchNode[] = [],
    parent = new Map<string, string | null>();

  const seedCandidates: { i: number; j: number; d: number }[] = [];
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
    const i = startIndex.i + di, j = startIndex.j + dj;
    if (i < 0 || j < 0 || i >= width || j >= height || !passable(i, j)) continue;
    seedCandidates.push({ i, j, d: di * di + dj * dj });
  }
  seedCandidates.sort((a, b) => a.d - b.d || a.j - b.j || a.i - b.i);
  if (!seedCandidates.length) return { found: false, reason: "no-start", width, height, expansions: 0 };
  const seed = seedCandidates[0], seedKey = keyOf(seed.i, seed.j);
  queue.push({ key: seedKey, i: seed.i, j: seed.j });
  parent.set(seedKey, null);
  const moves = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
  let read = 0, expansions = 0, foundKey: string | undefined;
  while (read < queue.length && expansions < 50_000) {
    const current = queue[read++];
    expansions++;
    if (Math.abs(current.i - goalIndex.i) <= 1 && Math.abs(current.j - goalIndex.j) <= 1) {
      foundKey = current.key; break;
    }
    for (const [di, dj] of moves) {
      const i = current.i + di, j = current.j + dj, key = keyOf(i, j);
      if (i < 0 || j < 0 || i >= width || j >= height || parent.has(key) || !passable(i, j)) continue;
      if (di && dj && (!passable(current.i + di, current.j) || !passable(current.i, current.j + dj))) continue;
      parent.set(key, current.key);
      queue.push({ key, i, j });
    }
  }
  if (!foundKey) return { found: false, reason: "disconnected", width, height, expansions };
  const reversed: { x: number; z: number }[] = [];
  for (let key: string | null = foundKey; key; key = parent.get(key) ?? null) {
    const [i, j] = key.split("/").map(Number);
    reversed.push(cell(i, j));
  }
  reversed.reverse();
  return { found: true, width, height, expansions, path: reversed };
}

test("WP15 diagnostic: failing pair has a bounded dry component around the seeded head", () => {
  const from = villages.find((v) => v.id === FAILING_A),
    to = villages.find((v) => v.id === FAILING_B);
  assert.ok(from && to);
  const coarse = planRoute({ from: from.canonicalPosition, to: to.canonicalPosition, terrain: macroTerrainSampler });
  assert.equal(coarse.found, true, `coarse planner failed: ${coarse.reason}`);
  const blocked = firstBlocked(coarse.points);
  assert.ok(blocked, "expected final-surface block");
  assert.ok(blocked.sample.catchmentCode, "blocked sample must have catchment");
  const approaches = localDryApproaches(coarse.points, blocked);
  assert.ok(approaches, "expected dry approaches");
  const source = lonLatToFlat(blocked.position.lon, blocked.position.lat),
    recipe = drainageRecipesNear(source.x, source.z, 2).find((r) => r.code === blocked.sample.catchmentCode);
  assert.ok(recipe, `missing recipe ${blocked.sample.catchmentCode}`);
  const hit = nearestPath(recipe, source.x, source.z);
  assert.ok(hit && hit.path.length > 1);

  console.log("WP15_DIAG_BLOCK", JSON.stringify({
    catchment: blocked.sample.catchmentCode,
    water: blocked.sample.water,
    crossingIndex: hit.segmentIndex,
    crossingT: hit.t,
    approachA: lonLatToFlat(approaches[0].lon, approaches[0].lat),
    approachB: lonLatToFlat(approaches[1].lon, approaches[1].lat),
    head: hit.path[0],
    crossing: hit.path[hit.segmentIndex],
  }));

  const trials = [
    { halo: 1200, step: 80 },
    { halo: 2000, step: 100 },
    { halo: 3200, step: 120 },
    { halo: 4800, step: 150 },
  ].map((config) => ({ ...config, result: dryComponentSearch(hit.path, hit.segmentIndex, approaches[1], config.halo, config.step) }));
  console.log("WP15_DIAG_COMPONENTS", JSON.stringify(trials.map((trial) => ({
    halo: trial.halo,
    step: trial.step,
    found: trial.result.found,
    reason: "reason" in trial.result ? trial.result.reason : undefined,
    width: trial.result.width,
    height: trial.result.height,
    expansions: trial.result.expansions,
    pathPoints: "path" in trial.result ? trial.result.path?.length : 0,
  }))));
  assert.ok(trials.some((trial) => trial.result.found), "no bounded dry component found in diagnostic envelopes");
});
