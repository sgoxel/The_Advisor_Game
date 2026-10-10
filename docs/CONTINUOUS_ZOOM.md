# Continuous surface presentation — WP-S002-004-010

Canonical material identity and base albedo are coordinate-only. `terrainTint` has
the same result for every tile size, uses the composed elevation and preserves
existing river/road/settlement edits. It never switches palette, noise frequency
or edit eligibility at a mesh-size threshold. Climate/ownership, generation,
simulation, traversal and feature IDs remain outside presentation state.

Local display-RGB vertex colors are explicitly gamma-decoded, matching the
globe's RGBA8 texture decode. Terrain uses an emissive, unlit surface on both
representations, with unit exposure and no terrain fog, specular, tone mapping
or independently baked globe illumination. Props retain their existing lighting
and shadows, with display-RGB decoding enabled. Geometry and canonical material
variation still convey landforms; this change deliberately removes mesh-normal
dependent ground brightness, which changed when mesh resolution changed.

One 1024×512 RGBA8 surface texture and mip chain are shared by globe and local
terrain. Generation occurs once in a worker, beginning at Province scale. The
previous valid surface remains visible until it is ready. There is no preview
texture replacement, per-frame texture recreation or additional world authority.
Between half-heights 70 and 900, a smooth logarithmic weight blends the shared
filtered texture with canonical fine vertex detail in linear light. Country and
globe use the same texture. Readiness only eases the presentation weight; it
cannot alter material identity or albedo. The sky backdrop/halo retain the
existing continuous globe handoff; the terrain endpoints have compatible color.

Canonical texture UVs are generated before patch-relative Float32 conversion,
transferred with the terrain payload and counted in cache bytes. They preserve
0/1 at the longitude seam and clamp at poles. Wide terrain evaluates one shared
ENU projection from these canonical UVs, removing gaps between independently
rotated patch tangent planes. Fine views retain precise patch-relative ENU
geometry; the projection correction blends with the same continuous detail
weight. Generation/picking continue to use canonical coordinates.

Tile replacements retain outgoing coverage for at most 240 ms after incoming
coverage is ready. Complementary pixel coverage smoothly replaces both terrain
and props without alpha-stacking skirts or drawing duplicate features at the
same pixel. Common tiles remain fully visible. The selector reserves half the
active patch budget for each coverage set; the coarse safety root fits in the
remaining slot. Retained tiles are protected from eviction until the blend ends.
No replacement starts a second overlapping blend. Unchanged material shader
settings are not rebuilt while zooming; only presentation uniforms change.
During globe handoff, the ground geometry continuously morphs from its flat
projection to the globe's same faceted sphere, using the shared sphere segment
counts, triangle interpolation and texture. Relief fades with that morph. The
ground stays opaque, preventing translucent skirt bands and avoiding a noisy
cross-fade between geographically misregistered surfaces. The existing
halo/backdrop still ease continuously. Prop coverage fades separately.

## Regression evidence

`tests/zoom-fixtures.json` holds reproducible grassland, desert, forest, snowy
mountain and coast coordinates for the release seed. `tools/zoom-fixtures.mjs`
reconstructs them from canonical climate/composed elevation. The browser test
retains focus, material ID, base albedo and lighting settings across the named
Country regression, all local tile-size thresholds (2–4096 source units), detail
filter endpoints and both handoff endpoints. It also visits both seam approaches
and poles, verifies unique keys/cache budgets and captures desktop Country,
handoff and globe views. The two backend suites use the same tests.

Adjacent frames differ by 0.2% in zoom. The stable-ground gate excludes new props
and labels and measures the right-centre ground crop, away from phone controls.
An 8-pixel box filter tolerates tiny geometry/detail motion. The CIELAB DeltaE76
budget is mean ≤2 and p95 ≤5; newly strengthened edge contrast is ≤3 Lab units.
Only an eight-pixel neighbourhood of pre-existing strong contours (>2 Lab units
per pixel after filtering) is excluded from stable-ground color measurements;
at least 40% of the crop must remain. Newly introduced block edges stay in the
gate. An independent symmetric contour check permits at most 5% of strong edge
pixels to move beyond that eight-pixel neighbourhood. This allowance was
calibrated from actually inspected Street/Village coast pairs: fine shoreline
geometry changes a few edge pixels while land/water color families remain fixed.
It still rejects the earlier snow-band shift at Country (mean DeltaE76 3.64,
p95 14.94 and contour mismatch 95.4% on the retained failed WebGPU evidence).
This equivalent perceptual metric rejects broad dark-green→pale-green palette
replacement (tens of Lab units), while permitting gradual detail refinement.
`tools/verify-zoom-images.py` records every pair and fails on a budget violation.
These are product regression targets, not physical-device performance claims.

Fresh production-UI captures use the `zoom-country` screenshot-tool scenario.
Installed Windows Chromium channels can be selected with `--browser-channel
msedge` (or `chrome`) to use their native adapter. Explicit WebGL2 requests hide
the WebGPU API before boot; capture metadata records the actual backend/channel.
The validation workflow retains screenshots, sampled inputs and metric results
for actual visual inspection. Automated measurements do not assign visual scores.

## Accepted evidence — 2026-10-10, Agent #2

Native Edge validated the unchanged final game source at 7e99baf: 91 unit tests,
build, 12 WebGL2 browser cases and all 10 unique WebGPU cases. The first WebGPU
suite had a test timing race in landscape reversal; sampling the baseline and
dispatching the wheel event atomically fixed the test, and all three affected
viewport cases passed on rerun. No game behavior changed for that test fix.
Both zoom regressions produced 131 pairs, all 262 passed, maximum stable-ground
mean DeltaE76 0.305. All 131 canonical focus sample fingerprints matched between
backends. The comparator rejects both the synthetic broad palette/block fixtures
and the retained earlier snow-band failure. Fresh production-UI and representative
biome/LOD, pole/wrap and rebase captures on both backends were actually inspected:
VISUAL 8/10. Coarse texture/coast approximation is visible; there is no major
palette replacement, patch grid or inverted/duplicated surface in accepted views.
Linux jobs remain supplemental cross-platform checks; no physical-device speed
claim is made. Evidence is retained in the accepted temporary artifact folder.
