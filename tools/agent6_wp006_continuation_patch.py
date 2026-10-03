#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")

MARKER = "WP006_ATOMIC_VIEWPORT_OWNER_V2"
if MARKER in text:
    print("WP-S003-010-003-006 atomic viewport ownership already current")
    raise SystemExit(0)

old = '''    // WP-006 single-parent ownership: when the fine child cannot cover the
    // viewport but the bounded outer continuation can, painting the medium
    // continuation creates a second finite-frequency island. Let the outer
    // parent own that frame alone. Retain medium coverage when it is actually
    // needed, or once the fine child already covers the viewport and its edge
    // refinement can safely blend over the parent family.
    const singleParentContinuation=Boolean(displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&surroundCoversViewport);
    if(focusRingPatch?.render)focusRingPatch.render.enabled=!singleParentContinuation;
    localResources.mediumRingPresentationEnabled=Boolean(focusRingPatch?.render?.enabled);
    localResources.singleParentContinuationActive=singleParentContinuation;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);'''

new = '''    // WP006_ATOMIC_VIEWPORT_OWNER_V2: a finer registered child may paint only
    // after its own physical coverage contains the entire viewport. Until then,
    // promote the smallest ready parent that truthfully covers the viewport to
    // sole terrain owner. This keeps the higher-density parent when its 6x span
    // is sufficient, falls back to the 12x parent only when necessary, and
    // prevents a finite fine/medium rectangle from being composited over a
    // different-frequency parent. All layers remain canonical, focus-anchored,
    // deterministic presentation resources; Simulation/world coordinates are
    // untouched.
    const atomicMediumOwner=Boolean(displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&mediumRingCoversViewport);
    const atomicOuterOwner=Boolean(displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&!mediumRingCoversViewport&&surroundCoversViewport);
    const atomicParentOwner=atomicMediumOwner||atomicOuterOwner;
    if(tangentPatch?.render)tangentPatch.render.enabled=!atomicParentOwner;
    if(focusRingPatch?.render)focusRingPatch.render.enabled=!atomicOuterOwner;
    localResources.finePatchPresentationEnabled=Boolean(tangentPatch?.render?.enabled);
    localResources.mediumRingPresentationEnabled=Boolean(focusRingPatch?.render?.enabled);
    localResources.singleParentContinuationActive=atomicParentOwner;
    localResources.viewportTerrainOwnerRole=atomicMediumOwner?"medium":atomicOuterOwner?"outer":"fine";
    localResources.viewportTerrainOwnerCoversViewport=atomicMediumOwner?mediumRingCoversViewport:atomicOuterOwner?surroundCoversViewport:finePatchCoversViewport;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);'''

count = text.count(old)
if count != 1:
    raise SystemExit(f"WP006 atomic ownership anchor: expected 1, found {count}")
updated = text.replace(old, new, 1)
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-006 to atomic viewport terrain ownership")
