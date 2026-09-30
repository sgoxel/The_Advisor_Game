const assert=require('assert');
const fs=require('fs');
const path=require('path');

global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;

function clone(v){return v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b||{})){out[k]=(v&&typeof v==='object'&&!Array.isArray(v))?merge(out[k]||{},v):clone(v);}return out;}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
const stores=new Map();
function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
global.WorldState={
  structuralRef(seed,kind,parent,key,initial){return{id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
  resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return{current:merge(ref.key.initial,entry?.changes||{}),delta:entry?clone(entry):null};},
  applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return{ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
  serializeState(seed){return clone(ensure(seed));},
  restoreSerializedState(campaign,value){stores.set(String(campaign.seed),clone(value));return{ok:true};}
};

let rhetoricLevel=1;
global.AdvisorProgression={getSkill(seed,skill){assert.equal(skill,'rhetoric');return{level:rhetoricLevel,totalXp:(rhetoricLevel-1)*100};}};

global.CommandSetInterface={
  validateProposal(snapshot,proposal){
    if(proposal.commandId==='advisor.impossible')return Object.freeze({ok:false,status:'rejected',reason:'unsupported-command',commandId:proposal.commandId,details:null});
    if(proposal.commandId!=='advisor.propose_advice')return Object.freeze({ok:false,status:'rejected',reason:'unsupported-command',commandId:proposal.commandId,details:null});
    return Object.freeze({ok:true,status:'validated',reason:'proposal-valid',commandId:proposal.commandId,snapshotId:snapshot.snapshotId,proposalId:proposal.proposalId||null,source:proposal.source||'direct',validatedParameters:Object.freeze({...proposal.parameters}),worldMutation:false,executionAttempted:false});
  }
};

const evaluatorPath=path.resolve(__dirname,'../world/protagonist-command-evaluator.js');
delete require.cache[evaluatorPath];
const Evaluator=require(evaluatorPath);
const modulePath=path.resolve(__dirname,'../world/advisor-rhetoric.js');
delete require.cache[modulePath];
const Rhetoric=require(modulePath);
assert(Rhetoric,'AdvisorRhetoric should attach to window');

const seed='WP-S011-003-SEED-A';
const snapshot={snapshotId:'RHETORIC-SNAPSHOT',context:{seed,when:'1201-05-04 10:00:00'},targets:{}};

function favorableContext(base={value:.72,urgency:.72,socialAcceptability:.72,dutyConflict:false}){
  return {
    decisionContext:base,
    personality:{traits:{resolve:70,empathy:100,curiosity:70,caution:50,ambition:80,sociability:75}},
    relationships:{trust:100,suspicion:0},
    goals:{records:[{id:'GOAL-FAMILY',status:'active',priority:100}]},
    knowledge:[{id:'KNOW-FACT-1',reliability:'verified',status:'confirmed'}]
  };
}
function unfavorableContext(){
  return {
    decisionContext:{value:.38,urgency:.30,socialAcceptability:.34,dutyConflict:false},
    personality:{traits:{resolve:30,empathy:10,curiosity:20,caution:80,ambition:20,sociability:15}},
    relationships:{trust:10,suspicion:90},
    goals:{records:[{id:'GOAL-LOW',status:'active',priority:10}]},
    knowledge:[{id:'KNOW-DISPUTED',reliability:'disputed',status:'conflicted'}]
  };
}
function argument(style='empathy',goalIds=['GOAL-FAMILY'],knowledgeRefIds=['KNOW-FACT-1']){
  return {messageId:'MSG-1',argumentId:'ARG-1',appealStyle:style,goalIds,knowledgeRefIds,text:'provider wording must have no authority',providerPayload:{secret:'must-not-persist'}};
}

rhetoricLevel=1;
const favorable=Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:00:00',argument:argument(),context:favorableContext()});
assert(favorable.ok);assert(favorable.assessment.modifier>0);assert(favorable.assessment.modifier<=Rhetoric.MAX_MODIFIER);
assert.equal(favorable.assessment.decisionContext.urgency,.72);assert.equal(favorable.assessment.decisionContext.dutyConflict,false);
const favorableReplay=Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:00:00',argument:argument(),context:favorableContext()});
assert.deepStrictEqual(favorableReplay,favorable,'same authoritative inputs must replay exactly');

const accepted=Evaluator.evaluate({seed,when:'1201-05-04 10:00:00',snapshot,execute:false,proposal:{proposalId:'PROP-FAVORABLE',commandId:'advisor.propose_advice',parameters:{topic:'Help the family'}},decisionContext:favorable.assessment.decisionContext});
assert.equal(accepted.decision,'accepted');
const recordedAccepted=Rhetoric.recordOutcome(seed,favorable.assessment,accepted);
assert(recordedAccepted.ok);assert.equal(recordedAccepted.outcome.decision,'accepted');
assert.equal(recordedAccepted.progressionEvidence.kind,'advisor-tool-result');
assert.equal(recordedAccepted.progressionEvidence.authority,'AdvisorToolResolution');
assert.equal(recordedAccepted.progressionEvidence.toolId,'advisor.rhetoric');
assert(/^RHO-[0-9A-F]{8}$/.test(recordedAccepted.outcome.id));

const duplicate=Rhetoric.recordOutcome(seed,favorable.assessment,accepted);
assert(duplicate.ok&&duplicate.duplicate);assert.equal(Rhetoric.snapshot(seed).outcomeCount,1);

const unfavorable=Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:01:00',argument:{...argument('empathy',['GOAL-LOW'],['KNOW-DISPUTED']),messageId:'MSG-2',argumentId:'ARG-2'},context:unfavorableContext()});
assert(unfavorable.ok);assert(unfavorable.assessment.modifier<0);
const rejected=Evaluator.evaluate({seed,when:'1201-05-04 10:01:00',snapshot:{...snapshot,context:{seed,when:'1201-05-04 10:01:00'}},execute:false,proposal:{proposalId:'PROP-UNFAVORABLE',commandId:'advisor.propose_advice',parameters:{topic:'Risky proposal'}},decisionContext:unfavorable.assessment.decisionContext});
assert.equal(rejected.decision,'rejected');
assert(Rhetoric.recordOutcome(seed,unfavorable.assessment,rejected).ok);

const neutralContext={
  decisionContext:{value:.50,urgency:.50,socialAcceptability:.50,dutyConflict:false},
  personality:{traits:{resolve:50,empathy:50,curiosity:50,caution:50,ambition:50,sociability:50}},
  relationships:{trust:50,suspicion:50},goals:{records:[]},knowledge:[]
};
const neutral=Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:02:00',argument:{messageId:'MSG-3',argumentId:'ARG-3',appealStyle:'neutral',goalIds:[],knowledgeRefIds:[]},context:neutralContext});
assert(neutral.ok);assert.equal(neutral.assessment.modifier,0);
const deferred=Evaluator.evaluate({seed,when:'1201-05-04 10:02:00',snapshot:{...snapshot,context:{seed,when:'1201-05-04 10:02:00'}},execute:false,proposal:{proposalId:'PROP-NEUTRAL',commandId:'advisor.propose_advice',parameters:{topic:'Neutral proposal'}},decisionContext:neutral.assessment.decisionContext});
assert.equal(deferred.decision,'deferred','neutral rhetoric fixture should preserve evaluator deferral');
assert(Rhetoric.recordOutcome(seed,neutral.assessment,deferred).ok);

rhetoricLevel=1;
const lowSkill=Rhetoric.assess('WP-S011-003-SKILL',{fantasyTimestamp:'1201-05-04 11:00:00',argument:argument(),context:favorableContext()});
rhetoricLevel=20;
const highSkill=Rhetoric.assess('WP-S011-003-SKILL',{fantasyTimestamp:'1201-05-04 11:00:00',argument:argument(),context:favorableContext()});
assert(lowSkill.ok&&highSkill.ok);assert(highSkill.assessment.modifier>lowSkill.assessment.modifier);
assert(highSkill.assessment.skill.bonus<=Rhetoric.MAX_SKILL_BONUS);assert(highSkill.assessment.modifier<=Rhetoric.MAX_MODIFIER);

const positiveLowBase=Rhetoric.assess('WP-S011-003-AUTONOMY',{fantasyTimestamp:'1201-05-04 12:00:00',argument:argument(),context:favorableContext({value:.05,urgency:.05,socialAcceptability:.05,dutyConflict:false})});
assert(positiveLowBase.assessment.modifier>0);
const autonomousReject=Evaluator.evaluate({seed:'WP-S011-003-AUTONOMY',when:'1201-05-04 12:00:00',snapshot:{snapshotId:'AUTO',context:{seed:'WP-S011-003-AUTONOMY',when:'1201-05-04 12:00:00'},targets:{}},execute:false,proposal:{proposalId:'PROP-AUTO',commandId:'advisor.propose_advice',parameters:{topic:'Still rejectable'}},decisionContext:positiveLowBase.assessment.decisionContext});
assert.equal(autonomousReject.decision,'rejected','positive rhetoric must not force acceptance');

const invalidPositive=Rhetoric.assess('WP-S011-003-INVALID',{fantasyTimestamp:'1201-05-04 13:00:00',argument:argument(),context:favorableContext({value:1,urgency:1,socialAcceptability:1,dutyConflict:false})});
const invalid=Evaluator.evaluate({seed:'WP-S011-003-INVALID',when:'1201-05-04 13:00:00',snapshot:{snapshotId:'INVALID',context:{seed:'WP-S011-003-INVALID',when:'1201-05-04 13:00:00'},targets:{}},execute:false,proposal:{proposalId:'PROP-INVALID',commandId:'advisor.impossible',parameters:{}},decisionContext:invalidPositive.assessment.decisionContext});
assert.equal(invalid.decision,'invalid');assert.equal(invalid.execution.attempted,false);assert.equal(invalid.finalValidation.ok,false);
const invalidRecord=Rhetoric.recordOutcome('WP-S011-003-INVALID',invalidPositive.assessment,invalid);
assert(invalidRecord.ok);assert.equal(invalidRecord.progressionEvidence,null,'invalid command must not generate progression evidence');

assert.equal(Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:03:00',argument:{...argument(),goalIds:['MISSING']},context:favorableContext()}).ok,false);
assert.equal(Rhetoric.assess(seed,{fantasyTimestamp:'1201-05-04 10:03:00',argument:{...argument(),knowledgeRefIds:['MISSING']},context:favorableContext()}).ok,false);

const beforeSave=Rhetoric.snapshot(seed),serialized=global.WorldState.serializeState(seed);
assert(beforeSave.serializedBytes<=Rhetoric.MAX_LEDGER_BYTES);assert.equal(beforeSave.outcomeCount,3);
assert(!JSON.stringify(serialized).includes('provider wording'),'provider wording leaked into persistence');
assert(!JSON.stringify(serialized).includes('must-not-persist'),'provider payload leaked into persistence');
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});
assert.equal(Rhetoric.snapshot(seed).outcomeCount,0);
global.WorldState.restoreSerializedState({seed},serialized);
assert.deepStrictEqual(Rhetoric.snapshot(seed),beforeSave,'save/reload must preserve rhetoric outcome references');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!source.includes(forbidden),'forbidden non-authoritative input: '+forbidden);
for(const forbidden of ['ActionExecutor.','RoutePlanner.','setPosition(','teleport(','SocialState.apply','ProtagonistGoals.update','ProtagonistInventory.'])assert(!source.includes(forbidden),'rhetoric must not mutate/execute: '+forbidden);
for(const required of ['fullWorldScan:false','wholeHistoryScan:false','perFrameScan:false','directWorldMutation:false','forcedDecision:false','guaranteedPersuasion:false','simulationValidationBypass:false'])assert(source.includes(required),'missing authority/bounds marker: '+required);

