import { test } from "node:test";
import assert from "node:assert/strict";
import { transportNetwork } from "../src/transport-network.ts";

test("player routing consumes every physical S005 road and never treats ferries as walking roads", async () => {
  const { roadSegments } = await import("../src/village-routes.ts");
  const codes = new Set(roadSegments.map((segment) => segment.code));

  for (const edge of transportNetwork.roadEdges) {
    const exact = codes.has(edge.code),
      segmented = [...codes].some((code) => code.startsWith(`${edge.code}/SEG/`));
    assert.ok(
      exact || segmented,
      `${edge.code} must be present in the player-facing traversal road segment authority`,
    );
  }

  for (const ferry of transportNetwork.ferryEdges) {
    assert.ok(
      ![...codes].some(
        (code) => code === ferry.code || code.startsWith(`${ferry.code}/SEG/`),
      ),
      `${ferry.code} must remain maritime and must not become a walking-road segment`,
    );
  }
});
