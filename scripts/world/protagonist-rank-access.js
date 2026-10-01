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
const MAX_MEMORY_READS=16;
const ROLE_RANKS=Object.freeze({
  "local-resident":0,
  "guild-member":1,
  "village-steward":2,
  "regional-magistrate":3,
  "realm-councillor":4
});
const ACCESS_RULES=Object.freeze({
  "storehouse":Object.freeze({
    enter:Object.freeze({requiredScope:"settlement:administration",label:"Storehouse entry"})
  }),
  "meeting-hall":Object.freeze({
    work:Object.freeze({requiredScope:"settlement:administration",label:"Civic administration"})
  })
});
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const item of Object.values(v))F(item);return Object.freeze(v)}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function T(v,n=160){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function B(v){if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(String(v==null?"":v)).length;return String(v==null?"":v).length}
function requiredSeed(v){const seed=T(v,160);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function roleRank(v){const id=I(v,80);return Object.prototype.hasOwnProperty.call(ROLE_RANKS,id)?ROLE_RANKS[id]:null}
function roleSnapshot(seedValue,identityValue,whenValue){
  const identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);
  try{
    const snap=root?.ProtagonistAuthority?.snapshot?.(seedValue,identity)||null;
    const role=snap?.exists===true?snap.currentRole:null;
    if(role?.roleId){
      return F({exists:true,roleId:I(role.roleId,80),title:T(role.title||role.label||role.rankLabel||role.roleId,120),rankTier:Number.isFinite(Number(role.rankTier))?Number(role.rankTier):0,rankLabel:T(role.rankLabel||"",80)||null,scopes:Array.isArray(role.scopes)?role.scopes.map(x=>I(x,120)).filter(Boolean).slice(0,16):[],source:"ProtagonistAuthority"});
    }
  }catch(_){}
  try{
    const state=root?.ProtagonistStatusObligations?.decisionContext?.(seedValue,when,identity)
      ||root?.ProtagonistStatusObligations?.resolve?.(seedValue,when,identity)||null;
    if(state?.ok===true&&state.role?.roleId){
      return F({exists:true,roleId:I(state.role.roleId,80),title:T(state.role.title||state.role.label||state.role.rankLabel||state.role.roleId,120),rankTier:Number.isFinite(Number(state.role.rankTier))?Number(state.role.rankTier):0,rankLabel:T(state.role.rankLabel||"",80)||null,scopes:Array.isArray(state.role.scopes)?state.role.scopes.map(x=>I(x,120)).filter(Boolean).slice(0,16):[],source:"ProtagonistStatusObligations"});
    }
  }catch(_){}
  return F({exists:false,roleId:null,title:"Unknown role",rankTier:null,rankLabel:null,scopes:[],source:"unavailable"});
}
function requirement(targetValue){
  const target=targetValue&&typeof targetValue==="object"?targetValue:{};
  const explicitScope=I(target.requiredScope||target.scope||"",120),explicitRole=I(target.requiredRoleId||target.requiredRole||"",80);
  if(explicitScope||explicitRole)return F({requiredScope:explicitScope||"self",requiredRoleId:explicitRole||null,label:T(target.accessLabel||target.label||"Local access",120),source:"explicit-target-metadata"});
  const buildingKind=I(target.buildingKind||target.structureKind||"",80),action=I(target.action||target.intent||"",80);
  const rule=ACCESS_RULES[buildingKind]?.[action]||null;
  if(rule)return F({requiredScope:rule.requiredScope,requiredRoleId:rule.requiredRoleId||null,label:rule.label,source:"rank-access-rule:"+buildingKind+":"+action});
  return F({requiredScope:"self",requiredRoleId:null,label:T(target.label||target.kind||"Local access",120),source:"ordinary-local-access"});
}
function localAccessContext(seedValue,identityValue,whenValue,targetValue){
  const seed=requiredSeed(seedValue),identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);
  const target=targetValue&&typeof targetValue==="object"?targetValue:{},auth=roleSnapshot(seed,identity,when),req=requirement(target);
  const label=T(target.label||req.label||target.kind||"local access",120),scopes=new Set((auth.scopes||[]).map(x=>I(x,120)).filter(Boolean));
  const currentRank=Number.isFinite(Number(auth.rankTier))?Number(auth.rankTier):null,requiredRank=req.requiredRoleId?roleRank(req.requiredRoleId):null;
  const scopeOK=auth.exists&&(req.requiredScope==="self"||scopes.has(req.requiredScope));
  const roleOK=auth.exists&&(!req.requiredRoleId||(requiredRank!==null&&currentRank!==null&&currentRank>=requiredRank));
  const permitted=Boolean(scopeOK&&roleOK);
  const conditional=Boolean(auth.exists&&!permitted&&target.allowConditional===true&&target.contextVerified===true);
  const unknown=!auth.exists;
  const reason=unknown?"authority-unavailable":permitted?"status-authority-scope-present":conditional?"status-authority-context-conditional":!scopeOK?"missing-authority-scope":"insufficient-legitimate-role";
  const status=permitted?"permitted":conditional?"conditional":"restricted";
  const presentation=unknown
    ?"Legitimate status is unavailable; privileged access is not assumed."
    :permitted
      ?"Permitted by current legitimate authority. Simulation still validates the action."
      :conditional
        ?"Conditionally eligible from grounded local context; Simulation still decides the outcome."
        :"Restricted by current legitimate authority.";
  const result={ok:permitted||conditional,status,label,role:{roleId:auth.roleId,title:auth.title,rankTier:currentRank,rankLabel:auth.rankLabel,scopes:(auth.scopes||[]).slice(0,8)},requiredScope:req.requiredScope||null,requiredRoleId:req.requiredRoleId||null,requirementSource:req.source,permitted,conditional,unknown,reason,presentation,readOnly:true,proposalOnly:true,eventDriven:true,sourceAuthority:auth.source,simulationValidationRequired:true,directActionExecution:false,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false};
  const bytes=B(S(result));
  if(bytes>MAX_RESULT_BYTES)return F({...result,ok:false,status:"restricted",permitted:false,conditional:false,reason:"status-context-over-budget",presentation:"Formal status access is temporarily unavailable.",serializedBytes:bytes,maxResultBytes:MAX_RESULT_BYTES});
  return F({...result,serializedBytes:bytes,maxResultBytes:MAX_RESULT_BYTES});
}
function memoryKnowledge(seed,residentId,auth){
  let recognition=null,reference=null,rowsRead=0;
  try{recognition=root?.CharacterMemory?.recognition?.(seed,residentId)||null}catch(_){}
  try{reference=auth?.exists?root?.CharacterMemory?.recognitionReference?.(seed,residentId,(auth.title||"")+" "+(auth.roleId||""))||null:null}catch(_){}
  try{rowsRead=Math.min(MAX_MEMORY_READS,Number(recognition?.scannedEntryCount||recognition?.storedEntryCount||0))}catch(_){}
  const text=T((reference?.topic||"")+" "+(reference?.summary||""),320).toLowerCase(),tokens=[auth?.title,auth?.roleId].filter(Boolean).flatMap(v=>String(v).toLowerCase().split(/[^a-z0-9]+/)).filter(x=>x.length>=4);
  const titleEvidence=Boolean(reference&&tokens.some(token=>text.includes(token)));
  return F({metBefore:recognition?.metBefore===true,titleEvidence,referenceId:reference?.id||reference?.memoryId||null,rowsRead,bounded:true,maxMemoryReads:MAX_MEMORY_READS});
}
function npcReaction(seedValue,residentIdValue,identityValue,whenValue,targetValue){
  const seed=requiredSeed(seedValue),residentId=I(residentIdValue||"",120),identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32);
  const target=targetValue&&typeof targetValue==="object"?targetValue:{},label=T(target.label||target.kind||"this place",120),auth=roleSnapshot(seed,identity,when),knowledge=memoryKnowledge(seed,residentId,auth);
  let social=null;try{social=root?.SocialState?.dialogueContext?.(seed,residentId)||null}catch(_){}
  const recognized=Boolean(auth.exists&&auth.roleId!=="local-resident"&&knowledge.metBefore&&knowledge.titleEvidence);
  const message=recognized
    ?"Your "+auth.title+" status is known here. That recognition does not bypass local action validation at "+label+"."
    :"No grounded knowledge of a special title is available here; ordinary local rules apply at "+label+".";
  return F({ok:true,recognized,roleTitle:auth.exists?auth.title:null,roleId:auth.roleId,sourceAuthority:auth.source,message,knowledge,relationshipContextAvailable:Boolean(social),relationshipDelta:null,socialConsequence:null,readOnly:true,presentationOnly:true,relationshipMutation:false,worldMutation:false,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,when});
}
function attemptAccess(seedValue,identityValue,whenValue,targetValue){
  const identity=I(identityValue||"protagonist",80),when=T(whenValue||root?.GameTime?.getTimestampKey?.()||"1201-01-01 00:00:00",32),target=targetValue&&typeof targetValue==="object"?targetValue:{},action=I(target.action||target.intent||"use",80);
  const access=localAccessContext(seedValue,identity,when,target);
  if(access.status!=="permitted"&&access.status!=="conditional")return F({ok:false,status:"rejected",reason:access.reason||"status-restricted",action,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions/Simulation"});
  const objectId=I(target.objectId||target.id||"",160),actorPosition=target.actorPosition||{x:0,y:0};
  if(objectId&&root?.ObjectInteractions?.attempt){
    try{
      const result=root.ObjectInteractions.attempt(seedValue,{actorKind:"protagonist",actorId:identity,actorPosition,objectId,action});
      return F({ok:Boolean(result?.ok),status:String(result?.status||"evaluated"),reason:String(result?.reason||access.reason),action,objectId,access,result,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"});
    }catch(_){return F({ok:false,status:"rejected",reason:"object-interaction-check-failed",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"ObjectInteractions"})}
  }
  return F({ok:true,status:"ready",reason:access.reason||"status-approved",action,objectId,access,readOnly:true,presentationOnly:true,simulationValidationRequired:true,delegatesTo:"Simulation"});
}
function snapshot(seedValue,identityValue){
  const probe=localAccessContext(seedValue||"seed",identityValue||"protagonist","1201-01-01 00:00:00",{requiredScope:"self"});
  return F({version:VERSION,bounded:true,eventDriven:true,readOnly:true,proposalOnly:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false,localAccessContext:probe,npcReaction:root?.CharacterMemory?"knowledge-bounded":"unavailable",performance:{maxResultBytes:MAX_RESULT_BYTES,maxQueryContexts:MAX_QUERY_CONTEXTS,maxMemoryReads:MAX_MEMORY_READS}});
}
function proof(){
  const seed="SEED-RANK-ACCESS",priorAuthority=root?.ProtagonistAuthority,priorMemory=root?.CharacterMemory,priorInteractions=root?.ObjectInteractions;
  try{
    root.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:"local-resident",title:"Local Resident",rankTier:0,rankLabel:"ordinary",scopes:["self"]}}}};
    const ordinary=localAccessContext(seed,"protagonist","1201-05-01 09:00:00",{buildingKind:"storehouse",action:"enter",label:"Storehouse"});
    root.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:{roleId:"village-steward",title:"Village Steward",rankTier:2,rankLabel:"local-authority",scopes:["self","settlement:administration","settlement:request-assistance"]}}}};
    root.CharacterMemory={recognition(){return {metBefore:true,scannedEntryCount:2}},recognitionReference(){return {id:"MEM-STEWARD",topic:"Village Steward office",summary:"Observed the protagonist serving as Village Steward."}}};
    const steward=localAccessContext(seed,"protagonist","1201-05-01 10:00:00",{buildingKind:"storehouse",action:"enter",label:"Storehouse"});
    const reaction=npcReaction(seed,"R-GUARD","protagonist","1201-05-01 10:00:00",{label:"Storehouse"});
    root.CharacterMemory={recognition(){return {metBefore:true,scannedEntryCount:1}},recognitionReference(){return null}};
    const unknownReaction=npcReaction(seed,"R-STRANGER","protagonist","1201-05-01 10:00:00",{label:"Storehouse"});
    root.ObjectInteractions={attempt(){return {ok:false,status:"rejected",reason:"simulation-rejected"}}};
    const blocked=attemptAccess(seed,"protagonist","1201-05-01 10:00:00",{objectId:"storehouse:door",action:"enter",buildingKind:"storehouse",requiredScope:"region:adjudication"});
    const pass=ordinary.status==="restricted"&&!ordinary.permitted&&steward.status==="permitted"&&steward.permitted&&reaction.recognized===true&&unknownReaction.recognized===false&&blocked.ok===false&&reaction.relationshipDelta===null;
    return F({pass,version:VERSION,ordinary,steward,reaction,unknownReaction,blocked,readOnly:true,proposalOnly:true,simulationValidationRequired:true});
  }finally{
    if(priorAuthority===undefined)delete root.ProtagonistAuthority;else root.ProtagonistAuthority=priorAuthority;
    if(priorMemory===undefined)delete root.CharacterMemory;else root.CharacterMemory=priorMemory;
    if(priorInteractions===undefined)delete root.ObjectInteractions;else root.ObjectInteractions=priorInteractions;
  }
}
return F({VERSION,MAX_RESULT_BYTES,MAX_QUERY_CONTEXTS,MAX_MEMORY_READS,ROLE_RANKS,ACCESS_RULES,localAccessContext,npcReaction,attemptAccess,snapshot,proof});
});
