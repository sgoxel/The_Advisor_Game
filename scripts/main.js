(function(){
"use strict";
async function start(){
  try{
    await window.RendererBootstrap?.ready?.();
    await AppUI.init();
  }catch(error){
    console.error("Application startup failed.",error);
    throw error;
  }
}
function loadInterior(){
  if(window.InteriorObjects){start();return;}
  const script=document.createElement("script");
  script.src="scripts/world/interior-objects.js";
  script.onload=start;
  script.onerror=()=>{console.error("Failed to load interior object foundation.");start();};
  document.head.appendChild(script);
}
function loadRuntimeTextureResolution(){
  if(window.RuntimeTextureResolution){loadInterior();return;}
  const script=document.createElement("script");
  script.src="scripts/render/runtime-texture-resolution.js";
  script.onload=loadInterior;
  script.onerror=()=>{console.error("Failed to load runtime texture resolution settings.");loadInterior();};
  document.head.appendChild(script);
}
function boot(){
  if(window.GameRenderer?.__dimetricPresentationFix){loadRuntimeTextureResolution();return;}
  const script=document.createElement("script");
  script.src="scripts/render/dimetric-presentation-fix.js";
  script.onload=loadRuntimeTextureResolution;
  script.onerror=()=>{console.error("Failed to load dimetric presentation correction.");loadRuntimeTextureResolution();};
  document.head.appendChild(script);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();
