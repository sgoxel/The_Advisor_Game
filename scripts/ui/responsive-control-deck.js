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
  path:"#8a7559",
  square:"#9a8b72",
  bridge:"#9c8766",
  floor:"#8c785d"
});

let deck=null;
let gameplay=null;
let downButton=null;
let upButton=null;
let miniMap=null;
let miniCtx=null;
let miniMapState=Object.freeze({ready:false,source:"none",simulationAuthorityPreserved:true});
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

  const renderer=window.GameRenderer?.snapshot?.()||{};
  const terrain=renderer?.frame?.localTerrain||renderer?.localTerrain||null;
  const simulation=renderer?.simulationSnapshot||window.RendererContract?.simulationSnapshot?.()||null;
  const cells=Array.isArray(terrain?.cells)?terrain.cells:[];
  const columns=Number(terrain?.columns||0);
  const rows=Number(terrain?.rows||0);
  const ready=Boolean(terrain?.ready&&columns>0&&rows>0&&cells.length===columns*rows);
  const basis=terrain?.projectionBasis||{x:.66,y:.28};
  const basisX=Math.max(.01,Number(basis.x)||.66);
  const basisY=Math.max(.01,Number(basis.y)||.28);
  const padding=10;
  let scale=1;
  let markerPoint=()=>null;

  if(ready){
    const logicalSpan=Math.max(1,columns+rows-2);
    scale=Math.max(.1,Math.min(
      (width-padding*2)/(logicalSpan*basisX),
      (height-padding*2)/(logicalSpan*basisY)
    ));
    const halfW=Math.max(.6,basisX*scale);
    const halfH=Math.max(.35,basisY*scale);
    const centerCol=(columns-1)/2;
    const centerRow=(rows-1)/2;

    for(const cell of cells){
      const col=Number(cell?.col);
      const row=Number(cell?.row);
      if(!Number.isFinite(col)||!Number.isFinite(row))continue;
      const dx=col-centerCol;
      const dy=row-centerRow;
      const x=width/2+(dx-dy)*basisX*scale;
      const y=height/2+(dx+dy)*basisY*scale;
      miniCtx.fillStyle=TERRAIN_COLORS[String(cell?.type||"grass")]||"#65705f";
      miniCtx.beginPath();
      miniCtx.moveTo(x,y-halfH);
      miniCtx.lineTo(x+halfW,y);
      miniCtx.lineTo(x,y+halfH);
      miniCtx.lineTo(x-halfW,y);
      miniCtx.closePath();
      miniCtx.fill();
    }

    markerPoint=point=>{
      if(!point||!terrain?.center)return null;
      try{
        const dx=Number(BigInt(String(point.x))-BigInt(String(terrain.center.x)));
        const dy=Number(BigInt(String(point.y))-BigInt(String(terrain.center.y)));
        if(!Number.isSafeInteger(dx)||!Number.isSafeInteger(dy))return null;
        return Object.freeze({
          x:Number((width/2+(dx-dy)*basisX*scale).toFixed(3)),
          y:Number((height/2+(dx+dy)*basisY*scale).toFixed(3)),
          dx,dy
        });
      }catch(_){return null}
    };
  }else{
    miniCtx.strokeStyle="rgba(190,205,181,.16)";
    miniCtx.lineWidth=1;
    for(let x=0;x<=width;x+=24){miniCtx.beginPath();miniCtx.moveTo(x,0);miniCtx.lineTo(x,height);miniCtx.stroke();}
    for(let y=0;y<=height;y+=22){miniCtx.beginPath();miniCtx.moveTo(0,y);miniCtx.lineTo(width,y);miniCtx.stroke();}
  }

  const camera=simulation?.cameraCenter||terrain?.center||null;
  const protagonist=simulation?.protagonist||renderer?.frame?.protagonistWorld||null;
  const cameraMarker=ready?markerPoint(camera):null;
  const protagonistMarker=ready?markerPoint(protagonist):null;

  if(cameraMarker){
    miniCtx.save();
    miniCtx.strokeStyle="rgba(244,248,238,.98)";
    miniCtx.fillStyle="#f4f8ee";
    miniCtx.lineWidth=2;
    miniCtx.beginPath();
    miniCtx.moveTo(cameraMarker.x-7,cameraMarker.y);
    miniCtx.lineTo(cameraMarker.x+7,cameraMarker.y);
    miniCtx.moveTo(cameraMarker.x,cameraMarker.y-7);
    miniCtx.lineTo(cameraMarker.x,cameraMarker.y+7);
    miniCtx.stroke();
    miniCtx.font="700 9px Arial";
    miniCtx.fillText("C",cameraMarker.x+8,cameraMarker.y-5);
    miniCtx.restore();
  }
  if(protagonistMarker){
    miniCtx.save();
    miniCtx.strokeStyle="#f2c968";
    miniCtx.fillStyle="rgba(242,201,104,.24)";
    miniCtx.lineWidth=2.5;
    miniCtx.beginPath();
    miniCtx.arc(protagonistMarker.x,protagonistMarker.y,6,0,Math.PI*2);
    miniCtx.fill();
    miniCtx.stroke();
    miniCtx.font="700 9px Arial";
    miniCtx.fillStyle="#ffe29a";
    miniCtx.fillText("P",protagonistMarker.x+8,protagonistMarker.y+10);
    miniCtx.restore();
  }

  const formatPoint=point=>point?"("+String(point.x)+","+String(point.y)+")":"—";
  const cameraReadout=document.getElementById("miniMapCamera");
  const protagonistReadout=document.getElementById("miniMapProtagonist");
  if(cameraReadout)cameraReadout.textContent=formatPoint(camera);
  if(protagonistReadout)protagonistReadout.textContent=formatPoint(protagonist);

  const worldRange=(()=>{
    if(!ready||!terrain?.center)return null;
    try{
      const cx=BigInt(String(terrain.center.x));
      const cy=BigInt(String(terrain.center.y));
      const halfCols=Math.floor(columns/2);
      const halfRows=Math.floor(rows/2);
      return Object.freeze({
        minX:(cx-BigInt(halfCols)).toString(),
        maxX:(cx+BigInt(columns-halfCols-1)).toString(),
        minY:(cy-BigInt(halfRows)).toString(),
        maxY:(cy+BigInt(rows-halfRows-1)).toString()
      });
    }catch(_){return null}
  })();
  const canvasVisibility=(()=>{
    const r=miniMap.getBoundingClientRect();
    const panel=miniMap.closest(".control-panel")?.getBoundingClientRect?.()||null;
    const left=Math.max(0,r.left,panel?.left??0);
    const top=Math.max(0,r.top,panel?.top??0);
    const right=Math.min(innerWidth,r.right,panel?.right??innerWidth);
    const bottom=Math.min(innerHeight,r.bottom,panel?.bottom??innerHeight);
    return Object.freeze({
      width:Number(r.width.toFixed(3)),
      height:Number(r.height.toFixed(3)),
      visibleWidth:Number(Math.max(0,right-left).toFixed(3)),
      visibleHeight:Number(Math.max(0,bottom-top).toFixed(3))
    });
  })();

  miniMapState=Object.freeze({
    ready,
    source:ready?String(terrain?.source||"renderer-frame"):"none",
    generatedForMiniMap:Boolean(terrain?.generatedForMiniMap),
    columns,
    rows,
    tileCount:cells.length,
    regionKey:terrain?.regionKey||renderer?.regionKey||null,
    center:terrain?.center||null,
    worldRange,
    canvasVisibility,
    projection:String(terrain?.projection||"soft-dimetric"),
    projectionBasis:Object.freeze({x:basisX,y:basisY}),
    camera,
    protagonist,
    cameraMarker,
    protagonistMarker,
    cameraProtagonistDistinct:Boolean(cameraMarker&&protagonistMarker&&(Math.abs(cameraMarker.x-protagonistMarker.x)>1||Math.abs(cameraMarker.y-protagonistMarker.y)>1)),
    chunkSize:Number(renderer?.terrainChunks?.chunkSize||0),
    zoom:Number(simulation?.cameraZoom||renderer?.frame?.cameraZoom||0),
    revisionKey:ready?[
      String(terrain?.regionKey||""),
      String(terrain?.center?.x||""),
      String(terrain?.center?.y||""),
      String(cells.length),
      String(simulation?.cameraZoom||renderer?.frame?.cameraZoom||"")
    ].join("|"):"",
    orientationMatchesGameplay:ready&&String(terrain?.projection||"")==="soft-dimetric",
    usesPreparedRendererFrame:ready&&String(terrain?.source||"")==="renderer-frame"&&!terrain?.generatedForMiniMap,
    simulationAuthorityPreserved:terrain?.simulationAuthorityPreserved!==false
  });
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
    developmentMode:document.body.classList.contains("development-mode"),
    developmentDetailsVisible:visible("#developmentDetails"),
    gameplayCanvasCount:document.querySelectorAll("#gameplayArea canvas").length,
    horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2,
    keyboardUsed:deck?.dataset.keyboardUsed==="true",
    mouseUsed:deck?.dataset.mouseUsed==="true",
    touchUsed:deck?.dataset.touchUsed==="true",
    lastInput:deck?.dataset.lastInput||null,
    lastAction:deck?.dataset.lastAction||null,
    miniMap:miniMapState,
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