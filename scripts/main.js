(function(){
"use strict";
function start(){AppUI.init()}
function boot(){
  if(window.InteriorObjects){start();return;}
  const script=document.createElement("script");
  script.src="scripts/world/interior-objects.js";
  script.onload=start;
  script.onerror=()=>{console.error("Failed to load interior object foundation.");start();};
  document.head.appendChild(script);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
})();
