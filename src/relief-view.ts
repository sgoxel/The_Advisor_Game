/**
 * Pure camera-facing rule for the "Terrain relief" inspection view.
 *
 * Samples eight points on a ring around the focus and derives the uphill
 * direction from the height differences. The camera is placed on the downhill
 * side so the slope or cliff face is seen rising away from it, instead of the
 * camera sitting on the plateau and looking over the rim.
 *
 * Camera offset convention is (sin yaw, cos yaw), as in `applyPresentation`
 * in src/main.ts, so the returned yaw points the camera opposite the uphill
 * direction. The camera turns only when the sampled rise fits inside
 * `maxRiseMetres` (the visible frame height), otherwise it keeps `currentYaw`.
 */
export function reliefFacingYaw(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
  currentYaw: number,
  minRiseMetres = 10,
  maxRiseMetres = Infinity,
): number {
  const centre = heightAt(x, z);
  let minH = centre, maxH = centre;
  let gx = 0, gz = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4,
      sx = Math.sin(a),
      sz = Math.cos(a),
      h = heightAt(x + sx * radius, z + sz * radius);
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
    gx += (h - centre) * sx;
    gz += (h - centre) * sz;
  }
  // A wall taller than the visible frame seen head-on fills the view with
  // uniform rock (no rim, no foot), so keep the current yaw in that case.
  if (maxH - minH < minRiseMetres || maxH - minH > maxRiseMetres || Math.hypot(gx, gz) < 1e-9)
    return currentYaw;
  let yaw = Math.atan2(-gx, -gz);
  if (yaw <= -Math.PI) yaw += 2 * Math.PI;
  return yaw;
}
