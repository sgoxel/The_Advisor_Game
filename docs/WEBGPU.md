# WebGPU renderer

WebGPU is now the default required backend. The prior `createGraphicsDevice` helper automatically appended WebGL2 and could hide a failed WebGPU initialization. This behavior is documented in [PlayCanvas's device creation reference](https://api.playcanvas.com/engine/functions/createGraphicsDevice.html) and confirmed in the installed 2.23.0 source.

`src/renderer.ts` constructs `WebgpuGraphicsDevice` directly and awaits `initWebGpu`. Built-in PlayCanvas materials provide WGSL, so the terrain, merged structures, foliage and textured character billboards use WebGPU without additional GLSL translators. The world authority and fantasy-time simulation are unchanged.

Startup checks secure context and the WebGPU API, then reports adapter/device initialization errors. There is no WebGL2 renderer or compatibility option. Old renderer query parameters cannot select another backend. **Retry WebGPU** reloads the page after the user resolves the adapter or browser issue.

The renderer exposes requested backend, actual backend, phase and failure reason through `window.advisorRenderer` and `window.advisorWorld.renderer`. Device loss pauses frame uploads and displays recovery controls; PlayCanvas's device-restored event resumes rendering and the deterministic clock catches up.

## Verification

`npm test` checks startup guards, successful initialization, failed-device cleanup and rejection of another backend. `npm run test:webgpu` requires an actual WebGPU backend, renders the world and zooms into its geometry; it cannot pass using another renderer or a skipped assertion. The deployment workflow runs it on Linux Chromium and uploads screenshots as `webgpu-evidence`.

The software-test launch options follow [Chromium's SwiftShader WebGPU test configuration](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/web_tests/FlagSpecificConfig). These flags apply only to the test browser; the game does not change browser settings or require them on supported hardware.

The production build and 14 functional checks pass. The Linux runner rendered the actual WebGPU village and zoomed detail without GPU/shader errors in [run 37605770976](https://github.com/sgoxel/The_Advisor_Game/actions/runs/37605770976), which also deployed successfully. Local Windows adapter initialization reports no available WebGPU adapter; its unsupported-device UI has no compatibility choice.

The initial CI failures came from [headless canvas presentation without a GPU-enabled Vulkan compositor and X display](https://github.com/visgl/luma.gl/issues/2874). Acquiring the swapchain texture dropped the native device and made later staging-buffer allocations fail. CI now runs with Xvfb, GPU-enabled headless rendering and Vulkan/SwiftShader compositing. Temporary native-device diagnostics were removed. Software WebGPU rendering is verified; hardware/mobile frame-rate benchmarking remains future work.

The finalized implementation `be2566e` [passed WebGPU rendering and deployed successfully](https://github.com/sgoxel/The_Advisor_Game/actions/runs/37606605638). The [village](evidence/webgpu-village.png) and [zoomed detail](evidence/webgpu-detail.png) screenshots were opened and inspected. Prototype visual score: **8/10**. Terrain, buildings, trees, bridge and resident artwork render correctly; the shortened-window map panel no longer overlaps the footer or status bar. Remaining art limitations are the same low-poly foundation noted in the original verification report.
