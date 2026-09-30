(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistSocialContact=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-social-contact-v1";
const MAX_CANDIDATES=12;
const MAX_INTENTS_PER_PERSON=6;
const MAX_REFERENCE_IDS=12;
const MAX_REASONS=12;
const INTENTS=Object.freeze(["greeting","check-in","ask","warn","apologize","avoid"]);
const UNRESOLVED_MEMORY_TYPES=Object.freeze(["promise","debt","warning","refusal"]);

function freeze(value){if(!value||typeof value!=="object"||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}return value;}
function stable(value){return JSON.stringify(canonical(value));}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function clamp01(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;}
function clamp11(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):fallback;}
function uniqueIds(value,limit=MAX_REFERENCE_IDS){const out=[];for(const raw of Array.isArray(value)?value:[]){const id=cleanId(raw);if(id&&!out.includes(id))out.push(id);if(out.length>=limit)break;}return freeze(out);}
function normalizeIntents(value){const out=[];const raw=Array.isArray(value)&&value.length?value:INTENTS;for(const item of raw){const intent=cleanId(item,40).toLowerCase();if(INTENTS.includes(intent)&&!out.includes(intent))out.push(intent);if(out.length>=MAX_INTENTS_PER_PERSON)break;}return freeze(out);}
function relationshipValues(social){const v=plain(social?.values)?social.values:plain(social?.relationship?.values)?social.relationship.values:{};return freeze({
  trust:clamp01(v.trust,.5),fear:clamp01(v.fear,.1),respect:clamp01(v.respect,.5),
  suspicion:clamp01(v.suspicion,.25),loyalty:clamp01(v.loyalty,.35),resentment:clamp01(v.resentment,.1)
});}
function socialSignals(value){const social=plain(value)?value:{};const relationship=plain(social.relationship)?social.relationship:null;const relationshipEventIds=uniqueIds(relationship?.eventIds||[]);const reputationEventIds=[];for(const row of Array.isArray(social.reputations)?social.reputations:[]){for(const id of Array.isArray(row?.eventIds)?row.eventIds:[]){const cleanRef=cleanId(id);if(cleanRef&&!reputationEventIds.includes(cleanRef))reputationEventIds.push(cleanRef);if(reputationEventIds.length>=MAX_REFERENCE_IDS)break;}if(reputationEventIds.length>=MAX_REFERENCE_IDS)break;}return freeze({
  values:relationshipValues(social),
  reputationAverage:clamp11(social.reputationAverage,0),
  activeDutyPriority:clamp01(social.activeDutyPriority,0),
  relationshipEventIds,
  reputationEventIds:freeze(reputationEventIds)
});}
function memorySignals(value){const memory=plain(value)?value:{};const last=plain(memory.lastMeaningfulEvent)?memory.lastMeaningfulEvent:null;const type=cleanId(last?.type||memory.lastInteractionType||"",40).toLowerCase();const unresolved=memory.unresolved===true||UNRESOLVED_MEMORY_TYPES.includes(type);return freeze({
  metBefore:memory.metBefore===true,
  familiarity:cleanId(memory.familiarity||"stranger",40).toLowerCase()||"stranger",
  meaningfulEncounterCount:Math.max(0,Math.min(9999,Math.floor(Number(memory.meaningfulEncounterCount)||0))),
  unresolved,
  lastType:type||null,
  referenceId:cleanId(last?.id||last?.memoryId||memory.referenceId||"")||null
});}
function normalizeCandidate(value,index){const raw=plain(value)?value:{},personId=cleanId(raw.personId||raw.id||"",120),socialAvailable=plain(raw.socialContext||raw.social),memoryAvailable=plain(raw.memoryContext||raw.memory);return freeze({
  personId,label:clean(raw.label||raw.name||personId||("person-"+index),120),
  available:raw.available===true,nearby:raw.nearby!==false,
  topic:clean(raw.topic||raw.subject||"",160)||null,
  interactionTargetId:cleanId(raw.interactionTargetId||raw.targetId||"",160)||null,
  supportedIntents:normalizeIntents(raw.supportedIntents||raw.intents),
  urgency:clamp01(raw.urgency,0),
  dutyId:cleanId(raw.dutyId||"",160)||null,
  socialAvailable,memoryAvailable,
  social:socialSignals(raw.socialContext||raw.social),
  memory:memorySignals(raw.memoryContext||raw.memory)
});}
function validateCandidate(candidate){if(!candidate.personId)return freeze({ok:false,reason:"person-id-required"});if(candidate.available!==true)return freeze({ok:false,reason:"person-unavailable"});if(candidate.nearby!==true)return freeze({ok:false,reason:"person-not-nearby"});if(!candidate.socialAvailable)return freeze({ok:false,reason:"social-context-unavailable"});if(!candidate.memoryAvailable)return freeze({ok:false,reason:"memory-context-unavailable"});if(!candidate.supportedIntents.length)return freeze({ok:false,reason:"supported-intent-required"});return freeze({ok:true,reason:"person-context-valid"});}
function intentScore(intent,candidate){const v=candidate.social.values,m=candidate.memory,duty=candidate.social.activeDutyPriority,rep=candidate.social.reputationAverage,topic=candidate.topic?1:0,met=m.metBefore?1:0,unresolved=m.unresolved?1:0,count=Math.min(6,m.meaningfulEncounterCount)/6;let score=0;
  if(intent==="greeting")score=50+v.trust*24+v.respect*10+v.loyalty*6-v.suspicion*12-v.resentment*14-v.fear*4+met*4;
  else if(intent==="check-in")score=42+v.trust*18+v.loyalty*8+met*8+unresolved*34+count*6-v.suspicion*6;
  else if(intent==="ask")score=38+v.trust*12+v.respect*12+rep*8+topic*10-v.suspicion*8;
  else if(intent==="warn")score=34+v.trust*6+v.respect*8+duty*46+candidate.urgency*22+topic*6-v.resentment*5;
  else if(intent==="apologize")score=25+v.resentment*34+v.suspicion*18+met*8+((m.lastType==="refusal")?12:0);
  else if(intent==="avoid")score=18+v.suspicion*36+v.resentment*38+v.fear*24-v.trust*18-v.loyalty*8;
  return Number(score.toFixed(6));
}
function reasonFor(intent,candidate){if(intent==="avoid")return "conflict-avoidance";if(intent==="warn"&&candidate.social.activeDutyPriority>=.5)return "duty-related-contact";if(intent==="check-in"&&candidate.memory.unresolved)return "unresolved-memory-follow-up";if(intent==="greeting"&&candidate.social.values.trust>=.65)return "friendly-contact";if(intent==="apologize")return "relationship-repair";if(intent==="ask")return "information-seeking-contact";return "social-contact";}
function explanation(candidate,intent){const out=[reasonFor(intent,candidate)];const v=candidate.social.values;if(v.trust>=.65)out.push("relationship-trust");if(v.suspicion>=.6||v.resentment>=.6||v.fear>=.6)out.push("relationship-risk");if(candidate.social.activeDutyPriority>=.5)out.push("active-duty");if(candidate.memory.metBefore)out.push("known-person");if(candidate.memory.unresolved)out.push("unresolved-memory");if(candidate.topic)out.push("supplied-topic");return freeze(out.slice(0,MAX_REASONS));}
function proposalFor(seed,when,candidate,intent,intentId){if(intent==="avoid")return null;const parameters={personId:candidate.personId};if(candidate.interactionTargetId)parameters.interactionTargetId=candidate.interactionTargetId;parameters.topic=candidate.topic||intent.replace(/-/g," ");return freeze({proposalId:"SOCIALPROP-"+hashText(stable({seed,when,intentId,parameters})),commandId:"advisor.propose_interaction",parameters:freeze(parameters),source:"protagonist-social-contact"});}
function refsFor(candidate){return freeze({personId:candidate.personId,dutyId:candidate.dutyId,memoryReferenceId:candidate.memory.referenceId,relationshipEventIds:candidate.social.relationshipEventIds,reputationEventIds:candidate.social.reputationEventIds});}
function authorityFlags(){return freeze({determinism:"Campaign SEED + Fantasy Game Time + supplied bounded person/social/memory context",personAuthority:false,relationshipAuthority:false,reputationAuthority:false,memoryAuthority:false,dutyAuthority:false,dialogueOutcomeAuthority:false,directRelationshipMutation:false,directMemoryMutation:false,directWorldMutation:false,directPositionMutation:false,targetFabrication:false,personFabrication:false,simulationValidationBypass:false,fullSettlementScan:false,wholeMemoryScan:false,fullWorldScan:false,perFrameScan:false,presentationAuthority:false,providerAuthority:false});}
function bounds(){return freeze({maxCandidates:MAX_CANDIDATES,maxIntentsPerPerson:MAX_INTENTS_PER_PERSON,maxReferenceIds:MAX_REFERENCE_IDS,maxReasons:MAX_REASONS});}
function evaluate(configValue){const config=plain(configValue)?configValue:{},seed=clean(config.seed,160),when=clean(config.when,32),raw=Array.isArray(config.candidates)?config.candidates:[];
  if(!seed)return freeze({ok:false,reason:"campaign-seed-required",authority:authorityFlags()});
  if(!validWhen(when))return freeze({ok:false,reason:"fantasy-time-required",authority:authorityFlags()});
  if(raw.length>MAX_CANDIDATES)return freeze({ok:false,reason:"candidate-limit-exceeded",maxCandidates:MAX_CANDIDATES,bounded:true,authority:authorityFlags()});
  const evaluated=[],valid=[];
  for(let i=0;i<raw.length;i++){const candidate=normalizeCandidate(raw[i],i),checked=validateCandidate(candidate);if(!checked.ok){evaluated.push(freeze({personId:candidate.personId||null,valid:false,reason:checked.reason,bestIntent:null,score:null}));continue;}let best=null;for(const intent of candidate.supportedIntents){const score=intentScore(intent,candidate),tie=hashText(stable({seed,when,personId:candidate.personId,intent,topic:candidate.topic||""})),row={intent,score,tie};if(!best||row.score>best.score||(row.score===best.score&&(row.tie<best.tie||(row.tie===best.tie&&row.intent<best.intent))))best=row;}const reason=reasonFor(best.intent,candidate),row=freeze({personId:candidate.personId,label:candidate.label,valid:true,reason,bestIntent:best.intent,score:best.score,tieBreak:best.tie,reasons:explanation(candidate,best.intent),references:refsFor(candidate)});evaluated.push(row);valid.push({candidate,row,intent:best.intent,score:best.score,tie:best.tie});}
  valid.sort((a,b)=>b.score-a.score||a.tie.localeCompare(b.tie)||a.candidate.personId.localeCompare(b.candidate.personId));
  const chosen=valid[0]||null;
  if(!chosen)return freeze({version:VERSION,ok:true,seed,when,status:"no-contact",disposition:"none",reason:"no-valid-person",selectedPerson:null,selectedIntent:null,selectedProposal:null,socialIntentId:null,evaluated:freeze(evaluated),bounds:bounds(),authority:authorityFlags()});
  const intentId="SINT-"+hashText(stable({seed,when,personId:chosen.candidate.personId,intent:chosen.intent,topic:chosen.candidate.topic,references:refsFor(chosen.candidate)}));
  const proposal=proposalFor(seed,when,chosen.candidate,chosen.intent,intentId),status=chosen.intent==="avoid"?"avoid":"proposal-ready";
  return freeze({version:VERSION,ok:true,seed,when,status,disposition:chosen.intent==="avoid"?"avoid":"contact",reason:chosen.row.reason,selectedPerson:freeze({id:chosen.candidate.personId,label:chosen.candidate.label}),selectedIntent:chosen.intent,selectedProposal:proposal,socialIntentId:intentId,selectionId:"SOCSEL-"+hashText(stable({seed,when,personId:chosen.candidate.personId,intent:chosen.intent,intentId})),references:refsFor(chosen.candidate),reasons:chosen.row.reasons,evaluated:freeze(evaluated),bounds:bounds(),authority:authorityFlags()});
}
function fromLive(seedValue,whenValue,optionsValue){const options=plain(optionsValue)?optionsValue:{},seed=clean(seedValue,160),when=clean(whenValue,32),raw=Array.isArray(options.candidates)?options.candidates:[];
  if(raw.length>MAX_CANDIDATES)return evaluate({seed,when,candidates:raw});
  let socialReads=0,memoryReads=0;const candidates=[];
  for(let i=0;i<raw.length;i++){const source=plain(raw[i])?raw[i]:{},personId=cleanId(source.personId||source.id||"",120);let social=null,memory=null;try{if(personId&&root?.SocialState?.dialogueContext){social=root.SocialState.dialogueContext(seed,personId);socialReads++;}}catch(_){}try{if(personId&&root?.CharacterMemory?.recognition){memory=root.CharacterMemory.recognition(seed,personId);memoryReads++;}}catch(_){}candidates.push({...clone(source),personId,socialContext:social,memoryContext:memory});}
  const result=evaluate({seed,when,candidates});return freeze({...clone(result),liveAdapter:true,sources:freeze({social:"SocialState.dialogueContext",memory:"CharacterMemory.recognition"}),readCounts:freeze({candidateRows:raw.length,socialReads,memoryReads}),authority:authorityFlags()});
}
function evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue){const result=plain(resultValue)?resultValue:{},options=plain(optionsValue)?optionsValue:{};if(result.ok!==true||result.status!=="proposal-ready"||!result.selectedProposal)return freeze({ok:false,reason:"selected-social-proposal-required",config:null});return freeze({ok:true,reason:"social-proposal-ready",boundary:"CommandSetInterface -> ProtagonistCommandEvaluator",executionDisabled:true,config:freeze({seed:result.seed,when:result.when,snapshot:snapshotValue||null,proposal:result.selectedProposal,decisionContext:plain(decisionContextValue)?clone(decisionContextValue):undefined,actorPosition:options.actorPosition?clone(options.actorPosition):undefined,actorId:cleanId(options.actorId||"protagonist",120)||"protagonist",execute:false,socialIntentId:result.socialIntentId})});}
function dialogueInput(resultValue){const result=plain(resultValue)?resultValue:{};if(result.ok!==true||result.status!=="proposal-ready"||!result.selectedPerson)return freeze({ok:false,reason:"selected-social-contact-required",config:null});return freeze({ok:true,reason:"dialogue-context-ready",boundary:"DialogueContext",config:freeze({seed:result.seed,speakerId:result.selectedPerson.id,topic:result.selectedProposal?.parameters?.topic||result.selectedIntent,when:result.when,socialIntentId:result.socialIntentId,references:clone(result.references||{})})});}
function handoff(resultValue,snapshotValue,decisionContextValue,optionsValue){const evaluator=evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue),dialogue=dialogueInput(resultValue),validator=(plain(optionsValue)?optionsValue.commandSet:null)||root?.CommandSetInterface;if(!evaluator.ok||!dialogue.ok)return freeze({ok:false,reason:evaluator.reason||dialogue.reason,evaluator,dialogue,directRelationshipMutation:false,directMemoryMutation:false});const checked=validator?.validateProposal?validator.validateProposal(snapshotValue,evaluator.config.proposal):null;return freeze({ok:Boolean(checked?.ok),reason:checked?.reason||"command-validator-unavailable",boundary:"CommandSetInterface -> ProtagonistCommandEvaluator / DialogueContext",commandValidation:checked||null,evaluator,dialogue,directRelationshipMutation:false,directMemoryMutation:false,simulationValidationBypass:false});}

return freeze({VERSION,MAX_CANDIDATES,MAX_INTENTS_PER_PERSON,MAX_REFERENCE_IDS,MAX_REASONS,INTENTS,UNRESOLVED_MEMORY_TYPES,evaluate,fromLive,evaluatorInput,dialogueInput,handoff,authority:authorityFlags()});
});
