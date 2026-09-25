(function(){
"use strict";

function hash32(text){
  let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619)>>>0;
  }
  h^=h>>>13; h=Math.imul(h,0x5bd1e995)>>>0; h^=h>>>15;
  return h>>>0;
}
function signed01(seed,x,z,salt){
  const h=hash32(String(seed)+"|"+String(x)+"|"+String(z)+"|"+String(salt||""));
  return (h/4294967295)*2-1;
}
function clamp(v,a,b){return Math.min(b,Math.max(a,v));}
function worldVisualStyle(){return window.AdvisorWorldVisualStyle||null;}
function styleColor(role,color){const style=worldVisualStyle();return style?.gradeRgb?style.gradeRgb(role,color):color;}

const HEIGHTFIELD_VERTICAL_SCALE=0.020;
const HEIGHTFIELD_MIN_Y=-26;
const HEIGHTFIELD_MAX_Y=26;
const HEIGHTFIELD_RELIEF=0.085;
const HEIGHTFIELD_WATER_Y=-0.22;
const HEIGHTFIELD_BRIDGE_CLEARANCE=0.32;
const HYDROLOGY_VERSION="hydrology-basin-v1";
const HYDROLOGY_QUERY_RADIUS_TILES=2;
const HYDROLOGY_BANK_TRANSITION_TILES=1.75;
const HYDROLOGY_BANK_MIN_RISE=0.12;
const HYDROLOGY_WATER_DEPTH=0.22;
const HYDROLOGY_BED_DEPTH=0.18;
const HYDROLOGY_LEVEL_STEP=0.035;
const LANDFORM_VERSION="macro-landform-v5";
const LANDFORM_SAMPLE_RADIUS_TILES=8;
const LANDFORM_CACHE_LIMIT=32768;
const LANDFORM_CLIFF_FACE_MAX_PER_CHUNK=12;
const LANDFORM_CLIFF_FACE_MIN_SIGNAL=0.32;
const LANDFORM_CLIFF_FACE_MIN_RELIEF_METERS=160;
const LANDFORM_CLIFF_FACE_MIN_HEIGHT=0.72;
const LANDFORM_CLIFF_FACE_MAX_HEIGHT=2.65;
const LANDFORM_CLIFF_FACE_APRON_MIN=0.68;
const LANDFORM_CLIFF_FACE_APRON_MAX=1.34;
const LANDFORM_CLIFF_LIP_INSET=1.08;
const LANDFORM_CLIFF_BREAK_RISE_MIN=0.46;
const LANDFORM_CLIFF_BREAK_RISE_MAX=1.18;
const WORLD_TILE_METERS=2;
const ROAD_PROFILE_LIFTS=Object.freeze({road:0.12,path:0.08,square:0.055});
const ROAD_PROFILE_CORE_RADIUS_TILES=0.80;
const ROAD_PROFILE_OUTER_RADIUS_TILES=2.15;
const ROAD_PROFILE_SHOULDER_WIDTH_TILES=ROAD_PROFILE_OUTER_RADIUS_TILES-ROAD_PROFILE_CORE_RADIUS_TILES;
const BUILDING_MATERIAL_VARIANTS=Object.freeze([
  Object.freeze({roof:Object.freeze([1.00,0.92,0.86]),wall:Object.freeze([1.00,0.97,0.90]),trim:Object.freeze([0.92,0.86,0.76])}),
  Object.freeze({roof:Object.freeze([0.88,0.96,1.00]),wall:Object.freeze([0.91,0.98,1.00]),trim:Object.freeze([0.86,0.90,0.92])}),
  Object.freeze({roof:Object.freeze([1.00,0.84,0.76]),wall:Object.freeze([0.96,0.91,0.82]),trim:Object.freeze([0.86,0.78,0.67])}),
  Object.freeze({roof:Object.freeze([0.82,0.88,0.84]),wall:Object.freeze([0.90,0.93,0.84]),trim:Object.freeze([0.78,0.82,0.74])})
]);
const SEMANTIC_TERRAIN_TYPES=new Set(["grass","forest","dirt","mud","road","bridge","square","path","plot","water","rock","sand","farmland"]);
const CONTOUR_SMOOTHABLE_TYPES=new Set(["grass","forest","dirt","mud","sand","farmland"]);
const CONTOUR_ROUND_RADIUS_TILES=0.50;
const CONTOUR_ARC_SEGMENTS=5;
const CONTOUR_Y_OFFSET=0.008;
const CONTOUR_HALO_TILES=1;
const TERRAIN_VARIATION_MACRO_SCALE_TILES=12n;
const TERRAIN_VARIATION_CONTEXT_RADIUS_TILES=2;
const TERRAIN_VARIATION_NATURAL_TYPES=new Set(["grass","forest","dirt","mud","sand","farmland","rock"]);
const TERRAIN_VARIATION_CONSTRUCTED_TYPES=new Set(["road","path","square","bridge","plot","water"]);
function semanticSurfaceType(value){
  const type=String(value||"grass");
  if(SEMANTIC_TERRAIN_TYPES.has(type))return type;
  if(type==="building"||type==="floor"||type==="wall"||type==="door")return "plot";
  return "grass";
}
const heightReferenceCache=new Map();
const heightVertexCache=new Map();
const hydrologyProfileCache=new Map();
const hydrologyVertexCache=new Map();
const landformProfileCache=new Map();
const HEIGHT_VERTEX_CACHE_LIMIT=16384;
const HYDROLOGY_CACHE_LIMIT=16384;
let heightVertexSampleCalls=0,heightVertexCacheHits=0,heightGroundSampleCalls=0;
let hydrologyQueryCalls=0,hydrologyCacheHits=0;
let landformQueryCalls=0,landformCacheHits=0;

function floorDivBig(value,divisor){
  let q=value/divisor,r=value%divisor;
  if(r<0n)q-=1n;
  return q;
}
function heightfieldSegments(size){
  const bounded=Math.max(1,Math.trunc(Number(size)||16));
  for(let candidate=Math.min(8,bounded);candidate>=1;candidate--)if(bounded%candidate===0)return candidate;
  return 1;
}
function heightfieldStep(size){return Math.max(1,Math.trunc(Number(size)||16)/heightfieldSegments(size));}
function referenceElevation(seed){
  const key=String(seed||"");
  if(!key)return 0;
  if(heightReferenceCache.has(key))return heightReferenceCache.get(key);
  const value=Number(window.GeographyFoundation?.environment?.(key,"0","0")?.elevationMeters||0);
  heightReferenceCache.set(key,value);
  return value;
}
function sourceElevationMeters(seed,x,y){
  return Number(window.GeographyFoundation?.environment?.(seed,String(x),String(y))?.elevationMeters||referenceElevation(seed));
}
function landformAtTile(seedValue,xValue,yValue){
  const seed=String(seedValue||""),x=String(xValue),y=String(yValue);
  const cacheKey=seed+"|"+x+"|"+y;
  const cached=landformProfileCache.get(cacheKey);
  if(cached){landformCacheHits++;return cached;}
  landformQueryCalls++;
  let bx,by;
  try{bx=BigInt(x);by=BigInt(y);}catch(_){
    return Object.freeze({version:LANDFORM_VERSION,x,y,kind:"plain",elevationMeters:referenceElevation(seed),conditionOffset:0,rendererOnly:true,navigationAuthority:false,collisionAuthority:false});
  }
  const r=BigInt(LANDFORM_SAMPLE_RADIUS_TILES);
  const center=sourceElevationMeters(seed,bx,by);
  const n=sourceElevationMeters(seed,bx,by-r),e=sourceElevationMeters(seed,bx+r,by);
  const s=sourceElevationMeters(seed,bx,by+r),w=sourceElevationMeters(seed,bx-r,by);
  const ne=sourceElevationMeters(seed,bx+r,by-r),nw=sourceElevationMeters(seed,bx-r,by-r);
  const se=sourceElevationMeters(seed,bx+r,by+r),sw=sourceElevationMeters(seed,bx-r,by+r);
  const values=[center,n,e,s,w,ne,nw,se,sw];
  const relief=Math.max(...values)-Math.min(...values);
  const gradientX=(e-w)/(2*LANDFORM_SAMPLE_RADIUS_TILES);
  const gradientY=(s-n)/(2*LANDFORM_SAMPLE_RADIUS_TILES);
  const gradient=Math.hypot(gradientX,gradientY);
  const curvature=center-(n+e+s+w)/4;
  const xSaddle=Math.min(e,w)-center-Math.max(0,Math.min(n,s)-center);
  const ySaddle=Math.min(n,s)-center-Math.max(0,Math.min(e,w)-center);
  const saddleStrength=Math.max(0,xSaddle,ySaddle);
  // Separate curvature-based ridge/valley identity from genuinely steep faces.
  // The previous thresholds saturated cliff/pass across most mountainous samples,
  // which made class labels unhelpful and visually flattened distinct forms.
  const ridgeSignal=clamp((curvature-8)/72,0,1)*clamp((relief-55)/230,0,1);
  const valleySignal=clamp((-curvature-8)/72,0,1)*clamp((relief-55)/230,0,1);
  const cliffSignal=clamp((gradient-7)/16,0,1)*clamp((relief-120)/300,0,1);
  const passSignal=clamp((saddleStrength-10)/60,0,1)*clamp((relief-95)/260,0,1);
  let kind="plain";
  const passDominant=passSignal>=0.24&&passSignal>=Math.max(ridgeSignal,valleySignal)*1.15;
  if(passDominant)kind="pass";
  else if(ridgeSignal>=0.16)kind="ridge";
  else if(valleySignal>=0.16)kind="valley";
  else if(cliffSignal>=0.22)kind="cliff";
  else if(gradient>=2.8)kind="slope";
  const cliffShape=clamp(curvature/90,-1,1);
  // Presentation-only vertical conditioning exaggerates broad form readability
  // without changing authoritative elevation, navigation or collision. Values
  // remain global-coordinate deterministic and therefore seam-safe.
  const conditionOffset=clamp(
    ridgeSignal*1.90-valleySignal*1.72-passSignal*1.28+cliffSignal*cliffShape*0.96,
    -2.60,2.60
  );
  const result=Object.freeze({
    version:LANDFORM_VERSION,x,y,kind,
    elevationMeters:center,
    gradientMetersPerTile:Number(gradient.toFixed(4)),
    gradientX:Number(gradientX.toFixed(4)),gradientY:Number(gradientY.toFixed(4)),
    localReliefMeters:Number(relief.toFixed(2)),
    curvatureMeters:Number(curvature.toFixed(3)),
    saddleStrengthMeters:Number(saddleStrength.toFixed(3)),
    ridgeSignal:Number(ridgeSignal.toFixed(4)),
    valleySignal:Number(valleySignal.toFixed(4)),
    cliffSignal:Number(cliffSignal.toFixed(4)),
    passSignal:Number(passSignal.toFixed(4)),
    conditionOffset:Number(conditionOffset.toFixed(6)),
    sampleRadiusTiles:LANDFORM_SAMPLE_RADIUS_TILES,
    source:"GeographyFoundation.environment.elevationMeters",
    deterministic:true,seamSafeGlobalCoordinates:true,chunkPrepared:true,
    rendererOnly:true,navigationAuthority:false,collisionAuthority:false,
    simulationAuthorityPreserved:true
  });
  landformProfileCache.set(cacheKey,result);
  if(landformProfileCache.size>LANDFORM_CACHE_LIMIT){
    const oldest=landformProfileCache.keys().next().value;
    if(oldest!==undefined)landformProfileCache.delete(oldest);
  }
  return result;
}
function macroHeight(seed,x,y){
  const landform=landformAtTile(seed,x,y);
  const elevation=Number(landform.elevationMeters||referenceElevation(seed));
  const baseMacro=(elevation-referenceElevation(seed))*HEIGHTFIELD_VERTICAL_SCALE;
  return Object.freeze({elevation,baseMacro,macro:baseMacro+Number(landform.conditionOffset||0),landform});
}
function smoothstep01(value){
  const t=clamp(Number(value)||0,0,1);
  return t*t*(3-2*t);
}

function terrainTypeAt(seed,x,y){
  return String(window.TerrainFoundation?.getTile?.(String(seed),String(x),String(y))?.type||"grass");
}
function underlyingTerrainTypeAt(seed,x,y){
  return String(window.GeographyFoundation?.getTerrainType?.(String(seed),String(x),String(y))||terrainTypeAt(seed,x,y));
}
function hydrologyWaterReference(seed,x,y,typeOverride=null){
  const type=String(typeOverride||terrainTypeAt(seed,x,y));
  return type==="water"||(type==="bridge"&&underlyingTerrainTypeAt(seed,x,y)==="water");
}
function bridgeDeckOrientation(seed,xValue,yValue){
  let x,y;
  try{x=BigInt(String(xValue));y=BigInt(String(yValue));}catch(_){return "horizontal";}
  const routeLike=type=>["road","path","square","bridge"].includes(String(type||""));
  const n=routeLike(terrainTypeAt(seed,x,y-1n)),e=routeLike(terrainTypeAt(seed,x+1n,y));
  const s=routeLike(terrainTypeAt(seed,x,y+1n)),w=routeLike(terrainTypeAt(seed,x-1n,y));
  const horizontal=(e?1:0)+(w?1:0),vertical=(n?1:0)+(s?1:0);
  if(vertical>horizontal)return "vertical";
  return "horizontal";
}
function rawPresentationHeight(seed,x,y,typeOverride=null){
  const type=String(typeOverride||terrainTypeAt(seed,x,y));
  const macro=macroHeight(seed,x,y).macro;
  if(type==="road"||type==="path"||type==="square"||type==="building"||type==="floor"||type==="door"||type==="wall"||type==="bridge")return macro;
  if(type==="water")return macro-HYDROLOGY_WATER_DEPTH;
  return macro+signed01(seed,x,y,"heightfield-relief")*HEIGHTFIELD_RELIEF;
}
function hydrologyKindFor(seed,x,y){
  const bx=BigInt(String(x)),by=BigInt(String(y));
  const water=(dx,dy)=>terrainTypeAt(seed,bx+BigInt(dx),by+BigInt(dy))==="water";
  const n=water(0,-1),e=water(1,0),s=water(0,1),w=water(-1,0);
  let ring=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)ring+=water(dx,dy)?1:0;
  const cardinal=[n,e,s,w].filter(Boolean).length;
  if(ring>=6||cardinal>=4)return "large-water";
  const opposite=(n&&s)||(e&&w);
  if(cardinal<=2&&opposite)return "channel";
  return "basin";
}
function hydrologyAtTile(seedValue,xValue,yValue){
  const seed=String(seedValue||""),x=String(xValue),y=String(yValue);
  const cacheKey=seed+"|"+x+"|"+y;
  const cached=hydrologyProfileCache.get(cacheKey);
  if(cached){hydrologyCacheHits++;return cached;}
  hydrologyQueryCalls++;
  let bx,by;
  try{bx=BigInt(x);by=BigInt(y);}catch(_){
    return Object.freeze({active:false,version:HYDROLOGY_VERSION,x,y,type:"grass"});
  }
  const centerType=terrainTypeAt(seed,x,y);
  const waterSamples=[],landSamples=[];
  let nearestWaterDistance=Infinity;
  for(let dy=-HYDROLOGY_QUERY_RADIUS_TILES;dy<=HYDROLOGY_QUERY_RADIUS_TILES;dy++){
    for(let dx=-HYDROLOGY_QUERY_RADIUS_TILES;dx<=HYDROLOGY_QUERY_RADIUS_TILES;dx++){
      const wx=bx+BigInt(dx),wy=by+BigInt(dy);
      const type=terrainTypeAt(seed,wx,wy);
      const distance=Math.hypot(dx,dy);
      const macro=macroHeight(seed,String(wx),String(wy)).macro;
      if(hydrologyWaterReference(seed,String(wx),String(wy),type)){
        waterSamples.push({x:wx,y:wy,macro,distance,type,underlyingWater:type==="bridge"});
        nearestWaterDistance=Math.min(nearestWaterDistance,distance);
      }else if(type!=="bridge"&&type!=="building"&&type!=="wall"){
        landSamples.push({x:wx,y:wy,height:rawPresentationHeight(seed,String(wx),String(wy),type),distance,type});
      }
    }
  }
  const active=waterSamples.length>0||centerType==="water";
  if(!active){
    const result=Object.freeze({
      active:false,version:HYDROLOGY_VERSION,x,y,type:centerType,
      distanceToWaterTiles:null,waterSurfaceHeight:null,bedHeight:null,
      bankMinHeight:null,bankMaxHeight:null,bankTransitionWidthTiles:HYDROLOGY_BANK_TRANSITION_TILES,
      bridgeDeckHeight:null,bridgeClearance:null,bodyKind:null,bodyId:null,
      groundHeight:rawPresentationHeight(seed,x,y,centerType),
      rendererOnly:true,navigationAuthority:false,collisionAuthority:false
    });
    hydrologyProfileCache.set(cacheKey,result);
    return result;
  }
  if(!waterSamples.length){
    const macro=macroHeight(seed,x,y).macro;
    waterSamples.push({x:bx,y:by,macro:macro-HYDROLOGY_WATER_DEPTH,distance:0});
    nearestWaterDistance=0;
  }
  const kind=centerType==="water"?hydrologyKindFor(seed,x,y):"shore";
  const macros=waterSamples.map(item=>item.macro);
  const meanMacro=macros.reduce((sum,value)=>sum+value,0)/macros.length;
  const minMacro=Math.min(...macros);
  const maxMacro=Math.max(...macros);
  const depth=kind==="large-water"?0.20:kind==="channel"?0.21:HYDROLOGY_WATER_DEPTH;
  let waterSurface=(meanMacro*0.68+minMacro*0.32)-depth;
  if(kind==="basin"||kind==="large-water"){
    waterSurface=Math.round(waterSurface/HYDROLOGY_LEVEL_STEP)*HYDROLOGY_LEVEL_STEP;
  }
  const bankHeights=landSamples.map(item=>item.height).filter(Number.isFinite);
  const bankMinRaw=bankHeights.length?Math.min(...bankHeights):macroHeight(seed,x,y).macro+HYDROLOGY_BANK_MIN_RISE;
  const bankMaxRaw=bankHeights.length?Math.max(...bankHeights):bankMinRaw;
  waterSurface=Math.min(waterSurface,bankMinRaw-HYDROLOGY_BANK_MIN_RISE);
  waterSurface=clamp(waterSurface,HEIGHTFIELD_MIN_Y+0.35,HEIGHTFIELD_MAX_Y-0.50);
  const bedHeight=clamp(waterSurface-HYDROLOGY_BED_DEPTH,HEIGHTFIELD_MIN_Y+0.10,HEIGHTFIELD_MAX_Y-0.65);
  const distance=Number.isFinite(nearestWaterDistance)?nearestWaterDistance:null;
  const influence=distance===null?0:smoothstep01(1-clamp((distance-0.25)/HYDROLOGY_BANK_TRANSITION_TILES,0,1));
  let groundHeight=rawPresentationHeight(seed,x,y,centerType);
  if(centerType!=="water"&&centerType!=="bridge"&&distance!==null){
    const bankTarget=waterSurface+HYDROLOGY_BANK_MIN_RISE+(1-influence)*0.18;
    groundHeight=Math.max(
      waterSurface+HYDROLOGY_BANK_MIN_RISE,
      groundHeight+(bankTarget-groundHeight)*influence*0.72
    );
  }
  const approachSamples=landSamples.filter(item=>["road","path","square"].includes(item.type)&&item.distance<=1.5);
  const approachHeight=approachSamples.length
    ?approachSamples.reduce((sum,item)=>sum+item.height,0)/approachSamples.length
    :macroHeight(seed,x,y).macro;
  const bridgeDeckHeight=centerType==="bridge"
    ?Math.max(waterSurface+HEIGHTFIELD_BRIDGE_CLEARANCE,approachHeight+0.055)
    :null;
  const bridgeClearance=bridgeDeckHeight===null?null:bridgeDeckHeight-waterSurface;
  const segmentX=floorDivBig(bx,8n),segmentY=floorDivBig(by,8n);
  const bodyLevel=Math.round(waterSurface/HYDROLOGY_LEVEL_STEP);
  const bodyKind=centerType==="water"?kind:(waterSamples.length>=6?"large-water":waterSamples.length>=3?"basin":"channel");
  const result=Object.freeze({
    active:true,version:HYDROLOGY_VERSION,x,y,type:centerType,
    distanceToWaterTiles:distance,
    waterSampleCount:waterSamples.length,
    waterSurfaceHeight:Number(waterSurface.toFixed(6)),
    waterMacroMin:Number(minMacro.toFixed(6)),
    waterMacroMax:Number(maxMacro.toFixed(6)),
    bedHeight:Number(bedHeight.toFixed(6)),
    bankMinHeight:Number(Math.max(bankMinRaw,waterSurface+HYDROLOGY_BANK_MIN_RISE).toFixed(6)),
    bankMaxHeight:Number(Math.max(bankMaxRaw,waterSurface+HYDROLOGY_BANK_MIN_RISE).toFixed(6)),
    bankTransitionWidthTiles:HYDROLOGY_BANK_TRANSITION_TILES,
    bankInfluence:Number(influence.toFixed(6)),
    groundHeight:Number(groundHeight.toFixed(6)),
    bridgeDeckHeight:bridgeDeckHeight===null?null:Number(bridgeDeckHeight.toFixed(6)),
    bridgeClearance:bridgeClearance===null?null:Number(bridgeClearance.toFixed(6)),
    bridgeUnderlyingWater:centerType==="bridge"?underlyingTerrainTypeAt(seed,x,y)==="water":null,
    bodyKind,
    bodyId:bodyKind+"|level="+bodyLevel+"|segment="+segmentX+","+segmentY,
    deterministic:true,seamSafeGlobalCoordinates:true,rendererOnly:true,
    navigationAuthority:false,collisionAuthority:false,waterIdentityChanged:false
  });
  hydrologyProfileCache.set(cacheKey,result);
  if(hydrologyProfileCache.size>HYDROLOGY_CACHE_LIMIT){
    const oldest=hydrologyProfileCache.keys().next().value;
    if(oldest!==undefined)hydrologyProfileCache.delete(oldest);
  }
  return result;
}
function waterSurfaceAtVertex(seedValue,xValue,yValue){
  const seed=String(seedValue||""),x=String(xValue),y=String(yValue);
  const key=seed+"|"+x+"|"+y;
  const cached=hydrologyVertexCache.get(key);
  if(cached!==undefined)return cached;
  let bx,by;
  try{bx=BigInt(x);by=BigInt(y);}catch(_){return HEIGHTFIELD_WATER_Y;}
  const levels=[];
  for(const dy of [-1,0])for(const dx of [-1,0]){
    const tx=bx+BigInt(dx),ty=by+BigInt(dy);
    if(!hydrologyWaterReference(seed,tx,ty))continue;
    const h=hydrologyAtTile(seed,String(tx),String(ty)).waterSurfaceHeight;
    if(Number.isFinite(Number(h)))levels.push(Number(h));
  }
  let value;
  if(levels.length)value=levels.reduce((sum,item)=>sum+item,0)/levels.length;
  else{
    const profile=hydrologyAtTile(seed,x,y);
    value=Number.isFinite(Number(profile.waterSurfaceHeight))?Number(profile.waterSurfaceHeight):macroHeight(seed,x,y).macro-HYDROLOGY_WATER_DEPTH;
  }
  value=clamp(value,HEIGHTFIELD_MIN_Y+0.35,HEIGHTFIELD_MAX_Y-0.50);
  hydrologyVertexCache.set(key,value);
  if(hydrologyVertexCache.size>HYDROLOGY_CACHE_LIMIT){
    const oldest=hydrologyVertexCache.keys().next().value;
    if(oldest!==undefined)hydrologyVertexCache.delete(oldest);
  }
  return value;
}
function roadProfileAtVertex(seed,xValue,yValue,naturalHeight,macro,type){
  if(type==="water"||type==="bridge")return null;
  let originX,originY;
  try{originX=BigInt(String(xValue));originY=BigInt(String(yValue));}
  catch(_){return null;}
  let bestInfluence=0,weightSum=0,weightedMacro=0,weightedLift=0,primaryType=null,primaryLift=0;
  for(let dy=-1;dy<=1;dy++){
    for(let dx=-1;dx<=1;dx++){
      const tx=originX+BigInt(dx),ty=originY+BigInt(dy);
      const candidate=String(window.TerrainFoundation?.getTile?.(seed,String(tx),String(ty))?.type||"");
      const lift=Number(ROAD_PROFILE_LIFTS[candidate]||0);
      if(lift<=0)continue;
      const distance=Math.hypot(dx+0.5,dy+0.5);
      if(distance>ROAD_PROFILE_OUTER_RADIUS_TILES)continue;
      const linear=1-clamp(
        (distance-ROAD_PROFILE_CORE_RADIUS_TILES)/ROAD_PROFILE_SHOULDER_WIDTH_TILES,
        0,1
      );
      const influence=smoothstep01(linear);
      if(influence<=0)continue;
      const sampleMacro=macroHeight(seed,String(tx),String(ty)).macro;
      weightSum+=influence;
      weightedMacro+=sampleMacro*influence;
      weightedLift+=lift*influence;
      if(influence>bestInfluence+1e-9||(Math.abs(influence-bestInfluence)<=1e-9&&lift>primaryLift)){
        bestInfluence=influence;primaryType=candidate;primaryLift=lift;
      }
    }
  }
  if(weightSum<=0||bestInfluence<=0)return null;
  const averageMacro=weightedMacro/weightSum;
  const averageLift=weightedLift/weightSum;
  // Core road/path/square vertices use the locally averaged macro slope, which
  // removes high-frequency natural relief from the constructed surface. The
  // bounded shoulder blends back into natural terrain without a second mesh.
  const smoothedTarget=averageMacro+averageLift;
  const blended=naturalHeight+(smoothedTarget-naturalHeight)*bestInfluence;
  const minimumRaised=naturalHeight+averageLift*bestInfluence*0.55;
  const height=Math.max(blended,minimumRaised);
  return Object.freeze({
    active:true,
    primaryType,
    influence:Number(bestInfluence.toFixed(4)),
    core:bestInfluence>=0.999,
    targetMacro:Number(averageMacro.toFixed(6)),
    liftWorldUnits:Number(averageLift.toFixed(6)),
    baseHeight:Number(naturalHeight.toFixed(6)),
    height:Number(height.toFixed(6)),
    delta:Number((height-naturalHeight).toFixed(6))
  });
}

