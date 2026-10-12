# Semantic Zoom & Far-View Icon Requirements

Status: binding owner requirements for cross-stage presentation/performance planning. This document does not claim the runtime already implements semantic icons or proxy LOD.

## Goal

The world remains fully detailed and authoritative, but distant views must not require mobile devices to instantiate/render every village house, garden, wall segment, farm prop, tree, ruin mesh, market stall or other local object.

At appropriate zoom ranges, detailed world geometry is replaced in presentation by lightweight semantic icons/proxies that represent the same canonical world entities. Zooming closer progressively reveals the real seeded geometry without changing identity, position, role or Simulation truth.

## Authority

Semantic zoom is presentation only.

- Campaign SEED decides fixed world facts, canonical identities, locations and base roles.
- Canonical coordinates remain the anchor for every icon/proxy and every later detailed representation.
- Later authoritative world changes use persisted SEED + Fantasy Game Time state/events.
- Device class, renderer, frame rate, zoom, cache pressure and quality tier may choose the **representation tier**, but may never decide whether an authoritative world entity exists, move it, rename it, change its role or alter Simulation state.
- An icon is a view of an existing canonical entity, never a replacement world object.

## Required semantic icon families

The system must support recognizable far-view representations for important world facts including at minimum:

- village / settlement;
- villa, manor or notable residence when it is itself an important place;
- city / capital;
- castle / keep / fortress;
- bazaar / market / major trade center;
- forest / major woodland region;
- ruin / critical place;
- harbor/port where important to transport readability;
- other high-value landmarks defined by later world systems.

City/settlement icons may expose an authoritative dominant role where one exists, for example:

- civic/administrative city;
- defensive/fortified city;
- merchant/trade city;
- port city;
- agricultural/resource center;
- other SEED/world-state-derived roles.

Role icons must be derived from canonical settlement facts such as governance, fortification, economy, services, transport and culture. Presentation must never invent a city type merely to create visual variety. Mixed-role settlements may use a primary icon plus bounded secondary badge/metadata rather than false single-role classification.

## Representation tiers

The exact scale thresholds must be researched and measured under WP-S007-001-001 before implementation values are frozen, but the architecture must support these conceptual tiers:

1. **Far / Realm-Country tier** — lightweight icons, labels, borders, major roads/routes and large natural-region symbols. Do not instantiate detailed village/city/castle meshes, local gardens, walls, local trees or individual farm props merely because they are inside the camera footprint.
2. **Regional / Province tier** — settlement/site icons remain, with selected coarse footprints, important roads, major fortifications/harbors and selected structural cues where budgets allow. Individual local-detail meshes remain suppressed unless focused.
3. **Near settlement tier** — simplified settlement geometry/major structures can replace or blend with icons; local roads, enclosure, main buildings and major vegetation progressively appear.
4. **Village/Street tier** — full bounded local detail: houses, services, walls, gardens, pavements, farms, roadside trees, props and other canonical geometry required by the local WP.

These are semantic representation levels, not separate world generations. Every tier resolves to the same canonical IDs and coordinates.

## Continuous zoom and transition rules

Semantic zoom must preserve the existing pure/continuous zoom contract.

- No representation change may rotate, recenter, jump focus or move an entity's screen/world anchor.
- Do not use one-frame hard swaps that cause icons, settlements or landmarks to flash/pop repeatedly around a threshold.
- Use hysteresis and, where appropriate, short bounded cross-fades/morphs/overlap windows so slight wheel/pinch motion does not thrash between icon and geometry states.
- Incoming detail must be ready before outgoing coverage is removed when technically possible.
- Icon → coarse proxy → detailed geometry transitions must preserve recognizable identity and position.
- Nearby zoom changes must not cause large-scale label/icon disappearance, duplicate markers, abrupt palette replacement or temporary blank geography.

## Mobile-first performance behavior

Mobile devices may transition to icon/proxy representation earlier than higher-budget devices, but only as a renderer/presentation policy.

