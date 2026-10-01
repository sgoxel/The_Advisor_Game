(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistConflictResponse=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-conflict-response-v1";
const MAX_REASONS=12;
const MAX_TARGET_LENGTH=180;
const SEVERITY_WEIGHTS=Object.freeze({minor:18,moderate:32,serious:48,critical:64,overwhelming:80});
const RESPONSES=Object.freeze(["avoid","fight","defend","protect","yield","retreat"]);
const REJECTED_REASONS=Object.freeze(["grounded-threat-required","grounded-protected-target-required","grounded-authority-context-required","factual-target-required","proposal-only-response"]);

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}return value;}
function stable(value){return JSON.stringify(canonical(value));}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function severityValue(value){const s=clean(String(value||""),32).toLowerCase();return SEVERITY_WEIGHTS[s]!==undefined?s:null;}
function numeric(value, fallback){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function normalizeTarget(value,label){const out=cleanId(value,MAX_TARGET_LENGTH);return out||null;}
function sourceRef(value){if(!plain(value))return null;const kind=cleanId(value.kind||value.type||"threat",64)||"threat",id=cleanId(value.id||value.refId||value.entityId,MAX_TARGET_LENGTH);return id?Object.freeze({kind,id}):null;}
function authorityFlags(){return freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded explicit threat/readiness context",protagonistAuthorityOnly:true,healthAuthority:false,inventoryAuthority:false,relationshipAuthority:false,directCombatResolution:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,resourceFabrication:false,targetFabrication:false,simulationValidationBypass:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,presentationAuthority:false,proposalOnly:true});}
function readContext(seedValue,contextValue){
  const seed=clean(seedValue,160),when=clean(contextValue?.when||contextValue?.fantasyTimestamp||contextValue?.timestamp||"",32),threat=plain(contextValue?.threat)?contextValue.threat:{},readiness=plain(contextValue?.readiness)?contextValue.readiness:{},health=plain(contextValue?.health)?contextValue.health:{},authority=plain(contextValue?.authority)?contextValue.authority:{},profile=plain(contextValue?.profile)?contextValue.profile:{},socialState=plain(contextValue?.socialState)?contextValue.socialState:{},guidance=plain(contextValue?.guidance)?contextValue.guidance:{};
  return freeze({seed,when,threat,readiness,health,authority,profile,socialState,guidance});
}
function parseThreat(inputValue){
  const threat=plain(inputValue)?inputValue:{};
  const id=normalizeTarget(threat.threatId||threat.id||threat.sourceRef?.id,"threat");
  const source=sourceRef(threat.sourceRef||threat.source);
  const severity=severityValue(threat.severity||threat.level);
  if(!id||!severity||!source){
    return {ok:false,reason:"grounded-threat-required",details:{require:["threatId","severity","sourceRef"]}};
  }
  const targetId=normalizeTarget(threat.targetId||threat.target||threat.personId||threat.placeId,MAX_TARGET_LENGTH);
  if(!targetId){
    return {ok:false,reason:"factual-target-required",details:{require:["targetId"]}};
  }
  const protectedTargetId=normalizeTarget(threat.protectedTargetId||threat.protectedTarget||threat.guardTargetId,MAX_TARGET_LENGTH);
  const escapeAvailable=threat.escapeAvailable===true || threat.escapeAvailable==="true";
  const aggressor=clean(threat.aggressor||threat.aggressorName||threat.aggressorId||"",120);
  const riskScore=numeric(threat.riskScore, SEVERITY_WEIGHTS[severity]);
  return {ok:true,threat:{
    ok:true,
    threatId:id,
    sourceRef:source,
    severity,
    targetId,
    protectedTargetId,
    escapeAvailable,
    aggressor,
    riskScore:clamp(riskScore,0,100),
    reason:clean(threat.reason||threat.summary||"threat-action",240),
    known:threat.known!==false
  }};
}
function normalizedReadiness(value){
  const raw=plain(value)?value:{};
  const score=clamp(numeric(raw.readinessScore, numeric(raw.score, 50)), 0, 100);
  const readiness=plain(raw.readiness)?raw.readiness:{},
    martial=plain(raw.martialSkill)?raw.martialSkill:{},
    skillLevel=clamp(numeric(raw.skillLevel, numeric(martial.level, 1)), 0, 10),
    authority=plain(raw.authority)?raw.authority:{},
    role=cleanId(authority.roleId||raw.roleId||authority.rankLabel||raw.role||"protagonist",80)||"protagonist";
  return {score,skillLevel,role,authorityAvailable:Boolean(authority.available||raw.authorityAvailable===true),lawfulAuthority:Boolean(authority.available||raw.authorityAvailable===true)};
}
function normalizedHealth(value){
  const raw=plain(value)?value:{};
  const condition=clamp(numeric(raw.conditionMilli, numeric(raw.condition, 90000)), 0, 100000);
  const fatigue=clamp(numeric(raw.fatigueMilli, numeric(raw.fatigue, 15000)), 0, 100000);
  const injuryBurden=clamp(numeric(raw.injuryBurdenMilli, numeric(raw.injuryBurden, 0)), 0, 100000);
  const activeInjuryCount=clamp(Math.round(numeric(raw.activeInjuryCount, raw.injuries?.length||0)),0,24);
  return {condition, fatigue, injuryBurden, activeInjuryCount};
}
function normalizedPersonality(value){
  const raw=plain(value)?value:{};
  return {temperament:clean(raw.temperament||raw.personality||raw.tendency||"balanced",80),strength:clamp(numeric(raw.strength, 0),0,100),courage:clamp(numeric(raw.courage, 50),0,100),selfPreservationBias:clamp(numeric(raw.selfPreservationBias, 45),0,100)};
}
function normalizedSocial(value){
  const raw=plain(value)?value:{};
  return {duty:clamp(numeric(raw.duty, numeric(raw.dutyLevel, 0)),0,1),relationship:clamp(numeric(raw.relationship, numeric(raw.trust, 0)),0,1),protectionPriority:clamp(numeric(raw.protectionPriority, numeric(raw.protection, 0)),0,1),lawfulness:clamp(numeric(raw.lawfulness, 0.5),0,1)};
}
function normalizedGuidance(value){
  const raw=plain(value)?value:{};
  return {dutyLabel:clean(raw.duty||raw.dutyLabel||raw.intent||"",80),protectsTargetId:normalizeTarget(raw.protectsTargetId||raw.protectedTargetId||raw.targetId,MAX_TARGET_LENGTH),guardDuty:Boolean(raw.guardDuty===true||raw.duty==="guard"||raw.dutyLabel?.toLowerCase().includes("guard")),avoidConflict:Boolean(raw.avoidConflict===true||raw.avoid===true)};
}
function chooseResponse(seed,when,threat,readiness,personality,social,guidance,health){
  const condition=health.condition;
  const fatigue=health.fatigue;
  const injury=health.activeInjuryCount;
  const strongProtection = Boolean(guidance.protectsTargetId || (social.protectionPriority>=0.75 && social.relationship>=0.6 && guidance.guardDuty));
  const threatWeight = SEVERITY_WEIGHTS[threat.severity];
  const risk = clamp(threat.riskScore + (fatigue>60000?12:0) + (injury>0?10:0) - readiness.score*0.25, 0, 100);
  const conditionBad = condition < 35000 || fatigue > 70000 || injury > 1;
  const severeThreat = threatWeight >= 48 || risk >= 58;
  const strongReadiness = readiness.score >= 70;
  const moderateReadiness = readiness.score >= 55;
  const groundableProtection = Boolean(threat.protectedTargetId || guidance.protectsTargetId);

  if(!threat.ok){
    return {ok:false,reason:"grounded-threat-required",response:null};
  }
  if(!threat.targetId){
    return {ok:false,reason:"factual-target-required",response:null};
  }
  if(groundableProtection && strongProtection && condition > 25000 && !conditionBad){
    return {ok:true,response:"protect",reason:"strong-duty-and-targeted-protection"};
  }
  if((conditionBad || risk >= 78) && threat.escapeAvailable){
    return {ok:true,response:"retreat",reason:"self-preservation-and-escape"};
  }
  if((conditionBad || risk >= 78) && !threat.escapeAvailable){
    return {ok:true,response:"yield",reason:"overwhelming-threat-beyond-safe-resistance"};
  }
  if(risk >= 70 && !strongReadiness && !guidance.guardDuty){
    return {ok:true,response:"avoid",reason:"threat-exceeds-current-readiness"};
  }
  if(strongReadiness && severeThreat && !conditionBad){
    return {ok:true,response:"defend",reason:"high-readiness-response-to-grounded-threat"};
  }
  if(moderateReadiness && severeThreat && condition > 45000 && (threat.severity === "serious" || threat.severity === "moderate")){
    return {ok:true,response:"fight",reason:"strong-enough-to-respond-to-grounded-threat"};
  }
  if(guidance.avoidConflict || (risk < 25 && condition > 40000)){
    return {ok:true,response:"avoid",reason:"low-value-conflict-and-safe-to-defer"};
  }
  return {ok:true,response:"avoid",reason:"default-protagonist-safe-bounded-response"};
}
function evaluate(configValue){
  const config=plain(configValue)?configValue:{};
  const seed=clean(config.seed||config.campaignSeed,160);
  const when=clean(config.when||config.fantasyTimestamp||config.timestamp||"",32);
  if(!seed){return freeze({ok:false,status:"rejected",reason:"campaign-seed-required",seed:null,when:when||null,selectedResponse:null,selectedProposal:null,bounded:true,readOnly:true,proposalOnly:true,authority:authorityFlags()});}
  if(!validWhen(when)){return freeze({ok:false,status:"rejected",reason:"fantasy-time-required",seed,when:when||null,selectedResponse:null,selectedProposal:null,bounded:true,readOnly:true,proposalOnly:true,authority:authorityFlags()});}
  const context=readContext(seed,config);
  const threatResult=parseThreat(context.threat || config.threat || config.threatContext || {});
  if(!threatResult.ok){
    return freeze({ok:false,status:"rejected",reason:threatResult.reason,seed,when,selectedResponse:null,selectedProposal:null,bounded:true,readOnly:true,proposalOnly:true,details:threatResult.details||null,authority:authorityFlags()});
  }
  const threat=threatResult.threat;
  const readiness=normalizedReadiness(context.readiness || config.readiness || {});
  const health=normalizedHealth(context.health || config.health || {});
  const personality=normalizedPersonality(context.profile || config.profile || {});
  const social=normalizedSocial(context.socialState || config.socialState || {});
  const guidance=normalizedGuidance(context.guidance || config.guidance || {});
  const chosen=chooseResponse(seed,when,threat,readiness,personality,social,guidance,health);
  if(!chosen.ok){return freeze({ok:false,status:"deferred",reason:chosen.reason,seed,when,selectedResponse:null,selectedProposal:null,bounded:true,readOnly:true,proposalOnly:true,authority:authorityFlags()});}

  const response=RESPONSES.includes(chosen.response)?chosen.response: "avoid";
  const target=threat.protectedTargetId || threat.targetId;
  const proposal=freeze({
    commandId:"advisor.propose_conflict_response",
    parameters:freeze({
      response,
      threatId:threat.threatId,
      targetId:target,
      protectedTargetId:threat.protectedTargetId||guidance.protectsTargetId||null,
      reason:chosen.reason,
      severity:threat.severity,
      riskScore:threat.riskScore,
      escapeAvailable:threat.escapeAvailable,
      sourceRef:threat.sourceRef,
      authoritativelyGrounded:true
    }),
    source:"protagonist-conflict-response"
  });
  const selectionId="CONFLICT-"+hashText(stable({seed,when,response,threatId:threat.threatId,targetId:target}));
  return freeze({
    version:VERSION,
    ok:true,
    status:"proposal-ready",
    reason:chosen.reason,
    seed,
    when,
    selectedResponse:response,
    selectedProposal:proposal,
    selectionId,
    threat:freeze({
      threatId:threat.threatId,
      severity:threat.severity,
      targetId:threat.targetId,
      protectedTargetId:threat.protectedTargetId||guidance.protectsTargetId||null,
      sourceRef:threat.sourceRef,
      escapeAvailable:threat.escapeAvailable,
      riskScore:threat.riskScore
    }),
    readiness:freeze({score:readiness.score,skillLevel:readiness.skillLevel,role:readiness.role}),
    health:freeze({condition:health.condition,fatigue:health.fatigue,injuryBurden:health.injuryBurden,activeInjuryCount:health.activeInjuryCount}),
    personality:freeze({temperament:personality.temperament,strength:personality.strength,courage:personality.courage,selfPreservationBias:personality.selfPreservationBias}),
    social:freeze({duty:social.duty,relationship:social.relationship,protectionPriority:social.protectionPriority,lawfulness:social.lawfulness}),
    guidance:freeze({dutyLabel:guidance.dutyLabel,protectsTargetId:guidance.protectsTargetId,guardDuty:guidance.guardDuty,avoidConflict:guidance.avoidConflict}),
    reasons:freeze([chosen.reason].slice(0,MAX_REASONS)),
    bounded:true,
    readOnly:true,
    proposalOnly:true,
    directActionExecution:false,
    directWorldMutation:false,
    directPositionMutation:false,
    simulationValidationBypass:false,
    fullWorldScan:false,
    wholeSettlementScan:false,
    wholeHistoryScan:false,
    perFrameScan:false,
    authority:authorityFlags()
  });
}
function evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const result=plain(resultValue)?resultValue:{};
  const options=plain(optionsValue)?optionsValue:{};
  if(result.ok!==true||result.status!=="proposal-ready"||!result.selectedProposal){
    return freeze({ok:false,reason:"selected-conflict-proposal-required",config:null});
  }
  return freeze({ok:true,reason:"proposal-ready",boundary:"ProtagonistCommandEvaluator",executionDisabled:true,config:freeze({seed:result.seed,when:result.when,snapshot:snapshotValue||null,proposal:result.selectedProposal,decisionContext:plain(decisionContextValue)?clone(decisionContextValue):undefined,actorPosition:options.actorPosition?clone(options.actorPosition):undefined,actorId:cleanId(options.actorId||"protagonist",120)||"protagonist",selectionId:result.selectionId,execute:false})});
}
function runtimeInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const handoff=evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue);
  if(!handoff.ok)return handoff;
  const config=handoff.config;
  return freeze({ok:true,reason:"runtime-schedule-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",executionDisabled:true,config:freeze({seed:config.seed,when:config.when,snapshot:config.snapshot,proposal:config.proposal,decisionContext:config.decisionContext,actorPosition:config.actorPosition,actorId:config.actorId,selectionId:config.selectionId})});
}
function schedule(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const options=plain(optionsValue)?optionsValue:{};
  const handoff=runtimeInput(resultValue,snapshotValue,decisionContextValue,options);
  if(!handoff.ok)return handoff;
  const runtime=options.runtime||root?.ProtagonistActionRuntime;
  if(!runtime?.schedule)return freeze({ok:false,reason:"protagonist-action-runtime-unavailable",boundary:handoff.boundary,directActionExecution:false,simulationValidationBypass:false});
  const scheduled=runtime.schedule(handoff.config);
  return freeze({ok:Boolean(scheduled?.ok),reason:scheduled?.reason||"scheduled",scheduled:scheduled||null,boundary:handoff.boundary,directActionExecution:false,simulationValidationBypass:false});
}
return freeze({VERSION,RESPONSES,MAX_REASONS,evaluate,evaluatorInput,runtimeInput,schedule,authority:authorityFlags()});
});
