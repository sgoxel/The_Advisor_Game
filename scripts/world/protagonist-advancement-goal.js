(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistAdvancementGoal=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-advancement-goal-v1";
const MAX_OPPORTUNITIES=12;
const MAX_GOALS=8;
const MAX_OBLIGATIONS=8;
const MAX_SCOPES=16;
const MAX_REASONS=12;
const MAX_PROPOSAL_PARAMETERS=16;
const MAX_RESULT_BYTES=49152;
const DECISIONS=Object.freeze(["pursue","defer","reject","maintain-current-role"]);
const ALLOWED_KINDS=Object.freeze(["promotion","appointment","patronage","training","service","career","other"]);
const telemetryState={evaluations:0,liveBuilds:0,socialReads:0,profileReads:0,needsReads:0,healthReads:0,goalReads:0,authorityReads:0,employmentReads:0,wealthReads:0,runtimeSchedules:0,invalid:0,pursues:0,defers:0,rejects:0,maintains:0};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null}
function clamp01(value,fallback=0){const n=finite(value);if(n==null)return fallback;if(n>=0&&n<=1)return n;if(n>=0&&n<=100)return n/100;if(n>=0&&n<=100000)return n/100000;return Math.max(0,Math.min(1,n))}
function clamp100(value,fallback=50){const n=finite(value);return n==null?fallback:Math.max(0,Math.min(100,n))}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function parts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function secondIndex(value){const p=parts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null}
function uniqueIds(values,max=MAX_REASONS){const out=[];for(const raw of Array.isArray(values)?values:[]){const id=cleanId(raw,160);if(id&&!out.includes(id)){out.push(id);if(out.length>=max)break}}return freeze(out)}
function invalid(seed,when,reason,extra){
  telemetryState.invalid++;
  return freeze({version:VERSION,ok:false,seed:seed||null,when:when||null,status:"invalid",disposition:"invalid",reason,decisionId:null,selectedOpportunity:null,selectedProposal:null,evaluated:freeze([]),bounded:true,requiresRuntime:false,...(extra||{}),authority:authorityMarkers()});
}
function authorityMarkers(){return freeze({determinism:"Campaign SEED + Fantasy Game Time + bounded Stage 1-12 authority context + supplied grounded opportunities",proposalOnly:true,selectionEventDriven:true,directActionExecution:false,directWorldMutation:false,directRankMutation:false,directSkillMutation:false,directRelationshipMutation:false,directWealthMutation:false,directEmploymentMutation:false,appointmentAuthority:false,opportunityCreation:false,simulationValidationBypass:false,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,providerAuthority:false,presentationAuthority:false})}

