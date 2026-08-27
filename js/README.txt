# Technical Notes – WebGL / HTML5 Tile-Based Map Generator Application

> Authority note
>
> This file is subordinate implementation documentation. It records useful facts and historical notes about the imported map baseline; it does not define project/product authority or freeze architecture.
>
> Authority order is defined by the root `README.md`: Admin explicit instruction → README.md → ROADMAP → TODO → Issues → Code / Assets → Tests. Planner-approved scope/decomposition and active issues may therefore change implementation details documented here. The root README itself may be changed only with explicit Admin authorization.
>
> When this file conflicts with higher-authority project state, follow the higher-authority state and update this technical documentation when useful. Historical change-log entries below are retained as history, not as permanent mandates.

## 1. Overview

This application is a WebGL + HTML5-based tile map generator designed for procedural terrain generation.

Current baseline characteristics:
- Fully client-side (no backend in the imported baseline)
- Lightweight JavaScript/WebGL architecture
- Deterministic behavior support through seeded generation

These are implementation facts of the current baseline, not restrictions against approved future architecture changes.

---

## 2. Current Functional Capabilities

### Map Generation
- Grid-based system
- Grass/base terrain plus settlement, forest, lake/water, dirt, roads and later imported terrain/elevation behavior
- Seed/map-derived generated terrain shapes are used by the current renderer

### Legacy generation assumptions
Historically, settlement placement used 5x5 to 8x8 rectangles, non-grass terrain was clustered, and grass acted as the base layer. Treat these as notes about the imported implementation unless an active approved task requires different behavior.

---

## 3. Generation Pipeline

The imported generator historically followed this broad order:
1. Initialize base terrain
2. Generate clustered terrain/features
3. Generate settlements and connectivity
4. Derive/render later terrain-shape/elevation overlays as implemented by subsequent versions

Preserve deterministic dependencies when modifying the pipeline. The exact order may be changed by approved work when tests and dependent behavior are updated accordingly.

---

## 4. Tile Priority Notes

Legacy priority was:
1. Settlement
2. Lake
3. Forest
4. Dirt
5. Grass

Higher-priority tiles historically overwrote lower-priority tiles. Later terrain, road and elevation systems may add additional representation rules; inspect current code and approved issue scope before relying on this list.

---

## 5. Coordinate System

- Origin: (0,0) top-left
- X → right
- Y → down

---

## 6. Legacy Tile Model

{
  type: "grass" | "forest" | "lake" | "settlement" | "dirt",
  x: number,
  y: number
}

This snippet describes the original baseline model and is not an exhaustive permanent type contract.

---

## 7. Function Notes

`generateMap()` coordinates map generation.

`generateSettlements()` historically creates bounded settlement footprints and avoids invalid overlap.

`generateClusters()` historically creates connected terrain clusters.

Exact function responsibilities/module boundaries are implementation details. Approved work may refactor them while preserving required product behavior, deterministic state boundaries, and relevant regression coverage.

---

## 8. Edge-Case Expectations

Current generation should avoid invalid out-of-bounds placement and unintended overlapping structures, and should keep generated features within valid map bounds. More specific constraints belong to current code/tests and approved issue acceptance criteria.

---

## 9. Rendering Boundary

The renderer should present simulation/map data rather than silently invent authoritative world truth. Visual state by itself is not simulation authority. Rendering implementation may evolve under approved scope.

---

## 10. Current Export / Import Notes

The imported current baseline uses JavaScript map bundles rather than the older PNG/steganography flow:
- Export map bundles as JavaScript files.
- Current bundle format includes map data plus `mapImage.dataUrl`.
- Current import path is JS-bundle based.

Older PNG/TXT/JSON/steganography entries in the historical log below describe superseded versions and are retained only for provenance.

---

## 11. Randomization and Determinism

Authoritative/procedural randomness should use explicit deterministic inputs such as the campaign/map seed where required by current project scope. Avoid introducing hidden ambient entropy into authoritative outcomes. Consult current README, ROADMAP, TODO, issue acceptance criteria and tests for the applicable deterministic contract.

---

## 12. Performance Guidance

Useful baseline guidance:
- Avoid unnecessary work in hot loops.
- Prefer appropriate data reuse/preallocation where it materially helps.
- Minimize avoidable redraws and expensive per-frame allocations.

Performance guidance is advisory; correctness, README compatibility, accessibility and approved acceptance criteria take precedence.

---

## 13. AI / Worker Update Guidance

Workers should:
- Follow Admin, root README, Planner-owned ROADMAP/TODO, and active issue scope in that authority order.
- Prefer scoped changes and preserve unrelated behavior.
- Inspect current implementation and regression coverage before changing architecture or data flow.
- Update subordinate technical notes when an approved change makes factual documentation materially stale.

