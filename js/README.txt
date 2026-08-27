# README – WebGL / HTML5 Tile-Based Map Generator Application

// THIS README FILE MUST BE UPDATED IF ANY CHANGES ARE APPLIED BY AI TOOLS.

## 1. Overview

This application is a WebGL + HTML5-based tile map generator designed for procedural terrain generation.

- Fully client-side (no backend)
- Lightweight architecture
- Deterministic behavior support (via seed if implemented)

Primary goal:
Enable safe, controlled updates by AI tools.

---

## 2. Core Functional Capabilities

### Map Generation
- Grid-based system
- Default tile: grass
- Other tiles: settlement, forest, lake, dirt

### Rules
- Settlement size: 5x5 to 8x8
- Non-grass tiles must be clustered
- Grass = base layer

---

## 3. Generation Pipeline (STRICT ORDER)

1. Initialize map with grass
2. Generate clusters (forest, lake, dirt)
3. Generate settlements (last)

AI MUST NOT change this order.

---

## 4. Tile Priority Rules

Priority (high → low):
1. Settlement
2. Lake
3. Forest
4. Dirt
5. Grass

Higher priority tiles overwrite lower ones.

---

## 5. Coordinate System

- Origin: (0,0) top-left
- X → right
- Y → down

---

## 6. Tile Model

{
  type: "grass" | "forest" | "lake" | "settlement" | "dirt",
  x: number,
  y: number
}

---

## 7. Function Contracts

generateMap():
- Must follow pipeline order

generateSettlements():
- Must create 5x5–8x8 rectangles
- Must not overlap or exceed bounds

generateClusters():
- Must create connected tiles
- No isolated tiles allowed

---

## 8. Edge Case Rules

- No out-of-bound placement
- No overlapping settlements
- Clusters must stay within bounds

---

## 9. Rendering Rules

- Renderer is READ-ONLY
- Must not modify tile data

---

## 10. Export Rules

- Export map bundles as JavaScript files (no separate image export)
- Format: map.js containing map data + mapImage.dataUrl
- Import path is JS-only (no PNG or steganographic decoding flow)

---

## 11. Randomization

- If randomness is used:
  - Seed-based approach recommended
  - AI must preserve randomness behavior

---

## 12. Performance

- Avoid unnecessary loops
- Prefer preallocated arrays
- Minimize redraws

---

## 13. AI Update Rules

AI MUST:
- Make minimal changes
- Preserve architecture
- Avoid refactoring unless required

AI MUST NOT:
- Change tile types
- Change grid structure
- Move logic between layers
- Introduce backend or async complexity

---

## 14. Naming Conventions

- camelCase → functions
- UPPER_CASE → constants
- lowercase → tile types

---

## 15. AI Change Log

Every update must append:

Date:
Modified files:
Description:
Reason:

---

## 16. Summary

- Grid-based procedural generator
- WebGL rendering
- JS map bundle export/import
- Fully client-side

AI must prioritize:
- Stability
- Predictability
- Minimal impact changes

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
