'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-self-care.js');
const source=fs.readFileSync(modulePath,'utf8');
const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');

assert(source.includes('VERSION="protagonist-self-care-v1"'),'self-care version marker missing');
assert(source.includes('MAX_CANDIDATES=12')&&source.includes('MAX_INVENTORY_ITEMS=24'),'bounded candidate/inventory markers missing');
assert(source.includes('directActionExecution:false')&&source.includes('simulationValidationBypass:false')&&source.includes('targetFabrication:false'),'authority boundary markers missing');
assert(!source.includes('Math.random('),'self-care selection must not use Math.random');
const script='scripts/world/protagonist-self-care.js?v=protagonist-self-care-v1';
assert(index.includes(script),'canonical root must load ProtagonistSelfCare');
assert(index.indexOf(script)>index.indexOf('scripts/world/protagonist-journey.js?v=protagonist-journey-v1'),'self-care should load after Stage 10 journey foundation');
assert(index.indexOf(script)<index.indexOf('scripts/world/conversation-transactions.js?v=conversation-transactions-v2'),'self-care should load before conversation presentation/history');

delete require.cache[require.resolve(modulePath)];
const SelfCare=require(modulePath);
assert.equal(SelfCare.VERSION,'protagonist-self-care-v1');
const seed='AGENT6-WP-S010-004',when='1201-09-30 18:00:00';
const healthy={conditionMilli:90000,fatigueMilli:18000};
const inventory={items:[
  {possessionId:'POS-BREAD',itemRef:{kind:'item',id:'ITEM-BREAD'},quantity:2,carryState:'carried'},
  {possessionId:'POS-SOUP',itemRef:{kind:'item',id:'ITEM-SOUP'},quantity:1,carryState:'stored'}
]};
const food={id:'FOOD-BREAD',type:'food',available:true,capability:'consume',possessionId:'POS-BREAD',itemRef:{kind:'item',id:'ITEM-BREAD'},proposal:{proposalId:'PROP-FOOD',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'ITEM-BREAD'},source:'self-care-fixture'}};
const storedFood={id:'FOOD-SOUP',type:'food',available:true,capability:'consume',possessionId:'POS-SOUP',itemRef:{kind:'item',id:'ITEM-SOUP'},proposal:{proposalId:'PROP-SOUP',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'ITEM-SOUP'}}};
const rest={id:'REST-HOME',type:'rest',available:true,capability:'rest',targetId:'HOME-BED',proposal:{proposalId:'PROP-REST',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'HOME-BED'}}};
const safe={id:'SAFE-INN',type:'safety',available:true,capability:'move-to-safe-place',targetId:'PLACE-INN',safetyGainMilli:40000,proposal:{proposalId:'PROP-SAFE',commandId:'advisor.propose_travel',parameters:{placeId:'PLACE-INN'}}};

// Low pressure leaves the autonomous protagonist alone.
const low=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:22000,fatigue:26000,safety:18000,social:10000}},health:healthy,inventory,candidates:[food,rest,safe]});
assert(low.ok);assert.equal(low.status,'no-op');assert.equal(low.selectedProposal,null);

// High hunger selects only a real carried possession and never consumes it here.
const hungry=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:91000,fatigue:12000,safety:8000}},health:healthy,inventory,candidates:[storedFood,food]});
assert.equal(hungry.status,'proposal-ready');assert.equal(hungry.selectedCandidate.type,'food');assert.equal(hungry.selectedCandidate.reference,'POS-BREAD');assert.equal(hungry.selectedProposal.commandId,'advisor.propose_interaction');
assert.equal(hungry.evaluated.find(x=>x.id==='FOOD-SOUP').reason,'food-not-carried');

// High hunger without owned carried food fails closed rather than inventing a meal.
const noFood=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:93000,fatigue:12000,safety:8000}},health:healthy,inventory:{items:[]},candidates:[food]});
assert.equal(noFood.status,'deferred');assert.equal(noFood.reason,'urgent-food-no-valid-candidate');assert.equal(noFood.selectedProposal,null);

// High fatigue chooses a supplied rest target.
const fatigued=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:15000,fatigue:88000,safety:9000}},health:{conditionMilli:82000,fatigueMilli:90000},inventory,candidates:[rest]});
assert.equal(fatigued.selectedCandidate.type,'rest');assert.equal(fatigued.selectedCandidate.reference,'HOME-BED');

// Critical injury blocks a mobility-sensitive safety route and allows a local rest fallback.
const mobilitySafe={...safe,id:'SAFE-ROAD',requiresHealthyMobility:true};
const injured=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:10000,fatigue:20000,safety:90000}},health:{conditionMilli:30000,fatigueMilli:22000},inventory,candidates:[mobilitySafe,rest]});
assert.equal(injured.selectedCandidate.type,'rest');assert.equal(injured.evaluated.find(x=>x.id==='SAFE-ROAD').reason,'injury-mobility-constraint');

// Unsafe-place pressure selects a supplied safer target when health permits travel.
const unsafe=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:12000,fatigue:18000,safety:94000}},health:healthy,inventory,candidates:[safe]});
assert.equal(unsafe.selectedCandidate.type,'safety');assert.equal(unsafe.selectedCandidate.reference,'PLACE-INN');

// Invalid/missing safety target is rejected locally before any runtime scheduling.
const invalidTarget=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:10000,fatigue:12000,safety:92000}},health:healthy,inventory,candidates:[{...safe,id:'SAFE-MISSING',targetId:''}]});
assert.equal(invalidTarget.status,'deferred');assert.equal(invalidTarget.evaluated[0].reason,'safety-target-required');assert.equal(invalidTarget.selectedProposal,null);

