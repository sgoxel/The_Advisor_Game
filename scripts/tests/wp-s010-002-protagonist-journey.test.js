'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const repoRoot=path.resolve(__dirname,'../..');
const modulePath=path.join(repoRoot,'scripts/world/protagonist-journey.js');
const source=fs.readFileSync(modulePath,'utf8');
assert(source.includes('VERSION="protagonist-journey-v1"'),'journey version marker missing');
assert(source.includes('MAX_SEGMENTS=64')&&source.includes('MAX_ROUTE_STEPS=2048'),'route bounds missing');
assert(source.includes('directPositionMutation:false')&&source.includes('teleportation:false'),'movement authority boundary missing');
assert(!source.includes('Math.random('),'journey state must not use Math.random');

const index=fs.readFileSync(path.join(repoRoot,'index.html'),'utf8');
const script='scripts/world/protagonist-journey.js?v=protagonist-journey-v1';
assert(index.includes(script),'canonical root must load ProtagonistJourney');
assert(index.indexOf(script)>index.indexOf('scripts/world/protagonist-action-runtime.js?v=protagonist-action-runtime-v1'),'journey must load after action runtime');

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function merge(a,b){if(!b||typeof b!=='object'||Array.isArray(b))return clone(b);const out=(a&&typeof a==='object'&&!Array.isArray(a))?clone(a):{};for(const [k,v] of Object.entries(b))out[k]=(v&&typeof v==='object'&&!Array.isArray(v))?merge(out[k],v):clone(v);return out;}
function hash(text){let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return(h>>>0).toString(16).toUpperCase().padStart(8,'0');}
function makeWorld(){
  const stores=new Map();
  function ensure(seed){if(!stores.has(seed))stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});return stores.get(seed);}
  const api={
    structuralRef(seed,kind,parent,key,initial){return {id:'STR|'+String(kind).toUpperCase()+'|'+hash([seed,kind,parent,key].join('|')),kind,key:{initial:clone(initial||{})}};},
    resolve(seed,ref){const s=ensure(seed),entry=s.entries[ref.id]||null;return {current:merge(ref.key.initial,entry?.changes||{}),delta:entry};},
    applyDelta(seed,ref,changes,reason){const s=ensure(seed),prev=s.entries[ref.id];s.sequence++;s.entries[ref.id]={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason,changes:merge(prev?.changes||{},changes)};return {ok:true,reason:'ok',entry:clone(s.entries[ref.id]),resolved:this.resolve(seed,ref)};},
    serializeState(seed){return clone(ensure(seed));},
    restoreSerializedState(seed,value){stores.set(seed,clone(value));return {ok:true};},
    clear(seed){stores.set(seed,{schema:'CampaignStateDelta',seed,sequence:0,entries:{}});},
    sequence(seed){return ensure(seed).sequence;}
  };
  return api;
}
let routeVersion=1;
function sig(seed,origin,destination,surface){return 'RSIG-'+hash([seed,origin.x,origin.y,destination.x,destination.y,surface,routeVersion].join('|'));}
function routeId(seed,signature){return 'ROUTE-'+hash(seed+'|'+signature);}
function fixtureValidator(seed,origin,destination,expected){
  if(String(destination.x)==='999')return {ok:false,reason:'route-unavailable'};
  const surface=String(destination.x)==='50'?'road':'grass';
  const seconds=surface==='road'?100:120;
  const signature=sig(seed,origin,destination,surface);
  if(expected&&expected!==signature)return {ok:false,reason:'route-stale',expectedSignature:expected,currentSignature:signature};
  return {
    ok:true,reason:'route-valid',source:'deterministic-supplied-route-fixture',
    routeId:routeId(seed,signature),signature,origin:clone(origin),destination:clone(destination),
    segments:[{from:clone(origin),to:clone(destination),surface,distanceMeters:100,seconds}],
    totalMeters:100,totalSeconds:seconds,stepCount:50
  };
}
function ts(seconds){
  const d=new Date(Date.UTC(1201,8,30,17,0,seconds));
  const p=n=>String(n).padStart(2,'0');
  return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds());
}
const Journey=require(modulePath);
assert.equal(Journey.VERSION,'protagonist-journey-v1');
const seed='AGENT6-WP-S010-002',origin={x:'0',y:'0',level:0},roadDest={x:'50',y:'0',level:0},grassDest={x:'0',y:'50',level:0};

