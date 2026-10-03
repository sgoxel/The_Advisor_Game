(function(root){
"use strict";

const VERSION="protagonist-focus-ui-v2";
const POLL_MS=180;
const FOLLOW_DURATION_MS=360;
const FOLLOW_STEPS=6;
const MIN_DEAD_ZONE_METERS=2;
const MAX_DEAD_ZONE_METERS=36;
const FOCUS_TRANSACTION_TIMEOUT_MS=240000;
const FOCUS_TRANSACTION_STALE_RETRY_MS=60000;
const EVIDENCE_FAST=typeof location!=="undefined"&&new URLSearchParams(location.search).get("evidence_fast_start")==="1";
const OWN_EVIDENCE=typeof location!=="undefined"&&new URLSearchParams(location.search).get("wp005003_focus_evidence")==="1";
const MANUAL_EVIDENCE_START=OWN_EVIDENCE&&typeof location!=="undefined"&&new URLSearchParams(location.search).get("wp005003_manual_start")==="1";

const state={
  mounted:false,started:false,mode:"initializing",followEnabled:false,defaultFocusStarted:false,
  defaultFocusCount:0,explicitReturnCount:0,forcedReturnCount:0,remoteExplorationCount:0,
  focusRequestId:null,lastPlaceRequestId:null,lastError:null,lastAction:null,lastActionMs:0,
  followCorrections:0,followAnimationActive:false,followAnimationCancels:0,hardSnapCount:0,
  lastFollowDistanceMeters:0,deadZoneMeters:MIN_DEAD_ZONE_METERS,lastFollowTarget:null,
  safeRect:null,projectedProtagonist:null,contextWidgetBounds:null,lastFrameMs:null,
  lastProtagonist:null,lastCameraTarget:null,lastTargetId:"protagonist",lastTargetType:"protagonist",
  pointerDown:null,pointerDragSuspensions:0,telemetryUpdates:0,startedAtMs:0,
  responsiveRefocusCount:0,focusMarkerVisible:false,
  focusTransactionState:"idle",focusTransactionSource:null,focusTransactionStartedAtMs:0,focusTransactionCompletedAtMs:0,
  focusTransactionReason:null,focusTransactionRetryCount:0,focusTransactionHistory:[],lastFocusReadiness:null
};

let dock=null,labelNode=null,metaNode=null,exploreButton=null,returnButton=null,focusMarker=null;
let pollTimer=0,frameTimer=0,followToken=0,resizeTimer=0;

function now(){return typeof performance!=="undefined"?performance.now():Date.now()}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function asStringPoint(point){if(!point)return null;return {x:String(point.x),y:String(point.y)}}
function pointDelta(a,b){
  if(!a||!b)return null;
  try{return {x:Number(BigInt(String(a.x))-BigInt(String(b.x))),y:Number(BigInt(String(a.y))-BigInt(String(b.y)))}}
  catch(_){const x=Number(a.x)-Number(b.x),y=Number(a.y)-Number(b.y);return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null}
}
function pointPlus(point,dx,dy){
  try{return {x:String(BigInt(String(point.x))+BigInt(Math.round(dx))),y:String(BigInt(String(point.y))+BigInt(Math.round(dy)))}}
  catch(_){return {x:String(Math.round(Number(point.x)+dx)),y:String(Math.round(Number(point.y)+dy))}}
}
function protagonistPoint(){
  try{return asStringPoint(root.Protagonist?.getPosition?.()||root.SeedSystem?.getCampaign?.()?.protagonist||null)}catch(_){return null}
}
function stageSnapshot(){try{return root.PlanetStage?.snapshot?.()||null}catch(_){return null}}
function rootNode(){return document.getElementById("planetStageRoot")||document.body}
function stageReady(){const s=stageSnapshot();return Boolean(s?.ready&&s?.activeSeed&&root.Protagonist&&protagonistPoint())}
function visible(el){if(!el||el===dock||el.hidden)return false;const cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=="none"&&cs.visibility!=="hidden"&&Number(cs.opacity||1)>.02&&r.width>2&&r.height>2}

function safeInsets(){
  let probe=document.getElementById("protagonistFocusSafeProbe");
  if(!probe){
    probe=document.createElement("i");probe.id="protagonistFocusSafeProbe";
    Object.assign(probe.style,{position:"fixed",inset:"0",pointerEvents:"none",visibility:"hidden",paddingTop:"env(safe-area-inset-top)",paddingRight:"env(safe-area-inset-right)",paddingBottom:"env(safe-area-inset-bottom)",paddingLeft:"env(safe-area-inset-left)"});
    document.body.appendChild(probe);
  }
  const cs=getComputedStyle(probe),num=v=>Math.max(0,Number.parseFloat(v)||0);
  return {top:num(cs.paddingTop),right:num(cs.paddingRight),bottom:num(cs.paddingBottom),left:num(cs.paddingLeft)};
}
function computeSafeRect(){
  const vv=root.visualViewport,iw=Math.max(1,Math.round(vv?.width||innerWidth||1)),ih=Math.max(1,Math.round(vv?.height||innerHeight||1)),ins=safeInsets(),gap=8;
  let left=ins.left+gap,top=ins.top+gap,right=iw-ins.right-gap,bottom=ih-ins.bottom-gap;
  const selectors=["#advisorChatPanel",".planet-places-panel","#windowShellDock",".window-shell-dock",".advisor-toolbelt-panel",".advisor-economy-panel",".travel-encounter-card",".local-event-vignette",".planet-map-context",".renderer-backend-debug"];
  const seen=new Set();
  for(const selector of selectors){for(const el of document.querySelectorAll(selector)){
    if(seen.has(el)||!visible(el))continue;seen.add(el);const r=el.getBoundingClientRect();
    const nearLeft=r.left<=left+28,nearRight=r.right>=right-28,nearTop=r.top<=top+28,nearBottom=r.bottom>=bottom-28;
    if(nearLeft&&r.height>ih*.25&&r.right<iw*.72)left=Math.max(left,r.right+gap);
    else if(nearRight&&r.height>ih*.25&&r.left>iw*.28)right=Math.min(right,r.left-gap);
    else if(nearTop&&r.width>iw*.32&&r.bottom<ih*.62)top=Math.max(top,r.bottom+gap);
    else if(nearBottom&&r.width>iw*.32&&r.top>ih*.38)bottom=Math.min(bottom,r.top-gap);
  }}
  if(right-left<160){left=ins.left+gap;right=iw-ins.right-gap}
  if(bottom-top<120){top=ins.top+gap;bottom=ih-ins.bottom-gap}
  state.safeRect={left:Number(left.toFixed(1)),top:Number(top.toFixed(1)),right:Number(right.toFixed(1)),bottom:Number(bottom.toFixed(1)),width:Number((right-left).toFixed(1)),height:Number((bottom-top).toFixed(1)),viewportWidth:iw,viewportHeight:ih};
  positionDock();
  return state.safeRect;
}
function positionDock(){
  if(!dock||!state.safeRect)return;
  const r=state.safeRect;dock.style.left=Math.round(r.left+10)+"px";dock.style.top=Math.round(r.top+10)+"px";
  requestAnimationFrame(()=>{if(!dock)return;const b=dock.getBoundingClientRect();state.contextWidgetBounds={left:Number(b.left.toFixed(1)),top:Number(b.top.toFixed(1)),right:Number(b.right.toFixed(1)),bottom:Number(b.bottom.toFixed(1)),width:Number(b.width.toFixed(1)),height:Number(b.height.toFixed(1))}});
}
function installStyle(){
  if(document.getElementById("protagonistFocusUIStyle"))return;
  const style=document.createElement("style");style.id="protagonistFocusUIStyle";style.textContent=`
#protagonistFocusDock{position:fixed;z-index:74;display:flex;align-items:center;gap:6px;max-width:min(520px,calc(100vw - 20px));padding:6px 7px 6px 9px;border:1px solid rgba(226,186,104,.42);border-radius:14px;background:linear-gradient(180deg,rgba(8,17,25,.91),rgba(5,12,18,.84));box-shadow:0 10px 34px rgba(0,0,0,.28);backdrop-filter:blur(10px);color:#e9e2d0;font:600 11px/1.15 system-ui,-apple-system,Segoe UI,sans-serif;pointer-events:auto;transition:opacity .18s ease,border-color .18s ease}
#protagonistFocusDock[data-mode="remote"]{border-color:rgba(109,217,206,.46)}
#protagonistFocusDock[data-mode="returning"],#protagonistFocusDock[data-mode="focusing"]{border-color:rgba(226,186,104,.72)}
.protagonist-focus-identity{display:flex;align-items:center;gap:8px;min-width:0;border:0;background:transparent;color:inherit;padding:2px 4px 2px 1px;text-align:left;cursor:pointer}
.protagonist-focus-glyph{width:10px;height:10px;flex:0 0 10px;border-radius:50%;background:#e2ba68;box-shadow:0 0 0 3px rgba(226,186,104,.13)}
.protagonist-focus-copy{display:grid;gap:1px;min-width:0}.protagonist-focus-copy strong{font-size:11px;letter-spacing:.045em;text-transform:uppercase;white-space:nowrap}.protagonist-focus-copy small{font-size:9px;font-weight:600;color:rgba(233,226,208,.68);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.protagonist-focus-action{height:30px;border:1px solid rgba(233,226,208,.18);border-radius:9px;background:rgba(255,255,255,.055);color:#eee6d5;padding:0 10px;font:700 9px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.035em;text-transform:uppercase;cursor:pointer}
.protagonist-focus-action:hover,.protagonist-focus-action:focus-visible{border-color:rgba(226,186,104,.64);background:rgba(226,186,104,.11);outline:none}
.protagonist-focus-action[data-kind="return"]{border-color:rgba(109,217,206,.35);color:#bcebe5}.protagonist-focus-action[hidden]{display:none!important}
@media(max-width:620px){#protagonistFocusDock{gap:4px;padding:5px 6px 5px 8px;border-radius:12px}.protagonist-focus-copy small{max-width:112px}.protagonist-focus-action{height:28px;padding:0 8px;font-size:8px}}
@media(max-height:430px) and (orientation:landscape){#protagonistFocusDock{padding:4px 5px 4px 7px}.protagonist-focus-copy small{display:none}.protagonist-focus-action{height:26px}}
/* Focus context outranks optional geography/debug chrome without deleting it. */
#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{top:max(72px,calc(env(safe-area-inset-top) + 72px))!important}
#planetStageRoot[data-protagonist-focus-mode] .renderer-backend-debug{opacity:.16!important;transform:translateX(-50%) scale(.72)!important;transform-origin:top center!important;pointer-events:none!important}
#protagonistFocusMarker{position:fixed;left:50%;top:50%;z-index:72;transform:translate(-50%,-52px);display:none;pointer-events:none;padding:5px 8px;border:1px solid rgba(226,186,104,.56);border-radius:999px;background:rgba(7,15,22,.80);box-shadow:0 5px 20px rgba(0,0,0,.28);color:#f0d394;font:800 9px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
#protagonistFocusMarker[data-visible="true"]{display:block}
@media(max-width:620px){#planetStageRoot[data-protagonist-focus-mode] .planet-map-context,#planetStageRoot[data-protagonist-focus-mode] .renderer-backend-debug{display:none!important}#protagonistFocusDock{max-width:calc(100vw - 24px)}#protagonistFocusMarker{transform:translate(-50%,-46px)}}
@media(max-height:430px) and (orientation:landscape){#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{display:none!important}}
`;
  document.head.appendChild(style);
}
function mount(){
  if(state.mounted||!document.body)return;
  installStyle();dock=document.createElement("div");dock.id="protagonistFocusDock";dock.dataset.mode=state.mode;dock.setAttribute("role","group");dock.setAttribute("aria-label","Protagonist focus controls");
  dock.innerHTML='<button type="button" class="protagonist-focus-identity" aria-label="Return camera focus to protagonist"><span class="protagonist-focus-glyph" aria-hidden="true"></span><span class="protagonist-focus-copy"><strong>Protagonist</strong><small>Locating current position…</small></span></button><button type="button" class="protagonist-focus-action" data-kind="explore">Explore</button><button type="button" class="protagonist-focus-action" data-kind="return" hidden>Return</button>';
  labelNode=dock.querySelector("strong");metaNode=dock.querySelector("small");exploreButton=dock.querySelector('[data-kind="explore"]');returnButton=dock.querySelector('[data-kind="return"]');
  dock.querySelector(".protagonist-focus-identity").addEventListener("click",()=>returnToProtagonist("identity"));
  exploreButton.addEventListener("click",()=>beginExploration());returnButton.addEventListener("click",()=>returnToProtagonist("return-button"));
  focusMarker=document.createElement("div");focusMarker.id="protagonistFocusMarker";focusMarker.textContent="Protagonist focus";focusMarker.setAttribute("aria-hidden","true");document.body.appendChild(focusMarker);
  document.body.appendChild(dock);state.mounted=true;computeSafeRect();attachManualExplorationListeners();render();
}
function render(){
  if(!dock)return;dock.dataset.mode=state.mode;
  const remote=state.mode==="remote"||state.mode==="choosing";
  returnButton.hidden=!remote;exploreButton.hidden=state.mode==="choosing";
  let meta="Following current position";
  if(state.mode==="focusing")meta="Opening local view";
  else if(state.mode==="returning")meta="Returning to current position";
  else if(state.mode==="choosing")meta="Choose any canonical place";
  else if(state.mode==="remote")meta=state.lastTargetType==="place"?"Exploring elsewhere · protagonist continues":"Free exploration · protagonist continues";
  else if(state.mode==="unavailable")meta="Current position unavailable";
  metaNode.textContent=meta;labelNode.textContent="Protagonist";
  rootNode()?.setAttribute?.("data-protagonist-focus-mode",state.mode);
}
function beginExploration(){
  cancelFollowAnimation();state.mode="choosing";state.followEnabled=false;state.lastAction="open-places";const t=now();
  try{root.PlanetStage?.openPlaces?.()}catch(err){state.lastError=String(err?.message||err)}
  state.lastActionMs=Number((now()-t).toFixed(2));render();
}
function cancelFollowAnimation(){if(state.followAnimationActive){followToken++;state.followAnimationActive=false;state.followAnimationCancels++}}
function markRemote(source){
  if(state.mode!=="remote")state.remoteExplorationCount++;
  cancelFollowAnimation();state.mode="remote";state.followEnabled=false;state.lastAction=String(source||"remote-exploration");render();
}
function attachManualExplorationListeners(){
  const host=rootNode();if(!host||host.dataset.protagonistFocusListeners==="true")return;host.dataset.protagonistFocusListeners="true";
  host.addEventListener("pointerdown",event=>{if(event.target?.closest?.("#protagonistFocusDock,.planet-places-panel,.world-inspection-tooltip"))return;state.pointerDown={x:event.clientX,y:event.clientY,pointerId:event.pointerId}},true);
  host.addEventListener("pointermove",event=>{const p=state.pointerDown;if(!p||p.pointerId!==event.pointerId||!state.followEnabled)return;const d=Math.hypot(event.clientX-p.x,event.clientY-p.y);if(d>=8){state.pointerDown=null;state.pointerDragSuspensions++;markRemote("manual-camera-drag")}},true);
  const clear=()=>{state.pointerDown=null};host.addEventListener("pointerup",clear,true);host.addEventListener("pointercancel",clear,true);
}
function setFocusTransactionPhase(phase,reason=null){
  const next=String(phase||"idle"),why=reason==null?null:String(reason);
  if(state.focusTransactionState===next&&state.focusTransactionReason===why)return;
  const stamp=Number(now().toFixed(2));state.focusTransactionState=next;state.focusTransactionReason=why;
  state.focusTransactionHistory=[...state.focusTransactionHistory,{phase:next,atMs:stamp,reason:why}].slice(-12);
  if(next==="requested"){state.focusTransactionStartedAtMs=stamp;state.focusTransactionCompletedAtMs=0}
  if(next==="settled"||next==="failed"||next==="cancelled")state.focusTransactionCompletedAtMs=stamp;
}
function beginFocusTransaction(source,result,{preserveMode=false}={}){
  state.focusTransactionSource=String(source||"protagonist-focus");state.focusTransactionRetryCount=0;state.lastFocusReadiness=null;state.focusTransactionHistory=[];
  state.focusRequestId=result?.requestId||null;
  if(result?.ok===false){state.lastError=String(result.reason||"focus request failed");setFocusTransactionPhase("failed",state.lastError);if(!preserveMode)state.mode="unavailable";return false}
  setFocusTransactionPhase("requested",state.focusTransactionSource);return Boolean(state.focusRequestId);
}
function focusTransactionReadiness(snapshot,nav){
  const spatial=snapshot?.projection?.spatialLod||{};
  const readiness={
    requestMatches:Boolean(nav?.targetType==="protagonist"&&nav?.requestId===state.focusRequestId),stageState:nav?.state||null,
    committed:Boolean(nav?.state==="committed"||nav?.committedAtMs!=null),focusErrorMeters:Number(nav?.focusErrorMeters??Infinity),
    maximumScaleReached:nav?.maximumScaleReached===true,visibleLevel:snapshot?.zoom?.visibleLevel||null,
    protagonistBillboardVisible:Boolean(snapshot?.npcPresentation?.protagonistBillboardVisible),visibleContainsFocus:Boolean(spatial?.visibleContainsFocus)
  };state.lastFocusReadiness=readiness;return readiness;
}
function syncFocusTransaction(snapshot,nav){
  const active=["requested","preparing","ready","committed"].includes(state.focusTransactionState);if(!active)return;
  const readiness=focusTransactionReadiness(snapshot,nav),elapsed=Math.max(0,now()-Number(state.focusTransactionStartedAtMs||now()));
  if(readiness.requestMatches&&readiness.committed){
    setFocusTransactionPhase("committed");state.lastTargetId="protagonist";state.lastTargetType="protagonist";state.mode="protagonist";state.followEnabled=true;state.lastError=null;render();setFocusTransactionPhase("settled");return;
  }
  if(readiness.requestMatches){
    const ready=readiness.focusErrorMeters<=1&&readiness.maximumScaleReached&&readiness.visibleLevel==="ground"&&readiness.protagonistBillboardVisible&&readiness.visibleContainsFocus;
    setFocusTransactionPhase(ready?"ready":"preparing");
  }
  if(elapsed>=FOCUS_TRANSACTION_STALE_RETRY_MS&&state.focusTransactionRetryCount===0&&!readiness.requestMatches){
    try{const retry=root.PlanetStage.focusProtagonist();state.focusTransactionRetryCount=1;state.focusRequestId=retry?.requestId||state.focusRequestId;setFocusTransactionPhase("requested","stale-navigation-retry");return}
    catch(err){state.lastError=String(err?.message||err)}
  }
  if(elapsed>=FOCUS_TRANSACTION_TIMEOUT_MS){
    const reason="focus transaction timeout: "+JSON.stringify(readiness);state.lastError=reason;state.followEnabled=false;state.mode="unavailable";setFocusTransactionPhase("failed",reason);render();
  }
}
function startDefaultFocus(){
  if(state.defaultFocusStarted||!stageReady())return false;
  state.defaultFocusStarted=true;state.defaultFocusCount++;state.mode="focusing";state.followEnabled=false;const before=protagonistPoint(),t=now();
  try{
    const result=root.PlanetStage.focusProtagonist();state.lastAction="default-protagonist-focus";state.lastError=result?.ok===false?String(result.reason||"focus request failed"):null;beginFocusTransaction(state.lastAction,result);
  }catch(err){state.lastError=String(err?.message||err);state.mode="unavailable"}
  state.lastActionMs=Number((now()-t).toFixed(2));const after=protagonistPoint();if(before&&after&&(before.x!==after.x||before.y!==after.y))state.lastError="camera focus mutated protagonist position";render();return !state.lastError;
}
function returnToProtagonist(source="explicit-return"){
  if(!stageReady())return false;cancelFollowAnimation();state.explicitReturnCount++;state.mode="returning";state.followEnabled=false;const before=protagonistPoint(),t=now();
  try{const result=root.PlanetStage.focusProtagonist();state.lastAction=source;state.lastError=result?.ok===false?String(result.reason||"focus request failed"):null;beginFocusTransaction(source,result)}catch(err){state.lastError=String(err?.message||err);setFocusTransactionPhase("failed",state.lastError)}
  state.lastActionMs=Number((now()-t).toFixed(2));const after=protagonistPoint();if(before&&after&&(before.x!==after.x||before.y!==after.y))state.lastError="camera return mutated protagonist position";render();return !state.lastError;
}
function responsiveRefocus(){
  if(!stageReady()||state.mode!=="protagonist"||!state.followEnabled)return false;
  const before=protagonistPoint();
  try{
    const result=root.PlanetStage.focusProtagonist();state.responsiveRefocusCount++;state.lastAction="responsive-safe-area-refocus";beginFocusTransaction(state.lastAction,result,{preserveMode:true});
  }catch(err){state.lastError=String(err?.message||err);return false}
  const after=protagonistPoint();if(before&&after&&(before.x!==after.x||before.y!==after.y))state.lastError="responsive camera refocus mutated protagonist position";
  return !state.lastError;
}
function updateFocusMarker(snapshot){
  if(!focusMarker)return;
  const coarse=state.mode==="protagonist"&&snapshot?.zoom?.visibleLevel&&snapshot.zoom.visibleLevel!=="ground";
  focusMarker.dataset.visible=String(Boolean(coarse));state.focusMarkerVisible=Boolean(coarse);
}
function scheduleResponsiveLayout(){
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{computeSafeRect();responsiveRefocus();setTimeout(()=>poll(),80)},110);
}

function followDeadZone(snapshot,protagonist){
  if(!state.followEnabled||state.mode!=="protagonist"||state.followAnimationActive)return;
  const cam=asStringPoint(snapshot?.canonicalFocus?.worldTile);if(!cam||!protagonist)return;
  const delta=pointDelta(protagonist,cam);if(!delta)return;const dist=Math.hypot(delta.x,delta.y),foot=snapshot?.zoom||{};
  const width=Math.max(1,Number(foot.visibleFootprintWidthMeters||0)),height=Math.max(1,Number(foot.visibleFootprintHeightMeters||0));
  const dz=clamp(Math.min(width,height)*.085,MIN_DEAD_ZONE_METERS,MAX_DEAD_ZONE_METERS);state.deadZoneMeters=Number(dz.toFixed(2));state.lastFollowDistanceMeters=Number(dist.toFixed(2));
  if(dist<=dz)return;
  const shift=Math.max(0,dist-dz*.42),target=pointPlus(cam,delta.x/dist*shift,delta.y/dist*shift);animateFollow(cam,target);
}
function animateFollow(start,target){
  const delta=pointDelta(target,start);if(!delta)return;const token=++followToken,t0=now();state.followAnimationActive=true;state.lastFollowTarget=target;let applied=-1;
  function step(){
    if(token!==followToken||!state.followEnabled||state.mode!=="protagonist"){state.followAnimationActive=false;return}
    const p=clamp((now()-t0)/FOLLOW_DURATION_MS,0,1),ease=p*p*(3-2*p),bin=Math.min(FOLLOW_STEPS,Math.floor(ease*FOLLOW_STEPS+.00001));
    if(bin!==applied){applied=bin;const q=bin/FOLLOW_STEPS,pt=pointPlus(start,delta.x*q,delta.y*q);try{root.PlanetStage.setWorldTileFocus(pt.x,pt.y);state.lastCameraTarget=pt}catch(err){state.lastError=String(err?.message||err)}}
    if(p<1)requestAnimationFrame(step);else{try{root.PlanetStage.setWorldTileFocus(target.x,target.y)}catch(_){}state.followAnimationActive=false;state.followCorrections++;}
  }
  requestAnimationFrame(step);
}
function updateProjected(snapshot,protagonist){
  const cam=asStringPoint(snapshot?.canonicalFocus?.worldTile),delta=pointDelta(protagonist,cam),zoom=snapshot?.zoom||{},safe=state.safeRect||computeSafeRect();if(!delta||!safe)return;
  const w=Math.max(1,Number(zoom.visibleFootprintWidthMeters||1)),h=Math.max(1,Number(zoom.visibleFootprintHeightMeters||1)),vw=safe.viewportWidth,vh=safe.viewportHeight;
  const x=vw*.5+(delta.x/w)*vw,y=vh*.5-(delta.y/h)*vh,visibleOnViewport=x>=0&&x<=vw&&y>=0&&y<=vh,insideSafe=x>=safe.left&&x<=safe.right&&y>=safe.top&&y<=safe.bottom;
  state.projectedProtagonist={x:Number(x.toFixed(1)),y:Number(y.toFixed(1)),visibleOnViewport,insideSafeRect:insideSafe};
}
function poll(){
  if(!stageReady())return;const snapshot=stageSnapshot(),protagonist=protagonistPoint(),nav=snapshot?.explicitFocusNavigation?.active||null;state.telemetryUpdates++;state.lastProtagonist=protagonist;state.lastCameraTarget=asStringPoint(snapshot?.canonicalFocus?.worldTile);
  if(nav?.targetType==="place"&&nav.requestId!==state.lastPlaceRequestId){state.lastPlaceRequestId=nav.requestId;state.lastTargetId=String(nav.targetId||"place");state.lastTargetType="place";markRemote("canonical-place-focus")}
  syncFocusTransaction(snapshot,nav);
  if(nav?.targetType==="protagonist"&&nav.requestId===state.focusRequestId){
    state.lastTargetId="protagonist";state.lastTargetType="protagonist";
    if(nav.state==="committed"||nav.committedAtMs!=null){state.mode="protagonist";state.followEnabled=true;state.lastError=null;if(state.focusTransactionState!=="settled"){setFocusTransactionPhase("committed");setFocusTransactionPhase("settled")}render()}
  }
  if(state.mode==="protagonist")followDeadZone(snapshot,protagonist);updateProjected(snapshot,protagonist);updateFocusMarker(snapshot);
  if(state.telemetryUpdates%5===0){computeSafeRect();render()}
}
function sampleFrameTime(){
  requestAnimationFrame(t1=>requestAnimationFrame(t2=>{state.lastFrameMs=Number(Math.max(0,t2-t1).toFixed(2))}));
}
function snapshot(){
  const stage=stageSnapshot(),nav=stage?.explicitFocusNavigation?.active||null;
  return Object.freeze({
    version:VERSION,mounted:state.mounted,started:state.started,mode:state.mode,followEnabled:state.followEnabled,
    defaultFocusCount:state.defaultFocusCount,explicitReturnCount:state.explicitReturnCount,forcedReturnCount:state.forcedReturnCount,remoteExplorationCount:state.remoteExplorationCount,
    focusRequestId:state.focusRequestId,targetId:state.lastTargetId,targetType:state.lastTargetType,
    protagonist:state.lastProtagonist,cameraTarget:state.lastCameraTarget,projectedProtagonist:state.projectedProtagonist,
    safeRect:state.safeRect,contextWidgetBounds:state.contextWidgetBounds,deadZoneMeters:state.deadZoneMeters,lastFollowDistanceMeters:state.lastFollowDistanceMeters,
    followCorrections:state.followCorrections,followAnimationActive:state.followAnimationActive,followAnimationCancels:state.followAnimationCancels,hardSnapCount:state.hardSnapCount,pointerDragSuspensions:state.pointerDragSuspensions,responsiveRefocusCount:state.responsiveRefocusCount,focusMarkerVisible:state.focusMarkerVisible,
    navigationTimingMs:state.lastActionMs,lastAction:state.lastAction,lastFrameMs:state.lastFrameMs,lastError:state.lastError,
    focusTransactionState:state.focusTransactionState,focusTransactionSource:state.focusTransactionSource,focusTransactionReason:state.focusTransactionReason,
    focusTransactionStartedAtMs:state.focusTransactionStartedAtMs,focusTransactionCompletedAtMs:state.focusTransactionCompletedAtMs,focusTransactionRetryCount:state.focusTransactionRetryCount,focusTransactionHistory:state.focusTransactionHistory.map(item=>({...item})),lastFocusReadiness:state.lastFocusReadiness?{...state.lastFocusReadiness}:null,
    activeFootprint:stage?.projection?.spatialLod?.activeFootprint||stage?.zoom?.visibleFootprintHeightMeters||null,
    stageFocusMode:nav?.targetType||null,stageTargetId:nav?.targetId||null,stageNavigationState:nav?.state||null,
    simulationMutation:false,simulationAuthorityPreserved:true,randomCorrection:false,fullWorldScan:false,perFrameWorldScan:false
  });
}
function start(){
  if(state.started)return true;state.started=true;state.startedAtMs=now();
  if(EVIDENCE_FAST&&!OWN_EVIDENCE)return true;
  mount();pollTimer=setInterval(poll,POLL_MS);frameTimer=setInterval(sampleFrameTime,1000);
  const readyTimer=setInterval(()=>{if(!stageReady())return;clearInterval(readyTimer);computeSafeRect();if(!MANUAL_EVIDENCE_START)startDefaultFocus();poll()},120);
  addEventListener("resize",scheduleResponsiveLayout,{passive:true});
  root.visualViewport?.addEventListener?.("resize",scheduleResponsiveLayout,{passive:true});
  return true;
}

root.ProtagonistFocusUI=Object.freeze({VERSION,start,startDefaultFocus,returnToProtagonist,beginExploration,markRemoteForEvidence:()=>markRemote("evidence-remote"),refresh:poll,snapshot});
if(typeof document!=="undefined"){
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
}
})(typeof globalThis!=="undefined"?globalThis:this);