// Same SEED + Fantasy Game Time + supplied state is order-stable and replay-stable.
const rest2={...rest,id:'REST-INN',targetId:'INN-BED',proposal:{proposalId:'PROP-REST-2',commandId:'advisor.propose_interaction',parameters:{interactionTargetId:'INN-BED'}}};
const replayA=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:10000,fatigue:85000,safety:10000}},health:healthy,inventory,candidates:[rest,rest2]});
const replayB=SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:10000,fatigue:85000,safety:10000}},health:healthy,inventory,candidates:[rest2,rest]});
assert.equal(replayA.selectionId,replayB.selectionId);assert.deepStrictEqual(replayA.selectedCandidate,replayB.selectedCandidate);assert.deepStrictEqual(replayA.selectedProposal,replayB.selectedProposal);

// Direct limits fail closed rather than silently scanning beyond budgets.
const tooMany=Array.from({length:SelfCare.MAX_CANDIDATES+1},(_,i)=>({...rest,id:'REST-'+i,targetId:'BED-'+i}));
assert.equal(SelfCare.evaluate({seed,when,needs:{pressureMilli:{fatigue:90000}},health:healthy,inventory,candidates:tooMany}).reason,'candidate-limit-exceeded');
const tooMuchInventory={items:Array.from({length:SelfCare.MAX_INVENTORY_ITEMS+1},(_,i)=>({possessionId:'P'+i,itemRef:{kind:'item',id:'I'+i},quantity:1,carryState:'carried'}))};
assert.equal(SelfCare.evaluate({seed,when,needs:{pressureMilli:{hunger:90000}},health:healthy,inventory:tooMuchInventory,candidates:[food]}).reason,'inventory-read-limit-exceeded');

// Live adapter reads the existing Stage 9 authorities once each.
let needsReads=0,healthReads=0,inventoryReads=0;
global.ProtagonistNeeds={snapshot(){needsReads++;return {pressureMilli:{hunger:90000,fatigue:10000,safety:10000}};}};
global.ProtagonistHealth={decisionContext(){healthReads++;return healthy;}};
global.ProtagonistInventory={commandContext(){inventoryReads++;return inventory;}};
const live=SelfCare.fromLive(seed,when,{candidates:[food]});
assert.equal(live.status,'proposal-ready');assert.deepStrictEqual([needsReads,healthReads,inventoryReads],[1,1,1]);assert.equal(live.sources.inventory,'ProtagonistInventory');

// Handoff is proposal-only: scheduling delegates to ProtagonistActionRuntime and does not evaluate/execute here.
const snapshot={snapshotId:'SNAP-SELF-CARE',context:{seed,when},targets:{interactions:[{id:'ITEM-BREAD'}]}};
const decisionContext={value:0.8,urgency:0.9,socialAcceptability:0.8,dutyConflict:false};
const evaluatorInput=SelfCare.evaluatorInput(hungry,snapshot,decisionContext,{actorPosition:{x:'0',y:'0',level:0}});
assert(evaluatorInput.ok);assert.equal(evaluatorInput.boundary,'ProtagonistCommandEvaluator');assert.equal(evaluatorInput.executionDisabled,true);assert.equal(evaluatorInput.config.execute,false);
let schedules=0,captured=null;
const fakeRuntime={schedule(config){schedules++;captured=config;return {ok:true,reason:'scheduled',attempt:{attemptId:'PAX-SELF'}};}};
const scheduled=SelfCare.schedule(hungry,snapshot,decisionContext,{runtime:fakeRuntime,actorPosition:{x:'0',y:'0',level:0}});
assert(scheduled.ok);assert.equal(schedules,1);assert.equal(captured.proposal.commandId,'advisor.propose_interaction');assert.equal(scheduled.directActionExecution,false);assert.equal(scheduled.simulationValidationBypass,false);

assert.equal(hungry.authority.needsAuthority,false);assert.equal(hungry.authority.healthAuthority,false);assert.equal(hungry.authority.inventoryAuthority,false);assert.equal(hungry.authority.directWorldMutation,false);assert.equal(hungry.authority.targetFabrication,false);assert.equal(hungry.authority.fullWorldScan,false);assert.equal(hungry.authority.wholeInventoryScan,false);assert.equal(hungry.authority.perFrameScan,false);

console.log(JSON.stringify({
  wp:'WP-S010-004',classification:'FUNCTIONAL',visual:'N/A — bounded self-care selection and runtime handoff add no rendered surface',pass:true,version:SelfCare.VERSION,
  cases:{low:low.status,hungry:hungry.selectedCandidate.type,noFood:noFood.status,fatigued:fatigued.selectedCandidate.type,injuryFallback:injured.selectedCandidate.type,unsafe:unsafe.selectedCandidate.type,invalidTarget:invalidTarget.evaluated[0].reason},
  deterministicReplay:true,liveReads:{needsReads,healthReads,inventoryReads},runtimeBoundary:scheduled.boundary,
  bounds:{maxCandidates:SelfCare.MAX_CANDIDATES,maxInventoryItems:SelfCare.MAX_INVENTORY_ITEMS,maxReasons:SelfCare.MAX_REASONS},
  directActionExecution:false,directWorldMutation:false,targetFabrication:false,simulationValidationBypass:false,fullWorldScan:false,wholeInventoryScan:false,perFrameScan:false
},null,2));
