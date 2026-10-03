from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text()
changed = False

if "const readinessResource=" not in text:
    old = "  const nativeVisibleHeight=Math.max(\n    GROUND_FOOTPRINT_HEIGHT_METERS,\n    Number(displayResource.dims?.visibleHeight||displayResource.detail?.visibleHeightMeters||GROUND_FOOTPRINT_HEIGHT_METERS)\n  );"
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one readiness-height anchor, found {text.count(old)}")
    new = "\n".join([
        "  // WP-S003-010-003-014: a completed next-child prewarm is real ready coverage.",
        "  // Let the camera advance far enough to request/swap that cached child; otherwise",
        "  // the parent readiness leash can hold below the child threshold indefinitely.",
        "  let readinessResource=displayResource;",
        "  if(zoomState.animating&&zoomState.targetScalar>zoomState.scalar&&displayResource.levelIndex<LOCAL_DETAIL_LEVELS.length-1){",
        "    const readyChildSignature=localSignatureFor(displayResource.levelIndex+1,zoomState.focusLatitudeRadians,zoomState.focusLongitudeRadians);",
        "    const readyChild=localResourceCache.get(readyChildSignature);",
        "    if(readyChild)readinessResource=readyChild;",
        "  }",
        "  const nativeVisibleHeight=Math.max(",
        "    GROUND_FOOTPRINT_HEIGHT_METERS,",
        "    Number(readinessResource.dims?.visibleHeight||readinessResource.detail?.visibleHeightMeters||GROUND_FOOTPRINT_HEIGHT_METERS)",
        "  );",
    ])
    text = text.replace(old, new, 1)
    changed = True

if "const activePrefetchNeedsNext=" not in text:
    old = '  if(zoomState.targetPrefetchState==="deferred"&&!localJob)requestZoomTargetPrefetch();'
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one target-prefetch continuation anchor, found {text.count(old)}")
    new = "\n".join([
        "  // WP-S003-010-003-014: after the staged child is atomically active, prepare the",
        "  // next canonical child toward the same final target instead of ending prefetch early.",
        '  const activePrefetchNeedsNext=zoomState.targetPrefetchState==="ready"&&!localJob&&displayResource?.signature===zoomState.targetPrefetchSignature&&displayResource.levelIndex<rawLodIndexForZoom(target);',
        '  if((zoomState.targetPrefetchState==="deferred"&&!localJob)||activePrefetchNeedsNext)requestZoomTargetPrefetch();',
    ])
    text = text.replace(old, new, 1)
    changed = True

if changed:
    path.write_text(text)
else:
    print("WP014 progressive readiness patch already present")
