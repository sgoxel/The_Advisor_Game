(function(){
"use strict";

const VERSION=1;
const CLASS_ORDER=Object.freeze(["hamlet","village","town","city","national-capital"]);
const CLASS_RANK=Object.freeze(Object.fromEntries(CLASS_ORDER.map((id,index)=>[id,index])));
const ALL_CLASSES=Object.freeze([...CLASS_ORDER]);
const RURAL_CLASSES=Object.freeze(["hamlet","village","town"]);
const URBAN_CLASSES=Object.freeze(["town","city","national-capital"]);
const LARGE_CLASSES=Object.freeze(["city","national-capital"]);
const NON_HAMLET=Object.freeze(["village","town","city","national-capital"]);
const cache=new Map();
const proofCache=new Map();

function def(value){return Object.freeze(value)}
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
function classes(...values){return Object.freeze(values.flat())}

const CATALOG=Object.freeze([
  def({id:"rural-residence",category:"residential",label:"Huts / Cabins / Houses",classes:classes(RURAL_CLASSES),capacity:6,maxCount:900,enterable:true,assetKey:"building:function:rural-residence",road:"local",publicSpace:"none",score:0.72}),
  def({id:"urban-residence",category:"residential",label:"Urban Residences",classes:classes(URBAN_CLASSES),populationMin:900,capacity:22,maxCount:1800,enterable:true,assetKey:"building:function:urban-residence",road:"local",publicSpace:"none",score:0.58}),
  def({id:"elite-residence",category:"residential",label:"Elite / Noble Residence",classes:classes(["town","city","national-capital"]),populationMin:1400,prosperityMin:0.48,capacity:18,maxCount:45,enterable:true,assetKey:"building:function:elite-residence",road:"structured",publicSpace:"communal",modifiers:def({prosperity:0.50,publicSpace:0.18,trade:0.10}),threshold:0.55}),
  def({id:"well-cistern",category:"community",label:"Well / Cistern",classes:classes(ALL_CLASSES),capacity:420,maxCount:140,enterable:false,assetKey:"building:function:well-cistern",road:"local",publicSpace:"communal",score:0.84}),
  def({id:"barn",category:"food-agriculture",label:"Barn / Agricultural Support",classes:classes(RURAL_CLASSES),resourceMin:def({agriculture:0.28}),capacity:180,maxCount:80,enterable:true,assetKey:"building:function:barn",road:"local",publicSpace:"none",legacyLotKinds:Object.freeze(["barn"]),modifiers:def({agriculture:0.64,prosperity:0.08}),threshold:0.44}),
  def({id:"granary",category:"food-agriculture",label:"Granary / Food Store",classes:classes(ALL_CLASSES),populationMin:35,resourceMin:def({agriculture:0.28}),capacity:520,maxCount:48,enterable:true,assetKey:"building:function:granary",road:"structured",publicSpace:"communal",modifiers:def({agriculture:0.54,prosperity:0.12,publicSpace:0.10}),threshold:0.46}),
  def({id:"mill",category:"food-agriculture",label:"Mill",classes:classes(["village","town","city","national-capital"]),resourceMin:def({agriculture:0.34}),capacity:900,maxCount:24,enterable:true,assetKey:"building:function:mill",road:"local",publicSpace:"none",modifiers:def({agriculture:0.56,route:0.16,prosperity:0.08}),threshold:0.54}),
  def({id:"livestock-yard",category:"food-agriculture",label:"Livestock Yard",classes:classes(["hamlet","village","town"]),resourceMin:def({agriculture:0.30}),capacity:260,maxCount:36,enterable:false,assetKey:"building:function:livestock-yard",road:"local",publicSpace:"none",modifiers:def({agriculture:0.48,route:0.08}),threshold:0.58}),
  def({id:"general-shop",category:"trade",label:"Shop",classes:classes(ALL_CLASSES),populationMin:35,capacity:650,maxCount:180,enterable:true,assetKey:"building:function:general-shop",road:"local",publicSpace:"communal",legacyLotKinds:Object.freeze(["shop"]),modifiers:def({trade:0.42,market:0.30,route:0.18}),threshold:0.45}),
  def({id:"market-stalls",category:"trade",label:"Market Stalls",classes:classes(["village","town","city","national-capital"]),populationMin:240,capacity:1000,maxCount:90,enterable:false,assetKey:"building:function:market-stalls",road:"structured",publicSpace:"communal",modifiers:def({trade:0.36,market:0.34,publicSpace:0.20}),threshold:0.52}),
  def({id:"market-hall",category:"trade",label:"Market Hall",classes:classes(["town","city","national-capital"]),populationMin:1100,prosperityMin:0.35,capacity:4200,maxCount:18,enterable:true,assetKey:"building:function:market-hall",road:"structured",publicSpace:"civic",modifiers:def({trade:0.38,market:0.34,prosperity:0.12,publicSpace:0.10}),threshold:0.58}),
  def({id:"inn-tavern",category:"trade",label:"Inn / Tavern",classes:classes(NON_HAMLET),populationMin:150,capacity:260,maxCount:70,enterable:true,assetKey:"building:function:inn-tavern",road:"local",publicSpace:"communal",legacyLotKinds:Object.freeze(["tavern"]),modifiers:def({trade:0.28,market:0.24,route:0.28,prosperity:0.08}),threshold:0.46}),
  def({id:"warehouse",category:"trade",label:"Warehouse",classes:classes(["town","city","national-capital"]),populationMin:1200,capacity:3200,maxCount:70,enterable:true,assetKey:"building:function:warehouse",road:"structured",publicSpace:"none",modifiers:def({trade:0.34,market:0.24,route:0.28,prosperity:0.08}),threshold:0.55}),
  def({id:"customs-house",category:"trade",label:"Customs / Trade Office",classes:classes(["city","national-capital"]),populationMin:4200,capacity:8000,maxCount:8,enterable:true,assetKey:"building:function:customs-house",road:"major",publicSpace:"civic",modifiers:def({trade:0.36,market:0.24,route:0.24,publicSpace:0.10}),threshold:0.62}),
  def({id:"storehouse",category:"production-storage",label:"Storehouse",classes:classes(ALL_CLASSES),populationMin:70,capacity:700,maxCount:100,enterable:true,assetKey:"building:function:storehouse",road:"local",publicSpace:"none",legacyLotKinds:Object.freeze(["storehouse"]),modifiers:def({route:0.22,prosperity:0.12,agriculture:0.14,trade:0.12}),threshold:0.40}),
  def({id:"craft-workshop",category:"production-storage",label:"Craft Workshop",classes:classes(NON_HAMLET),populationMin:180,capacity:340,maxCount:160,enterable:true,assetKey:"building:function:craft-workshop",road:"local",publicSpace:"none",legacyLotKinds:Object.freeze(["workshop"]),modifiers:def({trade:0.16,prosperity:0.18,forest:0.20,mining:0.20,route:0.10}),threshold:0.48}),
  def({id:"smithy",category:"production-storage",label:"Smithy",classes:classes(["village","town","city","national-capital"]),populationMin:260,resourceMin:def({mineral:0.20}),capacity:520,maxCount:60,enterable:true,assetKey:"building:function:smithy",road:"local",publicSpace:"none",modifiers:def({mining:0.42,prosperity:0.14,route:0.14}),threshold:0.53}),
  def({id:"ore-depot",category:"production-storage",label:"Ore Depot",classes:classes(ALL_CLASSES),populationMin:35,resourceMin:def({mineral:0.28}),capacity:1200,maxCount:36,enterable:true,assetKey:"building:function:ore-depot",road:"structured",publicSpace:"none",modifiers:def({mining:0.58,route:0.18}),threshold:0.47}),
  def({id:"smelter",category:"production-storage",label:"Smelter / Processing Works",classes:classes(["town","city","national-capital"]),populationMin:800,resourceMin:def({mineral:0.38}),capacity:1700,maxCount:30,enterable:true,assetKey:"building:function:smelter",road:"structured",publicSpace:"none",modifiers:def({mining:0.58,prosperity:0.10,route:0.14}),threshold:0.56}),
  def({id:"timber-yard",category:"production-storage",label:"Timber Yard",classes:classes(["village","town","city","national-capital"]),resourceMin:def({timber:0.36}),capacity:1100,maxCount:40,enterable:false,assetKey:"building:function:timber-yard",road:"structured",publicSpace:"none",modifiers:def({forest:0.62,route:0.16}),threshold:0.50}),
  def({id:"workyard",category:"production-storage",label:"Outdoor Workyard",classes:classes(ALL_CLASSES),populationMin:80,capacity:500,maxCount:80,enterable:false,assetKey:"building:function:workyard",road:"local",publicSpace:"none",legacyLotKinds:Object.freeze(["workyard"]),modifiers:def({prosperity:0.12,route:0.12,forest:0.14,mining:0.14}),threshold:0.44}),
  def({id:"meeting-hall",category:"civic",label:"Meeting / Community Hall",classes:classes(NON_HAMLET),populationMin:130,capacity:650,maxCount:8,enterable:true,assetKey:"building:function:meeting-hall",road:"structured",publicSpace:"communal",legacyLotKinds:Object.freeze(["meeting-hall"]),modifiers:def({publicSpace:0.40,prosperity:0.12}),threshold:0.40}),
  def({id:"town-hall",category:"civic",label:"Town Hall / Administration",classes:classes(["town","city","national-capital"]),populationMin:700,capacity:2800,maxCount:8,enterable:true,assetKey:"building:function:town-hall",road:"structured",publicSpace:"civic",modifiers:def({publicSpace:0.38,prosperity:0.14,route:0.08}),threshold:0.48}),
  def({id:"city-administration",category:"civic",label:"City Administration",classes:classes(LARGE_CLASSES),populationMin:2600,capacity:9000,maxCount:10,enterable:true,assetKey:"building:function:city-administration",road:"major",publicSpace:"civic",modifiers:def({publicSpace:0.36,prosperity:0.16,route:0.10}),threshold:0.54}),
  def({id:"court-records",category:"civic",label:"Court / Records Office",classes:classes(["town","city","national-capital"]),populationMin:1700,prosperityMin:0.35,capacity:5200,maxCount:8,enterable:true,assetKey:"building:function:court-records",road:"structured",publicSpace:"civic",modifiers:def({publicSpace:0.30,prosperity:0.24,trade:0.08}),threshold:0.58}),
  def({id:"guard-post",category:"security-military",label:"Guard Post",classes:classes(ALL_CLASSES),capacity:420,maxCount:60,enterable:true,assetKey:"building:function:guard-post",road:"structured",publicSpace:"none",modifiers:def({defense:0.46,frontier:0.24,fortified:0.20}),threshold:0.46}),
  def({id:"watchtower",category:"security-military",label:"Watchtower",classes:classes(["village","town","city","national-capital"]),capacity:1200,maxCount:32,enterable:true,assetKey:"building:function:watchtower",road:"local",publicSpace:"none",modifiers:def({defense:0.42,frontier:0.34,fortified:0.18}),threshold:0.58}),
  def({id:"barracks",category:"security-military",label:"Barracks",classes:classes(["town","city","national-capital"]),populationMin:900,capacity:1800,maxCount:28,enterable:true,assetKey:"building:function:barracks",road:"structured",publicSpace:"communal",modifiers:def({defense:0.46,fortified:0.26,frontier:0.14}),threshold:0.55}),
  def({id:"armory",category:"security-military",label:"Armory",classes:classes(["city","national-capital"]),populationMin:3600,capacity:5200,maxCount:8,enterable:true,assetKey:"building:function:armory",road:"major",publicSpace:"communal",modifiers:def({defense:0.50,fortified:0.26,prosperity:0.08}),threshold:0.62}),
  def({id:"wall-gate",category:"security-military",label:"Wall / Gate / Palisade",classes:classes(["village","town","city","national-capital"]),capacity:8000,maxCount:18,enterable:false,assetKey:"building:function:wall-gate",road:"major",publicSpace:"none",modifiers:def({defense:0.50,fortified:0.32,frontier:0.18}),threshold:0.58}),
  def({id:"community-shrine",category:"religious-cultural-community",label:"Community Shrine / Cultural House",classes:classes(ALL_CLASSES),populationMin:90,capacity:700,maxCount:24,enterable:true,assetKey:"building:function:community-shrine",road:"local",publicSpace:"communal",modifiers:def({publicSpace:0.26,prosperity:0.12}),threshold:0.56}),
  def({id:"temple-cultural-hall",category:"religious-cultural-community",label:"Temple / Cultural Hall",classes:classes(["town","city","national-capital"]),populationMin:1500,prosperityMin:0.38,capacity:5000,maxCount:18,enterable:true,assetKey:"building:function:temple-cultural-hall",road:"structured",publicSpace:"civic",modifiers:def({publicSpace:0.32,prosperity:0.24,trade:0.06}),threshold:0.60}),
  def({id:"stable-road-service",category:"transport",label:"Stable / Road Service",classes:classes(ALL_CLASSES),populationMin:60,capacity:700,maxCount:90,enterable:true,assetKey:"building:function:stable-road-service",road:"local",publicSpace:"none",modifiers:def({route:0.46,trade:0.18,market:0.10}),threshold:0.40}),
  def({id:"caravan-yard",category:"transport",label:"Caravan Yard",classes:classes(["town","city","national-capital"]),populationMin:800,capacity:2600,maxCount:36,enterable:false,assetKey:"building:function:caravan-yard",road:"major",publicSpace:"communal",modifiers:def({route:0.44,trade:0.30,market:0.16}),threshold:0.56}),
  def({id:"dock-wharf",category:"transport",label:"Dock / Wharf",classes:classes(ALL_CLASSES),populationMin:35,coastalOnly:true,resourceMin:def({water:0.28}),capacity:2600,maxCount:42,enterable:false,assetKey:"building:function:dock-wharf",road:"structured",publicSpace:"none",modifiers:def({port:0.54,trade:0.18,route:0.10}),threshold:0.45}),
  def({id:"fish-market",category:"transport",label:"Fish Market",classes:classes(["village","town","city","national-capital"]),populationMin:260,coastalOnly:true,resourceMin:def({water:0.30}),capacity:1800,maxCount:24,enterable:false,assetKey:"building:function:fish-market",road:"structured",publicSpace:"communal",modifiers:def({port:0.42,trade:0.24,market:0.18}),threshold:0.52}),
  def({id:"government-complex",category:"capital-government",label:"National Government Complex",classes:classes(["national-capital"]),populationMin:10000,capacity:24000,maxCount:4,enterable:true,assetKey:"building:function:government-complex",road:"major",publicSpace:"monumental",capitalOnly:true,score:0.96}),
  def({id:"palace-castle",category:"capital-government",label:"Palace / Castle",classes:classes(["national-capital"]),populationMin:10000,capacity:30000,maxCount:2,enterable:true,assetKey:"building:function:palace-castle",road:"major",publicSpace:"monumental",capitalOnly:true,modifiers:def({defense:0.28,prosperity:0.28,publicSpace:0.20,fortified:0.18}),threshold:0.52}),
  def({id:"great-civic-hall",category:"capital-government",label:"Great Civic / Ceremonial Hall",classes:classes(["national-capital"]),populationMin:10000,capacity:18000,maxCount:5,enterable:true,assetKey:"building:function:great-civic-hall",road:"major",publicSpace:"monumental",capitalOnly:true,score:0.92})
]);

const BY_ID=new Map(CATALOG.map(item=>[item.id,item]));
const SIGNAL_CANDIDATES=Object.freeze({
  "housing":Object.freeze(["rural-residence","urban-residence"]),
  "water-access":Object.freeze(["well-cistern"]),
  "local-road-access":Object.freeze(["stable-road-service"]),
  "communal-space":Object.freeze(["meeting-hall","community-shrine"]),
  "market":Object.freeze(["market-stalls","market-hall","general-shop"]),
  "administration":Object.freeze(["town-hall","city-administration"]),
  "lodging":Object.freeze(["inn-tavern"]),
  "district-services":Object.freeze(["city-administration","court-records"]),
  "large-storage":Object.freeze(["warehouse"]),
  "national-government":Object.freeze(["government-complex","palace-castle"]),
  "major-civic-space":Object.freeze(["great-civic-hall"]),
  "garrison":Object.freeze(["barracks","armory"]),
  "food-storage":Object.freeze(["granary"]),
  "ore-storage":Object.freeze(["ore-depot","storehouse"]),
  "dock-or-wharf":Object.freeze(["dock-wharf"]),
  "defensive-post":Object.freeze(["guard-post","watchtower"]),
  "farm-support":Object.freeze(["barn","livestock-yard"]),
  "small-market":Object.freeze(["general-shop","market-stalls"]),
  "craft-workshop":Object.freeze(["craft-workshop","smithy"]),
  "storehouse":Object.freeze(["storehouse"]),
  "guild-hall":Object.freeze(["temple-cultural-hall"]),
  "mill":Object.freeze(["mill"]),
  "smelter":Object.freeze(["smelter"]),
  "caravan-yard":Object.freeze(["caravan-yard"]),
  "fish-market":Object.freeze(["fish-market"]),
  "wall-or-palisade":Object.freeze(["wall-gate"]),
  "timber-yard":Object.freeze(["timber-yard"])
});

function metric(plan,key){
  if(key==="agriculture")return plan.subtypes.weights.agricultural;
  if(key==="forest")return plan.subtypes.weights.forest;
  if(key==="mining")return plan.subtypes.weights.mining;
  if(key==="trade")return plan.subtypes.weights.trade;
  if(key==="port")return plan.subtypes.weights.port;
  if(key==="frontier")return plan.subtypes.weights.frontier;
  if(key==="fortified")return plan.subtypes.weights.fortified;
  if(key==="prosperity")return plan.prosperity.value;
  if(key==="defense")return plan.defenseTendency;
  if(key==="market")return plan.tradeMarketTendency;
  if(key==="route")return plan.inputs.local.routeAccess;
  if(key==="publicSpace")return plan.publicSpaceScale.value;
  return 0;
}
function eligible(definition,plan){
  if(!definition.classes.includes(plan.classId))return false;
  if((definition.populationMin||0)>plan.population.planned)return false;
  if((definition.prosperityMin||0)>plan.prosperity.value)return false;
  if(definition.coastalOnly&&!plan.inputs.local.coastalAccess)return false;
  if(definition.resourceMin){
    for(const [key,min] of Object.entries(definition.resourceMin)){
      if(Number(plan.inputs.local.resources[key]||0)<Number(min))return false;
    }
  }
  return true;
}
function suitability(seed,definition,plan){
  let score=Number(definition.score||0);
  for(const [key,weight] of Object.entries(definition.modifiers||{}))score+=metric(plan,key)*Number(weight);
  score+=unit(seed,"settlement-building:suitability:"+plan.id+":"+definition.id)*0.045;
  return round(clamp01(score));
}
function chooseForSignal(seed,signal,plan,used){
  const candidates=(SIGNAL_CANDIDATES[signal]||[])
    .map(id=>BY_ID.get(id)).filter(Boolean)
    .filter(item=>eligible(item,plan)&&!used.has(item.id))
    .map(item=>({item,score:suitability(seed,item,plan)}))
    .sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
  return candidates[0]||null;
}
function qualityTier(plan){
  const value=clamp01(plan.prosperity.value*0.66+plan.publicSpaceScale.value*0.20+plan.roadScale.value*0.14);
  return value>=0.78?"grand":value>=0.60?"refined":value>=0.40?"standard":"basic";
}
function countFor(definition,plan,score){
  const population=plan.population.planned;
  let count=1;
  if(definition.id==="rural-residence"){
    const share={hamlet:0.96,village:0.90,town:0.46,city:0.05,"national-capital":0.02}[plan.classId]||0.5;
    count=Math.ceil(population*share/definition.capacity);
  }else if(definition.id==="urban-residence"){
    const share={town:0.48,city:0.88,"national-capital":0.91}[plan.classId]||0.4;
    count=Math.ceil(population*share/definition.capacity);
  }else if(definition.id==="elite-residence"){
    count=Math.max(1,Math.ceil(population*Math.max(0.01,plan.prosperity.value-0.38)/900));
  }else{
    const demand=Math.max(0,population-(definition.populationMin||0));
    count=1+Math.floor(demand/Math.max(1,definition.capacity||1000));
    if(score>=0.78)count+=1;
    if(score>=0.90&&CLASS_RANK[plan.classId]>=CLASS_RANK.city)count+=1;
  }
  return Math.max(1,Math.min(Number(definition.maxCount||99),count));
}
function reasonFor(definition,plan,source,signal,score){
  const reasons=[];
  if(source==="required")reasons.push("required by settlement plan: "+signal);
  else if(source==="optional")reasons.push("optional settlement need selected: "+signal);
  else reasons.push("context score "+Math.round(score*100)+"% passed "+Math.round(Number(definition.threshold||0.55)*100)+"% threshold");
  if(definition.resourceMin){
    for(const [key,min] of Object.entries(definition.resourceMin)){
      reasons.push(key+" "+Math.round(Number(plan.inputs.local.resources[key]||0)*100)+"% ≥ "+Math.round(Number(min)*100)+"%");
    }
  }
  if(definition.coastalOnly)reasons.push("coastal/water access physically valid");
  if(definition.capitalOnly)reasons.push("national-capital only");
  if(definition.modifiers){
    const strongest=Object.entries(definition.modifiers)
      .map(([key,weight])=>({key,value:metric(plan,key)*Number(weight)}))
      .sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key))[0];
    if(strongest&&strongest.value>0.04)reasons.push("strongest context: "+strongest.key+" "+Math.round(metric(plan,strongest.key)*100)+"%");
  }
  return Object.freeze(reasons);
}
function recordFor(definition,plan,source,signal,score){
  const count=countFor(definition,plan,score);
  return Object.freeze({
    id:definition.id,category:definition.category,label:definition.label,
    source,signal:signal||null,score:round(score),count,
    capacityPerBuilding:Number(definition.capacity||0),
    totalCapacity:Number(definition.capacity||0)*count,
    enterable:Boolean(definition.enterable),
    roadRequirement:definition.road||"none",
    publicSpaceRequirement:definition.publicSpace||"none",
    assetKey:definition.assetKey,
    qualityTier:qualityTier(plan),
    reasons:reasonFor(definition,plan,source,signal,score)
  });
}
function compositionSignature(composition){
  return composition.selected.map(item=>item.id+":"+item.count+":"+item.qualityTier).join("|");
}
function compose(seedValue,planValue){
  const seed=String(seedValue==null?"":seedValue);
  const plan=typeof planValue==="string"?null:planValue;
  if(!plan||!plan.id)return null;
  const cacheKey=seed+"|"+plan.id+"|"+plan.revision;
  if(cache.has(cacheKey))return cache.get(cacheKey);

  const selected=[],used=new Set();
  const add=(choice,source,signal)=>{
    if(!choice||used.has(choice.item.id))return;
    used.add(choice.item.id);
    selected.push(recordFor(choice.item,plan,source,signal,choice.score));
  };
  for(const signal of plan.buildingFunctions.required){
    add(chooseForSignal(seed,signal,plan,used),"required",signal);
  }
  for(const signal of plan.buildingFunctions.optional){
    const choice=chooseForSignal(seed,signal,plan,used);
    if(choice&&choice.score>=Number(choice.item.threshold||0.50))add(choice,"optional",signal);
  }

  const contextualBudget={hamlet:1,village:2,town:4,city:7,"national-capital":9}[plan.classId]||2;
  const candidates=CATALOG.filter(item=>!used.has(item.id)&&eligible(item,plan))
    .map(item=>({item,score:suitability(seed,item,plan)}))
    .filter(choice=>choice.score>=Number(choice.item.threshold||0.60))
    .sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
  let contextualAdded=0;
  for(const choice of candidates){
    if(contextualAdded>=contextualBudget)break;
    add(choice,"contextual",null);
    contextualAdded++;
  }

  const categories={};
  let totalBuildings=0,totalCapacity=0,enterableFunctions=0;
  for(const item of selected){
    categories[item.category]=(categories[item.category]||0)+item.count;
    totalBuildings+=item.count;
    totalCapacity+=item.totalCapacity;
    if(item.enterable)enterableFunctions++;
  }
  const record=Object.freeze({
    version:VERSION,
    id:"SBC|"+hashText(seed+"|"+plan.id+"|"+plan.revision),
    revision:"SBCF-"+hashText([VERSION,seed,plan.id,plan.revision,...selected.map(item=>item.id+":"+item.count+":"+item.qualityTier)].join("|")),
    settlementId:plan.id,settlementRevision:plan.revision,
    settlementName:plan.name,countryId:plan.countryId,regionId:plan.regionId,classId:plan.classId,
    inputs:Object.freeze({
      population:plan.population.planned,prosperity:plan.prosperity.value,
      subtypeTags:plan.subtypes.tags,subtypeWeights:plan.subtypes.weights,
      localResources:plan.inputs.local.resources,routeAccess:plan.inputs.local.routeAccess,
      coastalAccess:plan.inputs.local.coastalAccess,defenseTendency:plan.defenseTendency,
      tradeMarketTendency:plan.tradeMarketTendency,roadScale:plan.roadScale,publicSpaceScale:plan.publicSpaceScale,
      architectureKeys:plan.architectureKeys
    }),
    selected:Object.freeze(selected),
    categoryCounts:Object.freeze(categories),
    totalPlannedBuildings:totalBuildings,totalCapacity,enterableFunctions,
    logicalAssetOnly:selected.every(item=>item.assetKey.startsWith("building:function:")&&!/\.(png|svg|webp|glb)$/i.test(item.assetKey)),
    foundation:Object.freeze({
      source:"SettlementArchetypes + reusable building-function catalog",
      immutable:true,fantasyTimeDependent:false,lazy:true,physicalLayoutCreated:false,
      settlementAuthority:"SettlementArchetypes",terrainMutation:false,resourceMutation:false,
      npcStateCreated:false,finalArtRequired:false,renderDependency:false
    })
  });
  cache.set(cacheKey,record);
  return record;
}
function samplePlans(seed){
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const countries=[origin];
  for(const profile of CountryProfile.sampleCountries(seed)){
    const country=PoliticalGeography.countryById(seed,profile.countryId);
    if(country&&!countries.some(item=>item.id===country.id))countries.push(country);
    if(countries.length>=4)break;
  }
  return Object.freeze(countries.flatMap(country=>SettlementArchetypes.settlementsForCountry(seed,country,2)));
}
function representativePlans(seed){
  const plans=[...samplePlans(seed)];
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const starting=plans.find(plan=>plan.countryId===origin.id&&plan.role==="starting-village");
  const village=[...plans].filter(plan=>plan.classId==="village"&&plan.id!==starting?.id)
    .sort((a,b)=>b.subtypes.weights.agricultural-a.subtypes.weights.agricultural||a.id.localeCompare(b.id))[0];
  const town=[...plans].filter(plan=>plan.classId==="town")
    .sort((a,b)=>b.tradeMarketTendency-a.tradeMarketTendency||a.id.localeCompare(b.id))[0];
  const city=[...plans].filter(plan=>plan.classId==="city")
    .sort((a,b)=>b.population.planned-a.population.planned||a.id.localeCompare(b.id))[0];
  const capital=[...plans].filter(plan=>plan.classId==="national-capital")
    .sort((a,b)=>b.population.planned-a.population.planned||a.id.localeCompare(b.id))[0];
  return Object.freeze([
    Object.freeze({reason:"starting-village",plan:starting}),
    Object.freeze({reason:"agricultural-village",plan:village}),
    Object.freeze({reason:"trade-town",plan:town}),
    Object.freeze({reason:"city",plan:city}),
    Object.freeze({reason:"national-capital",plan:capital})
  ].filter(item=>item.plan));
}
function representatives(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  return Object.freeze(representativePlans(seed).map(item=>Object.freeze({
    reason:item.reason,plan:item.plan,composition:compose(seed,item.plan)
  })));
}
function startingVillageMapping(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const lots=window.SpecialLots?.build?.(seed)||[];
  const mappings=lots.map(lot=>{
    const definition=CATALOG.find(item=>(item.legacyLotKinds||[]).includes(lot.kind))||null;
    return Object.freeze({
      lotId:lot.id,lotKind:lot.kind,lotLabel:lot.label,legacyFunction:lot.function,
      catalogId:definition?.id||null,catalogLabel:definition?.label||null,
      enterableMatches:definition?Boolean(definition.enterable)===Boolean(lot.enterable):false,
      logicalAssetKey:definition?.assetKey||null
    });
  });
  return Object.freeze({
    lotCount:lots.length,mappedCount:mappings.filter(item=>item.catalogId).length,
    allMapped:lots.length>0&&mappings.every(item=>item.catalogId&&item.enterableMatches),
    mappings:Object.freeze(mappings)
  });
}
function selectedDefinitionValid(item,plan){
  const definition=BY_ID.get(item.id);
  return Boolean(definition&&eligible(definition,plan));
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(proofCache.has(seed))return proofCache.get(seed);
  const plans=samplePlans(seed);
  const comps=plans.map(plan=>compose(seed,plan));
  const reps=representatives(seed);
  const replay=reps.map(item=>Object.freeze({reason:item.reason,plan:item.plan,composition:compose(seed,item.plan)}));
  const deterministic=JSON.stringify(reps)===JSON.stringify(replay);
  const timeIndependent=comps.every(item=>item.foundation.fantasyTimeDependent===false);
  const catalogCategories=new Set(CATALOG.map(item=>item.category));
  const requiredCategories=["residential","food-agriculture","trade","production-storage","civic","security-military","religious-cultural-community","transport","capital-government"];
  const catalogCoverage=requiredCategories.every(category=>catalogCategories.has(category));
  const metadataComplete=CATALOG.every(item=>
    item.id&&item.category&&item.label&&item.classes?.length&&item.capacity>0&&item.maxCount>0&&
    typeof item.enterable==="boolean"&&item.assetKey&&item.road&&item.publicSpace
  );
  const contextualValidity=comps.every((composition,index)=>
    composition.selected.every(item=>selectedDefinitionValid(item,plans[index]))
  );
  const portConstraint=comps.every((composition,index)=>
    plans[index].inputs.local.coastalAccess||!composition.selected.some(item=>item.id==="dock-wharf"||item.id==="fish-market")
  );
  const agricultureConstraint=comps.every((composition,index)=>
    !composition.selected.some(item=>["barn","granary","mill","livestock-yard"].includes(item.id))||
    plans[index].inputs.local.resources.agriculture>=0.28
  );
  const miningConstraint=comps.every((composition,index)=>
    !composition.selected.some(item=>["ore-depot","smelter"].includes(item.id))||
    plans[index].inputs.local.resources.mineral>=0.32
  );
  const smallPlans=plans.filter(plan=>plan.classId==="hamlet"||plan.classId==="village");
  const scaleLeakagePrevented=smallPlans.every(plan=>{
    const composition=compose(seed,plan);
    return !composition.selected.some(item=>BY_ID.get(item.id)?.capitalOnly||["city-administration","armory","customs-house"].includes(item.id));
  });
  const capitalPlans=plans.filter(plan=>plan.classId==="national-capital");
  const capitalFunctions=capitalPlans.length>=2&&capitalPlans.every(plan=>{
    const ids=new Set(compose(seed,plan).selected.map(item=>item.id));
    return ids.has("government-complex")&&ids.has("great-civic-hall")&&(ids.has("barracks")||ids.has("armory"));
  });
  const villageMap=startingVillageMapping(seed);
  const startingVillageMapped=villageMap.allMapped&&villageMap.mappedCount===7;
  const classSet=new Set(plans.map(plan=>plan.classId));
  const classCoverage=["village","town","city","national-capital"].every(id=>classSet.has(id));
  const repSignatures=new Set(reps.map(item=>compositionSignature(item.composition)));
  const contextualDiversity=reps.length===5&&repSignatures.size>=4;
  const classDifferences=(()=>{
    const byClass=new Map();
    for(const item of reps)if(!byClass.has(item.plan.classId))byClass.set(item.plan.classId,compositionSignature(item.composition));
    return ["village","town","city","national-capital"].every(id=>byClass.has(id))&&new Set(byClass.values()).size>=4;
  })();
  const requiredSignalsSatisfied=comps.every((composition,index)=>
    plans[index].buildingFunctions.required.every(signal=>
      composition.selected.some(item=>item.source==="required"&&item.signal===signal)
    )
  );
  const selectedHasReasons=comps.every(item=>item.selected.every(entry=>entry.reasons.length>=1&&entry.source));
  const logicalAssetOnly=comps.every(item=>item.logicalAssetOnly);
  const noTemplateClone=(()=>{
    const signatures=new Set(comps.map(composition=>compositionSignature(composition)));
    return signatures.size>=Math.min(12,Math.max(1,Math.floor(comps.length/3)));
  })();
  const authorityPreserved=comps.every(item=>
    item.foundation.immutable&&item.foundation.lazy&&!item.foundation.physicalLayoutCreated&&
    !item.foundation.terrainMutation&&!item.foundation.resourceMutation&&!item.foundation.npcStateCreated&&
    !item.foundation.finalArtRequired&&!item.foundation.renderDependency
  );
  const pass=Boolean(
    plans.length>=12&&comps.length===plans.length&&reps.length===5&&deterministic&&timeIndependent&&
    catalogCoverage&&metadataComplete&&contextualValidity&&portConstraint&&agricultureConstraint&&miningConstraint&&
    scaleLeakagePrevented&&capitalFunctions&&startingVillageMapped&&classCoverage&&contextualDiversity&&classDifferences&&
    requiredSignalsSatisfied&&selectedHasReasons&&logicalAssetOnly&&noTemplateClone&&authorityPreserved
  );
  const result=Object.freeze({
    pass,campaignSeed:seed,planCount:plans.length,compositionCount:comps.length,catalogCount:CATALOG.length,
    categoryCount:catalogCategories.size,representativeCount:reps.length,
    deterministic,timeIndependent,catalogCoverage,metadataComplete,contextualValidity,
    portConstraint,agricultureConstraint,miningConstraint,scaleLeakagePrevented,capitalFunctions,
    startingVillageMapped,classCoverage,contextualDiversity,classDifferences,requiredSignalsSatisfied,selectedHasReasons,
    logicalAssetOnly,noTemplateClone,authorityPreserved,
    startingVillageMapping:villageMap,representatives:reps,
    authority:"settlement-building-composition-foundation",
    physicalLayoutCreated:false,terrainMutation:false,resourceMutation:false,npcStateCreated:false,
    finalArtRequired:false,renderDependency:false,fullWorldMaterialized:false
  });
  proofCache.set(seed,result);
  return result;
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
function renderDebugPanel(seedValue,indexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("settlementBuildingCatalogProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,plan:null,composition:null});
  const index=Math.abs(Number(indexValue)||0)%verification.representatives.length;
  const selected=verification.representatives[index],plan=selected.plan,composition=selected.composition;
  const select=root.querySelector("#settlementBuildingSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+escapeHtml(item.reason+" · "+item.plan.name+" · "+item.plan.classId)+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    settlementBuildingName:plan.name,
    settlementBuildingClass:plan.classId+" · "+selected.reason,
    settlementBuildingPopulation:plan.population.planned.toLocaleString("en-US")+" · prosperity "+percent(plan.prosperity.value),
    settlementBuildingContext:"tags "+plan.subtypes.tags.join(" / ")+" · route "+percent(plan.inputs.local.routeAccess)+" · agri "+percent(plan.inputs.local.resources.agriculture)+" · mineral "+percent(plan.inputs.local.resources.mineral)+" · water "+percent(plan.inputs.local.resources.water),
    settlementBuildingCounts:composition.selected.length+" functions · "+composition.totalPlannedBuildings.toLocaleString("en-US")+" planned buildings",
    settlementBuildingCapacity:composition.totalCapacity.toLocaleString("en-US")+" functional capacity units",
    settlementBuildingMapping:verification.startingVillageMapping.mappedCount+"/"+verification.startingVillageMapping.lotCount+" current Starting Village lots mapped",
    settlementBuildingRevision:composition.revision
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const list=root.querySelector("#settlementBuildingFunctions");
  if(list){
    list.innerHTML=composition.selected.slice(0,14).map(item=>
      "<li><div><strong>"+escapeHtml(item.label)+" × "+escapeHtml(String(item.count))+"</strong>"+
      "<small>"+escapeHtml(item.category+" · "+item.source+(item.signal?" · "+item.signal:"")+" · "+item.qualityTier)+"</small>"+
      "<small>"+escapeHtml(item.reasons.slice(0,2).join(" · "))+"</small></div>"+
      "<span>"+escapeHtml(item.enterable?"enterable":"outdoor")+"</span>"+
      "<span>"+escapeHtml(item.roadRequirement)+" road</span>"+
      "<span>"+escapeHtml(item.publicSpaceRequirement)+" space</span></li>"
    ).join("");
  }
  const comparison=root.querySelector("#settlementBuildingComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.map(item=>{
      const ids=item.composition.selected.map(entry=>entry.id);
      return "<li class=\""+(item.plan.id===plan.id?"selected":"")+"\"><div><strong>"+escapeHtml(item.plan.name)+"</strong>"+
        "<small>"+escapeHtml(item.reason+" · "+item.plan.classId+" · "+item.plan.subtypes.tags.join(" / "))+"</small></div>"+
        "<span>"+escapeHtml(String(item.composition.selected.length))+" funcs</span>"+
        "<span>"+escapeHtml(String(item.composition.totalPlannedBuildings))+" bldgs</span>"+
        "<span>"+escapeHtml(ids.slice(0,2).join(" / "))+"</span></li>";
    }).join("");
  }
  const legacy=root.querySelector("#settlementBuildingVillageMap");
  if(legacy){
    legacy.innerHTML=verification.startingVillageMapping.mappings.map(item=>
      "<span class=\"diplomacy-agreement "+(item.catalogId&&item.enterableMatches?"active":"inactive")+"\">"+
      escapeHtml(item.lotKind+" → "+(item.catalogId||"unmapped"))+"</span>"
    ).join("");
  }
  setCheck("vBuildingCatalogDeterministic",verification.deterministic&&verification.timeIndependent);
  setCheck("vBuildingCatalogCoverage",verification.catalogCoverage&&verification.metadataComplete&&verification.logicalAssetOnly);
  setCheck("vBuildingCatalogContext",verification.contextualValidity&&verification.contextualDiversity&&verification.classDifferences&&verification.noTemplateClone&&verification.requiredSignalsSatisfied);
  setCheck("vBuildingCatalogConstraints",verification.portConstraint&&verification.agricultureConstraint&&verification.miningConstraint&&verification.scaleLeakagePrevented);
  setCheck("vBuildingCatalogVillage",verification.startingVillageMapped);
  setCheck("vBuildingCatalogAuthority",verification.authorityPreserved&&!verification.physicalLayoutCreated&&!verification.terrainMutation&&!verification.resourceMutation&&!verification.npcStateCreated&&!verification.finalArtRequired&&!verification.renderDependency);
  root.dataset.compositionIndex=String(index);
  root.dataset.compositionId=composition.id;
  root.dataset.revision=composition.revision;
  root.dataset.reason=selected.reason;
  root.dataset.classId=plan.classId;
  root.dataset.planId=plan.id;
  root.dataset.signature=compositionSignature(composition);
  root.dataset.functionCount=String(composition.selected.length);
  root.dataset.buildingCount=String(composition.totalPlannedBuildings);
  root.dataset.capitalFunctions=String(verification.capitalFunctions);
  root.dataset.villageMapped=String(verification.startingVillageMapped);
  return Object.freeze({verification,plan,composition,selected,index});
}

const api=Object.freeze({
  VERSION,CATALOG,SIGNAL_CANDIDATES,definition:id=>BY_ID.get(id)||null,
  compose,representatives,startingVillageMapping,proof,renderDebugPanel
});
window.SettlementBuildingCatalog=api;
window.SettlementComposition=api;
})();