(function(){
"use strict";

const MODE_KEY="advisor.renderer.mode";
const BACKEND_KEY="advisor.renderer.backend";
let readyPromise=null;
let selectedMode="legacy";
let selectedBackend="webgl2";
let lastError=null;

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

async function initialize(){
  selectedMode=readMode();
  selectedBackend=readBackend();
  const legacy=window.GameRenderer;
  window.LegacyGameRenderer=legacy;

  if(selectedMode!=="playcanvas"){
    return Object.freeze({
      mode:"legacy",
      backend:"webgl2",
      engine:"PixiJS",
      ready:true,
      fallback:false
    });
  }

  try{
    if(!window.RendererContract)throw new Error("RendererContract is unavailable");
    if(!window.PlayCanvasRendererFactory)throw new Error("PlayCanvasRendererFactory is unavailable");
    const renderer=window.PlayCanvasRendererFactory.create({backendPreference:selectedBackend});
    window.GameRenderer=renderer;
    return Object.freeze({
      mode:"playcanvas",
      backend:selectedBackend,
      engine:"PlayCanvas",
      engineVersion:window.PlayCanvasRendererFactory.engineVersion,
      ready:true,
      fallback:false
    });
  }catch(error){
    lastError=String(error);
    window.GameRenderer=legacy;
    selectedMode="legacy";
    console.error("PlayCanvas migration bootstrap failed; legacy renderer retained.",error);
    return Object.freeze({
      mode:"legacy",
      backend:"webgl2",
      engine:"PixiJS",
      ready:true,
      fallback:true,
      error:lastError
    });
  }
}

function ready(){
  if(!readyPromise)readyPromise=initialize();
  return readyPromise;
}

function status(){
  return Object.freeze({
    mode:selectedMode,
    backend:selectedBackend,
    webgpuAvailable:Boolean(navigator.gpu),
    engineVersion:window.PlayCanvasRendererFactory?.engineVersion||null,
    error:lastError
  });
}

window.RendererBootstrap=Object.freeze({
  ready,
  status,
  modeKey:MODE_KEY,
  backendKey:BACKEND_KEY
});
})();