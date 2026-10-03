#!/usr/bin/env python3
from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
updated = text


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"WP006 {label}: expected 1 anchor, found {count}")
    return source.replace(old, new, 1)

# Attempt 1 for the 2026-10-03 12:26 +03 run.
# Prior evidence proved that a separately painted 6x medium continuation remains
# visible as a finite high-frequency island when the 1x child is intentionally
# suppressed. Use one outer parent as the sole viewport owner in that state,
# while retaining the medium ring for cases where the outer parent cannot cover
# or the fine child already owns the viewport. Raise only the outer parent's
# bounded source resolution so removing the medium island does not collapse the
# viewport into the previous low-frequency blur.
updated = replace_once(
    updated,
    'const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.90;\nconst LOCAL_SURROUND_RING_TEXTURE_SCALE=.58;',
    'const LOCAL_MEDIUM_RING_TEXTURE_SCALE=.90;\nconst LOCAL_SURROUND_RING_TEXTURE_SCALE=.58;\nconst WP006_SINGLE_PARENT_MAX_LEVEL=8;\nconst WP006_SINGLE_PARENT_OUTER_TEXTURE_SCALE=.86;',
    "single-parent constants",
)

updated = replace_once(
    updated,
    '  const surroundSize=Math.max(96,Math.round(size*LOCAL_SURROUND_RING_TEXTURE_SCALE));',
    '  const surroundSize=Math.max(96,Math.round(size*(job.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL?WP006_SINGLE_PARENT_OUTER_TEXTURE_SCALE:LOCAL_SURROUND_RING_TEXTURE_SCALE)));',
    "outer continuation source resolution",
)

updated = replace_once(
    updated,
    '    localResources.foregroundPatchVisible=fineTerrainVisible;\n    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);',
    '    localResources.foregroundPatchVisible=fineTerrainVisible;\n    // WP-006 single-parent ownership: when the fine child cannot cover the\n    // viewport but the bounded outer continuation can, painting the medium\n    // continuation creates a second finite-frequency island. Let the outer\n    // parent own that frame alone. Retain medium coverage when it is actually\n    // needed, or once the fine child already covers the viewport and its edge\n    // refinement can safely blend over the parent family.\n    const singleParentContinuation=Boolean(displayResource&&displayResource.levelIndex<=WP006_SINGLE_PARENT_MAX_LEVEL&&!finePatchCoversViewport&&surroundCoversViewport);\n    if(focusRingPatch?.render)focusRingPatch.render.enabled=!singleParentContinuation;\n    localResources.mediumRingPresentationEnabled=Boolean(focusRingPatch?.render?.enabled);\n    localResources.singleParentContinuationActive=singleParentContinuation;\n    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);',
    "single-parent visibility ownership",
)

if updated == text:
    raise SystemExit("WP006 single-parent continuation patch produced no change")
path.write_text(updated, encoding="utf-8")
print("patched WP-S003-010-003-006 to single-parent intermediate continuation ownership")
