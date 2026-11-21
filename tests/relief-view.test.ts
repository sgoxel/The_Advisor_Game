import test from "node:test";
import assert from "node:assert/strict";
import { reliefFacingYaw } from "../src/relief-view.ts";

const PI = Math.PI;
const offset = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

test("flat ground keeps the current camera yaw", () => {
  const flat = () => 42;
  assert.equal(reliefFacingYaw(flat, 0, 0, 10, 0.37), 0.37);
});

test("camera sits downhill of a plane rising toward +z", () => {
  const yaw = reliefFacingYaw((_x, z) => 50 * z, 0, 0, 10, 0);
  assert.ok(Math.abs(Math.abs(yaw) - PI) < 1e-9, `yaw ${yaw} should be +-PI`);
  assert.ok(offset(yaw).z < -0.999, "camera at -z looking uphill toward +z");
});

test("camera sits downhill of a plane rising toward +x", () => {
  const yaw = reliefFacingYaw((x) => 50 * x, 0, 0, 10, 0);
  assert.ok(Math.abs(yaw + PI / 2) < 1e-9, `yaw ${yaw} should be -PI/2`);
  assert.ok(offset(yaw).x < -0.999, "camera at -x looking uphill toward +x");
});

test("step cliff puts the camera on the low (-z) side", () => {
  const cliff = (_x: number, z: number) => (z > 2 ? 100 : 0);
  const yaw = reliefFacingYaw(cliff, 0, 0, 4, 0);
  assert.ok(Math.abs(Math.abs(yaw) - PI) < 1e-9, `yaw ${yaw} should be +-PI`);
  assert.ok(offset(yaw).z < -0.999, "camera at -z, cliff face on +z side");
});

test("rise below minRiseMetres keeps the current yaw", () => {
  // Ring spans -4..4 metres (8 m range), below the default 10 m threshold.
  const gentle = (_x: number, z: number) => z;
  assert.equal(reliefFacingYaw(gentle, 0, 0, 4, 1.25), 1.25);
  // Same slope is accepted when the caller lowers the threshold.
  assert.notEqual(reliefFacingYaw(gentle, 0, 0, 4, 1.25, 5), 1.25);
});

test("result is deterministic for identical input", () => {
  const ridge = (x: number, z: number) => 30 * Math.sin(x * 0.7) + 20 * z;
  const first = reliefFacingYaw(ridge, 3, -2, 6, 0.5);
  const second = reliefFacingYaw(ridge, 3, -2, 6, 0.5);
  assert.equal(first, second);
  assert.ok(first > -PI && first <= PI, "normalised to (-PI, PI]");
});

test("a wall taller than the visible frame keeps the current yaw", () => {
  const cliff = (_x: number, z: number) => (z > 2 ? 100 : 0);
  assert.equal(reliefFacingYaw(cliff, 0, 0, 4, -0.22, 10, 64), -0.22);
  const turned = reliefFacingYaw(cliff, 0, 0, 4, -0.22, 10, 244);
  assert.ok(Math.abs(Math.abs(turned) - PI) < 1e-9, `yaw ${turned} should face the cliff from -z`);
});
