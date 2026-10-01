const assert=require('assert');
const path=require('path');
global.window=global;
global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const UI=require(path.resolve(__dirname,'../ui/protagonist-status-ui.js'));

global.ProtagonistProfile={derive(){return {protagonistId:'PROTAGONIST-RANK',birthIdentity:{fullName:'Mira Vale'},personality:{traits:{resolve:80,curiosity:75,caution:45,ambition:90}}};}};
global.ProtagonistNeeds={snapshot(){return {pressureMilli:{hunger:14000,fatigue:6000,safety:9000,social:18000}};}};
global.ProtagonistGoals={snapshot(){return {records:[{id:'G-READOUT',topic:'Earn legitimate guild recognition',status:'active',priority:82}]};}};
global.ProtagonistInventory={snapshot(){return {records:[{itemId:'ITEM-ROPE',quantity:1,label:'Rope coil'}]};}};
global.ProtagonistHealth={decisionContext(){return {conditionMilli:92000,fatigueMilli:22000,injuries:[]};}};
global.ProtagonistAuthority={decisionContext(){return {currentRole:{label:'Village steward',roleId:'village-steward',rankTier:2,scopes:['self','settlement:administration','settlement:request-assistance']},scopes:['self','settlement:administration','settlement:request-assistance'],rankTier:2};}};
global.ProtagonistStatusObligations={decisionContext(){return {role:{label:'Village steward',roleId:'village-steward',rankTier:2,scopes:['self','settlement:administration','settlement:request-assistance']},duties:[{label:'Attend village administration',detail:'settlement:administration',state:'standing'},{label:'Honor guild commitments',detail:'guild:participate',state:'standing'}],obligations:[{id:'OBL-RENTER',kind:'housing-obligation',label:'Meet housing obligation',state:'due',priority:'normal'}],readOnly:true};}};
global.ProtagonistPatronageOpportunities={list(){return [{label:'Guildmaster sponsorship',detail:'guildmaster · grounded',state:'available',sourceNpcRef:{id:'N-GUILDMASTER'}},{label:'Watch-house service sponsorship',detail:'guard captain · grounded',state:'available',sourceNpcRef:{id:'N-GUARD'}}];}};
global.ProtagonistAdvancementGoal={evaluate(){return {ok:true,status:'pursue',selectedOpportunityId:'ADV-GUILD',reason:'Aligned with stewardship and patronage interest',selectedOpportunity:{hardBlockers:[],softBlockers:[]},selectedProposal:{commandId:'advisor.propose_interaction'}};}};
global.ProtagonistGuidance={snapshot(){return {records:[{status:'active',principle:'Use office authority only for duties that require it.',priority:90,stance:'caution'}]};}};

const runtime=UI.runtimeModel({seed:'SEED-RANK',when:'1201-10-01 09:00:00'});
assert.equal(runtime.authority.value.role,'Village steward');
assert.equal(runtime.status.value.role,'Village steward');
assert(runtime.status.value.duties.some(item=>item.label.includes('village administration')));
assert(runtime.opportunities.value.some(item=>item.label.includes('Guildmaster')));
assert.equal(runtime.advancement.value.status,'pursue');
assert.equal(runtime.readOnly,true);
assert.equal(runtime.eventDriven,true);
const html=UI.markup(runtime);
assert(html.includes('Status duties'));
assert(html.includes('Advancement'));
assert(html.includes('Local opportunities'));
assert(html.includes('Read-only · event-driven'));

const evidence=UI.evidenceModel('authority');
assert.equal(evidence.status.value.role,'Village steward');
assert(evidence.opportunities.value.some(item=>item.label.includes('guildmaster')));
assert.equal(evidence.advancement.value.status,'pursue');

console.log(JSON.stringify({wp:'WP-S013-009',classification:'MIXED',visual:'N/A — status readout is read-only prose and layout evidence only',pass:true,role:runtime.status.value.role,opportunityCount:runtime.opportunities.value.length,advancementStatus:runtime.advancement.value.status,readOnly:true,eventDriven:true},null,2));
