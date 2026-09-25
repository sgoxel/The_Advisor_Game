(function(){
"use strict";

// WP-S003-009 — shared low-cost gameplay-world art direction.
// The loading presentation supplies the palette/mood language only. Gameplay
// keeps its own geometry, sprites, UI and renderer architecture.
const STYLE=Object.freeze({
  signature:"living-world-style-v2",
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
    clearColor:Object.freeze([0.075,0.120,0.095]),
    sun:Object.freeze({
      color:Object.freeze([1.000,0.915,0.730]),
      intensity:1.48,
      euler:Object.freeze([48,32,0])
    }),
    fill:Object.freeze({
      color:Object.freeze([0.480,0.660,0.840]),
      intensity:0.24,
      euler:Object.freeze([55,210,0])
    }),
    ambient:Object.freeze([0.205,0.245,0.200])
  }),
  materials:Object.freeze({
    terrainGloss:0.035,
    sharedGloss:0.10,
    presentationGlossMax:0.11,
    metalness:0
  }),
  terrainGrade:Object.freeze({
    green:Object.freeze({saturation:1.30,brightness:1.045,redScale:0.955,greenScale:1.045,blueScale:0.915,redOffset:-0.004,greenOffset:0.022,blueOffset:0}),
    water:Object.freeze({saturation:1.22,brightness:1.035,redScale:0.900,greenScale:1.015,blueScale:1.080,redOffset:-0.006,greenOffset:0.004,blueOffset:0.020}),
    earth:Object.freeze({saturation:1.22,brightness:1.025,redScale:1.055,greenScale:1.005,blueScale:0.900,redOffset:0.012,greenOffset:0.004,blueOffset:0}),
    constructed:Object.freeze({saturation:1.10,brightness:1.010,redScale:1.010,greenScale:1.000,blueScale:0.970,redOffset:0.004,greenOffset:0,blueOffset:0}),
    neutral:Object.freeze({saturation:1.20,brightness:1.030,redScale:0.985,greenScale:1.025,blueScale:0.945,redOffset:0,greenOffset:0.014,blueOffset:0})
  }),
  performance:Object.freeze({
    postProcessing:false,
    extraLights:0,
    perObjectShaders:false,
    perFrameWorldScan:false,
    preparationTimeColorGrade:true
  })
});

const GREEN_TYPES=new Set(["grass","forest","farmland","plot"]);
const EARTH_TYPES=new Set(["dirt","mud","sand","rock"]);
const CONSTRUCTED_TYPES=new Set(["road","path","square","building","floor","door","wall","bridge"]);
function clamp01(value){return Math.min(1,Math.max(0,Number(value)||0));}
function profileFor(role){
  const key=String(role||"");
  const type=key.includes(":")?key.slice(key.lastIndexOf(":")+1):key;
  if(type==="water")return STYLE.terrainGrade.water;
  if(GREEN_TYPES.has(type))return STYLE.terrainGrade.green;
  if(EARTH_TYPES.has(type))return STYLE.terrainGrade.earth;
  if(CONSTRUCTED_TYPES.has(type))return STYLE.terrainGrade.constructed;
  return STYLE.terrainGrade.neutral;
}
function gradeRgb(role,color){
  const src=Array.isArray(color)?color:[0,0,0,1];
  let r=clamp01(src[0]),g=clamp01(src[1]),b=clamp01(src[2]);
  const a=src.length>3?clamp01(src[3]):1;
  if(String(role||"").startsWith("terrain")){
    const p=profileFor(role);
    const l=0.2126*r+0.7152*g+0.0722*b;
    r=(l+(r-l)*p.saturation)*p.brightness*p.redScale+p.redOffset;
    g=(l+(g-l)*p.saturation)*p.brightness*p.greenScale+p.greenOffset;
    b=(l+(b-l)*p.saturation)*p.brightness*p.blueScale+p.blueOffset;
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
    typeAwareTerrainGrade:true,
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
