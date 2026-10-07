import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initializeRenderer,
  rendererMode,
  type RendererDevice,
} from "../src/renderer-policy.ts";
test("WebGPU is the default and compatibility requires an explicit choice", () => {
  assert.equal(rendererMode(""), "webgpu");
  assert.equal(rendererMode("?renderer=unknown"), "webgpu");
  assert.equal(rendererMode("?renderer=webgl2"), "webgl2");
});
test("WebGPU initializes directly and never calls the compatibility factory", async () => {
  let initialized = false;
  const gpu: RendererDevice = {
    deviceType: "webgpu",
    destroy() {},
    async initWebGpu() {
      initialized = true;
    },
  };
  assert.equal(
    await initializeRenderer(
      "webgpu",
      { secure: true, gpuAvailable: true },
      {
        webgpu: () => gpu,
        webgl2: () => {
          throw Error("Unexpected fallback");
        },
      },
    ),
    gpu,
  );
  assert.ok(initialized);
});
test("adapter failure releases the attempted device without silently falling back", async () => {
  let destroyed = false;
  await assert.rejects(
    initializeRenderer(
      "webgpu",
      { secure: true, gpuAvailable: true },
      {
        webgpu: () => ({
          deviceType: "webgpu",
          destroy() {
            destroyed = true;
          },
          async initWebGpu() {
            throw Error("No adapter");
          },
        }),
        webgl2: () => {
          throw Error("Unexpected fallback");
        },
      },
    ),
    /No adapter/,
  );
  assert.ok(destroyed);
});
test("insecure or unsupported browsers do not attempt device allocation", async () => {
  const factories = {
    webgpu: () => {
      throw Error("Unexpected allocation");
    },
    webgl2: () => {
      throw Error("Unexpected allocation");
    },
  };
  await assert.rejects(
    initializeRenderer(
      "webgpu",
      { secure: false, gpuAvailable: true },
      factories,
    ),
    /HTTPS/,
  );
  await assert.rejects(
    initializeRenderer(
      "webgpu",
      { secure: true, gpuAvailable: false },
      factories,
    ),
    /does not expose WebGPU/,
  );
});
test("explicit compatibility initializes WebGL2 even without WebGPU", async () => {
  const gl = { deviceType: "webgl2", destroy() {} };
  assert.equal(
    await initializeRenderer(
      "webgl2",
      { secure: true, gpuAvailable: false },
      {
        webgpu: () => {
          throw Error("Unexpected WebGPU attempt");
        },
        webgl2: () => gl,
      },
    ),
    gl,
  );
});
