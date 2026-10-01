(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistSelfCare=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-self-care-v1";
const MAX_CANDIDATES=12;
const MAX_INVENTORY_ITEMS=24;
const MAX_REASONS=12;
const ACTION_THRESHOLD=60000;
const URGENT_THRESHOLD=75000;
const CRITICAL_CONDITION=40000;
const TYPES=Object.freeze(["food","rest","safety"]);

function freeze(value){if(!value||typeof value!=="object"||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}return value;}
function stable(value){return JSON.stringify(canonical(value));}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function clampMilli(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100000,Math.round(n))):0;}
function itemKey(value){if(!plain(value))return"";const kind=cleanId(value.kind||value.itemKind||"item",64)||"item",id=cleanId(value.id||value.itemId||value.refId);return id?kind+"|"+id:"";}
function pressure(snapshot,key){if(!plain(snapshot))return 0;if(snapshot.pressureMilli&&snapshot.pressureMilli[key]!=null)return clampMilli(snapshot.pressureMilli[key]);if(snapshot.pressures&&snapshot.pressures[key]!=null)return clampMilli(Number(snapshot.pressures[key])*1000);return 0;}
function inventoryRows(snapshot){if(!plain(snapshot))return[];const raw=Array.isArray(snapshot.items)?snapshot.items:Array.isArray(snapshot.records)?snapshot.records:[];return raw.slice(0,MAX_INVENTORY_ITEMS).map(clone);}
function normalizeProposal(value){if(!plain(value))return null;const commandId=cleanId(value.commandId);if(!commandId)return null;const parameters=plain(value.validatedParameters)?clone(value.validatedParameters):plain(value.parameters)?clone(value.parameters):{};return freeze({proposalId:cleanId(value.proposalId)||null,commandId,parameters,source:cleanId(value.source||"protagonist-self-care",80)||"protagonist-self-care"});}
function capability(candidate){const raw=[];if(candidate.capability)raw.push(candidate.capability);if(Array.isArray(candidate.capabilities))raw.push(...candidate.capabilities);return new Set(raw.map(x=>cleanId(x,80).toLowerCase()).filter(Boolean));}
function possessionMatch(candidate,rows){const pid=cleanId(candidate.possessionId||candidate.item?.possessionId||""),key=itemKey(candidate.itemRef||candidate.item||{});return rows.find(row=>{const rowId=cleanId(row.possessionId||row.id||""),rowKey=itemKey(row.itemRef||row);return Number(row.quantity||0)>0&&(!pid||rowId===pid)&&(!key||rowKey===key);})||null;}
function normalizeCandidate(value,index){const raw=plain(value)?value:{},type=cleanId(raw.type||raw.kind,32).toLowerCase(),id=cleanId(raw.id||raw.candidateId||("candidate-"+index));return freeze({
  id,type,label:clean(raw.label||raw.name||id,120),available:raw.available===true,targetId:cleanId(raw.targetId||raw.placeId||raw.objectId||""),
  possessionId:cleanId(raw.possessionId||""),itemRef:plain(raw.itemRef)?clone(raw.itemRef):null,capabilities:freeze([...capability(raw)]),
  requiresHealthyMobility:raw.requiresHealthyMobility===true,safetyGainMilli:clampMilli(raw.safetyGainMilli||raw.safetyImprovementMilli||0),proposal:normalizeProposal(raw.proposal)
});}
function urgencyModel(needs,health){const hunger=pressure(needs,"hunger"),needsFatigue=pressure(needs,"fatigue"),safety=pressure(needs,"safety"),healthFatigue=clampMilli(health?.fatigueMilli),conditionMilli=health?.conditionMilli==null?100000:clampMilli(health.conditionMilli),injuryPressure=Math.max(0,100000-conditionMilli);return freeze({
  hunger,fatigue:Math.max(needsFatigue,healthFatigue),safety,conditionMilli,injuryPressure,
  byType:freeze({food:hunger,rest:Math.max(needsFatigue,healthFatigue,Math.floor(injuryPressure*0.9)),safety})
});}
function validateCandidate(candidate,rows,urgency){if(!TYPES.includes(candidate.type))return{ok:false,reason:"unsupported-self-care-type"};if(!candidate.id)return{ok:false,reason:"candidate-id-required"};if(candidate.available!==true)return{ok:false,reason:"candidate-unavailable"};if(!candidate.proposal)return{ok:false,reason:"validated-proposal-required"};const caps=new Set(candidate.capabilities);
  if(candidate.requiresHealthyMobility&&urgency.conditionMilli<CRITICAL_CONDITION)return{ok:false,reason:"injury-mobility-constraint"};
  if(candidate.type==="food"){
    if(!caps.has("consume")&&!caps.has("eat"))return{ok:false,reason:"food-consume-capability-required"};
    const owned=possessionMatch(candidate,rows);if(!owned)return{ok:false,reason:"owned-food-possession-required"};
    if(String(owned.carryState||"carried")!=="carried")return{ok:false,reason:"food-not-carried"};
    return{ok:true,reason:"owned-food-available",reference:cleanId(owned.possessionId||owned.id||"")};
  }
  if(candidate.type==="rest"){
    if(!candidate.targetId)return{ok:false,reason:"rest-target-required"};
    if(!caps.has("rest")&&!caps.has("sleep"))return{ok:false,reason:"rest-capability-required"};
    return{ok:true,reason:"rest-target-available",reference:candidate.targetId};
  }
  if(!candidate.targetId)return{ok:false,reason:"safety-target-required"};
  if(!caps.has("shelter")&&!caps.has("move-to-safe-place")&&!caps.has("safety"))return{ok:false,reason:"safety-capability-required"};
  if(candidate.safetyGainMilli<=0)return{ok:false,reason:"safety-improvement-required"};
  return{ok:true,reason:"safer-target-available",reference:candidate.targetId};
}
function evaluate(configValue){const config=plain(configValue)?configValue:{},seed=clean(config.seed,160),when=clean(config.when,32),rawCandidates=Array.isArray(config.candidates)?config.candidates:[],inventory=plain(config.inventory)?config.inventory:{},rows=inventoryRows(inventory);
  if(!seed)return freeze({ok:false,reason:"campaign-seed-required"});if(!validWhen(when))return freeze({ok:false,reason:"fantasy-time-required"});
  if(rawCandidates.length>MAX_CANDIDATES)return freeze({ok:false,reason:"candidate-limit-exceeded",evaluated:0,maxCandidates:MAX_CANDIDATES,bounded:true});
  const rawInventoryCount=Array.isArray(inventory.items)?inventory.items.length:Array.isArray(inventory.records)?inventory.records.length:0;if(rawInventoryCount>MAX_INVENTORY_ITEMS)return freeze({ok:false,reason:"inventory-read-limit-exceeded",evaluated:0,maxInventoryItems:MAX_INVENTORY_ITEMS,bounded:true});
  const urgency=urgencyModel(config.needs,config.health),evaluated=[],valid=[];
  for(let i=0;i<rawCandidates.length;i++){
    const candidate=normalizeCandidate(rawCandidates[i],i),checked=validateCandidate(candidate,rows,urgency),score=urgency.byType[candidate.type]||0,tie=hashText(seed+"|"+when+"|"+candidate.id+"|"+candidate.type);
    const row=freeze({id:candidate.id,type:candidate.type,label:candidate.label,valid:checked.ok,reason:checked.reason,reference:checked.reference||null,urgencyMilli:score,tieBreak:tie});evaluated.push(row);if(checked.ok&&score>=ACTION_THRESHOLD)valid.push({candidate,row,score,tie});
  }
  const rankedTypes=TYPES.map(type=>({type,urgencyMilli:urgency.byType[type]})).sort((a,b)=>b.urgencyMilli-a.urgencyMilli||a.type.localeCompare(b.type)),dominant=rankedTypes[0];
  if(dominant.urgencyMilli<ACTION_THRESHOLD)return freeze({version:VERSION,ok:true,status:"no-op",reason:"pressure-below-action-threshold",seed,when,urgency,evaluated:freeze(evaluated),selectedCandidate:null,selectedProposal:null,reasons:freeze(["pressure-below-action-threshold"]),bounds:freeze({maxCandidates:MAX_CANDIDATES,maxInventoryItems:MAX_INVENTORY_ITEMS,maxReasons:MAX_REASONS}),authority:authorityFlags()});
  valid.sort((a,b)=>b.score-a.score||a.tie.localeCompare(b.tie)||a.candidate.id.localeCompare(b.candidate.id));const chosen=valid[0]||null;
  if(!chosen){const reason="urgent-"+dominant.type+"-no-valid-candidate";return freeze({version:VERSION,ok:true,status:"deferred",reason,seed,when,urgency,evaluated:freeze(evaluated),selectedCandidate:null,selectedProposal:null,reasons:freeze([reason]),bounds:freeze({maxCandidates:MAX_CANDIDATES,maxInventoryItems:MAX_INVENTORY_ITEMS,maxReasons:MAX_REASONS}),authority:authorityFlags()});}
  const reason=chosen.score>=URGENT_THRESHOLD?"urgent-"+chosen.candidate.type+"-self-care":"self-care-"+chosen.candidate.type+"-appropriate";
  return freeze({version:VERSION,ok:true,status:"proposal-ready",reason,seed,when,urgency,evaluated:freeze(evaluated),selectedCandidate:freeze({id:chosen.candidate.id,type:chosen.candidate.type,label:chosen.candidate.label,reference:chosen.row.reference,urgencyMilli:chosen.score}),selectedProposal:chosen.candidate.proposal,reasons:freeze([reason,chosen.row.reason].slice(0,MAX_REASONS)),selectionId:"SELFCARE-"+hashText(stable({seed,when,candidateId:chosen.candidate.id,type:chosen.candidate.type,proposal:chosen.candidate.proposal})),bounds:freeze({maxCandidates:MAX_CANDIDATES,maxInventoryItems:MAX_INVENTORY_ITEMS,maxReasons:MAX_REASONS}),authority:authorityFlags()});
}
function authorityFlags(){return freeze({determinism:"Campaign SEED + Fantasy Game Time + supplied bounded authoritative/validated state",needsAuthority:false,healthAuthority:false,inventoryAuthority:false,directActionExecution:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,resourceFabrication:false,targetFabrication:false,simulationValidationBypass:false,fullWorldScan:false,wholeInventoryScan:false,perFrameScan:false,presentationAuthority:false,providerAuthority:false});}
function fromLive(seedValue,whenValue,optionsValue){const options=plain(optionsValue)?optionsValue:{},seed=clean(seedValue,160),when=clean(whenValue,32),identityKey=cleanId(options.identityKey||"protagonist",96)||"protagonist";let needs=options.needs||null,health=options.health||null,inventory=options.inventory||null;try{if(!needs)needs=root?.ProtagonistNeeds?.snapshot?.(seed,identityKey)||null;}catch(_){}try{if(!health)health=root?.ProtagonistHealth?.decisionContext?.(seed,identityKey)||null;}catch(_){}try{if(!inventory)inventory=root?.ProtagonistInventory?.commandContext?.(seed,identityKey)||root?.ProtagonistInventory?.snapshot?.(seed,identityKey)||null;}catch(_){}
  const result=evaluate({seed,when,needs,health,inventory,candidates:options.candidates||[]});return freeze({...clone(result),sources:freeze({needs:needs?"ProtagonistNeeds":"unavailable",health:health?"ProtagonistHealth":"unavailable",inventory:inventory?"ProtagonistInventory":"unavailable"}),liveAdapter:true});}
function evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue){const result=plain(resultValue)?resultValue:{},options=plain(optionsValue)?optionsValue:{};if(result.ok!==true||result.status!=="proposal-ready"||!result.selectedProposal)return freeze({ok:false,reason:"selected-self-care-proposal-required",config:null});return freeze({ok:true,reason:"proposal-ready",boundary:"ProtagonistCommandEvaluator",executionDisabled:true,config:freeze({seed:result.seed,when:result.when,snapshot:snapshotValue||null,proposal:result.selectedProposal,decisionContext:plain(decisionContextValue)?clone(decisionContextValue):undefined,actorPosition:options.actorPosition?clone(options.actorPosition):undefined,actorId:cleanId(options.actorId||"protagonist",120)||"protagonist",selectionId:result.selectionId,execute:false})});}
function runtimeInput(resultValue,snapshotValue,decisionContextValue,optionsValue){const handoff=evaluatorInput(resultValue,snapshotValue,decisionContextValue,optionsValue);if(!handoff.ok)return handoff;const config=handoff.config;return freeze({ok:true,reason:"runtime-schedule-ready",boundary:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",executionDisabled:true,config:freeze({seed:config.seed,when:config.when,snapshot:config.snapshot,proposal:config.proposal,decisionContext:config.decisionContext,actorPosition:config.actorPosition,actorId:config.actorId,selectionId:config.selectionId})});}
function schedule(resultValue,snapshotValue,decisionContextValue,optionsValue){const options=plain(optionsValue)?optionsValue:{},handoff=runtimeInput(resultValue,snapshotValue,decisionContextValue,options);if(!handoff.ok)return handoff;const runtime=options.runtime||root?.ProtagonistActionRuntime;if(!runtime?.schedule)return freeze({ok:false,reason:"protagonist-action-runtime-unavailable",boundary:handoff.boundary,directActionExecution:false});const scheduled=runtime.schedule(handoff.config);return freeze({ok:Boolean(scheduled?.ok),reason:scheduled?.reason||"scheduled",scheduled:scheduled||null,boundary:handoff.boundary,directActionExecution:false,simulationValidationBypass:false});}

return freeze({VERSION,MAX_CANDIDATES,MAX_INVENTORY_ITEMS,MAX_REASONS,ACTION_THRESHOLD,URGENT_THRESHOLD,CRITICAL_CONDITION,TYPES,evaluate,fromLive,evaluatorInput,runtimeInput,schedule,authority:authorityFlags()});
});
