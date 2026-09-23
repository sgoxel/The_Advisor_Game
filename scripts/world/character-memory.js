(function(){
"use strict";

const STORAGE_PREFIX="theAdvisorGame.characterMemory.v1";
const VERSION=1;
const VALID_ACTOR_KINDS=Object.freeze(["protagonist","resident"]);
const VALID_KINDS=Object.freeze(["memory","observation","fact"]);
const VALID_CATEGORIES=Object.freeze(["people","places","promises","warnings","plans","rumors","outcomes","advice","general"]);
const VALID_SOURCE_TYPES=Object.freeze(["simulation","direct-observation","trusted-testimony","advice","rumor","unknown"]);
const VALID_RELIABILITY=Object.freeze(["verified","trusted","uncertain","disputed","false"]);
const ENTRY_SCHEMA=Object.freeze([
  "id","sequence","actor","kind","category","summary","timestamp","source",
  "confidence","relevance","reliability","uncertain","authority","fact","scene","externalRef"
]);

function scope(){return typeof window!=="undefined"?window:globalThis}
function store(){try{return scope().localStorage||null}catch(_){return null}}

function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}
function normalizeActor(actorValue,idValue){
  let kind="protagonist",id="protagonist";
  if(actorValue&&typeof actorValue==="object"){
    kind=String(actorValue.kind||actorValue.type||kind).trim().toLowerCase();
    id=String(actorValue.id||idValue||id).trim();
  }else if(typeof actorValue==="string"&&VALID_ACTOR_KINDS.includes(actorValue.toLowerCase())){
    kind=actorValue.toLowerCase();
    id=String(idValue||((kind==="protagonist")?"protagonist":"")).trim();
  }else if(typeof actorValue==="string"&&actorValue.trim()){
    kind="resident";
    id=actorValue.trim();
  }
  if(!VALID_ACTOR_KINDS.includes(kind))kind="resident";
  if(!id)id=kind==="protagonist"?"protagonist":"unknown-resident";
  if(kind==="protagonist")id="protagonist";
  return {kind,id};
}
function actorKey(actor){return actor.kind+":"+actor.id}
function storageKey(seedValue){return STORAGE_PREFIX+":"+normalizeSeed(seedValue)}

function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function clamp01(value,fallback){
  const n=Number(value);
  if(!Number.isFinite(n))return fallback;
  return Math.max(0,Math.min(1,n));
}
function normalizeKind(value){
  const text=String(value||"memory").trim().toLowerCase();
  return VALID_KINDS.includes(text)?text:"memory";
}
function normalizeCategory(value){
  const text=String(value||"general").trim().toLowerCase();
  return VALID_CATEGORIES.includes(text)?text:"general";
}
function normalizeSummary(value){
  const text=String(value==null?"":value).trim().replace(/\s+/g," ");
  return text||"Unspecified memory";
}
function timestampFromParts(parts){
  if(!parts)return null;
  const pad=n=>String(n).padStart(2,"0");
  const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
  if(!Number.isFinite(year)||!Number.isFinite(month)||!Number.isFinite(day))return null;
  return String(year).padStart(4,"0")+"-"+pad(month)+"-"+pad(day)+" "+pad(Number(parts.hour||0))+":"+pad(Number(parts.minute||0))+":"+pad(Number(parts.second||0));
}
function currentFantasyTimestamp(){
  return scope().GameTime?.getTimestampKey?.()
    ||timestampFromParts(scope().SeedSystem?.getCampaign?.()?.fantasyStart)
    ||"0000-01-01 00:00:00";
}
function normalizeTimestamp(value,fallback){
  if(value==null)return fallback||currentFantasyTimestamp();
  if(typeof value==="string"){
    const text=value.trim();
    const direct=/^(\d{4,})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if(direct)return direct[1]+"-"+direct[2]+"-"+direct[3]+" "+direct[4]+":"+direct[5]+":"+direct[6];
    const iso=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
    if(iso)return iso[1]+"-"+iso[2]+"-"+iso[3]+" "+iso[4]+":"+iso[5]+":"+iso[6];
  }
  if(typeof value==="number"&&Number.isFinite(value)){
    const d=new Date(value);
    const pad=n=>String(n).padStart(2,"0");
    return String(d.getUTCFullYear()).padStart(4,"0")+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())+" "+pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds());
  }
  return fallback||currentFantasyTimestamp();
}
function normalizeSource(value){
  const source=value&&typeof value==="object"?value:{type:value};
  let type=String(source.type||"unknown").trim().toLowerCase();
  if(!VALID_SOURCE_TYPES.includes(type))type="unknown";
  const id=String(source.id||source.ref||type).trim()||type;
  const defaultLabel={
    "simulation":"Simulation truth",
    "direct-observation":"Direct observation",
    "trusted-testimony":"Trusted testimony",
    "advice":"Advisor record",
    "rumor":"Rumor",
    "unknown":"Unknown source"
  }[type];
  const label=String(source.label||source.name||defaultLabel).trim()||defaultLabel;
  return {type,id,label};
}
function defaultReliability(sourceType){
  if(sourceType==="simulation"||sourceType==="direct-observation")return "verified";
  if(sourceType==="trusted-testimony"||sourceType==="advice")return "trusted";
  return "uncertain";
}
function normalizeReliability(value,sourceType){
  let reliability=String(value||defaultReliability(sourceType)).trim().toLowerCase();
  if(!VALID_RELIABILITY.includes(reliability))reliability=defaultReliability(sourceType);
  if((sourceType==="rumor"||sourceType==="unknown")&&(reliability==="verified"||reliability==="trusted")){
    reliability="uncertain";
  }
  return reliability;
}
function defaultConfidence(sourceType){
  if(sourceType==="simulation")return 1;
  if(sourceType==="direct-observation")return 0.95;
  if(sourceType==="trusted-testimony"||sourceType==="advice")return 0.8;
  if(sourceType==="rumor")return 0.4;
  return 0.3;
}
function normalizeFact(value){
  if(value==null)return null;
  const source=typeof value==="object"?value:{value};
  return {
    subject:String(source.subject||"").trim()||"unspecified",
    predicate:String(source.predicate||"state").trim()||"state",
    value:source.value==null?null:source.value
  };
}
function normalizeScene(value){
  if(value==null)return null;
  const source=typeof value==="object"?value:{location:value};
  return {
    location:String(source.location||source.place||"").trim()||null,
    event:String(source.event||source.eventId||"").trim()||null,
    subjectId:String(source.subjectId||source.entityId||"").trim()||null
  };
}
function normalizeExternalRef(value){
  if(value==null)return null;
  const source=typeof value==="object"?value:{id:value};
  const type=String(source.type||source.kind||"memory").trim().toLowerCase();
  const id=String(source.id||source.ref||"").trim();
  return id?{type,id}:null;
}
function authorityFor(source,reliability){
  return source.type==="simulation"&&reliability==="verified"?"simulation-truth":"knowledge-only";
}
function uncertaintyFor(source,reliability,confidence){
  return source.type==="rumor"||source.type==="unknown"||reliability==="uncertain"||reliability==="disputed"||confidence<0.75;
}
function freezeEntry(entry){
  return Object.freeze({
    ...entry,
    actor:Object.freeze({...entry.actor}),
    source:Object.freeze({...entry.source}),
    fact:entry.fact?Object.freeze({...entry.fact}):null,
    scene:entry.scene?Object.freeze({...entry.scene}):null,
    externalRef:entry.externalRef?Object.freeze({...entry.externalRef}):null
  });
}
function blankRecord(seedValue){
  return {version:VERSION,campaignSeed:normalizeSeed(seedValue),actors:{}};
}
function nextId(seed,actor,sequence,entry){
  const identity=[
    seed,actorKey(actor),sequence,entry.kind,entry.category,entry.summary,entry.timestamp,
    entry.source.type,entry.source.id,entry.fact?JSON.stringify(entry.fact):"",
    entry.externalRef?entry.externalRef.type+":"+entry.externalRef.id:""
  ].join("|");
  return "MEM-"+actor.id+"-"+String(sequence).padStart(4,"0")+"-"+hashText(identity);
}
function normalizeEntry(entry,seedValue,actorValue,index){
  const seed=normalizeSeed(seedValue);
  const actor=normalizeActor(actorValue);
  const sequence=Number.isInteger(entry?.sequence)&&entry.sequence>0?entry.sequence:index+1;
  const kind=normalizeKind(entry?.kind);
  const category=normalizeCategory(entry?.category);
  const summary=normalizeSummary(entry?.summary);
  const timestamp=normalizeTimestamp(entry?.timestamp);
  const source=normalizeSource(entry?.source);
  const confidence=clamp01(entry?.confidence,defaultConfidence(source.type));
  const relevance=clamp01(entry?.relevance,0.5);
  const reliability=normalizeReliability(entry?.reliability,source.type);
  const fact=kind==="fact"?normalizeFact(entry?.fact):null;
  const scene=normalizeScene(entry?.scene);
  const externalRef=normalizeExternalRef(entry?.externalRef);
  const base={
    sequence,actor,kind,category,summary,timestamp,source,confidence,relevance,reliability,
    uncertain:uncertaintyFor(source,reliability,confidence),
    authority:authorityFor(source,reliability),
    fact,scene,externalRef
  };
  return {
    id:String(entry?.id||nextId(seed,actor,sequence,base)),
    ...base
  };
}
function readRecord(seedValue){
  const seed=normalizeSeed(seedValue);
  const storage=store();
  if(!storage)return blankRecord(seed);
  try{
    const raw=storage.getItem(storageKey(seed));
    if(!raw)return blankRecord(seed);
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||!parsed.actors)return blankRecord(seed);
    const record=blankRecord(seed);
    for(const [key,ledger] of Object.entries(parsed.actors)){
      const actor=normalizeActor(ledger?.actor||key.split(":")[0],ledger?.actor?.id||key.slice(key.indexOf(":")+1));
      const entries=Array.isArray(ledger?.entries)?ledger.entries:[];
      record.actors[actorKey(actor)]={
        actor,
        entries:entries.map((entry,index)=>normalizeEntry(entry,seed,actor,index))
      };
    }
    return record;
  }catch(error){
    console.warn("Unable to read character memory.",error);
    return blankRecord(seed);
  }
}
function writeRecord(seedValue,record){
  const seed=normalizeSeed(seedValue);
  const normalized=blankRecord(seed);
  for(const ledger of Object.values(record?.actors||{})){
    const actor=normalizeActor(ledger?.actor);
    normalized.actors[actorKey(actor)]={
      actor,
      entries:(ledger?.entries||[]).map((entry,index)=>normalizeEntry(entry,seed,actor,index))
    };
  }
  const storage=store();
  if(storage){
    try{storage.setItem(storageKey(seed),JSON.stringify(normalized))}
    catch(error){console.warn("Unable to persist character memory.",error)}
  }
  return normalized;
}
function list(seedValue,actorValue,idValue){
  const seed=normalizeSeed(seedValue);
  const actor=normalizeActor(actorValue,idValue);
  const ledger=readRecord(seed).actors[actorKey(actor)];
  return Object.freeze((ledger?.entries||[]).map(freezeEntry));
}
function recordMemory(seedValue,actorValue,configValue,idValue){
  const seed=normalizeSeed(seedValue);
  const actor=normalizeActor(actorValue,idValue);
  const config=configValue&&typeof configValue==="object"?configValue:{summary:configValue};
  const record=readRecord(seed);
  const key=actorKey(actor);
  const ledger=record.actors[key]||{actor,entries:[]};
  const sequence=ledger.entries.length+1;
  const source=normalizeSource(config.source);
  const confidence=clamp01(config.confidence,defaultConfidence(source.type));
  const reliability=normalizeReliability(config.reliability,source.type);
  const kind=normalizeKind(config.kind);
  const base={
    sequence,
    actor,
    kind,
    category:normalizeCategory(config.category),
    summary:normalizeSummary(config.summary||config.text||config.message),
    timestamp:normalizeTimestamp(config.timestamp),
    source,
    confidence,
    relevance:clamp01(config.relevance,0.5),
    reliability,
    uncertain:uncertaintyFor(source,reliability,confidence),
    authority:authorityFor(source,reliability),
    fact:kind==="fact"?normalizeFact(config.fact||{
      subject:config.subject,
      predicate:config.predicate,
      value:config.value
    }):null,
    scene:normalizeScene(config.scene),
    externalRef:normalizeExternalRef(config.externalRef)
  };
  const entry={id:nextId(seed,actor,sequence,base),...base};
  ledger.entries.push(entry);
  record.actors[key]=ledger;
  writeRecord(seed,record);
  return freezeEntry(entry);
}
function recordFact(seedValue,actorValue,configValue,idValue){
  return recordMemory(seedValue,actorValue,{...(configValue||{}),kind:"fact"},idValue);
}
function recordObservation(seedValue,actorValue,configValue,idValue){
  return recordMemory(seedValue,actorValue,{...(configValue||{}),kind:"observation",source:(configValue||{}).source||{type:"direct-observation"}},idValue);
}
function recordAdviceReference(seedValue,actorValue,adviceId,configValue,idValue){
  const seed=normalizeSeed(seedValue);
  const actor=normalizeActor(actorValue,idValue);
  const advice=scope().AdvisorChannel?.resolve?.(seed,adviceId,"protagonist")||null;
  if(!advice)return null;
  const config=configValue&&typeof configValue==="object"?configValue:{};
  return recordMemory(seed,actor,{
    ...config,
    kind:"memory",
    category:normalizeCategory(config.category||"advice"),
    summary:config.summary||("Advice remembered: "+advice.topic),
    source:{type:"advice",id:advice.id,label:"Advisor record"},
    confidence:config.confidence==null?0.8:config.confidence,
    relevance:config.relevance==null?0.75:config.relevance,
    reliability:config.reliability||"trusted",
    externalRef:{type:"advice",id:advice.id}
  });
}
function clear(seedValue){
  const storage=store();
  if(storage)storage.removeItem(storageKey(seedValue));
  return true;
}
function snapshot(seedValue){
  const seed=normalizeSeed(seedValue);
  const record=readRecord(seed);
  const actors=Object.values(record.actors).sort((a,b)=>actorKey(a.actor).localeCompare(actorKey(b.actor))).map(ledger=>Object.freeze({
    actor:Object.freeze({...ledger.actor}),
    entries:Object.freeze(ledger.entries.map(freezeEntry))
  }));
  return Object.freeze({version:VERSION,campaignSeed:seed,actors:Object.freeze(actors)});
}
function sameSchema(entry){
  return ENTRY_SCHEMA.every(key=>Object.prototype.hasOwnProperty.call(entry,key))
    &&Object.keys(entry).length===ENTRY_SCHEMA.length;
}
function verify(seedValue){
  const seed=normalizeSeed(seedValue);
  const first=snapshot(seed);
  const second=snapshot(seed);
  const entries=first.actors.flatMap(ledger=>ledger.entries);
  const ids=entries.map(entry=>entry.id);
  const sharedRecordFormat=entries.every(sameSchema);
  const uniqueIds=new Set(ids).size===ids.length;
  const sequenceStable=first.actors.every(ledger=>ledger.entries.every((entry,index)=>entry.sequence===index+1));
  const deterministicIds=entries.every(entry=>entry.id===nextId(seed,entry.actor,entry.sequence,entry));
  const traceable=entries.every(entry=>
    typeof entry.timestamp==="string"&&
    VALID_SOURCE_TYPES.includes(entry.source.type)&&
    Boolean(entry.source.id)&&Boolean(entry.source.label)&&
    Number.isFinite(entry.confidence)&&Number.isFinite(entry.relevance)&&
    VALID_RELIABILITY.includes(entry.reliability)
  );
  const uncertainPreserved=entries.every(entry=>{
    const shouldBeUncertain=entry.source.type==="rumor"||entry.source.type==="unknown"||entry.reliability==="uncertain"||entry.reliability==="disputed"||entry.confidence<0.75;
    return !shouldBeUncertain||entry.uncertain===true;
  });
  const authoritySafe=entries.every(entry=>
    entry.authority!=="simulation-truth"||(entry.source.type==="simulation"&&entry.reliability==="verified")
  );
  const adviceRefsTraceable=entries.filter(entry=>entry.source.type==="advice").every(entry=>entry.externalRef?.type==="advice"&&Boolean(entry.externalRef?.id));
  const storageRoundTrip=JSON.stringify(first)===JSON.stringify(second);
  return Object.freeze({
    pass:sharedRecordFormat&&uniqueIds&&sequenceStable&&deterministicIds&&traceable&&uncertainPreserved&&authoritySafe&&adviceRefsTraceable&&storageRoundTrip,
    campaignSeed:seed,
    actorCount:first.actors.length,
    entryCount:entries.length,
    sharedRecordFormat,
    uniqueIds,
    sequenceStable,
    deterministicIds,
    traceable,
    uncertainPreserved,
    authoritySafe,
    adviceRefsTraceable,
    storageRoundTrip,
    worldMutationApi:false,
    schema:Object.freeze(ENTRY_SCHEMA.slice()),
    actors:first.actors
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value,0)*100)+"%"}
function actorOptions(seed){
  const options=[{kind:"protagonist",id:"protagonist",label:"Protagonist"}];
  const residents=scope().ResidentRoster?.build?.(seed)||[];
  for(const resident of residents){
    options.push({kind:"resident",id:resident.id,label:resident.name+" ("+resident.id+")"});
  }
  return options;
}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderDebugPanel(seedValue,actorValue,idValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue||scope().SeedSystem?.getCampaign?.()?.seed||scope().SeedSystem?.getSettings?.()?.seed);
  const actor=normalizeActor(actorValue,idValue);
  const root=rootNode||document.getElementById("memoryProof");
  if(!root)return null;
  const entries=list(seed,actor);
  const verification=verify(seed);
  const actorSelect=root.querySelector("#memoryActorSelect");
  const options=actorOptions(seed);
  if(actorSelect){
    const selected=actorKey(actor);
    actorSelect.innerHTML=options.map(option=>{
      const value=option.kind+":"+option.id;
      return "<option value=\""+escapeHtml(value)+"\" "+(value===selected?"selected":"")+">"+escapeHtml(option.label)+"</option>";
    }).join("");
    actorSelect.onchange=()=>{
      const [kind,...rest]=actorSelect.value.split(":");
      renderDebugPanel(seed,{kind,id:rest.join(":")||"protagonist"},undefined,root);
    };
  }
  const actorNode=root.querySelector("#memoryActor");
  const countNode=root.querySelector("#memoryEntryCount");
  const verifiedNode=root.querySelector("#memoryVerifiedCount");
  const uncertainNode=root.querySelector("#memoryUncertainCount");
  if(actorNode)actorNode.textContent=actor.kind+" · "+actor.id;
  if(countNode)countNode.textContent=String(entries.length);
  if(verifiedNode)verifiedNode.textContent=String(entries.filter(entry=>entry.reliability==="verified").length);
  if(uncertainNode)uncertainNode.textContent=String(entries.filter(entry=>entry.uncertain).length);

  const timeline=root.querySelector("#memoryTimeline");
  if(timeline){
    timeline.innerHTML=entries.length?entries.map(entry=>{
      const sourceClass=entry.uncertain?" uncertain":"";
      const fact=entry.fact?("<span class=\"memory-fact\">"+escapeHtml(entry.fact.subject)+" · "+escapeHtml(entry.fact.predicate)+" = "+escapeHtml(JSON.stringify(entry.fact.value))+"</span>"):"";
      const ref=entry.externalRef?("<span class=\"memory-ref\">"+escapeHtml(entry.externalRef.type)+": "+escapeHtml(entry.externalRef.id)+"</span>"):"";
      return "<article class=\"memory-entry"+sourceClass+"\" data-memory-id=\""+escapeHtml(entry.id)+"\">"+
        "<div class=\"memory-entry-head\"><span class=\"memory-kind "+escapeHtml(entry.kind)+"\">"+escapeHtml(entry.kind)+" · "+escapeHtml(entry.category)+"</span>"+
        "<time>"+escapeHtml(entry.timestamp)+"</time></div>"+
        "<strong>"+escapeHtml(entry.summary)+"</strong>"+
        "<div class=\"memory-source\"><span><b>Source:</b> "+escapeHtml(entry.source.label)+"</span><span><b>Reliability:</b> "+escapeHtml(entry.reliability)+(entry.uncertain?" · UNCERTAIN":"")+"</span></div>"+
        "<div class=\"memory-metrics\"><span>Confidence "+escapeHtml(percent(entry.confidence))+"</span><span>Relevance "+escapeHtml(percent(entry.relevance))+"</span><span>"+escapeHtml(entry.authority)+"</span></div>"+
        fact+ref+"<small>"+escapeHtml(entry.id)+"</small></article>";
    }).join(""):"<p class=\"memory-empty\">No memory records for this actor.</p>";
  }
  setCheck("vMemorySharedFormat",verification.sharedRecordFormat);
  setCheck("vMemoryTraceable",verification.traceable&&verification.adviceRefsTraceable);
  setCheck("vMemoryUncertain",verification.uncertainPreserved);
  setCheck("vMemoryDeterministic",verification.deterministicIds&&verification.sequenceStable&&verification.uniqueIds);
  setCheck("vMemoryReload",verification.storageRoundTrip);
  setCheck("vMemoryAuthority",verification.authoritySafe&&verification.worldMutationApi===false);
  root.dataset.actorKey=actorKey(actor);
  root.dataset.entryCount=String(entries.length);
  return Object.freeze({actor:Object.freeze({...actor}),entries,verification});
}

const api=Object.freeze({
  STORAGE_PREFIX,VERSION,VALID_ACTOR_KINDS,VALID_KINDS,VALID_CATEGORIES,VALID_SOURCE_TYPES,VALID_RELIABILITY,ENTRY_SCHEMA,
  storageKey,normalizeActor,list,snapshot,recordMemory,recordFact,recordObservation,recordAdviceReference,clear,verify,renderDebugPanel
});
scope().CharacterMemory=api;
scope().MemoryLedger=api;
scope().WorldFactMemory=api;
})();