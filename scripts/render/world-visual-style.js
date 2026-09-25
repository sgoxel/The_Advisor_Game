(function(){
"use strict";

// WP-S003-009 — shared low-cost gameplay-world art direction.
// The colorful loading presentation is a mood/palette reference only; no UI
// layout, animation or post-processing is copied into the world renderer.
const STYLE=Object.freeze({
  signature:"living-world-style-v1",
  reference:"scene-loading-color-language",
  palette:Object.freeze({
    gold:Object.freeze([0.949,0.831,0.494]),
    meadow:Object.freeze([0.624,0.816,0.514]),
    teal:Object.freeze([0.447,0.718,0.690]),
    plum:Object.freeze([0.698,0.604,0.875]),
    terracotta:Object.freeze([0.894,0.608,0.467]),
    deepGreen:Object.freeze([0.094,0.125,0.086])
  }),
  hierarchy:Object.freeze([
    "terrain-environment-base",
    "roads-buildings-mid-contrast",
    "characters-high-readability",
    "landmarks-controlled-accent"
  ]),
  lighting:Object.freeze({
    clearColor:Object.freeze([0.100,0.145,0.115]),
    sun:Object.freeze({
      color:Object.freeze([1.000,0.930,0.760]),
      intensity:1.36,
      euler:Object.freeze([48,32,0])
    }),
    fill:Object.freeze({
      color:Object.freeze([0.500,0.670,0.820]),
      intensity:0.28,
      euler:Object.freeze([55,210,0])
    }),
    ambient:Object.freeze([0.240,0.285,0.235])
  }),
  materials:Object.freeze({
    terrainGloss:0.045,
    sharedGloss:0.12,
    presentationGlossMax:0.12,
    metalness:0
  }),
  terrainGrade:Object.freeze({
    saturation:1.16,
    brightness:1.045,
    redLift:0.006,
    greenLift:0.012,
    blueScale:0.975
  }),
  performance:Object.freeze({
    postProcessing:false,
    extraLights:0,
    perObjectShaders:false,
    perFrameWorldScan:false,
    preparationTimeColorGrade:true
  })
});

function clamp01(value){return Math.min(1,Math.max(0,Number(value)||0));}
function gradeRgb(role,color){
  const src=Array.isArray(color)?color:[0,0,0,1];
  let r=clamp01(src[0]),g=clamp01(src[1]),b=clamp01(src[2]);
  const a=src.length>3?clamp01(src[3]):1;
  if(String(role||"")==="terrain"){
    const l=0.2126*r+0.7152*g+0.0722*b;
    const sat=STYLE.terrainGrade.saturation;
    r=l+(r-l)*sat;
    g=l+(g-l)*sat;
    b=l+(b-l)*sat;
    r=r*STYLE.terrainGrade.brightness+STYLE.terrainGrade.redLift;
    g=g*STYLE.terrainGrade.brightness+STYLE.terrainGrade.greenLift;
    b=b*STYLE.terrainGrade.brightness*STYLE.terrainGrade.blueScale;
  }
  return [clamp01(r),clamp01(g),clamp01(b),a];
}
function snapshot(){
  return Object.freeze({
    signature:STYLE.signature,
    reference:STYLE.reference,
    palette:STYLE.palette,
    hierarchy:STYLE.hierarchy,
    lighting:STYLE.lighting,
    materials:STYLE.materials,
    terrainGrade:STYLE.terrainGrade,
    performance:STYLE.performance,
    stylized:true,
    loadingUiCopied:false,
    rendererOnly:true,
    simulationAuthorityPreserved:true
  });
}

window.AdvisorWorldVisualStyle=Object.freeze({
  signature:STYLE.signature,
  reference:STYLE.reference,
  palette:STYLE.palette,
  hierarchy:STYLE.hierarchy,
  lighting:STYLE.lighting,
  materials:STYLE.materials,
  terrainGrade:STYLE.terrainGrade,
  performance:STYLE.performance,
  gradeRgb,
  snapshot
});
})();