const repoRoot=path.resolve(__dirname,'../..'),indexPath=path.join(repoRoot,'index.html');
if(fs.existsSync(indexPath)){
  const html=fs.readFileSync(indexPath,'utf8'),script='scripts/world/advisor-rhetoric.js?v=advisor-rhetoric-v1';
  assert(html.includes(script),'canonical root must load AdvisorRhetoric');
  assert(html.indexOf(script)>html.indexOf('scripts/world/advisor-insight.js?v=advisor-insight-v1'));
  assert(html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
}

const final=Rhetoric.snapshot(seed);
assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');
assert.equal(final.chronologyAuthority,'Fantasy Game Time');
assert.equal(final.decisionAuthority,'ProtagonistCommandEvaluator');
assert.equal(final.maxModifier,.08);assert.equal(final.maxSkillBonus,.02);
assert.equal(final.fullWorldScan,false);assert.equal(final.wholeHistoryScan,false);assert.equal(final.perFrameScan,false);
assert.equal(final.directWorldMutation,false);assert.equal(final.relationshipMutation,false);assert.equal(final.goalMutation,false);assert.equal(final.inventoryMutation,false);assert.equal(final.authorityMutation,false);
assert.equal(final.forcedDecision,false);assert.equal(final.guaranteedPersuasion,false);assert.equal(final.simulationValidationBypass,false);

console.log(JSON.stringify({
  wp:'WP-S011-003',
  classification:'FUNCTIONAL',
  visual:'N/A — bounded persuasion/evaluator logic adds no rendered surface',
  pass:true,
  favorableDecision:accepted.decision,
  unfavorableDecision:rejected.decision,
  neutralDecision:deferred.decision,
  positiveInfluenceStillRejected:autonomousReject.decision,
  invalidCommandStillInvalid:invalid.decision,
  stableAttemptIds:true,
  duplicateOutcomeIdempotence:true,
  progressionEvidence:true,
  lowSkillModifier:lowSkill.assessment.modifier,
  highSkillModifier:highSkill.assessment.modifier,
  maxModifier:Rhetoric.MAX_MODIFIER,
  maxSkillBonus:Rhetoric.MAX_SKILL_BONUS,
  saveReload:true,
  providerWordingAuthority:false,
  directWorldMutation:false,
  forcedDecision:false,
  simulationValidationBypass:false
},null,2));