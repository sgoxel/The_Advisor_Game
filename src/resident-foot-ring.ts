import { elevationToRenderY } from "./render-frame.ts";

/** A single physical selection ring in the same 3D depth buffer as scenery.
 * Radii and elevation are in canonical metres, NOT source/render units.
 * Every vertex lies 22 cm above the selected actor's real foot anchor.
 * The outer edge clears the illustrated boots so the original grounded person
 * remains identifiable even when other actual residents stand close together.
 * Triangles are presentation only: no collider, resident or source position. */
export function residentFootRingGeometry(segments = 24, innerRadius = 0.42, outerRadius = 0.48) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const footClearance = elevationToRenderY(0.22);
  for (let i = 0; i < segments; i++) {
    const angle = i * 2 * Math.PI / segments;
    for (const radius of [innerRadius, outerRadius]) {
      positions.push(elevationToRenderY(Math.cos(angle) * radius), footClearance,
        elevationToRenderY(Math.sin(angle) * radius));
      normals.push(0, 1, 0);
    }
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments, inner = i * 2, outer = inner + 1,
      nextInner = next * 2, nextOuter = nextInner + 1;
    indices.push(inner, nextInner, outer, outer, nextInner, nextOuter);
  }
  return { positions, normals, indices };
}
