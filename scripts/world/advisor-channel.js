(function(){
"use strict";

const STORAGE_PREFIX="theAdvisorGame.advice.v1";
const DEFAULT_PROTAGONIST_ID="protagonist";
const VALID_STATUSES=Object.freeze([
  "delivered",
  "considered",
  "accepted",
  "rejected",
  "deferred",
  "forgotten"
]);

function normalizeSeed(seedValue){
  const seed=String(seedValue==null?"":seedValue).trim();
  return seed || "The_Advisor_Game_20260924";
}

function normalizeProtagonistId(value){
  const text=String(value==null?"":value).trim();
  return text || DEFAULT_PROTAGONIST_ID;
}

function storageKey(seedValue, protagonistIdValue){
  return `${STORAGE_PREFIX}:${normalizeSeed(seedValue)}:${normalizeProtagonistId(protagonistIdValue)}`;
}

function pad2(value){
  return String(value).padStart(2,"0");
}

function normalizeTimestamp(value){
  if(value==null){
    return new Date().toISOString().replace("T"," ").slice(0,19);
  }
  if(value instanceof Date){
    return value.toISOString().replace("T"," ").slice(0,19);
  }
  if(typeof value==="string"){
    const text=value.trim();
    const direct=/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if(direct)return text;
    const iso=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
    if(iso)return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6]}`;
    if(!Number.isNaN(Date.parse(text))) return new Date(Date.parse(text)).toISOString().replace("T"," ").slice(0,19);
  }
  if(typeof value==="number" && Number.isFinite(value)){
    return new Date(value).toISOString().replace("T"," ").slice(0,19);
  }
  return new Date().toISOString().replace("T"," ").slice(0,19);
}

function normalizeStatus(value){
  const text=String(value==null?"delivered":value).trim().toLowerCase();
  return VALID_STATUSES.includes(text)?text:"delivered";
}

function normalizeTopic(value){
  const text=String(value==null?"":value).trim();
  return text || "General advisory reminder";
}

function normalizeTarget(value){
  if(value==null){
    return Object.freeze({kind:"general",label:"General advice",x:null,y:null,id:null});
  }
  if(typeof value==="string"){
    return Object.freeze({kind:"topic",label:value,x:null,y:null,id:null});
  }
  if(typeof value==="object"){
    const kind=value.kind||((value.x!=null&&value.y!=null)?"coordinate":(value.id?"entity":"general"));
    const label=value.label||value.name||value.id||((value.x!=null&&value.y!=null)?`Coordinate (${value.x},${value.y})`:"General advice");
    return Object.freeze({
      kind,
      label,
      x:value.x!=null?String(value.x):null,
      y:value.y!=null?String(value.y):null,
      id:value.id!=null?String(value.id):null
    });
  }
  return Object.freeze({kind:"general",label:String(value),x:null,y:null,id:null});
}

function getStorage(){
  const globalScope=(typeof window!=="undefined"?window:globalThis);
  return globalScope && globalScope.localStorage ? globalScope.localStorage : null;
}

function readCampaignEntries(seedValue, protagonistIdValue){
  const storage=getStorage();
  if(!storage) return [];
  const key=storageKey(seedValue, protagonistIdValue);
  try{
    const raw=storage.getItem(key);
    if(!raw) return [];
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return parsed.map(entry=>Object.freeze({
      id:String(entry.id||"A-unknown"),
      topic:normalizeTopic(entry.topic),
      status:normalizeStatus(entry.status),
      timestamp:normalizeTimestamp(entry.timestamp),
      updatedAt:normalizeTimestamp(entry.updatedAt || entry.timestamp),
      createdAt:normalizeTimestamp(entry.createdAt || entry.timestamp),
      campaignSeed:normalizeSeed(entry.campaignSeed || seedValue),
      protagonistId:normalizeProtagonistId(entry.protagonistId || protagonistIdValue),
      target:normalizeTarget(entry.target),
      details:typeof entry.details==="string"?entry.details:""
    }));
  }catch(error){
    console.warn("Unable to read advisor log.",error);
    return [];
  }
}

function writeCampaignEntries(seedValue, protagonistIdValue, entries){
  const storage=getStorage();
  if(!storage) return entries;
  storage.setItem(storageKey(seedValue, protagonistIdValue), JSON.stringify(entries));
  return entries;
}

function list(seedValue, protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
  return readCampaignEntries(seed, protagonist).slice().sort((a,b)=>{
    const at=Date.parse(a.timestamp.replace(" ","T")+"Z");
    const bt=Date.parse(b.timestamp.replace(" ","T")+"Z");
    return at-bt;
  });
}

function build(seedValue, protagonistIdValue){
  return Object.freeze(list(seedValue, protagonistIdValue));
}

function nextAdviceId(seedValue, protagonistIdValue, topic, target){
  const seed=normalizeSeed(seedValue);
  const protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
  const tombstone=`${seed}|${protagonist}|${normalizeTopic(topic)}|${normalizeTarget(target).label}`;
  let hash=2166136261>>>0;
  for(let i=0;i<tombstone.length;i++){
    hash^=tombstone.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  const sequence=list(seed, protagonist).length + 1;
  return `A-${(hash>>>0).toString(16).slice(0,8).toUpperCase()}-${pad2(sequence)}`;
}

function recordAdvice(seedValue, topicOrConfig, targetOrStatus, statusValue, protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const fallbackProtagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);

  let protagonist=fallbackProtagonist;
  let topic="General advisory reminder";
  let target=null;
  let status="delivered";
  let details="";
  let timestamp=new Date();

  if(topicOrConfig && typeof topicOrConfig==="object"){
    const source=topicOrConfig;
    protagonist=normalizeProtagonistId(source.protagonistId||protagonistIdValue||DEFAULT_PROTAGONIST_ID);
    topic=normalizeTopic(source.topic || source.message || source.text || source.summary || source.label);
    target=source.target || targetOrStatus || null;
    status=normalizeStatus(source.status || statusValue || "delivered");
    details=typeof source.details==="string"?source.details:(source.note||"");
    if(source.timestamp) timestamp=new Date(source.timestamp);
  }else{
    protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
    topic=normalizeTopic(topicOrConfig);
    if(targetOrStatus && typeof targetOrStatus==="object"){
      target=targetOrStatus;
      status=normalizeStatus(statusValue || "delivered");
    }else if(typeof targetOrStatus==="string"){
      status=normalizeStatus(targetOrStatus);
    }else{
      status=normalizeStatus(statusValue || "delivered");
    }
  }

  const entry={
    id:nextAdviceId(seed, protagonist, topic, target),
    topic,
    status,
    timestamp:normalizeTimestamp(timestamp),
    updatedAt:normalizeTimestamp(timestamp),
    createdAt:normalizeTimestamp(timestamp),
    campaignSeed:seed,
    protagonistId:protagonist,
    target:normalizeTarget(target),
    details
  };

  const entries=readCampaignEntries(seed, protagonist);
  entries.push(entry);
  writeCampaignEntries(seed, protagonist, entries);
  return Object.freeze(entry);
}

function updateStatus(seedValue, adviceId, nextStatus, protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
  const entries=readCampaignEntries(seed, protagonist);
  const index=entries.findIndex(entry=>entry.id===String(adviceId));
  if(index<0) return null;
  const current=entries[index];
  const updated=Object.freeze({
    ...current,
    status:normalizeStatus(nextStatus),
    updatedAt:normalizeTimestamp(new Date())
  });
  entries[index]=updated;
  writeCampaignEntries(seed, protagonist, entries);
  return updated;
}

function transition(seedValue, adviceId, nextStatus, protagonistIdValue){
  return updateStatus(seedValue, adviceId, nextStatus, protagonistIdValue);
}

function resolve(seedValue, adviceId, protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
  const entries=readCampaignEntries(seed, protagonist);
  return entries.find(entry=>entry.id===String(adviceId)) || null;
}

function proof(seedValue, protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonist=normalizeProtagonistId(protagonistIdValue || DEFAULT_PROTAGONIST_ID);
  const first=build(seed, protagonist);
  const second=build(seed, protagonist);
  const deterministic=JSON.stringify(first)===JSON.stringify(second);
  const validStatuses=first.every(entry=>VALID_STATUSES.includes(entry.status));
  const validFields=first.every(entry=>
    typeof entry.id==="string" &&
    typeof entry.topic==="string" &&
    typeof entry.timestamp==="string" &&
    typeof entry.target==="object" &&
    typeof entry.campaignSeed==="string"
  );
  return Object.freeze({
    pass:deterministic&&validStatuses&&validFields,
    deterministic,
    validStatuses,
    validFields,
    entryCount:first.length,
    entries:first
  });
}

function renderAdvicePanel(seedValue, protagonistIdValue, rootNode){
  const target=rootNode || (typeof document!=="undefined" && document.getElementById("advisorPanel"));
  if(!target) return null;
  const seed=normalizeSeed(seedValue || (typeof window!=="undefined" && window.SeedSystem && SeedSystem.getCampaign() ? SeedSystem.getCampaign().seed : null));
  const protagonist=normalizeProtagonistId(protagonistIdValue || (typeof window!=="undefined" && window.SeedSystem && SeedSystem.getCampaign() ? SeedSystem.getCampaign().protagonistId : DEFAULT_PROTAGONIST_ID));
  const entries=list(seed, protagonist);
  const rows=(entries.slice(-6).map(entry=>`<li><span class="advice-status ${entry.status}">${entry.status}</span><div><strong>${entry.topic}</strong><small>${entry.timestamp}</small></div></li>`).join("") || "<li class=\"advice-empty\">No advice yet.</li>");
  target.innerHTML=`<h3>Advisor</h3><ul class="advisor-log">${rows}</ul>`;
  return target;
}

function initAdvicePanel(){
  if(typeof document==="undefined") return null;
  let panel=document.getElementById("advisorPanel");
  if(!panel){
    panel=document.createElement("aside");
    panel.id="advisorPanel";
    panel.className="advisor-panel";
    const anchor=document.querySelector(".status-area");
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    }else{
      document.body.appendChild(panel);
    }
  }
  renderAdvicePanel(undefined, undefined, panel);
  return panel;
}

const api=Object.freeze({
  STORAGE_PREFIX,
  VALID_STATUSES,
  normalizeSeed,
  normalizeProtagonistId,
  normalizeStatus,
  normalizeTarget,
  list,
  build,
  recordAdvice,
  updateStatus,
  transition,
  resolve,
  proof,
  renderAdvicePanel,
  initAdvicePanel
});

window.AdvisorChannel=api;
window.AdviceLog=api;
window.AdviceChannel=api;
window.PersistentAdvice=api;
window.AdvisorInterface=Object.freeze({
  init:initAdvicePanel,
  render:renderAdvicePanel,
  record:recordAdvice,
  updateStatus,
  transition,
  build,
  proof,
  list
});
})();
