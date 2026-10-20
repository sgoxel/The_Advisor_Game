import { finalSurfaceAt } from "./world-core.ts";

/**
 * Focus-only proof of the actual Simulation-valid deck at a listed river crossing.
 * A coarse transport crossing record alone never certifies legal bridge traversal.
 */
export function transportBridgeSurfaceAt(x: number, z: number) {
  const surface = finalSurfaceAt(x, z);
  return Object.freeze({
    centerDeckWalkable:
      surface.water.kind === "river" &&
      surface.deckHeight !== null &&
      surface.walkable &&
      surface.traversal === "bridge",
    deckHeight: surface.deckHeight,
    waterKind: surface.water.kind,
    traversal: surface.traversal,
  });
}
