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
    // Temporary device-level diagnostics while validating the mapped-buffer path.
    const gpu = Reflect.get(device, "wgpu");
    const nativeDestroy = gpu.destroy.bind(gpu);
    gpu.destroy = () => { console.error("WebGPU explicit device destruction", new Error().stack); nativeDestroy(); };
    const staging = gpu.createBuffer({ size: 102400, usage: 6, mappedAtCreation: true });
    console.info("Engine WebGPU staging preflight", staging.getMappedRange().byteLength);
    staging.unmap(); staging.destroy();
    gpu.lost.then((info: { reason: string; message: string }) => console.error("WebGPU device lost", info.reason, info.message));
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
