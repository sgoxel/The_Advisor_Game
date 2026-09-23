(function(){
"use strict";
const STORAGE_KEY="the-advisor-game:texture-quality-profile";
const LEGACY_KEY="the-advisor-game:tile-texture-resolution";
const SOURCE=128;
const HARD_CACHE_LIMIT=160;
const PROFILES=Object.freeze({
  low:Object.freeze({
    id:"low",label:"Low",runtimeResolution:16,textureBudgetMB:24,worldAssetCacheLimit:24,
    maxMaterialTextureResolution:512,anisotropy:1,auxiliaryMaps:false,detailMaps:false,
    filtering:"bilinear",mipBias:1,materialComplexity:"basic",compressionPolicy:"prefer-compressed-runtime"
  }),
  standard:Object.freeze({
    id:"standard",label:"Standard",runtimeResolution:32,textureBudgetMB:48,worldAssetCacheLimit:48,
    maxMaterialTextureResolution:1024,anisotropy:2,auxiliaryMaps:true,detailMaps:false,
    filtering:"trilinear",mipBias:0,materialComplexity:"standard",compressionPolicy:"prefer-compressed-runtime"
  }),
  high:Object.freeze({
    id:"high",label:"High",runtimeResolution:64,textureBudgetMB:96,worldAssetCacheLimit:72,
    maxMaterialTextureResolution:2048,anisotropy:4,auxiliaryMaps:true,detailMaps:true,
    filtering:"trilinear",mipBias:0,materialComplexity:"enhanced",compressionPolicy:"prefer-compressed-runtime"
  }),
  ultra:Object.freeze({
    id:"ultra",label:"Ultra",runtimeResolution:128,textureBudgetMB:192,worldAssetCacheLimit:96,
    maxMaterialTextureResolution:4096,anisotropy:8,auxiliaryMaps:true,detailMaps:true,
    filtering:"trilinear",mipBias:-0.25,materialComplexity:"ultra",compressionPolicy:"prefer-compressed-runtime"
  })
});
const DEFAULT="standard",OPTIONS=Object.freeze(Object.keys(PROFILES));
let current=DEFAULT,revision=0,presentationRefreshSerial=0,budgetEnforcementCount=0;
function normalize(value){const v=String(value||"").toLowerCase();return PROFILES[v]?v:DEFAULT}
function profileForResolution(value){const n=Number(value);return OPTIONS.find(id=>PROFILES[id].runtimeResolution===n)||DEFAULT}
function read(){try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)return normalize(saved);const legacy=localStorage.getItem(LEGACY_KEY);return profileForResolution(legacy)}catch(_){return DEFAULT}}
function active(){return PROFILES[current]}
function cacheSignature(){const p=active();return [
  "pc-material-quality@"+p.id,
  "terrain="+p.runtimeResolution+"px",
  "materialMax="+p.maxMaterialTextureResolution+"px",
  "aniso="+p.anisotropy,
  "aux="+(p.auxiliaryMaps?1:0),
  "detail="+(p.detailMaps?1:0),
  "worldCache="+p.worldAssetCacheLimit,
  "budget="+p.textureBudgetMB+"MB"
].join("|")}
function estimatedTextureBytes(profile=active()){const px=profile.runtimeResolution;return Math.ceil(px*px*4*4/3)}
function budgetTextureCapacity(profile=active()){return Math.max(1,Math.floor(profile.textureBudgetMB*1024*1024/estimatedTextureBytes(profile)))}
function effectiveCacheLimit(profile=active()){return Math.max(1,Math.min(HARD_CACHE_LIMIT,budgetTextureCapacity(profile)))}
function enforceBudget(){const limit=effectiveCacheLimit();const before=window.TextureAssets?.stats?.().totalResolutionCacheEntryCount??0;const removed=window.TextureAssets?.evict?.(limit)||0;budgetEnforcementCount++;return Object.freeze({limit,before,removed,after:Math.max(0,before-removed)})}
function requestPreparedPresentationRefresh(){const serial=++presentationRefreshSerial,grid=document.getElementById("terrainGrid"),host=grid?.parentElement;if(!host)return;const previousWidth=host.style.width;host.style.width="calc(100% - 0.01px)";requestAnimationFrame(()=>{if(serial!==presentationRefreshSerial)return;host.style.width=previousWidth})}
function write(value){const next=normalize(value);if(next===current)return snapshot();current=next;try{localStorage.setItem(STORAGE_KEY,current);localStorage.removeItem(LEGACY_KEY)}catch(_){}revision++;enforceBudget();const state=snapshot();window.dispatchEvent(new CustomEvent("advisor:texture-resolution-change",{detail:state}));window.dispatchEvent(new CustomEvent("advisor:texture-quality-change",{detail:state}));requestPreparedPresentationRefresh();return state}
function setResolution(value){return write(profileForResolution(value))}
function ultraSupported(){const memory=Number(navigator.deviceMemory||0);return memory<=0||memory>=4}
function snapshot(){const p=active(),bytes=estimatedTextureBytes(p),capacity=budgetTextureCapacity(p),limit=effectiveCacheLimit(p),loaded=window.TextureAssets?.stats?.().totalResolutionCacheEntryCount??0;return Object.freeze({
  qualityProfile:p.id,qualityLabel:p.label,sourceResolution:SOURCE,runtimeResolution:p.runtimeResolution,
  defaultProfile:DEFAULT,options:OPTIONS.slice(),textureBudgetMB:p.textureBudgetMB,worldAssetCacheLimit:p.worldAssetCacheLimit,
  maxMaterialTextureResolution:p.maxMaterialTextureResolution,estimatedTextureBytes:bytes,budgetTextureCapacity:capacity,
  effectiveCacheLimit:limit,estimatedLoadedTextureMB:Number((loaded*bytes/1048576).toFixed(3)),
  budgetUtilization:Number((loaded*bytes/(p.textureBudgetMB*1048576)).toFixed(4)),budgetEnforcementCount,
  anisotropy:p.anisotropy,auxiliaryMaps:p.auxiliaryMaps,detailMaps:p.detailMaps,filtering:p.filtering,mipBias:p.mipBias,
  materialComplexity:p.materialComplexity,compressionPolicy:p.compressionPolicy,
  characterSpritePolicy:"native-separate",ultraSupported:ultraSupported(),
  cacheSignature:cacheSignature(),revision
})}
function installSettingsControl(){const card=document.querySelector("#settingsPopup .settings-card"),actions=card?.querySelector(".settings-actions");if(!card||!actions||document.getElementById("textureQualityProfile"))return;const wrap=document.createElement("div");wrap.className="readonly-setting";const label=document.createElement("label");label.htmlFor="textureQualityProfile";label.textContent="3D Texture Quality";const select=document.createElement("select");select.id="textureQualityProfile";select.setAttribute("aria-label","3D Texture Quality");OPTIONS.forEach(id=>{const p=PROFILES[id],option=document.createElement("option");option.value=id;option.disabled=id==="ultra"&&!ultraSupported();option.textContent=p.label+(id===DEFAULT?" (default)":"")+" — material ≤"+p.maxMaterialTextureResolution+"px / "+p.textureBudgetMB+" MB"+(option.disabled?" (unsupported on this device)":"");select.appendChild(option)});select.value=current;select.addEventListener("change",()=>write(select.value));wrap.append(label,select);card.insertBefore(wrap,actions)}
current=read();
window.RuntimeTextureResolution=Object.freeze({SOURCE_RESOLUTION:SOURCE,DEFAULT_RESOLUTION:PROFILES[DEFAULT].runtimeResolution,OPTIONS:Object.freeze(OPTIONS.map(id=>PROFILES[id].runtimeResolution)),PROFILES,DEFAULT_PROFILE:DEFAULT,normalizeResolution:value=>PROFILES[profileForResolution(value)].runtimeResolution,get:()=>active().runtimeResolution,set:setResolution,snapshot,cacheSignature,getProfile:()=>current,setProfile:write,profile:active,enforceBudget,effectiveCacheLimit,budgetTextureCapacity,estimatedTextureBytes,ultraSupported});
window.RuntimeTextureQuality=window.RuntimeTextureResolution;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{installSettingsControl();enforceBudget()},{once:true});else{installSettingsControl();enforceBudget()}
})();
