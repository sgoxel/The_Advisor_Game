import test from "node:test";
import assert from "node:assert/strict";
import { places, villages } from "../src/geography.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { resolvedSettlementHomeDoorFor } from "../src/world.ts";
import { criticalSites } from "../src/sites.ts";
import { nearbyWilderness } from "../src/wilderness.ts";
import { metresToSource } from "../src/physical-scale.ts";

// npc-popup pulls in browser-only modules that read document.baseURI at load time.
(globalThis as { document?: unknown }).document ??= { baseURI: "http://localhost/" };
const { resolveGoTarget, popupFocusHalfHeight, HOME_ENTRANCE_FOCUS_HALF_HEIGHT } = await import("../src/npc-popup.ts");

test("settlement card place links resolve to their positions only when clicked", () => {
  const home = villages[0], other = places.find((place) => place.id !== home.id)!;
  const neighbour = resolveGoTarget(`place:${other.id}`);
  assert.deepEqual(neighbour && { x: neighbour.x, z: neighbour.z }, { x: other.x, z: other.z }, "neighbouring settlement");
  const keep = settlementExteriorFor(home).plots.find((plot) => plot.kind === "keep" || plot.kind === "service")!;
  assert.deepEqual(resolveGoTarget(`plot:${home.id}:${keep.id}`), keep.candidates[0], "notable place inside the town");
  const wild = nearbyWilderness(home.x, home.z, metresToSource(8000), 8)[0];
  if (wild) assert.deepEqual(resolveGoTarget(`site:${home.id}:${wild.code}`), wild, "wilderness point of interest");
  const ruin = criticalSites[0];
  assert.equal(resolveGoTarget(`site:${home.id}:${ruin.code}`), ruin, "ruin / critical site");
  assert.equal(resolveGoTarget(`plot:${home.id}:no-such-plot`), undefined);
  assert.equal(resolveGoTarget("place:no-such-place"), undefined);
  assert.equal(resolveGoTarget(""), undefined);
});

test("resident camera focus reaches actual SEED-owned entrance", () => {
  const place = villages[0], index = 37, door = resolvedSettlementHomeDoorFor(place, index);
  assert.ok(door, "fixture must have a real owned doorway");
  assert.deepEqual(resolveGoTarget(`home:${place.id}:${index}`), door);
  assert.equal(resolveGoTarget(`home:${place.id}:-1`), undefined);
  assert.equal(resolveGoTarget(`home:${place.id}:999999`), undefined);
  assert.equal(resolveGoTarget(`home:${place.id}:2.5`), undefined);
});

test("owned-door inspection stays at readable building zoom and preserves ordinary place zoom", () => {
  const heroHalfHeight = .8344302680376363;
  assert.equal(popupFocusHalfHeight("home:0:37", heroHalfHeight), HOME_ENTRANCE_FOCUS_HALF_HEIGHT,
    "a camera-only home lookup cannot force the GPU-losing extreme close-detail view");
  assert.equal(popupFocusHalfHeight("place:0", heroHalfHeight), heroHalfHeight,
    "other place previews preserve their existing Hero zoom");
  assert.equal(popupFocusHalfHeight("home:0:37", 14), 14,
    "a future larger canonical Hero setting is never tightened by this fix");
});
