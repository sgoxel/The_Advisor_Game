/** A single physical selection ring in the same 3D depth buffer as scenery.
 * Every vertex lies just above the selected actor's real foot anchor. Its
 * triangles are presentation only: no collider, resident or source position. */
export function residentFootRingGeometry(segments = 24, innerRadius = 0.32, outerRadius = 0.38) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = i * 2 * Math.PI / segments;
    for (const radius of [innerRadius, outerRadius]) {
      positions.push(Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius);
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
