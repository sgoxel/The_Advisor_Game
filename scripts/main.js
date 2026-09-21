(function(){
"use strict";
function start(){SeedUI.init()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
else start();
})();