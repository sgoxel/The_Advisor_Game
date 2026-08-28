# R02-T13 Region Continuity Presentation Contract

Issue: #108  
Role: Designer  
Authority boundary: presentation only. Simulation-owned region coordinates, generated terrain and persistent deltas remain authoritative.

## Visual objective

The strategic map must read as a local camera window into one continuous SEED world. A player may see only the currently active tile area, but the composition must never imply that the visible rectangle is the complete world or a finite board.

## Terrain language

Use the existing terrain families as a coherent material system rather than isolated stamps:

| World signal | Presentation treatment | Continuity rule |
| --- | --- | --- |
| Grass / temperate ground | broad low-contrast base with subtle value variation | variation crosses region edges without a reset line |
| Dirt / warm-dry ground | irregular soft transition bands, not rectangular patches | edge continuation follows generated neighboring samples |
| Forest | clustered canopy rhythm with variable density and softened fringe | clusters may enter/leave the viewport at any edge; never trim into a straight wall |
| Mountain / high elevation | stepped relief, stronger shadow and texture scale | elevation shading derives from neighboring samples so ridges do not stop at region boundaries |
| Lake / river | continuous water surface language; rivers preserve direction and width cues | water meeting an edge must visually continue when the adjacent region becomes active |
| Road | narrow readable route with consistent width hierarchy | road endpoints at an active-region edge are continuation cues, never dead ends unless Simulation says so |

## Region-edge presentation

1. Do not draw region borders, bounding boxes, outer frames, edge labels, fog walls or map-end decoration around generated regions.
2. Keep edge tiles rendered with the same material, lighting and elevation treatment as interior tiles.
3. When neighboring region data is available, use one-tile visual neighbor context for edge normals/blending so relief and material transitions do not expose the data partition.
4. If neighboring data is not yet available, use only the current edge sample for presentation. Do not invent authoritative terrain beyond the active data.
5. Region activation should preserve camera continuity. Avoid full-map flash/reset, recentering or a visually obvious rectangular replacement.
6. Any loading cue belongs to UI chrome and must not masquerade as terrain or a physical world boundary.

## Diversity and repetition control

Representative distant regions should differ in terrain balance, elevation rhythm, moisture/temperature character and route/water arrangement while keeping the same art direction. Repetition checks should look for copied 24×24 silhouettes, repeated edge strips, identical forest/mountain clusters and synchronized water/road bends. Presentation may add deterministic micro-variation keyed to authoritative tile identity, but must not alter terrain class, collision, route truth or Simulation state.

## Elevation and biome transitions

Use continuous light direction and relief scale across the active world window. Blend material edges over a narrow screen-space range so transitions are legible without erasing tile identity. Avoid a separate per-region light rig, color grade or texture scale. Biome shifts should be gradual where neighboring authoritative samples are gradual; abrupt authoritative transitions may remain abrupt but must not acquire a rectangular region outline.

## Camera/window cues

The map camera is the cue that the player is viewing part of a larger world. Preserve pan/zoom language and allow terrain features to leave the viewport naturally. Do not add a mini-board outline around the active generated area. Minimap treatment should likewise show the known/local context without an iconography implying an outer world edge.

## Responsive behavior

### Desktop
- Preserve the map as the dominant surface.
- Terrain textures and route/water lines must remain distinguishable at normal strategic zoom.
- Edge continuity should be inspectable while panning without persistent region-debug overlays.

### Tablet
- Maintain the same material hierarchy with reduced nonessential micro-detail.
- Minimum route/water visual weight must survive common device scaling.
- UI overlays must not cover all four map edges simultaneously.

### Phone
- Favor terrain-class silhouette, route/water continuity and protagonist/local-context readability over fine texture noise.
- Suppress purely decorative micro-variation before reducing functional route/water contrast.
- Keep the visible world window useful behind mobile panels; no added region frame is permitted.

## Accessibility

- Terrain meaning cannot rely on hue alone. Texture, value, silhouette and line structure differentiate water, road, forest and mountain classes.
- Maintain readable value separation between road and adjacent ground and between water and land under reduced color perception.
- Focus/status UI remains outside terrain and uses text/icon semantics rather than color-only state.
- Reduced-motion preferences remove nonessential transition animation; continuity must remain understandable from static frames.

## WebGL/performance budget

- Reuse existing texture/material atlases and batching where possible.
- Prefer deterministic shader/material variation and shared geometry over unique per-region assets.
- Neighbor-context blending should be a small fixed data margin, not simultaneous rendering of an unbounded number of regions.
- Region transitions must not require rebuilding unrelated UI or all historical world regions.
- Presentation caches are disposable and reconstructible from Simulation-owned base state plus deltas.

## Integration acceptance references

Later Coder/Designer integration should demonstrate at minimum:

- origin plus north/east/south/west neighboring region transitions;
- one negative-coordinate transition;
- a water feature and a road or elevation feature crossing a region boundary;
- two distant coordinate samples with visibly different terrain composition;
- desktop, tablet and phone captures showing no finite-map frame or rectangular reset;
- static/non-color-only readability and reduced-motion behavior;
- no presentation cache values written back as authoritative region coordinates or terrain state.

This contract deliberately does not prescribe terrain generation algorithms or persistent world-delta rules; those remain Coder/Simulation responsibilities in their owning R02 tasks.
