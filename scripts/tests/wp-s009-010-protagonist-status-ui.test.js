const assert=require('assert');
const fs=require('fs');
const path=require('path');
global.window=global;
const modulePath=path.resolve(__dirname,'../ui/protagonist-status-ui.js');
delete require.cache[modulePath];
const UI=require(modulePath);
assert.equal(UI.VERSION,'protagonist-status-ui-v1');
assert.deepStrictEqual(UI.EVIDENCE_MODES,['healthy','pressure','injured','authority','unavailable']);

for(const mode of UI.EVIDENCE_MODES){
  const model=UI.evidenceModel(mode),html=UI.markup(model);
  assert.equal(model.readOnly,true);assert.equal(model.eventDriven,true);assert.equal(model.authorityFlags.directWorldMutation,false);
  assert.equal(model.authorityFlags.directExecution,false);assert.equal(model.authorityFlags.perFrameRender,false);assert.equal(model.authorityFlags.wholeWorldScan,false);
  assert(html.includes('PROTAGONIST READOUT'));assert(html.includes('Read-only · event-driven'));
  assert(html.includes('Authoritative'));assert(html.includes('Long-term guidance'));
}
const healthy=UI.evidenceModel('healthy');
assert.equal(healthy.unavailable.length,0);assert(healthy.needs.value.every(x=>x.value<60));assert(healthy.health.value.condition>90);
const pressure=UI.evidenceModel('pressure');
assert(pressure.needs.value.some(x=>x.key==='hunger'&&x.value>=80));assert(pressure.goals.value.length>=2);
const injured=UI.evidenceModel('injured');
assert(injured.health.value.condition<60);assert(injured.health.value.fatigue>=80);assert(injured.health.value.injuries.length>=1);
const authority=UI.evidenceModel('authority');
assert(authority.authority.value.rankTier>=2);assert(authority.authority.value.scopes.length>=2);
const unavailable=UI.evidenceModel('unavailable');
for(const key of ['goals','inventory','authority','guidance'])assert(unavailable.unavailable.includes(key));
assert(UI.markup(unavailable).includes('Unavailable'));

global.ProtagonistProfile={derive(){return {protagonistId:'PROTAGONIST-X',birthIdentity:{fullName:'Runtime Hero'},personality:{traits:{resolve:70,empathy:60,caution:50,ambition:40}}};}};
global.ProtagonistNeeds={snapshot(){return {pressureMilli:{hunger:10000,fatigue:20000,safety:5000,social:15000}};}};
global.ProtagonistGoals={snapshot(){return {records:[{id:'GOAL-X',topic:'Runtime goal',status:'active',priority:77}]};}};
global.ProtagonistInventory={snapshot(){return {records:[{itemId:'ITEM-BREAD',quantity:2}]};}};
global.ProtagonistHealth={decisionContext(){return {conditionMilli:90000,fatigueMilli:25000,injuries:[]};}};
global.ProtagonistAuthority={decisionContext(){return {currentRole:{label:'Resident',rankTier:0,scopes:['self']}};}};
global.ProtagonistGuidance={snapshot(){return {records:[{status:'active',principle:'Runtime advice',priority:60,stance:'neutral'}]};}};
const runtime=UI.runtimeModel({seed:'SEED-A',when:'1201-09-30 15:00:00'});
assert.equal(runtime.unavailable.length,0);assert.equal(runtime.identity.value.name,'Runtime Hero');assert.equal(runtime.readOnly,true);
assert(UI.markup(runtime).includes('Runtime goal'));

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['requestAnimationFrame','setInterval(','Math.random','Date.now','innerWidth','innerHeight','devicePixelRatio'])assert(!source.includes(forbidden),'forbidden per-frame/device authority reference: '+forbidden);
for(const forbidden of ['applyDelta(','ActionExecutor.','RoutePlanner.','setPosition(','teleport('])assert(!source.includes(forbidden),'readout must not mutate/execute: '+forbidden);
assert(source.includes('providerPayloadRendered:false'));assert(source.includes('authoritativeVsAdvisoryLabeled:true'));

const repoRoot=path.resolve(__dirname,'../..'),index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8'),advisor=fs.readFileSync(path.join(repoRoot,'scripts/ui/advisor-conversation-ui.js'),'utf8'),css=fs.readFileSync(path.join(repoRoot,'styles/main.css'),'utf8');
const statusScript='scripts/ui/protagonist-status-ui.js?v=protagonist-status-ui-v1',chatScript='scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1';
assert(index.includes(statusScript));assert(index.indexOf(statusScript)<index.indexOf(chatScript),'status readout must load before Advisor panel');
assert(advisor.includes('ProtagonistStatusUI?.markup'),'Advisor panel must host status readout');
assert(css.includes('WP-S009-010 — Protagonist status readout'));

const snap=UI.snapshot();assert.equal(snap.authority.directWorldMutation,false);assert.equal(snap.authority.directExecution,false);assert.equal(snap.authority.wholeWorldScan,false);
console.log(JSON.stringify({wp:'WP-S009-010',classification:'MIXED',functionalPass:true,eventDriven:true,readOnly:true,authoritativeAdvisoryLabels:true,evidenceModes:UI.EVIDENCE_MODES,healthy:true,pressure:true,injured:true,authority:true,unavailable:true,directWorldMutation:false,directExecution:false,wholeWorldScan:false,perFrameRender:false},null,2));