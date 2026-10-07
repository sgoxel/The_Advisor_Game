export interface RendererDevice {
  deviceType: string;
  initWebGpu?: (glslangUrl: undefined, twgslUrl: undefined) => Promise<unknown>;
  destroy: () => void;
}
export async function initializeRenderer<T extends RendererDevice>(
  environment: { secure: boolean; gpuAvailable: boolean },
  createGpu: () => T,
  createGl: () => T,
): Promise<{ device: T; fallbackReason: string }> {
  const messageOf = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  let fallbackReason = !environment.secure
    ? "WebGPU requires a secure context."
    : !environment.gpuAvailable
      ? "This browser does not expose WebGPU."
      : "";
  if (!fallbackReason) {
    let gpu: T | undefined;
    try {
      gpu = createGpu();
      const initialized = await gpu.initWebGpu!(undefined, undefined);
      if (initialized === null)
        throw Error("WebGPU initialization was cancelled.");
      if (gpu.deviceType !== "webgpu")
        throw Error("Unexpected WebGPU backend.");
      return { device: gpu, fallbackReason: "" };
    } catch (error) {
      gpu?.destroy();
      fallbackReason = `WebGPU unavailable: ${messageOf(error)}`;
    }
  }
  let gl: T | undefined;
  try {
    gl = createGl();
    if (gl.deviceType !== "webgl2") throw Error("Unexpected WebGL2 backend.");
    return { device: gl, fallbackReason };
  } catch (error) {
    gl?.destroy();
    throw Error(
      `3D rendering is unavailable. ${fallbackReason} WebGL2 unavailable: ${messageOf(error)}. Restart Chrome and try again.`,
    );
  }
}
