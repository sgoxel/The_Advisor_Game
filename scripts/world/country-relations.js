(function(){
"use strict";

const VERSION=1;
const relationCache=new Map();

function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function clamp11(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):0;
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
function canonicalPair(countryAId,countryBId){
  const a=String(countryAId||""),b=String(countryBId||"");
  if(!a||!b||a===b)return null;
  return a<b?Object.freeze({low:a,high:b,key:a+"<>"+b}):Object.freeze({low:b,high:a,key:b+"<>"+a});
}
function countrySummary(profile){
  return Object.freeze({
    countryId:profile.countryId,
    countryName:profile.countryName,
    profileRevision:profile.revision,
    wealth:profile.wealth.value,
    tradeOpenness:profile.tendencies.tradeOpenness,
    militaryEmphasis:profile.tendencies.militaryEmphasis,
    infrastructure:profile.tendencies.infrastructure,
    fortification:profile.tendencies.fortification,
    agriculture:profile.tendencies.agriculture,
    craftProduction:profile.tendencies.craftProduction,
    maritime:profile.tendencies.maritime,
    mining:profile.tendencies.mining
  });
}
function borderFor(seed,countryA,countryB){
  const borders=PoliticalGeography.borderEvidence(seed,countryA);
  return borders.find(border=>
    (border.countryA.id===countryA.id&&border.countryB.id===countryB.id)||
    (border.countryA.id===countryB.id&&border.countryB.id===countryA.id)
  )||null;
}
function pairContext(seed,countryA,countryB,profileA,profileB){
  const border=borderFor(seed,countryA,countryB);
  const ga=profileA.geography,gb=profileB.geography;
  const resourcesA=[ga.agriculturalSuitability,ga.timberAvailability,ga.mineralPotential,ga.waterAccess];
  const resourcesB=[gb.agriculturalSuitability,gb.timberAvailability,gb.mineralPotential,gb.waterAccess];
  const complementarity=resourcesA.reduce((sum,value,index)=>sum+Math.abs(value-resourcesB[index]),0)/resourcesA.length;
  const overlap=resourcesA.reduce((sum,value,index)=>sum+Math.min(value,resourcesB[index]),0)/resourcesA.length;
  const routeAccess=clamp01(
    (ga.routeAccess+gb.routeAccess)*0.36+
    (profileA.tendencies.infrastructure+profileB.tendencies.infrastructure)*0.10+
    ((border?.terrain==="road"||border?.terrain==="bridge")?0.20:0)
  );
  const borderFriction=border?clamp01(
    (border.terrain==="rock"?0.24:0)+
    (border.terrain==="water"?0.12:0)+
    Math.min(0.22,Number(border.elevationMeters||0)/6000)+
    Math.min(0.12,Number(border.featureShiftTiles||0)/3000)
  ):0.34;
  const wealthDifference=Math.abs(profileA.wealth.value-profileB.wealth.value);
  const marketDifference=Math.abs(profileA.tendencies.tradeOpenness-profileB.tendencies.tradeOpenness);
  const militaryDifference=Math.abs(profileA.tendencies.militaryEmphasis-profileB.tendencies.militaryEmphasis);
  const competition=clamp01(
    overlap*0.48+
    (1-complementarity)*0.18+
    (1-wealthDifference)*0.12+
    Math.min(profileA.tendencies.mining,profileB.tendencies.mining)*0.12+
    Math.min(profileA.tendencies.agriculture,profileB.tendencies.agriculture)*0.10
  );
  return Object.freeze({
    adjacent:Boolean(border),
    borderId:border?.id||null,
    borderTerrain:border?.terrain||null,
    borderElevationMeters:border?.elevationMeters??null,
    borderMoisturePercent:border?.moisturePercent??null,
    routeAccess:round(routeAccess),
    resourceComplementarity:round(complementarity),
    resourceCompetition:round(competition),
    borderFriction:round(borderFriction),
    wealthDifference:round(wealthDifference),
    marketDifference:round(marketDifference),
    militaryDifference:round(militaryDifference)
  });
}
function relationState(score,tension,rivalry){
  if(score<=-0.55||tension>=0.82)return "hostile";
  if(score<=-0.24||tension>=0.64||rivalry>=0.70)return "tense";
  if(score<0.02||rivalry>=0.52)return "wary";
  if(score<0.28)return "neutral";
  if(score<0.55)return "cordial";
  return "friendly";
}
function directional(seed,pairKey,fromProfile,toProfile,context,sharedCore){
  const tradeNeed=clamp01(
    fromProfile.tendencies.tradeOpenness*0.34+
    context.resourceComplementarity*0.28+
    Math.max(0,toProfile.wealth.value-fromProfile.wealth.value)*0.18+
    Math.max(0,toProfile.tendencies.infrastructure-fromProfile.tendencies.infrastructure)*0.10+
    unit(seed,"country-relations:trade-need:"+pairKey+":"+fromProfile.countryId)*0.10
  );
  const tradeReliance=clamp01(
    tradeNeed*0.58+
    sharedCore.tradeAccess*0.30+
    context.routeAccess*0.12
  );
  const dependency=clamp01(
    tradeReliance*0.48+
    Math.max(0,toProfile.wealth.value-fromProfile.wealth.value)*0.24+
    Math.max(0,toProfile.tendencies.militaryEmphasis-fromProfile.tendencies.militaryEmphasis)*0.12+
    unit(seed,"country-relations:dependency:"+pairKey+":"+fromProfile.countryId)*0.16
  );
  const leverage=clamp11(
    (fromProfile.wealth.value-toProfile.wealth.value)*0.35+
    (fromProfile.governance.administrativeCapacity-toProfile.governance.administrativeCapacity)*0.18+
    (fromProfile.tendencies.militaryEmphasis-toProfile.tendencies.militaryEmphasis)*0.27+
    (toProfile.tendencies.tradeOpenness-fromProfile.tendencies.tradeOpenness)*0.08+
    (unit(seed,"country-relations:leverage:"+pairKey+":"+fromProfile.countryId)-0.5)*0.12
  );
  return Object.freeze({
    fromCountryId:fromProfile.countryId,toCountryId:toProfile.countryId,
    tradeReliance:round(tradeReliance),
    dependency:round(dependency),
    leverage:round(leverage)
  });
}
function build(seedValue,countryAValue,countryBValue){
  const seed=String(seedValue==null?"":seedValue);
  const aId=typeof countryAValue==="object"?countryAValue?.id:countryAValue;
  const bId=typeof countryBValue==="object"?countryBValue?.id:countryBValue;
  const pair=canonicalPair(aId,bId);
  if(!pair)return null;
  const cacheKey=seed+"|"+pair.key;
  if(relationCache.has(cacheKey))return relationCache.get(cacheKey);

  const countryLow=PoliticalGeography.countryById(seed,pair.low);
  const countryHigh=PoliticalGeography.countryById(seed,pair.high);
  if(!countryLow||!countryHigh)return null;
  const profileLow=CountryProfile.build(seed,pair.low);
  const profileHigh=CountryProfile.build(seed,pair.high);
  if(!profileLow||!profileHigh)return null;
  const context=pairContext(seed,countryLow,countryHigh,profileLow,profileHigh);

  const avgTrade=(profileLow.tendencies.tradeOpenness+profileHigh.tendencies.tradeOpenness)/2;
  const avgMilitary=(profileLow.tendencies.militaryEmphasis+profileHigh.tendencies.militaryEmphasis)/2;
  const disposition=unit(seed,"country-relations:disposition:"+pair.key);
  const cooperationSeed=unit(seed,"country-relations:cooperation:"+pair.key);
  const rivalrySeed=unit(seed,"country-relations:rivalry:"+pair.key);
  const historicBias=(disposition-0.5)*1.36;
  const economicPull=avgTrade*0.24+context.resourceComplementarity*0.18+context.routeAccess*0.13;
  const securityDrag=avgMilitary*0.19+context.resourceCompetition*0.15+context.borderFriction*0.10;
  const score=clamp11(historicBias+economicPull-securityDrag+(context.adjacent?0.025:-0.06));
  const militaryTension=clamp01(
    0.08+
    avgMilitary*0.27+
    rivalrySeed*0.28+
    context.resourceCompetition*0.16+
    context.borderFriction*0.10+
    Math.max(0,-score)*0.26-
    cooperationSeed*0.08
  );
  const tradeAccess=clamp01(
    0.12+
    avgTrade*0.36+
    context.routeAccess*0.20+
    context.resourceComplementarity*0.16+
    Math.max(0,score)*0.18-
    militaryTension*0.14
  );
  const cooperation=clamp01(
    0.10+
    ((score+1)/2)*0.38+
    tradeAccess*0.23+
    cooperationSeed*0.18-
    militaryTension*0.15
  );
  const rivalry=clamp01(
    0.08+
    militaryTension*0.38+
    context.resourceCompetition*0.20+
    rivalrySeed*0.16+
    Math.max(0,-score)*0.24-
    cooperation*0.08
  );
  const borderOpenness=context.adjacent?clamp01(
    0.18+
    tradeAccess*0.36+
    cooperation*0.20+
    Math.max(0,score)*0.18-
    militaryTension*0.25-
    context.borderFriction*0.10
  ):0;
  const sharedCore=Object.freeze({
    relationshipScore:round(score),
    state:relationState(score,militaryTension,rivalry),
    tradeAccess:round(tradeAccess),
    militaryTension:round(militaryTension),
    borderOpenness:round(borderOpenness),
    cooperation:round(cooperation),
    rivalry:round(rivalry),
    warState:false
  });
  const lowToHigh=directional(seed,pair.key,profileLow,profileHigh,context,sharedCore);
  const highToLow=directional(seed,pair.key,profileHigh,profileLow,context,sharedCore);
  const powerLow=profileLow.wealth.value*0.36+profileLow.governance.administrativeCapacity*0.22+profileLow.tendencies.militaryEmphasis*0.42;
  const powerHigh=profileHigh.wealth.value*0.36+profileHigh.governance.administrativeCapacity*0.22+profileHigh.tendencies.militaryEmphasis*0.42;
  const powerGap=Math.abs(powerLow-powerHigh);
  const weakerId=powerLow<=powerHigh?pair.low:pair.high;
  const strongerId=weakerId===pair.low?pair.high:pair.low;
  const agreements=Object.freeze({
    nonAggression:Object.freeze({
      slot:"non-aggression",
      active:sharedCore.relationshipScore>-0.30&&sharedCore.militaryTension<0.60
    }),
    tradeAccord:Object.freeze({
      slot:"trade",
      active:sharedCore.tradeAccess>=0.62&&sharedCore.relationshipScore>-0.18&&sharedCore.militaryTension<0.68
    }),
    alliance:Object.freeze({
      slot:"alliance",
      active:sharedCore.cooperation>=0.72&&sharedCore.relationshipScore>=0.34&&sharedCore.militaryTension<0.46
    }),
    tributary:Object.freeze({
      slot:"tributary",
      active:powerGap>=0.30&&sharedCore.relationshipScore<=-0.12,
      payerCountryId:powerGap>=0.30&&sharedCore.relationshipScore<=-0.12?weakerId:null,
      receiverCountryId:powerGap>=0.30&&sharedCore.relationshipScore<=-0.12?strongerId:null
    })
  });
  const lowSummary=countrySummary(profileLow),highSummary=countrySummary(profileHigh);
  const record=Object.freeze({
    version:VERSION,
    id:"REL|"+hashText(seed+"|"+pair.key),
    revision:"DRF-"+hashText([
      VERSION,seed,pair.key,profileLow.revision,profileHigh.revision,
      context.borderId,context.routeAccess,context.resourceComplementarity,context.resourceCompetition,
      sharedCore.relationshipScore,sharedCore.tradeAccess,sharedCore.militaryTension,
      sharedCore.borderOpenness,sharedCore.cooperation,sharedCore.rivalry,
      lowToHigh.tradeReliance,highToLow.tradeReliance
    ].join("|")),
    pair:Object.freeze({lowCountryId:pair.low,highCountryId:pair.high,key:pair.key}),
    countries:Object.freeze({[pair.low]:lowSummary,[pair.high]:highSummary}),
    shared:sharedCore,
    agreements,
    context,
    directional:Object.freeze({[pair.low]:lowToHigh,[pair.high]:highToLow}),
    foundation:Object.freeze({
      source:"campaign-seed + stable-country-pair + fixed-geographic-economic-context",
      immutable:true,fantasyTimeDependent:false,
      countryProfileAuthority:"CountryProfile",
      politicalAuthority:"PoliticalGeography",
      dynamicOverlayCompatible:true,
      warDeclaration:false,treatyNegotiation:false,
      fullWorldMaterialized:false,lazy:true
    })
  });
  relationCache.set(cacheKey,record);
  return record;
}
function view(seedValue,fromCountryId,toCountryId){
  const relation=build(seedValue,fromCountryId,toCountryId);
  if(!relation)return null;
  const fromId=String(fromCountryId),toId=String(toCountryId);
  return Object.freeze({
    id:relation.id,revision:relation.revision,
    from:relation.countries[fromId],to:relation.countries[toId],
    shared:relation.shared,agreements:relation.agreements,context:relation.context,
    direction:relation.directional[fromId],reverseDirection:relation.directional[toId],
    foundation:relation.foundation
  });
}
function relationKind(record){
  const s=record.shared;
  if(s.tradeAccess>=0.60&&s.relationshipScore>=-0.12&&s.militaryTension<0.64)return "trade-friendly";
  if(s.militaryTension>=0.58&&s.rivalry>=0.52&&s.relationshipScore<=0.10)return "tense-rival";
  if(record.agreements.alliance.active)return "allied";
  return "mixed";
}
function relevantRelations(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const profiles=CountryProfile.sampleCountries(seed);
  const seen=new Set(),relations=[];
  for(const profile of profiles){
    const country=PoliticalGeography.countryById(seed,profile.countryId);
    if(!country)continue;
    for(const neighbor of PoliticalGeography.nearbyCountries(seed,country)){
      const pair=canonicalPair(country.id,neighbor.id);
      if(!pair||seen.has(pair.key))continue;
      seen.add(pair.key);
      const relation=build(seed,pair.low,pair.high);
      if(relation?.context.adjacent)relations.push(relation);
    }
  }
  return Object.freeze(relations.sort((a,b)=>a.id.localeCompare(b.id)));
}
function representatives(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const relations=[...relevantRelations(seed)];
  if(!relations.length)return Object.freeze([]);
  const picks=[];
  const add=(record,reason)=>{
    if(record&&!picks.some(item=>item.record.id===record.id))picks.push(Object.freeze({reason,record}));
  };
  const friendly=relations.filter(record=>relationKind(record)==="trade-friendly")
    .sort((a,b)=>
      (b.shared.tradeAccess+b.shared.relationshipScore*0.30+b.shared.cooperation*0.20)-
      (a.shared.tradeAccess+a.shared.relationshipScore*0.30+a.shared.cooperation*0.20)||
      a.id.localeCompare(b.id)
    )[0];
  const tense=relations.filter(record=>relationKind(record)==="tense-rival")
    .sort((a,b)=>
      (b.shared.militaryTension+b.shared.rivalry-b.shared.relationshipScore*0.35)-
      (a.shared.militaryTension+a.shared.rivalry-a.shared.relationshipScore*0.35)||
      a.id.localeCompare(b.id)
    )[0];
  add(friendly,"trade-friendly");
  add(tense,"tense-rival");
  add([...relations].sort((a,b)=>b.shared.borderOpenness-a.shared.borderOpenness||a.id.localeCompare(b.id))[0],"open-border");
  add([...relations].sort((a,b)=>{
    const depA=Math.abs(a.directional[a.pair.lowCountryId].dependency-a.directional[a.pair.highCountryId].dependency);
    const depB=Math.abs(b.directional[b.pair.lowCountryId].dependency-b.directional[b.pair.highCountryId].dependency);
    return depB-depA||a.id.localeCompare(b.id);
  })[0],"directional-dependency");
  for(const record of relations)if(picks.length<5)add(record,"mixed-context");
  return Object.freeze(picks.slice(0,5));
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const relations=relevantRelations(seed);
  const reps=representatives(seed);
  const repeated=reps.map(item=>Object.freeze({reason:item.reason,record:build(seed,item.record.pair.lowCountryId,item.record.pair.highCountryId)}));
  const deterministic=JSON.stringify(reps)===JSON.stringify(repeated);
  const reversedSymmetric=reps.every(item=>{
    const r=item.record;
    return JSON.stringify(build(seed,r.pair.lowCountryId,r.pair.highCountryId))===
      JSON.stringify(build(seed,r.pair.highCountryId,r.pair.lowCountryId));
  });
  const timeA=reps.map(item=>build(seed,item.record.pair.lowCountryId,item.record.pair.highCountryId,{year:1200,month:1,day:1}));
  const timeB=reps.map(item=>build(seed,item.record.pair.lowCountryId,item.record.pair.highCountryId,{year:1400,month:12,day:31}));
  const timeIndependent=JSON.stringify(timeA)===JSON.stringify(timeB);
  const numericValid=relations.every(record=>{
    const s=record.shared;
    return Number.isFinite(s.relationshipScore)&&s.relationshipScore>=-1&&s.relationshipScore<=1&&
      [s.tradeAccess,s.militaryTension,s.borderOpenness,s.cooperation,s.rivalry].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&
      Object.values(record.directional).every(d=>
        d.tradeReliance>=0&&d.tradeReliance<=1&&d.dependency>=0&&d.dependency<=1&&d.leverage>=-1&&d.leverage<=1
      );
  });
  const agreementSymmetry=relations.every(record=>
    typeof record.agreements.nonAggression.active==="boolean"&&
    typeof record.agreements.tradeAccord.active==="boolean"&&
    typeof record.agreements.alliance.active==="boolean"&&
    typeof record.agreements.tributary.active==="boolean"
  );
  const directionalSupported=relations.some(record=>{
    const a=record.directional[record.pair.lowCountryId],b=record.directional[record.pair.highCountryId];
    return Math.abs(a.tradeReliance-b.tradeReliance)>=0.01||Math.abs(a.dependency-b.dependency)>=0.01||Math.abs(a.leverage-b.leverage)>=0.01;
  });
  const tradeFriendlyCount=relations.filter(record=>relationKind(record)==="trade-friendly").length;
  const tenseRivalCount=relations.filter(record=>relationKind(record)==="tense-rival").length;
  const stateCount=new Set(relations.map(record=>record.shared.state)).size;
  const relationValueCount=new Set(relations.map(record=>record.shared.relationshipScore.toFixed(3))).size;
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const originRelations=relations.filter(record=>
    record.pair.lowCountryId===origin.id||record.pair.highCountryId===origin.id
  );
  const orientationSeparated=originRelations.length>=2&&new Set(originRelations.map(record=>record.shared.state)).size>=2&&
    originRelations.every(record=>record.countries[origin.id]?.profileRevision===CountryProfile.build(seed,origin.id).revision);
  const mercantileNotUniversal=relations.some(record=>{
    const ids=[record.pair.lowCountryId,record.pair.highCountryId];
    return ids.some(id=>record.countries[id].tradeOpenness>=0.62)&&record.shared.relationshipScore<0.20;
  });
  const militaristicNotWar=relations.some(record=>{
    const ids=[record.pair.lowCountryId,record.pair.highCountryId];
    return ids.some(id=>record.countries[id].militaryEmphasis>=0.70)&&record.shared.warState===false;
  });
  const adjacencyContext=relations.every(record=>record.context.adjacent&&record.context.borderId);
  const lazyQueryable=relations.every(record=>record.foundation.lazy&&!record.foundation.fullWorldMaterialized);
  const overlayReady=relations.every(record=>record.foundation.immutable&&record.foundation.dynamicOverlayCompatible&&!record.foundation.fantasyTimeDependent);
  const pass=Boolean(
    relations.length>=8&&reps.length>=4&&deterministic&&reversedSymmetric&&timeIndependent&&numericValid&&agreementSymmetry&&
    directionalSupported&&tradeFriendlyCount>=1&&tenseRivalCount>=1&&stateCount>=3&&relationValueCount>=5&&
    orientationSeparated&&mercantileNotUniversal&&militaristicNotWar&&adjacencyContext&&lazyQueryable&&overlayReady
  );
  return Object.freeze({
    pass,campaignSeed:seed,
    relationCount:relations.length,representativeCount:reps.length,
    deterministic,reversedSymmetric,timeIndependent,numericValid,agreementSymmetry,directionalSupported,
    tradeFriendlyCount,tenseRivalCount,stateCount,relationValueCount,
    orientationSeparated,mercantileNotUniversal,militaristicNotWar,adjacencyContext,lazyQueryable,overlayReady,
    representatives:reps,
    authority:"country-diplomacy-foundation",
    liveDiplomacy:false,warDeclarations:false,treatyNegotiation:false,
    countryProfileMutation:false,politicalMutation:false,renderDependency:false,fullWorldMaterialized:false
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value)*100)+"%"}
function signed(value){const n=Math.round(Number(value)*100);return (n>0?"+":"")+n}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderMetric(label,value,kind){
  const width=kind==="signed"?Math.round((clamp11(value)+1)*50):Math.round(clamp01(value)*100);
  const text=kind==="signed"?signed(value):percent(value);
  return "<div class=\"diplomacy-metric\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(text)+(kind==="signed"?"":"")+"</strong><i><b style=\"width:"+width+"%\"></b></i></div>";
}
function renderDebugPanel(seedValue,relationIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("countryRelationsProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,relation:null});
  const index=Math.abs(Number(relationIndexValue)||0)%verification.representatives.length;
  const selected=verification.representatives[index];
  const relation=selected.record;
  const low=relation.countries[relation.pair.lowCountryId],high=relation.countries[relation.pair.highCountryId];
  const select=root.querySelector("#countryRelationsSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>{
      const r=item.record,a=r.countries[r.pair.lowCountryId],b=r.countries[r.pair.highCountryId];
      return "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+
        escapeHtml(item.reason+" · "+a.countryName+" ↔ "+b.countryName)+"</option>";
    }).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    countryRelationsPair:low.countryName+" ↔ "+high.countryName,
    countryRelationsId:relation.id,
    countryRelationsState:relation.shared.state+" · score "+signed(relation.shared.relationshipScore),
    countryRelationsProfiles:
      low.countryName+": trade "+percent(low.tradeOpenness)+" / military "+percent(low.militaryEmphasis)+
      " · "+high.countryName+": trade "+percent(high.tradeOpenness)+" / military "+percent(high.militaryEmphasis),
    countryRelationsBorder:
      (relation.context.borderTerrain||"no shared border")+" · route "+percent(relation.context.routeAccess)+
      " · friction "+percent(relation.context.borderFriction),
    countryRelationsResources:
      "complement "+percent(relation.context.resourceComplementarity)+" · competition "+percent(relation.context.resourceCompetition),
    countryRelationsKind:selected.reason,
    countryRelationsRevision:relation.revision
  };
  for(const [id,value] of Object.entries(values)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const metrics=root.querySelector("#countryRelationsMetrics");
  if(metrics){
    const s=relation.shared;
    metrics.innerHTML=[
      ["Relationship",s.relationshipScore,"signed"],["Trade access",s.tradeAccess],["Military tension",s.militaryTension],
      ["Border openness",s.borderOpenness],["Cooperation",s.cooperation],["Rivalry",s.rivalry]
    ].map(([label,value,kind])=>renderMetric(label,value,kind)).join("");
  }
  const agreements=root.querySelector("#countryRelationsAgreements");
  if(agreements){
    agreements.innerHTML=[
      relation.agreements.nonAggression,relation.agreements.tradeAccord,relation.agreements.alliance,relation.agreements.tributary
    ].map(item=>
      "<span class=\"diplomacy-agreement "+(item.active?"active":"inactive")+"\">"+
      escapeHtml(item.slot)+" · "+(item.active?"ACTIVE":"slot open")+"</span>"
    ).join("");
  }
  const directions=root.querySelector("#countryRelationsDirections");
  if(directions){
    directions.innerHTML=[relation.pair.lowCountryId,relation.pair.highCountryId].map(id=>{
      const from=relation.countries[id],toId=id===relation.pair.lowCountryId?relation.pair.highCountryId:relation.pair.lowCountryId;
      const to=relation.countries[toId],d=relation.directional[id];
      return "<article><strong>"+escapeHtml(from.countryName+" → "+to.countryName)+"</strong>"+
        "<small>trade reliance "+escapeHtml(percent(d.tradeReliance))+" · dependency "+escapeHtml(percent(d.dependency))+
        " · leverage "+escapeHtml(signed(d.leverage))+"</small></article>";
    }).join("");
  }
  const comparison=root.querySelector("#countryRelationsComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.map(item=>{
      const r=item.record,a=r.countries[r.pair.lowCountryId],b=r.countries[r.pair.highCountryId];
      return "<li class=\""+(r.id===relation.id?"selected":"")+"\"><div><strong>"+escapeHtml(a.countryName+" ↔ "+b.countryName)+"</strong>"+
        "<small>"+escapeHtml(item.reason+" · "+r.shared.state)+"</small></div>"+
        "<span>R "+escapeHtml(signed(r.shared.relationshipScore))+"</span>"+
        "<span>Trade "+escapeHtml(percent(r.shared.tradeAccess))+"</span>"+
        "<span>Tension "+escapeHtml(percent(r.shared.militaryTension))+"</span>"+
        "<span>Open "+escapeHtml(percent(r.shared.borderOpenness))+"</span></li>";
    }).join("");
  }
  setCheck("vDiplomacyDeterministic",verification.deterministic&&verification.reversedSymmetric&&verification.timeIndependent);
  setCheck("vDiplomacyVariety",verification.tradeFriendlyCount>=1&&verification.tenseRivalCount>=1&&verification.stateCount>=3);
  setCheck("vDiplomacyOrientation",verification.orientationSeparated&&verification.mercantileNotUniversal&&verification.militaristicNotWar);
  setCheck("vDiplomacyContext",verification.adjacencyContext&&verification.numericValid);
  setCheck("vDiplomacySymmetry",verification.agreementSymmetry&&verification.directionalSupported);
  setCheck("vDiplomacyAuthority",verification.lazyQueryable&&verification.overlayReady&&!verification.liveDiplomacy&&!verification.warDeclarations&&!verification.treatyNegotiation&&!verification.countryProfileMutation&&!verification.politicalMutation&&!verification.renderDependency);
  root.dataset.relationIndex=String(index);
  root.dataset.relationId=relation.id;
  root.dataset.revision=relation.revision;
  root.dataset.kind=selected.reason;
  root.dataset.state=relation.shared.state;
  root.dataset.score=String(relation.shared.relationshipScore);
  root.dataset.trade=String(relation.shared.tradeAccess);
  root.dataset.tension=String(relation.shared.militaryTension);
  root.dataset.openness=String(relation.shared.borderOpenness);
  root.dataset.lowCountryId=relation.pair.lowCountryId;
  root.dataset.highCountryId=relation.pair.highCountryId;
  root.dataset.lowTradeOpenness=String(low.tradeOpenness);
  root.dataset.highTradeOpenness=String(high.tradeOpenness);
  root.dataset.lowMilitary=String(low.militaryEmphasis);
  root.dataset.highMilitary=String(high.militaryEmphasis);
  return Object.freeze({verification,relation,selected,index});
}

const api=Object.freeze({
  VERSION,build,relation:build,view,relevantRelations,representatives,proof,renderDebugPanel
});
window.CountryRelations=api;
window.DiplomacyFoundation=api;
})();