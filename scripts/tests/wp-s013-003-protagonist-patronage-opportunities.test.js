'use strict';
const assert=require('assert'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const C=v=>v==null||typeof v!=='object'?v:Array.isArray(v)?v.map(C):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]));
function H(v){let h=2166136261>>>0;for(const ch of String(v??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
const stores=new Map(),fresh=s=>({schema:'CampaignStateDelta',seed:s,sequence:0,entries:{}}),ensure=s=>(stores.has(s)||stores.set(s,fresh(s)),stores.get(s));
global.WorldState={
 structuralRef(s,k,p,keyName,initial){return{id:'STR|'+String(k).toUpperCase()+'|'+H([s,k,p,keyName].join('|')),kind:k,key:{initial:C(initial||{})}}},
 resolve(s,ref){const st=ensure(s),e=st.entries[ref.id];return{current:e?C(e.current):{},delta:e?C(e):null}},
 applyDelta(s,ref,changes,reason){const st=ensure(s),old=st.entries[ref.id]||{revision:0,current:{}};st.sequence++;const entry={revision:old.revision+1,sequence:st.sequence,reason,current:{...C(old.current),...C(changes)}};st.entries[ref.id]=entry;return{ok:true,reason:'ok',entry:C(entry)}},
 serializeState(s){return C(ensure(s))},
 restoreSerializedState({seed},state){stores.set(seed,C(state));return{ok:true}}
};
global.ProtagonistProfile={derive(s,k='protagonist'){return{protagonistId:'PROTAGONIST-'+H(s+'|'+k+'|identity-v1')}}};
const roster=[
 {id:'r-farmer',displayName:'Farmer',profession:'farmer',workFunction:'farm',workplaceId:'farm-1',workplaceLabel:'Farm'},
 {id:'r-smith',displayName:'Smith',profession:'smith',workFunction:'craft',workplaceId:'forge-1',workplaceLabel:'Forge'},
 {id:'r-tavern',displayName:'Innkeeper',profession:'tavern-keeper',workFunction:'lodging',workplaceId:'inn-1',workplaceLabel:'Inn'},
 {id:'r-shop',displayName:'Shopkeeper',profession:'shopkeeper',workFunction:'market',workplaceId:'shop-1',workplaceLabel:'Shop'},
 {id:'r-wood',displayName:'Woodcutter',profession:'woodcutter',workFunction:'outdoor-work',workplaceId:'wood-1',workplaceLabel:'Woodlot'},
 {id:'r-guard',displayName:'Guard',profession:'guard',workFunction:'civic',workplaceId:'guard-1',workplaceLabel:'Watch House'}
];
let currentRoster=[...roster];
global.DailyActivity={build(){return currentRoster}};
const recognition={
 'r-farmer':{metBefore:true,familiarity:'familiar'},
 'r-smith':{metBefore:true,familiarity:'known'},
 'r-tavern':{metBefore:true,familiarity:'known'},
 'r-shop':{metBefore:true,familiarity:'known'},
 'r-wood':{metBefore:false,familiarity:'stranger'},
 'r-guard':{metBefore:true,familiarity:'known'}
};
global.CharacterMemory={recognition(_s,id){return C(recognition[id]||{metBefore:false,familiarity:'stranger'})}};
const social={
 'r-farmer':{trust:.25,respect:.3,suspicion:.2},
 'r-smith':{trust:.82,respect:.8,suspicion:.12},
 'r-tavern':{trust:.76,respect:.72,suspicion:.2},
 'r-shop':{trust:.79,respect:.74,suspicion:.18},
 'r-wood':{trust:.9,respect:.9,suspicion:.05},
 'r-guard':{trust:.9,respect:.88,suspicion:.08}
};
global.SocialState={dialogueContext(_s,id){return{source:'persistent-social-ledger',values:C(social[id]||{})}}};
let authoritySnapshot={exists:true,currentRole:{roleId:'local-resident',rankTier:0,scopes:['self']}};
global.ProtagonistAuthority={snapshot(){return C(authoritySnapshot)}};
global.ProtagonistEmployment={current(){return{ok:true,status:'none',contract:null,readOnly:true}}};

const modulePath=path.resolve(__dirname,'../world/protagonist-patronage-opportunities.js');
let Patronage=require(modulePath);global.ProtagonistPatronageOpportunities=Patronage;
const seed='WP-S013-003-A',other='WP-S013-003-B',when='1201-05-01 09:00:00';
const first=Patronage.list(seed,when,{limit:12});
assert(first.length>0&&first.length<=9);
for(const intent of Patronage.INTENTS)assert(first.some(x=>x.intent===intent),'missing '+intent);
assert(first.every(x=>x.sourceNpcRef?.id&&x.locationRef?.id&&x.opensAt&&x.expiresAt&&x.prerequisites?.satisfied));
assert(first.every(x=>x.rankGuaranteed===false&&x.appointmentGuaranteed===false&&x.skillGrant===false&&x.wealthGrant===false&&x.authorityGrant===false));
assert.deepStrictEqual(Patronage.list(seed,when,{limit:12}),first,'same seed/state/time must replay identically');
assert.notDeepStrictEqual(Patronage.list(other,when,{limit:12}).map(x=>x.opportunityId),first.map(x=>x.opportunityId),'alternate seed should change stable opportunity IDs');

const low=Patronage.inspectCandidate(seed,when,'r-farmer','mentorship-training');
assert.equal(low.ok,true);assert.equal(low.reason,'blocked');assert(low.opportunity.prerequisites.blockers.includes('trust-below-threshold'));
const invalidRole=Patronage.inspectCandidate(seed,when,'r-smith','advancement-sponsorship');
assert.equal(invalidRole.reason,'blocked');assert(invalidRole.opportunity.prerequisites.blockers.includes('qualified-source-role-required'));
const unknown=Patronage.inspectCandidate(seed,when,'r-wood','mentorship-training');
assert.equal(unknown.reason,'blocked');assert(unknown.opportunity.prerequisites.blockers.includes('known-resident-required'));
assert(!first.some(x=>x.sourceNpcRef.id==='r-farmer'||x.sourceNpcRef.id==='r-wood'));

const guard=first.find(x=>x.sourceNpcRef.id==='r-guard'&&x.intent==='advancement-sponsorship');
assert(guard,'qualified known guard should expose grounded advancement sponsorship');
const beforeAuthority=JSON.stringify(global.ProtagonistAuthority.snapshot());
const forged=Patronage.evaluate(seed,guard.opportunityId,'accepted',{authority:'ui',protagonistOwned:true,decisionId:'D-FORGED',fantasyTimestamp:when});
assert.equal(forged.ok,false);assert.equal(forged.reason,'protagonist-decision-authority-required');
const accepted=Patronage.evaluate(seed,guard.opportunityId,'accepted',{authority:'protagonist',protagonistOwned:true,decisionId:'D-ACCEPT',fantasyTimestamp:when});
assert.equal(accepted.ok,true);assert.equal(accepted.decisionRecord.status,'accepted-awaiting-simulation');
assert.equal(accepted.interactionProposal.proposalOnly,true);assert.equal(accepted.interactionProposal.targetId,'r-guard');
assert.equal(accepted.interactionProposal.requiresTerminalSimulation,true);assert.equal(accepted.interactionProposal.directActionExecution,false);
assert.equal(JSON.stringify(global.ProtagonistAuthority.snapshot()),beforeAuthority,'opportunity acceptance must not mutate rank/authority');
const dup=Patronage.evaluate(seed,guard.opportunityId,'accepted',{authority:'protagonist',protagonistOwned:true,decisionId:'D-ACCEPT',fantasyTimestamp:when});
assert.equal(dup.ok,true);assert.equal(dup.duplicate,true);
const conflict=Patronage.evaluate(seed,guard.opportunityId,'rejected',{authority:'protagonist',protagonistOwned:true,decisionId:'D-ACCEPT',fantasyTimestamp:when});
assert.equal(conflict.ok,false);assert.equal(conflict.reason,'duplicate-decision-conflict');

const mentor=first.find(x=>x.intent==='mentorship-training'&&x.opportunityId!==guard.opportunityId);
const rejected=Patronage.evaluate(seed,mentor.opportunityId,'rejected',{authority:'protagonist',protagonistOwned:true,decisionId:'D-REJECT',fantasyTimestamp:when});
assert.equal(rejected.ok,true);assert.equal(rejected.interactionProposal,null);
const service=first.find(x=>x.intent==='service-sponsorship');
const deferred=Patronage.evaluate(seed,service.opportunityId,'deferred',{authority:'protagonist',protagonistOwned:true,decisionId:'D-DEFER',fantasyTimestamp:when});
assert.equal(deferred.ok,true);assert.equal(deferred.interactionProposal,null);

const stale=Patronage.evaluate(seed,guard.opportunityId,'accepted',{authority:'protagonist',protagonistOwned:true,decisionId:'D-STALE',fantasyTimestamp:'1201-05-20 09:00:00'});
assert.equal(stale.ok,false);assert.equal(stale.reason,'opportunity-unavailable-or-stale');

const sourceOpp=Patronage.list(seed,when,{limit:12}).find(x=>x.sourceNpcRef.id==='r-shop');
currentRoster=currentRoster.filter(x=>x.id!=='r-shop');
const vanished=Patronage.evaluate(seed,sourceOpp.opportunityId,'accepted',{authority:'protagonist',protagonistOwned:true,decisionId:'D-VANISH',fantasyTimestamp:when});
assert.equal(vanished.ok,false);assert.equal(vanished.reason,'opportunity-unavailable-or-stale');
currentRoster=[...roster];

const saved=C(WorldState.serializeState(seed)),pre=Patronage.snapshot(seed),preDecisions=Patronage.decisions(seed,{limit:12});
stores.set(seed,fresh(seed));delete require.cache[require.resolve(modulePath)];Patronage=require(modulePath);global.ProtagonistPatronageOpportunities=Patronage;
assert.equal(Patronage.snapshot(seed).decisionCount,0);
WorldState.restoreSerializedState({seed},saved);
assert.deepStrictEqual(Patronage.snapshot(seed),pre);
assert.deepStrictEqual(Patronage.decisions(seed,{limit:12}),preDecisions);

const snap=Patronage.snapshot(seed);
assert.equal(snap.bounded,true);assert.equal(snap.fullWorldScan,false);assert.equal(snap.fullSettlementScan,false);assert.equal(snap.wholeHistoryScan,false);assert.equal(snap.perFrameGeneration,false);
assert.equal(snap.directRankMutation,false);assert.equal(snap.directSkillMutation,false);assert.equal(snap.directWealthMutation,false);assert.equal(snap.directAuthorityMutation,false);assert.equal(snap.directRelationshipMutation,false);
assert(snap.decisionCount<=48&&snap.serializedBytes<=49152);
assert.equal(Patronage.list(seed,when,{limit:999}).length<=9,true);
currentRoster=[...roster,...Array.from({length:30},(_,i)=>({id:'extra-'+i,displayName:'Extra '+i,profession:'guard',workFunction:'civic',workplaceId:'extra-work-'+i,workplaceLabel:'Extra'}))];
assert(Patronage.list(seed,when,{limit:999}).length<=9,'candidate/result bounds must hold');
const proof={
 version:Patronage.VERSION,intents:[...Patronage.INTENTS],opportunityCount:first.length,decisionCount:snap.decisionCount,
 knownQualified:true,lowTrustBlocked:true,invalidRoleBlocked:true,unknownBlocked:true,stableReplay:true,alternateSeedDifferent:true,
 expiryFailClosed:true,sourceInvalidFailClosed:true,protagonistOwnedEvaluation:true,simulationProposalOnly:true,
 duplicateIdempotent:true,conflictFailClosed:true,saveReload:true,bounded:true,fullWorldScan:false,wholeHistoryScan:false,perFrameGeneration:false,
 rankMutation:false,skillMutation:false,wealthMutation:false,authorityMutation:false,relationshipMutation:false
};
console.log('WP-S013-003 patronage opportunity evidence PASS');
console.log(JSON.stringify(proof,null,2));
