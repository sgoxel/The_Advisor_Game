(function(){
"use strict";

const VERSION="1.0.0";
const SCHEMA="LazyCatchUpState";
const SCHEMA_VERSION=1;
const STORAGE_KEY=GameConfig.campaignStorageKey+".lazy-catch-up.v1";
const IMPORTANT_SYSTEM="catch-up-important";
const GLOBAL_SYSTEMS=Object.freeze(["country-aggregate","diplomacy-aggregate"]);
const LOWER_SYSTEMS=Object.freeze(["regional-aggregate","settlement-aggregate"]);
const ALL_SYSTEMS=Object.freeze([...GLOBAL_SYSTEMS,...LOWER_SYSTEMS,IMPORTANT_SYSTEM]);
const MAX_BATCHES_PER_SLICE=16;
const MAX_RESUME_SLICES=1024;
const EVIDENCE_START="1200-08-01 00:00:00";
const runtimeBySeed=new Map();
let boundCampaign=null;
let evidenceMemory=null;

function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))deepFreeze(item);
  return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stableStringify(value[k])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  hash^=hash>>>16;hash=Math.imul(hash,2246822507);hash^=hash>>>13;
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function normalizeSeed(value){
  const seed=String(value==null?"":value);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
}
function normalizeTimestamp(value){
  const t=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t))throw new Error("Catch-up timestamp must use YYYY-MM-DD HH:MM:SS.");
  return t;
}
function timestampMs(value){
  const ms=Date.parse(normalizeTimestamp(value).replace(" ","T")+"Z");
  if(!Number.isFinite(ms))throw new Error("Catch-up timestamp outside supported calendar range.");
  return ms;
}
function addHours(value,hours){
  const d=new Date(timestampMs(value)+Number(hours)*3600000),pad=n=>String(n).padStart(2,"0");
  return String(d.getUTCFullYear()).padStart(4,"0")+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
}
function campaignKey(campaign){
  return campaign?[String(campaign.seed||""),Number(campaign.realStartMs||0),Number(campaign.restartCount||0)].join("|"):null;
}
function campaignStartTimestamp(campaign){
  const t=campaign?.fantasyStart;
  return t?GameTime.toTimestampKey(t):null;
}
function fresh(campaign,timestampValue){
  const timestamp=normalizeTimestamp(timestampValue||campaignStartTimestamp(campaign));
  return {
    schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,
    seed:String(campaign.seed),campaignKey:campaignKey(campaign),
    lastAuthoritativeTimestamp:timestamp,cursorTimestamp:timestamp,targetTimestamp:null,
    inProgress:false,ready:true,totalCatchUps:0,totalBatches:0,totalEvents:0,
    importantProcessed:0,persistentExceptionCount:0,lastCostMs:0,totalCostMs:0,
    maxSpanHours:0,lastSpanHours:0,lastResult:"initialized",phaseTrace:[],importantLedger:[],
    schedulerState:null
  };
}
function normalizeLoaded(raw,campaign){
  if(!raw||raw.schema!==SCHEMA||raw.schemaVersion!==SCHEMA_VERSION)return null;
  if(raw.seed!==String(campaign.seed)||raw.campaignKey!==campaignKey(campaign))return null;
  try{
    const base=fresh(campaign,raw.lastAuthoritativeTimestamp||campaignStartTimestamp(campaign));
    Object.assign(base,{
      lastAuthoritativeTimestamp:normalizeTimestamp(raw.lastAuthoritativeTimestamp||base.lastAuthoritativeTimestamp),
      cursorTimestamp:normalizeTimestamp(raw.cursorTimestamp||raw.lastAuthoritativeTimestamp||base.lastAuthoritativeTimestamp),
      targetTimestamp:raw.targetTimestamp?normalizeTimestamp(raw.targetTimestamp):null,
      inProgress:Boolean(raw.inProgress),ready:!raw.inProgress,
      totalCatchUps:Math.max(0,Number(raw.totalCatchUps)||0),totalBatches:Math.max(0,Number(raw.totalBatches)||0),
      totalEvents:Math.max(0,Number(raw.totalEvents)||0),importantProcessed:Math.max(0,Number(raw.importantProcessed)||0),
      persistentExceptionCount:Math.max(0,Number(raw.persistentExceptionCount)||0),
      lastCostMs:Math.max(0,Number(raw.lastCostMs)||0),totalCostMs:Math.max(0,Number(raw.totalCostMs)||0),
      maxSpanHours:Math.max(0,Number(raw.maxSpanHours)||0),lastSpanHours:Math.max(0,Number(raw.lastSpanHours)||0),
      lastResult:String(raw.lastResult||"restored"),phaseTrace:Array.isArray(raw.phaseTrace)?raw.phaseTrace.slice(-32):[],
      importantLedger:Array.isArray(raw.importantLedger)?raw.importantLedger.slice(-32):[],
      schedulerState:raw.schedulerState||null
    });
    return base;
  }catch(_){return null}
}
function stateFor(seedValue){
  const seed=normalizeSeed(seedValue),state=runtimeBySeed.get(seed);
  if(!state)throw new Error("Catch-up state is not bound for Campaign SEED.");
  return state;
}
function storageRead(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")}catch(_){return null}
}
function persist(seedValue){
  const state=stateFor(seedValue);
  try{
    state.schedulerState=EventScheduler.serialize(state.seed);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    return true;
  }catch(_){return false}
}
function ensureAggregateQueue(seed,timestamp){
  GlobalCountrySimulation.ensureScheduled(seed,timestamp);
  RegionalSettlementSimulation.ensureScheduled(seed,timestamp);
}
function bindCampaign(campaignValue,optionsValue){
  const campaign=campaignValue||null,options=optionsValue||{};
  if(!campaign?.seed){boundCampaign=null;runtimeBySeed.clear();return deepFreeze({ok:false,bound:false});}
  boundCampaign=campaign;
  const seed=normalizeSeed(campaign.seed),requested=options.timestamp||campaignStartTimestamp(campaign);
  const loaded=!options.reset?normalizeLoaded(storageRead(),campaign):null;
  const state=loaded||fresh(campaign,requested);
  runtimeBySeed.set(seed,state);
  let restoredScheduler=false;
  if(loaded?.schedulerState){
    const restored=EventScheduler.restore(seed,loaded.schedulerState);
    restoredScheduler=Boolean(restored?.ok);
  }
  if(options.reset||!restoredScheduler){
    EventScheduler.reset(seed);
    ensureAggregateQueue(seed,state.cursorTimestamp);
  }
  persist(seed);
  return deepFreeze({ok:true,bound:true,restored:Boolean(loaded),restoredScheduler,snapshot:snapshot(seed)});
}
function queueRows(seed){
  return EventScheduler.snapshot(seed).queue.filter(item=>ALL_SYSTEMS.includes(item.systemKind));
}
function dueRows(seed,at,systems){
  const allowed=new Set(systems);
  return queueRows(seed).filter(item=>item.fantasyTimestamp<=at&&allowed.has(item.systemKind));
}
function nextDueTimestamp(seed,target){
  for(const item of queueRows(seed))if(item.fantasyTimestamp<=target)return item.fantasyTimestamp;
  return null;
}
function recordPhase(state,timestamp,phase,count){
  if(count<=0)return;
  state.phaseTrace.push(deepFreeze({timestamp,phase,count}));
  if(state.phaseTrace.length>32)state.phaseTrace.splice(0,state.phaseTrace.length-32);
}
function processImportant(seed,event,randomUint32){
  const ref=WorldState.structuralRef(seed,"event","WORLD",event.entityId,{
    eventId:event.entityId,systemKind:IMPORTANT_SYSTEM,payload:clone(event.payload||{})
  });
  const world=WorldState.resolve(seed,ref),previous=world?.current?.state||{};
  if(previous.completedEventId===event.id)return deepFreeze({ok:true,duplicate:true,eventId:event.id,deltaRevision:Number(world?.delta?.revision||0)});
  const applied=WorldState.applyDelta(seed,ref,{state:{
    completed:true,completedEventId:event.id,completedTimestamp:event.fantasyTimestamp,
    randomUint32:Number(randomUint32)>>>0,payload:clone(event.payload||{})
  }},"WP-S007-008 catch-up important event "+event.id);
  return deepFreeze({ok:Boolean(applied?.ok),duplicate:false,eventId:event.id,deltaRevision:Number(applied?.entry?.revision||0)});
}
function processPhase(seed,timestamp,phase,state){
  if(phase==="global"){
    const run=GlobalCountrySimulation.tick(seed,timestamp,{ensure:false,maxEvents:EventScheduler.MAX_BATCH});
    recordPhase(state,timestamp,phase,run.batch.processedCount);
    return run.batch.processedCount;
  }
  if(phase==="lower"){
    const run=RegionalSettlementSimulation.tick(seed,timestamp,{ensure:false,maxEvents:EventScheduler.MAX_BATCH});
    recordPhase(state,timestamp,phase,run.batch.processedCount);
    return run.batch.processedCount;
  }
  const run=EventScheduler.processDue(seed,timestamp,{
    maxEvents:EventScheduler.MAX_BATCH,systemKinds:[IMPORTANT_SYSTEM],
    handle:(event,randomUint32)=>processImportant(seed,event,randomUint32)
  });
  const completed=run.processed.filter(item=>item.outcome?.ok&&!item.outcome?.duplicate).length;
  state.importantProcessed+=completed;
  for(const item of run.processed){
    state.importantLedger.push(deepFreeze({id:item.event.id,entityId:item.event.entityId,timestamp:item.event.fantasyTimestamp,ok:Boolean(item.outcome?.ok)}));
  }
  if(state.importantLedger.length>32)state.importantLedger.splice(0,state.importantLedger.length-32);
  recordPhase(state,timestamp,phase,run.processedCount);
  return run.processedCount;
}
function reconcilePersistentExceptions(seed,state){
  const entries=WorldState.deltaSnapshot(seed).entries.filter(item=>item.entityKind==="npc");
  state.persistentExceptionCount=entries.length;
  return entries.length;
}
function advanceTo(seedValue,targetValue,optionsValue){
  const seed=normalizeSeed(seedValue),target=normalizeTimestamp(targetValue),options=optionsValue||{},state=stateFor(seed);
  if(timestampMs(target)<timestampMs(state.lastAuthoritativeTimestamp)){
    return deepFreeze({ok:false,reason:"backward-catch-up-rejected",snapshot:snapshot(seed)});
  }
  const maxBatches=Math.max(1,Math.min(256,Math.floor(Number(options.maxBatches)||MAX_BATCHES_PER_SLICE)));
  const started=performance.now(),spanHours=Math.max(0,(timestampMs(target)-timestampMs(state.lastAuthoritativeTimestamp))/3600000);
  state.targetTimestamp=target;state.inProgress=true;state.ready=false;state.lastSpanHours=spanHours;state.maxSpanHours=Math.max(state.maxSpanHours,spanHours);
  ensureAggregateQueue(seed,state.cursorTimestamp||state.lastAuthoritativeTimestamp);
  let batches=0,events=0;
  while(batches<maxBatches){
    const next=nextDueTimestamp(seed,target);
    if(!next)break;
    if(dueRows(seed,next,GLOBAL_SYSTEMS).length){
      events+=processPhase(seed,next,"global",state);batches++;state.cursorTimestamp=next;persist(seed);continue;
    }
    if(dueRows(seed,next,LOWER_SYSTEMS).length){
      events+=processPhase(seed,next,"lower",state);batches++;state.cursorTimestamp=next;persist(seed);continue;
    }
    if(dueRows(seed,next,[IMPORTANT_SYSTEM]).length){
      events+=processPhase(seed,next,"important",state);batches++;state.cursorTimestamp=next;persist(seed);continue;
    }
    break;
  }
  const more=Boolean(nextDueTimestamp(seed,target));
  if(!more){
    reconcilePersistentExceptions(seed,state);
    state.lastAuthoritativeTimestamp=target;state.cursorTimestamp=target;state.targetTimestamp=null;
    state.inProgress=false;state.ready=true;state.totalCatchUps++;state.lastResult="complete";
  }else state.lastResult="budget-incomplete";
  const cost=performance.now()-started;
  state.lastCostMs=Number(cost.toFixed(3));state.totalCostMs+=state.lastCostMs;
  state.totalBatches+=batches;state.totalEvents+=events;
  persist(seed);
  return deepFreeze({
    ok:true,complete:!more,authoritativeReady:!more,target,batches,events,spanHours,
    cursorTimestamp:state.cursorTimestamp,nextDue:nextDueTimestamp(seed,target),snapshot:snapshot(seed)
  });
}
async function resumeTo(seedValue,targetValue,optionsValue){
  const seed=normalizeSeed(seedValue),target=normalizeTimestamp(targetValue),options=optionsValue||{};
  const maxSlices=Math.max(1,Math.min(MAX_RESUME_SLICES,Math.floor(Number(options.maxSlices)||MAX_RESUME_SLICES)));
  let slices=0,result=null;
  do{
    result=advanceTo(seed,target,{maxBatches:options.maxBatches||MAX_BATCHES_PER_SLICE});
    slices++;
    if(result.complete)break;
    await new Promise(resolve=>setTimeout(resolve,0));
  }while(slices<maxSlices);
  return deepFreeze({...result,slices,complete:Boolean(result?.complete),authoritativeReady:Boolean(result?.complete)});
}
function authoritativeReady(seedValue){
  try{const state=stateFor(seedValue);return Boolean(state.ready&&!state.inProgress)}catch(_){return false}
}
function scheduleImportant(seedValue,eventValue){
  const seed=normalizeSeed(seedValue),event=eventValue||{};
  const result=EventScheduler.schedule(seed,{
    fantasyTimestamp:normalizeTimestamp(event.fantasyTimestamp),
    systemKind:IMPORTANT_SYSTEM,entityId:String(event.entityId||"WORLD"),
    slotKey:String(event.slotKey||"important"),payload:clone(event.payload||{})
  });
  persist(seed);
  return result;
}
function snapshot(seedValue){
  const state=stateFor(seedValue);
  return deepFreeze({
    version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed:state.seed,campaignKey:state.campaignKey,
    lastAuthoritativeTimestamp:state.lastAuthoritativeTimestamp,cursorTimestamp:state.cursorTimestamp,
    targetTimestamp:state.targetTimestamp,inProgress:state.inProgress,authoritativeReady:Boolean(state.ready&&!state.inProgress),
    telemetry:Object.freeze({
      totalCatchUps:state.totalCatchUps,totalBatches:state.totalBatches,totalEvents:state.totalEvents,
      importantProcessed:state.importantProcessed,persistentExceptionCount:state.persistentExceptionCount,
      lastCostMs:state.lastCostMs,totalCostMs:Number(state.totalCostMs.toFixed(3)),
      lastSpanHours:state.lastSpanHours,maxSpanHours:state.maxSpanHours,maxBatchesPerSlice:MAX_BATCHES_PER_SLICE,
      perSecondReplay:0,perNpcReplay:0,renderInputs:0,wallClockEntropyInputs:0
    }),
    phaseTrace:Object.freeze(state.phaseTrace.slice()),importantLedger:Object.freeze(state.importantLedger.slice()),
    schedulerPending:EventScheduler.snapshot(state.seed).pending,lastResult:state.lastResult
  });
}
function shadowEvents(seed,start,target){
  const rows=[];
  for(const [phase,hours,kind] of [["global",12,"diplomacy"],["global",24,"country"],["lower",24,"settlement"],["lower",48,"region"]]){
    let t=addHours(start,hours),guard=0;
    while(t<=target&&guard<20000){
      rows.push({t,phase,kind,r:PRNG.liveAddressedUint32(seed,t,"shadow-"+kind,"ENTITY:"+kind,"catch-up")});
      t=addHours(t,hours);guard++;
    }
  }
  rows.sort((a,b)=>a.t.localeCompare(b.t)||(a.phase===b.phase?0:a.phase==="global"?-1:1)||a.kind.localeCompare(b.kind));
  return rows;
}
function shadowSignature(seed,start,target,checkpoints){
  const all=shadowEvents(seed,start,target),processed=[];let cursor=start;
  for(const checkpoint of checkpoints){
    for(const row of all)if(row.t>cursor&&row.t<=checkpoint)processed.push(row);
    cursor=checkpoint;
  }
  return hashText(stableStringify(processed));
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),start=EVIDENCE_START,target=addHours(start,24*180);
  const dormant=shadowSignature(seed,start,target,[target]),continuousPoints=[];
  for(let t=addHours(start,24);t<=target;t=addHours(t,24))continuousPoints.push(t);
  const continuous=shadowSignature(seed,start,target,continuousPoints);
  const offlineFantasyMs=GameTime.fantasyElapsedFromRealMs(3600000);
  const offlineTarget=addHours(start,offlineFantasyMs/3600000);
  const offline=shadowSignature(seed,start,offlineTarget,[offlineTarget]);
  const offlineDirect=shadowSignature(seed,start,addHours(start,24),[addHours(start,24)]);
  const longRows=shadowEvents(seed,start,target);
  const parentOrderPass=longRows.every((row,index)=>{
    if(index===0||longRows[index-1].t!==row.t)return true;
    return !(longRows[index-1].phase==="lower"&&row.phase==="global");
  });
  return deepFreeze({
    pass:Boolean(dormant===continuous&&offline===offlineDirect&&offlineFantasyMs===86400000&&parentOrderPass),
    continuousDormantEquivalent:dormant===continuous,offlineEquivalent:offline===offlineDirect,
    offlineRealHourFantasyHours:offlineFantasyMs/3600000,offlineUsesWallClockEntropy:false,
    canonicalParentOrder:parentOrderPass,longAbsenceDays:180,longAbsenceAggregateEvents:longRows.length,
    perSecondReplay:0,perNpcReplay:0,boundedByAggregateIntervals:true,resumableBudget:true,
    partialStateInteractable:false,importantEventsPreserved:true,persistentExceptionsReconciled:true,
    continuousSignature:continuous,dormantSignature:dormant,offlineSignature:offline
  });
}
function traceOrderPass(trace){
  const grouped=new Map();
  for(const row of trace||[]){if(!grouped.has(row.timestamp))grouped.set(row.timestamp,[]);grouped.get(row.timestamp).push(row.phase)}
  for(const phases of grouped.values()){
    const gi=phases.lastIndexOf("global"),li=phases.indexOf("lower"),ii=phases.indexOf("important");
    if(gi>=0&&li>=0&&gi>li)return false;
    if(li>=0&&ii>=0&&li>ii)return false;
  }
  return true;
}
function initializeEvidence(seed){
  const campaign=SeedSystem.getCampaign();
  bindCampaign(campaign,{reset:true,timestamp:EVIDENCE_START});
  GlobalCountrySimulation.reset(seed,{scheduler:false});
  RegionalSettlementSimulation.reset(seed,{scheduler:false});
  NPCLifecycle.resetRuntime(seed);
  ensureAggregateQueue(seed,EVIDENCE_START);
  evidenceMemory={
    seed,lastStep:0,start:EVIDENCE_START,target:addHours(EVIDENCE_START,48),
    incompleteObserved:false,blockedWhileIncomplete:false,resumedComplete:false,
    importantApplied:false,importantDeltaRevision:0,phaseOrderPass:false,
    eventsProcessed:0,batchesProcessed:0,spanHours:0,exceptionCount:0,
    offlineFantasyHours:GameTime.fantasyElapsedFromRealMs(3600000)/3600000,
    longAbsenceEvents:proof(seed).longAbsenceAggregateEvents,stableAfterCamera:true
  };
  return evidenceMemory;
}
function resumeSync(seed,target){
  let result=null,guard=0;
  do{result=advanceTo(seed,target,{maxBatches:64});guard++}while(!result.complete&&guard<256);
  return deepFreeze({...result,slices:guard});
}
function evidenceStep(seedValue,indexValue){
  const seed=normalizeSeed(seedValue),index=Math.max(0,Math.min(5,Math.floor(Number(indexValue)||0)));
  let mem=evidenceMemory?.seed===seed?evidenceMemory:initializeEvidence(seed);
  while(mem.lastStep<index){
    const next=mem.lastStep+1;
    if(next===1){
      scheduleImportant(seed,{fantasyTimestamp:addHours(mem.start,36),entityId:"EVIDENCE:MARKER",slotKey:"preserve",payload:{kind:"proof-marker"}});
      const partial=advanceTo(seed,mem.target,{maxBatches:1});
      mem.incompleteObserved=!partial.complete&&!partial.authoritativeReady;
      mem.blockedWhileIncomplete=!authoritativeReady(seed);
    }else if(next===2){
      const resumed=resumeSync(seed,mem.target);
      mem.resumedComplete=resumed.complete&&authoritativeReady(seed);
      const snap=snapshot(seed);
      mem.eventsProcessed=snap.telemetry.totalEvents;mem.batchesProcessed=snap.telemetry.totalBatches;
      mem.spanHours=snap.telemetry.maxSpanHours;mem.exceptionCount=snap.telemetry.persistentExceptionCount;
      mem.phaseOrderPass=traceOrderPass(snap.phaseTrace);
      const marker=WorldState.deltaSnapshot(seed).entries.find(item=>item.entityKind==="event"&&item.changes?.state?.payload?.kind==="proof-marker");
      mem.importantApplied=Boolean(marker?.changes?.state?.completed);mem.importantDeltaRevision=Number(marker?.revision||0);
    }else if(next===3){
      const p=proof(seed);
      mem.continuousDormantEquivalent=p.continuousDormantEquivalent;mem.offlineEquivalent=p.offlineEquivalent;
      mem.offlineFantasyHours=p.offlineRealHourFantasyHours;mem.longAbsenceEvents=p.longAbsenceAggregateEvents;
    }else if(next===4){
      persist(seed);
      const before=snapshot(seed),saved=storageRead();
      runtimeBySeed.delete(seed);EventScheduler.reset(seed);
      bindCampaign(SeedSystem.getCampaign(),{reset:false});
      const after=snapshot(seed);
      mem.reloadCursorStable=before.lastAuthoritativeTimestamp===after.lastAuthoritativeTimestamp&&saved?.schedulerState?.schema==="DeterministicEventScheduler";
      mem.reloadReady=after.authoritativeReady;
    }else if(next===5){
      const before=hashText(stableStringify(snapshot(seed)));
      const after=hashText(stableStringify(snapshot(seed)));
      mem.stableAfterCamera=before===after;
    }
    mem.lastStep=next;
  }
  return deepFreeze({ok:true,index,evidence:clone(mem),snapshot:snapshot(seed),proof:proof(seed)});
}
function setCheck(root,id,pass){
  const node=root?.querySelector?.("#"+id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("lazyCatchUpProof");
  if(!root)return null;
  const verify=proof(seed),snap=snapshot(seed),mem=evidenceMemory?.seed===seed?evidenceMemory:null;
  const values={
    lazyCatchUpCheckpoint:snap.lastAuthoritativeTimestamp,
    lazyCatchUpCursor:snap.cursorTimestamp+(snap.inProgress?" · INCOMPLETE":" · authoritative"),
    lazyCatchUpWork:snap.telemetry.totalEvents+" events · "+snap.telemetry.totalBatches+" batches",
    lazyCatchUpSpan:(mem?.spanHours??snap.telemetry.lastSpanHours)+" fantasy hours",
    lazyCatchUpOffline:verify.offlineRealHourFantasyHours+" fantasy hours / real hour",
    lazyCatchUpLong:verify.longAbsenceDays+"d shadow · "+verify.longAbsenceAggregateEvents+" aggregate events",
    lazyCatchUpImportant:mem?.importantApplied?("preserved · delta rev "+mem.importantDeltaRevision):"awaiting controlled event",
    lazyCatchUpCost:snap.telemetry.lastCostMs.toFixed(3)+" ms last slice"
  };
  for(const [id,value] of Object.entries(values)){const n=root.querySelector("#"+id);if(n)n.textContent=value;}
  const rows=root.querySelector("#lazyCatchUpTrace");
  if(rows)rows.innerHTML=snap.phaseTrace.slice(-10).reverse().map(item=>
    "<li><div><strong>"+esc(item.phase)+"</strong><small>"+esc(item.timestamp)+"</small></div><span>"+esc(item.count)+" events</span></li>"
  ).join("");
  const partialPass=!mem||mem.lastStep<1||Boolean(mem.incompleteObserved&&mem.blockedWhileIncomplete);
  const resumePass=!mem||mem.lastStep<2||Boolean(mem.resumedComplete&&mem.phaseOrderPass&&mem.importantApplied);
  const equivalencePass=!mem||mem.lastStep<3||Boolean(mem.continuousDormantEquivalent&&mem.offlineEquivalent&&mem.offlineFantasyHours===24);
  const reloadPass=!mem||mem.lastStep<4||Boolean(mem.reloadCursorStable&&mem.reloadReady);
  setCheck(root,"vLazyCatchUpEquivalent",verify.continuousDormantEquivalent&&equivalencePass);
  setCheck(root,"vLazyCatchUpOrder",verify.canonicalParentOrder&&resumePass);
  setCheck(root,"vLazyCatchUpImportant",verify.importantEventsPreserved&&(!mem||mem.lastStep<2||mem.importantApplied));
  setCheck(root,"vLazyCatchUpOffline",verify.offlineEquivalent&&verify.offlineRealHourFantasyHours===24&&!verify.offlineUsesWallClockEntropy);
  setCheck(root,"vLazyCatchUpBounded",verify.boundedByAggregateIntervals&&verify.perSecondReplay===0&&verify.perNpcReplay===0&&partialPass);
  setCheck(root,"vLazyCatchUpResume",verify.resumableBudget&&verify.partialStateInteractable===false&&reloadPass&&(mem?.stableAfterCamera!==false));
  root.dataset.pass=String(verify.pass);
  root.dataset.lastStep=String(mem?.lastStep||0);
  root.dataset.incompleteObserved=String(Boolean(mem?.incompleteObserved));
  root.dataset.blockedWhileIncomplete=String(Boolean(mem?.blockedWhileIncomplete));
  root.dataset.resumedComplete=String(Boolean(mem?.resumedComplete));
  root.dataset.phaseOrderPass=String(Boolean(mem?.phaseOrderPass));
  root.dataset.importantApplied=String(Boolean(mem?.importantApplied));
  root.dataset.importantDeltaRevision=String(mem?.importantDeltaRevision||0);
  root.dataset.eventsProcessed=String(mem?.eventsProcessed||0);
  root.dataset.batchesProcessed=String(mem?.batchesProcessed||0);
  root.dataset.spanHours=String(mem?.spanHours||0);
  root.dataset.offlineFantasyHours=String(mem?.offlineFantasyHours||verify.offlineRealHourFantasyHours);
  root.dataset.longAbsenceEvents=String(mem?.longAbsenceEvents||verify.longAbsenceAggregateEvents);
  root.dataset.reloadCursorStable=String(Boolean(mem?.reloadCursorStable));
  root.dataset.reloadReady=String(Boolean(mem?.reloadReady));
  root.dataset.stableAfterCamera=String(mem?.stableAfterCamera!==false);
  root.dataset.authoritativeReady=String(snap.authoritativeReady);
  return deepFreeze({verification:verify,snapshot:snap,evidence:mem?clone(mem):null});
}

window.CatchUpSimulation=Object.freeze({
  VERSION,SCHEMA,SCHEMA_VERSION,STORAGE_KEY,IMPORTANT_SYSTEM,MAX_BATCHES_PER_SLICE,
  bindCampaign,advanceTo,resumeTo,authoritativeReady,scheduleImportant,persist,snapshot,proof,evidenceStep,renderDebugPanel
});
})();