- Device class may alter detail thresholds, icon density, clustering aggressiveness, shadow/decorative detail and proxy complexity.
- Device class may **not** alter canonical settlements, sites, roads, forests or their identities.
- Far zoom must keep CPU/GPU work bounded by visible semantic objects/regions rather than total hidden local geometry inside the geographic footprint.
- Coarse views must not create all village building entities, interiors, gardens, trees, crop props, ruin sub-meshes or resident actor meshes.
- Icon/proxy assets should use a small reusable atlas/material set, instancing/batching and bounded label projection.
- Normal zooming/panning must not repeatedly recreate unchanged icons/materials/resources.

## Selection and interaction

A semantic icon must remain an interaction gateway to the same canonical object.

- Selecting a village icon selects that village identity, not an icon-only object.
- Selecting/focusing a castle/ruin/market icon must preserve the canonical target while zooming closer.
- Labels, tooltips and inspection data may expose name, type, parent country/region and other known authoritative metadata without forcing detailed mesh materialization.
- Hidden/unknown places remain subject to gameplay discovery rules. Semantic zoom must not reveal secret sites merely because a far-view icon system exists.

## Decluttering and clustering

Dense far views need bounded decluttering.

- Prefer hierarchy, priority and deterministic clustering over drawing every low-value icon simultaneously.
- Capitals, major cities, important castles, selected ruins/critical places, primary ports and other high-priority anchors must remain readable according to the final analysis contract.
- Clustering is presentation-only and must preserve the identities/count of grouped entities for inspection/expansion; it may not merge world state.
- Use stable deterministic ordering/tie-breaking for overlapping labels/icons so slight pan/zoom does not cause arbitrary flicker.

## World-system integration

Existing and future systems must expose lightweight coarse records sufficient for semantic representation without generating full local detail.

- S003 natural world: major forest/woodland and other large natural-region identities can provide coarse semantic anchors where icons/symbols improve readability.
- S004 settlements: villages/cities/castles expose stable type/role, center coordinate, importance and coarse footprint/anchor without materializing all buildings.
- S004 sites: ruins/critical places expose stable site type and icon anchor while detailed site geometry remains lazy.
- S005 transport: important main roads, border crossings, capitals and ports remain readable at the appropriate coarse tier without requiring every local road mesh.
- S006 living world: resident Simulation continues analytically off-screen; semantic settlement icons do not require resident actor meshes.
- S007 presentation: owns reference analysis for semantic icon/proxy visual language, transition behavior, thresholds and readability with toon/cel presentation.
- S009 renderer/resource resilience: verifies device-class thresholds, hysteresis, resource reuse and performance stability.

These are scope boundaries, not blocking dependencies. Every implementation WP must provide any minimum adapter it needs inside its own scope.

## Required analysis before implementation values are frozen

WP-S007-001-001 must research proven semantic zoom / map-symbol / distant-proxy patterns from relevant games, GIS/cartographic systems, engines and mobile rendering practice, then define:

- exact scale/footprint transition bands using the existing 1/10 → 1/10000 ladder;
- hysteresis/cross-fade behavior;
- icon language and visual hierarchy;
- city-role classification presentation;
- clustering/declutter policy;
- interaction/selection behavior;
- WebGPU/WebGL2 implementation pattern;
- mobile/tablet/desktop budgets and quality-tier differences;
- acceptance screenshots and measurable performance counters.

Do not freeze arbitrary thresholds in this requirements document before that analysis.

## Acceptance requirements for later implementation

Future semantic-zoom implementation cannot pass unless evidence proves:

- zoomed-out mobile views do not instantiate detailed geometry for every visible village/city/site;
- villages, castles, bazaars/markets, forests and ruins remain recognizable at appropriate scales through semantic representation;
- civic/defensive/merchant/etc. city roles match canonical world facts;
- selecting an icon and zooming inward resolves to the same canonical entity and coordinates;
- same world/Simulation fingerprints persist across device class, icon/proxy/detail representation, WebGPU/WebGL2 and cache eviction;
- slight repeated zoom across each threshold does not cause thrashing, duplicate markers, missing anchors or major popping;
- icon/label/cluster counts and detailed entity/mesh/resource counts are observable for performance evidence;
- phone/tablet/desktop evidence demonstrates bounded resource use and readable decluttering;
- visual transitions score at least 8/10 after fresh screenshot inspection for MIXED implementation WPs.
