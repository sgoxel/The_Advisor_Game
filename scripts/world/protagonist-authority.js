(function(){
"use strict";

const VERSION="protagonist-authority-v1";
const SCHEMA="ProtagonistAuthorityState";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-authority-state";
const REGISTRY_KEY="legitimate-authority-v1";
const DEFAULT_IDENTITY_KEY="protagonist";
const MAX_HISTORY=16;
const MAX_RECENT_TRANSITIONS=64;
const MAX_QUERY_SCOPES=16;
const MAX_STATE_BYTES=32768;
const BASE_ROLE_ID="local-resident";
const ROLE_DEFS=Object.freeze({
  "local-resident":Object.freeze({roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:Object.freeze(["self"])}),
  "guild-member":Object.freeze({roleId:"guild-member",title:"Guild Member",rankTier:1,rankLabel:"recognized-local-role",scopes:Object.freeze(["self","guild:participate"])}),
  "knight":Object.freeze({roleId:"knight",title:"Knight",rankTier:2,rankLabel:"local-protection-role",scopes:Object.freeze(["self","local:protection","local:escort","local:patrol"])}),
  "village-steward":Object.freeze({roleId:"village-steward",title:"Village Steward",rankTier:2,rankLabel:"local-authority",scopes:Object.freeze(["self","settlement:administration","settlement:request-assistance"])}),
  "regional-magistrate":Object.freeze({roleId:"regional-magistrate",title:"Regional Magistrate",rankTier:3,rankLabel:"regional-authority",scopes:Object.freeze(["self","settlement:administration","region:adjudication","region:request-assistance"])}),
  "realm-councillor":Object.freeze({roleId:"realm-councillor",title:"Realm Councillor",rankTier:4,rankLabel:"realm-advisory-authority",scopes:Object.freeze(["self","region:adjudication","realm:advise","realm:request-audience"])})
});
const telemetryState={reads:0,writes:0,initializations:0,transitions:0,duplicates:0,rejections:0,queries:0};

function root(){return typeof window!=="undefined"?window:globalThis}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function stableStringify(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stableStringify).join(",")+"]";return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableStringify(value[key])).join(",")+"}"}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0).toString(16).toUpperCase().padStart(8,"0")}
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
function context(seedValue,identityValue){const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key),world=root().WorldState,ref=world?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"protagonist-authority",protagonistId:actorId,identityKey:key,authority:"ProtagonistAuthority"})||null;return freeze({seed,identityKey:key,protagonistId:actorId,ref})}
function sourceRef(value){if(!value||typeof value!=="object")return null;const kind=cleanId(value.kind||value.type||"entity",80)||"entity",id=cleanId(value.id||value.entityId||"",160);return id?freeze({kind,id}):null}
function roleDefinition(roleIdValue){const roleId=cleanId(roleIdValue,80);return ROLE_DEFS[roleId]||null}
function initialState(ctx,when){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,currentRoleId:BASE_ROLE_ID,lastFantasyTimestamp:String(when),lastSecondIndex:secondIndex(when),revision:1,history:[],recentTransitionIds:[]}}
function compatibleState(raw,ctx){
  if(!raw||typeof raw!=="object"||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION)return false;
  if(raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!roleDefinition(raw.currentRoleId)||!validTimestamp(raw.lastFantasyTimestamp)||secondIndex(raw.lastFantasyTimestamp)!==raw.lastSecondIndex||!Number.isInteger(raw.revision)||raw.revision<1)return false;
  if(!Array.isArray(raw.history)||raw.history.length>MAX_HISTORY||!Array.isArray(raw.recentTransitionIds)||raw.recentTransitionIds.length>MAX_RECENT_TRANSITIONS)return false;
  const ids=new Set();for(const id of raw.recentTransitionIds){if(!id||cleanId(id)!==id||ids.has(id))return false;ids.add(id)}
  let previous=-Infinity;
  for(const row of raw.history){
    if(!row||!/^AUTH-[0-9A-F]{8}$/.test(String(row.id||""))||!roleDefinition(row.fromRoleId)||!roleDefinition(row.toRoleId)||!validTimestamp(row.fantasyTimestamp)||!sourceRef(row.sourceRef))return false;
    const idx=secondIndex(row.fantasyTimestamp);if(idx<previous||idx>raw.lastSecondIndex)return false;previous=idx;
    if(!row.transitionId||!ids.has(row.transitionId))return false;
  }
  return utf8Bytes(stableStringify(raw))<=MAX_STATE_BYTES;
}
function readState(seedValue,identityValue){bump("reads");const ctx=context(seedValue,identityValue),resolved=ctx.ref&&root().WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistAuthorityState;if(raw==null)return {ctx,resolved,compatible:true,exists:false,state:null,reason:"empty"};if(!compatibleState(raw,ctx))return {ctx,resolved,compatible:false,exists:true,state:null,reason:"authority-state-incompatible"};return {ctx,resolved,compatible:true,exists:true,state:clone(raw),reason:"ok"}}
function writeState(ctx,stateValue,reasonValue){const world=root().WorldState;if(!ctx.ref||!world?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});const next=clone(stateValue);if(!compatibleState(next,ctx))return freeze({ok:false,reason:"authority-state-invalid"});const serializedBytes=utf8Bytes(stableStringify(next));if(serializedBytes>MAX_STATE_BYTES)return freeze({ok:false,reason:"authority-state-size-exceeded",serializedBytes,maxStateBytes:MAX_STATE_BYTES});const result=world.applyDelta(ctx.seed,ctx.ref,{protagonistAuthorityState:next},String(reasonValue||"protagonist-authority"));if(result?.ok)bump("writes");return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",serializedBytes,stateRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0)})}
function initialize(seedValue,identityValue,startTimestampValue){const read=readState(seedValue,identityValue);if(!read.compatible){bump("rejections");return freeze({ok:false,reason:read.reason})}if(read.exists)return freeze({ok:true,reason:"already-initialized",created:false,snapshot:snapshotFromRead(read)});const when=String(startTimestampValue||campaignStartTimestamp()||currentTimestamp()||"");if(!validTimestamp(when)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}const write=writeState(read.ctx,initialState(read.ctx,when),"protagonist-authority-initialize");if(!write.ok){bump("rejections");return write}bump("initializations");return freeze({...write,created:true,snapshot:snapshot(seedValue,identityValue)})}
function ensure(seedValue,identityValue,when){let read=readState(seedValue,identityValue);if(!read.compatible)return {ok:false,reason:read.reason,read};if(!read.exists){const init=initialize(seedValue,identityValue,when);if(!init.ok)return {ok:false,reason:init.reason,read};read=readState(seedValue,identityValue)}return {ok:true,read}}
function transitionEvidence(options,targetRoleId,ctx){
  if(options?.authority!=="simulation"||options?.authoritative!==true)return {ok:false,reason:"simulation-authority-required"};
  const transitionId=cleanId(options.transitionId||options.operationId||options.eventId||"",160);if(!transitionId)return {ok:false,reason:"transition-id-required"};
  const evidence=options.evidence&&typeof options.evidence==="object"?options.evidence:null;if(!evidence||evidence.validated!==true||evidence.type!=="legitimate-role-transition")return {ok:false,reason:"validated-transition-evidence-required"};
  if(cleanId(evidence.targetRoleId,80)!==targetRoleId)return {ok:false,reason:"transition-evidence-target-mismatch"};
  if(evidence.protagonistId&&cleanId(evidence.protagonistId,160)!==ctx.protagonistId)return {ok:false,reason:"transition-evidence-protagonist-mismatch"};
  const source=sourceRef(evidence.sourceRef||evidence.source);if(!source)return {ok:false,reason:"transition-evidence-source-required"};
  return {ok:true,transitionId,source,evidence};
}
function transition(seedValue,identityValue,targetRoleValue,optionsValue){
  const targetRoleId=cleanId(targetRoleValue,80),target=roleDefinition(targetRoleId);if(!target){bump("rejections");return freeze({ok:false,reason:"unsupported-role"})}
  const options=optionsValue&&typeof optionsValue==="object"?optionsValue:{},when=String(options.fantasyTimestamp||options.timestamp||currentTimestamp()||"");if(!validTimestamp(when)){bump("rejections");return freeze({ok:false,reason:"fantasy-timestamp-required"})}
  const ensured=ensure(seedValue,identityValue,when);if(!ensured.ok){bump("rejections");return freeze({ok:false,reason:ensured.reason})}const read=ensured.read,auth=transitionEvidence(options,targetRoleId,read.ctx);if(!auth.ok){bump("rejections");return freeze(auth)}
  if(read.state.recentTransitionIds.includes(auth.transitionId)){bump("duplicates");return freeze({ok:true,reason:"duplicate",duplicate:true,transitionId:auth.transitionId,snapshot:snapshotFromRead(read)})}
  const whenIndex=secondIndex(when);if(whenIndex<read.state.lastSecondIndex){bump("rejections");return freeze({ok:false,reason:"cannot-rewind-authority-state",transitionId:auth.transitionId,snapshot:snapshotFromRead(read)})}
  if(read.state.currentRoleId===targetRoleId){bump("rejections");return freeze({ok:false,reason:"role-already-current",transitionId:auth.transitionId,snapshot:snapshotFromRead(read)})}
  const next=clone(read.state),fromRoleId=next.currentRoleId,recordId="AUTH-"+hashText(stableStringify({seed:read.ctx.seed,protagonistId:read.ctx.protagonistId,transitionId:auth.transitionId,fromRoleId,toRoleId:targetRoleId,fantasyTimestamp:when,sourceRef:auth.source}));
  next.currentRoleId=targetRoleId;next.lastFantasyTimestamp=when;next.lastSecondIndex=whenIndex;next.revision+=1;next.recentTransitionIds=[...next.recentTransitionIds.filter(id=>id!==auth.transitionId),auth.transitionId].slice(-MAX_RECENT_TRANSITIONS);next.history=[...next.history,{id:recordId,transitionId:auth.transitionId,fromRoleId,toRoleId:targetRoleId,fantasyTimestamp:when,sourceRef:clone(auth.source)}].slice(-MAX_HISTORY);
  const write=writeState(read.ctx,next,"protagonist-authority-transition:"+recordId);if(!write.ok){bump("rejections");return write}bump("transitions");return freeze({...write,duplicate:false,transitionId:auth.transitionId,transition:freeze(clone(next.history[next.history.length-1])),snapshot:snapshot(seedValue,identityValue)})
}
function snapshotFromRead(read){
  if(!read?.compatible||!read?.exists||!read.state)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:Boolean(read?.compatible),exists:false,reason:read?.reason||"empty",bounded:true,fullWorldScan:false,perFrameScan:false,directActionExecution:false});
  const state=read.state,role=roleDefinition(state.currentRoleId),serializedBytes=utf8Bytes(stableStringify(state));return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,exists:true,seed:read.ctx.seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,registryId:read.ctx.ref?.id||null,revision:state.revision,lastFantasyTimestamp:state.lastFantasyTimestamp,currentRole:freeze(clone(role)),history:freeze(state.history.map(clone)),recentTransitionIds:freeze(state.recentTransitionIds.slice()),serializedBytes,maxStateBytes:MAX_STATE_BYTES,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",mutationAuthority:"explicit Simulation-authorized role transitions",scopeAuthority:"fixed role catalog only",bounded:true,maxHistory:MAX_HISTORY,maxRecentTransitionIds:MAX_RECENT_TRANSITIONS,maxQueryScopes:MAX_QUERY_SCOPES,fullWorldScan:false,perFrameScan:false,directActionExecution:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,routeValidationBypass:false,resourceValidationBypass:false,actionValidationBypass:false,dialogueGrantAuthority:false,llmGrantAuthority:false,uiGrantAuthority:false})
}
function snapshot(seedValue,identityValue){return snapshotFromRead(readState(seedValue,identityValue))}
function hasScope(seedValue,scopeValue,identityValue){bump("queries");const scope=cleanId(scopeValue,120);if(!scope)return false;const snap=snapshot(seedValue,identityValue);return Boolean(snap.exists&&snap.currentRole.scopes.includes(scope))}
function filterScopes(seedValue,scopeValues,identityValue){bump("queries");const values=Array.isArray(scopeValues)?scopeValues.slice(0,MAX_QUERY_SCOPES):[],seen=new Set(),granted=[],rejected=[];for(const raw of values){const scope=cleanId(raw,120);if(!scope||seen.has(scope))continue;seen.add(scope);(hasScope(seedValue,scope,identityValue)?granted:rejected).push(scope)}return freeze({granted:freeze(granted),rejected:freeze(rejected),requestedCount:seen.size,bounded:true,maxQueryScopes:MAX_QUERY_SCOPES,readOnly:true,actionValidationBypass:false})}
function decisionContext(seedValue,identityValue){const snap=snapshot(seedValue,identityValue);return freeze({available:Boolean(snap.exists),protagonistId:snap.protagonistId||null,roleId:snap.currentRole?.roleId||null,rankTier:snap.currentRole?.rankTier??null,rankLabel:snap.currentRole?.rankLabel||null,scopes:freeze((snap.currentRole?.scopes||[]).slice(0,MAX_QUERY_SCOPES)),readOnly:true,authoritySource:"ProtagonistAuthority",directActionExecution:false,worldMutation:false})}
function telemetry(){return freeze({...telemetryState,fullWorldScan:false,perFrameScan:false,authority:false,bounded:true})}

root().ProtagonistAuthority=Object.freeze({VERSION,SCHEMA,SCHEMA_VERSION,DEFAULT_IDENTITY_KEY,BASE_ROLE_ID,ROLE_DEFS,MAX_HISTORY,MAX_RECENT_TRANSITIONS,MAX_QUERY_SCOPES,MAX_STATE_BYTES,initialize,transition,snapshot,hasScope,filterScopes,decisionContext,telemetry});
if(typeof module!=="undefined"&&module.exports)module.exports=root().ProtagonistAuthority;
})();
