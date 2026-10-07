import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initializeRenderer,
  type RendererDevice,
} from "../src/renderer-policy.ts";
const environment = { secure: true, gpuAvailable: true };
const gl = (): RendererDevice => ({ deviceType: "webgl2", destroy() {} });
test("WebGPU is preferred without allocating WebGL2", async () => {
  const gpu: RendererDevice = {
    deviceType: "webgpu",
    destroy() {},
    async initWebGpu() {
      return gpu;
    },
  };
  const result = await initializeRenderer(
    environment,
    () => gpu,
    () => {
      throw Error("Unexpected fallback");
    },
  );
  assert.equal(result.device, gpu);
  assert.equal(result.fallbackReason, "");
});
test("blocked adapter releases WebGPU before allocating WebGL2", async () => {
  let destroyed = false;
  const result = await initializeRenderer(
    environment,
    () => ({
      deviceType: "webgpu",
      destroy() {
        destroyed = true;
      },
      async initWebGpu() {
        throw Error("No adapter");
      },
    }),
    () => {
      assert.ok(destroyed);
      return gl();
    },
  );
  assert.equal(result.device.deviceType, "webgl2");
  assert.match(result.fallbackReason, /No adapter/);
});
test("missing API and insecure context go directly to WebGL2", async () => {
  for (const env of [
    { secure: false, gpuAvailable: true },
    { secure: true, gpuAvailable: false },
  ]) {
    const result = await initializeRenderer(
      env,
      () => {
        throw Error("Unexpected GPU allocation");
      },
      gl,
    );
    assert.equal(result.device.deviceType, "webgl2");
    assert.ok(result.fallbackReason);
  }
});
test("factory failure and cancelled initialization fall back", async () => {
  const result = await initializeRenderer(
    environment,
    () => {
      throw Error("Constructor failed");
    },
    gl,
  );
  assert.match(result.fallbackReason, /Constructor failed/);
  let destroyed = false;
  const cancelled = await initializeRenderer(
    environment,
    () => ({
      deviceType: "webgpu",
      destroy() {
        destroyed = true;
      },
      async initWebGpu() {
        return null;
      },
    }),
    gl,
  );
  assert.ok(destroyed);
  assert.match(cancelled.fallbackReason, /cancelled/);
});
test("both backend failures report both reasons", async () => {
  await assert.rejects(
    initializeRenderer(
      environment,
      () => ({
        deviceType: "webgpu",
        destroy() {},
        async initWebGpu() {
          throw Error("No adapter");
        },
      }),
      () => {
        throw Error("No context");
      },
    ),
    /No adapter.*No context/,
  );
});
test("a non-rendering backend cannot be accepted", async () => {
  let destroyed = false;
  await assert.rejects(
    initializeRenderer({ secure: true, gpuAvailable: false }, gl, () => ({
      deviceType: "null",
      destroy() {
        destroyed = true;
      },
    })),
    /Unexpected WebGL2/,
  );
  assert.ok(destroyed);
});
