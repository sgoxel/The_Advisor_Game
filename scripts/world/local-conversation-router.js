(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.LocalConversationRouter=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const ROUTER_VERSION="advisor-local-router-v1";
const MAX_INPUT_LENGTH=512;
const MAX_INTENT_CANDIDATES=8;
const MAX_MEMORY_ROWS=16;
const MAX_ADVICE_ROWS=8;
const MAX_CONTEXT_FACTS=16;
const MODES=Object.freeze([
  "local-library",
  "local-context-response",
  "clarification-needed",
  "llm-eligible",
  "deterministic-offline-fallback"
]);

function deepFreeze(value){
  if(!value||typeof value!=="object"||Object.isFrozen(value))return value;
  Object.freeze(value);
  Object.keys(value).forEach(key=>deepFreeze(value[key]));
  return value;
}
function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    const out={};
    Object.keys(value).sort().forEach(key=>{
      if(value[key]!==undefined)out[key]=canonicalize(value[key]);
    });
    return out;
  }
  return value;
}
function stableStringify(value){return JSON.stringify(canonicalize(value));}
function normalizeText(value,max=MAX_INPUT_LENGTH){
  return String(value==null?"":value).normalize?.("NFKC")
    ?.replace(/[\u2018\u2019]/g,"'")
    ?.replace(/\s+/g," ")
    ?.trim()
    ?.slice(0,max)
    ||String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);
}
function lower(value){return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}'\s-]+/gu," ").replace(/\s+/g," ").trim();}
function tokens(value){
  return lower(value).match(/[\p{L}\p{N}']+/gu)?.filter(token=>token.length>2)||[];
}
function actorIdentity(context){
  const source=context?.character&&typeof context.character==="object"?context.character:{};
  const id=normalizeText(source.id||context?.protagonistId||"protagonist",120)||"protagonist";
  const name=normalizeText(source.name||context?.protagonistName||"Protagonist",120)||"Protagonist";
  return Object.freeze({kind:"protagonist",id,name});
}
function sourceDefaults(){
  const scope=root||globalThis;
  return Object.freeze({
    matchSentence(input){
      return scope.SentenceLibrary?.match?.(input)||null;
    },
    getMemory(context){
      const seed=normalizeText(context.seed,120);
      const rows=scope.CharacterMemory?.list?.(seed,{kind:"protagonist",id:"protagonist"})||[];
      return rows.slice(-MAX_MEMORY_ROWS);
    },
    getAdvice(context){
      const seed=normalizeText(context.seed,120);
      const rows=scope.AdvisorChannel?.list?.(seed,"protagonist")||[];
      return rows.slice(-MAX_ADVICE_ROWS);
    },
    getSocialContext(context){
      const residentId=normalizeText(context.socialTargetId||"",120);
      if(!residentId)return null;
      return scope.SocialState?.dialogueContext?.(normalizeText(context.seed,120),residentId)||null;
    }
  });
}
function internalFallbackMatch(input){
  const normalized=lower(input),candidates=[];
  const add=(intentId,ruleId,variables,priority=50,confidence=.72)=>candidates.push({
    intentId,ruleId,matchType:"internal-fallback",priority,confidence,variables:variables||{}
  });
  if(["hello","hi","hey","greetings","good morning","good evening"].includes(normalized))add("advisor.greeting","fallback-greeting",{},100,1);
  if(["how are you","how do you feel","are you okay","how are things"].includes(normalized))add("advisor.status.question","fallback-status",{},100,1);
  if(["what is your schedule","what's your schedule","what are you doing","what are you doing today","when do you work"].includes(normalized))add("advisor.schedule.question","fallback-schedule",{},100,1);
  if(["what do you have","what are you carrying","show me your inventory","what is in your inventory","what's in your inventory"].includes(normalized))add("advisor.inventory.question","fallback-inventory",{},100,1);

  let match=/^(?:please )?(?:tell me about|what do you know about|explain) (.+)$/.exec(normalized);
  if(match)add("advisor.info.request","fallback-info",{topic:match[1]},82,.9);
  match=/^(?:please )?where is (.+)$/.exec(normalized);
  if(match)add("advisor.info.location","fallback-location",{place:match[1]},82,.9);
  match=/^(?:please )?(?:go to|travel to|head to|visit|walk to) (.+)$/.exec(normalized);
  if(match)add("advisor.travel.suggest","fallback-travel",{place:match[1]},78,.86);
  match=/^(?:please )?(?:talk to|speak with|speak to) (.+)$/.exec(normalized);
  if(match)add("advisor.interaction.request","fallback-interaction",{person:match[1]},78,.86);
  match=/^(?:please )?(?:ask|question) (.+?) about (.+)$/.exec(normalized);
  if(match)add("advisor.interaction.request","fallback-interaction-topic",{person:match[1],topic:match[2]},84,.91);
  match=/^(?:please )?(?:remember|don't forget|do not forget) (.+)$/.exec(normalized);
  if(match)add("advisor.reminder","fallback-reminder",{topic:match[1]},80,.88);
  if(/\b(?:be careful|watch out|stay alert)\b/.test(normalized))add("advisor.warning","fallback-warning",{},85,.9);

  match=/^find (.+)$/.exec(normalized);
  if(match){
    add("advisor.travel.suggest","fallback-find-place",{target:match[1]},40,.62);
    add("advisor.interaction.request","fallback-find-person",{target:match[1]},40,.62);
  }
  match=/^check on (.+)$/.exec(normalized);
  if(match){
    add("advisor.info.request","fallback-check-info",{target:match[1]},38,.6);
    add("advisor.interaction.request","fallback-check-interaction",{target:match[1]},38,.6);
  }
  candidates.sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence||a.intentId.localeCompare(b.intentId));
  const top=candidates[0]||null;
  const tied=top?candidates.filter(item=>item.priority===top.priority&&item.confidence===top.confidence):[];
  const ids=[...new Set(tied.map(item=>item.intentId))].sort();
  return deepFreeze({
    normalizedInput:normalized,
    candidates:candidates.slice(0,MAX_INTENT_CANDIDATES),
    selectedIntentId:ids.length===1?ids[0]:null,
    ambiguity:Object.freeze({isAmbiguous:ids.length>1,reason:ids.length>1?"top-score-conflict":(top?"resolved":"no-match"),candidateIntentIds:Object.freeze(ids.length>1?ids:[])}),
    source:"internal-fallback"
  });
}
function normalizeCandidate(candidate){
  if(!candidate||typeof candidate!=="object")return null;
  const intentId=normalizeText(candidate.intentId||candidate.intent||"",120);
  if(!intentId)return null;
  return Object.freeze({
    intentId,
    ruleId:normalizeText(candidate.ruleId||candidate.rule||"supplied",120)||"supplied",
    matchType:normalizeText(candidate.matchType||"supplied",80)||"supplied",
    priority:Number.isFinite(Number(candidate.priority))?Number(candidate.priority):50,
    confidence:Number.isFinite(Number(candidate.confidence))?Math.max(0,Math.min(1,Number(candidate.confidence))):.5,
    variables:Object.freeze({...((candidate.variables&&typeof candidate.variables==="object")?candidate.variables:{})})
  });
}
function suppliedMatch(context){
  const raw=context?.matchResult||context?.intentResult||null;
  const suppliedCandidates=context?.intentCandidates||raw?.candidates||null;
  if(!Array.isArray(suppliedCandidates))return null;
  const candidates=suppliedCandidates.map(normalizeCandidate).filter(Boolean).slice(0,MAX_INTENT_CANDIDATES);
  const ambiguityRaw=context?.ambiguity||raw?.ambiguity||null;
  const top=candidates[0]||null;
  const sameTop=top?candidates.filter(item=>item.priority===top.priority&&item.confidence===top.confidence):[];
  const conflict=[...new Set(sameTop.map(item=>item.intentId))].sort();
  const explicitAmbiguous=Boolean(ambiguityRaw?.isAmbiguous);
  const ambiguous=explicitAmbiguous||conflict.length>1;
  return deepFreeze({
    normalizedInput:normalizeText(raw?.normalizedInput||context?.normalizedInput||"",MAX_INPUT_LENGTH),
    candidates,
    selectedIntentId:ambiguous?null:normalizeText(raw?.selectedIntentId||context?.selectedIntentId||top?.intentId||"",120)||null,
    ambiguity:Object.freeze({
      isAmbiguous:ambiguous,
      reason:normalizeText(ambiguityRaw?.reason||(ambiguous?"top-score-conflict":top?"resolved":"no-match"),120),
      candidateIntentIds:Object.freeze(
        (Array.isArray(ambiguityRaw?.candidateIntentIds)?ambiguityRaw.candidateIntentIds:conflict).map(String).sort()
      )
    }),
    source:"supplied-candidates"
  });
}
function resolveMatch(message,context,sources){
  const supplied=suppliedMatch(context);
  if(supplied)return supplied;
  const external=sources?.matchSentence?.(message);
  if(external&&typeof external==="object"){
    return deepFreeze({
      normalizedInput:normalizeText(external.normalizedInput||lower(message),MAX_INPUT_LENGTH),
      candidates:Object.freeze((external.candidates||[]).map(normalizeCandidate).filter(Boolean).slice(0,MAX_INTENT_CANDIDATES)),
      selectedIntentId:normalizeText(external.selectedIntentId||"",120)||null,
      ambiguity:Object.freeze({
        isAmbiguous:Boolean(external.ambiguity?.isAmbiguous),
        reason:normalizeText(external.ambiguity?.reason||"resolved",120),
        candidateIntentIds:Object.freeze((external.ambiguity?.candidateIntentIds||[]).map(String).sort())
      }),
      source:"sentence-library"
    });
  }
  return internalFallbackMatch(message);
}
function factRows(context,sources){
  const supplied=Array.isArray(context?.facts)?context.facts.slice(0,MAX_CONTEXT_FACTS):[];
  const memory=(sources?.getMemory?.(context)||[]).slice(-MAX_MEMORY_ROWS).map(entry=>({
    id:entry?.id||null,
    subject:entry?.fact?.subject||entry?.scene?.subjectId||null,
    summary:entry?.summary||"",
    sourceType:entry?.source?.type||"memory",
    reliability:entry?.reliability||"uncertain",
    authority:entry?.authority||"knowledge-only",
    uncertain:Boolean(entry?.uncertain)
  }));
  return [...supplied,...memory].slice(0,MAX_CONTEXT_FACTS).map((row,index)=>Object.freeze({
    id:normalizeText(row?.id||("fact-"+index),120),
    subject:normalizeText(row?.subject||"",160)||null,
    summary:normalizeText(row?.summary||row?.text||row?.value||"",320),
    sourceType:normalizeText(row?.sourceType||row?.source?.type||"context",80),
    reliability:normalizeText(row?.reliability||"uncertain",80),
    authority:normalizeText(row?.authority||"knowledge-only",80),
    uncertain:Boolean(row?.uncertain),
    grounded:row?.grounded!==false
  })).filter(row=>row.summary&&row.grounded);
}
function bestFact(topic,rows){
  const wanted=tokens(topic);
  if(!wanted.length)return null;
  const ranked=rows.map(row=>{
    const hay=lower([row.subject,row.summary].filter(Boolean).join(" "));
    const score=wanted.reduce((n,token)=>n+(hay.includes(token)?1:0),0);
    return {row,score};
  }).filter(item=>item.score>0).sort((a,b)=>
    b.score-a.score||
    Number(a.row.uncertain)-Number(b.row.uncertain)||
    a.row.id.localeCompare(b.row.id)
  );
  return ranked[0]?.row||null;
}
function groundedSummary(value,label){
  if(!value)return null;
  if(typeof value==="string"){
    const text=normalizeText(value,320);
    return text?Object.freeze({text,source:label,grounded:true}):null;
  }
  if(typeof value==="object"){
    const text=normalizeText(value.text||value.summary||value.label||"",320);
    if(!text||value.grounded===false)return null;
    return Object.freeze({text,source:normalizeText(value.source||label,120)||label,grounded:true});
  }
  return null;
}
function topicFor(intent,candidate,message){
  const v=candidate?.variables||{};
  if(intent==="advisor.info.request")return normalizeText(v.topic||v.target||message,160);
  if(intent==="advisor.info.location")return normalizeText(v.place||v.target||message,160);
  if(intent==="advisor.warning"||intent==="advisor.reminder")return normalizeText(v.topic||v.target||message,160);
  return normalizeText(message,160);
}
function localReply(intent,candidate,context,sources,message){
  if(intent==="advisor.greeting")return {mode:"local-library",reason:"known-greeting",reply:"I'm listening. What would you like to discuss?",source:"deterministic-template"};
  if(intent==="advisor.travel.suggest"){
    const place=normalizeText(candidate?.variables?.place||candidate?.variables?.target||"that destination",120);
    return {mode:"local-library",reason:"known-travel-suggestion",reply:"I understand the suggestion to travel to "+place+". I have not taken that action; I can consider it.",source:"deterministic-template"};
  }
  if(intent==="advisor.interaction.request"){
    const person=normalizeText(candidate?.variables?.person||candidate?.variables?.target||"that person",120);
    return {mode:"local-library",reason:"known-interaction-request",reply:"I understand the suggestion to speak with "+person+". No interaction has happened yet; I can consider it.",source:"deterministic-template"};
  }
  if(intent==="advisor.warning"){
    return {mode:"local-library",reason:"known-warning",reply:"I understand the warning. I will treat it as advice, not as proof that anything has changed.",source:"deterministic-template"};
  }
  if(intent==="advisor.reminder"){
    const topic=normalizeText(candidate?.variables?.topic||"that",160);
    return {mode:"local-library",reason:"known-reminder",reply:"I understand the reminder about "+topic+". It is advice only; no world state has changed.",source:"deterministic-template"};
  }

  if(intent==="advisor.status.question"){
    const status=groundedSummary(context?.statusSummary||context?.status,"authoritative-status");
    if(status)return {mode:"local-context-response",reason:"grounded-status",reply:status.text,source:status.source};
    return {mode:null,reason:"status-unavailable",reply:null,source:null};
  }
  if(intent==="advisor.schedule.question"){
    const schedule=groundedSummary(context?.scheduleSummary||context?.schedule,"authoritative-schedule");
    if(schedule)return {mode:"local-context-response",reason:"grounded-schedule",reply:schedule.text,source:schedule.source};
    return {mode:null,reason:"schedule-unavailable",reply:null,source:null};
  }
  if(intent==="advisor.inventory.question"){
    const inventory=groundedSummary(context?.inventorySummary||context?.inventory,"authoritative-inventory");
    if(inventory)return {mode:"local-context-response",reason:"grounded-inventory",reply:inventory.text,source:inventory.source};
    return {mode:null,reason:"inventory-unavailable",reply:null,source:null};
  }
  if(intent==="advisor.info.request"||intent==="advisor.info.location"){
    const topic=topicFor(intent,candidate,message),fact=bestFact(topic,factRows(context,sources));
    if(fact){
      const prefix=fact.uncertain?"The grounded information I have is uncertain: ":"What I know from the current record: ";
      return {mode:"local-context-response",reason:"grounded-context-fact",reply:prefix+fact.summary,source:fact.id};
    }
    return {mode:null,reason:"grounded-fact-unavailable",reply:null,source:null};
  }
  return {mode:null,reason:"no-local-template",reply:null,source:null};
}
function offlineFallback(reason,character){
  const name=character.name;
  if(reason==="status-unavailable")return name+": I don't have a reliable current status record to report.";
  if(reason==="schedule-unavailable")return name+": I don't have a reliable current schedule record to report.";
  if(reason==="inventory-unavailable")return name+": I don't have a reliable inventory record to report.";
  if(reason==="grounded-fact-unavailable")return name+": I don't have reliable information in the current bounded context to answer that.";
  return name+": I don't understand that well enough to act on it. You can rephrase it, and I won't invent an answer.";
}
function route(messageValue,contextValue,sourceOverrides){
  const message=normalizeText(messageValue,MAX_INPUT_LENGTH);
  const context=contextValue&&typeof contextValue==="object"?contextValue:{};
  const defaults=sourceDefaults(),sources=Object.freeze({...defaults,...(sourceOverrides||{})});
  const character=actorIdentity(context);
  if(!message){
    return deepFreeze({
      routerVersion:ROUTER_VERSION,mode:"deterministic-offline-fallback",reason:"empty-input",
      reply:offlineFallback("empty-input",character),offlineFallback:offlineFallback("empty-input",character),
      character,intentCandidates:Object.freeze([]),selectedIntentId:null,
      sourceMetadata:Object.freeze({recognizer:"none",responseSource:"offline-fallback",authority:"read-only-context"}),
      externalLlmEligible:false,worldMutation:false,actionExecuted:false,memoryMutation:false,
      metrics:Object.freeze({memoryRowsRead:0,adviceRowsRead:0,maxMemoryRows:MAX_MEMORY_ROWS,maxAdviceRows:MAX_ADVICE_ROWS,fullWorldScan:false,wholeHistoryScan:false})
    });
  }

  const match=resolveMatch(message,context,sources);
  const candidates=Object.freeze((match.candidates||[]).slice(0,MAX_INTENT_CANDIDATES));
  if(match.ambiguity?.isAmbiguous){
    const ids=match.ambiguity.candidateIntentIds||candidates.map(item=>item.intentId);
    const reply="I can read that more than one way ("+ids.join(", ")+"). Please clarify what you want me to consider.";
    return deepFreeze({
      routerVersion:ROUTER_VERSION,mode:"clarification-needed",reason:"ambiguous-intent",reply,offlineFallback:reply,
      character,intentCandidates:candidates,selectedIntentId:null,
      sourceMetadata:Object.freeze({recognizer:match.source,responseSource:"clarification-template",authority:"read-only-context"}),
      externalLlmEligible:false,worldMutation:false,actionExecuted:false,memoryMutation:false,
      metrics:Object.freeze({memoryRowsRead:0,adviceRowsRead:0,maxMemoryRows:MAX_MEMORY_ROWS,maxAdviceRows:MAX_ADVICE_ROWS,fullWorldScan:false,wholeHistoryScan:false})
    });
  }

  const selected=match.selectedIntentId||candidates[0]?.intentId||null;
  const candidate=candidates.find(item=>item.intentId===selected)||candidates[0]||null;
  const local=selected?localReply(selected,candidate,context,sources,message):{mode:null,reason:"unrecognized-input",reply:null,source:null};
  if(local.mode){
    return deepFreeze({
      routerVersion:ROUTER_VERSION,mode:local.mode,reason:local.reason,reply:local.reply,offlineFallback:local.reply,
      character,intentCandidates:candidates,selectedIntentId:selected,
      sourceMetadata:Object.freeze({recognizer:match.source,responseSource:local.source,authority:"read-only-context"}),
      externalLlmEligible:false,worldMutation:false,actionExecuted:false,memoryMutation:false,
      metrics:Object.freeze({
        memoryRowsRead:(selected==="advisor.info.request"||selected==="advisor.info.location")?Math.min(MAX_MEMORY_ROWS,(sources?.getMemory?.(context)||[]).length):0,
        adviceRowsRead:0,maxMemoryRows:MAX_MEMORY_ROWS,maxAdviceRows:MAX_ADVICE_ROWS,
        fullWorldScan:false,wholeHistoryScan:false
      })
    });
  }

  const fallback=offlineFallback(local.reason,character);
  const externalEnabled=context.externalAiEnabled!==false;
  const mode=externalEnabled?"llm-eligible":"deterministic-offline-fallback";
  return deepFreeze({
    routerVersion:ROUTER_VERSION,mode,reason:local.reason,reply:fallback,offlineFallback:fallback,
    character,intentCandidates:candidates,selectedIntentId:selected,
    sourceMetadata:Object.freeze({recognizer:match.source,responseSource:"offline-fallback",authority:"read-only-context"}),
    externalLlmEligible:externalEnabled,worldMutation:false,actionExecuted:false,memoryMutation:false,
    metrics:Object.freeze({
      memoryRowsRead:(selected==="advisor.info.request"||selected==="advisor.info.location")?Math.min(MAX_MEMORY_ROWS,(sources?.getMemory?.(context)||[]).length):0,
      adviceRowsRead:0,maxMemoryRows:MAX_MEMORY_ROWS,maxAdviceRows:MAX_ADVICE_ROWS,
      fullWorldScan:false,wholeHistoryScan:false
    })
  });
}
function serializeResult(value){return stableStringify(value);}
function getModes(){return MODES;}

return deepFreeze({
  ROUTER_VERSION,MAX_INPUT_LENGTH,MAX_INTENT_CANDIDATES,MAX_MEMORY_ROWS,MAX_ADVICE_ROWS,MAX_CONTEXT_FACTS,
  getModes,route,serializeResult,internalFallbackMatch
});
});
