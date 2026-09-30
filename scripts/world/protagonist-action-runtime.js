(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistActionRuntime=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-action-runtime-v1";
const MAX_PENDING=24;
const MAX_RESULTS=24;
const MAX_PER_TICK=4;
const MAX_TEXT=160;
const TERMINAL_STATES=Object.freeze(["succeeded","rejected","invalid","blocked"]);

function freeze(value){if(!value||typeof value!=="object"||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};for(const key of Object.keys(value).sort())if(value[key]!==undefined)out[key]=canonical(value[key]);return out;}return value;}
function stable(value){return JSON.stringify(canonical(value));}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function clean(value,max=MAX_TEXT){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=MAX_TEXT){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function parts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p;}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe;}
function secondIndex(value){const p=parts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null;}
function normalizeProposal(value){if(!plain(value))return null;const commandId=cleanId(value.commandId);if(!commandId)return null;const parameters=plain(value.validatedParameters)?clone(value.validatedParameters):plain(value.parameters)?clone(value.parameters):{};return freeze({proposalId:cleanId(value.proposalId)||null,commandId,parameters,source:cleanId(value.source||"autonomous-runtime",80)||"autonomous-runtime"});}
function normalizePlan(value){if(!plain(value)||value.ok!==true)return null;const proposal=normalizeProposal(value.selectedProposal);if(!proposal)return null;return freeze({planId:cleanId(value.planId)||null,selectionId:cleanId(value.selectionId)||null,seed:clean(value.seed),when:clean(value.when,32),proposal});}
function terminalSuccess(execution){const state=cleanId(execution?.state,80).toLowerCase();return execution?.actionExecuted===true&&["complete","completed","success","succeeded"].includes(state);}
function mapResult(record){
  const decision=cleanId(record?.decision,40).toLowerCase(),validation=record?.finalValidation||{},execution=record?.execution||{};
  if(decision==="invalid"||validation.ok===false)return {state:"invalid",terminal:true,reason:cleanId(validation.reason||"invalid",120)||"invalid"};
  if(decision==="rejected")return {state:"rejected",terminal:true,reason:"protagonist-rejected"};
  if(decision==="deferred")return {state:"deferred",terminal:false,reason:"protagonist-deferred"};
  if(terminalSuccess(execution))return {state:"succeeded",terminal:true,reason:"simulation-terminal-success"};
  if(execution?.state==="blocked")return {state:"blocked",terminal:true,reason:cleanId(execution.reason||"simulation-blocked",120)||"simulation-blocked"};
  if(decision==="accepted"||decision==="modified")return {state:"running",terminal:false,reason:cleanId(execution.reason||execution.state||"simulation-handoff-active",120)||"simulation-handoff-active"};
  return {state:"blocked",terminal:true,reason:"unsupported-evaluator-result"};
}
function attemptId(seed,scheduledWhen,actorId,planId,selectionId,proposal){return "PAX-"+hashText(stable({seed,scheduledWhen,actorId,planId,selectionId,proposal}));}

