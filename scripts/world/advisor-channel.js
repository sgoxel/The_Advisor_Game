(function(){
"use strict";

const STORAGE_PREFIX="theAdvisorGame.advice.v2";
const DEFAULT_PROTAGONIST_ID="protagonist";
const VALID_STATUSES=Object.freeze([
  "delivered",
  "considered",
  "accepted",
  "rejected",
  "deferred",
  "modified",
  "forgotten"
]);
const TRANSITIONS=Object.freeze({
  delivered:Object.freeze(["considered","deferred","forgotten"]),
  considered:Object.freeze(["accepted","rejected","deferred","modified","forgotten"]),
  deferred:Object.freeze(["considered","accepted","rejected","modified","forgotten"]),
  accepted:Object.freeze(["forgotten"]),
  rejected:Object.freeze(["forgotten"]),
  modified:Object.freeze(["forgotten"]),
  forgotten:Object.freeze([])
});

function scope(){
  return typeof window!=="undefined"?window:globalThis;
}

function storage(){
  try{return scope().localStorage||null}catch(_){return null}
}

function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}

function normalizeProtagonistId(value){
  const text=String(value==null?"":value).trim();
  return text||DEFAULT_PROTAGONIST_ID;
}

function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}

function storageKey(seedValue,protagonistIdValue){
  return STORAGE_PREFIX+":"+normalizeSeed(seedValue)+":"+normalizeProtagonistId(protagonistIdValue);
}

function pad2(value){
  return String(value).padStart(2,"0");
}

function timestampFromParts(parts){
  if(!parts)return null;
  const year=Number(parts.year);
  const month=Number(parts.month);
  const day=Number(parts.day);
  const hour=Number(parts.hour||0);
  const minute=Number(parts.minute||0);
  const second=Number(parts.second||0);
  if(!Number.isFinite(year)||!Number.isFinite(month)||!Number.isFinite(day))return null;
  return String(year).padStart(4,"0")+"-"+pad2(month)+"-"+pad2(day)+" "+pad2(hour)+":"+pad2(minute)+":"+pad2(second);
}

function campaignStartTimestamp(){
  const globalScope=scope();
  const campaign=globalScope.SeedSystem?.getCampaign?.();
  if(campaign?.fantasyStart){
    return globalScope.GameTime?.toTimestampKey?.(campaign.fantasyStart)
      || timestampFromParts(campaign.fantasyStart)
      || "0000-01-01 00:00:00";
  }
  return "0000-01-01 00:00:00";
}

function currentCampaignTimestamp(){
  const globalScope=scope();
  return globalScope.GameTime?.getTimestampKey?.()
    || campaignStartTimestamp();
}

function normalizeTimestamp(value,fallbackValue){
  if(value==null)return fallbackValue||currentCampaignTimestamp();
  if(typeof value==="number"&&Number.isFinite(value)){
    const d=new Date(value);
    return String(d.getUTCFullYear()).padStart(4,"0")+"-"+pad2(d.getUTCMonth()+1)+"-"+pad2(d.getUTCDate())+" "+pad2(d.getUTCHours())+":"+pad2(d.getUTCMinutes())+":"+pad2(d.getUTCSeconds());
  }
  if(value instanceof Date){
    return normalizeTimestamp(value.getTime(),fallbackValue);
  }
  const text=String(value).trim();
  const direct=/^(\d{4,})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if(direct)return direct[1]+"-"+direct[2]+"-"+direct[3]+" "+direct[4]+":"+direct[5]+":"+direct[6];
  const iso=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if(iso)return iso[1]+"-"+iso[2]+"-"+iso[3]+" "+iso[4]+":"+iso[5]+":"+iso[6];
  return fallbackValue||currentCampaignTimestamp();
}

function normalizeStatus(value){
  const text=String(value==null?"delivered":value).trim().toLowerCase();
  return VALID_STATUSES.includes(text)?text:"delivered";
}

