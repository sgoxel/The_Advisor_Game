(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistConflictResponse=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-conflict-response-v2";
const MAX_REASONS=12;
const MAX_GOALS=8;
const MAX_GUIDANCE=6;
const MAX_PROPOSAL_PARAMETERS=16;
const MAX_TARGET_LENGTH=180;
const MAX_RESULT_BYTES=49152;
const RESPONSES=Object.freeze(["avoid","fight","defend","protect","yield","retreat"]);
const SEVERITY_WEIGHTS=Object.freeze({minor:18,moderate:32,serious:48,critical:64,overwhelming:80});
const UNTRUSTED_SOURCE_KINDS=Object.freeze(["ui","advisor","llm","provider","render","camera","viewport","device"]);
const telemetryState={evaluations:0,liveBuilds:0,profileReads:0,needsReads:0,healthReads:0,goalReads:0,socialReads:0,authorityReads:0,guidanceReads:0,runtimeSchedules:0,invalid:0};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null}
function clamp(value,min,max,fallback){const n=finite(value);return n==null?fallback:Math.max(min,Math.min(max,n))}
function clamp01(value,fallback){const n=finite(value);if(n==null)return fallback;if(n>=0&&n<=1)return n;if(n>=0&&n<=100)return n/100;if(n>=0&&n<=100000)return n/100000;return Math.max(0,Math.min(1,n))}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;return text.length}
function pushUnique(list,value){const v=cleanId(value,120);if(v&&!list.includes(v)&&list.length<MAX_REASONS)list.push(v)}
function sourceRef(value){if(!plain(value))return null;const kind=cleanId(value.kind||value.type,64).toLowerCase(),id=cleanId(value.id||value.refId||value.entityId,MAX_TARGET_LENGTH);return kind&&id?freeze({kind,id}):null}
function isTrustedSource(ref){return Boolean(ref&&ref.id&&ref.kind&&!UNTRUSTED_SOURCE_KINDS.includes(String(ref.kind).toLowerCase()))}
function authorityFlags(){return freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded Stage 1-13 authority context + supplied validated threat/readiness",protagonistDecisionAuthority:true,proposalOnly:true,selectionEventDriven:true,directCombatResolution:false,directActionExecution:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,resourceFabrication:false,targetFabrication:false,simulationValidationBypass:false,healthAuthority:false,inventoryAuthority:false,relationshipAuthority:false,rankAuthority:false,threatAuthority:false,readinessAuthority:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,providerAuthority:false,presentationAuthority:false})}
function invalid(seed,when,reason,extra){telemetryState.invalid++;return freeze({version:VERSION,ok:false,status:"rejected",reason,seed:seed||null,when:when||null,selectedResponse:null,selectedProposal:null,selectionId:null,bounded:true,proposalOnly:true,requiresRuntime:false,authority:authorityFlags(),...(extra||{})})}

function normalizeThreat(value){
  const raw=plain(value)?value:{},threatId=cleanId(raw.threatId||raw.id,MAX_TARGET_LENGTH),targetId=cleanId(raw.targetId||raw.target||raw.personId||raw.placeId,MAX_TARGET_LENGTH),severity=cleanId(raw.severity||raw.level,32).toLowerCase(),source=sourceRef(raw.sourceRef||raw.source);
  if(!threatId)return {ok:false,reason:"grounded-threat-required"};
  if(!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHTS,severity))return {ok:false,reason:"threat-severity-required"};
  if(!targetId)return {ok:false,reason:"factual-target-required"};
  if(raw.validated!==true&&raw.authoritative!==true&&raw.grounded!==true)return {ok:false,reason:"validated-threat-evidence-required"};
  if(!isTrustedSource(source))return {ok:false,reason:"trusted-threat-source-required"};
  const protectedTargetId=cleanId(raw.protectedTargetId||raw.guardTargetId,MAX_TARGET_LENGTH)||null;
  return {ok:true,value:freeze({threatId,targetId,protectedTargetId,severity,sourceRef:source,escapeAvailable:raw.escapeAvailable===true,riskScore:clamp(raw.riskScore,0,100,SEVERITY_WEIGHTS[severity]),known:raw.known!==false})};
}
function normalizeReadiness(value){
  const raw=plain(value)?value:{};
  return freeze({validated:raw.validated===true||raw.authoritative===true||raw.grounded===true,score:clamp(raw.readinessScore??raw.score,0,100,50),skillLevel:clamp(raw.skillLevel??raw.martialSkill?.level,0,10,1),equipmentKnown:raw.equipmentKnown!==false});
}
function normalizeHealth(value){
  const raw=plain(value)?value:{},injuries=Array.isArray(raw.injuries)?raw.injuries:[];
  return freeze({condition:clamp(raw.conditionMilli??raw.condition,0,100000,90000),fatigue:clamp(raw.fatigueMilli??raw.fatigue,0,100000,15000),injuryBurden:clamp(raw.injuryBurdenMilli??raw.injuryBurden,0,100000,0),activeInjuryCount:Math.max(0,Math.min(12,Math.round(finite(raw.activeInjuryCount)??injuries.length))),mobilityBlocked:Boolean(raw.mobilityBlocked||raw.incapacitated)});
}
function normalizeTraits(value){
  const raw=plain(value?.personality?.traits)?value.personality.traits:plain(value?.traits)?value.traits:plain(value)?value:{};
  return freeze({resolve:clamp01(raw.resolve,.5),caution:clamp01(raw.caution,.5),empathy:clamp01(raw.empathy,.5),ambition:clamp01(raw.ambition,.5)});
}
function normalizeNeeds(value){
  const raw=plain(value?.pressureMilli)?value.pressureMilli:plain(value?.pressures)?value.pressures:plain(value)?value:{};
  return freeze({hunger:clamp01(raw.hunger,0),fatigue:clamp01(raw.fatigue,0),safety:clamp01(raw.safety,0),social:clamp01(raw.social,0)});
}
function normalizeGoals(value){
  const rows=Array.isArray(value?.records)?value.records:Array.isArray(value?.goals)?value.goals:Array.isArray(value)?value:[],out=[];
  for(const row of rows){if(out.length>=MAX_GOALS)break;const id=cleanId(row?.id||row?.goalId,160),status=cleanId(row?.status||"active",32).toLowerCase();if(!id||status!=="active")continue;out.push(freeze({id,priority:clamp(row?.priority,0,100,50),targetId:cleanId(row?.targetId||row?.personId,MAX_TARGET_LENGTH)||null,kind:cleanId(row?.kind||row?.type||row?.topic,80).toLowerCase()}))}
  return freeze(out);
}
function normalizeAuthority(value){
  const raw=plain(value)?value:{},current=plain(raw.currentRole)?raw.currentRole:raw,scopes=[];
  for(const item of Array.isArray(current.scopes)?current.scopes:[]){const id=cleanId(item,120);if(id&&!scopes.includes(id)&&scopes.length<16)scopes.push(id)}
  return freeze({available:Boolean(raw.available!==false&&(current.roleId||raw.roleId||scopes.length)),roleId:cleanId(current.roleId||raw.roleId,80)||null,rankTier:clamp(current.rankTier??raw.rankTier,0,10,0),scopes:freeze(scopes)});
}
function normalizeSocial(value,targetId){
  const raw=plain(value?.values)?value.values:plain(value?.relationship?.values)?value.relationship.values:plain(value?.relationship)?value.relationship:plain(value)?value:{};
  return freeze({targetId:cleanId(value?.targetId||value?.subject?.id||targetId,MAX_TARGET_LENGTH)||null,trust:clamp01(raw.trust,.5),respect:clamp01(raw.respect,.5),loyalty:clamp01(raw.loyalty,.35),fear:clamp01(raw.fear,.1),resentment:clamp01(raw.resentment,.1),duty:clamp01(value?.duty??value?.dutyLevel,0),protectionPriority:clamp01(value?.protectionPriority??value?.protection,0)});
}
function normalizeGuidance(value,targetId){
  const rows=Array.isArray(value)?value:Array.isArray(value?.records)?value.records:[],out={avoidConflict:false,protectsTargetId:null,dutyLabel:"",matchedIds:[]};
  if(plain(value)&&!rows.length){out.avoidConflict=Boolean(value.avoidConflict||value.avoid);out.protectsTargetId=cleanId(value.protectsTargetId||value.protectedTargetId,MAX_TARGET_LENGTH)||null;out.dutyLabel=clean(value.duty||value.dutyLabel||"",80)}
  for(const row of rows.slice(0,MAX_GUIDANCE)){const stance=cleanId(row?.stance,32).toLowerCase();if(stance==="avoid"||stance==="caution")out.avoidConflict=true;const id=cleanId(row?.id,160);if(id)out.matchedIds.push(id);const possible=cleanId(row?.protectsTargetId||row?.targetId,MAX_TARGET_LENGTH);if(possible&&possible===targetId)out.protectsTargetId=possible;if(!out.dutyLabel)out.dutyLabel=clean(row?.topic||row?.principle||"",80)}
  return freeze({...out,matchedIds:freeze(out.matchedIds)});
}
function normalizeProposal(value){
  if(!plain(value))return null;
  if(value.grounded!==true&&value.authoritativelyGrounded!==true&&value.validated!==true)return null;
  const commandId=cleanId(value.commandId,160);if(!commandId)return null;
  const source=cleanId(value.source||"protagonist-conflict-response",100)||"protagonist-conflict-response";
  const rawParams=plain(value.parameters)?value.parameters:plain(value.validatedParameters)?value.validatedParameters:{},keys=Object.keys(rawParams);
  if(keys.length>MAX_PROPOSAL_PARAMETERS)return null;
  const params={};
  for(const key of keys.sort()){const k=cleanId(key,80);if(!k)continue;const item=rawParams[key];if(item==null||typeof item==="string"||typeof item==="number"||typeof item==="boolean")params[k]=typeof item==="string"?clean(item,180):item;else return null}
  return freeze({proposalId:cleanId(value.proposalId,160)||null,commandId,parameters:freeze(params),source});
}
function proposalFor(response,config){
  const map=plain(config.responseProposals)?config.responseProposals:plain(config.proposals)?config.proposals:{};
  return normalizeProposal(map[response]);
}
function commitmentContext(goals,needs){
  const high=goals.filter(g=>g.priority>=80),urgentNeed=Math.max(needs.hunger,needs.fatigue,needs.safety)>=.78;
  return freeze({highPriorityGoalCount:high.length,urgentNeed,goalIds:freeze(high.map(g=>g.id))});
}
function choose(context){
  const {seed,when,threat,readiness,health,traits,needs,goals,social,guidance,authority}=context,reasons=[];
  const conditionBad=health.mobilityBlocked||health.condition<35000||health.fatigue>72000||health.activeInjuryCount>1;
  const immediateRisk=Math.max(SEVERITY_WEIGHTS[threat.severity],threat.riskScore)+(health.fatigue>60000?10:0)+(health.activeInjuryCount?8:0)+(needs.safety>=.75?8:0)-readiness.score*.22;
  const risk=Math.max(0,Math.min(100,immediateRisk));
  const targetRelationshipMatches=Boolean(threat.protectedTargetId&&social.targetId===threat.protectedTargetId);
  const goalProtects=Boolean(threat.protectedTargetId&&goals.some(g=>g.targetId===threat.protectedTargetId&&g.priority>=70));
  const strongRelationship=targetRelationshipMatches&&((social.trust+social.respect+social.loyalty)/3>=.62);
  const groundedProtection=Boolean(threat.protectedTargetId&&(strongRelationship||social.duty>=.7||social.protectionPriority>=.75||guidance.protectsTargetId===threat.protectedTargetId||goalProtects));
  const lawfulProtection=groundedProtection&&(authority.available||social.duty>=.7||goalProtects);
  const severe=SEVERITY_WEIGHTS[threat.severity]>=48||risk>=58;
  const strongReadiness=readiness.validated&&readiness.score>=70;
  const moderateReadiness=readiness.validated&&readiness.score>=55;
  if(lawfulProtection&&!conditionBad&&health.condition>30000){pushUnique(reasons,"grounded-protection-duty");return {response:"protect",reason:"grounded-protection-duty",risk,reasons}}
  if((conditionBad||risk>=80)&&threat.escapeAvailable){pushUnique(reasons,"self-preservation-retreat");return {response:"retreat",reason:"self-preservation-retreat",risk,reasons}}
  if((conditionBad||risk>=80)&&!threat.escapeAvailable){pushUnique(reasons,"overwhelming-risk-yield");return {response:"yield",reason:"overwhelming-risk-yield",risk,reasons}}
  if(risk>=70&&!strongReadiness){pushUnique(reasons,"risk-exceeds-readiness");return {response:threat.escapeAvailable?"retreat":"avoid",reason:"risk-exceeds-readiness",risk,reasons}}
  if(strongReadiness&&severe&&!conditionBad){pushUnique(reasons,"capable-grounded-defense");return {response:"defend",reason:"capable-grounded-defense",risk,reasons}}
  if(moderateReadiness&&["moderate","serious"].includes(threat.severity)&&health.condition>45000&&!guidance.avoidConflict){pushUnique(reasons,"capable-grounded-fight");return {response:"fight",reason:"capable-grounded-fight",risk,reasons}}
  if(guidance.avoidConflict||needs.safety>=.65||traits.caution>=.72){pushUnique(reasons,"cautious-avoidance");return {response:"avoid",reason:"cautious-avoidance",risk,reasons}}
  const tie=parseInt(hashText(stable({seed,when,threatId:threat.threatId,targetId:threat.targetId,resolve:traits.resolve,caution:traits.caution})),16)>>>0;
  const response=moderateReadiness&&tie%2===0?"defend":"avoid";
  pushUnique(reasons,response==="defend"?"bounded-defensive-choice":"bounded-safe-choice");
  return {response,reason:reasons[0],risk,reasons};
}
function evaluate(configValue){
  telemetryState.evaluations++;
  const config=plain(configValue)?configValue:{},seed=clean(config.seed||config.campaignSeed,160),when=clean(config.when||config.fantasyTimestamp,32);
  if(!seed)return invalid(seed,when,"campaign-seed-required");
  if(!validWhen(when))return invalid(seed,when,"fantasy-time-required");
  const threatResult=normalizeThreat(config.threat||config.threatContext);if(!threatResult.ok)return invalid(seed,when,threatResult.reason);
  const threat=threatResult.value,readiness=normalizeReadiness(config.readiness),health=normalizeHealth(config.health),traits=normalizeTraits(config.profile),needs=normalizeNeeds(config.needs),goals=normalizeGoals(config.goals),authority=normalizeAuthority(config.authority),social=normalizeSocial(config.socialState,threat.protectedTargetId),guidance=normalizeGuidance(config.guidance,threat.protectedTargetId);
  const chosen=choose({seed,when,threat,readiness,health,traits,needs,goals,authority,social,guidance});
  const selectedResponse=RESPONSES.includes(chosen.response)?chosen.response:"avoid",selectedProposal=proposalFor(selectedResponse,config),status=selectedProposal?"proposal-ready":"proposal-only";
  const selectionId="CONFLICT-"+hashText(stable({seed,when,threatId:threat.threatId,targetId:threat.targetId,response:selectedResponse}));
  const result={version:VERSION,ok:true,status,reason:chosen.reason,seed,when,selectedResponse,selectedProposal,selectionId,requiresRuntime:Boolean(selectedProposal),threat,readiness,health,needs,goalContext:commitmentContext(goals,needs),authorityContext:authority,socialContext:social,guidanceContext:guidance,riskScore:Number(chosen.risk.toFixed(4)),reasons:freeze(chosen.reasons.slice(0,MAX_REASONS)),handoff:freeze({boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",proposalOnly:true,requiresRuntimeValidation:Boolean(selectedProposal),directEvaluatorHandoff:false,directActionExecution:false}),bounded:true,proposalOnly:true,authority:authorityFlags()};
  const serializedBytes=utf8Bytes(stable(result));if(serializedBytes>MAX_RESULT_BYTES)return invalid(seed,when,"result-byte-budget-exceeded",{maxResultBytes:MAX_RESULT_BYTES});
  return freeze({...result,serializedBytes,bounds:freeze({maxReasons:MAX_REASONS,maxGoals:MAX_GOALS,maxGuidance:MAX_GUIDANCE,maxProposalParameters:MAX_PROPOSAL_PARAMETERS,maxResultBytes:MAX_RESULT_BYTES})});
}
function fromLive(seedValue,whenValue,optionsValue){
  telemetryState.liveBuilds++;
  const seed=clean(seedValue,160),when=clean(whenValue,32),options=plain(optionsValue)?optionsValue:{},identity=cleanId(options.identityKey||"protagonist",96)||"protagonist",threat=options.threat||options.threatContext;
  const protectedTargetId=cleanId(threat?.protectedTargetId||threat?.guardTargetId,MAX_TARGET_LENGTH)||null;
  let profile=null,needs=null,health=null,goals=null,authority=null,socialState=plain(options.socialState)?clone(options.socialState):null,guidance=plain(options.guidance)||Array.isArray(options.guidance)?clone(options.guidance):null;
  try{telemetryState.profileReads++;profile=root?.ProtagonistProfile?.summary?.(seed,identity)||root?.ProtagonistProfile?.derive?.(seed,identity)||null}catch(_){}
  try{telemetryState.needsReads++;needs=root?.ProtagonistNeeds?.snapshot?.(seed,identity)||null}catch(_){}
  try{telemetryState.healthReads++;health=root?.ProtagonistHealth?.decisionContext?.(seed,identity)||root?.ProtagonistHealth?.snapshot?.(seed,identity)||null}catch(_){}
  try{telemetryState.goalReads++;goals=root?.ProtagonistGoals?.list?.(seed,{status:"active",limit:MAX_GOALS},identity)||root?.ProtagonistGoals?.snapshot?.(seed,identity)||null}catch(_){}
  try{telemetryState.authorityReads++;authority=root?.ProtagonistAuthority?.decisionContext?.(seed,identity)||root?.ProtagonistAuthority?.snapshot?.(seed,identity)||null}catch(_){}
  if(!socialState&&protectedTargetId){try{telemetryState.socialReads++;socialState=root?.SocialState?.relationship?.(seed,{kind:"protagonist",id:"protagonist"},{kind:"resident",id:protectedTargetId})||null;if(plain(socialState))socialState={...clone(socialState),targetId:protectedTargetId}}catch(_){}}
  if(!guidance){try{telemetryState.guidanceReads++;guidance=root?.ProtagonistGuidance?.relevant?.(seed,{topic:"conflict",riskBand:cleanId(threat?.severity,32),activityKind:"security"},{limit:MAX_GUIDANCE},identity)||[]}catch(_){}}
  return evaluate({seed,when,threat,readiness:options.readiness,profile,needs,health,goals,authority,socialState,guidance,responseProposals:options.responseProposals||options.proposals});
}
function runtimeInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const result=plain(resultValue)?resultValue:{},options=plain(optionsValue)?optionsValue:{};
  if(result.ok!==true||result.status!=="proposal-ready"||!result.selectedProposal)return freeze({ok:false,reason:"grounded-executable-proposal-required",config:null});
  if(!snapshotValue)return freeze({ok:false,reason:"bounded-command-snapshot-required",config:null});
  return freeze({ok:true,reason:"runtime-schedule-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",config:freeze({seed:result.seed,when:result.when,dueWhen:result.when,snapshot:snapshotValue,proposal:result.selectedProposal,decisionContext:plain(decisionContextValue)?clone(decisionContextValue):undefined,actorPosition:options.actorPosition?clone(options.actorPosition):undefined,actorId:cleanId(options.actorId||"protagonist",120)||"protagonist",selectionId:result.selectionId})});
}
function schedule(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const options=plain(optionsValue)?optionsValue:{},handoff=runtimeInput(resultValue,snapshotValue,decisionContextValue,options);
  if(!handoff.ok)return handoff;
  const runtime=options.runtime||root?.ProtagonistActionRuntime;if(!runtime?.schedule)return freeze({ok:false,reason:"protagonist-action-runtime-unavailable",boundary:handoff.boundary,directActionExecution:false,simulationValidationBypass:false});
  telemetryState.runtimeSchedules++;const scheduled=runtime.schedule(handoff.config);
  return freeze({ok:Boolean(scheduled?.ok),reason:scheduled?.reason||scheduled?.attempt?.reason||"runtime-schedule-result",boundary:handoff.boundary,directActionExecution:false,simulationValidationBypass:false,runtimeResult:scheduled||null});
}
function telemetry(){return freeze({...clone(telemetryState),maxReasons:MAX_REASONS,maxGoals:MAX_GOALS,maxGuidance:MAX_GUIDANCE,maxResultBytes:MAX_RESULT_BYTES,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,authority:false,bounded:true})}

return freeze({VERSION,RESPONSES,MAX_REASONS,MAX_GOALS,MAX_GUIDANCE,MAX_RESULT_BYTES,evaluate,fromLive,runtimeInput,schedule,telemetry,authority:authorityFlags()});
});
