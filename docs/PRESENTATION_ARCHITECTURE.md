# Presentation Architecture — toon 3D, 2D-default residents with optional owner meshes, semantic zoom

Status: WP-S007-001-001 reference analysis. **Research only.** Nothing in this document is implemented by that WP; it records the current source, the target, the cited techniques, the semantic-zoom contract and the future implementation slices. No visual PASS is claimed (`VISUAL: N/A`).

Authority: `docs/README.md` (PlayCanvas 3D World Standard, 3D Asset Standard, Optional Owner 3D Character Models and Permanent 2D Fallback, Performance Rules, Canonical Scale and Navigation Rule) and `docs/SEMANTIC_ZOOM_REQUIREMENTS.md`. Presentation never decides terrain class, walkability, routes, SEED identity, Simulation state or canonical material meaning. The contract test `tests/presentation-architecture.test.ts` keeps the tables below in step with the source constants.

**Owner character presentation revision, 2026-10-29:** This historical reference analysis preserves the 2D character-atlas target as the **current working fallback**, not an exclusive prohibition against future 3D NPCs. Use current original 2D resident images until the owner supplies actual GLB/glTF character meshes; then use a valid deployed owner model where available, while every unmatched, missing, unsupported or failed model **always uses its corresponding 2D illustration**. Models and sprites share exactly the same Simulation-owned identity, feet, collision, position and interactions. The independent future adoption WP is [WP-S010-003-003](ROADMAP.md); the existing 2D-baseline work and performance rules continue to apply.

## 1. Source-to-target gap (audited at this commit)

| Surface | Current source | README target | Gap |
|---|---|---|---|
| Terrain | `src/surface-presentation.ts` `createTerrainMaterial`: `StandardMaterial`, `emissive` = vertex colour × surface map, `useFog/useTonemap = false`; lighting is on only as a **shadow catcher** (black diffuse/specular/ambient, `shadowCatcher = true`) so object shadows darken the emissive colour; procedural surface detail (section 2a) adds sun-shaded relief; custom `emissivePS` chunk in GLSL **and** WGSL; daylight is a `surfaceDaylightTint` uniform | Lit toon/cel terrain with stable canonical palette | Hills still read only by albedo (no N·L on the terrain itself); ground shadows and relief only at close zoom |
| Buildings, roads, props | `src/main.ts` `worldMaterial`: one lit `StandardMaterial`, vertex colour (gamma), specular 0.04, `CULLFACE_NONE`; geometry procedural (`settlement-exterior*.ts`, `site-geometry.ts`, `wilderness-geometry.ts`) | Shared low-poly GLB assets, shared materials, atlases, instancing | No GLB/glTF in the repository; repeated forms are regenerated per settlement rather than instanced; Lambert+Phong, not banded |
| Lighting | One directional sun, `castShadows`, `shadowResolution: 2048`; at local zoom the camera near plane and `shadowDistance` are fitted to the visible ground (`updateCamera`), so close-up shadows are ~10 cm per texel at Hero zoom; ambient + sun follow local daylight (`daylight.ts`) | Readable cel lighting, bounded shadow tiers | Single fixed shadow tier for every device |
| Night glow | Additive, unlit, `depthWrite=false` glow materials, fade by `closeLightingWeight` (`street-lighting.ts`) | Keep | Fits target; stays unlit by design |
| Vegetation | Forest is terrain texture (`forest-texture.ts` `forestTextureAt`, painted by `geometry-core.ts` at every zoom: dark = tree stand, light = grass); there is no secondary 2D canopy layer. 3D tree bodies (`forest-cover.ts`, fine tiles only) stand only where that texture is dark and only closer than displayed 1/1 (`forestBodiesVisibleAtScale`) | Instanced low-poly trees/rocks | Bodies are merged per tile, not instanced |
| Residents | `main.ts`: pooled `plane` render entities, cylindrical billboard (yaw only), `alphaTest 0.4`, `CULLFACE_NONE`, one material per character key, 39 WebP images (~1 MB) in `public/characters/` | Foot-anchored 2D sprites, correct occlusion/cutaway, atlas frames | One material + texture per type (draw calls do not merge); no frame atlas; no roof cutaway/silhouette |
| Place icons | `place-symbol.ts`: 13 inline SVG stroke symbols in DOM (`political-atlas.ts`, `wilderness-overlay.ts`) | Semantic icon tiers with hierarchy/clustering | No role badges; icon density not clustered; DOM nodes per icon |
| Labels | DOM `#map-labels`, measured with `getBoundingClientRect`/`offsetWidth` (`political-atlas.ts`, `main.ts`), placement gated by a fingerprint | Stable priority/hysteresis, no flicker | Fonts load late (see below) and invalidate measured boxes |
| Fonts | `src/style.css` line 1 `@import` Google Fonts (Cormorant Garamond, DM Sans), `display=swap` | Stable metrics | Late swap changes label widths after first placement; external dependency |
| Scale gates | Scattered: `roadRepresentationAtScale`, `forestBodiesVisibleAtScale` (`surface-presentation.ts`), `SETTLEMENT_ICON_FROM_SCALE`, `settlementSmallDetailsVisible`, `POLITICAL_*_MAX_SCALE_DENOMINATOR` (`political-presentation.ts`), `closeLightingEnabled` (`street-lighting.ts`), handoff footprints (`handoff.ts`) | One semantic-zoom matrix with hysteresis | Hard single-value thresholds, no hysteresis, no shared table |

