import { test } from "node:test";
import assert from "node:assert/strict";
import {
  surfaceDistance,
  draggedFocus,
  coordinateLabel,
  placeLabels,
  overlaps,
} from "../src/navigation.ts";
import {
  CANONICAL_PLANET_RADIUS,
  lonLatToFlat,
  flatToLonLat,
} from "../src/planet.ts";

test("canonical distances include seam and latitude geometry", () => {
  assert.ok(
    Math.abs(
      surfaceDistance({ lon: 0, lat: 0 }, { lon: Math.PI / 2, lat: 0 }) -
        (CANONICAL_PLANET_RADIUS * Math.PI) / 2,
    ) < 1e-6,
  );
  assert.ok(
    surfaceDistance(
      { lon: Math.PI - 0.001, lat: 0 },
      { lon: -Math.PI + 0.001, lat: 0 },
    ) < 1300,
  );
  assert.ok(
    surfaceDistance({ lon: 0, lat: 1.4 }, { lon: 0.1, lat: 1.4 }) < 11000,
  );
});
test("a centre grab rotates focus by the picked surface distance", () => {
  for (const lat of [0, 0.6, -1.1]) {
    const focus = { lon: 3.1, lat },
      end = { lon: 3.13, lat: lat + 0.01 };
    const next = draggedFocus(focus, focus, end);
    assert.ok(
      Math.abs(surfaceDistance(focus, next) - surfaceDistance(focus, end)) <
        1e-6,
    );
    const flat = lonLatToFlat(next.lon + 2 * Math.PI, next.lat);
    assert.ok(surfaceDistance(next, flatToLonLat(flat.x, flat.z)) < 1e-6);
  }
});
test("label placement keeps eligible anchors, resolves collisions and provides leaders", () => {
  const labels = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    x: 180,
    y: 200,
    width: 90,
    height: 20,
  }));
  const obstacle = { x: 155, y: 175, width: 50, height: 50 };
  const placed = placeLabels(labels, 360, 800, [obstacle]);
  assert.equal(placed.length, labels.length);
  assert.deepEqual(
    placed,
    placeLabels([...labels].reverse(), 360, 800, [obstacle]),
  );
  placed.forEach((p, i) => {
    assert.ok(!overlaps(p.rect, obstacle));
    assert.ok(
      !placed.slice(0, i).some((other) => overlaps(other.rect, p.rect)),
    );
    assert.ok(p.rect.x >= 8 && p.rect.x + p.rect.width <= 352);
    assert.equal(p.leader, Math.hypot(p.endX - p.x, p.endY - p.y) > 4);
  });
});
test("coordinates expose precision and hemispheres", () => {
  assert.match(
    coordinateLabel({ lon: -0.1, lat: 0.1 }, true),
    /\d+\.\d{5}°N · \d+\.\d{5}°W/,
  );
  assert.match(coordinateLabel({ lon: 0.1, lat: -0.1 }, false), /\d+\.\d{4}°S/);
});
