# R04 World-Space PNG Character Sprite Foundation

Issue: #252  
Role owner: Designer  
Phase: R04  
Authority: current README, Admin #249, completed #227 identity foundation, completed #251 enterable-building scale contract.  
Authority boundary: character identity, authoritative location, profession/rank/equipment/status facts, occupancy, movement legality, SEED and campaign state remain Simulation-owned. This artifact defines presentation only.

## Goal

Replace the visual target of detached map-marker people with readable transparent-background character sprites that physically stand on authoritative world tiles and remain compatible with exterior streets, entrances, room clearances and revealed interiors. R04 needs static evidence only; walk/idle animation sheets are not required.

## Committed original PNG evidence

All three assets are original schematic/pixel-art-like sprites created for this project. They have a transparent RGBA background, 128 x 160 px canvas and a common foot/base anchor near the bottom center.

- `assets/characters/world-space/protagonist.png` — protagonist/ranger identity family. Distinguishing cues: muted green field clothing, earth cloak, diagonal ranger strap and quiver/tool silhouette.
- `assets/characters/world-space/guard.png` — representative starter-village guard. Distinguishing cues: slate clothing/armor, metal helmet/chest accents, red-brown outer layer and shield silhouette.
- `assets/characters/world-space/merchant.png` — representative starter-village merchant/trader. Distinguishing cues: plum clothing, green outer layer, warm cap/scarf, diagonal strap and satchel.

These images are not authoritative character records. Runtime mapping must select them from Simulation-backed identity/role facts and must never write those facts back from the artwork.

## World-space anchor and logical-tile contract

1. **One authoritative position.** A sprite's logical position is the Simulation-owned tile/coordinate. The image may overlap neighboring screen pixels but may not move the logical occupant.
2. **Feet/base anchor.** Runtime should anchor the sprite at the bottom-center foot line, not at the image rectangle center. The committed sprites reserve transparent space around the body and include a subtle base cue close to the foot anchor for prototype inspection.
3. **Character-scale continuity.** At normal local-map zoom, the body should read as one standing person while remaining visibly smaller than an ordinary room and compatible with the one-logical-tile passage guidance in #251.
4. **Door compatibility.** The body may visually overlap doorway pixels, but the feet/base must pass only through an authoritative legal entrance/opening. Sprite width never changes collision legality.
5. **Furniture compatibility.** Visual overlap can be depth-sorted, but a sprite may not be shifted to avoid artwork if Simulation says it occupies a specific tile.
6. **Interior continuity.** The same sprite/identity mapping follows the same authoritative character from exterior to revealed interior; do not swap to a disconnected marker or duplicate occupant.

## Recommended runtime sizing

The committed source canvas is deliberately larger than the expected on-screen footprint to retain transparency and allow future supersampling. Runtime may scale it according to renderer zoom and device density.

- Desktop normal local view: target roughly 42-64 CSS px tall for ordinary characters, adjusted only for readability/camera scale.
- Tablet: roughly 38-58 CSS px tall.
- Phone: roughly 34-52 CSS px tall; preserve silhouette and profession cues before fine details.
- Never use source-pixel dimensions as authoritative world dimensions.
- Keep aspect ratio stable; do not stretch a sprite to fill a tile.

These are presentation ranges, not Simulation measurements. #251's room/door/walkability contract remains the spatial authority boundary.

## Identity continuity with dialogue/full-body art

World sprites may use simplified shallow-isometric/near-isometric proportions. They do not need to duplicate the full-body dialogue illustration pixel-for-pixel. Recognition should come from a stable combination of cues:

- silhouette and stance family;
- dominant clothing/outer-layer palette;
- hair/headwear family;
- profession/rank equipment where authoritative;
- one or two stable accent shapes such as ranger strap/quiver, guard shield/metal band or merchant satchel;
- status-specific temporary cues only when backed by state.

