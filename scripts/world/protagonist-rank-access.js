(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistRankAccess=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-rank-access-v2";
const MAX_RESULT_BYTES=16384;
const MAX_QUERY_CONTEXTS=8;
const MAX_REPUTATION_CONTEXTS=8;
const ROLE_RANKS=Object.freeze({
  "local-resident":0,
  "guild-member":1,
  "village-steward":2,
  "regional-magistrate":3,
  "realm-councillor":4
});
const telemetryState={localAccessQueries:0,npcReactionQueries:0,authorityReads:0,memoryReads:0,socialReads:0};
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const item of Object.values(v))F(item);return Object.freeze(v)}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function T(v,n=160){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function B(v){if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(String(v==null?"":v)).length;return String(v==null?"":v).length}
function bump(key){telemetryState[key]=Math.min(Number.MAX_SAFE_INTEGER,(telemetryState[key]||0)+1)}
function requiredSeed(seedValue){const seed=T(seedValue,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function roleRank(roleIdValue){const roleId=I(roleIdValue,80);return Object.prototype.hasOwnProperty.call(ROLE_RANKS,roleId)?ROLE_RANKS[roleId]:null}
function roleSnapshot(seedValue,identityValue){
  bump("authorityReads");
  try{
    const snap=root?.ProtagonistAuthority?.snapshot?.(seedValue,identityValue)||null;
    if(snap&&snap.exists!==false&&snap.currentRole){
      return F({exists:true,roleId:I(snap.currentRole.roleId||"local-resident",80),title:T(snap.currentRole.title||snap.currentRole.label||"Local Resident",120),rankTier:Number.isFinite(Number(snap.currentRole.rankTier))?Number(snap.currentRole.rankTier):0,rankLabel:T(snap.currentRole.rankLabel||"ordinary",80),scopes:Array.isArray(snap.currentRole.scopes)?snap.currentRole.scopes.map(x=>I(x,120)).filter(Boolean).slice(0,16):[],source:"ProtagonistAuthority"});
    }
  }catch(_){}
  try{
    const when=root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00";
    const state=root?.ProtagonistStatusObligations?.decisionContext?.(seedValue,when,identityValue)||null;
    if(state&&state.role){
      return F({exists:Boolean(state.ok!==false),roleId:I(state.role.roleId||"local-resident",80),title:T(state.role.title||state.role.label||"Local Resident",120),rankTier:Number.isFinite(Number(state.role.rankTier))?Number(state.role.rankTier):0,rankLabel:T(state.role.rankLabel||"ordinary",80),scopes:Array.isArray(state.role.scopes)?state.role.scopes.map(x=>I(x,120)).filter(Boolean).slice(0,16):[],source:"ProtagonistStatusObligations"});
    }
  }catch(_){}
  return F({exists:false,roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:["self"],source:"fallback"});
}
function localAccessContext(seedValue,identityValue,whenValue,targetValue){
  bump("localAccessQueries");
  const seed=requiredSeed(seedValue),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32),identity=I(identityValue||"protagonist",80);
  const target=targetValue&&typeof targetValue==="object"?targetValue:{},authority=roleSnapshot(seed,identity);
  const currentRole=authority.roleId||"local-resident",currentRank=Number.isFinite(Number(authority.rankTier))?Number(authority.rankTier):0;
  const requiredScope=I(target.requiredScope||target.scope||"self",120),requiredRoleId=I(target.requiredRoleId||target.requiredRole||target.roleId||"",80),label=T(target.label||target.kind||"local access",120);
  const scopeSet=new Set((authority.scopes||[]).map(x=>I(x,120)).filter(Boolean));
  let permitted=requiredScope==="self"||scopeSet.has(requiredScope),conditional=false,reason=permitted?"status-authority-scope-present":"missing-authority-scope";
  if(!permitted&&requiredRoleId){
    const requiredRank=roleRank(requiredRoleId);
    if(requiredRank!==null&&currentRank>=requiredRank){permitted=true;reason="status-authority-rank-qualified"}
    else if(currentRank>0){conditional=true;reason="status-authority-higher-role-conditional"}
  }
  const status=permitted?"permitted":conditional?"conditional":"restricted";
  const presentation=permitted?"Permitted for this legitimate role; the action still requires normal Simulation validation.":conditional?"Conditional local access; additional grounded context is required before the action may proceed.":"Restricted: this legitimate authority scope is not currently held.";
  const result={ok:status==="permitted",status,label,when,role:{roleId:currentRole,title:authority.title||"Local Resident",rankTier:currentRank,rankLabel:authority.rankLabel||"ordinary",scopes:(authority.scopes||[]).slice(0,16)},requiredScope:requiredScope||null,requiredRoleId:requiredRoleId||null,permitted,conditional,reason,presentation,readOnly:true,proposalOnly:true,eventDriven:true,sourceAuthority:authority.source,simulationValidationRequired:true,directActionExecution:false,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false};
  const bytes=B(S(result));
  if(bytes>MAX_RESULT_BYTES)return F({...result,ok:false,status:"restricted",permitted:false,conditional:false,reason:"status-context-over-budget",presentation:"Formal status access is temporarily unavailable.",serializedBytes:bytes,maxResultBytes:MAX_RESULT_BYTES});
  result.serializedBytes=bytes;result.maxResultBytes=MAX_RESULT_BYTES;return F(result);
}
function npcKnowledge(seed,residentId){
  let memory=null,social=null;
  bump("memoryReads");
  try{memory=root?.CharacterMemory?.recognition?.(seed,residentId)||null}catch(_){}
  bump("socialReads");
  try{social=root?.SocialState?.dialogueContext?.(seed,residentId)||null}catch(_){}
  const familiarity=String(memory?.familiarity||"").toLowerCase(),meaningful=Math.max(0,Number(memory?.meaningfulEncounterCount||0));
  const memoryKnown=Boolean(memory?.metBefore===true&&(meaningful>0||["known","familiar","trusted"].includes(familiarity)));
  const reputations=Array.isArray(social?.reputations)?social.reputations.slice(0,MAX_REPUTATION_CONTEXTS):[];
  const statusEvidence=reputations.some(row=>{
    const scope=String(row?.scope||"").toLowerCase(),events=Array.isArray(row?.eventIds)?row.eventIds.slice(0,8):[];
    return ["role","settlement","guild"].includes(scope)&&events.length>0&&Math.abs(Number(row?.score||0))>=0.05;
  });
  return F({grounded:Boolean(memoryKnown&&statusEvidence),memoryKnown,statusEvidence,memorySource:memory?"CharacterMemory.recognition":null,socialSource:social?"SocialState.dialogueContext":null,reputationEvidenceCount:reputations.filter(row=>Array.isArray(row?.eventIds)&&row.eventIds.length>0).length,maxReputationContexts:MAX_REPUTATION_CONTEXTS});
}
function npcReaction(seedValue,residentIdValue,identityValue,whenValue,targetValue){
  bump("npcReactionQueries");
  const seed=requiredSeed(seedValue),residentId=I(residentIdValue||"unknown",120),identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);
  const target=targetValue&&typeof targetValue==="object"?targetValue:{},label=T(target.label||target.kind||"this local situation",120),auth=roleSnapshot(seed,identity),knowledge=npcKnowledge(seed,residentId);
  const recognized=Boolean(auth.rankTier>0&&knowledge.grounded);
  const message=recognized
    ? "I recognize your standing as "+(auth.title||"a local officer")+". "+label+" still requires the proper local authorization and outcome."
    : auth.rankTier>0
      ? "This resident has no grounded knowledge of your formal standing here."
      : "No formal status is being acknowledged in this local exchange.";
  return F({ok:true,recognized,roleTitle:auth.title||"Local Resident",roleId:auth.roleId||"local-resident",rankTier:Number(auth.rankTier||0),sourceAuthority:auth.source,knowledge,message,readOnly:true,presentationOnly:true,relationshipMutation:false,worldMutation:false,socialOutcomeAuthority:"SocialState/Simulation only",fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,when});
}
function attemptAccess(seedValue,identityValue,whenValue,targetValue){
  const identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32),target=targetValue&&typeof targetValue==="object"?targetValue:{},action=I(target.action||target.intent||"use",80);
  const access=localAccessContext(seedValue,identity,when,target);
  if(access.status==="restricted")return F({ok:false,status:"rejected",reason:access.reason||"status-restricted",action,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions/Simulation"});
  if(access.status==="conditional")return F({ok:false,status:"conditional",reason:"additional-grounded-local-context-required",action,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"Simulation"});
  const objectId=I(target.objectId||target.id||"",160),actorPosition=target.actorPosition||{x:0,y:0};
  if(objectId&&root&&root.ObjectInteractions&&typeof root.ObjectInteractions.attempt==="function"){
    try{
      const result=root.ObjectInteractions.attempt(seedValue,{actorKind:"protagonist",actorId:identity,actorPosition,objectId,action});
      return F({ok:Boolean(result&&result.ok),status:result&&result.status?String(result.status):"evaluated",reason:result&&result.reason?String(result.reason):access.reason,action,objectId,access,result,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"});
    }catch(_){return F({ok:false,status:"rejected",reason:"object-interaction-check-failed",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"})}
  }
  return F({ok:true,status:"ready",reason:access.reason||"status-approved",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"Simulation"});
}
function telemetry(){return F({...telemetryState,maxQueryContexts:MAX_QUERY_CONTEXTS,maxReputationContexts:MAX_REPUTATION_CONTEXTS,eventDriven:true,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,relationshipMutation:false,worldMutation:false})}
function snapshot(seedValue,identityValue){
  return F({version:VERSION,bounded:true,eventDriven:true,readOnly:true,proposalOnly:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,localAccessContext:localAccessContext(seedValue||"seed",identityValue||"protagonist","1201-01-01 00:00:00",{requiredScope:"self"}),npcReaction:root?.SocialState&&root?.CharacterMemory?"available":"unavailable",performance:{maxResultBytes:MAX_RESULT_BYTES,maxQueryContexts:MAX_QUERY_CONTEXTS,maxReputationContexts:MAX_REPUTATION_CONTEXTS},telemetry:telemetry()});
}
function proof(){
  const seed="SEED-RANK-ACCESS",previousAuthority=root?.ProtagonistAuthority,previousMemory=root?.CharacterMemory,previousSocial=root?.SocialState;
  try{
    root.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:["self"]}}}};
    const ordinary=localAccessContext(seed,"protagonist","1201-05-01 09:00:00",{requiredScope:"settlement:administration",label:"Administrative work"});
    root.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:"guild-member",title:"Guild Member",rankTier:1,rankLabel:"recognized-local-role",scopes:["self","guild:participate"]}}}};
    const conditional=localAccessContext(seed,"protagonist","1201-05-01 09:30:00",{requiredScope:"settlement:administration",requiredRoleId:"village-steward",label:"Administrative work"});
    root.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:"village-steward",title:"Village Steward",rankTier:2,rankLabel:"local-authority",scopes:["self","settlement:administration","settlement:request-assistance"]}}}};
    root.CharacterMemory={recognition(_s,id){return id==="R-KNOWN"?{metBefore:true,meaningfulEncounterCount:3,familiarity:"known"}:{metBefore:false,meaningfulEncounterCount:0,familiarity:"stranger"}}};
    root.SocialState={dialogueContext(_s,id){return{values:{trust:.7,respect:.7,suspicion:.1,fear:.1},reputations:id==="R-KNOWN"?[{scope:"settlement",score:.6,eventIds:["SOC-E1"]}]:[]}}};
    const steward=localAccessContext(seed,"protagonist","1201-05-01 10:00:00",{requiredScope:"settlement:administration",label:"Administrative work"});
    const known=npcReaction(seed,"R-KNOWN","protagonist","1201-05-01 10:00:00",{label:"the meeting hall"});
    const stranger=npcReaction(seed,"R-STRANGER","protagonist","1201-05-01 10:00:00",{label:"the meeting hall"});
    root.ProtagonistAuthority={snapshot(){return{exists:true,currentRole:{roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:["self"]}}}};
    const blocked=attemptAccess(seed,"protagonist","1201-05-01 10:30:00",{objectId:"meeting-hall:table:01",action:"work",requiredScope:"settlement:administration"});
    const pass=ordinary.status==="restricted"&&!ordinary.permitted&&conditional.status==="conditional"&&steward.status==="permitted"&&known.recognized===true&&stranger.recognized===false&&blocked.ok===false;
    return F({pass,version:VERSION,ordinary,conditional,steward,known,stranger,blocked,telemetry:telemetry(),readOnly:true,proposalOnly:true,simulationValidationRequired:true});
  }finally{
    if(previousAuthority===undefined)delete root.ProtagonistAuthority;else root.ProtagonistAuthority=previousAuthority;
    if(previousMemory===undefined)delete root.CharacterMemory;else root.CharacterMemory=previousMemory;
    if(previousSocial===undefined)delete root.SocialState;else root.SocialState=previousSocial;
  }
}
return F({VERSION,MAX_RESULT_BYTES,MAX_QUERY_CONTEXTS,MAX_REPUTATION_CONTEXTS,localAccessContext,npcReaction,attemptAccess,snapshot,telemetry,proof});
});
