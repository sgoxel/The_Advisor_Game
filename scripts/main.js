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
function loadResidentMovement(){
  if(window.ResidentMovement){start();return;}
  const script=document.createElement("script");
  script.src="scripts/world/resident-movement.js";
  script.onload=start;
  script.onerror=()=>{console.error("Failed to load resident movement simulation.");start();};
  document.head.appendChild(script);
}
function loadActionExecutor(){
  if(window.ActionExecutor){loadResidentMovement();return;}
  const script=document.createElement("script");
  script.src="scripts/world/action-executor.js";
  script.onload=loadResidentMovement;
  script.onerror=()=>{console.error("Failed to load action executor.");loadResidentMovement();};
  document.head.appendChild(script);
}
function loadInterior(){
  if(window.InteriorObjects){loadActionExecutor();return;}
  const script=document.createElement("script");
  script.src="scripts/world/interior-objects.js";
  script.onload=loadActionExecutor;
  script.onerror=()=>{console.error("Failed to load interior object foundation.");loadActionExecutor();};
  document.head.appendChild(script);
}
function loadTerrainChunkSizeSettings(){
  if(window.TerrainChunkSizeSettings){loadInterior();return;}
  const script=document.createElement("script");
  script.src="scripts/render/terrain-chunk-size-settings.js";
  script.onload=loadInterior;
  script.onerror=()=>{console.error("Failed to load terrain chunk size settings.");loadInterior();};
  document.head.appendChild(script);
}
function loadRuntimeRenderQuality(){
  if(window.RuntimeRenderQuality){loadTerrainChunkSizeSettings();return;}
  const script=document.createElement("script");
  script.src="scripts/render/runtime-render-quality.js";
  script.onload=loadTerrainChunkSizeSettings;
  script.onerror=()=>{console.error("Failed to load adaptive render quality settings.");loadTerrainChunkSizeSettings();};
  document.head.appendChild(script);
}
function loadRuntimeTextureResolution(){
  if(window.RuntimeTextureResolution){loadRuntimeRenderQuality();return;}
  const script=document.createElement("script");
  script.src="scripts/render/runtime-texture-resolution.js";
  script.onload=loadRuntimeRenderQuality;
  script.onerror=()=>{console.error("Failed to load runtime texture resolution settings.");loadRuntimeRenderQuality();};
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
