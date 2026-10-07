# WebGPU renderer

WebGPU is now the default required backend. The prior `createGraphicsDevice` helper automatically appended WebGL2 and could hide a failed WebGPU initialization. This behavior is documented in [PlayCanvas's device creation reference](https://api.playcanvas.com/engine/functions/createGraphicsDevice.html) and confirmed in the installed 2.23.0 source.

`src/renderer.ts` constructs `WebgpuGraphicsDevice` directly and awaits `initWebGpu`. Built-in PlayCanvas materials provide WGSL, so the terrain, merged structures, foliage and textured character billboards use WebGPU without additional GLSL translators. The world authority and fantasy-time simulation are unchanged.

Startup checks secure context and the WebGPU API, then reports adapter/device initialization errors. It never silently creates WebGL2. A user may explicitly choose **Continue with WebGL2**, which reloads with `?renderer=webgl2`. The ordinary game URL always requests WebGPU. **Retry WebGPU** returns to that default.

The renderer exposes requested backend, actual backend, phase and failure reason through `window.advisorRenderer` and `window.advisorWorld.renderer`. Device loss pauses frame uploads and displays recovery controls; PlayCanvas's device-restored event resumes rendering and the deterministic clock catches up.

## Verification

`npm test` checks strict backend selection, startup guards, successful initialization, failed-device cleanup and explicit compatibility selection. `npm run test:webgpu` requires an actual WebGPU backend, renders the world and zooms into its geometry; it cannot pass using WebGL2 or a skipped assertion. The deployment workflow runs it on Linux Chromium and uploads screenshots as `webgpu-evidence`.

The software-test launch options follow [Chromium's SwiftShader WebGPU test configuration](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/web_tests/FlagSpecificConfig). These flags apply only to the test browser; the game does not change browser settings or require them on supported hardware.

Local Windows adapter initialization currently reports no available WebGPU adapter. The production build and 15 functional checks pass; missing-adapter UI and explicit compatibility are tested locally. Real WebGPU validation is delegated to the required Linux CI check, with results recorded before completing this work package.