Canonical place roles available today: `capital` (city index 0 of a country, `political-atlas.ts`), `city`, `village` (`geography.ts`), `ruin`, `critical-place` (`sites.ts`), wilderness kinds `forest|lake|cave|mine|dungeon|hill|cliff|waterfall` (`wilderness.ts`). **No authoritative castle, market, harbor/port or civic/defensive/trade role exists yet**; their icons stay unused until a world system supplies the fact (SEMANTIC_ZOOM_REQUIREMENTS: never invent a role).

## 2. Target presentation system

Grounded medieval-fantasy, low-poly, flat-shaded faces with two- or three-band cel lighting and a fixed per-material palette.

1. **One toon lit material family.** Keep `StandardMaterial` (shared shader cache, both backends) and override the diffuse lighting chunk with a banded ramp: `band = step-quantised N·L` (3 bands: shadow 0.45, mid 0.75, lit 1.0, 0.04 smoothing width). The chunk is supplied for `SHADERLANGUAGE_GLSL` and `SHADERLANGUAGE_WGSL` exactly as `surface-presentation.ts` already does for `emissivePS`. Albedo stays the canonical vertex/surface colour; only the light term is quantised, so material meaning is unchanged.
2. **Terrain becomes lit, not emissive.** Move canonical colour from `emissive` to `diffuse` (vertex colour + `surface` map), enable lighting and the same ramp, keep fog/tonemap off (`TONEMAP_NONE` / linear) so globe and local colours stay identical. Globe surface uses the same ramp with the same sun direction so the handoff blend cannot recolour.
3. **Palette lock.** All albedo keeps coming from `final-surface.ts`/`globe-surface.ts`; daylight multiplies light colour, never albedo. A palette checksum (mean rendered colour of canonical swatches under fixed light) is the cross-backend parity probe.
4. **Outlines** only on buildings/props at Village/Street tier: inverted-hull back-face shell in the GLB (one extra draw per batch, vertex shader push of 0.02–0.05 m), not a full-screen edge pass (bandwidth cost on tile GPUs). Terrain gets no outline; ridges read from the ramp.
5. **Shadows by tier** (device-chosen, presentation only; each shadowed directional cascade re-renders the shadow casters [R5]): low phone off; phone 1024 map / 1 cascade / 250 m distance; tablet 2048 / 1 / 420 m (current); desktop 2048 / 2 cascades / 600 m. Shadows off beyond 1/2 displayed scale (no small detail exists there to cast them).
6. **Shared GLB kit.** House/hall/chapel/smithy/barn/wall/gate/tower/bridge/tree/rock/fence/well/stall modules, each ≤ 300 triangles (trees ≤ 120), one 512² or 1024² colour atlas (palette strip texture, UVs into flat swatches), one material for the whole kit + one for vegetation (alpha-test leaves only if needed). Procedural settlement plans keep choosing module, position, rotation, scale and palette index from the SEED; GLB is appearance only.
7. **Instancing and batching.** Repeated modules (trees, rocks, fences, lamps, roof variants) use hardware instancing per (mesh, material) per chunk; unique merged ground/road strips keep the current per-tile merged meshes. Static settlement shells that are not repeated use one merged mesh per chunk.
8. **Residents.** One character atlas (2048² desktop/tablet, 1024² phone variant) holding all 39 types × frames, one shared material, per-instance UV rect. Billboard stays cylindrical (yaw only) so physical height is preserved under the 3/4 orthographic camera. Pivot at the feet; `alphaTest` with mipmapped premultiplied alpha; depth write on, so roofs/walls occlude correctly. When an actor is occluded by a roof, a second pass draws a flat silhouette (depth test GREATER, low alpha, no depth write) instead of cutting the roof — cheaper than per-building cutaway. Roof cutaway for interiors uses a per-building `roof` sub-mesh faded with the engine's `opacityDither` (Bayer8) when the focus is inside the footprint [R14].
9. **Fonts.** Self-host the two fonts as WOFF2 subsets in `public/fonts/` with `font-display: optional` and metric-matched fallback (`size-adjust`/`ascent-override`), or system stacks only; label placement waits for `document.fonts.ready` once and treats a font change as an explicit invalidation input.
10. **Labels.** Keep DOM labels (accessible text, crisp at any DPR) but measure each label text once per (text, font, size) and cache the box; placement re-runs only when the label fingerprint, viewport or font generation changes (already fingerprinted in `main.ts`). Never call `getBoundingClientRect` for unchanged labels on stable frames.

