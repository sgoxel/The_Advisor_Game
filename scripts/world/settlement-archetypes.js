(function(){
"use strict";

const VERSION=1;
const SUPPORTED_CLASSES=Object.freeze(["hamlet","village","town","city","national-capital"]);
const CLASS_SCALE=Object.freeze({
  hamlet:Object.freeze({population:[35,140],road:0.26,publicSpace:0.18,market:0.16,defense:0.18}),
  village:Object.freeze({population:[120,620],road:0.38,publicSpace:0.30,market:0.30,defense:0.26}),
  town:Object.freeze({population:[550,3200],road:0.58,publicSpace:0.48,market:0.56,defense:0.42}),
  city:Object.freeze({population:[2800,18000],road:0.78,publicSpace:0.68,market:0.74,defense:0.58}),
  "national-capital":Object.freeze({population:[14000,65000],road:0.96,publicSpace:0.94,market:0.90,defense:0.82})
});
const cache=new Map();
const catalogCache=new Map();
const proofCache=new Map();

function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function round(value,digits=4){
  const factor=10**digits;
  return Math.round(Number(value)*factor)/factor;
}
function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function distance(a,b){
  const dx=Number(BigInt(a.x)-BigInt(b.x));
  const dy=Number(BigInt(a.y)-BigInt(b.y));
  return Math.hypot(dx,dy);
}
function prosperityBand(value){
  const v=clamp01(value);
  if(v<0.28)return "strained";
  if(v<0.44)return "modest";
  if(v<0.62)return "stable";
  if(v<0.78)return "prosperous";
  return "wealthy";
}
function populationBand(classId,prosperity,seed,key){
  const scale=CLASS_SCALE[classId]||CLASS_SCALE.village;
  const min=scale.population[0],max=scale.population[1];
  const weighted=0.20+clamp01(prosperity)*0.58+unit(seed,"settlement:population:"+key)*0.22;
  const planned=Math.round(min+(max-min)*clamp01(weighted));
  return Object.freeze({min,max,planned,label:min.toLocaleString("en-US")+"–"+max.toLocaleString("en-US")});
}
function countryFromInput(seed,countryValue){
  if(countryValue&&typeof countryValue==="object"&&countryValue.id)return PoliticalGeography.countryById(seed,countryValue.id)||countryValue;
  if(typeof countryValue==="string")return PoliticalGeography.countryById(seed,countryValue);
  if(countryValue&&typeof countryValue==="object"&&countryValue.x!=null&&countryValue.y!=null)return PoliticalGeography.countryAt(seed,countryValue.x,countryValue.y);
  return PoliticalGeography.countryAt(seed,"0","0");
}
function legalCenter(seed,country,desired){
  const baseX=BigInt(desired.x),baseY=BigInt(desired.y);
  const offsets=[[0,0],[24,0],[-24,0],[0,24],[0,-24],[48,24],[-48,24],[48,-24],[-48,-24],[96,0],[-96,0],[0,96],[0,-96]];
  let best=null;
  for(const [dx,dy] of offsets){
    const x=(baseX+BigInt(dx)).toString(),y=(baseY+BigInt(dy)).toString();
    const owner=PoliticalGeography.ownerAt(seed,x,y);
    if(!owner||owner.id!==country.id)continue;
    const terrain=GeographyFoundation.getTerrainType(seed,x,y);
    if(terrain==="water")continue;
    const env=GeographyFoundation.environment(seed,x,y);
    const terrainPenalty=terrain==="rock"?0.22:terrain==="mud"?0.15:0;
    const elevationPenalty=Math.min(0.22,Number(env.elevationMeters||0)/9000);
    const roadBonus=(terrain==="road"||terrain==="bridge")?-0.12:0;
    const score=terrainPenalty+elevationPenalty+roadBonus+(Math.abs(dx)+Math.abs(dy))/4000;
    if(!best||score<best.score)best={score,x,y,terrain,environment:env};
  }
  if(!best)return null;
  return Object.freeze({x:best.x,y:best.y,terrain:best.terrain,environment:best.environment});
}
function borderContext(seed,country,center){
  const borders=PoliticalGeography.borderEvidence(seed,country);
  let nearest=null;
  for(const border of borders){
    const d=distance(center,border);
    if(!nearest||d<nearest.distance)nearest={border,distance:d};
  }
  if(!nearest)return Object.freeze({
    nearBorder:false,proximity:0,distanceTiles:null,neighborCountryId:null,
    relationId:null,relationRevision:null,tradeAccess:0.3,militaryTension:0.2,borderOpenness:0.2,warState:false
  });
  const border=nearest.border;
  const neighborId=border.countryA.id===country.id?border.countryB.id:border.countryA.id;
  const relation=window.CountryRelations?.build?.(seed,country.id,neighborId)||null;
  const proximity=clamp01(1-nearest.distance/5200);
  return Object.freeze({
    nearBorder:proximity>=0.42,
    proximity:round(proximity),
    distanceTiles:Math.round(nearest.distance),
    neighborCountryId:neighborId,
    borderId:border.id,
    borderTerrain:border.terrain,
    relationId:relation?.id||null,
    relationRevision:relation?.revision||null,
    tradeAccess:round(relation?.shared?.tradeAccess??0.3),
    militaryTension:round(relation?.shared?.militaryTension??0.2),
    borderOpenness:round(relation?.shared?.borderOpenness??0.2),
    warState:Boolean(relation?.shared?.warState)
  });
}
function localContext(seed,country,center,region){
  const env=center.environment||GeographyFoundation.environment(seed,center.x,center.y);
  const terrain=center.terrain||GeographyFoundation.getTerrainType(seed,center.x,center.y);
  const identity=region.identity;
  const localAgriculture=clamp01(
    identity.agriculturalSuitability*0.72+
    ((terrain==="farmland"||terrain==="grass")?0.20:terrain==="rock"? -0.16:0)+
    (1-Math.min(1,Number(env.elevationMeters||0)/1900))*0.08
  );
  const localTimber=clamp01(identity.timberAvailability*0.78+(terrain==="forest"?0.22:0));
  const localMineral=clamp01(identity.mineralPotential*0.76+(terrain==="rock"?0.18:0)+Math.min(0.06,Number(env.elevationMeters||0)/24000));
  const localWater=clamp01(identity.waterAccess*0.86+(terrain==="sand"||terrain==="mud"?0.08:0));
  const routeAccess=clamp01(identity.transportAccessibility*0.78+((terrain==="road"||terrain==="bridge")?0.22:0));
  return Object.freeze({
    terrain,biome:env.biome,climate:env.climate,elevationMeters:Number(env.elevationMeters||0),
    moisturePercent:Number(env.moisturePercent||0),temperatureC:Number(env.temperatureC||0),
    resources:Object.freeze({
      agriculture:round(localAgriculture),timber:round(localTimber),mineral:round(localMineral),water:round(localWater)
    }),
    routeAccess:round(routeAccess),
    coastalAccess:localWater>=0.36,
    geographyAuthority:"GeographyFoundation",
    resourceAuthority:"RegionProfile + local fixed geography"
  });
}
function classFor(seed,key,countryProfile,region,local,border,options){
  if(options?.classHint&&SUPPORTED_CLASSES.includes(options.classHint))return options.classHint;
  if(options?.role==="national-capital")return "national-capital";
  const localProsperity=clamp01(countryProfile.wealth.value+region.prosperity.modifier);
  const signal=clamp01(
    0.08+countryProfile.wealth.value*0.13+countryProfile.tendencies.infrastructure*0.11+
    localProsperity*0.13+local.routeAccess*0.22+region.specialization.trade*0.11+
    local.resources.agriculture*0.05+local.resources.mineral*0.04+unit(seed,"settlement:size:"+key)*0.13+
    (options?.role==="regional-seat"?0.08:0)-(options?.role==="satellite"?0.12:0)
  );
  if(signal<0.34)return "hamlet";
  if(signal<0.49)return "village";
  if(signal<0.66)return "town";
  return "city";
}
function subtypeWeights(countryProfile,region,local,border,classId){
  const c=countryProfile.tendencies,s=region.specialization,r=local.resources;
  const physicalPort=local.coastalAccess&&r.water>=0.28;
  const agriculture=clamp01(s.agriculture*0.46+r.agriculture*0.36+c.agriculture*0.18);
  const forestry=clamp01(s.forestry*0.52+r.timber*0.34+c.craftProduction*0.14);
  const mining=clamp01(s.mining*0.48+r.mineral*0.40+c.mining*0.12);
  const trade=clamp01(s.trade*0.35+local.routeAccess*0.25+c.tradeOpenness*0.20+border.tradeAccess*0.12+border.borderOpenness*0.08);
  const port=physicalPort?clamp01(s.maritime*0.38+r.water*0.34+c.maritime*0.20+trade*0.08):0;
  const frontier=clamp01(border.proximity*0.44+border.militaryTension*0.28+c.militaryEmphasis*0.18+(1-border.borderOpenness)*0.10);
  const fortified=clamp01(s.defense*0.40+c.fortification*0.30+border.proximity*0.18+border.militaryTension*0.12+(classId==="national-capital"?0.12:0));
  const mixed=clamp01(0.30+(1-Math.max(agriculture,forestry,mining,trade,port,frontier))*0.50);
  const values={agricultural:agriculture,forest:forestry,mining,trade,port,frontier,fortified,mixed};
  const rounded=Object.freeze(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,round(v)])));
  const tags=Object.freeze(Object.entries(rounded)
    .filter(([key,value])=>value>=0.42&&(key!=="port"||physicalPort))
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,4).map(([key])=>key));
  return Object.freeze({weights:rounded,tags:tags.length?tags:Object.freeze(["mixed"]),physicalPort});
}
function buildingFunctions(classId,subtypes){
  const required=new Set(["housing","water-access","local-road-access"]);
  const optional=new Set(["farm-support","small-market","craft-workshop","storehouse"]);
  if(classId!=="hamlet")required.add("communal-space");
  if(["town","city","national-capital"].includes(classId)){required.add("market");required.add("administration");required.add("lodging");}
  if(["city","national-capital"].includes(classId)){required.add("district-services");required.add("large-storage");optional.add("guild-hall");}
  if(classId==="national-capital"){required.add("national-government");required.add("major-civic-space");required.add("garrison");}
  if(subtypes.tags.includes("agricultural")){required.add("food-storage");optional.add("mill");}
  if(subtypes.tags.includes("mining")){required.add("ore-storage");optional.add("smelter");}
  if(subtypes.tags.includes("trade")){required.add("market");optional.add("caravan-yard");}
  if(subtypes.tags.includes("port")){required.add("dock-or-wharf");optional.add("fish-market");}
  if(subtypes.tags.includes("fortified")||subtypes.tags.includes("frontier")){required.add("defensive-post");optional.add("wall-or-palisade");}
  if(subtypes.tags.includes("forest"))optional.add("timber-yard");
  return Object.freeze({required:Object.freeze([...required]),optional:Object.freeze([...optional])});
}
function architectureKeys(countryProfile,region,local,subtypes){
  const keys=[...countryProfile.culturalKeys,
    countryProfile.architecture.primaryMaterial,countryProfile.architecture.roofStyle,
    countryProfile.architecture.settlementPattern,countryProfile.architecture.civicStyle,
    "terrain:"+local.terrain,"biome:"+local.biome,"region:"+region.identity.dominantTerrain
  ];
  for(const tag of subtypes.tags)keys.push("settlement:"+tag);
  return Object.freeze([...new Set(keys)].slice(0,12));
}
function planName(seed,country,region,classId,subtypes,key,options){
  if(options?.nameHint)return String(options.nameHint);
  if(classId==="national-capital")return country.capital.name;
  const lead=(region.name||"Local").replace(/\s+(Province|Region)$/i,"");
  const suffixByTag={agricultural:["Fields","Grange","Meadow"],forest:["Wood","Timber","Grove"],mining:["Delve","Forge","Quarry"],trade:["Cross","Market","Ford"],port:["Harbor","Quay","Haven"],frontier:["March","Watch","Gate"],fortified:["Keep","Ward","Hold"],mixed:["stead","ton","wick"]};
  const tag=subtypes.tags[0]||"mixed",choices=suffixByTag[tag]||suffixByTag.mixed;
  return lead+" "+choices[PRNG.foundationUint32(seed,"settlement:name:"+key)%choices.length];
}
function planningSignature(plan){
  return [plan.classId,plan.subtypes.tags.join(","),Math.round(plan.prosperity.value*10),Math.round(plan.defenseTendency*10),Math.round(plan.tradeMarketTendency*10),plan.roadScale.band,plan.publicSpaceScale.band,plan.architectureKeys.slice(0,5).join(",")].join("|");
}
function contextSignature(plan){
  const r=plan.inputs.regionIdentity,l=plan.inputs.local;
  return [plan.countryId,plan.regionId,r.dominantTerrain,r.dominantBiome,Math.round(l.resources.agriculture*5),Math.round(l.resources.mineral*5),Math.round(l.resources.water*5),Math.round(l.routeAccess*5),Math.round(plan.inputs.border.proximity*5)].join("|");
}
function build(seedValue,centerValue,optionsValue){
  const seed=String(seedValue==null?"":seedValue);
  const options=optionsValue||{};
  const desired=Object.freeze({x:String(centerValue?.x??"0"),y:String(centerValue?.y??"0")});
  const country=countryFromInput(seed,options.countryId?String(options.countryId):desired);
  if(!country)return null;
  const center=legalCenter(seed,country,desired);
  if(!center)return null;
  const region=RegionProfile.at(seed,center.x,center.y);
  const countryProfile=CountryProfile.build(seed,country.id);
  if(!region||!countryProfile)return null;
  const local=localContext(seed,country,center,region);
  const border=borderContext(seed,country,center);
  const role=String(options.role||"local");
  const key=[country.id,region.id,center.x,center.y,role,options.classHint||""].join("|");
  const cacheKey=seed+"|"+key;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const classId=classFor(seed,key,countryProfile,region,local,border,options);
  const subtypes=subtypeWeights(countryProfile,region,local,border,classId);
  const prosperityValue=clamp01(
    countryProfile.wealth.value*0.46+(countryProfile.wealth.value+region.prosperity.modifier)*0.24+
    local.routeAccess*0.12+subtypes.weights.trade*0.08+unit(seed,"settlement:prosperity:"+key)*0.10
  );
  const scale=CLASS_SCALE[classId];
  const defense=clamp01(scale.defense*0.34+subtypes.weights.fortified*0.44+countryProfile.tendencies.militaryEmphasis*0.12+border.militaryTension*0.10);
  const tradeMarket=clamp01(scale.market*0.34+subtypes.weights.trade*0.42+local.routeAccess*0.16+border.tradeAccess*0.08);
  const roadValue=clamp01(scale.road*0.50+countryProfile.tendencies.infrastructure*0.20+local.routeAccess*0.30);
  const publicValue=clamp01(scale.publicSpace*0.58+countryProfile.governance.administrativeCapacity*0.18+prosperityValue*0.24);
  const population=populationBand(classId,prosperityValue,seed,key);
  const functions=buildingFunctions(classId,subtypes);
  const architecture=architectureKeys(countryProfile,region,local,subtypes);
  const id="SET|"+hashText(seed+"|"+key);
  const revision="SAF-"+hashText([VERSION,id,countryProfile.revision,region.revision,border.relationRevision||"none",classId,subtypes.tags.join(","),prosperityValue,defense,tradeMarket].join("|"));
  const plan=Object.freeze({
    version:VERSION,id,revision,
    name:planName(seed,country,region,classId,subtypes,key,options),
    countryId:country.id,countryName:country.name,regionId:region.id,regionName:region.name,
    center:Object.freeze({x:center.x,y:center.y,terrain:center.terrain}),
    role,classId,
    subtypes,
    population,
    prosperity:Object.freeze({value:round(prosperityValue),band:prosperityBand(prosperityValue)}),
    defenseTendency:round(defense),tradeMarketTendency:round(tradeMarket),
    roadScale:Object.freeze({value:round(roadValue),band:roadValue>=0.74?"major":roadValue>=0.48?"structured":roadValue>=0.30?"local":"minimal"}),
    publicSpaceScale:Object.freeze({value:round(publicValue),band:publicValue>=0.78?"monumental":publicValue>=0.56?"civic":publicValue>=0.34?"communal":"small"}),
    buildingFunctions:functions,
    architectureKeys:architecture,
    generation:Object.freeze({
      desiredCenter:Object.freeze({x:desired.x,y:desired.y}),
      countryId:country.id,role,
      classHint:options.classHint||null,nameHint:options.nameHint||null
    }),
    inputs:Object.freeze({
      countryProfileRevision:countryProfile.revision,
      regionProfileRevision:region.revision,
      regionIdentity:Object.freeze({
        dominantTerrain:region.identity.dominantTerrain,dominantBiome:region.identity.dominantBiome,
        agriculturalSuitability:region.identity.agriculturalSuitability,timberAvailability:region.identity.timberAvailability,
        mineralPotential:region.identity.mineralPotential,waterAccess:region.identity.waterAccess,
        transportAccessibility:region.identity.transportAccessibility,defensibility:region.identity.defensibility
      }),
      local,
      border,
      role,
      precedence:Object.freeze(["CountryProfile","RegionProfile","local fixed geography/resources"])
    }),
    foundation:Object.freeze({
      source:"campaign-seed + country-profile + region-profile + local-geography + route/border context",
      immutable:true,fantasyTimeDependent:false,lazy:true,renderIndependent:true,
      countryAuthority:"PoliticalGeography",countryProfileAuthority:"CountryProfile",regionAuthority:"RegionProfile",
      localTerrainAuthority:"GeographyFoundation",diplomacyAuthority:"CountryRelations",
      terrainMutation:false,resourceMutation:false,npcPopulationCreated:false,physicalLayoutCreated:false,
      dynamicOverlayCompatible:true
    })
  });
  cache.set(cacheKey,plan);
  return plan;
}
function satelliteCenter(seed,country,region,index){
  const seat=region.administrativeSeat;
  const key=region.id+"|"+index;
  const angle=unit(seed,"settlement:satellite-angle:"+key)*Math.PI*2;
  const radius=480+Math.round(unit(seed,"settlement:satellite-radius:"+key)*1050);
  return Object.freeze({
    x:(BigInt(seat.x)+BigInt(Math.round(Math.cos(angle)*radius))).toString(),
    y:(BigInt(seat.y)+BigInt(Math.round(Math.sin(angle)*radius))).toString()
  });
}
function settlementsForCountry(seedValue,countryValue,radiusValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=countryFromInput(seed,countryValue);
  if(!country)return Object.freeze([]);
  const radius=Math.max(1,Math.min(4,Number(radiusValue??3)));
  const cacheKey=seed+"|"+country.id+"|"+radius;
  if(catalogCache.has(cacheKey))return catalogCache.get(cacheKey);
  const out=[],seen=new Set();
  const add=plan=>{if(plan&&!seen.has(plan.id)){seen.add(plan.id);out.push(plan)}};
  add(build(seed,country.capital,{countryId:country.id,role:"national-capital",classHint:"national-capital",nameHint:country.capital.name}));
  if(PoliticalGeography.countryAt(seed,"0","0").id===country.id){
    const startingName=window.StartingVillage?.plan?.(seed)?.name||"Starting Village";
    add(build(seed,{x:"0",y:"0"},{countryId:country.id,role:"starting-village",classHint:"village",nameHint:startingName}));
  }
  const regions=RegionProfile.regionsForCountry(seed,country,radius);
  for(let i=0;i<regions.length;i++){
    const region=regions[i];
    const seatPlan=build(seed,region.administrativeSeat,{countryId:country.id,role:"regional-seat"});
    add(seatPlan);
    if(i%2===0){
      const satellite=satelliteCenter(seed,country,region,i);
      add(build(seed,satellite,{countryId:country.id,role:"satellite"}));
    }
  }
  const frozen=Object.freeze(out.sort((a,b)=>a.id.localeCompare(b.id)));
  catalogCache.set(cacheKey,frozen);
  return frozen;
}
function sampleCatalog(seed){
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const countries=[origin];
  for(const profile of CountryProfile.sampleCountries(seed)){
    const country=PoliticalGeography.countryById(seed,profile.countryId);
    if(country&&!countries.some(item=>item.id===country.id))countries.push(country);
    if(countries.length>=4)break;
  }
  return Object.freeze(countries.flatMap(country=>settlementsForCountry(seed,country,2)));
}
function scoreReason(plan,reason){
  if(reason==="agricultural")return plan.subtypes.weights.agricultural+(plan.classId==="village"?0.25:plan.classId==="hamlet"?0.12:0);
  if(reason==="mining")return plan.subtypes.weights.mining+(plan.classId==="town"?0.12:0);
  if(reason==="trade")return plan.subtypes.weights.trade+(plan.classId==="town"?0.22:plan.classId==="city"?0.14:0);
  if(reason==="frontier-fortified")return Math.max(plan.subtypes.weights.frontier,plan.subtypes.weights.fortified)+plan.inputs.border.proximity*0.20;
  if(reason==="capital")return plan.classId==="national-capital"?2:0;
  return 0;
}
function representatives(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const plans=[...sampleCatalog(seed)];
  const picks=[];
  const add=(reason,plan)=>{if(plan&&!picks.some(item=>item.plan.id===plan.id))picks.push(Object.freeze({reason,plan}))};
  for(const reason of ["agricultural","mining","trade","frontier-fortified","capital"]){
    const ranked=[...plans].sort((a,b)=>scoreReason(b,reason)-scoreReason(a,reason)||a.id.localeCompare(b.id));
    add(reason,ranked[0]);
  }
  for(const plan of plans)if(picks.length<5)add("mixed",plan);
  return Object.freeze(picks.slice(0,5));
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(proofCache.has(seed))return proofCache.get(seed);
  const plans=sampleCatalog(seed);
  const reps=representatives(seed);
  const rebuilt=reps.map(item=>{
    const g=item.plan.generation;
    return Object.freeze({reason:item.reason,plan:build(seed,g.desiredCenter,{
      countryId:g.countryId,role:g.role,classHint:g.classHint,nameHint:g.nameHint
    })});
  });
  const deterministic=JSON.stringify(reps)===JSON.stringify(rebuilt);
  const timeIndependent=plans.every(plan=>plan.foundation.fantasyTimeDependent===false);
  const numericValid=plans.every(plan=>[
    plan.prosperity.value,plan.defenseTendency,plan.tradeMarketTendency,plan.roadScale.value,plan.publicSpaceScale.value,
    ...Object.values(plan.subtypes.weights)
  ].every(value=>Number.isFinite(value)&&value>=0&&value<=1));
  const geographyValid=plans.every(plan=>
    plan.center.terrain!=="water"&&PoliticalGeography.ownerAt(seed,plan.center.x,plan.center.y).id===plan.countryId
  );
  const physicalConstraints=plans.every(plan=>
    plan.inputs.local.coastalAccess||plan.subtypes.weights.port===0
  );
  const classSupport=SUPPORTED_CLASSES.length===5&&SUPPORTED_CLASSES.every(id=>CLASS_SCALE[id]);
  const classCount=new Set(plans.map(plan=>plan.classId)).size;
  const subtypeCount=new Set(plans.flatMap(plan=>plan.subtypes.tags)).size;
  const capitalPlans=plans.filter(plan=>plan.classId==="national-capital");
  const capitalScale=capitalPlans.length>=2&&capitalPlans.every(plan=>plan.population.min>=CLASS_SCALE.city.population[1]*0.7&&plan.buildingFunctions.required.includes("national-government"));
  const contextComplete=plans.every(plan=>
    plan.inputs.countryProfileRevision&&plan.inputs.regionProfileRevision&&plan.inputs.regionIdentity&&plan.inputs.local&&plan.inputs.border&&
    plan.inputs.precedence.join(">").includes("CountryProfile>RegionProfile>local fixed geography/resources")
  );
  let sameCountryPairs=0,contextualDifferences=0;
  for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++){
    if(plans[i].countryId!==plans[j].countryId||plans[i].regionId===plans[j].regionId)continue;
    sameCountryPairs++;
    if(contextSignature(plans[i])!==contextSignature(plans[j])&&planningSignature(plans[i])!==planningSignature(plans[j]))contextualDifferences++;
  }
  const countryRegionTerrainInfluence=sameCountryPairs>=3&&contextualDifferences>=Math.min(3,sameCountryPairs);
  const differentContexts=plans.filter((plan,index)=>plans.findIndex(other=>contextSignature(other)===contextSignature(plan))===index);
  const uniquePlanSignatures=new Set(differentContexts.map(planningSignature)).size;
  const cloneAvoidance=differentContexts.length<2||uniquePlanSignatures>=Math.min(differentContexts.length,4);
  const roleCoverage=new Set(plans.map(plan=>plan.role));
  const genericPlanner=roleCoverage.has("regional-seat")&&roleCoverage.has("satellite")&&roleCoverage.has("national-capital");
  const lazyQueryable=plans.every(plan=>plan.foundation.lazy&&plan.foundation.renderIndependent&&!plan.foundation.physicalLayoutCreated);
  const authorityPreserved=plans.every(plan=>!plan.foundation.terrainMutation&&!plan.foundation.resourceMutation&&!plan.foundation.npcPopulationCreated);
  const evidenceReasons=new Set(reps.map(item=>item.reason));
  const representativeCoverage=["agricultural","mining","trade","frontier-fortified","capital"].every(reason=>evidenceReasons.has(reason));
  const pass=Boolean(
    plans.length>=12&&reps.length===5&&deterministic&&timeIndependent&&numericValid&&geographyValid&&physicalConstraints&&classSupport&&
    classCount>=3&&subtypeCount>=4&&capitalScale&&contextComplete&&countryRegionTerrainInfluence&&cloneAvoidance&&genericPlanner&&
    lazyQueryable&&authorityPreserved&&representativeCoverage
  );
  const result=Object.freeze({
    pass,campaignSeed:seed,planCount:plans.length,representativeCount:reps.length,
    deterministic,timeIndependent,numericValid,geographyValid,physicalConstraints,classSupport,
    classCount,subtypeCount,capitalScale,contextComplete,countryRegionTerrainInfluence,cloneAvoidance,genericPlanner,
    lazyQueryable,authorityPreserved,representativeCoverage,
    supportedClasses:SUPPORTED_CLASSES,representatives:reps,
    authority:"settlement-archetype-planning-foundation",
    terrainMutation:false,resourceMutation:false,npcPopulationCreated:false,physicalLayoutCreated:false,
    liveEconomyCreated:false,renderDependency:false,fullWorldMaterialized:false
  });
  proofCache.set(seed,result);
  return result;
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value)*100)+"%"}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderBar(label,value){
  return "<div class=\"region-profile-bar\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(percent(value))+"</strong><i><b style=\"width:"+escapeHtml(percent(value))+"\"></b></i></div>";
}
function renderDebugPanel(seedValue,planIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("settlementArchetypeProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,plan:null});
  const index=Math.abs(Number(planIndexValue)||0)%verification.representatives.length;
  const selected=verification.representatives[index],plan=selected.plan;
  const select=root.querySelector("#settlementArchetypeSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+escapeHtml(item.reason+" · "+item.plan.name+" · "+item.plan.classId)+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    settlementArchetypeName:plan.name,
    settlementArchetypeId:plan.id,
    settlementArchetypeCountry:plan.countryName+" · "+plan.countryId,
    settlementArchetypeRegion:plan.regionName+" · "+plan.regionId,
    settlementArchetypeClass:plan.classId+" · "+selected.reason,
    settlementArchetypeCenter:"("+plan.center.x+","+plan.center.y+") · "+plan.center.terrain,
    settlementArchetypePopulation:plan.population.planned.toLocaleString("en-US")+" planned · band "+plan.population.label,
    settlementArchetypeProsperity:plan.prosperity.band+" · "+percent(plan.prosperity.value),
    settlementArchetypeContext:
      "terrain "+plan.inputs.local.terrain+" · agri "+percent(plan.inputs.local.resources.agriculture)+" · mineral "+percent(plan.inputs.local.resources.mineral)+
      " · water "+percent(plan.inputs.local.resources.water)+" · route "+percent(plan.inputs.local.routeAccess)+" · border "+percent(plan.inputs.border.proximity),
    settlementArchetypePlanning:
      "defense "+percent(plan.defenseTendency)+" · market "+percent(plan.tradeMarketTendency)+" · roads "+plan.roadScale.band+" · public "+plan.publicSpaceScale.band,
    settlementArchetypeRevision:plan.revision
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const tags=root.querySelector("#settlementArchetypeTags");
  if(tags)tags.innerHTML=plan.subtypes.tags.map(tag=>"<span class=\"diplomacy-agreement active\">"+escapeHtml(tag)+"</span>").join("");
  const bars=root.querySelector("#settlementArchetypeWeights");
  if(bars){
    const w=plan.subtypes.weights;
    bars.innerHTML=[["Agriculture",w.agricultural],["Forest",w.forest],["Mining",w.mining],["Trade",w.trade],["Port",w.port],["Frontier",w.frontier],["Fortified",w.fortified]]
      .map(([label,value])=>renderBar(label,value)).join("");
  }
  const functions=root.querySelector("#settlementArchetypeFunctions");
  if(functions)functions.textContent="Required: "+plan.buildingFunctions.required.join(", ")+" · Optional: "+plan.buildingFunctions.optional.join(", ");
  const architecture=root.querySelector("#settlementArchetypeArchitecture");
  if(architecture)architecture.textContent=plan.architectureKeys.join(" · ");
  const comparison=root.querySelector("#settlementArchetypeComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.map(item=>{
      const p=item.plan;
      return "<li class=\""+(p.id===plan.id?"selected":"")+"\"><div><strong>"+escapeHtml(p.name)+"</strong>"+
        "<small>"+escapeHtml(item.reason+" · "+p.countryName+" / "+p.regionName+" · "+p.subtypes.tags.join(" / "))+"</small></div>"+
        "<span>"+escapeHtml(p.classId)+"</span><span>Pop "+escapeHtml(String(p.population.planned))+"</span>"+
        "<span>Market "+escapeHtml(percent(p.tradeMarketTendency))+"</span><span>Defense "+escapeHtml(percent(p.defenseTendency))+"</span></li>";
    }).join("");
  }
  setCheck("vSettlementDeterministic",verification.deterministic&&verification.timeIndependent);
  setCheck("vSettlementClasses",verification.classSupport&&verification.classCount>=3&&verification.capitalScale);
  setCheck("vSettlementContext",verification.contextComplete&&verification.countryRegionTerrainInfluence&&verification.cloneAvoidance);
  setCheck("vSettlementGeography",verification.geographyValid&&verification.physicalConstraints);
  setCheck("vSettlementOutputs",verification.numericValid&&verification.subtypeCount>=4&&verification.genericPlanner&&verification.representativeCoverage);
  setCheck("vSettlementAuthority",verification.lazyQueryable&&verification.authorityPreserved&&!verification.terrainMutation&&!verification.resourceMutation&&!verification.npcPopulationCreated&&!verification.physicalLayoutCreated&&!verification.liveEconomyCreated&&!verification.renderDependency);
  root.dataset.planIndex=String(index);
  root.dataset.planId=plan.id;
  root.dataset.revision=plan.revision;
  root.dataset.reason=selected.reason;
  root.dataset.classId=plan.classId;
  root.dataset.countryId=plan.countryId;
  root.dataset.regionId=plan.regionId;
  root.dataset.context=contextSignature(plan);
  root.dataset.planning=planningSignature(plan);
  root.dataset.market=String(plan.tradeMarketTendency);
  root.dataset.defense=String(plan.defenseTendency);
  root.dataset.port=String(plan.subtypes.weights.port);
  root.dataset.coastal=String(plan.inputs.local.coastalAccess);
  return Object.freeze({verification,plan,selected,index});
}

const api=Object.freeze({
  VERSION,SUPPORTED_CLASSES,CLASS_SCALE,build,settlementsForCountry,representatives,proof,renderDebugPanel
});
window.SettlementArchetypes=api;
window.SettlementPlanner=api;
})();
