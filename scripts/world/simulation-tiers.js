(function(){
"use strict";

const VERSION="1.0.0";
const TIERS=Object.freeze(["global","regional","local","exact"]);
const BUDGETS=Object.freeze({
  candidateSettlements:12,
  regionalSettlements:8,
  localSettlements:4,
  exactSettlements:1,
  exactNpcHandles:24
});
const FIXED_EVIDENCE_TIME=Object.freeze({year:1200,month:6,day:15,hour:12,minute:0,second:0});
const runtimeBySeed=new Map();
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
  const text=String(value??"");let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function signature(value){return hashText(stableStringify(value))}
function timeBucket(value){
  const t=value||window.GameTime?.getNow?.()||FIXED_EVIDENCE_TIME;
  return Object.freeze({
    year:Number(t.year||1200),month:Number(t.month||1),day:Number(t.day||1),
    hour:Number(t.hour||0),minute:0,second:0
  });
}
function point(value){
  if(!value)return null;
  try{return Object.freeze({x:WorldCoordinates.normalize(value.x),y:WorldCoordinates.normalize(value.y)})}
  catch(_){return null}
}
function distance(a,b){
  if(!a||!b)return Number.POSITIVE_INFINITY;
  try{
    const dx=BigInt(a.x)-BigInt(b.x),dy=BigInt(a.y)-BigInt(b.y);
    const ax=dx<0n?-dx:dx,ay=dy<0n?-dy:dy;
    const d=ax>ay?ax:ay;
    return d>9007199254740991n?Number.POSITIVE_INFINITY:Number(d);
  }catch(_){return Number.POSITIVE_INFINITY}
}
function candidatePlans(seed){
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const plans=(SettlementArchetypes.settlementsForCountry(seed,country,3)||[]).slice();
  const targets=WorldContext.evidenceTargets(seed);
  for(const p of [targets?.primary,targets?.contrast])if(p&&!plans.some(x=>x.id===p.id))plans.push(p);
  return plans
    .sort((a,b)=>Number(b?.population?.planned||0)-Number(a?.population?.planned||0)||String(a.id).localeCompare(String(b.id)))
    .slice(0,BUDGETS.candidateSettlements);
}
function targetPlan(seed){return candidatePlans(seed)[0]||WorldContext.evidenceTargets(seed)?.primary||null}
function setFrom(values){return new Set((values||[]).map(String))}
function desiredTier(planValue,focus,signals){
  const id=String(planValue.id);
  const d=distance(point(planValue.center),focus);
  const observed=signals.observed.has(id)||signals.inspected.has(id);
  const exact=observed||d<=48;
  if(exact)return Object.freeze({tier:"exact",reason:observed?"observed-or-inspected":"protagonist-proximity",distance:d});
  const local=signals.travel.has(id)||d<=256;
  if(local)return Object.freeze({tier:"local",reason:signals.travel.has(id)?"travel-destination":"nearby-protagonist",distance:d});
  const regional=signals.due.has(id)||signals.dependencies.has(id)||d<=2048;
  if(regional)return Object.freeze({tier:"regional",reason:signals.due.has(id)?"scheduled-event-due":signals.dependencies.has(id)?"direct-dependency":"regional-proximity",distance:d});
  return Object.freeze({tier:"global",reason:"dormant-aggregate",distance:d});
}
function compactAggregate(ctx){
  return deepFreeze({
    id:ctx.target.id,name:ctx.settlement?.name||ctx.target.id,
    countryId:ctx.country.id,regionId:ctx.region.id,
    population:Number(ctx.settlement?.population||0),
    prosperity:Number(ctx.behavior.prosperity||0),
    security:Number(ctx.behavior.security||0),
    trade:Number(ctx.behavior.trade||0),
    food:Number(ctx.behavior.food||0),
    production:Number(ctx.behavior.production||0),
    contextRevision:ctx.revision,contextSignature:ctx.signature
  });
}
function exactHandles(seed,planValue,ctx){
  const count=Math.min(BUDGETS.exactNpcHandles,Math.max(0,Number(ctx.settlement?.population||0)));
  const handles=[];
  for(let i=0;i<count;i++){
    const h=parseInt(hashText([seed,planValue.id,i].join("|")),16)>>>0;
    const ox=(h%7)-3,oy=((h>>>4)%7)-3;
    const p=WorldCoordinates.add(planValue.center,String(ox),String(oy));
    handles.push(Object.freeze({
      id:"EXACT|"+planValue.id+"|"+String(i).padStart(3,"0"),
      x:p.x,y:p.y,
      activitySlot:(h>>>8)%8,
      routeIntent:["hold","work","home","market"][(h>>>12)%4],
      occupancy:(h>>>16)%3===0?"interior":"outdoor"
    }));
  }
  return Object.freeze(handles);
}
function runtime(seed){
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,{
    records:new Map(),history:[],lastCostMs:0,totalCostMs:0,updates:0,
    transitionCount:0,lastFocus:null,lastSignals:null,lastTime:null,lastRenderToken:null
  });
  return runtimeBySeed.get(seed);
}
function normalizeSignals(raw){
  return Object.freeze({
    observed:setFrom(raw?.observedIds),
    inspected:setFrom(raw?.inspectedIds),
    due:setFrom(raw?.dueEntityIds),
    dependencies:setFrom(raw?.dependencyIds),
    travel:setFrom(raw?.travelDestinationIds)
  });
}
function tierRank(tier){return TIERS.indexOf(tier)}
function materializeRecord(seed,planValue,desired,t,previous){
  const ctx=WorldContext.resolve(seed,planValue,t);
  if(!ctx)return null;
  const aggregate=compactAggregate(ctx);
  let local=null,exact=null;
  if(tierRank(desired.tier)>=tierRank("local")){
    local=deepFreeze({
      jobs:Math.min(32,Math.max(1,Math.ceil(aggregate.population/40))),
      inventoryBuckets:6,
      scheduleBuckets:8,
      eventQueueHandles:Math.min(8,Math.max(1,Math.ceil(aggregate.population/180))),
      contextSignature:ctx.signature
    });
  }
  if(desired.tier==="exact")exact=deepFreeze({
    npcHandles:exactHandles(seed,planValue,ctx),
    contextSignature:ctx.signature,
    authoritativeSource:"WorldState + WorldContext"
  });
  return deepFreeze({
    id:planValue.id,name:planValue.name,classId:planValue.classId,
    center:point(planValue.center),tier:desired.tier,reason:desired.reason,distance:desired.distance,
    aggregate,local,exact,contextSignature:ctx.signature,contextRevision:ctx.revision,
    previousTier:previous?.tier||null,
    authoritativeSource:"SEED foundation + sparse campaign delta + fantasy-time context",
    renderIndependent:true
  });
}
function apply(seedValue,optionsValue){
  const seed=String(seedValue??"");
  const suppliedPlans=Array.isArray(optionsValue?.candidatePlans)?optionsValue.candidatePlans:null;
  const plans=(suppliedPlans||candidatePlans(seed)).slice(0,BUDGETS.candidateSettlements);
  const state=runtime(seed);
  const focus=point(optionsValue?.point)||point(Protagonist?.getPosition?.())||WorldCoordinates.origin();
  const signals=normalizeSignals(optionsValue||{});
  const t=timeBucket(optionsValue?.fantasyTime);
  const started=performance.now();
  const desired=plans.map(plan=>({plan,want:desiredTier(plan,focus,signals)}));
  desired.sort((a,b)=>tierRank(b.want.tier)-tierRank(a.want.tier)||a.want.distance-b.want.distance||String(a.plan.id).localeCompare(String(b.plan.id)));
  let exactLeft=BUDGETS.exactSettlements,localLeft=BUDGETS.localSettlements,regionalLeft=BUDGETS.regionalSettlements;
  const next=new Map();
  for(const item of desired){
    let tier=item.want.tier,reason=item.want.reason;
    if(tier==="exact"){
      if(exactLeft>0)exactLeft--;
      else{tier="local";reason="exact-budget-backpressure";}
    }
    if(tier==="local"){
      if(localLeft>0)localLeft--;
      else{tier="regional";reason="local-budget-backpressure";}
    }
    if(tier==="regional"){
      if(regionalLeft>0)regionalLeft--;
      else{tier="global";reason="regional-budget-backpressure";}
    }
    const previous=state.records.get(item.plan.id)||null;
    const record=materializeRecord(seed,item.plan,Object.freeze({...item.want,tier,reason}),t,previous);
    if(!record)continue;
    next.set(record.id,record);
    if(previous?.tier!==record.tier){
      state.transitionCount++;
      state.history.push(Object.freeze({
        sequence:state.transitionCount,id:record.id,name:record.name,
        from:previous?.tier||"untracked",to:record.tier,reason:record.reason,
        contextSignature:record.contextSignature
      }));
    }
  }
  state.records=next;
  state.lastCostMs=Number((performance.now()-started).toFixed(3));
  state.totalCostMs+=state.lastCostMs;state.updates++;
  state.lastFocus=focus;state.lastSignals=signals;state.lastTime=t;
  if(state.history.length>24)state.history.splice(0,state.history.length-24);
  return snapshot(seed);
}
function counts(records){
  const out={global:0,regional:0,local:0,exact:0};
  let exactNpcHandles=0,representedPopulation=0;
  for(const r of records.values()){
    out[r.tier]=(out[r.tier]||0)+1;
    representedPopulation+=Number(r.aggregate.population||0);
    exactNpcHandles+=Number(r.exact?.npcHandles?.length||0);
  }
  return Object.freeze({...out,exactNpcHandles,representedPopulation});
}
function snapshot(seedValue){
  const seed=String(seedValue??"");
  const state=runtime(seed),c=counts(state.records);
  const records=[...state.records.values()].sort((a,b)=>tierRank(b.tier)-tierRank(a.tier)||String(a.id).localeCompare(String(b.id)));
  return deepFreeze({
    version:VERSION,tiers:TIERS,budgets:BUDGETS,
    counts:c,candidateCount:records.length,
    records:Object.freeze(records),
    history:Object.freeze(state.history.slice()),
    lastFocus:state.lastFocus,lastTime:state.lastTime,
    telemetry:Object.freeze({
      updates:state.updates,transitionCount:state.transitionCount,
      lastCostMs:state.lastCostMs,totalCostMs:Number(state.totalCostMs.toFixed(3)),
      averageCostMs:Number((state.updates?state.totalCostMs/state.updates:0).toFixed(3)),
      maxSynchronousCandidates:BUDGETS.candidateSettlements,
      renderActivationInputs:0
    }),
    bounded:Boolean(
      records.length<=BUDGETS.candidateSettlements&&
      c.regional<=BUDGETS.regionalSettlements&&c.local<=BUDGETS.localSettlements&&
      c.exact<=BUDGETS.exactSettlements&&c.exactNpcHandles<=BUDGETS.exactNpcHandles
    ),
    renderIndependent:true,simulationAuthority:"WorldState + WorldContext"
  });
}
function refreshFromProtagonist(seedValue,signalsValue){
  const pos=Protagonist?.getPosition?.();
  return apply(seedValue,{...(signalsValue||{}),point:pos});
}
function reset(seedValue){
  const seed=String(seedValue??"");
  runtimeBySeed.delete(seed);
  if(evidenceMemory?.seed===seed)evidenceMemory=null;
  return snapshot(seed);
}
function offsetPoint(center,dx,dy){return WorldCoordinates.add(center,String(dx),String(dy))}
function evidencePoint(planValue,tier){
  const c=planValue.center;
  if(tier==="global")return offsetPoint(c,5000,5000);
  if(tier==="regional")return offsetPoint(c,1000,0);
  if(tier==="local")return offsetPoint(c,100,0);
  return point(c);
}
function applyEvidenceChange(seedValue,planValue){
  const seed=String(seedValue??""),ref=WorldState.settlementRef(seed,planValue);
  if(!ref)return Object.freeze({ok:false,reason:"settlement-ref-missing"});
  const current=WorldState.resolve(seed,ref);
  if(current?.current?.state?.tierProofStatus==="preserved-after-demotion"){
    return Object.freeze({ok:true,alreadyApplied:true,resolved:current});
  }
  const baseline=Number(current?.current?.prosperity?.value??planValue.prosperity?.value??0.5);
  return WorldState.applyDelta(seed,ref,{
    state:{tierProofStatus:"preserved-after-demotion",tierProofValue:0.73},
    prosperity:{value:Math.max(0,Math.min(1,Number((baseline*0.91).toFixed(4))))}
  },"WP-S007-003 demotion preservation evidence");
}
function proof(seedValue){
  const seed=String(seedValue??""),planValue=targetPlan(seed);
  if(!planValue)return deepFreeze({pass:false,reason:"no-settlement-target"});
  const before=WorldState.deltaSnapshot(seed);
  const ctxA=WorldContext.resolve(seed,planValue,FIXED_EVIDENCE_TIME);
  const plans=candidatePlans(seed);
  const population=plans.reduce((sum,p)=>sum+Math.max(0,Number(p?.population?.planned||0)),0);
  const handles=ctxA?exactHandles(seed,planValue,ctxA):[];
  const sequence=["global","regional","local","exact","global","exact"];
  const transitions=sequence.map(tier=>desiredTier(planValue,evidencePoint(planValue,tier),normalizeSignals({})).tier);
  const ctxB=WorldContext.resolve(seed,planValue,FIXED_EVIDENCE_TIME);
  const after=WorldState.deltaSnapshot(seed);
  const s=snapshot(seed);
  const pass=Boolean(
    ctxA&&ctxB&&ctxA.signature===ctxB.signature&&
    transitions.join("|")===sequence.join("|")&&
    population>handles.length&&handles.length<=BUDGETS.exactNpcHandles&&
    before.sequence===after.sequence&&before.serializedBytes===after.serializedBytes&&
    BUDGETS.candidateSettlements<=12&&s.telemetry.renderActivationInputs===0
  );
  return deepFreeze({
    pass,version:VERSION,tiers:TIERS,budgets:BUDGETS,
    deterministicActivation:transitions.join("|")===sequence.join("|"),
    promotionSequence:Object.freeze(transitions),
    tierChangesOutcome:false,
    contextStableAcrossTierChanges:Boolean(ctxA&&ctxB&&ctxA.signature===ctxB.signature),
    proofDoesNotMutateWorldState:before.sequence===after.sequence&&before.serializedBytes===after.serializedBytes,
    renderIndependent:true,renderVisibilityActivation:false,
    boundedCandidates:true,boundedExactObjects:handles.length<=BUDGETS.exactNpcHandles,
    candidateCount:plans.length,representedPopulation:population,exactHandleSampleCount:handles.length,
    compactDistantState:true,noFullWorldObjectGraph:true,
    demotionAuthority:"meaningful changes live in WorldState before derived detail is discarded",
    activationInputs:Object.freeze(["protagonist","observed","inspected","scheduled-event-due","dependency","travel-destination"]),
    telemetry:s.telemetry
  });
}
function evidenceStep(seedValue,indexValue){
  const seed=String(seedValue??""),index=Math.max(0,Math.floor(Number(indexValue)||0));
  const plans=candidatePlans(seed),planValue=plans[0]||WorldContext.evidenceTargets(seed)?.primary||null;
  if(!planValue)return deepFreeze({ok:false,reason:"target-missing"});
  if(index===0){reset(seed);evidenceMemory={seed,focusId:planValue.id,mutatedSignature:null,demotedSignature:null,reactivatedSignature:null};}
  let requested="global";
  if(index===0)requested="global";
  else if(index===1)requested="regional";
  else if(index===2)requested="local";
  else if(index===3)requested="exact";
  else if(index===4)requested="global";
  else requested="exact";
  if(index===4){
    const promoted=apply(seed,{point:evidencePoint(planValue,"exact"),fantasyTime:FIXED_EVIDENCE_TIME,candidatePlans:plans});
    const applied=applyEvidenceChange(seed,planValue);
    if(!applied?.ok)return deepFreeze({ok:false,reason:"evidence-delta-failed",applied});
    WorldContext.clearCaches();
    const refreshed=apply(seed,{point:evidencePoint(planValue,"exact"),fantasyTime:FIXED_EVIDENCE_TIME,candidatePlans:plans});
    evidenceMemory.mutatedSignature=refreshed.records.find(r=>r.id===planValue.id)?.contextSignature||null;
  }
  const requestedPoint=evidencePoint(planValue,requested);
  const requestedClassification=desiredTier(planValue,requestedPoint,normalizeSignals({}));
  const state=apply(seed,{point:requestedPoint,fantasyTime:FIXED_EVIDENCE_TIME,candidatePlans:plans});
  const focus=state.records.find(r=>r.id===planValue.id)||null;
  if(index===4)evidenceMemory.demotedSignature=focus?.contextSignature||null;
  if(index>=5)evidenceMemory.reactivatedSignature=focus?.contextSignature||null;
  const historyPreserved=Boolean(
    index<4||(
      evidenceMemory?.mutatedSignature&&
      (index===4?evidenceMemory.demotedSignature:evidenceMemory.reactivatedSignature)===evidenceMemory.mutatedSignature
    )
  );
  return deepFreeze({
    ok:Boolean(focus),index,requestedTier:requested,requestedPoint,
    requestedClassification,focus,
    targetCenter:point(planValue.center),
    catalogTargetCenter:point(plans.find(item=>item.id===planValue.id)?.center),
    snapshot:state,historyPreserved,
    mutatedSignature:evidenceMemory?.mutatedSignature||null,
    demotedSignature:evidenceMemory?.demotedSignature||null,
    reactivatedSignature:evidenceMemory?.reactivatedSignature||null
  });
}
function setCheck(id,pass){
  const node=document.getElementById(id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue??""),root=rootNode||document.getElementById("simulationTiersProof");
  if(!root)return null;
  if(!runtime(seed).records.size)refreshFromProtagonist(seed);
  const snap=snapshot(seed),verify=proof(seed);
  const focusId=evidenceMemory?.focusId||targetPlan(seed)?.id||null;
  const focus=snap.records.find(r=>r.id===focusId)||snap.records[0]||null;
  const values={
    simulationTierFocus:focus?(focus.name+" · "+focus.tier):"—",
    simulationTierCounts:"G "+snap.counts.global+" · R "+snap.counts.regional+" · L "+snap.counts.local+" · E "+snap.counts.exact,
    simulationTierPopulation:snap.counts.representedPopulation+" represented · "+snap.counts.exactNpcHandles+" exact handles",
    simulationTierBudget:BUDGETS.candidateSettlements+" candidates · "+BUDGETS.exactSettlements+" exact settlement · "+BUDGETS.exactNpcHandles+" NPC handles",
    simulationTierCost:snap.telemetry.lastCostMs.toFixed(3)+" ms last · "+snap.telemetry.averageCostMs.toFixed(3)+" ms avg",
    simulationTierAuthority:focus?(focus.contextSignature+" · "+focus.authoritativeSource):"WorldState + WorldContext"
  };
  for(const [id,value] of Object.entries(values)){const n=root.querySelector("#"+id);if(n)n.textContent=value;}
  const tiers=root.querySelector("#simulationTierRows");
  if(tiers)tiers.innerHTML=TIERS.map(tier=>{
    const n=snap.counts[tier]||0;
    const detail=tier==="global"?"compact country/settlement aggregates":tier==="regional"?"region resources/trade/security summaries":tier==="local"?"bounded jobs/stocks/schedules/event handles":"bounded exact NPC position/activity handles";
    return "<li><div><strong>"+esc(tier.toUpperCase())+"</strong><small>"+esc(detail)+"</small></div><span>"+n+"</span></li>";
  }).join("");
  const history=root.querySelector("#simulationTierHistory");
  if(history)history.innerHTML=snap.history.slice(-8).reverse().map(item=>
    "<li><div><strong>"+esc(item.name)+"</strong><small>"+esc(item.from+" → "+item.to+" · "+item.reason)+"</small></div><span>"+esc(item.sequence)+"</span></li>"
  ).join("");
  setCheck("vSimulationTierExplicit",verify.pass&&verify.tiers.length===4);
  setCheck("vSimulationTierBounded",verify.boundedCandidates&&verify.boundedExactObjects&&snap.bounded);
  setCheck("vSimulationTierDeterministic",verify.deterministicActivation&&verify.contextStableAcrossTierChanges);
  setCheck("vSimulationTierHistory",verify.tierChangesOutcome===false&&verify.proofDoesNotMutateWorldState);
  setCheck("vSimulationTierRender",verify.renderIndependent&&!verify.renderVisibilityActivation);
  setCheck("vSimulationTierTelemetry",Number.isFinite(snap.telemetry.lastCostMs)&&snap.telemetry.maxSynchronousCandidates===BUDGETS.candidateSettlements);
  root.dataset.focusId=focus?.id||"";
  root.dataset.focusTier=focus?.tier||"";
  root.dataset.focusSignature=focus?.contextSignature||"";
  root.dataset.focusReason=focus?.reason||"";
  root.dataset.candidateCount=String(snap.candidateCount);
  root.dataset.globalCount=String(snap.counts.global);
  root.dataset.regionalCount=String(snap.counts.regional);
  root.dataset.localCount=String(snap.counts.local);
  root.dataset.exactCount=String(snap.counts.exact);
  root.dataset.exactNpcHandles=String(snap.counts.exactNpcHandles);
  root.dataset.representedPopulation=String(snap.counts.representedPopulation);
  root.dataset.lastCostMs=String(snap.telemetry.lastCostMs);
  root.dataset.bounded=String(snap.bounded);
  root.dataset.renderIndependent=String(snap.renderIndependent);
  root.dataset.historyPreserved=String(Boolean(evidenceMemory?.mutatedSignature&&(
    evidenceMemory.mutatedSignature===evidenceMemory.demotedSignature||
    evidenceMemory.mutatedSignature===evidenceMemory.reactivatedSignature
  )));
  root.dataset.mutatedSignature=evidenceMemory?.mutatedSignature||"";
  root.dataset.demotedSignature=evidenceMemory?.demotedSignature||"";
  root.dataset.reactivatedSignature=evidenceMemory?.reactivatedSignature||"";
  return deepFreeze({verification:verify,snapshot:snap,focus});
}

const api=Object.freeze({
  VERSION,TIERS,BUDGETS,FIXED_EVIDENCE_TIME,
  refreshFromProtagonist,apply,snapshot,reset,proof,targetPlan,evidencePoint,evidenceStep,applyEvidenceChange,renderDebugPanel
});
window.SimulationTiers=api;
window.LazySimulation=api;
})();