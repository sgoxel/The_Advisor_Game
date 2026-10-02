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
assert.strictEqual(style.snapshot().celLighting.model,"four-band-lambert");
assert.strictEqual(style.snapshot().celLighting.litMaterialApplicationCount,0);
assert.deepStrictEqual(Array.from(style.celLighting.thresholds),[0.14,0.43,0.76]);
assert.deepStrictEqual(Array.from(style.celLighting.diffuseLevels),[0,0.34,0.68,1]);

let glslWrites=0,wgslWrites=0;
const material={
  useLighting:true,
  shaderChunks:{
    glsl:new Map([["lightDiffuseLambertPS","default-glsl"]]),
    wgsl:new Map([["lightDiffuseLambertPS","default-wgsl"]])
  }
};
const glslSet=material.shaderChunks.glsl.set.bind(material.shaderChunks.glsl);
const wgslSet=material.shaderChunks.wgsl.set.bind(material.shaderChunks.wgsl);
material.shaderChunks.glsl.set=(...args)=>{glslWrites++;return glslSet(...args)};
material.shaderChunks.wgsl.set=(...args)=>{wgslWrites++;return wgslSet(...args)};

assert.strictEqual(style.applyLitMaterial(material),true);
const glsl=material.shaderChunks.glsl.get("lightDiffuseLambertPS");
const wgsl=material.shaderChunks.wgsl.get("lightDiffuseLambertPS");
assert.match(glsl,/vec3 worldNormal/);
assert.match(glsl,/diffuse < 0\.43/);
assert.match(wgsl,/worldNormal: vec3f/);
assert.match(wgsl,/diffuse < 0\.76/);
assert.strictEqual(material.useLighting,true,"style application changed material lighting mode");
assert.strictEqual(style.applyLitMaterial(material),false,"style application was not idempotent");
assert.strictEqual(style.snapshot().celLighting.litMaterialApplicationCount,1);
assert.strictEqual(glslWrites,1,"GLSL chunk was written more than once");
assert.strictEqual(wgslWrites,1,"WGSL chunk was written more than once");
assert.throws(()=>style.applyLitMaterial(null),/Grounded cel lighting requires/);

console.log("WP-S003-009 cel-lighting material contract passed");
