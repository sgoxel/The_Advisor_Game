import * as pc from "playcanvas";
import { initializeRenderer, rendererMode } from "./renderer-policy.ts";
export const rendererState = {
  requested: rendererMode(location.search),
  backend: "" as string,
  phase: "starting" as "starting" | "ready" | "failed" | "lost",
  error: "",
};
Object.defineProperty(window, "advisorRenderer", { value: rendererState });
export async function createRenderer(
  canvas: HTMLCanvasElement,
): Promise<pc.GraphicsDevice> {
  const options = {
    antialias: true,
    powerPreference: "high-performance" as const,
  };
  try {
    const device = await initializeRenderer<
      pc.GraphicsDevice & {
        initWebGpu?: (
          glslangUrl: undefined,
          twgslUrl: undefined,
        ) => Promise<unknown>;
      }
    >(
      rendererState.requested,
      {
        secure: isSecureContext,
        gpuAvailable: !!(navigator as Navigator & { gpu?: unknown }).gpu,
      },
      {
        webgpu: () => new pc.WebgpuGraphicsDevice(canvas, options),
        webgl2: () => new pc.WebglGraphicsDevice(canvas, options),
      },
    );
    rendererState.backend = device.deviceType;
    rendererState.phase = "ready";
    return device;
  } catch (error) {
    rendererState.phase = "failed";
    rendererState.error =
      error instanceof Error ? error.message : String(error);
    throw error;
  }
}
