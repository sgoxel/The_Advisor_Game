const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
const clone=v=>v==null||typeof v!=='object'?v:JSON.parse(JSON.stringify(v));
function merge(a,b){const o=clone(a||{});for(const[k,v]of Object.entries(b||{}))o[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(o[k]||{},v):clone(v);return o}
function hash(s){let h=2166136261>>>0;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,'0')}
const stores=new Map(),ensure=s=>{if(!stores.has(s))stores.set(s,{schema:'CampaignStateDelta',seed:s,sequence:0,entries:{}});return stores.get(s)};
global.WorldState={
 structuralRef(seed,kind,parent,key,initial){return{id:'STR|'+kind.toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}}},
 resolve(seed,ref){const s=ensure(seed),e=s.entries[ref.id];return{current:merge(ref.key.initial,e?.changes||{}),delta:e?clone(e):null}},
 applyDelta(seed,ref,changes,reason){const s=ensure(seed),p=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(p?.revision||0)+1,sequence:s.sequence,reason,changes:merge(p?.changes||{},changes)};return{ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)}},
 serializeState:seed=>clone(ensure(seed)),restoreSerializedState:(campaign,value)=>(stores.set(String(campaign.seed),clone(value)),{ok:true})
};
let diplomacyLevel=1;
global.AdvisorProgression={getSkill(seed,skill){assert.equal(skill,'diplomacy');return{level:diplomacyLevel,totalXp:(diplomacyLevel-1)*100}}};
global.CommandSetInterface={validateProposal(snapshot,p){if(p.commandId==='advisor.impossible')return Object.freeze({ok:false,status:'rejected',reason:'unsupported-command',commandId:p.commandId,details:null});return Object.freeze({ok:true,status:'validated',reason:'proposal-valid',commandId:p.commandId,snapshotId:snapshot.snapshotId,proposalId:p.proposalId||null,source:p.source||'direct',validatedParameters:Object.freeze({...p.parameters}),worldMutation:false,executionAttempted:false})}};
const ep=path.resolve(__dirname,'../world/protagonist-command-evaluator.js');delete require.cache[ep];const Eval=require(ep);
const mp=path.resolve(__dirname,'../world/advisor-diplomacy.js');delete require.cache[mp];const D=require(mp);assert(D);

const seed='WP-S011-004-SEED-A';
const cp=(id='R-ALLY',kind='resident',sourceSystem='DailyActivity')=>({id,kind,sourceSystem,refId:id,validated:true});
const req=(id='REQ-1',scope=null)=>({requestId:id,topicId:'TOPIC-COOPERATION',requiredAuthorityScope:scope,text:'provider wording',providerPayload:{secret:'must-not-persist'}});
const rel=(id='R-ALLY',values={trust:.9,fear:.1,respect:.9,suspicion:.1,loyalty:.8,resentment:.05})=>({sourceSystem:'SocialState',refId:'REL:'+id,observerId:id,subjectId:'protagonist',values});
const dec=(v=.66,u=.58,s=.64)=>({value:v,urgency:u,socialAcceptability:s,dutyConflict:false});
const friendly=()=>({decisionContext:dec(),relationship:rel(),reputations:[{sourceSystem:'SocialState',refId:'REP:SET',subjectId:'protagonist',scope:'settlement',id:'starting-village',score:.6}],obligations:[],authority:null});
const hostile=()=>({decisionContext:dec(.24,.25,.22),relationship:rel('R-HOSTILE',{trust:.08,fear:.4,respect:.15,suspicion:.9,loyalty:.05,resentment:.85}),reputations:[{sourceSystem:'SocialState',refId:'REP:HOST',subjectId:'protagonist',scope:'settlement',id:'hostile-quarter',score:-.8}],obligations:[],authority:null});
function evaluate(s,when,a,id,cmd='advisor.propose_advice'){return Eval.evaluate({seed:s,when,snapshot:{snapshotId:'DIP',context:{seed:s,when},targets:{}},execute:false,proposal:{proposalId:id,commandId:cmd,parameters:{topic:'Diplomatic approach'}},decisionContext:a.decisionContext})}

