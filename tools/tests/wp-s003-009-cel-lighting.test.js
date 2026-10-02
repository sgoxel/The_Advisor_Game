"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

const context={window:{}};
vm.runInNewContext(
  fs.readFileSync("scripts/render/world-visual-style.js","utf8"),
  context,
  {filename:"scripts/render/world-visual-style.js"}
);

const style=context.window.AdvisorWorldVisualStyle;
assert(style,"world visual style API did not register");
assert.strictEqual(style.snapshot().celLighting.model,"four-band-lambert-filled-shadow");
assert.strictEqual(style.snapshot().celLighting.litMaterialApplicationCount,0);
assert.deepStrictEqual(Array.from(style.celLighting.thresholds),[0.14,0.43,0.76]);
assert.deepStrictEqual(Array.from(style.celLighting.diffuseLevels),[0.16,0.40,0.70,1]);
assert.strictEqual(style.celLighting.shadowFloor,0.16);
assert.strictEqual(style.celLighting.fillBalanced,true);

let glslWrites=0,wgslWrites=0;
const chunkMaps={
  glsl:new Map([["lightDiffuseLambertPS","default-glsl"]]),
  wgsl:new Map([["lightDiffuseLambertPS","default-wgsl"]])
};
const material={
  useLighting:true,
  shaderChunksVersion:null,
  getShaderChunks(language){return chunkMaps[language]||null;}
};
const glslSet=chunkMaps.glsl.set.bind(chunkMaps.glsl);
const wgslSet=chunkMaps.wgsl.set.bind(chunkMaps.wgsl);
chunkMaps.glsl.set=(...args)=>{glslWrites++;return glslSet(...args)};
chunkMaps.wgsl.set=(...args)=>{wgslWrites++;return wgslSet(...args)};

assert.strictEqual(style.applyLitMaterial(material),true);
const glsl=chunkMaps.glsl.get("lightDiffuseLambertPS");
const wgsl=chunkMaps.wgsl.get("lightDiffuseLambertPS");
assert.match(glsl,/vec3 worldNormal/);
assert.match(glsl,/diffuse < 0\.43/);
assert.match(wgsl,/worldNormal: vec3f/);
assert.match(wgsl,/diffuse < 0\.76/);
assert.strictEqual(material.useLighting,true,"style application changed material lighting mode");
assert.strictEqual(material.shaderChunksVersion,"2.23","PlayCanvas shader chunk version was not pinned");
assert.strictEqual(style.applyLitMaterial(material),false,"style application was not idempotent");
assert.strictEqual(style.snapshot().celLighting.litMaterialApplicationCount,1);
assert.strictEqual(glslWrites,1,"GLSL chunk was written more than once");
assert.strictEqual(wgslWrites,1,"WGSL chunk was written more than once");
assert.throws(()=>style.applyLitMaterial(null),/Grounded cel lighting requires/);
assert.throws(()=>style.applyLitMaterial({}),/Grounded cel lighting requires/);

console.log("WP-S003-009 cel-lighting material contract passed");