// Stable identity on the same deterministic route/time using independent sparse campaign stores.
const worldA=makeWorld(),worldB=makeWorld();
const a=Journey.createService({worldState:worldA,routeValidator:fixtureValidator});
const b=Journey.createService({worldState:worldB,routeValidator:fixtureValidator});
const aStart=a.start(seed,{when:ts(0),origin,destination:roadDest,externalKey:'PLAN-1'});
const bStart=b.start(seed,{when:ts(0),origin,destination:roadDest,externalKey:'PLAN-1'});
assert(aStart.ok&&bStart.ok);assert.equal(aStart.journey.journeyId,bStart.journey.journeyId);assert.equal(aStart.journey.route.signature,bStart.journey.route.signature);

// Partial physical progress; no instant arrival and no world-position mutation authority.
const partial=a.advance(seed,{when:ts(50)});
assert(partial.ok&&!partial.arrived);assert.equal(partial.processedSeconds,50);assert(Math.abs(partial.journey.progressMeters-50)<1e-6);assert.equal(partial.journey.routeProjection.fraction,0.5);
const snapPartial=a.snapshot(seed);assert.equal(snapPartial.active.status,'travelling');assert.equal(snapPartial.worldPositionAuthority,false);assert.equal(snapPartial.directPositionMutation,false);assert.equal(snapPartial.teleportation,false);

// Sparse save/reload continuity keeps exactly the same active journey/progress.
const saved=worldA.serializeState(seed),beforeReload=JSON.stringify(a.snapshot(seed));
worldA.clear(seed);assert.equal(a.snapshot(seed).active,null);
worldA.restoreSerializedState(seed,saved);
const reloaded=Journey.createService({worldState:worldA,routeValidator:fixtureValidator});
assert.equal(JSON.stringify(reloaded.snapshot(seed)),beforeReload);

// Arrival only after the remaining validated route time and exactly at the validated endpoint.
const arrived=reloaded.advance(seed,{when:ts(100)});
assert(arrived.ok&&arrived.arrived);assert.equal(arrived.journey.status,'arrived');assert.equal(arrived.journey.progressMeters,100);assert.deepEqual(arrived.journey.finalRoutePoint,roadDest);assert.equal(reloaded.snapshot(seed).active,null);assert.equal(reloaded.snapshot(seed).history[0].status,'arrived');

// Road vs open-ground timing from canonical 3.6 km/h vs 3.0 km/h fixture: same distance, same elapsed time, grass advances less.
const roadWorld=makeWorld(),grassWorld=makeWorld();
const road=Journey.createService({worldState:roadWorld,routeValidator:fixtureValidator});
const grass=Journey.createService({worldState:grassWorld,routeValidator:fixtureValidator});
road.start(seed+'-ROAD',{when:ts(0),origin,destination:roadDest});
grass.start(seed+'-GRASS',{when:ts(0),origin,destination:grassDest});
const road50=road.advance(seed+'-ROAD',{when:ts(50)}),grass50=grass.advance(seed+'-GRASS',{when:ts(50)});
assert(Math.abs(road50.journey.progressMeters-50)<1e-6);assert(Math.abs(grass50.journey.progressMeters-41.666667)<1e-5);assert(road50.journey.progressMeters>grass50.journey.progressMeters);
const grassDone=grass.advance(seed+'-GRASS',{when:ts(120)});assert(grassDone.arrived&&grassDone.journey.progressMeters===100);