const a=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:00:00',counterpart:cp(),request:req(),context:friendly()});
assert(a.ok&&a.assessment.modifier>0&&a.assessment.modifier<=D.MAX_MODIFIER);assert(a.assessment.options.some(x=>x.id==='relationship-goodwill'));assert(a.assessment.options.some(x=>x.id==='reputation-appeal'));assert(a.assessment.constraints.includes('protagonist-choice-required'));assert.deepStrictEqual(D.assess(seed,{fantasyTimestamp:'1201-05-05 09:00:00',counterpart:cp(),request:req(),context:friendly()}),a);
const accepted=evaluate(seed,'1201-05-05 09:00:00',a.assessment,'PROP-FRIENDLY');assert.equal(accepted.decision,'accepted');
const recorded=D.recordOutcome(seed,a.assessment,accepted);assert(recorded.ok&&recorded.progressionEvidence.toolId==='advisor.diplomacy');assert(D.recordOutcome(seed,a.assessment,accepted).duplicate);

const oc=friendly();oc.relationship=rel('R-DEBTOR',{trust:.55,fear:.1,respect:.6,suspicion:.25,loyalty:.45,resentment:.1});oc.reputations=[];oc.obligations=[{sourceSystem:'SocialState',id:'DUTY-DEBT-1',status:'active',type:'debt',priority:.95,actor:{kind:'resident',id:'R-DEBTOR'},beneficiary:{kind:'protagonist',id:'protagonist'}}];
const wd=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:01:00',counterpart:cp('R-DEBTOR'),request:req('REQ-DEBT'),context:oc});
const nd=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:01:00',counterpart:cp('R-DEBTOR'),request:req('REQ-DEBT'),context:{...oc,obligations:[]}});
assert(wd.ok&&nd.ok&&wd.assessment.factors.obligationNet>0&&wd.assessment.modifier>nd.assessment.modifier&&wd.assessment.factorRefs.includes('DUTY-DEBT-1'));assert(wd.assessment.options.some(x=>x.id==='counterpart-obligation'&&x.sourceRefs.includes('DUTY-DEBT-1')));

const h=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:02:00',counterpart:cp('R-HOSTILE'),request:req('REQ-HOSTILE'),context:hostile()});
assert(h.ok&&h.assessment.modifier<0&&h.assessment.risks.includes('hostile-or-low-trust-context'));
const rejected=evaluate(seed,'1201-05-05 09:02:00',h.assessment,'PROP-HOSTILE');assert.equal(rejected.decision,'rejected');assert(D.recordOutcome(seed,h.assessment,rejected).ok);

const pcp=cp('COUNTRY-B','country','PoliticalGeography'),preq=req('REQ-AUDIENCE','realm:advise');
const pctx={decisionContext:dec(.62,.48,.60),relationship:{sourceSystem:'CountryRelations',refId:'REL|A<>B',fromCountryId:'COUNTRY-A',toCountryId:'COUNTRY-B',shared:{relationshipScore:.35,cooperation:.72,rivalry:.22,militaryTension:.24,tradeAccess:.75},direction:{leverage:.30,dependency:.25,tradeReliance:.70}},reputations:[],obligations:[],authority:{sourceSystem:'ProtagonistAuthority',roleId:'realm-councillor',rankTier:4,scopes:['self','realm:advise']}};
const pol=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:03:00',counterpart:pcp,request:preq,context:pctx});assert(pol.ok);assert(pol.assessment.options.some(x=>x.id==='legitimate-authority-request'));assert(pol.assessment.constraints.includes('authority-scope:realm:advise'));
diplomacyLevel=20;const missing=D.assess(seed,{fantasyTimestamp:'1201-05-05 09:04:00',counterpart:pcp,request:preq,context:{...pctx,authority:{sourceSystem:'ProtagonistAuthority',roleId:'local-resident',rankTier:0,scopes:['self']}}});assert(!missing.ok&&/authority scope/.test(missing.reason));
assert(!D.assess(seed,{fantasyTimestamp:'1201-05-05 09:04:00',counterpart:{...cp(),validated:false},request:req('REQ-INVALID'),context:friendly()}).ok);

