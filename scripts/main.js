(function(){
"use strict";
function start(){AppUI.init()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
else start();
})();
