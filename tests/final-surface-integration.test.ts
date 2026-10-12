import assert from "node:assert/strict";
import test from "node:test";
import { places, roads, villages } from "../src/geography.ts";
import {
  WORLD_BUILDING_PRIORITIES,
} from "../src/final-surface.ts";
import {
  finalSurfaceAt,
  finalSurfaceDebugAt,
  finalSurfaceTelemetry,
  resetFinalSurfaceTelemetry,
} from "../src/world.ts";

const EPS = 1e-9;

test("settlement terraces use one bounded priority-7 final-surface modifier", () => {
  const village = villages[0];
  assert.ok(village);
  const debug = finalSurfaceDebugAt(village.x, village.z),
    pad = debug.modifiers.find((modifier) => modifier.id === `${village.code}/PAD`);
  assert.ok(pad, "village centre must expose its canonical pad modifier");
  assert.equal(pad.priority, WORLD_BUILDING_PRIORITIES.village);
  const delta = debug.final.groundHeight - debug.base.groundHeight;
  assert.ok(delta >= -3 - EPS && delta <= 3 + EPS, `village terrace delta ${delta} exceeded ±3m`);
  assert.equal(debug.final.vegetationDensityScale, 0);
});

test("priority-9 keep site is inspectable and wins the reserved-use channel", () => {
  const place = places[0];
  assert.ok(place);
  const debug = finalSurfaceDebugAt(place.x - 30, place.z - 28),
    site = debug.modifiers.find((modifier) => modifier.id === `${place.code}/SITE/KEEP`);
  assert.ok(site, "representative keep must expose a priority-9 site modifier");
  assert.equal(site.priority, WORLD_BUILDING_PRIORITIES.site);
  assert.equal(debug.final.reservedUse, `${place.code}/SITE/KEEP`);
  assert.equal(debug.final.vegetationDensityScale, 0);
});

test("road cut/fill is bounded and priority-8 ownership is inspectable", () => {
  let checked = 0;
  for (const road of roads.slice(0, 24)) {
    for (const t of [0.25, 0.5, 0.75]) {
      const x = road.fromX + (road.toX - road.fromX) * t,
        z = road.fromZ + (road.toZ - road.fromZ) * t,
        debug = finalSurfaceDebugAt(x, z),
        modifier = debug.modifiers.find((candidate) => candidate.id === road.code);
      if (!modifier || debug.base.water.kind !== "none") continue;
      assert.equal(modifier.priority, WORLD_BUILDING_PRIORITIES.road);
      const delta = debug.final.groundHeight - debug.base.groundHeight;
      assert.ok(delta >= -4 - EPS, `road cut ${delta} exceeded 4m at ${road.code}`);
      assert.ok(delta <= 3 + EPS, `road fill ${delta} exceeded 3m at ${road.code}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `expected representative dry road samples, got ${checked}`);
});

test("bridge deck preserves authoritative water and ground as separate channels", () => {
  let bridge:
    | ReturnType<typeof finalSurfaceDebugAt>
    | undefined;
  outer: for (const road of roads) {
    const length = Math.hypot(road.toX - road.fromX, road.toZ - road.fromZ),
      samples = Math.max(8, Math.min(96, Math.ceil(length / 8)));
    for (let index = 0; index <= samples; index++) {
      const t = index / samples,
        debug = finalSurfaceDebugAt(
          road.fromX + (road.toX - road.fromX) * t,
          road.fromZ + (road.toZ - road.fromZ) * t,
        );
      if (debug.final.deckHeight !== null) {
        bridge = debug;
        break outer;
      }
    }
  }
  assert.ok(bridge, "seeded road registry must expose at least one composed bridge crossing");
  assert.notEqual(bridge.base.water.kind, "none");
  assert.equal(bridge.final.water.kind, bridge.base.water.kind);
  assert.equal(bridge.final.groundHeight, bridge.base.groundHeight);
  assert.equal(bridge.final.groundMaterial, bridge.base.material);
  assert.equal(bridge.final.material, "Bridge");
  assert.equal(bridge.final.deckMaterial, "Bridge");
  assert.equal(bridge.final.traversal, "bridge");
  assert.ok(bridge.final.deckHeight! >= bridge.base.water.level + 1);
});

test("outside all modifier support, final ground/material/water channels are unchanged", () => {
  const probes = [
    [-60_000, 18_000],
    [60_000, -18_000],
    [-48_000, -32_000],
    [48_000, 32_000],
    [0, 48_000],
  ] as const;
  const debug = probes
    .map(([x, z]) => finalSurfaceDebugAt(x, z))
    .find((sample) => sample.modifiers.length === 0);
  assert.ok(debug, "expected an unmodified representative probe");
  assert.equal(debug.final.groundHeight, debug.base.groundHeight);
  assert.equal(debug.final.groundMaterial, debug.base.material);
  assert.deepEqual(debug.final.water, debug.base.water);
  assert.equal(debug.final.vegetationDensityScale, debug.base.vegetationDensityScale);
  assert.equal(debug.final.reservedUse, debug.base.reservedUse);
});

test("final-surface memoization is bounded and exposes deterministic hit/miss telemetry", () => {
  resetFinalSurfaceTelemetry();
  const first = finalSurfaceAt(12_345.25, -4_321.75),
    second = finalSurfaceAt(12_345.25, -4_321.75),
    telemetry = finalSurfaceTelemetry();
  assert.deepEqual(second, first);
  assert.equal(telemetry.queries, 2);
  assert.equal(telemetry.cacheMisses, 1);
  assert.equal(telemetry.cacheHits, 1);
  assert.ok(telemetry.cacheSize <= telemetry.cacheLimit);
  assert.ok(telemetry.worstModifierCandidates <= 128, `unbounded modifier candidates: ${telemetry.worstModifierCandidates}`);
});