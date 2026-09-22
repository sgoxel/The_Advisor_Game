(function(){
"use strict";
function start(){AppUI.init()}
function loadInterior(){
  if(window.InteriorObjects){start();return;}
  const script=document.createElement("script");
  script.src="scripts/world/interior-objects.js";
  script.onload=start;
  script.onerror=()=>{console.error("Failed to load interior object foundation.");start();};
  document.head.appendChild(script);
}
function boot(){
  if(window.GameRenderer?.__dimetricPresentationFix){loadInterior();return;}
  const script=document.createElement("script");
  script.src="scripts/render/dimetric-presentation-fix.js";
  script.onload=loadInterior;
  script.onerror=()=>{console.error("Failed to load dimetric presentation correction.");loadInterior();};
  document.head.appendChild(script);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();
