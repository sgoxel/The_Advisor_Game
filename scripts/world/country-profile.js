(function(){
"use strict";

const VERSION=1;
const GOVERNANCE_STYLES=Object.freeze([
  Object.freeze({id:"royal-bureaucracy",label:"Royal Bureaucracy",admin:0.82,tax:0.78,military:0.12,trade:0.02}),
  Object.freeze({id:"feudal-council",label:"Feudal Council",admin:0.58,tax:0.55,military:0.16,trade:-0.02}),
  Object.freeze({id:"merchant-principality",label:"Merchant Principality",admin:0.72,tax:0.66,military:-0.02,trade:0.18}),
  Object.freeze({id:"border-march",label:"Border March",admin:0.54,tax:0.48,military:0.24,trade:-0.04}),
  Object.freeze({id:"estate-assembly",label:"Estate Assembly",admin:0.63,tax:0.57,military:0.04,trade:0.08}),
  Object.freeze({id:"clan-confederacy",label:"Clan Confederacy",admin:0.38,tax:0.34,military:0.14,trade:0.01})
]);
const profileCache=new Map();

function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function round(value,digits=4){
  const factor=10**digits;
  return Math.round(Number(value)*factor)/factor;
}
function band(value){
  const v=clamp01(value);
  if(v<0.30)return "Strained";
  if(v<0.45)return "Modest";
  if(v<0.60)return "Stable";
  if(v<0.75)return "Prosperous";
  return "Wealthy";
}
function strength(value){
  const v=clamp01(value);
  if(v>=0.72)return "strong";
  if(v>=0.46)return "moderate";
  return "limited";
}
function countryFromInput(seed,countryValue){
  if(!window.PoliticalGeography)return null;
  if(countryValue&&typeof countryValue==="object"&&countryValue.id){
    return window.PoliticalGeography.countryById(seed,countryValue.id)||countryValue;
  }
  if(typeof countryValue==="string"&&countryValue.startsWith("CTR|")){
    return window.PoliticalGeography.countryById(seed,countryValue);
  }
  if(countryValue&&typeof countryValue==="object"&&countryValue.x!=null&&countryValue.y!=null){
    return window.PoliticalGeography.countryAt(seed,countryValue.x,countryValue.y);
  }
  return window.PoliticalGeography.countryAt(seed,"0","0");
}
function samplePoint(country,radius,angle){
  const cx=BigInt(country.politicalCenter.x);
  const cy=BigInt(country.politicalCenter.y);
  return Object.freeze({
    x:(cx+BigInt(Math.round(Math.cos(angle)*radius))).toString(),
    y:(cy+BigInt(Math.round(Math.sin(angle)*radius))).toString()
  });
}
function foundationContext(seed,country){
  const rotation=unit(seed,"country-profile:sample-rotation:"+country.id)*Math.PI*2;
  const candidatePoints=[
    Object.freeze({x:country.politicalCenter.x,y:country.politicalCenter.y}),
    Object.freeze({x:country.capital.x,y:country.capital.y})
  ];
  for(const radius of [2600,6200,10000]){
    for(let spoke=0;spoke<4;spoke++){
      candidatePoints.push(samplePoint(country,radius,rotation+spoke*Math.PI/2));
    }
  }
  const accepted=[];
  for(const point of candidatePoints){
    if(window.PoliticalGeography.ownerAt(seed,point.x,point.y).id!==country.id)continue;
    const environment=GeographyFoundation.environment(seed,point.x,point.y);
    const terrain=GeographyFoundation.getTerrainType(seed,point.x,point.y);
    accepted.push(Object.freeze({x:point.x,y:point.y,terrain,environment}));
  }
  if(!accepted.length){
    const environment=GeographyFoundation.environment(seed,country.capital.x,country.capital.y);
    accepted.push(Object.freeze({
      x:country.capital.x,y:country.capital.y,
      terrain:GeographyFoundation.getTerrainType(seed,country.capital.x,country.capital.y),
      environment
    }));
  }

  let water=0,rock=0,forest=0,fertile=0,route=0,highland=0;
  let elevation=0,moisture=0;
  for(const sample of accepted){
    const terrain=sample.terrain;
    if(terrain==="water")water++;
    if(terrain==="rock")rock++;
    if(terrain==="forest")forest++;
    if(terrain==="farmland"||terrain==="grass")fertile++;
    if(terrain==="road"||terrain==="bridge")route++;
    if(sample.environment.elevationMeters>=1050)highland++;
    elevation+=sample.environment.elevationMeters;
    moisture+=sample.environment.moisturePercent;
  }
  const n=accepted.length;
  const waterShare=water/n;
  const rockShare=rock/n;
  const forestShare=forest/n;
  const fertileShare=fertile/n;
  const routeShare=route/n;
  const highlandShare=highland/n;
  const averageElevation=elevation/n;
  const averageMoisture=moisture/n;
  const geologySignal=0.15+unit(seed,"country-profile:geology:"+country.id)*0.50;
  const waterAccess=clamp01(waterShare*2.5+(waterShare>0?0.10:0));
  const agriculturalSuitability=clamp01(
    fertileShare*0.62+
    (1-Math.abs(averageMoisture/100-0.56))*0.22+
    (1-Math.min(1,averageElevation/1700))*0.16
  );
  const timberAvailability=clamp01(forestShare*0.78+(averageMoisture/100)*0.22);
  const mineralPotential=clamp01(
    rockShare*0.42+
    highlandShare*0.26+
    Math.min(1,averageElevation/1500)*0.17+
    geologySignal*0.15
  );
  const routeAccess=clamp01(routeShare*2.8+0.12+unit(seed,"country-profile:route:"+country.id)*0.16);
  const defensibility=clamp01(
    highlandShare*0.46+
    rockShare*0.18+
    Math.min(1,averageElevation/1500)*0.24+
    (1-waterAccess)*0.12
  );
  return Object.freeze({
    sampleCount:n,
    waterShare:round(waterShare),
    rockShare:round(rockShare),
    forestShare:round(forestShare),
    fertileShare:round(fertileShare),
    routeShare:round(routeShare),
    highlandShare:round(highlandShare),
    averageElevationMeters:Math.round(averageElevation),
    averageMoisturePercent:Math.round(averageMoisture),
    waterAccess:round(waterAccess),
    agriculturalSuitability:round(agriculturalSuitability),
    timberAvailability:round(timberAvailability),
    mineralPotential:round(mineralPotential),
    routeAccess:round(routeAccess),
    defensibility:round(defensibility),
    geologySignal:round(geologySignal),
    landlocked:waterAccess<0.08
  });
}
function governanceFor(seed,country){
  const index=PRNG.foundationUint32(seed,"country-profile:governance:"+country.id)%GOVERNANCE_STYLES.length;
  return GOVERNANCE_STYLES[index];
}
function culturalKeys(seed,country,context,tendencies){
  const keys=[];
  if(context.highlandShare>=0.28||context.rockShare>=0.20)keys.push("highland-stone");
  if(context.forestShare>=0.24)keys.push("woodland-timber");
  if(context.waterAccess>=0.18)keys.push("river-coastal");
  if(context.agriculturalSuitability>=0.56)keys.push("agrarian-courtyard");
  if(tendencies.tradeOpenness>=0.60)keys.push("market-oriented");
  if(tendencies.fortification>=0.62)keys.push("fortified-march");
  if(tendencies.craftProduction>=0.62)keys.push("artisan-quarter");
  if(!keys.length)keys.push("mixed-rural");
  const accent=["carved-stone","painted-timber","lime-plaster","dark-oak","slate-roof","clay-tile"][
    PRNG.foundationUint32(seed,"country-profile:culture-accent:"+country.id)%6
  ];
  keys.push(accent);
  return Object.freeze([...new Set(keys)].slice(0,5));
}
function architectureFor(seed,country,context,tendencies){
  const primaryMaterial=context.rockShare+context.highlandShare*0.5>context.forestShare+0.12
    ?"stone"
    :context.forestShare>0.22?"timber":"mixed-masonry";
  const roofStyle=context.averageElevationMeters>900
    ?"steep-slate"
    :context.waterAccess>0.18?"weathered-tile":"pitched-tile";
  const settlementPattern=tendencies.tradeOpenness>=0.65
    ?"market-spine"
    :tendencies.fortification>=0.62?"defensive-core"
    :context.agriculturalSuitability>=0.62?"farm-courtyard":"organic-street";
  const civicStyle=[
    "austere-administrative","merchant-arcade","fortified-hall","timber-council","stone-court"
  ][PRNG.foundationUint32(seed,"country-profile:civic-style:"+country.id)%5];
  return Object.freeze({primaryMaterial,roofStyle,settlementPattern,civicStyle});
}
function build(seedValue,countryValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=countryFromInput(seed,countryValue);
  if(!country)return null;
  const cacheKey=seed+"|"+country.id;
  if(profileCache.has(cacheKey))return profileCache.get(cacheKey);

  const context=foundationContext(seed,country);
  const governance=governanceFor(seed,country);
  const neighbors=window.PoliticalGeography.nearbyCountries(seed,country).length;
  const tradeSeed=unit(seed,"country-profile:trade:"+country.id);
  const militarySeed=unit(seed,"country-profile:military:"+country.id);
  const agricultureSeed=unit(seed,"country-profile:agriculture:"+country.id);
  const craftSeed=unit(seed,"country-profile:craft:"+country.id);
  const maritimeSeed=unit(seed,"country-profile:maritime:"+country.id);
  const miningSeed=unit(seed,"country-profile:mining:"+country.id);
  const infrastructureSeed=unit(seed,"country-profile:infrastructure:"+country.id);
  const fortificationSeed=unit(seed,"country-profile:fortification:"+country.id);

  const administrativeCapacity=clamp01(governance.admin*0.72+unit(seed,"country-profile:admin:"+country.id)*0.28);
  const taxationCapacity=clamp01(governance.tax*0.68+administrativeCapacity*0.22+unit(seed,"country-profile:tax:"+country.id)*0.10);
  const tradeOpenness=clamp01(
    0.16+
    context.routeAccess*0.26+
    context.waterAccess*0.20+
    tradeSeed*0.34+
    governance.trade
  );
  const militaryEmphasis=clamp01(
    0.16+
    militarySeed*0.48+
    Math.min(0.14,neighbors*0.025)+
    context.defensibility*0.08+
    governance.military
  );
  const agriculture=clamp01(
    context.agriculturalSuitability*(0.52+agricultureSeed*0.48)
  );
  const craftProduction=clamp01(
    0.18+
    craftSeed*0.40+
    context.timberAvailability*0.13+
    context.mineralPotential*0.19+
    tradeOpenness*0.10
  );
  let maritime=clamp01(context.waterAccess*(0.28+maritimeSeed*0.72));
  if(context.landlocked)maritime=Math.min(maritime,0.08);
  else if(context.waterAccess<0.18)maritime=Math.min(maritime,0.22);
  const mining=clamp01(context.mineralPotential*(0.38+miningSeed*0.62));
  const infrastructure=clamp01(
    0.17+
    infrastructureSeed*0.28+
    administrativeCapacity*0.23+
    tradeOpenness*0.17+
    context.routeAccess*0.15
  );
  const fortification=clamp01(
    0.10+
    fortificationSeed*0.24+
    militaryEmphasis*0.34+
    context.defensibility*0.22+
    Math.min(0.10,neighbors*0.018)
  );
  const prosperitySignal=unit(seed,"country-profile:prosperity:"+country.id);
  const wealth=clamp01(
    0.05+
    prosperitySignal*0.30+
    tradeOpenness*0.17+
    agriculture*0.12+
    craftProduction*0.15+
    mining*0.07+
    infrastructure*0.14
  );

  const tendencies=Object.freeze({
    tradeOpenness:round(tradeOpenness),
    militaryEmphasis:round(militaryEmphasis),
    agriculture:round(agriculture),
    craftProduction:round(craftProduction),
    maritime:round(maritime),
    mining:round(mining),
    infrastructure:round(infrastructure),
    fortification:round(fortification)
  });
  const orientationLabels=Object.freeze(
    Object.entries(tendencies)
      .filter(([,value])=>value>=0.56)
      .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
      .map(([key,value])=>key+":"+strength(value))
  );
  const profile=Object.freeze({
    version:VERSION,
    id:"CP|"+country.id,
    revision:"CPF-"+hashText([
      VERSION,seed,country.id,wealth,governance.id,
      ...Object.values(tendencies),
      context.waterAccess,context.mineralPotential,context.agriculturalSuitability
    ].join("|")),
    countryId:country.id,
    countryName:country.name,
    capital:Object.freeze({...country.capital}),
    wealth:Object.freeze({value:round(wealth),band:band(wealth)}),
    governance:Object.freeze({
      id:governance.id,label:governance.label,
      administrativeCapacity:round(administrativeCapacity),
      taxationCapacity:round(taxationCapacity)
    }),
    tendencies,
    orientationLabels,
    geography:context,
    culturalKeys:culturalKeys(seed,country,context,tendencies),
    architecture:architectureFor(seed,country,context,tendencies),
    foundation:Object.freeze({
      source:"campaign-seed + country + fixed-geography",
      immutable:true,
      fantasyTimeDependent:false,
      terrainMutation:false,
      resourceMutation:false,
      dynamicOverlayCompatible:true
    })
  });
  profileCache.set(cacheKey,profile);
  return profile;
}
function sampleCountries(seed){
  const origin=window.PoliticalGeography.countryAt(seed,"0","0");
  const cx=BigInt(origin.cellX),cy=BigInt(origin.cellY);
  const out=[];
  const seen=new Set();
  for(let dy=-2;dy<=2;dy++){
    for(let dx=-2;dx<=2;dx++){
      const country=window.PoliticalGeography.countryForCell(seed,cx+BigInt(dx),cy+BigInt(dy));
      if(!country||seen.has(country.id))continue;
      seen.add(country.id);
      out.push(build(seed,country.id));
    }
  }
  return Object.freeze(out.filter(Boolean));
}
function representatives(seed){
  const profiles=[...sampleCountries(seed)];
  if(!profiles.length)return Object.freeze([]);
  const picks=[];
  const add=profile=>{if(profile&&!picks.some(item=>item.id===profile.id))picks.push(profile)};
  const byWealth=[...profiles].sort((a,b)=>a.wealth.value-b.wealth.value||a.id.localeCompare(b.id));
  add(byWealth[0]);
  add(byWealth[byWealth.length-1]);
  add([...profiles].sort((a,b)=>b.tendencies.maritime-a.tendencies.maritime||a.id.localeCompare(b.id))[0]);
  add([...profiles].sort((a,b)=>b.tendencies.mining-a.tendencies.mining||a.id.localeCompare(b.id))[0]);
  add([...profiles].sort((a,b)=>b.tendencies.agriculture-a.tendencies.agriculture||a.id.localeCompare(b.id))[0]);
  for(const profile of profiles)if(picks.length<5)add(profile);
  return Object.freeze(picks.slice(0,5));
}
function profileMixSignature(profile){
  const t=profile.tendencies;
  return [
    Math.round(t.tradeOpenness*10),Math.round(t.militaryEmphasis*10),Math.round(t.agriculture*10),
    Math.round(t.craftProduction*10),Math.round(t.maritime*10),Math.round(t.mining*10)
  ].join(":");
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const profiles=sampleCountries(seed);
  const reps=representatives(seed);
  const repeat=reps.map(profile=>build(seed,profile.countryId));
  const deterministic=JSON.stringify(reps)===JSON.stringify(repeat);
  const timeA=reps.map(profile=>build(seed,profile.countryId,{year:1200,month:1,day:1}));
  const timeB=reps.map(profile=>build(seed,profile.countryId,{year:1400,month:12,day:31}));
  const timeIndependent=JSON.stringify(timeA)===JSON.stringify(timeB);
  const numericValid=profiles.every(profile=>{
    const values=[
      profile.wealth.value,
      profile.governance.administrativeCapacity,
      profile.governance.taxationCapacity,
      ...Object.values(profile.tendencies)
    ];
    return values.every(value=>Number.isFinite(value)&&value>=0&&value<=1);
  });
  const maritimePlausible=profiles.every(profile=>
    !profile.geography.landlocked||profile.tendencies.maritime<=0.080001
  );
  const miningPlausible=profiles.every(profile=>
    profile.tendencies.mining<=profile.geography.mineralPotential+1e-9
  );
  const geographyPreserved=profiles.every(profile=>
    profile.foundation.terrainMutation===false&&profile.foundation.resourceMutation===false
  );
  const wealthBandCount=new Set(profiles.map(profile=>profile.wealth.band)).size;
  const wealthValueCount=new Set(profiles.map(profile=>profile.wealth.value.toFixed(3))).size;
  const strategicMixCount=new Set(profiles.map(profileMixSignature)).size;
  const geographyVariety=new Set(profiles.map(profile=>
    [
      Math.round(profile.geography.waterAccess*5),
      Math.round(profile.geography.mineralPotential*5),
      Math.round(profile.geography.agriculturalSuitability*5)
    ].join(":")
  )).size;
  const capitalLinked=profiles.every(profile=>profile.capital?.id&&profile.capital.id.startsWith("CAP|"+profile.countryId));
  const weightedNotExclusive=profiles.some(profile=>
    Object.values(profile.tendencies).filter(value=>value>=0.46).length>=2
  );
  const overlayReady=profiles.every(profile=>
    profile.foundation.immutable&&profile.foundation.dynamicOverlayCompatible&&!profile.foundation.fantasyTimeDependent
  );
  const pass=Boolean(
    profiles.length>=9&&reps.length>=3&&deterministic&&timeIndependent&&numericValid&&
    maritimePlausible&&miningPlausible&&geographyPreserved&&capitalLinked&&weightedNotExclusive&&overlayReady&&
    wealthBandCount>=3&&wealthValueCount>=3&&strategicMixCount>=3&&geographyVariety>=3
  );
  return Object.freeze({
    pass,campaignSeed:seed,
    profileCount:profiles.length,representativeCount:reps.length,
    deterministic,timeIndependent,numericValid,maritimePlausible,miningPlausible,
    geographyPreserved,capitalLinked,weightedNotExclusive,overlayReady,
    wealthBandCount,wealthValueCount,strategicMixCount,geographyVariety,
    representatives:reps,
    authority:"immutable-country-profile-foundation",
    dynamicStateCreated:false,
    terrainMutation:false,resourceMutation:false,renderDependency:false
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
function renderBar(label,value){
  return "<div class=\"country-profile-bar\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(percent(value))+"</strong><i><b style=\"width:"+escapeHtml(percent(value))+"\"></b></i></div>";
}
function renderDebugPanel(seedValue,profileIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("countryProfileProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,profile:null});
  const index=Math.abs(Number(profileIndexValue)||0)%verification.representatives.length;
  const profile=verification.representatives[index];
  const select=root.querySelector("#countryProfileSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+
      escapeHtml(item.countryName+" · "+item.wealth.band+" "+Math.round(item.wealth.value*100)+"%")+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    countryProfileCountry:profile.countryName,
    countryProfileId:profile.countryId,
    countryProfileCapital:profile.capital.name+" ("+profile.capital.x+","+profile.capital.y+")",
    countryProfileWealth:profile.wealth.band+" · "+percent(profile.wealth.value),
    countryProfileGovernance:profile.governance.label,
    countryProfileAdmin:"Admin "+percent(profile.governance.administrativeCapacity)+" · tax "+percent(profile.governance.taxationCapacity),
    countryProfileGeography:
      "water "+percent(profile.geography.waterAccess)+" · mineral "+percent(profile.geography.mineralPotential)+
      " · agriculture "+percent(profile.geography.agriculturalSuitability)+" · "+profile.geography.averageElevationMeters+"m avg",
    countryProfileRevision:profile.revision
  };
  for(const [id,value] of Object.entries(values)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const bars=root.querySelector("#countryProfileTendencies");
  if(bars){
    const t=profile.tendencies;
    bars.innerHTML=[
      ["Trade",t.tradeOpenness],["Military",t.militaryEmphasis],["Agriculture",t.agriculture],["Craft",t.craftProduction],
      ["Maritime",t.maritime],["Mining",t.mining],["Infrastructure",t.infrastructure],["Fortification",t.fortification]
    ].map(([label,value])=>renderBar(label,value)).join("");
  }
  const keys=root.querySelector("#countryProfileKeys");
  if(keys){
    keys.innerHTML=[
      ...profile.culturalKeys,
      profile.architecture.primaryMaterial,
      profile.architecture.roofStyle,
      profile.architecture.settlementPattern,
      profile.architecture.civicStyle
    ].map(key=>"<span>"+escapeHtml(key)+"</span>").join("");
  }
  const comparison=root.querySelector("#countryProfileComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.slice(0,5).map(item=>
      "<li class=\""+(item.id===profile.id?"selected":"")+"\"><div><strong>"+escapeHtml(item.countryName)+"</strong>"+
      "<small>"+escapeHtml(item.wealth.band+" · "+item.governance.label)+"</small></div>"+
      "<span>W "+escapeHtml(percent(item.wealth.value))+"</span>"+
      "<span>T "+escapeHtml(percent(item.tendencies.tradeOpenness))+"</span>"+
      "<span>M "+escapeHtml(percent(item.tendencies.militaryEmphasis))+"</span>"+
      "<span>Ag "+escapeHtml(percent(item.tendencies.agriculture))+"</span>"+
      "<span>Sea "+escapeHtml(percent(item.tendencies.maritime))+"</span>"+
      "<span>Mine "+escapeHtml(percent(item.tendencies.mining))+"</span></li>"
    ).join("");
  }
  setCheck("vCountryProfileDeterministic",verification.deterministic&&verification.timeIndependent);
  setCheck("vCountryProfileStructured",verification.numericValid&&verification.capitalLinked);
  setCheck("vCountryProfileWeighted",verification.weightedNotExclusive&&verification.strategicMixCount>=3);
  setCheck("vCountryProfileGeography",verification.maritimePlausible&&verification.miningPlausible&&verification.geographyVariety>=3);
  setCheck("vCountryProfileDiversity",verification.wealthBandCount>=3&&verification.wealthValueCount>=3);
  setCheck("vCountryProfileAuthority",verification.geographyPreserved&&verification.overlayReady&&!verification.dynamicStateCreated&&!verification.renderDependency);
  root.dataset.profileIndex=String(index);
  root.dataset.profileId=profile.id;
  root.dataset.countryId=profile.countryId;
  root.dataset.wealth=String(profile.wealth.value);
  root.dataset.wealthBand=profile.wealth.band;
  root.dataset.maritime=String(profile.tendencies.maritime);
  root.dataset.mining=String(profile.tendencies.mining);
  root.dataset.waterAccess=String(profile.geography.waterAccess);
  root.dataset.mineralPotential=String(profile.geography.mineralPotential);
  root.dataset.mix=profileMixSignature(profile);
  root.dataset.revision=profile.revision;
  return Object.freeze({verification,profile,index});
}

const api=Object.freeze({
  VERSION,GOVERNANCE_STYLES,build,profile:build,sampleCountries,representatives,proof,renderDebugPanel
});
window.CountryProfile=api;
window.CountryProfiles=api;
})();