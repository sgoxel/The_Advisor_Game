const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
const stores=new Map();
function fresh(seed){return {schema:'CampaignStateDelta',seed,sequence:0,entries:{}};}
function ensure(seed){if(!stores.has(seed))stores.set(seed,fresh(seed));return stores.get(seed);}
function refId(seed,kind,a,b){let h=2166136261>>>0;for(const ch of seed+'|'+kind+'|'+a+'|'+b){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return kind+'-'+(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
global.WorldState={
  structuralRef(seed,kind,a,b,metadata){return {id:refId(seed,kind,a,b),kind,metadata:clone(metadata)};},
  resolve(seed,ref){const entry=ensure(seed).entries[ref.id];return {current:entry?clone(entry.current):{},delta:entry?clone(entry):null};},
  applyDelta(seed,ref,patch,reason){const s=ensure(seed),prev=s.entries[ref.id]||{revision:0,current:{}};const entry={revision:prev.revision+1,reason,current:{...clone(prev.current),...clone(patch)}};s.entries[ref.id]=entry;s.sequence++;return {ok:true,entry:clone(entry),resolved:this.resolve(seed,ref)};}
};
global.ProtagonistProfile={derive(seed,key){return {protagonistId:'PROTAGONIST-'+Buffer.from(seed+'|'+key).toString('hex').slice(0,8).toUpperCase()};}};
global.GameTime={getTimestampKey(){return '1201-05-04 08:00:00';}};

const modulePath=path.resolve(__dirname,'../world/protagonist-guidance.js');
delete require.cache[modulePath];
const Guidance=require(modulePath);
assert(Guidance,'ProtagonistGuidance should attach to window');

const seed='WP-S009-009-SEED-A',identity='hero';
const unconditional=Guidance.create(seed,{topic:'conduct',principle:'Keep promises already made.',priority:60,stance:'encourage',fantasyTimestamp:'1201-05-04 08:00:00',links:{advisorRecordId:'ADV-42',conversationTransactionId:'CTX-42'},providerPayload:{secret:'must-not-persist'}},identity);
assert.equal(unconditional.ok,true);assert(/^GUID-[0-9A-F]{8}$/.test(unconditional.record.id));
assert.equal(unconditional.record.links.advisorRecordId,'ADV-42');assert.equal(unconditional.record.links.conversationTransactionId,'CTX-42');

const conditional=Guidance.create(seed,{topic:'travel',principle:'Avoid dangerous travel unless emergency authority applies.',priority:90,stance:'avoid',fantasyTimestamp:'1201-05-04 08:01:00',conditions:[{field:'topic',operator:'eq',value:'travel'},{field:'riskBand',operator:'eq',value:'high'}],exceptions:[{field:'authorityScope',operator:'contains',value:'emergency'}]},identity);
assert.equal(conditional.ok,true);

const invalid=Guidance.create(seed,{topic:'bad',principle:'bad',conditions:[{field:'arbitrary.javascript.path',operator:'eq',value:'x'}],fantasyTimestamp:'1201-05-04 08:02:00'},identity);
assert.equal(invalid.ok,false);assert(/Unsupported guidance condition field/.test(invalid.reason));

const highRisk={topic:'travel',riskBand:'high',authorityScope:['self']};
const relevantA=Guidance.relevant(seed,highRisk,{},identity),relevantB=Guidance.relevant(seed,clone(highRisk),{},identity);
assert.deepStrictEqual(relevantB,relevantA,'same records/context must produce deterministic relevance ordering');
assert.deepStrictEqual(relevantA.map(x=>x.id),[conditional.record.id,unconditional.record.id],'priority ordering must be deterministic');

const excepted=Guidance.relevant(seed,{topic:'travel',riskBand:'high',authorityScope:['self','emergency']},{},identity);
assert(excepted.some(x=>x.id===unconditional.record.id));assert(!excepted.some(x=>x.id===conditional.record.id),'matching exception must suppress conditional guidance');

const lowRisk=Guidance.relevant(seed,{topic:'travel',riskBand:'low',authorityScope:['self']},{},identity);
assert(!lowRisk.some(x=>x.id===conditional.record.id),'unsatisfied condition must fail closed');

const updated=Guidance.update(seed,unconditional.record.id,{priority:75,principle:'Keep explicit promises unless they conflict with safety.',fantasyTimestamp:'1201-05-04 08:03:00'},identity);
assert.equal(updated.ok,true);assert.equal(updated.record.priority,75);
const rewind=Guidance.update(seed,unconditional.record.id,{priority:20,fantasyTimestamp:'1201-05-04 08:02:59'},identity);
assert.equal(rewind.ok,false);assert.equal(rewind.reason,'cannot-rewind-guidance-chronology');

const beforeSave=Guidance.snapshot(seed,identity),serialized=JSON.stringify(ensure(seed));
assert.equal(beforeSave.recordCount,2);assert(beforeSave.serializedBytes<=Guidance.MAX_LEDGER_BYTES);
assert(!JSON.stringify(beforeSave).includes('must-not-persist'),'provider payload leaked into guidance persistence');
stores.set(seed,fresh(seed));assert.equal(Guidance.snapshot(seed,identity).recordCount,0);
stores.set(seed,JSON.parse(serialized));const afterReload=Guidance.snapshot(seed,identity);
assert.deepStrictEqual(afterReload,beforeSave,'save/reload must preserve guidance exactly');

const base={value:0.62,urgency:0.55,socialAcceptability:0.70,dutyConflict:false};
const evalCtx=Guidance.evaluationContext(seed,highRisk,base,{},identity);
assert.equal(evalCtx.advisoryOnly,true);assert.equal(evalCtx.forcedDecision,false);assert.equal(evalCtx.requiresEvaluator,true);
assert(Math.abs(evalCtx.valueShift)<=Guidance.MAX_DECISION_SHIFT+1e-9,'guidance shift exceeded advisory cap');
assert(evalCtx.matchedGuidanceIds.includes(conditional.record.id));assert.notEqual(evalCtx.decisionContext.value,base.value);

global.CommandSetInterface={validateProposal(snapshot,proposal){return Object.freeze({ok:true,status:'accepted',reason:'valid',proposalId:proposal.proposalId||null,commandId:proposal.commandId,validatedParameters:Object.freeze({...proposal.parameters}),source:proposal.source||'direct'});}};
const evaluatorPath=path.resolve(__dirname,'../world/protagonist-command-evaluator.js');
delete require.cache[evaluatorPath];
const Evaluator=require(evaluatorPath);
const evaluated=Evaluator.evaluate({seed,when:'1201-05-04 08:05:00',snapshot:{snapshotId:'GUID-SNAP',context:{seed,when:'1201-05-04 08:05:00'},targets:{}},proposal:{proposalId:'GUID-PROP',commandId:'advisor.query_information',parameters:{}},decisionContext:evalCtx.decisionContext,execute:false});
assert.equal(evaluated.protagonistEvaluation.checked,true);assert.equal(evaluated.execution.attempted,false);assert.equal(evaluated.authority.simulationValidation,true);assert.equal(evaluated.authority.parallelWorldAuthority,false);
assert.equal(evaluated.protagonistEvaluation.factors.value,evalCtx.decisionContext.value,'evaluator did not receive guidance-informed factor');

const retired=Guidance.retire(seed,conditional.record.id,{fantasyTimestamp:'1201-05-04 08:06:00'},identity);
assert.equal(retired.ok,true);assert.equal(retired.record.status,'retired');
assert(!Guidance.relevant(seed,highRisk,{},identity).some(x=>x.id===conditional.record.id));
assert.equal(Guidance.update(seed,conditional.record.id,{priority:99,fantasyTimestamp:'1201-05-04 08:07:00'},identity).reason,'retired-guidance');

global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;global.navigator={userAgent:'device-a'};
const presentationA=Guidance.relevant(seed,{topic:'conduct'}, {},identity);
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'device-b'};
const presentationB=Guidance.relevant(seed,{topic:'conduct'}, {},identity);
assert.deepStrictEqual(presentationB,presentationA,'presentation/device state influenced guidance relevance');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input reference: '+forbidden);
for(const forbidden of ['ActionExecutor.','RoutePlanner.','setPosition(','teleport('])assert(!source.includes(forbidden),'guidance must not directly execute/move: '+forbidden);
assert(source.includes('fullWorldScan:false')&&source.includes('wholeCampaignScan:false'),'bounded scan diagnostics missing');
assert(source.includes('advisoryOnly:true')&&source.includes('simulationValidationBypass:false'),'advisory boundary contract missing');

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/protagonist-guidance.js?v=protagonist-guidance-v1';assert(html.includes(script),'canonical root must load ProtagonistGuidance');assert(html.indexOf(script)>html.indexOf('scripts/world/protagonist-planner.js?v=protagonist-autonomous-planner-v1'));assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));}

const snap=Guidance.snapshot(seed,identity);
assert.equal(snap.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(snap.chronologyAuthority,'Fantasy Game Time');assert.equal(snap.advisoryOnly,true);assert.equal(snap.providerStatePersisted,false);assert.equal(snap.arbitraryPredicates,false);
assert.equal(snap.fullWorldScan,false);assert.equal(snap.wholeCampaignScan,false);assert.equal(snap.directActionExecution,false);

console.log(JSON.stringify({wp:'WP-S009-009',classification:'FUNCTIONAL',visual:'N/A — persistent advisory guidance metadata adds no rendered surface',pass:true,version:Guidance.VERSION,unconditionalGuidance:true,conditionalGuidance:true,exceptionSuppression:true,priorityOrdering:true,updateRetire:true,saveReload:true,stableLinks:true,providerPayloadPersisted:false,conditionSchemaWhitelisted:true,decisionFixtureConsideredGuidance:true,decisionForced:false,executionAttempted:false,maxRecords:Guidance.MAX_RECORDS,maxQueryResults:Guidance.MAX_QUERY_RESULTS,maxConditions:Guidance.MAX_CONDITIONS,maxExceptions:Guidance.MAX_EXCEPTIONS,maxDecisionShift:Guidance.MAX_DECISION_SHIFT,serializedBytes:snap.serializedBytes,fullWorldScan:false,wholeCampaignScan:false,directActionExecution:false},null,2));