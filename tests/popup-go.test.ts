import test from "node:test";
import assert from "node:assert/strict";
import { places, villages } from "../src/geography.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { resolvedSettlementHomeDoorFor } from "../src/world.ts";
import { criticalSites } from "../src/sites.ts";
import { nearbyWilderness } from "../src/wilderness.ts";
import { metresToSource } from "../src/physical-scale.ts";
import { lonLatToSource, sourceToLonLat } from "../src/planet.ts";

// npc-popup pulls in browser-only modules that read document.baseURI at load time.
(globalThis as { document?: unknown }).document ??= { baseURI: "http://localhost/" };
const { resolveGoTarget, popupFocusHalfHeight, HOME_ENTRANCE_FOCUS_HALF_HEIGHT, RESIDENT_OBSERVE_HALF_HEIGHT, residentObservationPoint } = await import("../src/npc-popup.ts");

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
  // The real owned house, front door and street must fit together; a sub-house
  // tight crop previously showed only the marker against an empty background.
  assert.ok(HOME_ENTRANCE_FOCUS_HALF_HEIGHT >= 6,
    "camera-only home inspection must not crop the full 3D building to its doorway");
  const heroHalfHeight = .8344302680376363;
  assert.equal(popupFocusHalfHeight("home:0:37", heroHalfHeight), HOME_ENTRANCE_FOCUS_HALF_HEIGHT,
    "the owned front door is framed at building scale instead of a whole neighbourhood");
  assert.equal(popupFocusHalfHeight("place:0", heroHalfHeight), heroHalfHeight,
    "other place previews preserve their existing Hero zoom");
  assert.equal(popupFocusHalfHeight("home:0:37", 14), 14,
    "a future larger canonical Hero setting is never tightened by this fix");
});

test("true-scale resident observation uses the real canonical position and cannot invent a missing actor", () => {
  const place = villages[0], position = sourceToLonLat(place.x, place.z);
  const real = { grounded: true, indoors: false, position: { ...position, elevation: 153 } };
  assert.deepEqual(residentObservationPoint(real), lonLatToSource(position.lon, position.lat),
    "camera-only view uses the Simulation position without changing elevation, identity or path");
  assert.equal(residentObservationPoint({ ...real, grounded: false }), undefined,
    "unresolved ground does not qualify for an on-world actor close-up");
  assert.equal(residentObservationPoint({ ...real, indoors: true }), undefined,
    "indoor resident may not be teleported outdoors by an inspect action");
  assert.equal(resolveGoTarget(`resident:${place.id}:37`), undefined,
    "a constructed resident ref alone cannot manufacture an inspected world actor");
  assert.equal(popupFocusHalfHeight(`resident:${place.id}:37`, 10), RESIDENT_OBSERVE_HALF_HEIGHT,
    "an explicit inspect-close action must actually show the physical person rather than a 300m-wide map");
  assert.ok(RESIDENT_OBSERVE_HALF_HEIGHT > 0.18, "camera stays above the existing minimum zoom");
  assert.equal(popupFocusHalfHeight(`resident:${place.id}:37`, 10, 1080), .421875,
    "landscape narrows only the camera to retain portrait physical actor readability");
  assert.equal(popupFocusHalfHeight(`resident:${place.id}:37`, 10, 1920), RESIDENT_OBSERVE_HALF_HEIGHT,
    "portrait keeps the already-proven actual actor size");
  assert.equal(popupFocusHalfHeight(`home:${place.id}:37`, 10, 1080), 10,
    "owned-door and ordinary navigation do not change with viewport height");
});