The protagonist sprite must remain recognizable as the protagonist/ranger rather than a generic NPC marker. NPC role sprites are fallback visual families for matching authoritative professions; final per-character art may later refine them without changing identity semantics.

## Depth, occlusion and activity feedback

Recommended local presentation order:

1. terrain/road/floor;
2. building lower mass and interior floor/props;
3. character sprites sorted deterministically by world/tile position;
4. upper-wall/roof cutaway layer where appropriate;
5. character-attached activity/dialogue bubbles and accessibility-critical feedback.

When a roof is faded for an occupied interior, the resident remains a world-space sprite at the same authoritative location. Dialogue/activity bubbles anchor above the character's visible head and may adjust screen-space placement to remain readable, but this never changes the character location.

## Safe fallback behavior

Missing final sprite art must not revert the target presentation to a permanent rectangular block.

Fallback order:

1. exact character sprite if available;
2. matching approved role/family sprite such as guard/merchant/worker/healer/villager;
3. neutral compact humanoid silhouette derived from the existing presentation fallback, with transparent surrounding pixels;
4. loading failure may keep the neutral silhouette and expose diagnostics without mutating character identity or location.

A missing image must never remove the authoritative person, change profession/equipment, move occupancy, or produce a second resident.

## Responsive and performance guidance

- Decode/cache each PNG once per asset URL or identity family and reuse it across draws.
- Keep source art compact; the committed 128 x 160 RGBA files are suitable as low-cost static R04 evidence.
- Cull off-screen drawing only at presentation level; never delete NPC state.
- Prefer static images in R04. Animation is optional later and must not gate this phase.
- On small screens retain head/body silhouette, profession cue and foot anchor before secondary equipment detail.
- Activity bubbles should avoid covering the full sprite when the viewport is narrow.
- Do not introduce a new fixed character panel for world-space presence.

## Accessibility

- Do not encode profession/status only by hue. Silhouette/equipment cues accompany palette differences.
- Preserve existing textual inspection/accessible labels for identity and profession; PNG pixels are not the only information channel.
- Reduced-motion users require no animation because the baseline is static.
- Selection/focus cues belong to the interaction layer and should remain distinguishable from sprite artwork.

## Originality boundary

The committed sprites are original project artwork and do not reproduce the Admin reference's protected characters, sprite sheets, layouts, logos or textures. The classic RPG influence is limited to high-level presentation language: compact world-space figures, readable role silhouettes and tile-compatible anchoring.

## Implementation contract for #254

Coder integration should:

- map Simulation-backed protagonist/NPC identity or profession to the approved sprite family without deriving gameplay facts from pixels;
- anchor the sprite's feet to the authoritative local tile/world coordinate;
- preserve #237 occupancy/conflict/dialogue authority and #253 building/interior authority;
- keep PNG drawing presentation-only and deterministic with respect to equivalent state/camera inputs;
- preserve the same character sprite identity across exterior/interior transitions;
- maintain activity/dialogue bubbles above the world sprite;
- use neutral transparent humanoid fallback when art is absent or fails to decode;
- verify desktop/tablet/phone readability and bounded asset caching/culling;
- verify PNG load/fallback cannot mutate Simulation state.

## Independent verification checklist

A Tester different from the Designer must verify the exact committed candidate:

- three transparent PNG outputs exist: protagonist plus at least two starter-village NPC roles;
- PNG files are valid RGBA images with transparent background and consistent foot/base anchoring;
- the assets are original and visually distinct by silhouette/equipment as well as palette;
- the contract ties screen presentation to authoritative logical positions without changing occupancy/movement;
- door, room, furniture and roof-reveal compatibility follows #251;
- identity mapping remains Simulation-backed and recognizable relative to approved character identity/full-body art;
- static sprites are explicitly sufficient for R04;
- fallback does not use permanent rectangular blocks or delete/move characters;
- activity/dialogue bubble and depth guidance preserve world-space presence;
- desktop/tablet/phone and performance guidance are bounded and testable;
- #254 receives a concrete integration/non-mutation contract.
