(function(){
"use strict";

const BACKEND_KEY="advisor.renderer.backend";
const ASSET_PREPARATION_URL="scripts/render/playcanvas/asset-preparation.js";
const WORLD_ASSETS_URL="scripts/render/playcanvas/world-assets.js";
let readyPromise=null;
let selectedBackend="webgl2";
let lastError=null;
let assetPreparationPromise=null;
let worldAssetsPromise=null;

function query(){return new URLSearchParams(location.search);}
function readBackend(){
  const requested=query().get("gpu");
  if(["webgl2","webgpu","auto"].includes(requested))return requested;
  try{const saved=localStorage.getItem(BACKEND_KEY);if(["webgl2","webgpu","auto"].includes(saved))return saved;}catch(_){}
  return "webgl2";
}
function readNumber(name,min,max){const raw=query().get(name);if(raw===null||String(raw).trim()==="")return null;const value=Number(raw);if(!Number.isFinite(value))return null;return Math.min(max,Math.max(min,value));}
function loadScript(url,readyCheck,label){
  if(readyCheck())return Promise.resolve(readyCheck());
  return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=url;script.async=false;script.onload=()=>readyCheck()?resolve(readyCheck()):reject(new Error(label+" did not register"));script.onerror=()=>reject(new Error("Failed to load "+url));document.head.appendChild(script);});
}
function loadAssetPreparation(){if(window.PlayCanvasAssetPreparation)return Promise.resolve(window.PlayCanvasAssetPreparation);if(!assetPreparationPromise)assetPreparationPromise=loadScript(ASSET_PREPARATION_URL,()=>window.PlayCanvasAssetPreparation,"PlayCanvasAssetPreparation");return assetPreparationPromise;}
function loadWorldAssets(){if(window.PlayCanvasWorldAssets)return Promise.resolve(window.PlayCanvasWorldAssets);if(!worldAssetsPromise)worldAssetsPromise=loadScript(WORLD_ASSETS_URL,()=>window.PlayCanvasWorldAssets,"PlayCanvasWorldAssets");return worldAssetsPromise;}

async function initialize(){
  selectedBackend=readBackend();
  try{
    if(!window.RendererContract)throw new Error("RendererContract is unavailable");
    if(!window.PlayCanvasRendererFactory)throw new Error("PlayCanvasRendererFactory is unavailable");
    await Promise.all([loadAssetPreparation(),loadWorldAssets()]);
    const renderer=window.PlayCanvasRendererFactory.create({backendPreference:selectedBackend,maxPixelRatio:readNumber("dpr",0.75,2),renderScale:readNumber("renderScale",0.6,1)});
    window.GameRenderer=renderer;
    if("LegacyGameRenderer" in window)delete window.LegacyGameRenderer;
    return Object.freeze({mode:"playcanvas",backend:selectedBackend,engine:"PlayCanvas",engineVersion:window.PlayCanvasRendererFactory.engineVersion,ready:true,assetPreparation:true,worldAssetCatalog:true});
  }catch(error){lastError=String(error);window.GameRenderer=null;console.error("PlayCanvas startup failed.",error);throw error;}
}
function ready(){if(!readyPromise)readyPromise=initialize();return readyPromise;}
function status(){return Object.freeze({mode:"playcanvas",backend:selectedBackend,webgpuAvailable:Boolean(navigator.gpu),engineVersion:window.PlayCanvasRendererFactory?.engineVersion||null,assetPreparation:Boolean(window.PlayCanvasAssetPreparation),worldAssetCatalog:Boolean(window.PlayCanvasWorldAssets),legacyRendererAvailable:false,error:lastError});}
window.RendererBootstrap=Object.freeze({ready,status,backendKey:BACKEND_KEY});
})();
