'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
global.window=global;global.TextEncoder=global.TextEncoder||require('util').TextEncoder;
let inventoryRecords=[],healthState={},martial={level:3,points:4800},authority={available:true,roleId:'local-resident',rankTier:0,rankLabel:'ordinary',scopes:['self']};
global.ProtagonistInventory={snapshot(){return{compatible:true,protagonistId:'PROTAGONIST-TEST',recordCount:inventoryRecords.length,records:JSON.parse(JSON.stringify(inventoryRecords))}}};
global.ProtagonistHealth={snapshot(){return{compatible:true,exists:true,conditionMilli:healthState.conditionMilli??92000,fatigueMilli:healthState.fatigueMilli??12000,injuryBurdenMilli:healthState.injuryBurdenMilli??0,activeInjuryCount:healthState.activeInjuryCount??0,injuries:JSON.parse(JSON.stringify(healthState.injuries||[]))}}};
global.ProtagonistSkills={getSkill(_seed,id){return id==='martial'?JSON.parse(JSON.stringify(martial)):null}};
global.ProtagonistAuthority={decisionContext(){return JSON.parse(JSON.stringify(authority))}};
const modulePath=path.resolve(__dirname,'../world/protagonist-martial-readiness.js');delete require.cache[modulePath];require(modulePath);const Ready=global.ProtagonistMartialReadiness;
assert.equal(Ready.VERSION,'protagonist-martial-readiness-v1');
const seed='WP-S014-002-SEED';
function rec(id,label,metadata={},carryState='carried'){return{id,itemRef:{kind:'item',id:'ITEM-'+id},label,quantity:1,ownershipState:'owned',carryState,metadata}}
inventoryRecords=[
 rec('POS-SWORD','Plain Sword',{martialWeaponClass:'standard',martialReachClass:'short',martialCondition:'good',martialSuitability:'good'}),
 rec('POS-COAT','Padded Coat',{martialProtectionClass:'medium',martialCondition:'good',martialSuitability:'adequate'})
];
const equipped=Ready.context(seed,{requiredCapabilities:['weapon','protection']});
assert(equipped.ok);assert.equal(equipped.missingCapabilities.length,0);assert(equipped.readinessScore>=50);assert.equal(equipped.health.activeInjuryCount,0);assert.equal(equipped.roleContext.roleId,'local-resident');
const replay=Ready.context(seed,{requiredCapabilities:['weapon','protection']});assert.deepStrictEqual(replay,equipped,'same inputs must replay identically');

inventoryRecords=[];
const missing=Ready.context(seed,{requiredCapabilities:['weapon','protection']});
assert(missing.ok);assert.deepStrictEqual(missing.missingCapabilities,['weapon','protection']);assert(missing.readinessScore<equipped.readinessScore,'grounded suitable equipment should raise readiness');

inventoryRecords=[rec('POS-MYSTERY','Sword-Looking Object',{})];
const nameOnly=Ready.context(seed,{requiredCapabilities:['weapon']});
assert.equal(nameOnly.equipment.length,0,'item label must not infer capability');assert(nameOnly.unknownFacts.some(x=>x.reason==='capability-metadata-absent'));assert.equal(nameOnly.missingCapabilities.includes('weapon'),false,'unknown capability must not be misreported as confirmed missing');

const unowned=Ready.context(seed,{equipmentDescriptors:[{possessionId:'POS-FAKE',validated:true,authoritative:true,authority:'item-catalog',sourceRef:{kind:'catalog',id:'CAT-1'},weaponClass:'heavy'}]});
assert(unowned.rejectedDescriptors.some(x=>x.reason==='owned-possession-required'));
const unsupported=Ready.context(seed,{equipmentDescriptors:[{possessionId:'POS-MYSTERY',validated:true,authoritative:true,authority:'item-catalog',sourceRef:{kind:'catalog',id:'CAT-2'},weaponClass:'dragon-slayer'}]});
assert(unsupported.rejectedDescriptors.some(x=>x.reason==='unsupported-capability-value'));
const forged=Ready.context(seed,{equipmentDescriptors:[{possessionId:'POS-MYSTERY',validated:true,authoritative:true,authority:'ui',sourceRef:{kind:'ui',id:'UI-1'},weaponClass:'standard'}]});
assert(forged.rejectedDescriptors.some(x=>x.reason==='validated-authoritative-descriptor-required'));

