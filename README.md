# The Advisor Game

A medieval 3D world atlas built with PlayCanvas 2.23.0, using WebGPU by default. Its fixed seed, five nested generation levels and fantasy clock determine world content and resident schedules without random-number APIs. If WebGPU is unavailable, choose the explicit WebGL2 compatibility option. See [WebGPU setup and verification](docs/WEBGPU.md).

The realm has three continents, 30 countries, 90 cities and 270 villages. Two-metre cells and lazy tile streaming keep detailed generation local to the camera. The focused country's residents update live; distant countries retain coarse summaries.

## Develop

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. `index.html` is the entry page; TypeScript sources require the development server or a production build.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Drag to pan, scroll or pinch to zoom, click a landscape cell to inspect its seed ancestry, and use the destination menu to visit any settlement. Q/E rotate the view when the canvas has focus. Calendar time advances at 24× real time, beginning at fantasy year 0126.

[World architecture and Google Earth reference analysis](docs/WORLD_ARCHITECTURE.md) · [Full game design](docs/README.md)
