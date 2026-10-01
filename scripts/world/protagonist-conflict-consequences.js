(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistConflictConsequences=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-conflict-consequences-v1";

function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]));}
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function cleanId(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function validTs(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""))}
function scopeFromRef(ref){const input=ref&&typeof ref==="object"?ref:{};const kind=String(input.kind||input.type||"location").toLowerCase();const id=cleanId(input.id||input.entityId||input.refId||"STARTING-VILLAGE",80);return {kind:kind==="settlement"?"settlement":kind==="building"||kind==="location"?"local":"local",id:id||"STARTING-VILLAGE"};}
function outcomeByResult(result){if(!result||typeof result!=="object")return {state:"failed",severity:"standard"};if(result.protagonistInjuryEvidence)return {state:"violated",severity:"major"};if(String(result.resolution||"").includes("disengaged"))return {state:"failed",severity:"standard"};if(String(result.resolution||"").includes("stalemate"))return {state:"failed",severity:"minor"};return {state:"failed",severity:"standard"};}
function operationId(seedValue,resultValue,whenValue){const h=H(String(seedValue||"campaign")+"|"+String(resultValue&&resultValue.id||"conflict")+"|"+String(whenValue||""));return "CONFLICT-OUTCOME-"+h}
function applyCombatResult(seedValue,resultValue,identityValue,optionsValue){
  const seed=cleanId(seedValue||"campaign",160)||"campaign";
  const identity=cleanId(identityValue||"protagonist",96)||"protagonist";
  const result=resultValue&&typeof resultValue==="object"?resultValue:{};
  const when=String(optionsValue&&optionsValue.fantasyTimestamp||result.fantasyTimestamp||"0001-01-01 00:00:00");
  const opId=cleanId(optionsValue&&optionsValue.operationId||operationId(seed,result,when),160);
  const outcome=outcomeByResult(result);
  const standingEvidence={type:"standing-recognition",validated:true,terminal:true,domain:result.protagonistInjuryEvidence?"reliability":"civic",scope:scopeFromRef(result.locationRef||{kind:"location",id:"STARTING-VILLAGE"}),direction:"negative",impact:outcome.severity,sourceRef:{kind:"combat-result",id:String(result.id||"combat-result")},reasonCode:result.protagonistInjuryEvidence?"combat-injury":"combat-defeat",outcome:outcome.state,fantasyTimestamp:when};
  let standingResult={ok:true,reason:"standing-unavailable",applied:false};
  if(root.ProtagonistStanding&&typeof root.ProtagonistStanding.recordSimulation==="function"){
    standingResult=root.ProtagonistStanding.recordSimulation(seed,standingEvidence,{authority:"simulation",authoritative:true,campaignSeed:seed,operationId:opId+"-STANDING",fantasyTimestamp:when},identity);
  }
  let serviceResult={ok:true,reason:"service-contracts-unavailable",applied:false};
  if(root.ProtagonistServiceContracts&&typeof root.ProtagonistServiceContracts.recordConflictConsequence==="function"){
    serviceResult=root.ProtagonistServiceContracts.recordConflictConsequence(seed,{contractId:(optionsValue&&optionsValue.contractId)||null,dutyId:(optionsValue&&optionsValue.dutyId)||null,resultState:(optionsValue&&optionsValue.resultState)||outcome.state,interactionAttemptId:(optionsValue&&optionsValue.interactionAttemptId)||opId,interactionResultId:(optionsValue&&optionsValue.interactionResultId)||String(result.id||opId),fantasyTimestamp:when},{authority:"simulation",authoritative:true,operationId:opId+"-SERVICE",fantasyTimestamp:when},identity);
  }
  let healthResult={ok:true,reason:"injury-not-applicable",applied:false};
  if(result.protagonistInjuryEvidence&&root.ProtagonistHealth&&typeof root.ProtagonistHealth.applyInjury==="function"){
    healthResult=root.ProtagonistHealth.applyInjury(seed,identity,{kind:result.protagonistInjuryEvidence.kind,bodyRegion:result.protagonistInjuryEvidence.bodyRegion,severityMilli:result.protagonistInjuryEvidence.severityMilli,recoveryDurationSeconds:result.protagonistInjuryEvidence.recoveryDurationSeconds,sourceRef:result.protagonistInjuryEvidence.sourceRef},{authority:"simulation",authoritative:true,operationId:result.protagonistInjuryEvidence.healthOperationId||opId+"-INJURY",fantasyTimestamp:when,activity:"exertion"});
  }
  const ok=Boolean(healthResult?.ok||standingResult?.ok||serviceResult?.ok);
  return F({ok,reason:standingResult?.ok===false?standingResult.reason:serviceResult?.ok===false?serviceResult.reason:healthResult?.ok===false?healthResult.reason:"conflict-consequence-applied",standing:standingResult,service:serviceResult,health:healthResult,applied:Boolean(healthResult?.applied||standingResult?.ok||serviceResult?.applied),resultId:String(result.id||""),operationId:opId,when})
}
function apply(seedValue,resultValue,identityValue,optionsValue){return applyCombatResult(seedValue,resultValue,identityValue,optionsValue)}
function snapshot(){return F({version:VERSION,api:"ProtagonistConflictConsequences",bounded:true,eventDriven:true,fullWorldScan:false,wholeHistoryScan:false,perFrameScan:false,requiresSimulationAuthority:true})}
return F({VERSION,applyCombatResult,apply,snapshot});
});
