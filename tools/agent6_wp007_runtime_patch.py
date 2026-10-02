#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/world/planet-stage.js')
text=p.read_text(encoding='utf-8')

old_tier='''function settlementRevealTierForScalar(value=zoomState.scalar){
  const scalar=clamp(Number(value)||0,ZOOM_MIN,ZOOM_MAX);
  const requestedLevel=String(localResources.requestedLevel||LOCAL_DETAIL_LEVELS[requestedLodIndexForZoom(scalar)]?.id||"");
  const rawIndex=rawLodIndexForZoom(scalar),level=LOCAL_DETAIL_LEVELS[rawIndex]||LOCAL_DETAIL_LEVELS[0];
  // Semantic/local-world eligibility follows the requested physical scale, not
  // a retained terrain resource. A ready close-detail parent may remain visible
  // temporarily to guarantee terrain coverage, but it must never keep village
  // props, residents or decorative layers alive after zoom has returned to a
  // regional/strategic scale.
  if(requestedLevel==="ground"||level?.id==="ground")return "full";
  if(level?.staticWorld){
    const staticTier=staticSettlementRevealTierForIndex(rawIndex);
    if(staticTier!=="none")return staticTier;
  }
  return semanticLayerSpec(semanticScaleIndexForScalar(scalar),false).settlementRevealTier;
}'''
new_tier='''function settlementRevealTierForScalar(value=zoomState.scalar){
  const scalar=clamp(Number(value)||0,ZOOM_MIN,ZOOM_MAX);
  // WP-S003-010-003-007: settlement meaning is revealed by canonical zoom
  // position, not by whichever terrain SLOD happens to own the viewport. This
  // keeps the same StartingVillage identity visible through asynchronous parent/
  // child swaps and restores the intended physical progression before ground.
  if(scalar>=.985)return "full";
  if(scalar>=.940)return "refined";
  if(scalar>=.880)return "coarse";
  if(scalar>=.750)return "route";
  if(scalar>=.630)return "footprint";
  return "none";
}'''
if text.count(old_tier)!=1:
    raise SystemExit(f'tier anchor count={text.count(old_tier)}')
text=text.replace(old_tier,new_tier,1)

old_visibility='''    const coverageDims=displayResource?.dims||dims;
    const finePatchCoversViewport=Number(coverageDims.patchHeight||0)>=shownHeightMeters*1.02&&Number(coverageDims.patchWidth||0)>=shownHeightMeters*viewportAspect*1.02;
    tangentPatch.enabled=fineVisible&&finePatchCoversViewport&&(!mapScaleShell||mapShellOut>.02);
    localResources.foregroundPatchCoversViewport=finePatchCoversViewport;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);'''
new_visibility='''    const coverageDims=displayResource?.dims||dims;
    const finePatchCoversViewport=Number(coverageDims.patchHeight||0)>=shownHeightMeters*1.02&&Number(coverageDims.patchWidth||0)>=shownHeightMeters*viewportAspect*1.02;
    // Terrain coverage and canonical local-world children have separate visual
    // ownership. Hiding the whole tangent entity to protect an undersized child
    // also hid the valid settlement presentation and caused the .985 -> 1.00
    // disappearance/pop. Keep the transform container alive for eligible local
    // semantics while disabling only the foreground terrain renderer.
    const fineTerrainVisible=fineVisible&&finePatchCoversViewport&&(!mapScaleShell||mapShellOut>.02);
    const localPresentationVisible=localWorldPresentationEligibility().visible;
    tangentPatch.enabled=fineVisible||localPresentationVisible;
    if(tangentPatch.render)tangentPatch.render.enabled=fineTerrainVisible;
    localResources.foregroundPatchCoversViewport=finePatchCoversViewport;
    localResources.foregroundPatchVisible=fineTerrainVisible;
    const patchScale=Math.max(1e-6,visibleHeightUnits*dims.metersPerUnit/shownHeightMeters);'''
if text.count(old_visibility)!=1:
    raise SystemExit(f'visibility anchor count={text.count(old_visibility)}')
text=text.replace(old_visibility,new_visibility,1)

p.write_text(text,encoding='utf-8')
print('patched WP007 scalar reveal progression and child-safe tangent visibility')
