(function(){
"use strict";
const STORAGE_KEY="the-advisor-game:terrain-chunk-size:v1";
const OPTIONS=Object.freeze([8,16,32,64]);
const DEFAULT=16;
let current=read(),revision=0,invalidations=0;
const listeners=new Set();
function normalize(value){const n=Number(value);return OPTIONS.includes(n)?n:DEFAULT;}
function read(){try{return normalize(localStorage.getItem(STORAGE_KEY));}catch(_){return DEFAULT;}}
function persist(){try{localStorage.setItem(STORAGE_KEY,String(current));return true;}catch(_){return false;}}
function snapshot(){return Object.freeze({chunkSize:current,defaultChunkSize:DEFAULT,options:OPTIONS.slice(),cacheSignature:"terrain-chunk-size@"+current,revision,invalidations});}
function notify(){const state=snapshot();for(const fn of [...listeners]){try{fn(state);}catch(_){}}window.dispatchEvent(new CustomEvent("advisor:terrain-chunk-size-change",{detail:state}));return state;}
function set(value){const next=normalize(value);if(next===current)return snapshot();current=next;revision++;invalidations++;persist();syncControl();return notify();}
function subscribe(fn){if(typeof fn!=="function")return ()=>{};listeners.add(fn);return ()=>listeners.delete(fn);}
function syncControl(){const select=document.getElementById("terrainChunkSizeSelect");if(select)select.value=String(current);}
function installControl(){const heading=document.getElementById("terrainPerformanceHeading"),section=heading?.closest(".settings-subsection");if(!section||document.getElementById("terrainChunkSizeSelect"))return;const label=document.createElement("label");label.className="select-setting";label.htmlFor="terrainChunkSizeSelect";const copy=document.createElement("span");const title=document.createElement("strong");title.textContent="Terrain Chunk Size";const help=document.createElement("small");help.textContent="Partition deterministic terrain into reusable PlayCanvas chunks. 16×16 is the default.";copy.append(title,help);const select=document.createElement("select");select.id="terrainChunkSizeSelect";select.setAttribute("aria-label","Terrain Chunk Size");for(const size of OPTIONS){const option=document.createElement("option");option.value=String(size);option.textContent=size+"×"+size+" tiles"+(size===DEFAULT?" (default)":"");select.appendChild(option);}select.value=String(current);select.addEventListener("change",()=>set(select.value));label.append(copy,select);const firstSetting=section.querySelector(".select-setting, .toggle-setting");section.insertBefore(label,firstSetting||null);}
function bindPreloadManager(){const api=window.TerrainChunkPreload;if(!api||typeof api.createManager!=="function"||api.__chunkSizeSettingsBound)return false;const original=api.createManager.bind(api);const wrapped=Object.create(api);wrapped.createManager=function(options={}){const manager=original({...options,chunkSize:current});subscribe(state=>manager?.setChunkSize?.(state.chunkSize));return manager;};Object.defineProperty(wrapped,"__chunkSizeSettingsBound",{value:true});window.TerrainChunkPreload=Object.freeze(wrapped);return true;}
function ensurePreloadBinding(){if(bindPreloadManager())return;let attempts=0;const timer=setInterval(()=>{attempts++;if(bindPreloadManager()||attempts>=100)clearInterval(timer);},100);}
window.TerrainChunkSizeSettings=Object.freeze({OPTIONS,DEFAULT,get:snapshot,set,subscribe,cacheSignature:()=>snapshot().cacheSignature});
ensurePreloadBinding();
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{installControl();bindPreloadManager();},{once:true});else{installControl();bindPreloadManager();}
window.addEventListener("load",bindPreloadManager,{once:true});
})();