function normalizeTopic(value){
  const text=String(value==null?"":value).trim().replace(/\s+/g," ");
  return text||"General advisory reminder";
}

function normalizeTarget(value){
  if(value==null||value===""){
    return {kind:"general",label:"General advice",x:null,y:null,id:null};
  }
  if(typeof value==="string"){
    const label=String(value).trim();
    return {kind:"topic",label:label||"General advice",x:null,y:null,id:null};
  }
  if(typeof value==="object"){
    const x=value.x!=null?String(value.x):null;
    const y=value.y!=null?String(value.y):null;
    const id=value.id!=null?String(value.id):null;
    const kind=String(value.kind||((x!=null&&y!=null)?"coordinate":(id?"entity":"topic")));
    const label=String(value.label||value.name||id||((x!=null&&y!=null)?("Coordinate ("+x+","+y+")"):"General advice")).trim()||"General advice";
    return {kind,label,x,y,id};
  }
  return {kind:"topic",label:String(value),x:null,y:null,id:null};
}

function advisorId(seed,protagonistId){
  return "ADVISOR-"+hashText(normalizeSeed(seed)+"|"+normalizeProtagonistId(protagonistId));
}

function makeAdvisor(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  return {
    id:advisorId(seed,protagonistId),
    role:"advisor",
    campaignSeed:seed,
    protagonistId,
    createdAt:campaignStartTimestamp()
  };
}

function normalizeHistory(history,entryStatus,entryTimestamp){
  const rows=Array.isArray(history)?history:[];
  const normalized=rows.map(row=>({
    status:normalizeStatus(row?.status),
    timestamp:normalizeTimestamp(row?.timestamp,entryTimestamp),
    actor:String(row?.actor||"protagonist")
  }));
  if(!normalized.length){
    normalized.push({status:normalizeStatus(entryStatus),timestamp:entryTimestamp,actor:"advisor"});
  }
  return normalized;
}

function normalizeEntry(entry,seedValue,protagonistIdValue,index){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const sequence=Number.isInteger(entry?.sequence)&&entry.sequence>0?entry.sequence:index+1;
  const topic=normalizeTopic(entry?.topic);
  const target=normalizeTarget(entry?.target);
  const timestamp=normalizeTimestamp(entry?.timestamp,campaignStartTimestamp());
  const status=normalizeStatus(entry?.status);
  const id=String(entry?.id||nextAdviceId(seed,protagonistId,sequence,topic,target));
  return {
    id,
    sequence,
    topic,
    target,
    status,
    timestamp,
    createdAt:normalizeTimestamp(entry?.createdAt,timestamp),
    updatedAt:normalizeTimestamp(entry?.updatedAt,timestamp),
    campaignSeed:seed,
    protagonistId,
    details:typeof entry?.details==="string"?entry.details:"",
    history:normalizeHistory(entry?.history,status,timestamp)
  };
}

function blankRecord(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  return {
    version:2,
    advisor:makeAdvisor(seed,protagonistId),
    entries:[]
  };
}

function readRecord(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const store=storage();
  if(!store)return blankRecord(seed,protagonistId);
  try{
    const raw=store.getItem(storageKey(seed,protagonistId));
    if(!raw)return blankRecord(seed,protagonistId);
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||!Array.isArray(parsed.entries)){
      return blankRecord(seed,protagonistId);
    }
    const entries=parsed.entries.map((entry,index)=>normalizeEntry(entry,seed,protagonistId,index));
    entries.sort((a,b)=>a.sequence-b.sequence);
    return {
      version:2,
      advisor:makeAdvisor(seed,protagonistId),
      entries
    };
  }catch(error){
    console.warn("Unable to read advisor channel.",error);
    return blankRecord(seed,protagonistId);
  }
}

function writeRecord(seedValue,protagonistIdValue,record){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const normalized={
    version:2,
    advisor:makeAdvisor(seed,protagonistId),
    entries:(record?.entries||[]).map((entry,index)=>normalizeEntry(entry,seed,protagonistId,index))
  };
  const store=storage();
  if(store){
    try{store.setItem(storageKey(seed,protagonistId),JSON.stringify(normalized))}
    catch(error){console.warn("Unable to persist advisor channel.",error)}
  }
  return normalized;
}

