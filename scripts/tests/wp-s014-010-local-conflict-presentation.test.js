'use strict';
const assert=require('assert');

global.PlanetStage={snapshot(){return {ready:true,activeSeed:'WP-S014-010-SEED',zoom:{scaleIndex:9},canonicalFocus:{latitudeDegrees:12.5,longitudeDegrees:44.25,worldTile:{x:'100',y:'200'},screenSpaceFocus:{valid:true,screenX:640,screenY:360}}}}};
global.LocalSecurityIncidents={list(){return [{id:'SEC-1',status:'active',epistemicStatus:'confirmed',severity:'serious',summary:'Bandits threaten the mill road.',sourceRef:{kind:'simulation-event',id:'SIM-SEC-1'},locationRef:{kind:'workplace',id:'mill-crossing'},updatedTimestamp:'1201-10-01 18:42:00'}]}};
global.PersonalCombatExchange={list(){return []}};
global.ProtagonistHealth={snapshot(){return {compatible:true,injuries:[]}}};
let now='1201-10-01 18:48:00';
global.GameTime={getTimestampKey(){return now}};
const UI=require('../ui/local-conflict-presentation.js');

assert.equal(UI.VERSION,'local-conflict-presentation-v2');
assert.deepEqual(UI.EVIDENCE_MODES,['active','retreat','terminal','recovered','cleared']);
for(const mode of UI.EVIDENCE_MODES){
  const m=UI.evidenceModel(mode);
  assert.equal(m.phase,mode);
  assert.equal(m.visible,mode!=='cleared');
  assert.equal(m.presentationOnly,true);
  assert.equal(m.authority.simulationAuthority,false);
  assert.equal(m.authority.directWorldMutation,false);
}

const active=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(active.phase,'active');
assert.equal(active.sourceRef.id,'SIM-SEC-1');
let tele=UI.snapshot();
assert.equal(tele.sourceReadTotal,5);
assert.equal(tele.authority.perFrameSourceScan,false);
assert.equal(tele.authority.fullWorldScan,false);
assert.equal(tele.authority.directActionExecution,false);
assert.equal(tele.authority.worldStateEventDriven,true);
assert.equal(UI.shouldRefreshForDelta({seed:'WP-S014-010-SEED',entityKind:'personal-combat-exchange-state'}),true);
assert.equal(UI.shouldRefreshForDelta({seed:'OTHER',entityKind:'personal-combat-exchange-state'}),false);
assert.equal(UI.shouldRefreshForDelta({seed:'WP-S014-010-SEED',entityKind:'unrelated-state'}),false);

const bad=UI.normalizeExplicit({validated:true,phase:'active',sourceRef:{kind:'ui',id:'FAKE'}});
assert.equal(bad.ok,false);
assert.equal(bad.reason,'validated-trusted-source-required');
const unvalidated=UI.normalizeExplicit({validated:false,phase:'terminal',sourceRef:{kind:'simulation-result',id:'SIM-1'}});
assert.equal(unvalidated.ok,false);
const explicit=UI.normalizeExplicit({validated:true,phase:'retreat',summary:'Validated disengagement cue.',sourceRef:{kind:'simulation-event',id:'SIM-2'},locationRef:{kind:'workplace',id:'gate'}});
assert.equal(explicit.ok,true);
assert.equal(explicit.model.phase,'retreat');
assert.equal(explicit.model.authority.movementMutation,false);

global.LocalSecurityIncidents.list=()=>[];
global.PersonalCombatExchange.list=()=>[{id:'CBT-1',resolution:'stalemate',fantasyTimestamp:'1201-10-01 18:45:00',terminal:true,locationRef:{kind:'workplace',id:'mill-crossing'},protagonistInjuryEvidence:null}];
let terminal=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(terminal.phase,'terminal');
assert.equal(terminal.title,'Stalemate');
UI.render(terminal,'headless-expiry-fixture');
now='1201-10-01 19:00:00';
assert.equal(UI.checkFantasyTimeExpiry(),true);
assert.equal(UI.snapshot().phase,'cleared');
now='1201-10-01 18:48:00';

global.PersonalCombatExchange.list=()=>[{id:'CBT-2',resolution:'opponent-advantage',fantasyTimestamp:'1201-10-01 18:46:00',terminal:true,locationRef:{kind:'workplace',id:'mill-crossing'},protagonistInjuryEvidence:{sourceRef:{kind:'combat-result',id:'CBT-2'}}}];
global.ProtagonistHealth.snapshot=()=>({compatible:true,injuries:[{id:'INJ-1',sourceRef:{kind:'combat-result',id:'CBT-2'}}]});
let recovery=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(recovery.phase,'recovered');
assert.equal(recovery.recovery,true);
assert.equal(recovery.terminal,true);

global.PersonalCombatExchange.list=()=>[{id:'CBT-3',resolution:'protagonist-disengaged',fantasyTimestamp:'1201-10-01 18:47:00',terminal:true,locationRef:{kind:'workplace',id:'mill-crossing'},protagonistInjuryEvidence:null}];
global.ProtagonistHealth.snapshot=()=>({compatible:true,injuries:[]});
let retreat=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(retreat.phase,'retreat');
assert.equal(retreat.terminal,true);

now='1201-10-01 19:00:00';
let stale=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(stale.phase,'cleared','old terminal outcomes must expire after the bounded presentation window');

now='1201-10-01 18:50:00';
global.PersonalCombatExchange.list=()=>[{id:'CBT-OLD',resolution:'stalemate',fantasyTimestamp:'1201-10-01 18:45:00',terminal:true,locationRef:{kind:'workplace',id:'mill-crossing'},protagonistInjuryEvidence:null}];
global.LocalSecurityIncidents.list=()=>[{id:'SEC-NEW',status:'active',epistemicStatus:'confirmed',severity:'serious',summary:'A newer threat is active.',sourceRef:{kind:'simulation-event',id:'SIM-SEC-NEW'},locationRef:{kind:'workplace',id:'gate'},updatedTimestamp:'1201-10-01 18:49:00'}];
let newer=UI.runtimeModel({seed:'WP-S014-010-SEED'});
assert.equal(newer.phase,'active','newer active threat evidence must supersede an older terminal cue');
assert.equal(newer.sourceRef.id,'SIM-SEC-NEW');

console.log(JSON.stringify({pass:true,wp:'WP-S014-010',classification:'MIXED',version:UI.VERSION,states:UI.EVIDENCE_MODES,sourceReadLimit:UI.SOURCE_READ_LIMIT,authority:UI.snapshot().authority},null,2));