const explicit=Ready.context(seed,{equipmentDescriptors:[{possessionId:'POS-MYSTERY',validated:true,authoritative:true,authority:'item-catalog',sourceRef:{kind:'catalog',id:'CAT-3'},weaponClass:'light',condition:'serviceable',suitability:'adequate'}],requiredCapabilities:['weapon']});
assert(explicit.equipment.some(x=>x.weaponClass==='light'));assert.equal(explicit.missingCapabilities.length,0);

inventoryRecords=[rec('POS-SWORD','Plain Sword',{martialWeaponClass:'standard',martialCondition:'good',martialSuitability:'good'})];
healthState={conditionMilli:62000,fatigueMilli:72000,injuryBurdenMilli:35000,activeInjuryCount:1,injuries:[{id:'INJ-1',kind:'sprain',bodyRegion:'arm',remainingSeverityMilli:35000}]};
martial={level:5,points:11000};
const constrained=Ready.context(seed,{requiredCapabilities:['weapon']});
assert(constrained.limitations.includes('high-fatigue'));assert(constrained.limitations.includes('active-injury'));assert(constrained.readinessScore<equipped.readinessScore,'fatigue/injury must remain constraining despite strong skill');
assert.equal(constrained.health.injuries[0].id,'INJ-1');

healthState={};martial={level:3,points:4800};
global.innerWidth=320;global.innerHeight=800;global.devicePixelRatio=3;Object.defineProperty(global,'navigator',{value:{userAgent:'a'},configurable:true,writable:true});const deviceA=Ready.context(seed,{requiredCapabilities:['weapon']});
global.innerWidth=1920;global.innerHeight=1080;global.devicePixelRatio=1;global.navigator={userAgent:'b'};const deviceB=Ready.context(seed,{requiredCapabilities:['weapon']});assert.deepStrictEqual(deviceB,deviceA,'presentation/device state influenced readiness');
assert(deviceA.serializedBytes<=Ready.MAX_OUTPUT_BYTES);assert(deviceA.counts.possessionsRead<=Ready.MAX_POSSESSIONS);assert(deviceA.counts.descriptorsRead<=Ready.MAX_DESCRIPTORS);
assert.equal(deviceA.fullWorldScan,false);assert.equal(deviceA.wholeSettlementScan,false);assert.equal(deviceA.wholeHistoryScan,false);assert.equal(deviceA.perFrameScan,false);assert.equal(deviceA.inventoryMutation,false);assert.equal(deviceA.healthMutation,false);assert.equal(deviceA.skillMutation,false);assert.equal(deviceA.authorityMutation,false);assert.equal(deviceA.autoEquip,false);assert.equal(deviceA.combatResolutionAuthority,false);assert.equal(deviceA.victoryProbabilityAuthority,false);assert.equal(deviceA.directActionExecution,false);assert.equal(deviceA.directWorldMutation,false);
const src=fs.readFileSync(modulePath,'utf8');for(const forbidden of ['Math.random','Date.now','new Date(','innerWidth','innerHeight','devicePixelRatio','navigator.','ProtagonistInventory.apply','ProtagonistHealth.apply','ProtagonistSkills.recordPractice','ProtagonistAuthority.transition','ActionExecutor.','setPosition(','teleport('])assert(!src.includes(forbidden),'forbidden authority/presentation input: '+forbidden);
for(const required of ['fullWorldScan:false','wholeSettlementScan:false','wholeHistoryScan:false','perFrameScan:false','inventoryMutation:false','healthMutation:false','skillMutation:false','authorityMutation:false','combatResolutionAuthority:false','victoryProbabilityAuthority:false'])assert(src.includes(required),'missing guard '+required);
console.log(JSON.stringify({pass:true,wp:'WP-S014-002',classification:'FUNCTIONAL',visual:'N/A',equippedScore:equipped.readinessScore,missingScore:missing.readinessScore,constrainedScore:constrained.readinessScore,unknownNameInferenceBlocked:true,unownedRejected:true,unsupportedCapabilityRejected:true,forgedDescriptorRejected:true,deterministicReplay:true,serializedBytes:deviceA.serializedBytes,maxOutputBytes:Ready.MAX_OUTPUT_BYTES,telemetry:Ready.telemetry()},null,2));
