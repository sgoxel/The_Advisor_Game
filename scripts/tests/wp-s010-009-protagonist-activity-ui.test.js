const assert=require('assert');
const fs=require('fs');
const path=require('path');
global.window=global;
const modulePath=path.resolve(__dirname,'../ui/protagonist-activity-ui.js');
delete require.cache[modulePath];
const UI=require(modulePath);

assert.equal(UI.VERSION,'protagonist-activity-ui-v1');
assert.deepStrictEqual(UI.EVIDENCE_MODES,['traveling','working','deferred','self-care','completed']);

for(const mode of UI.EVIDENCE_MODES){
  const model=UI.evidenceModel(mode),html=UI.markup(model);
  assert.equal(model.readOnly,true);
  assert.equal(model.eventDriven,true);
  assert.equal(model.authority.directExecution,false);
  assert.equal(model.authority.directWorldMutation,false);
  assert.equal(model.authority.wholeWorldScan,false);
  assert.equal(model.authority.wholeHistoryScan,false);
  assert.equal(model.authority.perFrameRender,false);
  assert.equal(model.authority.completionRequiresTerminalSimulation,true);
  assert(html.includes('advisor-activity-strip'));
  assert(html.includes('Read-only')||model.authorityLabel);
}
assert.equal(UI.evidenceModel('traveling').phase,'active');
assert.equal(UI.evidenceModel('working').kind,'work');
assert.equal(UI.evidenceModel('deferred').phase,'deferred');
assert.equal(UI.evidenceModel('self-care').phase,'planned');
assert.equal(UI.evidenceModel('self-care').completionBacked,false);
assert.equal(UI.evidenceModel('completed').phase,'completed');
assert.equal(UI.evidenceModel('completed').completionBacked,true);
assert(UI.markup(UI.evidenceModel('completed')).includes('SIM-WORK-77'));

function reset(){
  global.ProtagonistActionRuntime={snapshot(){return {pending:[],results:[]};}};
  global.ProtagonistJourney={snapshot(){return {active:null,history:[]};}};
  global.ProtagonistInteractionPipeline={snapshot(){return {active:[],results:[]};}};
}
const ctx={seed:'SEED-A',when:'1201-09-30 20:20:00'};
reset();
global.ProtagonistJourney={snapshot(){return {active:{journeyId:'JRN-LIVE',status:'travelling',progressMeters:40,route:{totalMeters:100,destinationLabel:'Market Gate'}}};}};
let live=UI.runtimeModel(ctx);
assert.equal(live.phase,'active');assert.equal(live.kind,'travel');assert.equal(live.progress,40);assert.equal(live.referenceId,'JRN-LIVE');

reset();
global.ProtagonistJourney={snapshot(){return {active:{journeyId:'JRN-COORD',status:'travelling',progressMeters:10,route:{totalMeters:50,destination:{x:'120',y:'-45',level:0}}}};}};
live=UI.runtimeModel(ctx);
assert.equal(live.target,'World cell 120, -45');assert(live.title.includes('World cell 120, -45'));

reset();
global.ProtagonistInteractionPipeline={snapshot(){return {active:[{attemptId:'IAX-LIVE',status:'active',action:'work',targetId:'FORGE-ANVIL',reason:'simulation-active',updatedFantasyTimestamp:'1201-09-30 20:19:00'}],results:[]};}};
live=UI.runtimeModel(ctx);
assert.equal(live.phase,'active');assert.equal(live.kind,'work');assert.equal(live.referenceId,'IAX-LIVE');

reset();
global.ProtagonistActionRuntime={snapshot(){return {pending:[{seed:'SEED-A',attemptId:'PAX-DEFER',state:'deferred',reason:'defer-for-health',proposal:{source:'protagonist-work-routine',commandId:'advisor.propose_interaction',parameters:{targetLabel:'North Gate'}}}],results:[]};}};
live=UI.runtimeModel(ctx);
assert.equal(live.phase,'deferred');assert.equal(live.completionBacked,false);assert(live.reason.includes('Defer'));

reset();
global.ProtagonistActionRuntime={snapshot(){return {pending:[{seed:'SEED-A',attemptId:'PAX-CARE',state:'pending',proposal:{source:'protagonist-self-care',commandId:'advisor.propose_interaction',parameters:{itemName:'Bread ration'}}}],results:[]};}};
live=UI.runtimeModel(ctx);
assert.equal(live.phase,'planned');assert.equal(live.kind,'self-care');assert.equal(live.target,'Bread Ration');assert.equal(live.completionBacked,false);

