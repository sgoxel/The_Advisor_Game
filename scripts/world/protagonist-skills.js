(function(){
"use strict";

const VERSION="protagonist-skills-v1";
const SCHEMA="ProtagonistSkillsState";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-skills-state";
const REGISTRY_KEY="competence-v1";
const DEFAULT_IDENTITY_KEY="protagonist";
const MAX_HISTORY=32;
const MAX_RECENT_OPERATIONS=64;
const MAX_QUERY_SKILLS=8;
const MAX_QUALIFICATION_REQUIREMENTS=8;
const MAX_STATE_BYTES=32768;
const MAX_POINTS=12000;
const LEVEL_THRESHOLDS=Object.freeze([0,1000,2500,4500,7000,10000]);
const SKILL_DEFS=Object.freeze({
  labor:Object.freeze({skillId:"labor",label:"Labor",description:"Sustained practical work and physical task discipline."}),
  craft:Object.freeze({skillId:"craft",label:"Craft",description:"Tool use, making and repair competence."}),
  social:Object.freeze({skillId:"social",label:"Social",description:"Everyday interpersonal conduct and negotiation practice."}),
  administration:Object.freeze({skillId:"administration",label:"Administration",description:"Record keeping, coordination and local stewardship practice."}),
  martial:Object.freeze({skillId:"martial",label:"Martial",description:"Training discipline for legitimate martial roles; not combat authority."}),
  survival:Object.freeze({skillId:"survival",label:"Survival",description:"Outdoor self-sufficiency, travel and fieldcraft competence."})
});
const PRACTICE_BANDS=Object.freeze({brief:120,standard:300,intensive:600});
const telemetryState={reads:0,writes:0,initializations:0,practiceAwards:0,duplicates:0,rejections:0,qualificationQueries:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stableStringify(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function hashNumber(value){return parseInt(hashText(value),16)>>>0}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function identityKey(value){return cleanId(value||DEFAULT_IDENTITY_KEY,96)||DEFAULT_IDENTITY_KEY}
function bump(key){telemetryState[key]=Math.min(Number.MAX_SAFE_INTEGER,(telemetryState[key]||0)+1)}
function protagonistId(seed,key){try{return root().ProtagonistProfile?.derive?.(seed,key)?.protagonistId||("PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1"))}catch(_){return"PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1")}}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestampParts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])};if(p.month<1||p.month>12||p.day<1||p.day>31||p.hour>23||p.minute>59||p.second>59)return null;return p}
function daysFromCivil(year,month,day){const y=year-(month<=2?1:0),era=Math.floor(y/400),yoe=y-era*400,mp=month+(month>2?-3:9),doy=Math.floor((153*mp+2)/5)+day-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function secondIndex(value){const p=timestampParts(value);return p?daysFromCivil(p.year,p.month,p.day)*86400+p.hour*3600+p.minute*60+p.second:null}
function currentTimestamp(){return root().GameTime?.getTimestampKey?.()||null}
function campaignStartTimestamp(){const campaign=root().SeedSystem?.getCampaign?.()||null;return campaign?.fantasyStart&&root().GameTime?.toTimestampKey?.(campaign.fantasyStart)||null}
function context(seedValue,identityValue){const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key),world=root().WorldState,ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"protagonist-skills",protagonistId:actorId,identityKey:key,authority:"ProtagonistSkills"})||null;return freeze({seed,identityKey:key,protagonistId:actorId,ref})}
function sourceRef(value){if(!value||typeof value!=="object")return null;const kind=cleanId(value.kind||value.type||"entity",80)||"entity",id=cleanId(value.id||value.entityId||"",160);return id?freeze({kind,id}):null}
function skillDefinition(skillIdValue){const skillId=cleanId(skillIdValue,64);return SKILL_DEFS[skillId]||null}
function levelForPoints(pointsValue){const points=Math.max(0,Math.min(MAX_POINTS,Math.floor(Number(pointsValue)||0)));let level=0;for(let i=1;i<LEVEL_THRESHOLDS.length;i++)if(points>=LEVEL_THRESHOLDS[i])level=i;return level}
function initialPoints(seed,protagonist,skillId){return 400+(hashNumber(seed+"|"+protagonist+"|"+skillId+"|skill-baseline-v1")%901)}
function initialSkills(ctx){const skills={};for(const skillId of Object.keys(SKILL_DEFS)){const points=initialPoints(ctx.seed,ctx.protagonistId,skillId);skills[skillId]={skillId,points,level:levelForPoints(points)}}return skills}
function initialState(ctx,when){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,lastFantasyTimestamp:String(when),lastSecondIndex:secondIndex(when),revision:1,skills:initialSkills(ctx),history:[],recentOperations:[]}}
function compatibleState(raw,ctx){
  if(!raw||typeof raw!=="object"||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION)return false;
  if(raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!validTimestamp(raw.lastFantasyTimestamp)||secondIndex(raw.lastFantasyTimestamp)!==raw.lastSecondIndex||!Number.isInteger(raw.revision)||raw.revision<1)return false;
  if(!raw.skills||typeof raw.skills!=="object"||Array.isArray(raw.skills))return false;
  for(const skillId of Object.keys(SKILL_DEFS)){const row=raw.skills[skillId];if(!row||row.skillId!==skillId||!Number.isInteger(row.points)||row.points<0||row.points>MAX_POINTS||row.level!==levelForPoints(row.points))return false}
  if(Object.keys(raw.skills).length!==Object.keys(SKILL_DEFS).length)return false;
  if(!Array.isArray(raw.history)||raw.history.length>MAX_HISTORY||!Array.isArray(raw.recentOperations)||raw.recentOperations.length>MAX_RECENT_OPERATIONS)return false;
  const opIds=new Set();for(const op of raw.recentOperations){if(!op||!cleanId(op.operationId,160)||cleanId(op.operationId,160)!==op.operationId||!/^SKO-[0-9A-F]{8}$/.test(String(op.signature||""))||opIds.has(op.operationId))return false;opIds.add(op.operationId)}
  let previous=-Infinity;
  for(const row of raw.history){
    if(!row||!/^SKP-[0-9A-F]{8}$/.test(String(row.id||""))||!skillDefinition(row.skillId)||!PRACTICE_BANDS[row.practiceBand]||!validTimestamp(row.fantasyTimestamp)||!sourceRef(row.sourceRef))return false;
    if(!Number.isInteger(row.pointsAwarded)||row.pointsAwarded!==PRACTICE_BANDS[row.practiceBand]||!Number.isInteger(row.pointsBefore)||!Number.isInteger(row.pointsAfter)||row.pointsAfter<row.pointsBefore||row.pointsAfter>MAX_POINTS)return false;
    const idx=secondIndex(row.fantasyTimestamp);if(idx<previous||idx>raw.lastSecondIndex)return false;previous=idx;
    if(!row.operationId||!opIds.has(row.operationId))return false;
  }
  return utf8Bytes(stableStringify(raw))<=MAX_STATE_BYTES;
}
function readState(seedValue,identityValue){bump("reads");const ctx=context(seedValue,identityValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistSkillsState;if(raw==null)return {ctx,resolved,compatible:true,exists:false,state:null,reason:"empty"};if(!compatibleState(raw,ctx))return {ctx,resolved,compatible:false,exists:true,state:null,reason:"skills-state-incompatible"};return {ctx,resolved,compatible:true,exists:true,state:clone(raw),reason:"ok"}}
function writeState(ctx,stateValue,reasonValue){const world=root().WorldState;if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});const next=clone(stateValue);if(!compatibleState(next,ctx))return freeze({ok:false,reason:"skills-state-invalid"});const serializedBytes=utf8Bytes(stableStringify(next));if(serializedBytes>MAX_STATE_BYTES)return freeze({ok:false,reason:"skills-state-size-exceeded",serializedBytes,maxStateBytes:MAX_STATE_BYTES});const result=world.applyDelta(ctx.seed,ctx.ref,{protagonistSkillsState:next},String(reasonValue||"protagonist-skills"));if(result?.ok)bump("writes");return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",serializedBytes,stateRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0)})}
function initialize(seedValue,identityValue,startTimestampValue){const read=readState(seedValue,identityValue);if(!read.compatible){bump("rejections");return freeze({ok:false,reason:read.reason})}if(read.exists)return freeze({ok:true,reason:"already-initialized",created:false,snapshot:snapshotFromRead(read)});const when=String(startTimestampValue||campaignStartTimestamp()||currentTimestamp()||"");if(!validTimestamp(when)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}const write=writeState(read.ctx,initialState(read.ctx,when),"protagonist-skills-initialize");if(!write.ok){bump("rejections");return write}bump("initializations");return freeze({...write,created:true,snapshot:snapshot(seedValue,identityValue)})}
function ensure(seedValue,identityValue,when){let read=readState(seedValue,identityValue);if(!read.compatible)return {ok:false,reason:read.reason,read};if(!read.exists){const init=initialize(seedValue,identityValue,when);if(!init.ok)return {ok:false,reason:init.reason,read};read=readState(seedValue,identityValue)}return {ok:true,read}}
function practiceEvidence(options,skillId,ctx,when){
  if(options?.authority!=="simulation"||options?.authoritative!==true)return {ok:false,reason:"simulation-authority-required"};
  if(cleanText(options.campaignSeed,160)!==ctx.seed)return {ok:false,reason:"campaign-seed-mismatch"};
  const operationId=cleanId(options.operationId||options.eventId||"",160);if(!operationId)return {ok:false,reason:"operation-id-required"};
  const evidence=options.evidence&&typeof options.evidence==="object"?options.evidence:null;if(!evidence||evidence.validated!==true||evidence.type!=="validated-skill-practice")return {ok:false,reason:"validated-practice-evidence-required"};
  if(cleanId(evidence.skillId,64)!==skillId)return {ok:false,reason:"practice-evidence-skill-mismatch"};
  if(evidence.protagonistId&&cleanId(evidence.protagonistId,160)!==ctx.protagonistId)return {ok:false,reason:"practice-evidence-protagonist-mismatch"};
  const practiceBand=cleanId(evidence.practiceBand,32);if(!PRACTICE_BANDS[practiceBand])return {ok:false,reason:"unsupported-practice-band"};
  if(!["completed","success"].includes(cleanId(evidence.outcome,32)))return {ok:false,reason:"terminal-practice-outcome-required"};
  const source=sourceRef(evidence.sourceRef||evidence.source);if(!source)return {ok:false,reason:"practice-evidence-source-required"};
  const signature="SKO-"+hashText(stableStringify({seed:ctx.seed,protagonistId:ctx.protagonistId,operationId,skillId,practiceBand,fantasyTimestamp:when,sourceRef:source,outcome:cleanId(evidence.outcome,32)}));
  return {ok:true,operationId,practiceBand,source,signature};
}
function recordPractice(seedValue,skillIdValue,optionsValue,identityValue){
  const skillId=cleanId(skillIdValue,64),definition=skillDefinition(skillId);if(!definition){bump("rejections");return freeze({ok:false,reason:"unsupported-skill"})}
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{},when=String(options.fantasyTimestamp||options.timestamp||currentTimestamp()||"");if(!validTimestamp(when)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}
  const ensured=ensure(seedValue,identityValue,when);if(!ensured.ok){bump("rejections");return freeze({ok:false,reason:ensured.reason})}const read=ensured.read,evidence=practiceEvidence(options,skillId,read.ctx,when);if(!evidence.ok){bump("rejections");return freeze(evidence)}
  const existing=read.state.recentOperations.find(row=>row.operationId===evidence.operationId);if(existing){if(existing.signature!==evidence.signature){bump("rejections");return freeze({ok:false,reason:"duplicate-operation-conflict",operationId:evidence.operationId})}bump("duplicates");return freeze({ok:true,reason:"duplicate",duplicate:true,operationId:evidence.operationId,snapshot:snapshotFromRead(read)})}
  const whenIndex=secondIndex(when);if(whenIndex<read.state.lastSecondIndex){bump("rejections");return freeze({ok:false,reason:"cannot-rewind-skills-state",operationId:evidence.operationId,snapshot:snapshotFromRead(read)})}
  const next=clone(read.state),skill=next.skills[skillId],pointsBefore=skill.points,levelBefore=skill.level,pointsAwarded=PRACTICE_BANDS[evidence.practiceBand],pointsAfter=Math.min(MAX_POINTS,pointsBefore+pointsAwarded),levelAfter=levelForPoints(pointsAfter),recordId="SKP-"+hashText(stableStringify({seed:read.ctx.seed,protagonistId:read.ctx.protagonistId,operationId:evidence.operationId,skillId,practiceBand:evidence.practiceBand,fantasyTimestamp:when,sourceRef:evidence.source}));
  skill.points=pointsAfter;skill.level=levelAfter;next.lastFantasyTimestamp=when;next.lastSecondIndex=whenIndex;next.revision+=1;next.recentOperations=[...next.recentOperations,{operationId:evidence.operationId,signature:evidence.signature}].slice(-MAX_RECENT_OPERATIONS);next.history=[...next.history,{id:recordId,operationId:evidence.operationId,skillId,practiceBand:evidence.practiceBand,pointsAwarded,pointsBefore,pointsAfter,levelBefore,levelAfter,fantasyTimestamp:when,sourceRef:clone(evidence.source)}].slice(-MAX_HISTORY);
  const write=writeState(read.ctx,next,"protagonist-skills-practice:"+recordId);if(!write.ok){bump("rejections");return write}bump("practiceAwards");return freeze({...write,duplicate:false,operationId:evidence.operationId,practice:freeze(clone(next.history[next.history.length-1])),snapshot:snapshot(seedValue,identityValue)})
}
function skillRows(state){return Object.keys(SKILL_DEFS).map(skillId=>{const current=state.skills[skillId];return freeze({...clone(SKILL_DEFS[skillId]),points:current.points,level:current.level,nextLevel:current.level>=LEVEL_THRESHOLDS.length-1?null:current.level+1,nextThreshold:current.level>=LEVEL_THRESHOLDS.length-1?null:LEVEL_THRESHOLDS[current.level+1]})})}
function snapshotFromRead(read){
  if(!read?.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:false,exists:true,reason:read?.reason||"incompatible",bounded:true,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false});
  const state=read?.exists&&read.state?read.state:initialState(read.ctx,campaignStartTimestamp()||currentTimestamp()||"0001-01-01 00:00:00"),persisted=Boolean(read?.exists&&read.state),serializedBytes=persisted?utf8Bytes(stableStringify(state)):0;
  return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,exists:persisted,seed:read.ctx.seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,registryId:read.ctx.ref?.id||null,revision:state.revision,lastFantasyTimestamp:state.lastFantasyTimestamp,skills:freeze(skillRows(state)),history:freeze(state.history.map(clone)),recentOperationCount:state.recentOperations.length,serializedBytes,maxStateBytes:MAX_STATE_BYTES,foundationAuthority:"Campaign SEED only",chronologyAuthority:"Fantasy Game Time",practiceAuthority:"explicit validated Simulation practice evidence only",persistenceAuthority:"WorldState CampaignStateDelta",qualificationAuthority:"read-only prerequisite evaluation",bounded:true,maxHistory:MAX_HISTORY,maxRecentOperations:MAX_RECENT_OPERATIONS,maxQuerySkills:MAX_QUERY_SKILLS,maxQualificationRequirements:MAX_QUALIFICATION_REQUIREMENTS,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,directActionExecution:false,directWorldMutation:false,professionAuthority:false,rankAuthority:false,legitimateAuthorityGrant:false,inventoryAuthority:false,economyAuthority:false,combatAuthority:false,uiPracticeAuthority:false,dialoguePracticeAuthority:false,llmPracticeAuthority:false})
}
function snapshot(seedValue,identityValue){return snapshotFromRead(readState(seedValue,identityValue))}
function getSkill(seedValue,skillIdValue,identityValue){bump("reads");const skillId=cleanId(skillIdValue,64);if(!skillDefinition(skillId))return null;return snapshot(seedValue,identityValue).skills.find(row=>row.skillId===skillId)||null}
function list(seedValue,optionsValue,identityValue){bump("reads");const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{},limit=Math.max(1,Math.min(MAX_QUERY_SKILLS,Math.floor(Number(options.limit)||MAX_QUERY_SKILLS)));return freeze(snapshot(seedValue,identityValue).skills.slice(0,limit).map(clone))}
function qualificationCheck(seedValue,requirementsValue,identityValue){bump("qualificationQueries");const raw=Array.isArray(requirementsValue)?requirementsValue.slice(0,MAX_QUALIFICATION_REQUIREMENTS):[],seen=new Set(),requirements=[];for(const item of raw){if(!item||typeof item!=="object")continue;const skillId=cleanId(item.skillId,64),minLevel=Math.floor(Number(item.minLevel));if(!skillDefinition(skillId)||!Number.isInteger(minLevel)||minLevel<0||minLevel>=LEVEL_THRESHOLDS.length||seen.has(skillId))continue;seen.add(skillId);requirements.push({skillId,minLevel})}const snap=snapshot(seedValue,identityValue),passed=[],failed=[];for(const requirement of requirements){const skill=snap.skills.find(row=>row.skillId===requirement.skillId),row=freeze({skillId:requirement.skillId,minLevel:requirement.minLevel,currentLevel:skill?.level??null,currentPoints:skill?.points??null});(skill&&skill.level>=requirement.minLevel?passed:failed).push(row)}return freeze({qualified:requirements.length>0&&failed.length===0,requirements:freeze(requirements.map(clone)),passed:freeze(passed),failed:freeze(failed),requestedCount:requirements.length,bounded:true,maxRequirements:MAX_QUALIFICATION_REQUIREMENTS,readOnly:true,grantsProfession:false,grantsRank:false,grantsAuthority:false,directActionExecution:false,simulationValidationBypass:false})}
function decisionContext(seedValue,identityValue){const snap=snapshot(seedValue,identityValue);return freeze({available:true,protagonistId:snap.protagonistId,skills:freeze(snap.skills.slice(0,MAX_QUERY_SKILLS).map(row=>({skillId:row.skillId,level:row.level}))),readOnly:true,authoritySource:"ProtagonistSkills",professionAuthority:false,rankAuthority:false,directActionExecution:false,worldMutation:false})}
function telemetry(){return freeze({...telemetryState,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,authority:false,bounded:true})}

root().ProtagonistSkills=Object.freeze({VERSION,SCHEMA,SCHEMA_VERSION,DEFAULT_IDENTITY_KEY,SKILL_DEFS,PRACTICE_BANDS,LEVEL_THRESHOLDS,MAX_HISTORY,MAX_RECENT_OPERATIONS,MAX_QUERY_SKILLS,MAX_QUALIFICATION_REQUIREMENTS,MAX_STATE_BYTES,MAX_POINTS,initialize,recordPractice,snapshot,getSkill,list,qualificationCheck,decisionContext,telemetry});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistSkills;
})();
