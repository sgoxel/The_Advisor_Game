import test from "node:test";
import assert from "node:assert/strict";
import { terrainProgressText, terrainLoadingMessage, residentFactSuffix } from "../src/readiness-presentation.ts";

test("terrain percentage never asserts resident or full interaction readiness", () => {
  assert.equal(terrainProgressText(0), "Terrain 0%");
  assert.equal(terrainProgressText(99), "Terrain 99%");
  assert.equal(terrainProgressText(100), "Terrain 100%");
  assert.equal(terrainProgressText(150), "Terrain 100%");
  assert.equal(terrainLoadingMessage(99, "Paving the roads…"), "Paving the roads…");
  assert.equal(terrainLoadingMessage(100, "Waking the advisors…"),
    "Terrain ready. Resident information loads separately.");
});

test("resident fact status distinguishes exact query absence, pending and ready", () => {
  assert.equal(residentFactSuffix(false, false), "");
  assert.equal(residentFactSuffix(false, true), "");
  assert.equal(residentFactSuffix(true, false), " · residents pending");
  assert.equal(residentFactSuffix(true, true), " · residents ready");
});
