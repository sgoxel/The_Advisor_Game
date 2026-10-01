'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/ui/advisor-security-readout-ui.js');
const source=fs.readFileSync(modulePath,'utf8');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const advisor=fs.readFileSync(path.join(repoRoot,'scripts/ui/advisor-conversation-ui.js'),'utf8');
const css=fs.readFileSync(path.join(repoRoot,'styles/main.css'),'utf8');

let reads={health:0,inventory:0,skill:0,authority:0};
global.ProtagonistHealth={decisionContext(){reads.health++;return{conditionMilli:88000,fatigueMilli:27000,activeInjuryCount:1,injuries:[{kind:'sprain'}]}}};
global.ProtagonistInventory={snapshot(){reads.inventory++;return{compatible:true,records:[
  {id:'POS-NAME-ONLY',label:'Sword of Doom',ownershipState:'owned',carryState:'carried',metadata:{}},
  {id:'POS-SPEAR',label:'Watch spear',ownershipState:'owned',carryState:'carried',metadata:{martialWeaponClass:'standard',martialReachClass:'long'}},
  {id:'POS-JACK',label:'Padded jack',ownershipState:'owned',carryState:'carried',metadata:{martialProtectionClass:'light'}}
]}}};
global.ProtagonistSkills={getSkill(seed,id){reads.skill++;assert.equal(id,'martial');return{level:4,points:760}}};
global.ProtagonistAuthority={decisionContext(){reads.authority++;return{available:true,roleId:'squire',roleLabel:'Squire',rankTier:1,scopes:['self','local:protection','local:escort']}}};
delete global.ProtagonistMartialReadiness;
delete global.LocalSecurityIncidents;
delete global.PersonalCombatExchange;

const UI=require(modulePath);
assert.equal(UI.VERSION,'advisor-security-readout-v1');
assert.deepStrictEqual(UI.EVIDENCE_MODES,['ordinary','threat','uncertain']);
assert(UI.proof().pass,'deterministic evidence proof failed');

const securityScript='scripts/ui/advisor-security-readout-ui.js?v=advisor-security-readout-v1';
const chatScript='scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1';
assert(index.includes(securityScript),'security readout script missing from index');
assert(index.indexOf(securityScript)<index.indexOf(chatScript),'security readout must load before Advisor panel');
assert(advisor.includes('AdvisorSecurityReadoutUI?.markup'),'Advisor panel must host security readout');
assert(css.includes('WP-S014-009 — Advisor threat, martial readiness + security readout'),'security readout CSS marker missing');

const ordinary=UI.evidenceModel('ordinary');
assert.equal(ordinary.summary,'No known active threat');
assert.equal(ordinary.threats.length,0);
const threat=UI.evidenceModel('threat');
assert.equal(threat.summary,'2 known threats');
assert.equal(threat.readiness.score,68);
assert(threat.threats.some(x=>x.epistemic==='confirmed'));
assert(threat.threats.some(x=>x.epistemic==='reported'));
assert(threat.outcomes.length>0&&threat.outcomes.every(x=>x.terminal===true));
const uncertain=UI.evidenceModel('uncertain');
assert.equal(uncertain.summary,'Threat picture uncertain');
assert.equal(uncertain.threatUnknown,true);
assert(uncertain.sources.some(x=>x.available===false));

const noStage14=UI.runtimeModel({seed:'WP-S014-009-SEED',when:'1201-10-01 18:45:00'});
assert.equal(noStage14.threatUnknown,true,'Stage 14 absence must be explicit, not fabricated');
assert.equal(noStage14.equipment.length,2,'only metadata-grounded equipment capability should be shown');
assert(!noStage14.equipment.some(x=>x.label==='Sword of Doom'),'item names must not infer capability');
assert.equal(noStage14.readiness.status,'context-only');
assert(noStage14.readiness.meaning.includes('no victory probability'));

const explicit=UI.runtimeModel({seed:'WP-S014-009-SEED',when:'1201-10-01 18:46:00',securityEvidence:{
  readiness:{ok:true,readinessScore:63,readinessStatus:'prepared-with-constraints',readinessMeaning:'Personal readiness only.',martialSkill:{level:4},health:{conditionMilli:88000,fatigueMilli:27000,activeInjuryCount:1},equipment:[{id:'POS-SPEAR'}]},
  threats:[{id:'REP-1',summary:'A watch runner reports movement near the ford',severity:'moderate',epistemicStatus:'reported',status:'active',locationRef:{label:'Old ford'},sourceSystem:'ResidentReport'}],
  outcomes:[{id:'CBT-1',resolution:'protagonist-disengaged',terminal:true,locationRef:{label:'North lane'},fantasyTimestamp:'1201-10-01 18:30:00',sourceSystem:'Simulation'},{id:'CBT-NONTERM',resolution:'active',terminal:false}]
}});
assert.equal(explicit.summary,'1 known threat');
assert.equal(explicit.threats[0].epistemic,'reported');
assert.equal(explicit.outcomes.length,1,'non-terminal outcomes must be excluded');
assert.equal(explicit.outcomes[0].terminal,true);

const html=UI.markup(threat);
for(const title of ['Condition','Martial readiness','Known threats','Protection duty','Recent terminal outcomes'])assert(html.includes(title),'missing card '+title);
assert(html.includes('Confirmed')&&html.includes('Reported'));
assert(html.includes('PRESENTATION ONLY'));

const snap=UI.snapshot();
assert(snap.sourceReadTotal<=UI.MAX_SOURCE_READS,'bounded read cap exceeded');
const auth=snap.authority;
assert.equal(auth.eventDriven,true);assert.equal(auth.bounded,true);assert.equal(auth.boundedReads,true);
for(const key of ['perFrameRead','fullWorldScan','wholeSettlementScan','wholeHistoryScan','directWorldMutation','directActionExecution','combatResolution','retreatExecution','healthMutation','inventoryMutation','skillMutation','standingMutation','rankMutation','relationshipMutation','legalAuthority','protagonistDecisionBypass','simulationValidationBypass'])assert.equal(auth[key],false,key+' authority regression');
assert.equal(auth.presentationOnly,true);
assert.deepStrictEqual(reads,{health:2,inventory:2,skill:2,authority:2});

assert(css.includes('.advisor-chat-panel:has(.advisor-security-readout[open]) .advisor-readout-stack{min-height:0;overflow:hidden}'),'open security readout stack must contain its content');
assert(css.includes('.advisor-chat-panel:has(.advisor-security-readout[open]) .advisor-security-readout{box-sizing:border-box;min-height:0;height:100%;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr)}'),'open security readout must own the Advisor content track');
assert(css.includes('.advisor-chat-panel:has(.advisor-security-readout[open]) .advisor-security-body{min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain}'),'security body must scroll inside the readout instead of spilling outside');
assert(css.includes('.advisor-chat-panel:has(.advisor-security-readout[open]) .advisor-activity-strip{display:none!important}'),'security readout must reserve the header track for security content on constrained viewports');

for(const forbidden of ['Date.now','Math.random','applyInjury(','recordSimulation(','resolveExchange(','setPosition(','teleport(','ActionExecutor.'])assert(!source.includes(forbidden),'forbidden execution/mutation path '+forbidden);

console.log(JSON.stringify({
  wp:'WP-S014-009',classification:'MIXED',pass:true,
  ordinary:ordinary.summary,threat:threat.summary,uncertain:uncertain.summary,
  runtimeWithoutStage14:noStage14.summary,explicitThreat:explicit.summary,
  equipmentCapabilityRows:noStage14.equipment.length,sourceReadTotal:snap.sourceReadTotal,authority:auth
},null,2));