function normalizeTraits(value){
  const raw=plain(value?.traits)?value.traits:plain(value?.personality?.traits)?value.personality.traits:plain(value)?value:{};
  return freeze({resolve:clamp01(raw.resolve,.5),curiosity:clamp01(raw.curiosity,.5),caution:clamp01(raw.caution,.5),ambition:clamp01(raw.ambition,.5),empathy:clamp01(raw.empathy,.5),sociability:clamp01(raw.sociability,.5)});
}
function normalizeNeeds(value){
  const raw=plain(value?.pressureMilli)?value.pressureMilli:plain(value?.pressures)?value.pressures:plain(value)?value:{};
  return freeze({hunger:clamp01(raw.hunger,0),fatigue:clamp01(raw.fatigue,0),safety:clamp01(raw.safety,0),social:clamp01(raw.social,0)});
}
function normalizeHealth(value){
  const raw=plain(value)?value:{};
  const condition=raw.conditionMilli!=null?clamp01(raw.conditionMilli,.75):raw.condition!=null?clamp01(raw.condition,.75):raw.conditionScore!=null?Math.max(0,Math.min(1,Number(raw.conditionScore)/10)):.75;
  const fatigue=raw.fatigueMilli!=null?clamp01(raw.fatigueMilli,.2):clamp01(raw.fatigue,.2);
  return freeze({condition,fatigue,mobilityBlocked:Boolean(raw.mobilityBlocked||raw.incapacitated)});
}
function normalizeGoals(value){
  const rows=Array.isArray(value?.records)?value.records:Array.isArray(value?.goals)?value.goals:Array.isArray(value)?value:[];
  const out=[];
  for(const row of rows){
    const id=cleanId(row?.id||row?.goalId,160);if(!id)continue;
    const status=cleanId(row?.status||"active",40).toLowerCase();
    if(status!=="active")continue;
    out.push(freeze({id,priority:clamp100(row?.priority,50),topic:clean(row?.topic||row?.title||row?.goal,120)}));
  }
  return freeze(out);
}
function normalizeAuthority(value){
  if(!plain(value))return freeze({available:false,roleId:null,rankTier:0,scopes:freeze([])});
  const current=plain(value.currentRole)?value.currentRole:value;
  const scopes=uniqueIds(Array.isArray(current.scopes)?current.scopes:Array.isArray(value.scopes)?value.scopes:[],MAX_SCOPES);
  const rank=finite(current.rankTier!=null?current.rankTier:value.rankTier);
  return freeze({available:true,roleId:cleanId(current.roleId||value.roleId,80)||null,rankTier:rank==null?0:rank,scopes});
}
function normalizeEmployment(value){
  if(!plain(value))return freeze({available:false,status:"none",contract:null});
  const contract=plain(value.contract)?clone(value.contract):null;
  return freeze({available:true,status:cleanId(value.status||contract?.status||"none",32).toLowerCase()||"none",contract:contract?freeze(contract):null});
}
function normalizeWealth(value){
  if(!plain(value))return freeze({available:false,balanceCopper:null,reserveCopper:null});
  const balance=finite(value.balanceCopper!=null?value.balanceCopper:value.balance);
  const reserve=finite(value.reserveCopper);
  return freeze({available:true,balanceCopper:balance==null?null:Math.max(0,Math.floor(balance)),reserveCopper:reserve==null?null:Math.max(0,Math.floor(reserve))});
}
function normalizeObligations(value){
  const rows=Array.isArray(value?.obligations)?value.obligations:Array.isArray(value)?value:[];
  const out=[];
  for(const row of rows){
    const id=cleanId(row?.obligationId||row?.id,160);if(!id)continue;
    out.push(freeze({id,state:cleanId(row?.state||"active",40).toLowerCase()||"active",priority:clamp100(row?.priority,50),kind:cleanId(row?.kind||row?.type||"commitment",80).toLowerCase()}));
  }
  return freeze(out);
}
function normalizeRelationship(value){
  const raw=plain(value?.values)?value.values:plain(value?.relationship?.values)?value.relationship.values:plain(value?.relationship)?value.relationship:plain(value)?value:{};
  return freeze({trust:clamp01(raw.trust,.5),respect:clamp01(raw.respect,.5),suspicion:clamp01(raw.suspicion,.2),fear:clamp01(raw.fear,.1),loyalty:clamp01(raw.loyalty,.35),resentment:clamp01(raw.resentment,.1)});
}
function normalizeSourceRef(raw){
  const ref=plain(raw?.sourceRef)?raw.sourceRef:plain(raw?.sourceNpcRef)?raw.sourceNpcRef:plain(raw?.groundingRef)?raw.groundingRef:null;
  const id=cleanId(ref?.id||ref?.refId||raw?.sourceNpcId||raw?.sponsorId||raw?.counterpartId,160);
  if(!id)return null;
  return freeze({kind:cleanId(ref?.kind||"resident",60).toLowerCase()||"resident",id});
}
function normalizeProposal(value){
  if(!plain(value))return {ok:false,reason:"proposal-required",proposal:null};
  const commandId=cleanId(value.commandId,160);if(!commandId)return {ok:false,reason:"proposal-command-required",proposal:null};
  const rawParams=plain(value.validatedParameters)?value.validatedParameters:plain(value.parameters)?value.parameters:{};
  const keys=Object.keys(rawParams);
  if(keys.length>MAX_PROPOSAL_PARAMETERS)return {ok:false,reason:"proposal-parameter-limit-exceeded",proposal:null};
  const params={};
  for(const key of keys.sort()){
    const cleanKey=cleanId(key,80);if(!cleanKey)continue;
    const item=rawParams[key];
    if(item==null||typeof item==="string"||typeof item==="number"||typeof item==="boolean")params[cleanKey]=typeof item==="string"?clean(item,160):item;
    else return {ok:false,reason:"proposal-parameter-invalid",proposal:null};
  }
  const proposal=freeze({proposalId:cleanId(value.proposalId,160)||null,commandId,parameters:freeze(params),source:cleanId(value.source||"protagonist-advancement-goal",100)||"protagonist-advancement-goal"});
  return {ok:true,reason:"ok",proposal};
}
function normalizeOpportunity(value,index){
  if(!plain(value))return freeze({ok:false,index,opportunityId:"INVALID-"+index,reason:"opportunity-not-object"});
  const opportunityId=cleanId(value.opportunityId||value.id||value.candidateId,160);
  if(!opportunityId)return freeze({ok:false,index,opportunityId:"INVALID-"+index,reason:"opportunity-id-required"});
  const kindRaw=cleanId(value.kind||value.type||value.intent||"other",60).toLowerCase();
  const kind=ALLOWED_KINDS.includes(kindRaw)?kindRaw:"other";
  const goalLinks=uniqueIds(Array.isArray(value.goalLinks)?value.goalLinks:Array.isArray(value.goals)?value.goals:[],MAX_GOALS+1);
  const requiredScopes=uniqueIds(Array.isArray(value.requiredAuthorityScopes)?value.requiredAuthorityScopes:Array.isArray(value.requiredScopes)?value.requiredScopes:[],MAX_SCOPES+1);
  const conflicts=uniqueIds(Array.isArray(value.conflictsWithCommitmentIds)?value.conflictsWithCommitmentIds:Array.isArray(value.conflictingCommitmentIds)?value.conflictingCommitmentIds:[],MAX_OBLIGATIONS+1);
  const prereqRaw=plain(value.prerequisites)?value.prerequisites:plain(value.requirements)?value.requirements:{};
  const prereqBlockers=uniqueIds(Array.isArray(prereqRaw.blockers)?prereqRaw.blockers:[],MAX_REASONS+1);
  const proposalCheck=normalizeProposal(value.proposal);
  const sourceRef=normalizeSourceRef(value);
  let invalidReason=null;
  if(goalLinks.length>MAX_GOALS)invalidReason="goal-link-limit-exceeded";
  else if(requiredScopes.length>MAX_SCOPES)invalidReason="required-scope-limit-exceeded";
  else if(conflicts.length>MAX_OBLIGATIONS)invalidReason="commitment-link-limit-exceeded";
  else if(prereqBlockers.length>MAX_REASONS)invalidReason="prerequisite-blocker-limit-exceeded";
  return freeze({
    ok:!invalidReason,index,opportunityId,invalidReason,
    opportunity:freeze({
      opportunityId,kind,label:clean(value.label||value.name||value.title||kind,120),priority:clamp100(value.priority!=null?value.priority:value.importance,50),
      grounded:value.grounded===true,available:value.available!==false,sourceRef,
      prerequisites:freeze({satisfied:prereqRaw.satisfied!==false&&prereqBlockers.length===0,blockers:prereqBlockers}),
      goalLinks,requiredScopes,conflictsWithCommitmentIds:conflicts,requiresClearSchedule:Boolean(value.requiresClearSchedule),
      opensAt:clean(value.opensAt||value.availableFrom||value.validFrom,32)||null,closesAt:clean(value.closesAt||value.expiresAt||value.validUntil,32)||null,
      targetRoleId:cleanId(value.targetRoleId||value.roleId,80)||null,targetRankTier:finite(value.targetRankTier),
      targetProfessionId:cleanId(value.targetProfessionId||value.professionId,80)||null,
      costCopper:finite(value.costCopper)==null?0:Math.max(0,Math.floor(Number(value.costCopper))),
      relationship:normalizeRelationship(value.relationship||value.social||value.socialContext),
      proposal:proposalCheck.proposal,proposalError:proposalCheck.ok?null:proposalCheck.reason
    })
  });
}
function needPressure(needs){
  const values=[needs.hunger,needs.fatigue,needs.safety,needs.social],max=Math.max(...values),avg=values.reduce((a,b)=>a+b,0)/values.length;
  return freeze({max,average:avg,urgent:max>=.75||avg>=.68});
}
function healthPressure(health){return freeze({urgent:Boolean(health.mobilityBlocked||health.condition<.45||health.fatigue>=.80),condition:health.condition,fatigue:health.fatigue})}
function goalSupport(opportunity,goals){
  const matches=goals.filter(g=>opportunity.goalLinks.includes(g.id));
  const best=matches.reduce((m,g)=>Math.max(m,g.priority),0);
  return freeze({matchedGoalIds:freeze(matches.map(g=>g.id)),score:best/100});
}
function socialSignal(rel){
  const positive=(rel.trust+rel.respect+rel.loyalty)/3,negative=(rel.suspicion+rel.fear+rel.resentment)/3;
  return Math.max(-1,Math.min(1,positive-negative));
}
function activeCommitments(obligations,goals,employment){
  const ids=[],dueIds=[];
  for(const row of obligations){
    if(["ended","completed","cancelled","inactive"].includes(row.state))continue;
    ids.push(row.id);
    if(["due","overdue","payment-pending","urgent"].includes(row.state)||row.priority>=80)dueIds.push(row.id);
  }
  for(const goal of goals)if(goal.priority>=85){const id="GOAL:"+goal.id;ids.push(id);dueIds.push(id)}
  if(employment.status==="active"&&employment.contract?.id)ids.push("EMPLOYMENT:"+cleanId(employment.contract.id,120));
  return freeze({ids:freeze([...new Set(ids)].slice(0,MAX_OBLIGATIONS+MAX_GOALS+1)),dueIds:freeze([...new Set(dueIds)].slice(0,MAX_OBLIGATIONS+MAX_GOALS)),pressure:Math.min(1,dueIds.length*.22+Math.max(0,ids.length-dueIds.length)*.05)});
}
function blockersFor(opportunity,context){
  const hard=[],soft=[];
  if(!opportunity.grounded)hard.push("opportunity-not-grounded");
  if(!opportunity.sourceRef)hard.push("grounding-source-required");
  if(!opportunity.available)hard.push("opportunity-unavailable");
  if(opportunity.proposalError)hard.push(opportunity.proposalError);
  if(!opportunity.prerequisites.satisfied)hard.push(...(opportunity.prerequisites.blockers.length?opportunity.prerequisites.blockers:["prerequisite-unsatisfied"]));
  if(opportunity.opensAt&&(!validWhen(opportunity.opensAt)||secondIndex(opportunity.opensAt)>secondIndex(context.when)))soft.push("opportunity-not-yet-open");
  if(opportunity.closesAt&&(!validWhen(opportunity.closesAt)||secondIndex(opportunity.closesAt)<secondIndex(context.when)))hard.push("opportunity-expired");
  if(opportunity.requiredScopes.some(scope=>!context.authority.scopes.includes(scope)))hard.push("authority-scope-missing");
  if(opportunity.targetRankTier!=null&&opportunity.targetRankTier-context.authority.rankTier>2)hard.push("rank-gap-too-large");
  const conflict=opportunity.conflictsWithCommitmentIds.some(id=>context.commitments.ids.includes(id));
  if(conflict||(opportunity.requiresClearSchedule&&context.commitments.dueIds.length))soft.push("commitment-conflict");
  if(context.needPressure.urgent)soft.push("urgent-self-care");
  if(context.healthPressure.urgent)soft.push("urgent-health");
  if(opportunity.costCopper>0&&context.wealth.balanceCopper!=null&&context.wealth.balanceCopper<opportunity.costCopper)soft.push("insufficient-funds");
  return freeze({hard:freeze([...new Set(hard)].slice(0,MAX_REASONS)),soft:freeze([...new Set(soft)].slice(0,MAX_REASONS))});
}
function opportunityScore(opportunity,context){
  const goal=goalSupport(opportunity,context.goals),social=socialSignal(opportunity.relationship),traits=context.traits;
  let score=8+opportunity.priority*.55+traits.ambition*18+traits.resolve*10+traits.curiosity*5-traits.caution*6+goal.score*14+social*8;
  if(opportunity.targetRankTier!=null){
    const gap=opportunity.targetRankTier-context.authority.rankTier;
    score+=gap===1?6:gap===2?1:gap<=0?-8:0;
  }
  if(opportunity.targetProfessionId&&context.employment.contract?.professionId===opportunity.targetProfessionId)score-=6;
  if(opportunity.costCopper>0&&context.wealth.balanceCopper!=null&&context.wealth.balanceCopper<opportunity.costCopper)score-=12;
  score-=context.commitments.pressure*10;
  const tie=parseInt(hashText(stable({seed:context.seed,when:context.when,opportunityId:opportunity.opportunityId,kind:opportunity.kind})),16)>>>0;
  return freeze({score:Number(Math.max(0,Math.min(100,score)).toFixed(4)),tie,goalSupport:goal,socialSignal:Number(social.toFixed(4))});
}
function maintainScore(context){
  const healthStress=context.healthPressure.urgent?1:Math.max(0,(.65-context.health.condition));
  const score=52+context.traits.caution*20-context.traits.ambition*20+context.needPressure.max*18+healthStress*15+context.commitments.pressure*18;
  return Number(Math.max(0,Math.min(100,score)).toFixed(4));
}
function evaluatorDecisionContext(row,context){
  return freeze({value:Number(Math.max(.05,Math.min(1,row.score/100)).toFixed(4)),urgency:Number(Math.max(.2,Math.min(1,.45+row.score/200)).toFixed(4)),socialAcceptability:Number(Math.max(.05,Math.min(1,.55+row.socialSignal*.3)).toFixed(4)),dutyConflict:false});
}
function compactSelected(row){
  if(!row)return null;
  return freeze({opportunityId:row.opportunity.opportunityId,kind:row.opportunity.kind,label:row.opportunity.label,score:row.score,reason:row.reason,hardBlockers:row.hardBlockers,softBlockers:row.softBlockers,sourceRef:row.opportunity.sourceRef,targetRoleId:row.opportunity.targetRoleId,targetRankTier:row.opportunity.targetRankTier,targetProfessionId:row.opportunity.targetProfessionId});
}
function finalizeResult(base){
  const result={...base,bounds:freeze({maxOpportunities:MAX_OPPORTUNITIES,maxGoals:MAX_GOALS,maxObligations:MAX_OBLIGATIONS,maxScopes:MAX_SCOPES,maxReasons:MAX_REASONS,maxProposalParameters:MAX_PROPOSAL_PARAMETERS,maxResultBytes:MAX_RESULT_BYTES}),authority:authorityMarkers(),bounded:true};
  result.serializedBytes=stable(result).length;
  if(result.serializedBytes>MAX_RESULT_BYTES)return invalid(result.seed,result.when,"result-byte-budget-exceeded",{maxResultBytes:MAX_RESULT_BYTES});
  return freeze(result);
}
function evaluate(configValue){
  telemetryState.evaluations++;
  const config=plain(configValue)?configValue:{},seed=clean(config.seed,160),when=clean(config.when,32);
  if(!seed)return invalid(seed,when,"campaign-seed-required");
  if(!validWhen(when))return invalid(seed,when,"fantasy-time-required");
  const rawOpportunities=Array.isArray(config.opportunities)?config.opportunities:Array.isArray(config.candidates)?config.candidates:[];
  const rawGoals=Array.isArray(config.goals?.records)?config.goals.records:Array.isArray(config.goals?.goals)?config.goals.goals:Array.isArray(config.goals)?config.goals:[];
  const rawObligations=Array.isArray(config.obligations?.obligations)?config.obligations.obligations:Array.isArray(config.obligations)?config.obligations:[];
  const rawScopes=Array.isArray(config.authority?.currentRole?.scopes)?config.authority.currentRole.scopes:Array.isArray(config.authority?.scopes)?config.authority.scopes:[];
  if(rawOpportunities.length>MAX_OPPORTUNITIES)return invalid(seed,when,"opportunity-limit-exceeded",{maxOpportunities:MAX_OPPORTUNITIES});
  if(rawGoals.length>MAX_GOALS)return invalid(seed,when,"goal-read-limit-exceeded",{maxGoals:MAX_GOALS});
  if(rawObligations.length>MAX_OBLIGATIONS)return invalid(seed,when,"obligation-limit-exceeded",{maxObligations:MAX_OBLIGATIONS});
  if(rawScopes.length>MAX_SCOPES)return invalid(seed,when,"authority-scope-limit-exceeded",{maxScopes:MAX_SCOPES});

  const context={
    seed,when,traits:normalizeTraits(config.profile),needs:normalizeNeeds(config.needs),health:normalizeHealth(config.health),
    goals:normalizeGoals(config.goals),authority:normalizeAuthority(config.authority),employment:normalizeEmployment(config.employment),
    wealth:normalizeWealth(config.wealth),obligations:normalizeObligations(config.obligations)
  };
  context.needPressure=needPressure(context.needs);
  context.healthPressure=healthPressure(context.health);
  context.commitments=activeCommitments(context.obligations,context.goals,context.employment);

  const normalized=rawOpportunities.map((row,index)=>normalizeOpportunity(row,index));
  const idCounts=new Map();
  for(const row of normalized)if(row.opportunityId&&!row.opportunityId.startsWith("INVALID-"))idCounts.set(row.opportunityId,(idCounts.get(row.opportunityId)||0)+1);
  const evaluated=[];
  for(const normalizedRow of normalized.sort((a,b)=>a.opportunityId.localeCompare(b.opportunityId)||a.index-b.index)){
    if(!normalizedRow.ok){
      evaluated.push(freeze({opportunityId:normalizedRow.opportunityId,kind:"invalid",score:0,decision:"reject",reason:normalizedRow.invalidReason||normalizedRow.reason,hardBlockers:freeze([normalizedRow.invalidReason||normalizedRow.reason]),softBlockers:freeze([]),proposalId:null,socialSignal:0,matchedGoalIds:freeze([])}));
      continue;
    }
    const opportunity=normalizedRow.opportunity;
    if((idCounts.get(opportunity.opportunityId)||0)>1){
      evaluated.push(freeze({opportunityId:opportunity.opportunityId,kind:opportunity.kind,score:0,decision:"reject",reason:"opportunity-id-duplicate",hardBlockers:freeze(["opportunity-id-duplicate"]),softBlockers:freeze([]),proposalId:opportunity.proposal?.proposalId||null,socialSignal:0,matchedGoalIds:freeze([]),opportunity}));
      continue;
    }
    const metric=opportunityScore(opportunity,context),blockers=blockersFor(opportunity,context);
    let decision="reject",reason=blockers.hard[0]||"opportunity-weak";
    if(!blockers.hard.length&&blockers.soft.length){decision="defer";reason=blockers.soft[0]}
    else if(!blockers.hard.length&&metric.score>=65){decision="pursue";reason="opportunity-strong"}
    else if(!blockers.hard.length&&metric.score>=45){decision="defer";reason="opportunity-possible"}
    evaluated.push(freeze({opportunityId:opportunity.opportunityId,kind:opportunity.kind,label:opportunity.label,score:metric.score,tie:metric.tie,decision,reason,hardBlockers:blockers.hard,softBlockers:blockers.soft,proposalId:opportunity.proposal?.proposalId||null,socialSignal:metric.socialSignal,matchedGoalIds:metric.goalSupport.matchedGoalIds,opportunity}));
  }

  const pursues=evaluated.filter(row=>row.decision==="pursue").sort((a,b)=>b.score-a.score||a.tie-b.tie||a.opportunityId.localeCompare(b.opportunityId));
  const defers=evaluated.filter(row=>row.decision==="defer").sort((a,b)=>b.score-a.score||a.tie-b.tie||a.opportunityId.localeCompare(b.opportunityId));
  const rejects=evaluated.filter(row=>row.decision==="reject").sort((a,b)=>b.score-a.score||a.opportunityId.localeCompare(b.opportunityId));
  const maintain=maintainScore(context);
  let status="maintain-current-role",selected=null,reason="current-role-maintained";
  if(pursues.length&&pursues[0].score>maintain){status="pursue";selected=pursues[0];reason=selected.reason}
  else if(pursues.length){status="maintain-current-role";reason="stability-preferred"}
  else if(defers.length){status="defer";selected=defers[0];reason=selected.reason}
  else if(rejects.length){status="reject";selected=rejects[0];reason=selected.reason}

  const selectedProposal=status==="pursue"?selected?.opportunity?.proposal||null:null;
  const selectedOpportunity=compactSelected(selected);
  const decisionBasis={seed,when,status,reason,selectedOpportunityId:selectedOpportunity?.opportunityId||null,maintainScore:maintain,evaluated:evaluated.map(row=>({id:row.opportunityId,decision:row.decision,reason:row.reason,score:row.score}))};
  const decisionId="ADVDEC-"+hashText(stable(decisionBasis));
  const selectedContext=selected?evaluatorDecisionContext(selected,context):null;
  if(status==="pursue")telemetryState.pursues++;else if(status==="defer")telemetryState.defers++;else if(status==="reject")telemetryState.rejects++;else telemetryState.maintains++;

  return finalizeResult({
    version:VERSION,ok:true,seed,when,status,disposition:status,reason,decisionId,
    selectedOpportunity,selectedOpportunityId:selectedOpportunity?.opportunityId||null,selectedProposal,selectedProposalId:selectedProposal?.proposalId||null,
    evaluated:freeze(evaluated.map(row=>freeze({opportunityId:row.opportunityId,kind:row.kind,label:row.label||null,score:row.score,decision:row.decision,reason:row.reason,hardBlockers:row.hardBlockers,softBlockers:row.softBlockers,proposalId:row.proposalId,socialSignal:row.socialSignal,matchedGoalIds:row.matchedGoalIds}))),
    evaluatorDecisionContext:selectedContext,
    maintain:freeze({score:maintain,reason:status==="maintain-current-role"?reason:"not-selected"}),
    contextSummary:freeze({needPressure:context.needPressure,healthPressure:context.healthPressure,commitmentPressure:context.commitments.pressure,activeCommitmentCount:context.commitments.ids.length,currentRoleId:context.authority.roleId,currentRankTier:context.authority.rankTier,employmentStatus:context.employment.status,goalCount:context.goals.length,opportunityCount:rawOpportunities.length}),
    handoff:freeze({boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",proposalOnly:true,requiresRuntimeValidation:status==="pursue",terminalSimulationRequired:status==="pursue",directEvaluatorHandoff:false,directActionExecution:false})
  });
}
function socialFor(seed,sourceId){
  if(!sourceId||!root?.SocialState?.dialogueContext)return null;
  try{telemetryState.socialReads++;return root.SocialState.dialogueContext(seed,sourceId)||null}catch(_){return null}
}
function fromLive(seedValue,whenValue,optionsValue){
  telemetryState.liveBuilds++;
  const options=plain(optionsValue)?optionsValue:{},seed=clean(seedValue,160),when=clean(whenValue,32),identity=cleanId(options.identityKey||options.identity||"protagonist",96)||"protagonist";
  const opportunities=Array.isArray(options.opportunities)?options.opportunities:Array.isArray(options.candidates)?options.candidates:[];
  if(opportunities.length>MAX_OPPORTUNITIES)return invalid(seed,when,"opportunity-limit-exceeded",{maxOpportunities:MAX_OPPORTUNITIES});
  let profile=options.profile||null,needs=options.needs||null,health=options.health||null,goals=options.goals||null,authority=options.authority||null,employment=options.employment||null,wealth=options.wealth||null;
  try{if(!profile){telemetryState.profileReads++;profile=root?.ProtagonistProfile?.summary?.(seed,identity)||root?.ProtagonistProfile?.derive?.(seed,identity)||null}}catch(_){}
  try{if(!needs){telemetryState.needsReads++;needs=root?.ProtagonistNeeds?.snapshot?.(seed,identity)||null}}catch(_){}
  try{if(!health){telemetryState.healthReads++;health=root?.ProtagonistHealth?.decisionContext?.(seed,identity)||root?.ProtagonistHealth?.snapshot?.(seed,identity)||null}}catch(_){}
  try{if(!goals){telemetryState.goalReads++;goals=root?.ProtagonistGoals?.list?.(seed,{limit:MAX_GOALS},identity)||[]}}catch(_){}
  try{if(!authority){telemetryState.authorityReads++;authority=root?.ProtagonistAuthority?.decisionContext?.(seed,identity)||root?.ProtagonistAuthority?.snapshot?.(seed,identity)||null}}catch(_){}
  try{if(!employment){telemetryState.employmentReads++;employment=root?.ProtagonistEmployment?.current?.(seed,when,identity)||null}}catch(_){}
  try{if(!wealth){telemetryState.wealthReads++;wealth=root?.ProtagonistWealth?.snapshot?.(seed,identity)||null}}catch(_){}
  const enriched=opportunities.map(raw=>{
    const copy=clone(raw);
    if(!copy.relationship){
      const source=normalizeSourceRef(copy);
      const social=source?.kind==="resident"?socialFor(seed,source.id):null;
      if(social)copy.relationship=social;
    }
    return copy;
  });
  return evaluate({seed,when,profile,needs,health,goals,authority,employment,wealth,obligations:options.obligations||[],opportunities:enriched});
}
function runtimeInput(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const result=plain(resultValue)?resultValue:{},options=plain(optionsValue)?optionsValue:{};
  if(result.ok!==true||result.status!=="pursue"||!plain(result.selectedProposal))return freeze({ok:false,reason:"selected-advancement-proposal-required",config:null});
  const actorId=cleanId(options.actorId||"protagonist",120)||"protagonist";
  return freeze({ok:true,reason:"advancement-runtime-handoff-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",directEvaluatorHandoff:false,executionDeferredToRuntime:true,config:freeze({
    seed:clean(result.seed,160),when:clean(result.when,32),dueWhen:clean(result.when,32),actorId,
    planId:"ADVPLAN-"+cleanId(result.decisionId,160),selectionId:cleanId(result.decisionId,160),
    proposal:result.selectedProposal,snapshot:snapshotValue||null,
    decisionContext:plain(decisionContextValue)?decisionContextValue:result.evaluatorDecisionContext,
    actorPosition:options.actorPosition?clone(options.actorPosition):null
  })});
}
function schedule(resultValue,snapshotValue,decisionContextValue,optionsValue){
  const options=plain(optionsValue)?optionsValue:{},handoff=runtimeInput(resultValue,snapshotValue,decisionContextValue,options);
  if(!handoff.ok)return handoff;
  const runtime=options.runtime||root?.ProtagonistActionRuntime;
  if(!runtime?.schedule)return freeze({ok:false,reason:"protagonist-action-runtime-unavailable",boundary:handoff.boundary,directEvaluatorHandoff:false});
  telemetryState.runtimeSchedules++;
  const scheduled=runtime.schedule(handoff.config);
  return freeze({ok:Boolean(scheduled?.ok),reason:scheduled?.reason||scheduled?.attempt?.reason||"runtime-schedule-result",boundary:handoff.boundary,directEvaluatorHandoff:false,directActionExecution:false,runtimeResult:scheduled||null});
}
function snapshot(seedValue,whenValue,optionsValue){return fromLive(seedValue,whenValue,optionsValue)}
function telemetry(){return freeze({...telemetryState,bounded:true,selectionEventDriven:true,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,directWorldMutation:false,directRankMutation:false,directSkillMutation:false,directRelationshipMutation:false,directWealthMutation:false,appointmentAuthority:false,opportunityCreation:false,simulationValidationBypass:false,authority:false})}

root.ProtagonistAdvancementGoal=Object.freeze({
  VERSION,MAX_OPPORTUNITIES,MAX_GOALS,MAX_OBLIGATIONS,MAX_SCOPES,MAX_REASONS,MAX_PROPOSAL_PARAMETERS,MAX_RESULT_BYTES,DECISIONS,ALLOWED_KINDS,
  evaluate,fromLive,runtimeInput,schedule,snapshot,telemetry
});
if(typeof module!=="undefined"&&module.exports)module.exports=root.ProtagonistAdvancementGoal;
return root.ProtagonistAdvancementGoal;
});
