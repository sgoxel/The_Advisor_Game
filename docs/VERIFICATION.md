# World atlas verification

Verified on 7 October 2026 in the local production build.

- `npm test`: 10 passing checks covering five-level inheritance, negative coordinates, island bounds, tile coverage, LOD feature ownership, absence of application RNG APIs, world settlement counts, bridge walkability, the accelerated calendar and lazy simulation catch-up.
- `npm run build`: TypeScript and Vite production build passed. PlayCanvas emits optional Node-worker externalization notices and a bundle-size advisory; the exercised browser paths work in the built output.
- Production browser checks: desktop exploration/zoom/cache/second-continent travel and phone layout/inspection passed. A separate final layer-control check passed and verified that hiding structures also hides their small decorations.
- After moving village fields clear of nearby homes, generation/route checks and the production build passed again. The final built scene was recaptured with `tools/capture-world.mjs`, including continent overview, street detail, city travel, phone layout and cell inspection.

## Visual inspection

The screenshots were opened and inspected, not scored from logs. Prototype visual score: **8/10**. The village is readable, roofs and keep towers occupy correct 3D depth, the bridge spans the river, fields are clear of homes, and desktop/phone controls and the cell inspector remain readable. The three continental masses are distinct and the city has a visibly larger house district. There are no major missing-terrain holes in the captured settled views.

Remaining visual limitations include regular city grids, blocky coarse shorelines, simple character artwork, occasional fine terrain seam stippling and fixed development lighting. This is a low-poly world foundation rather than finished production art.

- [Village desktop](evidence/village-desktop.png)
- [Street detail](evidence/street-desktop.png)
- [Three continents](evidence/realm-desktop.png)
- [Tile overlay](evidence/realm-tiles.png)
- [City on Westreach](evidence/city-westreach.png)
- [Phone village](evidence/village-phone.png)
- [Phone cell inspector](evidence/cell-phone.png)
- [Desktop cell inspector](evidence/cell-desktop.png)

## WebGPU and performance limit

The code requests WebGPU through PlayCanvas 2.23.0, then falls back to WebGL2. Three local Chromium adapter probes (default hardware, Dawn SwiftShader and Vulkan SwiftShader) returned no WebGPU adapter. Browser evidence uses WebGL2 software rendering. Actual WebGPU output and hardware/mobile frame rates remain unverified; these checks do not certify the design's future 60/30 FPS targets.

## Deployment

Pending verification of the first GitHub Actions/Pages deployment. The roadmap work package remains in progress until the final main commit is deployed.
