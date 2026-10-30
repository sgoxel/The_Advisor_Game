/** Scene-depth confirmation of an existing Simulation-backed 2D actor hit.
 * The real PlayCanvas ID/depth picker is authoritative for rendered pixels:
 * a projected 44px touch target never makes an actor pickable through a wall.
 * View depths are negative in front of the camera; larger means nearer.
 * This function cannot assign actor identity, route, position or world truth. */
export function residentGpuHitAllows(
  actorViewDepth: number, nearestViewDepth: number | null,
  actorMeshes: readonly object[], renderedSelection: readonly object[],
): boolean {
  if (!Number.isFinite(actorViewDepth) || actorViewDepth >= 0 ||
      !actorMeshes.length || !renderedSelection.some(mesh => actorMeshes.includes(mesh)))
    return false;
  // No first-surface pixel (for example a touch-padding point over sky)
  // cannot occlude the actual painted resident proven by the nearby ID read.
  if (nearestViewDepth === null) return true;
  if (!Number.isFinite(nearestViewDepth) || nearestViewDepth >= 0) return false;
  // Depth buffer and render/screen projection can differ by small precision
  // errors near a coplanar foot; an actual wall has positive front separation.
  return nearestViewDepth <= actorViewDepth + 0.035;
}
