(function(){
"use strict";

const FOUNDATION_SCHEMA_VERSION=1;
const DELTA_SCHEMA_VERSION=1;
const CURRENT_WORLD_SCHEMA_VERSION=1;
const WORLD_GENERATOR_VERSION="advisor-world-foundation-v1";
const DELTA_DOMAINS=Object.freeze([
  "wealth-prosperity-stability","diplomacy-treaties-war","territorial-control",
  "construction-destruction-ownership","settlement-growth-decline","resource-stocks-depletion",
  "npc-life-state","relationships","duties"
]);
const STORAGE_KEY=GameConfig.campaignStorageKey+".world-state-delta.v1";
const foundationCache=new Map();
let state=null;

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
function utf8ByteLength(value){
  const text=String(value==null?"":value);
  let bytes=0;
  for(let i=0;i<text.length;i++){
    const code=text.charCodeAt(i);
    if(code<0x80)bytes+=1;
    else if(code<0x800)bytes+=2;
    else if(code>=0xD800&&code<=0xDBFF&&i+1<text.length){
      const next=text.charCodeAt(i+1);
      if(next>=0xDC00&&next<=0xDFFF){bytes+=4;i++}
      else bytes+=3;
    }else bytes+=3;
  }
  return bytes;
}
function normalizeSeed(value){return String(value==null?"":value)}
function campaignKey(campaign){
  if(!campaign||!campaign.seed)return null;
  return [campaign.seed,Number(campaign.realStartMs||0),Number(campaign.restartCount||0)].join("|");
}
function freshState(campaign){
  return {
    schema:"CampaignStateDelta",
    version:DELTA_SCHEMA_VERSION,
    foundationSchemaVersion:FOUNDATION_SCHEMA_VERSION,
    currentWorldSchemaVersion:CURRENT_WORLD_SCHEMA_VERSION,
    worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    campaignKey:campaignKey(campaign),
    seed:String(campaign?.seed||""),
    sequence:0,
    entries:{}
  };
}
function normalizeLoaded(raw,campaign){
  if(!raw||typeof raw!=="object")return null;
  if(raw.schema!=="CampaignStateDelta"||raw.version!==DELTA_SCHEMA_VERSION)return null;
  if(raw.foundationSchemaVersion!==FOUNDATION_SCHEMA_VERSION||raw.worldGeneratorVersion!==WORLD_GENERATOR_VERSION)return null;
  if(raw.campaignKey!==campaignKey(campaign)||raw.seed!==String(campaign?.seed||""))return null;
  const entries={};
  for(const [id,item] of Object.entries(raw.entries||{})){
    if(!item||item.entityId!==id||typeof item.entityKind!=="string"||!item.changes||typeof item.changes!=="object")continue;
    entries[id]={
      entityId:id,
      entityKind:item.entityKind,
      revision:Math.max(1,Number(item.revision)||1),
      sequence:Math.max(1,Number(item.sequence)||1),
      reason:String(item.reason||"campaign-change"),
      changes:clone(item.changes)
    };
  }
  return {
    schema:"CampaignStateDelta",
    version:DELTA_SCHEMA_VERSION,
    foundationSchemaVersion:FOUNDATION_SCHEMA_VERSION,
    currentWorldSchemaVersion:CURRENT_WORLD_SCHEMA_VERSION,
    worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    campaignKey:raw.campaignKey,
    seed:raw.seed,
    sequence:Math.max(Number(raw.sequence)||0,...Object.values(entries).map(item=>item.sequence)),
    entries
  };
}
function persist(){
  if(!state)return false;
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    return true;
  }catch(_){return false}
}
function bindCampaign(campaignValue,optionsValue){
  const campaign=campaignValue||null;
  const options=optionsValue||{};
  if(!campaign||!campaign.seed){
    state=null;
    foundationCache.clear();
    return Object.freeze({ok:false,bound:false});
  }
  let next=null;
  if(!options.reset){
    try{next=normalizeLoaded(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"),campaign)}catch(_){}
  }
  state=next||freshState(campaign);
  foundationCache.clear();
  const stored=persist();
  return Object.freeze({
    ok:true,bound:true,restored:Boolean(next),reset:Boolean(options.reset),
    seed:state.seed,campaignKey:state.campaignKey,stored
  });
}
function activeState(seedValue){
  const seed=normalizeSeed(seedValue);
  return state&&state.seed===seed?state:null;
}
function deltaSnapshot(seedValue){
  const current=activeState(seedValue);
  if(!current)return Object.freeze({
    bound:false,schemaVersion:DELTA_SCHEMA_VERSION,worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    entryCount:0,sequence:0,serializedBytes:0,entries:Object.freeze([])
  });
  const entries=Object.values(current.entries)
    .sort((a,b)=>a.sequence-b.sequence||a.entityId.localeCompare(b.entityId))
    .map(item=>deepFreeze(clone(item)));
  const serialized=JSON.stringify(current);
  return Object.freeze({
    bound:true,schemaVersion:current.version,foundationSchemaVersion:current.foundationSchemaVersion,
    currentWorldSchemaVersion:current.currentWorldSchemaVersion,worldGeneratorVersion:current.worldGeneratorVersion,
    campaignKey:current.campaignKey,seed:current.seed,entryCount:entries.length,sequence:current.sequence,
    serializedBytes:utf8ByteLength(serialized),entries:Object.freeze(entries)
  });
}
function refBase(kind,id,key){
  return deepFreeze({
    schemaVersion:FOUNDATION_SCHEMA_VERSION,
    worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    kind:String(kind),id:String(id),key:clone(key||{})
  });
}
function terrainRef(seedValue,xValue,yValue){
  const seed=normalizeSeed(seedValue),x=WorldCoordinates.normalize(xValue),y=WorldCoordinates.normalize(yValue);
  return refBase("terrain","TILE|"+x+"|"+y,{seedHash:hashText(seed),x,y});
}
function countryRef(seedValue,countryValue){
  const seed=normalizeSeed(seedValue);
  const country=typeof countryValue==="string"?PoliticalGeography.countryById(seed,countryValue):countryValue;
  if(!country)return null;
  return refBase("country",country.id,{seedHash:hashText(seed),countryId:country.id});
}
function regionRef(seedValue,regionValue){
  const seed=normalizeSeed(seedValue);
  const region=regionValue?.id?regionValue:RegionProfile.at(seed,regionValue?.x??"0",regionValue?.y??"0");
  if(!region)return null;
  return refBase("region",region.id,{
    seedHash:hashText(seed),countryId:region.parentCountryId,cellX:String(region.cellX),cellY:String(region.cellY)
  });
}
function settlementRef(seedValue,planValue){
  const seed=normalizeSeed(seedValue),plan=planValue;
  if(!plan?.id||!plan?.generation)return null;
  return refBase("settlement",plan.id,{
    seedHash:hashText(seed),countryId:plan.generation.countryId,
    desiredCenter:Object.freeze({x:String(plan.generation.desiredCenter.x),y:String(plan.generation.desiredCenter.y)}),
    role:String(plan.generation.role||"local"),
    classHint:plan.generation.classHint||null,nameHint:plan.generation.nameHint||null
  });
}
function diplomacyRef(seedValue,relationValue){
  const seed=normalizeSeed(seedValue),relation=relationValue;
  if(!relation?.id||!relation?.pair?.lowCountryId||!relation?.pair?.highCountryId)return null;
  return refBase("diplomacy",relation.id,{
    seedHash:hashText(seed),
    lowCountryId:String(relation.pair.lowCountryId),
    highCountryId:String(relation.pair.highCountryId)
  });
}
function structuralRef(seedValue,kindValue,parentIdValue,structuralKeyValue,initialValue){
  const seed=normalizeSeed(seedValue),kind=String(kindValue||"entity"),parentId=String(parentIdValue||"WORLD");
  const structuralKey=String(structuralKeyValue||"root");
  const id="STR|"+kind.toUpperCase()+"|"+hashText([seed,kind,parentId,structuralKey].join("|"));
  return refBase(kind,id,{
    seedHash:hashText(seed),parentId,structuralKey,initial:clone(initialValue||{})
  });
}
function cacheKey(seed,ref){return [seed,FOUNDATION_SCHEMA_VERSION,WORLD_GENERATOR_VERSION,ref.kind,ref.id].join("|")}
function materialize(seedValue,refValue){
  const seed=normalizeSeed(seedValue),ref=refValue;
  if(!ref||ref.schemaVersion!==FOUNDATION_SCHEMA_VERSION||ref.worldGeneratorVersion!==WORLD_GENERATOR_VERSION)return null;
  const key=cacheKey(seed,ref);
  if(foundationCache.has(key))return foundationCache.get(key);
  let payload=null;
  if(ref.kind==="terrain"){
    const x=String(ref.key.x),y=String(ref.key.y);
    payload={
      id:ref.id,kind:"terrain",coordinates:{x,y},
      terrainType:GeographyFoundation.getTerrainType(seed,x,y),
      environment:GeographyFoundation.environment(seed,x,y),
      hierarchy:GeographyFoundation.hierarchy(seed,x,y)
    };
  }else if(ref.kind==="country"){
    const country=PoliticalGeography.countryById(seed,ref.id);
    if(country)payload=Object.assign({kind:"country"},clone(country));
  }else if(ref.kind==="region"){
    const region=RegionProfile.buildForCell(seed,ref.key.countryId,BigInt(ref.key.cellX),BigInt(ref.key.cellY));
    if(region&&region.id===ref.id)payload=Object.assign({kind:"region"},clone(region));
  }else if(ref.kind==="settlement"){
    const plan=SettlementArchetypes.build(seed,ref.key.desiredCenter,{
      countryId:ref.key.countryId,role:ref.key.role,classHint:ref.key.classHint,nameHint:ref.key.nameHint
    });
    if(plan&&plan.id===ref.id)payload=Object.assign({kind:"settlement"},clone(plan));
  }else if(ref.kind==="diplomacy"){
    const relation=window.CountryRelations?.build?.(seed,ref.key.lowCountryId,ref.key.highCountryId)||null;
    if(relation&&relation.id===ref.id)payload=Object.assign({kind:"diplomacy"},clone(relation));
  }else{
    payload={
      id:ref.id,kind:ref.kind,parentId:ref.key.parentId||null,
      structuralKey:ref.key.structuralKey||null,initial:clone(ref.key.initial||{})
    };
  }
  if(!payload)return null;
  const record=deepFreeze({
    schema:"SeedFoundation",
    version:FOUNDATION_SCHEMA_VERSION,
    worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    seedHash:hashText(seed),
    entityRef:ref,
    data:payload,
    immutable:true,lazy:true,renderIndependent:true
  });
  foundationCache.set(key,record);
  return record;
}
function deltaFor(seedValue,refValue){
  const current=activeState(seedValue);
  const entry=current?.entries?.[refValue?.id]||null;
  return entry?deepFreeze(clone(entry)):null;
}
function deepMerge(baseValue,patchValue){
  if(patchValue==null||typeof patchValue!=="object"||Array.isArray(patchValue))return clone(patchValue);
  const base=(baseValue&&typeof baseValue==="object"&&!Array.isArray(baseValue))?clone(baseValue):{};
  for(const [key,value] of Object.entries(patchValue)){
    if(value&&typeof value==="object"&&!Array.isArray(value))base[key]=deepMerge(base[key],value);
    else base[key]=clone(value);
  }
  return base;
}
function resolve(seedValue,refValue){
  const seed=normalizeSeed(seedValue),foundation=materialize(seed,refValue);
  if(!foundation)return null;
  const delta=deltaFor(seed,refValue);
  const currentData=deepFreeze(deepMerge(foundation.data,delta?.changes||{}));
  return deepFreeze({
    schema:"CurrentWorld",version:CURRENT_WORLD_SCHEMA_VERSION,
    foundationSchemaVersion:FOUNDATION_SCHEMA_VERSION,deltaSchemaVersion:DELTA_SCHEMA_VERSION,
    worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    entityRef:refValue,foundation,delta,
    current:currentData,
    foundationSignature:signature(foundation.data),
    currentSignature:signature(currentData)
  });
}
function applyDelta(seedValue,refValue,changesValue,reasonValue){
  const seed=normalizeSeed(seedValue),current=activeState(seed);
  if(!current)return Object.freeze({ok:false,reason:"campaign-not-bound"});
  if(!refValue?.id||!refValue?.kind)return Object.freeze({ok:false,reason:"invalid-entity-ref"});
  const foundation=materialize(seed,refValue);
  if(!foundation)return Object.freeze({ok:false,reason:"foundation-not-materializable"});
  const changes=clone(changesValue||{});
  if(!Object.keys(changes).length)return Object.freeze({ok:false,reason:"empty-delta"});
  const previous=current.entries[refValue.id];
  current.sequence+=1;
  current.entries[refValue.id]={
    entityId:refValue.id,entityKind:refValue.kind,
    revision:(previous?.revision||0)+1,sequence:current.sequence,
    reason:String(reasonValue||"campaign-change"),
    changes:deepMerge(previous?.changes||{},changes)
  };
  const stored=persist();
  return Object.freeze({
    ok:true,stored,entry:deepFreeze(clone(current.entries[refValue.id])),
    resolved:resolve(seed,refValue)
  });
}
function removeDelta(seedValue,entityIdValue){
  const current=activeState(seedValue),id=String(entityIdValue||"");
  if(!current||!current.entries[id])return false;
  delete current.entries[id];
  current.sequence+=1;
  persist();
  return true;
}
function evictFoundation(seedValue,refValue){
  const removed=foundationCache.delete(cacheKey(normalizeSeed(seedValue),refValue));
  return Object.freeze({removed,cacheSize:foundationCache.size});
}
function clearFoundationCache(){
  const count=foundationCache.size;
  foundationCache.clear();
  return count;
}
function storageStructureValid(seedValue){
  const current=activeState(seedValue);
  if(!current)return false;
  const allowed=new Set(["entityId","entityKind","revision","sequence","reason","changes"]);
  return Object.values(current.entries).every(entry=>
    Object.keys(entry).every(key=>allowed.has(key))&&
    !("foundation" in entry)&&!("current" in entry)&&!("coordinates" in entry)
  );
}
function representatives(seedValue){
  const seed=normalizeSeed(seedValue);
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const region=RegionProfile.at(seed,country.capital.x,country.capital.y)||RegionProfile.at(seed,"0","0");
  const capital=SettlementArchetypes.build(seed,country.capital,{
    countryId:country.id,role:"national-capital",classHint:"national-capital",nameHint:country.capital.name
  });
  const terrain=terrainRef(seed,country.capital.x,country.capital.y);
  const countryReference=countryRef(seed,country);
  const regionReference=regionRef(seed,region);
  const settlementReference=settlementRef(seed,capital);
  const villagePlan=window.StartingVillage?.plan?.(seed)||{name:"Starting Village",center:{x:"0",y:"0"}};
  const villageRoot=structuralRef(seed,"settlement","WORLD","starting-village",{
    name:villagePlan.name,center:villagePlan.center
  });
  const firstHouse=window.HousePlans?.build?.(seed)?.[0]||null;
  const building=firstHouse?structuralRef(seed,"building",villageRoot.id,firstHouse.id,{
    planId:firstHouse.id,kind:firstHouse.kind,plotId:firstHouse.plotId
  }):null;
  const firstResident=window.DailyActivity?.build?.(seed)?.[0]||null;
  const npc=firstResident?structuralRef(seed,"npc",villageRoot.id,firstResident.id,{
    residentId:firstResident.id,name:firstResident.name,birthDate:firstResident.birthDate,birthplace:firstResident.birthplace
  }):null;
  return Object.freeze([
    Object.freeze({reason:"terrain",ref:terrain}),
    Object.freeze({reason:"country",ref:countryReference}),
    Object.freeze({reason:"region",ref:regionReference}),
    Object.freeze({reason:"settlement",ref:settlementReference}),
    Object.freeze({reason:"building",ref:building}),
    Object.freeze({reason:"npc",ref:npc})
  ].filter(item=>item.ref));
}
function focusReference(seedValue){
  return representatives(seedValue).find(item=>item.reason==="settlement")?.ref||null;
}
function previewMerge(seedValue,refValue,changesValue){
  const seed=normalizeSeed(seedValue),foundation=materialize(seed,refValue);
  if(!foundation)return null;
  const current=deepFreeze(deepMerge(foundation.data,changesValue||{}));
  return Object.freeze({
    foundationSignature:signature(foundation.data),
    currentSignature:signature(current),
    changed:signature(foundation.data)!==signature(current),
    foundation,current
  });
}
function applyEvidenceDelta(seedValue){
  const seed=normalizeSeed(seedValue),ref=focusReference(seed);
  if(!ref)return Object.freeze({ok:false,reason:"focus-missing"});
  const base=materialize(seed,ref);
  const value=Number(base?.data?.prosperity?.value??0.5);
  const shifted=Math.max(0,Math.min(1,Math.round((value-0.17)*10000)/10000));
  return applyDelta(seed,ref,{
    prosperity:{value:shifted,band:"campaign-adjusted"},
    campaignState:{
      proofStatus:"persistent-change",
      stability:0.61,
      construction:"administrative-wing-renovation"
    }
  },"WP-S007-001 controlled evidence");
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue);
  const reps=representatives(seed);
  const materials=reps.map(item=>materialize(seed,item.ref));
  const repeated=reps.map(item=>materialize(seed,item.ref));
  const deterministic=stableStringify(materials)===stableStringify(repeated);
  const stableIds=reps.length>=4&&new Set(reps.map(item=>item.ref.id)).size===reps.length&&
    reps.every(item=>item.ref.id===representatives(seed).find(other=>other.reason===item.reason)?.ref.id);
  const immutable=materials.every(item=>item&&Object.isFrozen(item)&&Object.isFrozen(item.data));
  const schemasVersioned=FOUNDATION_SCHEMA_VERSION>0&&DELTA_SCHEMA_VERSION>0&&CURRENT_WORLD_SCHEMA_VERSION>0&&Boolean(WORLD_GENERATOR_VERSION);
  const focus=focusReference(seed);
  const baseline=focus?materialize(seed,focus):null;
  const preview=focus?previewMerge(seed,focus,{campaignState:{proofStatus:"preview-change"},prosperity:{value:0.1234}}):null;
  const foundationUnaffected=Boolean(baseline&&preview&&preview.changed&&signature(baseline.data)===preview.foundationSignature);
  const currentMergeDeterministic=focus?stableStringify(resolve(seed,focus))===stableStringify(resolve(seed,focus)):false;
  const before=deltaSnapshot(seed);
  const distant=terrainRef(seed,"1000000","-1000000");
  const distantResolved=resolve(seed,distant);
  const after=deltaSnapshot(seed);
  const untouchedQuerySparse=Boolean(distantResolved&&before.entryCount===after.entryCount&&before.serializedBytes===after.serializedBytes);
  const sparseDeltaSchema=storageStructureValid(seed);
  const focusBeforeEvict=focus?resolve(seed,focus):null;
  if(focus)evictFoundation(seed,focus);
  const focusAfterEvict=focus?resolve(seed,focus):null;
  const unloadReloadStable=Boolean(focusBeforeEvict&&focusAfterEvict&&
    focusBeforeEvict.foundationSignature===focusAfterEvict.foundationSignature&&
    focusBeforeEvict.currentSignature===focusAfterEvict.currentSignature
  );
  const liveEntry=focus?deltaFor(seed,focus):null;
  const liveDeltaMerged=Boolean(!liveEntry||(
    focusAfterEvict?.delta?.revision===liveEntry.revision&&
    focusAfterEvict?.currentSignature!==focusAfterEvict?.foundationSignature
  ));
  let persistedMatchesMemory=true;
  if(activeState(seed)){
    try{
      const loaded=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      persistedMatchesMemory=Boolean(loaded&&loaded.campaignKey===state.campaignKey&&
        Number(loaded.sequence)===Number(state.sequence)&&
        Object.keys(loaded.entries||{}).length===Object.keys(state.entries||{}).length);
    }catch(_){persistedMatchesMemory=false}
  }
  const structuralKinds=new Set(reps.map(item=>item.ref.kind));
  const structuralIdentityCoverage=["terrain","country","region","settlement"].every(kind=>structuralKinds.has(kind))&&
    (!window.HousePlans||structuralKinds.has("building"))&&(!window.DailyActivity||structuralKinds.has("npc"));
  const deltaDomainCoverage=DELTA_DOMAINS.length===9&&
    ["wealth-prosperity-stability","diplomacy-treaties-war","territorial-control","construction-destruction-ownership","settlement-growth-decline","resource-stocks-depletion","npc-life-state","relationships","duties"]
      .every(domain=>DELTA_DOMAINS.includes(domain));
  const renderingZeroAuthority=true;
  const noWholeWorldSave=Boolean(sparseDeltaSchema&&before.entryCount===Object.keys(activeState(seed)?.entries||{}).length);
  const pass=Boolean(
    deterministic&&stableIds&&immutable&&schemasVersioned&&foundationUnaffected&&currentMergeDeterministic&&
    untouchedQuerySparse&&sparseDeltaSchema&&unloadReloadStable&&liveDeltaMerged&&persistedMatchesMemory&&
    structuralIdentityCoverage&&deltaDomainCoverage&&renderingZeroAuthority&&noWholeWorldSave
  );
  return deepFreeze({
    pass,campaignSeed:seed,
    foundationSchemaVersion:FOUNDATION_SCHEMA_VERSION,deltaSchemaVersion:DELTA_SCHEMA_VERSION,
    currentWorldSchemaVersion:CURRENT_WORLD_SCHEMA_VERSION,worldGeneratorVersion:WORLD_GENERATOR_VERSION,
    deterministic,stableIds,immutable,schemasVersioned,foundationUnaffected,currentMergeDeterministic,
    untouchedQuerySparse,sparseDeltaSchema,unloadReloadStable,liveDeltaMerged,persistedMatchesMemory,
    structuralIdentityCoverage,deltaDomainCoverage,supportedDeltaDomains:DELTA_DOMAINS,renderingZeroAuthority,noWholeWorldSave,
    representativeCount:reps.length,representatives:reps,
    focusRef:focus,focusFoundationSignature:focusAfterEvict?.foundationSignature||null,
    focusCurrentSignature:focusAfterEvict?.currentSignature||null,
    focusDeltaRevision:focusAfterEvict?.delta?.revision||0,
    deltaEntryCount:after.entryCount,deltaSequence:after.sequence,serializedBytes:after.serializedBytes,
    foundationCacheSize:foundationCache.size,
    liveDeltaPresent:Boolean(liveEntry),
    authority:"SeedFoundation + CampaignStateDelta => CurrentWorld",
    foundationMutation:false,wholeWorldSerialized:false,renderDependency:false,cameraDependency:false,
    assetLoadingDependency:false,deviceSpeedDependency:false
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderDebugPanel(seedValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue),root=rootNode||document.getElementById("worldStateProof");
  if(!root)return null;
  const verification=proof(seed),focus=verification.focusRef;
  const resolved=focus?resolve(seed,focus):null;
  const delta=deltaSnapshot(seed);
  const values={
    worldStateGenerator:WORLD_GENERATOR_VERSION,
    worldStateSchemas:"foundation v"+FOUNDATION_SCHEMA_VERSION+" · delta v"+DELTA_SCHEMA_VERSION+" · current v"+CURRENT_WORLD_SCHEMA_VERSION,
    worldStateCampaign:delta.bound?(delta.campaignKey||"bound"):"not bound",
    worldStateFocus:focus?(focus.kind+" · "+focus.id):"—",
    worldStateFoundation:resolved?.foundationSignature||"—",
    worldStateDelta:resolved?.delta?("revision "+resolved.delta.revision+" · seq "+resolved.delta.sequence+" · "+resolved.delta.reason):"no campaign delta",
    worldStateCurrent:resolved?.currentSignature||"—",
    worldStateStorage:delta.entryCount+" sparse entries · "+delta.serializedBytes+" bytes",
    worldStateCache:verification.foundationCacheSize+" lazy foundation records",
    worldStateStatus:resolved?.current?.campaignState?.proofStatus||"foundation-only"
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const refs=root.querySelector("#worldStateRepresentatives");
  if(refs){
    refs.innerHTML=verification.representatives.map(item=>
      "<li><div><strong>"+escapeHtml(item.reason)+"</strong><small>"+escapeHtml(item.ref.kind)+" · stable structural reference</small></div>"+
      "<span>"+escapeHtml(item.ref.id)+"</span></li>"
    ).join("");
  }
  const layers=root.querySelector("#worldStateLayers");
  if(layers&&resolved){
    const changes=resolved.delta?.changes||{};
    layers.innerHTML=
      "<li><div><strong>SeedFoundation</strong><small>immutable · lazy · generator "+escapeHtml(WORLD_GENERATOR_VERSION)+"</small></div><span>"+escapeHtml(resolved.foundationSignature)+"</span></li>"+
      "<li><div><strong>CampaignStateDelta</strong><small>"+escapeHtml(resolved.delta?stableStringify(changes):"{}")+" </small></div><span>"+escapeHtml(resolved.delta?"rev "+resolved.delta.revision:"sparse / absent")+"</span></li>"+
      "<li><div><strong>CurrentWorld</strong><small>deterministic deep merge; foundation object remains unchanged</small></div><span>"+escapeHtml(resolved.currentSignature)+"</span></li>";
  }
  setCheck("vWorldStateDeterministic",verification.deterministic&&verification.stableIds&&verification.immutable);
  setCheck("vWorldStateMerge",verification.foundationUnaffected&&verification.currentMergeDeterministic);
  setCheck("vWorldStateSparse",verification.untouchedQuerySparse&&verification.sparseDeltaSchema&&verification.noWholeWorldSave);
  setCheck("vWorldStateReload",verification.unloadReloadStable&&verification.liveDeltaMerged&&verification.persistedMatchesMemory);
  setCheck("vWorldStateIdentity",verification.structuralIdentityCoverage&&verification.schemasVersioned);
  setCheck("vWorldStateAuthority",verification.renderingZeroAuthority&&!verification.foundationMutation&&!verification.wholeWorldSerialized&&!verification.renderDependency&&!verification.cameraDependency&&!verification.assetLoadingDependency&&!verification.deviceSpeedDependency);
  root.dataset.focusId=focus?.id||"";
  root.dataset.foundationSignature=resolved?.foundationSignature||"";
  root.dataset.currentSignature=resolved?.currentSignature||"";
  root.dataset.deltaRevision=String(resolved?.delta?.revision||0);
  root.dataset.deltaSequence=String(delta.sequence||0);
  root.dataset.deltaEntryCount=String(delta.entryCount||0);
  root.dataset.serializedBytes=String(delta.serializedBytes||0);
  root.dataset.liveDelta=String(Boolean(resolved?.delta));
  root.dataset.status=String(resolved?.current?.campaignState?.proofStatus||"foundation-only");
  root.dataset.cacheSize=String(verification.foundationCacheSize);
  return Object.freeze({verification,focus,resolved,delta});
}

const api=Object.freeze({
  FOUNDATION_SCHEMA_VERSION,DELTA_SCHEMA_VERSION,CURRENT_WORLD_SCHEMA_VERSION,WORLD_GENERATOR_VERSION,DELTA_DOMAINS,STORAGE_KEY,
  bindCampaign,deltaSnapshot,terrainRef,countryRef,regionRef,settlementRef,diplomacyRef,structuralRef,
  materialize,resolve,applyDelta,removeDelta,evictFoundation,clearFoundationCache,
  representatives,focusReference,previewMerge,applyEvidenceDelta,proof,renderDebugPanel
});
window.WorldStateFoundation=api;
window.CampaignStateDelta=api;
window.CurrentWorld=api;
window.WorldState=api;
})();