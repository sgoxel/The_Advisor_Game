(function(){
"use strict";

const VERSION="advisor-diplomacy-v1";
const SCHEMA="AdvisorDiplomacyLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="advisor-diplomacy-ledger";
const REGISTRY_KEY="diplomacy-outcomes";
const MAX_OUTCOMES=32;
const MAX_LEDGER_BYTES=48*1024;
const MAX_QUERY_RESULTS=12;
const MAX_REPUTATIONS=6;
const MAX_OBLIGATIONS=8;
const MAX_SCOPES=16;
const MAX_FACTOR_REFS=16;
const MAX_RISKS=6;\nconst MAX_OPTIONS=6;\nconst MAX_CONSTRAINTS=8;
const MAX_MODIFIER=0.07;
const MAX_SKILL_BONUS=0.015;
const COUNTERPART_KINDS=Object.freeze(["resident","official","country","faction"]);
const COUNTERPART_SOURCES=Object.freeze(["Simulation","DailyActivity","PoliticalGeography","WorldState"]);
const HIGH_AUTHORITY_KINDS=Object.freeze(["official","country","faction"]);
const SOCIAL_SOURCE="SocialState";
const COUNTRY_SOURCE="CountryRelations";
const AUTHORITY_SOURCE="ProtagonistAuthority";
const DECISIONS=Object.freeze(["accepted","modified","deferred","rejected","invalid"]);
const DUTY_STATUSES=Object.freeze(["active","fulfilled","breached","released"]);

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestamp(value){const out=cleanText(value,32);if(!validTimestamp(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out}
function clamp01(value,fallback=.5){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback}
function clamp11(value,fallback=0){const n=Number(value);return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):fallback}
function round4(value){return Number(Number(value).toFixed(4))}
function advisorProfileId(seed){return "ADVISOR-"+hashText(seed+"|advisor-profile-v1")}
function registryContext(seedValue){const seed=requiredSeed(seedValue),profileId=advisorProfileId(seed),world=root().WorldState;const ref=world?.structuralRef?.(seed,REGISTRY_KIND,profileId,REGISTRY_KEY,{role:"advisor-diplomacy-history",advisorProfileId:profileId,authority:"AdvisorDiplomacy compact outcome references"})||null;return freeze({seed,advisorProfileId:profileId,ref})}
function emptyLedger(ctx){return{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,advisorProfileId:ctx.advisorProfileId,registryId:ctx.ref?.id||null,revision:0,lastFantasyTimestamp:null,outcomes:[],bounds:{maxOutcomes:MAX_OUTCOMES,maxBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS}}}
function outcomeValid(row,seed){
  if(!plain(row)||!/^DPO-[0-9A-F]{8}$/.test(String(row.id||""))||row.seed!==seed)return false;
  if(!/^DPA-[0-9A-F]{8}$/.test(String(row.attemptId||""))||!/^DPR-[0-9A-F]{8}$/.test(String(row.resultId||"")))return false;
  if(!DECISIONS.includes(row.decision)||!row.decisionId||!validTimestamp(row.fantasyTimestamp))return false;
  if(!row.counterpartId||!row.requestId||!Array.isArray(row.factorRefs)||row.factorRefs.length>MAX_FACTOR_REFS)return false;
  if(!Number.isFinite(row.modifier)||Math.abs(row.modifier)>MAX_MODIFIER||!Number.isInteger(row.diplomacyLevel)||row.diplomacyLevel<1||row.diplomacyLevel>20)return false;
  if(row.protagonistChoice!==true||row.simulationValidation!==true)return false;
  return true;
}
function compatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.advisorProfileId!==ctx.advisorProfileId||raw.registryId!==(ctx.ref?.id||null)||!Array.isArray(raw.outcomes)||raw.outcomes.length>MAX_OUTCOMES)return false;
  const ids=new Set();let latest=null;
  for(const row of raw.outcomes){if(!outcomeValid(row,ctx.seed)||ids.has(row.id))return false;ids.add(row.id);if(latest===null||row.fantasyTimestamp>latest)latest=row.fantasyTimestamp}
  if(raw.lastFantasyTimestamp!==latest)return false;
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function readLedger(seedValue){const ctx=registryContext(seedValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.advisorDiplomacy;if(raw==null)return{ctx,resolved,compatible:true,ledger:emptyLedger(ctx),reason:"empty"};if(!compatible(raw,ctx))return{ctx,resolved,compatible:false,ledger:null,reason:"ledger-incompatible"};return{ctx,resolved,compatible:true,ledger:clone(raw),reason:"ok"}}
function writeLedger(seedValue,ledgerValue,reasonValue){const read=readLedger(seedValue),ctx=read.ctx,world=root().WorldState;if(!read.compatible)return freeze({ok:false,reason:read.reason});if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});const next=clone(ledgerValue);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.advisorProfileId=ctx.advisorProfileId;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;if(!compatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});const result=world.applyDelta(ctx.seed,ctx.ref,{advisorDiplomacy:next},String(reasonValue||"advisor-diplomacy"));return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),outcomeCount:next.outcomes.length,serializedBytes:utf8Bytes(stable(next))})}
function diplomacySkill(seed){let level=1,totalXp=0;try{const row=root().AdvisorProgression?.getSkill?.(seed,"diplomacy");if(row){level=Math.max(1,Math.min(20,Math.floor(Number(row.level)||1)));totalXp=Math.max(0,Math.floor(Number(row.totalXp)||0))}}catch(_){}return freeze({level,totalXp,maxBonus:MAX_SKILL_BONUS})}
function normalizeDecisionContext(value){if(!plain(value))throw new Error("Current protagonist decision context is required.");return freeze({value:clamp01(value.value,.5),urgency:clamp01(value.urgency,.5),socialAcceptability:clamp01(value.socialAcceptability,.5),dutyConflict:Boolean(value.dutyConflict)})}
function normalizeCounterpart(value){
  if(!plain(value))throw new Error("Authoritative counterpart reference is required.");
  const id=cleanId(value.id,160),kind=cleanId(value.kind,40).toLowerCase(),sourceSystem=cleanText(value.sourceSystem,80),refId=cleanId(value.refId||value.id,160);
  if(!id||!refId||!COUNTERPART_KINDS.includes(kind))throw new Error("Invalid counterpart reference.");
  if(value.validated!==true||!COUNTERPART_SOURCES.includes(sourceSystem))throw new Error("Counterpart must be a validated authoritative reference.");
  return freeze({id,kind,sourceSystem,refId,validated:true});
}
function normalizeRequest(value){
  if(!plain(value))throw new Error("Diplomacy request is required.");
  const requestId=cleanId(value.requestId,160),topicId=cleanId(value.topicId,160),requiredAuthorityScope=cleanId(value.requiredAuthorityScope||"",120)||null;
  if(!requestId||!topicId)throw new Error("Diplomacy request requires requestId and topicId.");
  return freeze({requestId,topicId,requiredAuthorityScope});
}
function normalizeSocialRelationship(value,counterpart){
  if(!plain(value)||value.sourceSystem!==SOCIAL_SOURCE)throw new Error("SocialState relationship reference is required.");
  const refId=cleanId(value.refId,160),observerId=cleanId(value.observerId,160),subjectId=cleanId(value.subjectId,160);
  if(!refId||observerId!==counterpart.id||subjectId!=="protagonist")throw new Error("Relationship reference does not match counterpart.");
  const v=plain(value.values)?value.values:{};
  return freeze({sourceSystem:SOCIAL_SOURCE,refId,observerId,subjectId,values:freeze({
    trust:clamp01(v.trust,.5),fear:clamp01(v.fear,.1),respect:clamp01(v.respect,.5),
    suspicion:clamp01(v.suspicion,.25),loyalty:clamp01(v.loyalty,.35),resentment:clamp01(v.resentment,.1)
  })});
}
function normalizeCountryRelationship(value,counterpart){
  if(!plain(value)||value.sourceSystem!==COUNTRY_SOURCE)throw new Error("CountryRelations reference is required.");
  const refId=cleanId(value.refId,160),fromCountryId=cleanId(value.fromCountryId,160),toCountryId=cleanId(value.toCountryId,160);
  if(!refId||!fromCountryId||!toCountryId||toCountryId!==counterpart.id||fromCountryId===toCountryId)throw new Error("Country relation does not match counterpart.");
  const shared=plain(value.shared)?value.shared:{},direction=plain(value.direction)?value.direction:{};
  return freeze({sourceSystem:COUNTRY_SOURCE,refId,fromCountryId,toCountryId,shared:freeze({
    relationshipScore:clamp11(shared.relationshipScore,0),cooperation:clamp01(shared.cooperation,.5),rivalry:clamp01(shared.rivalry,.5),
    militaryTension:clamp01(shared.militaryTension,.5),tradeAccess:clamp01(shared.tradeAccess,.5)
  }),direction:freeze({
    leverage:clamp11(direction.leverage,0),dependency:clamp01(direction.dependency,.5),tradeReliance:clamp01(direction.tradeReliance,.5)
  })});
}
function normalizeReputations(value){
  const rows=Array.isArray(value)?value:[];if(rows.length>MAX_REPUTATIONS)throw new Error("Reputation read limit exceeded.");
  return freeze(rows.map(row=>{if(!plain(row)||row.sourceSystem!==SOCIAL_SOURCE)throw new Error("Reputation source must be SocialState.");const refId=cleanId(row.refId,160),subjectId=cleanId(row.subjectId,160),scope=cleanId(row.scope,80),id=cleanId(row.id,160);if(!refId||subjectId!=="protagonist"||!scope||!id)throw new Error("Invalid reputation reference.");return freeze({sourceSystem:SOCIAL_SOURCE,refId,subjectId,scope,id,score:clamp11(row.score,0)})}));
}
function actorRef(value){if(!plain(value))return null;const kind=cleanId(value.kind,40).toLowerCase(),id=kind==="protagonist"?"protagonist":cleanId(value.id,160);return kind&&id?freeze({kind,id}):null}
function normalizeObligations(value){
  const rows=Array.isArray(value)?value:[];if(rows.length>MAX_OBLIGATIONS)throw new Error("Obligation read limit exceeded.");
  return freeze(rows.map(row=>{if(!plain(row)||row.sourceSystem!==SOCIAL_SOURCE)throw new Error("Obligation source must be SocialState.");const id=cleanId(row.id,160),status=cleanId(row.status,40).toLowerCase(),type=cleanId(row.type,60).toLowerCase(),actor=actorRef(row.actor),beneficiary=actorRef(row.beneficiary);if(!id||!DUTY_STATUSES.includes(status)||!type||!actor||!beneficiary)throw new Error("Invalid obligation reference.");return freeze({sourceSystem:SOCIAL_SOURCE,id,status,type,actor,beneficiary,priority:clamp01(row.priority,.5)})}));
}
function normalizeAuthority(value){
  if(value==null)return null;
  if(!plain(value)||value.sourceSystem!==AUTHORITY_SOURCE)throw new Error("Authority source must be ProtagonistAuthority.");
  const roleId=cleanId(value.roleId,80),scopes=Array.isArray(value.scopes)?value.scopes:[];if(!roleId||scopes.length>MAX_SCOPES)throw new Error("Invalid authority context.");
  const unique=[];for(const raw of scopes){const scope=cleanId(raw,120);if(!scope)throw new Error("Authority scope is invalid.");if(!unique.includes(scope))unique.push(scope)}
  return freeze({sourceSystem:AUTHORITY_SOURCE,roleId,rankTier:Math.max(0,Math.min(99,Math.floor(Number(value.rankTier)||0))),scopes:freeze(unique)});
}
function relevantObligationScore(obligations,counterpart){
  let sum=0,count=0;const refs=[];
  for(const row of obligations){
    if(row.status!=="active")continue;
    const actorCounterpart=row.actor.id===counterpart.id&&row.actor.kind!=="protagonist";
    const beneficiaryCounterpart=row.beneficiary.id===counterpart.id&&row.beneficiary.kind!=="protagonist";
    const actorProtagonist=row.actor.kind==="protagonist"&&row.actor.id==="protagonist";
    const beneficiaryProtagonist=row.beneficiary.kind==="protagonist"&&row.beneficiary.id==="protagonist";
    let signed=null;
    if(actorCounterpart&&beneficiaryProtagonist)signed=row.priority;
    else if(actorProtagonist&&beneficiaryCounterpart)signed=-row.priority;
    if(signed==null)continue;
    sum+=signed;count++;refs.push(row.id);
  }
  const net=count?Math.max(-1,Math.min(1,sum/count)):0;
  return freeze({net:round4(net),score:round4(.5+net*.5),refs:freeze(refs.slice(0,MAX_OBLIGATIONS))});
}
function localFactors(counterpart,relationship,reputations,obligations,authority,request){
  const v=relationship.values;
  const relationshipScore=clamp01(v.trust*.30+v.respect*.25+v.loyalty*.15+(1-v.suspicion)*.15+(1-v.resentment)*.10+(1-v.fear)*.05,.5);
  const reputationScore=reputations.length?clamp01(reputations.reduce((sum,row)=>sum+(row.score+1)/2,0)/reputations.length,.5):.5;
  const obligation=relevantObligationScore(obligations,counterpart);
  const authorityScore=request.requiredAuthorityScope?1:.5;
  const hostilityRisk=clamp01(v.suspicion*.35+v.resentment*.35+v.fear*.15+(1-v.trust)*.15,0);
  const combined=clamp01(relationshipScore*.45+reputationScore*.20+obligation.score*.25+authorityScore*.10,.5);
  const effective=clamp01(combined*(1-hostilityRisk*.35),.5);
  return freeze({relationshipScore:round4(relationshipScore),reputationScore:round4(reputationScore),obligationScore:obligation.score,obligationNet:obligation.net,authorityScore:round4(authorityScore),hostilityRisk:round4(hostilityRisk),combinedScore:round4(combined),effectiveScore:round4(effective),obligationRefs:obligation.refs});
}
function countryFactors(relationship,authority){
  const shared=relationship.shared,direction=relationship.direction;
  const relationshipScore=clamp01((shared.relationshipScore+1)/2,.5),leverageScore=clamp01((direction.leverage+1)/2,.5);
  const authorityScore=authority?1:0;
  const hostilityRisk=clamp01(shared.rivalry*.45+shared.militaryTension*.30+(1-relationshipScore)*.20+direction.dependency*.05,.5);
  const combined=clamp01(relationshipScore*.25+shared.cooperation*.20+leverageScore*.30+(1-shared.rivalry)*.15+authorityScore*.10,.5);
  const effective=clamp01(combined*(1-hostilityRisk*.30),.5);
  return freeze({relationshipScore:round4(relationshipScore),cooperationScore:round4(shared.cooperation),leverageScore:round4(leverageScore),authorityScore:round4(authorityScore),hostilityRisk:round4(hostilityRisk),combinedScore:round4(combined),effectiveScore:round4(effective),dependencyRisk:round4(direction.dependency)});
}
function risksFor(factors,request,obligationRefs){
  const risks=[];if(factors.hostilityRisk>=.6)risks.push("hostile-or-low-trust-context");if(request.requiredAuthorityScope)risks.push("legitimate-authority-scope-required");if(Array.isArray(obligationRefs)&&obligationRefs.length===0)risks.push("no-direct-obligation-leverage");if(factors.dependencyRisk>=.7)risks.push("high-dependency-risk");return freeze(risks.slice(0,MAX_RISKS));
}
function factorRefs(relationship,reputations,obligations,authority,request,counterpart){
  const refs=[relationship.refId,...reputations.map(x=>x.refId),...obligations.map(x=>x.id)];
  if(authority)refs.push("AUTHREF:"+authority.roleId);
  if(request.requiredAuthorityScope)refs.push("AUTHSCOPE:"+request.requiredAuthorityScope);
  refs.push("COUNTERPART:"+counterpart.refId);
  return freeze([...new Set(refs.filter(Boolean))].slice(0,MAX_FACTOR_REFS));
}
function leverageOptions(counterpart,relationship,reputations,authority,request,factors){
  const options=[];
  const add=(id,strength,refs)=>{if(options.length<MAX_OPTIONS)options.push(freeze({id,strength:round4(clamp01(strength,.5)),sourceRefs:freeze([...new Set((refs||[]).filter(Boolean))].slice(0,MAX_FACTOR_REFS))}))};
  if(counterpart.kind==="country"){
    if(factors.cooperationScore>=.58)add("mutual-cooperation",factors.cooperationScore,[relationship.refId]);
    if(factors.leverageScore>=.55)add("directional-leverage",factors.leverageScore,[relationship.refId]);
  }else{
    if(factors.relationshipScore>=.58)add("relationship-goodwill",factors.relationshipScore,[relationship.refId]);
    if(factors.reputationScore>=.58&&reputations.length)add("reputation-appeal",factors.reputationScore,reputations.map(x=>x.refId));
    if(factors.obligationNet>0&&factors.obligationRefs?.length)add("counterpart-obligation",factors.obligationScore,factors.obligationRefs);
  }
  if(request.requiredAuthorityScope&&authority?.scopes.includes(request.requiredAuthorityScope))add("legitimate-authority-request",factors.authorityScore,["AUTHSCOPE:"+request.requiredAuthorityScope]);
  return freeze(options);
}
function constraintsFor(request,counterpart){
  const rows=["advisor-only","protagonist-choice-required","simulation-validation-required","no-fabricated-leverage"];
  if(request.requiredAuthorityScope)rows.push("authority-scope:"+request.requiredAuthorityScope);
  if(HIGH_AUTHORITY_KINDS.includes(counterpart.kind))rows.push("higher-authority-context");
  return freeze(rows.slice(0,MAX_CONSTRAINTS));
}
function assess(seedValue,inputValue){
  const seed=requiredSeed(seedValue),input=plain(inputValue)?inputValue:{};
  let when,counterpart,request,decisionContext,relationship,reputations,obligations,authority;
  try{
    when=timestamp(input.fantasyTimestamp);counterpart=normalizeCounterpart(input.counterpart);request=normalizeRequest(input.request);
    const context=plain(input.context)?input.context:{};decisionContext=normalizeDecisionContext(context.decisionContext);
    relationship=counterpart.kind==="country"?normalizeCountryRelationship(context.relationship,counterpart):normalizeSocialRelationship(context.relationship,counterpart);
    reputations=counterpart.kind==="country"?freeze([]):normalizeReputations(context.reputations);
    obligations=normalizeObligations(context.obligations);authority=normalizeAuthority(context.authority);
    if(HIGH_AUTHORITY_KINDS.includes(counterpart.kind)&&!request.requiredAuthorityScope)throw new Error("Higher-authority diplomacy requires an explicit authority scope.");
    if(request.requiredAuthorityScope&&(!authority||!authority.scopes.includes(request.requiredAuthorityScope)))throw new Error("Required authority scope is missing.");
  }catch(error){return freeze({ok:false,reason:String(error.message||error),assessment:null})}
  const factors=counterpart.kind==="country"?countryFactors(relationship,authority):localFactors(counterpart,relationship,reputations,obligations,authority,request);
  const skill=diplomacySkill(seed),baseModifier=round4((factors.effectiveScore-.5)*.12);
  const favorableStrength=Math.max(0,Math.min(1,(factors.effectiveScore-.5)*2));
  const skillContribution=round4(((skill.level-1)/19)*MAX_SKILL_BONUS*favorableStrength);
  const modifier=round4(Math.max(-MAX_MODIFIER,Math.min(MAX_MODIFIER,baseModifier+skillContribution)));
  const adjusted=freeze({value:round4(clamp01(decisionContext.value+modifier*.5,decisionContext.value)),urgency:decisionContext.urgency,socialAcceptability:round4(clamp01(decisionContext.socialAcceptability+modifier,decisionContext.socialAcceptability)),dutyConflict:decisionContext.dutyConflict});
  const refs=factorRefs(relationship,reputations,obligations,authority,request,counterpart),risks=risksFor(factors,request,factors.obligationRefs||[]),options=leverageOptions(counterpart,relationship,reputations,authority,request,factors),constraints=constraintsFor(request,counterpart);
  const basis={seed,when,counterpart,request,decisionContext,relationship,reputations,obligations,authority,skillLevel:skill.level};
  const attemptId="DPA-"+hashText(stable(basis)),resultId="DPR-"+hashText("result|"+stable({...basis,modifier,adjusted,factorRefs:refs}));
  return freeze({ok:true,reason:"assessed",assessment:freeze({
    version:VERSION,seed,fantasyTimestamp:when,attemptId,resultId,counterpart,request,factors,options,constraints,risks,factorRefs:refs,
    skill:freeze({level:skill.level,totalXp:skill.totalXp,contribution:skillContribution,maxBonus:MAX_SKILL_BONUS}),
    baseModifier,modifier,modifierCap:MAX_MODIFIER,decisionContext:adjusted,originalDecisionContext:decisionContext,
    advisoryOnly:true,forcedDecision:false,guaranteedOutcome:false,requiresEvaluator:true,evaluatorBoundary:"ProtagonistCommandEvaluator",
    invalidCommandBypass:false,simulationValidationBypass:false,protagonistChoice:true,directWorldMutation:false,
    relationshipMutation:false,politicalMutation:false,territorialMutation:false,lawMutation:false,ownershipMutation:false,
    authorityMutation:false,resourceMutation:false,providerWordingUsed:false,presentationStateUsed:false
  })});
}
function validAssessment(seed,value){return plain(value)&&value.version===VERSION&&value.seed===seed&&/^DPA-[0-9A-F]{8}$/.test(String(value.attemptId||""))&&/^DPR-[0-9A-F]{8}$/.test(String(value.resultId||""))&&validTimestamp(value.fantasyTimestamp)&&plain(value.counterpart)&&plain(value.request)&&Number.isFinite(value.modifier)&&Math.abs(value.modifier)<=MAX_MODIFIER&&Number.isInteger(value.skill?.level)&&value.skill.level>=1&&value.skill.level<=20&&Array.isArray(value.factorRefs)&&value.factorRefs.length<=MAX_FACTOR_REFS}
function evaluatorOutcomeValid(seed,assessment,value){if(!plain(value)||value.seed!==seed||value.when!==assessment.fantasyTimestamp||!DECISIONS.includes(String(value.decision||"")))return false;if(!value.decisionId||value.authority?.simulationValidation!==true)return false;if(value.decision==="invalid")return value.protagonistEvaluation?.checked===false&&value.originalValidation?.checked===true;return value.protagonistEvaluation?.checked===true&&value.authority?.protagonistChoice===true}
function progressionEvidence(row){if(row.decision==="invalid")return null;return freeze({campaignSeed:row.seed,kind:"advisor-tool-result",authority:"AdvisorToolResolution",validated:true,rewardBand:(row.decision==="accepted"||row.decision==="modified")?"success":"practice",fantasyTimestamp:row.fantasyTimestamp,toolId:"advisor.diplomacy",outcomeId:row.id,sourceSystem:"AdvisorDiplomacy"})}
function recordOutcome(seedValue,assessmentValue,evaluatorValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);if(!read.compatible)return freeze({ok:false,reason:read.reason,outcome:null});
  if(!validAssessment(seed,assessmentValue))return freeze({ok:false,reason:"invalid-diplomacy-assessment",outcome:null});
  if(!evaluatorOutcomeValid(seed,assessmentValue,evaluatorValue))return freeze({ok:false,reason:"invalid-protagonist-evaluator-outcome",outcome:null});
  const row=freeze({
    id:"DPO-"+hashText(stable({seed,attemptId:assessmentValue.attemptId,resultId:assessmentValue.resultId,decisionId:evaluatorValue.decisionId,decision:evaluatorValue.decision})),
    seed,attemptId:assessmentValue.attemptId,resultId:assessmentValue.resultId,decisionId:cleanId(evaluatorValue.decisionId,160),decision:String(evaluatorValue.decision),
    fantasyTimestamp:assessmentValue.fantasyTimestamp,counterpartId:assessmentValue.counterpart.id,requestId:assessmentValue.request.requestId,
    requiredAuthorityScope:assessmentValue.request.requiredAuthorityScope||null,modifier:round4(assessmentValue.modifier),diplomacyLevel:assessmentValue.skill.level,
    factorRefs:freeze(assessmentValue.factorRefs.slice(0,MAX_FACTOR_REFS)),protagonistChoice:true,simulationValidation:true
  });
  const existing=read.ledger.outcomes.find(x=>x.id===row.id);if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,outcome:freeze(clone(existing)),progressionEvidence:progressionEvidence(existing)});
  if(read.ledger.outcomes.length>=MAX_OUTCOMES)return freeze({ok:false,reason:"diplomacy-outcome-limit-reached",outcome:null});
  if(read.ledger.lastFantasyTimestamp&&row.fantasyTimestamp<read.ledger.lastFantasyTimestamp)return freeze({ok:false,reason:"cannot-rewind-diplomacy-chronology",outcome:null});
  const next=clone(read.ledger);next.outcomes.push(clone(row));next.lastFantasyTimestamp=row.fantasyTimestamp;
  const write=writeLedger(seed,next,"advisor-diplomacy-outcome:"+row.id);
  return freeze({...write,duplicate:false,outcome:write.ok?row:null,progressionEvidence:write.ok?progressionEvidence(row):null});
}
function listOutcomes(seedValue,optionsValue){const read=readLedger(seedValue),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze([]);const counterpartId=cleanId(options.counterpartId||"",160)||null,limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS)));return freeze(read.ledger.outcomes.filter(x=>!counterpartId||x.counterpartId===counterpartId).slice().sort((a,b)=>String(b.fantasyTimestamp).localeCompare(String(a.fantasyTimestamp))||String(a.id).localeCompare(String(b.id))).slice(0,limit).map(row=>freeze(clone(row))))}
function snapshot(seedValue){const seed=requiredSeed(seedValue),read=readLedger(seed);if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,outcomes:freeze([]),bounded:true});return freeze({
  version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,advisorProfileId:read.ctx.advisorProfileId,registryId:read.ctx.ref?.id||null,compatible:true,reason:read.reason,
  ledgerRevision:Number(read.ledger.revision||0),deltaRevision:Number(read.resolved?.delta?.revision||0),lastFantasyTimestamp:read.ledger.lastFantasyTimestamp,
  outcomeCount:read.ledger.outcomes.length,serializedBytes:utf8Bytes(stable(read.ledger)),outcomes:freeze(read.ledger.outcomes.map(x=>freeze(clone(x)))),
  maxOutcomes:MAX_OUTCOMES,maxLedgerBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,maxReputations:MAX_REPUTATIONS,maxObligations:MAX_OBLIGATIONS,maxScopes:MAX_SCOPES,maxFactorRefs:MAX_FACTOR_REFS,maxOptions:MAX_OPTIONS,maxConstraints:MAX_CONSTRAINTS,maxModifier:MAX_MODIFIER,maxSkillBonus:MAX_SKILL_BONUS,
  bounded:true,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",relationshipAuthority:"SocialState references only",
  politicalRelationshipAuthority:"CountryRelations references only",legitimateAuthority:"ProtagonistAuthority scopes only",decisionAuthority:"ProtagonistCommandEvaluator",
  fullWorldScan:false,wholeRelationshipScan:false,wholeHistoryScan:false,perFrameScan:false,directWorldMutation:false,relationshipMutation:false,
  politicalMutation:false,territorialMutation:false,lawMutation:false,ownershipMutation:false,authorityMutation:false,resourceMutation:false,
  forcedDecision:false,guaranteedOutcome:false,simulationValidationBypass:false,providerWordingAuthority:false,presentationStateAuthority:false
})}
const api=Object.freeze({VERSION,SCHEMA,SCHEMA_VERSION,MAX_OUTCOMES,MAX_LEDGER_BYTES,MAX_QUERY_RESULTS,MAX_REPUTATIONS,MAX_OBLIGATIONS,MAX_SCOPES,MAX_FACTOR_REFS,MAX_RISKS,MAX_OPTIONS,MAX_CONSTRAINTS,MAX_MODIFIER,MAX_SKILL_BONUS,COUNTERPART_KINDS,assess,recordOutcome,listOutcomes,snapshot});
root().AdvisorDiplomacy=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();