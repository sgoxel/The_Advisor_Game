(function(){
"use strict";

const STORAGE_KEY="the-advisor-game:render-quality-mode";
const DEFAULT_MODE="auto";
const MODES=Object.freeze(["auto","low","standard","high"]);
const LEVELS=Object.freeze(["low","standard","high"]);
const LOW_FRAME_THRESHOLD_MS=1000/30;
const GOOD_FRAME_THRESHOLD_MS=1000/55;
const LOW_STREAK_FRAMES=180;
const GOOD_STREAK_FRAMES=360;

const PROFILES=Object.freeze({
  low:Object.freeze({
    id:"low",label:"Low",maxPixelRatio:1.0,renderScale:0.65,recommendedTextureProfile:"low",
    lightCount:1,shadowQuality:"off",shadowsEnabled:false,lodDistanceScale:0.70,
    propDensityScale:0.70,antialiasing:"off",postProcessing:"off"
  }),
  standard:Object.freeze({
    id:"standard",label:"Standard",maxPixelRatio:1.25,renderScale:0.85,recommendedTextureProfile:"standard",
    lightCount:2,shadowQuality:"off",shadowsEnabled:false,lodDistanceScale:1.0,
    propDensityScale:1.0,antialiasing:"off",postProcessing:"off"
  }),
  high:Object.freeze({
    id:"high",label:"High",maxPixelRatio:1.5,renderScale:1.0,recommendedTextureProfile:"high",
    lightCount:2,shadowQuality:"off",shadowsEnabled:false,lodDistanceScale:1.20,
    propDensityScale:1.0,antialiasing:"off",postProcessing:"off"
  })
});

let mode=readMode();
let autoLevel=initialAutoLevel();
let lowFrameStreak=0;
let goodFrameStreak=0;
let sampleCount=0;
let transitionCount=0;
let lastFrameMs=0;
let lastTransitionReason="startup";
let lastDeviceClass=deviceClass();
let resizeHandler=null;

function normalizeMode(value){
  const candidate=String(value||"").toLowerCase();
  return MODES.includes(candidate)?candidate:DEFAULT_MODE;
}
function readMode(){
  try{return normalizeMode(localStorage.getItem(STORAGE_KEY)||DEFAULT_MODE)}
  catch(_){return DEFAULT_MODE}
}
function persistMode(){
  try{localStorage.setItem(STORAGE_KEY,mode);return true}
  catch(_){return false}
}
function deviceClass(){
  const width=Math.max(1,Number(window.innerWidth||1));
  const height=Math.max(1,Number(window.innerHeight||1));
  const shortSide=Math.min(width,height);
  const coarse=Boolean(window.matchMedia?.("(pointer:coarse)")?.matches);
  if(shortSide<=520)return "phone";
  if(shortSide<=900||coarse)return "tablet";
  return "desktop";
}
function initialAutoLevel(){
  return deviceClass()==="phone"?"low":"standard";
}
function maxAutoLevel(){
  return deviceClass()==="phone"?"standard":"high";
}
function clampAutoLevel(){
  const max=maxAutoLevel();
  if(LEVELS.indexOf(autoLevel)>LEVELS.indexOf(max))autoLevel=max;
}
function activeLevel(){
  return mode==="auto"?autoLevel:mode;
}
function activeProfile(){
  return PROFILES[activeLevel()]||PROFILES.standard;
}
function persistedMode(){
  try{return normalizeMode(localStorage.getItem(STORAGE_KEY)||DEFAULT_MODE)}
  catch(_){return mode}
}
function snapshot(){
  const profile=activeProfile();
  return Object.freeze({
    mode,
    persistedMode:persistedMode(),
    activeLevel:profile.id,
    activeLabel:profile.label,
    autoSelected:mode==="auto",
    deviceClass:deviceClass(),
    maxPixelRatio:profile.maxPixelRatio,
    renderScale:profile.renderScale,
    textureProfile:window.RuntimeTextureQuality?.getProfile?.()||"standard",
    recommendedTextureProfile:profile.recommendedTextureProfile,
    textureQualityCoupled:false,
    lightCount:profile.lightCount,
    shadowQuality:profile.shadowQuality,
    shadowsEnabled:profile.shadowsEnabled,
    lodDistanceScale:profile.lodDistanceScale,
    propDensityScale:profile.propDensityScale,
    antialiasing:profile.antialiasing,
    postProcessing:profile.postProcessing,
    targetFps:60,
    minimumFps:30,
    lowFrameThresholdMs:Number(LOW_FRAME_THRESHOLD_MS.toFixed(2)),
    goodFrameThresholdMs:Number(GOOD_FRAME_THRESHOLD_MS.toFixed(2)),
    lowStreakRequired:LOW_STREAK_FRAMES,
    goodStreakRequired:GOOD_STREAK_FRAMES,
    lowFrameStreak,
    goodFrameStreak,
    sampleCount,
    lastFrameMs:Number(lastFrameMs.toFixed(3)),
    transitionCount,
    lastTransitionReason,
    simulationAuthorityPreserved:true
  });
}
function syncSettingsControl(){
  const select=document.getElementById("renderQualityMode");
  if(select)select.value=mode;
  const status=document.getElementById("renderQualityStatus");
  if(status){
    const s=snapshot();
    status.textContent=s.mode==="auto"
      ?"Auto currently "+s.activeLabel+" · "+Math.round(s.renderScale*100)+"% render scale · DPR cap "+s.maxPixelRatio
      :s.activeLabel+" · "+Math.round(s.renderScale*100)+"% render scale · DPR cap "+s.maxPixelRatio;
  }
}
function emit(reason){
  lastTransitionReason=reason||lastTransitionReason;
  const state=snapshot();
  syncSettingsControl();
  window.dispatchEvent(new CustomEvent("advisor:render-quality-change",{detail:state}));
  return state;
}
function resetStreaks(){
  lowFrameStreak=0;
  goodFrameStreak=0;
}
function setMode(value){
  const next=normalizeMode(value);
  const changed=next!==mode;
  mode=next;
  if(mode==="auto"){
    autoLevel=initialAutoLevel();
    clampAutoLevel();
  }
  resetStreaks();
  persistMode();
  if(changed)transitionCount++;
  return emit(changed?"user-mode-"+mode:"user-mode-refresh");
}
function transitionAuto(direction,reason){
  const index=LEVELS.indexOf(autoLevel);
  const maxIndex=LEVELS.indexOf(maxAutoLevel());
  let nextIndex=index;
  if(direction<0)nextIndex=Math.max(0,index-1);
  if(direction>0)nextIndex=Math.min(maxIndex,index+1);
  if(nextIndex===index){
    resetStreaks();
    return snapshot();
  }
  autoLevel=LEVELS[nextIndex];
  transitionCount++;
  resetStreaks();
  return emit(reason);
}
function recordFrame(frameMs){
  const ms=Number(frameMs);
  if(!Number.isFinite(ms)||ms<=0||document.hidden)return snapshot();
  lastFrameMs=ms;
  sampleCount++;
  if(mode!=="auto")return snapshot();
  const currentClass=deviceClass();
  if(currentClass!==lastDeviceClass){
    lastDeviceClass=currentClass;
    const before=autoLevel;
    clampAutoLevel();
    if(autoLevel!==before){
      transitionCount++;
      resetStreaks();
      return emit("device-class-limit");
    }
  }
  if(ms>LOW_FRAME_THRESHOLD_MS){
    lowFrameStreak++;
    goodFrameStreak=0;
  }else if(ms<GOOD_FRAME_THRESHOLD_MS){
    goodFrameStreak++;
    lowFrameStreak=0;
  }else{
    resetStreaks();
  }
  if(lowFrameStreak>=LOW_STREAK_FRAMES)return transitionAuto(-1,"sustained-below-30-fps");
  if(goodFrameStreak>=GOOD_STREAK_FRAMES)return transitionAuto(1,"sustained-near-60-fps");
  return snapshot();
}
function installSettingsControl(){
  const card=document.querySelector("#settingsPopup .settings-card");
  const actions=card?.querySelector(".settings-actions");
  if(!card||!actions||document.getElementById("renderQualityMode"))return;
  const wrap=document.createElement("label");
  wrap.className="select-setting";
  wrap.htmlFor="renderQualityMode";
  const text=document.createElement("span");
  const strong=document.createElement("strong");
  strong.textContent="Graphics Quality";
  const help=document.createElement("small");
  help.textContent="Auto adapts render scale and lighting only after sustained performance changes. 3D Texture Quality is selected independently; Simulation, collision and routes stay unchanged.";
  text.append(strong,help);
  const select=document.createElement("select");
  select.id="renderQualityMode";
  select.setAttribute("aria-label","Graphics Quality");
  [
    ["auto","Auto (recommended)"],
    ["low","Low"],
    ["standard","Standard"],
    ["high","High"]
  ].forEach(([value,label])=>{
    const option=document.createElement("option");
    option.value=value;
    option.textContent=label;
    select.appendChild(option);
  });
  select.addEventListener("change",()=>setMode(select.value));
  wrap.append(text,select);
  const status=document.createElement("p");
  status.id="renderQualityStatus";
  status.className="field-help";
  card.insertBefore(wrap,actions);
  card.insertBefore(status,actions);
  syncSettingsControl();
}
function handleResize(){
  if(mode!=="auto")return;
  const currentClass=deviceClass();
  if(currentClass===lastDeviceClass)return;
  lastDeviceClass=currentClass;
  const before=autoLevel;
  clampAutoLevel();
  if(autoLevel!==before){
    transitionCount++;
    resetStreaks();
    emit("device-class-limit");
  }else syncSettingsControl();
}

window.RuntimeRenderQuality=Object.freeze({
  STORAGE_KEY,
  MODES,
  PROFILES,
  DEFAULT_MODE,
  snapshot,
  getMode:()=>mode,
  getActiveLevel:()=>activeLevel(),
  setMode,
  recordFrame
});

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",()=>{
    installSettingsControl();
    syncSettingsControl();
  },{once:true});
}else{
  installSettingsControl();
  syncSettingsControl();
}
resizeHandler=handleResize;
window.addEventListener("resize",resizeHandler,{passive:true});
})();
