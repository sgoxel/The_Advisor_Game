#!/usr/bin/env python3
from pathlib import Path

p = Path('scripts/world/planet-stage.js')
text = p.read_text(encoding='utf-8')

old_scale='''function revealPresentationScale(dims,tier,coreDiameterMeters,visibleHeightMeters=zoomState.visibleFootprintHeightMeters){
  if(tier==="full")return 1;
  // WP-S003-010-003-007: the coarse settlement envelope must remain readable
  // in screen space across terrain-resource swaps while preserving the exact
  // canonical plan underneath it. Terrain patch dimensions vary by LOD, so they
  // cannot be used as a stable presentation scale reference.
  const targetFraction=tier==="footprint"?.24:tier==="route"?.34:tier==="coarse"?.42:.42;
  const visibleHeight=Number(visibleHeightMeters),referenceHeight=Number.isFinite(visibleHeight)&&visibleHeight>0?visibleHeight:Number(dims.patchHeight||0);
  const desiredSpan=Math.max(coreDiameterMeters,referenceHeight*targetFraction);
  const cap=tier==="footprint"?750:tier==="route"?600:tier==="coarse"?90:18;
  return Number(clamp(desiredSpan/Math.max(1,coreDiameterMeters),1,cap).toFixed(4));
}'''
new_scale='''function revealPresentationScale(dims,tier,coreDiameterMeters){
  if(tier==="full")return 1;
  // WP-S003-010-003-007: keep overview sizing bound to the prepared world
  // resource so apparent village size remains stable across a resource handoff.
  // Only the coarse tier gets a modest readability lift before refined 1:1 detail.
  const targetFraction=tier==="footprint"?.16:tier==="route"?.17:tier==="coarse"?.33:.22;
  const desiredSpan=Math.max(coreDiameterMeters,dims.patchHeight*targetFraction);
  const cap=tier==="footprint"?400:tier==="route"?200:tier==="coarse"?90:18;
  return Number(clamp(desiredSpan/Math.max(1,coreDiameterMeters),1,cap).toFixed(4));
}'''
if text.count(old_scale) != 1:
    raise SystemExit(f'revealPresentationScale anchor count={text.count(old_scale)}')
text = text.replace(old_scale, new_scale, 1)

old_call='  const scale=revealPresentationScale(dims,tier,Number(village.approximateCoreDiameterMeters||104),zoomState.visibleFootprintHeightMeters);'
new_call='  const scale=revealPresentationScale(dims,tier,Number(village.approximateCoreDiameterMeters||104));'
if text.count(old_call) != 1:
    raise SystemExit(f'revealPresentationScale call anchor count={text.count(old_call)}')
text = text.replace(old_call, new_call, 1)

old_count='  const targetCount=tier==="footprint"?Math.min(ordinary.length,8):tier==="route"?Math.min(ordinary.length,6):tier==="coarse"?Math.min(ordinary.length,10):(tier==="refined"||tier==="full"?ordinary.length:0);'
new_count='  const targetCount=tier==="footprint"?Math.min(ordinary.length,8):tier==="route"?Math.min(ordinary.length,6):tier==="coarse"?ordinary.length:(tier==="refined"||tier==="full"?ordinary.length:0);'
if text.count(old_count) != 1:
    raise SystemExit(f'coarse targetCount anchor count={text.count(old_count)}')
text = text.replace(old_count, new_count, 1)

p.write_text(text, encoding='utf-8')
print('patched WP007 final world-matched reveal continuity and complete coarse footprint')