function createRuntime(optionsValue){
  const options=plain(optionsValue)?optionsValue:{},evaluator=options.evaluator||root?.ProtagonistCommandEvaluator||null;
  const pending=[],results=[],byId=new Map();
  let lastTickSecond=null,lastScheduleSecond=null;
  const telemetryState={scheduled:0,duplicates:0,ticks:0,processed:0,terminal:0,deferred:0,running:0,invalid:0,rejected:0,blocked:0,succeeded:0,maxProcessedInTick:0,evaluatorCalls:0};

  function snapshotRecord(row){return freeze(clone(row));}
  function addResult(row){results.push(snapshotRecord(row));while(results.length>MAX_RESULTS)results.shift();}
  function sortPending(){pending.sort((a,b)=>a.dueSecond-b.dueSecond||a.attemptId.localeCompare(b.attemptId));}
  function fail(reason,extra){return freeze({ok:false,reason,...(extra||{}),bounded:true,directWorldMutation:false,directPositionMutation:false,teleportation:false});}

  function schedule(configValue){
    const config=plain(configValue)?configValue:{},plan=normalizePlan(config.plan),proposal=plan?.proposal||normalizeProposal(config.proposal);
    const seed=clean(config.seed||plan?.seed,160),scheduledWhen=clean(config.when||plan?.when,32),dueWhen=clean(config.dueWhen||scheduledWhen,32),actorId=cleanId(config.actorId||"protagonist",120)||"protagonist";
    if(!seed)return fail("campaign-seed-required");
    if(!validWhen(scheduledWhen)||!validWhen(dueWhen))return fail("fantasy-time-required");
    const scheduledSecond=secondIndex(scheduledWhen),dueSecond=secondIndex(dueWhen);
    if(dueSecond<scheduledSecond)return fail("due-time-before-schedule");
    if(lastScheduleSecond!=null&&scheduledSecond<lastScheduleSecond)return fail("cannot-rewind-schedule-chronology");
    if(!proposal)return fail("executable-proposal-required");
    if(pending.length>=MAX_PENDING)return fail("pending-cap-reached",{maxPending:MAX_PENDING});
    const planId=plan?.planId||cleanId(config.planId)||null,selectionId=plan?.selectionId||cleanId(config.selectionId)||null;
    const id=attemptId(seed,scheduledWhen,actorId,planId,selectionId,proposal),existing=byId.get(id);
    if(existing){telemetryState.duplicates++;return freeze({ok:true,duplicate:true,attempt:snapshotRecord(existing)});}
    const row={version:VERSION,attemptId:id,seed,actorId,scheduledWhen,dueWhen,dueSecond,planId,selectionId,proposal,snapshot:config.snapshot||null,decisionContext:plain(config.decisionContext)?clone(config.decisionContext):null,actorPosition:config.actorPosition?clone(config.actorPosition):null,modifiedProposal:config.modifiedProposal?clone(config.modifiedProposal):null,state:"pending",terminal:false,reason:"scheduled",attemptCount:0,lastEvaluatedWhen:null,evaluatorTransactionId:null,evaluatorDecisionId:null,evaluatorExecutionId:null};
    pending.push(row);byId.set(id,row);sortPending();lastScheduleSecond=scheduledSecond;telemetryState.scheduled++;
    return freeze({ok:true,duplicate:false,attempt:snapshotRecord(row)});
  }

  function tick(configValue){
    const config=plain(configValue)?configValue:{},seed=clean(config.seed,160),when=clean(config.when,32);
    if(!seed)return fail("campaign-seed-required");
    if(!validWhen(when))return fail("fantasy-time-required");
    const now=secondIndex(when);if(lastTickSecond!=null&&now<lastTickSecond)return fail("cannot-rewind-tick-chronology");
    const limit=Math.max(1,Math.min(MAX_PER_TICK,Number.isFinite(Number(config.maxAttempts))?Math.floor(Number(config.maxAttempts)):MAX_PER_TICK));
    telemetryState.ticks++;const processed=[],processedIds=new Set();
    for(let i=0;i<pending.length&&processed.length<limit;){
      const row=pending[i];if(row.seed!==seed||row.dueSecond>now||processedIds.has(row.attemptId)){i++;continue;}
      processedIds.add(row.attemptId);
      pending.splice(i,1);row.state="running";row.reason="execution-started";row.attemptCount++;row.lastEvaluatedWhen=when;
      if(!evaluator?.evaluate){row.state="blocked";row.terminal=true;row.reason="protagonist-evaluator-unavailable";telemetryState.blocked++;telemetryState.terminal++;addResult(row);processed.push(snapshotRecord(row));continue;}
      telemetryState.evaluatorCalls++;
      const record=evaluator.evaluate({seed,when,snapshot:row.snapshot,proposal:row.proposal,decisionContext:row.decisionContext||undefined,actorPosition:row.actorPosition||undefined,actorId:row.actorId,modifiedProposal:row.modifiedProposal||undefined,execute:true});
      row.evaluatorTransactionId=cleanId(record?.transactionId)||null;row.evaluatorDecisionId=cleanId(record?.decisionId)||null;row.evaluatorExecutionId=cleanId(record?.executionId)||null;
      const mapped=mapResult(record);row.state=mapped.state;row.terminal=mapped.terminal;row.reason=mapped.reason;row.evaluatorResult=record?clone(record):null;
      telemetryState.processed++;telemetryState[row.state]=(telemetryState[row.state]||0)+1;
      if(row.terminal){telemetryState.terminal++;addResult(row);}else{row.dueWhen=when;row.dueSecond=now;pending.push(row);sortPending();}
      processed.push(snapshotRecord(row));
    }
    lastTickSecond=now;telemetryState.maxProcessedInTick=Math.max(telemetryState.maxProcessedInTick,processed.length);
    return freeze({ok:true,seed,when,processed:freeze(processed),processedCount:processed.length,pendingCount:pending.length,resultCount:results.length,maxPerTick:MAX_PER_TICK,bounded:true,eventDriven:true,perFrameScan:false,fullWorldScan:false,directWorldMutation:false,directPositionMutation:false,teleportation:false});
  }

  function get(attemptIdValue){const row=byId.get(cleanId(attemptIdValue));return row?snapshotRecord(row):null;}
  function snapshot(){return freeze({version:VERSION,pending:freeze(pending.map(snapshotRecord)),results:freeze(results.map(snapshotRecord)),pendingCount:pending.length,resultCount:results.length,bounds:freeze({maxPending:MAX_PENDING,maxResults:MAX_RESULTS,maxPerTick:MAX_PER_TICK}),eventDriven:true,perFrameScan:false,fullWorldScan:false,wholeHistoryScan:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,simulationValidationBypass:false,authority:"ProtagonistCommandEvaluator + Simulation"});}
  function telemetry(){return freeze({...telemetryState,pendingCount:pending.length,resultCount:results.length,maxPending:MAX_PENDING,maxResults:MAX_RESULTS,maxPerTick:MAX_PER_TICK,eventDriven:true,perFrameScan:false,fullWorldScan:false,authority:false});}
  function reset(){pending.length=0;results.length=0;byId.clear();lastTickSecond=null;lastScheduleSecond=null;for(const key of Object.keys(telemetryState))telemetryState[key]=0;return true;}
  return freeze({schedule,tick,get,snapshot,telemetry,reset});
}

const defaultRuntime=createRuntime();
return freeze({VERSION,MAX_PENDING,MAX_RESULTS,MAX_PER_TICK,TERMINAL_STATES,createRuntime,schedule:defaultRuntime.schedule,tick:defaultRuntime.tick,get:defaultRuntime.get,snapshot:defaultRuntime.snapshot,telemetry:defaultRuntime.telemetry,reset:defaultRuntime.reset});
});
