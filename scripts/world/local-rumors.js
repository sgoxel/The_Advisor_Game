(function(){
"use strict";

const VERSION=1;
const STORAGE_PREFIX="theAdvisorGame.localRumors.v1";
const MAX_RESULTS=6;
const MAX_DESTINATIONS=16;
const MAX_LEADS=5;
const MAX_LOCAL_RECORDS=24;
const GENERIC_TOPIC_TOKENS=new Set(["rumor","rumors","news","nearby","local","around","situation","anything","happening"]);

function scope(){return typeof window!=="undefined"?window:globalThis}
function store(){try{return scope().localStorage||null}catch(_){return null}}
function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function clamp01(value,fallback=.5){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
}
function normalizeTimestamp(value){
  if(value&&typeof value==="object"){
    const pad=n=>String(Math.max(0,Math.floor(Number(n)||0))).padStart(2,"0");
    if(Number.isFinite(Number(value.year))&&Number.isFinite(Number(value.month))&&Number.isFinite(Number(value.day))){
      return String(Math.floor(Number(value.year))).padStart(4,"0")+"-"+pad(value.month)+"-"+pad(value.day)+" "+pad(value.hour)+":"+pad(value.minute)+":"+pad(value.second);
    }
  }
  const text=String(value||"").trim();
  const m=/^(\d{4,})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if(!m)return null;
  return m[1]+"-"+m[2]+"-"+m[3]+" "+(m[4]||"00")+":"+(m[5]||"00")+":"+(m[6]||"00");
}
function timestampMinutes(value){
  const text=normalizeTimestamp(value);if(!text)return null;
  const m=/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);if(!m)return null;
  // GameTime uses fantasy calendar timestamps but follows ordinary month/day
  // fields. This monotonic minute projection is only for freshness labels; it
  // never drives Simulation outcomes.
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]),hour=Number(m[4]),minute=Number(m[5]);
  return (((year*12+Math.max(0,month-1))*31+Math.max(0,day-1))*24+hour)*60+minute;
}
function currentTimestamp(){
  return normalizeTimestamp(scope().GameTime?.getTimestampKey?.())
    ||normalizeTimestamp(scope().GameTime?.getNow?.())
    ||normalizeTimestamp(scope().SeedSystem?.getCampaign?.()?.fantasyStart)
    ||"0000-01-01 00:00:00";
}
function freshnessFor(timestamp,nowValue){
  const source=timestampMinutes(timestamp),now=timestampMinutes(nowValue||currentTimestamp());
  if(source==null||now==null)return Object.freeze({id:"unknown",ageMinutes:null,stale:false,label:"Unknown age"});
  const age=Math.max(0,now-source);
  if(age<=360)return Object.freeze({id:"fresh",ageMinutes:age,stale:false,label:"Fresh"});
  if(age<=4320)return Object.freeze({id:"recent",ageMinutes:age,stale:false,label:"Recent"});
  if(age<=20160)return Object.freeze({id:"stale",ageMinutes:age,stale:true,label:"Stale"});
  return Object.freeze({id:"old",ageMinutes:age,stale:true,label:"Old"});
}
function topicTokens(value){
  return String(value||"").toLowerCase().match(/[a-z0-9]+/g)||[];
}
function topicMatch(topic,text){
  const tokens=topicTokens(topic).filter(token=>token.length>2&&!GENERIC_TOPIC_TOKENS.has(token));
  if(!tokens.length)return {matches:1,generic:true};
  const hay=String(text||"").toLowerCase();
  return {matches:tokens.reduce((n,token)=>n+(hay.includes(token)?1:0),0),generic:false};
}
function statusFor(sourceType,reliability,uncertain){
  const source=String(sourceType||"unknown").toLowerCase();
  const rel=String(reliability||"uncertain").toLowerCase();
  if(source==="rumor")return "hearsay";
  if(uncertain||rel==="uncertain"||rel==="disputed"||rel==="false")return "uncertain";
  if((source==="simulation"||source==="direct-observation")&&rel==="verified")return "confirmed";
  return "uncertain";
}
function plausibleForResident(record,residentId){
  if(!record||typeof record!=="object")return false;
  const knownBy=record.knownBy||record.speakerIds||record.residentIds;
  if(!Array.isArray(knownBy))return true;
  return knownBy.map(String).includes(String(residentId));
}
function normalizeDestination(value){
  if(!value||typeof value!=="object")return null;
  const id=String(value.id||value.destinationId||value.poiId||"").trim();
  const name=String(value.name||value.label||"").trim();
  const lat=Number(value.latitudeRadians),lon=Number(value.longitudeRadians);
  const latDeg=Number(value.latitudeDegrees),lonDeg=Number(value.longitudeDegrees);
  const hasRadians=Number.isFinite(lat)&&Number.isFinite(lon),hasDegrees=Number.isFinite(latDeg)&&Number.isFinite(lonDeg);
  if(!id||!name||(!hasRadians&&!hasDegrees))return null;
  const latitudeRadians=hasRadians?lat:latDeg*Math.PI/180;
  const longitudeRadians=hasRadians?lon:lonDeg*Math.PI/180;
  return Object.freeze({
    id,name,type:String(value.type||"lead"),category:String(value.category||"landmark"),
    description:String(value.description||"Discoverable local lead"),
    importance:Math.max(1,Math.min(5,Math.round(Number(value.importance)||2))),
    latitudeRadians,longitudeRadians,
    latitudeDegrees:hasDegrees?latDeg:latitudeRadians*180/Math.PI,
    longitudeDegrees:hasDegrees?lonDeg:longitudeRadians*180/Math.PI,
    elevationMeters:Number(value.elevationMeters)||0
  });
}
function destinationForMemory(entry,destinations){
  const bounded=(Array.isArray(destinations)?destinations:[]).slice(0,MAX_DESTINATIONS).map(normalizeDestination).filter(Boolean);
  const refType=String(entry?.externalRef?.type||"").toLowerCase();
  const refId=String(entry?.externalRef?.id||entry?.scene?.subjectId||"");
  let match=null;
  if(["destination","place","poi","landmark"].includes(refType)&&refId)match=bounded.find(item=>item.id===refId)||null;
  if(!match&&refId)match=bounded.find(item=>item.id===refId)||null;
  if(!match){
    const text=String(entry?.summary||"").toLowerCase();
    match=bounded.find(item=>item.name.length>=4&&text.includes(item.name.toLowerCase()))||null;
  }
  return match;
}
function descriptorList(config){
  const provided=config?.destinations;
  if(Array.isArray(provided))return provided.slice(0,MAX_DESTINATIONS);
  try{return (scope().PlanetStage?.placeDescriptors?.()||[]).slice(0,MAX_DESTINATIONS)}catch(_){return []}
}
function memoryCandidates(seed,residentId,config){
  const entries=scope().CharacterMemory?.list?.(seed,{kind:"resident",id:residentId})||[];
  const destinations=descriptorList(config);
  return entries.slice(0,64).map(entry=>({
    sourceKind:"memory",
    sourceId:entry.id,
    sourceType:entry.source?.type||"unknown",
    sourceLabel:entry.source?.label||"Character memory",
    reliability:entry.reliability||"uncertain",
    confidence:clamp01(entry.confidence,.3),
    relevance:clamp01(entry.relevance,.5),
    uncertain:Boolean(entry.uncertain),
    summary:String(entry.summary||"").trim(),
    timestamp:normalizeTimestamp(entry.timestamp),
    location:entry.scene?.location||null,
    subject:entry.fact?.subject||entry.scene?.subjectId||entry.externalRef?.id||null,
    externalRef:entry.externalRef||null,
    destination:destinationForMemory(entry,destinations)
  }));
}
function indexedCandidates(records,kind,residentId,destinations){
  return (Array.isArray(records)?records:[]).slice(0,MAX_LOCAL_RECORDS).filter(record=>plausibleForResident(record,residentId)).map((record,index)=>{
    const source=record.source&&typeof record.source==="object"?record.source:{type:record.sourceType||"simulation",label:record.sourceLabel||kind};
    let destination=normalizeDestination(record.destination);
    if(!destination&&record.destinationId)destination=(destinations||[]).map(normalizeDestination).filter(Boolean).find(item=>item.id===String(record.destinationId))||null;
    return {
      sourceKind:kind,
      sourceId:String(record.id||kind+"-"+index),
      sourceType:String(source.type||"simulation"),
      sourceLabel:String(source.label||kind),
      reliability:String(record.reliability||((source.type==="simulation")?"verified":"uncertain")),
      confidence:clamp01(record.confidence,source.type==="simulation"?1:.5),
      relevance:clamp01(record.relevance,.65),
      uncertain:Boolean(record.uncertain),
      summary:String(record.summary||record.text||record.description||"").trim(),
      timestamp:normalizeTimestamp(record.timestamp||record.when),
      location:String(record.location||"").trim()||null,
      subject:String(record.subject||record.entityId||record.destinationId||"").trim()||null,
      externalRef:record.externalRef||null,
      destination
    };
  }).filter(item=>item.summary);
}
function deterministicText(seed,residentId,candidate,status,freshness){
  const variants={
    confirmed:["I can confirm this: ","I saw this myself: ","What I know is this: "],
    uncertain:["I'm not certain, but ","My information is incomplete: ","I cannot fully verify this: "],
    hearsay:["I heard that ","People have been saying that ","This is only hearsay: "]
  };
  const list=variants[status]||variants.uncertain;
  const index=parseInt(hashText(seed+"|"+residentId+"|"+candidate.sourceId+"|"+status).slice(-4),16)%list.length;
  const stale=freshness.stale?" This may be out of date.":"";
  return list[index]+candidate.summary+stale;
}
function freezeRumor(value){
  return Object.freeze({
    ...value,
    source:Object.freeze({...value.source}),
    freshness:Object.freeze({...value.freshness}),
    destinationLead:value.destinationLead?Object.freeze({...value.destinationLead}):null
  });
}
let telemetry={
  queryCount:0,lastQueryMs:0,maxQueryMs:0,lastCandidateCount:0,lastResultCount:0,lastResidentId:null,
  leadRevealCount:0,duplicateLeadRevealCount:0,fullWorldScan:false,bounded:true
};
function query(seedValue,residentIdValue,configValue){
  const started=(scope().performance?.now?.()??Date.now());
  const seed=normalizeSeed(seedValue),residentId=String(residentIdValue||"").trim();
  if(!residentId)return Object.freeze([]);
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const topic=String(config.topic||"local news").trim()||"local news";
  const destinations=descriptorList(config).map(normalizeDestination).filter(Boolean);
  const candidates=[
    ...memoryCandidates(seed,residentId,{...config,destinations}),
    ...indexedCandidates(config.localFacts,"local-fact",residentId,destinations),
    ...indexedCandidates(config.localEvents,"local-event",residentId,destinations)
  ];
  const now=normalizeTimestamp(config.now||config.when)||currentTimestamp();
  const ranked=candidates.map(candidate=>{
    const match=topicMatch(topic,[candidate.summary,candidate.subject,candidate.location,candidate.sourceLabel].filter(Boolean).join(" "));
    const freshness=freshnessFor(candidate.timestamp,now);
    const status=statusFor(candidate.sourceType,candidate.reliability,candidate.uncertain);
    const score=match.matches*10+candidate.relevance*3+candidate.confidence*2-(freshness.id==="old"?1.5:freshness.id==="stale"?.5:0);
    return {candidate,match,freshness,status,score};
  }).filter(item=>item.match.matches>0).sort((a,b)=>
    b.score-a.score||
    String(a.candidate.sourceId).localeCompare(String(b.candidate.sourceId))
  );
  const seen=new Set(),limit=Math.max(1,Math.min(MAX_RESULTS,Math.floor(Number(config.maxResults)||MAX_RESULTS)));
  const results=[];
  for(const item of ranked){
    const c=item.candidate,dedupe=[c.summary,c.subject,c.location].join("|").toLowerCase();
    if(seen.has(dedupe))continue;seen.add(dedupe);
    const lead=c.destination?Object.freeze({...c.destination,sourceId:c.sourceId}):null;
    const id="RUM-"+residentId+"-"+hashText([seed,c.sourceKind,c.sourceId,item.status,c.summary].join("|"));
    results.push(freezeRumor({
      id,campaignSeed:seed,speakerId:residentId,topic,
      summary:c.summary,text:deterministicText(seed,residentId,c,item.status,item.freshness),
      status:item.status,confidence:Number(c.confidence.toFixed(3)),reliability:c.reliability,
      source:Object.freeze({kind:c.sourceKind,id:c.sourceId,type:c.sourceType,label:c.sourceLabel}),
      freshness:item.freshness,location:c.location,subject:c.subject,
      destinationLead:lead,
      worldAuthority:false,createsWorldTruth:false,characterBounded:true
    }));
    if(results.length>=limit)break;
  }
  const elapsed=(scope().performance?.now?.()??Date.now())-started;
  telemetry={...telemetry,queryCount:telemetry.queryCount+1,lastQueryMs:Number(elapsed.toFixed(3)),maxQueryMs:Number(Math.max(telemetry.maxQueryMs,elapsed).toFixed(3)),
    lastCandidateCount:candidates.length,lastResultCount:results.length,lastResidentId:residentId};
  return Object.freeze(results);
}
function bestForTopic(seedValue,residentIdValue,configValue){
  return query(seedValue,residentIdValue,{...(configValue||{}),maxResults:1})[0]||null;
}
function storageKey(seed){return STORAGE_PREFIX+":"+normalizeSeed(seed)}
function readLeadRecord(seedValue){
  const seed=normalizeSeed(seedValue),storage=store();
  if(!storage)return {version:VERSION,campaignSeed:seed,leads:[]};
  try{
    const parsed=JSON.parse(storage.getItem(storageKey(seed))||"null");
    if(!parsed||!Array.isArray(parsed.leads))return {version:VERSION,campaignSeed:seed,leads:[]};
    return {version:VERSION,campaignSeed:seed,leads:parsed.leads.slice(-MAX_LEADS)};
  }catch(_){return {version:VERSION,campaignSeed:seed,leads:[]}}
}
function writeLeadRecord(seedValue,record){
  const seed=normalizeSeed(seedValue),normalized={version:VERSION,campaignSeed:seed,leads:(record?.leads||[]).slice(-MAX_LEADS)};
  try{store()?.setItem(storageKey(seed),JSON.stringify(normalized))}catch(_){}
  return normalized;
}
function revealLead(seedValue,residentIdValue,rumorValue){
  const seed=normalizeSeed(seedValue),residentId=String(residentIdValue||"").trim(),rumor=rumorValue&&typeof rumorValue==="object"?rumorValue:null;
  if(!rumor||String(rumor.speakerId)!==residentId||rumor.campaignSeed!==seed||!rumor.destinationLead)return null;
  const destination=normalizeDestination(rumor.destinationLead);if(!destination)return null;
  const record=readLeadRecord(seed),existing=record.leads.find(item=>item.destination?.id===destination.id);
  if(existing){
    telemetry={...telemetry,duplicateLeadRevealCount:telemetry.duplicateLeadRevealCount+1};
    return Object.freeze({...existing,destination:Object.freeze({...existing.destination})});
  }
  const lead={
    id:"LEAD-"+hashText(seed+"|"+residentId+"|"+rumor.id+"|"+destination.id),
    destination,
    rumorId:rumor.id,speakerId:residentId,status:rumor.status,
    learnedAt:currentTimestamp(),sourceType:rumor.source?.type||null,
    worldAuthority:false,createsWorldTruth:false
  };
  record.leads.push(lead);writeLeadRecord(seed,record);
  telemetry={...telemetry,leadRevealCount:telemetry.leadRevealCount+1};
  try{scope().PlanetStage?.refreshPlaces?.()}catch(_){}
  return Object.freeze({...lead,destination:Object.freeze({...destination})});
}
function navigatorLeads(seedValue){
  return Object.freeze(readLeadRecord(seedValue).leads.slice(-MAX_LEADS).map(item=>{
    const d=normalizeDestination(item.destination);if(!d)return null;
    return Object.freeze({
      ...d,
      rumorLead:true,knowledgeStatus:item.status||"uncertain",
      leadId:item.id,leadSpeakerId:item.speakerId||null,leadRumorId:item.rumorId||null,
      description:(item.status==="confirmed"?"Confirmed lead":item.status==="hearsay"?"Hearsay lead":"Uncertain lead")+" · "+d.description,
      worldAuthority:false
    });
  }).filter(Boolean));
}
function snapshot(seedValue){
  const leads=navigatorLeads(seedValue);
  return Object.freeze({
    ...telemetry,version:VERSION,leadCount:leads.length,maxResults:MAX_RESULTS,maxDestinations:MAX_DESTINATIONS,maxLocalRecords:MAX_LOCAL_RECORDS,maxLeads:MAX_LEADS,
    leadIds:Object.freeze(leads.map(item=>item.leadId)),destinationIds:Object.freeze(leads.map(item=>item.id)),
    localIndexedQueriesOnly:true,globalScan:false,worldMutation:false,simulationAuthority:false
  });
}
function clear(seedValue){
  try{store()?.removeItem(storageKey(normalizeSeed(seedValue)))}catch(_){}
  return snapshot(seedValue);
}
const api=Object.freeze({
  VERSION,MAX_RESULTS,MAX_DESTINATIONS,MAX_LOCAL_RECORDS,MAX_LEADS,
  query,bestForTopic,revealLead,navigatorLeads,snapshot,clear
});
scope().LocalRumors=api;
scope().RumorKnowledge=api;
})();