// Pause/interruption/resume exclude paused time from travel progress.
const stateWorld=makeWorld(),stateSvc=Journey.createService({worldState:stateWorld,routeValidator:fixtureValidator}),stateSeed=seed+'-STATE';
assert(stateSvc.start(stateSeed,{when:ts(0),origin,destination:roadDest}).ok);
assert(Math.abs(stateSvc.advance(stateSeed,{when:ts(20)}).journey.progressMeters-20)<1e-6);
assert.equal(stateSvc.interrupt(stateSeed,{when:ts(20),reason:'world-condition-changed'}).journey.status,'interrupted');
assert.equal(stateSvc.advance(stateSeed,{when:ts(50)}).reason,'journey-not-travelling');
assert.equal(stateSvc.resume(stateSeed,{when:ts(60)}).journey.status,'travelling');
const afterResume=stateSvc.advance(stateSeed,{when:ts(70)});assert(Math.abs(afterResume.journey.progressMeters-30)<1e-6);
assert.equal(stateSvc.pause(stateSeed,{when:ts(70)}).journey.status,'paused');
assert.equal(stateSvc.resume(stateSeed,{when:ts(80)}).journey.status,'travelling');

// Stale-route revalidation fails closed with zero travel mutation.
const staleWorld=makeWorld(),staleSvc=Journey.createService({worldState:staleWorld,routeValidator:fixtureValidator}),staleSeed=seed+'-STALE';
routeVersion=1;assert(staleSvc.start(staleSeed,{when:ts(0),origin,destination:roadDest}).ok);
const staleBefore=JSON.stringify(staleSvc.snapshot(staleSeed)),seqBefore=staleWorld.sequence(staleSeed);
routeVersion=2;const staleAdvance=staleSvc.advance(staleSeed,{when:ts(10)});
assert.equal(staleAdvance.ok,false);assert.equal(staleAdvance.reason,'route-stale');assert.equal(JSON.stringify(staleSvc.snapshot(staleSeed)),staleBefore);assert.equal(staleWorld.sequence(staleSeed),seqBefore);
routeVersion=1;

// Invalid route causes zero campaign delta mutation.
const invalidWorld=makeWorld(),invalidSvc=Journey.createService({worldState:invalidWorld,routeValidator:fixtureValidator}),invalidSeed=seed+'-INVALID';
const invalid=invalidSvc.start(invalidSeed,{when:ts(0),origin,destination:{x:'999',y:'0',level:0}});
assert.equal(invalid.ok,false);assert.equal(invalid.reason,'route-unavailable');assert.equal(invalidWorld.sequence(invalidSeed),0);assert.equal(invalidSvc.snapshot(invalidSeed).active,null);

// Cancellation is terminal and retained as bounded history; campaign state remains isolated.
const cancelWorld=makeWorld(),cancelSvc=Journey.createService({worldState:cancelWorld,routeValidator:fixtureValidator});
const cancelSeed=seed+'-CANCEL',otherSeed=seed+'-OTHER';
cancelSvc.start(cancelSeed,{when:ts(0),origin,destination:roadDest});cancelSvc.advance(cancelSeed,{when:ts(10)});
const cancelled=cancelSvc.cancel(cancelSeed,{when:ts(10),reason:'goal-changed'});assert(cancelled.ok);assert.equal(cancelled.journey.status,'cancelled');assert.equal(cancelSvc.snapshot(cancelSeed).active,null);assert.equal(cancelSvc.snapshot(cancelSeed).history[0].status,'cancelled');
assert.equal(cancelSvc.snapshot(otherSeed).active,null);assert.equal(cancelSvc.snapshot(otherSeed).historyCount,0);

// Chronology rewind fails closed.
const chronoWorld=makeWorld(),chrono=Journey.createService({worldState:chronoWorld,routeValidator:fixtureValidator}),chronoSeed=seed+'-CHRONO';
chrono.start(chronoSeed,{when:ts(10),origin,destination:roadDest});
assert.equal(chrono.advance(chronoSeed,{when:ts(9)}).reason,'cannot-rewind-journey-chronology');
assert.equal(chrono.pause(chronoSeed,{when:ts(9)}).reason,'cannot-rewind-journey-chronology');

