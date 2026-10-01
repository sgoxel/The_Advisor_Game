(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistInteractionPipeline=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-interaction-pipeline-v1";
const SCHEMA="ProtagonistInteractionLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-interaction-ledger";
const REGISTRY_KEY="autonomous-interactions";
const MAX_ACTIVE=8;
const MAX_RESULTS=24;
const MAX_LEDGER_BYTES=64*1024;
const MAX_ADVANCE_SECONDS=30;
const MAX_REFERENCES=8;
const TARGET_KINDS=Object.freeze(["object","building","person"]);
const ACTIVE_STATES=Object.freeze(["pending","active"]);
const TERMINAL_STATES=Object.freeze(["rejected","unavailable","failed","terminal-success"]);

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value);}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;return unescape(encodeURIComponent(text)).length;}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function point(value){if(!plain(value)||value.x==null||value.y==null)return null;return freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function timestamp(value){const out=clean(value,32);if(!validWhen(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out;}
function parts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p;}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe;}
function secondIndex(value){const p=parts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null;}
function currentTimestamp(){return root?.GameTime?.getTimestampKey?.()||null;}
function requiredSeed(value){const seed=clean(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed;}
function uniqueIds(values){const out=[];for(const value of Array.isArray(values)?values:[]){const id=cleanId(value);if(id&&!out.includes(id))out.push(id);if(out.length>=MAX_REFERENCES)break;}return out;}
function normalizeReferences(value){const src=plain(value)?value:{};return freeze({conversationTransactionIds:freeze(uniqueIds(src.conversationTransactionIds||[src.conversationTransactionId].filter(Boolean))),proposalIds:freeze(uniqueIds(src.proposalIds||[src.proposalId].filter(Boolean))),decisionIds:freeze(uniqueIds(src.decisionIds||[src.decisionId].filter(Boolean))),runtimeAttemptIds:freeze(uniqueIds(src.runtimeAttemptIds||[src.runtimeAttemptId].filter(Boolean)))});}
function actorId(value){return cleanId(value||"protagonist",120)||"protagonist";}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist";}

function registryContext(worldState,seedValue,identityValue){
  const seed=requiredSeed(seedValue),identity=identityKey(identityValue),actor=actorId(identity);
  const ref=worldState?.structuralRef?.(seed,REGISTRY_KIND,actor,REGISTRY_KEY,{role:"persistent-protagonist-interactions",actorId:actor,identityKey:identity,authority:"ProtagonistInteractionPipeline Simulation-result references"})||null;
  return freeze({seed,identityKey:identity,actorId:actor,ref});
}
function emptyLedger(ctx){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,actorId:ctx.actorId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:0,active:[],results:[],bounds:{maxActive:MAX_ACTIVE,maxResults:MAX_RESULTS,maxBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}};}
function rowShapeValid(row,terminal){
  if(!plain(row)||!/^IAX-[0-9A-F]{8}$/.test(String(row.attemptId||""))||!validWhen(row.startedFantasyTimestamp)||!validWhen(row.updatedFantasyTimestamp))return false;
  if(!TARGET_KINDS.includes(row.targetKind)||!row.targetId||!row.action||!row.actorId)return false;
  if(terminal){if(!TERMINAL_STATES.includes(row.status)||!/^IRX-[0-9A-F]{8}$/.test(String(row.resultId||"")))return false;}
  else if(!ACTIVE_STATES.includes(row.status)||row.resultId!=null)return false;
  if(!plain(row.references)||!plain(row.simulation))return false;
  if(row.status==="terminal-success"&&row.simulation.authoritativeTerminalSuccess!==true)return false;
  return true;
}
function ledgerCompatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.actorId!==ctx.actorId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(!Array.isArray(raw.active)||raw.active.length>MAX_ACTIVE||!raw.active.every(row=>rowShapeValid(row,false)))return false;
  if(!Array.isArray(raw.results)||raw.results.length>MAX_RESULTS||!raw.results.every(row=>rowShapeValid(row,true)))return false;
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function resultId(row){return "IRX-"+hashText(stable({attemptId:row.attemptId,status:row.status,reason:row.reason,simulation:row.simulation}));}
function terminalize(row,status,reason,simulation,when){const out=clone(row);out.status=status;out.reason=cleanId(reason||status,120)||status;out.updatedFantasyTimestamp=when;out.revision=Math.max(1,Number(out.revision)||1)+1;out.simulation=freeze({...clone(out.simulation||{}),...clone(simulation||{}),authoritativeTerminalSuccess:status==="terminal-success"&&simulation?.authoritativeTerminalSuccess===true});out.resultId=resultId(out);return freeze(out);}
function activeUpdate(row,status,reason,simulation,when){const out=clone(row);out.status=status;out.reason=cleanId(reason||status,120)||status;out.updatedFantasyTimestamp=when;out.revision=Math.max(1,Number(out.revision)||1)+1;out.simulation=freeze({...clone(out.simulation||{}),...clone(simulation||{}),authoritativeTerminalSuccess:false});out.resultId=null;return freeze(out);}
function publicRow(row){return row?freeze(clone(row)):null;}

function defaultAdapter(){
  function descriptor(seed,row){return root?.ObjectInteractions?.get?.(seed,row.targetId)||null;}
  function validation(seed,row,position){
    if(row.targetKind==="person")return freeze({ok:false,status:"unavailable",reason:"person-interaction-adapter-unavailable",delegate:"Dialogue/Social interaction authority unavailable"});
    const oi=root?.ObjectInteractions;if(!oi?.get||!oi?.context)return freeze({ok:false,status:"unavailable",reason:"object-interactions-unavailable",delegate:"ObjectInteractions"});
    const desc=descriptor(seed,row);if(!desc)return freeze({ok:false,status:"unavailable",reason:"target-unavailable",delegate:"ObjectInteractions"});
    const context=oi.context(seed,row.targetId,position);if(!context)return freeze({ok:false,status:"unavailable",reason:"target-unavailable",delegate:"ObjectInteractions"});
    const action=context.actions?.find(item=>String(item.id)===row.action)||null;
    if(!action)return freeze({ok:false,status:"rejected",reason:"action-not-supported",delegate:"ObjectInteractions"});
    if(!action.enabled)return freeze({ok:false,status:"unavailable",reason:String(action.reason||"interaction-unavailable"),delegate:"ObjectInteractions",target:point(action.target)});
    return freeze({ok:true,status:"ready",reason:"interaction-ready",delegate:"ObjectInteractions",descriptor:desc,target:point(action.target)});
  }
  function start(seed,row,position){
    const checked=validation(seed,row,position);if(!checked.ok)return checked;
    const result=root.ObjectInteractions.attempt?.(seed,{actorKind:"protagonist",actorId:row.actorId,actorPosition:position,objectId:row.targetId,action:row.action});
    if(!result)return freeze({ok:false,status:"failed",reason:"interaction-attempt-no-result",delegate:"ObjectInteractions"});
    if(result.ok!==true){const reason=String(result.reason||"interaction-rejected");return freeze({ok:false,status:reason==="unknown-object"||reason==="out-of-range"?"unavailable":"rejected",reason,delegate:"ObjectInteractions",authoritativeResult:clone(result)});}
    const status=String(result.status||"").toLowerCase();
    if(["complete","completed","success","succeeded"].includes(status)&&result.authoritative===true)return freeze({ok:true,status:"terminal-success",reason:String(result.reason||"interaction-complete"),delegate:"ObjectInteractions",authoritativeTerminalSuccess:true,authoritativeResult:clone(result)});
    if(status==="active")return freeze({ok:true,status:"active",reason:String(result.reason||"interaction-active"),delegate:"ObjectInteractions -> ActionExecutor",authoritativeResult:clone(result)});
    if(status==="ready"||status==="pending")return freeze({ok:true,status:"pending",reason:String(result.reason||"interaction-pending"),delegate:String(result.delegatesTo||"ObjectInteractions"),authoritativeResult:clone(result)});
    return freeze({ok:false,status:"failed",reason:String(result.reason||"interaction-failed"),delegate:"ObjectInteractions",authoritativeResult:clone(result)});
  }
  function advance(seed,row,position,elapsedSeconds){
    const checked=validation(seed,row,position);if(!checked.ok)return checked;
    if(row.status==="pending")return freeze({ok:true,status:"pending",reason:"awaiting-existing-simulation-controller",delegate:row.simulation?.delegate||checked.delegate});
    const executor=root?.ActionExecutor;if(!executor?.advanceActor)return freeze({ok:false,status:"failed",reason:"action-executor-unavailable",delegate:"ActionExecutor"});
    const desc=checked.descriptor,target=checked.target;
    const activity=freeze({state:"protagonist-interaction-"+row.action,action:row.action,intendedAction:row.action,label:row.action,target,buildingId:String(desc?.buildingId||""),targetSource:"interior-interaction",interactionObjectId:String(desc?.id||row.targetId),interactionObjectType:String(desc?.type||""),supportedActions:freeze([...(desc?.actions||[]).filter(action=>action!=="inspect")])});
    const result=executor.advanceActor({seed:String(seed),actorKind:"protagonist",actorId:row.actorId,position,activity},elapsedSeconds);
    const status=String(result?.status||"").toLowerCase();
    if(status==="complete"&&result?.state?.authoritative===true)return freeze({ok:true,status:"terminal-success",reason:"simulation-terminal-success",delegate:"ActionExecutor",authoritativeTerminalSuccess:true,authoritativeResult:clone(result.state)});
    if(status==="active")return freeze({ok:true,status:"active",reason:"simulation-active",delegate:"ActionExecutor",authoritativeResult:clone(result.state)});
    if(status==="waiting-arrival")return freeze({ok:false,status:"unavailable",reason:String(result?.reason||"target-unavailable"),delegate:"ActionExecutor"});
    return freeze({ok:false,status:"failed",reason:String(result?.reason||"simulation-failed"),delegate:"ActionExecutor",authoritativeResult:clone(result?.state||null)});
  }
  return freeze({validation,start,advance});
}

function createService(optionsValue){
  const options=plain(optionsValue)?optionsValue:{},adapter=options.adapter||defaultAdapter();
  const world=()=>options.worldState||root?.WorldState;
  function readLedger(seedValue,identityValue){
    const ws=world(),ctx=registryContext(ws,seedValue,identityValue),resolved=ctx.ref&&ws?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistInteractions;
    if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
    if(!ledgerCompatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
    return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
  }
  function fitLedger(ledger){
    ledger.active=(ledger.active||[]).slice(-MAX_ACTIVE);ledger.results=(ledger.results||[]).slice(-MAX_RESULTS);
    while(ledger.results.length&&utf8Bytes(stable(ledger))>MAX_LEDGER_BYTES)ledger.results.shift();
    return ledger;
  }
  function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
    const ws=world(),read=readLedger(seedValue,identityValue),ctx=read.ctx;if(!read.compatible)return freeze({ok:false,reason:read.reason});
    if(!ctx.ref||!ws?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
    const next=fitLedger(clone(ledgerValue));next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.actorId=ctx.actorId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
    if(!ledgerCompatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
    const result=ws.applyDelta(ctx.seed,ctx.ref,{protagonistInteractions:next},String(reasonValue||"protagonist-interaction"));
    return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),serializedBytes:utf8Bytes(stable(next))});
  }
  function findByExternal(ledger,externalKey){if(!externalKey)return null;return [...ledger.active,...ledger.results].find(row=>row.externalKey===externalKey)||null;}
  function findById(ledger,id){return [...ledger.active,...ledger.results].find(row=>row.attemptId===id||row.resultId===id)||null;}
  function storeRow(seed,identity,read,row){
    const next=clone(read.ledger),terminal=TERMINAL_STATES.includes(row.status);next.active=next.active.filter(x=>x.attemptId!==row.attemptId);next.results=next.results.filter(x=>x.attemptId!==row.attemptId);
    if(terminal)next.results.push(clone(row));else next.active.push(clone(row));
    const write=writeLedger(seed,identity,next,"protagonist-interaction:"+row.attemptId+":"+row.status);return freeze({...write,interaction:write.ok?publicRow(row):null});
  }
  function normalizeInput(seed,inputValue,identityValue){
    const input=plain(inputValue)?inputValue:{},actor=actorId(input.actorId||identityValue),targetKind=cleanId(input.targetKind,24).toLowerCase(),targetId=cleanId(input.targetId,160),action=cleanId(input.action,80).toLowerCase(),position=point(input.actorPosition||input.position),externalKey=cleanId(input.externalKey||input.runtimeAttemptId||input.attemptId||"",160)||null;
    let when;try{when=timestamp(input.fantasyTimestamp||input.when||currentTimestamp());}catch(error){return {ok:false,reason:String(error.message||error)};}
    if(!TARGET_KINDS.includes(targetKind))return {ok:false,reason:"target-kind-invalid"};if(!targetId)return {ok:false,reason:"target-id-required"};if(!action)return {ok:false,reason:"action-required"};if(!position)return {ok:false,reason:"actor-position-required"};
    return {ok:true,seed,actorId:actor,targetKind,targetId,action,actorPosition:position,externalKey,when,references:normalizeReferences(input.references||input)};
  }
  function applyAdapterOutcome(seed,identity,read,row,outcome,when){
    const rawStatus=cleanId(outcome?.status||"failed",40).toLowerCase(),status=ACTIVE_STATES.includes(rawStatus)||TERMINAL_STATES.includes(rawStatus)?rawStatus:"failed";
    const simulation=freeze({delegate:clean(outcome?.delegate||"Simulation",120),authoritativeResultId:cleanId(outcome?.authoritativeResult?.id||outcome?.authoritativeResult?.resultId||"",160)||null,authoritativeStatus:cleanId(outcome?.authoritativeResult?.status||"",80)||null,authoritativeTerminalSuccess:status==="terminal-success"&&outcome?.authoritativeTerminalSuccess===true,worldTruthCopied:false});
    const next=TERMINAL_STATES.includes(status)?terminalize(row,status,outcome?.reason||status,simulation,when):activeUpdate(row,status,outcome?.reason||status,simulation,when);
    return storeRow(seed,identity,read,next);
  }
  function advanceExisting(seed,input,identity,read,row){
    const now=secondIndex(input.when),previous=secondIndex(row.updatedFantasyTimestamp);if(now<previous)return freeze({ok:false,reason:"cannot-rewind-interaction-chronology",interaction:publicRow(row),claimedCompletionSuppressed:false});
    const elapsed=Math.max(0,now-previous),processed=Math.min(elapsed,MAX_ADVANCE_SECONDS);
    if(elapsed===0)return freeze({ok:true,reason:"duplicate-active",duplicate:true,processedSeconds:0,unprocessedSeconds:0,interaction:publicRow(row)});
    const outcome=adapter.advance?.(seed,publicRow(row),input.actorPosition,processed)||{ok:false,status:"failed",reason:"simulation-adapter-unavailable",delegate:"Simulation"};
    const stored=applyAdapterOutcome(seed,identity,read,row,outcome,input.when);return freeze({...stored,duplicate:false,processedSeconds:processed,unprocessedSeconds:Math.max(0,elapsed-processed)});
  }
  function execute(seedValue,inputValue,identityValue){
    let seed;try{seed=requiredSeed(seedValue);}catch(error){return freeze({ok:false,reason:String(error.message||error)});}const input=normalizeInput(seed,inputValue,identityValue);if(!input.ok)return freeze(input);
    const read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const existing=findByExternal(read.ledger,input.externalKey);if(existing){
      if(existing.targetKind!==input.targetKind||existing.targetId!==input.targetId||existing.action!==input.action||existing.actorId!==input.actorId)return freeze({ok:false,reason:"external-key-conflict",interaction:publicRow(existing)});
      if(TERMINAL_STATES.includes(existing.status))return freeze({ok:true,reason:"duplicate-terminal",duplicate:true,interaction:publicRow(existing)});
      return advanceExisting(seed,input,identityValue,read,existing);
    }
    if(read.ledger.active.length>=MAX_ACTIVE)return freeze({ok:false,reason:"active-cap-reached",maxActive:MAX_ACTIVE});
    const attemptId="IAX-"+hashText(stable({seed,actorId:input.actorId,when:input.when,targetKind:input.targetKind,targetId:input.targetId,action:input.action,externalKey:input.externalKey,references:input.references}));
    const byId=findById(read.ledger,attemptId);if(byId)return freeze({ok:true,reason:TERMINAL_STATES.includes(byId.status)?"duplicate-terminal":"duplicate-active",duplicate:true,interaction:publicRow(byId)});
    const row=freeze({attemptId,resultId:null,actorId:input.actorId,targetKind:input.targetKind,targetId:input.targetId,action:input.action,externalKey:input.externalKey,startedFantasyTimestamp:input.when,updatedFantasyTimestamp:input.when,revision:1,status:"pending",reason:"created",references:input.references,simulation:freeze({delegate:"Simulation",authoritativeResultId:null,authoritativeStatus:null,authoritativeTerminalSuccess:false,worldTruthCopied:false})});
    const checked=adapter.validation?.(seed,row,input.actorPosition)||{ok:false,status:"unavailable",reason:"simulation-adapter-unavailable",delegate:"Simulation"};
    if(!checked.ok)return applyAdapterOutcome(seed,identityValue,read,row,checked,input.when);
    const outcome=adapter.start?.(seed,row,input.actorPosition)||{ok:false,status:"failed",reason:"simulation-start-unavailable",delegate:"Simulation"};
    return applyAdapterOutcome(seed,identityValue,read,row,outcome,input.when);
  }
  function claimCompletion(seedValue,inputValue,identityValue){
    let seed;try{seed=requiredSeed(seedValue);}catch(error){return freeze({ok:false,reason:String(error.message||error)});}const input=plain(inputValue)?inputValue:{},read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const id=cleanId(input.attemptId||input.resultId||"",160),externalKey=cleanId(input.externalKey||"",160)||null,row=id?findById(read.ledger,id):findByExternal(read.ledger,externalKey);if(!row)return freeze({ok:false,reason:"interaction-not-found",claimedCompletionSuppressed:true});
    if(row.status!=="terminal-success"||row.simulation?.authoritativeTerminalSuccess!==true)return freeze({ok:false,reason:"claimed-success-not-authoritative",claimedCompletionSuppressed:true,interaction:publicRow(row)});
    return freeze({ok:true,reason:"already-authoritative-terminal-success",claimedCompletionSuppressed:false,interaction:publicRow(row)});
  }
  function get(seedValue,idValue,identityValue){const read=readLedger(seedValue,identityValue);if(!read.compatible)return null;const row=findById(read.ledger,cleanId(idValue,160));return publicRow(row);}
  function list(seedValue,optionsValue,identityValue){const read=readLedger(seedValue,identityValue),options=plain(optionsValue)?optionsValue:{};if(!read.compatible)return freeze([]);const status=cleanId(options.status||"",40),limit=Math.max(0,Math.min(MAX_RESULTS,Math.floor(Number(options.limit)||MAX_RESULTS)));let rows=[...read.ledger.active,...read.ledger.results];if(status)rows=rows.filter(row=>row.status===status);rows.sort((a,b)=>a.updatedFantasyTimestamp.localeCompare(b.updatedFantasyTimestamp)||a.attemptId.localeCompare(b.attemptId));return freeze(rows.slice(Math.max(0,rows.length-limit)).map(publicRow));}
  function snapshot(seedValue,identityValue){const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({version:VERSION,seed,compatible:false,reason:read.reason,activeCount:0,resultCount:0,active:freeze([]),results:freeze([]),bounded:true,fullWorldScan:false,wholeHistoryScan:false});const serialized=stable(read.ledger);return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:true,reason:read.reason,activeCount:read.ledger.active.length,resultCount:read.ledger.results.length,active:freeze(read.ledger.active.map(publicRow)),results:freeze(read.ledger.results.map(publicRow)),serializedBytes:utf8Bytes(serialized),bounds:freeze({maxActive:MAX_ACTIVE,maxResults:MAX_RESULTS,maxLedgerBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}),indexedById:true,eventDriven:true,perFrameScan:false,fullWorldScan:false,wholeHistoryScan:false,directWorldMutation:false,directPositionMutation:false,teleportation:false,worldTruthCopied:false,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",simulationAuthority:"ObjectInteractions / ActionExecutor or supplied Simulation adapter"});}
  function clear(seedValue,identityValue){const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);if(!read.compatible)return freeze({ok:false,reason:read.reason});return writeLedger(seed,identityValue,emptyLedger(read.ctx),"protagonist-interactions-clear");}
  return freeze({execute,claimCompletion,get,list,snapshot,clear});
}

const defaultService=createService();
return freeze({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,MAX_ACTIVE,MAX_RESULTS,MAX_LEDGER_BYTES,MAX_ADVANCE_SECONDS,TARGET_KINDS,ACTIVE_STATES,TERMINAL_STATES,createService,execute:defaultService.execute,claimCompletion:defaultService.claimCompletion,get:defaultService.get,list:defaultService.list,snapshot:defaultService.snapshot,clear:defaultService.clear});
});
