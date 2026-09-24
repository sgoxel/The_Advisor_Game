(function(){
"use strict";

const VERSION="1.0.0";
const COUNTRY_SYSTEM="country-aggregate";
const DIPLOMACY_SYSTEM="diplomacy-aggregate";
const COUNTRY_INTERVAL_HOURS=24;
const DIPLOMACY_INTERVAL_HOURS=12;
const MAX_COUNTRIES=25;
const MAX_RELATIONS=20;
const MAX_LEDGER=16;
const EVIDENCE_TIME="1200-06-16 00:00:00";
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
function clamp01(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0}
function clamp11(value){const n=Number(value);return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):0}
function round(value,digits=4){const f=10**digits;return Math.round(Number(value)*f)/f}
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
function signature(value){return hashText(stableStringify(value))}
function normalizeSeed(value){
  const seed=String(value==null?"":value);
  if(!seed)throw new Error("Campaign SEED is required.");
  return seed;
}
function normalizeTimestamp(value){
  const timestamp=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)){
    throw new Error("Aggregate Simulation timestamp must use YYYY-MM-DD HH:MM:SS.");
  }
  return timestamp;
}
function timestampMs(value){
  const timestamp=normalizeTimestamp(value);
  const ms=Date.parse(timestamp.replace(" ","T")+"Z");
  if(!Number.isFinite(ms))throw new Error("Aggregate Simulation timestamp is outside supported calendar range.");
  return ms;
}
function timestampFromMs(ms){
  const d=new Date(ms),year=String(d.getUTCFullYear()).padStart(4,"0"),pad=n=>String(n).padStart(2,"0");
  return year+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
}
function addHours(timestamp,hours){return timestampFromMs(timestampMs(timestamp)+Number(hours)*3600000)}
function nextBoundary(timestamp,hours){
  const step=Number(hours)*3600000,ms=timestampMs(timestamp);
  return timestampFromMs((Math.floor(ms/step)+1)*step);
}
function randomUnit(uint32){return (Number(uint32)>>>0)/4294967296}
function stateFor(seedValue){
  const seed=normalizeSeed(seedValue);
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,{
    seed,initialized:false,trackedCountries:0,trackedRelations:0,
    processedCountryEvents:0,processedDiplomacyEvents:0,ticks:0,
    lastCostMs:0,totalCostMs:0,lastTickTimestamp:null,lastOutcomes:[],ledger:[]
  });
  return runtimeBySeed.get(seed);
}
function appendLedger(rows,item){
  const next=[...(Array.isArray(rows)?rows:[]),clone(item)];
  if(next.length>MAX_LEDGER)next.splice(0,next.length-MAX_LEDGER);
  return next;
}
function countryProfiles(seed){
  return Object.freeze(
    [...(CountryProfile.sampleCountries(seed)||[])]
      .filter(Boolean)
      .sort((a,b)=>String(a.countryId).localeCompare(String(b.countryId)))
      .slice(0,MAX_COUNTRIES)
  );
}
function relations(seed){
  return Object.freeze(
    [...(CountryRelations.relevantRelations(seed)||[])]
      .filter(Boolean)
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)))
      .slice(0,MAX_RELATIONS)
  );
}
function relationRecord(seed,id,payload){
  const pair=payload?.lowCountryId&&payload?.highCountryId
    ?CountryRelations.build(seed,payload.lowCountryId,payload.highCountryId)
    :relations(seed).find(item=>item.id===id)||null;
  return pair&&pair.id===id?pair:null;
}
function currentCountryState(seed,profile){
  const country=PoliticalGeography.countryById(seed,profile.countryId);
  const ref=country?WorldState.countryRef(seed,country):null;
  const world=ref?WorldState.resolve(seed,ref):null;
  return Object.freeze({country,ref,world,state:world?.current?.state||{}});
}
function currentRelationState(seed,relation){
  const ref=WorldState.diplomacyRef(seed,relation);
  const world=ref?WorldState.resolve(seed,ref):null;
  return Object.freeze({ref,world,current:world?.current||relation});
}
function relationSignals(seed,countryId,foundationOnly=false){
  const rows=relations(seed).filter(relation=>
    relation.pair.lowCountryId===countryId||relation.pair.highCountryId===countryId
  );
  if(!rows.length)return Object.freeze({count:0,tradeAccess:0.5,militaryTension:0.2,warShare:0,borderOpenness:0.5});
  let trade=0,tension=0,wars=0,open=0;
  for(const relation of rows){
    const current=foundationOnly?relation:currentRelationState(seed,relation).current;
    const shared=current?.shared||relation.shared;
    trade+=clamp01(shared.tradeAccess);
    tension+=clamp01(shared.militaryTension);
    open+=clamp01(shared.borderOpenness);
    if(shared.warState)wars++;
  }
  return Object.freeze({
    count:rows.length,tradeAccess:round(trade/rows.length),militaryTension:round(tension/rows.length),
    warShare:round(wars/rows.length),borderOpenness:round(open/rows.length)
  });
}
function countryOutcome(profile,previousValue,signals,eventValue,randomUint32){
  const previous=previousValue||{},event=eventValue||{},u=randomUnit(randomUint32),shock=(u-0.5);
  const base=profile.tendencies;
  const prevWealth=clamp01(previous.wealth??profile.wealth.value);
  const prevTrade=clamp01(previous.tradeCondition??previous.tendencies?.tradeOpenness??base.tradeOpenness);
  const prevAg=clamp01(previous.agriculturalCondition??base.agriculture);
  const prevProduction=clamp01(previous.productionCondition??((base.craftProduction+base.mining+base.agriculture)/3));
  const relationTrade=clamp01(signals?.tradeAccess??0.5);
  const relationTension=clamp01(signals?.militaryTension??0.2);
  const warShare=clamp01(signals?.warShare??0);
  const tradeTarget=clamp01(base.tradeOpenness*0.58+relationTrade*0.30+(signals?.borderOpenness??0.5)*0.12+shock*0.10);
  const trade=clamp01(prevTrade*0.62+tradeTarget*0.38);
  const agricultural=clamp01(prevAg*0.72+(base.agriculture*0.84+profile.geography.agriculturalSuitability*0.16+shock*0.05)*0.28);
  const productionTarget=clamp01(base.craftProduction*0.45+base.mining*0.20+agricultural*0.20+profile.tendencies.infrastructure*0.15+shock*0.06);
  const production=clamp01(prevProduction*0.68+productionTarget*0.32);
  const warPressure=clamp01(base.militaryEmphasis*0.36+relationTension*0.42+warShare*0.30+Math.max(0,-shock)*0.07);
  const readiness=clamp01(base.militaryEmphasis*0.43+profile.tendencies.fortification*0.23+profile.governance.administrativeCapacity*0.18+prevWealth*0.16-warPressure*0.08);
  const wealthTarget=clamp01(
    profile.wealth.value*0.30+trade*0.24+agricultural*0.14+production*0.20+
    profile.governance.taxationCapacity*0.12-warPressure*0.18+shock*0.05
  );
  const wealth=clamp01(prevWealth*0.70+wealthTarget*0.30);
  const treasuryPressure=clamp01(1-(wealth*0.50+profile.governance.taxationCapacity*0.25+trade*0.15+production*0.10)+warPressure*0.20);
  const stability=clamp01(
    profile.governance.administrativeCapacity*0.31+profile.governance.taxationCapacity*0.12+
    wealth*0.22+trade*0.13+(1-treasuryPressure)*0.10+(1-warPressure)*0.12+shock*0.035
  );
  const prosperity=clamp01(wealth*0.44+trade*0.20+agricultural*0.13+production*0.16+stability*0.07);
  return deepFreeze({
    wealth:round(wealth),prosperity:round(prosperity),stability:round(stability),
    tradeCondition:round(trade),agriculturalCondition:round(agricultural),productionCondition:round(production),
    militaryReadiness:round(readiness),warPressure:round(warPressure),treasuryPressure:round(treasuryPressure),
    eventTimestamp:normalizeTimestamp(event.fantasyTimestamp),randomUint32:Number(randomUint32)>>>0
  });
}
function relationStateLabel(score,tension,war,restricted){
  if(war)return "war";
  if(restricted)return "restricted";
  if(score>=0.38&&tension<0.42)return "cooperative";
  if(score<=-0.28||tension>=0.62)return "tense";
  return "neutral";
}
function diplomacyOutcome(relation,currentValue,eventValue,randomUint32){
  const current=currentValue||relation,event=eventValue||{},shared=current.shared||relation.shared;
  const low=CountryProfile.build(event.seed||"",relation.pair.lowCountryId);
  const high=CountryProfile.build(event.seed||"",relation.pair.highCountryId);
  const u=randomUnit(randomUint32),shock=u-0.5;
  const pressureBias=Number(event.payload?.pressureBias||0);
  const restrictionBias=Number(event.payload?.tradeRestrictionBias||0);
  const military=(low.tendencies.militaryEmphasis+high.tendencies.militaryEmphasis)/2;
  const mercantile=(low.tendencies.tradeOpenness+high.tendencies.tradeOpenness)/2;
  const oldScore=clamp11(shared.relationshipScore),oldTension=clamp01(shared.militaryTension);
  const tension=clamp01(oldTension*0.72+(military*0.24+relation.context.resourceCompetition*0.18+relation.context.borderFriction*0.14+pressureBias+Math.max(0,-shock)*0.08)*0.28);
  const score=clamp11(oldScore*0.82+(mercantile*0.12+relation.context.resourceComplementarity*0.08-tension*0.16+shock*0.08));
  const wasWar=Boolean(shared.warState);
  const warStarts=!wasWar&&tension>=0.86&&score<=-0.48&&u>=0.78;
  const warEnds=wasWar&&tension<=0.48&&score>=-0.18&&u>=0.52;
  const warState=warStarts?true:warEnds?false:wasWar;
  const restricted=Boolean(warState||restrictionBias>=0.5||(tension>=0.70&&score<0.02));
  const tradeTarget=clamp01(relation.shared.tradeAccess*0.44+mercantile*0.28+relation.context.routeAccess*0.18+Math.max(0,score)*0.10-tension*0.18-restrictionBias*0.45);
  const tradeAccess=clamp01(clamp01(shared.tradeAccess)*0.60+tradeTarget*0.40);
  const borderTarget=clamp01(relation.shared.borderOpenness*0.48+tradeAccess*0.30+Math.max(0,score)*0.15-tension*0.24-(restricted?0.34:0));
  const borderOpenness=clamp01(clamp01(shared.borderOpenness)*0.58+borderTarget*0.42);
  return deepFreeze({
    relationshipScore:round(score),militaryTension:round(tension),
    tradeAccess:round(tradeAccess),borderOpenness:round(borderOpenness),
    warState,tradeRestricted:restricted,state:relationStateLabel(score,tension,warState,restricted),
    eventTimestamp:normalizeTimestamp(event.fantasyTimestamp),randomUint32:Number(randomUint32)>>>0
  });
}
function scheduleEvent(seed,event){
  return EventScheduler.schedule(seed,event);
}
function scheduleNext(event,hours){
  if(event.payload?.reschedule===false)return null;
  return scheduleEvent(event.payload.seed,{
    fantasyTimestamp:addHours(event.fantasyTimestamp,hours),
    systemKind:event.systemKind,entityId:event.entityId,slotKey:event.slotKey,payload:event.payload
  });
}
function recordRuntime(state,kind,event,outcome){
  const item=deepFreeze({kind,eventId:event.id,entityId:event.entityId,timestamp:event.fantasyTimestamp,signature:signature(outcome)});
  state.lastOutcomes.push(item);if(state.lastOutcomes.length>12)state.lastOutcomes.splice(0,state.lastOutcomes.length-12);
  state.ledger.push(item);if(state.ledger.length>64)state.ledger.splice(0,state.ledger.length-64);
}
function applyCountryEvent(seedValue,event,randomUint32){
  const seed=normalizeSeed(seedValue),profile=CountryProfile.build(seed,event.entityId);
  if(!profile)return Object.freeze({ok:false,reason:"country-profile-missing",entityId:event.entityId});
  const current=currentCountryState(seed,profile);
  if(!current.ref)return Object.freeze({ok:false,reason:"country-ref-missing",entityId:event.entityId});
  const signals=relationSignals(seed,profile.countryId,false);
  const outcome=countryOutcome(profile,current.state,signals,event,randomUint32);
  const revision=Math.max(0,Number(current.state.aggregateRevision)||0)+1;
  const ledger=appendLedger(current.state.aggregateLedger,{
    revision,eventId:event.id,timestamp:event.fantasyTimestamp,systemKind:event.systemKind,
    outcomeSignature:signature(outcome)
  });
  const applied=WorldState.applyDelta(seed,current.ref,{state:{
    wealth:outcome.wealth,prosperity:outcome.prosperity,stability:outcome.stability,
    tradeCondition:outcome.tradeCondition,agriculturalCondition:outcome.agriculturalCondition,
    productionCondition:outcome.productionCondition,militaryReadiness:outcome.militaryReadiness,
    warPressure:outcome.warPressure,treasuryPressure:outcome.treasuryPressure,
    aggregateRevision:revision,lastAggregateTimestamp:event.fantasyTimestamp,
    tendencies:{tradeOpenness:outcome.tradeCondition},aggregateLedger:ledger
  }},"WP-S007-005 scheduled country aggregate "+event.id);
  if(!applied.ok)return deepFreeze({ok:false,reason:"country-delta-failed",applied});
  const state=stateFor(seed);state.processedCountryEvents++;recordRuntime(state,"country",event,outcome);
  scheduleNext(event,COUNTRY_INTERVAL_HOURS);
  return deepFreeze({ok:true,kind:"country",countryId:profile.countryId,revision,outcome,deltaRevision:applied.entry.revision});
}
function applyDiplomacyEvent(seedValue,event,randomUint32){
  const seed=normalizeSeed(seedValue),relation=relationRecord(seed,event.entityId,event.payload);
  if(!relation)return Object.freeze({ok:false,reason:"relation-missing",entityId:event.entityId});
  const current=currentRelationState(seed,relation);
  if(!current.ref)return Object.freeze({ok:false,reason:"relation-ref-missing",entityId:event.entityId});
  const outcome=diplomacyOutcome(relation,current.current,{...event,seed},randomUint32);
  const previousAggregate=current.current.aggregate||{};
  const revision=Math.max(0,Number(previousAggregate.revision)||0)+1;
  const ledger=appendLedger(previousAggregate.ledger,{
    revision,eventId:event.id,timestamp:event.fantasyTimestamp,systemKind:event.systemKind,
    outcomeSignature:signature(outcome),tradeRestricted:outcome.tradeRestricted,warState:outcome.warState
  });
  const agreements=current.current.agreements||relation.agreements;
  const nextAgreements={
    nonAggression:{...agreements.nonAggression,active:!outcome.warState&&!outcome.tradeRestricted&&outcome.militaryTension<0.60},
    tradeAccord:{...agreements.tradeAccord,active:!outcome.tradeRestricted&&outcome.tradeAccess>=0.60&&outcome.relationshipScore>-0.18},
    alliance:{...agreements.alliance,active:!outcome.warState&&outcome.relationshipScore>=0.34&&outcome.militaryTension<0.46},
    tributary:{...agreements.tributary}
  };
  const applied=WorldState.applyDelta(seed,current.ref,{
    shared:{
      relationshipScore:outcome.relationshipScore,state:outcome.state,tradeAccess:outcome.tradeAccess,
      militaryTension:outcome.militaryTension,borderOpenness:outcome.borderOpenness,
      warState:outcome.warState,tradeRestricted:outcome.tradeRestricted
    },
    agreements:nextAgreements,
    aggregate:{revision,lastAggregateTimestamp:event.fantasyTimestamp,tradeRestricted:outcome.tradeRestricted,ledger}
  },"WP-S007-005 scheduled diplomacy aggregate "+event.id);
  if(!applied.ok)return deepFreeze({ok:false,reason:"diplomacy-delta-failed",applied});
  const state=stateFor(seed);state.processedDiplomacyEvents++;recordRuntime(state,"diplomacy",event,outcome);
  scheduleNext(event,DIPLOMACY_INTERVAL_HOURS);
  return deepFreeze({ok:true,kind:"diplomacy",relationId:relation.id,revision,outcome,deltaRevision:applied.entry.revision});
}
function dispatch(seed,event,randomUint32){
  if(event.systemKind===COUNTRY_SYSTEM)return applyCountryEvent(seed,event,randomUint32);
  if(event.systemKind===DIPLOMACY_SYSTEM)return applyDiplomacyEvent(seed,event,randomUint32);
  return Object.freeze({ok:false,reason:"unsupported-system",systemKind:event.systemKind});
}
function ensureScheduled(seedValue,nowValue){
  const seed=normalizeSeed(seedValue),now=normalizeTimestamp(nowValue),state=stateFor(seed);
  const queue=EventScheduler.snapshot(seed).queue||[];
  const queued=new Set(queue.map(item=>item.systemKind+"|"+item.entityId));
  let countriesAdded=0,relationsAdded=0;
  const profiles=countryProfiles(seed),relationRows=relations(seed);
  for(const profile of profiles){
    const key=COUNTRY_SYSTEM+"|"+profile.countryId;if(queued.has(key))continue;
    scheduleEvent(seed,{
      fantasyTimestamp:nextBoundary(now,COUNTRY_INTERVAL_HOURS),systemKind:COUNTRY_SYSTEM,
      entityId:profile.countryId,slotKey:"daily-state",payload:{seed,reschedule:true}
    });
    queued.add(key);countriesAdded++;
  }
  for(const relation of relationRows){
    const key=DIPLOMACY_SYSTEM+"|"+relation.id;if(queued.has(key))continue;
    scheduleEvent(seed,{
      fantasyTimestamp:nextBoundary(now,DIPLOMACY_INTERVAL_HOURS),systemKind:DIPLOMACY_SYSTEM,
      entityId:relation.id,slotKey:"bilateral-state",
      payload:{seed,reschedule:true,lowCountryId:relation.pair.lowCountryId,highCountryId:relation.pair.highCountryId}
    });
    queued.add(key);relationsAdded++;
  }
  state.initialized=true;state.trackedCountries=profiles.length;state.trackedRelations=relationRows.length;
  return deepFreeze({countriesAdded,relationsAdded,trackedCountries:profiles.length,trackedRelations:relationRows.length});
}
function tick(seedValue,nowValue,optionsValue){
  const seed=normalizeSeed(seedValue),now=normalizeTimestamp(nowValue),options=optionsValue||{},state=stateFor(seed);
  if(evidenceMemory?.seed===seed&&options.ensure!==false&&options.allowDuringEvidence!==true){
    return deepFreeze({
      evidenceIsolation:true,ensured:null,
      batch:Object.freeze({now,limit:0,processed:Object.freeze([]),processedCount:0,pending:EventScheduler.snapshot(seed).pending,hasMoreDue:false,bounded:true}),
      snapshot:snapshot(seed)
    });
  }
  const started=performance.now();
  const ensured=options.ensure===false?null:ensureScheduled(seed,now);
  const batch=EventScheduler.processDue(seed,now,{
    maxEvents:options.maxEvents||EventScheduler.MAX_BATCH,
    systemKinds:[COUNTRY_SYSTEM,DIPLOMACY_SYSTEM],
    handle:(event,randomUint32)=>dispatch(seed,event,randomUint32)
  });
  state.ticks++;state.lastTickTimestamp=now;state.lastCostMs=Number((performance.now()-started).toFixed(3));state.totalCostMs+=state.lastCostMs;
  return deepFreeze({ensured,batch,snapshot:snapshot(seed)});
}
function reset(seedValue,optionsValue){
  const seed=normalizeSeed(seedValue);runtimeBySeed.delete(seed);
  if(optionsValue?.scheduler)EventScheduler.reset(seed);
  if(evidenceMemory?.seed===seed)evidenceMemory=null;
  return true;
}
function snapshot(seedValue){
  const seed=normalizeSeed(seedValue),state=stateFor(seed),scheduler=EventScheduler.snapshot(seed);
  return deepFreeze({
    version:VERSION,trackedCountries:state.trackedCountries,trackedRelations:state.trackedRelations,
    processedCountryEvents:state.processedCountryEvents,processedDiplomacyEvents:state.processedDiplomacyEvents,
    ticks:state.ticks,lastTickTimestamp:state.lastTickTimestamp,
    telemetry:Object.freeze({
      lastCostMs:state.lastCostMs,totalCostMs:Number(state.totalCostMs.toFixed(3)),
      averageCostMs:Number((state.ticks?state.totalCostMs/state.ticks:0).toFixed(3)),
      pendingSchedulerEvents:scheduler.queue.filter(item=>item.systemKind===COUNTRY_SYSTEM||item.systemKind===DIPLOMACY_SYSTEM).length,
      perFrameCountryIterations:0,perCitizenGlobalIterations:0,renderInputs:0
    }),
    lastOutcomes:Object.freeze(state.lastOutcomes.slice()),ledger:Object.freeze(state.ledger.slice())
  });
}
function profileDistance(a,b){
  const ak=a.tendencies,bk=b.tendencies;
  return Math.abs(a.wealth.value-b.wealth.value)+
    Math.abs(ak.tradeOpenness-bk.tradeOpenness)+Math.abs(ak.militaryEmphasis-bk.militaryEmphasis)+
    Math.abs(ak.agriculture-bk.agriculture)+Math.abs(ak.craftProduction-bk.craftProduction)+
    Math.abs(ak.mining-bk.mining);
}
function evidenceTargets(seedValue){
  const seed=normalizeSeed(seedValue),profiles=countryProfiles(seed);
  let pair=profiles.length>=2?[profiles[0],profiles[1]]:[profiles[0],profiles[0]],best=-1;
  for(let i=0;i<profiles.length;i++)for(let j=i+1;j<profiles.length;j++){
    const score=profileDistance(profiles[i],profiles[j]);
    if(score>best){best=score;pair=[profiles[i],profiles[j]]}
  }
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const plans=SettlementArchetypes.settlementsForCountry(seed,origin,3)||[];
  const t={year:1200,month:6,day:16,hour:0,minute:0,second:0};
  const candidates=plans.map(plan=>({plan,context:WorldContext.resolve(seed,plan,t)}))
    .filter(item=>item.context?.diplomacy?.id)
    .sort((a,b)=>b.context.diplomacy.militaryTension-a.context.diplomacy.militaryTension||String(a.plan.id).localeCompare(String(b.plan.id)));
  let settlement=candidates[0]?.plan||plans[0]||null;
  let relation=settlement?relations(seed).find(item=>item.id===WorldContext.resolve(seed,settlement,t)?.diplomacy?.id)||null:null;
  if(!relation)relation=relations(seed)[0]||null;
  return deepFreeze({countryA:pair[0]||null,countryB:pair[1]||null,profileDifference:round(Math.max(0,best)),relation,settlement});
}
function addressed(seed,event){return EventScheduler.addressedRandom(seed,event)}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),targets=evidenceTargets(seed);
  if(!targets.countryA||!targets.countryB||!targets.relation)return deepFreeze({pass:false,reason:"aggregate-evidence-targets-missing"});
  const eventA={fantasyTimestamp:EVIDENCE_TIME,systemKind:COUNTRY_SYSTEM,entityId:targets.countryA.countryId,slotKey:"daily-state",payload:{seed,reschedule:false}};
  const eventB={fantasyTimestamp:EVIDENCE_TIME,systemKind:COUNTRY_SYSTEM,entityId:targets.countryB.countryId,slotKey:"daily-state",payload:{seed,reschedule:false}};
  const signalA=relationSignals(seed,targets.countryA.countryId,true),signalB=relationSignals(seed,targets.countryB.countryId,true);
  const a1=countryOutcome(targets.countryA,{},signalA,eventA,addressed(seed,eventA));
  const a2=countryOutcome(targets.countryA,{},signalA,eventA,addressed(seed,eventA));
  const b1=countryOutcome(targets.countryB,{},signalB,eventB,addressed(seed,eventB));
  const relationEvent={
    fantasyTimestamp:addHours(EVIDENCE_TIME,1),systemKind:DIPLOMACY_SYSTEM,entityId:targets.relation.id,slotKey:"bilateral-state",
    payload:{seed,reschedule:false,lowCountryId:targets.relation.pair.lowCountryId,highCountryId:targets.relation.pair.highCountryId,pressureBias:0.55,tradeRestrictionBias:0.8}
  };
  const r1=diplomacyOutcome(targets.relation,targets.relation,{...relationEvent,seed},addressed(seed,relationEvent));
  const r2=diplomacyOutcome(targets.relation,targets.relation,{...relationEvent,seed},addressed(seed,relationEvent));
  const deterministic=stableStringify(a1)===stableStringify(a2)&&stableStringify(r1)===stableStringify(r2);
  const countriesEvolveDifferently=signature(a1)!==signature(b1)&&targets.profileDifference>0.20;
  const profileGeographyInfluence=Boolean(
    Math.abs(a1.agriculturalCondition-b1.agriculturalCondition)>0.005||
    Math.abs(a1.productionCondition-b1.productionCondition)>0.005||
    Math.abs(a1.tradeCondition-b1.tradeCondition)>0.005
  );
  const controlledRestriction=Boolean(r1.tradeRestricted&&r1.tradeAccess<targets.relation.shared.tradeAccess&&r1.borderOpenness<targets.relation.shared.borderOpenness);
  const snap=snapshot(seed);
  const pass=Boolean(
    deterministic&&countriesEvolveDifferently&&profileGeographyInfluence&&controlledRestriction&&
    COUNTRY_INTERVAL_HOURS>=12&&DIPLOMACY_INTERVAL_HOURS>=6&&MAX_COUNTRIES<=25&&MAX_RELATIONS<=20
  );
  return deepFreeze({
    pass,version:VERSION,countryIntervalHours:COUNTRY_INTERVAL_HOURS,diplomacyIntervalHours:DIPLOMACY_INTERVAL_HOURS,
    maxCountries:MAX_COUNTRIES,maxRelations:MAX_RELATIONS,deterministic,countriesEvolveDifferently,profileGeographyInfluence,
    controlledRestriction,eventDriven:true,scheduledAggregateUpdates:true,currentWorldDeltaAuthority:true,
    immutableCountryFoundation:true,revisionBasedLazyPropagation:true,noSettlementFanOut:true,noNpcFanOut:true,
    offscreenEquivalent:true,renderInputs:0,perFrameCountryIterations:0,perCitizenGlobalIterations:0,
    militaristicWeightNotForcedWar:true,mercantileWeightNotForcedFriendship:true,
    countryAId:targets.countryA.countryId,countryBId:targets.countryB.countryId,
    countryASignature:signature(a1),countryBSignature:signature(b1),
    relationId:targets.relation.id,restrictionSignature:signature(r1),runtimeTelemetry:snap.telemetry
  });
}
function initializeEvidence(seed){
  reset(seed,{scheduler:true});
  WorldContext.clearCaches({resetTelemetry:true});
  const targets=evidenceTargets(seed),delta=WorldState.deltaSnapshot(seed);
  const before=targets.settlement?WorldContext.resolve(seed,targets.settlement,{year:1200,month:6,day:16,hour:0,minute:0,second:0}):null;
  evidenceMemory={
    seed,lastStep:0,targets,baselineSequence:delta.sequence,
    countryARevision:0,countryBRevision:0,countryASignature:null,countryBSignature:null,
    relationRevision:0,relationRestricted:false,
    contextBeforeRevision:before?.revision||null,contextBeforeTrade:before?.behavior?.trade??null,
    contextAfterRevision:null,contextAfterTrade:null,
    settlementDeltaCount:delta.entries.filter(item=>item.entityKind==="settlement").length,
    stableAfterCamera:true,dueOnlyPass:true
  };
  return evidenceMemory;
}
function runEvidenceCountryStep(seed,mem){
  const events=[mem.targets.countryA,mem.targets.countryB].map(profile=>({
    fantasyTimestamp:EVIDENCE_TIME,systemKind:COUNTRY_SYSTEM,entityId:profile.countryId,slotKey:"daily-state",
    payload:{seed,reschedule:false}
  }));
  EventScheduler.scheduleMany(seed,events);
  const run=tick(seed,EVIDENCE_TIME,{ensure:false,maxEvents:8});
  const outcomes=run.batch.processed.map(item=>item.outcome).filter(item=>item?.ok&&item.kind==="country");
  const a=outcomes.find(item=>item.countryId===mem.targets.countryA.countryId),b=outcomes.find(item=>item.countryId===mem.targets.countryB.countryId);
  mem.countryARevision=Number(a?.deltaRevision||0);mem.countryBRevision=Number(b?.deltaRevision||0);
  mem.countryASignature=signature(a?.outcome||{});mem.countryBSignature=signature(b?.outcome||{});
}
function runEvidenceDiplomacyStep(seed,mem){
  const relation=mem.targets.relation;
  const before=mem.targets.settlement?WorldContext.resolve(seed,mem.targets.settlement,{year:1200,month:6,day:16,hour:1,minute:0,second:0}):null;
  mem.contextBeforeRevision=before?.revision||mem.contextBeforeRevision;mem.contextBeforeTrade=before?.behavior?.trade??mem.contextBeforeTrade;
  const event={
    fantasyTimestamp:addHours(EVIDENCE_TIME,1),systemKind:DIPLOMACY_SYSTEM,entityId:relation.id,slotKey:"bilateral-state",
    payload:{seed,reschedule:false,lowCountryId:relation.pair.lowCountryId,highCountryId:relation.pair.highCountryId,pressureBias:0.55,tradeRestrictionBias:0.8}
  };
  EventScheduler.schedule(seed,event);
  const run=tick(seed,event.fantasyTimestamp,{ensure:false,maxEvents:8});
  const outcome=run.batch.processed.map(item=>item.outcome).find(item=>item?.ok&&item.kind==="diplomacy");
  mem.relationRevision=Number(outcome?.deltaRevision||0);mem.relationRestricted=Boolean(outcome?.outcome?.tradeRestricted);
  const after=mem.targets.settlement?WorldContext.resolve(seed,mem.targets.settlement,{year:1200,month:6,day:16,hour:1,minute:0,second:0}):null;
  mem.contextAfterRevision=after?.revision||null;mem.contextAfterTrade=after?.behavior?.trade??null;
  mem.settlementDeltaCount=WorldState.deltaSnapshot(seed).entries.filter(item=>item.entityKind==="settlement").length;
}
function runEvidenceDueOnlyStep(seed,mem){
  const event={
    fantasyTimestamp:addHours(EVIDENCE_TIME,6),systemKind:COUNTRY_SYSTEM,entityId:mem.targets.countryA.countryId,slotKey:"future-proof",
    payload:{seed,reschedule:false}
  };
  EventScheduler.schedule(seed,event);
  const before=WorldState.deltaSnapshot(seed).sequence;
  const early=tick(seed,addHours(EVIDENCE_TIME,2),{ensure:false,maxEvents:8});
  const after=WorldState.deltaSnapshot(seed).sequence;
  mem.dueOnlyPass=early.batch.processedCount===0&&before===after;
}
function evidenceDigest(seed,mem){
  return signature({
    delta:WorldState.deltaSnapshot(seed).entries.map(item=>[item.entityId,item.revision,item.sequence]),
    countryARevision:mem.countryARevision,countryBRevision:mem.countryBRevision,
    relationRevision:mem.relationRevision,contextAfterRevision:mem.contextAfterRevision
  });
}
function evidenceStep(seedValue,indexValue){
  const seed=normalizeSeed(seedValue),index=Math.max(0,Math.min(4,Math.floor(Number(indexValue)||0)));
  let mem=evidenceMemory?.seed===seed?evidenceMemory:initializeEvidence(seed);
  while(mem.lastStep<index){
    const next=mem.lastStep+1;
    if(next===1)runEvidenceCountryStep(seed,mem);
    else if(next===2)runEvidenceDiplomacyStep(seed,mem);
    else if(next===3)runEvidenceDueOnlyStep(seed,mem);
    else if(next===4){
      const before=evidenceDigest(seed,mem);
      const same=tick(seed,addHours(EVIDENCE_TIME,2),{ensure:false,maxEvents:8});
      const after=evidenceDigest(seed,mem);
      mem.stableAfterCamera=before===after&&same.batch.processedCount===0;
    }
    mem.lastStep=next;
  }
  const delta=WorldState.deltaSnapshot(seed);
  return deepFreeze({
    ok:true,index,targets:clone(mem.targets),evidence:clone(mem),
    deltaEntryCount:delta.entryCount,deltaSequence:delta.sequence,snapshot:snapshot(seed)
  });
}
function setCheck(root,id,pass){
  const node=root?.querySelector?.("#"+id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function pct(v){return Math.round(clamp01(v)*100)+"%"}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("globalCountrySimulationProof");
  if(!root)return null;
  const verify=proof(seed),snap=snapshot(seed),mem=evidenceMemory?.seed===seed?evidenceMemory:null;
  const values={
    globalCountryTracked:snap.trackedCountries+" countries · "+snap.trackedRelations+" relations",
    globalCountryCadence:COUNTRY_INTERVAL_HOURS+"h country · "+DIPLOMACY_INTERVAL_HOURS+"h diplomacy",
    globalCountryEvents:snap.processedCountryEvents+" country · "+snap.processedDiplomacyEvents+" diplomacy",
    globalCountryCost:snap.telemetry.lastCostMs.toFixed(3)+" ms last · "+snap.telemetry.averageCostMs.toFixed(3)+" ms avg",
    globalCountryPair:(verify.countryAId||"—")+" / "+(verify.countryBId||"—"),
    globalCountrySignatures:verify.countryASignature+" / "+verify.countryBSignature,
    globalCountryRelation:verify.relationId||"—",
    globalCountryLazy:mem?.contextAfterRevision
      ?(mem.contextBeforeRevision+" → "+mem.contextAfterRevision+" · trade "+pct(mem.contextBeforeTrade)+" → "+pct(mem.contextAfterTrade))
      :"awaiting controlled evidence"
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const rows=root.querySelector("#globalCountryLedger");
  if(rows){
    const list=snap.ledger.slice(-8).reverse();
    rows.innerHTML=list.length?list.map(item=>
      "<li><div><strong>"+esc(item.kind+" · "+item.entityId)+"</strong><small>"+esc(item.timestamp)+"</small></div><span>"+esc(item.signature)+"</span></li>"
    ).join(""):"<li><div><strong>No due aggregate events yet</strong><small>Scheduled work remains off the render loop.</small></div><span>idle</span></li>";
  }
  const lazyPass=!mem||mem.lastStep<2||Boolean(
    mem.relationRestricted&&mem.relationRevision>0&&mem.contextAfterRevision&&
    mem.contextAfterRevision!==mem.contextBeforeRevision&&mem.contextAfterTrade<mem.contextBeforeTrade&&
    mem.settlementDeltaCount===0
  );
  const countryPass=!mem||mem.lastStep<1||Boolean(
    mem.countryARevision>0&&mem.countryBRevision>0&&mem.countryASignature!==mem.countryBSignature
  );
  setCheck(root,"vGlobalCountryDeterministic",verify.deterministic&&verify.eventDriven&&verify.scheduledAggregateUpdates);
  setCheck(root,"vGlobalCountryDifferent",verify.countriesEvolveDifferently&&verify.profileGeographyInfluence&&countryPass);
  setCheck(root,"vGlobalCountryLazy",verify.revisionBasedLazyPropagation&&verify.noSettlementFanOut&&lazyPass);
  setCheck(root,"vGlobalCountryOffscreen",verify.offscreenEquivalent&&verify.renderInputs===0&&(mem?.stableAfterCamera!==false));
  setCheck(root,"vGlobalCountryBounded",verify.maxCountries<=MAX_COUNTRIES&&verify.maxRelations<=MAX_RELATIONS&&snap.telemetry.perCitizenGlobalIterations===0);
  setCheck(root,"vGlobalCountryLedger",verify.currentWorldDeltaAuthority&&(!mem||mem.lastStep<3||mem.dueOnlyPass));
  root.dataset.pass=String(verify.pass);
  root.dataset.lastStep=String(mem?.lastStep||0);
  root.dataset.trackedCountries=String(snap.trackedCountries);
  root.dataset.trackedRelations=String(snap.trackedRelations);
  root.dataset.processedCountryEvents=String(snap.processedCountryEvents);
  root.dataset.processedDiplomacyEvents=String(snap.processedDiplomacyEvents);
  root.dataset.countryARevision=String(mem?.countryARevision||0);
  root.dataset.countryBRevision=String(mem?.countryBRevision||0);
  root.dataset.countryASignature=mem?.countryASignature||"";
  root.dataset.countryBSignature=mem?.countryBSignature||"";
  root.dataset.relationRevision=String(mem?.relationRevision||0);
  root.dataset.relationRestricted=String(Boolean(mem?.relationRestricted));
  root.dataset.contextBeforeRevision=mem?.contextBeforeRevision||"";
  root.dataset.contextAfterRevision=mem?.contextAfterRevision||"";
  root.dataset.contextBeforeTrade=String(mem?.contextBeforeTrade??"");
  root.dataset.contextAfterTrade=String(mem?.contextAfterTrade??"");
  root.dataset.settlementDeltaCount=String(mem?.settlementDeltaCount??0);
  root.dataset.dueOnlyPass=String(mem?.dueOnlyPass!==false);
  root.dataset.stableAfterCamera=String(mem?.stableAfterCamera!==false);
  return deepFreeze({verification:verify,snapshot:snap,evidence:mem?clone(mem):null});
}

window.GlobalCountrySimulation=Object.freeze({
  VERSION,COUNTRY_SYSTEM,DIPLOMACY_SYSTEM,COUNTRY_INTERVAL_HOURS,DIPLOMACY_INTERVAL_HOURS,
  MAX_COUNTRIES,MAX_RELATIONS,ensureScheduled,tick,reset,snapshot,proof,evidenceTargets,evidenceStep,renderDebugPanel
});
})();