diplomacyLevel=1;const low=D.assess('WP-S011-004-SKILL',{fantasyTimestamp:'1201-05-05 10:00:00',counterpart:cp(),request:req('REQ-SKILL'),context:friendly()});
diplomacyLevel=20;const high=D.assess('WP-S011-004-SKILL',{fantasyTimestamp:'1201-05-05 10:00:00',counterpart:cp(),request:req('REQ-SKILL'),context:friendly()});
assert(low.ok&&high.ok&&high.assessment.modifier>low.assessment.modifier&&high.assessment.skill.contribution<=D.MAX_SKILL_BONUS);

const ia=D.assess('WP-S011-004-INVALID',{fantasyTimestamp:'1201-05-05 11:00:00',counterpart:cp(),request:req('REQ-CMD'),context:friendly()});
const inv=evaluate('WP-S011-004-INVALID','1201-05-05 11:00:00',ia.assessment,'PROP-INVALID','advisor.impossible');assert.equal(inv.decision,'invalid');const ir=D.recordOutcome('WP-S011-004-INVALID',ia.assessment,inv);assert(ir.ok&&ir.progressionEvidence===null);

const before=D.snapshot(seed),saved=global.WorldState.serializeState(seed);assert(before.serializedBytes<=D.MAX_LEDGER_BYTES&&before.outcomeCount===2);assert(!JSON.stringify(saved).includes('provider wording')&&!JSON.stringify(saved).includes('must-not-persist'));
stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});global.WorldState.restoreSerializedState({seed},saved);assert.deepStrictEqual(D.snapshot(seed),before);

const src=fs.readFileSync(mp,'utf8');
for(const x of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.'])assert(!src.includes(x));
for(const x of ['SocialState.recordEvent','SocialState.createDuty','SocialState.transitionDuty','ProtagonistAuthority.transition','setPosition(','teleport('])assert(!src.includes(x));
for(const x of ['fullWorldScan:false','wholeRelationshipScan:false','wholeHistoryScan:false','perFrameScan:false','directWorldMutation:false','relationshipMutation:false','politicalMutation:false','authorityMutation:false','forcedDecision:false','guaranteedOutcome:false','simulationValidationBypass:false'])assert(src.includes(x),x);
const html=fs.readFileSync(path.resolve(__dirname,'../../index.html'),'utf8'),script='scripts/world/advisor-diplomacy.js?v=advisor-diplomacy-v1';assert(html.includes(script));assert(html.indexOf(script)>html.indexOf('scripts/world/advisor-rhetoric.js?v=advisor-rhetoric-v1')&&html.indexOf(script)<html.indexOf('scripts/world/advisor-channel.js?v=advisor-chat-v1'));
const final=D.snapshot(seed);assert.equal(final.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(final.relationshipAuthority,'SocialState references only');assert.equal(final.politicalRelationshipAuthority,'CountryRelations references only');assert.equal(final.legitimateAuthority,'ProtagonistAuthority scopes only');assert.equal(final.decisionAuthority,'ProtagonistCommandEvaluator');assert.equal(final.maxModifier,.07);assert.equal(final.maxSkillBonus,.015);assert.equal(final.maxOptions,6);assert.equal(final.maxConstraints,8);assert.equal(final.fullWorldScan,false);assert.equal(final.relationshipMutation,false);assert.equal(final.politicalMutation,false);assert.equal(final.authorityMutation,false);assert.equal(final.forcedDecision,false);assert.equal(final.simulationValidationBypass,false);
console.log(JSON.stringify({wp:'WP-S011-004',classification:'FUNCTIONAL',visual:'N/A — bounded diplomacy/leverage analysis adds no rendered surface',pass:true,friendlyDecision:accepted.decision,hostileDecision:rejected.decision,obligationImprovesLeverage:true,missingAuthorityFailsClosed:true,invalidTargetFailsClosed:true,invalidCommandStillInvalid:inv.decision,duplicateOutcomeIdempotence:true,deterministicReplay:true,maxModifier:D.MAX_MODIFIER,maxSkillBonus:D.MAX_SKILL_BONUS,saveReload:true,directRelationshipMutation:false,politicalMutation:false,authorityMutation:false},null,2));