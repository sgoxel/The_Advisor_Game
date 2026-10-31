/** Actual rendered structural triangles may cover a 2D resident even when
 * the graphics picker cannot return an opaque pixel's ID/depth. This is a
 * single-touch geometry intersection, never Simulation movement/collision. */
export type Point3 = Readonly<{ x: number; y: number; z: number }>;

/** Negative camera depths: the grounded feet can be farther from the eye
 * than the projected painted tap. Structural occlusion must test the full
 * physically occupied resident depth, not stop in transparent sprite padding.
 * Render-only; this never moves the resident or changes Simulation truth. */
export function residentOcclusionReachDepth(paintedTapDepth: number, groundedFootDepth: number): number {
  return Math.min(paintedTapDepth, groundedFootDepth);
}

export function structuralMeshBlocksSegment(
  start: Point3, end: Point3,
  positions: readonly number[], indices: readonly number[],
): boolean {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const segmentLength = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(segmentLength) || segmentLength <= 0) return false;
  // Reuse the existing 3.5cm actor/surface depth tolerance, now in actual
  // ray distance rather than the GPU's occasionally unavailable depth.
  const maxT = 1 - 0.035 / segmentLength;
  if (maxT <= 0) return false;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const ux = positions[b] - ax, uy = positions[b + 1] - ay, uz = positions[b + 2] - az;
    const vx = positions[c] - ax, vy = positions[c + 1] - ay, vz = positions[c + 2] - az;
    const px = dy * vz - dz * vy, py = dz * vx - dx * vz, pz = dx * vy - dy * vx;
    const det = ux * px + uy * py + uz * pz;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-10) continue;
    const inv = 1 / det;
    const tx = start.x - ax, ty = start.y - ay, tz = start.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * uz - tz * uy, qy = tz * ux - tx * uz, qz = tx * uy - ty * ux;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (vx * qx + vy * qy + vz * qz) * inv;
    if (t >= 0 && t < maxT) return true;
  }
  return false;
}
