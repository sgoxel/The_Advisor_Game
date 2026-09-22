(function(){
"use strict";

const PANEL_KEYS=Object.freeze({
  z:"info",
  x:"interactions",
  c:"map"
});
const TERRAIN_COLORS=Object.freeze({
  water:"#476b7c",
  grass:"#6f8a59",
  forest:"#405e43",
  dirt:"#80664d",
  mud:"#5f5947",
  rock:"#717873",
  sand:"#aa946c",
  farmland:"#857143",
  road:"#8b7d68",
  floor:"#8c785d"
});

let deck=null;
let gameplay=null;
let downButton=null;
let upButton=null;
let miniMap=null;
let miniCtx=null;
let lastPointerInput=null;
let intersectionObserver=null;
let mutationObserver=null;

function isPortrait(){
  return window.matchMedia("(orientation: portrait)").matches || innerHeight>innerWidth;
}
function panelByName(name){
  return document.querySelector('.control-panel[data-panel="'+name+'"]');
}
function toggleFor(panel){
  return panel ? panel.querySelector(".control-panel-title") : null;
}
function markInput(type,action){
  if(!deck)return;
  if(type==="keyboard")deck.dataset.keyboardUsed="true";
  if(type==="mouse")deck.dataset.mouseUsed="true";
  if(type==="touch")deck.dataset.touchUsed="true";
  deck.dataset.lastInput=type||"unknown";
  if(action)deck.dataset.lastAction=action;
}
function setPanel(name,expanded,inputType){
  const panel=panelByName(name);
  if(!panel)return;
  panel.dataset.collapsed=expanded?"false":"true";
  const toggle=toggleFor(panel);
  if(toggle)toggle.setAttribute("aria-expanded",expanded?"true":"false");
  if(inputType)markInput(inputType,"panel:"+name+":"+(expanded?"open":"closed"));
}
function focusPanel(name,inputType){
  const panel=panelByName(name);
  if(!panel)return;
  if(isPortrait()){
    setPanel(name,true,inputType);
    panel.scrollIntoView({behavior:"auto",block:"start"});
  }else{
    markInput(inputType,"panel:"+name+":focus");
    toggleFor(panel)?.focus({preventScroll:true});
  }
}
function goControls(inputType){
  markInput(inputType,"navigate:controls");
  deck?.scrollIntoView({behavior:"auto",block:"start"});
}
function goGameplay(inputType){
  markInput(inputType,"navigate:gameplay");
  gameplay?.scrollIntoView({behavior:"auto",block:"start"});
}
function eventInput(event){
  if(event?.pointerType==="touch")return "touch";
  if(event?.pointerType==="mouse")return "mouse";
  return lastPointerInput||"mouse";
}
function installPanelControls(){
  document.querySelectorAll(".control-panel").forEach(panel=>{
    const toggle=toggleFor(panel);
    if(!toggle)return;
    toggle.addEventListener("click",event=>{
      if(!isPortrait()){
        markInput(eventInput(event),"panel:"+panel.dataset.panel+":focus");
        return;
      }
      const expanded=panel.dataset.collapsed==="true";
      setPanel(panel.dataset.panel,expanded,eventInput(event));
    });
    toggle.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" ")markInput("keyboard","panel-key:"+panel.dataset.panel);
    });
  });
}
function installInputParity(){
  document.addEventListener("pointerdown",event=>{
    const target=event.target instanceof Element ? event.target.closest(".control-deck,.portrait-nav") : null;
    if(!target)return;
    lastPointerInput=event.pointerType==="touch"?"touch":"mouse";
    markInput(lastPointerInput,"pointer:"+lastPointerInput);
  },true);

  downButton?.addEventListener("click",event=>goControls(eventInput(event)));
  upButton?.addEventListener("click",event=>goGameplay(eventInput(event)));
  downButton?.addEventListener("keydown",event=>{
    if(event.key==="Enter"||event.key===" ")markInput("keyboard","navigate:controls");
  });
  upButton?.addEventListener("keydown",event=>{
    if(event.key==="Enter"||event.key===" ")markInput("keyboard","navigate:gameplay");
  });

  document.addEventListener("keydown",event=>{
    if(event.ctrlKey||event.altKey||event.metaKey)return;
    if(event.target&&["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName))return;
    const key=String(event.key||"").toLowerCase();
    if(PANEL_KEYS[key]){
      event.preventDefault();
      focusPanel(PANEL_KEYS[key],"keyboard");
      return;
    }
    if(key==="v"){
      event.preventDefault();
      goControls("keyboard");
      return;
    }
    if(key==="g"){
      event.preventDefault();
      goGameplay("keyboard");
    }
  });
}
function drawMiniMap(){
  if(!miniMap||!miniCtx)return;
  const width=miniMap.width;
  const height=miniMap.height;
  miniCtx.clearRect(0,0,width,height);
  miniCtx.fillStyle="#10140f";
  miniCtx.fillRect(0,0,width,height);

  const snapshot=window.GameRenderer?.snapshot?.()||{};
  const cells=Array.isArray(snapshot.cells)?snapshot.cells:[];
  const grid=snapshot.grid||{};
  const columns=Number(grid.columns||0);
  const rows=Number(grid.rows||0);
  if(columns>0&&rows>0&&cells.length===columns*rows){
    const cellW=width/columns;
    const cellH=height/rows;
    for(let row=0;row<rows;row++){
      for(let col=0;col<columns;col++){
        const raw=cells[row*columns+col];
        const type=typeof raw==="string"?raw:(raw?.type||"grass");
        miniCtx.fillStyle=TERRAIN_COLORS[type]||"#65705f";
        miniCtx.fillRect(col*cellW,row*cellH,Math.ceil(cellW+.3),Math.ceil(cellH+.3));
      }
    }
  }else{
    miniCtx.strokeStyle="rgba(190,205,181,.16)";
    miniCtx.lineWidth=1;
    for(let x=0;x<=width;x+=24){miniCtx.beginPath();miniCtx.moveTo(x,0);miniCtx.lineTo(x,height);miniCtx.stroke();}
    for(let y=0;y<=height;y+=22){miniCtx.beginPath();miniCtx.moveTo(0,y);miniCtx.lineTo(width,y);miniCtx.stroke();}
  }
  miniCtx.strokeStyle="rgba(244,248,238,.9)";
  miniCtx.lineWidth=2;
  miniCtx.beginPath();
  miniCtx.moveTo(width/2-7,height/2);
  miniCtx.lineTo(width/2+7,height/2);
  miniCtx.moveTo(width/2,height/2-7);
  miniCtx.lineTo(width/2,height/2+7);
  miniCtx.stroke();

  const camera=document.getElementById("cameraCoordinate")?.textContent?.trim()||"(0,0)";
  const protagonist=document.getElementById("protagonistLocation")?.textContent?.trim()||"—";
  const cameraReadout=document.getElementById("miniMapCamera");
  const protagonistReadout=document.getElementById("miniMapProtagonist");
  if(cameraReadout)cameraReadout.textContent=camera;
  if(protagonistReadout)protagonistReadout.textContent=protagonist;
}
function syncOrientation(){
  document.body.classList.toggle("control-deck-portrait",isPortrait());
  drawMiniMap();
}
function rect(selector){
  const node=document.querySelector(selector);
  if(!node)return null;
  const r=node.getBoundingClientRect();
  return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
}
function visible(selector){
  const node=document.querySelector(selector);
  if(!node)return false;
  const style=getComputedStyle(node);
  const r=node.getBoundingClientRect();
  return style.display!=="none"&&style.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;
}
function snapshot(){
  const deckRect=rect("#controlDeck");
  const gameRect=rect("#gameplayArea");
  const infoRect=rect("#characterInfoPanel");
  const interactionsRect=rect("#characterInteractionsPanel");
  const mapRect=rect("#miniMapPanel");
  const advisor=document.getElementById("advisorPanel");
  const interactions=document.getElementById("characterInteractionsPanel");
  const panels={};
  document.querySelectorAll(".control-panel").forEach(panel=>{
    panels[panel.dataset.panel]={
      collapsed:panel.dataset.collapsed==="true",
      expanded:toggleFor(panel)?.getAttribute("aria-expanded")==="true"
    };
  });
  const portrait=isPortrait();
  const sideBySide=!portrait&&Boolean(
    infoRect&&interactionsRect&&mapRect&&
    Math.abs(infoRect.top-interactionsRect.top)<3&&
    Math.abs(infoRect.top-mapRect.top)<3&&
    infoRect.right<=interactionsRect.left+3&&
    interactionsRect.right<=mapRect.left+3
  );
  const deckDocumentTop=deckRect?deckRect.top+scrollY:0;
  const gameDocumentBottom=gameRect?gameRect.bottom+scrollY:0;
  return {
    portrait,
    viewport:{width:innerWidth,height:innerHeight},
    scrollY:Number(scrollY||0),
    documentScrollHeight:Number(document.documentElement.scrollHeight||0),
    deck:deckRect,
    gameplay:gameRect,
    deckHeightRatio:deckRect&&innerHeight?deckRect.height/innerHeight:0,
    sideBySide,
    controlsBelowGameplay:Boolean(deckRect&&gameRect&&deckDocumentTop>=gameDocumentBottom-3),
    deckVisible:visible("#controlDeck"),
    downVisible:visible("#controlsDownButton"),
    upVisible:visible("#gameplayUpButton"),
    advisorInInteractions:Boolean(advisor&&interactions?.contains(advisor)),
    gameplayCanvasCount:document.querySelectorAll("#gameplayArea canvas").length,
    horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,
    keyboardUsed:deck?.dataset.keyboardUsed==="true",
    mouseUsed:deck?.dataset.mouseUsed==="true",
    touchUsed:deck?.dataset.touchUsed==="true",
    lastInput:deck?.dataset.lastInput||null,
    lastAction:deck?.dataset.lastAction||null,
    panels
  };
}
function init(){
  deck=document.getElementById("controlDeck");
  gameplay=document.getElementById("gameplayArea");
  downButton=document.getElementById("controlsDownButton");
  upButton=document.getElementById("gameplayUpButton");
  miniMap=document.getElementById("miniMapCanvas");
  miniCtx=miniMap?.getContext?.("2d")||null;
  if(!deck||!gameplay)return;

  installPanelControls();
  installInputParity();
  syncOrientation();

  const media=window.matchMedia("(orientation: portrait)");
  media.addEventListener?.("change",syncOrientation);
  window.addEventListener("resize",syncOrientation,{passive:true});

  if("IntersectionObserver" in window){
    intersectionObserver=new IntersectionObserver(entries=>{
      const entry=entries[0];
      document.body.classList.toggle("control-deck-in-view",Boolean(entry&&entry.isIntersecting&&entry.intersectionRatio>.12));
    },{threshold:[0,.12,.35]});
    intersectionObserver.observe(deck);
  }

  if("MutationObserver" in window){
    mutationObserver=new MutationObserver(()=>drawMiniMap());
    ["cameraCoordinate","protagonistLocation","campaignState","terrainGrid"].forEach(id=>{
      const node=document.getElementById(id);
      if(node)mutationObserver.observe(node,{subtree:true,childList:true,characterData:true,attributes:id==="terrainGrid"});
    });
  }
}
window.ResponsiveControlDeck=Object.freeze({snapshot,drawMiniMap,goControls,goGameplay,focusPanel});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
})();