### 2a. Procedural surface detail (implemented)

`src/surface-detail.ts` adds texture-free surface detail to the terrain material and the lit world
material (buildings, props, Blender models), in GLSL and WGSL. Each pixel picks a pattern from its own
vertex colour and orientation (grass, dirt/road, rock, sand, snow on terrain; brick, plaster, timber,
stone blocks on walls; roof tiles; paving; foliage), laid out in world metres. The pattern tints the
albedo and carries a small height field turned into a bent normal from screen derivatives
(surface-gradient bump mapping): lit materials light it with the real sun and lamps, the unlit terrain
shades it against the sun direction. Features fade out below a few pixels and nothing is evaluated
above 0.45 m per pixel, so far zoom levels cost nothing extra. Hooked in through
`installLodCoverage(material, mode)` / `installLitSurfaceDetail` in `src/surface-presentation.ts`.

## 3. Semantic-zoom matrix

Scale anchors are the `SCALE_LADDER` in `src/handoff.ts`: README ladder 1/10…1/10000 plus the owner-approved close-up anchors Hero (0.2), Close (0.5), 1/1, 1/2, 1/5. Denominator `d` is the displayed scale. Tiers (SEMANTIC_ZOOM_REQUIREMENTS §Representation tiers):

| d (anchor) | Tier | Terrain | Roads / bridges | Settlements | Sites (ruin, critical, wilderness) | Buildings / props | Vegetation | Residents | Borders | Labels |
|---|---|---|---|---|---|---|---|---|---|---|
| 10000, 5000 | Realm (globe) | globe surface, painted biomes | hidden | capital icons only | hidden | none | painted albedo | none | hidden | country names |
| 2500 | Realm→Country handoff | globe/local blend | hidden | capital + city icons | hidden | none | painted | none | hidden | country names |
| 1000, 500 | Country | local flat | major routes as route overlay only | all city icons, village dots | icons for ruins/critical places | none | painted | none | shown | city/village names (priority-placed) |
| 250, 100 | Province | local flat | cartographic lines (`d ≤ 100`) | icons + names | icons | none | painted | none | shown | all eligible names, leaders when displaced |
| 50, 20, 10 | Region→Near | local refined | ground ribbons (`d < 50`) | icons | icons | none | painted | none | shown | names |
| 5 | Near settlement | local refined | ground | icon **hands off** to geometry (`SETTLEMENT_ICON_FROM_SCALE = 5`) | coarse site geometry | main buildings, walls | forest as terrain texture | none | shown | names + building tags |
| 2, 1 | Village | full | ground + bridges | geometry | full | all buildings | forest as terrain texture, no 3D bodies (`d ≥ 1`) | none at `d ≥ 2` | shown | names |
| 0.5, 0.2 | Street (Close, Hero) | full | ground | geometry | full | all + small props (`d < 2`), lamps/glow (`d ≤ 1`) | 3D bodies (`d < 1`) | billboards (`d < 2`) | shown | nearby stop labels step aside |