function heightfieldColor(seed,x,z,value,type="grass"){
  const text=String(value||"").trim();
  const match=/^#([0-9a-f]{6})$/i.exec(text);
  if(match){
    const n=parseInt(match[1],16);
    return styleColor("terrain:"+String(type||"grass"),[((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1]);
  }
  const noise=signed01(seed,x,z,"color");
  return styleColor("terrain:"+String(type||"grass"),[
    clamp(0.29+noise*0.018,0.20,0.40),
    clamp(0.42+noise*0.025,0.30,0.55),
    clamp(0.215+noise*0.012,0.14,0.30),
    1
  ]);
}
function terrainHeightVertex(seed,xValue,yValue){
  const seedKey=String(seed||"");
  const x=String(xValue),y=String(yValue);
  if(!seedKey)return Object.freeze({height:0,type:"grass",color:[0.29,0.42,0.215,1],elevationMeters:0});
  const cacheKey=seedKey+"|"+x+"|"+y;
  const cached=heightVertexCache.get(cacheKey);
  if(cached){
    heightVertexCacheHits++;
    return cached;
  }
  heightVertexSampleCalls++;
  const macroSample=macroHeight(seed,x,y);
  const elevation=Number(macroSample.elevation);
  const macro=Number(macroSample.macro);
  const landform=macroSample.landform;
  const tile=window.TerrainFoundation?.getTile?.(seed,x,y)||null;
  const type=String(tile?.type||"grass");
  const hydrology=hydrologyAtTile(seed,x,y);
  let naturalHeight;
  if(type==="water")naturalHeight=Number(hydrology.waterSurfaceHeight);
  else if(type==="bridge")naturalHeight=Number(hydrology.bridgeDeckHeight??macro);
  else if(hydrology.active)naturalHeight=Number(hydrology.groundHeight);
  else naturalHeight=rawPresentationHeight(seed,x,y,type);
  const roadProfile=roadProfileAtVertex(seed,x,y,naturalHeight,macro,type);
  const height=roadProfile?.active?roadProfile.height:naturalHeight;
  const sample=Object.freeze({
    height:clamp(height,HEIGHTFIELD_MIN_Y,HEIGHTFIELD_MAX_Y),
    type,
    color:heightfieldColor(seed,x,y,tile?.color,type),
    elevationMeters:elevation,
    landform,
    roadProfile,
    hydrology
  });
  heightVertexCache.set(cacheKey,sample);
  if(heightVertexCache.size>HEIGHT_VERTEX_CACHE_LIMIT){
    const oldest=heightVertexCache.keys().next().value;
    if(oldest!==undefined)heightVertexCache.delete(oldest);
  }
  return sample;
}
function terrainHeightAtTile(seed,xValue,yValue,size=16,offsetX=0,offsetY=0){
  if(!String(seed||""))return 0;
  heightGroundSampleCalls++;
  const centerType=terrainTypeAt(seed,xValue,yValue);
  if(Math.abs(Number(offsetX||0))<=0.5&&Math.abs(Number(offsetY||0))<=0.5){
    if(centerType==="water")return Number(hydrologyAtTile(seed,xValue,yValue).waterSurfaceHeight||0);
    if(centerType==="bridge")return Number(hydrologyAtTile(seed,xValue,yValue).bridgeDeckHeight||0);
  }
  const step=heightfieldStep(size);
  const x=Number(xValue)+0.5+Number(offsetX||0);
  const y=Number(yValue)+0.5+Number(offsetY||0);
  if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
  const x0=Math.floor(x/step)*step,y0=Math.floor(y/step)*step;
  const tx=(x-x0)/step,tz=(y-y0)/step;
  const h00=terrainHeightVertex(seed,String(x0),String(y0)).height;
  const h10=terrainHeightVertex(seed,String(x0+step),String(y0)).height;
  const h01=terrainHeightVertex(seed,String(x0),String(y0+step)).height;
  const h11=terrainHeightVertex(seed,String(x0+step),String(y0+step)).height;
  if(tx+tz<=1)return h00+tx*(h10-h00)+tz*(h01-h00);
  return h11+(1-tz)*(h10-h11)+(1-tx)*(h01-h11);
}

function create({pc,device,parent,material,textureAtlasProvider=()=>null,buildingSurfaceAtlasProvider=()=>null,treeSpriteAtlasProvider=()=>null,treeYawProvider=()=>45,seedProvider=()=>"",qualityProvider=()=>null,registerRoof=()=>{}}={}){
  if(!pc||!device||!parent||!material)throw new Error("PlayCanvasTerrainChunkMesh requires pc/device/parent/material");
  material.vertexColors=true;
  material.diffuseVertexColor=true;
  material.diffuse.set(1,1,1);
  material.gloss=Number(worldVisualStyle()?.materials?.terrainGloss??0.06);
  material.metalness=0;
  material.update();

  const presentationMaterials=new Map();
  const contactShadowMaterials=new Map();
  const routeSurfaceMaterials=new Map();
  const treeSpriteMaterials=new Map();
  const surfaceBoundMaterials=new Set();
  const buildingMaterialVariantEvidence=new Map();
  const primitiveMeshes=new Map();
  const baseBox=new pc.BoxGeometry();
  let creations=0,destroys=0,totalBuildMs=0,maxBuildMs=0;
  let presentationEntityCreations=0,presentationEntityDestroys=0,presentationMeshInstanceCreations=0;
  let staticBatchMeshCreations=0,staticBatchSourcePrimitiveCount=0,instancedGroupCreations=0,instancedObjectCount=0;
  let instancingBufferUpdates=0,instancingParentRepositions=0,frustumCulledMeshInstances=0;
  let treeSpriteMaterialRebinds=0,treeSpriteMaterialRefreshes=0;
  let buildingSurfaceMaterialRebinds=0,buildingSurfaceMaterialRefreshes=0;
  let contactShadowMaterialRefreshes=0;
  let ambientUpdateCalls=0,ambientSkippedUpdateCalls=0,ambientBufferUpdates=0,totalAmbientUpdateMs=0,maxAmbientUpdateMs=0,lastAmbientUpdateMs=0;
  let routeSurfaceMaterialRebinds=0,routeSurfaceMaterialRefreshes=0;

  function applyBuildingSurfaceMaterial(m,name,r,g,b,tint=[1,1,1]){
    const atlas=buildingSurfaceAtlasProvider?.()||null;
    const state=atlas?.stats?.()||null;
    const knownSurface=Boolean(atlas?.surfaces?.some?.(item=>item?.material===String(name||"")));
    const rect=state?.ready?atlas?.rectForMaterial?.(name):null;
    const texture=state?.ready?(atlas?.textureForMaterial?.(name)||atlas?.texture?.()||null):null;
    const tintValue=[
      clamp(Number(tint?.[0]??1),0.65,1.08),
      clamp(Number(tint?.[1]??1),0.65,1.08),
      clamp(Number(tint?.[2]??1),0.65,1.08)
    ];
    if(knownSurface){
      m._advisorBuildingSurfaceName=String(name||"");
      m._advisorBuildingFallbackColor=Object.freeze([Number(r),Number(g),Number(b)]);
      m._advisorBuildingTint=Object.freeze(tintValue.slice());
    }
    if(rect&&texture){
      const previousTexture=m.diffuseMap||null;
      const previousSignature=String(m._advisorBuildingAtlasSignature||"");
      // PlayCanvas can apply sampler changes lazily. Explicitly detach a
      // superseded atlas generation before rebinding so every long-lived
      // deterministic material variant drops the old GPU texture reference.
      if(previousTexture&&previousTexture!==texture){
        m.diffuseMap=null;
        try{m.update?.()}catch(_){}
      }
      m.diffuseMap=texture;
      m._advisorBuildingTextureName=String(texture.name||"");
      // Diffuse color multiplies the authored atlas, preserving texture detail
      // while adding bounded deterministic settlement variation.
      m.diffuse.set(...tintValue);
      if(m.diffuseMapTiling?.set)m.diffuseMapTiling.set(rect.uScale,rect.vScale);
      else m.diffuseMapTiling=new pc.Vec2(rect.uScale,rect.vScale);
      if(m.diffuseMapOffset?.set)m.diffuseMapOffset.set(rect.u0,rect.v0);
      else m.diffuseMapOffset=new pc.Vec2(rect.u0,rect.v0);
      m._advisorBuildingAtlasSignature=String(state?.signature||"");
      surfaceBoundMaterials.add(name);
      if(previousTexture!==texture||previousSignature!==m._advisorBuildingAtlasSignature)buildingSurfaceMaterialRebinds++;
      return true;
    }
    m.diffuseMap=null;
    m.diffuse.set(r*tintValue[0],g*tintValue[1],b*tintValue[2]);
    if(knownSurface)m._advisorBuildingAtlasSignature="";
    return false;
  }
  function contactShadowProfile(){
    const q=qualityProvider?.()||{};
    const level=String(q.activeLevel||q.mode||"standard");
    const opacity=level==="low"?0.105:level==="high"?0.185:0.145;
    return Object.freeze({level,opacity});
  }
  function bindContactShadowMaterial(m){
    const profile=contactShadowProfile();
    m.diffuse.set(0.035,0.028,0.022);
    m.emissive.set(0.018,0.014,0.011);
    m.opacity=profile.opacity;
    m.blendType=pc.BLEND_NORMAL;
    m.depthWrite=false;
    m.depthTest=true;
    m.cull=pc.CULLFACE_NONE;
    m.useLighting=false;
    m.gloss=0;
    m.metalness=0;
    m._advisorContactShadowOpacity=profile.opacity;
    m._advisorContactShadowQuality=profile.level;
    m.update();
    return m;
  }
  function contactShadowMaterial(name="ground-contact"){
    const key=String(name||"ground-contact");
    let m=contactShadowMaterials.get(key)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-contact-shadow-"+key;
      contactShadowMaterials.set(key,m);
    }
    return bindContactShadowMaterial(m);
  }
  function refreshContactShadowMaterials(){
    for(const m of contactShadowMaterials.values())bindContactShadowMaterial(m);
    if(contactShadowMaterials.size)contactShadowMaterialRefreshes++;
    return contactShadowMaterials.size;
  }

  function ambientMaterial(name,r,g,b,opacity=1){
    const key="ambient-"+String(name||"effect");
    let m=presentationMaterials.get(key)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-"+key;
      m.gloss=0.02;
      m.metalness=0;
      m.diffuse.set(r,g,b);
      const emissiveScale=key==="ambient-pennant"?0.42:0.08;
      m.emissive.set(r*emissiveScale,g*emissiveScale,b*emissiveScale);
      m.opacity=clamp(Number(opacity||1),0.05,1);
      m.blendType=m.opacity<0.999?pc.BLEND_NORMAL:pc.BLEND_NONE;
      m.depthWrite=m.opacity>=0.999;
      m.depthTest=true;
      m.cull=pc.CULLFACE_NONE;
      m.useLighting=false;
      m.update();
      presentationMaterials.set(key,m);
    }
    return m;
  }

  function presentationMaterial(name,r,g,b,gloss=0.10){
    let m=presentationMaterials.get(name)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-"+name;
      m.gloss=gloss;
      m.metalness=0;
      presentationMaterials.set(name,m);
    }
    applyBuildingSurfaceMaterial(m,name,r,g,b);
    m.update();
    return m;
  }
  function buildingVariantIndex(descriptor){
    const identity=String(descriptor?.id||descriptor?.entrance?.x||"building")+"|"+String(descriptor?.source||"normal");
    return hash32(String(seedProvider()||"")+"|building-material|"+identity)%BUILDING_MATERIAL_VARIANTS.length;
  }
  function buildingVariantMaterial(baseName,variantIndex,r,g,b,gloss,tint){
    const index=Math.max(0,Math.min(BUILDING_MATERIAL_VARIANTS.length-1,Math.trunc(Number(variantIndex)||0)));
    const key=String(baseName)+"-v"+index;
    let m=presentationMaterials.get(key)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-"+key;
      m.gloss=gloss;
      m.metalness=0;
      m._advisorBuildingVariantIndex=index;
      presentationMaterials.set(key,m);
    }
    applyBuildingSurfaceMaterial(m,baseName,r,g,b,tint);
    m.update();
    return m;
  }
  function primitive(root,name,type,position,scale,mat,euler=null){
    const entity=new pc.Entity(name);
    entity.addComponent("render",{type,material:mat,castShadows:false,receiveShadows:false});
    entity.setLocalPosition(...position);
    entity.setLocalScale(...scale);
    if(euler)entity.setLocalEulerAngles(...euler);
    root.addChild(entity);
    presentationEntityCreations++;
    presentationMeshInstanceCreations+=Number(entity.render?.meshInstances?.length||1);
    for(const mi of entity.render?.meshInstances||[]){mi.cull=true;frustumCulledMeshInstances++;}
    return entity;
  }
  function primitiveMesh(kind){
    if(primitiveMeshes.has(kind))return primitiveMeshes.get(kind);
    let mesh;
    if(kind==="tree-plane"){
      mesh=new pc.Mesh(device);
      mesh.setPositions([-0.5,0,0, 0.5,0,0, -0.5,1,0, 0.5,1,0]);
      mesh.setNormals([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
      // Browser image sources are top-down while PlayCanvas UV V=0 is the
      // texture bottom. Flip V once in the shared plane mesh so authored tree
      // trunks remain grounded and canopies stay above them.
      mesh.setUvs(0,[0,1, 1,1, 0,0, 1,0]);
      mesh.setIndices([0,1,2, 1,3,2]);
      mesh.update();
    }else if(kind==="pennant-plane"){
      mesh=new pc.Mesh(device);
      mesh.setPositions([
        -0.035,0,0, 0.035,0,0, -0.035,1.45,0, 0.035,1.45,0,
        0.02,1.36,0, 1.00,1.18,0, 0.74,0.90,0, 0.02,0.98,0,
        0,0,-0.035, 0,0,0.035, 0,1.45,-0.035, 0,1.45,0.035,
        0,1.36,0.02, 0,1.18,1.00, 0,0.90,0.74, 0,0.98,0.02
      ]);
      mesh.setNormals([
        0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1,
        1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0, 1,0,0
      ]);
      mesh.setIndices([0,1,2, 1,3,2, 4,5,6, 4,6,7, 8,9,10, 9,11,10, 12,13,14, 12,14,15]);
      mesh.update();
    }else if(kind==="box"){
      mesh=pc.Mesh.fromGeometry(device,new pc.BoxGeometry());
    }else if(kind==="contact-disc"){
      mesh=new pc.Mesh(device);
      const positions=[0,0,0],normals=[0,1,0],uvs=[0.5,0.5],indices=[];
      const segments=16;
      for(let i=0;i<=segments;i++){
        const a=Math.PI*2*i/segments,x=Math.cos(a)*0.5,z=Math.sin(a)*0.5;
        positions.push(x,0,z);normals.push(0,1,0);uvs.push(x+0.5,z+0.5);
      }
      for(let i=0;i<segments;i++)indices.push(0,i+1,i+2);
      mesh.setPositions(positions);
      mesh.setNormals(normals);
      mesh.setUvs(0,uvs);
      mesh.setIndices(indices);
      mesh.update();
    }else{
      const geometry=new pc.SphereGeometry({radius:0.5,latitudeBands:8,longitudeBands:8});
      mesh=pc.Mesh.fromGeometry(device,geometry);
    }
    primitiveMeshes.set(kind,mesh);
    return mesh;
  }
  function setMapRect(material,prefix,rect){
    const tiling=material[prefix+"MapTiling"],offset=material[prefix+"MapOffset"];
    if(tiling?.set)tiling.set(rect.uScale,rect.vScale);else material[prefix+"MapTiling"]=new pc.Vec2(rect.uScale,rect.vScale);
    if(offset?.set)offset.set(rect.u0,rect.v0);else material[prefix+"MapOffset"]=new pc.Vec2(rect.u0,rect.v0);
  }
  function bindTreeSpriteMaterial(m,index){
    const atlas=treeSpriteAtlasProvider?.()||null,state=atlas?.stats?.()||null;
    const texture=state?.ready?atlas?.texture?.():null;
    if(!texture)return false;
    const rect=atlas?.rect?.(index)||{u0:index*0.5,v0:0,uScale:0.5,vScale:1};
    const treatment=worldVisualStyle()?.spriteTreatment?.tree||{};
    const diffuseTint=Array.isArray(treatment.diffuseTint)?treatment.diffuseTint:[1,1,1];
    const emissiveTint=Array.isArray(treatment.emissiveTint)?treatment.emissiveTint:[1,1,1];
    m.diffuse.set(...diffuseTint);
    m.emissive.set(...emissiveTint);
    m.diffuseMap=texture;
    m.emissiveMap=texture;
    m.opacityMap=texture;
    m.opacityMapChannel="a";
    setMapRect(m,"diffuse",rect);
    setMapRect(m,"emissive",rect);
    setMapRect(m,"opacity",rect);
    m.alphaTest=Number(treatment.alphaTest??0.12);
    m.blendType=pc.BLEND_NONE;
    m.depthWrite=true;
    m.depthTest=true;
    m.cull=pc.CULLFACE_NONE;
    m.useLighting=treatment.useLighting===true;
    m._advisorArtTreatmentSignature=String(worldVisualStyle()?.signature||"");
    m._advisorArtRole=String(treatment.role||"vegetation");
    m.gloss=0;
    m.metalness=0;
    m._advisorTreeAtlasSignature=String(state?.signature||"");
    m.update();
    treeSpriteMaterialRebinds++;
    return true;
  }
  function bindRouteSurfaceMaterial(m,type){
    const atlas=textureAtlasProvider?.()||null;
    const state=atlas?.stats?.()||null;
    const texture=state?.ready?atlas?.texture?.():null;
    const rect=state?.ready?atlas?.uvRect?.(type):null;
    const fallback={
      road:[0.53,0.43,0.31],
      path:[0.60,0.48,0.34],
      square:[0.54,0.51,0.45]
    }[String(type)]||[0.53,0.43,0.31];
    m._advisorRouteSurfaceType=String(type||"road");
    m._advisorRouteFallbackColor=Object.freeze(fallback.slice());
    m.vertexColors=false;
    m.diffuseVertexColor=false;
    m.metalness=0;
    m.gloss=String(type)==="square"?0.10:0.04;
    m.opacity=1;
    m.blendType=pc.BLEND_NONE;
    m.depthWrite=true;
    m.depthTest=true;
    if(texture&&rect){
      const previousTexture=m.diffuseMap||null;
      const previousSignature=String(m._advisorTerrainAtlasSignature||"");
      m.diffuseMap=texture;
      m.diffuse.set(1,1,1);
      setMapRect(m,"diffuse",{
        u0:Number(rect.u0),v0:Number(rect.v0),
        uScale:Number(rect.u1)-Number(rect.u0),
        vScale:Number(rect.v1)-Number(rect.v0)
      });
      m._advisorTerrainAtlasSignature=String(state?.signature||"");
      if(previousTexture!==texture||previousSignature!==m._advisorTerrainAtlasSignature)routeSurfaceMaterialRebinds++;
    }else{
      m.diffuseMap=null;
      m.diffuse.set(...fallback);
      m._advisorTerrainAtlasSignature="";
    }
    m.update();
    return Boolean(texture&&rect);
  }
  function routeSurfaceMaterial(type){
    const key=String(type||"road");
    let m=routeSurfaceMaterials.get(key)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-route-surface-"+key;
      routeSurfaceMaterials.set(key,m);
    }
    bindRouteSurfaceMaterial(m,key);
    return m;
  }
  function refreshRouteSurfaceMaterials(){
    let refreshed=0;
    for(const [type,m] of routeSurfaceMaterials){
      if(bindRouteSurfaceMaterial(m,type))refreshed++;
    }
    if(refreshed)routeSurfaceMaterialRefreshes++;
    return refreshed;
  }
  function routeSurfaceBindings(){
    const atlas=textureAtlasProvider?.()||null,state=atlas?.stats?.()||null;
    const out={};
    for(const type of ["road","path","square"]){
      const rect=state?.ready?atlas?.uvRect?.(type):null;
      const material=routeSurfaceMaterials.get(type)||null;
      out[type]=Object.freeze({
        type,
        materialName:material?.name||("chunk-route-surface-"+type),
        textureKey:"tile:"+type,
        textureBound:Boolean(material?.diffuseMap),
        atlasSignature:String(material?._advisorTerrainAtlasSignature||""),
        runtimeResolution:Number(state?.runtimeResolution||0),
        atlasWidth:Number(state?.atlasWidth||0),
        atlasHeight:Number(state?.atlasHeight||0),
        uvRect:rect?Object.freeze({
          u0:Number(rect.u0),v0:Number(rect.v0),u1:Number(rect.u1),v1:Number(rect.v1),
          uScale:Number(rect.u1)-Number(rect.u0),vScale:Number(rect.v1)-Number(rect.v0)
        }):null,
        opacity:1,
        blendWeightInterior:1,
        vertexColorTint:false
      });
    }
    return Object.freeze(out);
  }

  function surfaceIdentityBindings(){
    const atlas=textureAtlasProvider?.()||null,state=atlas?.stats?.()||null;
    const texture=state?.ready?atlas?.texture?.():null;
    const routeBindings=routeSurfaceBindings();
    const out={};
    for(const type of ["grass","forest","dirt","mud","water","rock","sand","farmland","plot","bridge","road","path","square"]){
      const route=routeBindings[type]||null;
      if(route){
        const routeMaterial=routeSurfaceMaterials.get(type)||null;
        out[type]=Object.freeze({
          authoritativeSurfaceId:type,
          materialKey:String(route.materialName||""),
          diffuseTextureKey:"tile:"+type,
          textureBound:Boolean(route.textureBound),
          textureName:String(routeMaterial?.diffuseMap?.name||""),
          textureWidth:Number(routeMaterial?.diffuseMap?.width||0),
          textureHeight:Number(routeMaterial?.diffuseMap?.height||0),
          atlasCellResolution:Number(state?.runtimeResolution||0),
          uvScale:Object.freeze([Number(route.uvRect?.uScale||0),Number(route.uvRect?.vScale||0)]),
          tint:Object.freeze([Number(routeMaterial?.diffuse?.r??1),Number(routeMaterial?.diffuse?.g??1),Number(routeMaterial?.diffuse?.b??1)]),
          blendWeightRange:Object.freeze([1,1]),opacity:1,
          mipmaps:false,sampling:"linear-no-mip",
          cacheSignature:String(route.atlasSignature||state?.signature||"")
        });
        continue;
      }
      const rect=state?.ready?(atlas?.meshUvRect?.(type)||atlas?.uvRect?.(type)):null;
      out[type]=Object.freeze({
        authoritativeSurfaceId:type,
        materialKey:String(material?.name||"terrain-chunk-surface"),
        diffuseTextureKey:"tile:"+type,
        textureBound:Boolean(texture&&rect),
        textureName:String(texture?.name||""),
        textureWidth:Number(texture?.width||0),
        textureHeight:Number(texture?.height||0),
        atlasCellResolution:Number(state?.runtimeResolution||0),
        uvScale:Object.freeze([rect?Number(rect.u1)-Number(rect.u0):0,rect?Number(rect.v1)-Number(rect.v0):0]),
        tint:Object.freeze([1,1,1]),
        blendWeightRange:Object.freeze([1,1]),opacity:1,
        mipmaps:Boolean(texture?.mipmaps),
        sampling:texture?._advisorDisableMipSampling===true?"linear-no-mip":"runtime",
        cacheSignature:String(state?.signature||"")
      });
    }
    return Object.freeze(out);
  }

  function treeSpriteMaterial(variant){
    const index=Math.max(0,Math.min(1,Math.trunc(Number(variant)||0)));
    let m=treeSpriteMaterials.get(index)||null;
    if(!m){
      m=new pc.StandardMaterial();
      m.name="chunk-tree-sprite-"+index;
      treeSpriteMaterials.set(index,m);
    }
    if(bindTreeSpriteMaterial(m,index))return m;
    treeSpriteMaterials.delete(index);
    return presentationMaterial("tree-fallback",0.20,0.42,0.18,0.02);
  }
  function refreshTreeMaterials(){
    let refreshed=0;
    for(const [index,m] of treeSpriteMaterials){
      if(bindTreeSpriteMaterial(m,index))refreshed++;
    }
    if(refreshed)treeSpriteMaterialRefreshes++;
    return refreshed;
  }
  function refreshBuildingMaterials(){
    let refreshed=0;
    for(const material of presentationMaterials.values()){
      const name=String(material?._advisorBuildingSurfaceName||"");
      if(!name)continue;
      const fallback=material._advisorBuildingFallbackColor||[1,1,1];
      const tint=material._advisorBuildingTint||[1,1,1];
      if(applyBuildingSurfaceMaterial(material,name,fallback[0],fallback[1],fallback[2],tint)){
        material.update();
        refreshed++;
      }
    }
    if(refreshed)buildingSurfaceMaterialRefreshes++;
    return refreshed;
  }
  function sampleColor(seed,x,z){
    const n=signed01(seed,x,z,"color");
    return styleColor("terrain:grass",[
      clamp(0.29+n*0.018,0.20,0.40),
      clamp(0.42+n*0.025,0.30,0.55),
      clamp(0.215+n*0.012,0.14,0.30),
      1
    ]);
  }
  function parseHexColor(value){
    const text=String(value||"").trim();
    const match=/^#([0-9a-f]{6})$/i.exec(text);
    if(!match)return null;
    const n=parseInt(match[1],16);
    return [((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1];
  }
  function appendColor32(target,color,count=1){
    const rgba=[
      Math.round(clamp(Number(color?.[0]??0),0,1)*255),
      Math.round(clamp(Number(color?.[1]??0),0,1)*255),
      Math.round(clamp(Number(color?.[2]??0),0,1)*255),
      Math.round(clamp(Number(color?.[3]??1),0,1)*255)
    ];
    for(let i=0;i<count;i++)target.push(...rgba);
  }
  function terrainPriority(type){
    const t=String(type||"");
    if(t==="bridge")return 100;
    if(t==="road"||t==="path"||t==="square")return 90;
    if(t==="water")return 80;
    if(t==="building"||t==="floor"||t==="door"||t==="wall")return 70;
    if(t==="farmland"||t==="plot")return 60;
    if(t==="rock"||t==="sand"||t==="mud"||t==="dirt")return 50;
    if(t==="forest")return 40;
    return 10;
  }
  function blockSurface(worldData,startX,startZ,endX,endZ,fallback){
    const size=Number(worldData?.chunkSize||0);
    if(!worldData?.cells||!size)return {type:"grass",color:fallback};
    let chosenType=null,chosenPriority=-1;
    const counts=new Map();
    for(let z=startZ;z<endZ;z++){
      for(let x=startX;x<endX;x++){
        const cell=worldData.cells[z*size+x];
        if(!cell)continue;
        const type=String(cell.type||"");
        counts.set(type,(counts.get(type)||0)+1);
        const priority=terrainPriority(type);
        if(priority>chosenPriority){chosenPriority=priority;chosenType=type;}
      }
    }
    if(chosenPriority<=10&&counts.size){
      chosenType=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
    }
    let r=0,g=0,b=0,n=0;
    for(let z=startZ;z<endZ;z++){
      for(let x=startX;x<endX;x++){
        const cell=worldData.cells[z*size+x];
        if(!cell||String(cell.type||"")!==chosenType)continue;
        const color=parseHexColor(cell.color);
        if(!color)continue;
        r+=color[0];g+=color[1];b+=color[2];n++;
      }
    }
    return {type:chosenType||"grass",color:n?styleColor("terrain:"+String(chosenType||"grass"),[r/n,g/n,b/n,1]):fallback};
  }
  function localTileCenter(worldData,x,y){
    const size=Number(worldData?.chunkSize||0);
    const half=size;
    try{
      const lx=Number(BigInt(String(x))-BigInt(worldData.bounds.minX));
      const ly=Number(BigInt(String(y))-BigInt(worldData.bounds.minY));
      return {x:(lx+0.5)*2-half,z:(ly+0.5)*2-half};
    }catch(_){return {x:0,z:0};}
  }
  function localBounds(worldData,bounds){
    const size=Number(worldData?.chunkSize||0),half=size;
    try{
      const minX=Number(BigInt(bounds.minX)-BigInt(worldData.bounds.minX));
      const maxX=Number(BigInt(bounds.maxX)-BigInt(worldData.bounds.minX));
      const minY=Number(BigInt(bounds.minY)-BigInt(worldData.bounds.minY));
      const maxY=Number(BigInt(bounds.maxY)-BigInt(worldData.bounds.minY));
      return {
        x:((minX+maxX+1)/2)*2-half,
        z:((minY+maxY+1)/2)*2-half,
        width:Math.max(1,(maxX-minX+1)*2),
        depth:Math.max(1,(maxY-minY+1)*2)
      };
    }catch(_){return {x:0,z:0,width:2,depth:2};}
  }

  function staticBatchCollector(){
    return new Map();
  }
  function batchFor(collector,key,mat){
    if(!collector.has(key))collector.set(key,{key,material:mat,positions:[],normals:[],uvs:[],indices:[],sourcePrimitiveCount:0});
    return collector.get(key);
  }
  function appendBoxBatch(batch,position,scale,eulerZ=0){
    const p=baseBox.positions||[],n=baseBox.normals||[],uv=baseBox.uvs||[],idx=baseBox.indices||[];
    const base=batch.positions.length/3;
    const sx=Number(scale[0]),sy=Number(scale[1]),sz=Number(scale[2]);
    const tx=Number(position[0]),ty=Number(position[1]),tz=Number(position[2]);
    const a=Number(eulerZ||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    for(let i=0;i<p.length;i+=3){
      const x=p[i]*sx,y=p[i+1]*sy,z=p[i+2]*sz;
      batch.positions.push(x*c-y*s+tx,x*s+y*c+ty,z+tz);
      const nx=n[i],ny=n[i+1],nz=n[i+2];
      batch.normals.push(nx*c-ny*s,nx*s+ny*c,nz);
      const uvIndex=(i/3)*2;
      batch.uvs.push(Number(uv[uvIndex]??0),Number(uv[uvIndex+1]??0));
    }
    for(const value of idx)batch.indices.push(base+value);
    batch.sourcePrimitiveCount++;
    staticBatchSourcePrimitiveCount++;
  }
  function finalizeStaticBatches(root,collector){
    const meshes=[];
    for(const batch of collector.values()){
      if(!batch.positions.length)continue;
      const mesh=new pc.Mesh(device);
      mesh.setPositions(batch.positions);
      mesh.setNormals(batch.normals);
      if(batch.uvs.length===(batch.positions.length/3)*2)mesh.setUvs(0,batch.uvs);
      mesh.setIndices(batch.indices);
      mesh.update();
      const batchEntity=new pc.Entity("ChunkStaticBatch_"+String(batch.key).replace(/[^a-z0-9_-]+/gi,"-"));
      batchEntity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
      const mi=new pc.MeshInstance(mesh,batch.material,batchEntity);
      mi.cull=true;
      batchEntity.render.meshInstances=[mi];
      root.addChild(batchEntity);
      presentationEntityCreations++;
      presentationMeshInstanceCreations++;
      frustumCulledMeshInstances++;
      meshes.push({entity:batchEntity,mesh,meshInstance:mi,sourcePrimitiveCount:batch.sourcePrimitiveCount});
      staticBatchMeshCreations++;
    }
    return meshes;
  }
  function appendRouteQuad(batch,worldData,xValue,yValue,halfX,halfZ,yOffset=0.024,centerOffsetX=0,centerOffsetZ=0){
    const p=localTileCenter(worldData,xValue,yValue);
    const seed=String(seedProvider()||"");
    const centerTileOffsetX=Number(centerOffsetX||0)/WORLD_TILE_METERS;
    const centerTileOffsetZ=Number(centerOffsetZ||0)/WORLD_TILE_METERS;
    const tileOffsetX=Number(halfX)/WORLD_TILE_METERS;
    const tileOffsetZ=Number(halfZ)/WORLD_TILE_METERS;
    const hNW=terrainHeightAtTile(seed,xValue,yValue,worldData?.chunkSize||16,centerTileOffsetX-tileOffsetX,centerTileOffsetZ-tileOffsetZ)+yOffset;
    const hNE=terrainHeightAtTile(seed,xValue,yValue,worldData?.chunkSize||16,centerTileOffsetX+tileOffsetX,centerTileOffsetZ-tileOffsetZ)+yOffset;
    const hSW=terrainHeightAtTile(seed,xValue,yValue,worldData?.chunkSize||16,centerTileOffsetX-tileOffsetX,centerTileOffsetZ+tileOffsetZ)+yOffset;
    const hSE=terrainHeightAtTile(seed,xValue,yValue,worldData?.chunkSize||16,centerTileOffsetX+tileOffsetX,centerTileOffsetZ+tileOffsetZ)+yOffset;
    const cx=p.x+Number(centerOffsetX||0),cz=p.z+Number(centerOffsetZ||0);
    const base=batch.positions.length/3;
    batch.positions.push(
      cx-halfX,hNW,cz-halfZ,
      cx+halfX,hNE,cz-halfZ,
      cx-halfX,hSW,cz+halfZ,
      cx+halfX,hSE,cz+halfZ
    );
    const dx=((hNE+hSE)-(hNW+hSW))/(Math.max(0.001,halfX*4));
    const dz=((hSW+hSE)-(hNW+hNE))/(Math.max(0.001,halfZ*4));
    const nx=-dx,ny=1,nz=-dz,len=Math.hypot(nx,ny,nz)||1;
    for(let i=0;i<4;i++)batch.normals.push(nx/len,ny/len,nz/len);
    batch.uvs.push(0,0,1,0,0,1,1,1);
    batch.indices.push(base,base+2,base+1,base+1,base+2,base+3);
    batch.sourcePrimitiveCount++;
    staticBatchSourcePrimitiveCount++;
    return 2;
  }
  function appendDiagonalRouteBridge(batch,worldData,xValue,yValue,dxTile,dzTile,halfWidth=0.72,yOffset=0.033){
    const seed=String(seedProvider()||"");
    const p0=localTileCenter(worldData,xValue,yValue);
    const nx=BigInt(String(xValue))+BigInt(dxTile),ny=BigInt(String(yValue))+BigInt(dzTile);
    const p1=localTileCenter(worldData,String(nx),String(ny));
    const vx=p1.x-p0.x,vz=p1.z-p0.z,length=Math.hypot(vx,vz)||1;
    const ux=vx/length,uz=vz/length,px=-uz,pz=ux;
    const halfLength=length*0.54;
    const cx=(p0.x+p1.x)*0.5,cz=(p0.z+p1.z)*0.5;
    const corners=[
      [cx-ux*halfLength-px*halfWidth,cz-uz*halfLength-pz*halfWidth],
      [cx-ux*halfLength+px*halfWidth,cz-uz*halfLength+pz*halfWidth],
      [cx+ux*halfLength-px*halfWidth,cz+uz*halfLength-pz*halfWidth],
      [cx+ux*halfLength+px*halfWidth,cz+uz*halfLength+pz*halfWidth]
    ];
    const heights=corners.map(([x,z])=>
      terrainHeightAtTile(
        seed,xValue,yValue,worldData?.chunkSize||16,
        (x-p0.x)/WORLD_TILE_METERS,(z-p0.z)/WORLD_TILE_METERS
      )+yOffset
    );
    const base=batch.positions.length/3;
    for(let i=0;i<4;i++)batch.positions.push(corners[i][0],heights[i],corners[i][1]);
    const ax=corners[2][0]-corners[0][0],ay=heights[2]-heights[0],az=corners[2][1]-corners[0][1];
    const bx=corners[1][0]-corners[0][0],by=heights[1]-heights[0],bz=corners[1][1]-corners[0][1];
    let nnx=ay*bz-az*by,nny=az*bx-ax*bz,nnz=ax*by-ay*bx;
    if(nny<0){nnx=-nnx;nny=-nny;nnz=-nnz;}
    const nlen=Math.hypot(nnx,nny,nnz)||1;
    for(let i=0;i<4;i++)batch.normals.push(nnx/nlen,nny/nlen,nnz/nlen);
    batch.uvs.push(0,0,1,0,0,1,1,1);
    // Diagonal bridge corners are ordered start-left/start-right/end-left/end-right,
    // so use the opposite winding from axis-aligned route quads to keep the
    // surface front-facing under normal back-face culling.
    batch.indices.push(base,base+1,base+2,base+1,base+3,base+2);
    batch.sourcePrimitiveCount++;
    staticBatchSourcePrimitiveCount++;
    return 2;
  }
  function routeNeighborType(seed,xValue,yValue,dx,dy){
    try{
      const x=BigInt(String(xValue))+BigInt(dx),y=BigInt(String(yValue))+BigInt(dy);
      return String(window.TerrainFoundation?.getTile?.(seed,String(x),String(y))?.type||"");
    }catch(_){return "";}
  }
  function routeOrientation(seed,cell){
    const type=String(cell?.type||"");
    const connected=neighbor=>{
      if(type==="path")return ["path","road","square","bridge"].includes(neighbor);
      return ["road","path","square","bridge"].includes(neighbor);
    };
    const n=connected(routeNeighborType(seed,cell.x,cell.y,0,-1));
    const e=connected(routeNeighborType(seed,cell.x,cell.y,1,0));
    const s=connected(routeNeighborType(seed,cell.x,cell.y,0,1));
    const w=connected(routeNeighborType(seed,cell.x,cell.y,-1,0));
    const horizontal=e||w,vertical=n||s;
    if(horizontal&&vertical)return "corner";
    if(horizontal)return "horizontal";
    if(vertical)return "vertical";
    return "terminal";
  }
  function routeExtents(type,orientation){
    if(type==="road")return {halfX:0.97,halfZ:0.97};
    if(type==="square")return {halfX:0.985,halfZ:0.985};
    if(orientation==="horizontal")return {halfX:1.04,halfZ:0.42};
    if(orientation==="vertical")return {halfX:0.42,halfZ:1.04};
    if(orientation==="corner")return {halfX:0.98,halfZ:0.98};
    return {halfX:0.58,halfZ:0.58};
  }
  function buildRoutePresentation(worldData,connectorDescriptors,batches){
    const seed=String(seedProvider()||"");
    const counts={road:0,path:0,square:0,connector:0};
    const samples=[];
    let triangleCount=0,edgeStripCount=0,diagonalBridgeCount=0,diagonalRibbonOnlyCellCount=0;
    const routeTypes=new Set(["road","path","square"]);
    const edgeMaterial=presentationMaterial("route-edge",0.25,0.18,0.11,0.02);
    const edgeBatch=batchFor(batches,edgeMaterial.name,edgeMaterial);
    const routeLike=type=>["road","path","square","bridge"].includes(String(type||""));
    const diagonalRoadAcrossSide=(cell,side)=>{
      const tests=side==="e"?[[1,-1],[1,1]]:
        side==="w"?[[-1,-1],[-1,1]]:
        side==="n"?[[-1,-1],[1,-1]]:
        [[-1,1],[1,1]];
      return tests.some(([dx,dy])=>routeNeighborType(seed,cell.x,cell.y,dx,dy)==="road");
    };
    const appendEdge=(cell,side)=>{
      const inset=0.92,width=0.075;
      const offsetX=side==="e"?inset:side==="w"?-inset:0;
      const offsetZ=side==="s"?inset:side==="n"?-inset:0;
      const halfX=(side==="e"||side==="w")?width:0.94;
      const halfZ=(side==="n"||side==="s")?width:0.94;
      triangleCount+=appendRouteQuad(edgeBatch,worldData,cell.x,cell.y,halfX,halfZ,0.034,offsetX,offsetZ);
      edgeStripCount++;
    };

    for(const cell of worldData?.cells||[]){
      const type=String(cell?.type||"");
      if(!routeTypes.has(type))continue;
      const orientation=routeOrientation(seed,cell);
      const cardinalTypes=[
        routeNeighborType(seed,cell.x,cell.y,0,-1),
        routeNeighborType(seed,cell.x,cell.y,1,0),
        routeNeighborType(seed,cell.x,cell.y,0,1),
        routeNeighborType(seed,cell.x,cell.y,-1,0)
      ];
      const diagonalRoadDirections=[[-1,-1],[1,-1],[-1,1],[1,1]].filter(
        ([dx,dy])=>routeNeighborType(seed,cell.x,cell.y,dx,dy)==="road"
      );
      const diagonalRibbonOnly=type==="road"&&!cardinalTypes.some(routeLike)&&diagonalRoadDirections.length>0;
      const extents=routeExtents(type,orientation);
      const mat=routeSurfaceMaterial(type);
      const batch=batchFor(batches,mat.name,mat);
      if(!diagonalRibbonOnly){
        triangleCount+=appendRouteQuad(batch,worldData,cell.x,cell.y,extents.halfX,extents.halfZ,type==="square"?0.028:0.032);
      }else{
        diagonalRibbonOnlyCellCount++;
      }
      counts[type]++;
      if(samples.length<24)samples.push(Object.freeze({
        x:String(cell.x),y:String(cell.y),type,
        orientation:diagonalRibbonOnly?"diagonal-ribbon":orientation,
        materialName:mat.name,textureKey:"tile:"+type,
        halfWidthMeters:Number((diagonalRibbonOnly?0.78:extents.halfX).toFixed(3)),
        halfDepthMeters:Number((diagonalRibbonOnly?0.78:extents.halfZ).toFixed(3))
      }));
      if(type==="road"){
        // The one-tile gateway centerline may change lateral offset by one tile
        // between consecutive forward coordinates. Simulation already treats
        // that diagonal pair as continuous; bridge only that visual corner so
        // the road no longer appears broken while authoritative cells stay unchanged.
        for(const [dx,dy] of [[1,-1],[1,1]]){
          const diagonal=routeNeighborType(seed,cell.x,cell.y,dx,dy);
          if(diagonal!=="road")continue;
          const sideA=routeNeighborType(seed,cell.x,cell.y,dx,0);
          const sideB=routeNeighborType(seed,cell.x,cell.y,0,dy);
          if(routeLike(sideA)||routeLike(sideB))continue;
          triangleCount+=appendDiagonalRouteBridge(batch,worldData,cell.x,cell.y,dx,dy,diagonalRibbonOnly?0.78:0.94,0.033);
          diagonalBridgeCount++;
        }
      }
      if((type==="road"||type==="square")&&!diagonalRibbonOnly){
        for(const [side,dx,dy] of [["n",0,-1],["e",1,0],["s",0,1],["w",-1,0]]){
          const neighbor=routeNeighborType(seed,cell.x,cell.y,dx,dy);
          if(!routeLike(neighbor)&&!diagonalRoadAcrossSide(cell,side))appendEdge(cell,side);
        }
      }
    }

    const connectorMat=routeSurfaceMaterial("path");
    const connectorBatch=batchFor(batches,connectorMat.name,connectorMat);
    for(const descriptor of connectorDescriptors||[]){
      const orientation=String(descriptor?.orientation||"terminal");
      const extents=routeExtents("path",orientation);
      triangleCount+=appendRouteQuad(connectorBatch,worldData,descriptor.x,descriptor.y,extents.halfX,extents.halfZ,0.026);
      counts.connector++;
      if(samples.length<24)samples.push(Object.freeze({
        x:String(descriptor.x),y:String(descriptor.y),type:"connector",orientation,
        buildingId:String(descriptor.buildingId||""),
        materialName:connectorMat.name,textureKey:"tile:path",
        routeSafe:descriptor.routeSafe!==false
      }));
    }

    return Object.freeze({
      counts:Object.freeze({...counts}),
      surfaceCellCount:counts.road+counts.path+counts.square,
      connectorCellCount:counts.connector,
      edgeStripCount,diagonalBridgeCount,diagonalRibbonOnlyCellCount,
      sourcePrimitiveCount:counts.road+counts.path+counts.square-diagonalRibbonOnlyCellCount+counts.connector+edgeStripCount+diagonalBridgeCount,
      triangleCount,
      samples:Object.freeze(samples),
      contactShadowMaterialCount:contactShadowMaterials.size,
      contactShadowQuality:String(contactShadowProfile().level),
      contactShadowOpacity:Number(contactShadowProfile().opacity.toFixed(3)),
      contactShadowMaterialRefreshes,
      ambientMotionEnabled:true,
      ambientMotionStrategy:"throttled-shared-instance-buffer",
      ambientUpdateCalls,ambientSkippedUpdateCalls,ambientBufferUpdates,
      ambientLastUpdateMs:Number(lastAmbientUpdateMs.toFixed(3)),
      ambientMaxUpdateMs:Number(maxAmbientUpdateMs.toFixed(3)),
      ambientAverageUpdateMs:Number((ambientUpdateCalls?totalAmbientUpdateMs/ambientUpdateCalls:0).toFixed(3)),
      ambientSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("ambient-")).length,
      ambientParticleEmitterCount:0,
      ambientAnimatedMaterialShaderCount:0,
      ambientRendererOnly:true,
      ambientNavigationAuthority:false,
      ambientCollisionAuthority:false,
      ambientSimulationAuthorityPreserved:true,
      routeSurfaceMaterialCount:routeSurfaceMaterials.size,
      routeSurfaceMaterialNames:Object.freeze([...routeSurfaceMaterials.values()].map(m=>m.name).sort()),
      surfaceBindings:routeSurfaceBindings(),
      routeSafe:(connectorDescriptors||[]).every(item=>item?.routeSafe!==false),
      rendererOnly:true,
      simulationAuthorityPreserved:true
    });
  }

  function matrixDataFor(instances){
    const data=new Float32Array(instances.length*16);
    const matrix=new pc.Mat4(),pos=new pc.Vec3(),rot=new pc.Quat(),scale=new pc.Vec3();
    for(let i=0;i<instances.length;i++){
      const item=instances[i];
      // Instance transforms are chunk-local. The parent chunk Entity owns the
      // scene-anchor/world translation exactly once.
      pos.set(item.position[0],item.position[1],item.position[2]);
      rot.setFromEulerAngles(...(item.euler||[0,0,0]));
      scale.set(...item.scale);
      matrix.setTRS(pos,rot,scale);
      data.set(matrix.data,i*16);
    }
    return data;
  }
  function instanceAabb(instances){
    if(!instances.length)return new pc.BoundingBox(new pc.Vec3(0,0,0),new pc.Vec3(1,1,1));
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const item of instances){
      const hx=Math.abs(item.scale[0])*0.6,hy=Math.abs(item.scale[1])*0.6,hz=Math.abs(item.scale[2])*0.6;
      const x=item.position[0],y=item.position[1],z=item.position[2];
      minX=Math.min(minX,x-hx);maxX=Math.max(maxX,x+hx);
      if(item.anchorBottom){minY=Math.min(minY,y);maxY=Math.max(maxY,y+Math.abs(item.scale[1]));}
      else{minY=Math.min(minY,y-hy);maxY=Math.max(maxY,y+hy);}
      minZ=Math.min(minZ,z-hz);maxZ=Math.max(maxZ,z+hz);
    }
    return new pc.BoundingBox(
      new pc.Vec3((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2),
      new pc.Vec3((maxX-minX)/2,(maxY-minY)/2,(maxZ-minZ)/2)
    );
  }
  function createInstancedGroup(root,name,mesh,mat,instances){
    if(!instances.length)return null;
    const entity=new pc.Entity(name);
    const mi=new pc.MeshInstance(mesh,mat,entity);
    const format=pc.VertexFormat.getDefaultInstancingFormat(device);
    const vb=new pc.VertexBuffer(device,format,instances.length,{data:matrixDataFor(instances)});
    mi.setInstancing(vb,true);
    entity.addComponent("render",{meshInstances:[mi],castShadows:false,receiveShadows:false});
    entity.render.customAabb=instanceAabb(instances);
    root.addChild(entity);
    presentationEntityCreations++;
    presentationMeshInstanceCreations++;
    instancedGroupCreations++;
    instancedObjectCount+=instances.length;
    frustumCulledMeshInstances++;
    return {entity,meshInstance:mi,vertexBuffer:vb,instances};
  }

  const ambientMatrix=new pc.Mat4(),ambientPos=new pc.Vec3(),ambientRot=new pc.Quat(),ambientScale=new pc.Vec3();
  function ambientQuality(levelOverride=null){
    const q=qualityProvider?.()||{};
    const level=String(levelOverride||q.activeLevel||q.mode||"standard").toLowerCase();
    if(level==="low")return Object.freeze({level:"low",interval:0.25,treeAmplitude:0.35,smoke:false,pennant:false});
    if(level==="high")return Object.freeze({level:"high",interval:0.10,treeAmplitude:1.20,smoke:true,pennant:true});
    return Object.freeze({level:"standard",interval:0.125,treeAmplitude:1.0,smoke:true,pennant:true});
  }
  function collectAmbientBuildingInstances(worldData,buildings,roofProfiles){
    const smoke=[],pennants=[];
    let smokeEmitterCount=0;
    const seed=String(seedProvider()||"");
    for(let i=0;i<buildings.length;i++){
      const descriptor=buildings[i]||{},profile=roofProfiles[i]||null;
      const bounds=localBounds(worldData,descriptor.bounds||{});
      const ridgeY=Number(profile?.ridgeTopY??2.5);
      const identity=String(descriptor.id||i)+"|"+String(descriptor.kind||"")+"|"+String(descriptor.source||"normal");
      const h=hash32(seed+"|ambient-building|"+identity);
      const treatment=String(descriptor.landmark?.treatment||"");
      const special=String(descriptor.source||"")==="special";
      const contextualStack=treatment==="forge-stack"||treatment==="timber-stack";
      const domesticHearth=!special&&(h%5===0);
      if(special||contextualStack||domesticHearth){
        smokeEmitterCount++;
        const x=bounds.x+bounds.width*(contextualStack?0.24:0.18);
        const z=bounds.z-bounds.depth*(contextualStack?0.12:0.16);
        for(let puff=0;puff<3;puff++){
          const phase=(puff/3)*Math.PI*2+((h>>>8)&255)/255;
          const s=0.38+puff*0.12;
          smoke.push({
            position:[x,ridgeY+0.58+puff*0.56,z],
            scale:[s,s*0.92,s],
            euler:[0,0,0],
            ambientPhase:phase,
            ambientDrift:0.18+(((h>>>(puff*3))&7)/7)*0.14
          });
        }
      }
      if(descriptor.landmark){
        const phase=((h>>>16)&1023)/1023*Math.PI*2;
        pennants.push({
          position:[bounds.x+bounds.width*0.32,ridgeY+0.06,bounds.z+bounds.depth*0.08],
          scale:[1,1,1],
          euler:[0,Number((h>>>4)%360),0],
          ambientPhase:phase,
          ambientStrength:0.85+((h>>>10)&15)/60
        });
      }
    }
    return Object.freeze({smoke,pennants,smokeEmitterCount});
  }
  function writeAmbientGroup(group,timeSeconds,kind,intensity=1){
    if(!group?.instances?.length||!group.vertexBuffer)return 0;
    const instances=group.instances;
    let data=group.ambientMatrixData;
    if(!(data instanceof Float32Array)||data.length!==instances.length*16){
      data=new Float32Array(instances.length*16);
      group.ambientMatrixData=data;
    }
    for(let i=0;i<instances.length;i++){
      const item=instances[i],phase=Number(item.ambientPhase||0),strength=Number(item.ambientStrength||1);
      const basePos=item.position||[0,0,0],baseEuler=item.euler||[0,0,0],baseScale=item.scale||[1,1,1];
      let px=Number(basePos[0]),py=Number(basePos[1]),pz=Number(basePos[2]);
      let ex=Number(baseEuler[0]||0),ey=Number(baseEuler[1]||0),ez=Number(baseEuler[2]||0);
      let sx=Number(baseScale[0]),sy=Number(baseScale[1]),sz=Number(baseScale[2]);
      if(kind==="tree"){
        const wave=Math.sin(timeSeconds*1.35+phase)*6.2*strength*intensity;
        ex+=wave*0.14;ez+=wave;
      }else if(kind==="smoke"){
        const wave=Math.sin(timeSeconds*1.10+phase);
        const drift=Number(item.ambientDrift||0.14)*intensity;
        px+=wave*drift;
        py+=Math.sin(timeSeconds*1.65+phase)*0.13*intensity;
        pz+=Math.cos(timeSeconds*0.85+phase)*drift*0.55;
        const pulse=1+Math.sin(timeSeconds*1.35+phase)*0.10*intensity;
        sx*=pulse;sy*=pulse;sz*=pulse;
      }else if(kind==="pennant"){
        const wave=Math.sin(timeSeconds*2.0+phase)*9.0*strength*intensity;
        ey+=wave;
        ez+=Math.sin(timeSeconds*2.7+phase)*1.5*intensity;
      }
      ambientPos.set(px,py,pz);
      ambientRot.setFromEulerAngles(ex,ey,ez);
      ambientScale.set(sx,sy,sz);
      ambientMatrix.setTRS(ambientPos,ambientRot,ambientScale);
      data.set(ambientMatrix.data,i*16);
    }
    group.vertexBuffer.setData(data);
    instancingBufferUpdates++;
    ambientBufferUpdates++;
    return 1;
  }
  function updateAmbientMotion(resource,timeSeconds,{qualityLevel=null,zoom=1,force=false,enabled=true}={}){
    if(!resource?.ambientMotionEnabled)return Object.freeze({updated:false,reason:"unavailable"});
    const profile=ambientQuality(qualityLevel);
    const now=Math.max(0,Number(timeSeconds)||0);
    const cameraZoom=Math.max(0.05,Number(zoom)||1);
    const far=cameraZoom<0.62;
    resource.ambientZoom=Number(cameraZoom.toFixed(3));
    resource.ambientUpdateIntervalMs=Math.round(profile.interval*1000);
    resource.ambientProofDisabled=enabled===false;
    if(enabled===false){
      resource.ambientTreeActive=false;
      resource.ambientSmokeActive=false;
      resource.ambientPennantActive=false;
      resource.ambientActiveEffectTypeCount=0;
      resource.ambientQuality="disabled";
      resource.ambientLodSimplified=true;
      if(resource.ambientMotionSuppressed===true&&!force){
        ambientSkippedUpdateCalls++;
        return Object.freeze({updated:false,reason:"suppressed",quality:"disabled",zoom:cameraZoom});
      }
      const started=performance.now();
      let buffers=0;
      for(const group of resource.treeGroups||[]){
        if(group?.entity)group.entity.enabled=true;
        if(group?.vertexBuffer&&group?.instances?.length){
          group.vertexBuffer.setData(matrixDataFor(group.instances));
          instancingBufferUpdates++;
          ambientBufferUpdates++;
          buffers++;
        }
      }
      for(const group of resource.ambientGroups||[])if(group?.entity)group.entity.enabled=false;
      resource.ambientMotionSuppressed=true;
      resource.ambientLastUpdateTime=now;
      const elapsed=performance.now()-started;
      ambientUpdateCalls++;
      totalAmbientUpdateMs+=elapsed;
      maxAmbientUpdateMs=Math.max(maxAmbientUpdateMs,elapsed);
      lastAmbientUpdateMs=elapsed;
      resource.ambientUpdateCount=Number(resource.ambientUpdateCount||0)+1;
      resource.ambientBufferUpdateCount=Number(resource.ambientBufferUpdateCount||0)+buffers;
      resource.ambientLastCpuUpdateMs=Number(elapsed.toFixed(3));
      resource.ambientMaxCpuUpdateMs=Math.max(Number(resource.ambientMaxCpuUpdateMs||0),elapsed);
      return Object.freeze({updated:true,buffers,cpuMs:Number(elapsed.toFixed(3)),quality:"disabled",zoom:cameraZoom,lodSimplified:true});
    }
    if(resource.ambientMotionSuppressed===true){
      resource.ambientMotionSuppressed=false;
      resource.ambientLastUpdateTime=-Infinity;
    }
    const treeIntensity=far?0.30:profile.treeAmplitude;
    const smokeActive=profile.smoke&&!far;
    const pennantActive=profile.pennant&&!far;
    resource.ambientTreeActive=resource.ambientTreeCount>0;
    resource.ambientSmokeActive=smokeActive&&resource.ambientSmokePuffCount>0;
    resource.ambientPennantActive=pennantActive&&resource.ambientPennantCount>0;
    resource.ambientActiveEffectTypeCount=(resource.ambientTreeActive?1:0)+(resource.ambientSmokeActive?1:0)+(resource.ambientPennantActive?1:0);
    resource.ambientQuality=profile.level;
    resource.ambientLodSimplified=far||profile.level==="low";
    const last=Number(resource.ambientLastUpdateTime??-Infinity);
    if(!force&&now-last<profile.interval){
      ambientSkippedUpdateCalls++;
      return Object.freeze({updated:false,reason:"throttled",quality:profile.level,zoom:cameraZoom});
    }
    resource.ambientLastUpdateTime=now;
    const started=performance.now();
    let buffers=0;
    for(const group of resource.treeGroups||[]){
      if(group?.entity)group.entity.enabled=true;
      buffers+=writeAmbientGroup(group,now,"tree",treeIntensity);
    }
    for(const group of resource.ambientGroups||[]){
      const kind=String(group.ambientKind||"");
      const active=kind==="smoke"?smokeActive:kind==="pennant"?pennantActive:true;
      if(group?.entity)group.entity.enabled=active;
      if(active)buffers+=writeAmbientGroup(group,now,kind,1);
    }
    const elapsed=performance.now()-started;
    ambientUpdateCalls++;
    totalAmbientUpdateMs+=elapsed;
    maxAmbientUpdateMs=Math.max(maxAmbientUpdateMs,elapsed);
    lastAmbientUpdateMs=elapsed;
    resource.ambientUpdateCount=Number(resource.ambientUpdateCount||0)+1;
    resource.ambientBufferUpdateCount=Number(resource.ambientBufferUpdateCount||0)+buffers;
    resource.ambientLastCpuUpdateMs=Number(elapsed.toFixed(3));
    resource.ambientMaxCpuUpdateMs=Math.max(Number(resource.ambientMaxCpuUpdateMs||0),elapsed);
    return Object.freeze({updated:true,buffers,cpuMs:Number(elapsed.toFixed(3)),quality:profile.level,zoom:cameraZoom,lodSimplified:resource.ambientLodSimplified});
  }

  function buildGabledRoof(root,descriptor,rootName,b,height,outerW,outerD,roof,roofProfiles){
    const pitchDegrees=28;
    const pitchRadians=pitchDegrees*Math.PI/180;
    const panelThickness=0.16;
    const overhang=clamp(Math.min(outerW,outerD)*0.07,0.16,0.42);
    const slopeAcrossX=outerW<=outerD;
    const wallSpan=slopeAcrossX?outerW:outerD;
    const ridgeLength=(slopeAcrossX?outerD:outerW)+overhang*2;
    const eaveSpan=wallSpan+overhang*2;
    const halfSpan=eaveSpan*0.5;
    const rise=halfSpan*Math.tan(pitchRadians);
    const panelLength=halfSpan/Math.cos(pitchRadians);
    const eaveBottomY=height-0.04;
    const centerY=eaveBottomY+rise*0.5+(panelThickness*0.5*Math.cos(pitchRadians));
    const ridgeBottomY=eaveBottomY+rise;
    const ridgeTopY=ridgeBottomY+panelThickness*Math.cos(pitchRadians);
    let left,right;
    if(slopeAcrossX){
      left=primitive(
        root,rootName+"_RoofL","box",
        [b.x-halfSpan*0.5,centerY,b.z],
        [panelLength,panelThickness,ridgeLength],roof,[0,0,pitchDegrees]
      );
      right=primitive(
        root,rootName+"_RoofR","box",
        [b.x+halfSpan*0.5,centerY,b.z],
        [panelLength,panelThickness,ridgeLength],roof,[0,0,-pitchDegrees]
      );
    }else{
      left=primitive(
        root,rootName+"_RoofL","box",
        [b.x,centerY,b.z-halfSpan*0.5],
        [ridgeLength,panelThickness,panelLength],roof,[-pitchDegrees,0,0]
      );
      right=primitive(
        root,rootName+"_RoofR","box",
        [b.x,centerY,b.z+halfSpan*0.5],
        [ridgeLength,panelThickness,panelLength],roof,[pitchDegrees,0,0]
      );
    }
    left._advisorBuildingId=String(descriptor.id||"");
    right._advisorBuildingId=String(descriptor.id||"");
    registerRoof(left,descriptor);registerRoof(right,descriptor);
    const profile=Object.freeze({
      buildingId:String(descriptor.id||""),
      source:String(descriptor.source||"normal"),
      footprintWidth:Number(b.width.toFixed(3)),
      footprintDepth:Number(b.depth.toFixed(3)),
      wallWidth:Number(outerW.toFixed(3)),
      wallDepth:Number(outerD.toFixed(3)),
      ridgeAxis:slopeAcrossX?"z":"x",
      slopeAxis:slopeAcrossX?"x":"z",
      pitchDegrees,
      overhang:Number(overhang.toFixed(3)),
      wallTopY:Number(height.toFixed(3)),
      eaveBottomY:Number(eaveBottomY.toFixed(3)),
      ridgeBottomY:Number(ridgeBottomY.toFixed(3)),
      ridgeTopY:Number(ridgeTopY.toFixed(3)),
      centerRidgeHigher:ridgeBottomY>eaveBottomY+0.2,
      eaveContact:Math.abs(height-eaveBottomY)<=0.08,
      restrainedOverhang:overhang>=0.16&&overhang<=0.42,
      footprintDriven:true,
      twoPlane:true
    });
    roofProfiles.push(profile);
    return Object.freeze({left,right,profile});
  }

  function buildBuilding(root,worldData,descriptor,index,batches,roofProfiles,buildingMaterialVariants,entranceTreatmentSamples,entranceCounters,landmarkSamples,landmarkCounters){
    const b=localBounds(worldData,descriptor.bounds||{});
    const special=descriptor.source==="special";
    const height=special?2.25:1.75;
    const anchor=descriptor.entrance||descriptor.bounds||{};
    const groundY=terrainHeightAtTile(String(seedProvider()||""),anchor.x??descriptor.bounds?.minX??"0",anchor.y??descriptor.bounds?.minY??"0",worldData?.chunkSize||16);
    const wallTopY=groundY+height;
    const variantIndex=buildingVariantIndex(descriptor);
    const variant=BUILDING_MATERIAL_VARIANTS[variantIndex];
    const wallBase=special?"building-special-wall":"building-house-wall";
    const wall=special
      ?buildingVariantMaterial(wallBase,variantIndex,0.53,0.45,0.31,0.10,variant.wall)
      :buildingVariantMaterial(wallBase,variantIndex,0.61,0.52,0.36,0.10,variant.wall);
    const roof=buildingVariantMaterial("building-roof",variantIndex,0.33,0.15,0.10,0.08,variant.roof);
    const door=buildingVariantMaterial("building-door",variantIndex,0.20,0.11,0.06,0.06,variant.trim);
    const variantSample=Object.freeze({
      buildingId:String(descriptor.id||index),source:String(descriptor.source||"normal"),
      variantIndex,
      wallSurface:wallBase,
      wallTint:Object.freeze(variant.wall.slice()),
      roofTint:Object.freeze(variant.roof.slice()),
      trimTint:Object.freeze(variant.trim.slice())
    });
    buildingMaterialVariants.push(variantSample);
    buildingMaterialVariantEvidence.set(variantSample.buildingId,variantSample);
    if(buildingMaterialVariantEvidence.size>64){
      const oldest=buildingMaterialVariantEvidence.keys().next().value;
      if(oldest!==undefined)buildingMaterialVariantEvidence.delete(oldest);
    }
    const contact=contactShadowMaterial("foundation");
    const rootName="ChunkBuilding_"+String(descriptor.id||index).replace(/[^a-z0-9_-]+/gi,"-");
    const outerW=b.width*0.90,outerD=b.depth*0.90,thickness=0.22;
    // One batched, very shallow translucent footprint extends slightly beyond
    // the wall line. The building hides the center, leaving a restrained
    // foundation-contact halo with one shared material instead of dynamic lights.
    appendBoxBatch(batchFor(batches,contact.name,contact),[b.x,groundY+0.012,b.z],[outerW+0.34,0.024,outerD+0.34],0);
    const wallBatch=batchFor(batches,wall.name,wall);
    appendBoxBatch(wallBatch,[b.x,groundY+height*0.5,b.z-outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x,groundY+height*0.5,b.z+outerD*0.5],[outerW,height,thickness],0);
    appendBoxBatch(wallBatch,[b.x-outerW*0.5,groundY+height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    appendBoxBatch(wallBatch,[b.x+outerW*0.5,groundY+height*0.5,b.z],[thickness,height,Math.max(thickness,outerD-thickness*2)],0);
    const roofBuild=buildGabledRoof(root,descriptor,rootName,b,wallTopY,outerW,outerD,roof,roofProfiles);
    let count=7;
    if(descriptor.entrance){
      const p=localTileCenter(worldData,descriptor.entrance.x,descriptor.entrance.y);
      const entranceX=String(descriptor.entrance.x),entranceY=String(descriptor.entrance.y);
      const minX=String(descriptor.bounds?.minX),maxX=String(descriptor.bounds?.maxX);
      const minY=String(descriptor.bounds?.minY),maxY=String(descriptor.bounds?.maxY);
      const onMinX=entranceX===minX,onMaxX=entranceX===maxX,onMinY=entranceY===minY,onMaxY=entranceY===maxY;
      const faceOffset=thickness*0.5+0.08;
      const doorPosition=[p.x,groundY+0.70,p.z];
      let doorScale=[0.82,1.34,0.10];
      if(onMinX){doorPosition[0]=b.x-outerW*0.5-faceOffset;doorScale=[0.10,1.34,0.82];}
      else if(onMaxX){doorPosition[0]=b.x+outerW*0.5+faceOffset;doorScale=[0.10,1.34,0.82];}
      else if(onMinY){doorPosition[2]=b.z-outerD*0.5-faceOffset;}
      else if(onMaxY){doorPosition[2]=b.z+outerD*0.5+faceOffset;}
      appendBoxBatch(batchFor(batches,door.name,door),doorPosition,doorScale,0);
      count++;

      // WP-S003-009-006: renderer-only doorway architecture anchored to the
      // authoritative exterior-door cell. These primitives never participate
      // in collision/navigation and intentionally reuse a tiny shared material set.
      const trim=presentationMaterial("entrance-trim",0.72,0.50,0.22,0.06);
      const threshold=presentationMaterial("entrance-threshold",0.48,0.38,0.26,0.03);
      const wear=presentationMaterial("entrance-wear",0.34,0.25,0.15,0.02);
      const awning=presentationMaterial("entrance-awning",0.46,0.20,0.12,0.04);
      const sign=presentationMaterial("entrance-sign",0.76,0.58,0.24,0.04);
      const trimBatch=batchFor(batches,trim.name,trim);
      const thresholdBatch=batchFor(batches,threshold.name,threshold);
      const wearBatch=batchFor(batches,wear.name,wear);
      const specialEntrance=descriptor.source==="special";
      const side=String(descriptor.entrance.side||"").toUpperCase();
      const outsideX=side==="E"?1:0,outsideZ=side==="S"?1:0;
      const frameDepth=0.14,frameSide=0.12,frameHalf=0.49;
      if(side==="E"){
        const fx=doorPosition[0]+outsideX*0.07;
        appendBoxBatch(trimBatch,[fx,groundY+0.77,p.z-frameHalf],[frameDepth,1.52,frameSide],0);
        appendBoxBatch(trimBatch,[fx,groundY+0.77,p.z+frameHalf],[frameDepth,1.52,frameSide],0);
        appendBoxBatch(trimBatch,[fx,groundY+1.50,p.z],[frameDepth,0.12,1.10],0);
        appendBoxBatch(thresholdBatch,[doorPosition[0]+0.30,groundY+0.075,p.z],[0.56,0.15,1.18],0);
        appendBoxBatch(wearBatch,[doorPosition[0]+0.70,groundY+0.026,p.z],[0.82,0.052,1.38],0);
        if(specialEntrance){
          appendBoxBatch(batchFor(batches,awning.name,awning),[doorPosition[0]+0.30,groundY+1.72,p.z],[0.72,0.12,1.48],0);
          appendBoxBatch(batchFor(batches,sign.name,sign),[doorPosition[0]+0.10,groundY+1.14,p.z+0.78],[0.16,0.52,0.42],0);
        }
      }else{
        const fz=doorPosition[2]+outsideZ*0.07;
        appendBoxBatch(trimBatch,[p.x-frameHalf,groundY+0.77,fz],[frameSide,1.52,frameDepth],0);
        appendBoxBatch(trimBatch,[p.x+frameHalf,groundY+0.77,fz],[frameSide,1.52,frameDepth],0);
        appendBoxBatch(trimBatch,[p.x,groundY+1.50,fz],[1.10,0.12,frameDepth],0);
        appendBoxBatch(thresholdBatch,[p.x,groundY+0.075,doorPosition[2]+0.30],[1.18,0.15,0.56],0);
        appendBoxBatch(wearBatch,[p.x,groundY+0.026,doorPosition[2]+0.70],[1.38,0.052,0.82],0);
        if(specialEntrance){
          appendBoxBatch(batchFor(batches,awning.name,awning),[p.x,groundY+1.72,doorPosition[2]+0.30],[1.48,0.12,0.72],0);
          appendBoxBatch(batchFor(batches,sign.name,sign),[p.x+0.78,groundY+1.14,doorPosition[2]+0.10],[0.42,0.52,0.16],0);
        }
      }
      const primitiveCount=5+(specialEntrance?2:0);
      count+=primitiveCount;
      if(entranceCounters){
        entranceCounters.total=(entranceCounters.total||0)+1;
        entranceCounters.ordinary=(entranceCounters.ordinary||0)+(specialEntrance?0:1);
        entranceCounters.special=(entranceCounters.special||0)+(specialEntrance?1:0);
        entranceCounters.threshold=(entranceCounters.threshold||0)+1;
        entranceCounters.frame=(entranceCounters.frame||0)+3;
        entranceCounters.wear=(entranceCounters.wear||0)+1;
        entranceCounters.awning=(entranceCounters.awning||0)+(specialEntrance?1:0);
        entranceCounters.sign=(entranceCounters.sign||0)+(specialEntrance?1:0);
        entranceCounters.primitives=(entranceCounters.primitives||0)+primitiveCount;
      }
      if(Array.isArray(entranceTreatmentSamples)&&entranceTreatmentSamples.length<32){
        entranceTreatmentSamples.push(Object.freeze({
          buildingId:String(descriptor.id||index),
          buildingKind:String(descriptor.kind||""),
          source:String(descriptor.source||"normal"),
          door:Object.freeze({x:entranceX,y:entranceY,side}),
          authoritativeDoor:true,
          connectorTarget:descriptor.entrance.target?Object.freeze({
            x:String(descriptor.entrance.target.x),y:String(descriptor.entrance.target.y)
          }):null,
          threshold:true,frame:true,localWear:true,
          awning:specialEntrance,sign:specialEntrance,
          rendererOnly:true,navigationBlocking:false,collisionBlocking:false
        }));
      }
    }

    const landmark=descriptor.landmark||null;
    if(landmark){
      const timber=presentationMaterial("landmark-timber",0.42,0.24,0.10,0.05);
      const accent=presentationMaterial("landmark-accent",0.78,0.46,0.16,0.04);
      const stone=presentationMaterial("landmark-stone",0.52,0.48,0.39,0.05);
      const treatment=String(landmark.treatment||"civic-cupola");
      let primitiveCount=0;
      const add=(mat,position,scale)=>{
        appendBoxBatch(batchFor(batches,mat.name,mat),position,scale,0);
        primitiveCount++;
      };
      // Landmark silhouettes must clear the actual gable ridge rather than
      // intersecting it. Use the prepared roof profile so the accent remains
      // readable at normal orthographic zoom without excessive height.
      const ridgeTopY=Number(roofBuild?.profile?.ridgeTopY??(wallTopY+1.0));
      const roofBaseY=ridgeTopY+0.10;
      if(treatment==="forge-stack"||treatment==="timber-stack"){
        const x=b.x+outerW*0.24,z=b.z-outerD*0.12;
        add(stone,[x,roofBaseY+0.62,z],[0.58,1.24,0.58]);
        add(accent,[x,roofBaseY+1.28,z],[0.82,0.16,0.82]);
        add(timber,[x,roofBaseY+1.52,z],[0.46,0.34,0.46]);
      }else if(treatment==="market-crest"){
        add(timber,[b.x,roofBaseY+0.70,b.z],[0.20,1.40,0.20]);
        add(timber,[b.x,roofBaseY+1.24,b.z],[1.32,0.16,0.20]);
        add(accent,[b.x+0.40,roofBaseY+0.91,b.z],[0.66,0.62,0.12]);
      }else if(treatment==="harvest-cupola"){
        add(timber,[b.x,roofBaseY+0.38,b.z],[0.94,0.76,0.94]);
        add(accent,[b.x,roofBaseY+0.82,b.z],[1.20,0.16,1.20]);
        add(timber,[b.x,roofBaseY+1.23,b.z],[0.16,0.82,0.16]);
        add(accent,[b.x,roofBaseY+1.47,b.z],[1.00,0.12,0.16]);
      }else{
        const watch=treatment==="watch-cupola";
        add(stone,[b.x,roofBaseY+(watch?0.54:0.46),b.z],[watch?1.10:0.96,watch?1.08:0.92,watch?1.10:0.96]);
        add(accent,[b.x,roofBaseY+(watch?1.14:0.98),b.z],[watch?1.42:1.26,0.18,watch?1.42:1.26]);
        add(timber,[b.x,roofBaseY+(watch?1.52:1.34),b.z],[0.18,0.72,0.18]);
      }
      count+=primitiveCount;
      if(landmarkCounters){
        landmarkCounters.total=(landmarkCounters.total||0)+1;
        landmarkCounters.primitives=(landmarkCounters.primitives||0)+primitiveCount;
        landmarkCounters.treatments[treatment]=(landmarkCounters.treatments[treatment]||0)+1;
        landmarkCounters.contexts[String(landmark.contextTag||"mixed")]=(landmarkCounters.contexts[String(landmark.contextTag||"mixed")]||0)+1;
      }
      if(Array.isArray(landmarkSamples)&&landmarkSamples.length<16){
        landmarkSamples.push(Object.freeze({
          buildingId:String(descriptor.id||index),
          buildingKind:String(descriptor.kind||""),
          treatment,
          role:String(landmark.role||""),
          contextTag:String(landmark.contextTag||"mixed"),
          contextTags:Object.freeze([...(landmark.contextTags||[])]),
          settlementClass:String(landmark.settlementClass||"village"),
          settlementRevision:String(landmark.settlementRevision||""),
          roofRidgeTopY:Number(ridgeTopY.toFixed(3)),
          landmarkBaseY:Number(roofBaseY.toFixed(3)),
          clearsRoofRidge:roofBaseY>ridgeTopY,
          primitiveCount,
          rendererOnly:true,
          navigationAuthority:false,
          collisionAuthority:false,
          simulationAuthorityPreserved:true
        }));
      }
    }
    return count;
  }
  function buildInteriorObject(worldData,descriptor,batches){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const type=String(descriptor.type||"object");
    const specs={
      bed:{scale:[1.45,0.42,1.70],y:0.27,color:[0.50,0.31,0.24]},
      table:{scale:[1.20,0.62,0.86],y:0.36,color:[0.39,0.24,0.12]},
      chair:{scale:[0.58,0.76,0.58],y:0.42,color:[0.35,0.22,0.12]},
      hearth:{scale:[0.88,0.66,0.88],y:0.36,color:[0.48,0.20,0.10]},
      storage:{scale:[1.00,0.96,0.82],y:0.50,color:[0.32,0.23,0.15]},
      workbench:{scale:[1.46,0.80,0.72],y:0.43,color:[0.42,0.29,0.16]}
    };
    const spec=specs[type]||{scale:[0.78,0.60,0.78],y:0.34,color:[0.36,0.29,0.20]};
    const mat=presentationMaterial("interior-"+type,...spec.color,0.08);
    const groundY=terrainHeightAtTile(String(seedProvider()||""),descriptor.x,descriptor.y,worldData?.chunkSize||16);
    appendBoxBatch(batchFor(batches,mat.name,mat),[p.x,groundY+spec.y,p.z],spec.scale,0);
    return 1;
  }
  function rotateOffset(dx,dz,yawDegrees){
    const a=Number(yawDegrees||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    return [dx*c-dz*s,dx*s+dz*c];
  }
  function collectDressingInstances(worldData,descriptor,groups,samples){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const seed=String(seedProvider()||"");
    const groundY=terrainHeightAtTile(seed,descriptor.x,descriptor.y,worldData?.chunkSize||16);
    const yaw=Number(descriptor.rotation||0);
    const variant=Math.max(0,Math.min(2,Number(descriptor.variant||0)));
    const semantic=String(descriptor.semantic||"bush");
    let primitiveCount=0;
    const addBox=(target,dx,dz,sx,sy,sz,y=sy*0.5,localYaw=yaw)=>{
      const [ox,oz]=rotateOffset(dx,dz,yaw);
      target.push({position:[p.x+ox,groundY+y,p.z+oz],scale:[sx,sy,sz],euler:[0,localYaw,0]});
      primitiveCount++;
    };
    const addSphere=(target,dx,dz,sx,sy,sz,y=sy*0.5)=>{
      const [ox,oz]=rotateOffset(dx,dz,yaw);
      target.push({position:[p.x+ox,groundY+y,p.z+oz],scale:[sx,sy,sz],euler:[0,0,0]});
      primitiveCount++;
    };
    const fenceSegment=(offsetX=0,offsetZ=0,segmentYaw=yaw)=>{
      const [ox,oz]=rotateOffset(offsetX,offsetZ,yaw);
      const q={x:p.x+ox,z:p.z+oz};
      const addFenceBox=(dx,dz,sx,sy,sz,y,localYaw=segmentYaw)=>{
        const [rx,rz]=rotateOffset(dx,dz,segmentYaw);
        groups.woodBoxes.push({position:[q.x+rx,groundY+y,q.z+rz],scale:[sx,sy,sz],euler:[0,localYaw,0]});
        primitiveCount++;
      };
      addFenceBox(-0.72,0,0.14,0.92,0.14,0.46);
      addFenceBox(0.72,0,0.14,0.92,0.14,0.46);
      addFenceBox(0,0,1.58,0.12,0.12,0.33);
      addFenceBox(0,0,1.58,0.12,0.12,0.68);
    };

    if(semantic==="fence"){
      fenceSegment();
    }else if(semantic==="pen"){
      fenceSegment(-0.32,0,0);
      fenceSegment(0.32,0,90);
    }else if(semantic==="bush"){
      addSphere(groups.foliage,0,0,1.05+variant*0.10,0.75+variant*0.08,0.95,0.40);
      addSphere(groups.foliage,0.35,-0.15,0.62,0.54,0.62,0.34);
    }else if(semantic==="flower"){
      addSphere(groups.foliage,0,0,0.48,0.32,0.48,0.20);
      addSphere(groups.accent,-0.20,0.05,0.18,0.22,0.18,0.34);
      addSphere(groups.accent,0.12,-0.10,0.20,0.24,0.20,0.36);
      addSphere(groups.accent,0.28,0.12,0.16,0.20,0.16,0.33);
    }else if(semantic==="woodpile"){
      addBox(groups.woodBoxes,-0.34,-0.22,0.72,0.18,0.18,0.14,yaw);
      addBox(groups.woodBoxes,0.32,-0.20,0.72,0.18,0.18,0.14,yaw);
      addBox(groups.woodBoxes,-0.18,0.20,0.72,0.18,0.18,0.34,yaw);
      addBox(groups.woodBoxes,0.36,0.18,0.72,0.18,0.18,0.34,yaw);
    }else if(semantic==="crate"){
      addBox(groups.woodBoxes,0,0,0.78,0.72,0.78,0.36,yaw);
    }else if(semantic==="barrel"){
      addBox(groups.woodBoxes,0,0,0.62,0.82,0.62,0.41,yaw);
      addBox(groups.darkBoxes,0,0,0.66,0.08,0.66,0.20,yaw);
      addBox(groups.darkBoxes,0,0,0.66,0.08,0.66,0.62,yaw);
    }else if(semantic==="sack"){
      addSphere(groups.cloth,0,0,0.66,0.82,0.58,0.42);
    }else if(semantic==="cart"){
      addBox(groups.woodBoxes,0,0,1.28,0.26,0.74,0.38,yaw);
      addBox(groups.woodBoxes,-0.62,0,0.18,0.62,0.18,0.32,yaw+18);
      addSphere(groups.darkSpheres,-0.42,0.42,0.36,0.52,0.18,0.33);
      addSphere(groups.darkSpheres,0.42,0.42,0.36,0.52,0.18,0.33);
    }else if(semantic==="signpost"){
      addBox(groups.woodBoxes,0,0,0.16,1.42,0.16,0.71,yaw);
      addBox(groups.woodBoxes,0.18,0,0.78,0.34,0.12,1.18,yaw);
    }else if(semantic==="well"){
      for(let i=0;i<8;i++){
        const a=(Math.PI*2*i)/8;
        addSphere(groups.stone,Math.cos(a)*0.58,Math.sin(a)*0.58,0.34,0.28,0.34,0.20);
      }
      addBox(groups.woodBoxes,-0.54,0,0.12,1.18,0.12,0.59,yaw);
      addBox(groups.woodBoxes,0.54,0,0.12,1.18,0.12,0.59,yaw);
      addBox(groups.woodBoxes,0,0,1.18,0.12,0.12,1.08,yaw);
    }else if(semantic==="garden"){
      addBox(groups.soil,0,0,1.48,0.08,1.48,0.05,yaw);
      for(const [dx,dz] of [[-0.42,-0.38],[0.0,-0.38],[0.42,-0.38],[-0.28,0.24],[0.28,0.24]]){
        addSphere(groups.foliage,dx,dz,0.34,0.30+variant*0.03,0.34,0.22);
      }
    }else if(semantic==="bench"){
      addBox(groups.woodBoxes,0,0,1.24,0.16,0.42,0.48,yaw);
      addBox(groups.woodBoxes,-0.46,0,0.16,0.62,0.16,0.31,yaw);
      addBox(groups.woodBoxes,0.46,0,0.16,0.62,0.16,0.31,yaw);
      addBox(groups.woodBoxes,0,-0.18,1.24,0.54,0.12,0.76,yaw);
    }else if(semantic==="work-prop"){
      addBox(groups.woodBoxes,0,0,1.05,0.68,0.68,0.34,yaw);
      addBox(groups.darkBoxes,0.30,-0.18,0.34,0.18,0.34,0.78,yaw+24);
      addBox(groups.darkBoxes,-0.28,0.16,0.28,0.16,0.28,0.74,yaw-18);
    }else{
      addSphere(groups.foliage,0,0,0.72,0.58,0.72,0.32);
    }
    if(samples.length<24)samples.push(Object.freeze({
      id:String(descriptor.id||""),
      semantic,context:String(descriptor.context||""),
      buildingId:String(descriptor.buildingId||""),
      x:String(descriptor.x),y:String(descriptor.y),
      routeSafe:descriptor.routeSafe!==false,
      roadAdjacent:Boolean(descriptor.roadAdjacent),
      rotation:yaw,variant,
      primitiveCount
    }));
    return primitiveCount;
  }
  function collectPropInstances(worldData,descriptor,treeVariants,rocks,treeVariationSamples,dressingGroups,dressingSamples){
    const p=localTileCenter(worldData,descriptor.x,descriptor.y);
    const type=String(descriptor.type||"");
    if(type==="tree"){
      const seed=String(seedProvider()||"");
      const h=hash32(seed+"|"+String(descriptor.x)+"|"+String(descriptor.y)+"|tree-sprite");
      const variant=h&1,scaleIndex=(h>>>1)%3,flipX=Boolean((h>>>3)&1);
      const scaleChoices=[0.88,1.0,1.12],scaleChoice=scaleChoices[scaleIndex];
      const baseHeight=variant===0?5.35:5.75,height=baseHeight*scaleChoice;
      const width=height*(variant===0?0.70:0.64);
      const jitterX=((((h>>>8)&255)/255)-0.5)*1.0;
      const jitterZ=((((h>>>16)&255)/255)-0.5)*1.0;
      const yaw=Number(treeYawProvider?.()??45);
      const groundY=terrainHeightAtTile(seed,descriptor.x,descriptor.y,worldData?.chunkSize||16,jitterX/2,jitterZ/2);
      const item={
        position:[p.x+jitterX,groundY+0.055,p.z+jitterZ],
        scale:[(flipX?-1:1)*width,height,1],
        euler:[0,yaw,0],
        anchorBottom:true,
        variant,flipX,scaleChoice,
        sourceX:String(descriptor.x),sourceY:String(descriptor.y),
        ambientPhase:((h>>>20)&1023)/1023*Math.PI*2,
        ambientStrength:0.78+(((h>>>12)&255)/255)*0.44
      };
      treeVariants[variant].push(item);
      if(treeVariationSamples.length<12)treeVariationSamples.push(Object.freeze({
        x:item.sourceX,y:item.sourceY,variant,flipX,scaleChoice:Number(scaleChoice.toFixed(2)),
        offsetX:Number(jitterX.toFixed(3)),offsetZ:Number(jitterZ.toFixed(3)),
        width:Number(width.toFixed(3)),height:Number(height.toFixed(3)),yawDegrees:Number(yaw.toFixed(3))
      }));
      return 1;
    }
    if(type==="dressing")return collectDressingInstances(worldData,descriptor,dressingGroups,dressingSamples);
    const rockGroundY=terrainHeightAtTile(String(seedProvider()||""),descriptor.x,descriptor.y,worldData?.chunkSize||16);
    rocks.push({position:[p.x,rockGroundY+0.34,p.z],scale:[0.70,0.48,0.62],euler:[0,0,0]});
    return 1;
  }

  function buildStreamingMinimum(spec){
    const started=performance.now();
    const size=Math.max(1,Number(spec.chunkSize)||16);
    const metersPerTile=2;
    const half=size*metersPerTile/2;
    const seed=String(seedProvider()||"");
    const baseX=BigInt(Math.trunc(Number(spec.x)||0))*BigInt(size);
    const baseZ=BigInt(Math.trunc(Number(spec.y)||0))*BigInt(size);
    const activeAtlas=textureAtlasProvider?.()||null;
    const atlasState=activeAtlas?.stats?.()||null;
    const semanticAtlasReady=Boolean(atlasState?.ready&&activeAtlas?.texture?.());
    const positions=[],normals=[],colors32=[],uvs=[],detailUvs=[],indices=[];
    const surfaceCounts=spec.worldData?.terrain?.surfaceCounts||{};
    let texturedBlockCount=0,colorFallbackBlockCount=0;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();
    // Gate-critical destination geometry deliberately avoids the full terrain
    // height/road-profile sampler. Four macro elevation samples preserve broad
    // slope continuity while all semantic surface identity still comes from the
    // authoritative prepared cells. Full relief/road conditioning is restored
    // by the normal post-gate chunk upgrade.
    const heightSegments=1;
    const heightStep=size;
    const nw=macroHeight(seed,String(baseX),String(baseZ)).macro;
    const ne=macroHeight(seed,String(baseX+BigInt(size)),String(baseZ)).macro;
    const sw=macroHeight(seed,String(baseX),String(baseZ+BigInt(size))).macro;
    const se=macroHeight(seed,String(baseX+BigInt(size)),String(baseZ+BigInt(size))).macro;
    const streamingLandforms=[
      landformAtTile(seed,String(baseX),String(baseZ)),
      landformAtTile(seed,String(baseX+BigInt(size)),String(baseZ)),
      landformAtTile(seed,String(baseX),String(baseZ+BigInt(size))),
      landformAtTile(seed,String(baseX+BigInt(size)),String(baseZ+BigInt(size)))
    ];
    const streamingLandformClassCounts={};
    for(const row of streamingLandforms)streamingLandformClassCounts[row.kind]=(streamingLandformClassCounts[row.kind]||0)+1;
    const sampleHeight=(tileX,tileZ)=>{
      const tx=clamp(Number(tileX)/size,0,1),tz=clamp(Number(tileZ)/size,0,1);
      const north=nw+(ne-nw)*tx;
      const south=sw+(se-sw)*tx;
      return clamp(north+(south-north)*tz,-3.4,3.4);
    };
    let emittedCellCount=0;
    const preparedCells=Array.isArray(spec.worldData?.cells)?spec.worldData.cells:[];
    for(let index=0;index<preparedCells.length;index++){
      const sourceCell=preparedCells[index]||null;
      if(!sourceCell)continue;
      const gz=Math.floor(index/size),gx=index-gz*size;
      if(gx<0||gz<0||gx>=size||gz>=size)continue;
      emittedCellCount++;
      const surfaceType=semanticSurfaceType(sourceCell.type||"grass");
      const worldX=baseX+BigInt(gx),worldZ=baseZ+BigInt(gz);
      const hydro=surfaceType==="bridge"?hydrologyAtTile(seed,String(worldX),String(worldZ)):null;
      const bridgeOverWater=Boolean(surfaceType==="bridge"&&hydro?.bridgeUnderlyingWater===true);
      const baseVisualType=bridgeOverWater?"water":surfaceType;
      const rect=semanticAtlasReady?(activeAtlas?.meshUvRect?.(baseVisualType)||activeAtlas?.uvRect?.(baseVisualType)):null;
      const x0=gx*metersPerTile-half,x1=(gx+1)*metersPerTile-half;
      const z0=gz*metersPerTile-half,z1=(gz+1)*metersPerTile-half;
      let h00=sampleHeight(gx,gz),h10=sampleHeight(gx+1,gz),h01=sampleHeight(gx,gz+1),h11=sampleHeight(gx+1,gz+1);
      if(surfaceType==="water"||bridgeOverWater){
        h00=waterSurfaceAtVertex(seed,worldX,worldZ);
        h10=waterSurfaceAtVertex(seed,worldX+1n,worldZ);
        h01=waterSurfaceAtVertex(seed,worldX,worldZ+1n);
        h11=waterSurfaceAtVertex(seed,worldX+1n,worldZ+1n);
      }else if(surfaceType==="bridge"){
        const deck=Number(hydro?.bridgeDeckHeight??sampleHeight(gx+0.5,gz+0.5));
        h00=h10=h01=h11=deck;
      }
      const base=positions.length/3;
      positions.push(x0,h00,z0,x1,h10,z0,x0,h01,z1,x1,h11,z1);
      for(let i=0;i<4;i++)normals.push(0,1,0);
      if(rect){
        texturedBlockCount++;
        texturedSurfaceTypes.add(baseVisualType);
        for(let i=0;i<4;i++)appendColor32(colors32,[1,1,1,1],1);
        uvs.push(
          Number(rect.u0),Number(rect.v0),
          Number(rect.u1),Number(rect.v0),
          Number(rect.u0),Number(rect.v1),
          Number(rect.u1),Number(rect.v1)
        );
      }else{
        colorFallbackBlockCount++;
        fallbackSurfaceTypes.add(baseVisualType);
        const fallback=heightfieldColor(seed,worldX,worldZ,sourceCell.color,baseVisualType);
        for(let i=0;i<4;i++)appendColor32(colors32,fallback,1);
        uvs.push(0,0,1,0,0,1,1,1);
      }
      detailUvs.push(
        Number(worldX)*0.25,Number(worldZ)*0.25,
        Number(worldX+1n)*0.25,Number(worldZ)*0.25,
        Number(worldX)*0.25,Number(worldZ+1n)*0.25,
        Number(worldX+1n)*0.25,Number(worldZ+1n)*0.25
      );
      indices.push(base,base+2,base+1,base+1,base+2,base+3);
      if(bridgeOverWater){
        const bridgeRect=semanticAtlasReady?(activeAtlas?.meshUvRect?.("bridge")||activeAtlas?.uvRect?.("bridge")):null;
        const deckY=Number(hydro.bridgeDeckHeight);
        const orientation=bridgeDeckOrientation(seed,worldX,worldZ);
        const centerX=(gx+0.5)*metersPerTile-half,centerZ=(gz+0.5)*metersPerTile-half;
        const halfLength=metersPerTile*0.53,halfWidth=metersPerTile*0.31;
        const minX=centerX-(orientation==="horizontal"?halfLength:halfWidth);
        const maxX=centerX+(orientation==="horizontal"?halfLength:halfWidth);
        const minZ=centerZ-(orientation==="vertical"?halfLength:halfWidth);
        const maxZ=centerZ+(orientation==="vertical"?halfLength:halfWidth);
        const deckBase=positions.length/3;
        positions.push(minX,deckY,minZ,maxX,deckY,minZ,minX,deckY,maxZ,maxX,deckY,maxZ);
        for(let i=0;i<4;i++)normals.push(0,1,0);
        if(bridgeRect){
          texturedSurfaceTypes.add("bridge");
          for(let i=0;i<4;i++)appendColor32(colors32,[1,1,1,1],1);
          uvs.push(
            Number(bridgeRect.u0),Number(bridgeRect.v0),
            Number(bridgeRect.u1),Number(bridgeRect.v0),
            Number(bridgeRect.u0),Number(bridgeRect.v1),
            Number(bridgeRect.u1),Number(bridgeRect.v1)
          );
        }else{
          fallbackSurfaceTypes.add("bridge");
          const deckColor=heightfieldColor(seed,worldX,worldZ,sourceCell.color,"bridge");
          for(let i=0;i<4;i++)appendColor32(colors32,deckColor,1);
          uvs.push(0,0,1,0,0,1,1,1);
        }
        for(let i=0;i<4;i++)detailUvs.push(Number(worldX)*0.25,Number(worldZ)*0.25);
        indices.push(deckBase,deckBase+2,deckBase+1,deckBase+1,deckBase+2,deckBase+3);
      }
    }
    const mesh=new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setColors32(colors32);
    mesh.setUvs(0,uvs);
    mesh.setUvs(1,detailUvs);
    mesh.setIndices(indices);
    mesh.update();
    const entity=new pc.Entity("TerrainChunkMesh_Minimum_"+spec.x+"_"+spec.y);
    entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
    const meshInstance=new pc.MeshInstance(mesh,material,entity);
    meshInstance.cull=true;
    entity.render.meshInstances=[meshInstance];
    parent.addChild(entity);
    entity.enabled=false;
    frustumCulledMeshInstances++;

    const presentation=spec.worldData?.presentation||{};
    const buildings=Array.isArray(presentation.buildingDescriptors)?presentation.buildingDescriptors:[];
    const batches=staticBatchCollector();
    const roofProfiles=[],buildingMaterialVariants=[],entranceTreatmentSamples=[];
    const entranceCounters={total:0,ordinary:0,special:0,threshold:0,frame:0,wear:0,awning:0,sign:0,primitives:0};
    const landmarkSamples=[],landmarkCounters={total:0,primitives:0,treatments:{},contexts:{}};
    let sourcePresentationPrimitiveCount=0;
    for(let i=0;i<buildings.length;i++){
      sourcePresentationPrimitiveCount+=buildBuilding(
        entity,spec.worldData,buildings[i],i,batches,roofProfiles,buildingMaterialVariants,
        entranceTreatmentSamples,entranceCounters,landmarkSamples,landmarkCounters
      );
    }
    const staticBatches=finalizeStaticBatches(entity,batches);
    const roofPrimitiveCount=buildings.length*2;
    const presentationMeshInstanceCount=roofPrimitiveCount+staticBatches.length;
    const presentationEntityCount=presentationMeshInstanceCount;
    const buildMs=performance.now()-started;
    creations++;
    totalBuildMs+=buildMs;
    maxBuildMs=Math.max(maxBuildMs,buildMs);
    return {
      entity,mesh,meshInstance,staticBatches,instancedGroups:[],treeGroups:[],ambientGroups:[],
      x:Number(spec.x),y:Number(spec.y),chunkSize:size,signature:String(spec.signature||""),
      streamingMinimum:true,
      streamingProfile:"minimum-destination",
      streamingOptionalPresentationDeferred:true,
      frustumCulling:true,hardwareInstancing:false,chunkLocalStaticBatching:true,
      sourcePresentationPrimitiveCount,
      sourcePresentationEntityCount:sourcePresentationPrimitiveCount,
      presentationMeshInstanceCount,presentationEntityCount,
      optimizedPresentationDrawCalls:presentationMeshInstanceCount,
      unoptimizedPresentationDrawCalls:sourcePresentationPrimitiveCount,
      savedDrawCalls:Math.max(0,sourcePresentationPrimitiveCount-presentationMeshInstanceCount),
      buildingPresentationCount:buildings.length,
      entranceTreatmentCount:Number(entranceCounters.total||0),
      entranceOrdinaryCount:Number(entranceCounters.ordinary||0),
      entranceSpecialCount:Number(entranceCounters.special||0),
      entranceThresholdCount:Number(entranceCounters.threshold||0),
      entranceFramePrimitiveCount:Number(entranceCounters.frame||0),
      entranceWearCount:Number(entranceCounters.wear||0),
      entranceAwningCount:Number(entranceCounters.awning||0),
      entranceSignCount:Number(entranceCounters.sign||0),
      entrancePrimitiveCount:Number(entranceCounters.primitives||0),
      entranceTreatmentSamples:Object.freeze(entranceTreatmentSamples.slice()),
      entranceAuthoritativeDoorAnchored:true,
      entranceRendererOnly:true,
      entranceNavigationBlocking:false,
      entranceCollisionBlocking:false,
      landmarkPresentationCount:Number(landmarkCounters.total||0),
      landmarkPrimitiveCount:Number(landmarkCounters.primitives||0),
      landmarkTreatmentCounts:Object.freeze({...landmarkCounters.treatments}),
      landmarkContextCounts:Object.freeze({...landmarkCounters.contexts}),
      landmarkSamples:Object.freeze(landmarkSamples.slice()),
      landmarkDeterministic:true,landmarkRendererOnly:true,landmarkNavigationAuthority:false,
      landmarkCollisionAuthority:false,landmarkSimulationAuthorityPreserved:true,
      interiorObjectPresentationCount:0,propPresentationCount:0,dressingPresentationCount:0,
      dressingDescriptorCount:0,dressingPrimitiveInstanceCount:0,dressingInstancedGroupCount:0,
      dressingRouteSafeCount:0,dressingContextCounts:Object.freeze({}),dressingSemanticCounts:Object.freeze({}),
      dressingSamples:Object.freeze([]),dressingDeterministic:true,dressingRendererOnly:true,
      treePresentationCount:0,treeVariant0Count:0,treeVariant1Count:0,treeInstancedGroupCount:0,
      treeCylinderSpherePlaceholderCount:0,treeVariationSamples:Object.freeze([]),
      contactShadowBuildingCount:0,contactShadowTreeCount:0,contactShadowPropCount:0,contactShadowObjectCount:0,
      contactShadowInstancedGroupCount:0,contactShadowDrawCalls:0,contactShadowRendererOnly:true,contactShadowTerrainSampled:true,
      roofProfiles:Object.freeze(roofProfiles.slice()),buildingMaterialVariants:Object.freeze(buildingMaterialVariants.slice()),
      ambientMotionEnabled:false,ambientMotionStrategy:"minimum-destination-static",
      ambientTreeCount:0,ambientSmokeEmitterCount:0,ambientSmokePuffCount:0,ambientPennantCount:0,
      ambientEffectTypeCount:0,ambientActiveEffectTypeCount:0,ambientAddedDrawCalls:0,
      ambientParticleEmitterCount:0,ambientAnimatedMaterialShaderCount:0,ambientContextAware:true,
      ambientRendererOnly:true,ambientNavigationAuthority:false,ambientCollisionAuthority:false,
      ambientSimulationAuthorityPreserved:true,ambientQuality:"minimum",ambientZoom:1,ambientLodSimplified:true,
      ambientUpdateIntervalMs:0,ambientUpdateCount:0,ambientBufferUpdateCount:0,ambientLastCpuUpdateMs:0,ambientMaxCpuUpdateMs:0,
      landformEnabled:true,landformVersion:LANDFORM_VERSION,landformSampleRadiusTiles:LANDFORM_SAMPLE_RADIUS_TILES,
      landformClassCounts:Object.freeze({...streamingLandformClassCounts}),landformSamples:Object.freeze(streamingLandforms.slice()),
      landformGradientMin:Math.min(...streamingLandforms.map(row=>Number(row.gradientMetersPerTile||0))),
      landformGradientMax:Math.max(...streamingLandforms.map(row=>Number(row.gradientMetersPerTile||0))),
      landformReliefMin:Math.min(...streamingLandforms.map(row=>Number(row.localReliefMeters||0))),
      landformReliefMax:Math.max(...streamingLandforms.map(row=>Number(row.localReliefMeters||0))),
      landformConditionOffsetMin:Math.min(...streamingLandforms.map(row=>Number(row.conditionOffset||0))),
      landformConditionOffsetMax:Math.max(...streamingLandforms.map(row=>Number(row.conditionOffset||0))),
      landformSteepFaceTreatment:"shared-terrain-vertex-color",landformDrawCallsAdded:0,landformTrianglesAdded:0,landformMaterialsAdded:0,
      landformDeterministic:true,landformSeamSafeGlobalCoordinates:true,landformChunkPrepared:true,landformPerFrameRegenerationCount:0,
      landformRendererOnly:true,landformNavigationAuthority:false,landformCollisionAuthority:false,landformSimulationAuthorityPreserved:true,
      segments:size,heightfieldGridResolution:heightSegments+1,heightfieldStepTiles:heightStep,
      semanticGridResolution:size+1,semanticStepTiles:1,indexedSharedVertices:false,indexedSemanticQuads:true,
      streamingSparseMesh:true,streamingSparseMeshCellCount:emittedCellCount,
      semanticUvChannel:0,normalDetailUvChannel:1,semanticSurfaceTileCount:emittedCellCount,
      semanticSurfaceTileCounts:Object.freeze({...surfaceCounts}),
      contourAlgorithm:"streaming-minimum-none",contourPreparationOnly:true,contourHaloTiles:0,
      contourRoundRadiusTiles:0,contourRoundRadiusWorldUnits:0,contourArcSegments:0,
      contourTransitionBandWidthTiles:0,contourMaxBoundaryDeviationTiles:0,contourMaxBoundaryDeviationWorldUnits:0,
      contourPatchCount:0,contourVertexCount:0,contourAddedTriangleCount:0,contourBaseTriangleCount:emittedCellCount*2,
      contourBaseVertexCount:emittedCellCount*4,contourBuildMs:0,contourDrawCallsAdded:0,contourMaterialCountAdded:0,
      contourPerFrameRegenerationCount:0,contourCanonicalCornerOwnership:true,contourSharedEdgeKeys:Object.freeze([]),
      contourSurfacePairCounts:Object.freeze({}),contourTileCentersPreserved:true,contourNarrowFeaturesPreserved:true,
      contourAlphaBlend:false,
      terrainVariationEnabled:false,terrainVariationStrategy:"deferred-during-destination-catchup",
      terrainVariationMacroScaleTiles:Number(TERRAIN_VARIATION_MACRO_SCALE_TILES),
      terrainVariationContextRadiusTiles:0,terrainVariationEvaluatedVertexCount:0,terrainVariationTintedVertexCount:0,
      terrainVariationCategoryCounts:Object.freeze({}),terrainVariationSamples:Object.freeze([]),
      terrainVariationMinTintComponent:1,terrainVariationMaxTintComponent:1,terrainVariationDrawCallsAdded:0,
      terrainVariationMaterialsAdded:0,terrainVariationTexturesAdded:0,terrainVariationTrianglesAdded:0,
      terrainVariationGlobalCoordinateField:true,terrainVariationChunkBorderContinuous:true,
      terrainVariationSemanticEdgeFade:true,terrainVariationAuthorityQueriesAdded:0,
      terrainVariationContourCompatible:true,terrainVariationBaseSurfaceIdentityPreserved:true,
      terrainVariationRendererOnly:true,terrainVariationNavigationAuthority:false,
      terrainVariationCollisionAuthority:false,terrainVariationSimulationAuthorityPreserved:true,
      roadProfileVertexCount:0,roadProfileCoreVertexCount:0,roadProfileShoulderVertexCount:0,
      roadProfileRoadVertexCount:0,roadProfilePathVertexCount:0,roadProfileSquareVertexCount:0,
      minRoadProfileHeightDelta:0,maxRoadProfileHeightDelta:0,minRoadCoreHeightDelta:0,maxRoadCoreHeightDelta:0,
      minSourceElevationMeters:0,maxSourceElevationMeters:0,minConditionedHeight:0,maxConditionedHeight:0,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      terrainTypeCount:Object.keys(surfaceCounts).length,
      roadCellCount:Number(surfaceCounts.road||0)+Number(surfaceCounts.path||0)+Number(surfaceCounts.square||0),
      waterCellCount:Number(surfaceCounts.water||0),bridgeCellCount:Number(surfaceCounts.bridge||0),
      vertices:positions.length/3,triangles:indices.length/3,
      buildMs,worldDataKey:spec.worldData?.key||null,worldDataComplete:Boolean(spec.worldData?.complete),
      seedDerivedPresentation:presentation.source==="seed-chunk-world-data",
      hardCodedSampleGeometry:Boolean(presentation.hardCodedSampleGeometry),
      presentationKind:"streaming-minimum-chunk-mesh",complete:true
    };
  }

  function build(spec){
    if(String(spec?.streamingProfile||"")==="minimum")return buildStreamingMinimum(spec);
    const started=performance.now();
    const size=Math.max(1,Number(spec.chunkSize)||16);
    // Surface identity is logical-tile authoritative, while elevation keeps the
    // proven bounded coarse heightfield. Per-tile semantic quads interpolate
    // that prepared heightfield instead of re-running world generation at every
    // logical vertex.
    const heightSegments=heightfieldSegments(size);
    const heightStep=heightfieldStep(size);
    const segments=size;
    const step=1;
    const metersPerTile=2;
    const half=size*metersPerTile/2;
    const seed=String(seedProvider()||"");
    const baseX=BigInt(Math.trunc(Number(spec.x)||0))*BigInt(size);
    const baseZ=BigInt(Math.trunc(Number(spec.y)||0))*BigInt(size);
    const positions=[],normals=[],colors32=[],uvs=[],detailUvs=[],indices=[];
    const activeAtlas=textureAtlasProvider?.()||null;
    const atlasState=activeAtlas?.stats?.()||null;
    const semanticAtlasReady=Boolean(atlasState?.ready&&activeAtlas?.texture?.());
    const detailReady=Boolean(atlasState?.normalDetailTextureReady);
    let texturedBlockCount=0,colorFallbackBlockCount=0;
    const texturedSurfaceTypes=new Set(),fallbackSurfaceTypes=new Set();
    const semanticSurfaceTileCounts={};
    const contourPairCounts={};
    const contourSharedEdgeKeys=[];
    let contourPatchCount=0,contourVertexCount=0,contourTriangleCount=0,contourBuildMs=0;
    const terrainVariationCategoryCounts={};
    const terrainVariationSamplesByCategory=new Map();
    const terrainVariationTileCache=new Map();
    const terrainVariationContextCache=new Map();
    const terrainVariationVertexCache=new Map();
    let terrainVariationEvaluatedVertexCount=0,terrainVariationTintedVertexCount=0;
    let terrainVariationMinTintComponent=Infinity,terrainVariationMaxTintComponent=-Infinity;
    const localSamples=new Map();
    let minHeight=Infinity,maxHeight=-Infinity,minElevation=Infinity,maxElevation=-Infinity;
    let roadProfileVertexCount=0,roadProfileCoreVertexCount=0,roadProfileShoulderVertexCount=0;
    let roadProfileRoadVertexCount=0,roadProfilePathVertexCount=0,roadProfileSquareVertexCount=0;
    let minRoadProfileDelta=Infinity,maxRoadProfileDelta=-Infinity,minRoadCoreDelta=Infinity,maxRoadCoreDelta=-Infinity;
    let hydrologyWaterCellCount=0,hydrologyBridgeCellCount=0;
    let hydrologyBridgeWaterUnderlayCellCount=0,hydrologyBridgeDeckTriangleCount=0;
    let hydrologyBankFaceCount=0,hydrologyBankFaceTriangleCount=0;
    let hydrologyWaterSurfaceMin=Infinity,hydrologyWaterSurfaceMax=-Infinity;
    let hydrologyBedMin=Infinity,hydrologyBedMax=-Infinity;
    let hydrologyBankMin=Infinity,hydrologyBankMax=-Infinity;
    let hydrologyBridgeClearanceMin=Infinity,hydrologyBridgeClearanceMax=-Infinity;
    let hydrologyWaterBelowBank=true,hydrologyBedBelowWater=true,hydrologyBridgeClearsWater=true;
    const hydrologyKindCounts={},hydrologySamples=[];
    const landformClassCounts={},landformSamples=[];
    let landformCliffFaceCount=0,landformCliffFaceTriangleCount=0;
    let landformCliffLipCount=0,landformCliffLipTriangleCount=0;
    let landformGradientMin=Infinity,landformGradientMax=-Infinity;
    let landformReliefMin=Infinity,landformReliefMax=-Infinity;
    let landformConditionOffsetMin=Infinity,landformConditionOffsetMax=-Infinity;
    const variationLocalCellAt=(lx,lz)=>{
      const x=Math.trunc(Number(lx)),z=Math.trunc(Number(lz));
      if(x<0||z<0||x>=size||z>=size)return null;
      const key=x+","+z;
      if(terrainVariationTileCache.has(key))return terrainVariationTileCache.get(key);
      const cell=spec.worldData?.cells?.[z*size+x]||null;
      const rawType=String(cell?.type||"grass");
      const result=Object.freeze({
        rawType,
        type:semanticSurfaceType(rawType),
        buildingId:cell?.buildingId?String(cell.buildingId):null
      });
      terrainVariationTileCache.set(key,result);
      return result;
    };
    const variationContextAt=(wx,wz)=>{
      const key=String(wx)+","+String(wz);
      if(terrainVariationContextCache.has(key))return terrainVariationContextCache.get(key);
      let routeDistance=Infinity,buildingDistance=Infinity,waterDistance=Infinity,forestDistance=Infinity;
      const radius=TERRAIN_VARIATION_CONTEXT_RADIUS_TILES;
      const lx=Number(wx-baseX),lz=Number(wz-baseZ);
      for(let dz=-radius;dz<=radius;dz++){
        for(let dx=-radius;dx<=radius;dx++){
          const distance=Math.hypot(dx,dz);
          if(distance>radius+0.001)continue;
          // Semantic wear uses the already-prepared authoritative cells in this
          // chunk. No TerrainFoundation calls are allowed from this renderer
          // presentation pass. The global macro field below owns cross-chunk
          // continuity; semantic proximity fades to zero at chunk boundaries.
          const tile=variationLocalCellAt(Math.floor(lx)+dx,Math.floor(lz)+dz);
          if(!tile)continue;
          const t=String(tile.type||""),raw=String(tile.rawType||"");
          if(["road","path","square"].includes(t))routeDistance=Math.min(routeDistance,distance);
          if(tile.buildingId||t==="plot"||["building","floor","wall","door"].includes(raw))buildingDistance=Math.min(buildingDistance,distance);
          if(t==="water")waterDistance=Math.min(waterDistance,distance);
          if(t==="forest")forestDistance=Math.min(forestDistance,distance);
        }
      }
      const influence=distance=>{
        if(!Number.isFinite(distance))return 0;
        return smoothstep01(1-clamp((distance-0.25)/(radius+0.25),0,1));
      };
      const edgeDistance=Math.max(0,Math.min(lx,lz,size-lx,size-lz));
      const edgeFade=smoothstep01(clamp(edgeDistance/Math.max(1,radius),0,1));
      const result=Object.freeze({
        route:influence(routeDistance)*edgeFade,
        building:influence(buildingDistance)*edgeFade,
        moisture:influence(waterDistance)*edgeFade,
        forest:influence(forestDistance)*edgeFade,
        edgeFade:Number(edgeFade.toFixed(4)),
        routeDistance:Number.isFinite(routeDistance)?Number(routeDistance.toFixed(3)):null,
        buildingDistance:Number.isFinite(buildingDistance)?Number(buildingDistance.toFixed(3)):null,
        waterDistance:Number.isFinite(waterDistance)?Number(waterDistance.toFixed(3)):null,
        forestDistance:Number.isFinite(forestDistance)?Number(forestDistance.toFixed(3)):null
      });
      terrainVariationContextCache.set(key,result);
      return result;
    };
    const terrainMacroVariationAt=(wx,wz)=>{
      const scale=TERRAIN_VARIATION_MACRO_SCALE_TILES;
      const gx=floorDivBig(wx,scale),gz=floorDivBig(wz,scale);
      const rx=wx-gx*scale,rz=wz-gz*scale;
      const tx=smoothstep01(Number(rx)/Number(scale)),tz=smoothstep01(Number(rz)/Number(scale));
      const n00=signed01(seed,gx,gz,"terrain-variation-macro");
      const n10=signed01(seed,gx+1n,gz,"terrain-variation-macro");
      const n01=signed01(seed,gx,gz+1n,"terrain-variation-macro");
      const n11=signed01(seed,gx+1n,gz+1n,"terrain-variation-macro");
      const nx0=n00+(n10-n00)*tx,nx1=n01+(n11-n01)*tx;
      return nx0+(nx1-nx0)*tz;
    };
    const terrainVariationAtVertex=(wx,wz,surfaceType)=>{
      const type=semanticSurfaceType(surfaceType);
      const key=String(wx)+","+String(wz)+"|"+type;
      if(terrainVariationVertexCache.has(key))return terrainVariationVertexCache.get(key);
      const macro=terrainMacroVariationAt(wx,wz);
      const context=variationContextAt(wx,wz);
      const categories=["broad-macro"];
      let r=1,g=1,b=1;
      if(!TERRAIN_VARIATION_CONSTRUCTED_TYPES.has(type)&&TERRAIN_VARIATION_NATURAL_TYPES.has(type)){
        const landform=landformAtTile(seed,wx,wz);
        if(landform.kind==="cliff"){
          r*=0.80;g*=0.80;b*=0.80;categories.push("cliff-face");
        }else if(landform.kind==="ridge"){
          r*=0.90;g*=0.88;b*=0.84;categories.push("ridge");
        }else if(landform.kind==="valley"){
          r*=0.84;g*=0.96;b*=0.90;categories.push("valley");
        }else if(landform.kind==="pass"){
          r*=0.84;g*=0.88;b*=0.94;categories.push("mountain-pass");
        }else if(landform.kind==="slope"){
          categories.push("mountain-slope");
        }
        // Encode broad landform orientation directly into the existing vertex
        // color stream so valleys/ridges remain legible even when top textures
        // dominate. This is deterministic world-space shading, not camera state.
        const gradient=Number(landform.gradientMetersPerTile||0);
        const slopeStrength=clamp((gradient-2.0)/18.0,0,1);
        if(slopeStrength>0.02){
          const denom=Math.max(0.001,gradient*Math.SQRT2);
          const towardPositiveDiagonal=clamp(
            (Number(landform.gradientX||0)+Number(landform.gradientY||0))/denom,
            -1,1
          );
          const directionalShade=clamp(
            1-slopeStrength*(0.12+0.30*Math.max(0,towardPositiveDiagonal)),
            0.58,1
          );
          r*=directionalShade;g*=directionalShade;b*=directionalShade;
          categories.push("landform-relief-shade");
        }
        const elevationMeters=Number(landform.elevationMeters||0);
        const relativeWorldHeight=(elevationMeters-referenceElevation(seed))*HEIGHTFIELD_VERTICAL_SCALE;
        const elevationShade=clamp(0.72+0.28*clamp((relativeWorldHeight+2.5)/13.5,0,1),0.72,1);
        r*=elevationShade;g*=elevationShade;b*=elevationShade;
        categories.push("macro-elevation-shade");
        const macroStrength=(type==="grass"||type==="forest"||type==="farmland")?0.11:
          (type==="dirt"||type==="mud"||type==="sand")?0.075:0.045;
        // Mesh.setColors32 is a normalized UINT8 stream: components above 1.0
        // cannot reach the shader. Encode both sides of the field as relative
        // hue/value attenuation so dry/warm and damp/lush regions are both
        // visible without a second material, texture, draw call or shader.
        if(macro>=0){
          const dry=clamp(macro,0,1);
          r*=1-macroStrength*0.20*dry;
          g*=1-macroStrength*0.65*dry;
          b*=1-macroStrength*1.00*dry;
        }else{
          const lush=clamp(-macro,0,1);
          r*=1-macroStrength*0.85*lush;
          g*=1-macroStrength*0.20*lush;
          b*=1-macroStrength*0.35*lush;
        }

        const routeWear=context.route*(type==="grass"||type==="forest"?1:0.72);
        if(routeWear>0.08){
          r*=1-0.020*routeWear;
          g*=1-0.100*routeWear;
          b*=1-0.160*routeWear;
          categories.push("road-shoulder");
        }
        const buildingWear=context.building*(type==="grass"||type==="forest"?1:0.65);
        if(buildingWear>0.08){
          r*=1-0.025*buildingWear;
          g*=1-0.090*buildingWear;
          b*=1-0.145*buildingWear;
          categories.push("building-wear");
        }
        const moisture=context.moisture*(type==="grass"||type==="forest"||type==="mud"?1:0.45);
        if(moisture>0.08){
          r*=1-0.120*moisture;
          g*=1-0.035*moisture;
          b*=1-0.015*moisture;
          categories.push("moisture");
        }
        const forestContact=context.forest*(type==="grass"||type==="forest"?1:0.35);
        if(forestContact>0.08){
          r*=1-0.080*forestContact;
          g*=1-0.015*forestContact;
          b*=1-0.050*forestContact;
          categories.push("forest-contact");
        }
        if(context.route<0.05&&context.building<0.05&&context.moisture<0.08&&Math.abs(macro)>0.18){
          categories.push("quiet-natural");
        }
      }
      const tint=Object.freeze([
        clamp(r,0.62,1.00),
        clamp(g,0.62,1.00),
        clamp(b,0.62,1.00),
        1
      ]);
      const tinted=Math.abs(tint[0]-1)>0.006||Math.abs(tint[1]-1)>0.006||Math.abs(tint[2]-1)>0.006;
      terrainVariationEvaluatedVertexCount++;
      if(tinted)terrainVariationTintedVertexCount++;
      terrainVariationMinTintComponent=Math.min(terrainVariationMinTintComponent,tint[0],tint[1],tint[2]);
      terrainVariationMaxTintComponent=Math.max(terrainVariationMaxTintComponent,tint[0],tint[1],tint[2]);
      for(const category of categories){
        terrainVariationCategoryCounts[category]=(terrainVariationCategoryCounts[category]||0)+1;
        if(!terrainVariationSamplesByCategory.has(category)){
          terrainVariationSamplesByCategory.set(category,Object.freeze({
            category,
            x:String(wx),y:String(wz),surfaceType:type,
            macro:Number(macro.toFixed(4)),
            tint:Object.freeze(tint.slice(0,3).map(value=>Number(value.toFixed(4)))),
            routeInfluence:Number(context.route.toFixed(4)),
            buildingInfluence:Number(context.building.toFixed(4)),
            moistureInfluence:Number(context.moisture.toFixed(4)),
            forestInfluence:Number(context.forest.toFixed(4))
          }));
        }
      }
      const result=Object.freeze({tint,macro,context,categories:Object.freeze(categories.slice())});
      terrainVariationVertexCache.set(key,result);
      return result;
    };
    const terrainVariationTintAtCellPoint=(cellX,cellZ,fx,fz,surfaceType)=>{
      const x0=baseX+BigInt(cellX),z0=baseZ+BigInt(cellZ);
      const t00=terrainVariationAtVertex(x0,z0,surfaceType).tint;
      const t10=terrainVariationAtVertex(x0+1n,z0,surfaceType).tint;
      const t01=terrainVariationAtVertex(x0,z0+1n,surfaceType).tint;
      const t11=terrainVariationAtVertex(x0+1n,z0+1n,surfaceType).tint;
      const out=[];
      for(let i=0;i<3;i++){
        const a=t00[i]+(t10[i]-t00[i])*fx;
        const c=t01[i]+(t11[i]-t01[i])*fx;
        out.push(a+(c-a)*fz);
      }
      return [out[0],out[1],out[2],1];
    };
    const sampleVertex=(wx,wz)=>{
      const key=String(wx)+","+String(wz);
      if(localSamples.has(key))return localSamples.get(key);
      const sample=terrainHeightVertex(seed,wx,wz);
      localSamples.set(key,sample);
      return sample;
    };
    const coarseStride=heightSegments+1;
    const coarseGrid=new Array(coarseStride*coarseStride);
    for(let gz=0;gz<=heightSegments;gz++){
      for(let gx=0;gx<=heightSegments;gx++){
        const wx=baseX+BigInt(gx*heightStep),wz=baseZ+BigInt(gz*heightStep);
        const sample=sampleVertex(wx,wz);
        const left=sampleVertex(wx-BigInt(heightStep),wz).height;
        const right=sampleVertex(wx+BigInt(heightStep),wz).height;
        const up=sampleVertex(wx,wz-BigInt(heightStep)).height;
        const down=sampleVertex(wx,wz+BigInt(heightStep)).height;
        const dx=(right-left)/(2*heightStep*metersPerTile),dz=(down-up)/(2*heightStep*metersPerTile);
        const nx=-dx,ny=1,nz=-dz,normLen=Math.hypot(nx,ny,nz)||1;
        coarseGrid[gz*coarseStride+gx]=Object.freeze({
          wx,wz,
          position:Object.freeze([gx*heightStep*metersPerTile-half,sample.height,gz*heightStep*metersPerTile-half]),
          normal:Object.freeze([nx/normLen,ny/normLen,nz/normLen]),
          sample
        });
        minHeight=Math.min(minHeight,sample.height);maxHeight=Math.max(maxHeight,sample.height);
        minElevation=Math.min(minElevation,sample.elevationMeters);maxElevation=Math.max(maxElevation,sample.elevationMeters);
        if(sample.landform){
          const lf=sample.landform;
          landformClassCounts[lf.kind]=(landformClassCounts[lf.kind]||0)+1;
          landformGradientMin=Math.min(landformGradientMin,Number(lf.gradientMetersPerTile||0));
          landformGradientMax=Math.max(landformGradientMax,Number(lf.gradientMetersPerTile||0));
          landformReliefMin=Math.min(landformReliefMin,Number(lf.localReliefMeters||0));
          landformReliefMax=Math.max(landformReliefMax,Number(lf.localReliefMeters||0));
          landformConditionOffsetMin=Math.min(landformConditionOffsetMin,Number(lf.conditionOffset||0));
          landformConditionOffsetMax=Math.max(landformConditionOffsetMax,Number(lf.conditionOffset||0));
          if(lf.kind!=="plain"&&landformSamples.length<32)landformSamples.push(lf);
        }
        if(sample.roadProfile?.active){
          const profile=sample.roadProfile;
          roadProfileVertexCount++;
          if(profile.core)roadProfileCoreVertexCount++;else roadProfileShoulderVertexCount++;
          if(profile.primaryType==="road"){
            roadProfileRoadVertexCount++;
            if(profile.core){
              minRoadCoreDelta=Math.min(minRoadCoreDelta,Number(profile.delta||0));
              maxRoadCoreDelta=Math.max(maxRoadCoreDelta,Number(profile.delta||0));
            }
          }else if(profile.primaryType==="path")roadProfilePathVertexCount++;
          else if(profile.primaryType==="square")roadProfileSquareVertexCount++;
          minRoadProfileDelta=Math.min(minRoadProfileDelta,Number(profile.delta||0));
          maxRoadProfileDelta=Math.max(maxRoadProfileDelta,Number(profile.delta||0));
        }
      }
    }
    const coarseAt=(gx,gz)=>coarseGrid[Math.max(0,Math.min(heightSegments,gz))*coarseStride+Math.max(0,Math.min(heightSegments,gx))];
    const fineVertex=(tileX,tileZ)=>{
      const qx=tileX/heightStep,qz=tileZ/heightStep;
      const x0=Math.min(heightSegments-1,Math.max(0,Math.floor(qx)));
      const z0=Math.min(heightSegments-1,Math.max(0,Math.floor(qz)));
      const tx=Math.max(0,Math.min(1,qx-x0)),tz=Math.max(0,Math.min(1,qz-z0));
      const a=coarseAt(x0,z0),b=coarseAt(x0+1,z0),c=coarseAt(x0,z0+1),d=coarseAt(x0+1,z0+1);
      let y,nx,ny,nz,elevation;
      // Match the same two-triangle interpolation used by terrainHeightAtTile.
      if(tx+tz<=1){
        y=a.sample.height+tx*(b.sample.height-a.sample.height)+tz*(c.sample.height-a.sample.height);
        nx=a.normal[0]+tx*(b.normal[0]-a.normal[0])+tz*(c.normal[0]-a.normal[0]);
        ny=a.normal[1]+tx*(b.normal[1]-a.normal[1])+tz*(c.normal[1]-a.normal[1]);
        nz=a.normal[2]+tx*(b.normal[2]-a.normal[2])+tz*(c.normal[2]-a.normal[2]);
        elevation=a.sample.elevationMeters+tx*(b.sample.elevationMeters-a.sample.elevationMeters)+tz*(c.sample.elevationMeters-a.sample.elevationMeters);
      }else{
        y=d.sample.height+(1-tz)*(b.sample.height-d.sample.height)+(1-tx)*(c.sample.height-d.sample.height);
        nx=d.normal[0]+(1-tz)*(b.normal[0]-d.normal[0])+(1-tx)*(c.normal[0]-d.normal[0]);
        ny=d.normal[1]+(1-tz)*(b.normal[1]-d.normal[1])+(1-tx)*(c.normal[1]-d.normal[1]);
        nz=d.normal[2]+(1-tz)*(b.normal[2]-d.normal[2])+(1-tx)*(c.normal[2]-d.normal[2]);
        elevation=d.sample.elevationMeters+(1-tz)*(b.sample.elevationMeters-d.sample.elevationMeters)+(1-tx)*(c.sample.elevationMeters-d.sample.elevationMeters);
      }
      const nlen=Math.hypot(nx,ny,nz)||1;
      return Object.freeze({
        wx:baseX+BigInt(tileX),wz:baseZ+BigInt(tileZ),
        position:Object.freeze([tileX*metersPerTile-half,y,tileZ*metersPerTile-half]),
        normal:Object.freeze([nx/nlen,ny/nlen,nz/nlen]),
        sample:Object.freeze({height:y,elevationMeters:elevation})
      });
    };
    const stride=segments+1;
    const grid=new Array(stride*stride);
    for(let gz=0;gz<=segments;gz++)for(let gx=0;gx<=segments;gx++)grid[gz*stride+gx]=fineVertex(gx,gz);
    const borderHeights=Object.freeze({
      north:Object.freeze(Array.from({length:stride},(_,i)=>grid[i].sample.height)),
      south:Object.freeze(Array.from({length:stride},(_,i)=>grid[segments*stride+i].sample.height)),
      west:Object.freeze(Array.from({length:stride},(_,i)=>grid[i*stride].sample.height)),
      east:Object.freeze(Array.from({length:stride},(_,i)=>grid[i*stride+segments].sample.height))
    });
    for(let gz=0;gz<segments;gz++){
      for(let gx=0;gx<segments;gx++){
        const sourceCell=spec.worldData?.cells?.[gz*size+gx]||null;
        const surfaceType=semanticSurfaceType(sourceCell?.type||grid[gz*stride+gx].sample.type);
        semanticSurfaceTileCounts[surfaceType]=(semanticSurfaceTileCounts[surfaceType]||0)+1;
        const rawCorners=[
          grid[gz*stride+gx],
          grid[gz*stride+gx+1],
          grid[(gz+1)*stride+gx],
          grid[(gz+1)*stride+gx+1]
        ];
        const cellWorldX=baseX+BigInt(gx),cellWorldZ=baseZ+BigInt(gz);
        const cellHydrology=(surfaceType==="water"||surfaceType==="bridge")
          ?hydrologyAtTile(seed,String(cellWorldX),String(cellWorldZ))
          :null;
        const bridgeOverWater=Boolean(
          surfaceType==="bridge"&&cellHydrology?.active&&cellHydrology?.bridgeUnderlyingWater===true
        );
        const baseVisualType=bridgeOverWater?"water":surfaceType;
        const rect=semanticAtlasReady?(activeAtlas?.meshUvRect?.(baseVisualType)||activeAtlas?.uvRect?.(baseVisualType)):null;
        if(rect){texturedBlockCount++;texturedSurfaceTypes.add(baseVisualType);}
        else{colorFallbackBlockCount++;fallbackSurfaceTypes.add(baseVisualType);}
        if(surfaceType==="water"&&cellHydrology?.active){
          hydrologyWaterCellCount++;
          const surface=Number(cellHydrology.waterSurfaceHeight),bed=Number(cellHydrology.bedHeight);
          hydrologyWaterSurfaceMin=Math.min(hydrologyWaterSurfaceMin,surface);
          hydrologyWaterSurfaceMax=Math.max(hydrologyWaterSurfaceMax,surface);
          hydrologyBedMin=Math.min(hydrologyBedMin,bed);
          hydrologyBedMax=Math.max(hydrologyBedMax,bed);
          hydrologyBankMin=Math.min(hydrologyBankMin,Number(cellHydrology.bankMinHeight));
          hydrologyBankMax=Math.max(hydrologyBankMax,Number(cellHydrology.bankMaxHeight));
          hydrologyWaterBelowBank=hydrologyWaterBelowBank&&surface<Number(cellHydrology.bankMinHeight);
          hydrologyBedBelowWater=hydrologyBedBelowWater&&bed<surface;
          hydrologyKindCounts[cellHydrology.bodyKind]=(hydrologyKindCounts[cellHydrology.bodyKind]||0)+1;
          if(hydrologySamples.length<24)hydrologySamples.push(Object.freeze({
            x:String(cellWorldX),y:String(cellWorldZ),type:"water",
            bodyKind:cellHydrology.bodyKind,bodyId:cellHydrology.bodyId,
            waterSurfaceHeight:surface,bedHeight:bed,
            bankMinHeight:Number(cellHydrology.bankMinHeight),bankMaxHeight:Number(cellHydrology.bankMaxHeight),
            transitionWidthTiles:Number(cellHydrology.bankTransitionWidthTiles)
          }));
        }else if(surfaceType==="bridge"&&cellHydrology?.active){
          hydrologyBridgeCellCount++;
          const clearance=Number(cellHydrology.bridgeClearance||0);
          hydrologyBridgeClearanceMin=Math.min(hydrologyBridgeClearanceMin,clearance);
          hydrologyBridgeClearanceMax=Math.max(hydrologyBridgeClearanceMax,clearance);
          hydrologyBridgeClearsWater=hydrologyBridgeClearsWater&&clearance>=HEIGHTFIELD_BRIDGE_CLEARANCE-1e-6;
          if(bridgeOverWater)hydrologyBridgeWaterUnderlayCellCount++;
          if(hydrologySamples.length<24)hydrologySamples.push(Object.freeze({
            x:String(cellWorldX),y:String(cellWorldZ),type:"bridge",
            waterSurfaceHeight:Number(cellHydrology.waterSurfaceHeight),
            bridgeDeckHeight:Number(cellHydrology.bridgeDeckHeight),
            bridgeClearance:clearance,
            bridgeUnderlyingWater:Boolean(cellHydrology.bridgeUnderlyingWater),
            waterUnderlayVisible:bridgeOverWater,
            orientation:bridgeDeckOrientation(seed,cellWorldX,cellWorldZ)
          }));
        }
        const corners=rawCorners.map(corner=>{
          let y=corner.position[1],normal=corner.normal;
          if(surfaceType==="water"||bridgeOverWater){
            y=waterSurfaceAtVertex(seed,corner.wx,corner.wz);
            normal=Object.freeze([0,1,0]);
          }else if(surfaceType==="bridge"&&cellHydrology?.bridgeDeckHeight!==null){
            y=Number(cellHydrology.bridgeDeckHeight);
            normal=Object.freeze([0,1,0]);
          }
          return Object.freeze({...corner,position:Object.freeze([corner.position[0],y,corner.position[2]]),normal});
        });
        const base=positions.length/3;
        for(const corner of corners){
          positions.push(...corner.position);
          normals.push(...corner.normal);
          const variation=terrainVariationAtVertex(corner.wx,corner.wz,baseVisualType);
          if(rect){
            appendColor32(colors32,variation.tint,1);
          }else{
            const fallback=heightfieldColor(seed,corner.wx,corner.wz,sourceCell?.color,baseVisualType);
            appendColor32(colors32,[
              fallback[0]*variation.tint[0],
              fallback[1]*variation.tint[1],
              fallback[2]*variation.tint[2],
              1
            ],1);
          }
          detailUvs.push(Number(corner.wx)*0.25,Number(corner.wz)*0.25);
        }
        if(rect){
          uvs.push(
            Number(rect.u0),Number(rect.v0),
            Number(rect.u1),Number(rect.v0),
            Number(rect.u0),Number(rect.v1),
            Number(rect.u1),Number(rect.v1)
          );
        }else{
          uvs.push(0,0,1,0,0,1,1,1);
        }
        indices.push(base,base+2,base+1, base+1,base+2,base+3);

        // Sparse same-mesh cliff skirts give genuinely steep authoritative
        // landforms a readable vertical face. One dominant downhill face is
        // allowed per cliff cell, capped per chunk; no object-per-tile entity,
        // material or draw call is created.
        if(
          landformCliffFaceCount<LANDFORM_CLIFF_FACE_MAX_PER_CHUNK &&
          TERRAIN_VARIATION_NATURAL_TYPES.has(surfaceType) &&
          surfaceType!=="water" &&
          surfaceType!=="bridge"
        ){
          const cliff=landformAtTile(seed,cellWorldX,cellWorldZ);
          if(
            cliff.kind==="cliff" &&
            Number(cliff.cliffSignal||0)>=LANDFORM_CLIFF_FACE_MIN_SIGNAL &&
            Number(cliff.localReliefMeters||0)>=LANDFORM_CLIFF_FACE_MIN_RELIEF_METERS
          ){
            const gxGrad=Number(cliff.gradientX||0),gzGrad=Number(cliff.gradientY||0);
            let edge;
            if(Math.abs(gxGrad)>=Math.abs(gzGrad)){
              edge=gxGrad>=0
                ?{a:0,b:2,ia:1,ib:3,normal:[-1,0,0],flip:true}
                :{a:1,b:3,ia:0,ib:2,normal:[1,0,0],flip:false};
            }else{
              edge=gzGrad>=0
                ?{a:0,b:1,ia:2,ib:3,normal:[0,0,-1],flip:false}
                :{a:2,b:3,ia:0,ib:1,normal:[0,0,1],flip:true};
            }
            const topA=corners[edge.a].position,topB=corners[edge.b].position;
            const innerA=corners[edge.ia].position,innerB=corners[edge.ib].position;
            const lerp=(a,b,t)=>Number(a)+(Number(b)-Number(a))*t;
            const breakT=clamp(LANDFORM_CLIFF_LIP_INSET/metersPerTile,0.32,0.58);
            const breakRise=clamp(
              LANDFORM_CLIFF_BREAK_RISE_MIN+
              Number(cliff.cliffSignal||0)*0.42+
              Number(cliff.localReliefMeters||0)/1200,
              LANDFORM_CLIFF_BREAK_RISE_MIN,
              LANDFORM_CLIFF_BREAK_RISE_MAX
            );
            const breakA=[
              lerp(topA[0],innerA[0],breakT),
              lerp(topA[1],innerA[1],breakT)+breakRise,
              lerp(topA[2],innerA[2],breakT)
            ];
            const breakB=[
              lerp(topB[0],innerB[0],breakT),
              lerp(topB[1],innerB[1],breakT)+breakRise,
              lerp(topB[2],innerB[2],breakT)
            ];
            const faceHeight=clamp(
              LANDFORM_CLIFF_FACE_MIN_HEIGHT+
              Number(cliff.cliffSignal||0)*0.95+
              Number(cliff.localReliefMeters||0)/520,
              LANDFORM_CLIFF_FACE_MIN_HEIGHT,
              LANDFORM_CLIFF_FACE_MAX_HEIGHT
            );
            const offset=0.035;
            const apronDepth=clamp(
              LANDFORM_CLIFF_FACE_APRON_MIN+
              Number(cliff.cliffSignal||0)*0.34+
              Number(cliff.localReliefMeters||0)/1500,
              LANDFORM_CLIFF_FACE_APRON_MIN,
              LANDFORM_CLIFF_FACE_APRON_MAX
            );
            const topOx=edge.normal[0]*offset,topOz=edge.normal[2]*offset;
            const bottomOx=edge.normal[0]*apronDepth,bottomOz=edge.normal[2]*apronDepth;
            const cliffBase=positions.length/3;
            positions.push(
              Number(breakA[0])+topOx,Number(breakA[1])+0.018,Number(breakA[2])+topOz,
              Number(breakB[0])+topOx,Number(breakB[1])+0.018,Number(breakB[2])+topOz,
              Number(topA[0])+bottomOx,Number(topA[1])-faceHeight*0.45,Number(topA[2])+bottomOz,
              Number(topB[0])+bottomOx,Number(topB[1])-faceHeight*0.45,Number(topB[2])+bottomOz
            );
            const faceNx=edge.normal[0],faceNy=0.34,faceNz=edge.normal[2];
            const faceNorm=Math.hypot(faceNx,faceNy,faceNz)||1;
            for(let i=0;i<4;i++)normals.push(faceNx/faceNorm,faceNy/faceNorm,faceNz/faceNorm);
            const rockRect=semanticAtlasReady?(activeAtlas?.meshUvRect?.("rock")||activeAtlas?.uvRect?.("rock")):null;
            const rockTint=terrainVariationAtVertex(cellWorldX,cellWorldZ,"rock").tint;
            const cliffTint=[
              clamp(rockTint[0]*0.70,0.42,0.78),
              clamp(rockTint[1]*0.72,0.42,0.78),
              clamp(rockTint[2]*0.74,0.42,0.78),
              1
            ];
            for(let i=0;i<4;i++)appendColor32(colors32,cliffTint,1);
            if(rockRect){
              uvs.push(
                Number(rockRect.u0),Number(rockRect.v0),
                Number(rockRect.u1),Number(rockRect.v0),
                Number(rockRect.u0),Number(rockRect.v1),
                Number(rockRect.u1),Number(rockRect.v1)
              );
              texturedSurfaceTypes.add("rock");
            }else{
              uvs.push(0,0,1,0,0,1,1,1);
              fallbackSurfaceTypes.add("rock");
            }
            for(let i=0;i<4;i++)detailUvs.push(Number(cellWorldX)*0.25,Number(cellWorldZ)*0.25);
            if(edge.flip){
              indices.push(cliffBase,cliffBase+2,cliffBase+1, cliffBase+1,cliffBase+2,cliffBase+3);
            }else{
              indices.push(cliffBase,cliffBase+1,cliffBase+2, cliffBase+1,cliffBase+3,cliffBase+2);
            }

            // A broad raised rock shelf changes the visible top-surface profile
            // inside the cliff cell while preserving the authoritative cell
            // boundaries exactly. The raised inner edge exposes a real face from
            // the normal gameplay camera instead of drawing a stripe on the sheet.
            const lipBase=positions.length/3;
            positions.push(
              Number(topA[0]),Number(topA[1])+0.036,Number(topA[2]),
              Number(topB[0]),Number(topB[1])+0.036,Number(topB[2]),
              Number(breakA[0]),Number(breakA[1])+0.036,Number(breakA[2]),
              Number(breakB[0]),Number(breakB[1])+0.036,Number(breakB[2])
            );
            for(let i=0;i<4;i++)normals.push(0,1,0);
            for(let i=0;i<4;i++)appendColor32(colors32,cliffTint,1);
            if(rockRect){
              uvs.push(
                Number(rockRect.u0),Number(rockRect.v0),
                Number(rockRect.u1),Number(rockRect.v0),
                Number(rockRect.u0),Number(rockRect.v1),
                Number(rockRect.u1),Number(rockRect.v1)
              );
            }else uvs.push(0,0,1,0,0,1,1,1);
            for(let i=0;i<4;i++)detailUvs.push(Number(cellWorldX)*0.25,Number(cellWorldZ)*0.25);
            indices.push(lipBase,lipBase+2,lipBase+1, lipBase+1,lipBase+2,lipBase+3);

            landformCliffFaceCount++;
            landformCliffFaceTriangleCount+=2;
            landformCliffLipCount++;
            landformCliffLipTriangleCount+=2;
          }
        }

        // Close only the exposed shoreline cut between the conditioned bank and
        // the depressed water surface. These restrained side faces stay in the
        // existing chunk mesh/material, so the basin reads as recessed terrain
        // without clear-color cracks or a second shoreline draw call.
        if(baseVisualType==="water"){
          const bankRect=semanticAtlasReady?(activeAtlas?.meshUvRect?.("dirt")||activeAtlas?.uvRect?.("dirt")):null;
          const bankEdges=[
            Object.freeze({dx:0,dz:-1,a:0,b:1,normal:[0,0,-1],flip:false}),
            Object.freeze({dx:1,dz:0,a:1,b:3,normal:[1,0,0],flip:false}),
            Object.freeze({dx:0,dz:1,a:2,b:3,normal:[0,0,1],flip:true}),
            Object.freeze({dx:-1,dz:0,a:0,b:2,normal:[-1,0,0],flip:true})
          ];
          for(const edge of bankEdges){
            const nx=cellWorldX+BigInt(edge.dx),nz=cellWorldZ+BigInt(edge.dz);
            const neighborType=terrainTypeAt(seed,nx,nz);
            if(hydrologyWaterReference(seed,nx,nz,neighborType))continue;
            const topA=rawCorners[edge.a].position,topB=rawCorners[edge.b].position;
            const bottomA=corners[edge.a].position,bottomB=corners[edge.b].position;
            const topAY=Math.max(Number(topA[1]),Number(bottomA[1])+0.006);
            const topBY=Math.max(Number(topB[1]),Number(bottomB[1])+0.006);
            const exposure=Math.max(topAY-Number(bottomA[1]),topBY-Number(bottomB[1]));
            if(exposure<=0.008)continue;
            const bankBase=positions.length/3;
            positions.push(
              Number(topA[0]),topAY,Number(topA[2]),
              Number(topB[0]),topBY,Number(topB[2]),
              Number(bottomA[0]),Number(bottomA[1]),Number(bottomA[2]),
              Number(bottomB[0]),Number(bottomB[1]),Number(bottomB[2])
            );
            for(let i=0;i<4;i++)normals.push(...edge.normal);
            const bankTint=terrainVariationAtVertex(cellWorldX,cellWorldZ,"dirt").tint;
            if(bankRect){
              for(let i=0;i<4;i++)appendColor32(colors32,bankTint,1);
              uvs.push(
                Number(bankRect.u0),Number(bankRect.v0),
                Number(bankRect.u1),Number(bankRect.v0),
                Number(bankRect.u0),Number(bankRect.v1),
                Number(bankRect.u1),Number(bankRect.v1)
              );
              texturedSurfaceTypes.add("dirt");
            }else{
              const earth=heightfieldColor(seed,cellWorldX,cellWorldZ,"#70533b","dirt");
              for(let i=0;i<4;i++)appendColor32(colors32,earth,1);
              uvs.push(0,0,1,0,0,1,1,1);
              fallbackSurfaceTypes.add("dirt");
            }
            for(let i=0;i<4;i++)detailUvs.push(Number(cellWorldX)*0.25,Number(cellWorldZ)*0.25);
            if(edge.flip){
              indices.push(bankBase,bankBase+2,bankBase+1, bankBase+1,bankBase+2,bankBase+3);
            }else{
              indices.push(bankBase,bankBase+1,bankBase+2, bankBase+1,bankBase+3,bankBase+2);
            }
            hydrologyBankFaceCount++;
            hydrologyBankFaceTriangleCount+=2;
          }
        }

        // A bridge over authoritative underlying water keeps the water surface
        // visible inside the tile and adds a narrower raised deck on top. Both
        // surfaces remain in the same chunk mesh/material and add no draw call.
        if(bridgeOverWater){
          const bridgeRect=semanticAtlasReady?(activeAtlas?.meshUvRect?.("bridge")||activeAtlas?.uvRect?.("bridge")):null;
          const deckY=Number(cellHydrology.bridgeDeckHeight);
          const orientation=bridgeDeckOrientation(seed,cellWorldX,cellWorldZ);
          const centerX=(gx+0.5)*metersPerTile-half,centerZ=(gz+0.5)*metersPerTile-half;
          const halfLength=metersPerTile*0.53,halfWidth=metersPerTile*0.31;
          const minX=centerX-(orientation==="horizontal"?halfLength:halfWidth);
          const maxX=centerX+(orientation==="horizontal"?halfLength:halfWidth);
          const minZ=centerZ-(orientation==="vertical"?halfLength:halfWidth);
          const maxZ=centerZ+(orientation==="vertical"?halfLength:halfWidth);
          const deckBase=positions.length/3;
          positions.push(
            minX,deckY,minZ,
            maxX,deckY,minZ,
            minX,deckY,maxZ,
            maxX,deckY,maxZ
          );
          for(let i=0;i<4;i++)normals.push(0,1,0);
          const deckVariation=terrainVariationAtVertex(cellWorldX,cellWorldZ,"bridge");
          if(bridgeRect){
            for(let i=0;i<4;i++)appendColor32(colors32,deckVariation.tint,1);
            uvs.push(
              Number(bridgeRect.u0),Number(bridgeRect.v0),
              Number(bridgeRect.u1),Number(bridgeRect.v0),
              Number(bridgeRect.u0),Number(bridgeRect.v1),
              Number(bridgeRect.u1),Number(bridgeRect.v1)
            );
            texturedSurfaceTypes.add("bridge");
          }else{
            const fallback=heightfieldColor(seed,cellWorldX,cellWorldZ,sourceCell?.color,"bridge");
            for(let i=0;i<4;i++)appendColor32(colors32,fallback,1);
            uvs.push(0,0,1,0,0,1,1,1);
            fallbackSurfaceTypes.add("bridge");
          }
          for(let i=0;i<4;i++)detailUvs.push(Number(cellWorldX)*0.25,Number(cellWorldZ)*0.25);
          indices.push(deckBase,deckBase+2,deckBase+1, deckBase+1,deckBase+2,deckBase+3);
          hydrologyBridgeDeckTriangleCount+=2;
        }
      }
    }

    // Tile-authoritative contour smoothing: categorical marching-corner patches.
    // A 2x2 junction with a 3:1 natural-surface majority receives one rounded
    // majority patch inside the minority cell. The authoritative tile center is
    // untouched; maximum visual deviation stays below half a logical tile.
    // Patches are appended to this same chunk mesh/material, so they add zero
    // terrain draw calls and zero terrain materials. A one-tile halo plus
    // canonical global-corner ownership keeps chunk edges deterministic.
    const contourStarted=performance.now();
    const baseSemanticVertexCount=positions.length/3;
    const baseSemanticTriangleCount=indices.length/3;
    const contourSemanticCache=new Map();
    const semanticTypeAtGlobal=(globalX,globalZ)=>{
      const key=String(globalX)+","+String(globalZ);
      if(contourSemanticCache.has(key))return contourSemanticCache.get(key);
      const lx=Number(globalX-baseX),lz=Number(globalZ-baseZ);
      let type;
      if(Number.isInteger(lx)&&Number.isInteger(lz)&&lx>=0&&lx<size&&lz>=0&&lz<size){
        const cell=spec.worldData?.cells?.[lz*size+lx]||null;
        type=semanticSurfaceType(cell?.type||"grass");
      }else{
        type=semanticSurfaceType(window.TerrainFoundation?.getTile?.(seed,String(globalX),String(globalZ))?.type||"grass");
      }
      contourSemanticCache.set(key,type);
      return type;
    };
    const appendContourPoint=(cellX,cellZ,pointX,pointZ,rect,surfaceType)=>{
      const fx=clamp(pointX-cellX,0,1),fz=clamp(pointZ-cellZ,0,1);
      const a=grid[cellZ*stride+cellX],b=grid[cellZ*stride+cellX+1];
      const c=grid[(cellZ+1)*stride+cellX],d=grid[(cellZ+1)*stride+cellX+1];
      let y,nx,ny,nz;
      if(fx+fz<=1){
        y=a.sample.height+fx*(b.sample.height-a.sample.height)+fz*(c.sample.height-a.sample.height);
        nx=a.normal[0]+fx*(b.normal[0]-a.normal[0])+fz*(c.normal[0]-a.normal[0]);
        ny=a.normal[1]+fx*(b.normal[1]-a.normal[1])+fz*(c.normal[1]-a.normal[1]);
        nz=a.normal[2]+fx*(b.normal[2]-a.normal[2])+fz*(c.normal[2]-a.normal[2]);
      }else{
        y=d.sample.height+(1-fz)*(b.sample.height-d.sample.height)+(1-fx)*(c.sample.height-d.sample.height);
        nx=d.normal[0]+(1-fz)*(b.normal[0]-d.normal[0])+(1-fx)*(c.normal[0]-d.normal[0]);
        ny=d.normal[1]+(1-fz)*(b.normal[1]-d.normal[1])+(1-fx)*(c.normal[1]-d.normal[1]);
        nz=d.normal[2]+(1-fz)*(b.normal[2]-d.normal[2])+(1-fx)*(c.normal[2]-d.normal[2]);
      }
      const nlen=Math.hypot(nx,ny,nz)||1;
      positions.push(pointX*metersPerTile-half,y+CONTOUR_Y_OFFSET,pointZ*metersPerTile-half);
      normals.push(nx/nlen,ny/nlen,nz/nlen);
      appendColor32(colors32,terrainVariationTintAtCellPoint(cellX,cellZ,fx,fz,surfaceType),1);
      uvs.push(
        Number(rect.u0)+(Number(rect.u1)-Number(rect.u0))*fx,
        Number(rect.v0)+(Number(rect.v1)-Number(rect.v0))*fz
      );
      detailUvs.push((Number(baseX)+pointX)*0.25,(Number(baseZ)+pointZ)*0.25);
      contourVertexCount++;
      return positions.length/3-1;
    };
    const quadrantInfo=[
      Object.freeze({cellDx:-1,cellDz:-1,start:Math.PI,end:Math.PI*1.5}),
      Object.freeze({cellDx:0,cellDz:-1,start:Math.PI*1.5,end:Math.PI*2}),
      Object.freeze({cellDx:-1,cellDz:0,start:Math.PI*0.5,end:Math.PI}),
      Object.freeze({cellDx:0,cellDz:0,start:0,end:Math.PI*0.5})
    ];
    // Local corners [0,size) are the canonical ownership domain for this
    // chunk; east/south boundary corners belong to the adjacent chunk.
    for(let cornerZ=0;cornerZ<size;cornerZ++){
      for(let cornerX=0;cornerX<size;cornerX++){
        const globalCornerX=baseX+BigInt(cornerX),globalCornerZ=baseZ+BigInt(cornerZ);
        const cells=[
          [globalCornerX-1n,globalCornerZ-1n],
          [globalCornerX,globalCornerZ-1n],
          [globalCornerX-1n,globalCornerZ],
          [globalCornerX,globalCornerZ]
        ];
        const types=cells.map(([x,z])=>semanticTypeAtGlobal(x,z));
        const counts=new Map();
        for(const type of types)counts.set(type,(counts.get(type)||0)+1);
        if(counts.size!==2)continue;
        const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
        if(ranked[0][1]!==3||ranked[1][1]!==1)continue;
        const majority=ranked[0][0],minority=ranked[1][0];
        if(!CONTOUR_SMOOTHABLE_TYPES.has(majority)||!CONTOUR_SMOOTHABLE_TYPES.has(minority))continue;
        const minorityIndex=types.indexOf(minority),q=quadrantInfo[minorityIndex];
        const localCellX=cornerX+q.cellDx,localCellZ=cornerZ+q.cellDz;
        if(localCellX<0||localCellX>=size||localCellZ<0||localCellZ>=size)continue;
        const rect=semanticAtlasReady?(activeAtlas?.meshUvRect?.(majority)||activeAtlas?.uvRect?.(majority)):null;
        if(!rect)continue;
        const centerIndex=appendContourPoint(localCellX,localCellZ,cornerX,cornerZ,rect,majority);
        let previous=null;
        for(let segment=0;segment<=CONTOUR_ARC_SEGMENTS;segment++){
          const t=segment/CONTOUR_ARC_SEGMENTS;
          const angle=q.start+(q.end-q.start)*t;
          const px=cornerX+Math.cos(angle)*CONTOUR_ROUND_RADIUS_TILES;
          const pz=cornerZ+Math.sin(angle)*CONTOUR_ROUND_RADIUS_TILES;
          const current=appendContourPoint(localCellX,localCellZ,px,pz,rect,majority);
          if(previous!==null){
            // Reverse the increasing x/z arc winding so the patch faces +Y.
            indices.push(centerIndex,current,previous);
            contourTriangleCount++;
          }
          previous=current;
        }
        contourPatchCount++;
        const pair=majority+">"+minority;
        contourPairCounts[pair]=(contourPairCounts[pair]||0)+1;
        if(cornerX===0||cornerZ===0)contourSharedEdgeKeys.push(String(globalCornerX)+","+String(globalCornerZ)+":"+pair);
      }
    }
    contourBuildMs=performance.now()-contourStarted;

    const mesh=new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setColors32(colors32);
    mesh.setUvs(0,uvs);
    mesh.setUvs(1,detailUvs);
    mesh.setIndices(indices);
    mesh.update();
    const entity=new pc.Entity("TerrainChunkMesh_"+spec.x+"_"+spec.y);
    entity.addComponent("render",{type:"asset",castShadows:false,receiveShadows:false});
    const meshInstance=new pc.MeshInstance(mesh,material,entity);
    meshInstance.cull=true;
    entity.render.meshInstances=[meshInstance];
    parent.addChild(entity);
    entity.enabled=false;
    frustumCulledMeshInstances++;

    const presentation=spec.worldData?.presentation||{};
    const buildings=Array.isArray(presentation.buildingDescriptors)?presentation.buildingDescriptors:[];
    const props=Array.isArray(presentation.propDescriptors)?presentation.propDescriptors:[];
    const interiorObjects=Array.isArray(presentation.interiorObjectDescriptors)?presentation.interiorObjectDescriptors:[];
    const connectorDescriptors=Array.isArray(presentation.connectorDescriptors)?presentation.connectorDescriptors:[];
    const batches=staticBatchCollector();
    const roofProfiles=[];
    const buildingMaterialVariants=[];
    const entranceTreatmentSamples=[];
    const entranceCounters={total:0,ordinary:0,special:0,threshold:0,frame:0,wear:0,awning:0,sign:0,primitives:0};
    const landmarkSamples=[];
    const landmarkCounters={total:0,primitives:0,treatments:{},contexts:{}};
    let sourcePresentationPrimitiveCount=0;
    for(let i=0;i<buildings.length;i++)sourcePresentationPrimitiveCount+=buildBuilding(entity,spec.worldData,buildings[i],i,batches,roofProfiles,buildingMaterialVariants,entranceTreatmentSamples,entranceCounters,landmarkSamples,landmarkCounters);
    for(let i=0;i<interiorObjects.length;i++)sourcePresentationPrimitiveCount+=buildInteriorObject(spec.worldData,interiorObjects[i],batches);
    const routePresentation=buildRoutePresentation(spec.worldData,connectorDescriptors,batches);
    sourcePresentationPrimitiveCount+=routePresentation.sourcePrimitiveCount;

    const staticBatches=finalizeStaticBatches(entity,batches);
    const ambientBuildings=collectAmbientBuildingInstances(spec.worldData,buildings,roofProfiles);

    const treeVariants=[[],[]],rocks=[],treeVariationSamples=[],dressingSamples=[];
    const dressingGroups={woodBoxes:[],darkBoxes:[],foliage:[],accent:[],stone:[],soil:[],cloth:[],darkSpheres:[]};
    for(let i=0;i<props.length;i++)sourcePresentationPrimitiveCount+=collectPropInstances(spec.worldData,props[i],treeVariants,rocks,treeVariationSamples,dressingGroups,dressingSamples);
    const contactShadowInstances=[];
    for(const variants of treeVariants){
      for(const item of variants){
        const width=Math.abs(Number(item.scale?.[0]||1));
        contactShadowInstances.push({
          position:[Number(item.position?.[0]||0),Number(item.position?.[1]||0)-0.037,Number(item.position?.[2]||0)],
          scale:[Math.max(0.82,width*0.36),1,Math.max(0.52,width*0.22)],
          euler:[0,0,0],
          contactKind:"tree"
        });
      }
    }
    for(const item of rocks){
      contactShadowInstances.push({
        position:[Number(item.position?.[0]||0),Number(item.position?.[1]||0)-0.322,Number(item.position?.[2]||0)],
        scale:[0.74,1,0.50],euler:[0,0,0],contactKind:"rock"
      });
    }
    const majorContactSemantics=new Set(["well","cart","bench","work-prop","woodpile","crate","barrel"]);
    for(const descriptor of props){
      if(String(descriptor?.type||"")!=="dressing"||!majorContactSemantics.has(String(descriptor?.semantic||"")))continue;
      const p=localTileCenter(spec.worldData,descriptor.x,descriptor.y);
      const groundY=terrainHeightAtTile(seed,descriptor.x,descriptor.y,spec.worldData?.chunkSize||16);
      const scale=String(descriptor.semantic)==="cart"?[1.25,1,0.74]:
        String(descriptor.semantic)==="well"?[1.05,1,1.05]:
        String(descriptor.semantic)==="bench"?[1.05,1,0.58]:[0.86,1,0.64];
      contactShadowInstances.push({position:[p.x,groundY+0.018,p.z],scale,euler:[0,Number(descriptor.rotation||0),0],contactKind:"prop"});
    }
    const treeGroups=[
      createInstancedGroup(entity,"ChunkTrees_Variant0",primitiveMesh("tree-plane"),treeSpriteMaterial(0),treeVariants[0]),
      createInstancedGroup(entity,"ChunkTrees_Variant1",primitiveMesh("tree-plane"),treeSpriteMaterial(1),treeVariants[1])
    ].filter(Boolean);
    for(const group of treeGroups)group.ambientKind="tree";
    const smokeGroup=createInstancedGroup(entity,"ChunkAmbientSmoke",primitiveMesh("sphere"),ambientMaterial("smoke",0.72,0.72,0.69,0.46),ambientBuildings.smoke);
    if(smokeGroup)smokeGroup.ambientKind="smoke";
    const pennantGroup=createInstancedGroup(entity,"ChunkAmbientPennants",primitiveMesh("pennant-plane"),ambientMaterial("pennant",0.95,0.42,0.08,1),ambientBuildings.pennants);
    if(pennantGroup)pennantGroup.ambientKind="pennant";
    const ambientGroups=[smokeGroup,pennantGroup].filter(Boolean);
    const dressingInstancedGroups=[
      createInstancedGroup(entity,"ChunkDressing_Wood",primitiveMesh("box"),presentationMaterial("dressing-wood",0.54,0.34,0.16,0.08),dressingGroups.woodBoxes),
      createInstancedGroup(entity,"ChunkDressing_DarkWood",primitiveMesh("box"),presentationMaterial("dressing-dark",0.24,0.15,0.09,0.05),dressingGroups.darkBoxes),
      createInstancedGroup(entity,"ChunkDressing_Foliage",primitiveMesh("sphere"),presentationMaterial("dressing-foliage",0.29,0.52,0.23,0.04),dressingGroups.foliage),
      createInstancedGroup(entity,"ChunkDressing_Accent",primitiveMesh("sphere"),presentationMaterial("dressing-accent",0.86,0.56,0.20,0.03),dressingGroups.accent),
      createInstancedGroup(entity,"ChunkDressing_Stone",primitiveMesh("sphere"),presentationMaterial("dressing-stone",0.48,0.48,0.43,0.04),dressingGroups.stone),
      createInstancedGroup(entity,"ChunkDressing_Soil",primitiveMesh("box"),presentationMaterial("dressing-soil",0.38,0.24,0.13,0.02),dressingGroups.soil),
      createInstancedGroup(entity,"ChunkDressing_Cloth",primitiveMesh("sphere"),presentationMaterial("dressing-cloth",0.67,0.54,0.33,0.03),dressingGroups.cloth),
      createInstancedGroup(entity,"ChunkDressing_Wheels",primitiveMesh("sphere"),presentationMaterial("dressing-wheel",0.18,0.13,0.09,0.02),dressingGroups.darkSpheres)
    ].filter(Boolean);
    const contactShadowGroup=createInstancedGroup(
      entity,
      "ChunkGroundContacts",
      primitiveMesh("contact-disc"),
      contactShadowMaterial("object"),
      contactShadowInstances
    );
    const instancedGroups=[
      ...treeGroups,
      ...ambientGroups,
      ...dressingInstancedGroups,
      createInstancedGroup(entity,"ChunkRocks",primitiveMesh("rock"),presentationMaterial("rock",0.39,0.40,0.37),rocks),
      contactShadowGroup
    ].filter(Boolean);

    const roofPrimitiveCount=buildings.length*2;
    const staticBatchCount=staticBatches.length;
    const instancedGroupCount=instancedGroups.length;
    const optimizedPresentationDrawCalls=roofPrimitiveCount+staticBatchCount+instancedGroupCount;
    const unoptimizedPresentationDrawCalls=sourcePresentationPrimitiveCount;
    const presentationMeshInstanceCount=optimizedPresentationDrawCalls;
    const presentationEntityCount=roofPrimitiveCount+staticBatchCount+instancedGroupCount;
    const sourcePresentationEntityCount=unoptimizedPresentationDrawCalls;
    const savedDrawCalls=Math.max(0,unoptimizedPresentationDrawCalls-optimizedPresentationDrawCalls);

    const surfaceCounts=spec.worldData?.terrain?.surfaceCounts||{};
    const buildMs=performance.now()-started;
    creations++;totalBuildMs+=buildMs;maxBuildMs=Math.max(maxBuildMs,buildMs);
    return {
      entity,mesh,meshInstance,staticBatches,instancedGroups,treeGroups,ambientGroups,
      x:Number(spec.x),y:Number(spec.y),chunkSize:size,signature:String(spec.signature||""),
      ambientMotionEnabled:true,
      ambientMotionStrategy:"throttled-shared-instance-buffer",
      ambientTreeCount:treeVariants[0].length+treeVariants[1].length,
      ambientSmokeEmitterCount:Number(ambientBuildings.smokeEmitterCount||0),
      ambientSmokePuffCount:ambientBuildings.smoke.length,
      ambientPennantCount:ambientBuildings.pennants.length,
      ambientEffectTypeCount:(treeVariants[0].length+treeVariants[1].length>0?1:0)+(ambientBuildings.smoke.length>0?1:0)+(ambientBuildings.pennants.length>0?1:0),
      ambientActiveEffectTypeCount:0,
      ambientAddedDrawCalls:ambientGroups.length,
      ambientParticleEmitterCount:0,
      ambientAnimatedMaterialShaderCount:0,
      ambientContextAware:true,
      ambientRendererOnly:true,
      ambientNavigationAuthority:false,
      ambientCollisionAuthority:false,
      ambientSimulationAuthorityPreserved:true,
      ambientQuality:String(ambientQuality().level),
      ambientZoom:1,
      ambientLodSimplified:false,
      ambientUpdateIntervalMs:Math.round(ambientQuality().interval*1000),
      ambientUpdateCount:0,ambientBufferUpdateCount:0,ambientLastCpuUpdateMs:0,ambientMaxCpuUpdateMs:0,
      ambientLastUpdateTime:-Infinity,
      segments,
      heightfieldGridResolution:heightSegments+1,
      heightfieldStepTiles:heightStep,
      semanticGridResolution:segments+1,
      semanticStepTiles:1,
      indexedSharedVertices:false,
      indexedSemanticQuads:true,
      semanticUvChannel:0,
      normalDetailUvChannel:1,
      semanticSurfaceTileCount:size*size,
      semanticSurfaceTileCounts:Object.freeze({...semanticSurfaceTileCounts}),
      contourAlgorithm:"categorical-marching-corners-rounded-fan",
      contourPreparationOnly:true,
      contourHaloTiles:CONTOUR_HALO_TILES,
      contourRoundRadiusTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourRoundRadiusWorldUnits:Number((CONTOUR_ROUND_RADIUS_TILES*WORLD_TILE_METERS).toFixed(3)),
      contourArcSegments:CONTOUR_ARC_SEGMENTS,
      contourTransitionBandWidthTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourMaxBoundaryDeviationTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourMaxBoundaryDeviationWorldUnits:Number((CONTOUR_ROUND_RADIUS_TILES*WORLD_TILE_METERS).toFixed(3)),
      contourPatchCount,
      contourVertexCount,
      contourAddedTriangleCount:contourTriangleCount,
      contourBaseTriangleCount:baseSemanticTriangleCount,
      contourBaseVertexCount:baseSemanticVertexCount,
      contourBuildMs:Number(contourBuildMs.toFixed(3)),
      contourDrawCallsAdded:0,
      contourMaterialCountAdded:0,
      contourPerFrameRegenerationCount:0,
      contourCanonicalCornerOwnership:true,
      contourSharedEdgeKeys:Object.freeze(contourSharedEdgeKeys.slice()),
      contourSurfacePairCounts:Object.freeze({...contourPairCounts}),
      contourTileCentersPreserved:true,
      contourNarrowFeaturesPreserved:true,
      contourAlphaBlend:false,
      terrainVariationEnabled:true,
      terrainVariationStrategy:"global-coordinate vertex-color macro field + semantic proximity wear",
      terrainVariationMacroScaleTiles:Number(TERRAIN_VARIATION_MACRO_SCALE_TILES),
      terrainVariationContextRadiusTiles:TERRAIN_VARIATION_CONTEXT_RADIUS_TILES,
      terrainVariationEvaluatedVertexCount,
      terrainVariationTintedVertexCount,
      terrainVariationCategoryCounts:Object.freeze({...terrainVariationCategoryCounts}),
      terrainVariationSamples:Object.freeze([...terrainVariationSamplesByCategory.values()]),
      terrainVariationMinTintComponent:Number.isFinite(terrainVariationMinTintComponent)?Number(terrainVariationMinTintComponent.toFixed(4)):1,
      terrainVariationMaxTintComponent:Number.isFinite(terrainVariationMaxTintComponent)?Number(terrainVariationMaxTintComponent.toFixed(4)):1,
      terrainVariationDrawCallsAdded:0,
      terrainVariationMaterialsAdded:0,
      terrainVariationTexturesAdded:0,
      terrainVariationTrianglesAdded:0,
      terrainVariationGlobalCoordinateField:true,
      terrainVariationChunkBorderContinuous:true,
      terrainVariationSemanticEdgeFade:true,
      terrainVariationAuthorityQueriesAdded:0,
      terrainVariationContourCompatible:true,
      terrainVariationBaseSurfaceIdentityPreserved:true,
      terrainVariationVertexColorEncoding:"uint8-multiply-visible-range-0.55-1.00",
      terrainVariationDeterministic:true,
      terrainVariationRendererOnly:true,
      terrainVariationNavigationAuthority:false,
      terrainVariationCollisionAuthority:false,
      terrainVariationSimulationAuthorityPreserved:true,
      vertexCount:positions.length/3,
      triangleCount:indices.length/3,
      minConditionedHeight:Number(minHeight.toFixed(4)),
      maxConditionedHeight:Number(maxHeight.toFixed(4)),
      minSourceElevationMeters:Number(minElevation.toFixed(1)),
      maxSourceElevationMeters:Number(maxElevation.toFixed(1)),
      borderHeights,
      terrainGroundSampler:"indexed-triangle-exact",
      terrainHeightPreparedOnly:true,
      roadProfileEnabled:true,
      roadProfileMode:"shared-heightfield-smoothed-roadbed+bounded-shoulder",
      roadLiftWorldUnits:ROAD_PROFILE_LIFTS.road,
      pathLiftWorldUnits:ROAD_PROFILE_LIFTS.path,
      squareLiftWorldUnits:ROAD_PROFILE_LIFTS.square,
      roadShoulderCoreRadiusTiles:ROAD_PROFILE_CORE_RADIUS_TILES,
      roadShoulderBlendWidthTiles:ROAD_PROFILE_SHOULDER_WIDTH_TILES,
      roadShoulderBlendWidthWorldUnits:Number((ROAD_PROFILE_SHOULDER_WIDTH_TILES*WORLD_TILE_METERS).toFixed(3)),
      bridgeClearanceWorldUnits:HEIGHTFIELD_BRIDGE_CLEARANCE,
      roadProfileVertexCount,
      roadProfileCoreVertexCount,
      roadProfileShoulderVertexCount,
      roadProfileRoadVertexCount,
      roadProfilePathVertexCount,
      roadProfileSquareVertexCount,
      minRoadProfileDelta:Number.isFinite(minRoadProfileDelta)?Number(minRoadProfileDelta.toFixed(6)):0,
      maxRoadProfileDelta:Number.isFinite(maxRoadProfileDelta)?Number(maxRoadProfileDelta.toFixed(6)):0,
      minRoadCoreHeightDelta:Number.isFinite(minRoadCoreDelta)?Number(minRoadCoreDelta.toFixed(6)):0,
      maxRoadCoreHeightDelta:Number.isFinite(maxRoadCoreDelta)?Number(maxRoadCoreDelta.toFixed(6)):0,
      roadProfileGroundingShared:true,
      landformEnabled:true,
      landformVersion:LANDFORM_VERSION,
      landformSampleRadiusTiles:LANDFORM_SAMPLE_RADIUS_TILES,
      landformClassCounts:Object.freeze({...landformClassCounts}),
      landformSamples:Object.freeze(landformSamples.slice()),
      landformGradientMin:Number.isFinite(landformGradientMin)?Number(landformGradientMin.toFixed(4)):0,
      landformGradientMax:Number.isFinite(landformGradientMax)?Number(landformGradientMax.toFixed(4)):0,
      landformReliefMin:Number.isFinite(landformReliefMin)?Number(landformReliefMin.toFixed(2)):0,
      landformReliefMax:Number.isFinite(landformReliefMax)?Number(landformReliefMax.toFixed(2)):0,
      landformConditionOffsetMin:Number.isFinite(landformConditionOffsetMin)?Number(landformConditionOffsetMin.toFixed(6)):0,
      landformConditionOffsetMax:Number.isFinite(landformConditionOffsetMax)?Number(landformConditionOffsetMax.toFixed(6)):0,
      landformSteepFaceTreatment:"exaggerated-heightfield+raised-cliff-breaks",
      landformCliffFaceCount,landformCliffFaceTriangleCount,
      landformCliffLipCount,landformCliffLipTriangleCount,
      landformCliffLipInsetWorldUnits:LANDFORM_CLIFF_LIP_INSET,
      landformCliffFaceApronMinWorldUnits:LANDFORM_CLIFF_FACE_APRON_MIN,
      landformCliffFaceApronMaxWorldUnits:LANDFORM_CLIFF_FACE_APRON_MAX,
      landformTriangleBudgetPerChunk:LANDFORM_CLIFF_FACE_MAX_PER_CHUNK*4,
      landformDrawCallsAdded:0,
      landformTrianglesAdded:landformCliffFaceTriangleCount+landformCliffLipTriangleCount,
      landformMaterialsAdded:0,
      landformDeterministic:true,landformSeamSafeGlobalCoordinates:true,landformChunkPrepared:true,
      landformPerFrameRegenerationCount:0,landformRendererOnly:true,landformNavigationAuthority:false,
      landformCollisionAuthority:false,landformSimulationAuthorityPreserved:true,
      hydrologyEnabled:true,
      hydrologyVersion:HYDROLOGY_VERSION,
      hydrologyQueryRadiusTiles:HYDROLOGY_QUERY_RADIUS_TILES,
      hydrologyBankTransitionWidthTiles:HYDROLOGY_BANK_TRANSITION_TILES,
      hydrologyBankMinRiseWorldUnits:HYDROLOGY_BANK_MIN_RISE,
      hydrologyBedDepthWorldUnits:HYDROLOGY_BED_DEPTH,
      hydrologyWaterCellCount,
      hydrologyBridgeCellCount,
      hydrologyBridgeWaterUnderlayCellCount,
      hydrologyBridgeDeckTriangleCount,
      hydrologyBankFaceCount,
      hydrologyBankFaceTriangleCount,
      hydrologyBankFaceDrawCallsAdded:0,
      hydrologyBankFacesPrepared:hydrologyWaterCellCount===0||hydrologyBankFaceCount>0,
      hydrologyBridgeWaterUnderlayPass:Boolean(
        hydrologyBridgeCellCount===0||hydrologyBridgeWaterUnderlayCellCount===hydrologyBridgeCellCount
      ),
      hydrologyKindCounts:Object.freeze({...hydrologyKindCounts}),
      hydrologySamples:Object.freeze(hydrologySamples.slice()),
      hydrologyWaterSurfaceMin:Number.isFinite(hydrologyWaterSurfaceMin)?Number(hydrologyWaterSurfaceMin.toFixed(6)):null,
      hydrologyWaterSurfaceMax:Number.isFinite(hydrologyWaterSurfaceMax)?Number(hydrologyWaterSurfaceMax.toFixed(6)):null,
      hydrologyBedMin:Number.isFinite(hydrologyBedMin)?Number(hydrologyBedMin.toFixed(6)):null,
      hydrologyBedMax:Number.isFinite(hydrologyBedMax)?Number(hydrologyBedMax.toFixed(6)):null,
      hydrologyBankMin:Number.isFinite(hydrologyBankMin)?Number(hydrologyBankMin.toFixed(6)):null,
      hydrologyBankMax:Number.isFinite(hydrologyBankMax)?Number(hydrologyBankMax.toFixed(6)):null,
      hydrologyBridgeClearanceMin:Number.isFinite(hydrologyBridgeClearanceMin)?Number(hydrologyBridgeClearanceMin.toFixed(6)):null,
      hydrologyBridgeClearanceMax:Number.isFinite(hydrologyBridgeClearanceMax)?Number(hydrologyBridgeClearanceMax.toFixed(6)):null,
      hydrologyWaterBelowBank:Boolean(hydrologyWaterBelowBank),
      hydrologyBedBelowWater:Boolean(hydrologyBedBelowWater),
      hydrologyBridgeClearsWater:Boolean(hydrologyBridgeClearsWater),
      hydrologySeamSafeGlobalCoordinates:true,
      hydrologyChunkPrepared:true,
      hydrologyPerFrameRegenerationCount:0,
      hydrologyRendererOnly:true,
      hydrologyNavigationAuthority:false,
      hydrologyCollisionAuthority:false,
      hydrologyWaterIdentityChanged:false,
      visibleFrameTerrainRebuildCount:0,
      meshInstanceCount:1,
      materialCount:1,
      texturedBlockCount,colorFallbackBlockCount,
      texturedSurfaceTypes:Object.freeze([...texturedSurfaceTypes].sort()),
      fallbackSurfaceTypes:Object.freeze([...fallbackSurfaceTypes].sort()),
      terrainTextureAtlasReady:Boolean(activeAtlas?.stats?.()?.ready),
      terrainTextureAtlasSignature:String(activeAtlas?.stats?.()?.signature||""),
      terrainSurfaceDetailTextureReady:detailReady,
      terrainSemanticAtlasReady:semanticAtlasReady,
      terrainSurfaceMode:"semantic-atlas-per-logical-tile+uv1-normal-detail",
      presentationMeshInstanceCount,
      presentationEntityCount,
      sourcePresentationEntityCount,
      sourcePresentationPrimitiveCount,
      staticBatchCount,
      staticBatchSourcePrimitiveCount:staticBatches.reduce((sum,item)=>sum+item.sourcePrimitiveCount,0),
      instancedGroupCount,
      instancedObjectCount:treeVariants[0].length+treeVariants[1].length+rocks.length+Object.values(dressingGroups).reduce((sum,items)=>sum+items.length,0),
      dressingDescriptorCount:props.filter(item=>String(item.type||"")==="dressing").length,
      dressingPrimitiveInstanceCount:Object.values(dressingGroups).reduce((sum,items)=>sum+items.length,0),
      dressingInstancedGroupCount:dressingInstancedGroups.length,
      dressingRouteSafeCount:props.filter(item=>String(item.type||"")==="dressing"&&item.routeSafe!==false).length,
      dressingContextCounts:Object.freeze({...((presentation.dressing||{}).contexts||{})}),
      dressingSemanticCounts:Object.freeze({...((presentation.dressing||{}).semantics||{})}),
      dressingSamples:Object.freeze(dressingSamples.slice()),
      dressingDeterministic:Boolean(presentation.dressing?.deterministic),
      dressingRendererOnly:Boolean(presentation.dressing?.rendererOnly),
      contactShadowTechnique:"batched-foundation-halo+instanced-ground-disc",
      contactShadowMaterialCount:contactShadowMaterials.size,
      contactShadowQuality:String(contactShadowProfile().level),
      contactShadowOpacity:Number(contactShadowProfile().opacity.toFixed(3)),
      contactShadowBuildingCount:buildings.length,
      contactShadowTreeCount:treeVariants[0].length+treeVariants[1].length,
      contactShadowPropCount:contactShadowInstances.filter(item=>item.contactKind!=="tree").length,
      contactShadowObjectCount:contactShadowInstances.length,
      contactShadowInstancedGroupCount:contactShadowGroup?1:0,
      contactShadowDrawCalls:(buildings.length?1:0)+(contactShadowGroup?1:0),
      contactShadowSharedMesh:true,
      contactShadowDepthWrite:false,
      contactShadowRendererOnly:true,
      contactShadowTerrainSampled:true,
      treePresentationCount:treeVariants[0].length+treeVariants[1].length,
      treeVariant0Count:treeVariants[0].length,
      treeVariant1Count:treeVariants[1].length,
      treeInstancedGroupCount:treeGroups.length,
      treePlanePresentation:true,
      treeCylinderSpherePlaceholderCount:0,
      treeCameraFacingYawDegrees:Number((Number(treeYawProvider?.()??45)).toFixed(3)),
      treeDeterministicVariation:true,
      instancingCoordinateSpace:"chunk-local",
      instancingParentTranslationAppliedOnce:true,
      instancingRepositionViaParent:true,
      treePlacementJitter:true,
      treePlacementJitterMaxMeters:0.5,
      treeVariationSamples:Object.freeze(treeVariationSamples.slice()),
      treeSpriteAtlas:treeSpriteAtlasProvider?.()?.stats?.()||null,
      treeSharedTextureCount:Number(treeSpriteAtlasProvider?.()?.stats?.()?.gpuTextureCount||0),
      treeSharedMaterialCount:treeSpriteMaterials.size,
      hardwareInstancing:instancedGroupCount>0,
      chunkLocalStaticBatching:staticBatchCount>0,
      frustumCulling:true,
      optimizedPresentationDrawCalls,
      unoptimizedPresentationDrawCalls,
      savedDrawCalls,
      drawCallReductionRatio:unoptimizedPresentationDrawCalls?Number((savedDrawCalls/unoptimizedPresentationDrawCalls).toFixed(4)):0,
      buildingPresentationCount:buildings.length,
      entranceTreatmentCount:Number(entranceCounters.total||0),
      entranceOrdinaryCount:Number(entranceCounters.ordinary||0),
      entranceSpecialCount:Number(entranceCounters.special||0),
      entranceThresholdCount:Number(entranceCounters.threshold||0),
      entranceFramePrimitiveCount:Number(entranceCounters.frame||0),
      entranceWearCount:Number(entranceCounters.wear||0),
      entranceAwningCount:Number(entranceCounters.awning||0),
      entranceSignCount:Number(entranceCounters.sign||0),
      entrancePrimitiveCount:Number(entranceCounters.primitives||0),
      entranceTreatmentSamples:Object.freeze(entranceTreatmentSamples.slice()),
      entranceAuthoritativeDoorAnchored:entranceTreatmentSamples.every(item=>item.authoritativeDoor===true),
      entranceRendererOnly:true,
      entranceNavigationBlocking:false,
      entranceCollisionBlocking:false,
      entranceSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("entrance-")).length,
      landmarkPresentationCount:Number(landmarkCounters.total||0),
      landmarkPrimitiveCount:Number(landmarkCounters.primitives||0),
      landmarkTreatmentCounts:Object.freeze({...landmarkCounters.treatments}),
      landmarkContextCounts:Object.freeze({...landmarkCounters.contexts}),
      landmarkSamples:Object.freeze(landmarkSamples.slice()),
      landmarkSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("landmark-")).length,
      landmarkDeterministic:Boolean(presentation.landmark?.deterministic!==false),
      landmarkRendererOnly:Boolean(presentation.landmark?.rendererOnly!==false),
      landmarkNavigationAuthority:false,
      landmarkCollisionAuthority:false,
      landmarkSimulationAuthorityPreserved:Boolean(presentation.landmark?.simulationAuthorityPreserved!==false),
      buildingMaterialVariationDeterministic:true,
      buildingMaterialVariantPaletteSize:BUILDING_MATERIAL_VARIANTS.length,
      buildingMaterialVariantCount:new Set(buildingMaterialVariants.map(item=>item.variantIndex)).size,
      buildingMaterialVariantMaterialBudget:16,
      buildingMaterialVariantMaterialCount:[...presentationMaterials.keys()].filter(name=>/^building-(?:house-wall|special-wall|roof|door)-v\d+$/.test(String(name))).length,
      buildingMaterialVariantSamples:Object.freeze(buildingMaterialVariants.slice(0,24)),
      buildingTexturedMaterialCount:surfaceBoundMaterials.size,
      buildingTexturedMaterialNames:Object.freeze([...surfaceBoundMaterials].sort()),
      buildingSurfaceMaterialRebinds,buildingSurfaceMaterialRefreshes,
      buildingSurfaceMaterialAtlasSignatures:Object.freeze(
        [...presentationMaterials.values()]
          .filter(item=>item?._advisorBuildingSurfaceName)
          .map(item=>String(item._advisorBuildingAtlasSignature||""))
          .sort()
      ),
      buildingSurfaceVariantBindings:Object.freeze(
        [...presentationMaterials.values()]
          .filter(item=>item?._advisorBuildingSurfaceName)
          .map(item=>Object.freeze({
            materialName:String(item.name||""),
            surfaceName:String(item._advisorBuildingSurfaceName||""),
            variantIndex:Number(item._advisorBuildingVariantIndex??-1),
            atlasSignature:String(item._advisorBuildingAtlasSignature||""),
            textureName:String(item._advisorBuildingTextureName||item.diffuseMap?.name||""),
            uvScale:Object.freeze([
              Number(item.diffuseMapTiling?.x??1),
              Number(item.diffuseMapTiling?.y??1)
            ]),
            uvOffset:Object.freeze([
              Number(item.diffuseMapOffset?.x??0),
              Number(item.diffuseMapOffset?.y??0)
            ]),
            tint:Object.freeze([
              Number(item.diffuse?.r??1),
              Number(item.diffuse?.g??1),
              Number(item.diffuse?.b??1)
            ])
          }))
          .sort((a,b)=>a.materialName.localeCompare(b.materialName))
      ),
      buildingSurfaceStaleBindingCount:(()=>{
        const current=String(buildingSurfaceAtlasProvider?.()?.stats?.()?.signature||"");
        return [...presentationMaterials.values()].filter(item=>
          item?._advisorBuildingSurfaceName&&String(item._advisorBuildingAtlasSignature||"")!==current
        ).length;
      })(),
      buildingSurfaceAtlas:buildingSurfaceAtlasProvider?.()?.stats?.()||null,
      staticBatchUvEnabled:staticBatches.every(item=>Boolean(item.mesh)),
      roofProfileCount:roofProfiles.length,
      roofNormalProfileCount:roofProfiles.filter(item=>item.source!=="special").length,
      roofSpecialProfileCount:roofProfiles.filter(item=>item.source==="special").length,
      roofProfilePass:roofProfiles.length===buildings.length&&roofProfiles.every(item=>item.centerRidgeHigher&&item.eaveContact&&item.restrainedOverhang&&item.footprintDriven),
      roofCenterRidgeHigher:roofProfiles.every(item=>item.centerRidgeHigher),
      roofEaveContactPass:roofProfiles.every(item=>item.eaveContact),
      roofFootprintDriven:roofProfiles.every(item=>item.footprintDriven),
      roofProfiles:Object.freeze(roofProfiles.slice()),
      interiorObjectPresentationCount:interiorObjects.length,
      propPresentationCount:props.length,
      dressingPresentationCount:props.filter(item=>String(item.type||"")==="dressing").length,
      routeSurfaceCellCount:routePresentation.surfaceCellCount,
      routeMainRoadCellCount:Number(routePresentation.counts.road||0),
      routeLocalPathCellCount:Number(routePresentation.counts.path||0),
      routeSquareCellCount:Number(routePresentation.counts.square||0),
      routeConnectorCellCount:Number(routePresentation.connectorCellCount||0),
      routeEdgeStripCount:Number(routePresentation.edgeStripCount||0),
      routeDiagonalBridgeCount:Number(routePresentation.diagonalBridgeCount||0),
      routeDiagonalRibbonOnlyCellCount:Number(routePresentation.diagonalRibbonOnlyCellCount||0),
      routeSurfaceTriangleCount:Number(routePresentation.triangleCount||0),
      routeSurfaceMaterialCount:Number(routePresentation.routeSurfaceMaterialCount||0),
      routeSurfaceMaterialNames:routePresentation.routeSurfaceMaterialNames,
      routeSurfaceBindings:routePresentation.surfaceBindings,
      routeSurfaceSamples:routePresentation.samples,
      routeSurfaceRouteSafe:routePresentation.routeSafe===true,
      routeSurfaceRendererOnly:routePresentation.rendererOnly===true,
      routeNetworkDeterministic:presentation?.routeNetwork?.deterministic===true,
      routeNetworkConnectedRouteCount:Number(presentation?.routeNetwork?.connectedRouteCount||0),
      routeNetworkTotalRouteCount:Number(presentation?.routeNetwork?.totalRouteCount||0),
      routeNetworkRouteSafetyPass:presentation?.routeNetwork?.routeSafetyPass===true,
      roadCellCount:Number(surfaceCounts.road||0)+Number(surfaceCounts.path||0)+Number(surfaceCounts.square||0),
      waterCellCount:Number(surfaceCounts.water||0),
      bridgeCellCount:Number(surfaceCounts.bridge||0),
      terrainTypeCount:Object.keys(surfaceCounts).length,
      seedDerivedPresentation:presentation.source==="seed-chunk-world-data",
      hardCodedSampleGeometry:Boolean(presentation.hardCodedSampleGeometry),
      buildMs,
      worldDataKey:spec.worldData?.key||null,
      worldDataComplete:Boolean(spec.worldData?.complete),
      presentationKind:"chunk-mesh",
      complete:true
    };
  }
  function reposition(resource){
    if(!resource)return;
    // The chunk Entity is repositioned by app.js. Instance matrices remain
    // chunk-local, so scene-anchor changes require no GPU buffer rewrite.
    instancingParentRepositions+=Number(resource.instancedGroups?.length||0);
  }
  function destroy(resource){
    if(!resource)return;
    presentationEntityDestroys+=Number(resource.presentationEntityCount||0);
    for(const group of resource.instancedGroups||[])group.vertexBuffer?.destroy?.();
    for(const item of resource.staticBatches||[])item.mesh?.destroy?.();
    resource.entity?.destroy?.();
    resource.mesh?.destroy?.();
    destroys++;
  }
  function stats(){
    return Object.freeze({
      creations,destroys,
      liveMeshes:Math.max(0,creations-destroys),
      totalBuildMs:Number(totalBuildMs.toFixed(3)),
      maxBuildMs:Number(maxBuildMs.toFixed(3)),
      averageBuildMs:Number((creations?totalBuildMs/creations:0).toFixed(3)),
      presentationEntityCreations,presentationEntityDestroys,presentationMeshInstanceCreations,
      entityCreations:creations+presentationEntityCreations,
      entityDestroys:destroys+presentationEntityDestroys,
      staticBatchMeshCreations,staticBatchSourcePrimitiveCount,
      instancedGroupCreations,instancedObjectCount,instancingBufferUpdates,instancingParentRepositions,
      instancingCoordinateSpace:"chunk-local",
      instancingParentTranslationAppliedOnce:true,
      frustumCulledMeshInstances,
      sharedPresentationMaterialCount:presentationMaterials.size,
      worldVisualStyleSignature:String(worldVisualStyle()?.signature||"legacy"),
      worldVisualStylePaletteRoleCount:Object.keys(worldVisualStyle()?.palette||{}).length,
      terrainSemanticUvPerTile:true,
      semanticMeshUvOrientation:String(textureAtlasProvider?.()?.stats?.()?.semanticMeshUvOrientation||"source-row-space"),
      hydrologyEnabled:true,
      hydrologyVersion:HYDROLOGY_VERSION,
      hydrologyQueryRadiusTiles:HYDROLOGY_QUERY_RADIUS_TILES,
      hydrologyBankTransitionWidthTiles:HYDROLOGY_BANK_TRANSITION_TILES,
      hydrologyBankMinRiseWorldUnits:HYDROLOGY_BANK_MIN_RISE,
      hydrologyBedDepthWorldUnits:HYDROLOGY_BED_DEPTH,
      hydrologyBridgeClearanceWorldUnits:HEIGHTFIELD_BRIDGE_CLEARANCE,
      hydrologyQueryCalls,
      hydrologyCacheHits,
      hydrologyCacheHitRate:Number((hydrologyQueryCalls+hydrologyCacheHits?hydrologyCacheHits/(hydrologyQueryCalls+hydrologyCacheHits):0).toFixed(4)),
      hydrologyProfileCacheSize:hydrologyProfileCache.size,
      hydrologyVertexCacheSize:hydrologyVertexCache.size,
      hydrologyPerFrameRegenerationCount:0,
      hydrologyRendererOnly:true,
      hydrologyNavigationAuthority:false,
      hydrologyCollisionAuthority:false,
      hydrologyWaterIdentityChanged:false,
      landformEnabled:true,
      landformVersion:LANDFORM_VERSION,
      landformSampleRadiusTiles:LANDFORM_SAMPLE_RADIUS_TILES,
      landformQueryCalls,landformCacheHits,
      landformCacheHitRate:Number((landformQueryCalls+landformCacheHits?landformCacheHits/(landformQueryCalls+landformCacheHits):0).toFixed(4)),
      landformProfileCacheSize:landformProfileCache.size,landformCacheLimit:LANDFORM_CACHE_LIMIT,
      landformPerFrameRegenerationCount:0,landformRendererOnly:true,landformNavigationAuthority:false,
      landformCollisionAuthority:false,landformSimulationAuthorityPreserved:true,
      landformSteepFaceTreatment:"exaggerated-heightfield+raised-cliff-breaks",
      landformCliffFaceApronMinWorldUnits:LANDFORM_CLIFF_FACE_APRON_MIN,
      landformCliffFaceApronMaxWorldUnits:LANDFORM_CLIFF_FACE_APRON_MAX,
      landformCliffLipInsetWorldUnits:LANDFORM_CLIFF_LIP_INSET,
      landformCliffBreakRiseMinWorldUnits:LANDFORM_CLIFF_BREAK_RISE_MIN,
      landformCliffBreakRiseMaxWorldUnits:LANDFORM_CLIFF_BREAK_RISE_MAX,
      landformTriangleBudgetPerChunk:LANDFORM_CLIFF_FACE_MAX_PER_CHUNK*4,
      contourAlgorithm:"categorical-marching-corners-rounded-fan",
      contourPreparationOnly:true,
      contourHaloTiles:CONTOUR_HALO_TILES,
      contourRoundRadiusTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourTransitionBandWidthTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourMaxBoundaryDeviationTiles:CONTOUR_ROUND_RADIUS_TILES,
      contourArcSegments:CONTOUR_ARC_SEGMENTS,
      contourDrawCallsAdded:0,
      contourMaterialCountAdded:0,
      contourPerFrameRegenerationCount:0,
      contourCanonicalCornerOwnership:true,
      contourTileCentersPreserved:true,
      contourAlphaBlend:false,
      terrainVariationEnabled:true,
      terrainVariationStrategy:"global-coordinate vertex-color macro field + semantic proximity wear",
      terrainVariationMacroScaleTiles:Number(TERRAIN_VARIATION_MACRO_SCALE_TILES),
      terrainVariationContextRadiusTiles:TERRAIN_VARIATION_CONTEXT_RADIUS_TILES,
      terrainVariationDrawCallsAdded:0,
      terrainVariationMaterialsAdded:0,
      terrainVariationTexturesAdded:0,
      terrainVariationTrianglesAdded:0,
      terrainVariationGlobalCoordinateField:true,
      terrainVariationChunkBorderContinuous:true,
      terrainVariationSemanticEdgeFade:true,
      terrainVariationAuthorityQueriesAdded:0,
      terrainVariationContourCompatible:true,
      terrainVariationBaseSurfaceIdentityPreserved:true,
      terrainVariationVertexColorEncoding:"uint8-multiply-visible-range-0.55-1.00",
      terrainVariationRendererOnly:true,
      terrainVariationNavigationAuthority:false,
      terrainVariationCollisionAuthority:false,
      terrainVariationSimulationAuthorityPreserved:true,
      indexedSharedVertices:false,
      indexedSemanticQuads:true,
      semanticTerrainMaterialCount:1,
      surfaceIdentityBindings:surfaceIdentityBindings(),
      buildingMaterialVariationDeterministic:true,
      buildingMaterialVariantPaletteSize:BUILDING_MATERIAL_VARIANTS.length,
      buildingMaterialVariantCount:new Set([...buildingMaterialVariantEvidence.values()].map(item=>item.variantIndex)).size,
      buildingMaterialVariantMaterialBudget:16,
      buildingMaterialVariantMaterialCount:[...presentationMaterials.keys()].filter(name=>/^building-(?:house-wall|special-wall|roof|door)-v\d+$/.test(String(name))).length,
      buildingMaterialVariantSamples:Object.freeze([...buildingMaterialVariantEvidence.values()].slice(0,24)),
      treeSpriteMaterialCount:treeSpriteMaterials.size,
      treeSpriteMaterialRebinds,treeSpriteMaterialRefreshes,
      treeSpriteMaterialAtlasSignatures:Object.freeze([...treeSpriteMaterials.values()].map(m=>String(m._advisorTreeAtlasSignature||"")).sort()),
      treeSpriteAtlas:treeSpriteAtlasProvider?.()?.stats?.()||null,
      treePlaneMeshPrepared:primitiveMeshes.has("tree-plane"),
      treeSpriteUnlitEmissive:true,
      treeSpriteAlphaTest:0.12,
      treeCylinderSpherePlaceholders:false,
      dressingSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("dressing-")).length,
      dressingHardwareInstanced:true,
      entranceSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("entrance-")).length,
      entranceRendererOnly:true,
      entranceNavigationBlocking:false,
      entranceCollisionBlocking:false,
      landmarkSharedMaterialCount:[...presentationMaterials.keys()].filter(name=>String(name).startsWith("landmark-")).length,
      landmarkRendererOnly:true,
      landmarkNavigationAuthority:false,
      landmarkCollisionAuthority:false,
      contactShadowMaterialCount:contactShadowMaterials.size,
      contactShadowQuality:String(contactShadowProfile().level),
      contactShadowOpacity:Number(contactShadowProfile().opacity.toFixed(3)),
      contactShadowMaterialRefreshes,
      contactShadowSharedMesh:primitiveMeshes.has("contact-disc"),
      contactShadowDepthWrite:false,
      contactShadowRendererOnly:true,
      contactShadowTerrainSampled:true,
      routeSurfaceMaterialCount:routeSurfaceMaterials.size,
      routeSurfaceMaterialNames:Object.freeze([...routeSurfaceMaterials.values()].map(m=>m.name).sort()),
      routeSurfaceMaterialRebinds,routeSurfaceMaterialRefreshes,
      routeSurfaceMaterialAtlasSignatures:Object.freeze([...routeSurfaceMaterials.values()].map(m=>String(m._advisorTerrainAtlasSignature||"")).sort()),
      routeSurfaceStaleBindingCount:(()=>{
        const current=String(textureAtlasProvider?.()?.stats?.()?.signature||"");
        return [...routeSurfaceMaterials.values()].filter(m=>String(m._advisorTerrainAtlasSignature||"")!==current).length;
      })(),
      routeSurfaceBindings:routeSurfaceBindings(),
      buildingTexturedMaterialCount:surfaceBoundMaterials.size,
      buildingTexturedMaterialNames:Object.freeze([...surfaceBoundMaterials].sort()),
      buildingSurfaceMaterialRebinds,buildingSurfaceMaterialRefreshes,
      buildingSurfaceMaterialAtlasSignatures:Object.freeze(
        [...presentationMaterials.values()]
          .filter(item=>item?._advisorBuildingSurfaceName)
          .map(item=>String(item._advisorBuildingAtlasSignature||""))
          .sort()
      ),
      buildingSurfaceVariantBindings:Object.freeze(
        [...presentationMaterials.values()]
          .filter(item=>item?._advisorBuildingSurfaceName)
          .map(item=>Object.freeze({
            materialName:String(item.name||""),
            surfaceName:String(item._advisorBuildingSurfaceName||""),
            variantIndex:Number(item._advisorBuildingVariantIndex??-1),
            atlasSignature:String(item._advisorBuildingAtlasSignature||""),
            textureName:String(item._advisorBuildingTextureName||item.diffuseMap?.name||""),
            textureWidth:Number(item.diffuseMap?.width||0),
            textureHeight:Number(item.diffuseMap?.height||0),
            uvScale:Object.freeze([
              Number(item.diffuseMapTiling?.x??1),
              Number(item.diffuseMapTiling?.y??1)
            ]),
            uvOffset:Object.freeze([
              Number(item.diffuseMapOffset?.x??0),
              Number(item.diffuseMapOffset?.y??0)
            ]),
            tint:Object.freeze([
              Number(item.diffuse?.r??1),
              Number(item.diffuse?.g??1),
              Number(item.diffuse?.b??1)
            ])
          }))
          .sort((a,b)=>a.materialName.localeCompare(b.materialName))
      ),
      buildingSurfaceStaleBindingCount:(()=>{
        const current=String(buildingSurfaceAtlasProvider?.()?.stats?.()?.signature||"");
        return [...presentationMaterials.values()].filter(item=>
          item?._advisorBuildingSurfaceName&&String(item._advisorBuildingAtlasSignature||"")!==current
        ).length;
      })(),
      buildingSurfaceAtlas:buildingSurfaceAtlasProvider?.()?.stats?.()||null,
      oneEntityPerChunk:true,
      oneEntityPerTile:false,
      sharedMaterial:true,
      terrainTextureAtlas:textureAtlasProvider?.()?.stats?.()||null,
      chunkLocalStaticBatching:true,
      hardwareInstancing:true,
      frustumCulling:true,
      completeChunkMesh:true,
      heightfield:true,
      heightfieldGridResolutionDefault:9,
      heightfieldVerticalScale:HEIGHTFIELD_VERTICAL_SCALE,
      heightfieldWaterY:HEIGHTFIELD_WATER_Y,
      roadProfileEnabled:true,
      roadProfileMode:"shared-heightfield-smoothed-roadbed+bounded-shoulder",
      roadLiftWorldUnits:ROAD_PROFILE_LIFTS.road,
      pathLiftWorldUnits:ROAD_PROFILE_LIFTS.path,
      squareLiftWorldUnits:ROAD_PROFILE_LIFTS.square,
      roadShoulderCoreRadiusTiles:ROAD_PROFILE_CORE_RADIUS_TILES,
      roadShoulderBlendWidthTiles:ROAD_PROFILE_SHOULDER_WIDTH_TILES,
      roadShoulderBlendWidthWorldUnits:Number((ROAD_PROFILE_SHOULDER_WIDTH_TILES*WORLD_TILE_METERS).toFixed(3)),
      bridgeClearanceWorldUnits:HEIGHTFIELD_BRIDGE_CLEARANCE,
      roadProfileGroundingShared:true,
      heightVertexSampleCalls,
      heightVertexCacheHits,
      heightVertexCacheEntries:heightVertexCache.size,
      heightVertexCacheLimit:HEIGHT_VERTEX_CACHE_LIMIT,
      heightGroundSampleCalls,
      seedDerivedPresentation:true,
      hardCodedSampleGeometry:false,
      simulationAuthorityPreserved:true
    });
  }
  function heightAtTile(x,y,chunkSize=16,offsetX=0,offsetY=0){
    return terrainHeightAtTile(String(seedProvider()||""),x,y,chunkSize,offsetX,offsetY);
  }
  return Object.freeze({
    build,reposition,destroy,stats,heightAtTile,
    hydrologyAtTile:(x,y)=>hydrologyAtTile(String(seedProvider()||""),x,y),
    waterSurfaceAtVertex:(x,y)=>waterSurfaceAtVertex(String(seedProvider()||""),x,y),
    landformAtTile:(x,y)=>landformAtTile(String(seedProvider()||""),x,y),
    updateAmbientMotion,refreshTreeMaterials,refreshBuildingMaterials,refreshRouteSurfaceMaterials,refreshContactShadowMaterials
  });
}

window.PlayCanvasTerrainChunkMesh=Object.freeze({create});
})();
