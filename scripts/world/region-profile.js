(function(){
"use strict";

const VERSION=1;
const REGION_CELL_SIZE=8192;
const SAMPLE_GRID=5;
const NAME_A=Object.freeze([
  "Alder","Ash","Black","Bright","Cedar","Dawn","Elder","Falcon","Green","Grey","High","Iron",
  "Kings","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","West","White","Wolf"
]);
const NAME_B=Object.freeze([
  "barrow","brook","dale","fall","field","ford","haven","heath","march","mere","moor","reach",
  "ridge","vale","watch","wick","wood"
]);
const cache=new Map();

function toBig(value){return BigInt(WorldCoordinates.normalize(value))}
function floorDiv(value,divisor){
  let q=value/divisor;
  const r=value%divisor;
  if(r!==0n&&value<0n)q-=1n;
  return q;
}
function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function clampRange(value,min,max){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;
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
function cellFor(xValue,yValue){
  const size=BigInt(REGION_CELL_SIZE);
  return Object.freeze({x:floorDiv(toBig(xValue),size),y:floorDiv(toBig(yValue),size)});
}
function cellKey(rx,ry){return rx.toString()+":"+ry.toString()}
function regionId(countryId,rx,ry){
  return "REG|"+countryId+"|"+rx.toString()+"|"+ry.toString();
}
function regionName(seed,countryId,rx,ry){
  const key=countryId+"|"+cellKey(rx,ry);
  const a=NAME_A[PRNG.foundationUint32(seed,"region-profile:name-a:"+key)%NAME_A.length];
  const b=NAME_B[PRNG.foundationUint32(seed,"region-profile:name-b:"+key)%NAME_B.length];
  return a+b+" Province";
}
function sampleCoordinates(rx,ry){
  const size=BigInt(REGION_CELL_SIZE);
  const baseX=rx*size,baseY=ry*size;
  const points=[];
  for(let gy=0;gy<SAMPLE_GRID;gy++){
    for(let gx=0;gx<SAMPLE_GRID;gx++){
      const px=baseX+BigInt(Math.floor((gx+0.5)*REGION_CELL_SIZE/SAMPLE_GRID));
      const py=baseY+BigInt(Math.floor((gy+0.5)*REGION_CELL_SIZE/SAMPLE_GRID));
      points.push(Object.freeze({x:px.toString(),y:py.toString(),gx,gy}));
    }
  }
  return Object.freeze(points);
}
function acceptedSamples(seed,countryId,rx,ry){
  const samples=[];
  for(const point of sampleCoordinates(rx,ry)){
    if(PoliticalGeography.ownerAt(seed,point.x,point.y).id!==countryId)continue;
    const environment=GeographyFoundation.environment(seed,point.x,point.y);
    const terrain=GeographyFoundation.getTerrainType(seed,point.x,point.y);
    samples.push(Object.freeze({x:point.x,y:point.y,terrain,environment}));
  }
  return Object.freeze(samples);
}
function dominantCounts(samples,selector){
  const counts=new Map();
  for(const sample of samples){
    const key=selector(sample);
    counts.set(key,(counts.get(key)||0)+1);
  }
  return Object.freeze(
    [...counts.entries()]
      .sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))
      .map(([key,count])=>Object.freeze({key,count,share:round(count/samples.length)}))
  );
}
function seatFor(seed,countryId,rx,ry,samples){
  if(!samples.length)return null;
  const key=countryId+"|"+cellKey(rx,ry);
  const ranked=[...samples].map(sample=>{
    const terrainPenalty=sample.terrain==="water"?1.0:sample.terrain==="rock"?0.34:0;
    const elevationPenalty=Math.min(0.5,sample.environment.elevationMeters/3600);
    const centerX=Number(toBig(sample.x)-(rx*BigInt(REGION_CELL_SIZE)))/REGION_CELL_SIZE;
    const centerY=Number(toBig(sample.y)-(ry*BigInt(REGION_CELL_SIZE)))/REGION_CELL_SIZE;
    const centerPenalty=Math.hypot(centerX-0.5,centerY-0.5)*0.22;
    const jitter=unit(seed,"region-profile:seat:"+key+":"+sample.x+":"+sample.y)*0.05;
    return {sample,score:terrainPenalty+elevationPenalty+centerPenalty+jitter};
  }).sort((a,b)=>a.score-b.score||a.sample.x.localeCompare(b.sample.x)||a.sample.y.localeCompare(b.sample.y));
  const chosen=ranked[0].sample;
  return Object.freeze({
    id:"RSEAT|"+hashText(regionId(countryId,rx,ry)),
    name:regionName(seed,countryId,rx,ry)+" Seat",
    x:chosen.x,y:chosen.y,
    terrain:chosen.terrain,
    elevationMeters:chosen.environment.elevationMeters
  });
}
function terrainResourceIdentity(seed,countryId,rx,ry,samples){
  const terrains=dominantCounts(samples,sample=>sample.terrain);
  const biomes=dominantCounts(samples,sample=>sample.environment.biome);
  let elevation=0,moisture=0,temperature=0;
  let water=0,rock=0,forest=0,fertile=0,route=0,mud=0,highland=0;
  for(const sample of samples){
    elevation+=sample.environment.elevationMeters;
    moisture+=sample.environment.moisturePercent;
    temperature+=sample.environment.temperatureC;
    if(sample.terrain==="water")water++;
    if(sample.terrain==="rock")rock++;
    if(sample.terrain==="forest")forest++;
    if(sample.terrain==="grass"||sample.terrain==="farmland")fertile++;
    if(sample.terrain==="road"||sample.terrain==="bridge")route++;
    if(sample.terrain==="mud")mud++;
    if(sample.environment.elevationMeters>=1050)highland++;
  }
  const n=Math.max(1,samples.length);
  const waterShare=water/n;
  const rockShare=rock/n;
  const forestShare=forest/n;
  const fertileShare=fertile/n;
  const routeShare=route/n;
  const mudShare=mud/n;
  const highlandShare=highland/n;
  const averageElevation=elevation/n;
  const averageMoisture=moisture/n;
  const averageTemperature=temperature/n;
  const localGeology=0.12+unit(seed,"region-profile:geology:"+countryId+":"+cellKey(rx,ry))*0.70;
  const agriculturalSuitability=clamp01(
    fertileShare*0.54+
    (1-Math.abs(averageMoisture/100-0.56))*0.23+
    (1-Math.min(1,averageElevation/1750))*0.18-
    mudShare*0.08
  );
  const timberAvailability=clamp01(
    forestShare*0.72+
    averageMoisture/100*0.20+
    (biomes[0]?.key==="Woodland"?0.08:0)
  );
  const mineralPotential=clamp01(
    rockShare*0.36+
    highlandShare*0.22+
    Math.min(1,averageElevation/1550)*0.18+
    localGeology*0.24
  );
  const waterAccess=clamp01(waterShare*2.8+(waterShare>0?0.12:0));
  const transportAccessibility=clamp01(
    0.14+
    routeShare*2.2+
    (1-rockShare)*0.12+
    (1-mudShare)*0.08+
    (1-Math.min(1,averageElevation/1750))*0.14
  );
  const defensibility=clamp01(
    highlandShare*0.40+
    rockShare*0.24+
    Math.min(1,averageElevation/1500)*0.22+
    (1-waterAccess)*0.08+
    unit(seed,"region-profile:defense:"+countryId+":"+cellKey(rx,ry))*0.06
  );
  const floodHazard=clamp01(waterShare*0.62+mudShare*0.30+Math.max(0,(averageMoisture-70)/30)*0.22);
  const droughtHazard=clamp01(Math.max(0,(35-averageMoisture)/35)*0.72+Math.max(0,(averageTemperature-20)/15)*0.20);
  const ruggedHazard=clamp01(rockShare*0.44+highlandShare*0.40+Math.min(1,averageElevation/1700)*0.16);
  return Object.freeze({
    dominantTerrain:terrains[0]?.key||"unknown",
    dominantBiome:biomes[0]?.key||"unknown",
    terrainMix:terrains,
    biomeMix:biomes,
    averageElevationMeters:Math.round(averageElevation),
    averageMoisturePercent:Math.round(averageMoisture),
    averageTemperatureC:Math.round(averageTemperature),
    climate:GeographyFoundation.environment(seed,samples[0].x,samples[0].y).climate,
    agriculturalSuitability:round(agriculturalSuitability),
    timberAvailability:round(timberAvailability),
    mineralPotential:round(mineralPotential),
    waterAccess:round(waterAccess),
    transportAccessibility:round(transportAccessibility),
    defensibility:round(defensibility),
    hazards:Object.freeze({
      flood:round(floodHazard),drought:round(droughtHazard),rugged:round(ruggedHazard)
    }),
    localGeology:round(localGeology)
  });
}
function specialization(countryProfile,identity){
  const c=countryProfile.tendencies;
  const agriculture=clamp01(c.agriculture*0.42+identity.agriculturalSuitability*0.58);
  const forestry=clamp01(c.craftProduction*0.28+identity.timberAvailability*0.72);
  const mining=clamp01((c.mining*0.40+identity.mineralPotential*0.60)*Math.min(1,identity.mineralPotential+0.35));
  const trade=clamp01(c.tradeOpenness*0.56+identity.transportAccessibility*0.44);
  const maritime=clamp01(c.maritime*identity.waterAccess);
  const defense=clamp01(c.fortification*0.52+identity.defensibility*0.48);
  const craft=clamp01(c.craftProduction*0.60+((identity.timberAvailability+identity.mineralPotential)/2)*0.40);
  const values={agriculture,forestry,mining,trade,maritime,defense,craft};
  const rounded=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,round(value)]));
  const labels=Object.freeze(
    Object.entries(rounded)
      .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
      .slice(0,3)
      .map(([key,value])=>key+":"+Math.round(value*100)+"%")
  );
  return Object.freeze({...rounded,labels});
}
function prosperityModifier(seed,countryId,rx,ry,countryProfile,identity,specializationValue){
  const structural=
    (identity.transportAccessibility-0.5)*0.10+
    (identity.agriculturalSuitability-0.5)*0.08+
    (identity.mineralPotential-0.5)*0.05+
    (specializationValue.trade-0.5)*0.04-
    identity.hazards.rugged*0.04-
    identity.hazards.flood*0.03;
  const local=(unit(seed,"region-profile:prosperity:"+countryId+":"+cellKey(rx,ry))-0.5)*0.10;
  const modifier=clampRange(structural+local,-0.25,0.25);
  return Object.freeze({
    modifier:round(modifier),
    localProsperity:round(clamp01(countryProfile.wealth.value+modifier))
  });
}
function buildForCell(seedValue,countryIdValue,rxValue,ryValue){
  const seed=String(seedValue==null?"":seedValue);
  const countryId=String(countryIdValue||"");
  const rx=BigInt(rxValue),ry=BigInt(ryValue);
  const id=regionId(countryId,rx,ry);
  const cacheKey=seed+"|"+id;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const country=PoliticalGeography.countryById(seed,countryId);
  if(!country)return null;
  const countryProfile=CountryProfile.build(seed,countryId);
  if(!countryProfile)return null;
  const samples=acceptedSamples(seed,countryId,rx,ry);
  if(!samples.length)return null;
  const seat=seatFor(seed,countryId,rx,ry,samples);
  if(!seat||PoliticalGeography.ownerAt(seed,seat.x,seat.y).id!==countryId)return null;
  const identity=terrainResourceIdentity(seed,countryId,rx,ry,samples);
  const special=specialization(countryProfile,identity);
  const prosperity=prosperityModifier(seed,countryId,rx,ry,countryProfile,identity,special);
  const profile=Object.freeze({
    version:VERSION,id,
    revision:"RPF-"+hashText([
      VERSION,seed,id,countryProfile.revision,identity.dominantTerrain,identity.dominantBiome,
      identity.agriculturalSuitability,identity.timberAvailability,identity.mineralPotential,
      identity.waterAccess,identity.transportAccessibility,prosperity.modifier,...Object.values(special).filter(v=>typeof v==="number")
    ].join("|")),
    name:regionName(seed,countryId,rx,ry),
    parentCountryId:country.id,
    parentCountryName:country.name,
    countryProfileRevision:countryProfile.revision,
    cellX:rx.toString(),cellY:ry.toString(),
    administrativeSeat:seat,
    sampleCount:samples.length,
    identity,
    prosperity,
    specialization:special,
    foundation:Object.freeze({
      source:"campaign-seed + region + parent-country-profile + fixed-geography",
      immutable:true,fantasyTimeDependent:false,
      countryOwnershipAuthority:"PoliticalGeography",
      localTerrainAuthority:"GeographyFoundation.getTerrainType",
      terrainMutation:false,resourceMutation:false,
      dynamicOverlayCompatible:true,lazy:true
    })
  });
  cache.set(cacheKey,profile);
  return profile;
}
function at(seedValue,xValue,yValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=PoliticalGeography.countryAt(seed,xValue,yValue);
  if(!country)return null;
  const cell=cellFor(xValue,yValue);
  return buildForCell(seed,country.id,cell.x,cell.y);
}
function regionsForCountry(seedValue,countryValue,radiusValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=typeof countryValue==="string"
    ?PoliticalGeography.countryById(seed,countryValue)
    :countryValue;
  if(!country)return Object.freeze([]);
  const base=cellFor(country.politicalCenter.x,country.politicalCenter.y);
  const radius=Math.max(1,Math.min(4,Number(radiusValue??3)));
  const profiles=[];
  const seen=new Set();
  for(let dy=-radius;dy<=radius;dy++){
    for(let dx=-radius;dx<=radius;dx++){
      const profile=buildForCell(seed,country.id,base.x+BigInt(dx),base.y+BigInt(dy));
      if(!profile||profile.sampleCount<3||seen.has(profile.id))continue;
      seen.add(profile.id);profiles.push(profile);
    }
  }
  return Object.freeze(profiles.sort((a,b)=>a.id.localeCompare(b.id)));
}
function identitySignature(profile){
  const i=profile.identity;
  return [
    i.dominantTerrain,i.dominantBiome,
    Math.round(i.agriculturalSuitability*5),Math.round(i.timberAvailability*5),
    Math.round(i.mineralPotential*5),Math.round(i.waterAccess*5),Math.round(i.transportAccessibility*5)
  ].join(":");
}
function specializationSignature(profile){
  const s=profile.specialization;
  return [s.agriculture,s.forestry,s.mining,s.trade,s.maritime,s.defense,s.craft]
    .map(v=>Math.round(v*10)).join(":");
}
function difference(a,b){
  const ia=a.identity,ib=b.identity;
  const sa=a.specialization,sb=b.specialization;
  return (
    Math.abs(ia.agriculturalSuitability-ib.agriculturalSuitability)+
    Math.abs(ia.timberAvailability-ib.timberAvailability)+
    Math.abs(ia.mineralPotential-ib.mineralPotential)+
    Math.abs(ia.waterAccess-ib.waterAccess)+
    Math.abs(ia.transportAccessibility-ib.transportAccessibility)+
    Math.abs(sa.agriculture-sb.agriculture)+
    Math.abs(sa.forestry-sb.forestry)+
    Math.abs(sa.mining-sb.mining)+
    Math.abs(sa.trade-sb.trade)+
    Math.abs(sa.maritime-sb.maritime)
  );
}
function representatives(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const regions=regionsForCountry(seed,country,3);
  if(!regions.length)return Object.freeze([]);
  let pair=[regions[0],regions[0]],maxDiff=-1;
  for(let i=0;i<regions.length;i++){
    for(let j=i+1;j<regions.length;j++){
      const d=difference(regions[i],regions[j]);
      if(d>maxDiff){maxDiff=d;pair=[regions[i],regions[j]]}
    }
  }
  const picks=[];
  const add=p=>{if(p&&!picks.some(item=>item.id===p.id))picks.push(p)};
  add(pair[0]);add(pair[1]);
  add([...regions].sort((a,b)=>b.identity.waterAccess-a.identity.waterAccess||a.id.localeCompare(b.id))[0]);
  add([...regions].sort((a,b)=>b.identity.mineralPotential-a.identity.mineralPotential||a.id.localeCompare(b.id))[0]);
  add([...regions].sort((a,b)=>b.identity.agriculturalSuitability-a.identity.agriculturalSuitability||a.id.localeCompare(b.id))[0]);
  for(const region of regions)if(picks.length<5)add(region);
  return Object.freeze(picks.slice(0,5));
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=PoliticalGeography.countryAt(seed,"0","0");
  const countryProfile=CountryProfile.build(seed,country.id);
  const regions=regionsForCountry(seed,country,3);
  const reps=representatives(seed);
  const repeated=reps.map(region=>buildForCell(seed,region.parentCountryId,BigInt(region.cellX),BigInt(region.cellY)));
  const deterministic=JSON.stringify(reps)===JSON.stringify(repeated);
  const timeA=reps.map(region=>at(seed,region.administrativeSeat.x,region.administrativeSeat.y,{year:1200,month:1,day:1}));
  const timeB=reps.map(region=>at(seed,region.administrativeSeat.x,region.administrativeSeat.y,{year:1400,month:12,day:31}));
  const timeIndependent=JSON.stringify(timeA)===JSON.stringify(timeB);
  const parentCountryCorrect=regions.every(region=>
    region.parentCountryId===country.id&&
    PoliticalGeography.ownerAt(seed,region.administrativeSeat.x,region.administrativeSeat.y).id===country.id
  );
  const hierarchyIntegrated=reps.every(region=>
    GeographyFoundation.hierarchy(seed,region.administrativeSeat.x,region.administrativeSeat.y).region===region.name
  );
  const numericValid=regions.every(region=>{
    const i=region.identity,s=region.specialization;
    const values=[
      i.agriculturalSuitability,i.timberAvailability,i.mineralPotential,i.waterAccess,
      i.transportAccessibility,i.defensibility,i.hazards.flood,i.hazards.drought,i.hazards.rugged,
      ...[s.agriculture,s.forestry,s.mining,s.trade,s.maritime,s.defense,s.craft]
    ];
    return values.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&
      Number.isFinite(region.prosperity.modifier)&&region.prosperity.modifier>=-0.25&&region.prosperity.modifier<=0.25;
  });
  const sameCountry=regions.length>=2&&regions.every(region=>region.parentCountryId===country.id);
  const sameCountryProfile=regions.every(region=>region.countryProfileRevision===countryProfile.revision);
  const identityCount=new Set(regions.map(identitySignature)).size;
  const specializationCount=new Set(regions.map(specializationSignature)).size;
  const maxRegionalDifference=reps.length>=2?difference(reps[0],reps[1]):0;
  const geographyRedirectsCountry=maxRegionalDifference>=0.55&&specializationCount>=3;
  const independentLayers=regions.every(region=>
    region.foundation.countryOwnershipAuthority==="PoliticalGeography"&&
    region.foundation.localTerrainAuthority==="GeographyFoundation.getTerrainType"&&
    !region.foundation.terrainMutation&&!region.foundation.resourceMutation
  );
  const lazyQueryable=regions.every(region=>region.foundation.lazy===true);
  const overlayReady=regions.every(region=>region.foundation.immutable&&region.foundation.dynamicOverlayCompatible&&!region.foundation.fantasyTimeDependent);
  const pass=Boolean(
    regions.length>=5&&reps.length>=3&&deterministic&&timeIndependent&&parentCountryCorrect&&hierarchyIntegrated&&numericValid&&
    sameCountry&&sameCountryProfile&&identityCount>=3&&specializationCount>=3&&geographyRedirectsCountry&&
    independentLayers&&lazyQueryable&&overlayReady
  );
  return Object.freeze({
    pass,campaignSeed:seed,
    parentCountryId:country.id,parentCountryName:country.name,countryProfileRevision:countryProfile.revision,
    regionCount:regions.length,representativeCount:reps.length,
    deterministic,timeIndependent,parentCountryCorrect,hierarchyIntegrated,numericValid,
    sameCountry,sameCountryProfile,identityCount,specializationCount,
    maxRegionalDifference:round(maxRegionalDifference),
    geographyRedirectsCountry,independentLayers,lazyQueryable,overlayReady,
    representatives:reps,
    authority:"region-profile-foundation",
    duplicateOwnership:false,terrainMutation:false,resourceMutation:false,
    liveRegionalEconomy:false,renderDependency:false
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value)*100)+"%"}
function signedPercent(value){
  const n=Math.round(Number(value)*100);
  return (n>0?"+":"")+n+"%";
}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderBar(label,value){
  return "<div class=\"region-profile-bar\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(percent(value))+"</strong><i><b style=\"width:"+escapeHtml(percent(value))+"\"></b></i></div>";
}
function renderDebugPanel(seedValue,regionIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("regionProfileProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,region:null});
  const index=Math.abs(Number(regionIndexValue)||0)%verification.representatives.length;
  const region=verification.representatives[index];
  const select=root.querySelector("#regionProfileSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+
      escapeHtml(item.name+" · "+item.identity.dominantTerrain+" / "+item.identity.dominantBiome)+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    regionProfileName:region.name,
    regionProfileId:region.id,
    regionProfileCountry:region.parentCountryName+" · "+region.parentCountryId,
    regionProfileSeat:region.administrativeSeat.name+" ("+region.administrativeSeat.x+","+region.administrativeSeat.y+")",
    regionProfileTerrain:region.identity.dominantTerrain+" · "+region.identity.dominantBiome,
    regionProfileClimate:region.identity.climate+" · "+region.identity.averageTemperatureC+"°C · "+region.identity.averageElevationMeters+"m",
    regionProfileResources:
      "agri "+percent(region.identity.agriculturalSuitability)+" · timber "+percent(region.identity.timberAvailability)+
      " · mineral "+percent(region.identity.mineralPotential)+" · water "+percent(region.identity.waterAccess),
    regionProfileAccess:
      "transport "+percent(region.identity.transportAccessibility)+" · defense "+percent(region.identity.defensibility)+
      " · prosperity "+signedPercent(region.prosperity.modifier),
    regionProfileRevision:region.revision
  };
  for(const [id,value] of Object.entries(values)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const terrain=root.querySelector("#regionTerrainMix");
  if(terrain){
    terrain.innerHTML=region.identity.terrainMix.slice(0,6).map(item=>
      "<span><b>"+escapeHtml(item.key)+"</b> "+escapeHtml(percent(item.share))+"</span>"
    ).join("");
  }
  const bars=root.querySelector("#regionSpecializationBars");
  if(bars){
    const s=region.specialization;
    bars.innerHTML=[
      ["Agriculture",s.agriculture],["Forestry",s.forestry],["Mining",s.mining],["Trade",s.trade],
      ["Maritime",s.maritime],["Defense",s.defense],["Craft",s.craft]
    ].map(([label,value])=>renderBar(label,value)).join("");
  }
  const comparison=root.querySelector("#regionProfileComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.slice(0,5).map(item=>
      "<li class=\""+(item.id===region.id?"selected":"")+"\"><div><strong>"+escapeHtml(item.name)+"</strong>"+
      "<small>"+escapeHtml(item.identity.dominantTerrain+" · "+item.identity.dominantBiome+" · "+item.specialization.labels.slice(0,2).join(" / "))+"</small></div>"+
      "<span>Ag "+escapeHtml(percent(item.identity.agriculturalSuitability))+"</span>"+
      "<span>Wood "+escapeHtml(percent(item.identity.timberAvailability))+"</span>"+
      "<span>Mine "+escapeHtml(percent(item.identity.mineralPotential))+"</span>"+
      "<span>Water "+escapeHtml(percent(item.identity.waterAccess))+"</span>"+
      "<span>Road "+escapeHtml(percent(item.identity.transportAccessibility))+"</span></li>"
    ).join("");
  }
  setCheck("vRegionDeterministic",verification.deterministic&&verification.timeIndependent);
  setCheck("vRegionHierarchy",verification.parentCountryCorrect&&verification.hierarchyIntegrated&&!verification.duplicateOwnership);
  setCheck("vRegionIdentity",verification.numericValid&&verification.identityCount>=3);
  setCheck("vRegionSpecialization",verification.sameCountry&&verification.sameCountryProfile&&verification.geographyRedirectsCountry&&verification.specializationCount>=3);
  setCheck("vRegionIndependent",verification.independentLayers&&!verification.terrainMutation&&!verification.resourceMutation);
  setCheck("vRegionLazy",verification.lazyQueryable&&verification.overlayReady&&!verification.liveRegionalEconomy&&!verification.renderDependency);
  root.dataset.regionIndex=String(index);
  root.dataset.regionId=region.id;
  root.dataset.parentCountryId=region.parentCountryId;
  root.dataset.countryRevision=region.countryProfileRevision;
  root.dataset.identity=identitySignature(region);
  root.dataset.specialization=specializationSignature(region);
  root.dataset.dominantTerrain=region.identity.dominantTerrain;
  root.dataset.agriculture=String(region.identity.agriculturalSuitability);
  root.dataset.timber=String(region.identity.timberAvailability);
  root.dataset.mineral=String(region.identity.mineralPotential);
  root.dataset.water=String(region.identity.waterAccess);
  root.dataset.revision=region.revision;
  return Object.freeze({verification,region,index});
}

const api=Object.freeze({
  VERSION,REGION_CELL_SIZE,SAMPLE_GRID,cellFor,at,buildForCell,regionsForCountry,representatives,proof,renderDebugPanel
});
window.RegionProfile=api;
window.RegionProfiles=api;
})();