Transition and hysteresis contract (target values, measured in S009 before freezing):

- Every gate becomes a band `[enter, exit]` with exit = enter × 1.15 (zooming out must pass 15 % beyond the enter value before the outgoing tier is dropped). Thresholds are evaluated on the continuous footprint, not on the snapped label.
- Icon↔geometry and forest-texture↔tree-body swaps cross-fade over `LOD_BLEND_SECONDS` (already in `surface-presentation.ts`) using the existing dithered LOD coverage, and the incoming tier must be prepared before the outgoing one is disabled; caches are never evicted by a visibility gate.
- Icons and their geometry share the canonical anchor (settlement centre lon/lat). The icon fades out only after geometry is ready; a selection made on an icon targets the same canonical ID.
- Labels: priority order capital > city > critical place > ruin > village > wilderness; ties broken by canonical ID string, never by draw order. A placed label keeps its slot while it still fits (placement hysteresis); displaced labels keep their leader to the anchor. A label is removed only for tier, hemisphere/occlusion or viewport reasons (README landmark rule).
- Clustering (Country tier, phones first): villages within 28 px of a higher-priority icon fold into a count badge; the cluster stores member IDs so expansion and inspection keep identity.
- Non-colour cues: every icon family has a distinct silhouette (`place-symbol.ts` shapes), capitals add a ring, routes add dash pattern + arrow tag (`route-overlay.ts`), borders add a dashed casing. Labels have a 2 px halo with ≥ 4.5:1 contrast to the halo on light and dark terrain families; focus ring is shape + colour.

## 4. Mobile / tablet / desktop budgets (assumptions, unmeasured)

Software-GL CI cannot measure GPU time. These are planning ceilings to be measured on physical devices in S009; the renderer may lower detail per tier but never Simulation or canonical existence.

| Budget per frame | Phone | Tablet | Desktop |
|---|---|---|---|
| Draw calls (scene) | ≤ 150 | ≤ 250 | ≤ 600 |
| Visible triangles | ≤ 300 k | ≤ 600 k | ≤ 2 M |
| Materials/shader variants live | ≤ 8 | ≤ 10 | ≤ 12 |
| Shadow map | 1024², 1 cascade | 2048², 1 cascade | 2048², 2 cascades |
| Texture memory (world + actors) | ≤ 48 MB | ≤ 96 MB | ≤ 192 MB |
| Character atlas | 1024² | 2048² | 2048² |
| Active resident billboards | ≤ 64 | ≤ 128 | 160 (current cap) |
| DOM labels placed | ≤ 40 | ≤ 70 | ≤ 120 |
| Device pixel ratio cap | 2.0 with dynamic render scale | 2.0 | native |

The current resident cap (160 in `main.ts`) and texture-per-type materials exceed the phone draw-call ceiling at Street tier if every type is visible; the character atlas slice removes that.

## 5. Backend pitfalls (WebGPU / WebGL2)

- Every chunk override must exist for both `SHADERLANGUAGE_GLSL` and `SHADERLANGUAGE_WGSL`; a GLSL-only chunk silently falls back to the default lighting on WebGPU.
- Keep colour pipeline linear-in / gamma-out identical on both: `vertexColorGamma` is already set on vertex colours; textures must be flagged sRGB consistently or the palette checksum differs by backend.
- WebGPU depth is [0,1]; custom depth math (silhouette pass) must use engine depth helpers, not raw `gl_FragCoord.z` assumptions.
- Alpha-to-coverage and MSAA availability differ; use alpha test + mipmaps as the baseline, alpha-to-coverage only as an optional quality knob.
- `installLodCoverage` (`surface-presentation.ts`) adds a `discard` to every world material for the dithered LOD fade. `discard` disables early-Z / hidden-surface removal on tile GPUs [R20], so the fade should be enabled only on materials mid-transition (`lodCoverage` < 1), not compiled into the steady-state shader variant.
- Colour parameters passed with `setParameter` must already be linear; colour textures need `srgb: true` (PlayCanvas 2 linear workflow) [R18].
- WebGPU on Android depends on browser/driver (Chrome 121+, Android 12+, Qualcomm/Arm GPUs) [R17]; the WebGL2 fallback path is the phone baseline and must pass every acceptance check on its own.