Workers are not prohibited by this legacy document from changing tile types, grid structure, module boundaries, architecture, pipeline order, backend strategy, asynchronous behavior, or refactoring when higher-authority approved work requires or justifies those changes.

---

## 14. Naming Conventions

Current imported code commonly uses:
- camelCase → functions/variables
- UPPER_CASE → constants
- lowercase identifiers → many tile types

Match surrounding code unless approved work intentionally changes conventions.

---

## 15. Technical Change Log

Historical entries are descriptive records only. They do not override current Admin/README/Planner/issue authority and do not permanently freeze the implementation decisions they describe.

Date: 2026-03-27
Modified files: js/ui.js, js/terrain.js
Description: Export now downloads the full generated map image from the world background canvas instead of only the visible viewport; settlement rectangles are explicitly clamped to 5x5–8x8 for both generated and fallback placement.
Reason: Meet the full-map PNG export requirement while preserving rendering performance and guarantee settlement size bounds in all placement paths.

Date: 2026-03-27
Modified files: js/ui.js, js/terrain.js
Description: PNG export now rotates the full-map image 90 degrees clockwise before download; world generation now enforces a blocked-terrain coverage floor of 30% while keeping clustered obstacle placement and without exceeding the intended 60% ceiling.
Reason: Meet the export orientation requirement and prevent sparse maps that look overly empty in generated results.

Date: 2026-03-28
Modified files: index.html, js/ui.js, js/state.js, locales/en.json, locales/tr.json, js/README.txt
Description: Added an Export Map Data button under the main menu that downloads a TXT file containing JSON-formatted map data, current world metadata, camera settings, flattened tile records, and an embedded PNG data URL for later re-import.
Reason: Support single-file export of map image and tile information with minimal UI and logic changes while preserving the existing application behavior.

Date: 2026-03-28
Modified files: js/app.js, js/README.txt
Description: Added automatic seed-based map import. When matching /map/<SEED>.txt and /map/<SEED>.png files both exist, the app loads those files instead of generating a new map, restoring tile data from JSON and using the PNG as the background map image.
Reason: Enable deterministic reuse of previously exported map assets with minimal impact on the existing generation flow.

