(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.LocalConflictPresentation=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="local-conflict-presentation-v1";
const EVIDENCE_MODES=Object.freeze(["active","retreat","terminal","recovered","cleared"]);
const SOURCE_READ_LIMIT=5;
const TERMINAL_CUE_SECONDS=300;
const ANCHOR_SYNC_MS=80;
const UNTRUSTED_KINDS=Object.freeze(["ui","advisor","llm","provider","render","camera","viewport","device"]);
const state={
  evidenceMode:null,explicitEvidence:null,lastModel:null,mounted:false,
  modelBuilds:0,renders:0,anchorSyncs:0,anchorStageReads:0,sourceReadTotal:0,
  sourceReads:{stage:0,threats:0,combat:0,health:0,time:0},timer:null,lastAnchor:null
};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const x of Object.values(value))freeze(x);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]))}
function clean(value,max=180){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function id(value,max=140){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function esc(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function title(value){return clean(value,100).replace(/(^|[-_: ])([a-z])/g,(_,a,b)=>a+b.toUpperCase())}
function currentSeed(){return clean(root.SeedSystem?.getCampaign?.()?.seed||root.PlanetStage?.snapshot?.()?.activeSeed||root.SeedSystem?.getSettings?.()?.seed||"",160)}
function bump(key){if(Object.prototype.hasOwnProperty.call(state.sourceReads,key))state.sourceReads[key]++;state.sourceReadTotal++}
function safeRead(key,fn,fallback=null){bump(key);try{const out=fn();return out==null?fallback:out}catch(_){return fallback}}
function trustedRef(value){if(!value||typeof value!=="object")return null;const kind=id(value.kind||value.type||"",80).toLowerCase(),refId=id(value.id||value.entityId||value.refId||"",180);return kind&&refId&&!UNTRUSTED_KINDS.includes(kind)?freeze({kind,id:refId}):null}
function resolutionLabel(value){const v=id(value,60).toLowerCase();return ({"protagonist-advantage":"Advantage secured","opponent-advantage":"Driven back","stalemate":"Stalemate","protagonist-disengaged":"Disengaged","opposition-disengaged":"Opposition withdrew"})[v]||title(v||"Recorded outcome")}
function fantasySecondIndex(value){const m=String(value||"").match(/^(\\d{4,})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})$/);if(!m)return null;let y=+m[1],mo=+m[2],d=+m[3],h=+m[4],mi=+m[5],s=+m[6];if(mo<1||mo>12||d<1||d>31||h>23||mi>59||s>59)return null;y-=mo<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=mo+(mo>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return (era*146097+doe)*86400+h*3600+mi*60+s}
function presentationModel(input){
  const x=input&&typeof input==="object"?input:{},phase=EVIDENCE_MODES.includes(x.phase)?x.phase:"cleared",visible=phase!=="cleared";
  const out={
    version:VERSION,phase,visible,tone:clean(x.tone||({active:"danger",retreat:"warning",terminal:"resolved",recovered:"recovery",cleared:"clear"}[phase]),24),
    kicker:clean(x.kicker||({active:"LOCAL CONFLICT",retreat:"DISENGAGING",terminal:"SIMULATION OUTCOME",recovered:"RECOVERY",cleared:"AREA CLEAR"}[phase]),40),
    title:clean(x.title||({active:"Threat engaged",retreat:"Breaking contact",terminal:"Conflict resolved",recovered:"Recovering after conflict",cleared:"No active local conflict"}[phase]),100),
    detail:clean(x.detail||"",180),status:clean(x.status||phase,60),fantasyTimestamp:clean(x.fantasyTimestamp||"",32),
    badges:freeze((Array.isArray(x.badges)?x.badges:[]).slice(0,3).map(v=>clean(v,36)).filter(Boolean)),
    sourceRef:x.sourceRef||null,locationRef:x.locationRef||null,worldAnchor:x.worldAnchor||freeze({kind:"canonical-focus"}),
    terminal:Boolean(x.terminal),recovery:Boolean(x.recovery),evidenceOnly:Boolean(x.evidenceOnly),readOnly:true,presentationOnly:true,
    authority:freeze({directWorldMutation:false,directActionExecution:false,combatResolution:false,healthMutation:false,standingMutation:false,relationshipMutation:false,rankMutation:false,movementMutation:false,simulationAuthority:false})
  };
  return freeze(out);
}
function evidenceModel(modeValue){
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"active";
  const common={evidenceOnly:true,worldAnchor:freeze({kind:"canonical-focus",label:"Current gameplay focus"}),fantasyTimestamp:"1201-10-01 18:45:00"};
  if(mode==="active")return presentationModel({...common,phase:"active",detail:"Steel is drawn at the mill crossing. The outcome is not yet resolved.",status:"active · unresolved",badges:["ACTIVE","UNRESOLVED"],sourceRef:freeze({kind:"simulation-event",id:"EVIDENCE-CONFLICT-ACTIVE"}),locationRef:freeze({kind:"workplace",id:"mill-crossing"})});
  if(mode==="retreat")return presentationModel({...common,phase:"retreat",detail:"The protagonist is disengaging from the immediate threat. No victory is implied.",status:"retreat in progress",badges:["DISENGAGE","UNRESOLVED"],sourceRef:freeze({kind:"simulation-event",id:"EVIDENCE-CONFLICT-RETREAT"}),locationRef:freeze({kind:"workplace",id:"mill-crossing"})});
  if(mode==="terminal")return presentationModel({...common,phase:"terminal",detail:"Simulation recorded a terminal stalemate at this location.",title:"Stalemate recorded",status:"terminal · Simulation",badges:["TERMINAL","STALEMATE"],terminal:true,sourceRef:freeze({kind:"combat-result",id:"EVIDENCE-CBT-TERMINAL"}),locationRef:freeze({kind:"workplace",id:"mill-crossing"})});
  if(mode==="recovered")return presentationModel({...common,phase:"recovered",detail:"Immediate danger has passed. Recovery context remains visible without changing health state.",status:"recovery · danger passed",badges:["RECOVERY","READ ONLY"],terminal:true,recovery:true,sourceRef:freeze({kind:"combat-result",id:"EVIDENCE-CBT-RECOVERY"}),locationRef:freeze({kind:"workplace",id:"mill-crossing"})});
  return presentationModel({...common,phase:"cleared",detail:"",status:"cleared",badges:[],terminal:true,sourceRef:freeze({kind:"simulation-result",id:"EVIDENCE-CLEAR"})});
}
function normalizeExplicit(value){
  const x=value&&typeof value==="object"?value:{};
  const sourceRef=trustedRef(x.sourceRef||x.source);if(x.validated!==true||!sourceRef)return freeze({ok:false,reason:"validated-trusted-source-required"});
  const phase=id(x.phase||x.state||x.status,40).toLowerCase();if(!EVIDENCE_MODES.includes(phase))return freeze({ok:false,reason:"unsupported-presentation-phase"});
  const locationRef=x.locationRef&&typeof x.locationRef==="object"?freeze({kind:id(x.locationRef.kind,60),id:id(x.locationRef.id,180),label:clean(x.locationRef.label||"",100)}):null;
  return freeze({ok:true,model:presentationModel({phase,tone:x.tone,kicker:x.kicker,title:x.title,detail:x.detail||x.summary,status:x.status||phase,fantasyTimestamp:x.fantasyTimestamp||x.timestamp,badges:x.badges,sourceRef,locationRef,worldAnchor:x.worldAnchor||freeze({kind:"canonical-focus"}),terminal:x.terminal===true,recovery:x.recovery===true})});
}
function healthContainsCombatInjury(health,result){
  const resultId=id(result?.id,180);if(!resultId)return false;
  const rows=Array.isArray(health?.injuries)?health.injuries:(Array.isArray(health?.activeInjuries)?health.activeInjuries:[]);
  return rows.some(row=>id(row?.sourceRef?.id,180)===resultId||id(row?.source?.id,180)===resultId);
}
function runtimeModel(optionsValue={}){
  state.modelBuilds++;state.sourceReadTotal=0;state.sourceReads={stage:0,threats:0,combat:0,health:0,time:0};
  const seed=clean(optionsValue.seed||currentSeed(),160);if(!seed)return presentationModel({phase:"cleared",detail:"Campaign unavailable."});
  const stage=safeRead("stage",()=>root.PlanetStage?.snapshot?.(),null);
  const threats=safeRead("threats",()=>root.LocalSecurityIncidents?.list?.(seed,{status:"active",limit:1})||[],[]);
  const results=safeRead("combat",()=>root.PersonalCombatExchange?.list?.(seed,{limit:1},"protagonist")||[],[]);
  const health=safeRead("health",()=>root.ProtagonistHealth?.snapshot?.(seed,"protagonist")||null,null);
  const now=safeRead("time",()=>root.GameTime?.getTimestampKey?.()||null,null);
  const worldAnchor=freeze({kind:"canonical-focus",worldTile:stage?.canonicalFocus?.worldTile||null,latitudeDegrees:stage?.canonicalFocus?.latitudeDegrees??null,longitudeDegrees:stage?.canonicalFocus?.longitudeDegrees??null});
  const latest=Array.isArray(results)?results[0]:null,threat=Array.isArray(threats)?threats[0]:null;
  const latestSeconds=fantasySecondIndex(latest?.fantasyTimestamp),nowSeconds=fantasySecondIndex(now),threatSeconds=fantasySecondIndex(threat?.updatedTimestamp||threat?.createdTimestamp);
  const terminalFresh=Boolean(latest&&(latestSeconds===null||nowSeconds===null||(nowSeconds>=latestSeconds&&nowSeconds-latestSeconds<=TERMINAL_CUE_SECONDS)));
  const newerThreat=Boolean(threat&&(!latest||latestSeconds===null||threatSeconds===null||threatSeconds>latestSeconds));
  if(latest&&!newerThreat){
    const resolution=id(latest.resolution,60).toLowerCase(),disengaged=resolution.includes("disengaged"),recovering=Boolean(latest.protagonistInjuryEvidence&&healthContainsCombatInjury(health,latest));
    if(recovering)return presentationModel({phase:"recovered",title:"Recovering after conflict",detail:"The terminal combat result is recorded; current health still carries its injury evidence.",status:"recovery · "+resolutionLabel(resolution),badges:["RECOVERY","TERMINAL"],terminal:true,recovery:true,sourceRef:freeze({kind:"combat-result",id:id(latest.id)}),locationRef:latest.locationRef||null,worldAnchor,fantasyTimestamp:latest.fantasyTimestamp});
    if(terminalFresh&&disengaged)return presentationModel({phase:"retreat",title:resolutionLabel(resolution),detail:"Simulation recorded disengagement. This cue does not claim victory or move any actor.",status:"terminal disengagement",badges:["DISENGAGED","TERMINAL"],terminal:true,sourceRef:freeze({kind:"combat-result",id:id(latest.id)}),locationRef:latest.locationRef||null,worldAnchor,fantasyTimestamp:latest.fantasyTimestamp});
    if(terminalFresh)return presentationModel({phase:"terminal",title:resolutionLabel(resolution),detail:"A terminal Simulation combat result is available for this local conflict.",status:"terminal · Simulation",badges:["TERMINAL",resolutionLabel(resolution).toUpperCase()],terminal:true,sourceRef:freeze({kind:"combat-result",id:id(latest.id)}),locationRef:latest.locationRef||null,worldAnchor,fantasyTimestamp:latest.fantasyTimestamp});
  }
  if(threat)return presentationModel({phase:"active",title:clean(threat.summary||title(threat.category||"local threat"),100),detail:"Known local security incident. Resolution remains pending.",status:clean((threat.epistemicStatus||"known")+" · "+(threat.severity||"severity unknown"),70),badges:[String(threat.epistemicStatus||"KNOWN").toUpperCase(),String(threat.severity||"ACTIVE").toUpperCase()],sourceRef:threat.sourceRef||freeze({kind:"security-incident",id:id(threat.id)}),locationRef:threat.locationRef||null,worldAnchor,fantasyTimestamp:threat.updatedTimestamp||threat.createdTimestamp});
  return presentationModel({phase:"cleared",worldAnchor,detail:"No bounded active conflict evidence is available."});
}
function getLayer(){return typeof document!=="undefined"?document.getElementById("localConflictPresentation"):null}
function markup(model){
  if(!model?.visible)return '<div class="local-conflict-anchor" hidden></div><aside class="local-conflict-card" hidden></aside>';
  const badges=model.badges.map(x=>'<span>'+esc(x)+'</span>').join("");
  return '<div class="local-conflict-anchor" data-tone="'+esc(model.tone)+'" aria-hidden="true"><i></i><b></b></div>'+
    '<aside class="local-conflict-card" data-tone="'+esc(model.tone)+'" aria-live="polite"><header><small>'+esc(model.kicker)+'</small><span>'+esc(model.status)+'</span></header><strong>'+esc(model.title)+'</strong><p>'+esc(model.detail)+'</p><footer>'+badges+'</footer></aside>';
}
function ensureLayer(){
  if(typeof document==="undefined")return null;let layer=getLayer();if(layer)return layer;
  layer=document.createElement("section");layer.id="localConflictPresentation";layer.className="local-conflict-presentation";layer.setAttribute("aria-label","Local conflict presentation");layer.dataset.safeSlot="world-anchor";(document.body||document.documentElement).appendChild(layer);state.mounted=true;return layer;
}
function anchorSnapshot(){
  let stage=null;state.anchorStageReads++;try{stage=root.PlanetStage?.snapshot?.()||null}catch(_){}const focus=stage?.canonicalFocus?.screenSpaceFocus,canvas=typeof document!=="undefined"?document.getElementById("planetCanvas"):null,rect=canvas?.getBoundingClientRect?.();
  const x=Number(focus?.screenX),y=Number(focus?.screenY);if(!rect||focus?.valid!==true||!Number.isFinite(x)||!Number.isFinite(y))return null;
  return freeze({x:Number((rect.left+x).toFixed(3)),y:Number((rect.top+y).toFixed(3)),screenX:Number(x.toFixed(3)),screenY:Number(y.toFixed(3)),canvasLeft:Number(rect.left.toFixed(3)),canvasTop:Number(rect.top.toFixed(3)),canvasWidth:Number(rect.width.toFixed(3)),canvasHeight:Number(rect.height.toFixed(3)),worldTile:stage?.canonicalFocus?.worldTile||null,latitudeDegrees:stage?.canonicalFocus?.latitudeDegrees??null,longitudeDegrees:stage?.canonicalFocus?.longitudeDegrees??null,source:"PlanetStage.canonicalFocus.screenSpaceFocus"});
}
function syncAnchor(){
  const layer=getLayer(),model=state.lastModel;if(!layer||!model?.visible)return null;
  const anchor=anchorSnapshot();if(!anchor)return null;state.anchorSyncs++;state.lastAnchor=anchor;
  const marker=layer.querySelector(".local-conflict-anchor"),card=layer.querySelector(".local-conflict-card");if(!marker||!card)return anchor;
  marker.style.left=anchor.x+"px";marker.style.top=anchor.y+"px";
  const vw=Number(root.innerWidth||anchor.canvasWidth||1024),vh=Number(root.innerHeight||anchor.canvasHeight||768),cardWidth=Math.min(286,Math.max(220,vw-24)),cardHeight=Math.max(126,Number(card.getBoundingClientRect?.().height||144));
  let left=vw>=700?anchor.x+34:12,top=vw>=700?anchor.y-cardHeight*.55:Math.min(vh-cardHeight-76,anchor.y+42);
  left=Math.max(12,Math.min(vw-cardWidth-12,left));top=Math.max(82,Math.min(vh-cardHeight-76,top));
  card.style.left=Number(left.toFixed(2))+"px";card.style.top=Number(top.toFixed(2))+"px";
  layer.dataset.anchorSource=anchor.source;return anchor;
}
function render(modelValue,reason="render"){
  const model=modelValue||state.lastModel||runtimeModel(),layer=ensureLayer();if(!layer)return model;state.lastModel=model;state.renders++;
  layer.dataset.phase=model.phase;layer.dataset.visible=String(Boolean(model.visible));layer.dataset.reason=clean(reason,60);layer.hidden=!model.visible;layer.innerHTML=markup(model);
  if(model.visible)syncAnchor();return model;
}
function refresh(reason="refresh"){return render(state.explicitEvidence?state.explicitEvidence:(state.evidenceMode?evidenceModel(state.evidenceMode):runtimeModel()),reason)}
function present(value){const n=normalizeExplicit(value);if(!n.ok)return n;state.explicitEvidence=n.model;state.evidenceMode=null;render(n.model,"explicit-event");return freeze({ok:true,model:n.model})}
function clear(reason="cleared"){state.explicitEvidence=presentationModel({phase:"cleared",detail:clean(reason,100)});state.evidenceMode=null;render(state.explicitEvidence,"clear");return state.explicitEvidence}
function setEvidenceMode(modeValue){const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"active";state.evidenceMode=mode;state.explicitEvidence=null;render(evidenceModel(mode),"evidence");return snapshot()}
function startAnchorSync(){if(typeof root.setInterval!=="function"||state.timer)return;state.timer=root.setInterval(()=>{if(state.lastModel?.visible)syncAnchor()},ANCHOR_SYNC_MS)}
function stopAnchorSync(){if(state.timer&&typeof root.clearInterval==="function")root.clearInterval(state.timer);state.timer=null}
function snapshot(){return freeze({version:VERSION,evidenceMode:state.evidenceMode,model:state.lastModel,anchor:state.lastAnchor,mounted:state.mounted,visible:Boolean(state.lastModel?.visible),phase:state.lastModel?.phase||"cleared",modelBuilds:state.modelBuilds,renders:state.renders,anchorSyncs:state.anchorSyncs,anchorStageReads:state.anchorStageReads,sourceReadTotal:state.sourceReadTotal,sourceReads:freeze(clone(state.sourceReads)),limits:freeze({sourceReadLimit:SOURCE_READ_LIMIT,anchorSyncMs:ANCHOR_SYNC_MS,terminalCueSeconds:TERMINAL_CUE_SECONDS,maxVisibleRecords:1,maxBadges:3}),authority:freeze({readOnly:true,presentationOnly:true,eventDriven:true,sourcePolling:false,anchorPresentationTickOnly:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameSourceScan:false,directWorldMutation:false,directActionExecution:false,combatResolution:false,healthMutation:false,standingMutation:false,relationshipMutation:false,rankMutation:false,movementMutation:false,simulationAuthority:false})})}
function init(){
  if(typeof document==="undefined")return false;ensureLayer();
  let requested=null;try{requested=new URLSearchParams(root.location?.search||"").get("conflictPresentationEvidence")}catch(_){}
  if(EVIDENCE_MODES.includes(requested))state.evidenceMode=requested;
  const boot=()=>{const ready=Boolean(root.PlanetStage?.snapshot?.()?.ready);if(!ready)return false;refresh("stage-ready");startAnchorSync();return true};
  if(!boot()){let tries=0;const wait=root.setInterval?.(()=>{tries++;if(boot()||tries>2400)root.clearInterval?.(wait)},100)}
  root.addEventListener?.("resize",syncAnchor,{passive:true});
  document.addEventListener?.("advisor:conflict-presentation-refresh",()=>refresh("event"));
  return true;
}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init()}
return freeze({VERSION,EVIDENCE_MODES,SOURCE_READ_LIMIT,TERMINAL_CUE_SECONDS,ANCHOR_SYNC_MS,evidenceModel,normalizeExplicit,runtimeModel,presentationModel,present,clear,setEvidenceMode,refresh,render,syncAnchor,snapshot,init,stopAnchorSync});
});
