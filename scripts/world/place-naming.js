(function(){
"use strict";

const VERSION=1;
const CACHE_LIMIT=2048;
const cache=new Map();

const CULTURES=Object.freeze([
  Object.freeze({id:"greenvale",leads:["Alder","Bram","Cedar","Dun","Elden","Fal","Glen","Harrow","Lorn","Mere","Nor","Oak","Raven","Silver","Thorn","West"],mids:["a","e","en","er","in","or","el","is","ar","ol","un","yr","an","ia","on","um"],tails:["bar","brook","dale","field","ford","haven","mere","reach","stead","vale","watch","wick","wood","gate","hold","ridge"]}),
  Object.freeze({id:"highmarch",leads:["Ard","Bren","Caer","Dorn","Eir","Garr","Hal","Iver","Keld","Morn","Rhyd","Skel","Tarn","Uld","Varr","Wyr"],mids:["a","e","i","o","u","ae","ai","ei","io","oa","ar","er","ir","or","ur","yr"],tails:["ach","ard","arn","en","eth","gar","holm","orn","rak","ren","ric","run","thar","var","vik","wyn"]}),
  Object.freeze({id:"suncoast",leads:["Ama","Bel","Cala","Dara","Elo","Fara","Ila","Luma","Mara","Nava","Ora","Pela","Riva","Sola","Tala","Vela"],mids:["la","le","li","lo","ma","me","mi","na","ne","ni","ra","re","ri","sa","se","va"],tails:["a","ia","ara","ena","ira","ora","una","essa","ella","ina","ava","ero","ari","ori","aya","era"]}),
  Object.freeze({id:"ironwood",leads:["Brak","Drom","Fell","Grim","Hark","Krag","Malk","Rok","Skarn","Sten","Thrak","Varn","Volk","Zarn","Borg","Keld"],mids:["a","e","i","o","u","ra","re","ri","ro","ur","ar","or","an","en","un","yr"],tails:["ak","ard","ek","en","gar","ik","ok","orn","rak","ren","sk","tor","ug","var","vek","yr"]}),
  Object.freeze({id:"mistmere",leads:["Ael","Bri","Cae","Eli","Fae","Iri","Lio","Mae","Nim","Oli","Rae","Sae","Tae","Uri","Vae","Yri"],mids:["a","e","i","o","u","ae","ea","ia","io","oa","el","il","ir","or","ul","yr"],tails:["a","el","en","iel","ion","ira","is","ora","riel","rin","sil","thiel","uin","wyn","yre","eth"]})
]);

const COUNTRY_FORMS=Object.freeze(["Realm","Kingdom","Principality","March","Dominion","Commonwealth","Crownlands","Grand Duchy"]);
const REGION_SUFFIX=Object.freeze(["Province","Region","March","Vale","Reach","Shire","District","Territory"]);
const TYPE_LABELS=Object.freeze({
  capital:["Crown","Seat","Hold","Court"],
  city:["City","Cross","Haven","Reach"],
  town:["Town","Cross","Ford","Market"],
  village:["Village","Stead","Field","Brook"],
  hamlet:["Hamlet","Stead","Croft","Wick"],
  lake:["Lake","Mere","Water"],
  "river-location":["Reach","Bend","River"],
  river:["River","Water","Flow"],
  confluence:["Meeting","Fork","Confluence"],
  waterfall:["Falls","Cascade","Drop"],
  "mountain-pass":["Pass","Gap","Gate"],
  mountain:["Peak","Mount","Crown"],
  forest:["Wood","Grove","Forest"],
  ruin:["Ruins","Watch","Keep","Hall"],
  fort:["Fort","Watch","Hold"],
  tower:["Tower","Watch","Beacon"],
  bridge:["Bridge","Crossing","Ford"],
  cave:["Cave","Hollow","Grotto"],
  cliff:["Cliffs","Scar","Crag"],
  outcrop:["Crag","Rocks","Tor"],
  hunting:["Chase","Hunt","Wilds"],
  fishing:["Fishery","Waters","Reach"],
  grazing:["Downs","Pastures","Meadow"],
  gathering:["Forage","Grounds","Gathering"]
});

function hash32(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
function safe(value){return String(value==null?"":value)}
function normalizeType(value){
  const type=safe(value).toLowerCase().trim();
  return type==="national-capital"?"capital":type||"place";
}
function boundedSet(key,value){
  if(cache.has(key))cache.delete(key);
  cache.set(key,value);
  while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
}
function cultureId(seed,countryId,entityId){
  const key=safe(countryId)||safe(entityId)||"WORLD";
  return CULTURES[hash32(safe(seed)+"|place-culture|"+key)%CULTURES.length].id;
}
function cultureFor(seed,countryId,entityId){
  const id=cultureId(seed,countryId,entityId);
  return CULTURES.find(item=>item.id===id)||CULTURES[0];
}
function pick(seed,key,list){
  return list[hash32(safe(seed)+"|place-name|v"+VERSION+"|"+safe(key))%list.length];
}
function smoothWord(value){
  return String(value).replace(/([aeiou])\1+/gi,"$1").replace(/([bcdfghjklmnpqrstvwxyz])\1+/gi,"$1");
}
function coreFor(seed,input,attempt){
  const id=safe(input.id)||[normalizeType(input.type),safe(input.countryId),safe(input.regionId),safe(input.x),safe(input.y)].join("|");
  const culture=cultureFor(seed,input.countryId,id);
  const key=id+"|"+normalizeType(input.type)+"|"+Math.max(0,Number(attempt)||0);
  const lead=pick(seed,key+"|lead",culture.leads);
  const mid=pick(seed,key+"|mid",culture.mids);
  const tail=pick(seed,key+"|tail",culture.tails);
  const lead2=pick(seed,key+"|lead2",culture.leads);
  const mid2=pick(seed,key+"|mid2",culture.mids);
  const tail2=pick(seed,key+"|tail2",culture.tails);
  return Object.freeze({
    core:smoothWord(lead+mid+tail),
    qualifier:smoothWord(lead2+mid2+tail2),
    culture
  });
}
function displayName(seed,input,attempt){
  const type=normalizeType(input.type),made=coreFor(seed,input,attempt),core=made.core,qualifier=made.qualifier;
  const identityName=core+" "+qualifier;
  if(type==="country"){
    return Object.freeze({name:pick(seed,safe(input.id)+"|country-form|"+attempt,COUNTRY_FORMS)+" of "+identityName,shortForm:identityName,culture:made.culture});
  }
  if(type==="region"){
    return Object.freeze({name:identityName+" "+pick(seed,safe(input.id)+"|region-form|"+attempt,REGION_SUFFIX),shortForm:identityName,culture:made.culture});
  }
  const labels=TYPE_LABELS[type];
  if(labels&&["lake","river","river-location","confluence","waterfall","mountain-pass","mountain","forest","ruin","fort","tower","bridge","cave","cliff","outcrop","hunting","fishing","grazing","gathering"].includes(type)){
    const label=pick(seed,safe(input.id)+"|type-label|"+type+"|"+attempt,labels);
    return Object.freeze({
      name:(type==="lake"||type==="mountain"?"":identityName+" ")+label+(type==="lake"||type==="mountain"?" "+identityName:""),
      shortForm:identityName,culture:made.culture
    });
  }
  if(labels&&["capital","city","town","village","hamlet"].includes(type)){
    const decorate=hash32(safe(seed)+"|place-decorate|"+safe(input.id)+"|"+type)%5===0;
    return Object.freeze({name:decorate?identityName+" "+pick(seed,safe(input.id)+"|settlement-label|"+type,labels):identityName,shortForm:identityName,culture:made.culture});
  }
  return Object.freeze({name:identityName,shortForm:identityName,culture:made.culture});
}
function descriptor(seedValue,inputValue,attemptValue){
  const seed=safe(seedValue),input=inputValue||{},attempt=Math.max(0,Math.floor(Number(attemptValue)||0));
  const type=normalizeType(input.type);
  const id=safe(input.id)||[type,safe(input.countryId),safe(input.regionId),safe(input.x),safe(input.y)].join("|");
  const countryId=safe(input.countryId)||(type==="country"?id:"");
  const regionId=safe(input.regionId)||(type==="region"?id:"");
  const key=[seed,VERSION,id,type,countryId,regionId,attempt].join("|");
  if(cache.has(key))return cache.get(key);
  const made=displayName(seed,{...input,id,type,countryId,regionId},attempt);
  const adjective=made.shortForm.endsWith("a")?made.shortForm+"n":made.shortForm+"ian";
  const result=Object.freeze({
    entityId:id,
    canonicalName:made.name,
    name:made.name,
    shortForm:made.shortForm,
    adjective,
    demonym:adjective,
    placeType:type,
    parentCountryId:countryId||null,
    parentRegionId:regionId||null,
    namingCultureKey:made.culture.id,
    nameGenerationVersion:VERSION,
    attempt,
    identityKey:"TOPONYM|v"+VERSION+"|"+id,
    authority:"Campaign SEED + stable entity ID + naming version",
    seedOnly:true,
    cameraIndependent:true,
    loadOrderIndependent:true,
    frameIndependent:true
  });
  boundedSet(key,result);
  return result;
}
function nameCountry(seed,input,attempt){return descriptor(seed,{...(input||{}),type:"country"},attempt).name}
function nameRegion(seed,input,attempt){return descriptor(seed,{...(input||{}),type:"region"},attempt).name}
function nameSettlement(seed,input,attempt){return descriptor(seed,{...(input||{}),type:normalizeType(input?.type||input?.classId||"village")},attempt).name}
function nameDestination(seed,input,attempt){return descriptor(seed,input,attempt).name}
function scoped(seedValue,inputsValue){
  const seed=safe(seedValue),inputs=[...(inputsValue||[])].map(item=>({...item,id:safe(item.id)})).sort((a,b)=>a.id.localeCompare(b.id));
  const used=new Set(),out=[];
  for(const item of inputs){
    let d=null;
    for(let attempt=0;attempt<64;attempt++){
      const candidate=descriptor(seed,item,attempt);
      const normalized=candidate.name.toLocaleLowerCase("en-US");
      if(!used.has(normalized)){d=candidate;used.add(normalized);break;}
    }
    if(!d)throw new Error("PlaceNaming collision sequence exhausted for "+item.id);
    out.push(d);
  }
  return Object.freeze(out);
}
function preserve(savedValue,currentValue){
  const saved=savedValue||null,current=currentValue||null;
  if(saved&&saved.entityId&&saved.name&&Number.isFinite(Number(saved.nameGenerationVersion))){
    return Object.freeze({...saved,preservedCampaignName:true});
  }
  return current?Object.freeze({...current,preservedCampaignName:false}):null;
}
function clearCache(){cache.clear();}
function stats(){return Object.freeze({version:VERSION,cacheSize:cache.size,cacheLimit:CACHE_LIMIT,cultureCount:CULTURES.length});}

const api=Object.freeze({
  VERSION,CACHE_LIMIT,CULTURES,
  descriptor,nameCountry,nameRegion,nameSettlement,nameDestination,scoped,preserve,
  cultureId,clearCache,stats
});
window.PlaceNaming=api;
window.Toponymy=api;
})();