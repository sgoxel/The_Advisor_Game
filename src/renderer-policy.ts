export type RendererMode = "webgpu" | "webgl2";
export function rendererMode(search: string): RendererMode {
  return new URLSearchParams(search).get("renderer") === "webgl2"
    ? "webgl2"
    : "webgpu";
}
export interface RendererDevice {
  deviceType: string;
  initWebGpu?: (glslangUrl: undefined, twgslUrl: undefined) => Promise<unknown>;
  destroy: () => void;
}
export async function initializeRenderer<T extends RendererDevice>(
  mode: RendererMode,
  environment: { secure: boolean; gpuAvailable: boolean },
  factories: { webgpu: () => T; webgl2: () => T },
): Promise<T> {
  if (mode === "webgl2") return factories.webgl2();
  if (!environment.secure)
    throw new Error(
      "WebGPU requires HTTPS or localhost. Open the hosted game or run the local development server.",
    );
  if (!environment.gpuAvailable)
    throw new Error(
      "This browser does not expose WebGPU. Use an up-to-date WebGPU-capable browser with graphics acceleration enabled.",
    );
  const device = factories.webgpu();
  try {
    const initialized = await device.initWebGpu!(undefined, undefined);
    if (initialized === null)
      throw new Error("WebGPU initialization was cancelled.");
    if (device.deviceType !== "webgpu")
      throw new Error("The renderer did not initialize a WebGPU device.");
    return device;
  } catch (error) {
    device.destroy();
    throw new Error(
      `WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
