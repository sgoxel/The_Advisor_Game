/** Cheap anchor-only key: no DOM geometry reads on unchanged-camera frames.
 * Selection IDs remain canonical; camera movement changes the rounded screen
 * anchor exactly as in the existing placement fingerprint. */
export function labelAnchorFingerprint(
  width: number,
  height: number,
  anchors: readonly { id: string; x: number; y: number }[],
): string {
  return JSON.stringify([width, height,
    anchors.map(({ id, x, y }) => [id, Math.round(x), Math.round(y)]),
  ]);
}

/** A font, viewport, panel, safe-area or label-size invalidation must remeasure
 * even when the geographic anchors have not moved. */
export function labelLayoutNeedsMeasurement(
  anchorKey: string,
  previousKey: string,
  geometryDirty: boolean,
): boolean {
  return geometryDirty || anchorKey !== previousKey;
}
