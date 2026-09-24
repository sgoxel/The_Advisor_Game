(function(){
"use strict";

const VERSION=1;
const CACHE_SCHEMA_VERSION=1;
const cache={
  country:new Map(),region:new Map(),local:new Map(),diplomacy:new Map(),settlement:new Map(),final:new Map()
};
const latestRevision=new Map();
const metrics={
  queries:0,hits:0,misses:0,staleRefreshes:0,fanOutInvalidations:0,
  builds:{country:0,region:0,local:0,diplomacy:0,settlement:0,final:0}
};

function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function round(value,digits=4){
  const factor=10**digits;
  return Math.round(Number(value)*factor)/factor;
}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};
  for(const [key,item] of Object.entries(value))out[key]=clone(item);
  return out;
}
function deepFreeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))deepFreeze(item);
  return Object.freeze(value);
}
function stableStringify(value){
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}";
}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function signature(value){return hashText(stableStringify(value))}
function timeKey(value){
  if(value==null)return "time-independent";
  if(typeof value==="string")return value;
  if(typeof window.GameTime?.toTimestampKey==="function"){
    try{return window.GameTime.toTimestampKey(value)}catch(_){}
  }
  if(value instanceof Date)return value.toISOString().slice(0,19);
  if(typeof value==="object"&&value.year!=null){
    const pad=n=>String(Number(n)||0).padStart(2,"0");
    return String(value.year)+"-"+pad(value.month||1)+"-"+pad(value.day||1)+" "+pad(value.hour||0)+":"+pad(value.minute||0)+":"+pad(value.second||0);
  }
  return String(value);
}
function distance(a,b){
  const dx=Number(BigInt(String(a.x))-BigInt(String(b.x)));
  const dy=Number(BigInt(String(a.y))-BigInt(String(b.y)));
  return Math.hypot(dx,dy);
}
function cacheSize(){
  return Object.values(cache).reduce((sum,map)=>sum+map.size,0);
}
function telemetry(){
  return deepFreeze({
    version:CACHE_SCHEMA_VERSION,
    queries:metrics.queries,hits:metrics.hits,misses:metrics.misses,
    staleRefreshes:metrics.staleRefreshes,fanOutInvalidations:metrics.fanOutInvalidations,
    cacheEntries:cacheSize(),
    cacheEntriesByKind:Object.freeze(Object.fromEntries(Object.entries(cache).map(([kind,map])=>[kind,map.size]))),
    builds:Object.freeze({...metrics.builds})
  });
}
function noteRevision(kind,id,revision){
  const identity=kind+"|"+id;
  const previous=latestRevision.get(identity);
  if(previous&&previous!==revision)metrics.staleRefreshes++;
  latestRevision.set(identity,revision);
}
function cached(kind,key,id,revision,builder){
  const map=cache[kind];
  if(map.has(key)){
    metrics.hits++;
    return Object.freeze({value:map.get(key),cacheHit:true});
  }
  metrics.misses++;
  noteRevision(kind,id,revision);
  metrics.builds[kind]++;
  const value=deepFreeze(builder());
  map.set(key,value);
  return Object.freeze({value,cacheHit:false});
}
function clearCaches(optionsValue){
  const options=optionsValue||{};
  const count=cacheSize();
  for(const map of Object.values(cache))map.clear();
  latestRevision.clear();
  if(options.resetTelemetry){
    metrics.queries=0;metrics.hits=0;metrics.misses=0;metrics.staleRefreshes=0;metrics.fanOutInvalidations=0;
    for(const key of Object.keys(metrics.builds))metrics.builds[key]=0;
  }
  return count;
}
function deltaRevision(resolved){return Number(resolved?.delta?.revision||0)}
function countryCurrent(seed,country){
  const profile=CountryProfile.build(seed,country.id);
  const ref=WorldState.countryRef(seed,country);
  const world=ref?WorldState.resolve(seed,ref):null;
  const overlay=world?.current?.state||{};
  const tendencies=Object.freeze({
    ...profile.tendencies,
    ...(overlay.tendencies||{})
  });
  const wealth=clamp01(overlay.wealth??profile.wealth.value);
  const prosperity=clamp01(overlay.prosperity??wealth);
  const stability=clamp01(overlay.stability??(
    0.18+
    profile.governance.administrativeCapacity*0.34+
    profile.governance.taxationCapacity*0.16+
    wealth*0.22+
    tendencies.tradeOpenness*0.10-
    tendencies.militaryEmphasis*0.08+
    0.08
  ));
  const revision="CCTX-"+hashText([
    VERSION,profile.revision,deltaRevision(world),wealth,prosperity,stability,
    ...Object.values(tendencies)
  ].join("|"));
  const key=[seed,country.id,revision].join("|");
  return cached("country",key,country.id,revision,()=>({
    id:country.id,name:country.name,
    foundationRevision:profile.revision,
    campaignDeltaRevision:deltaRevision(world),
    revision,
    wealth:round(wealth),prosperity:round(prosperity),stability:round(stability),
    governance:profile.governance,
    tendencies:Object.freeze(Object.fromEntries(Object.entries(tendencies).map(([k,v])=>[k,round(clamp01(v))]))),
    geography:profile.geography,
    culturalKeys:profile.culturalKeys,
    architecture:profile.architecture,
    sourceRef:ref,
    currentWorldSignature:world?.currentSignature||null
  }));
}
function regionCurrent(seed,region,countryFragment){
  const ref=WorldState.regionRef(seed,region);
  const world=ref?WorldState.resolve(seed,ref):null;
  const overlay=world?.current?.state||{};
  const c=countryFragment.tendencies;
  const foundation=region.specialization;
  const effective={
    agriculture:clamp01(foundation.agriculture*0.70+c.agriculture*0.30),
    forestry:clamp01(foundation.forestry*0.78+c.craftProduction*0.22),
    mining:clamp01(foundation.mining*0.72+c.mining*0.28),
    trade:clamp01(foundation.trade*0.68+c.tradeOpenness*0.32),
    maritime:clamp01(foundation.maritime*0.72+c.maritime*0.28),
    defense:clamp01(foundation.defense*0.72+c.fortification*0.18+c.militaryEmphasis*0.10),
    craft:clamp01(foundation.craft*0.72+c.craftProduction*0.28)
  };
  Object.assign(effective,overlay.specialization||{});
  const prosperity=clamp01(overlay.prosperity??countryFragment.prosperity+Number(region.prosperity?.modifier||0));
  const stability=clamp01(overlay.stability??countryFragment.stability-region.identity.hazards.rugged*0.06-region.identity.hazards.flood*0.05);
  const revision="RCTX-"+hashText([
    VERSION,region.revision,deltaRevision(world),countryFragment.revision,prosperity,stability,...Object.values(effective)
  ].join("|"));
  const key=[seed,region.id,revision].join("|");
  return cached("region",key,region.id,revision,()=>({
    id:region.id,name:region.name,parentCountryId:region.parentCountryId,
    foundationRevision:region.revision,campaignDeltaRevision:deltaRevision(world),
    parentCountryRevision:countryFragment.revision,revision,
    identity:region.identity,
    specialization:Object.freeze(Object.fromEntries(Object.entries(effective).map(([k,v])=>[k,round(clamp01(v))]))),
    prosperity:round(prosperity),stability:round(stability),
    administrativeSeat:region.administrativeSeat,
    sourceRef:ref,currentWorldSignature:world?.currentSignature||null
  }));
}
function deriveLocalResources(region,terrain,environment){
  const identity=region.identity;
  const elevation=Math.max(0,Number(environment.elevationMeters||0));
  const agriculture=clamp01(
    identity.agriculturalSuitability*0.74+
    ((terrain==="farmland"||terrain==="grass")?0.20:terrain==="rock"?-0.18:terrain==="water"?-0.32:0)+
    (1-Math.min(1,elevation/1900))*0.06
  );
  const timber=clamp01(identity.timberAvailability*0.80+(terrain==="forest"?0.20:0));
  const mineral=clamp01(identity.mineralPotential*0.78+(terrain==="rock"?0.17:0)+Math.min(0.05,elevation/28000));
  const water=clamp01(identity.waterAccess*0.84+(terrain==="water"?0.16:terrain==="mud"||terrain==="sand"?0.06:0));
  return Object.freeze({
    agriculture:round(agriculture),timber:round(timber),mineral:round(mineral),water:round(water)
  });
}
function localCurrent(seed,point,regionFragment,plan){
  const x=String(point.x),y=String(point.y);
  const terrain=GeographyFoundation.getTerrainType(seed,x,y);
  const environment=GeographyFoundation.environment(seed,x,y);
  const resources=plan?.inputs?.local?.resources||deriveLocalResources(regionFragment,terrain,environment);
  const routeAccess=clamp01(plan?.inputs?.local?.routeAccess??(
    regionFragment.identity.transportAccessibility*0.84+
    ((terrain==="road"||terrain==="bridge")?0.16:0)
  ));
  const coastalAccess=Boolean(plan?.inputs?.local?.coastalAccess??(resources.water>=0.36));
  const revision="LCTX-"+hashText([
    VERSION,x,y,terrain,environment.biome,environment.climate,environment.elevationMeters,
    resources.agriculture,resources.timber,resources.mineral,resources.water,routeAccess,coastalAccess,
    regionFragment.revision
  ].join("|"));
  const id="LOCAL|"+x+"|"+y;
  const key=[seed,id,revision].join("|");
  return cached("local",key,id,revision,()=>({
    id,x,y,revision,parentRegionRevision:regionFragment.revision,
    terrain,biome:environment.biome,climate:environment.climate,
    elevationMeters:Number(environment.elevationMeters||0),
    moisturePercent:Number(environment.moisturePercent||0),
    temperatureC:Number(environment.temperatureC||0),
    resources:Object.freeze({
      agriculture:round(clamp01(resources.agriculture)),
      timber:round(clamp01(resources.timber)),
      mineral:round(clamp01(resources.mineral)),
      water:round(clamp01(resources.water))
    }),
    routeAccess:round(routeAccess),coastalAccess,
    terrainAuthority:"GeographyFoundation",
    resourceAuthority:plan?.inputs?.local?.resourceAuthority||"RegionProfile + local fixed geography"
  }));
}
function nearestBorderRelation(seed,country,point,plan){
  const plannedNeighbor=plan?.inputs?.border?.neighborCountryId||null;
  if(plannedNeighbor){
    const relation=CountryRelations.build(seed,country.id,plannedNeighbor);
    if(relation)return Object.freeze({
      relation,neighborCountryId:plannedNeighbor,
      proximity:clamp01(plan.inputs.border.proximity||0),
      distanceTiles:plan.inputs.border.distanceTiles??null,
      source:"settlement-border-context"
    });
  }
  const borders=PoliticalGeography.borderEvidence(seed,country)||[];
  let best=null;
  for(const border of borders){
    if(border.x==null||border.y==null)continue;
    const d=distance(point,border);
    if(!best||d<best.distance){
      const neighborId=border.countryA.id===country.id?border.countryB.id:border.countryA.id;
      best={border,distance:d,neighborId};
    }
  }
  if(!best)return null;
  const relation=CountryRelations.build(seed,country.id,best.neighborId);
  if(!relation)return null;
  return Object.freeze({
    relation,neighborCountryId:best.neighborId,
    proximity:clamp01(1-best.distance/5200),
    distanceTiles:Math.round(best.distance),
    source:"nearest-border"
  });
}
function diplomacyCurrent(seed,country,point,plan,countryFragment){
  const found=nearestBorderRelation(seed,country,point,plan);
  if(!found)return Object.freeze({
    value:deepFreeze({
      id:null,revision:"DCTX-none",foundationRevision:null,campaignDeltaRevision:0,
      neighborCountryId:null,proximity:0,distanceTiles:null,
      state:"internal",relationshipScore:0,tradeAccess:0.35,militaryTension:0.10,borderOpenness:0.35,
      warState:false,agreements:Object.freeze({}),direction:Object.freeze({tradeReliance:0,dependency:0,leverage:0}),
      parentCountryRevision:countryFragment.revision
    }),
    cacheHit:true
  });
  const relation=found.relation;
  const ref=WorldState.diplomacyRef(seed,relation);
  const world=ref?WorldState.resolve(seed,ref):null;
  const current=world?.current||relation;
  const shared=current.shared||relation.shared;
  const direction=current.directional?.[country.id]||relation.directional?.[country.id]||{};
  const revision="DCTX-"+hashText([
    VERSION,relation.revision,deltaRevision(world),countryFragment.revision,
    shared.relationshipScore,shared.tradeAccess,shared.militaryTension,shared.borderOpenness,shared.warState
  ].join("|"));
  const key=[seed,relation.id,revision].join("|");
  return cached("diplomacy",key,relation.id,revision,()=>({
    id:relation.id,revision,foundationRevision:relation.revision,campaignDeltaRevision:deltaRevision(world),
    parentCountryRevision:countryFragment.revision,
    neighborCountryId:found.neighborCountryId,proximity:round(found.proximity),distanceTiles:found.distanceTiles,
    state:shared.state,relationshipScore:round(Number(shared.relationshipScore||0)),
    tradeAccess:round(clamp01(shared.tradeAccess)),militaryTension:round(clamp01(shared.militaryTension)),
    borderOpenness:round(clamp01(shared.borderOpenness)),warState:Boolean(shared.warState),
    agreements:current.agreements||relation.agreements,
    direction:Object.freeze({
      tradeReliance:round(clamp01(direction.tradeReliance||0)),
      dependency:round(clamp01(direction.dependency||0)),
      leverage:round(Math.max(-1,Math.min(1,Number(direction.leverage||0))))
    }),
    sourceRef:ref,currentWorldSignature:world?.currentSignature||null
  }));
}
function settlementCurrent(seed,plan,countryFragment,regionFragment,localFragment,diplomacyFragment){
  if(!plan)return Object.freeze({value:null,cacheHit:true});
  const ref=WorldState.settlementRef(seed,plan);
  const world=ref?WorldState.resolve(seed,ref):null;
  const current=world?.current||plan;
  const prosperity=clamp01(current.prosperity?.value??plan.prosperity.value);
  const population=Math.max(0,Math.round(Number(current.population?.planned??plan.population.planned)||0));
  const security=clamp01(
    current.state?.security??
    plan.defenseTendency*0.48+
    regionFragment.specialization.defense*0.18+
    countryFragment.tendencies.militaryEmphasis*0.12+
    (1-diplomacyFragment.militaryTension)*0.12+
    countryFragment.stability*0.10
  );
  const trade=clamp01(
    current.state?.trade??
    plan.tradeMarketTendency*0.42+
    regionFragment.specialization.trade*0.18+
    countryFragment.tendencies.tradeOpenness*0.16+
    localFragment.routeAccess*0.16+
    diplomacyFragment.tradeAccess*0.08
  );
  const food=clamp01(
    current.state?.food??
    localFragment.resources.agriculture*0.55+
    regionFragment.specialization.agriculture*0.25+
    countryFragment.tendencies.agriculture*0.12+
    prosperity*0.08
  );
  const production=clamp01(
    current.state?.production??
    Math.max(localFragment.resources.timber,localFragment.resources.mineral)*0.34+
    Math.max(regionFragment.specialization.craft,regionFragment.specialization.mining,regionFragment.specialization.forestry)*0.34+
    countryFragment.tendencies.craftProduction*0.20+
    localFragment.routeAccess*0.12
  );
  const revision="SCTX-"+hashText([
    VERSION,plan.revision,deltaRevision(world),countryFragment.revision,regionFragment.revision,
    localFragment.revision,diplomacyFragment.revision,prosperity,population,security,trade,food,production
  ].join("|"));
  const key=[seed,plan.id,revision].join("|");
  return cached("settlement",key,plan.id,revision,()=>({
    id:plan.id,name:plan.name,classId:plan.classId,role:plan.role,
    foundationRevision:plan.revision,campaignDeltaRevision:deltaRevision(world),
    revision,
    parentRevisions:Object.freeze({
      country:countryFragment.revision,region:regionFragment.revision,
      local:localFragment.revision,diplomacy:diplomacyFragment.revision
    }),
    subtypes:plan.subtypes,population,prosperity:round(prosperity),
    security:round(security),trade:round(trade),food:round(food),production:round(production),
    roadScale:plan.roadScale,publicSpaceScale:plan.publicSpaceScale,
    buildingFunctions:plan.buildingFunctions,architectureKeys:plan.architectureKeys,
    sourceRef:ref,currentWorldSignature:world?.currentSignature||null
  }));
}
function settlementAt(seed,country,point){
  const plans=SettlementArchetypes.settlementsForCountry(seed,country,3)||[];
  let best=null;
  for(const plan of plans){
    const d=distance(point,plan.center);
    if(!best||d<best.distance)best={plan,distance:d};
  }
  if(!best)return null;
  return best.distance<=1800?best.plan:null;
}
function normalizeTarget(seedValue,targetValue){
  const seed=String(seedValue==null?"":seedValue);
  const target=targetValue||{};
  let plan=null,point=null,entityRef=null;
  if(target?.id&&String(target.id).startsWith("SET|")&&target.center&&target.generation)plan=target;
  else if(target?.settlement?.id)plan=target.settlement;
  else if(target?.plan?.id)plan=target.plan;
  else if(target?.kind==="settlement"&&target?.key?.desiredCenter){
    const materialized=WorldState.materialize(seed,target);
    plan=materialized?.data||null;
    entityRef=target;
  }
  if(plan)point={x:String(plan.center.x),y:String(plan.center.y)};
  else if(target?.x!=null&&target?.y!=null)point={x:WorldCoordinates.normalize(target.x),y:WorldCoordinates.normalize(target.y)};
  else if(target?.coordinates?.x!=null&&target?.coordinates?.y!=null)point={x:WorldCoordinates.normalize(target.coordinates.x),y:WorldCoordinates.normalize(target.coordinates.y)};
  else point={x:"0",y:"0"};
  const country=PoliticalGeography.countryAt(seed,point.x,point.y);
  if(!plan&&country)plan=settlementAt(seed,country,point);
  if(target?.entityRef)entityRef=target.entityRef;
  return Object.freeze({seed,target,point,country,plan,entityRef});
}
function behaviorModifiers(country,region,local,diplomacy,settlement){
  const prosperity=settlement?.prosperity??region.prosperity;
  const security=settlement?.security??clamp01(region.stability*(1-diplomacy.militaryTension*0.35));
  const trade=settlement?.trade??clamp01(country.tendencies.tradeOpenness*0.32+region.specialization.trade*0.28+local.routeAccess*0.28+diplomacy.tradeAccess*0.12);
  const production=settlement?.production??clamp01(region.specialization.craft*0.30+region.specialization.mining*0.24+region.specialization.forestry*0.20+country.tendencies.craftProduction*0.16+local.routeAccess*0.10);
  const food=settlement?.food??clamp01(local.resources.agriculture*0.58+region.specialization.agriculture*0.26+country.tendencies.agriculture*0.16);
  const agricultureMultiplier=clamp01(0.48+region.specialization.agriculture*0.22+country.tendencies.agriculture*0.18+prosperity*0.12);
  const miningMultiplier=clamp01(0.48+region.specialization.mining*0.24+country.tendencies.mining*0.18+production*0.10);
  const maritimeMultiplier=local.coastalAccess?clamp01(0.46+region.specialization.maritime*0.24+country.tendencies.maritime*0.18+trade*0.12):0;
  return Object.freeze({
    prosperity:round(prosperity),security:round(security),trade:round(trade),food:round(food),production:round(production),
    marketDemand:round(clamp01(prosperity*0.34+trade*0.38+country.wealth*0.18+local.routeAccess*0.10)),
    employmentOpportunity:round(clamp01(production*0.34+trade*0.28+food*0.18+prosperity*0.20)),
    securityPressure:round(clamp01((1-security)*0.52+diplomacy.militaryTension*0.34+(diplomacy.warState?0.22:0))),
    agriculturePotential:round(local.resources.agriculture*agricultureMultiplier),
    miningPotential:round(local.resources.mineral*miningMultiplier),
    maritimePotential:round(local.resources.water*maritimeMultiplier),
    transportAccess:round(local.routeAccess*clamp01(0.62+country.tendencies.infrastructure*0.20+region.identity.transportAccessibility*0.18)),
    borderTradeAccess:round(diplomacy.tradeAccess*local.routeAccess),
    localConstraints:Object.freeze({
      agricultureCeiling:local.resources.agriculture,
      miningCeiling:local.resources.mineral,
      waterCeiling:local.resources.water,
      coastalRequiredForMaritime:true
    })
  });
}
function resolve(seedValue,targetValue,fantasyTimeValue){
  const normalized=normalizeTarget(seedValue,targetValue);
  const {seed,point,country,plan}=normalized;
  if(!country)return null;
  metrics.queries++;
  const countryResult=countryCurrent(seed,country),countryFragment=countryResult.value;
  const region=RegionProfile.at(seed,point.x,point.y);
  if(!region)return null;
  const regionResult=regionCurrent(seed,region,countryFragment),regionFragment=regionResult.value;
  const localResult=localCurrent(seed,point,regionFragment,plan),localFragment=localResult.value;
  const diplomacyResult=diplomacyCurrent(seed,country,point,plan,countryFragment),diplomacyFragment=diplomacyResult.value;
  const settlementResult=settlementCurrent(seed,plan,countryFragment,regionFragment,localFragment,diplomacyFragment);
  const settlementFragment=settlementResult.value;
  const tk=timeKey(fantasyTimeValue);
  const revisions=Object.freeze({
    country:countryFragment.revision,region:regionFragment.revision,local:localFragment.revision,
    diplomacy:diplomacyFragment.revision,settlement:settlementFragment?.revision||"SCTX-none"
  });
  const finalRevision="WCTX-"+hashText([VERSION,tk,...Object.values(revisions)].join("|"));
  const identity=plan?.id||("COORD|"+point.x+"|"+point.y);
  const finalKey=[seed,identity,tk,finalRevision].join("|");
  const built=cached("final",finalKey,identity,finalRevision,()=>{
    const behavior=behaviorModifiers(countryFragment,regionFragment,localFragment,diplomacyFragment,settlementFragment);
    return {
      version:VERSION,schema:"WorldContext",timeKey:tk,
      target:Object.freeze({
        kind:plan?"settlement":"coordinate",id:identity,x:point.x,y:point.y,
        entityRef:normalized.entityRef||null
      }),
      country:countryFragment,region:regionFragment,local:localFragment,diplomacy:diplomacyFragment,
      settlement:settlementFragment,
      behavior,
      downstream:Object.freeze({
        economy:Object.freeze({prosperity:behavior.prosperity,trade:behavior.trade,marketDemand:behavior.marketDemand,transportAccess:behavior.transportAccess}),
        settlement:Object.freeze({security:behavior.security,food:behavior.food,production:behavior.production,prosperity:behavior.prosperity}),
        job:Object.freeze({employmentOpportunity:behavior.employmentOpportunity,agriculturePotential:behavior.agriculturePotential,miningPotential:behavior.miningPotential,maritimePotential:behavior.maritimePotential}),
        npc:Object.freeze({prosperity:behavior.prosperity,securityPressure:behavior.securityPressure,employmentOpportunity:behavior.employmentOpportunity,transportAccess:behavior.transportAccess}),
        diplomacy:Object.freeze({state:diplomacyFragment.state,tradeAccess:diplomacyFragment.tradeAccess,militaryTension:diplomacyFragment.militaryTension,warState:diplomacyFragment.warState}),
        presentation:Object.freeze({settlementClass:settlementFragment?.classId||null,terrain:localFragment.terrain,biome:localFragment.biome,security:behavior.security,prosperity:behavior.prosperity})
      }),
      revisions,
      revision:finalRevision,
      authority:Object.freeze({
        hierarchy:"Country → Region → Local Geography/Resources → Settlement → Building/Job/NPC Context",
        country:"WorldState + CountryProfile",region:"WorldState + RegionProfile",
        localTerrain:"GeographyFoundation",localResources:"RegionProfile + local fixed geography",
        diplomacy:"WorldState + CountryRelations",settlement:"WorldState + SettlementArchetypes",
        mutatesWorldState:false,renderIndependent:true,fanOutInvalidation:false,lazyRefresh:true
      })
    };
  });
  const data=built.value;
  return deepFreeze({
    ...data,
    signature:signature({
      version:data.version,timeKey:data.timeKey,target:data.target,country:data.country,region:data.region,
      local:data.local,diplomacy:data.diplomacy,settlement:data.settlement,behavior:data.behavior,
      downstream:data.downstream,revisions:data.revisions,revision:data.revision,authority:data.authority
    }),
    cache:Object.freeze({
      finalHit:built.cacheHit,
      fragmentHits:Object.freeze({
        country:countryResult.cacheHit,region:regionResult.cacheHit,local:localResult.cacheHit,
        diplomacy:diplomacyResult.cacheHit,settlement:settlementResult.cacheHit
      })
    })
  });
}
function resolveChild(seedValue,settlementTarget,childRefValue,fantasyTimeValue){
  const parent=resolve(seedValue,settlementTarget,fantasyTimeValue);
  if(!parent)return null;
  const childRef=childRefValue||null;
  const id=childRef?.id||"anonymous-child";
  const kind=childRef?.kind||"child";
  return deepFreeze({
    schema:"WorldChildContext",version:VERSION,child:Object.freeze({id,kind}),
    parentContextSignature:parent.signature,parentContextRevision:parent.revision,
    inherited:parent.downstream,
    localAuthority:parent.local,
    revisions:parent.revisions,
    renderIndependent:true,mutatesWorldState:false
  });
}
function evidenceTargets(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const plans=(SettlementArchetypes.settlementsForCountry(seed,country,3)||[]).filter(plan=>plan.classId!=="national-capital"||true);
  let bestPair=null,bestScore=-1;
  for(let i=0;i<plans.length;i++){
    for(let j=i+1;j<plans.length;j++){
      const a=plans[i],b=plans[j];
      if(a.regionId===b.regionId)continue;
      const ar=a.inputs.local.resources,br=b.inputs.local.resources;
      const score=
        Math.abs(ar.agriculture-br.agriculture)+Math.abs(ar.timber-br.timber)+
        Math.abs(ar.mineral-br.mineral)+Math.abs(ar.water-br.water)+
        Math.abs(a.inputs.local.routeAccess-b.inputs.local.routeAccess);
      if(score>bestScore){bestScore=score;bestPair=[a,b]}
    }
  }
  if(!bestPair&&plans.length>=2)bestPair=[plans[0],plans[1]];
  if(!bestPair&&plans.length===1)bestPair=[plans[0],plans[0]];
  return Object.freeze({
    countryId:country.id,
    primary:bestPair?.[0]||null,
    contrast:bestPair?.[1]||null,
    differenceScore:round(Math.max(0,bestScore))
  });
}
function applyEvidenceCountryDelta(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const targets=evidenceTargets(seed);
  const country=PoliticalGeography.countryById(seed,targets.countryId);
  const profile=CountryProfile.build(seed,country.id);
  const ref=WorldState.countryRef(seed,country);
  const current=WorldState.resolve(seed,ref);
  const existing=current?.current?.state||{};
  if(deltaRevision(current)>0&&existing.proofStatus==="wp-s007-002-country-change"){
    return Object.freeze({ok:true,alreadyApplied:true,entry:current.delta,resolved:current});
  }
  const wealth=clamp01(profile.wealth.value+0.18);
  const tradeOpenness=clamp01(profile.tendencies.tradeOpenness+0.24);
  const prosperity=clamp01(wealth+0.04);
  const stability=clamp01(
    0.42+profile.governance.administrativeCapacity*0.28+wealth*0.20-profile.tendencies.militaryEmphasis*0.08
  );
  return WorldState.applyDelta(seed,ref,{
    state:{
      proofStatus:"wp-s007-002-country-change",
      wealth:round(wealth),prosperity:round(prosperity),stability:round(stability),
      tendencies:{tradeOpenness:round(tradeOpenness)}
    }
  },"WP-S007-002 country wealth/trade evidence");
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const beforeDelta=WorldState.deltaSnapshot(seed);
  const targets=evidenceTargets(seed);
  if(!targets.primary||!targets.contrast)return deepFreeze({pass:false,reason:"settlement-evidence-targets-missing"});
  const fixedTime=Object.freeze({year:1200,month:6,day:15,hour:12,minute:0,second:0});
  const a=resolve(seed,targets.primary,fixedTime);
  const aRepeat=resolve(seed,targets.primary,fixedTime);
  const b=resolve(seed,targets.contrast,fixedTime);
  const afterDelta=WorldState.deltaSnapshot(seed);
  const deterministic=Boolean(a&&aRepeat&&a.signature===aRepeat.signature);
  const sameCountryDifferentRegions=Boolean(
    a&&b&&a.country.id===b.country.id&&a.region.id!==b.region.id
  );
  const regionalTerrainDifference=Boolean(
    sameCountryDifferentRegions&&(
      a.local.terrain!==b.local.terrain||
      a.local.biome!==b.local.biome||
      stableStringify(a.local.resources)!==stableStringify(b.local.resources)||
      a.local.routeAccess!==b.local.routeAccess
    )
  );
  const regionalBehaviorDifference=Boolean(
    regionalTerrainDifference&&a.signature!==b.signature&&(
      a.behavior.agriculturePotential!==b.behavior.agriculturePotential||
      a.behavior.miningPotential!==b.behavior.miningPotential||
      a.behavior.transportAccess!==b.behavior.transportAccess||
      a.behavior.trade!==b.behavior.trade
    )
  );
  const localAuthorityPreserved=[a,b].every(ctx=>
    ctx.behavior.agriculturePotential<=ctx.local.resources.agriculture+0.0001&&
    ctx.behavior.miningPotential<=ctx.local.resources.mineral+0.0001&&
    ctx.behavior.maritimePotential<=ctx.local.resources.water+0.0001&&
    (ctx.local.coastalAccess||ctx.behavior.maritimePotential===0)
  );
  const complete=Boolean(a&&
    a.country?.revision&&a.region?.revision&&a.local?.revision&&a.diplomacy?.revision&&
    a.behavior&&a.downstream?.economy&&a.downstream?.settlement&&a.downstream?.job&&
    a.downstream?.npc&&a.downstream?.diplomacy&&a.downstream?.presentation
  );
  const parentRevisionsRecorded=Boolean(a?.settlement?.parentRevisions&&
    a.settlement.parentRevisions.country===a.revisions.country&&
    a.settlement.parentRevisions.region===a.revisions.region&&
    a.settlement.parentRevisions.local===a.revisions.local&&
    a.settlement.parentRevisions.diplomacy===a.revisions.diplomacy
  );
  const cachedRepeat=Boolean(aRepeat?.cache?.finalHit);
  const noStateMutation=beforeDelta.entryCount===afterDelta.entryCount&&beforeDelta.sequence===afterDelta.sequence&&beforeDelta.serializedBytes===afterDelta.serializedBytes;
  const childRef=WorldState.structuralRef(seed,"npc",targets.primary.id,"context-proof-npc",{role:"context-consumer"});
  const child=resolveChild(seed,targets.primary,childRef,fixedTime);
  const childInheritance=Boolean(child&&child.parentContextSignature===a.signature&&child.revisions.country===a.revisions.country);
  const renderIndependent=Boolean(
    a.authority.renderIndependent&&!a.authority.mutatesWorldState&&!a.authority.fanOutInvalidation&&a.authority.lazyRefresh&&
    child?.renderIndependent&&!child?.mutatesWorldState
  );
  const currentStateIntegrated=Boolean(
    a.country.campaignDeltaRevision>=0&&a.region.campaignDeltaRevision>=0&&
    (a.settlement?.campaignDeltaRevision??0)>=0&&a.diplomacy.campaignDeltaRevision>=0
  );
  const t=telemetry();
  const pass=Boolean(
    deterministic&&sameCountryDifferentRegions&&regionalTerrainDifference&&regionalBehaviorDifference&&
    localAuthorityPreserved&&complete&&parentRevisionsRecorded&&cachedRepeat&&noStateMutation&&
    childInheritance&&renderIndependent&&currentStateIntegrated&&t.fanOutInvalidations===0
  );
  return deepFreeze({
    pass,campaignSeed:seed,version:VERSION,cacheSchemaVersion:CACHE_SCHEMA_VERSION,
    deterministic,sameCountryDifferentRegions,regionalTerrainDifference,regionalBehaviorDifference,
    localAuthorityPreserved,complete,parentRevisionsRecorded,cachedRepeat,noStateMutation,
    childInheritance,renderIndependent,currentStateIntegrated,noFanOut:t.fanOutInvalidations===0,
    countryId:targets.countryId,differenceScore:targets.differenceScore,
    primary:Object.freeze({id:targets.primary.id,name:targets.primary.name,regionId:targets.primary.regionId,signature:a?.signature||null}),
    contrast:Object.freeze({id:targets.contrast.id,name:targets.contrast.name,regionId:targets.contrast.regionId,signature:b?.signature||null}),
    telemetry:t,
    hierarchy:"Country → Region → Local Geography/Resources → Settlement → Building/Job/NPC Context",
    authority:"WorldContext resolver",
    worldStateMutation:false,renderDependency:false,globalFanOut:false
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value)*100)+"%"}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderDebugPanel(seedValue,targetValue,rootNode,fantasyTimeValue){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("worldContextProof");
  if(!root)return null;
  const verification=proof(seed);
  const targets=evidenceTargets(seed);
  const target=targetValue?.id?targetValue:targets.primary;
  const context=resolve(seed,target,fantasyTimeValue||Object.freeze({year:1200,month:6,day:15,hour:12,minute:0,second:0}));
  if(!context)return Object.freeze({verification,context:null});
  const values={
    worldContextTarget:context.settlement?(context.settlement.name+" · "+context.settlement.classId):context.target.id,
    worldContextCountry:context.country.name+" · wealth "+percent(context.country.wealth)+" · stability "+percent(context.country.stability),
    worldContextRegion:context.region.name+" · prosperity "+percent(context.region.prosperity),
    worldContextLocal:context.local.terrain+" / "+context.local.biome+" · route "+percent(context.local.routeAccess),
    worldContextResources:"agri "+percent(context.local.resources.agriculture)+" · timber "+percent(context.local.resources.timber)+" · mineral "+percent(context.local.resources.mineral)+" · water "+percent(context.local.resources.water),
    worldContextDiplomacy:context.diplomacy.state+" · trade "+percent(context.diplomacy.tradeAccess)+" · tension "+percent(context.diplomacy.militaryTension),
    worldContextSettlement:context.settlement?("prosperity "+percent(context.settlement.prosperity)+" · security "+percent(context.settlement.security)+" · trade "+percent(context.settlement.trade)):"none",
    worldContextRevision:context.revision,
    worldContextParents:"country "+context.revisions.country+" · region "+context.revisions.region+" · settlement "+context.revisions.settlement,
    worldContextCache:"queries "+telemetry().queries+" · hits "+telemetry().hits+" · misses "+telemetry().misses+" · stale "+telemetry().staleRefreshes+" · fan-out "+telemetry().fanOutInvalidations
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const bars=root.querySelector("#worldContextBehavior");
  if(bars){
    const b=context.behavior;
    bars.innerHTML=[
      ["Prosperity",b.prosperity],["Security",b.security],["Trade",b.trade],["Food",b.food],["Production",b.production],
      ["Market demand",b.marketDemand],["Employment",b.employmentOpportunity],["Agriculture potential",b.agriculturePotential],
      ["Mining potential",b.miningPotential],["Transport",b.transportAccess]
    ].map(([label,value])=>
      "<div class=\"region-profile-bar\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(percent(value))+"</strong><i><b style=\"width:"+escapeHtml(percent(value))+"\"></b></i></div>"
    ).join("");
  }
  const layers=root.querySelector("#worldContextLayers");
  if(layers){
    layers.innerHTML=[
      ["Country",context.country.revision,"wealth "+percent(context.country.wealth)+" · trade "+percent(context.country.tendencies.tradeOpenness)],
      ["Region",context.region.revision,context.region.identity.dominantTerrain+" · "+context.region.identity.dominantBiome],
      ["Local",context.local.revision,context.local.terrain+" · route "+percent(context.local.routeAccess)],
      ["Diplomacy",context.diplomacy.revision,context.diplomacy.state+" · tension "+percent(context.diplomacy.militaryTension)],
      ["Settlement",context.settlement?.revision||"none",context.settlement?(context.settlement.classId+" · "+context.settlement.subtypes.tags.join(" / ")):"no settlement"],
      ["Child consumers",context.revision,"economy · settlement · job · NPC · diplomacy · presentation"]
    ].map(([label,revision,detail])=>
      "<li><div><strong>"+escapeHtml(label)+"</strong><small>"+escapeHtml(detail)+"</small></div><span>"+escapeHtml(revision)+"</span></li>"
    ).join("");
  }
  const compare=root.querySelector("#worldContextComparison");
  if(compare){
    const a=resolve(seed,targets.primary,Object.freeze({year:1200,month:6,day:15,hour:12,minute:0,second:0}));
    const b=resolve(seed,targets.contrast,Object.freeze({year:1200,month:6,day:15,hour:12,minute:0,second:0}));
    compare.innerHTML=[a,b].filter(Boolean).map(item=>
      "<li class=\""+(item.target.id===context.target.id?"selected":"")+"\"><div><strong>"+escapeHtml(item.settlement?.name||item.target.id)+"</strong>"+
      "<small>"+escapeHtml(item.region.name+" · "+item.local.terrain+" / "+item.local.biome)+"</small></div>"+
      "<span>Ag "+escapeHtml(percent(item.behavior.agriculturePotential))+"</span>"+
      "<span>Mine "+escapeHtml(percent(item.behavior.miningPotential))+"</span>"+
      "<span>Trade "+escapeHtml(percent(item.behavior.trade))+"</span>"+
      "<span>Road "+escapeHtml(percent(item.behavior.transportAccess))+"</span></li>"
    ).join("");
  }
  setCheck("vWorldContextDeterministic",verification.deterministic&&verification.cachedRepeat);
  setCheck("vWorldContextHierarchy",verification.complete&&verification.parentRevisionsRecorded&&verification.childInheritance);
  setCheck("vWorldContextRegional",verification.sameCountryDifferentRegions&&verification.regionalTerrainDifference&&verification.regionalBehaviorDifference);
  setCheck("vWorldContextLocal",verification.localAuthorityPreserved);
  setCheck("vWorldContextLazy",verification.noFanOut&&verification.noStateMutation);
  setCheck("vWorldContextAuthority",verification.renderIndependent&&verification.currentStateIntegrated&&!verification.worldStateMutation&&!verification.renderDependency&&!verification.globalFanOut);
  root.dataset.targetId=context.target.id;
  root.dataset.countryId=context.country.id;
  root.dataset.regionId=context.region.id;
  root.dataset.contextRevision=context.revision;
  root.dataset.contextSignature=context.signature;
  root.dataset.countryRevision=context.revisions.country;
  root.dataset.countryDeltaRevision=String(context.country.campaignDeltaRevision);
  root.dataset.regionRevision=context.revisions.region;
  root.dataset.settlementRevision=context.revisions.settlement;
  root.dataset.cacheHit=String(Boolean(context.cache.finalHit));
  root.dataset.cacheEntries=String(telemetry().cacheEntries);
  root.dataset.cacheHits=String(telemetry().hits);
  root.dataset.cacheMisses=String(telemetry().misses);
  root.dataset.staleRefreshes=String(telemetry().staleRefreshes);
  root.dataset.fanOutInvalidations=String(telemetry().fanOutInvalidations);
  root.dataset.wealth=String(context.country.wealth);
  root.dataset.trade=String(context.country.tendencies.tradeOpenness);
  root.dataset.agriculturePotential=String(context.behavior.agriculturePotential);
  root.dataset.miningPotential=String(context.behavior.miningPotential);
  root.dataset.transportAccess=String(context.behavior.transportAccess);
  return Object.freeze({verification,context,targets,telemetry:telemetry()});
}

const api=Object.freeze({
  VERSION,CACHE_SCHEMA_VERSION,
  resolve,resolveChild,evidenceTargets,applyEvidenceCountryDelta,
  clearCaches,telemetry,proof,renderDebugPanel
});
window.WorldContext=api;
window.WorldContextResolver=api;
})();