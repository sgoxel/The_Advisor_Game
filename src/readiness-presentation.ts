/** Only presentation labels. SEED, terrain and Simulation own their own readiness. */
export function terrainProgressText(percent: number): string {
  return `Terrain ${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

/** 100% is coherent terrain, not an invented completed resident interaction. */
export function terrainLoadingMessage(percent: number, regularMessage: string): string {
  return percent >= 100
    ? "Terrain ready. Resident information loads separately."
    : regularMessage;
}

/** Pending means the exact current-view authoritative query has not completed. */
export function residentFactSuffix(requested: boolean, ready: boolean): string {
  if (!requested) return "";
  return ready ? " · residents ready" : " · residents pending";
}

/** Rendered terrain is not fully detailed just because a coarse preview exists. */
export function terrainDetailLabel(coherent: boolean, currentDetailSettled: boolean): string {
  if (!coherent) return "preparing terrain";
  return currentDetailSettled ? "ready" : "refining detail";
}

/** The initial 100% milestone is the first genuinely usable current view,
 * not merely an available coarse terrain preview. Keep player access open
 * while authoritative resident facts and required fine geometry settle. */
export function initialWorldReady(
  coherentTerrain: boolean,
  requiredDetailSettled: boolean,
  residentFactRequested: boolean,
  residentFactReady: boolean,
): boolean {
  return coherentTerrain && requiredDetailSettled &&
    (!residentFactRequested || residentFactReady);
}
