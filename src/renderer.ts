import * as pc from "playcanvas";
import { initializeRenderer } from "./renderer-policy.ts";
export const rendererState = {
  requested: "webgpu",
  backend: "" as string,
  phase: "starting" as "starting" | "ready" | "failed" | "lost",
  error: "",
  fallbackReason: "",
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
    const { device, fallbackReason } = await initializeRenderer<
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
      () =>
        new pc.WebgpuGraphicsDevice(canvas, {
          ...options,
          featureLevel: "bare",
        }),
      () => {
        // A canvas bound to WebGPU cannot acquire a WebGL2 context, even after
        // device destruction. Use a fresh surface after any GPU failure.
        const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
        canvas.replaceWith(replacement);
        return new pc.WebglGraphicsDevice(replacement, options);
      },
    );
    rendererState.backend = device.deviceType;
    rendererState.fallbackReason = fallbackReason;
    rendererState.phase = "ready";
    return device;
  } catch (error) {
    rendererState.phase = "failed";
    rendererState.error =
      error instanceof Error ? error.message : String(error);
    throw error;
  }
}
