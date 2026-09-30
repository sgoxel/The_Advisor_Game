(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.AdvisorChatSurface=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="advisor-chat-surface-v1";
const MAX_THREADS=8;
const MAX_TRACE_IDS=4;
const MAX_TEXT=480;
const PROPOSAL_INTENTS=Object.freeze(new Set([
  "advisor.travel.suggest","advisor.interaction.request","advisor.warning","advisor.reminder"
]));
const DECISION_STATES=Object.freeze(["accepted","modified","deferred","rejected","invalid"]);
const STATUS_LABELS=Object.freeze({
  sent:"Sent",replied:"Replied",clarification:"Clarify",proposal:"Proposal",
  considering:"Considering",accepted:"Accepted",modified:"Modified",deferred:"Deferred",
  rejected:"Rejected",invalid:"Invalid",completed:"Completed"
});
const state={
  open:false,evidence:false,root:null,launcher:null,sessionThreads:[],liveEvaluations:new Map(),
  renderCount:0,sendCount:0,lastRenderMs:0,lastSource:"none"
};

function scope(){return root||globalThis}
function cleanText(value,max=MAX_TEXT){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function clone(value){
  if(value==null||typeof value!=="object")return value;
  if(Array.isArray(value))return value.map(clone);
  const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out;
}
function freeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))freeze(item);
  return Object.freeze(value);
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function escapeHtml(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function nowTimestamp(){
  const stamp=scope().GameTime?.getTimestampKey?.();
  if(/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(stamp||"")))return String(stamp);
  return "0000-01-01 00:00:00";
}
function activeSeed(){
  return cleanText(
    scope().SeedSystem?.getCampaign?.()?.seed||
    scope().PlanetStage?.snapshot?.()?.activeSeed||
    scope().SeedSystem?.getSettings?.()?.seed||
    "DEFAULT-SEED",160
  )||"DEFAULT-SEED";
}
function protagonistIdentity(){
  const campaign=scope().SeedSystem?.getCampaign?.()||null;
  return freeze({
    id:cleanId(campaign?.protagonistId||"protagonist")||"protagonist",
    name:cleanText(campaign?.protagonistName||campaign?.protagonist?.name||"Protagonist",120)||"Protagonist"
  });
}
function advisorIdentity(seed=activeSeed(),protagonistId=protagonistIdentity().id){
  const record=scope().AdvisorChannel?.getAdvisor?.(seed,protagonistId)||null;
  return freeze({
    id:cleanId(record?.id||("ADVISOR-"+hashText(seed+"|"+protagonistId)),160),
    label:"Advisor"
  });
}
function routeSourceLabel(mode){
  const value=String(mode||"unknown");
  if(value==="local-library")return "Local reply";
  if(value==="local-context-response")return "Local grounded";
  if(value==="clarification-needed")return "Clarification";
  if(value==="llm-eligible")return "Fallback ready";
  if(value==="deterministic-offline-fallback")return "Offline fallback";
  if(value==="evaluation")return "Decision record";
  return value.replace(/[-_]+/g," ");
}
function authoritativeCompleted(evaluation){
  const execution=evaluation?.execution||evaluation?.simulationResult||null;
  if(!execution||execution.actionExecuted!==true)return false;
  const status=String(execution.state||execution.status||execution.authoritativeResult?.status||"").toLowerCase();
  const ok=execution.ok===true||execution.authoritativeResult?.ok===true;
  return Boolean(ok&&["complete","completed","success","succeeded"].includes(status));
}
function recordCompleted(record){
  return Boolean(record?.outcome?.state==="completed"&&record?.outcome?.authoritativeExecution===true&&record?.outcome?.simulationResultId);
}
function statusFor(backingValue){
  const backing=backingValue&&typeof backingValue==="object"?backingValue:{};
  const evaluation=backing.evaluation||null,record=backing.record||null,advice=backing.advice||null,routing=backing.routing||record?.routing||null;
  if(authoritativeCompleted(evaluation)||recordCompleted(record))return "completed";
  const decision=String(evaluation?.decision||evaluation?.protagonistEvaluation?.state||"").toLowerCase();
  if(DECISION_STATES.includes(decision))return decision;
  const adviceStatus=String(advice?.status||"").toLowerCase();
  if(["accepted","modified","deferred","rejected"].includes(adviceStatus))return adviceStatus;
  if(adviceStatus==="considered")return "considering";
  if(adviceStatus==="delivered")return "proposal";
  if(String(routing?.mode||"")==="clarification-needed")return "clarification";
  if((record?.links?.proposalIds||[]).length)return "considering";
  return backing.reply?"replied":"sent";
}
function statusLabel(status){return STATUS_LABELS[status]||cleanText(status,40)||"Status"}
function traceIds(thread){
  const values=[
    thread?.record?.id,
    ...(thread?.record?.links?.proposalIds||[]),
    ...(thread?.record?.links?.decisionIds||[]),
    ...(thread?.record?.links?.simulationResultIds||[]),
    thread?.evaluation?.proposal?.proposalId,
    thread?.evaluation?.decisionId,
    thread?.evaluation?.executionId
  ].filter(Boolean).map(v=>cleanId(v,160));
  return [...new Set(values)].slice(0,MAX_TRACE_IDS);
}
function adviceForRecord(seed,record){
  const ids=record?.links?.advisorChannelIds||[];
  if(!ids.length||!scope().AdvisorChannel?.resolve)return null;
  for(const id of ids){
    const found=scope().AdvisorChannel.resolve(seed,id,protagonistIdentity().id);
    if(found)return found;
  }
  return null;
}
function threadFromRecord(seed,record,replyRecord){
  const evaluation=state.liveEvaluations.get(record?.message?.messageId)||null;
  const advice=adviceForRecord(seed,record);
  const routing=record?.routing||{};
  const reply=cleanText(replyRecord?.message?.text||"",MAX_TEXT);
  return freeze({
    id:cleanId(record?.id||record?.message?.messageId||hashText(JSON.stringify(record)),160),
    timestamp:cleanText(record?.fantasyTimestamp||"",32),
    request:cleanText(record?.message?.text||"",MAX_TEXT),
    reply,
    routing:clone(routing),
    source:routeSourceLabel(routing.mode),
    status:statusFor({record,evaluation,advice,routing,reply}),
    record:clone(record),evaluation:clone(evaluation),advice:clone(advice),
    traceIds:traceIds({record,evaluation})
  });
}
function ledgerThreads(seed){
  const ledger=scope().ConversationTransactions;
  if(!ledger?.list)return [];
  let rows=[];
  try{rows=ledger.list(seed,{limit:Math.min(ledger.MAX_QUERY_RESULTS||24,24)})||[]}catch(_){return []}
  const advisors=new Map();
  for(const row of rows){
    if(row?.message?.role==="advisor"&&row.message.referenceId)advisors.set(row.message.referenceId,row);
  }
  return rows.filter(row=>row?.message?.role==="player").map(row=>threadFromRecord(seed,row,advisors.get(row.message.messageId)||null));
}
function adviceRows(seed){
  const api=scope().AdvisorChannel;
  if(!api?.list)return [];
  try{
    return (api.list(seed,protagonistIdentity().id)||[]).slice(-4).reverse().map(entry=>freeze({
      id:entry.id,topic:cleanText(entry.topic,180),status:String(entry.status||"delivered"),
      timestamp:cleanText(entry.updatedAt||entry.timestamp,32),target:cleanText(entry.target?.label||"General",100)
    }));
  }catch(_){return []}
}
function evidenceThreads(){
  const base="1201-09-30 ";
  const completedRecord={
    id:"CTX-EVIDENCE-COMPLETE",fantasyTimestamp:base+"10:12:00",
    message:{messageId:"EVIDENCE-M4",role:"player",text:"Use the gate winch once the guard gives the all-clear."},
    routing:{mode:"local-library",recognizedIntentIds:["advisor.interaction.request"],localReplyId:"deterministic-template",externalProviderUsed:false},
    links:{proposalIds:["PROP-E4"],decisionIds:["PCD-E4"],advisorChannelIds:[],characterMemoryIds:[],simulationResultIds:["PCE-E4"]},
    outcome:{state:"completed",simulationResultId:"PCE-E4",authoritativeResultId:"ACT-E4",authoritativeExecution:true}
  };
  return freeze([
    {
      id:"evidence-local",timestamp:base+"10:00:00",request:"Hello. Give me the short version.",
      reply:"I'm listening. What would you like to discuss?",routing:{mode:"local-library",recognizedIntentIds:["advisor.greeting"]},
      source:"Local reply",status:"replied",traceIds:["CTX-EVIDENCE-LOCAL"]
    },
    {
      id:"evidence-clarify",timestamp:base+"10:04:00",request:"Find Rowan.",
      reply:"I can read that more than one way (travel or interaction). Please clarify what you want me to consider.",
      routing:{mode:"clarification-needed",recognizedIntentIds:["advisor.travel.suggest","advisor.interaction.request"]},
      source:"Clarification",status:"clarification",traceIds:["CTX-EVIDENCE-CLARIFY"]
    },
    {
      id:"evidence-rejected",timestamp:base+"10:08:00",request:"Cross the flooded north road now.",
      reply:"I understand the suggestion, but I will not take that route under the current conditions.",
      routing:{mode:"evaluation",recognizedIntentIds:["advisor.travel.suggest"]},source:"Decision record",status:"rejected",
      evaluation:{decision:"rejected",decisionId:"PCD-E3",proposal:{proposalId:"PROP-E3"},execution:{attempted:false,state:"not-run",actionExecuted:false}},
      traceIds:["PROP-E3","PCD-E3"]
    },
    {
      id:"evidence-completed",timestamp:base+"10:12:00",request:completedRecord.message.text,
      reply:"The gate winch action has completed.",routing:completedRecord.routing,source:"Simulation backed",status:statusFor({record:completedRecord,reply:true}),
      record:completedRecord,traceIds:["PROP-E4","PCD-E4","PCE-E4","ACT-E4"]
    }
  ]);
}
function currentThreads(){
  if(state.evidence)return evidenceThreads();
  const seed=activeSeed();
  const persisted=ledgerThreads(seed);
  const merged=[...persisted,...state.sessionThreads].slice(-MAX_THREADS);
  return merged;
}
function messageId(seed,stamp,text,kind){
  return cleanId("CHAT-"+kind+"-"+hashText(seed+"|"+stamp+"|"+text+"|"+state.sendCount),160);
}
function persistConversation(seed,message,routing,reply,adviceId){
  const ledger=scope().ConversationTransactions;
  if(!ledger?.append)return {player:null,reply:null,reason:"ledger-unavailable"};
  const stamp=nowTimestamp(),playerId=messageId(seed,stamp,message,"PLAYER");
  const commonRouting={
    mode:routing?.mode||"unknown",
    recognizedIntentIds:(routing?.selectedIntentId?[routing.selectedIntentId]:routing?.intentCandidates?.map(item=>item.intentId)||[]).slice(0,8),
    localReplyId:routing?.sourceMetadata?.responseSource||null,
    externalProviderUsed:false
  };
  let player=null,answer=null;
  try{
    player=ledger.append(seed,{
      fantasyTimestamp:stamp,
      message:{messageId:playerId,role:"player",text:message},
      routing:commonRouting,
      advisorChannelIds:adviceId?[adviceId]:[]
    });
    answer=ledger.append(seed,{
      fantasyTimestamp:stamp,
      message:{messageId:messageId(seed,stamp,reply,"ADVISOR"),referenceId:playerId,role:"advisor",text:reply},
      routing:commonRouting,
      advisorChannelIds:adviceId?[adviceId]:[]
    });
  }catch(error){return {player:null,reply:null,reason:String(error?.message||error)}}
  return {player,reply:answer,reason:(player?.ok&&answer?.ok)?"ok":"append-failed"};
}
function recordAdviceIfNeeded(seed,message,routing){
  const intent=String(routing?.selectedIntentId||"");
  if(!PROPOSAL_INTENTS.has(intent)||!scope().AdvisorChannel?.recordAdvice)return null;
  try{
    return scope().AdvisorChannel.recordAdvice(seed,{
      topic:message,
      target:{kind:"conversation",label:"Conversation proposal"},
      timestamp:nowTimestamp(),
      details:"Recorded from Advisor chat surface; proposal only."
    },protagonistIdentity().id);
  }catch(_){return null}
}
function routeMessage(message){
  const router=scope().LocalConversationRouter;
  if(!router?.route){
    const identity=protagonistIdentity();
    return freeze({
      mode:"deterministic-offline-fallback",reason:"router-unavailable",
      reply:identity.name+": I cannot interpret that safely right now. No action has been taken.",
      character:identity,selectedIntentId:null,intentCandidates:[],sourceMetadata:{responseSource:"surface-fallback"},
      worldMutation:false,actionExecuted:false,memoryMutation:false
    });
  }
  return router.route(message,{
    seed:activeSeed(),protagonistId:protagonistIdentity().id,protagonistName:protagonistIdentity().name,
    externalAiEnabled:false
  });
}
function sessionThread(message,routing,reply,advice){
  return freeze({
    id:"SESSION-"+hashText(message+"|"+reply+"|"+state.sendCount),timestamp:nowTimestamp(),request:message,reply,
    routing:clone(routing),source:routeSourceLabel(routing?.mode),status:statusFor({routing,reply,advice}),record:null,evaluation:null,
    advice:clone(advice),traceIds:advice?.id?[advice.id]:[]
  });
}
function send(messageValue){
  const message=cleanText(messageValue,MAX_TEXT);
  if(!message)return freeze({ok:false,reason:"empty-message"});
  state.sendCount++;
  const seed=activeSeed(),routing=routeMessage(message),reply=cleanText(routing?.reply||routing?.offlineFallback||"No reply is available.",MAX_TEXT);
  const advice=recordAdviceIfNeeded(seed,message,routing);
  const persisted=persistConversation(seed,message,routing,reply,advice?.id||null);
  if(!(persisted?.player?.ok&&persisted?.reply?.ok)){
    state.sessionThreads.push(sessionThread(message,routing,reply,advice));
    if(state.sessionThreads.length>MAX_THREADS)state.sessionThreads.splice(0,state.sessionThreads.length-MAX_THREADS);
  }
  state.lastSource=routeSourceLabel(routing?.mode);
  render();
  return freeze({
    ok:true,message,reply,routing:clone(routing),advice:clone(advice),persisted:Boolean(persisted?.player?.ok&&persisted?.reply?.ok),
    directWorldMutation:false,actionExecuted:false,simulationBypassed:false
  });
}
function presentEvaluation(configValue){
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const evaluation=config.evaluation&&typeof config.evaluation==="object"?config.evaluation:null;
  const message=config.message&&typeof config.message==="object"?config.message:{messageId:config.messageId||"evaluation-message",role:"player",text:config.text||""};
  const routing=config.routing&&typeof config.routing==="object"?config.routing:{mode:"evaluation",recognizedIntentIds:[]};
  if(!evaluation)return freeze({ok:false,reason:"evaluation-required"});
  const key=cleanId(message.messageId||evaluation.transactionId||evaluation.decisionId||"evaluation",160);
  state.liveEvaluations.set(key,clone(evaluation));
  let persisted=null;
  try{
    persisted=scope().ConversationTransactions?.fromEvaluation?.(activeSeed(),message,routing,evaluation,{
      advisorChannelIds:Array.isArray(config.advisorChannelIds)?config.advisorChannelIds.slice(0,8):[],
      characterMemoryIds:Array.isArray(config.characterMemoryIds)?config.characterMemoryIds.slice(0,8):[]
    })||null;
  }catch(_){persisted=null}
  render();
  return freeze({ok:true,key,status:statusFor({evaluation}),persisted:Boolean(persisted?.ok)});
}
function renderThread(thread){
  const status=thread.status||"replied",ids=(thread.traceIds||[]).slice(0,MAX_TRACE_IDS);
  const trace=ids.length
    ?'<details class="advisor-chat-trace"><summary>Trace</summary><div>'+ids.map(id=>'<code>'+escapeHtml(id)+'</code>').join("")+'</div></details>'
    :"";
  return '<article class="advisor-chat-thread" data-status="'+escapeHtml(status)+'">'+
    '<div class="advisor-chat-thread-head"><span class="advisor-chat-source">'+escapeHtml(thread.source||"Conversation")+'</span>'+
    '<span class="advisor-chat-status" data-status="'+escapeHtml(status)+'">'+escapeHtml(statusLabel(status))+'</span></div>'+
    '<div class="advisor-chat-bubble advisor-chat-bubble-player"><small>Advisor</small><p>'+escapeHtml(thread.request||"")+'</p></div>'+
    '<div class="advisor-chat-bubble advisor-chat-bubble-character"><small>'+escapeHtml(protagonistIdentity().name)+'</small><p>'+escapeHtml(thread.reply||"No reply recorded.")+'</p></div>'+
    '<div class="advisor-chat-meta"><time>'+escapeHtml(thread.timestamp||"")+'</time>'+trace+'</div>'+
  '</article>';
}
function renderAdviceTrail(seed){
  const rows=state.evidence?[
    {id:"ADV-EVIDENCE-01",topic:"Keep clear of the flooded north road.",status:"rejected",timestamp:"1201-09-30 10:08:00",target:"North road"},
    {id:"ADV-EVIDENCE-02",topic:"Use the gate winch after clearance.",status:"accepted",timestamp:"1201-09-30 10:12:00",target:"East gate"}
  ]:adviceRows(seed);
  if(!rows.length)return '<div class="advisor-chat-advice-empty">No separate advice proposals recorded.</div>';
  return rows.map(row=>'<div class="advisor-chat-advice-row"><span class="advisor-chat-status" data-status="'+escapeHtml(row.status)+'">'+escapeHtml(statusLabel(row.status==="considered"?"considering":row.status))+'</span><div><strong>'+escapeHtml(row.topic)+'</strong><small>'+escapeHtml(row.target)+' · '+escapeHtml(row.timestamp)+'</small></div></div>').join("");
}
function ensureDom(){
  if(typeof document==="undefined")return null;
  let panel=document.getElementById("advisorChatPanel");
  let launcher=document.getElementById("advisorChatLauncher");
  if(!launcher){
    launcher=document.createElement("button");
    launcher.id="advisorChatLauncher";launcher.className="advisor-chat-launcher";launcher.type="button";
    launcher.setAttribute("aria-controls","advisorChatPanel");launcher.setAttribute("aria-expanded","false");
    launcher.textContent="Advisor";
    document.body.appendChild(launcher);
    launcher.addEventListener("click",()=>state.open?close():open());
  }
  if(!panel){
    panel=document.createElement("section");
    panel.id="advisorChatPanel";panel.className="advisor-chat-panel";panel.hidden=true;
    panel.setAttribute("aria-label","Advisor conversation");
    document.body.appendChild(panel);
  }
  if(!document.body.classList.contains("advisor-chat-enabled"))document.body.classList.add("advisor-chat-enabled");
  state.root=panel;state.launcher=launcher;
  return panel;
}
function render(){
  const started=typeof performance!=="undefined"?performance.now():0;
  const panel=ensureDom();if(!panel)return null;
  const seed=activeSeed(),character=protagonistIdentity(),advisor=advisorIdentity(seed,character.id),threads=currentThreads();
  const rows=threads.length?threads.slice(-MAX_THREADS).map(renderThread).join("")
    :'<div class="advisor-chat-empty"><strong>No conversation yet.</strong><span>Send a message to the protagonist. Messages do not directly control the world.</span></div>';
  panel.innerHTML=
    '<header class="advisor-chat-head"><div><small>ADVISOR CHANNEL</small><strong>'+escapeHtml(character.name)+'</strong><span>'+escapeHtml(advisor.id)+'</span></div>'+
    '<button type="button" class="advisor-chat-close" aria-label="Close Advisor">×</button></header>'+
    '<div class="advisor-chat-modebar"><span>'+(state.evidence?"Deterministic evidence · presentation only":"Persistent campaign conversation")+'</span><b>'+escapeHtml(state.lastSource==="none"?"Local routing":state.lastSource)+'</b></div>'+
    '<div class="advisor-chat-scroll"><div class="advisor-chat-transcript">'+rows+'</div>'+
    '<details class="advisor-chat-advice"><summary>Advice trail</summary><div class="advisor-chat-advice-list">'+renderAdviceTrail(seed)+'</div></details></div>'+
    '<form class="advisor-chat-compose" autocomplete="off"><label for="advisorChatInput">Message</label><div><textarea id="advisorChatInput" maxlength="'+MAX_TEXT+'" rows="2" placeholder="Ask, advise, warn, or suggest…"></textarea><button type="submit">Send</button></div></form>'+
    '<p class="advisor-chat-boundary">Messages are counsel. The protagonist decides; only Simulation-backed execution may be shown as completed.</p>';
  panel.hidden=!state.open;
  panel.dataset.evidence=state.evidence?"true":"false";
  panel.dataset.threadCount=String(threads.length);
  panel.querySelector(".advisor-chat-close")?.addEventListener("click",close);
  const form=panel.querySelector(".advisor-chat-compose");
  const input=panel.querySelector("#advisorChatInput");
  form?.addEventListener("submit",event=>{
    event.preventDefault();
    const text=input?.value||"";
    if(!cleanText(text,MAX_TEXT)){input?.focus();return}
    if(state.evidence)state.evidence=false;
    send(text);
  });
  state.launcher?.setAttribute("aria-expanded",state.open?"true":"false");
  state.renderCount++;
  state.lastRenderMs=started&&typeof performance!=="undefined"?Number((performance.now()-started).toFixed(3)):0;
  return panel;
}
function open(){
  state.open=true;
  try{scope().PlanetStage?.closePlaces?.()}catch(_){}
  render();
  state.root?.querySelector("#advisorChatInput")?.focus?.();
  return snapshot();
}
function close(){
  state.open=false;
  if(state.root)state.root.hidden=true;
  state.launcher?.setAttribute("aria-expanded","false");
  return snapshot();
}
function showEvidence(){
  state.evidence=true;state.open=true;state.lastSource="Evidence states";render();return snapshot();
}
function clearEvidence(){state.evidence=false;render();return snapshot()}
function snapshot(){
  const threads=currentThreads();
  return freeze({
    version:VERSION,open:state.open,evidence:state.evidence,threadCount:threads.length,maxThreads:MAX_THREADS,
    renderCount:state.renderCount,sendCount:state.sendCount,lastRenderMs:state.lastRenderMs,lastSource:state.lastSource,
    eventDriven:true,perFrameRerender:false,fullWorldScan:false,directWorldMutation:false,simulationAuthority:false,
    completedCount:threads.filter(row=>row.status==="completed").length,
    statuses:freeze(threads.map(row=>row.status))
  });
}
function init(){
  ensureDom();
  const params=typeof location!=="undefined"?new URLSearchParams(location.search):null;
  if(params?.get("advisor_evidence")==="1")showEvidence();
  else render();
  if(typeof document!=="undefined"){
    document.addEventListener("click",event=>{
      if(event.target?.closest?.(".planet-places-button")&&state.open)close();
    },true);
  }
  return snapshot();
}

const api=freeze({
  VERSION,MAX_THREADS,MAX_TEXT,DECISION_STATES,STATUS_LABELS,
  statusFor,authoritativeCompleted,recordCompleted,evidenceThreads,routeSourceLabel,
  init,open,close,render,send,presentEvaluation,showEvidence,clearEvidence,snapshot
});

if(typeof document!=="undefined"){
  const boot=()=>init();
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
}
return api;
});