## 6. Future implementation slices (recommendations only, not WPs)

Each slice is independently implementable and testable; none waits on another.

1. **Toon light ramp** — banded diffuse chunk (GLSL+WGSL) on `worldMaterial`; palette checksum probe; screenshot pair per backend.
2. **Lit terrain** — move terrain/globe from emissive to the same ramp with identical globe/local colour at the handoff; continuity test on the existing handoff footprints.
3. **Semantic-zoom table** — replace the scattered gates with one `presentation-tiers.ts` table carrying `[enter, exit]` bands, used by `main.ts`, `political-atlas.ts`, `street-lighting.ts`; unit test for hysteresis (no toggle under ±10 % oscillation).
4. **Self-hosted fonts + label metric cache** — remove the Google Fonts `@import`, add WOFF2 subsets and fallback metrics, cache text boxes, invalidate on `document.fonts` change; test that stable frames do zero layout reads.
5. **Character atlas** — pack the 39 WebP sprites into one atlas (plus phone variant), one shared material with per-instance UV rect; draw-call counter test at Street tier.
6. **Occluded-resident silhouette** — second pass for actors behind roofs; browser check that an indoor/behind-roof actor shows a silhouette and no roof hole.
7. **GLB building kit** — first five modules (house, hall, wall, gate, tree) in one atlas material, loaded once, instanced per chunk; deterministic placement unchanged (same settlement fingerprints).
8. **Icon clustering and role badges** — Country-tier clustering with member IDs; role badges only for roles that exist canonically.
9. **Shadow/quality tiers** — device tier picks shadow map/cascades/distance and DPR cap via `renderer-policy.ts`; Simulation fingerprint identical across tiers.

## 7. References

Fetched sources unless marked *(search result)*. PlayCanvas pages were read from the `playcanvas/developer-site` and `playcanvas/engine` main branches on GitHub (the hosted docs sites were unreachable from the research sandbox), so details must be re-checked against engine 2.23.0 when a slice is implemented.

