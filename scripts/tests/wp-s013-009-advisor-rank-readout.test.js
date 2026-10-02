'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
let mutations=0,reads={authority:0,status:0,patronage:0,service:0,oath:0,catalog:0,eligibility:0,appointmentHistory:0,patronageHistory:0,serviceHistory:0};
const failMutation=name=>()=>{mutations++;throw new Error('readout must not call '+name)};
global.ProtagonistAuthority={snapshot(){reads.authority++;return{exists:true,currentRole:{roleId:'village-steward',title:'Village Steward',rankTier:2,rankLabel:'Entrusted local office',scopes:['self','settlement:administration','settlement:records']}}},transition:failMutation('authority.transition')};
global.ProtagonistStatusObligations={decisionContext(){reads.status++;return{ok:true,role:{roleId:'village-steward',title:'Village Steward',rankTier:2,scopes:['self','settlement:administration']},obligations:[{id:'OBL-1',label:'Attend administration',state:'standing',sourceRef:{kind:'authority-scope'}}],readOnly:true}},checkPrivilege:failMutation('status.checkPrivilege')};
global.ProtagonistPatronageOpportunities={list(){reads.patronage++;return[{opportunityId:'PAT-1',intent:'advancement-sponsorship',sourceNpcRef:{id:'R-GUARD'},locationRef:{id:'WATCH'},state:'available'}]},decisions(){reads.patronageHistory++;return[{id:'PDEC-1',decision:'deferred',intent:'mentorship-training'}]},evaluate:failMutation('patronage.evaluate')};
global.ProtagonistServiceContracts={dutyContext(){reads.service++;return{available:true,reason:'active-service',contractId:'SVC-1',roleType:'squire',patronRef:{id:'R-GUARD'},duties:[{label:'Attend patron'}]}},results(){reads.serviceHistory++;return[{id:'SRES-1',state:'completed',roleType:'squire'}]},activate:failMutation('service.activate'),recordResult:failMutation('service.recordResult'),end:failMutation('service.end')};
global.ProtagonistOathAllegiance={currentContext(){reads.oath++;return{available:true,reason:'active-oaths',oaths:[{id:'OATH-1',state:'active',institutionRef:{id:'COUNCIL'}}]}},create:failMutation('oath.create'),end:failMutation('oath.end')};
global.ProtagonistAppointmentResolution={catalog(){reads.catalog++;return[{targetRoleId:'guild-member',title:'Guild Member'}]},eligibility(){reads.eligibility++;return{status:'ineligible',eligible:false,reason:'blocked',blockers:['paid-work-evidence-required'],unknowns:[],readOnly:true}},list(){reads.appointmentHistory++;return[{id:'APP-1',status:'appointed',targetRoleId:'guild-member'}]},appointment:failMutation('appointment.appointment')};
global.ActionExecutor={execute:failMutation('ActionExecutor.execute')};global.ProtagonistCommandEvaluator={evaluate:failMutation('ProtagonistCommandEvaluator.evaluate')};

const modulePath=path.resolve(__dirname,'../ui/advisor-rank-readout-ui.js');delete require.cache[require.resolve(modulePath)];
const UI=require(modulePath);
assert.equal(UI.VERSION,'advisor-rank-readout-v1');assert.deepStrictEqual(UI.EVIDENCE_MODES,['ordinary','authority','blocked','unavailable']);
const model=UI.runtimeModel({seed:'SEED-RANK',when:'1201-10-01 09:30:00'});
assert.equal(model.role.label,'Village Steward');assert.equal(model.role.rankTier,2);assert(model.role.scopes.includes('settlement:administration'));
assert.equal(model.eligibility.targetLabel,'Guild Member');assert.equal(model.eligibility.status,'ineligible');assert(model.eligibility.blockers.includes('paid-work-evidence-required'));
assert.equal(model.opportunities.length,1);assert(model.obligations.some(x=>x.source==='ProtagonistServiceContracts'));assert(model.obligations.some(x=>x.source==='ProtagonistOathAllegiance'));
assert(model.outcomes.some(x=>x.kind==='appointment'));assert(model.outcomes.some(x=>x.kind==='patronage'));assert.equal(mutations,0);
assert(reads.authority<=1&&reads.status<=1&&reads.patronage<=1&&reads.service<=1&&reads.oath<=1&&reads.catalog<=1&&reads.eligibility<=1);
const html=UI.markup(model);for(const phrase of ['RANK · PATRONAGE · ADVANCEMENT','LEGITIMATE STATUS','Advancement','Grounded opportunities','Duties · service · oath','Recent outcomes','PRESENTATION ONLY'])assert(html.includes(phrase),phrase);
for(const mode of UI.EVIDENCE_MODES){const m=UI.evidenceModel(mode),markup=UI.markup(m);assert.equal(m.readOnly,true);assert.equal(m.eventDriven,true);assert(markup.includes('Read-only'))}
assert.equal(UI.evidenceModel('ordinary').role.rankTier,0);assert.equal(UI.evidenceModel('authority').role.rankTier,2);assert(UI.evidenceModel('authority').obligations.some(x=>x.source==='ProtagonistServiceContracts'));assert(UI.evidenceModel('authority').obligations.some(x=>x.source==='ProtagonistOathAllegiance'));
assert(UI.evidenceModel('blocked').eligibility.blockers.length>=2);assert.equal(UI.evidenceModel('unavailable').eligibility.status,'unknown');assert(UI.evidenceModel('unavailable').sources.some(x=>!x.available));
const proof=UI.proof();assert.equal(proof.pass,true);
const snap=UI.snapshot();assert.equal(snap.authority.eventDriven,true);assert.equal(snap.authority.boundedReads,true);for(const key of ['perFrameRead','fullWorldScan','wholeHistoryScan','directWorldMutation','directActionExecution','rankMutation','relationshipMutation','economyMutation','appointmentExecution','serviceAcceptance','oathCreation','patronageDecision','progressionMutation','protagonistDecisionBypass','simulationValidationBypass'])assert.equal(snap.authority[key],false,key);
assert(snap.sourceReadTotal<=UI.MAX_SOURCE_READS,'bounded source read budget');

