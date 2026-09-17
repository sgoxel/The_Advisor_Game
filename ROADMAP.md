# The Advisor Game — Product Roadmap

## Purpose

`README.md` is product truth. `ROADMAP.md` is a Planner-only sequencing map.

Executable work lives in GitHub Issues under `AGENTS.md`. Workers must use the selected Issue only and must not depend on this file for execution instructions. Issue fields control Role, Priority, Status, Claim, Dependency and Handoff.

WP identifiers are stable product areas. Atomic `Ixx` details belong to current Issues; this roadmap does not duplicate them because historical atomic mappings drifted from the live queue.

## Current delivery focus — Starting Village visual-first slice

Finish a visually coherent, stable and responsive Starting Village before broad feature expansion.

Issue priority still wins globally under `AGENTS.md`; this section does not override a valid higher-priority Issue or active Claim.

### 1. Static-world presentation continuity

Primary WPs: `WP-112`, `WP-093`, `WP-103`, `WP-104`.

- All normal non-NPC world visuals use the unified exact `100x100 RGBA` logical-tile composition path.
- NPCs remain the independently dynamic world-image exception.
- Eliminate black/missing static-world gaps, duplicate static layers, projection seams and camera/zoom discontinuities.
- Preserve Simulation authority for terrain, roads, buildings, occupancy and world state.

Current critical lineage: Issue `#461` and its independent Tester verification.

### 2. Starting Village production visuals

Primary WPs: `WP-101` through `WP-107`.

- `WP-101` — visual specification and factual runtime reference evidence.
- `WP-102` — terrain, water, vegetation and ground props.
- `WP-103` — roads, paths, intersections and main-road presentation.
- `WP-104` — building exteriors, interiors and cutaway presentation.
- `WP-105` — protagonist visual identity and movement presentation.
- `WP-106` — NPC profession/resident visual roster.
- `WP-107` — NPC animation and visual continuity.

Production artwork remains Admin-provided or Admin-authorized. Canonical reusable atlas families use exact `1000x1000 RGBA`, `10x10`, exact `100x100` cells, row-major order and trim `0`. Workers stage required PNG binaries in the configured Drive mirror; Admin performs the mandatory GitHub binary push.

### 3. Responsive gameplay surface

Primary WPs: `WP-108`, `WP-109`, `WP-110`.

- Desktop and tablet keep the game world as the primary interaction surface.
- Phone landscape remains playable with touch-safe controls and bounded chrome.
- Phone portrait keeps Game Area and Control Panel as separate mounted major surfaces with only one primary surface visible at a time.
- Persistent overlays, debug UI and contextual panels must not unnecessarily consume gameplay viewport.
- Responsive regression tests must describe current layout rather than force restoration of superseded geometry.

### 4. Motion and entity continuity

Primary WPs: `WP-039`, `WP-040`, `WP-091`, `WP-092`, `WP-111`.

- Keep input, camera and visible rendering ahead of background work.
- Preserve stable NPC identity through interpolation, culling, relevance changes, zoom, camera motion and resize.
- Avoid flicker, edge clamping, disappearance and presentation churn.
- Keep lazy/background Simulation bounded and deterministic.

### 5. Visual/release evidence

Primary WPs: `WP-099`, `WP-100`, `WP-112`.

- Use the latest successful Actions visual-review artifact for the tested current-main commit.
- Standard visual evidence: phone `720x1280` and tablet `1280x800`.
- NPC/action/flicker evidence: two frames per viewport, `0.2s` apart.
- Final visual acceptance requires motion-aware runtime evidence, not repository presence or static source inspection alone.

## Starting Village visual-first exit criteria

The current delivery focus is complete only when independent Tester/Reviewer evidence confirms all of the following:

- no critical black, missing, duplicated or detached non-NPC world presentation;
- coherent terrain, roads, buildings, interiors, vegetation and props at gameplay scale;
- protagonist and NPC presentation remain visible, identifiable and stable during movement;
- road/building/character scale is plausible and consistent;
- desktop, tablet and phone layouts preserve a practical game area;
- phone portrait major-surface switching preserves state and does not overlap both surfaces;
- contextual/debug UI does not permanently cover useful game space;
- camera movement, zoom, resize and orientation do not cause material presentation discontinuity;
- current-main visual evidence matches the exact tested commit;
- no unresolved P0 visual defect remains in this slice.

## Product workstream map

These WP ranges remain the long-term product decomposition. Current executable scope is always defined by Issues, not by this summary.

| WP range | Product area |
| --- | --- |
| `WP-001`–`WP-010` | Advisor -> Character -> Simulation -> World core loop |
| `WP-011`–`WP-020` | Character identity, autonomy, memory, emotion and AI-driver parity |
| `WP-021`–`WP-030` | Starting Village generation, buildings and top-down presentation |
| `WP-031`–`WP-040` | NPC homes, workplaces, routines, routing, occupancy and lazy simulation |
| `WP-041`–`WP-050` | World continuity, terrain, ecology, roads, travel and maps |
| `WP-051`–`WP-060` | Game time, persistence, reconciliation and campaign history |
| `WP-061`–`WP-070` | Economy, inventory, settlements and Advisor progression |
| `WP-071`–`WP-080` | Realms, factions, diplomacy, rank, authority and political evolution |
| `WP-081`–`WP-090` | Military systems, conflict and world events |
| `WP-091`–`WP-100` | Rendering, responsive UI, accessibility, localization, performance and release gates |
| `WP-101`–`WP-112` | Starting Village visual-first production, responsive presentation and certification |

## Sequencing after the visual-first slice

Once the Starting Village visual-first exit criteria are independently verified, Planner should prefer the smallest missing end-to-end gameplay consequences before broad systems expansion:

1. complete the bounded Advisor -> Character -> Simulation -> World chain in `WP-001`–`WP-010`;
2. stabilize persistent character identity/autonomy foundations in `WP-011`–`WP-020`;
3. deepen village/world Simulation in `WP-021`–`WP-060`;
4. expand economy, settlement progression and politics in `WP-061`–`WP-080`;
5. expand military/conflict/event systems in `WP-081`–`WP-090`;
6. continuously enforce `WP-091`–`WP-100` quality gates as features expand.

This sequence is product direction only. A live higher-priority defect, dependency repair, valid active Claim or Admin instruction takes precedence according to `AGENTS.md`.

## Planner maintenance rules

- Keep this file compact and product-level.
- Do not copy issue lifecycle, claims, detailed acceptance criteria or atomic execution instructions here.
- Do not reintroduce named worker ownership or retired lane/stage workflow.
- Do not use roadmap edits to override `README.md` product truth.
- Do not renumber existing WP areas merely because individual Issues were repaired, split, superseded or reopened.
- When an atomic Issue changes, update the Issue; change this roadmap only if product sequencing or WP-level scope materially changes.
- Real external blockers belong in the affected Issue as `DELAYED` with an exact resume condition; they must not stall unrelated roadmap work.
- Only mandatory Admin execution step: push Admin-created texture-tile binaries already staged in the configured Drive mirror to the identical GitHub paths.
