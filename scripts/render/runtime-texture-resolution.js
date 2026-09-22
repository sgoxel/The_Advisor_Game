(function(){
"use strict";
const STORAGE_KEY="the-advisor-game:tile-texture-resolution";
const DEFAULT=32;
const SOURCE=128;
const OPTIONS=Object.freeze([16,32,64,128]);
let current=DEFAULT;
let revision=0;
function normalize(value){const n=Number(value);return OPTIONS.includes(n)?n:DEFAULT}
function read(){try{return normalize(localStorage.getItem(STORAGE_KEY))}catch(_){return DEFAULT}}
function write(value){current=normalize(value);try{localStorage.setItem(STORAGE_KEY,String(current))}catch(_){} revision++; window.dispatchEvent(new CustomEvent("advisor:texture-resolution-change",{detail:snapshot()}));return snapshot()}
function snapshot(){return Object.freeze({sourceResolution:SOURCE,runtimeResolution:current,defaultResolution:DEFAULT,options:OPTIONS.slice(),cacheSignature:"tile-texture@"+current+"px",revision})}
function installSettingsControl(){
  const card=document.querySelector("#settingsPopup .settings-card");
  const actions=card?.querySelector(".settings-actions");
  if(!card||!actions||document.getElementById("tileTextureResolution"))return;
  const wrap=document.createElement("div"); wrap.className="readonly-setting";
  const label=document.createElement("label"); label.htmlFor="tileTextureResolution"; label.textContent="Tile Texture Resolution";
  const select=document.createElement("select"); select.id="tileTextureResolution"; select.setAttribute("aria-label","Tile Texture Resolution");
  [[16,"16×16 — Performance"],[32,"32×32 — Standard (default)"],[64,"64×64 — High"],[128,"128×128 — Maximum"]].forEach(([value,text])=>{const option=document.createElement("option");option.value=String(value);option.textContent=text;select.appendChild(option)});
  select.value=String(current); select.addEventListener("change",()=>write(select.value));
  wrap.append(label,select); card.insertBefore(wrap,actions);
}
current=read();
window.RuntimeTextureResolution=Object.freeze({SOURCE_RESOLUTION:SOURCE,DEFAULT_RESOLUTION:DEFAULT,OPTIONS,normalize,get:()=>current,set:write,snapshot,cacheSignature:()=>"tile-texture@"+current+"px"});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installSettingsControl,{once:true}); else installSettingsControl();
})();
