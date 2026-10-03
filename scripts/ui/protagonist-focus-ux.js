(function(root){
"use strict";

const VERSION="protagonist-focus-ux-v1";
const UPDATE_INTERVAL_MS=240;
const FOLLOW_INTERVAL_MS=180;
const FOLLOW_STEP_MAX_METERS=6;
const DEAD_ZONE_FRACTION=.18;
const DEAD_ZONE_MIN_METERS=3;
const DEAD_ZONE_MAX_METERS=24;
const SETTLE_ZONE_FACTOR=.55;
const ACTOR_ID="protagonist";

const state={
  version:VERSION,
  ready:false,
  mode:"boot",
  actorId:ACTOR_ID,
  selectedTargetId:ACTOR_ID,
  selectedTargetType:"protagonist",
  source:"startup",
  autoStartEnabled:true,
  autoStartApplied:false,
  returnCount:0,
  forcedReturnCount:0,
  remoteExplorationCount:0,
  remoteSinceMs:null,
  lastReturnAtMs:null,
  lastRemoteAtMs:null,
  follow:{
    enabled:true,
    active:false,
    inDeadZone:true,
    deadZoneMeters:null,
    settleZoneMeters:null,
    distanceMeters:null,
    stepCount:0,
    maxStepMeters:0,
    hardSnapCount:0,
    lastStepMeters:0,
    lastStepAtMs:null
  },
  telemetry:{
    protagonistPosition:null,
    cameraFocusTile:null,
    projectedProtagonist:null,
    unobscuredGameplayRect:null,
    contextWidgetBounds:null,
    activeFootprint:null,
    focusNavigation:null,
    frameTimeMs:null,
    navigationTimingMs:null,
    simulationMutation:false,
    simulationAuthorityPreserved:true,
    fullWorldScan:false
  },
  pointer:{down:false,x:0,y:0,moved:false},
  timers:{update:null,follow:null},
  hud:null,
  returnButton:null,
  modeNode:null,
  titleNode:null,
  activityNode:null,
  locationNode:null
};

function now(){return root.performance?.now?.()||Date.now()}
function text(value,max=120){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function stage(){return root.PlanetStage||null}
function stageSnapshot(){try{return stage()?.snapshot?.()||null}catch(_){return null}}
function campaign(){try{return root.SeedSystem?.getCampaign?.()||null}catch(_){return null}}
function protagonistPosition(){
  try{
    const direct=root.Protagonist?.getPosition?.();
    if(direct?.x!=null&&direct?.y!=null)return {x:String(direct.x),y:String(direct.y),source:"Protagonist.getPosition"};
  }catch(_){}
  const stored=campaign()?.protagonist;
  if(stored?.x==null||stored?.y==null)return null;
  return {x:String(stored.x),y:String(stored.y),source:"SeedSystem.campaign.protagonist"};
}
function bigint(value){try{return BigInt(String(value))}catch(_){return null}}
function tileDistance(a,b){
  if(!a||!b)return null;
  const ax=bigint(a.x),ay=bigint(a.y),bx=bigint(b.x),by=bigint(b.y);
  if(ax==null||ay==null||bx==null||by==null)return null;
  const dx=Number(ax-bx),dy=Number(ay-by);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  return Math.hypot(dx,dy);
}
function currentFocusTile(snap){
  const t=snap?.canonicalFocus?.worldTile;
  return t?.x!=null&&t?.y!=null?{x:String(t.x),y:String(t.y)}:null;
}
function footprint(snap){
  const w=Number(snap?.zoom?.visibleFootprintWidthMeters||0),h=Number(snap?.zoom?.visibleFootprintHeightMeters||0);
  return Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0?{widthMeters:w,heightMeters:h}:null;
}
function safeAreaInsets(){
  let probe=document.getElementById("protagonistFocusSafeAreaProbe");
  if(!probe){
    probe=document.createElement("div");
    probe.id="protagonistFocusSafeAreaProbe";
    probe.setAttribute("aria-hidden","true");
    Object.assign(probe.style,{position:"fixed",visibility:"hidden",pointerEvents:"none",top:"env(safe-area-inset-top)",right:"env(safe-area-inset-right)",bottom:"env(safe-area-inset-bottom)",left:"env(safe-area-inset-left)"});
    document.body.appendChild(probe);
  }
  const cs=getComputedStyle(probe);
  return {top:parseFloat(cs.top)||0,right:parseFloat(cs.right)||0,bottom:parseFloat(cs.bottom)||0,left:parseFloat(cs.left)||0};
}
function visibleRect(node){
  if(!node||node===state.hud)return null;
  const cs=getComputedStyle(node);
  if(cs.display==="none"||cs.visibility==="hidden"||Number(cs.opacity||1)<=.02)return null;
  const r=node.getBoundingClientRect();
  if(r.width<8||r.height<8)return null;
  return r;
}
function unobscuredGameplayRect(){
  const rootNode=document.getElementById("planetStageRoot")||document.documentElement;
  const base=rootNode.getBoundingClientRect();
  const insets=safeAreaInsets();
  let left=base.left+insets.left,right=base.right-insets.right,top=base.top+insets.top,bottom=base.bottom-insets.bottom;
  const selectors=[".window-shell-dock",".planet-control-deck",".planet-stage-controls",".planet-touch-controls",".advisor-chat-panel","#advisorChatPanel","#advisorToolbeltPanel","#advisorEconomyPanel"];
  for(const selector of selectors){
    for(const node of document.querySelectorAll(selector)){
      const r=visibleRect(node);if(!r)continue;
      const tall=r.height>Math.max(120,(bottom-top)*.42),wide=r.width>Math.max(180,(right-left)*.42);
      if(tall&&r.left<=left+24&&r.right<right-40)left=Math.max(left,r.right+8);
      else if(tall&&r.right>=right-24&&r.left>left+40)right=Math.min(right,r.left-8);
      else if(wide&&r.bottom>=bottom-24&&r.top>top+40)bottom=Math.min(bottom,r.top-8);
      else if(wide&&r.top<=top+24&&r.bottom<bottom-40)top=Math.max(top,r.bottom+8);
    }
  }
  if(right-left<120){left=base.left+insets.left;right=base.right-insets.right}
  if(bottom-top<120){top=base.top+insets.top;bottom=base.bottom-insets.bottom}
  return {left:Number(left.toFixed(1)),top:Number(top.toFixed(1)),right:Number(right.toFixed(1)),bottom:Number(bottom.toFixed(1)),width:Number((right-left).toFixed(1)),height:Number((bottom-top).toFixed(1))};
}
function projectedProtagonist(snap,pos){
  const focusTile=currentFocusTile(snap),fp=footprint(snap),stageRoot=document.getElementById("planetStageRoot");
  if(!focusTile||!fp||!pos||!stageRoot)return null;
  const fx=bigint(focusTile.x),fy=bigint(focusTile.y),px=bigint(pos.x),py=bigint(pos.y);
  if(fx==null||fy==null||px==null||py==null)return null;
  const rect=stageRoot.getBoundingClientRect(),dx=Number(px-fx),dy=Number(py-fy);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  return {
    x:Number((rect.left+rect.width*.5+(dx/fp.widthMeters)*rect.width).toFixed(1)),
    y:Number((rect.top+rect.height*.5-(dy/fp.heightMeters)*rect.height).toFixed(1)),
    deltaMeters:{east:Number(dx.toFixed(2)),north:Number(dy.toFixed(2))}
  };
}
function currentIdentity(seed){
  try{
    const profile=root.ProtagonistProfile?.derive?.(seed,ACTOR_ID);
    const name=profile?.birthIdentity?.fullName||profile?.name;
    if(name)return text(name,72);
  }catch(_){}
  return "Protagonist";
}
function currentActivity(seed){
  try{
    const when=root.GameTime?.getTimestampKey?.()||"";
    const model=root.ProtagonistActivityUI?.currentModel?.({seed,identityKey:ACTOR_ID,when});
    if(model)return {title:text(model.title||model.eyebrow||"Current activity",92),target:model.target?text(model.target,72):null,phase:text(model.phase||"idle",24)};
  }catch(_){}
  return {title:"Current activity unavailable",target:null,phase:"unknown"};
}
function ensureHud(){
  if(state.hud?.isConnected)return state.hud;
  const hud=document.createElement("section");
  hud.id="protagonistFocusHUD";
  hud.className="protagonist-focus-hud";
  hud.dataset.mode=state.mode;
  hud.innerHTML='<div class="protagonist-focus-copy"><span class="protagonist-focus-kicker"><i aria-hidden="true"></i><b data-focus-mode>PRIMARY FOCUS</b></span><strong data-focus-title>Protagonist</strong><span data-focus-activity>Reading current activity…</span><code data-focus-location></code></div><button type="button" class="protagonist-focus-return" aria-label="Return camera to protagonist">Return to Protagonist</button>';
  (document.getElementById("planetStageRoot")||document.body).appendChild(hud);
  state.hud=hud;
  state.returnButton=hud.querySelector(".protagonist-focus-return");
  state.modeNode=hud.querySelector("[data-focus-mode]");
  state.titleNode=hud.querySelector("[data-focus-title]");
  state.activityNode=hud.querySelector("[data-focus-activity]");
  state.locationNode=hud.querySelector("[data-focus-location]");
  state.returnButton.addEventListener("click",()=>returnToProtagonist("player-return"));
  return hud;
}
function setMode(mode,source,targetId,targetType){
  const previous=state.mode;
  state.mode=mode;
  state.source=source||state.source;
  state.selectedTargetId=String(targetId||ACTOR_ID);
  state.selectedTargetType=String(targetType||(mode==="remote"?"place":"protagonist"));
  state.follow.active=false;
  if(mode==="remote"&&previous!=="remote"){
    state.remoteExplorationCount++;
    state.remoteSinceMs=now();
    state.lastRemoteAtMs=state.remoteSinceMs;
  }
  if(state.hud)state.hud.dataset.mode=mode;
}
function enterRemoteExploration(source="explicit-remote"){
  setMode("remote",source,state.selectedTargetId||"remote-location","place");
  render();
  return snapshot();
}
function returnToProtagonist(source="player-return"){
  const before=protagonistPosition();
  const st=stage();
  if(!st?.focusProtagonist||!before)return {ok:false,reason:"protagonist-focus-authority-unavailable",snapshot:snapshot()};
  const started=now();
  const result=st.focusProtagonist();
  const after=protagonistPosition();
  const unchanged=Boolean(after&&before.x===after.x&&before.y===after.y);
  state.telemetry.simulationMutation=!unchanged;
  state.telemetry.simulationAuthorityPreserved=unchanged;
  state.returnCount++;
  state.lastReturnAtMs=started;
  state.telemetry.navigationTimingMs=Number((now()-started).toFixed(3));
  setMode("protagonist",source,ACTOR_ID,"protagonist");
  render();
  return {ok:result?.ok!==false,request:result||null,simulationPositionUnchanged:unchanged,snapshot:snapshot()};
}
function followThreshold(fp){
  if(!fp)return DEAD_ZONE_MIN_METERS;
  return clamp(Math.min(fp.widthMeters,fp.heightMeters)*DEAD_ZONE_FRACTION,DEAD_ZONE_MIN_METERS,DEAD_ZONE_MAX_METERS);
}
function boundedStep(diff){
  const d=Number(diff);if(!Number.isFinite(d)||d===0)return 0;
  const magnitude=Math.min(FOLLOW_STEP_MAX_METERS,Math.max(1,Math.ceil(Math.abs(d)*.28)));
  return Math.sign(d)*magnitude;
}
function followTick(){
  if(state.mode!=="protagonist"||!state.follow.enabled)return;
  const snap=stageSnapshot(),pos=protagonistPosition(),focus=currentFocusTile(snap),fp=footprint(snap);
  if(!snap?.ready||!pos||!focus||!fp)return;
  const px=bigint(pos.x),py=bigint(pos.y),fx=bigint(focus.x),fy=bigint(focus.y);
  if(px==null||py==null||fx==null||fy==null)return;
  const dx=Number(px-fx),dy=Number(py-fy),distance=Math.hypot(dx,dy),dead=followThreshold(fp),settle=dead*SETTLE_ZONE_FACTOR;
  state.follow.deadZoneMeters=Number(dead.toFixed(2));
  state.follow.settleZoneMeters=Number(settle.toFixed(2));
  state.follow.distanceMeters=Number(distance.toFixed(2));
  if(!state.follow.active&&distance<=dead){state.follow.inDeadZone=true;return}
  if(!state.follow.active){state.follow.active=true;state.follow.inDeadZone=false}
  if(distance<=settle){state.follow.active=false;state.follow.inDeadZone=true;return}
  const sx=boundedStep(dx),sy=boundedStep(dy),stepMeters=Math.hypot(sx,sy);
  if(stepMeters<=0)return;
  const nx=fx+BigInt(sx),ny=fy+BigInt(sy);
  const before=protagonistPosition();
  stage()?.setWorldTileFocus?.(String(nx),String(ny));
  const after=protagonistPosition();
  if(before&&after&&(before.x!==after.x||before.y!==after.y)){
    state.telemetry.simulationMutation=true;
    state.telemetry.simulationAuthorityPreserved=false;
  }
  state.follow.stepCount++;
  state.follow.lastStepMeters=Number(stepMeters.toFixed(2));
  state.follow.maxStepMeters=Math.max(state.follow.maxStepMeters,state.follow.lastStepMeters);
  state.follow.lastStepAtMs=now();
}
function observeNavigation(snap){
  const nav=snap?.explicitFocusNavigation?.active||null;
  state.telemetry.focusNavigation=nav?{
    requestId:nav.requestId||null,targetId:nav.targetId||null,targetType:nav.targetType||null,state:nav.state||null,
    focusErrorMeters:nav.focusErrorMeters??null,committedAtMs:nav.committedAtMs??null,cameraOnly:nav.cameraOnly!==false,simulationMutation:nav.simulationMutation===true
  }:null;
  if(nav?.targetType==="place"&&nav?.targetId&&state.mode!=="remote")setMode("remote","canonical-place-focus",nav.targetId,"place");
}
function updateTelemetry(snap,pos){
  state.telemetry.protagonistPosition=pos?{x:pos.x,y:pos.y,source:pos.source}:null;
  state.telemetry.cameraFocusTile=currentFocusTile(snap);
  state.telemetry.projectedProtagonist=projectedProtagonist(snap,pos);
  state.telemetry.unobscuredGameplayRect=unobscuredGameplayRect();
  state.telemetry.activeFootprint=footprint(snap);
  const r=state.hud?.getBoundingClientRect?.();
  state.telemetry.contextWidgetBounds=r?{left:Number(r.left.toFixed(1)),top:Number(r.top.toFixed(1)),right:Number(r.right.toFixed(1)),bottom:Number(r.bottom.toFixed(1)),width:Number(r.width.toFixed(1)),height:Number(r.height.toFixed(1))}:null;
  state.telemetry.frameTimeMs=Number(snap?.rendererEvidence?.performance?.frameTimeMs||snap?.rendererBackend?.frameTimeMs||0)||null;
}
function render(){
  const hud=ensureHud(),snap=stageSnapshot(),seed=snap?.activeSeed||campaign()?.seed||"",pos=protagonistPosition(),identity=currentIdentity(seed),activity=currentActivity(seed);
  observeNavigation(snap);
  updateTelemetry(snap,pos);
  hud.dataset.mode=state.mode;
  if(state.mode==="remote"){
    state.modeNode.textContent="EXPLORING WORLD";
    state.titleNode.textContent=state.selectedTargetId&&state.selectedTargetId!==ACTOR_ID?"Remote location":"Free exploration";
    state.activityNode.textContent="Protagonist remains autonomous elsewhere";
    state.returnButton.hidden=false;
  }else{
    state.modeNode.textContent="PRIMARY FOCUS";
    state.titleNode.textContent=identity;
    state.activityNode.textContent=activity.target?activity.title+" · "+activity.target:activity.title;
    state.returnButton.hidden=true;
  }
  if(pos&&state.mode!=="remote")state.locationNode.textContent="World "+pos.x+", "+pos.y;
  else if(state.telemetry.cameraFocusTile)state.locationNode.textContent="View "+state.telemetry.cameraFocusTile.x+", "+state.telemetry.cameraFocusTile.y;
  else state.locationNode.textContent="";
}
function pointerDown(event){
  if(event.target?.closest?.("#protagonistFocusHUD"))return;
  state.pointer={down:true,x:event.clientX,y:event.clientY,moved:false};
}
function pointerMove(event){
  if(!state.pointer.down||state.pointer.moved)return;
  if(Math.hypot(event.clientX-state.pointer.x,event.clientY-state.pointer.y)>=9){
    state.pointer.moved=true;
    if(state.mode!=="remote")enterRemoteExploration("player-camera-drag");
  }
}
function pointerUp(){state.pointer.down=false}
function boot(){
  if(state.ready)return snapshot();
  try{
    const p=new URLSearchParams(root.location?.search||"");
    state.autoStartEnabled=p.get("focusUxAutoStart")!=="0";
  }catch(_){}
  ensureHud();
  const surface=document.getElementById("planetStageRoot")||document;
  surface.addEventListener("pointerdown",pointerDown,{passive:true});
  surface.addEventListener("pointermove",pointerMove,{passive:true});
  root.addEventListener("pointerup",pointerUp,{passive:true});
  root.addEventListener("pointercancel",pointerUp,{passive:true});
  state.timers.update=root.setInterval(render,UPDATE_INTERVAL_MS);
  state.timers.follow=root.setInterval(followTick,FOLLOW_INTERVAL_MS);
  state.ready=true;
  const attemptAuto=()=>{
    const snap=stageSnapshot();
    if(!state.autoStartEnabled||state.autoStartApplied||!snap?.ready||!snap?.activeSeed)return;
    state.autoStartApplied=true;
    returnToProtagonist("default-primary-focus");
  };
  const autoTimer=root.setInterval(()=>{attemptAuto();if(state.autoStartApplied||!state.autoStartEnabled)root.clearInterval(autoTimer)},180);
  render();attemptAuto();
  root.dispatchEvent?.(new CustomEvent("protagonist-focus-ux-ready",{detail:{version:VERSION}}));
  return snapshot();
}
function snapshot(){
  const t=state.telemetry;
  return Object.freeze({
    version:VERSION,ready:state.ready,mode:state.mode,actorId:state.actorId,selectedTargetId:state.selectedTargetId,selectedTargetType:state.selectedTargetType,source:state.source,
    autoStartEnabled:state.autoStartEnabled,autoStartApplied:state.autoStartApplied,returnCount:state.returnCount,forcedReturnCount:state.forcedReturnCount,remoteExplorationCount:state.remoteExplorationCount,
    follow:Object.freeze({...state.follow}),
    protagonistPosition:t.protagonistPosition?Object.freeze({...t.protagonistPosition}):null,
    cameraFocusTile:t.cameraFocusTile?Object.freeze({...t.cameraFocusTile}):null,
    projectedProtagonist:t.projectedProtagonist?Object.freeze({...t.projectedProtagonist}):null,
    unobscuredGameplayRect:t.unobscuredGameplayRect?Object.freeze({...t.unobscuredGameplayRect}):null,
    contextWidgetBounds:t.contextWidgetBounds?Object.freeze({...t.contextWidgetBounds}):null,
    activeFootprint:t.activeFootprint?Object.freeze({...t.activeFootprint}):null,
    focusNavigation:t.focusNavigation?Object.freeze({...t.focusNavigation}):null,
    frameTimeMs:t.frameTimeMs,navigationTimingMs:t.navigationTimingMs,simulationMutation:t.simulationMutation,simulationAuthorityPreserved:t.simulationAuthorityPreserved,
    fullWorldScan:false,perFrameWorldScan:false,presentationOnly:true,cameraAuthorityOnly:true
  });
}

root.ProtagonistFocusUX=Object.freeze({VERSION,boot,snapshot,returnToProtagonist,enterRemoteExploration,refresh:render});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})(typeof globalThis!=="undefined"?globalThis:window);
