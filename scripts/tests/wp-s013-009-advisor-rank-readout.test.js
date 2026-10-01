const assert=require('assert');
const path=require('path');
global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const UI=require(path.resolve(__dirname,'../ui/protagonist-status-ui.js'));

function baseAuthorities(role){
  global.ProtagonistProfile={derive(){return {protagonistId:'PROTAGONIST-RANK',birthIdentity:{fullName:'Mira Vale'},personality:{traits:{resolve:80,curiosity:75,caution:45,ambition:90}}};}};
  global.ProtagonistNeeds={snapshot(){return {pressureMilli:{hunger:14000,fatigue:6000,safety:9000,social:18000}};}};
  global.ProtagonistGoals={snapshot(){return {records:[{id:'G-READOUT',topic:'Earn legitimate recognition',status:'active',priority:82}]};}};
  global.ProtagonistInventory={snapshot(){return {records:[{itemId:'ITEM-ROPE',quantity:1,label:'Rope coil'}]};}};
  global.ProtagonistHealth={decisionContext(){return {conditionMilli:92000,fatigueMilli:22000,injuries:[]};}};
  global.ProtagonistAuthority={snapshot(){return {exists:true,currentRole:role,history:[],bounded:true,fullWorldScan:false,perFrameScan:false};}};
  global.ProtagonistGuidance={snapshot(){return {records:[{status:'active',principle:'Use authority only for duties that require it.',priority:90,stance:'caution'}]};}};
}
function clearStage13(){
  for(const k of ['ProtagonistStatusObligations','ProtagonistPatronageOpportunities','ProtagonistAppointmentResolution','ProtagonistAdvancementGoal','ProtagonistServiceContracts','ProtagonistOathAllegiance'])delete global[k];
}

clearStage13();
baseAuthorities({label:'Village resident',roleId:'local-resident',rankTier:0,scopes:['self']});
const ordinary=UI.runtimeModel({seed:'SEED-RANK',when:'1201-10-01 09:00:00'});
assert.equal(ordinary.authority.value.role,'Village resident');
assert.equal(ordinary.status.value.role,'Village resident');
assert.equal(ordinary.status.value.duties.length,0);
assert.equal(ordinary.status.value.commitments.length,0);
assert.equal(ordinary.status.value.opportunities.length,0);
assert.equal(ordinary.status.value.advancement,null);
assert.equal(ordinary.status.value.eligibility,null);
assert.equal(ordinary.status.value.availability.duties,false);
assert.equal(ordinary.status.value.availability.commitments,false);
assert.equal(ordinary.status.value.availability.opportunities,false);
assert.equal(ordinary.status.value.availability.eligibility,false);
assert.equal(ordinary.advancement.available,false);
assert.equal(ordinary.opportunities.available,false);
const ordinaryHtml=UI.markup(ordinary);
assert(ordinaryHtml.includes('Duties / commitments'));
assert(ordinaryHtml.includes('Commitment sources unavailable.'));
assert(ordinaryHtml.includes('Advancement / patronage'));
assert(ordinaryHtml.includes('Advancement sources unavailable; no eligibility is inferred.'));
assert(!ordinaryHtml.includes('Continue active personal obligations'));
assert(!ordinaryHtml.includes('Current goals and authority context are available.'));

