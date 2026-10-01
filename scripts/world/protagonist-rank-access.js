(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistRankAccess=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-rank-access-v1";
const MAX_RESULT_BYTES=16384;
const MAX_QUERY_CONTEXTS=8;
const ROLE_RANKS=Object.freeze({
  "local-resident":0,
  "guild-member":1,
  "village-steward":2,
  "regional-magistrate":3,
  "realm-councillor":4
});
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const item of Object.values(v))F(item);return Object.freeze(v)}
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,C(item)]))}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function T(v,n=160){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function B(v){if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(String(v==null?"":v)).length;return String(v==null?"":v).length}
function cleanText(v,n=160){return T(v,n)}
function roleSnapshot(seedValue,identityValue){
  try{
    const snap=root?.ProtagonistAuthority?.snapshot?.(seedValue,identityValue)||null;
    if(snap&&snap.exists!==false&&snap.currentRole){return F({exists:Boolean(snap.exists!==false),roleId:I(snap.currentRole.roleId||"local-resident",80),title:T(snap.currentRole.title||snap.currentRole.label||"Local Resident",120),rankTier:Number.isFinite(Number(snap.currentRole.rankTier))?Number(snap.currentRole.rankTier):0,rankLabel:T(snap.currentRole.rankLabel||"ordinary",80),scopes:Array.isArray(snap.currentRole.scopes)?snap.currentRole.scopes.map(x=>I(x,120)).filter(Boolean):[],source:"ProtagonistAuthority"})}
  }catch(_){ }
  try{
    const state=root?.ProtagonistStatusObligations?.resolve?.(seedValue,root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",identityValue)||
      root?.ProtagonistStatusObligations?.decisionContext?.(seedValue,root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",identityValue)||null;
    if(state&&state.role){return F({exists:Boolean(state.ok!==false),roleId:I(state.role.roleId||"local-resident",80),title:T(state.role.title||state.role.label||"Local Resident",120),rankTier:Number.isFinite(Number(state.role.rankTier))?Number(state.role.rankTier):0,rankLabel:T(state.role.rankLabel||"ordinary",80),scopes:Array.isArray(state.role.scopes)?state.role.scopes.map(x=>I(x,120)).filter(Boolean):[],source:"ProtagonistStatusObligations"})}
  }catch(_){ }
  return F({exists:false,roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:["self"],source:"fallback"})
}
function requiredSeed(seedValue){const seed=T(seedValue,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function roleRank(roleIdValue){const roleId=I(roleIdValue,80);return Object.prototype.hasOwnProperty.call(ROLE_RANKS,roleId)?ROLE_RANKS[roleId]:null}
function localAccessContext(seedValue,identityValue,whenValue,targetValue){
  const seed=requiredSeed(seedValue);const when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);const identity=I(identityValue||"protagonist",80);const target=targetValue&&typeof targetValue==="object"?targetValue:{};
  const authority=roleSnapshot(seed,identity);const currentRole=authority.roleId||"local-resident";const currentRank=Number.isFinite(Number(authority.rankTier))?Number(authority.rankTier):0;
  const requiredScope=I(target.requiredScope||target.scope||"self",120),requiredRoleId=I(target.requiredRoleId||target.requiredRole||target.roleId||"",80);
  const label=cleanText(target.label||target.kind||"local access",120);
  const scopeSet=new Set((authority.scopes||[]).map(x=>I(x,120)).filter(Boolean));
  let permitted=(requiredScope==="self"||scopeSet.has(requiredScope));
  let conditional=false;
  let reason=permitted?"status-authority-scope-present":"missing-authority-scope";
  if(!permitted&&requiredRoleId){
    const requiredRank=roleRank(requiredRoleId);
    if(requiredRank!==null&&currentRank>=requiredRank){
      permitted=true;reason="status-authority-rank-qualified";
    } else if(currentRank>0||scopeSet.size>0){
      conditional=true;reason="status-authority-higher-role-conditional";
    }
  }
  const status=permitted?"permitted":conditional?"conditional":"restricted";
  const presentation=permitted?"Open for this role." : conditional?"Conditional for this role with grounded local context." : "Restricted to a higher legitimate role.";
  const result={ok:status!=="restricted",status,label,role:{roleId:currentRole,title:authority.title||"Local Resident",rankTier:currentRank,rankLabel:authority.rankLabel||"ordinary",scopes:(authority.scopes||[]).slice(0,8)},requiredScope:requiredScope||null,requiredRoleId:requiredRoleId||null,permitted,conditional,reason,presentation,readOnly:true,proposalOnly:true,eventDriven:true,sourceAuthority:authority.source,simulationValidationRequired:true,directActionExecution:false,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false};
  const bytes=B(S(result));if(bytes>MAX_RESULT_BYTES)return F({ok:false,status:"restricted",label,role:{roleId:currentRole,title:authority.title||"Local Resident",rankTier:currentRank,rankLabel:authority.rankLabel||"ordinary",scopes:(authority.scopes||[]).slice(0,8)},requiredScope:requiredScope||null,requiredRoleId:requiredRoleId||null,permitted:false,conditional:false,reason:"status-context-over-budget",presentation:"Formal status access is temporarily unavailable.",readOnly:true,proposalOnly:true,eventDriven:true,sourceAuthority:authority.source,simulationValidationRequired:true,directActionExecution:false,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,serializedBytes:bytes,maxResultBytes:MAX_RESULT_BYTES});
  result.serializedBytes=bytes;result.maxResultBytes=MAX_RESULT_BYTES;return F(result);
}
function npcReaction(seedValue,residentIdValue,identityValue,whenValue,targetValue){
  const seed=requiredSeed(seedValue);const residentId=I(residentIdValue||"unknown",120);const identity=I(identityValue||"protagonist",80);const when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);
  const target=targetValue&&typeof targetValue==="object"?targetValue:{};const label=cleanText(target.label||target.kind||"this place",120);const auth=roleSnapshot(seed,identity);
  const social=(()=>{try{return root?.SocialState?.dialogueContext?.(seed,residentId)||null}catch(_){return null}})();
  const values=social&&social.values?social.values:{};const trust=Number(values.trust??0.45),respect=Number(values.respect??0.35),suspicion=Number(values.suspicion??0.25),fear=Number(values.fear??0.1);
  const recognized=Boolean(social&&((social.knownResident===true)||(trust>=0.55&&respect>=0.52&&suspicion<=0.4)));
  const title=auth.title||"Local Resident";
  const message=recognized? ("Your "+title+" standing is recognized here; " + label + " remains open to you with the right local context.") : ("You are still just an ordinary local resident to me; " + label + " does not grant special authority without a valid legitimate action.");
  const relationshipDelta=recognized?{trust:0.04,respect:0.05,fear:-0.01}:{trust:-0.01,respect:-0.01,suspicion:0.02};
  return F({ok:true,recognized,roleTitle:title,sourceAuthority:auth.source,message,relationshipDelta,readOnly:true,presentationOnly:true,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,when})
}
function attemptAccess(seedValue,identityValue,whenValue,targetValue){
  const identity=I(identityValue||"protagonist",80);const when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);const target=targetValue&&typeof targetValue==="object"?targetValue:{};const action=I(target.action||target.intent||"use",80);
  const access=localAccessContext(seedValue,identity,when,target);
  if(access.status!=="permitted"&&access.status!=="conditional"){
    return F({ok:false,status:"rejected",reason:access.reason||"status-restricted",action,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions/Simulation"});
  }
  const objectId=I(target.objectId||target.id||"",160);const actorPosition=target.actorPosition||{x:0,y:0};
  if(objectId&&root&&root.ObjectInteractions&&typeof root.ObjectInteractions.attempt==="function"){
    try{
      const result=root.ObjectInteractions.attempt(seedValue,{actorKind:"protagonist",actorId:identity,actorPosition,objectId,action});
      return F({ok:Boolean(result&&result.ok),status:result&&result.status?String(result.status):"evaluated",reason:result&&result.reason?String(result.reason):access.reason,action,objectId,access,result,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"});
    }catch(_){
      return F({ok:false,status:"rejected",reason:"object-interaction-check-failed",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"});
    }
  }
  return F({ok:true,status:"ready",reason:access.reason||"status-approved",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"Simulation"});
}
function snapshot(seedValue,identityValue){
  return F({version:VERSION,bounded:true,eventDriven:true,readOnly:true,proposalOnly:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,localAccessContext:localAccessContext(seedValue||"seed",identityValue||"protagonist","1201-01-01 00:00:00",{requiredScope:"self"}),npcReaction:root?.SocialState?"available":"unavailable",performance: {maxResultBytes:MAX_RESULT_BYTES,maxQueryContexts:MAX_QUERY_CONTEXTS}})
}
function proof(){
  const seed="SEED-RANK-ACCESS";
  const ordinary=localAccessContext(seed,"protagonist","1201-05-01 09:00:00",{requiredScope:"settlement:administration",label:"Town Hall"});
  const authority={exists:true,currentRole:{roleId:"village-steward",title:"Village Steward",rankTier:2,rankLabel:"local-authority",scopes:["self","settlement:administration","settlement:request-assistance"]}};
  const previousAuthority=root?.ProtagonistAuthority;
  root.ProtagonistAuthority={snapshot(){return authority;}};
  try{
    const steward=localAccessContext(seed,"protagonist","1201-05-01 10:00:00",{requiredScope:"settlement:administration",label:"Town Hall"});
    const reaction=npcReaction(seed,"R-GUARD","protagonist","1201-05-01 10:00:00",{label:"Town Hall"});
    const blocked=attemptAccess(seed,"protagonist","1201-05-01 09:00:00",{objectId:"town-hall-door",action:"enter",requiredScope:"settlement:administration"});
    const pass=ordinary.status==="restricted"&&ordinary.permitted===false&&steward.status==="permitted"&&steward.permitted===true&&reaction.recognized===true&&blocked.ok===false;
    return F({pass,version:VERSION,ordinary,steward,reaction,blocked,readOnly:true,proposalOnly:true,simulationValidationRequired:true});
  } finally {
    if(previousAuthority===undefined)delete root.ProtagonistAuthority;else root.ProtagonistAuthority=previousAuthority;
  }
}
return F({VERSION,MAX_RESULT_BYTES,MAX_QUERY_CONTEXTS,localAccessContext,npcReaction,attemptAccess,snapshot,proof});
});
