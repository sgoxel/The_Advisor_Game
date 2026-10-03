from pathlib import Path

path = Path("scripts/world/planet-stage.js")
text = path.read_text(encoding="utf-8")
old = '''    // Terrain coverage and canonical local-world children have separate visual
    // ownership. Hiding the whole tangent entity to protect an undersized child
    // also hid the valid settlement presentation and caused the .985 -> 1.00
    // disappearance/pop. Keep the transform container alive for eligible local
    // semantics while disabling only the foreground terrain renderer.
    // The focus mesh is a bounded 1x child, not a viewport-sized replacement.
    // Medium and outer rings provide complete coverage beneath its feathered
    // edge, so hiding the child until it alone covers the viewport suppresses
    // every higher-density LOD during the exact zoom range meant to reveal it.
    const fineTerrainVisible=fineVisible&&(!mapScaleShell||mapShellOut>.02);
'''
new = '''    // Terrain coverage and canonical local-world children have separate visual
    // ownership. Keep the tangent transform container alive for eligible local
    // semantics, but let only a viewport-covering fine terrain child take over
    // from the already-ready world-matched medium/outer parents beneath it.
    // This preserves local buildings/roads while an undersized 1x focus child is
    // ready, and prevents its feathered footprint from reading as a rectangular
    // LOD ownership boundary during continuous zoom.
    const fineTerrainVisible=fineVisible&&finePatchCoversViewport&&(!mapScaleShell||mapShellOut>.02);
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one WP-006 ownership block, found {count}")
path.write_text(text.replace(old, new), encoding="utf-8")
