export interface RendererDevice {
  deviceType: string;
  initWebGpu?: (glslangUrl: undefined, twgslUrl: undefined) => Promise<unknown>;
  destroy: () => void;
}
export async function initializeRenderer<T extends RendererDevice>(
  environment: { secure: boolean; gpuAvailable: boolean },
  factory: () => T,
): Promise<T> {
  if (!environment.secure)
    throw new Error(
      "WebGPU requires HTTPS or localhost. Open the hosted game or run the local development server.",
    );
  if (!environment.gpuAvailable)
    throw new Error(
      "This browser does not expose WebGPU. Use an up-to-date WebGPU-capable browser with graphics acceleration enabled.",
    );
  const device = factory();
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