// Missing authoritative sources remain unknown; presentation never synthesizes an ordinary role.
global.ProtagonistAuthority={snapshot(){return{exists:false,reason:'empty'}}};
global.ProtagonistStatusObligations={decisionContext(){return{ok:false,reason:'protagonist-authority-unavailable'}}};
global.ProtagonistPatronageOpportunities={list(){return null},decisions(){return null}};
global.ProtagonistServiceContracts={dutyContext(){return null},results(){return null}};
global.ProtagonistOathAllegiance={currentContext(){return null}};
global.ProtagonistAppointmentResolution={catalog(){return null},list(){return null}};
const missing=UI.runtimeModel({seed:'SEED-RANK',when:'1201-10-01 10:00:00'});
assert.equal(missing.role,null);
assert.equal(missing.eligibility.status,'unknown');
assert(missing.eligibility.unknowns.includes('appointment-catalog-unavailable'));
assert(missing.sources.some(x=>x.name==='ProtagonistAuthority'&&x.available===false));
assert(missing.sources.some(x=>x.name==='Status obligations'&&x.available===false));
const missingHtml=UI.markup(missing);
assert(missingHtml.includes('Status unavailable'));
assert(missingHtml.includes('Unknown role'));
assert(!missingHtml.includes('Local Resident'));
const missingSnap=UI.snapshot();
assert(missingSnap.sourceReadTotal<=UI.MAX_SOURCE_READS,'bounded source read budget after refresh');

const source=fs.readFileSync(modulePath,'utf8');
for(const forbidden of ['requestAnimationFrame','setInterval(','Math.random','Date.now','innerWidth','innerHeight','devicePixelRatio'])assert(!source.includes(forbidden),'forbidden frame/device authority: '+forbidden);
for(const forbidden of ['ProtagonistAppointmentResolution?.appointment','ProtagonistPatronageOpportunities?.evaluate','ProtagonistServiceContracts?.activate','ProtagonistOathAllegiance?.create','ProtagonistAdvancementGoal?.schedule','ActionExecutor.execute','ProtagonistCommandEvaluator.evaluate'])assert(!source.includes(forbidden),'mutation/action path present: '+forbidden);
const root=path.resolve(__dirname,'../..'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),advisor=fs.readFileSync(path.join(root,'scripts/ui/advisor-conversation-ui.js'),'utf8'),css=fs.readFileSync(path.join(root,'styles/main.css'),'utf8');
const tag='scripts/ui/advisor-rank-readout-ui.js?v=advisor-rank-readout-v1';assert(index.includes(tag));assert(index.indexOf(tag)<index.indexOf('scripts/ui/advisor-conversation-ui.js?v=advisor-chat-v1'));assert(advisor.includes('AdvisorRankReadoutUI?.markup'));assert(advisor.includes('advisor-readout-stack'));assert(css.includes('WP-S013-009 — Advisor rank, patronage + advancement readout'));
console.log(JSON.stringify({wp:'WP-S013-009',classification:'MIXED',functionalPass:true,readOnly:true,eventDriven:true,bounded:true,sourceReadTotal:snap.sourceReadTotal,ordinaryRole:UI.evidenceModel('ordinary').role.label,authorityRole:UI.evidenceModel('authority').role.label,blockedPrerequisites:UI.evidenceModel('blocked').eligibility.blockers.length,unknownExplicit:true,mutations},null,2));