function list(seedValue,protagonistIdValue){
  return readRecord(seedValue,protagonistIdValue).entries.map(entry=>Object.freeze({
    ...entry,
    target:Object.freeze({...entry.target}),
    history:Object.freeze(entry.history.map(row=>Object.freeze({...row})))
  }));
}

function getAdvisor(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const record=readRecord(seed,protagonistId);
  writeRecord(seed,protagonistId,record);
  return Object.freeze({...record.advisor});
}

function nextAdviceId(seedValue,protagonistIdValue,sequence,topicValue,targetValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const topic=normalizeTopic(topicValue);
  const target=normalizeTarget(targetValue);
  const n=Number(sequence);
  const safeSequence=Number.isInteger(n)&&n>0?n:1;
  const identity=seed+"|"+protagonistId+"|"+safeSequence+"|"+topic+"|"+target.kind+"|"+target.label+"|"+(target.id||"")+"|"+(target.x||"")+"|"+(target.y||"");
  return "ADV-"+String(safeSequence).padStart(4,"0")+"-"+hashText(identity);
}

function recordAdvice(seedValue,configValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const config=configValue&&typeof configValue==="object"?configValue:{topic:configValue};
  const protagonistId=normalizeProtagonistId(config.protagonistId||protagonistIdValue);
  const record=readRecord(seed,protagonistId);
  const sequence=record.entries.length+1;
  const topic=normalizeTopic(config.topic||config.message||config.text||config.summary);
  const target=normalizeTarget(config.target);
  const timestamp=normalizeTimestamp(config.timestamp,currentCampaignTimestamp());
  const entry={
    id:nextAdviceId(seed,protagonistId,sequence,topic,target),
    sequence,
    topic,
    target,
    status:"delivered",
    timestamp,
    createdAt:timestamp,
    updatedAt:timestamp,
    campaignSeed:seed,
    protagonistId,
    details:typeof config.details==="string"?config.details:"",
    history:[{status:"delivered",timestamp,actor:"advisor"}]
  };
  record.entries.push(entry);
  writeRecord(seed,protagonistId,record);
  return Object.freeze(normalizeEntry(entry,seed,protagonistId,sequence-1));
}

function resolve(seedValue,adviceId,protagonistIdValue){
  const id=String(adviceId||"");
  return list(seedValue,protagonistIdValue).find(entry=>entry.id===id)||null;
}

function canTransition(fromStatus,toStatus){
  const from=normalizeStatus(fromStatus);
  const to=normalizeStatus(toStatus);
  return from===to||(TRANSITIONS[from]||[]).includes(to);
}

function transition(seedValue,adviceId,nextStatusValue,protagonistIdValue,optionsValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const nextStatus=normalizeStatus(nextStatusValue);
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  const record=readRecord(seed,protagonistId);
  const index=record.entries.findIndex(entry=>entry.id===String(adviceId));
  if(index<0)return null;
  const current=record.entries[index];
  if(!canTransition(current.status,nextStatus))return null;
  if(current.status===nextStatus)return Object.freeze(normalizeEntry(current,seed,protagonistId,index));
  const timestamp=normalizeTimestamp(options.timestamp,currentCampaignTimestamp());
  const actor=String(options.actor||"protagonist");
  const updated={
    ...current,
    status:nextStatus,
    updatedAt:timestamp,
    history:[...current.history,{status:nextStatus,timestamp,actor}]
  };
  record.entries[index]=updated;
  writeRecord(seed,protagonistId,record);
  return Object.freeze(normalizeEntry(updated,seed,protagonistId,index));
}

function updateStatus(seedValue,adviceId,nextStatus,protagonistIdValue,optionsValue){
  return transition(seedValue,adviceId,nextStatus,protagonistIdValue,optionsValue);
}

