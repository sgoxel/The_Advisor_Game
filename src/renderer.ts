import * as pc from "playcanvas";
import { initializeRenderer } from "./renderer-policy.ts";
export const rendererState = {
  requested: "webgpu",
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
    powerPreference: "default" as const,
    xrCompatible: false,
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
      {
        secure: isSecureContext,
        gpuAvailable: !!(navigator as Navigator & { gpu?: unknown }).gpu,
      },
      () => new pc.WebgpuGraphicsDevice(canvas, { ...options, featureLevel: "bare" }),
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
