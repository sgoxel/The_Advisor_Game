(function(){
"use strict";

const VERSION="1.0.0";
const REGION_SYSTEM="regional-aggregate";
const SETTLEMENT_SYSTEM="settlement-aggregate";
const REGION_INTERVAL_HOURS=48;
const SETTLEMENT_INTERVAL_HOURS=24;
const MAX_REGIONS=16;
const MAX_SETTLEMENTS=24;
const MAX_LEDGER=16;
const EVIDENCE_TIME="1200-07-01 00:00:00";
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
    throw new Error("Regional/settlement Simulation timestamp must use YYYY-MM-DD HH:MM:SS.");
  }
  return timestamp;
}
function timestampMs(value){
  const timestamp=normalizeTimestamp(value),ms=Date.parse(timestamp.replace(" ","T")+"Z");
  if(!Number.isFinite(ms))throw new Error("Regional/settlement Simulation timestamp is outside supported range.");
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
    seed,trackedRegions:0,trackedSettlements:0,processedRegionEvents:0,processedSettlementEvents:0,
    ticks:0,lastTickTimestamp:null,lastCostMs:0,totalCostMs:0,ledger:[]
  });
  return runtimeBySeed.get(seed);
}
function appendLedger(rows,item){
  const next=[...(Array.isArray(rows)?rows:[]),clone(item)];
  if(next.length>MAX_LEDGER)next.splice(0,next.length-MAX_LEDGER);
  return next;
}
function sampledCountries(seed){
  const origin=PoliticalGeography.countryAt(seed,"0","0"),out=[origin],seen=new Set([origin.id]);
  for(const profile of CountryProfile.sampleCountries(seed)||[]){
    const country=PoliticalGeography.countryById(seed,profile.countryId);
    if(country&&!seen.has(country.id)){seen.add(country.id);out.push(country)}
    if(out.length>=3)break;
  }
  return Object.freeze(out);
}
function catalog(seedValue){
  const seed=normalizeSeed(seedValue),settlements=[],seenSettlements=new Set();
  for(const country of sampledCountries(seed)){
    for(const plan of SettlementArchetypes.settlementsForCountry(seed,country,2)||[]){
      if(seenSettlements.has(plan.id))continue;
      seenSettlements.add(plan.id);settlements.push(plan);
      if(settlements.length>=MAX_SETTLEMENTS)break;
    }
    if(settlements.length>=MAX_SETTLEMENTS)break;
  }
  settlements.sort((a,b)=>a.id.localeCompare(b.id));
  const regions=[],seenRegions=new Set();
  for(const plan of settlements){
    const region=RegionProfile.at(seed,plan.center.x,plan.center.y);
    if(!region||seenRegions.has(region.id))continue;
    seenRegions.add(region.id);regions.push(region);
    if(regions.length>=MAX_REGIONS)break;
  }
  regions.sort((a,b)=>a.id.localeCompare(b.id));
  return deepFreeze({regions,settlements});
}
function regionPayload(region){
  return Object.freeze({
    seed:null,countryId:region.parentCountryId,cellX:String(region.cellX),cellY:String(region.cellY),reschedule:true
  });
}
function settlementPayload(plan){
  return Object.freeze({
    seed:null,reschedule:true,
    desiredCenter:Object.freeze({x:String(plan.generation.desiredCenter.x),y:String(plan.generation.desiredCenter.y)}),
    countryId:plan.generation.countryId,role:plan.generation.role,
    classHint:plan.generation.classHint||null,nameHint:plan.generation.nameHint||null
  });
}
function regionFromEvent(seed,event){
  const p=event.payload||{};
  if(p.countryId!=null&&p.cellX!=null&&p.cellY!=null){
    const region=RegionProfile.buildForCell(seed,p.countryId,BigInt(p.cellX),BigInt(p.cellY));
    if(region?.id===event.entityId)return region;
  }
  return catalog(seed).regions.find(item=>item.id===event.entityId)||null;
}
function planFromEvent(seed,event){
  const p=event.payload||{};
  if(p.desiredCenter&&p.countryId){
    const plan=SettlementArchetypes.build(seed,p.desiredCenter,{
      countryId:p.countryId,role:p.role,classHint:p.classHint,nameHint:p.nameHint
    });
    if(plan?.id===event.entityId)return plan;
  }
  return catalog(seed).settlements.find(item=>item.id===event.entityId)||null;
}
function currentRegion(seed,region){
  const ref=WorldState.regionRef(seed,region),world=ref?WorldState.resolve(seed,ref):null;
  return Object.freeze({ref,world,state:world?.current?.state||{}});
}
function currentSettlement(seed,plan){
  const ref=WorldState.settlementRef(seed,plan),world=ref?WorldState.resolve(seed,ref):null;
  return Object.freeze({ref,world,current:world?.current||plan,state:world?.current?.state||{}});
}
function regionContext(seed,region,timestamp){
  return WorldContext.resolve(seed,{x:region.administrativeSeat.x,y:region.administrativeSeat.y},timestamp);
}
function settlementContext(seed,plan,timestamp){return WorldContext.resolve(seed,plan,timestamp)}
function regionOutcome(region,context,previousValue,eventValue,randomUint32){
  const previous=previousValue||{},u=randomUnit(randomUint32),shock=u-0.5;
  const identity=region.identity,spec=context.region.specialization,country=context.country,diplomacy=context.diplomacy;
  const hazard=clamp01(Math.max(identity.hazards.flood,identity.hazards.drought,identity.hazards.rugged));
  const food=clamp01(
    (previous.foodSupply??identity.agriculturalSuitability)*0.62+
    (identity.agriculturalSuitability*0.45+spec.agriculture*0.31+country.tendencies.agriculture*0.14+country.stability*0.10-hazard*0.12+shock*0.04)*0.38
  );
  const production=clamp01(
    (previous.productionOutput??Math.max(spec.craft,spec.mining,spec.forestry))*0.64+
    (spec.craft*0.32+spec.mining*0.22+spec.forestry*0.16+spec.agriculture*0.14+country.prosperity*0.16-hazard*0.06+shock*0.05)*0.36
  );
  const trade=clamp01(
    (previous.tradeActivity??spec.trade)*0.63+
    (spec.trade*0.34+identity.transportAccessibility*0.24+country.tendencies.tradeOpenness*0.22+diplomacy.tradeAccess*0.12+diplomacy.borderOpenness*0.08-diplomacy.militaryTension*0.12)*0.37
  );
  const security=clamp01(
    (previous.security??context.region.stability)*0.60+
    (context.region.specialization.defense*0.32+identity.defensibility*0.22+country.stability*0.22+(1-diplomacy.militaryTension)*0.16+(1-hazard)*0.08)*0.40
  );
  const prosperity=clamp01(
    (previous.prosperity??context.region.prosperity)*0.64+
    (country.prosperity*0.28+food*0.17+production*0.23+trade*0.22+security*0.10)*0.36
  );
  const employmentPressure=clamp01(0.54-production*0.30-trade*0.20+hazard*0.16+(1-prosperity)*0.18);
  const migrationPressure=clamp01((1-prosperity)*0.30+(1-security)*0.30+employmentPressure*0.24+hazard*0.16);
  const infrastructure=clamp01((previous.infrastructure??identity.transportAccessibility)*0.70+(identity.transportAccessibility*0.34+country.tendencies.infrastructure*0.38+prosperity*0.28)*0.30);
  return deepFreeze({
    prosperity:round(prosperity),stability:round(security),foodSupply:round(food),productionOutput:round(production),
    tradeActivity:round(trade),employmentPressure:round(employmentPressure),security:round(security),
    hazardPressure:round(hazard),migrationPressure:round(migrationPressure),infrastructure:round(infrastructure),
    maintenancePressure:round(clamp01((1-infrastructure)*0.54+hazard*0.28+(1-prosperity)*0.18)),
    parentCountryRevisionSeen:context.country.revision,lastSimulatedTimestamp:eventValue.fantasyTimestamp,
    randomUint32:Number(randomUint32)>>>0
  });
}
function settlementOutcome(plan,context,previousValue,eventValue,randomUint32){
  const previous=previousValue||{},u=randomUnit(randomUint32),shock=u-0.5;
  const local=context.local,region=context.region,country=context.country,diplomacy=context.diplomacy;
  const priorPopulation=Math.max(0,Math.round(Number(previous.population??context.settlement?.population??plan.population.planned)||0));
  const baseCapacity=Math.max(Number(plan.population.max||plan.population.planned||1),1);
  const capacity=Math.max(1,Math.round(baseCapacity*(0.86+plan.roadScale.value*0.08+plan.publicSpaceScale.value*0.06)));
  const foodTarget=clamp01(local.resources.agriculture*0.48+region.specialization.agriculture*0.22+country.tendencies.agriculture*0.12+context.behavior.transportAccess*0.10+country.prosperity*0.08);
  const food=clamp01((previous.foodSupply??context.behavior.food)*0.64+(foodTarget+shock*0.04)*0.36);
  const productionTarget=clamp01(
    Math.max(local.resources.mineral*region.specialization.mining,local.resources.timber*region.specialization.forestry,local.resources.agriculture*region.specialization.agriculture)*0.45+
    region.specialization.craft*0.22+country.tendencies.craftProduction*0.18+context.behavior.transportAccess*0.15
  );
  const production=clamp01((previous.productionOutput??context.behavior.production)*0.64+(productionTarget+shock*0.05)*0.36);
  const tradeTarget=clamp01(plan.tradeMarketTendency*0.28+region.specialization.trade*0.22+country.tendencies.tradeOpenness*0.16+local.routeAccess*0.18+diplomacy.tradeAccess*0.16-diplomacy.militaryTension*0.12);
  const trade=clamp01((previous.tradeActivity??context.behavior.trade)*0.62+tradeTarget*0.38);
  const hazard=clamp01(
    Math.max(region.identity.hazards.flood,region.identity.hazards.drought,region.identity.hazards.rugged)*0.62+
    (1-food)*0.22+(1-local.resources.water)*0.16
  );
  const danger=clamp01(diplomacy.militaryTension*0.44+(diplomacy.warState?0.42:0)+(1-region.stability)*0.14);
  const security=clamp01((previous.security??context.behavior.security)*0.62+(plan.defenseTendency*0.36+region.specialization.defense*0.20+country.stability*0.18+(1-danger)*0.26)*0.38);
  const infrastructure=clamp01((previous.infrastructure??plan.roadScale.value)*0.70+(plan.roadScale.value*0.34+plan.publicSpaceScale.value*0.14+country.tendencies.infrastructure*0.24+context.behavior.transportAccess*0.28)*0.30);
  const prosperity=clamp01((previous.prosperity??context.behavior.prosperity)*0.62+(country.prosperity*0.20+region.prosperity*0.15+food*0.14+production*0.20+trade*0.20+security*0.11)*0.38);
  const populationLoad=clamp01(priorPopulation/capacity);
  const employmentPressure=clamp01(populationLoad*0.42-production*0.23-trade*0.17+(1-prosperity)*0.18);
  const diseasePressure=clamp01(hazard*0.34+(1-food)*0.30+(1-local.resources.water)*0.20+populationLoad*0.16);
  const migrationPressure=clamp01((1-prosperity)*0.28+(1-security)*0.25+employmentPressure*0.22+diseasePressure*0.15+(populationLoad>0.92?0.10:0));
  const growthPressure=clamp01(food*0.23+prosperity*0.23+security*0.18+(1-employmentPressure)*0.14+(1-diseasePressure)*0.12+(1-populationLoad)*0.10);
  const declinePressure=clamp01(migrationPressure*0.42+diseasePressure*0.24+danger*0.18+(1-food)*0.16);
  const deltaRate=(growthPressure-declinePressure)*0.018;
  const population=Math.max(0,Math.min(capacity,Math.round(priorPopulation*(1+deltaRate))));
  const fortificationPressure=clamp01(danger*0.48+(1-security)*0.28+diplomacy.militaryTension*0.14+plan.subtypes.weights.fortified*0.10);
  const maintenancePressure=clamp01((1-infrastructure)*0.48+hazard*0.22+populationLoad*0.14+(1-prosperity)*0.16);
  return deepFreeze({
    population,capacity,foodSupply:round(food),prosperity:round(prosperity),tradeActivity:round(trade),
    productionOutput:round(production),employmentPressure:round(employmentPressure),security:round(security),
    diseaseHazardPressure:round(diseasePressure),migrationPressure:round(migrationPressure),
    infrastructure:round(infrastructure),maintenancePressure:round(maintenancePressure),
    growthPressure:round(growthPressure),declinePressure:round(declinePressure),
    fortificationPressure:round(fortificationPressure),
    parentCountryRevisionSeen:country.revision,regionRevisionSeen:region.revision,
    diplomacyRevisionSeen:diplomacy.revision,lastSimulatedTimestamp:eventValue.fantasyTimestamp,
    randomUint32:Number(randomUint32)>>>0
  });
}
function recordRuntime(state,kind,event,outcome){
  state.ledger.push(deepFreeze({kind,eventId:event.id,entityId:event.entityId,timestamp:event.fantasyTimestamp,signature:signature(outcome)}));
  if(state.ledger.length>64)state.ledger.splice(0,state.ledger.length-64);
}
function scheduleNext(seed,event,hours){
  if(event.payload?.reschedule===false)return null;
  return EventScheduler.schedule(seed,{
    fantasyTimestamp:addHours(event.fantasyTimestamp,hours),systemKind:event.systemKind,
    entityId:event.entityId,slotKey:event.slotKey,payload:event.payload
  });
}
function applyRegionEvent(seedValue,event,randomUint32){
  const seed=normalizeSeed(seedValue),region=regionFromEvent(seed,event);
  if(!region)return deepFreeze({ok:false,reason:"region-missing",entityId:event.entityId});
  const current=currentRegion(seed,region),context=regionContext(seed,region,event.fantasyTimestamp);
  if(!current.ref||!context)return deepFreeze({ok:false,reason:"region-context-missing",entityId:event.entityId});
  const previous=current.state.aggregate||{};
  if((previous.ledger||[]).some(item=>item.eventId===event.id)){
    scheduleNext(seed,event,REGION_INTERVAL_HOURS);
    return deepFreeze({ok:true,kind:"region",regionId:region.id,revision:Number(previous.revision||0),duplicate:true,outcome:null,deltaRevision:Number(current.world?.delta?.revision||0)});
  }
  const outcome=regionOutcome(region,context,previous,event,randomUint32);
  const revision=Math.max(0,Number(previous.revision)||0)+1;
  const ledger=appendLedger(previous.ledger,{revision,eventId:event.id,timestamp:event.fantasyTimestamp,outcomeSignature:signature(outcome)});
  const applied=WorldState.applyDelta(seed,current.ref,{state:{
    prosperity:outcome.prosperity,stability:outcome.stability,
    specialization:{
      agriculture:round(clamp01(context.region.specialization.agriculture*0.88+outcome.foodSupply*0.12)),
      forestry:context.region.specialization.forestry,mining:context.region.specialization.mining,
      trade:round(clamp01(context.region.specialization.trade*0.82+outcome.tradeActivity*0.18)),
      maritime:context.region.specialization.maritime,defense:context.region.specialization.defense,
      craft:round(clamp01(context.region.specialization.craft*0.84+outcome.productionOutput*0.16))
    },
    aggregate:{...outcome,revision,ledger}
  }},"WP-S007-006 scheduled regional aggregate "+event.id);
  if(!applied.ok)return deepFreeze({ok:false,reason:"region-delta-failed",applied});
  const state=stateFor(seed);state.processedRegionEvents++;recordRuntime(state,"region",event,outcome);
  scheduleNext(seed,event,REGION_INTERVAL_HOURS);
  return deepFreeze({ok:true,kind:"region",regionId:region.id,revision,deltaRevision:applied.entry.revision,outcome});
}
function applySettlementEvent(seedValue,event,randomUint32){
  const seed=normalizeSeed(seedValue),plan=planFromEvent(seed,event);
  if(!plan)return deepFreeze({ok:false,reason:"settlement-missing",entityId:event.entityId});
  const current=currentSettlement(seed,plan),context=settlementContext(seed,plan,event.fantasyTimestamp);
  if(!current.ref||!context?.settlement)return deepFreeze({ok:false,reason:"settlement-context-missing",entityId:event.entityId});
  const previous=current.state.aggregate||{};
  if((previous.ledger||[]).some(item=>item.eventId===event.id)){
    scheduleNext(seed,event,SETTLEMENT_INTERVAL_HOURS);
    return deepFreeze({ok:true,kind:"settlement",settlementId:plan.id,revision:Number(previous.revision||0),duplicate:true,outcome:null,reconciliation:previous.reconciliation||null,deltaRevision:Number(current.world?.delta?.revision||0)});
  }
  const outcome=settlementOutcome(plan,context,{
    ...previous,
    population:current.current?.population?.planned,
    prosperity:current.current?.prosperity?.value
  },event,randomUint32);
  const revision=Math.max(0,Number(previous.revision)||0)+1;
  const ledger=appendLedger(previous.ledger,{revision,eventId:event.id,timestamp:event.fantasyTimestamp,outcomeSignature:signature(outcome)});
  const reconciliation=Object.freeze({
    populationTotal:outcome.population,capacity:outcome.capacity,
    employmentPressure:outcome.employmentPressure,migrationPressure:outcome.migrationPressure,
    prosperity:outcome.prosperity,foodSupply:outcome.foodSupply,security:outcome.security,
    lastAggregateTimestamp:event.fantasyTimestamp,source:"settlement-aggregate"
  });
  const applied=WorldState.applyDelta(seed,current.ref,{
    population:{planned:outcome.population},
    prosperity:{value:outcome.prosperity,band:"aggregate-current"},
    state:{
      food:outcome.foodSupply,security:outcome.security,trade:outcome.tradeActivity,production:outcome.productionOutput,
      employmentPressure:outcome.employmentPressure,diseaseHazardPressure:outcome.diseaseHazardPressure,
      migrationPressure:outcome.migrationPressure,infrastructure:outcome.infrastructure,
      maintenancePressure:outcome.maintenancePressure,growthPressure:outcome.growthPressure,
      declinePressure:outcome.declinePressure,fortificationPressure:outcome.fortificationPressure,
      parentCountryRevisionSeen:outcome.parentCountryRevisionSeen,regionRevisionSeen:outcome.regionRevisionSeen,
      diplomacyRevisionSeen:outcome.diplomacyRevisionSeen,lastSimulatedTimestamp:event.fantasyTimestamp,
      aggregate:{...outcome,revision,ledger,reconciliation}
    }
  },"WP-S007-006 scheduled settlement aggregate "+event.id);
  if(!applied.ok)return deepFreeze({ok:false,reason:"settlement-delta-failed",applied});
  const state=stateFor(seed);state.processedSettlementEvents++;recordRuntime(state,"settlement",event,outcome);
  scheduleNext(seed,event,SETTLEMENT_INTERVAL_HOURS);
  return deepFreeze({ok:true,kind:"settlement",settlementId:plan.id,revision,deltaRevision:applied.entry.revision,outcome,reconciliation});
}
function dispatch(seed,event,randomUint32){
  if(event.systemKind===REGION_SYSTEM)return applyRegionEvent(seed,event,randomUint32);
  if(event.systemKind===SETTLEMENT_SYSTEM)return applySettlementEvent(seed,event,randomUint32);
  return deepFreeze({ok:false,reason:"unsupported-system",systemKind:event.systemKind});
}
function ensureScheduled(seedValue,nowValue){
  const seed=normalizeSeed(seedValue),now=normalizeTimestamp(nowValue),state=stateFor(seed),data=catalog(seed);
  const queue=EventScheduler.snapshot(seed).queue||[],queued=new Set(queue.map(item=>item.systemKind+"|"+item.entityId));
  let regionsAdded=0,settlementsAdded=0;
  for(const region of data.regions){
    const key=REGION_SYSTEM+"|"+region.id;if(queued.has(key))continue;
    EventScheduler.schedule(seed,{
      fantasyTimestamp:nextBoundary(now,REGION_INTERVAL_HOURS),systemKind:REGION_SYSTEM,entityId:region.id,slotKey:"regional-state",
      payload:{...regionPayload(region),seed}
    });
    queued.add(key);regionsAdded++;
  }
  for(const plan of data.settlements){
    const key=SETTLEMENT_SYSTEM+"|"+plan.id;if(queued.has(key))continue;
    EventScheduler.schedule(seed,{
      fantasyTimestamp:nextBoundary(now,SETTLEMENT_INTERVAL_HOURS),systemKind:SETTLEMENT_SYSTEM,entityId:plan.id,slotKey:"settlement-state",
      payload:{...settlementPayload(plan),seed}
    });
    queued.add(key);settlementsAdded++;
  }
  state.trackedRegions=data.regions.length;state.trackedSettlements=data.settlements.length;
  return deepFreeze({regionsAdded,settlementsAdded,trackedRegions:data.regions.length,trackedSettlements:data.settlements.length});
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
  const started=performance.now(),ensured=options.ensure===false?null:ensureScheduled(seed,now);
  const batch=EventScheduler.processDue(seed,now,{
    maxEvents:options.maxEvents||EventScheduler.MAX_BATCH,
    systemKinds:[REGION_SYSTEM,SETTLEMENT_SYSTEM],
    handle:(event,randomUint32)=>dispatch(seed,event,randomUint32)
  });
  state.ticks++;state.lastTickTimestamp=now;state.lastCostMs=Number((performance.now()-started).toFixed(3));state.totalCostMs+=state.lastCostMs;
  return deepFreeze({ensured,batch,snapshot:snapshot(seed)});
}
function storedAggregate(seed,plan){
  const resolved=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  return resolved?.current?.state?.aggregate||null;
}
function ensureRelevant(seedValue,planValue,nowValue,optionsValue){
  const seed=normalizeSeed(seedValue),plan=planValue,now=normalizeTimestamp(nowValue),options=optionsValue||{};
  if(!plan?.id)return deepFreeze({ok:false,reason:"settlement-plan-required"});
  const context=settlementContext(seed,plan,now),stored=storedAggregate(seed,plan);
  const region=RegionProfile.at(seed,plan.center.x,plan.center.y);
  const regionResolved=region?WorldState.resolve(seed,WorldState.regionRef(seed,region)):null;
  const regionAggregate=regionResolved?.current?.state?.aggregate||null;
  const regionStale=!regionAggregate||regionAggregate.parentCountryRevisionSeen!==context.country.revision;
  const settlementStale=!stored||
    stored.parentCountryRevisionSeen!==context.country.revision||
    stored.regionRevisionSeen!==context.region.revision||
    stored.diplomacyRevisionSeen!==context.diplomacy.revision;
  if(!regionStale&&!settlementStale)return deepFreeze({ok:true,refreshed:false,reason:"revisions-current"});
  const events=[];
  if(region&&regionStale)events.push({
    fantasyTimestamp:now,systemKind:REGION_SYSTEM,entityId:region.id,
    slotKey:"relevance:"+context.country.revision,
    payload:{...regionPayload(region),seed,reschedule:false}
  });
  if(settlementStale)events.push({
    fantasyTimestamp:now,systemKind:SETTLEMENT_SYSTEM,entityId:plan.id,
    slotKey:"relevance:"+context.country.revision+":"+context.region.revision+":"+context.diplomacy.revision,
    payload:{...settlementPayload(plan),seed,reschedule:false}
  });
  EventScheduler.scheduleMany(seed,events);
  const run=tick(seed,now,{ensure:false,maxEvents:Math.min(8,options.maxEvents||8)});
  return deepFreeze({ok:true,refreshed:true,scheduled:events.length,processed:run.batch.processedCount,run});
}
function reset(seedValue,optionsValue){
  const seed=normalizeSeed(seedValue);runtimeBySeed.delete(seed);
  if(optionsValue?.scheduler)EventScheduler.reset(seed);
  if(evidenceMemory?.seed===seed)evidenceMemory=null;
  return true;
}
function snapshot(seedValue){
  const seed=normalizeSeed(seedValue),state=stateFor(seed),queue=EventScheduler.snapshot(seed).queue||[];
  return deepFreeze({
    version:VERSION,trackedRegions:state.trackedRegions,trackedSettlements:state.trackedSettlements,
    processedRegionEvents:state.processedRegionEvents,processedSettlementEvents:state.processedSettlementEvents,
    ticks:state.ticks,lastTickTimestamp:state.lastTickTimestamp,
    telemetry:Object.freeze({
      lastCostMs:state.lastCostMs,totalCostMs:Number(state.totalCostMs.toFixed(3)),
      averageCostMs:Number((state.ticks?state.totalCostMs/state.ticks:0).toFixed(3)),
      pendingAggregateEvents:queue.filter(item=>item.systemKind===REGION_SYSTEM||item.systemKind===SETTLEMENT_SYSTEM).length,
      perResidentIterations:0,fullSettlementFanOuts:0,renderInputs:0
    }),
    ledger:Object.freeze(state.ledger.slice())
  });
}
function evidenceTargets(seedValue){
  const seed=normalizeSeed(seedValue),origin=PoliticalGeography.countryAt(seed,"0","0");
  const plans=[...(SettlementArchetypes.settlementsForCountry(seed,origin,3)||[])];
  if(plans.length<2)return deepFreeze({agricultural:plans[0]||null,mining:plans[0]||null,distant:plans[0]||null});
  const agricultural=[...plans].sort((a,b)=>
    b.subtypes.weights.agricultural-a.subtypes.weights.agricultural||
    b.inputs.local.resources.agriculture-a.inputs.local.resources.agriculture||a.id.localeCompare(b.id)
  )[0];
  const mining=[...plans].filter(p=>p.id!==agricultural.id).sort((a,b)=>
    b.subtypes.weights.mining-a.subtypes.weights.mining||
    b.inputs.local.resources.mineral-a.inputs.local.resources.mineral||a.id.localeCompare(b.id)
  )[0]||plans[1];
  const distant=[...plans].filter(p=>p.id!==agricultural.id&&p.id!==mining.id)
    .sort((a,b)=>Number(BigInt(b.center.x)**2n+BigInt(b.center.y)**2n)-Number(BigInt(a.center.x)**2n+BigInt(a.center.y)**2n))[0]||mining;
  return deepFreeze({agricultural,mining,distant});
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue),targets=evidenceTargets(seed);
  if(!targets.agricultural||!targets.mining)return deepFreeze({pass:false,reason:"settlement-evidence-targets-missing"});
  const eventFor=(plan,slot)=>({
    fantasyTimestamp:EVIDENCE_TIME,systemKind:SETTLEMENT_SYSTEM,entityId:plan.id,slotKey:slot,
    payload:{...settlementPayload(plan),seed,reschedule:false}
  });
  const aEvent=eventFor(targets.agricultural,"proof-agricultural"),mEvent=eventFor(targets.mining,"proof-mining");
  const aCtx=settlementContext(seed,targets.agricultural,EVIDENCE_TIME),mCtx=settlementContext(seed,targets.mining,EVIDENCE_TIME);
  const a1=settlementOutcome(targets.agricultural,aCtx,{},aEvent,EventScheduler.addressedRandom(seed,aEvent));
  const a2=settlementOutcome(targets.agricultural,aCtx,{},aEvent,EventScheduler.addressedRandom(seed,aEvent));
  const m1=settlementOutcome(targets.mining,mCtx,{},mEvent,EventScheduler.addressedRandom(seed,mEvent));
  const deterministic=stableStringify(a1)===stableStringify(a2);
  const differentiated=signature(a1)!==signature(m1)&&(
    Math.abs(a1.foodSupply-m1.foodSupply)>0.005||Math.abs(a1.productionOutput-m1.productionOutput)>0.005
  );
  const resourceConstrained=Boolean(
    a1.foodSupply<=clamp01(aCtx.local.resources.agriculture*0.48+aCtx.region.specialization.agriculture*0.22+aCtx.country.tendencies.agriculture*0.12+aCtx.behavior.transportAccess*0.10+aCtx.country.prosperity*0.08+0.20)&&
    m1.productionOutput<=1
  );
  return deepFreeze({
    pass:Boolean(deterministic&&differentiated&&resourceConstrained),
    deterministic,differentiated,resourceConstrained,eventDriven:true,lazyParentRevisionChecks:true,
    noImmediateCountryFanOut:true,noResidentSimulation:true,persistentAggregateHistory:true,
    reconciliationData:true,renderIndependent:true,renderInputs:0,perResidentIterations:0,
    maxRegions:MAX_REGIONS,maxSettlements:MAX_SETTLEMENTS,
    regionIntervalHours:REGION_INTERVAL_HOURS,settlementIntervalHours:SETTLEMENT_INTERVAL_HOURS,
    agriculturalId:targets.agricultural.id,miningId:targets.mining.id,distantId:targets.distant?.id||null,
    agriculturalSignature:signature(a1),miningSignature:signature(m1),
    agriculturalFood:a1.foodSupply,miningFood:m1.foodSupply,
    agriculturalProduction:a1.productionOutput,miningProduction:m1.productionOutput
  });
}
function initializeEvidence(seed){
  try{window.GlobalCountrySimulation?.evidenceStep?.(seed,0)}catch(_){}
  reset(seed,{scheduler:true});
  WorldContext.clearCaches({resetTelemetry:true});
  const targets=evidenceTargets(seed),delta=WorldState.deltaSnapshot(seed);
  evidenceMemory={
    seed,lastStep:0,targets,baselineSequence:delta.sequence,
    agriculturalRevision:0,miningRevision:0,agriculturalFood:null,miningFood:null,
    agriculturalProduction:null,miningProduction:null,
    parentCountryDeltaRevision:0,settlementRevisionBeforeParent:0,settlementRevisionAfterParent:0,
    parentCountryRevisionSeenBefore:null,parentCountryRevisionSeenAfter:null,
    lazyNoFanOut:true,longAbsenceRevisionBefore:0,longAbsenceRevisionAfter:0,
    longAbsenceSignatureBefore:null,longAbsenceSignatureAfter:null,
    reconciliationReady:false,noNpcDelta:true,stableAfterCamera:true
  };
  return evidenceMemory;
}
function scheduleAggregatePair(seed,plans,timestamp,slot){
  const regions=[],seen=new Set();
  for(const plan of plans){
    const region=RegionProfile.at(seed,plan.center.x,plan.center.y);
    if(region&&!seen.has(region.id)){seen.add(region.id);regions.push(region)}
  }
  const events=[
    ...regions.map(region=>({
      fantasyTimestamp:timestamp,systemKind:REGION_SYSTEM,entityId:region.id,slotKey:slot+"-region",
      payload:{...regionPayload(region),seed,reschedule:false}
    })),
    ...plans.map(plan=>({
      fantasyTimestamp:timestamp,systemKind:SETTLEMENT_SYSTEM,entityId:plan.id,slotKey:slot+"-settlement",
      payload:{...settlementPayload(plan),seed,reschedule:false}
    }))
  ];
  EventScheduler.scheduleMany(seed,events);
  return tick(seed,timestamp,{ensure:false,maxEvents:8});
}
function runEvidenceDifference(seed,mem){
  const run=scheduleAggregatePair(seed,[mem.targets.agricultural,mem.targets.mining],EVIDENCE_TIME,"difference");
  const settlements=run.batch.processed.map(item=>item.outcome).filter(item=>item?.ok&&item.kind==="settlement");
  const a=settlements.find(item=>item.settlementId===mem.targets.agricultural.id);
  const m=settlements.find(item=>item.settlementId===mem.targets.mining.id);
  mem.agriculturalRevision=Number(a?.deltaRevision||0);mem.miningRevision=Number(m?.deltaRevision||0);
  mem.agriculturalFood=a?.outcome?.foodSupply??null;mem.miningFood=m?.outcome?.foodSupply??null;
  mem.agriculturalProduction=a?.outcome?.productionOutput??null;mem.miningProduction=m?.outcome?.productionOutput??null;
  mem.reconciliationReady=Boolean(a?.reconciliation&&m?.reconciliation);
}
function runEvidenceParentChange(seed,mem){
  const plan=mem.targets.agricultural,country=PoliticalGeography.countryById(seed,plan.countryId);
  const countryRef=WorldState.countryRef(seed,country),countryWorld=WorldState.resolve(seed,countryRef);
  const current=countryWorld?.current?.state||{},ctxBefore=settlementContext(seed,plan,addHours(EVIDENCE_TIME,1));
  const setWorld=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  mem.settlementRevisionBeforeParent=Number(setWorld?.delta?.revision||0);
  mem.parentCountryRevisionSeenBefore=setWorld?.current?.state?.aggregate?.parentCountryRevisionSeen||null;
  const applied=WorldState.applyDelta(seed,countryRef,{state:{
    ...current,wealth:round(clamp01((ctxBefore?.country?.wealth??0.5)+0.08)),
    prosperity:round(clamp01((ctxBefore?.country?.prosperity??0.5)+0.07)),
    tendencies:{...(current.tendencies||{}),tradeOpenness:round(clamp01((ctxBefore?.country?.tendencies?.tradeOpenness??0.5)+0.09))}
  }},"WP-S007-006 lazy parent revision evidence");
  mem.parentCountryDeltaRevision=Number(applied?.entry?.revision||0);
  const afterWorld=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  mem.settlementRevisionAfterParent=Number(afterWorld?.delta?.revision||0);
  mem.lazyNoFanOut=mem.parentCountryDeltaRevision>0&&mem.settlementRevisionAfterParent===mem.settlementRevisionBeforeParent;
}
function runEvidenceRelevantRefresh(seed,mem){
  const plan=mem.targets.agricultural,now=addHours(EVIDENCE_TIME,2);
  const before=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  const beforeRevision=Number(before?.delta?.revision||0);
  const refreshed=ensureRelevant(seed,plan,now,{maxEvents:8});
  const after=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  mem.settlementRevisionBeforeParent=beforeRevision;
  mem.settlementRevisionAfterParent=Number(after?.delta?.revision||0);
  mem.parentCountryRevisionSeenAfter=after?.current?.state?.aggregate?.parentCountryRevisionSeen||null;
  const ctx=settlementContext(seed,plan,now);
  mem.lazyConsumed=Boolean(
    refreshed.ok&&refreshed.refreshed&&mem.settlementRevisionAfterParent>beforeRevision&&
    mem.parentCountryRevisionSeenAfter===ctx?.country?.revision
  );
}
function runEvidenceLongAbsence(seed,mem){
  const plan=mem.targets.distant||mem.targets.mining,before=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  mem.longAbsenceRevisionBefore=Number(before?.current?.state?.aggregate?.revision||0);
  mem.longAbsenceSignatureBefore=before?.currentSignature||null;
  const later=addHours(EVIDENCE_TIME,24*30);
  const region=RegionProfile.at(seed,plan.center.x,plan.center.y);
  const events=[];
  if(region)events.push({
    fantasyTimestamp:later,systemKind:REGION_SYSTEM,entityId:region.id,slotKey:"long-absence-region",
    payload:{...regionPayload(region),seed,reschedule:false}
  });
  events.push({
    fantasyTimestamp:later,systemKind:SETTLEMENT_SYSTEM,entityId:plan.id,slotKey:"long-absence-settlement",
    payload:{...settlementPayload(plan),seed,reschedule:false}
  });
  EventScheduler.scheduleMany(seed,events);
  tick(seed,later,{ensure:false,maxEvents:8});
  const after=WorldState.resolve(seed,WorldState.settlementRef(seed,plan));
  mem.longAbsenceRevisionAfter=Number(after?.current?.state?.aggregate?.revision||0);
  mem.longAbsenceSignatureAfter=after?.currentSignature||null;
  const entries=WorldState.deltaSnapshot(seed).entries;
  mem.noNpcDelta=!entries.some(item=>item.entityKind==="npc");
  mem.longAbsenceAccumulated=Boolean(mem.longAbsenceRevisionAfter>mem.longAbsenceRevisionBefore&&mem.longAbsenceSignatureAfter!==mem.longAbsenceSignatureBefore);
}
function evidenceDigest(seed,mem){
  const ids=[mem.targets.agricultural?.id,mem.targets.mining?.id,mem.targets.distant?.id].filter(Boolean);
  const entries=WorldState.deltaSnapshot(seed).entries.filter(item=>ids.includes(item.entityId)||item.entityKind==="region")
    .map(item=>[item.entityId,item.revision,item.sequence]);
  return signature({entries,last:mem.longAbsenceSignatureAfter,parent:mem.parentCountryRevisionSeenAfter});
}
function evidenceStep(seedValue,indexValue){
  const seed=normalizeSeed(seedValue),index=Math.max(0,Math.min(5,Math.floor(Number(indexValue)||0)));
  let mem=evidenceMemory?.seed===seed?evidenceMemory:initializeEvidence(seed);
  while(mem.lastStep<index){
    const next=mem.lastStep+1;
    if(next===1)runEvidenceDifference(seed,mem);
    else if(next===2)runEvidenceParentChange(seed,mem);
    else if(next===3)runEvidenceRelevantRefresh(seed,mem);
    else if(next===4)runEvidenceLongAbsence(seed,mem);
    else if(next===5){
      const before=evidenceDigest(seed,mem);
      const run=tick(seed,addHours(EVIDENCE_TIME,3),{ensure:false,maxEvents:8});
      const after=evidenceDigest(seed,mem);
      mem.stableAfterCamera=before===after&&run.batch.processedCount===0;
    }
    mem.lastStep=next;
  }
  return deepFreeze({ok:true,index,evidence:clone(mem),snapshot:snapshot(seed),delta:WorldState.deltaSnapshot(seed)});
}
function setCheck(root,id,pass){
  const node=root?.querySelector?.("#"+id);if(!node)return;
  node.textContent=pass?"PASS":"FAIL";node.classList.toggle("pass",Boolean(pass));
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function pct(v){return v==null?"—":Math.round(clamp01(v)*100)+"%"}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("regionalSettlementSimulationProof");
  if(!root)return null;
  const verify=proof(seed),snap=snapshot(seed),mem=evidenceMemory?.seed===seed?evidenceMemory:null;
  const values={
    regionalSettlementScope:snap.trackedRegions+" regions · "+snap.trackedSettlements+" settlements",
    regionalSettlementCadence:REGION_INTERVAL_HOURS+"h region · "+SETTLEMENT_INTERVAL_HOURS+"h settlement",
    regionalSettlementEvents:snap.processedRegionEvents+" region · "+snap.processedSettlementEvents+" settlement",
    regionalSettlementCost:snap.telemetry.lastCostMs.toFixed(3)+" ms last · "+snap.telemetry.averageCostMs.toFixed(3)+" ms avg",
    regionalSettlementPair:(verify.agriculturalId||"—")+" / "+(verify.miningId||"—"),
    regionalSettlementResources:"food "+pct(mem?.agriculturalFood)+" / "+pct(mem?.miningFood)+" · production "+pct(mem?.agriculturalProduction)+" / "+pct(mem?.miningProduction),
    regionalSettlementLazy:mem?.lazyConsumed
      ?("settlement delta "+mem.settlementRevisionBeforeParent+" → "+mem.settlementRevisionAfterParent+" · parent consumed")
      :"awaiting lazy parent refresh",
    regionalSettlementHistory:mem?.longAbsenceAccumulated
      ?("aggregate rev "+mem.longAbsenceRevisionBefore+" → "+mem.longAbsenceRevisionAfter+" after 30d")
      :"awaiting dormant history evidence"
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const rows=root.querySelector("#regionalSettlementLedger");
  if(rows){
    const list=snap.ledger.slice(-8).reverse();
    rows.innerHTML=list.length?list.map(item=>
      "<li><div><strong>"+esc(item.kind+" · "+item.entityId)+"</strong><small>"+esc(item.timestamp)+"</small></div><span>"+esc(item.signature)+"</span></li>"
    ).join(""):"<li><div><strong>No due regional work yet</strong><small>Aggregate state stays dormant until scheduled/relevant.</small></div><span>idle</span></li>";
  }
  const differencePass=!mem||mem.lastStep<1||Boolean(
    mem.agriculturalRevision>0&&mem.miningRevision>0&&
    (Math.abs((mem.agriculturalFood??0)-(mem.miningFood??0))>0.005||Math.abs((mem.agriculturalProduction??0)-(mem.miningProduction??0))>0.005)
  );
  const lazyPass=!mem||mem.lastStep<3||Boolean(mem.lazyNoFanOut&&mem.lazyConsumed&&mem.parentCountryRevisionSeenAfter);
  const historyPass=!mem||mem.lastStep<4||Boolean(mem.longAbsenceAccumulated&&mem.noNpcDelta&&mem.reconciliationReady);
  setCheck(root,"vRegionalSettlementDeterministic",verify.deterministic&&verify.eventDriven);
  setCheck(root,"vRegionalSettlementResources",verify.differentiated&&verify.resourceConstrained&&differencePass);
  setCheck(root,"vRegionalSettlementLazy",verify.lazyParentRevisionChecks&&verify.noImmediateCountryFanOut&&lazyPass);
  setCheck(root,"vRegionalSettlementDormant",verify.noResidentSimulation&&historyPass);
  setCheck(root,"vRegionalSettlementReconcile",verify.reconciliationData&&(!mem||mem.reconciliationReady));
  setCheck(root,"vRegionalSettlementBounded",verify.maxRegions<=MAX_REGIONS&&verify.maxSettlements<=MAX_SETTLEMENTS&&snap.telemetry.perResidentIterations===0&&(mem?.stableAfterCamera!==false));
  root.dataset.pass=String(verify.pass);
  root.dataset.lastStep=String(mem?.lastStep||0);
  root.dataset.trackedRegions=String(snap.trackedRegions);
  root.dataset.trackedSettlements=String(snap.trackedSettlements);
  root.dataset.processedRegionEvents=String(snap.processedRegionEvents);
  root.dataset.processedSettlementEvents=String(snap.processedSettlementEvents);
  root.dataset.agriculturalRevision=String(mem?.agriculturalRevision||0);
  root.dataset.miningRevision=String(mem?.miningRevision||0);
  root.dataset.agriculturalFood=String(mem?.agriculturalFood??"");
  root.dataset.miningFood=String(mem?.miningFood??"");
  root.dataset.agriculturalProduction=String(mem?.agriculturalProduction??"");
  root.dataset.miningProduction=String(mem?.miningProduction??"");
  root.dataset.parentCountryDeltaRevision=String(mem?.parentCountryDeltaRevision||0);
  root.dataset.settlementRevisionBeforeParent=String(mem?.settlementRevisionBeforeParent||0);
  root.dataset.settlementRevisionAfterParent=String(mem?.settlementRevisionAfterParent||0);
  root.dataset.parentCountryRevisionSeenAfter=mem?.parentCountryRevisionSeenAfter||"";
  root.dataset.lazyNoFanOut=String(mem?.lazyNoFanOut!==false);
  root.dataset.lazyConsumed=String(Boolean(mem?.lazyConsumed));
  root.dataset.longAbsenceRevisionBefore=String(mem?.longAbsenceRevisionBefore||0);
  root.dataset.longAbsenceRevisionAfter=String(mem?.longAbsenceRevisionAfter||0);
  root.dataset.longAbsenceAccumulated=String(Boolean(mem?.longAbsenceAccumulated));
  root.dataset.reconciliationReady=String(Boolean(mem?.reconciliationReady));
  root.dataset.noNpcDelta=String(mem?.noNpcDelta!==false);
  root.dataset.stableAfterCamera=String(mem?.stableAfterCamera!==false);
  return deepFreeze({verification:verify,snapshot:snap,evidence:mem?clone(mem):null});
}

window.RegionalSettlementSimulation=Object.freeze({
  VERSION,REGION_SYSTEM,SETTLEMENT_SYSTEM,REGION_INTERVAL_HOURS,SETTLEMENT_INTERVAL_HOURS,
  MAX_REGIONS,MAX_SETTLEMENTS,catalog,ensureScheduled,tick,ensureRelevant,reset,snapshot,proof,evidenceTargets,evidenceStep,renderDebugPanel
});
})();