Update v98.1
- Added a local-folder loading fallback for file:// usage.
- When the browser blocks fetch access to map/*.txt under file://, use Main Menu > Load and select the app folder or the map folder once.
- After folder selection, the app searches for SEED-matching .txt and .png files and loads them instead of generating a new map.
- Standard automatic loading from /map still works normally when the app is served through http:// or https://.

Update v100:
- Fixed persistent visible native file picker issue by adding a global .hidden CSS rule.
- Forced #localMapFolderInput to remain out of layout with display:none, zero size, opacity 0, and no pointer events.
- Added hidden, aria-hidden, and tabindex=-1 attributes to the local folder input element.
- Main Menu button types remain correct; the issue was not caused by button type.
- Imported stored PNG map images are rotated 90 degrees counter-clockwise in the gameplay background so they align with the minimap orientation.

Update v102b
Modified files: js/app.js, js/README.txt
Description: Manual map loading now ignores the current SEED when files are selected through Main Menu > Load. The app loads the first .png file in the selected folder that has a matching .txt file with the same base filename, then updates the active SEED to that filename. Automatic SEED-based loading from /map/<SEED>.png and /map/<SEED>.txt remains unchanged for direct startup loading.

Version: v104
Date: 2026-03-28
Description: PNG export now embeds the full map JSON payload directly inside the exported PNG as PNG metadata. Map loading now supports PNG-only imports by reading embedded JSON when no matching TXT file is present, for both manual folder loading and normal map-folder loading.
Reason: Allow single-file map portability so users can distribute and reload only one PNG file instead of a PNG and TXT pair.

2026-03-28
Modified files: js/ui.js, js/app.js
Description: Replaced PNG metadata embedding with steganographic PNG export/import. Exported PNG files now hide the map JSON inside pixel LSB data, allowing PNG-only loading under file:// by decoding the image through an off-screen canvas. Manual and automatic loading continue to support legacy .txt sidecar files and earlier metadata-based PNG files as fallbacks.

2026-03-28 cache fallback update
- Added IndexedDB-based local cache for successfully imported map PNG+JSON payloads.
- Under file:// startup, when browser canvas security blocks steganographic decoding of map/<SEED>.png, the app now falls back to the last cached copy of that seed if it was loaded manually before.
- Added clearer log text explaining that direct startup decoding from local disk is blocked by browser security and that one successful manual load seeds the cache for later sessions.

Version: 108
Description: Startup map import now first checks the fixed file /map/map.png instead of matching the current SEED to the filename. The PNG export now defaults to the filename map.png. The embedded JSON payload already carries the map SEED, and the loader now applies that embedded SEED to the world after import. This allows the app to boot from /map/map.png, read the embedded SEED and map data, and load the correct map without renaming the file to the SEED value.
Reason: Support a fixed startup filename without requiring directory listing, wildcard lookup, or SEED-based filenames.

Update 24
Modified files: js/ui.js, js/app.js, js/README.txt
Description: Export Map Data now downloads a .json file instead of .txt. Map loading now prefers matching .json sidecar files and still accepts legacy .txt sidecars as fallback for backward compatibility. Note: this extension change does not remove Chrome file:// authorization restrictions by itself; local file access behavior is controlled by the browser.

Version: v114
Description: Startup map loading now checks PNG files in this order: /map/<SEED>.png, /map/<SEED>/<SEED>.png, then /map/map.png. A matching JS sidecar is only attempted when the PNG exists but its embedded map data cannot be decoded. PNG imports now prefer the payload's embedded mapImage.dataUrl for rendering, which avoids file:// tainted-canvas texture upload errors when WebGL draws the gameplay background.

### Update 35
Description: Renamed the main menu export action to 'Export Map Image' and added inertial camera dragging for mouse and touch so map panning continues smoothly after release, with improved touch responsiveness on Android devices.

Date: 2026-03-28
Modified files: js/terrain.js, js/topology.js, js/README.txt
Description: Reworked settlement road generation so each settlement road now starts from the tile directly below the midpoint of the settlement's bottom edge, then connects into a junction-based road network instead of chaining settlements in a fixed order. Added protected gate routing so settlement exits stay clean. Reworked dirt generation into clustered blobs and changed dirt targeting so dirt occupies 30% to 70% of the combined grass+dirt surface area.
Reason: Meet the requested settlement connection logic and clustered dirt coverage constraints with minimal architectural impact.

Date: 2026-03-28
Modified files: index.html, js/ui.js, js/app.js, js/state.js, locales/en.json, locales/tr.json, locales/en.js, locales/tr.js, js/README.txt
Description: PNG export now outputs a transparent diamond-shaped map image matching gameplay orientation, and PNG import now restores these diamond exports correctly. Added a new main menu action to export per-tile-type mask PNG images bundled into a ZIP archive.
Reason: Support gameplay-shaped PNG portability and provide mask assets for all tile types without changing the rest of the application.

Date: 2026-03-30
Modified files: index.html, js/app.js, js/renderer.js, js/state.js, js/ui.js, locales/en.js, locales/en.json, locales/tr.js, locales/tr.json, js/README.txt
Description: Removed PNG/steganography map import-export workflow and switched to JS-only map bundles. Startup and manual folder loading now use .js files that include both map payload and mapImage.dataUrl. Main menu export now downloads map.js, and map-loading logs were updated to JS-bundle terminology.
Reason: Eliminate file-origin canvas taint failure paths and keep map portability in a single JS file.

Version: v147-overlay-2d
Date: 2026-03-31
Modified files: js/renderer.js, js/ui.js, js/README.txt
Description: Replaced the previous shadow-like terrain-shape depth attempt with a true 2D screen-space 2.5D overlay pass. The app now creates visible front-side wall faces for rounded terrain shapes by projecting the lower contour to screen space, extruding only the camera-facing segments downward, and filling those quads with the same terrain texture plus vertical shading so the colors overflow downward without breaking rounded corners.
Reason: The prior result read as a flat ground shadow instead of an isometric 2.5D side surface. The new solution keeps the existing app architecture and terrain generation unchanged while producing a clearer cubic depth effect using a lightweight 2D overlay.

Date: 2026-03-31
Modified files: js/terrain.js, js/renderer.js, js/app.js, js/README.txt
Description: Replaced config-driven TERRAIN_SHAPES usage with seed/map-derived generated terrain shapes built from the current terrain grid. The full map background now starts from a grass base and renders terrain through generated terrain-shape top passes, while roads remain on the road overlay. Elevations are normalized to 0=lake/river, 1=grass/dirt/road/settlement, 2=forest, 3=mountain; 2.5D wall overlays are rendered only for raised generated shapes with elevation differences above the base level.
Reason: Meet the requirement to stop using the old tile painting system for terrain surfaces, move terrain drawing to terrain-shape logic, keep roads as overlays, and derive terrain-shape placement from map generation/seed data rather than config.js.

Date: 2026-08-28
Modified files: js/README.txt
Description: Reclassified this file as subordinate technical documentation, documented the current project authority boundary, converted legacy absolute AI/architecture/pipeline mandates into factual or advisory implementation notes, and retained historical change entries as provenance rather than permanent rules.
Reason: R01-T06 / #63 requires the imported v155 guidance to remain useful without overriding Admin, root README, Planner-owned scope/decomposition, or approved implementation work.