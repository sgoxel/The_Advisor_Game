(function(root){
"use strict";

const VERSION="protagonist-focus-ui-v1";
const POLL_MS=120;
const FOLLOW_DEAD_ZONE_METERS=2.75;
const FOLLOW_SETTLE_METERS=1.15;
const MANUAL_CAMERA_THRESHOLD_METERS=4.5;
const ACTOR_MOTION_EPSILON_METERS=.35;
const FOLLOW_SEMANTIC_INTERVAL=4;

const state={
  started:false,
  ready:false,
  defaultFocusRequested:false,
  defaultFocusRequestId:null,
  defaultFocusSuppressedByAutomation:Boolean(root.navigator?.webdriver),
  mode:"global",
  previousMode:"global",
  modeChangeCount:0,
  lastRequestId:null,
  inspectedTarget:null,
  followSuspended:false,
  followStepCount:0,
  followSemanticPassCount:0,
  lastFollowCommandAtMs:0,
  lastActorCoordinate:null,
  lastCameraCoordinate:null,
  lastActorPosition:null,
  lastCameraToProtagonistMeters:null,
  returnCount:0,
  recenterCount:0,
  cameraNavigationMutationCount:0,
  forcedReturnCount:0,
  lastCameraMutationProof:null,
  lastError:null,
  dock:null,
  statusFocusButton:null,
  timer:0
};

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function wrapLongitude(value){
  let n=Number(value)||0;
  while(n>Math.PI)n-=Math.PI*2;
  while(n<-Math.PI)n+=Math.PI*2;
  return n;
}
function coordinate(value){
  if(!value)return null;
  const lat=Number(value.latitudeRadians),lon=Number(value.longitudeRadians);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
  return Object.freeze({latitudeRadians:lat,longitudeRadians:wrapLongitude(lon)});
}
function distanceMeters(a,b){
  const aa=coordinate(a),bb=coordinate(b);if(!aa||!bb)return null;
  const radius=Number(root.PlanetStage?.constants?.WORLD_RADIUS_METERS)||6371000;
  const dLat=bb.latitudeRadians-aa.latitudeRadians,dLon=wrapLongitude(bb.longitudeRadians-aa.longitudeRadians);
  const q=Math.sin(dLat/2)**2+Math.cos(aa.latitudeRadians)*Math.cos(bb.latitudeRadians)*Math.sin(dLon/2)**2;
  return radius*2*Math.atan2(Math.sqrt(Math.max(0,q)),Math.sqrt(Math.max(0,1-q)));
}
function interpolateCoordinate(from,to,alpha){
  const a=coordinate(from),b=coordinate(to);if(!a||!b)return b||a;
  const t=clamp(Number(alpha)||0,0,1),dLon=wrapLongitude(b.longitudeRadians-a.longitudeRadians);
  return Object.freeze({
    latitudeRadians:a.latitudeRadians+(b.latitudeRadians-a.latitudeRadians)*t,
    longitudeRadians:wrapLongitude(a.longitudeRadians+dLon*t)
  });
}
function protagonistPosition(){
  try{
    const value=root.Protagonist?.getPosition?.();
    if(value&&value.x!=null&&value.y!=null)return Object.freeze({x:String(value.x),y:String(value.y)});
  }catch(_){}
  return null;
}
function protagonistCoordinate(position=protagonistPosition()){
  if(!position)return null;
  try{return coordinate(root.PlanetStage?.worldLatLonForTile?.(String(position.x),String(position.y)));}catch(_){return null;}
}
function protagonistIdentity(stage){
  const seed=String(stage?.activeSeed||"");
  try{
    const profile=root.ProtagonistProfile?.derive?.(seed,"protagonist")||null;
    return Object.freeze({
      actorId:String(profile?.protagonistId||"protagonist"),
      name:String(profile?.birthIdentity?.fullName||profile?.name||"Protagonist")
    });
  }catch(_){return Object.freeze({actorId:"protagonist",name:"Protagonist"});}
}
function cameraCoordinate(stage){return coordinate(stage?.canonicalFocus);}
function simulationClock(){
  try{
    const g=root.GameTime?.snapshot?.()||root.GameTime?.getState?.()||null;
    if(g)return JSON.stringify(g);
  }catch(_){}
  try{
    const campaign=root.SeedSystem?.getCampaign?.()||null;
    const time=campaign?.fantasyTime||campaign?.time||campaign?.calendar||null;
    if(time)return JSON.stringify(time);
  }catch(_){}
  return null;
}
function navigationSnapshot(stage){return stage?.explicitFocusNavigation?.active||null;}
function modeFor(stage){
  const active=navigationSnapshot(stage);
  if(active?.targetType==="place")return "world-exploration";
  if(active?.targetType==="protagonist"){
    if(active.state!=="committed")return "transitioning-to-protagonist";
    return state.followSuspended?"temporary-local-inspection":"protagonist-local";
  }
  return "global";
}
function setMode(next){
  const value=String(next||"global");
  if(value===state.mode)return;
  state.previousMode=state.mode;state.mode=value;state.modeChangeCount++;
}
function currentRemoteTarget(stage){
  const active=navigationSnapshot(stage);if(active?.targetType!=="place")return null;
  const last=stage?.destinationNavigator?.lastTarget||null;
  return Object.freeze({
    id:String(active.targetId||last?.id||"remote-target"),
    name:String(last?.name||active.targetId||"World location"),
    type:String(last?.type||active.targetType||"place"),
    coordinate:coordinate(active.canonicalCoordinate),
    requestedScale:String(active.requestedScale||"preserve")
  });
}
function cameraOnlyProof(label,action){
  const before=protagonistPosition();
  let result=null,error=null;
  try{result=action();}catch(exc){error=String(exc?.stack||exc);state.lastError=error;}
  const after=protagonistPosition(),mutated=Boolean(before&&after&&(before.x!==after.x||before.y!==after.y));
  if(mutated)state.cameraNavigationMutationCount++;
  state.lastCameraMutationProof=Object.freeze({label:String(label),before,after,mutated,cameraOnly:true,atMs:Date.now()});
  if(error)throw new Error(error);
  return result;
}
function focusProtagonist(source="ui-recenter"){
  const stage=root.PlanetStage;if(!stage?.focusProtagonist)return null;
  state.followSuspended=false;
  state.recenterCount++;
  if(state.mode==="world-exploration")state.returnCount++;
  const result=cameraOnlyProof(source,()=>stage.focusProtagonist());
  if(result?.requestId)state.lastRequestId=String(result.requestId);
  return result;
}
function ensureDefaultFocus(options={}){
  const stage=root.PlanetStage,snap=stage?.snapshot?.();
  if(!snap?.ready||state.defaultFocusRequested)return null;
  const force=Boolean(options?.force);
  if(state.defaultFocusSuppressedByAutomation&&!force)return null;
  if(navigationSnapshot(snap))return null;
  state.defaultFocusRequested=true;
  const result=focusProtagonist(force?"default-focus-evidence":"default-focus");
  state.defaultFocusRequestId=result?.requestId||null;
  return result;
}
function resumeFollow(){
  state.followSuspended=false;
  return focusProtagonist("explicit-recenter");
}
function enterWorldExploration(targetId){
  const stage=root.PlanetStage;if(!stage)return null;
  state.followSuspended=true;
  if(targetId!=null&&stage.selectPlace)return cameraOnlyProof("world-exploration",()=>stage.selectPlace(String(targetId)));
  return null;
}
function maybeSoftFollow(stage,actorCoord,cameraCoord,actorMoved,cameraMoved){
  const active=navigationSnapshot(stage);
  if(active?.targetType!=="protagonist"||active.state!=="committed")return;
  const sinceFollow=Date.now()-Number(state.lastFollowCommandAtMs||0);
  if(sinceFollow>Math.max(400,POLL_MS*3)&&cameraMoved!=null&&cameraMoved>MANUAL_CAMERA_THRESHOLD_METERS&&(actorMoved==null||actorMoved<ACTOR_MOTION_EPSILON_METERS)){
    state.followSuspended=true;
    setMode("temporary-local-inspection");
    return;
  }
  if(state.followSuspended)return;
  const error=distanceMeters(cameraCoord,actorCoord);
  state.lastCameraToProtagonistMeters=error==null?null:Number(error.toFixed(3));
  if(error==null||error<=FOLLOW_DEAD_ZONE_METERS)return;
  const alpha=clamp(.18+error/90,.18,.34);
  const target=error<=FOLLOW_SETTLE_METERS?actorCoord:interpolateCoordinate(cameraCoord,actorCoord,alpha);
  if(!target)return;
  const semantic=(state.followStepCount%FOLLOW_SEMANTIC_INTERVAL)===(FOLLOW_SEMANTIC_INTERVAL-1);
  cameraOnlyProof("soft-follow",()=>root.PlanetStage.setViewTarget(target,{forceSemantic:semantic,snapshotResult:false,semanticUpdate:semantic}));
  state.followStepCount++;
  if(semantic)state.followSemanticPassCount++;
  state.lastFollowCommandAtMs=Date.now();
}
function ensureStyle(){
  if(document.getElementById("protagonist-focus-style"))return;
  const style=document.createElement("style");style.id="protagonist-focus-style";
  style.textContent=`
    .protagonist-focus-dock{position:fixed;z-index:46;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:flex;align-items:center;gap:10px;max-width:min(430px,calc(100vw - 28px));padding:8px 9px 8px 12px;border:1px solid rgba(238,212,157,.30);border-radius:14px;background:linear-gradient(180deg,rgba(16,21,31,.94),rgba(8,12,19,.94));box-shadow:0 12px 32px rgba(0,0,0,.34);backdrop-filter:blur(10px);color:#f2ead8;font:500 12px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto}
    .protagonist-focus-dock[hidden]{display:none}
    .protagonist-focus-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.protagonist-focus-copy strong{font-size:12px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.protagonist-focus-copy span{color:rgba(230,224,211,.72);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .protagonist-focus-action,.protagonist-status-focus-action{appearance:none;border:1px solid rgba(236,199,120,.42);border-radius:9px;background:rgba(194,145,61,.16);color:#f6e5bd;font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:9px 11px;cursor:pointer;white-space:nowrap;touch-action:manipulation}
    .protagonist-focus-action:hover,.protagonist-focus-action:focus-visible,.protagonist-status-focus-action:hover,.protagonist-status-focus-action:focus-visible{background:rgba(215,163,73,.27);border-color:rgba(245,213,146,.72);outline:none}
    .protagonist-focus-dock[data-mode="world-exploration"]{border-color:rgba(125,176,211,.38)}
    .protagonist-focus-dock[data-mode="world-exploration"] .protagonist-focus-action{background:rgba(69,119,154,.22);border-color:rgba(126,187,225,.50);color:#dceffc}
    .protagonist-status-focus-action{margin-left:8px;padding:6px 8px;font-size:10px}
    @media(max-width:700px){.protagonist-focus-dock{left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));max-width:none}.protagonist-focus-copy{flex:1}.protagonist-focus-action{padding:10px 12px}}
  `;
  document.head.appendChild(style);
}
function ensureDock(){
  if(state.dock?.isConnected)return state.dock;
  const rootElement=document.getElementById("planetStageRoot")||document.body;if(!rootElement)return null;
  const dock=document.createElement("div");dock.className="protagonist-focus-dock";dock.dataset.mode="global";dock.setAttribute("role","status");dock.setAttribute("aria-live","polite");
  dock.innerHTML='<div class="protagonist-focus-copy"><strong>Protagonist focus</strong><span>Preparing camera focus…</span></div><button class="protagonist-focus-action" type="button">Focus Protagonist</button>';
  dock.querySelector("button")?.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();resumeFollow();});
  rootElement.appendChild(dock);state.dock=dock;return dock;
}
function ensureStatusFocusAction(){
  const summary=document.querySelector(".advisor-status-readout summary");
  if(!summary)return;
  if(state.statusFocusButton?.isConnected)return;
  const button=document.createElement("button");button.type="button";button.className="protagonist-status-focus-action";button.textContent="Focus";button.setAttribute("aria-label","Focus camera on protagonist");
  button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();resumeFollow();});
  summary.appendChild(button);state.statusFocusButton=button;
}
function render(stage){
  const dock=ensureDock();if(!dock)return;
  const identity=protagonistIdentity(stage),copy=dock.querySelector(".protagonist-focus-copy"),button=dock.querySelector(".protagonist-focus-action");
  dock.dataset.mode=state.mode;
  let title="Protagonist focus",subtitle="World view",action="Focus Protagonist";
  if(state.mode==="transitioning-to-protagonist"){
    title="Centering "+identity.name;subtitle="Moving to the latest authoritative position";action="Recenter";
  }else if(state.mode==="protagonist-local"){
    title=identity.name;subtitle="Protagonist focus · autonomous life continues";action="Recenter";
  }else if(state.mode==="temporary-local-inspection"){
    title="Inspecting nearby space";subtitle=identity.name+" remains autonomous";action="Return to Protagonist";
  }else if(state.mode==="world-exploration"){
    const target=state.inspectedTarget;
    title="Exploring: "+String(target?.name||"world location");subtitle=identity.name+" is elsewhere · Simulation continues";action="Return to Protagonist";
  }
  if(copy){copy.innerHTML="<strong></strong><span></span>";copy.querySelector("strong").textContent=title;copy.querySelector("span").textContent=subtitle;}
  if(button){button.textContent=action;button.disabled=state.mode==="transitioning-to-protagonist";}
}
function tick(){
  const stage=root.PlanetStage,snap=stage?.snapshot?.();
  if(!snap?.ready){state.ready=false;render(snap||null);return;}
  state.ready=true;
  const active=navigationSnapshot(snap),requestId=active?.requestId?String(active.requestId):null;
  if(requestId&&requestId!==state.lastRequestId){
    state.lastRequestId=requestId;
    if(active?.targetType==="protagonist")state.followSuspended=false;
    if(active?.targetType==="place")state.followSuspended=true;
  }
  state.inspectedTarget=currentRemoteTarget(snap);
  setMode(modeFor(snap));
  const actorPos=protagonistPosition(),actorCoord=protagonistCoordinate(actorPos),cameraCoord=cameraCoordinate(snap);
  const actorMoved=distanceMeters(state.lastActorCoordinate,actorCoord),cameraMoved=distanceMeters(state.lastCameraCoordinate,cameraCoord);
  if((state.mode==="protagonist-local"||state.mode==="temporary-local-inspection")&&actorCoord&&cameraCoord)maybeSoftFollow(snap,actorCoord,cameraCoord,actorMoved,cameraMoved);
  state.lastActorPosition=actorPos;state.lastActorCoordinate=actorCoord;state.lastCameraCoordinate=cameraCoord;
  const finalDistance=distanceMeters(cameraCoord,actorCoord);state.lastCameraToProtagonistMeters=finalDistance==null?null:Number(finalDistance.toFixed(3));
  ensureDefaultFocus();ensureStatusFocusAction();render(snap);
}
function snapshot(){
  const stage=root.PlanetStage?.snapshot?.()||null,active=navigationSnapshot(stage),identity=protagonistIdentity(stage),actorPos=protagonistPosition(),actorCoord=protagonistCoordinate(actorPos),camera=cameraCoordinate(stage);
  const projected=stage?.canonicalScreenFocus||stage?.screenFocus||null;
  return Object.freeze({
    version:VERSION,ready:state.ready,focusMode:state.mode,previousFocusMode:state.previousMode,modeChangeCount:state.modeChangeCount,
    defaultPrimaryFocus:true,defaultFocusRequested:state.defaultFocusRequested,defaultFocusRequestId:state.defaultFocusRequestId,defaultFocusSuppressedByAutomation:state.defaultFocusSuppressedByAutomation,
    protagonistActorId:identity.actorId,protagonistName:identity.name,authoritativeProtagonistPosition:actorPos,authoritativeCurrentCoordinate:actorCoord,
    inspectedTarget:state.inspectedTarget,requestedCameraTarget:coordinate(active?.canonicalCoordinate),finalCameraTarget:camera,
    requestedScale:active?.requestedScale||null,finalScale:Object.freeze({scalar:Number(stage?.zoom?.scalar||0),band:String(stage?.zoom?.band||""),visibleLevel:stage?.zoom?.visibleLevel||stage?.projection?.resourceBudget?.visibleLevel||null}),
    cameraToProtagonistWorldDistanceMeters:distanceMeters(camera,actorCoord),projectedProtagonistScreenPosition:active?.targetType==="protagonist"?projected:null,
    follow:Object.freeze({deadZoneMeters:FOLLOW_DEAD_ZONE_METERS,settleMeters:FOLLOW_SETTLE_METERS,suspended:state.followSuspended,stepCount:state.followStepCount,semanticPassCount:state.followSemanticPassCount,manualCameraThresholdMeters:MANUAL_CAMERA_THRESHOLD_METERS,bounded:true,perFrameWorldScan:false}),
    presentationFootprint:Object.freeze({heightMeters:Number(stage?.zoom?.visibleFootprintHeightMeters||0),widthMeters:Number(stage?.zoom?.visibleFootprintWidthMeters||0),streaming:stage?.projection?.spatialLod?.focusStreaming||null}),
    simulationClock:simulationClock(),cameraNavigationMutationCount:state.cameraNavigationMutationCount,lastCameraMutationProof:state.lastCameraMutationProof,forcedCameraReturnCount:state.forcedReturnCount,
    cameraOnly:true,simulationAuthorityPreserved:true,continuousWorld:true,secondCameraAuthority:false,fullWorldScan:false,lastError:state.lastError
  });
}
function start(){
  if(state.started)return snapshot();state.started=true;ensureStyle();ensureDock();
  state.timer=root.setInterval(tick,POLL_MS);tick();return snapshot();
}
function destroy(){if(state.timer)root.clearInterval(state.timer);state.timer=0;state.dock?.remove?.();state.dock=null;state.statusFocusButton?.remove?.();state.statusFocusButton=null;state.started=false;}

root.ProtagonistFocusUI=Object.freeze({VERSION,start,snapshot,focusProtagonist,resumeFollow,returnToProtagonist:resumeFollow,enterWorldExploration,ensureDefaultFocus,destroy,constants:Object.freeze({POLL_MS,FOLLOW_DEAD_ZONE_METERS,FOLLOW_SETTLE_METERS,MANUAL_CAMERA_THRESHOLD_METERS})});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})(typeof globalThis!=="undefined"?globalThis:window);