| # | Source | Finding used | Limit / pitfall |
|---|---|---|---|
| R1 | [engine `material.js`](https://github.com/playcanvas/engine/blob/main/src/scene/materials/material.js) | Per-material `getShaderChunks(GLSL/WGSL)`, `shaderChunksVersion`, `update()` | GLSL-only chunk is transpiled on WebGPU (slower); `update()` drops cached variants |
| R2 | [`lightDiffuseLambert` WGSL](https://github.com/playcanvas/engine/blob/main/src/scene/shader-lib/wgsl/chunks/lit/frag/lightDiffuseLambert.js) / [GLSL](https://github.com/playcanvas/engine/blob/main/src/scene/shader-lib/glsl/chunks/lit/frag/lightDiffuseLambert.js) | Toon ramp = one-line override of `getLightDiffuse` | Needs `useLighting=true`; chunk names change between releases |
| R3 | [trees example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/shaders/trees.example.mjs) | Backend-selected chunk sets + `setInstancing` for 1000 trees | Template, not production code |
| R4 | [Shaders manual](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/shaders/index.md) | `ShaderMaterial` with GLSL+WGSL sources | Engine `shader-toon` example is unlit posterisation, not lit toon |
| R5 | [Shadows manual](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/lighting/shadows.md), [cascades example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/lights-and-shadows/shadow-cascades.example.mjs) | 1–4 cascades, resolution/distance trade-off | Scene re-rendered per cascade; example's 4 cascades is desktop-grade |
| R6 | [Clustered lighting](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/lighting/clustered-lighting.md) | Directional lights excluded; disable shadows/cookies on low tier | CPU grid rebuild per frame |
| R7 | [Optimization guidelines](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/optimization/guidelines.md) | 100–200 draw calls on low-end mobile; DPR per device; backface culling | Guidance, not measurement |
| R8 | [Hardware instancing](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/advanced-rendering/hardware-instancing.md) | `setInstancing`, compact instance formats, `EXT_mesh_gpu_instancing` | Instances not frustum-culled: split per chunk |
| R9 | [Batching](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/advanced-rendering/batching.md) | Same material/layer, ≤ 65,535 vertices, static cheaper | Rebatching expensive; large AABB hurts culling |
| R10 | [Multi-draw](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/advanced-rendering/multi-draw.md) | Many sub-ranges, one material (terrain patches) | `gl_DrawID` absent on WebGL2 fallback loop |
| R11 | [GLB parser](https://github.com/playcanvas/engine/blob/main/src/framework/parsers/glb-parser.js) + [extensions](https://github.com/playcanvas/engine/tree/main/src/framework/parsers/glb/extensions) | meshopt (needs `meshoptInitialize`), Draco, GPU instancing, texture transform, unlit | KTX2/basisu end-to-end in 2.23.0 unverified |
| R12 | Khronos [KHR_mesh_quantization](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md), [EXT_meshopt_compression](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md), [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md) | ~48→20 B/vertex; ETC1S colour, UASTC data; full mips, ×4 sizes | Must be `extensionsRequired` |
| R13 | [Basis Universal](https://github.com/BinomialLLC/basis_universal) | ETC1S ~0.3–3 bpp, UASTC 8 bpp, transcode to ETC2/ASTC/BC7 | WASM transcoder download |
| R14 | [Transparency manual](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/transparency.md), [dithered transparency example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/graphics/dithered-transparency.example.mjs) | Alpha test writes depth (correct sprite occlusion); `opacityDither` Bayer8 | Alpha-to-coverage ignored without MSAA; blending sorts per instance |
| R15 | [Outline example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/graphics/model-outline.example.mjs) | Post-process outline = extra scene pass + full-screen pass | Reserve for selection; inverted hull for kit (concave edges missed, unmeasured) |
| R16 | [Mapbox collision detection](https://github.com/mapbox/mapbox-gl-native/wiki/Collision-Detection), [MapLibre style spec](https://github.com/maplibre/maplibre-style-spec/blob/main/src/reference/v8.json) | Greedy priority placement in a ~30 px grid, cross-zoom IDs keep state, re-place ~150 ms not per frame, GPU fade; `symbol-sort-key`, `text-optional`, variable anchors | Fade default 300 ms *(search result)* |
| R17 | [webgpufundamentals: from WebGL](https://github.com/webgpu/webgpufundamentals/blob/main/webgpu/lessons/webgpu-from-webgl.md); Chrome 121 WebGPU Android *(search result)* | Clip Z 0..1, top-left origin; check `maxTextureDimension2D` | Android WebGPU limited to Chrome 121+/Android 12+/Qualcomm·Arm |
| R18 | [PlayCanvas linear workflow](https://github.com/playcanvas/developer-site/blob/main/docs/user-manual/graphics/linear-workflow/index.md); MDN [GPUSupportedLimits](https://github.com/mdn/content/blob/main/files/en-us/web/api/gpusupportedlimits/index.md) | Linear shaders, `srgb:true` colour textures; 8192 tex, 16 sampled textures/stage defaults | `float32-filterable`, ETC2/ASTC optional per device |
| R19 | MDN [FontFaceSet.load](https://github.com/mdn/content/blob/main/files/en-us/web/api/fontfaceset/load/index.md), [font-display](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/at-rules/@font-face/font-display/index.md), [size-adjust](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/at-rules/@font-face/size-adjust/index.md) | Explicit `document.fonts.load()` before measuring; `optional` = no late swap; metric-matched fallback | `ready` covers only already-requested fonts |
| R20 | Arm [render-pass bandwidth sample](https://github.com/KhronosGroup/Vulkan-Samples/blob/main/samples/performance/render_passes/README.adoc); PowerVR "do not use discard", Qualcomm shader practices *(search results)* | Full-screen 2220×1080 pass ≈ 575 MiB/s at 60 fps; discard disables early-Z/HSR; order opaque → alpha-test → blend | Vendor guidance, not this game's measurement |

UNVERIFIED (no primary source fetched): WebP-vs-PNG atlas guidance and premultiplied-alpha bleed, inverted-hull vs post-outline mobile cost, PlayCanvas-specific depth-greater silhouette pass, the §4 budget numbers themselves (planning ceilings for S009 measurement).
