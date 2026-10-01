(function(){
"use strict";

const VERSION="advisor-progression-v1";
const SCHEMA="AdvisorProgressionLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="advisor-progression-ledger";
const REGISTRY_KEY="advisor-profile";
const MAX_EVENTS=128;
const MAX_LEDGER_BYTES=64*1024;
const MAX_QUERY_RESULTS=24;
const MAX_LEVEL=20;
const MAX_TOTAL_XP=25000;
const SKILLS=Object.freeze(["insight","rhetoric","diplomacy","stewardship","command","intrigue"]);
const REWARD_XP=Object.freeze({practice:20,success:40,strong:70,milestone:120});
const ACCEPTED_EVIDENCE_KIND="advisor-tool-result";
const ACCEPTED_EVIDENCE_AUTHORITY="AdvisorToolResolution";

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;let n=0;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);n+=c<0x80?1:c<0x800?2:(c>=0xD800&&c<=0xDBFF&&i+1<text.length&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3)}return n}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function validTimestamp(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function timestamp(value){const out=cleanText(value,32);if(!validTimestamp(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out}
function requiredSeed(value){const seed=cleanText(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function skillId(value){const skill=cleanId(value,40).toLowerCase();if(!SKILLS.includes(skill))throw new Error("Unsupported Advisor skill.");return skill}
function advisorProfileId(seed){return "ADVISOR-"+hashText(seed+"|advisor-profile-v1")}
function thresholdForLevel(levelValue){const level=Math.max(1,Math.min(MAX_LEVEL,Math.floor(Number(levelValue)||1)));if(level<=1)return 0;return 25*(level-1)*(level+2)}
function levelFromXp(xpValue){const xp=Math.max(0,Math.min(MAX_TOTAL_XP,Math.floor(Number(xpValue)||0)));let level=1;while(level<MAX_LEVEL&&xp>=thresholdForLevel(level+1))level++;return level}
function trackView(skill,totalXp,eventCount){
  const xp=Math.max(0,Math.min(MAX_TOTAL_XP,Math.floor(Number(totalXp)||0))),level=levelFromXp(xp),floor=thresholdForLevel(level),next=level<MAX_LEVEL?thresholdForLevel(level+1):floor;
  return freeze({skill,level,totalXp:xp,currentLevelXp:xp-floor,nextLevelXp:level<MAX_LEVEL?next-floor:0,nextLevelTotalXp:level<MAX_LEVEL?next:null,atMaxLevel:level>=MAX_LEVEL,eventCount:Math.max(0,Math.floor(Number(eventCount)||0))});
}
function registryContext(seedValue){
  const seed=requiredSeed(seedValue),profileId=advisorProfileId(seed),world=root().WorldState;
  const ref=world?.structuralRef?.(seed,REGISTRY_KIND,profileId,REGISTRY_KEY,{role:"persistent-advisor-progression",advisorProfileId:profileId,authority:"AdvisorProgression capability metadata"})||null;
  return freeze({seed,advisorProfileId:profileId,ref});
}
function emptyLedger(ctx){
  const totals={};for(const skill of SKILLS)totals[skill]=0;
  return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,advisorProfileId:ctx.advisorProfileId,registryId:ctx.ref?.id||null,revision:0,lastFantasyTimestamp:null,totals,events:[],bounds:{maxEvents:MAX_EVENTS,maxBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,maxLevel:MAX_LEVEL,maxTotalXp:MAX_TOTAL_XP}};
}
function eventValid(event,seed){
  if(!plain(event)||!/^APX-[0-9A-F]{8}$/.test(String(event.id||"")))return false;
  if(!SKILLS.includes(event.skill)||!Object.prototype.hasOwnProperty.call(REWARD_XP,event.rewardBand)||event.xp!==REWARD_XP[event.rewardBand])return false;
  if(!validTimestamp(event.fantasyTimestamp)||event.campaignSeed!==seed)return false;
  if(event.evidenceKind!==ACCEPTED_EVIDENCE_KIND||event.evidenceAuthority!==ACCEPTED_EVIDENCE_AUTHORITY||event.validated!==true)return false;
  if(!event.toolId||!event.outcomeId||!event.sourceSystem)return false;
  return true;
}
function compatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.advisorProfileId!==ctx.advisorProfileId||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!plain(raw.totals)||!Array.isArray(raw.events)||raw.events.length>MAX_EVENTS)return false;
  const ids=new Set(),sums={};for(const skill of SKILLS)sums[skill]=0;
  let latest=null;
  for(const event of raw.events){
    if(!eventValid(event,ctx.seed)||ids.has(event.id))return false;
    ids.add(event.id);sums[event.skill]+=event.xp;if(latest===null||event.fantasyTimestamp>latest)latest=event.fantasyTimestamp;
  }
  for(const skill of SKILLS){
    if(!Number.isInteger(raw.totals[skill])||raw.totals[skill]<0||raw.totals[skill]>MAX_TOTAL_XP||raw.totals[skill]!==sums[skill])return false;
  }
  if(raw.lastFantasyTimestamp!==latest)return false;
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function readLedger(seedValue){
  const ctx=registryContext(seedValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.advisorProgression;
  if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
  if(!compatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
  return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
}
function writeLedger(seedValue,ledgerValue,reasonValue){
  const read=readLedger(seedValue),ctx=read.ctx,world=root().WorldState;if(!read.compatible)return freeze({ok:false,reason:read.reason});
  if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
  const next=clone(ledgerValue);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.advisorProfileId=ctx.advisorProfileId;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
  if(!compatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
  const result=world.applyDelta(ctx.seed,ctx.ref,{advisorProgression:next},String(reasonValue||"advisor-progression"));
  return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),eventCount:next.events.length,serializedBytes:utf8Bytes(stable(next))});
}
function normalizeEvidence(seedValue,skillValue,evidenceValue){
  const seed=requiredSeed(seedValue),skill=skillId(skillValue),evidence=plain(evidenceValue)?evidenceValue:{};
  if(evidence.campaignSeed!==seed)throw new Error("Progression evidence campaign mismatch.");
  if(evidence.kind!==ACCEPTED_EVIDENCE_KIND)throw new Error("Unsupported progression evidence kind.");
  if(evidence.authority!==ACCEPTED_EVIDENCE_AUTHORITY)throw new Error("Progression evidence authority is invalid.");
  if(evidence.validated!==true)throw new Error("Progression evidence must be validated.");
  const rewardBand=cleanId(evidence.rewardBand,40).toLowerCase();if(!Object.prototype.hasOwnProperty.call(REWARD_XP,rewardBand))throw new Error("Unsupported progression reward band.");
  const fantasyTimestamp=timestamp(evidence.fantasyTimestamp),toolId=cleanId(evidence.toolId,120),outcomeId=cleanId(evidence.outcomeId,160),sourceSystem=cleanId(evidence.sourceSystem,120);
  if(!toolId||!outcomeId||!sourceSystem)throw new Error("Progression evidence requires toolId, outcomeId and sourceSystem.");
  const basis={seed,skill,rewardBand,fantasyTimestamp,toolId,outcomeId,sourceSystem,evidenceKind:evidence.kind,evidenceAuthority:evidence.authority};
  return freeze({id:"APX-"+hashText(stable(basis)),skill,rewardBand,xp:REWARD_XP[rewardBand],fantasyTimestamp,campaignSeed:seed,toolId,outcomeId,sourceSystem,evidenceKind:evidence.kind,evidenceAuthority:evidence.authority,validated:true});
}
function award(seedValue,skillValue,evidenceValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);if(!read.compatible)return freeze({ok:false,reason:read.reason,event:null});
  let event;try{event=normalizeEvidence(seed,skillValue,evidenceValue)}catch(error){return freeze({ok:false,reason:String(error.message||error),event:null})}
  const existing=read.ledger.events.find(row=>row.id===event.id);
  if(existing)return freeze({ok:true,reason:"duplicate",duplicate:true,event:freeze(clone(existing)),track:trackView(existing.skill,read.ledger.totals[existing.skill],read.ledger.events.filter(row=>row.skill===existing.skill).length)});
  if(read.ledger.events.length>=MAX_EVENTS)return freeze({ok:false,reason:"progression-event-limit-reached",event:null,eventCount:read.ledger.events.length});
  if(read.ledger.lastFantasyTimestamp&&event.fantasyTimestamp<read.ledger.lastFantasyTimestamp)return freeze({ok:false,reason:"cannot-rewind-progression-chronology",event:null});
  const current=read.ledger.totals[event.skill],nextXp=Math.min(MAX_TOTAL_XP,current+event.xp);
  if(nextXp===current)return freeze({ok:false,reason:"skill-xp-cap-reached",event:null,track:trackView(event.skill,current,read.ledger.events.filter(row=>row.skill===event.skill).length)});
  const next=clone(read.ledger);next.events.push(clone(event));next.totals[event.skill]=nextXp;next.lastFantasyTimestamp=event.fantasyTimestamp;
  const write=writeLedger(seed,next,"advisor-progression-award:"+event.id);
  return freeze({...write,duplicate:false,event:write.ok?event:null,track:write.ok?trackView(event.skill,nextXp,next.events.filter(row=>row.skill===event.skill).length):null});
}
function catalog(){
  return freeze({version:VERSION,skills:freeze(SKILLS.map(skill=>freeze({id:skill,label:skill.charAt(0).toUpperCase()+skill.slice(1)}))),rewardBands:freeze(Object.keys(REWARD_XP).map(id=>freeze({id,xp:REWARD_XP[id]}))),maxLevel:MAX_LEVEL,thresholds:freeze(Array.from({length:MAX_LEVEL},(_,i)=>freeze({level:i+1,totalXp:thresholdForLevel(i+1)})))});
}
function getSkill(seedValue,skillValue){
  const skill=skillId(skillValue),read=readLedger(seedValue);if(!read.compatible)return null;
  return trackView(skill,read.ledger.totals[skill],read.ledger.events.filter(row=>row.skill===skill).length);
}
function listEvents(seedValue,optionsValue){
  const read=readLedger(seedValue),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze([]);
  let rows=read.ledger.events.slice(),skill=null;if(options.skill!==undefined){try{skill=skillId(options.skill)}catch(_){return freeze([])}rows=rows.filter(row=>row.skill===skill)}
  const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.limit)||MAX_QUERY_RESULTS)));
  rows.sort((a,b)=>String(b.fantasyTimestamp).localeCompare(String(a.fantasyTimestamp))||String(a.id).localeCompare(String(b.id)));
  return freeze(rows.slice(0,limit).map(row=>freeze(clone(row))));
}
function snapshot(seedValue){
  const seed=requiredSeed(seedValue),read=readLedger(seed);if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,skills:freeze([]),events:freeze([]),bounded:true});
  const skills=SKILLS.map(skill=>trackView(skill,read.ledger.totals[skill],read.ledger.events.filter(row=>row.skill===skill).length));
  return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,advisorProfileId:read.ctx.advisorProfileId,registryId:read.ctx.ref?.id||null,compatible:true,reason:read.reason,ledgerRevision:Number(read.ledger.revision||0),deltaRevision:Number(read.resolved?.delta?.revision||0),lastFantasyTimestamp:read.ledger.lastFantasyTimestamp,eventCount:read.ledger.events.length,serializedBytes:utf8Bytes(stable(read.ledger)),skills:freeze(skills),events:freeze(read.ledger.events.map(row=>freeze(clone(row)))),maxEvents:MAX_EVENTS,maxLedgerBytes:MAX_LEDGER_BYTES,maxQueryResults:MAX_QUERY_RESULTS,maxLevel:MAX_LEVEL,maxTotalXp:MAX_TOTAL_XP,bounded:true,indexedByStableEventId:true,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",progressionAuthority:"validated Advisor tool/outcome evidence only",fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,gameplayWorldMutation:false,inventoryAuthority:false,politicalAuthority:false,protagonistDecisionAuthority:false,guaranteedPersuasion:false,worldTruthAuthority:false,simulationValidationBypass:false,providerPayloadPersisted:false,presentationStatePersisted:false});
}
const api=Object.freeze({VERSION,SCHEMA,SCHEMA_VERSION,SKILLS,REWARD_XP,MAX_EVENTS,MAX_LEDGER_BYTES,MAX_QUERY_RESULTS,MAX_LEVEL,MAX_TOTAL_XP,thresholdForLevel,levelFromXp,catalog,getSkill,listEvents,snapshot,award});
root().AdvisorProgression=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();