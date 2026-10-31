/** Scene-depth confirmation of an existing Simulation-backed 2D actor hit.
 * The real PlayCanvas ID/depth picker is authoritative for rendered pixels:
 * a projected 44px touch target never makes an actor pickable through a wall.
 * View depths are negative in front of the camera; larger means nearer.
 * This function cannot assign actor identity, route, position or world truth. */
export function residentGpuHitAllows(
  actorViewDepth: number, nearestViewDepth: number | null,
  actorMeshes: readonly object[], renderedSelection: readonly object[],
  exactPixelSelection: readonly object[] = [],
  worldWithoutResidentsDepth: number | null = null,
  opaqueWorldAtPixel = false,
): boolean {
  if (!Number.isFinite(actorViewDepth) || actorViewDepth >= 0 ||
      !actorMeshes.length || !renderedSelection.some(mesh => actorMeshes.includes(mesh)))
    return false;
  // Resident quads can win the ordinary pick pass where their lower body
  // is visually covered by a solid roof. The second real GPU pass excludes
  // only resident IDs: a nearer opaque world surface always rejects the tap.
  if (worldWithoutResidentsDepth !== null &&
      (!Number.isFinite(worldWithoutResidentsDepth) ||
       worldWithoutResidentsDepth >= 0 ||
       worldWithoutResidentsDepth > actorViewDepth + 0.035)) return false;
  // The world-only ID is real geometry from the same GPU pass. A roof or
  // wall ID with no readable depth is unknown occlusion, not empty sky.
  // Do not apply this conservative fallback to background terrain.
  if (worldWithoutResidentsDepth === null && opaqueWorldAtPixel) return false;
  // On opaque world geometry, a non-resident exact-pixel ID takes precedence
  // over the broad 44px accessibility hit area. A projected guard body may
  // be near the tap but behind a solid roof, even when its estimated depth
  // is nearer than the separately rendered world picker point.
  if (opaqueWorldAtPixel && exactPixelSelection.length > 0 &&
      !exactPixelSelection.some(mesh => actorMeshes.includes(mesh))) return false;
  // A missing depth sample is not proof of empty sky. The original real
  // WebGL2 wall click reproduced a null-depth hole even while an opaque wall
  // had an ID at that exact pixel. Accept sky padding only when there is
  // genuinely no foreground ID, or the resident itself owns that pixel.
  if (nearestViewDepth === null)
    return exactPixelSelection.length === 0 ||
      exactPixelSelection.some(mesh => actorMeshes.includes(mesh));
  if (!Number.isFinite(nearestViewDepth) || nearestViewDepth >= 0) return false;
  // Depth buffer and render/screen projection can differ by small precision
  // errors near a coplanar foot; an actual wall has positive front separation.
  return nearestViewDepth <= actorViewDepth + 0.035;
}