function snapshot(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  return Object.freeze({
    storageKey:storageKey(seed,protagonistId),
    advisor:getAdvisor(seed,protagonistId),
    entries:Object.freeze(list(seed,protagonistId))
  });
}

function proof(seedValue,protagonistIdValue){
  const seed=normalizeSeed(seedValue);
  const protagonistId=normalizeProtagonistId(protagonistIdValue);
  const first=readRecord(seed,protagonistId);
  const second=readRecord(seed,protagonistId);
  const ids=first.entries.map(entry=>entry.id);
  const sequences=first.entries.map(entry=>entry.sequence);
  const stableAdvisor=first.advisor.id===advisorId(seed,protagonistId)&&first.advisor.campaignSeed===seed&&first.advisor.protagonistId===protagonistId;
  const uniqueIds=new Set(ids).size===ids.length;
  const sequenceStable=sequences.every((value,index)=>value===index+1);
  const validFields=first.entries.every(entry=>
    entry.campaignSeed===seed&&
    entry.protagonistId===protagonistId&&
    typeof entry.topic==="string"&&entry.topic.length>0&&
    typeof entry.target==="object"&&typeof entry.target.label==="string"&&
    typeof entry.timestamp==="string"&&
    VALID_STATUSES.includes(entry.status)
  );
  const validHistory=first.entries.every(entry=>
    Array.isArray(entry.history)&&entry.history.length>0&&
    entry.history[entry.history.length-1].status===entry.status&&
    entry.history.every(row=>VALID_STATUSES.includes(row.status)&&typeof row.timestamp==="string"&&typeof row.actor==="string")
  );
  const deterministicIds=first.entries.every(entry=>
    entry.id===nextAdviceId(seed,protagonistId,entry.sequence,entry.topic,entry.target)
  );
  const storageRoundTrip=JSON.stringify(first)===JSON.stringify(second);
  return Object.freeze({
    pass:stableAdvisor&&uniqueIds&&sequenceStable&&validFields&&validHistory&&deterministicIds&&storageRoundTrip,
    stableAdvisor,
    uniqueIds,
    sequenceStable,
    validFields,
    validHistory,
    deterministicIds,
    storageRoundTrip,
    entryCount:first.entries.length,
    advisor:Object.freeze({...first.advisor}),
    entries:Object.freeze(list(seed,protagonistId))
  });
}

