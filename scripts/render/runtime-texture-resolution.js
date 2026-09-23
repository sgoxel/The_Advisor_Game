(function(){
"use strict";
const STORAGE_KEY="the-advisor-game:texture-quality-profile";
const LEGACY_KEY="the-advisor-game:tile-texture-resolution";
const SOURCE=128;
const PROFILES=Object.freeze({
  low:Object.freeze({id:"low",label:"Low",runtimeResolution:16,textureBudgetMB:24,anisotropy:1,auxiliaryMaps:false,detailMaps:false}),
  standard:Object.freeze({id:"standard",label:"Standard",runtimeResolution:32,textureBudgetMB:48,anisotropy:2,auxiliaryMaps:true,detailMaps:false}),
  high:Object.freeze({id:"high",label:"High",runtimeResolution:64,textureBudgetMB:96,anisotropy:4,auxiliaryMaps:true,detailMaps:true}),
  ultra:Object.freeze({id:"ultra",label:"Ultra",runtimeResolution:128,textureBudgetMB:192,anisotropy:8,auxiliaryMaps:true,detailMaps:true})
});
const DEFAULT="standard",OPTIONS=Object.freeze(Object.keys(PROFILES));
let current=DEFAULT,revision=0,presentationRefreshSerial=0;
function normalize(value){const v=String(value||"").toLowerCase();return PROFILES[v]?v:DEFAULT}
function profileForResolution(value){const n=Number(value);return OPTIONS.find(id=>PROFILES[id].runtimeResolution===n)||DEFAULT}
function read(){try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)return normalize(saved);const legacy=localStorage.getItem(LEGACY_KEY);return profileForResolution(legacy)}catch(_){return DEFAULT}}
function active(){return PROFILES[current]}
function requestPreparedPresentationRefresh(){const serial=++presentationRefreshSerial,grid=document.getElementById("terrainGrid"),host=grid?.parentElement;if(!host)return;const previousWidth=host.style.width;host.style.width="calc(100% - 0.01px)";requestAnimationFrame(()=>{if(serial!==presentationRefreshSerial)return;host.style.width=previousWidth})}
function write(value){const next=normalize(value);if(next===current)return snapshot();current=next;try{localStorage.setItem(STORAGE_KEY,current);localStorage.removeItem(LEGACY_KEY)}catch(_){}revision++;const state=snapshot();window.dispatchEvent(new CustomEvent("advisor:texture-resolution-change",{detail:state}));window.dispatchEvent(new CustomEvent("advisor:texture-quality-change",{detail:state}));requestPreparedPresentationRefresh();return state}
function setResolution(value){return write(profileForResolution(value))}
function snapshot(){const p=active();return Object.freeze({qualityProfile:p.id,qualityLabel:p.label,sourceResolution:SOURCE,runtimeResolution:p.runtimeResolution,defaultProfile:DEFAULT,options:OPTIONS.slice(),textureBudgetMB:p.textureBudgetMB,anisotropy:p.anisotropy,auxiliaryMaps:p.auxiliaryMaps,detailMaps:p.detailMaps,cacheSignature:"material-quality@"+p.id+"-"+p.runtimeResolution+"px",revision})}
function installSettingsControl(){const card=document.querySelector("#settingsPopup .settings-card"),actions=card?.querySelector(".settings-actions");if(!card||!actions||document.getElementById("textureQualityProfile"))return;const wrap=document.createElement("div");wrap.className="readonly-setting";const label=document.createElement("label");label.htmlFor="textureQualityProfile";label.textContent="3D Texture Quality";const select=document.createElement("select");select.id="textureQualityProfile";select.setAttribute("aria-label","3D Texture Quality");OPTIONS.forEach(id=>{const p=PROFILES[id],option=document.createElement("option");option.value=id;option.textContent=p.label+(id===DEFAULT?" (default)":"")+" — "+p.runtimeResolution+"px / "+p.textureBudgetMB+" MB";select.appendChild(option)});select.value=current;select.addEventListener("change",()=>write(select.value));wrap.append(label,select);card.insertBefore(wrap,actions)}
current=read();
window.RuntimeTextureResolution=Object.freeze({SOURCE_RESOLUTION:SOURCE,DEFAULT_RESOLUTION:PROFILES[DEFAULT].runtimeResolution,OPTIONS:Object.freeze(OPTIONS.map(id=>PROFILES[id].runtimeResolution)),PROFILES,DEFAULT_PROFILE:DEFAULT,normalizeResolution:value=>PROFILES[profileForResolution(value)].runtimeResolution,get:()=>active().runtimeResolution,set:setResolution,snapshot,cacheSignature:()=>snapshot().cacheSignature,getProfile:()=>current,setProfile:write,profile:active});
window.RuntimeTextureQuality=window.RuntimeTextureResolution;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installSettingsControl,{once:true});else installSettingsControl();
})();
