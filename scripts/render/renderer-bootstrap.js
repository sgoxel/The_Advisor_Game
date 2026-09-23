(function(){
"use strict";

const MODE_KEY="advisor.renderer.mode";
const BACKEND_KEY="advisor.renderer.backend";
const ASSET_PREPARATION_URL="scripts/render/playcanvas/asset-preparation.js";
let readyPromise=null;
let selectedMode="legacy";
let selectedBackend="webgl2";
let lastError=null;
let assetPreparationPromise=null;

function query(){
  return new URLSearchParams(location.search);
}

function readMode(){
  const requested=query().get("renderer");
  if(requested==="playcanvas"||requested==="legacy")return requested;
  try{
    const saved=localStorage.getItem(MODE_KEY);
    if(saved==="playcanvas"||saved==="legacy")return saved;
  }catch(_){}
  return "legacy";
}

function readBackend(){
  const requested=query().get("gpu");
  if(["webgl2","webgpu","auto"].includes(requested))return requested;
  try{
    const saved=localStorage.getItem(BACKEND_KEY);
    if(["webgl2","webgpu","auto"].includes(saved))return saved;
  }catch(_){}
  return "webgl2";
}

function readNumber(name,min,max){
  const raw=query().get(name);
  if(raw===null||String(raw).trim()==="")return null;
  const value=Number(raw);
  if(!Number.isFinite(value))return null;
  return Math.min(max,Math.max(min,value));
}

function loadAssetPreparation(){
  if(window.PlayCanvasAssetPreparation)return Promise.resolve(window.PlayCanvasAssetPreparation);
  if(assetPreparationPromise)return assetPreparationPromise;
  assetPreparationPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=ASSET_PREPARATION_URL;
    script.async=false;
    script.onload=()=>window.PlayCanvasAssetPreparation?resolve(window.PlayCanvasAssetPreparation):reject(new Error("PlayCanvasAssetPreparation did not register"));
    script.onerror=()=>reject(new Error("Failed to load "+ASSET_PREPARATION_URL));
    document.head.appendChild(script);
  });
  return assetPreparationPromise;
}

async function initialize(){
  selectedMode=readMode();
  selectedBackend=readBackend();
  const legacy=window.GameRenderer;
  window.LegacyGameRenderer=legacy;

  if(selectedMode!=="playcanvas"){
    return Object.freeze({mode:"legacy",backend:"webgl2",engine:"PixiJS",ready:true,fallback:false});
  }

  try{
    if(!window.RendererContract)throw new Error("RendererContract is unavailable");
    if(!window.PlayCanvasRendererFactory)throw new Error("PlayCanvasRendererFactory is unavailable");
    await loadAssetPreparation();
    const renderer=window.PlayCanvasRendererFactory.create({
      backendPreference:selectedBackend,
      maxPixelRatio:readNumber("dpr",0.75,2),
      renderScale:readNumber("renderScale",0.6,1)
    });
    window.GameRenderer=renderer;
    return Object.freeze({mode:"playcanvas",backend:selectedBackend,engine:"PlayCanvas",engineVersion:window.PlayCanvasRendererFactory.engineVersion,ready:true,fallback:false,assetPreparation:true});
  }catch(error){
    lastError=String(error);
    window.GameRenderer=legacy;
    selectedMode="legacy";
    console.error("PlayCanvas migration bootstrap failed; legacy renderer retained.",error);
    return Object.freeze({mode:"legacy",backend:"webgl2",engine:"PixiJS",ready:true,fallback:true,error:lastError});
  }
}

function ready(){if(!readyPromise)readyPromise=initialize();return readyPromise;}
function status(){return Object.freeze({mode:selectedMode,backend:selectedBackend,webgpuAvailable:Boolean(navigator.gpu),engineVersion:window.PlayCanvasRendererFactory?.engineVersion||null,assetPreparation:Boolean(window.PlayCanvasAssetPreparation),error:lastError});}

window.RendererBootstrap=Object.freeze({ready,status,modeKey:MODE_KEY,backendKey:BACKEND_KEY});
})();