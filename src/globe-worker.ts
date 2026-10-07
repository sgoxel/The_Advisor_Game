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
    const { pixels } = buildGlobeSurface(width, height, { samples, relief });
    self.postMessage(
      { id, width, height, pixels },
      { transfer: [pixels.buffer] },
    );
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