reset();
global.ProtagonistActionRuntime={snapshot(){return {pending:[],results:[
  {seed:'OTHER-SEED',attemptId:'PAX-OTHER',state:'succeeded',terminal:true,lastEvaluatedWhen:'1201-09-30 20:19:59',proposal:{source:'protagonist-work-routine',parameters:{targetLabel:'Wrong campaign'}},evaluatorResult:{execution:{actionExecuted:true,state:'succeeded',authoritativeResult:{id:'SIM-OTHER',terminal:true}}}},
  {seed:'SEED-A',attemptId:'PAX-DONE',state:'succeeded',terminal:true,lastEvaluatedWhen:'1201-09-30 20:19:00',proposal:{source:'protagonist-work-routine',parameters:{targetLabel:'Forge anvil'}},evaluatorResult:{execution:{actionExecuted:true,state:'succeeded',authoritativeResult:{id:'SIM-42',terminal:true}}}}
]};}};
live=UI.runtimeModel(ctx);
assert.equal(live.phase,'completed');assert.equal(live.completionBacked,true);assert.equal(live.resultId,'SIM-42');assert.equal(live.target,'Forge Anvil');

reset();
global.ProtagonistActionRuntime={snapshot(){return {pending:[],results:[{seed:'SEED-A',attemptId:'PAX-FORGED',state:'succeeded',terminal:true,lastEvaluatedWhen:'1201-09-30 20:19:00',proposal:{source:'protagonist-work-routine'},evaluatorResult:{execution:{actionExecuted:false,state:'succeeded',authoritativeResult:{id:'FAKE',terminal:true}}}}]};}};
live=UI.runtimeModel(ctx);
assert.notEqual(live.phase,'completed');assert.equal(live.completionBacked,false);assert(!UI.markup(live).includes('Simulation confirmed'));

reset();
global.ProtagonistInteractionPipeline={snapshot(){return {active:[],results:[{attemptId:'IAX-DONE',resultId:'IRX-DONE',status:'terminal-success',action:'inspect',targetId:'GATE',reason:'done',updatedFantasyTimestamp:'1201-09-30 20:19:30',simulation:{authoritativeTerminalSuccess:true}}]};}};
live=UI.runtimeModel(ctx);
assert.equal(live.phase,'completed');assert.equal(live.completionBacked,true);assert.equal(live.resultId,'IRX-DONE');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['requestAnimationFrame','setInterval(','Math.random','Date.now','applyDelta(','ActionExecutor.','RoutePlanner.','setPosition(','teleport(','schedule(','tick(','execute(']){
  assert(!source.includes(forbidden),'activity presentation must remain read-only/event-driven: '+forbidden);
}
assert(source.includes('completionRequiresTerminalSimulation:true'));
assert(source.includes('providerPayloadRendered:false'));

const repoRoot=path.resolve(__dirname,'../..');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const advisor=fs.readFileSync(path.join(repoRoot,'scripts/ui/advisor-conversation-ui.js'),'utf8');
const css=fs.readFileSync(path.join(repoRoot,'styles/main.css'),'utf8');
const activityScript='scripts/ui/protagonist-activity-ui.js?v=protagonist-activity-ui-v1';
const chatScript='scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1';
assert(index.includes(activityScript));
assert(index.indexOf(activityScript)<index.indexOf(chatScript),'activity UI must load before Advisor panel');
assert(advisor.includes('ProtagonistActivityUI?.markup'),'Advisor panel must host activity strip');
assert(css.includes('WP-S010-009 — Visible protagonist activity + intent/outcome presentation'));

const snap=UI.snapshot();
assert.equal(snap.authority.directExecution,false);
assert.equal(snap.authority.directWorldMutation,false);
assert.equal(snap.authority.wholeWorldScan,false);
assert.equal(snap.authority.wholeHistoryScan,false);
assert.equal(snap.authority.perFrameRender,false);
console.log(JSON.stringify({wp:'WP-S010-009',classification:'MIXED',functionalPass:true,evidenceModes:UI.EVIDENCE_MODES,completionRequiresTerminalSimulation:true,forgedCompletionSuppressed:true,eventDriven:true,readOnly:true,directExecution:false,directWorldMutation:false,wholeWorldScan:false,wholeHistoryScan:false,perFrameRender:false},null,2));
