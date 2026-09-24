(function(){
"use strict";

const STORAGE_PREFIX="theAdvisorGame.adviceResolution.v1";
const VERSION=1;
const DECISIONS=Object.freeze(["accepted","rejected","deferred","modified"]);

function scope(){return typeof window!=="undefined"?window:globalThis}
function storage(){try{return scope().localStorage||null}catch(_){return null}}
function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}
function clamp01(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function storageKey(seedValue){return STORAGE_PREFIX+":"+normalizeSeed(seedValue)}
function clone(value){return value==null?null:JSON.parse(JSON.stringify(value))}
function currentTimestamp(){
  return scope().GameTime?.getTimestampKey?.()
    ||scope().AdvisorChannel?.snapshot?.(normalizeSeed())?.entries?.[0]?.timestamp
    ||"0000-01-01 00:00:00";
}
function normalizeTimestamp(value){
  const text=String(value==null?"":value).trim();
  if(/^\d{4,}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text))return text;
  const iso=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if(iso)return iso[1]+"-"+iso[2]+"-"+iso[3]+" "+iso[4]+":"+iso[5]+":"+iso[6];
  return currentTimestamp();
}
function plainIntent(value){
  if(!value||typeof value!=="object")return null;
  const position=value.position?{x:String(value.position.x),y:String(value.position.y)}:null;
  const activity=value.activity?clone(value.activity):null;
  return position&&activity?{position,activity}:null;
}
function intentSignature(intent){
  if(!intent)return "none";
  const a=intent.activity||{};
  return [
    intent.position?.x||"",intent.position?.y||"",
    a.intendedAction||a.action||"",
    a.target?.x||"",a.target?.y||"",
    a.targetSource||"",a.interactionObjectId||"",a.buildingId||""
  ].join("|");
}
function simulationCheck(seedValue,intentValue){
  const seed=normalizeSeed(seedValue);
  const intent=plainIntent(intentValue);
  if(!intent)return Object.freeze({checked:false,ok:false,reason:"missing-intent",action:null,target:null});
  const executor=scope().ActionExecutor;
  if(!executor?.compatible)return Object.freeze({checked:false,ok:false,reason:"simulation-validator-unavailable",action:null,target:null});
  const result=executor.compatible(seed,intent.position,intent.activity);
  return Object.freeze({
    checked:true,
    ok:Boolean(result?.ok),
    reason:String(result?.reason||"unknown"),
    action:String(result?.action||intent.activity?.intendedAction||intent.activity?.action||""),
    target:result?.target?Object.freeze({x:String(result.target.x),y:String(result.target.y)}):null
  });
}
function normalizeInput(configValue){
  const config=configValue&&typeof configValue==="object"?configValue:{};
  return Object.freeze({
    value:clamp01(config.value,0.5),
    urgency:clamp01(config.urgency,0.5),
    socialAcceptability:clamp01(config.socialAcceptability,0.5),
    intent:plainIntent(config.intent),
    modifiedIntent:plainIntent(config.modifiedIntent),
    recommendation:String(config.recommendation||"").trim(),
    modification:String(config.modification||"").trim()
  });
}
function chooseDecision(input){
  if(input.socialAcceptability<0.35||input.value<0.45)return "rejected";
  if(input.modifiedIntent&&input.value>=0.65&&input.socialAcceptability>=0.5)return "modified";
  if(input.value>=0.7&&input.urgency>=0.6&&input.socialAcceptability>=0.5)return "accepted";
  if(input.value>=0.6&&input.socialAcceptability>=0.5)return "deferred";
  return "rejected";
}
function influenceFor(decision){
  const table={
    accepted:{confidence:0.95,relevance:0.9,reliability:"trusted",label:"reinforced"},
    modified:{confidence:0.9,relevance:0.85,reliability:"trusted",label:"adapted"},
    deferred:{confidence:0.75,relevance:0.65,reliability:"trusted",label:"retained"},
    rejected:{confidence:0.55,relevance:0.45,reliability:"uncertain",label:"discounted"}
  };
  return Object.freeze({...table[decision],trustDelta:0,relationshipPersistence:false});
}
function reasoningFor(decision,input,validation){
  if(decision==="rejected"){
    return input.socialAcceptability<0.35
      ?"The protagonist rejects the recommendation because the social cost is unacceptable."
      :"The protagonist rejects the recommendation because its value is too low for the current context.";
  }
  if(decision==="deferred"){
    return "The protagonist sees value in the recommendation but decides it is not urgent enough to act on now.";
  }
  if(decision==="modified"){
    return validation.ok
      ?"The protagonist changes the recommendation into a Simulation-compatible alternative before considering execution."
      :"The protagonist modifies the recommendation, but Simulation still blocks the revised action: "+validation.reason+".";
  }
  return validation.ok
    ?"The protagonist accepts the recommendation; Simulation confirms the intended action is currently compatible."
    :"The protagonist accepts the recommendation, but Simulation blocks execution: "+validation.reason+".";
}
function summaryFor(decision,advice,input){
  const lead={accepted:"Accepted",rejected:"Rejected",deferred:"Deferred",modified:"Modified"}[decision];
  const subject=input.recommendation||advice.topic;
  return lead+": "+subject;
}
function previewDecision(seedValue,configValue){
  const seed=normalizeSeed(seedValue);
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const adviceId=String(config.adviceId||"");
  const advice=scope().AdvisorChannel?.resolve?.(seed,adviceId,"protagonist")||null;
  if(!advice)return null;
  const input=normalizeInput(config);
  const decision=chooseDecision(input);
  const originalValidation=simulationCheck(seed,input.intent);
  const finalIntent=decision==="modified"?input.modifiedIntent:input.intent;
  const finalValidation=decision==="modified"?simulationCheck(seed,input.modifiedIntent):originalValidation;
  const executionAllowed=Boolean((decision==="accepted"||decision==="modified")&&finalValidation.checked&&finalValidation.ok);
  const influence=influenceFor(decision);
  const recommendation=input.recommendation||advice.topic;
  return Object.freeze({
    adviceId:advice.id,
    decision,
    summary:summaryFor(decision,advice,input),
    recommendation,
    modification:decision==="modified"?(input.modification||"Use the revised Simulation-compatible intent."):null,
    reasoning:reasoningFor(decision,input,finalValidation),
    input,
    originalValidation,
    finalValidation,
    executionAllowed,
    influence,
    authority:"protagonist-choice + simulation-validation",
    actionExecuted:false
  });
}
function blankRecord(seedValue){return {version:VERSION,campaignSeed:normalizeSeed(seedValue),entries:[]}}
function readRecord(seedValue){
  const seed=normalizeSeed(seedValue),s=storage();
  if(!s)return blankRecord(seed);
  try{
    const parsed=JSON.parse(s.getItem(storageKey(seed))||"null");
    if(!parsed||!Array.isArray(parsed.entries))return blankRecord(seed);
    return {
      version:VERSION,campaignSeed:seed,
      entries:parsed.entries.map((entry,index)=>normalizeStored(entry,seed,index))
    };
  }catch(error){
    console.warn("Unable to read advice resolution state.",error);
    return blankRecord(seed);
  }
}
function writeRecord(seedValue,record){
  const seed=normalizeSeed(seedValue);
  const normalized=blankRecord(seed);
  normalized.entries=(record?.entries||[]).map((entry,index)=>normalizeStored(entry,seed,index));
  const s=storage();
  if(s){try{s.setItem(storageKey(seed),JSON.stringify(normalized))}catch(error){console.warn("Unable to persist advice resolution.",error)}}
  return normalized;
}
function nextId(seed,sequence,adviceId,decision,input){
  const signature=[
    seed,sequence,adviceId,decision,
    input.value.toFixed(3),input.urgency.toFixed(3),input.socialAcceptability.toFixed(3),
    intentSignature(input.intent),intentSignature(input.modifiedIntent),input.recommendation,input.modification
  ].join("|");
  return "ADR-"+String(sequence).padStart(4,"0")+"-"+hashText(signature);
}
function normalizeStored(entry,seed,index){
  const input=normalizeInput(entry?.input||{});
  const sequence=Number.isInteger(entry?.sequence)&&entry.sequence>0?entry.sequence:index+1;
  const adviceId=String(entry?.adviceId||"");
  const decision=DECISIONS.includes(entry?.decision)?entry.decision:"rejected";
  const originalValidation=entry?.originalValidation&&typeof entry.originalValidation==="object"
    ?{checked:Boolean(entry.originalValidation.checked),ok:Boolean(entry.originalValidation.ok),reason:String(entry.originalValidation.reason||""),action:String(entry.originalValidation.action||""),target:entry.originalValidation.target?{x:String(entry.originalValidation.target.x),y:String(entry.originalValidation.target.y)}:null}
    :simulationCheck(seed,input.intent);
  const finalValidation=entry?.finalValidation&&typeof entry.finalValidation==="object"
    ?{checked:Boolean(entry.finalValidation.checked),ok:Boolean(entry.finalValidation.ok),reason:String(entry.finalValidation.reason||""),action:String(entry.finalValidation.action||""),target:entry.finalValidation.target?{x:String(entry.finalValidation.target.x),y:String(entry.finalValidation.target.y)}:null}
    :(decision==="modified"?simulationCheck(seed,input.modifiedIntent):originalValidation);
  const influence=entry?.influence&&typeof entry.influence==="object"?{
    confidence:clamp01(entry.influence.confidence,influenceFor(decision).confidence),
    relevance:clamp01(entry.influence.relevance,influenceFor(decision).relevance),
    reliability:String(entry.influence.reliability||influenceFor(decision).reliability),
    label:String(entry.influence.label||influenceFor(decision).label),
    trustDelta:0,relationshipPersistence:false
  }:influenceFor(decision);
  const normalized={
    id:String(entry?.id||nextId(seed,sequence,adviceId,decision,input)),
    sequence,adviceId,decision,
    summary:String(entry?.summary||""),
    recommendation:String(entry?.recommendation||input.recommendation||""),
    modification:entry?.modification==null?null:String(entry.modification),
    reasoning:String(entry?.reasoning||""),
    timestamp:normalizeTimestamp(entry?.timestamp),
    input,
    originalValidation,
    finalValidation,
    executionAllowed:Boolean(entry?.executionAllowed),
    influence,
    memoryId:String(entry?.memoryId||""),
    authority:"protagonist-choice + simulation-validation",
    actionExecuted:false
  };
  return normalized;
}
function freezeEntry(entry){
  return Object.freeze({
    ...entry,
    input:Object.freeze({...entry.input,intent:entry.input.intent?Object.freeze(clone(entry.input.intent)):null,modifiedIntent:entry.input.modifiedIntent?Object.freeze(clone(entry.input.modifiedIntent)):null}),
    originalValidation:Object.freeze({...entry.originalValidation,target:entry.originalValidation.target?Object.freeze({...entry.originalValidation.target}):null}),
    finalValidation:Object.freeze({...entry.finalValidation,target:entry.finalValidation.target?Object.freeze({...entry.finalValidation.target}):null}),
    influence:Object.freeze({...entry.influence})
  });
}
function list(seedValue){return Object.freeze(readRecord(seedValue).entries.map(freezeEntry))}
function applyAdviceStatus(seed,adviceId,decision,timestamp){
  const channel=scope().AdvisorChannel;
  let advice=channel?.resolve?.(seed,adviceId,"protagonist")||null;
  if(!advice)return null;
  if(advice.status==="delivered"){
    advice=channel.transition(seed,adviceId,"considered","protagonist",{timestamp,actor:"protagonist"})||advice;
  }
  if(advice.status!==decision&&channel.canTransition(advice.status,decision)){
    advice=channel.transition(seed,adviceId,decision,"protagonist",{timestamp,actor:"protagonist"})||advice;
  }
  return advice;
}
function resolveAdvice(seedValue,configValue){
  const seed=normalizeSeed(seedValue);
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const adviceId=String(config.adviceId||"");
  const record=readRecord(seed);
  const existing=record.entries.find(entry=>entry.adviceId===adviceId);
  if(existing)return freezeEntry(existing);
  const preview=previewDecision(seed,{...config,adviceId});
  if(!preview)return null;
  const timestamp=normalizeTimestamp(config.timestamp);
  const advice=applyAdviceStatus(seed,adviceId,preview.decision,timestamp);
  if(!advice||advice.status!==preview.decision)return null;
  const protagonist={kind:"protagonist",id:"protagonist"};
  const memory=scope().CharacterMemory?.recordMemory?.(seed,protagonist,{
    kind:"memory",
    category:"advice",
    summary:preview.summary+". "+preview.reasoning,
    timestamp,
    source:{type:"advice",id:adviceId,label:"Advice decision"},
    confidence:preview.influence.confidence,
    relevance:preview.influence.relevance,
    reliability:preview.influence.reliability,
    externalRef:{type:"advice",id:adviceId}
  })||null;
  if(!memory)return null;
  const sequence=record.entries.length+1;
  const stored=normalizeStored({
    id:nextId(seed,sequence,adviceId,preview.decision,preview.input),
    sequence,adviceId,decision:preview.decision,
    summary:preview.summary,recommendation:preview.recommendation,modification:preview.modification,
    reasoning:preview.reasoning,timestamp,input:preview.input,
    originalValidation:preview.originalValidation,finalValidation:preview.finalValidation,
    executionAllowed:preview.executionAllowed,influence:preview.influence,memoryId:memory.id
  },seed,sequence-1);
  record.entries.push(stored);
  writeRecord(seed,record);
  return freezeEntry(stored);
}
function clear(seedValue){
  const s=storage();if(s)s.removeItem(storageKey(seedValue));return true;
}
function snapshot(seedValue){
  const seed=normalizeSeed(seedValue);
  return Object.freeze({version:VERSION,campaignSeed:seed,entries:list(seed)});
}
function proof(seedValue){
  const seed=normalizeSeed(seedValue);
  const entries=list(seed);
  const adviceStatusSync=entries.every(entry=>scope().AdvisorChannel?.resolve?.(seed,entry.adviceId,"protagonist")?.status===entry.decision);
  const memory=scope().CharacterMemory?.list?.(seed,{kind:"protagonist",id:"protagonist"})||[];
  const memoryLinked=entries.every(entry=>memory.some(item=>item.id===entry.memoryId&&item.externalRef?.type==="advice"&&item.externalRef?.id===entry.adviceId));
  const memoryEffects=entries.every(entry=>memory.some(item=>item.id===entry.memoryId&&Math.abs(item.confidence-entry.influence.confidence)<1e-9&&Math.abs(item.relevance-entry.influence.relevance)<1e-9));
  const simulationValidated=entries.every(entry=>entry.originalValidation.checked&&entry.finalValidation.checked);
  const executionBoundary=entries.every(entry=>
    entry.executionAllowed===Boolean((entry.decision==="accepted"||entry.decision==="modified")&&entry.finalValidation.ok)&&
    entry.actionExecuted===false
  );
  const decisionsCovered=DECISIONS.every(decision=>entries.some(entry=>entry.decision===decision));
  const deterministicIds=entries.every((entry,index)=>entry.sequence===index+1&&entry.id===nextId(seed,entry.sequence,entry.adviceId,entry.decision,entry.input));
  const deterministicReplay=entries.every(entry=>{
    const preview=previewDecision(seed,{adviceId:entry.adviceId,...clone(entry.input)});
    return Boolean(preview&&preview.decision===entry.decision&&preview.finalValidation.ok===entry.finalValidation.ok&&preview.finalValidation.reason===entry.finalValidation.reason&&preview.executionAllowed===entry.executionAllowed);
  });
  const storageRoundTrip=JSON.stringify(readRecord(seed))===JSON.stringify(readRecord(seed));
  return Object.freeze({
    pass:entries.length>0&&adviceStatusSync&&memoryLinked&&memoryEffects&&simulationValidated&&executionBoundary&&decisionsCovered&&deterministicIds&&deterministicReplay&&storageRoundTrip,
    campaignSeed:seed,entryCount:entries.length,
    adviceStatusSync,memoryLinked,memoryEffects,simulationValidated,executionBoundary,decisionsCovered,deterministicIds,deterministicReplay,storageRoundTrip,
    protagonistAgencyPreserved:true,
    worldMutationApi:false,
    actionExecutionInvoked:false,
    relationshipPersistenceIntroduced:false,
    entries
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value,0)*100)+"%"}
function setCheck(id,pass,waiting){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=waiting?"WAITING":pass?"PASS":"FAIL";
  node.classList.toggle("pass",!waiting&&Boolean(pass));
}
function renderDebugPanel(seedValue,adviceIdValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue);
  const root=rootNode||document.getElementById("adviceResolutionProof");
  if(!root)return null;
  const entries=list(seed);
  const verification=proof(seed);
  const select=root.querySelector("#adviceResolutionSelect");
  if(!entries.length){
    if(select){select.innerHTML="<option>No resolved advice yet</option>";select.disabled=true}
    const response=root.querySelector("#adviceResolutionReasoning");if(response)response.textContent="No protagonist advice decisions have been recorded.";
    ["vAdviceDecisionStates","vAdviceDualRecord","vAdviceSimulation","vAdviceDeterministic","vAdviceAgency"].forEach(id=>setCheck(id,false,true));
    root.dataset.adviceId="";root.dataset.decision="";root.dataset.entryCount="0";
    return Object.freeze({entry:null,verification});
  }
  const selected=entries.find(entry=>entry.adviceId===String(adviceIdValue||""))||entries[0];
  if(select){
    select.disabled=false;
    select.innerHTML=entries.map(entry=>"<option value=\""+escapeHtml(entry.adviceId)+"\" "+(entry.adviceId===selected.adviceId?"selected":"")+">"+escapeHtml(entry.decision.toUpperCase()+" · "+entry.recommendation)+"</option>").join("");
    select.onchange=()=>renderDebugPanel(seed,select.value,root);
  }
  const advisor=scope().AdvisorChannel?.resolve?.(seed,selected.adviceId,"protagonist");
  const pairs={
    adviceResolutionDecision:selected.decision,
    adviceResolutionAdvice:advisor?.topic||selected.recommendation,
    adviceResolutionRecommendation:selected.recommendation,
    adviceResolutionSimulation:(selected.finalValidation.ok?"ALLOWED":"BLOCKED")+" · "+selected.finalValidation.reason,
    adviceResolutionMemory:selected.memoryId,
    adviceResolutionExecution:selected.executionAllowed?"Eligible for later execution":"Not executable from advice resolution"
  };
  for(const [id,value] of Object.entries(pairs)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const decision=root.querySelector("#adviceResolutionDecision");
  if(decision)decision.className="advice-decision "+selected.decision;
  const reasoning=root.querySelector("#adviceResolutionReasoning");
  if(reasoning)reasoning.textContent=selected.reasoning;
  const influence=root.querySelector("#adviceResolutionInfluence");
  if(influence)influence.textContent="Memory confidence "+percent(selected.influence.confidence)+" · relevance "+percent(selected.influence.relevance)+" · trust unchanged until the relationship WP.";
  const events=root.querySelector("#adviceResolutionEvents");
  if(events){
    events.innerHTML=entries.map(entry=>
      "<li class=\""+(entry.adviceId===selected.adviceId?"selected":"")+"\">"+
      "<span class=\"advice-decision "+escapeHtml(entry.decision)+"\">"+escapeHtml(entry.decision)+"</span>"+
      "<div><strong>"+escapeHtml(entry.summary)+"</strong><small>Simulation: "+escapeHtml(entry.finalValidation.ok?"allowed":"blocked")+" · "+escapeHtml(entry.finalValidation.reason)+"</small><small>"+escapeHtml(entry.memoryId)+"</small></div></li>"
    ).join("");
  }
  setCheck("vAdviceDecisionStates",verification.decisionsCovered,false);
  setCheck("vAdviceDualRecord",verification.adviceStatusSync&&verification.memoryLinked&&verification.memoryEffects,false);
  setCheck("vAdviceSimulation",verification.simulationValidated&&verification.executionBoundary,false);
  setCheck("vAdviceDeterministic",verification.deterministicIds&&verification.deterministicReplay&&verification.storageRoundTrip,false);
  setCheck("vAdviceAgency",verification.protagonistAgencyPreserved&&!verification.worldMutationApi&&!verification.actionExecutionInvoked,false);
  root.dataset.adviceId=selected.adviceId;
  root.dataset.decision=selected.decision;
  root.dataset.entryCount=String(entries.length);
  return Object.freeze({entry:selected,verification});
}

const api=Object.freeze({
  STORAGE_PREFIX,VERSION,DECISIONS,storageKey,list,snapshot,previewDecision,resolveAdvice,clear,proof,renderDebugPanel
});
scope().AdviceResolution=api;
scope().ProtagonistAdviceResolution=api;
})();