(function(){
"use strict";

const VERSION="1.2.0";
const SCHEMA="PersistentWorldConsequences";
const SCHEMA_VERSION=2;
const REGISTRY_KIND="consequence-registry";
const MAX_LOCAL_RECORDS=8;
const MAX_VISIBLE_RECORDS=3;
const MAX_RECOVERY_PER_ADVANCE=4;
const AUTO_TICK_MS=1500;

const TYPES=Object.freeze({
  "damaged-building":Object.freeze({
    title:"Building damage",icon:"◆",summary:"A damaged village building remains visibly affected until repairs finish.",
    recoveryMinutes:180,targetSlot:0,state:"damaged"
  }),
  "road-blockage":Object.freeze({
    title:"Road blockage",icon:"▰",summary:"A local road obstruction persists until the route is cleared.",
    recoveryMinutes:90,targetSlot:1,state:"blocked"
  }),
  "abandoned-workplace":Object.freeze({
    title:"Abandoned workplace",icon:"⌂",summary:"A workplace remains inactive until local recovery returns it to service.",
    recoveryMinutes:360,targetSlot:2,state:"abandoned"
  })
});

let activeSeed=null;
let timer=0;
let lastSnapshot=Object.freeze({
  version:VERSION,active:false,recordCount:0,activeCount:0,recoveredCount:0,
  localQueries:0,lastResolveMs:0,maxResolveMs:0,eventDriven:true,perFrameScan:false,
  fullWorldScan:false,fullSettlementPerFrameScan:false,lazyLocal:true
});
const telemetryBySeed=new Map();

function clone(v){
  if(v==null||typeof v!=="object")return v;
  if(Array.isArray(v))return v.map(clone);
  const out={};for(const [k,x] of Object.entries(v))out[k]=clone(x);return out;
}
function freeze(v){
  if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;
  for(const x of Object.values(v))freeze(x);return Object.freeze(v);
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function requiredSeed(value){
  const seed=String(value==null?"":value);if(!seed)throw new Error("Campaign SEED is required.");return seed;
}
function normalizeTimestamp(value){
  const s=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");
  return s;
}
function addMinutes(timestamp,minutes){
  const m=normalizeTimestamp(timestamp).match(/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6])));
  d.setUTCMinutes(d.getUTCMinutes()+Number(minutes||0));
  const pad=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
}
function telemetry(seed){
  if(!telemetryBySeed.has(seed))telemetryBySeed.set(seed,{localQueries:0,lastResolveMs:0,maxResolveMs:0,writes:0,recoveries:0,lastWriteReason:null});
  return telemetryBySeed.get(seed);
}
function nowMs(){return typeof performance!=="undefined"&&performance.now?performance.now():Date.now()}
function villageContext(seedValue){
  const seed=requiredSeed(seedValue),plan=window.StartingVillage?.plan?.(seed)||{name:"Starting Village",center:{x:"0",y:"0"}};
  const ref=window.WorldState?.structuralRef?.(seed,REGISTRY_KIND,"WORLD","starting-village",{name:plan.name,center:plan.center,role:"starting-village",authority:"PersistentConsequences registry foundation"})||null;
  return freeze({seed,plan,ref});
}
function emptyRegistry(seed,ref){
  return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,settlementId:ref?.id||null,revision:0,records:[]};
}
function readRegistry(seedValue){
  const seed=requiredSeed(seedValue),ctx=villageContext(seed),t=telemetry(seed),started=nowMs();
  const resolved=ctx.ref&&window.WorldState?.resolve?.(seed,ctx.ref)||null;
  const elapsed=nowMs()-started;t.localQueries++;t.lastResolveMs=elapsed;t.maxResolveMs=Math.max(t.maxResolveMs,elapsed);
  const raw=resolved?.current?.consequenceProjection;
  const registry=(raw&&raw.schema===SCHEMA&&Number(raw.schemaVersion)===SCHEMA_VERSION&&raw.seed===seed)
    ? clone(raw):emptyRegistry(seed,ctx.ref);
  if(!Array.isArray(registry.records))registry.records=[];
  return {ctx,resolved,registry};
}
function orderedRecords(registry){
  return (Array.isArray(registry?.records)?registry.records:[]).filter(Boolean).map(clone).sort((a,b)=>{
    const sa=a.status==="active"?0:1,sb=b.status==="active"?0:1;
    return sa-sb||String(b.startedTimestamp||"").localeCompare(String(a.startedTimestamp||""))||String(a.id).localeCompare(String(b.id));
  });
}
function boundedRegistry(registry){
  const rows=orderedRecords(registry).slice(0,MAX_LOCAL_RECORDS);
  registry.records=rows.map(clone);
  return registry;
}
function writeRegistry(seedValue,registryValue,reasonValue){
  const seed=requiredSeed(seedValue),ctx=villageContext(seed);
  if(!ctx.ref||!window.WorldState?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=boundedRegistry(clone(registryValue||emptyRegistry(seed,ctx.ref)));
  next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.seed=seed;next.settlementId=ctx.ref.id;
  next.revision=Math.max(0,Number(next.revision)||0)+1;
  const result=window.WorldState.applyDelta(seed,ctx.ref,{consequenceProjection:next},String(reasonValue||"persistent-world-consequence"));
  const t=telemetry(seed);t.writes++;t.lastWriteReason=String(reasonValue||"persistent-world-consequence");
  renderPanel(seed);
  return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",entryRevision:Number(result?.entry?.revision||0),registryRevision:next.revision,resolved:result?.resolved||null});
}
function buildingTarget(seed,index){
  const houses=window.HousePlans?.build?.(seed)||[],house=houses[index%Math.max(1,houses.length)]||null;
  if(!house)return null;
  const b=house.bounds||{},x=Math.round((Number(b.minX||0)+Number(b.maxX||0))/2),y=Math.round((Number(b.minY||0)+Number(b.maxY||0))/2);
  return freeze({entityKind:"building",entityId:String(house.id),label:(house.kind==="cabin"?"Cabin ":"House ")+String(house.id),anchor:{x:String(x),y:String(y),level:0},source:"HousePlans"});
}
function roadTarget(seed,index){
  const houses=window.HousePlans?.build?.(seed)||[],house=houses[index%Math.max(1,houses.length)]||null,target=house?.entrance?.target||null;
  if(!target)return freeze({entityKind:"road",entityId:"STARTING-VILLAGE-MAIN-ROAD",label:"Village main road",anchor:{x:"0",y:"0",level:0},source:"StartingVillage"});
  return freeze({entityKind:"road",entityId:"ROAD|"+target.x+"|"+target.y,label:"Village access road",anchor:{x:String(target.x),y:String(target.y),level:0},source:"HousePlans.entrance.target"});
}
function targetFor(seed,type){
  const spec=TYPES[type];if(!spec)return null;
  return type==="road-blockage"?roadTarget(seed,spec.targetSlot):buildingTarget(seed,spec.targetSlot);
}
function consequenceId(seed,type,target,startedTimestamp){
  return "CNS|"+hashText([seed,type,target?.entityKind,target?.entityId,startedTimestamp].join("|"));
}
function descriptor(seedValue,typeValue,startedTimestampValue,optionsValue){
  const seed=requiredSeed(seedValue),type=String(typeValue||""),spec=TYPES[type];if(!spec)throw new Error("Unknown consequence type: "+type);
  const startedTimestamp=normalizeTimestamp(startedTimestampValue),options=optionsValue||{},target=options.target||targetFor(seed,type);
  if(!target)throw new Error("No authoritative local target for consequence: "+type);
  const readyAt=normalizeTimestamp(options.recoveryReadyAt||addMinutes(startedTimestamp,spec.recoveryMinutes));
  return freeze({
    id:consequenceId(seed,type,target,startedTimestamp),type,title:spec.title,icon:spec.icon,summary:spec.summary,
    target:clone(target),status:"active",state:String(options.state||spec.state),severity:String(options.severity||"moderate"),
    startedTimestamp,recovery:freeze({mode:String(options.recoveryMode||"time"),readyAtTimestamp:readyAt,recoveredAtTimestamp:null,condition:String(options.recoveryCondition||"elapsed-authoritative-fantasy-time")}),
    authoritativeStateChange:freeze(clone(options.authoritativeStateChange||{state:String(options.state||spec.state)})),
    presentationRevision:1,scheduleRoutingImpact:Boolean(options.scheduleRoutingImpact===true&&options.scheduleRoutingValidated===true),
    scheduleRoutingValidated:Boolean(options.scheduleRoutingValidated===true),seedOnly:true,localProjection:true
  });
}
function activate(seedValue,typeValue,startedTimestampValue,optionsValue){
  const seed=requiredSeed(seedValue),read=readRegistry(seed),event=descriptor(seed,typeValue,startedTimestampValue,optionsValue);
  const next=clone(read.registry);next.records=orderedRecords(read.registry).filter(record=>record.id!==event.id).concat([clone(event)]);
  return freeze({...writeRegistry(seed,next,"consequence:"+event.type+":activate"),record:event});
}
function recover(seedValue,idValue,recoveredTimestampValue,reasonValue){
  const seed=requiredSeed(seedValue),id=String(idValue||""),when=normalizeTimestamp(recoveredTimestampValue),read=readRegistry(seed),rows=orderedRecords(read.registry),current=rows.find(record=>record.id===id)||null;
  if(!current)return freeze({ok:false,reason:"consequence-not-found",id});
  if(current.status==="recovered")return freeze({ok:true,reason:"already-recovered",record:freeze(clone(current))});
  const next=clone(read.registry),record=clone(current);
  record.status="recovered";record.state="recovered";record.recovery=clone(record.recovery||{});
  record.recovery.recoveredAtTimestamp=when;record.presentationRevision=Math.max(1,Number(record.presentationRevision)||1)+1;
  next.records=rows.map(item=>clone(item.id===id?record:item));telemetry(seed).recoveries++;
  return freeze({...writeRegistry(seed,next,String(reasonValue||"consequence-recovered")),record:freeze(clone(record))});
}
function advance(seedValue,nowValue){
  const seed=requiredSeed(seedValue),now=normalizeTimestamp(nowValue),read=readRegistry(seed),next=clone(read.registry),rows=orderedRecords(read.registry),updates=new Map();
  let changed=0;
  for(const record of rows){
    if(changed>=MAX_RECOVERY_PER_ADVANCE)break;
    if(record.status!=="active"||record.recovery?.mode!=="time"||String(record.recovery?.readyAtTimestamp||"")>now)continue;
    const updated=clone(record);updated.status="recovered";updated.state="recovered";updated.recovery=clone(updated.recovery||{});
    updated.recovery.recoveredAtTimestamp=now;updated.presentationRevision=Math.max(1,Number(updated.presentationRevision)||1)+1;
    updates.set(updated.id,updated);changed++;
  }
  if(changed){next.records=rows.map(record=>clone(updates.get(record.id)||record));telemetry(seed).recoveries+=changed;writeRegistry(seed,next,"consequence:auto-recovery");}
  else renderPanel(seed);
  return snapshot(seed);
}
function projection(seedValue){
  const seed=requiredSeed(seedValue),read=readRegistry(seed),rows=orderedRecords(read.registry).slice(0,MAX_LOCAL_RECORDS);
  return freeze({
    seed,settlementId:read.ctx.ref?.id||null,registryRevision:Number(read.registry.revision||0),
    sourceDeltaRevision:Number(read.resolved?.delta?.revision||0),sourceCurrentSignature:read.resolved?.currentSignature||null,
    records:freeze(rows.map(r=>freeze(clone(r)))),recordCount:rows.length,
    activeCount:rows.filter(r=>r.status==="active").length,recoveredCount:rows.filter(r=>r.status==="recovered").length,
    queryScope:"single starting-village consequence-registry structural ref",registryKind:REGISTRY_KIND,lazyLocal:true,fullWorldScan:false,historyReplay:false
  });
}
function forBuilding(seedValue,buildingIdValue){
  const id=String(buildingIdValue||"");return freeze(projection(seedValue).records.filter(r=>r.target?.entityKind==="building"&&r.target?.entityId===id));
}
function forRoad(seedValue,xValue,yValue){
  const x=String(xValue),y=String(yValue);return freeze(projection(seedValue).records.filter(r=>r.target?.entityKind==="road"&&r.target?.anchor?.x===x&&r.target?.anchor?.y===y));
}
function panel(){
  if(typeof document==="undefined")return null;
  let node=document.getElementById("persistentWorldConsequence");if(node)return node;
  const root=document.getElementById("planetStageRoot")||document.body;if(!root)return null;
  node=document.createElement("aside");node.id="persistentWorldConsequence";node.className="persistent-world-consequence";node.hidden=true;
  node.setAttribute("aria-live","polite");
  node.innerHTML='<div class="consequence-kicker">WORLD CONSEQUENCE</div><div class="consequence-list"></div><div class="consequence-foot">Persistent campaign state · local projection</div>';
  root.appendChild(node);return node;
}
function renderPanel(seedValue){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue||activeSeed||""),node=panel();if(!node)return null;
  if(!seed){node.hidden=true;return null}
  let view=null;try{view=projection(seed)}catch(_){node.hidden=true;return null}
  const rows=view.records.slice(0,MAX_VISIBLE_RECORDS),list=node.querySelector(".consequence-list");
  node.hidden=rows.length===0;node.dataset.active=String(rows.length>0);node.dataset.activeCount=String(view.activeCount);
  if(list){
    list.innerHTML="";
    for(const record of rows){
      const item=document.createElement("div");item.className="consequence-item";item.dataset.status=record.status;item.dataset.type=record.type;
      const status=record.status==="recovered"?"RECOVERED":String(record.state||"ACTIVE").replace(/-/g," ").toUpperCase();
      item.innerHTML='<span class="consequence-icon"></span><div class="consequence-copy"><div class="consequence-head"><strong></strong><span class="consequence-status"></span></div><p></p><small></small></div>';
      item.querySelector(".consequence-icon").textContent=record.icon||"•";
      item.querySelector("strong").textContent=record.title;
      item.querySelector(".consequence-status").textContent=status;
      item.querySelector("p").textContent=record.summary;
      item.querySelector("small").textContent=record.target?.label+" · "+(record.status==="recovered"?"recovered "+String(record.recovery?.recoveredAtTimestamp||"").slice(11,16):"recovery "+String(record.recovery?.readyAtTimestamp||"").slice(11,16));
      list.appendChild(item);
    }
  }
  return view;
}
function snapshot(seedValue){
  const seed=String(seedValue||activeSeed||"");
  if(!seed){lastSnapshot=freeze({...clone(lastSnapshot),active:false,seed:null});return lastSnapshot}
  let view;try{view=projection(seed)}catch(_){view={recordCount:0,activeCount:0,recoveredCount:0,records:[],registryRevision:0,sourceDeltaRevision:0,sourceCurrentSignature:null}}
  const t=telemetry(seed);
  lastSnapshot=freeze({
    version:VERSION,seed,active:view.recordCount>0,recordCount:view.recordCount,activeCount:view.activeCount,recoveredCount:view.recoveredCount,
    registryRevision:view.registryRevision,sourceDeltaRevision:view.sourceDeltaRevision,sourceCurrentSignature:view.sourceCurrentSignature,
    records:freeze((view.records||[]).map(r=>freeze(clone(r)))),
    maxLocalRecords:MAX_LOCAL_RECORDS,maxVisibleRecords:MAX_VISIBLE_RECORDS,maxRecoveryPerAdvance:MAX_RECOVERY_PER_ADVANCE,
    localQueries:t.localQueries,lastResolveMs:Number(t.lastResolveMs.toFixed(3)),maxResolveMs:Number(t.maxResolveMs.toFixed(3)),writes:t.writes,recoveries:t.recoveries,lastWriteReason:t.lastWriteReason,
    eventDriven:true,perFrameScan:false,fullWorldScan:false,fullSettlementPerFrameScan:false,lazyLocal:true,historyReplay:false,
    authority:"WorldState CampaignStateDelta",registryKind:REGISTRY_KIND,presentationOnly:false,presentationAdapterAuthority:false,
    projectionAdapters:freeze(["forBuilding","forRoad","renderPanel"])
  });
  return lastSnapshot;
}
function proofReset(seedValue){
  const seed=requiredSeed(seedValue),read=readRegistry(seed),next=emptyRegistry(seed,read.ctx.ref);
  return writeRegistry(seed,next,"WP-S007-012 proof reset");
}
function proofSetOnly(seedValue,typeValue,startedTimestampValue){
  const seed=requiredSeed(seedValue),event=descriptor(seed,typeValue,startedTimestampValue),read=readRegistry(seed);
  const next=emptyRegistry(seed,read.ctx.ref);next.records=[clone(event)];
  const result=writeRegistry(seed,next,"WP-S007-012 proof "+event.type);
  return freeze({ok:result.ok,record:event,snapshot:snapshot(seed)});
}
function proof(seedValue){
  const seed=requiredSeed(seedValue),start="1201-03-02 09:00:00";
  proofReset(seed);
  const rows=[];
  for(const type of Object.keys(TYPES)){
    const result=activate(seed,type,start);if(result.record)rows.push(result.record);
  }
  const before=snapshot(seed),serialized=window.WorldState?.serializeState?.(seed)||null;
  const stable=before.recordCount===3&&new Set(before.records.map(r=>r.id)).size===3;
  const bounded=before.recordCount<=MAX_LOCAL_RECORDS&&before.maxResolveMs<50;
  return freeze({
    pass:Boolean(stable&&bounded&&serialized?.entries),types:freeze(Object.keys(TYPES)),records:freeze(rows.map(r=>freeze(clone(r)))),
    recordCount:before.recordCount,stableIds:stable,sparseDelta:Boolean(serialized?.entries),boundedLocal:bounded,
    eventDriven:true,perFrameScan:false,fullWorldScan:false,historyReplay:false,lazyLocal:true
  });
}
function autoTick(){
  try{
    const campaign=window.SeedSystem?.getCampaign?.(),seed=campaign?.seed,now=window.GameTime?.getTimestampKey?.();
    if(seed){activeSeed=String(seed);if(now)advance(activeSeed,now);else renderPanel(activeSeed)}
    else renderPanel(null);
  }catch(_){}
}
function startAuto(){
  if(typeof window==="undefined"||timer)return;
  timer=window.setInterval(autoTick,AUTO_TICK_MS);autoTick();
}
if(typeof window!=="undefined"){
  window.addEventListener?.("advisor:world-state-delta-change",event=>{
    try{
      const seed=String(event?.detail?.seed||activeSeed||"");if(seed){activeSeed=seed;renderPanel(seed)}
    }catch(_){}
  });
  if(typeof document!=="undefined"&&document.readyState==="loading")document.addEventListener("DOMContentLoaded",startAuto,{once:true});
  else startAuto();
}

window.PersistentConsequences=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,TYPES,MAX_LOCAL_RECORDS,MAX_VISIBLE_RECORDS,MAX_RECOVERY_PER_ADVANCE,
  villageContext,descriptor,activate,recover,advance,projection,forBuilding,forRoad,snapshot,renderPanel,
  proofReset,proofSetOnly,proof
});
})();
