import { elevationToRenderY } from "./render-frame.ts";

/** A single physical selection ring in the same 3D depth buffer as scenery.
 * Radii and elevation are in canonical metres, NOT source/render units.
 * Every vertex lies 22 cm above the selected actor's real foot anchor.
 * Triangles are presentation only: no collider, resident or source position. */
// The original real WebGL2 portrait and landscape pixels showed the near
// 32-38 cm band, but the wider 48-60 cm band disappeared in both original
// PR #804 captures (despite "shown=true" mesh-state telemetry). Keep the
// narrow proven-visible witness as well as the wider ground halo, in ONE
// depth-tested mesh on the same real resident foot. Never fake screen pixels.
export function residentFootRingGeometry(segments = 32) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const footClearance = elevationToRenderY(0.22);
  // The inner band's visibility is backed by original WebGL2 captures;
  // the outer band's absence can no longer erase all foot selection pixels.
  for (const [innerRadius, outerRadius] of [[0.32, 0.38], [0.48, 0.60]]) {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const angle = i * 2 * Math.PI / segments;
      for (const radius of [innerRadius, outerRadius]) {
        positions.push(elevationToRenderY(Math.cos(angle) * radius), footClearance,
          elevationToRenderY(Math.sin(angle) * radius));
        normals.push(0, 1, 0);
      }
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = base + i * 2, b = base + next * 2;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, indices };
}
