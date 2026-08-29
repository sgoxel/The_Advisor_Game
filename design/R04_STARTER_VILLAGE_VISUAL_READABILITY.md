# R04 Starter Village Visual Readability Specification

Issue: #243  
Role owner: Designer  
Phase: R04  
Authority boundary: placement, building identity/type, footprint, entrance, roads/paths, terrain and occupancy remain Simulation-backed. This document defines presentation only.

## Goal

At normal gameplay zoom, the authoritative origin region must immediately read as an inhabited medieval-fantasy starter village rather than an abstract patch of generic settlement terrain. The full canonical 100 x 100 region remains visible and meaningful; presentation must reveal the generated settlement structure without inventing a second layout.

## Visual hierarchy

Use three readable layers, all derived from authoritative state:

1. **Settlement silhouette** — grouped roofs/building masses and farm/service zones make inhabited space visible before individual details are read.
2. **Movement network** — roads, paths and entrances remain continuous and visually stronger than incidental ground texture so players can understand how structures connect.
3. **Character/activity layer** — approved world-icon PNGs and development bubbles remain legible above structures without being hidden by roofs or decorative props.

Surrounding forest, water, fields and open terrain should frame the village rather than visually compete with its inhabited core.

## Building treatment by authoritative type

The renderer should map an existing authoritative building descriptor to a small visual family. It must not invent a type or change a footprint.

- **Home / dwelling:** warm timber-and-plaster or timber roof mass, modest chimney/door cue, domestic scale.
- **Inn / tavern / lodging:** larger readable roof mass, hanging-sign or porch cue, warm entry emphasis.
- **Hall / landmark / civic building:** stronger roofline, broader entrance frontage, slightly higher visual prominence.
- **Food / shop / market:** stall, awning or frontage cue inside/along the authoritative footprint; keep road-facing entrance readable.
- **Smithy / workshop / production:** darker roof/material contrast and work-yard cue where footprint permits; no invented machinery or resource state.
- **Guard / service:** restrained defensive/service cue such as banner, rack or compact watch element without implying unsupported fortification.
- **Farm / mill / agricultural:** cultivated-ground or yard treatment within authoritative area; a mill silhouette only when the authoritative type actually represents one.
- **Storage:** simple barn/storehouse mass with large door cue.

Unknown/fallback authoritative types use a neutral inhabited-building treatment rather than disappearing into generic ground color.

## Footprint and entrance rules

- Every visible building mass must stay inside its authoritative footprint.
- Entrance emphasis is anchored to the authoritative entrance tile/edge.
- Roof or facade overhang may be cosmetic, but hit/selection/occupancy logic remains tied to authoritative tiles.
- Visual masses may span multiple tiles to communicate the real footprint; do not reduce large buildings to one icon token.
- Roads and paths must remain visible through or immediately up to entrance connections.
- Do not paint structures over authoritative water, blocked terrain or unrelated road cells.

## Spatial distribution across the 100 x 100 region

The whole origin region should communicate settlement geography at normal zoom. Do not create a second central decorative cluster.

- Render every authoritative starter-village building that is relevant at the current map scale.
- Preserve natural gaps, fields, yards and terrain between building groups.
- Use authored type/size contrast to create several readable sub-areas when the generated distribution supports them: residential, service/market, production/agricultural and landmark/social zones.
- Roads/paths provide the primary visual connective tissue across those sub-areas.
- If generation produces sparse edges, preserve that truth; improve readability through structure silhouettes, paths and terrain contrast rather than relocating content.

## Camera-scale behavior

### Normal gameplay zoom

This is the acceptance-critical view. Individual structure masses, primary entrances/roads and key type differences must be discernible without opening inspection UI.

### Zoomed out

- Collapse fine facade details before collapsing building silhouettes.
- Keep roof/building masses distinct from bare settlement terrain.
- Retain road/path continuity and landmark-scale cues.
- Character PNG icons remain above building presentation according to the independently governed #228 scale behavior.

### Zoomed in

- Additional facade/yard accents may appear if inexpensive.
- Do not expose details that imply unsupported inventory, occupancy, production or ownership facts.

## Layering and occlusion

Recommended presentation order:

1. terrain/base ground;
2. fields/yards/low footprint treatment;
3. roads and paths where not structurally occluded;
4. building bodies/roofs;
5. entrance/sign/low-cost type cues;
6. selection/inspection affordance;
7. NPC/protagonist world icons;
8. activity/dialogue bubbles and accessibility-critical feedback.

Character icons and actionable inspection cues must not become permanently hidden behind structure art. Where isometric overlap occurs, use deterministic screen-space layering/fade/outline treatment rather than changing authoritative positions.

## Old-school RPG presentation direction

Keep the existing grounded medieval-fantasy / old-school PC RPG family:

- readable silhouettes over photoreal detail;
- restrained material palette: timber, plaster, stone, thatch/wood/shingle roof families as appropriate;
- clear edge/value separation between roof, road, field and surrounding terrain;
- modest signs/banners/props as semantic accents, not noisy decoration;
- avoid modern city-builder iconography or dashboard-like floating building tokens.

## Responsive and performance guidance

- Reuse atlased/small presentation assets or CSS/canvas primitives where practical; do not require full-resolution character-like textures for structures.
- Culling may omit off-screen decorative detail but must not alter authoritative building existence.
- Tablet/phone should retain structure silhouettes, roads, icons and inspection targets even when fine decoration is reduced.
- No horizontal page overflow or map-control obstruction may be introduced.
- Touch selection targets and accessibility labels should continue to identify the authoritative building/type where supported.

## Implementation contract for #244

Coder integration should consume existing authoritative `originVillage.buildings` (or its current compatible equivalent) and each building's existing identity/type/footprint/entrance. The presentation mapping must be deterministic and side-effect free.

Minimum implementation evidence should demonstrate:

- at least one generated origin campaign where homes plus multiple service/production/landmark types are visibly distinguishable when those types exist;
- structures span their authoritative logical footprints rather than rendering as dimensionless single points;
- entrance-to-road/path relationships remain visible;
- changing render/device/order does not alter building identity, type or placement;
- rendering does not mutate generated village descriptors or Simulation state;
- desktop, tablet and phone views keep settlement structure readable with world icons and inspection usable.

## Independent verification checklist

A Tester different from the Designer must verify on an exact committed candidate that:

- the origin reads as an inhabited village at normal gameplay zoom;
- authoritative footprints/entrances are visibly respected;
- representative authoritative types are distinguishable without invented placement/facts;
- roads/paths visibly connect the settlement;
- content is meaningfully distributed across the generated 100 x 100 origin rather than replaced by a decorative central cluster;
- character icons, bubbles, selection and accessibility feedback remain readable;
- responsive form factors remain usable and presentation does not mutate Simulation state.