// Default production adapter consumes RoutePlanner legality and routeEdgeCost instead of trusting caller distance/time.
global.WorldStandards={TILE_METERS:2,WALK_SPEED_KMH:{road:3.6,grass:3.0}};
global.Walkability={CATEGORY:{ROUTE:'route',DIFFICULT:'difficult',INTERIOR:'interior'},classify(){return {terrainType:'road',category:'route'};}};
let defaultRouteCalls=0,defaultEdgeCalls=0;
global.RoutePlanner={
  findRoute(seedValue,from,to){defaultRouteCalls++;return {found:true,reason:'ok',path:[clone(from),{x:'1',y:'0',level:0},clone(to)],stepCount:2,totalSeconds:4};},
  routeEdgeCost(){defaultEdgeCalls++;return {seconds:2};}
};
const defaultWorld=makeWorld(),defaultSvc=Journey.createService({worldState:defaultWorld}),defaultSeed=seed+'-DEFAULT';
const defaultStart=defaultSvc.start(defaultSeed,{when:ts(0),origin,destination:{x:'2',y:'0',level:0}});
assert(defaultStart.ok);assert.equal(defaultRouteCalls,1);assert.equal(defaultEdgeCalls,2);assert.equal(defaultStart.journey.route.totalMeters,4);assert.equal(defaultStart.journey.route.totalSeconds,4);assert.equal(defaultStart.journey.route.segments[0].surface,'road');

for(const snapshot of [reloaded.snapshot(seed),road.snapshot(seed+'-ROAD'),grass.snapshot(seed+'-GRASS'),stateSvc.snapshot(stateSeed),cancelSvc.snapshot(cancelSeed)]){
  assert(snapshot.serializedBytes<=Journey.MAX_LEDGER_BYTES);assert(snapshot.historyCount<=Journey.MAX_HISTORY);
  assert.equal(snapshot.persistenceAuthority,'WorldState CampaignStateDelta');assert.equal(snapshot.chronologyAuthority,'Fantasy Game Time');assert.equal(snapshot.routeAuthority,'RoutePlanner validated route');
  assert.equal(snapshot.fullWorldScan,false);assert.equal(snapshot.perFramePathPlanning,false);assert.equal(snapshot.directPositionMutation,false);assert.equal(snapshot.teleportation,false);assert.equal(snapshot.cameraDependency,false);assert.equal(snapshot.viewportDependency,false);assert.equal(snapshot.deviceDependency,false);
}

console.log(JSON.stringify({
  wp:'WP-S010-002',classification:'FUNCTIONAL',
  visual:'N/A — persistent physical journey/progress authority adds no rendered surface',
  pass:true,version:Journey.VERSION,stableJourneyId:aStart.journey.journeyId,routeSignature:aStart.journey.route.signature,
  physicalScaleMetersPerTile:2,roadSpeedKmh:3.6,openGroundSpeedKmh:3.0,
  roadProgressAfter50s:road50.journey.progressMeters,grassProgressAfter50s:grass50.journey.progressMeters,
  partialTravel:true,exactEndpointArrival:true,interruptionResume:true,staleRouteZeroMutation:true,
  saveReloadContinuity:true,campaignIsolation:true,
  defaultRoutePlannerIntegration:{routeCalls:defaultRouteCalls,edgeCalls:defaultEdgeCalls,totalMeters:defaultStart.journey.route.totalMeters,totalSeconds:defaultStart.journey.route.totalSeconds},
  bounds:{maxHistory:Journey.MAX_HISTORY,maxSegments:Journey.MAX_SEGMENTS,maxRouteSteps:Journey.MAX_ROUTE_STEPS,maxLedgerBytes:Journey.MAX_LEDGER_BYTES,maxAdvanceSeconds:Journey.MAX_ADVANCE_SECONDS},
  fullWorldScan:false,perFramePathPlanning:false,directPositionMutation:false,teleportation:false
},null,2));
