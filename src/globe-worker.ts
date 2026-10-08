import { buildGlobeSurface } from "./globe-surface.ts";
type Request = {
  id: number;
  width: number;
  height: number;
  samples?: number;
  relief?: number;
};
self.onmessage = (event: MessageEvent<Request>) => {
  const { id, width, height, samples, relief } = event.data;
  try {
    const started = performance.now(),
      { pixels } = buildGlobeSurface(width, height, { samples, relief }),
      buildMs = performance.now() - started;
    self.postMessage(
      { id, width, height, pixels, buildMs },
      { transfer: [pixels.buffer] },
    );
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
