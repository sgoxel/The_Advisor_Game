(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.AdvisorConversationUI=api;
if(root?.document)api.autoMount();
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="advisor-chat-ui-v1";
const MAX_TRANSCRIPT_RECORDS=12;
const MAX_COUNSEL_ROWS=4;
const MAX_MESSAGE_CHARS=480;
const EVIDENCE_MODES=Object.freeze(["ordinary","ambiguous","rejected","completed"]);
const DECISION_STATES=Object.freeze(["considering","accepted","modified","deferred","rejected","invalid"]);
const state={
  mounted:false,open:false,rootNode:null,renderCount:0,submitCount:0,counselSubmitCount:0,
  transientRecords:[],evidenceMode:null,lastSeed:null,lastRecordCount:0,lastRenderReason:null
};

function cleanText(value,max=MAX_MESSAGE_CHARS){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function freeze(value){
  if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;
  for(const item of Object.values(value))freeze(item);
  return Object.freeze(value);
}
function campaignContext(){
  const campaign=root.SeedSystem?.getCampaign?.()||null;
  const seed=cleanText(campaign?.seed||root.SeedSystem?.getSettings?.()?.seed||"DEFAULT-SEED",160)||"DEFAULT-SEED";
  const protagonistId=cleanId(campaign?.protagonistId||"protagonist",120)||"protagonist";
  const when=root.GameTime?.getTimestampKey?.()||"0000-01-01 00:00:00";
  return freeze({campaign,seed,protagonistId,when,active:Boolean(campaign&&campaign.seed===seed)});
}
function recognizedIntents(route){
  const values=[route?.selectedIntentId,...(Array.isArray(route?.intentCandidates)?route.intentCandidates.map(item=>item?.intentId):[])].filter(Boolean);
  return [...new Set(values.map(value=>cleanId(value,120)).filter(Boolean))].slice(0,8);
}
function completedBacked(record){
  return Boolean(record?.outcome?.state==="completed"&&record?.outcome?.authoritativeExecution===true&&record?.outcome?.simulationResultId);
}
function decisionFor(record){
  const value=cleanId(record?.presentation?.decisionState||"",40).toLowerCase();
  return DECISION_STATES.includes(value)?value:null;
}
function statusFor(record){
  if(completedBacked(record))return freeze({key:"completed",label:"Completed",detail:"Simulation confirmed completion"});
  const decision=decisionFor(record);
  if(decision)return freeze({
    key:decision,
    label:decision.charAt(0).toUpperCase()+decision.slice(1),
    detail:decision==="considering"?"Proposal recorded; no final decision yet":"Protagonist decision recorded"
  });
  if((record?.links?.proposalIds||[]).length)return freeze({key:"considering",label:"Considering",detail:"Proposal recorded; no final decision yet"});
  const mode=String(record?.routing?.mode||"");
  if(mode==="clarification-needed")return freeze({key:"clarification",label:"Clarify",detail:"Message is ambiguous"});
  if(mode==="local-library"||mode==="local-context-response")return freeze({key:"local",label:"Local reply",detail:"Answered from bounded local context"});
  if(mode==="llm-eligible")return freeze({key:"fallback",label:"Fallback ready",detail:"External help is optional; local fallback retained"});
  if(mode==="deterministic-offline-fallback")return freeze({key:"fallback",label:"Offline reply",detail:"Deterministic fallback"});
  return freeze({key:"conversation",label:"Conversation",detail:"Historical conversation record"});
}
function viewRecord(record,index=0){
  const status=statusFor(record),presentation=record?.presentation||{},links=record?.links||{};
  const reply=cleanText(presentation.replyText||"",MAX_MESSAGE_CHARS);
  const replyName=cleanText(presentation.replyCharacterName||"Protagonist",120)||"Protagonist";
  const replyId=cleanId(presentation.replyCharacterId||"protagonist",120)||"protagonist";
  const intents=(record?.routing?.recognizedIntentIds||[]).slice(0,8).map(value=>cleanId(value,120)).filter(Boolean);
  return freeze({
    id:cleanId(record?.id||("record-"+index),180)||("record-"+index),
    fantasyTimestamp:cleanText(record?.fantasyTimestamp||"",32),
    playerText:cleanText(record?.message?.text||"",MAX_MESSAGE_CHARS),
    replyText:reply,
    replyRetained:Boolean(reply),
    replyName,replyId,status,
    routeMode:cleanId(record?.routing?.mode||"unknown",80)||"unknown",
    responseSource:cleanId(presentation.responseSource||"unknown",120)||"unknown",
    intents,
    proposalIds:(links.proposalIds||[]).slice(0,4).map(String),
    decisionIds:(links.decisionIds||[]).slice(0,4).map(String),
    simulationResultIds:(links.simulationResultIds||[]).slice(0,4).map(String),
    authoritativeCompletion:completedBacked(record)
  });
}
function identityFor(records){
  for(let i=records.length-1;i>=0;i--){
    const p=records[i]?.presentation;
    if(p?.replyCharacterId||p?.replyCharacterName)return freeze({
      id:cleanId(p.replyCharacterId||"protagonist",120)||"protagonist",
      name:cleanText(p.replyCharacterName||"Protagonist",120)||"Protagonist"
    });
  }
  return freeze({id:"protagonist",name:"Protagonist"});
}
function syntheticRecord(config){
  const c=config&&typeof config==="object"?config:{};
  const outcome=c.completed===true
    ?{state:"completed",simulationResultId:c.simulationResultId||"PCE-EVIDENCE-COMPLETE",authoritativeResultId:c.authoritativeResultId||"ACT-EVIDENCE-COMPLETE",authoritativeExecution:true,claimedCompletionSuppressed:false}
    :{state:"unexecuted",simulationResultId:null,authoritativeResultId:null,authoritativeExecution:false,claimedCompletionSuppressed:false};
  const proposalIds=c.proposalId?[c.proposalId]:[];
  const decisionIds=c.decisionId?[c.decisionId]:[];
  const simulationResultIds=outcome.simulationResultId?[outcome.simulationResultId]:[];
  return freeze({
    id:c.id||("EVID-"+hashText(JSON.stringify(c))),
    fantasyTimestamp:c.when||"1201-09-30 12:00:00",
    message:{messageId:c.messageId||"EVID-MSG",role:"player",text:c.playerText||"",historicalDialogue:true,authoritativeFact:false},
    routing:{mode:c.routeMode||"local-library",recognizedIntentIds:freeze((c.intents||[]).slice(0,8)),localReplyId:null,externalProviderUsed:false},
    links:{proposalIds:freeze(proposalIds),decisionIds:freeze(decisionIds),advisorChannelIds:freeze([]),characterMemoryIds:freeze([]),simulationResultIds:freeze(simulationResultIds)},
    outcome,
    presentation:{
      replyText:c.replyText||"",
      replyCharacterId:"protagonist",
      replyCharacterName:"Protagonist",
      decisionState:c.decisionState||null,
      validationState:c.validationState||null,
      responseSource:c.responseSource||c.routeMode||"local-library",
      traceAvailable:true,
      providerPayloadPersisted:false
    },
    authority:{chronology:"Fantasy Game Time",worldTruthCopied:false,dialogueIsProof:false,fullWorldScan:false,wholeCampaignScan:false,providerStatePersisted:false,renderStatePersisted:false,cameraStatePersisted:false}
  });
}
function evidenceRecords(modeValue){
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"ordinary";
  if(mode==="ordinary")return freeze([
    syntheticRecord({
      id:"EVID-LOCAL-1",messageId:"EVID-M-LOCAL",when:"1201-09-30 08:12:00",
      playerText:"How are things this morning?",replyText:"I am keeping to the morning schedule and watching the village road.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.status.question"]
    }),
    syntheticRecord({
      id:"EVID-CONSIDER-1",messageId:"EVID-M-CONSIDER",when:"1201-09-30 08:14:00",
      playerText:"Consider checking the north gate after breakfast.",replyText:"I will consider it against my duties before deciding.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.interaction.request"],proposalId:"PROP-EVID-CONSIDER"
    })
  ]);
  if(mode==="ambiguous")return freeze([
    syntheticRecord({
      id:"EVID-AMB-1",messageId:"EVID-M-AMB",when:"1201-09-30 09:03:00",
      playerText:"Find Rowan.",replyText:"I can read that more than one way: do you want information about Rowan, or should I consider speaking with Rowan?",
      routeMode:"clarification-needed",responseSource:"clarification-template",intents:["advisor.info.request","advisor.interaction.request"]
    })
  ]);
  if(mode==="rejected")return freeze([
    syntheticRecord({
      id:"EVID-REJECT-1",messageId:"EVID-M-REJECT",when:"1201-09-30 10:21:00",
      playerText:"Leave your post and cross the flooded ford now.",replyText:"No. I will not abandon the post for that route.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.travel.suggest"],
      proposalId:"PROP-EVID-REJECT",decisionId:"PCD-EVID-REJECT",decisionState:"rejected",validationState:"validated"
    }),
    syntheticRecord({
      id:"EVID-DEFER-1",messageId:"EVID-M-DEFER",when:"1201-09-30 10:24:00",
      playerText:"Then visit the mill before noon.",replyText:"I can do that later, after the watch change.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.travel.suggest"],
      proposalId:"PROP-EVID-DEFER",decisionId:"PCD-EVID-DEFER",decisionState:"deferred",validationState:"validated"
    })
  ]);
  return freeze([
    syntheticRecord({
      id:"EVID-DONE-1",messageId:"EVID-M-DONE",when:"1201-09-30 11:07:00",
      playerText:"Use the gate lever when the path is clear.",replyText:"The gate lever action is complete.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.interaction.request"],
      proposalId:"PROP-EVID-DONE",decisionId:"PCD-EVID-DONE",decisionState:"accepted",validationState:"validated",
      completed:true,simulationResultId:"PCE-EVID-DONE",authoritativeResultId:"ACT-EVID-DONE"
    }),
    syntheticRecord({
      id:"EVID-ACTIVE-1",messageId:"EVID-M-ACTIVE",when:"1201-09-30 11:09:00",
      playerText:"Consider inspecting the road marker next.",replyText:"I have accepted the suggestion, but it is not complete yet.",
      routeMode:"local-library",responseSource:"sentence-library",intents:["advisor.interaction.request"],
      proposalId:"PROP-EVID-ACTIVE",decisionId:"PCD-EVID-ACTIVE",decisionState:"accepted",validationState:"validated"
    })
  ]);
}
function runtimeRecords(seed){
  const rows=root.ConversationTransactions?.list?.(seed,{limit:MAX_TRANSCRIPT_RECORDS})||[];
  const merged=[...rows,...state.transientRecords].slice(-MAX_TRANSCRIPT_RECORDS);
  return merged;
}
function counselRows(seed,protagonistId){
  const rows=root.AdvisorChannel?.list?.(seed,protagonistId)||[];
  return rows.slice(-MAX_COUNSEL_ROWS).reverse();
}
function traceHtml(view){
  const bits=[
    "<span><b>Route</b> "+escapeHtml(view.routeMode)+"</span>",
    "<span><b>Source</b> "+escapeHtml(view.responseSource)+"</span>"
  ];
  if(view.intents.length)bits.push("<span><b>Intent</b> "+escapeHtml(view.intents.join(", "))+"</span>");
  if(view.proposalIds.length)bits.push("<span><b>Proposal</b> "+escapeHtml(view.proposalIds[0])+"</span>");
  if(view.decisionIds.length)bits.push("<span><b>Decision</b> "+escapeHtml(view.decisionIds[0])+"</span>");
  if(view.authoritativeCompletion&&view.simulationResultIds.length)bits.push("<span><b>Simulation</b> "+escapeHtml(view.simulationResultIds[0])+"</span>");
  return bits.join("");
}
function transcriptHtml(records){
  if(!records.length)return '<div class="advisor-chat-empty"><strong>No conversation yet.</strong><span>Send a normal message to begin. Replies are recorded without giving the UI world authority.</span></div>';
  return records.slice(-MAX_TRANSCRIPT_RECORDS).map((record,index)=>{
    const view=viewRecord(record,index);
    const reply=view.replyRetained?escapeHtml(view.replyText):"Reply text was not retained in this earlier record.";
    return '<article class="advisor-chat-exchange" data-status="'+escapeHtml(view.status.key)+'" data-record-id="'+escapeHtml(view.id)+'">'+
      '<div class="advisor-chat-meta"><time>'+escapeHtml(view.fantasyTimestamp||"Fantasy time")+'</time><span class="advisor-chat-status" data-tone="'+escapeHtml(view.status.key)+'">'+escapeHtml(view.status.label)+'</span></div>'+
      '<div class="advisor-chat-bubble player"><small>YOU · ADVISOR</small><p>'+escapeHtml(view.playerText||"Historical message")+'</p></div>'+
      '<div class="advisor-chat-bubble protagonist"><small>'+escapeHtml(view.replyName)+' · '+escapeHtml(view.replyId)+'</small><p class="'+(view.replyRetained?"":"muted")+'">'+reply+'</p></div>'+
      '<details class="advisor-chat-trace"><summary>'+escapeHtml(view.status.detail)+' <span>Trace</span></summary><div>'+traceHtml(view)+'</div></details>'+
    '</article>';
  }).join("");
}
function counselHtml(rows){
  if(!rows.length)return '<p class="advisor-counsel-empty">No structured counsel has been delivered yet.</p>';
  return '<ul class="advisor-counsel-list">'+rows.map(row=>
    '<li><span class="advisor-counsel-status '+escapeHtml(row.status||"delivered")+'">'+escapeHtml(cleanText(row.status||"delivered",30))+'</span><div><strong>'+escapeHtml(row.topic||"Advice")+'</strong><small>'+escapeHtml(row.target?.label||"General advice")+' · '+escapeHtml(row.timestamp||"")+'</small></div></li>'
  ).join("")+'</ul>';
}
function panelMarkup(ctx,records,counsel,identity){
  const enabled=Boolean(ctx.active||state.evidenceMode);
  return '<button class="advisor-chat-launcher" type="button" aria-expanded="'+(state.open?"true":"false")+'" aria-controls="advisorChatPanel">'+
    '<span class="advisor-chat-launcher-dot" aria-hidden="true"></span><b>Advisor</b><small>'+escapeHtml(identity.name)+'</small></button>'+
    '<section id="advisorChatPanel" class="advisor-chat-panel" '+(state.open?"":"hidden")+' aria-label="Advisor conversation" data-evidence-mode="'+escapeHtml(state.evidenceMode||"none")+'">'+
      '<header class="advisor-chat-head"><div><small>ADVISOR CHANNEL</small><strong>'+escapeHtml(identity.name)+'</strong><span>'+escapeHtml(identity.id)+' · persistent protagonist</span></div><button class="advisor-chat-close" type="button" aria-label="Close Advisor chat">×</button>'+      (root.ProtagonistActivityUI?.markup?.(root.ProtagonistActivityUI.currentModel?.(ctx)||null)||"")+'</header>'+
      '<div class="advisor-readout-stack">'+(root.ProtagonistStatusUI?.markup?.(root.ProtagonistStatusUI.currentModel?.(ctx)||null)||"")+(root.AdvisorRankReadoutUI?.markup?.(root.AdvisorRankReadoutUI.currentModel?.(ctx)||null)||"")+'</div>'+
      '<div class="advisor-chat-transcript" role="log" aria-live="polite">'+transcriptHtml(records)+'</div>'+
      '<form class="advisor-chat-compose" autocomplete="off"><label for="advisorChatInput">Message</label><div><textarea id="advisorChatInput" maxlength="'+MAX_MESSAGE_CHARS+'" rows="2" placeholder="Ask, advise, warn, or suggest…" '+(enabled?"":"disabled")+'></textarea><button type="submit" '+(enabled?"":"disabled")+'>Send</button></div><small>Conversation is advisory. The protagonist decides; only Simulation can complete an action.</small></form>'+
      '<details class="advisor-counsel"><summary>Structured counsel history <span>'+counsel.length+'/'+MAX_COUNSEL_ROWS+'</span></summary>'+
        counselHtml(counsel)+
        '<form class="advisor-counsel-compose" autocomplete="off"><input name="topic" maxlength="180" placeholder="Deliver structured advice" aria-label="Structured advice" '+(enabled?"":"disabled")+'><input name="target" maxlength="80" placeholder="Target (optional)" aria-label="Advice target" '+(enabled?"":"disabled")+'><button type="submit" '+(enabled?"":"disabled")+'>Deliver</button></form>'+
      '</details>'+
    '</section>';
}
function currentRecords(ctx){
  return state.evidenceMode?evidenceRecords(state.evidenceMode):runtimeRecords(ctx.seed);
}
function makeTransientRecord(ctx,text,route){
  const id="CHAT-"+hashText([ctx.seed,ctx.when,text,route?.mode,state.submitCount].join("|"));
  return freeze({
    id,fantasyTimestamp:ctx.when,
    message:{messageId:id+"-M",role:"player",text,historicalDialogue:true,authoritativeFact:false},
    routing:{mode:route?.mode||"unknown",recognizedIntentIds:freeze(recognizedIntents(route)),localReplyId:null,externalProviderUsed:false},
    links:{proposalIds:freeze([]),decisionIds:freeze([]),advisorChannelIds:freeze([]),characterMemoryIds:freeze([]),simulationResultIds:freeze([])},
    outcome:{state:"unexecuted",simulationResultId:null,authoritativeResultId:null,authoritativeExecution:false,claimedCompletionSuppressed:false},
    presentation:{
      replyText:cleanText(route?.reply||"",MAX_MESSAGE_CHARS),
      replyCharacterId:cleanId(route?.character?.id||ctx.protagonistId,120)||ctx.protagonistId,
      replyCharacterName:cleanText(route?.character?.name||"Protagonist",120)||"Protagonist",
      decisionState:null,validationState:null,
      responseSource:cleanId(route?.sourceMetadata?.responseSource||route?.mode||"unknown",120)||"unknown",
      traceAvailable:true,providerPayloadPersisted:false
    },
    authority:{chronology:"Fantasy Game Time",worldTruthCopied:false,dialogueIsProof:false,fullWorldScan:false,wholeCampaignScan:false,providerStatePersisted:false,renderStatePersisted:false,cameraStatePersisted:false}
  });
}
function recordMessage(textValue){
  const ctx=campaignContext(),text=cleanText(textValue,MAX_MESSAGE_CHARS);
  if(!text)return freeze({ok:false,reason:"empty-message"});
  const router=root.LocalConversationRouter;
  if(!router?.route)return freeze({ok:false,reason:"router-unavailable"});
  state.submitCount++;
  const route=router.route(text,{seed:ctx.seed,protagonistId:ctx.protagonistId,protagonistName:"Protagonist",externalAiEnabled:false});
  const messageId="CHAT-M-"+hashText([ctx.seed,ctx.when,text,state.submitCount].join("|"));
  let stored=null;
  try{
    stored=root.ConversationTransactions?.appendExchange?.(ctx.seed,{messageId,role:"player",text},route,{fantasyTimestamp:ctx.when})||null;
  }catch(_){stored=null}
  if(!stored?.ok){
    state.transientRecords.push(makeTransientRecord(ctx,text,route));
    if(state.transientRecords.length>MAX_TRANSCRIPT_RECORDS)state.transientRecords.shift();
  }
  return freeze({ok:true,stored:Boolean(stored?.ok),routeMode:route.mode,recordId:stored?.record?.id||state.transientRecords.at(-1)?.id||null,worldMutation:false,actionExecuted:false,evaluatorCalled:false});
}
function deliverCounsel(topicValue,targetValue){
  const ctx=campaignContext(),topic=cleanText(topicValue,180),target=cleanText(targetValue,80);
  if(!topic)return freeze({ok:false,reason:"empty-advice"});
  if(!root.AdvisorChannel?.recordAdvice)return freeze({ok:false,reason:"advisor-channel-unavailable"});
  state.counselSubmitCount++;
  const entry=root.AdvisorChannel.recordAdvice(ctx.seed,{topic,target:target?{kind:"topic",label:target}:{kind:"general",label:"General advice"},timestamp:ctx.when},ctx.protagonistId);
  return freeze({ok:Boolean(entry),adviceId:entry?.id||null,worldMutation:false,actionExecuted:false,proposalOnly:true});
}
function render(reason="explicit"){
  if(!state.rootNode||!root.document)return null;
  const ctx=campaignContext(),records=currentRecords(ctx),identity=identityFor(records),counsel=state.evidenceMode?[]:counselRows(ctx.seed,ctx.protagonistId);
  state.rootNode.innerHTML=panelMarkup(ctx,records,counsel,identity);
  state.rootNode.dataset.version=VERSION;
  state.rootNode.dataset.renderMode="event-driven";
  state.rootNode.dataset.evidenceMode=state.evidenceMode||"none";
  state.rootNode.dataset.open=String(state.open);
  state.rootNode.dataset.recordCount=String(records.length);
  state.renderCount++;state.lastSeed=ctx.seed;state.lastRecordCount=records.length;state.lastRenderReason=reason;

  const launcher=state.rootNode.querySelector(".advisor-chat-launcher");
  launcher?.addEventListener("click",()=>{const next=!state.open;if(next&&root.AdvisorToolbeltUI?.setOpen)root.AdvisorToolbeltUI.setOpen(false);state.open=next;render("toggle")});
  state.rootNode.querySelector(".advisor-chat-close")?.addEventListener("click",()=>{state.open=false;render("close")});
  const form=state.rootNode.querySelector(".advisor-chat-compose");
  form?.addEventListener("submit",event=>{
    event.preventDefault();
    const input=form.querySelector("textarea"),text=input?.value||"";
    const result=recordMessage(text);
    if(result.ok){state.open=true;render("message-submit")}
    else input?.focus();
  });
  const counselForm=state.rootNode.querySelector(".advisor-counsel-compose");
  counselForm?.addEventListener("submit",event=>{
    event.preventDefault();
    const data=new FormData(counselForm),result=deliverCounsel(data.get("topic"),data.get("target"));
    if(result.ok){state.open=true;render("counsel-submit")}
  });
  return state.rootNode;
}
function setOpen(value){const next=Boolean(value);if(next&&root.AdvisorEconomyUI?.setOpen)root.AdvisorEconomyUI.setOpen(false);state.open=next;return render(state.open?"external-open":"external-close")}
function setEvidenceMode(modeValue){
  const mode=EVIDENCE_MODES.includes(String(modeValue||""))?String(modeValue):null;
  state.evidenceMode=mode;state.open=Boolean(mode)||state.open;
  return render("evidence-mode");
}
function mount(optionsValue){
  if(!root.document)return null;
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
  let node=root.document.getElementById("advisorConversationUI");
  if(!node){
    node=root.document.createElement("div");
    node.id="advisorConversationUI";
    node.className="advisor-chat-shell";
    root.document.body.appendChild(node);
  }
  state.rootNode=node;state.mounted=true;
  const queryMode=(()=>{
    try{return new URLSearchParams(root.location?.search||"").get("advisorEvidence")}catch(_){return null}
  })();
  state.evidenceMode=EVIDENCE_MODES.includes(options.evidenceMode)?options.evidenceMode:(EVIDENCE_MODES.includes(queryMode)?queryMode:null);
  state.open=options.open===true||Boolean(state.evidenceMode);
  render("mount");
  return node;
}
function autoMount(){
  if(!root.document||state.mounted)return;
  const start=()=>{if(!state.mounted)mount()};
  if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
}
function snapshot(){
  const ctx=campaignContext();
  return freeze({
    version:VERSION,mounted:state.mounted,open:state.open,evidenceMode:state.evidenceMode,
    renderCount:state.renderCount,submitCount:state.submitCount,counselSubmitCount:state.counselSubmitCount,
    lastSeed:state.lastSeed||ctx.seed,lastRecordCount:state.lastRecordCount,lastRenderReason:state.lastRenderReason,
    limits:{maxTranscriptRecords:MAX_TRANSCRIPT_RECORDS,maxCounselRows:MAX_COUNSEL_ROWS,maxMessageChars:MAX_MESSAGE_CHARS},
    authority:{eventDriven:true,perFrameConversationRender:false,fullWorldScan:false,wholeCampaignScan:false,directWorldMutation:false,directExecution:false,protagonistDecisionBypass:false,simulationCompletionGate:true,providerPayloadRendered:false}
  });
}
function proof(){
  const modes=Object.fromEntries(EVIDENCE_MODES.map(mode=>[mode,evidenceRecords(mode).map(statusFor)]));
  const falseComplete=syntheticRecord({id:"EVID-FALSE-COMPLETE",playerText:"Claim complete",replyText:"Accepted.",decisionState:"accepted",proposalId:"P",decisionId:"D"});
  const trueComplete=evidenceRecords("completed")[0];
  return freeze({
    pass:
      modes.ordinary.some(x=>x.key==="local")&&modes.ordinary.some(x=>x.key==="considering")&&
      modes.ambiguous.some(x=>x.key==="clarification")&&
      modes.rejected.some(x=>x.key==="rejected")&&modes.rejected.some(x=>x.key==="deferred")&&
      statusFor(trueComplete).key==="completed"&&statusFor(falseComplete).key!=="completed",
    modes,falseCompletionSuppressed:statusFor(falseComplete).key,authoritativeCompletion:statusFor(trueComplete).key,
    deterministicEvidence:JSON.stringify(evidenceRecords("ordinary"))===JSON.stringify(evidenceRecords("ordinary")),
    eventDriven:true,perFrameConversationRender:false,fullWorldScan:false,directWorldMutation:false,directExecution:false
  });
}

return freeze({
  VERSION,MAX_TRANSCRIPT_RECORDS,MAX_COUNSEL_ROWS,MAX_MESSAGE_CHARS,EVIDENCE_MODES,
  completedBacked,statusFor,viewRecord,evidenceRecords,recordMessage,deliverCounsel,mount,autoMount,render,setOpen,setEvidenceMode,snapshot,proof
});
});