const calls={};
function hit(k){calls[k]=(calls[k]||0)+1}
let mutationCalls=0;
baseAuthorities({label:'Village steward',roleId:'village-steward',rankTier:2,scopes:['self','settlement:administration','settlement:request-assistance']});
global.ProtagonistStatusObligations={decisionContext(){hit('status');return {ok:true,role:{label:'Village steward',roleId:'village-steward',rankTier:2,scopes:['self','settlement:administration']},duties:[{label:'Attend village administration',requiredScope:'settlement:administration',state:'standing'}],obligations:[{id:'OBL-RENTER',kind:'housing-obligation',label:'Meet housing obligation',state:'due'}],readOnly:true};}};
global.ProtagonistPatronageOpportunities={
  list(){hit('opportunities');return [{opportunityId:'PAT-GUILD',label:'Guildmaster sponsorship',intent:'advancement-sponsorship',state:'available',sourceNpcRef:{id:'N-GUILDMASTER'}}];},
  decisions(){hit('patronageDecisions');return [{id:'PDEC-1',opportunityId:'PAT-OLD',intent:'mentorship-training',decision:'deferred',status:'deferred'}];},
  evaluate(){mutationCalls++;throw new Error('presentation must not evaluate patronage decisions');}
};
global.ProtagonistAppointmentResolution={
  catalog(){hit('catalog');return [{targetRoleId:'guild-member',label:'Guild member'}];},
  eligibility(){hit('eligibility');return {status:'eligible',eligible:true,targetRoleId:'guild-member',targetRoleLabel:'Guild member',reason:'requirements-satisfied',blockers:[],readOnly:true,bounded:true};},
  list(){hit('appointments');return [{id:'APP-1',targetRoleId:'guild-member',status:'appointed'}];},
  appointment(){mutationCalls++;throw new Error('presentation must not appoint');}
};
global.ProtagonistAdvancementGoal={
  snapshot(){hit('advancement');return {ok:true,status:'pursue',selectedOpportunityId:'PAT-GUILD',reason:'Grounded advancement opportunity selected',selectedOpportunity:{hardBlockers:[]},available:true};},
  schedule(){mutationCalls++;throw new Error('presentation must not schedule advancement');}
};
global.ProtagonistServiceContracts={
  current(){hit('service');return {id:'SVC-1',roleType:'squire',patronRef:{id:'N-GUARD'},state:'active',effectiveState:'active'};},
  results(){hit('serviceResults');return [{id:'SVR-1',dutyId:'attend-patron',resultState:'completed'}];},
  activate(){mutationCalls++;throw new Error('presentation must not activate service');}
};
global.ProtagonistOathAllegiance={
  currentContext(){hit('oaths');return {available:true,oaths:[{id:'OATH-1',state:'active',institutionRef:{id:'WORK-GUILD'},authorityStillBacked:true}],readOnly:true,bounded:true};},
  create(){mutationCalls++;throw new Error('presentation must not create oath');}
};

const rich=UI.runtimeModel({seed:'SEED-RANK',when:'1201-10-01 09:00:00'});
assert.equal(rich.authority.value.role,'Village steward');
assert.equal(rich.status.value.role,'Village steward');
assert(rich.status.value.duties.some(x=>x.label.includes('village administration')));
assert(rich.status.value.commitments.some(x=>x.source==='Service contract'));
assert(rich.status.value.commitments.some(x=>x.source==='Oath ledger'));
assert(rich.status.value.commitments.some(x=>x.source==='Status obligations'));
assert(rich.status.value.opportunities.some(x=>x.label.includes('Guildmaster')));
assert.equal(rich.status.value.eligibility.status,'eligible');
assert.equal(rich.status.value.advancement.status,'pursue');
assert(rich.status.value.outcomes.some(x=>x.source==='Appointment resolution'));
assert(rich.status.value.outcomes.some(x=>x.source==='Patronage decision'));
assert(rich.status.value.outcomes.some(x=>x.source==='Service contract'));
assert.equal(rich.readOnly,true);
assert.equal(rich.eventDriven,true);
assert.equal(mutationCalls,0);
for(const key of ['status','opportunities','catalog','eligibility','advancement','service','oaths','appointments','patronageDecisions','serviceResults'])assert.equal(calls[key],1,key+' read count');
const snap=UI.snapshot();
assert(snap.readTelemetry.readCount<=snap.readTelemetry.maxReadCount);
assert.equal(snap.readTelemetry.fullWorldScan,false);
assert.equal(snap.readTelemetry.wholeHistoryScan,false);
assert.equal(snap.readTelemetry.perFrameScan,false);
const richHtml=UI.markup(rich);
assert(richHtml.includes('Duties / commitments'));
assert(richHtml.includes('Squire'));
assert(richHtml.includes('Advancement / patronage'));
assert(richHtml.includes('Guild member'));
assert(richHtml.includes('PAT-GUILD'));
assert(richHtml.includes('Read-only · event-driven · bounded'));

const evidenceOrdinary=UI.evidenceModel('healthy');
assert.equal(evidenceOrdinary.authority.value.role,'Village resident');
assert.equal(evidenceOrdinary.status.value.role,'Village resident');
assert.equal(evidenceOrdinary.status.value.eligibility.status,'ineligible');
assert(evidenceOrdinary.status.value.eligibility.blockers.includes('authoritative-employment-required'));
const evidenceRich=UI.evidenceModel('authority');
assert.equal(evidenceRich.authority.value.role,'Village steward');
assert(evidenceRich.status.value.commitments.some(x=>x.source==='Service contract'));
assert(evidenceRich.status.value.outcomes.some(x=>x.source==='Appointment resolution'));

console.log(JSON.stringify({
  wp:'WP-S013-009',
  classification:'MIXED',
  pass:true,
  ordinaryRole:ordinary.status.value.role,
  richRole:rich.status.value.role,
  richCommitments:rich.status.value.commitments.length,
  richOutcomes:rich.status.value.outcomes.length,
  boundedReadCount:snap.readTelemetry.readCount,
  maxReadCount:snap.readTelemetry.maxReadCount,
  mutationCalls
},null,2));
