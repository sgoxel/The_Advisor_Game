(function(root){
"use strict";

const VERSION="1.0.0";
const SAFE=8;
const Z_BASE=40;
const configs=[
  {selector:"#localEventVignette",key:"local-event",handle:".local-event-kicker",title:"Local Event"},
  {selector:".planet-places-panel",key:"places",handle:".planet-places-head",close:".planet-places-close",title:"Places"},
  {selector:"#advisorChatPanel",key:"advisor-chat",handle:".advisor-chat-head",close:".advisor-chat-close",title:"Advisor"},
  {selector:"#advisorToolbeltPanel",key:"advisor-toolbelt",handle:".advisor-toolbelt-head",close:".advisor-toolbelt-close",title:"Toolbelt"},
  {selector:"#advisorEconomyPanel",key:"advisor-economy",handle:".advisor-econ-head",close:".advisor-econ-close",title:"Economy"}
];
const states=new Map();
const registry=new Map();
let zCounter=Z_BASE;
let drag=null;
let observer=null;
let dock=null;
const telemetry={registerCount:0,activeCount:0,minimizedCount:0,dragStartCount:0,dragEndCount:0,clampCorrections:0,focusChanges:0,worldInputSuppressions:0,closeCount:0,restoreCount:0,resizeCount:0};

function stateFor(key){
  if(!states.has(key))states.set(key,{x:null,y:null,minimized:false,closedInstance:null,z:++zCounter});
  return states.get(key);
}
function instanceKey(node,key){
  return String(node?.dataset?.windowInstance||node?.dataset?.eventId||node?.dataset?.eventType||key);
}
function ensureDock(){
  if(typeof document==="undefined")return null;
  if(dock&&dock.isConnected)return dock;
  dock=document.getElementById("windowShellDock");
  if(!dock){
    dock=document.createElement("nav");
    dock.id="windowShellDock";
    dock.className="window-shell-dock";
    dock.setAttribute("aria-label","Minimized windows");
    document.body.appendChild(dock);
  }
  return dock;
}
function focus(key,node){
  const s=stateFor(key);s.z=++zCounter;
  if(node)node.style.zIndex=String(s.z);
  telemetry.focusChanges++;
}
function clampValue(v,min,max){return Math.max(min,Math.min(max,v))}
function clampNode(key,node){
  if(!node||node.hidden)return;
  const s=stateFor(key),r=node.getBoundingClientRect();
  if(!r.width||!r.height)return;
  const maxX=Math.max(SAFE,innerWidth-Math.min(r.width,innerWidth-SAFE*2)-SAFE);
  const maxY=Math.max(SAFE,innerHeight-Math.min(r.height,innerHeight-SAFE*2)-SAFE);
  let x=s.x==null?r.left:s.x,y=s.y==null?r.top:s.y;
  const nx=clampValue(x,SAFE,maxX),ny=clampValue(y,SAFE,maxY);
  if(nx!==x||ny!==y)telemetry.clampCorrections++;
  s.x=nx;s.y=ny;
  node.style.position="fixed";
  node.style.left=nx+"px";
  node.style.top=ny+"px";
  node.style.right="auto";
  node.style.bottom="auto";
  node.style.transform="none";
  node.style.maxWidth="calc(100vw - 16px)";
  node.style.maxHeight="calc(100vh - 16px)";
  node.style.zIndex=String(s.z);
}
function setMinimized(key,value){
  const rec=registry.get(key),s=stateFor(key);s.minimized=Boolean(value);
  if(rec?.node)rec.node.hidden=s.minimized||Boolean(s.closedInstance);
  syncDock();
}
function clearClosedForNewInstance(key,node){
  const s=stateFor(key);
  if(s.closedInstance&&s.closedInstance!==instanceKey(node,key))s.closedInstance=null;
}
function closeWindow(key){
  const rec=registry.get(key),s=stateFor(key);
  s.minimized=false;
  s.closedInstance=instanceKey(rec?.node,key);
  if(rec?.node)rec.node.hidden=true;
  telemetry.closeCount++;
  syncDock();
}
function restoreWindow(key){
  const rec=registry.get(key),s=stateFor(key);
  s.minimized=false;s.closedInstance=null;
  if(rec?.node){rec.node.hidden=false;clampNode(key,rec.node);focus(key,rec.node);}
  telemetry.restoreCount++;
  syncDock();
}
function syncDock(){
  const d=ensureDock();if(!d)return;
  d.replaceChildren();
  for(const cfg of configs){
    const s=states.get(cfg.key);if(!s?.minimized)continue;
    const b=document.createElement("button");
    b.type="button";b.className="window-shell-dock-item";b.dataset.windowKey=cfg.key;
    b.setAttribute("aria-label","Restore "+cfg.title);
    b.innerHTML='<span aria-hidden="true">▣</span><b>'+cfg.title+'</b>';
    b.addEventListener("click",()=>restoreWindow(cfg.key));
    d.appendChild(b);
  }
  d.hidden=!d.childElementCount;
  telemetry.minimizedCount=d.childElementCount;
}
function button(label,cls,text,handler){
  const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=text;b.setAttribute("aria-label",label);b.addEventListener("click",e=>{e.stopPropagation();handler();});return b;
}
function installControls(cfg,node,handle){
  handle.classList.add("window-shell-handle");
  let min=node.querySelector(":scope .window-shell-minimize");
  if(!min){
    min=button("Minimize "+cfg.title,"window-shell-minimize","—",()=>setMinimized(cfg.key,true));
    const close=cfg.close?node.querySelector(cfg.close):null;
    if(close?.parentNode===handle)handle.insertBefore(min,close);else handle.appendChild(min);
  }
  let close=cfg.close?node.querySelector(cfg.close):null;
  if(close){
    close.setAttribute("aria-label",close.getAttribute("aria-label")||("Close "+cfg.title));
    if(!close.dataset.windowShellBound){
      close.dataset.windowShellBound="true";
      close.addEventListener("click",()=>{const s=stateFor(cfg.key);s.minimized=false;s.closedInstance=null;telemetry.closeCount++;syncDock();},{capture:true});
    }
  }else if(!node.querySelector(":scope .window-shell-close")){
    close=button("Close "+cfg.title,"window-shell-close","×",()=>closeWindow(cfg.key));
    handle.appendChild(close);
  }
}
function suppress(e){e.stopPropagation();telemetry.worldInputSuppressions++;}
function bindDrag(cfg,node,handle){
  if(handle.dataset.windowShellDragBound)return;
  handle.dataset.windowShellDragBound="true";
  handle.addEventListener("pointerdown",e=>{
    if(e.button!==undefined&&e.button!==0)return;
    if(e.target.closest("button,input,textarea,select,a,summary"))return;
    const r=node.getBoundingClientRect(),s=stateFor(cfg.key);
    focus(cfg.key,node);
    s.x=r.left;s.y=r.top;
    drag={key:cfg.key,node,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,baseX:r.left,baseY:r.top};
    telemetry.dragStartCount++;suppress(e);
    try{handle.setPointerCapture(e.pointerId)}catch(_){}
    document.body.classList.add("window-shell-dragging");
  },true);
  handle.addEventListener("pointermove",e=>{
    if(!drag||drag.key!==cfg.key||drag.pointerId!==e.pointerId)return;
    const s=stateFor(cfg.key);s.x=drag.baseX+(e.clientX-drag.startX);s.y=drag.baseY+(e.clientY-drag.startY);
    clampNode(cfg.key,node);suppress(e);
  },true);
  const end=e=>{
    if(!drag||drag.key!==cfg.key||drag.pointerId!==e.pointerId)return;
    clampNode(cfg.key,node);drag=null;telemetry.dragEndCount++;suppress(e);document.body.classList.remove("window-shell-dragging");
  };
  handle.addEventListener("pointerup",end,true);handle.addEventListener("pointercancel",end,true);
  node.addEventListener("pointerdown",()=>focus(cfg.key,node),true);
}
function register(cfg,node){
  if(!node)return null;
  const existing=registry.get(cfg.key);
  if(existing?.node===node){applyState(cfg,node);return existing;}
  const handle=node.querySelector(cfg.handle)||node;
  node.dataset.windowShell=cfg.key;
  node.dataset.windowShellVersion=VERSION;
  installControls(cfg,node,handle);bindDrag(cfg,node,handle);
  registry.set(cfg.key,{cfg,node,handle});
  telemetry.registerCount++;
  applyState(cfg,node);
  return registry.get(cfg.key);
}
function applyState(cfg,node){
  clearClosedForNewInstance(cfg.key,node);
  const s=stateFor(cfg.key);
  if(s.closedInstance===instanceKey(node,cfg.key)||s.minimized){node.hidden=true;syncDock();return;}
  if(!node.hidden)clampNode(cfg.key,node);
  focus(cfg.key,node);syncDock();
}
function scan(){
  if(typeof document==="undefined")return;
  for(const cfg of configs)for(const node of document.querySelectorAll(cfg.selector))register(cfg,node);
  telemetry.activeCount=[...registry.values()].filter(r=>r.node?.isConnected&&!r.node.hidden).length;
}
function refresh(node){
  if(!node){scan();return}
  const cfg=configs.find(c=>node.matches?.(c.selector));if(cfg)register(cfg,node);
}
function onResize(){telemetry.resizeCount++;for(const [key,rec] of registry)if(rec.node?.isConnected&&!rec.node.hidden)clampNode(key,rec.node);syncDock();}
function snapshot(){
  const windows={};
  for(const cfg of configs){const rec=registry.get(cfg.key),s=stateFor(cfg.key),r=rec?.node?.isConnected?rec.node.getBoundingClientRect():null;windows[cfg.key]={registered:Boolean(rec?.node?.isConnected),visible:Boolean(rec?.node?.isConnected&&!rec.node.hidden),minimized:s.minimized,closedInstance:s.closedInstance,position:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null,z:s.z};}
  return Object.freeze({version:VERSION,dragging:Boolean(drag),telemetry:{...telemetry},windows});
}
function start(){
  if(typeof document==="undefined")return;
  ensureDock();scan();
  if(!observer){observer=new MutationObserver(()=>scan());observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden","data-event-id","data-window-instance"]});}
  addEventListener("resize",onResize,{passive:true});
  addEventListener("orientationchange",onResize,{passive:true});
  document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;const visible=[...registry.entries()].filter(([,r])=>r.node?.isConnected&&!r.node.hidden).sort((a,b)=>stateFor(b[0]).z-stateFor(a[0]).z);const top=visible[0];if(!top)return;const [key,rec]=top;const native=rec.cfg.close?rec.node.querySelector(rec.cfg.close):null;if(native)native.click();else closeWindow(key);});
}
root.WindowShell=Object.freeze({VERSION,start,scan,refresh,snapshot,restore:restoreWindow,minimize:key=>setMinimized(key,true),close:closeWindow,isDragging:()=>Boolean(drag)});
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();}
})(typeof window!=="undefined"?window:globalThis);
