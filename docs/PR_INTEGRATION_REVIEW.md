# Owner-requested integration release

The owner requested publication of reviewed unfinished candidates and scrollbars/minimize controls on every popup. Issues remain open and unassigned.

| Candidate | Release decision |
| --- | --- |
| #107 | Port resident house-focus behavior and responsive inspector layout; replace focus-dependent movement with stable state so Close works. Home records remain the existing one-home-per-resident authority. |
| #109 | Port transport links, canonical border crossings, harbors/ferries and inspector. Initialize the same roads before main/worker surface indexing; respect the existing 23 km hydrology query bound. |
| #98 and #97 | Use #98 site authority/inspection and #97 close-range ruin/standing-stone meshes. Select roads by canonical country ownership, validate clearance against all roads, preserve priority composition and account for new registry resources. |
| #110 | Held: its household housing model groups multiple residents per house; README requires each NPC to own a distinct house. Its replacement settlement registry was not imported. |
| #95 and #100 | Interior architecture is already represented by the fuller main document from 09a3998. This release does not implement enterable interiors. |
| #52, palette step | Port its colder sea-ice, polar-ice, tundra and snowy-mountain colours. Ecotone/beach/thermal threshold changes remain pending because climate also feeds settlement placement. Preserve the current coarse seed recipe and canonical terrain classification. |

Older overlapping foundation/evidence proposals (#28, #31, #35, #40, #42, #45, #47, #48, #52, #57, #64, #65, #67, #69, #76, #79, #80, #84, #85, #86, #93) were not blindly merged. Their branches remain intact. In particular #52 changes canonical climate and has no fresh acceptance in this release; evidence-only triggers and extra CI scaffolding were not imported. This is selective source integration, not a claim that every open PR or issue is complete.

## Popup behavior

Map information retains its existing minimize control. Cell, travel/resident, transport and site inspectors have explicit minimize/restore buttons, sticky reachable headers, bounded vertical scrolling and restored scroll position. Existing Close actions remain available. The screenshot helper restores the prior information-panel state even when another panel temporarily hides that control.

## Verification scope

Production TypeScript/Vite build passed; all 86 focused release checks passed and cover world, transport, sites, simulation, coverage geometry, political access, continuity, final-surface integration, sparse road indexing and macro roads. A fresh nine-test site run additionally compares bucket queries with canonical distance truth, including wrapped coordinates. The default full npm test list remains available and remains the PR/manual validation gate; push deployment uses the focused release gate followed by build. All 86 release checks keep their assertions and thresholds; the full suite remains in PR/manual validation.

Native Edge desktop WebGPU 1440x900 and emulated phone WebGL2 390x844: minimize/restore/scroll/Close assertions passed for all four inspector types. All eight final screenshots were actually inspected: VISUAL 8/10. No page/console errors; maximum combined estimated CPU+GPU resources 148,420,125 / 125,069,821 bytes. Low-poly prototype art, long canonical references and cold/fine preparation time remain. No physical-phone, complete-interior, full-browser-suite or fresh full-unit-suite claim. The exploratory full local run was stopped before final query optimization, not counted as a pass.

Raw captures and assertions: Temp/advisor-feature-integration-final-ui2; focused tests/build logs: Temp/advisor-feature-integration-*. Initial integration failures and stopped/partial captures are retained. The final site bucket optimization preserves canonical query results and changes no mesh/layout algorithm.

Recorded 2026-10-16 23:26 +0300

## Climate palette integration

Only four RGB constants from #52 are integrated in this step. No climate field, terrain classification, settlement recipe, geometry or streaming algorithm changes. The remaining #52 proposal is not accepted or complete.

All 24 focused climate/world/coverage-geometry checks and the production build passed. Four fresh native Edge images (desktop WebGPU and emulated phone WebGL2, alpine and southern frozen-coast views) were actually inspected: palette readability VISUAL 8/10, no missing terrain or major UI defects. Existing coarse edge steps/filtering and prototype art remain. Both requested backends rendered without page/console errors and passed resource budgets; this is not a physical-device or full-suite claim. Raw images/metadata: Temp/advisor-climate52-local; source asset hashes/build/test logs: Temp/advisor-climate52-accepted. Issues and source PRs remain open and unassigned.
