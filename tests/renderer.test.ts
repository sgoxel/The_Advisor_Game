import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initializeRenderer,
  type RendererDevice,
} from "../src/renderer-policy.ts";
test("WebGPU initializes a real requested device", async () => {
  const gpu: RendererDevice = {
    deviceType: "webgpu",
    destroy() {},
    async initWebGpu() {
      return gpu;
    },
  };
  assert.equal(
    await initializeRenderer({ secure: true, gpuAvailable: true }, () => gpu),
    gpu,
  );
});
test("initialization failure releases the device and reports the adapter error", async () => {
  let destroyed = false;
  await assert.rejects(
    initializeRenderer({ secure: true, gpuAvailable: true }, () => ({
      deviceType: "webgpu",
      destroy() {
        destroyed = true;
      },
      async initWebGpu() {
        throw Error("No adapter");
      },
    })),
    /No adapter/,
  );
  assert.ok(destroyed);
});
test("insecure and unsupported browsers do not allocate a device", async () => {
  const factory = () => {
    throw Error("Unexpected allocation");
  };
  await assert.rejects(
    initializeRenderer({ secure: false, gpuAvailable: true }, factory),
    /HTTPS/,
  );
  await assert.rejects(
    initializeRenderer({ secure: true, gpuAvailable: false }, factory),
    /does not expose WebGPU/,
  );
});
test("another backend is rejected instead of accepted as WebGPU", async () => {
  let destroyed = false;
  await assert.rejects(
    initializeRenderer({ secure: true, gpuAvailable: true }, () => ({
      deviceType: "other",
      destroy() {
        destroyed = true;
      },
      async initWebGpu() {},
    })),
    /did not initialize a WebGPU/,
  );
  assert.ok(destroyed);
});
