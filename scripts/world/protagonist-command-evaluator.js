(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistCommandEvaluator=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const EVALUATOR_VERSION="protagonist-command-evaluator-v1";
const DECISION_VERSION="protagonist-command-decision-v1";
const EXECUTION_VERSION="protagonist-command-execution-v1";
const DECISIONS=Object.freeze(["accepted","modified","deferred","rejected","invalid"]);
const LIMITS=Object.freeze({maxRouteDistanceTiles:2048,maxRouteNodes:3000,maxTextLength:320});

function deepFreeze(value){
  if(!value||typeof value!=="object"||Object.isFrozen(value))return value;
  Object.freeze(value);Object.keys(value).forEach(key=>deepFreeze(value[key]));return value;
}
function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    const out={};Object.keys(value).sort().forEach(key=>{if(value[key]!==undefined)out[key]=canonicalize(value[key]);});return out;
  }
  return value;
}
function stableStringify(value){return JSON.stringify(canonicalize(value));}
function hashText(value){
  let hash=2166136261>>>0;
  for(const ch of String(value==null?"":value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function normalizeText(value,max=LIMITS.maxTextLength){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function clamp01(value,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;}
function plainObject(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function clone(value){return value==null?null:JSON.parse(JSON.stringify(value));}
function point(value){
  if(!value||value.x==null||value.y==null)return null;
  return Object.freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});
}
function targetLookup(snapshot,kind,id){
  const key={person:"people",place:"places",route:"routes",interaction:"interactions"}[kind];
  return key?(snapshot?.targets?.[key]||[]).find(item=>String(item?.id)===String(id))||null:null;
}
function whenKey(config,snapshot){return normalizeText(config?.when||snapshot?.context?.when||root?.GameTime?.getTimestampKey?.()||"",80);}
function seedKey(config,snapshot){return normalizeText(config?.seed||snapshot?.context?.seed||root?.SeedSystem?.getCampaign?.()?.seed||"",120);}
function actorPosition(config,snapshot){return point(config?.actorPosition||snapshot?.context?.origin||root?.Protagonist?.getPosition?.());}
function proposalCore(proposal){
  return Object.freeze({
    proposalId:normalizeText(proposal?.proposalId||"",160)||null,
    commandId:normalizeText(proposal?.commandId||"",160),
    parameters:plainObject(proposal?.validatedParameters)?clone(proposal.validatedParameters):clone(proposal?.parameters||{}),
    source:normalizeText(proposal?.source||"direct",80)||"direct"
  });
}
function generatedProposalId(seed,when,proposal){
  return "PROP-"+hashText(stableStringify({seed,when,commandId:proposal.commandId,parameters:proposal.parameters,source:proposal.source}));
}
function validateProposal(snapshot,proposalValue){
  const proposal=proposalCore(proposalValue),validator=root?.CommandSetInterface;
  if(!snapshot||!validator?.validateProposal){
    return deepFreeze({ok:false,status:"rejected",reason:"command-validator-unavailable",commandId:proposal.commandId,snapshotId:snapshot?.snapshotId||null,validatedParameters:null});
  }
  const checked=validator.validateProposal(snapshot,{
    proposalId:proposal.proposalId,commandId:proposal.commandId,parameters:proposal.parameters,source:proposal.source
  });
  if(!checked?.ok)return checked;
  return deepFreeze({...checked,source:checked.source||proposal.source});
}
function operationDefaults(commandId){
  if(commandId==="advisor.query_information"||commandId==="advisor.query_schedule")return Object.freeze({value:0.92,urgency:0.45,social:0.72});
  if(commandId==="advisor.propose_advice")return Object.freeze({value:0.64,urgency:0.45,social:0.58});
  if(commandId==="advisor.propose_travel")return Object.freeze({value:0.72,urgency:0.62,social:0.58});
  if(commandId==="advisor.propose_interaction")return Object.freeze({value:0.70,urgency:0.60,social:0.58});
  return Object.freeze({value:0.5,urgency:0.5,social:0.5});
}
function socialAcceptability(seed,proposal,config,defaults){
  if(config?.socialAcceptability!=null)return Object.freeze({value:clamp01(config.socialAcceptability,defaults.social),source:"provided-context"});
  const personId=proposal?.validatedParameters?.personId;
  if(personId&&root?.SocialState?.adviceAcceptability){
    const value=root.SocialState.adviceAcceptability(seed,personId,{dutyConflict:Boolean(config?.dutyConflict)});
    return Object.freeze({value:clamp01(value,defaults.social),source:"persistent-social-ledger"});
  }
  return Object.freeze({value:defaults.social,source:"command-default"});
}
function deterministicBias(seed,when,proposalId,commandId,parameters){
  const h=parseInt(hashText(stableStringify({seed,when,proposalId,commandId,parameters})),16)>>>0;
  return ((h%10001)/10000-0.5)*0.05;
}
function decisionFactors(seed,when,proposal,config){
  const defaults=operationDefaults(proposal.commandId),social=socialAcceptability(seed,proposal,config,defaults);
  const value=clamp01(config?.value,defaults.value),urgency=clamp01(config?.urgency,defaults.urgency),dutyConflict=Boolean(config?.dutyConflict);
  const bias=deterministicBias(seed,when,proposal.proposalId,proposal.commandId,proposal.validatedParameters);
  const rawScore=value*0.45+urgency*0.25+social.value*0.30+bias;
  const effectiveScore=Math.max(0,Math.min(1,rawScore-(dutyConflict?0.16:0)));
  return deepFreeze({
    value,urgency,socialAcceptability:social.value,socialSource:social.source,dutyConflict,
    deterministicBias:Number(bias.toFixed(6)),rawScore:Number(rawScore.toFixed(6)),effectiveScore:Number(effectiveScore.toFixed(6)),
    authority:"Campaign SEED + Fantasy Game Time + character/social/context state"
  });
}
function chooseDecision(factors,hasValidModification){
  if(factors.effectiveScore<0.35)return "rejected";
  if(factors.dutyConflict&&hasValidModification&&factors.rawScore>=0.58&&factors.effectiveScore<0.58)return "modified";
  if(factors.effectiveScore<0.58)return "deferred";
  return "accepted";
}
function buildIds(seed,when,proposal,decision,factors,finalProposal){
  const signature={seed,when,proposalId:proposal.proposalId,commandId:proposal.commandId,parameters:proposal.validatedParameters,decision,factors,finalCommandId:finalProposal?.commandId||null,finalParameters:finalProposal?.validatedParameters||null};
  const core=hashText(stableStringify(signature));
  return Object.freeze({
    transactionId:"PCX-"+core,
    decisionId:"PCD-"+hashText("decision|"+stableStringify(signature)),
    executionId:"PCE-"+hashText("execution|"+stableStringify(signature))
  });
}
function invalidRecord(seed,when,snapshot,rawProposal,validation){
  const core=proposalCore(rawProposal),proposalId=core.proposalId||generatedProposalId(seed,when,core);
  const proposal=deepFreeze({...core,proposalId,validatedParameters:null}),ids=buildIds(seed,when,proposal,"invalid",Object.freeze({}),null);
  return deepFreeze({
    evaluatorVersion:EVALUATOR_VERSION,decisionVersion:DECISION_VERSION,executionVersion:EXECUTION_VERSION,
    ...ids,seed,when,proposal,decision:"invalid",
    protagonistEvaluation:Object.freeze({checked:false,state:"invalid",reason:"proposal-validation-failed",factors:null}),
    originalValidation:Object.freeze({checked:true,ok:false,reason:String(validation?.reason||"proposal-invalid"),source:"CommandSetInterface",details:validation?.details||null}),
    finalValidation:Object.freeze({checked:true,ok:false,reason:String(validation?.reason||"proposal-invalid"),source:"CommandSetInterface",details:validation?.details||null}),
    execution:Object.freeze({attempted:false,state:"not-run",reason:"proposal-invalid",delegate:null,actionExecuted:false,positionMutation:false,directWorldMutation:false}),
    authority:Object.freeze({protagonistChoice:false,simulationValidation:true,directControl:false,directPositionMutation:false,teleportation:false,fullWorldScan:false,parallelWorldAuthority:false,seedAndFantasyTimeAuthority:true})
  });
}
function routeValidation(seed,snapshot,proposal,position){
  const destinationId=proposal.validatedParameters.destinationId,destination=targetLookup(snapshot,"place",destinationId);
  if(!destination?.position)return Object.freeze({checked:true,ok:false,reason:"destination-position-unavailable",source:"CommandSetInterface snapshot",delegate:"RoutePlanner",targetId:destinationId});
  if(!position)return Object.freeze({checked:true,ok:false,reason:"actor-position-unavailable",source:"Protagonist",delegate:"RoutePlanner",targetId:destinationId});
  const planner=root?.RoutePlanner;
  if(!planner?.findRoute)return Object.freeze({checked:true,ok:false,reason:"route-planner-unavailable",source:"Simulation",delegate:"RoutePlanner",targetId:destinationId});
  const route=planner.findRoute(seed,position,destination.position,{maxDistanceTiles:LIMITS.maxRouteDistanceTiles,maxNodes:LIMITS.maxRouteNodes});
  return deepFreeze({
    checked:true,ok:Boolean(route?.found),reason:route?.found?"route-available":String(route?.reason||"route-unavailable"),
    source:"Simulation",delegate:"RoutePlanner",targetId:destinationId,target:point(destination.position),
    route:route?{found:Boolean(route.found),stepCount:Number(route.stepCount||0),totalSeconds:Number(route.totalSeconds||0),reason:String(route.reason||"")}:null
  });
}
function interactionValidation(seed,snapshot,proposal,position){
  const personId=proposal.validatedParameters.personId,targetId=proposal.validatedParameters.interactionTargetId;
  if(!targetId)return Object.freeze({checked:true,ok:true,reason:"person-interaction-proposal-valid",source:"CommandSetInterface snapshot",delegate:null,targetId:personId,executionReady:false});
  const target=targetLookup(snapshot,"interaction",targetId);
  if(!target)return Object.freeze({checked:true,ok:false,reason:"interaction-target-unavailable",source:"CommandSetInterface snapshot",delegate:"ObjectInteractions",targetId});
  if(!position)return Object.freeze({checked:true,ok:false,reason:"actor-position-unavailable",source:"Protagonist",delegate:"ObjectInteractions",targetId});
  const interactions=root?.ObjectInteractions;
  if(!interactions?.context)return Object.freeze({checked:true,ok:false,reason:"object-interactions-unavailable",source:"Simulation",delegate:"ObjectInteractions",targetId});
  const context=interactions.context(seed,targetId,position),action=normalizeText(target.action||"inspect",80)||"inspect";
  const actionState=context?.actions?.find(item=>item.id===action)||null;
  return deepFreeze({
    checked:true,ok:Boolean(context&&actionState?.enabled),
    reason:context?(actionState?.enabled?"interaction-ready":String(actionState?.reason||"interaction-out-of-range")):"interaction-object-unavailable",
    source:"Simulation",delegate:"ObjectInteractions",targetId,action,personId,executionReady:Boolean(context&&actionState?.enabled),
    target:point(actionState?.target||target.position||null)
  });
}
function simulationValidation(seed,snapshot,proposal,position){
  const commandId=proposal.commandId;
  if(commandId==="advisor.propose_travel")return routeValidation(seed,snapshot,proposal,position);
  if(commandId==="advisor.propose_interaction")return interactionValidation(seed,snapshot,proposal,position);
  if(commandId==="advisor.query_information"||commandId==="advisor.query_schedule"){
    return Object.freeze({checked:true,ok:true,reason:"read-only-query-valid",source:"CommandSetInterface snapshot",delegate:null,executionReady:false});
  }
  if(commandId==="advisor.propose_advice"){
    return Object.freeze({checked:true,ok:true,reason:"advice-proposal-valid",source:"CommandSetInterface snapshot",delegate:"AdviceResolution",executionReady:false});
  }
  return Object.freeze({checked:true,ok:false,reason:"unsupported-command",source:"Simulation",delegate:null,executionReady:false});
}
function executeAccepted(seed,snapshot,proposal,validation,position,actorId){
  if(!validation.ok)return Object.freeze({attempted:false,state:"blocked",reason:validation.reason,delegate:validation.delegate||null,actionExecuted:false,positionMutation:false,directWorldMutation:false});
  if(proposal.commandId==="advisor.propose_travel"){
    return deepFreeze({
      attempted:true,state:"route-ready",reason:"authoritative-route-handoff-ready",delegate:"RoutePlanner",
      actionExecuted:false,positionMutation:false,directWorldMutation:false,route:validation.route,target:validation.target
    });
  }
  if(proposal.commandId==="advisor.propose_interaction"){
    const targetId=proposal.validatedParameters.interactionTargetId;
    if(!targetId)return Object.freeze({attempted:false,state:"proposal-ready",reason:"person-interaction-requires-later-concrete-target",delegate:null,actionExecuted:false,positionMutation:false,directWorldMutation:false});
    const interactions=root?.ObjectInteractions;
    if(!interactions?.attempt)return Object.freeze({attempted:false,state:"blocked",reason:"object-interactions-unavailable",delegate:"ObjectInteractions",actionExecuted:false,positionMutation:false,directWorldMutation:false});
    const result=interactions.attempt(seed,{actorKind:"protagonist",actorId,actorPosition:position,objectId:targetId,action:validation.action}),ok=Boolean(result?.ok);
    return deepFreeze({
      attempted:true,state:ok?String(result.status||"accepted"):"blocked",reason:String(result?.reason||"interaction-rejected"),delegate:"ObjectInteractions -> ActionExecutor",
      actionExecuted:ok,positionMutation:false,directWorldMutation:false,
      authoritativeResult:result?{ok,status:String(result.status||""),reason:String(result.reason||""),objectId:String(result.objectId||targetId),action:String(result.action||validation.action||"")}:null
    });
  }
  if(proposal.commandId==="advisor.propose_advice"){
    return Object.freeze({attempted:false,state:"advice-record-ready",reason:"requires-existing-advice-record-for-AdviceResolution",delegate:"AdviceResolution",actionExecuted:false,positionMutation:false,directWorldMutation:false});
  }
  return Object.freeze({attempted:false,state:"read-only",reason:"no-world-action-required",delegate:null,actionExecuted:false,positionMutation:false,directWorldMutation:false});
}
function evaluate(configValue){
  const config=plainObject(configValue)?configValue:{},snapshot=config.snapshot||null;
  const seed=seedKey(config,snapshot),when=whenKey(config,snapshot);
  if(!seed||!when)return invalidRecord(seed,when,snapshot,config.proposal||{},Object.freeze({reason:!seed?"campaign-seed-required":"fantasy-time-required"}));
  const rawProposal=proposalCore(config.proposal||{});
  if(!rawProposal.commandId)return invalidRecord(seed,when,snapshot,rawProposal,Object.freeze({reason:"command-id-required"}));
  const validated=validateProposal(snapshot,rawProposal);
  if(!validated?.ok)return invalidRecord(seed,when,snapshot,rawProposal,validated);
  const proposalId=validated.proposalId||rawProposal.proposalId||generatedProposalId(seed,when,rawProposal);
  const proposal=deepFreeze({...validated,proposalId,source:validated.source||rawProposal.source||"direct"});
  const modifiedRaw=config.modifiedProposal?proposalCore(config.modifiedProposal):null;
  const modifiedChecked=modifiedRaw?validateProposal(snapshot,modifiedRaw):null;
  const modifiedProposal=modifiedChecked?.ok?deepFreeze({...modifiedChecked,proposalId:modifiedChecked.proposalId||generatedProposalId(seed,when,modifiedRaw),source:modifiedChecked.source||modifiedRaw.source||"protagonist-modification"}):null;
  const factors=decisionFactors(seed,when,proposal,config.decisionContext||config),decision=chooseDecision(factors,Boolean(modifiedProposal));
  const finalProposal=decision==="modified"?modifiedProposal:proposal,position=actorPosition(config,snapshot);
  const originalValidation=simulationValidation(seed,snapshot,proposal,position);
  const finalValidation=decision==="modified"?simulationValidation(seed,snapshot,finalProposal,position):originalValidation;
  const ids=buildIds(seed,when,proposal,decision,factors,finalProposal);
  const executable=(decision==="accepted"||decision==="modified")&&finalValidation.ok;
  const execution=executable&&config.execute!==false
    ?executeAccepted(seed,snapshot,finalProposal,finalValidation,position,normalizeText(config.actorId||"protagonist",120)||"protagonist")
    :Object.freeze({attempted:false,state:executable?"validated":"not-run",reason:executable?"execution-disabled":decision,delegate:finalValidation.delegate||null,actionExecuted:false,positionMutation:false,directWorldMutation:false});
  return deepFreeze({
    evaluatorVersion:EVALUATOR_VERSION,decisionVersion:DECISION_VERSION,executionVersion:EXECUTION_VERSION,
    ...ids,seed,when,proposal,decision,finalProposal,
    protagonistEvaluation:Object.freeze({checked:true,state:decision,reason:decision==="modified"?"lawful-validated-alternative-selected":"deterministic-context-evaluation",factors}),
    originalValidation,finalValidation,execution,
    authority:Object.freeze({
      protagonistChoice:true,simulationValidation:true,directControl:false,directPositionMutation:false,teleportation:false,
      fullWorldScan:false,parallelWorldAuthority:false,seedAndFantasyTimeAuthority:true
    })
  });
}
function serialize(value){return stableStringify(value);}

return deepFreeze({EVALUATOR_VERSION,DECISION_VERSION,EXECUTION_VERSION,DECISIONS,LIMITS,evaluate,serialize});
});