function escapeHtml(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

function statusLabel(value){
  const text=normalizeStatus(value);
  return text.charAt(0).toUpperCase()+text.slice(1);
}

function renderAdvicePanel(seedValue,protagonistIdValue,rootNode){
  const globalScope=scope();
  const target=rootNode||(typeof document!=="undefined"?document.getElementById("advisorPanel"):null);
  if(!target)return null;

  const campaign=globalScope.SeedSystem?.getCampaign?.()||null;
  const seed=normalizeSeed(seedValue||(campaign?.seed)||(globalScope.SeedSystem?.getSettings?.()?.seed));
  const protagonistId=normalizeProtagonistId(protagonistIdValue||DEFAULT_PROTAGONIST_ID);
  const entries=list(seed,protagonistId);
  const advisor=getAdvisor(seed,protagonistId);
  const draftTopic=target.querySelector("#advisorAdviceInput")?.value||"";
  const draftTarget=target.querySelector("#advisorTargetInput")?.value||"";
  const activeCampaign=Boolean(campaign&&campaign.seed===seed);

  const rows=entries.slice().reverse().slice(0,8).map(entry=>{
    const latest=entry.history[entry.history.length-1];
    return "<li data-advice-id=\""+escapeHtml(entry.id)+"\">"+
      "<span class=\"advice-status "+escapeHtml(entry.status)+"\">"+escapeHtml(statusLabel(entry.status))+"</span>"+
      "<div class=\"advice-copy\"><strong>"+escapeHtml(entry.topic)+"</strong>"+
      "<small><b>Target:</b> "+escapeHtml(entry.target.label)+"</small>"+
      "<small><b>Delivered:</b> "+escapeHtml(entry.timestamp)+" · <b>Updated:</b> "+escapeHtml(latest.timestamp)+"</small>"+
      "<small class=\"advice-id\">"+escapeHtml(entry.id)+"</small></div></li>";
  }).join("");

  target.innerHTML=
    "<div class=\"advisor-heading\"><div><h3>Advisor Channel</h3><p>Persistent counsel for this campaign.</p></div><span class=\"advisor-record-id\" title=\"Stable advisor identity\">"+escapeHtml(advisor.id)+"</span></div>"+
    "<form id=\"advisorComposeForm\" class=\"advisor-compose\" autocomplete=\"off\">"+
      "<label for=\"advisorAdviceInput\">Advice</label>"+
      "<textarea id=\"advisorAdviceInput\" maxlength=\"180\" rows=\"2\" placeholder=\"Offer advice to the protagonist\" "+(activeCampaign?"":"disabled")+"></textarea>"+
      "<div class=\"advisor-compose-row\"><input id=\"advisorTargetInput\" maxlength=\"80\" placeholder=\"Target or topic\" aria-label=\"Advice target\" "+(activeCampaign?"":"disabled")+">"+
      "<button id=\"advisorDeliverButton\" type=\"submit\" "+(activeCampaign?"":"disabled")+">Deliver advice</button></div>"+
    "</form>"+
    "<p class=\"advisor-boundary\">Advice is a proposal. The protagonist decides; Simulation remains authoritative.</p>"+
    "<ul class=\"advisor-log\">"+(rows||"<li class=\"advice-empty\">No advice yet. Deliver counsel above to create the first persistent entry.</li>")+"</ul>";

  const topicInput=target.querySelector("#advisorAdviceInput");
  const targetInput=target.querySelector("#advisorTargetInput");
  if(topicInput)topicInput.value=draftTopic;
  if(targetInput)targetInput.value=draftTarget;

  const form=target.querySelector("#advisorComposeForm");
  if(form&&activeCampaign){
    form.addEventListener("submit",event=>{
      event.preventDefault();
      const topic=topicInput?.value?.trim()||"";
      if(!topic){
        topicInput?.focus();
        return;
      }
      const targetText=targetInput?.value?.trim()||"";
      recordAdvice(seed,{
        topic,
        target:targetText?{kind:"topic",label:targetText}:{kind:"general",label:"General advice"}
      },protagonistId);
      form.reset();
      renderAdvicePanel(seed,protagonistId,target);
    });
  }

  target.dataset.advisorSeed=seed;
  target.dataset.protagonistId=protagonistId;
  target.dataset.adviceCount=String(entries.length);
  return target;
}

function initAdvicePanel(){
  if(typeof document==="undefined")return null;
  let panel=document.getElementById("advisorPanel");
  if(!panel){
    panel=document.createElement("aside");
    panel.id="advisorPanel";
    panel.className="advisor-panel";
    document.body.appendChild(panel);
  }
  return renderAdvicePanel(undefined,DEFAULT_PROTAGONIST_ID,panel);
}

const api=Object.freeze({
  STORAGE_PREFIX,
  VALID_STATUSES,
  TRANSITIONS,
  storageKey,
  normalizeSeed,
  normalizeProtagonistId,
  normalizeStatus,
  normalizeTarget,
  nextAdviceId,
  getAdvisor,
  list,
  snapshot,
  recordAdvice,
  resolve,
  canTransition,
  transition,
  updateStatus,
  proof,
  renderAdvicePanel,
  initAdvicePanel
});

scope().AdvisorChannel=api;
scope().AdviceLog=api;
scope().AdviceChannel=api;
scope().PersistentAdvice=api;
scope().AdvisorInterface=Object.freeze({
  init:initAdvicePanel,
  render:renderAdvicePanel,
  record:recordAdvice,
  transition,
  updateStatus,
  build:list,
  proof,
  list,
  getAdvisor
});
})();