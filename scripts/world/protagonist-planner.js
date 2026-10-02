(function(){
"use strict";

const VERSION="protagonist-autonomous-planner-v1";
const MAX_CANDIDATES=16;
const MAX_QUEUE=8;
const MAX_REASONS=8;
const MAX_HISTORY=8;
const MAX_TEXT=160;
const CANDIDATE_KINDS=Object.freeze(["goal","action"]);
const CANDIDATE_STATES=Object.freeze(["available","deferred","blocked"]);
const INTERRUPTION_KINDS=Object.freeze(["candidate-invalidated","goal-state-changed","need-state-changed","world-condition-changed","simulation-result","reevaluate"]);
const telemetryState={plans:0,replans:0,restores:0,invalid:0,rejectedCandidates:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function cleanText(value,max=MAX_TEXT){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=MAX_TEXT){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null}
function clamp(value,min,max,fallback){const n=finite(value);return n==null?fallback:Math.max(min,Math.min(max,n))}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestampParts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])};if(p.month<1||p.month>12||p.day<1||p.day>31||p.hour>23||p.minute>59||p.second>59)return null;return p}
function daysFromCivil(year,month,day){const y=year-(month<=2?1:0),era=Math.floor(y/400),yoe=y-era*400,mp=month+(month>2?-3:9),doy=Math.floor((153*mp+2)/5)+day-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function secondIndex(value){const p=timestampParts(value);return p?daysFromCivil(p.year,p.month,p.day)*86400+p.hour*3600+p.minute*60+p.second:null}
function boundedReasons(values){const out=[];for(const raw of Array.isArray(values)?values.slice(0,MAX_REASONS):[]){const v=cleanId(raw,96);if(v&&!out.includes(v))out.push(v)}return out}
function normalizeParameters(value){if(!plain(value))return {};const out={};for(const key of Object.keys(value).sort().slice(0,16)){const cleanKey=cleanId(key,80);if(!cleanKey)continue;const v=value[key];if(v==null||typeof v==="string"||typeof v==="number"||typeof v==="boolean")out[cleanKey]=typeof v==="string"?cleanText(v,160):v}return out}
function normalizeProposal(value){
  if(!plain(value))return null;
  const commandId=cleanId(value.commandId,160);if(!commandId)return null;
  return freeze({proposalId:cleanId(value.proposalId,160)||null,commandId,parameters:freeze(normalizeParameters(value.parameters)),source:cleanId(value.source||"autonomous-planner",80)||"autonomous-planner"});
}
function normalizeCandidate(value,index){
  if(!plain(value))return {ok:false,reason:"candidate-not-object",candidateId:"INVALID-"+index};
  const candidateId=cleanId(value.candidateId||value.id,160);if(!candidateId)return {ok:false,reason:"candidate-id-required",candidateId:"INVALID-"+index};
  const kind=cleanId(value.kind,40).toLowerCase();if(!CANDIDATE_KINDS.includes(kind))return {ok:false,reason:"candidate-kind-invalid",candidateId};
  const state=cleanId(value.state||"available",40).toLowerCase();if(!CANDIDATE_STATES.includes(state))return {ok:false,reason:"candidate-state-invalid",candidateId};
  const priority=finite(value.priority),urgency=finite(value.urgency),suitability=value.suitability==null?50:finite(value.suitability);
  if(priority==null||priority<0||priority>100)return {ok:false,reason:"candidate-priority-invalid",candidateId};
  if(urgency==null||urgency<0||urgency>100)return {ok:false,reason:"candidate-urgency-invalid",candidateId};
  if(suitability==null||suitability<0||suitability>100)return {ok:false,reason:"candidate-suitability-invalid",candidateId};
  const goalId=cleanId(value.goalId,160)||null,proposal=normalizeProposal(value.proposal);
  if(kind==="goal"&&!goalId)return {ok:false,reason:"goal-id-required",candidateId};
  if(kind==="action"&&!proposal)return {ok:false,reason:"action-proposal-required",candidateId};
  return {ok:true,candidate:freeze({
    candidateId,kind,state,goalId,proposal,priority:Number(priority.toFixed(4)),urgency:Number(urgency.toFixed(4)),suitability:Number(suitability.toFixed(4)),
    deferReason:state==="deferred"?(cleanId(value.deferReason||"deferred",96)||"deferred"):null,
    blockedReason:state==="blocked"?(cleanId(value.blockedReason||"blocked",96)||"blocked"):null,
    reasonCodes:freeze(boundedReasons(value.reasonCodes))
  })};
}
function normalizeContext(value){
  const ctx=plain(value)?value:{},dc=plain(ctx.decisionContext)?ctx.decisionContext:plain(ctx)?ctx:{};
  return freeze({
    contextId:cleanId(ctx.contextId,160)||null,
    value:Number(clamp(dc.value,0,1,0.5).toFixed(4)),
    urgency:Number(clamp(dc.urgency,0,1,0.5).toFixed(4)),
    socialAcceptability:Number(clamp(dc.socialAcceptability,0,1,0.5).toFixed(4)),
    dutyConflict:Boolean(dc.dutyConflict),
    reasons:freeze(boundedReasons(ctx.reasons))
  });
}
function normalizeInterruption(value){
  const raw=plain(value)?value:{kind:"reevaluate"},kind=cleanId(raw.kind||"reevaluate",80).toLowerCase();
  if(!INTERRUPTION_KINDS.includes(kind))return {ok:false,reason:"interruption-kind-invalid"};
  return {ok:true,interruption:freeze({kind,candidateId:cleanId(raw.candidateId,160)||null,reasonCode:cleanId(raw.reasonCode||kind,96)||kind})};
}
function candidateScore(seed,when,candidate,context){
  const dutyPenalty=context.dutyConflict&&candidate.kind==="action"?8:0;
  const raw=candidate.priority*0.50+candidate.urgency*0.30+candidate.suitability*0.20-dutyPenalty;
  const tie=parseInt(hashText(stable({seed,when,candidateId:candidate.candidateId,goalId:candidate.goalId,commandId:candidate.proposal?.commandId||null})),16)>>>0;
  return freeze({score:Number(Math.max(0,Math.min(100,raw)).toFixed(4)),tie});
}
function ranked(seed,when,candidates,context){
  return candidates.map(candidate=>({candidate,metric:candidateScore(seed,when,candidate,context)})).sort((a,b)=>
    Number(b.metric.score)-Number(a.metric.score)||Number(a.metric.tie)-Number(b.metric.tie)||a.candidate.candidateId.localeCompare(b.candidate.candidateId)
  );
}
function planSignatureBase(plan){
  const out=clone(plan);delete out.planSignature;return out;
}
function sealPlan(plan){const next=clone(plan);next.planSignature=hashText(stable(planSignatureBase(next)));return freeze(next)}
function invalid(seed,when,reason){telemetryState.invalid++;return freeze({version:VERSION,ok:false,reason,seed:seed||null,when:when||null,planId:null,selectionId:null,selectionState:"invalid",selectedCandidate:null,selectedProposal:null,queue:freeze([]),rejectedCandidates:freeze([]),bounded:true,directActionExecution:false,worldMutation:false})}
function buildPlan(configValue,previousPlanValue,interruptionValue){
  const config=plain(configValue)?configValue:{},seed=cleanText(config.seed,160),when=cleanText(config.when,32);
  if(!seed)return invalid(seed,when,"campaign-seed-required");
  if(!validWhen(when))return invalid(seed,when,"fantasy-time-required");
  const supplied=Array.isArray(config.candidates)?config.candidates:[];
  if(supplied.length>MAX_CANDIDATES)return invalid(seed,when,"candidate-limit-exceeded");
  const seen=new Set(),valid=[],rejected=[];
  for(let i=0;i<supplied.length;i++){
    const normalized=normalizeCandidate(supplied[i],i);
    if(!normalized.ok){telemetryState.rejectedCandidates++;rejected.push(freeze({candidateId:normalized.candidateId,reason:normalized.reason}));continue}
    if(seen.has(normalized.candidate.candidateId)){telemetryState.rejectedCandidates++;rejected.push(freeze({candidateId:normalized.candidate.candidateId,reason:"candidate-id-duplicate"}));continue}
    seen.add(normalized.candidate.candidateId);valid.push(normalized.candidate);
  }
  const context=normalizeContext(config.context),previous=previousPlanValue||null;
  if(previous){
    if(previous.ok!==true||previous.version!==VERSION||previous.seed!==seed)return invalid(seed,when,"previous-plan-incompatible");
    if(secondIndex(when)<secondIndex(previous.when))return invalid(seed,when,"cannot-rewind-plan-chronology");
  }
  const interruptionCheck=normalizeInterruption(interruptionValue);
  if(!interruptionCheck.ok)return invalid(seed,when,interruptionCheck.reason);
  const interruption=interruptionCheck.interruption,rankedRows=ranked(seed,when,valid,context);
  const available=rankedRows.filter(row=>row.candidate.state==="available"),deferred=rankedRows.filter(row=>row.candidate.state==="deferred");
  const selected=available[0]||null;
  const selectionState=selected?"selected":(deferred.length?"deferred":"noop");
  const queueRows=rankedRows.slice(0,MAX_QUEUE).map((row,index)=>freeze({
    queueIndex:index,candidateId:row.candidate.candidateId,kind:row.candidate.kind,state:row.candidate.state,goalId:row.candidate.goalId,
    score:row.metric.score,reasonCodes:row.candidate.reasonCodes,deferReason:row.candidate.deferReason,blockedReason:row.candidate.blockedReason,
    proposal:row.candidate.proposal
  }));
  const history=previous?[...(Array.isArray(previous.historyPlanIds)?previous.historyPlanIds:[]),previous.planId].filter(Boolean).slice(-MAX_HISTORY):[];
  const planBasis={
    seed,when,previousPlanId:previous?.planId||null,interruption,context,
    candidates:valid,selectionState,selectedCandidateId:selected?.candidate.candidateId||null,
    historyPlanIds:history,rejectedCandidates:rejected
  };
  const planId="PLAN-"+hashText(stable(planBasis)),selectionId=selected?"SEL-"+hashText(stable({planId,candidateId:selected.candidate.candidateId,when,seed})):null;
  const reasons=[];
  if(selected){reasons.push("highest-ranked-available");if(context.dutyConflict&&selected.candidate.kind==="action")reasons.push("duty-conflict-penalty-applied")}
  else if(deferred.length)reasons.push("no-available-candidate","deferred-candidates-remain");
  else reasons.push(valid.length?"all-candidates-blocked":"no-valid-candidates");
  if(previous)reasons.push("replan-"+interruption.kind);
  const plan=sealPlan({
    version:VERSION,ok:true,seed,when,planId,selectionId,selectionState,previousPlanId:previous?.planId||null,
    interruptedSelectionId:previous&&interruption.kind!=="reevaluate"?previous.selectionId||null:null,
    interruption,context,selectedCandidate:selected?selected.candidate:null,selectedProposal:selected?.candidate.proposal||null,
    queue:freeze(queueRows),rejectedCandidates:freeze(rejected.slice(0,MAX_CANDIDATES)),reasons:freeze(boundedReasons(reasons)),
    historyPlanIds:freeze(history),chronologyDepth:history.length,bounded:true,
    bounds:freeze({maxCandidates:MAX_CANDIDATES,maxQueue:MAX_QUEUE,maxReasons:MAX_REASONS,maxHistory:MAX_HISTORY}),
    handoff:freeze({boundary:"ProtagonistCommandEvaluator",proposalOnly:true,requiresEvaluatorValidation:Boolean(selected?.candidate.proposal),directExecution:false}),
    authority:freeze({determinism:"Campaign SEED + Fantasy Game Time + supplied bounded candidate/context state",directActionExecution:false,worldMutation:false,positionMutation:false,teleportation:false,routePlanning:false,simulationValidationBypass:false,fullWorldScan:false,perFrameScan:false,providerAuthority:false,presentationAuthority:false})
  });
  return plan;
}
function plan(configValue){telemetryState.plans++;return buildPlan(configValue,null,{kind:"reevaluate"})}
function replan(configValue){
  telemetryState.replans++;
  const config=plain(configValue)?configValue:{},previousRaw=config.previousPlan;
  let previous=previousRaw;
  if(typeof previousRaw==="string"){const restored=restore(previousRaw);if(!restored.ok)return invalid(cleanText(config.seed,160),cleanText(config.when,32),restored.reason);previous=restored.plan}
  if(!previous||previous.ok!==true)return invalid(cleanText(config.seed,160),cleanText(config.when,32),"previous-plan-required");
  return buildPlan(config,previous,config.interruption||{kind:"reevaluate"});
}
function serialize(planValue){if(!planValue||planValue.ok!==true||planValue.version!==VERSION)return null;return stable(planValue)}
function restore(serializedValue){
  telemetryState.restores++;
  let parsed;try{parsed=typeof serializedValue==="string"?JSON.parse(serializedValue):clone(serializedValue)}catch(_){return freeze({ok:false,reason:"plan-serialization-invalid",plan:null})}
  if(!plain(parsed)||parsed.version!==VERSION||parsed.ok!==true||!/^PLAN-[0-9A-F]{8}$/.test(String(parsed.planId||""))||!validWhen(parsed.when)||!parsed.seed)return freeze({ok:false,reason:"plan-shape-invalid",plan:null});
  if(!Array.isArray(parsed.queue)||parsed.queue.length>MAX_QUEUE||!Array.isArray(parsed.historyPlanIds)||parsed.historyPlanIds.length>MAX_HISTORY||!Array.isArray(parsed.rejectedCandidates)||parsed.rejectedCandidates.length>MAX_CANDIDATES)return freeze({ok:false,reason:"plan-bounds-invalid",plan:null});
  const expected=hashText(stable(planSignatureBase(parsed)));if(parsed.planSignature!==expected)return freeze({ok:false,reason:"plan-signature-mismatch",plan:null});
  return freeze({ok:true,reason:"ok",plan:freeze(parsed)});
}
function evaluatorInput(planValue,snapshotValue,decisionContextValue){
  const restored=typeof planValue==="string"?restore(planValue):{ok:true,plan:planValue};
  const planResult=restored?.plan;
  if(!restored?.ok||!planResult?.ok||!planResult.selectedProposal)return freeze({ok:false,reason:"selected-executable-proposal-required",config:null});
  return freeze({ok:true,reason:"proposal-ready",config:freeze({seed:planResult.seed,when:planResult.when,snapshot:snapshotValue||null,proposal:planResult.selectedProposal,decisionContext:decisionContextValue||planResult.context,execute:false}),boundary:"ProtagonistCommandEvaluator",executionDisabled:true});
}
function telemetry(){return freeze({...telemetryState,fullWorldScan:false,perFrameScan:false,authority:false,bounded:true})}

root().ProtagonistPlanner=Object.freeze({VERSION,MAX_CANDIDATES,MAX_QUEUE,MAX_REASONS,MAX_HISTORY,CANDIDATE_KINDS,CANDIDATE_STATES,INTERRUPTION_KINDS,plan,replan,serialize,restore,evaluatorInput,telemetry});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistPlanner;
})();