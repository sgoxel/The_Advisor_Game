(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistActivityUI=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-activity-ui-v1";
const EVIDENCE_MODES=Object.freeze(["traveling","working","deferred","self-care","completed"]);
const PHASES=Object.freeze(["idle","planned","active","deferred","blocked","completed"]);
const MAX_RUNTIME_ROWS=24;
const state={evidenceMode:null,modelBuilds:0,runtimeBuilds:0,evidenceBuilds:0,lastModel:null};

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value)}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [key,item] of Object.entries(value))out[key]=clone(item);return out}
function cleanText(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max)}
function cleanId(value,max=160){return cleanText(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function esc(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function title(value){return cleanText(value,120).replace(/[_:-]+/g," ").replace(/\b[a-z]/g,c=>c.toUpperCase())}
function pct(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):null}
function latest(rows,field){return (Array.isArray(rows)?rows.slice(0,MAX_RUNTIME_ROWS):[]).filter(Boolean).sort((a,b)=>String(a?.[field]||"").localeCompare(String(b?.[field]||""))).slice(-1)[0]||null}
function sourceKind(proposal){
  const source=cleanId(proposal?.source||"",80).toLowerCase(),command=cleanId(proposal?.commandId||"",120).toLowerCase();
  if(source.includes("self-care")||source.includes("selfcare"))return"self-care";
  if(source.includes("work")||command.includes("work"))return"work";
  if(command.includes("travel")||command.includes("navigate")||command.includes("move"))return"travel";
  if(command.includes("interaction")||command.includes("interact")||command.includes("speak"))return"interaction";
  return"action";
}
function targetFromProposal(proposal){
  const p=proposal?.parameters||{};
  const raw=p.targetLabel||p.label||p.destinationLabel||p.targetName||p.itemName||p.workplaceName||p.targetId||p.destinationId||p.objectId||p.buildingId||p.personId||p.itemId||p.workplaceId||p.target||p.destination;
  return raw==null?null:title(raw);
}
function reasonLabel(value){const out=cleanId(value||"",120);return out?title(out):null}
function strictActionCompletion(row){
  const execution=row?.evaluatorResult?.execution||{},stateValue=cleanId(execution?.state||"",40).toLowerCase(),result=execution?.authoritativeResult||{};
  return Boolean(row?.terminal===true&&row?.state==="succeeded"&&execution?.actionExecuted===true&&["complete","completed","success","succeeded"].includes(stateValue)&&result?.terminal===true&&cleanId(result?.id||result?.resultId||"",160));
}
function strictInteractionCompletion(row){return Boolean(row?.status==="terminal-success"&&row?.simulation?.authoritativeTerminalSuccess===true&&cleanId(row?.resultId||"",160))}
function baseModel(value){
  state.modelBuilds++;
  const phase=PHASES.includes(value.phase)?value.phase:"idle",completionBacked=phase==="completed"?value.completionBacked===true:false;
  const model=freeze({
    version:VERSION,mode:value.mode||"runtime",when:cleanText(value.when||"",32),phase,kind:cleanId(value.kind||"activity",40)||"activity",
    eyebrow:cleanText(value.eyebrow||"CURRENT ACTIVITY",40),title:cleanText(value.title||"No current autonomous action",120),
    target:value.target?cleanText(value.target,120):null,detail:value.detail?cleanText(value.detail,180):null,reason:value.reason?cleanText(value.reason,180):null,
    progress:pct(value.progress),referenceId:cleanId(value.referenceId||"",160)||null,resultId:cleanId(value.resultId||"",160)||null,
    authorityLabel:cleanText(value.authorityLabel||"Read-only projection",80),completionBacked,
    readOnly:true,eventDriven:true,bounded:true,
    authority:freeze({directExecution:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,wholeWorldScan:false,wholeHistoryScan:false,perFrameRender:false,providerPayloadRendered:false,completionRequiresTerminalSimulation:true,presentationAuthority:false})
  });
  state.lastModel=model;return model;
}
function evidenceModel(modeValue){
  state.evidenceBuilds++;
  const mode=EVIDENCE_MODES.includes(modeValue)?modeValue:"traveling",when="1201-09-30 20:20:00";
  if(mode==="traveling")return baseModel({mode,when,phase:"active",kind:"travel",eyebrow:"MOVING",title:"Traveling to North Gate",target:"North Gate",detail:"Validated route · physical travel in progress",progress:42,referenceId:"JRN-A12F90C1",authorityLabel:"Journey progress"});
  if(mode==="working")return baseModel({mode,when,phase:"active",kind:"work",eyebrow:"WORKING",title:"Working at the smithy",target:"Forge anvil",detail:"Simulation interaction active",referenceId:"IAX-7B4D9012",authorityLabel:"Simulation active"});
  if(mode==="deferred")return baseModel({mode,when,phase:"deferred",kind:"work",eyebrow:"DEFERRED",title:"Gate patrol deferred",target:"North Gate patrol",detail:"Duty remains pending · no action executed",reason:"Fatigue pressure requires rest first",referenceId:"PAX-4E2C77A1",authorityLabel:"Protagonist decision"});
  if(mode==="self-care")return baseModel({mode,when,phase:"planned",kind:"self-care",eyebrow:"SELF-CARE INTENT",title:"Eat before resuming duty",target:"Bread ration",detail:"Proposal queued for protagonist evaluation",reason:"Hunger pressure 91",referenceId:"PAX-91A3D20F",authorityLabel:"Intent only"});
  return baseModel({mode,when,phase:"completed",kind:"work",eyebrow:"RECENT OUTCOME",title:"Smithy task completed",target:"Forge anvil",detail:"Terminal Simulation result confirmed",referenceId:"PAX-22A7C831",resultId:"SIM-WORK-77",authorityLabel:"Simulation confirmed",completionBacked:true});
}
function runtimeModel(ctx){
  state.runtimeBuilds++;
  const seed=cleanText(ctx?.seed||"",160),identityKey=cleanId(ctx?.identityKey||"protagonist",96)||"protagonist",when=cleanText(ctx?.when||"",32);
  let action=null,journey=null,interaction=null;
  try{action=root.ProtagonistActionRuntime?.snapshot?.()||null}catch(_){}
  try{journey=root.ProtagonistJourney?.snapshot?.(seed,identityKey)||null}catch(_){}
  try{interaction=root.ProtagonistInteractionPipeline?.snapshot?.(seed,identityKey)||null}catch(_){}

  const activeJourney=journey?.active||null;
  if(activeJourney&&String(activeJourney.status||"")==="travelling"){
    const total=Number(activeJourney.route?.totalMeters),done=Number(activeJourney.progressMeters),progress=Number.isFinite(total)&&total>0&&Number.isFinite(done)?done*100/total:null;
    const destination=activeJourney.destinationLabel||activeJourney.route?.destinationLabel||activeJourney.route?.destination?.label||null;
    return baseModel({mode:"runtime",when,phase:"active",kind:"travel",eyebrow:"MOVING",title:destination?("Traveling to "+cleanText(destination,100)):"Traveling on a validated route",target:destination?cleanText(destination,100):null,detail:"Physical journey in progress",progress,referenceId:activeJourney.journeyId,authorityLabel:"Journey progress"});
  }

  const activeInteraction=latest(interaction?.active,"updatedFantasyTimestamp");
  if(activeInteraction){
    return baseModel({mode:"runtime",when,phase:"active",kind:activeInteraction.action==="work"?"work":"interaction",eyebrow:activeInteraction.action==="work"?"WORKING":"INTERACTING",title:title(activeInteraction.action||"Interaction")+" in progress",target:title(activeInteraction.targetId||"Target"),detail:reasonLabel(activeInteraction.reason)||"Simulation interaction active",referenceId:activeInteraction.attemptId,authorityLabel:"Simulation active"});
  }

  const pending=(Array.isArray(action?.pending)?action.pending.slice(0,MAX_RUNTIME_ROWS):[]).filter(row=>!seed||!row?.seed||row.seed===seed);
  const current=pending.slice().reverse()[0]||null;
  if(current){
    const kind=sourceKind(current.proposal),target=targetFromProposal(current.proposal),phase=current.state==="deferred"?"deferred":(current.state==="running"?"active":"planned");
    const eyebrow=phase==="deferred"?"DEFERRED":kind==="self-care"?"SELF-CARE INTENT":phase==="active"?"ACTIVE":"CURRENT INTENT";
    return baseModel({mode:"runtime",when,phase,kind,eyebrow,title:kind==="self-care"?"Self-care proposal":kind==="work"?"Work proposal":title(current.proposal?.commandId||"Autonomous proposal"),target,detail:phase==="planned"?"Queued for protagonist evaluation":phase==="active"?"Simulation handoff active":"No action executed",reason:phase==="deferred"?(reasonLabel(current.reason)||"Protagonist deferred"):null,referenceId:current.attemptId,authorityLabel:phase==="active"?"Simulation handoff":"Intent / decision"});
  }

  const recentInteraction=latest(interaction?.results,"updatedFantasyTimestamp");
  const recentAction=latest(action?.results,"lastEvaluatedWhen");
  if(recentInteraction&&(!recentAction||String(recentInteraction.updatedFantasyTimestamp||"")>=String(recentAction.lastEvaluatedWhen||""))){
    if(strictInteractionCompletion(recentInteraction))return baseModel({mode:"runtime",when,phase:"completed",kind:recentInteraction.action==="work"?"work":"interaction",eyebrow:"RECENT OUTCOME",title:title(recentInteraction.action||"Interaction")+" completed",target:title(recentInteraction.targetId||"Target"),detail:"Terminal Simulation result confirmed",referenceId:recentInteraction.attemptId,resultId:recentInteraction.resultId,authorityLabel:"Simulation confirmed",completionBacked:true});
    return baseModel({mode:"runtime",when,phase:"blocked",kind:"interaction",eyebrow:"RECENT OUTCOME",title:"Interaction did not complete",target:title(recentInteraction.targetId||"Target"),detail:"No authoritative completion recorded",reason:reasonLabel(recentInteraction.reason)||title(recentInteraction.status||"Stopped"),referenceId:recentInteraction.attemptId,resultId:recentInteraction.resultId,authorityLabel:"Simulation result"});
  }
  if(recentAction){
    if(strictActionCompletion(recentAction)){
      const result=recentAction.evaluatorResult.execution.authoritativeResult;
      return baseModel({mode:"runtime",when,phase:"completed",kind:sourceKind(recentAction.proposal),eyebrow:"RECENT OUTCOME",title:"Action completed",target:targetFromProposal(recentAction.proposal),detail:"Terminal Simulation result confirmed",referenceId:recentAction.attemptId,resultId:result.id||result.resultId,authorityLabel:"Simulation confirmed",completionBacked:true});
    }
    const blocked=recentAction.state==="blocked"||recentAction.state==="invalid"||recentAction.state==="rejected";
    return baseModel({mode:"runtime",when,phase:blocked?"blocked":"idle",kind:sourceKind(recentAction.proposal),eyebrow:"RECENT OUTCOME",title:blocked?"Action did not complete":"No current autonomous action",target:targetFromProposal(recentAction.proposal),detail:"No authoritative completion recorded",reason:reasonLabel(recentAction.reason),referenceId:recentAction.attemptId,authorityLabel:"Runtime result"});
  }
  return baseModel({mode:"runtime",when,phase:"idle",kind:"idle",eyebrow:"CURRENT ACTIVITY",title:"No current autonomous action",detail:"Waiting for the next protagonist decision",authorityLabel:"Read-only projection"});
}
function currentModel(ctx){return state.evidenceMode?evidenceModel(state.evidenceMode):runtimeModel(ctx||{})}
function setEvidenceMode(modeValue){state.evidenceMode=EVIDENCE_MODES.includes(String(modeValue||""))?String(modeValue):null;return currentModel({seed:"EVIDENCE",when:"1201-09-30 20:20:00"})}
function phaseLabel(phase){return phase==="planned"?"Intent":phase.charAt(0).toUpperCase()+phase.slice(1)}
function markup(modelValue){
  const m=modelValue||state.lastModel||evidenceModel("traveling"),progress=m.progress==null?"":'<span class="advisor-activity-progress" aria-label="Progress '+m.progress+' percent"><i style="width:'+m.progress+'%"></i></span>';
  const target=m.target?'<span class="advisor-activity-target"><b>Target</b> '+esc(m.target)+'</span>':"";
  const reason=m.reason?'<span class="advisor-activity-reason"><b>Why</b> '+esc(m.reason)+'</span>':"";
  const result=m.resultId?'<span class="advisor-activity-result"><b>Result</b> '+esc(m.resultId)+'</span>':"";
  return '<section class="advisor-activity-strip" data-activity-phase="'+esc(m.phase)+'" data-activity-kind="'+esc(m.kind)+'" aria-label="Current protagonist activity">'+
    '<div class="advisor-activity-signal" aria-hidden="true"></div>'+
    '<div class="advisor-activity-main"><small>'+esc(m.eyebrow)+'</small><strong>'+esc(m.title)+'</strong><span>'+esc(m.detail||"Read-only activity projection")+'</span>'+progress+'</div>'+
    '<div class="advisor-activity-meta"><span class="advisor-activity-phase">'+esc(phaseLabel(m.phase))+'</span><span class="advisor-activity-authority">'+esc(m.authorityLabel)+'</span></div>'+
    '<div class="advisor-activity-context">'+target+reason+result+'</div>'+
    '</section>';
}
function snapshot(){const m=state.lastModel;return freeze({version:VERSION,evidenceMode:state.evidenceMode,modelBuilds:state.modelBuilds,runtimeBuilds:state.runtimeBuilds,evidenceBuilds:state.evidenceBuilds,lastPhase:m?.phase||null,lastKind:m?.kind||null,completionBacked:Boolean(m?.completionBacked),authority:m?.authority||freeze({directExecution:false,directWorldMutation:false,wholeWorldScan:false,wholeHistoryScan:false,perFrameRender:false,completionRequiresTerminalSimulation:true})})}

try{const p=typeof URLSearchParams!=="undefined"&&root.location?.search?new URLSearchParams(root.location.search):null,requested=p?.get?.("advisorActivityEvidence");if(EVIDENCE_MODES.includes(requested))state.evidenceMode=requested}catch(_){}

return freeze({VERSION,EVIDENCE_MODES,PHASES,MAX_RUNTIME_ROWS,evidenceModel,runtimeModel,currentModel,setEvidenceMode,markup,snapshot});
});