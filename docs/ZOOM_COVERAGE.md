# Zoom-out coverage — owner #105

The previous streamer waited for every fine tile before replacing the old view,
while its single worker consumed a FIFO backlog. Zoom-out could leave an isolated
old square over mismatched coarse terrain for tens of seconds.

The current viewport now gets terrain-only coverage before fine detail. Preview
patches have separate cache keys, an 8x8 base grid and at most four local
subdivision levels at sharp colour boundaries (maximum 16,384 quads per patch).
Canonical composed height, water and natural colour are shared with fine ground;
sub-texel rivers are filtered by their coarse footprint. Optional surface
refinement, properties, fine roads and vegetation are deferred. Normal detailed
mesh generation remains unchanged.

One job is posted to the worker at a time. Each completion chooses from the
current view: emergency root, missing preview, then missing fine detail. An
executing job cannot be interrupted; obsolete queued work is avoided and obsolete
completed presentation results are discarded. Previous detail remains until
coverage exists, then current fine patches replace it progressively. Full warm
fine coverage skips preview generation.

Background layers are allocated after PlayCanvas reserved layer initialization,
and draw before fine terrain without depth writes. Preview, fading and fine
patches share the existing active limit; uploads remain at most one per frame.
The owner's 256,000,000-byte combined estimated cache-retention threshold and
ONE 1,000,000,000-byte combined ceiling remain unchanged. These estimates are
not physical browser RAM measurements. SEED/geography, simulation, authority,
road/icon zoom gates and initially minimized information panel are preserved.

## Final measured result

Native Windows Edge 155.0.4283.45 / Node 24.12.0. Single sequential run per
configuration, desktop1440x900 and phone390x844 viewport; no physical A55 claim.

| Backend / viewport | Before coherent terrain | Final coherent terrain | Final detail |
| --- | ---: | ---: | ---: |
| webgl2 / desktop | 54,654.0 ms | 425.4 ms | 52,293.7 ms |
| webgl2 / phone | 11,244.1 ms | 302.1 ms | 10,954.9 ms |
| webgpu / desktop | 57,845.4 ms | 445.9 ms | 52,348.7 ms |
| webgpu / phone | 11,519.9 ms | 338.8 ms | 11,031.6 ms |


Reversal coverage: 115.2–147.7ms; settled 356.3–389.6ms. All eight final traces
have no page/console errors, pass resource limits and have max one outstanding
job. All16 unmasked250/1000ms-to-final comparisons pass unchanged mean RGB<=2
and broad changed area<=5% limits; worst mean1.633163. The owner clarified that
about one second is sufficient and visual quality/richer scenery take priority.
No further sub-second optimization is planned. Full fine detail still takes
about11–52s and cold startup about100s on this host. Do not claim every visible
object is generated within one second.

Final coastline first-coverage/settled pairs pass unchanged limits: desktop
WebGPU .620510 mean RGB/.635090% changed; phone WebGL2 .757151/1.042467%.
Four representative final benchmark frames and all four final coast frames were
actually inspected (8 final frames total): VISUAL8/10 for this loading fix,
no broad terrain replacement or missing coverage. Closer houses/keep/fields/road
remain visible. Prototype art, narrow coast/road aliasing and fine-feature
appearance during refinement remain; this is not a richer-environment/art pass.
Both coastal capture sets have no errors, minimized panel and captured budgets pass.

## Validation scope and retained failures

Production TypeScript/build passed on final asset index-BduXcm9x.js. Before the
final removal of redundant uniform-cell centre sampling,31 focused units passed;
the final three geometry checks were rerun afterward (omitted details, default
mesh identity and adaptive-coast hard bound). No full fresh unit-suite claim.

The preceding candidate passed12 native Edge cases: two owner4K pan/Street,
four orientation, four streaming/resource and both complete zoom matrices.
Its262 image comparisons pass unchanged limits (worst mean DeltaE76 .6340673922),
and all131 canonical backend focus/sample pairs match. This full browser run was
not repeated after the preview sampling correction; final validation is the
four-configuration timing run and the two coastal pairs above. No fresh warm-drift,
full Linux or physical-device performance claim. Earlier desktop WebGPU pan
measured407.3ms versus38,688.3ms baseline; that pan was not rerun on final sampling.

Failures retained honestly: candidate1 had reserved-layer ID collisions/cache-only
false readiness (1s meanRGB6.309635); candidate2 failed the coast at2.859194/
6.871795%; first adaptive sampling took830.2ms and failed the250ms diagnostic at
3.051035 despite its1s pass. Final sampling reuses cell corners and passes both
250ms diagnostics and1s frames. Thresholds were not changed and failures remain.
Measurement tests reject old-view frames and cache-only readiness; the retained
palette/block negative control rejects34.9555DeltaE76.

## Evidence and reproduction

Public images, final measurements and exact hashes: [owner-105](evidence/owner-105/README.md).
Raw final traces/images/source/dist/hashes/logs are retained at
C:/Users/serha/AppData/Local/Temp/advisor-zoom105-accepted-final. Baselines remain
at advisor-zoom105-baseline2 and advisor-zoom105-baseline-pan; failed candidates,
layer debug, Cq9 regression source and native outputs remain separately retained.

Run `node tools/measure-zoom-coverage.mjs <output> <url>`, then
`node tools/report-zoom-coverage.mjs <output>`. Optional ZOOM_BACKENDS,
ZOOM_PROFILE and ZOOM_PHASES=pan narrow the driver. Readiness matches final
canonical destination keys and requires submitted/cullable preview meshes in a
valid independent layer. Screenshot step `coverage` waits for this first usable
view; `settle` waits for final detail. Neither substitutes for actual image review.

Normal main deployment and actual live verification remain required before closure.
