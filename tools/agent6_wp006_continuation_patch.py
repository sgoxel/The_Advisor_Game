#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
updated = text

anchors = [
    (
        '  const metersPerTexel=Math.max(spanEast,spanNorth)/Math.max(1,size);',
        '  const sourceMetersPerTexel=Math.max(spanEast,spanNorth)/Math.max(1,size);\n  let metersPerTexel=sourceMetersPerTexel;',
        "preserve physical source density",
    ),
    (
        '  const sharedMetersPerTexel=Math.max(job.dims.patchWidth,job.dims.patchHeight)*LOCAL_SURROUND_SPAN_FACTOR/focusTextureSize;\n  // Phase 18 final acceptance: strategic concentric representations must apply',
        '  const sharedMetersPerTexel=Math.max(job.dims.patchWidth,job.dims.patchHeight)*LOCAL_SURROUND_SPAN_FACTOR/focusTextureSize;\n  // WP-006 continuation ownership: at intermediate tiers the medium and outer\n  // layers are coverage for one ready parent, not separate visual LODs. Drive\n  // both through the same physical photometry bandwidth so their finite mesh or\n  // raster boundary cannot appear as a higher-frequency island. Keep the real\n  // sourceMetersPerTexel for density/streaming telemetry and restore native\n  // context refinement only once near-ground resources own the viewport.\n  const unifiedContinuationBasis=contextRing&&job.levelIndex<=8;\n  if(unifiedContinuationBasis)metersPerTexel=sharedMetersPerTexel;\n  // Phase 18 final acceptance: strategic concentric representations must apply',
        "unified intermediate continuation basis",
    ),
    (
        '  return {\n    data,size,metersPerTexel,\n    componentRanges:Object.freeze(roundedRanges),\n    contributorPixels:captureContributorPixels?{revision:"wp020-surface-contributors-v2",layerRole:String(evidenceLayerRole),size,spanEast:Number(spanEast),spanNorth:Number(spanNorth),metersPerTexel:Number(metersPerTexel.toFixed(3)),layers:contributorLayers,probes:Object.freeze(evidenceProbes.slice())}:null,',
        '  return {\n    data,size,metersPerTexel:sourceMetersPerTexel,\n    componentRanges:Object.freeze(roundedRanges),\n    contributorPixels:captureContributorPixels?{revision:"wp020-surface-contributors-v2",layerRole:String(evidenceLayerRole),size,spanEast:Number(spanEast),spanNorth:Number(spanNorth),metersPerTexel:Number(sourceMetersPerTexel.toFixed(3)),layers:contributorLayers,probes:Object.freeze(evidenceProbes.slice())}:null,',
        "truthful density telemetry",
    ),
]
for old, new, label in anchors:
    count = updated.count(old)
    if count != 1:
        raise SystemExit(f"WP006 {label}: expected 1 anchor, found {count}")
    updated = updated.replace(old, new, 1)

if updated == text:
    raise SystemExit("WP006 unified continuation-basis attempt produced no change")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-006 intermediate continuation layers to one photometry basis")
