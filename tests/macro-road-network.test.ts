import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMacroRoadNetwork,MACRO_ROAD_LIMITS,ROAD_FORK_POLICY,type RoadNode} from '../src/macro-road-network.ts';
import {macroSampleAt} from '../src/macro-geography.ts';
import {lonLatToSource,greatCircleDistance,CANONICAL_METRES_PER_SOURCE_UNIT} from '../src/planet.ts';
const node=(id:string,lon:number,lat:number):RoadNode=>({id,code:`fixture/${id}`,kind:'village',continent:0,country:0,canonicalPosition:{lon,lat,elevation:0},...lonLatToSource(lon,lat)});
const base=macroSampleAt({lon:-1,lat:-.2});
const flat=(p:{lon:number;lat:number})=>({...base,land:true,domain:'Mainland' as const,reliefM:2,mountainIntensity:0});
test('near approaches merge into one shared physical Y trunk with exact canonical junctions',()=>{
 const hub=node('hub',0,0),a=node('a',.12,.035),b=node('b',.12,-.035),g=createMacroRoadNetwork([hub,a,b],[[hub,a],[hub,b]],()=> '0/0','Y-fixture',flat);
 assert.equal(g.junctions.length,1);assert.equal(g.edges.length,3);assert.equal(g.connections.length,2);
 const trunk=g.edges.filter(e=>e.kind==='trunk');assert.equal(trunk.length,1);
 assert.ok(g.connections.every(c=>c.legs.some(l=>l.edgeId===trunk[0].id)));
 const junction=g.junctions[0];assert.equal(g.edges.filter(e=>e.from.id===junction.id||e.to.id===junction.id).length,3);
 for(const e of g.edges){assert.deepEqual(e.points[0].position,{lon:e.from.canonicalPosition.lon,lat:e.from.canonicalPosition.lat});assert.deepEqual(e.points.at(-1)!.position,{lon:e.to.canonicalPosition.lon,lat:e.to.canonicalPosition.lat});}
 const reversed=createMacroRoadNetwork([b,a,hub],[[hub,b],[hub,a]],()=> '0/0','Y-fixture',flat);
 const signature=(network:typeof g)=>network.edges.map(e=>({id:e.id,points:e.points})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(signature(g),signature(reversed));
});
test('terrain-costed roads bend around a real supplied ridge while flat land stays direct',()=>{
 const a=node('a',-.12,0),b=node('b',.12,0),ridge=(p:{lon:number;lat:number})=>({...flat(p),reliefM:700*Math.exp(-Math.pow(p.lon/.025,2)-Math.pow(p.lat/.008,2))});
 const g=createMacroRoadNetwork([a,b],[[a,b]],()=> '0/0','terrain-fixture',ridge),e=g.edges[0];
 assert.equal(e.fallback,false);assert.ok(e.points.some(p=>Math.abs(p.position.lat)>.005));
 assert.ok(e.points.length<=MACRO_ROAD_LIMITS.maximumStations);assert.ok(g.telemetry.maxStates<=49);
 const length=e.points.slice(1).reduce((n,p,i)=>n+greatCircleDistance(e.points[i].position,p.position),0);assert.ok(length>greatCircleDistance(a.canonicalPosition,b.canonicalPosition));
 const direct=createMacroRoadNetwork([a,b],[[a,b]],()=> '0/0','terrain-fixture',flat);assert.equal(direct.edges[0].points.length,2);
});

test('shallow-angle river approaches bend to legal crossings instead of inventing a straight fallback',()=>{
 const a=node('a',-.002,-.04),b=node('b',.002,.04),riverA=lonLatToSource(0,-.06),riverB=lonLatToSource(0,.06);
 const g=createMacroRoadNetwork([a,b],[[a,b]],()=> '0/0','river-fixture',flat,[{ax:riverA.x,az:riverA.z,bx:riverB.x,bz:riverB.z,width:3.5}]);
 assert.equal(g.telemetry.fallbacks,0);assert.equal(g.edges[0].fallback,false);assert.ok(g.edges[0].points.length>2);
 const points=g.edges[0].points;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a.x*b.x<0){const sine=Math.abs(b.x-a.x)/Math.hypot(b.x-a.x,b.z-a.z);assert.ok(7*CANONICAL_METRES_PER_SOURCE_UNIT/sine<120,'crossing must be short enough for a legal bridge');}}
});
test('an impossible supplied barrier fails explicitly without an unverified road',()=>{
 const a=node('a',-.02,0),b=node('b',.02,0),wall=(p:{lon:number;lat:number})=>({...flat(p),land:Math.abs(p.lon)>.005});
 assert.throws(()=>createMacroRoadNetwork([a,b],[[a,b]],()=> '0/0','barrier-fixture',wall),/No legal coarse road corridor/);
});

test('four nearby approaches share one hub trunk and split through nested degree-three Y nodes',()=>{
 const hub=node('hub',0,0),leaves=[-.03,-.01,.01,.03].map((lat,i)=>node(`leaf${i}`,.12,lat)),g=createMacroRoadNetwork([hub,...leaves],leaves.map(n=>[hub,n] as const),()=> '0/0','nested-fixture',flat);
 assert.equal(g.junctions.length,3);assert.equal(g.edges.filter(e=>e.from.id===hub.id||e.to.id===hub.id).length,1);
 assert.equal(g.telemetry.maximumJunctionDepth,2);assert.equal(g.connections.length,4);
 for(const j of g.junctions)assert.equal(g.edges.filter(e=>e.from.id===j.id||e.to.id===j.id).length,3);
 const trunk=g.edges.find(e=>e.from.id===hub.id||e.to.id===hub.id)!;assert.ok(g.connections.every(c=>c.legs.some(l=>l.edgeId===trunk.id)));
 const oldLength=leaves.reduce((n,l)=>n+greatCircleDistance(hub.canonicalPosition,l.canonicalPosition),0),newLength=g.edges.reduce((n,e)=>n+e.points.slice(1).reduce((m,p,i)=>m+greatCircleDistance(e.points[i].position,p.position),0),0);
 assert.ok(newLength<oldLength,'merging must save actual physical road distance');
});

test('owner fork policy measures actual first segments, separation and twelve seeded attempts',()=>{
 assert.deepEqual(ROAD_FORK_POLICY,{minimumAngleDegrees:32,preferredMinimumDegrees:45,preferredMaximumDegrees:70,hardNearParallelDegrees:20,separationM:300,maximumRegenerationAttempts:12});
 const hub=node('hub',0,0),leaves=[-.03,-.01,.01,.03].map((lat,i)=>node(`leaf${i}`,.12,lat)),g=createMacroRoadNetwork([hub,...leaves],leaves.map(n=>[hub,n] as const),()=> '0/0','owner-fork-fixture',flat);
 assert.equal(g.junctions.length,3);
 assert.ok(g.telemetry.minimumForkAngleDegrees!>=32);assert.ok(g.telemetry.minimumJunctionSeparationM!>=300);assert.ok(g.telemetry.maximumForkAttempts<=12);
 for(const j of g.junctions){
  const arms=g.edges.filter(e=>e.from.id===j.id||e.to.id===j.id).map(e=>e.from.id===j.id?e.points[1]:e.points.at(-2)!);
  assert.equal(arms.length,3);
  for(const arm of arms)assert.ok(greatCircleDistance(j.canonicalPosition,arm.position)>=299.99,'local approach rays must be retained before terrain bends');
 }
 const a=node('a',.12,.00005),b=node('b',.12,-.00005),parallel=createMacroRoadNetwork([hub,a,b],[[hub,a],[hub,b]],()=> '0/0','too-close-fork',flat);
 assert.equal(parallel.junctions.length,0,'do not invent a near-parallel fork where the angle and separation cannot both be legal');
 assert.equal(parallel.connections.length,2);
});

test('opposite endpoint sharing cannot fold a logical connection back through itself',()=>{
 const a=node('a',-.08,0),b=node('b',.08,0),c=node('c',.08,.03),d=node('d',-.08,-.03),g=createMacroRoadNetwork([a,b,c,d],[[a,b],[a,c],[b,d]],()=> '0/0','opposite-fork-fixture',flat);
 assert.ok(g.junctions.length<=1);assert.ok(g.telemetry.minimumForkAngleDegrees===null||g.telemetry.minimumForkAngleDegrees>=32);
 const connection=g.connections.find(e=>e.from===a.id&&e.to===b.id)!,edges=new Map(g.edges.map(e=>[e.id,e]));
 const length=connection.legs.reduce((total,leg)=>{const e=edges.get(leg.edgeId)!;return total+e.points.slice(1).reduce((n,p,i)=>n+greatCircleDistance(e.points[i].position,p.position),0);},0);
 assert.ok(length<greatCircleDistance(a.canonicalPosition,b.canonicalPosition)*1.15,'a shared approach must not cause two ends to pass each other');
});

test('new fork approach stubs remain continuous across the wrapped source seam',()=>{
 const hub=node('0',Math.PI-.03,0),a=node('1',-Math.PI+.07,.03),b=node('2',-Math.PI+.07,-.03),g=createMacroRoadNetwork([hub,a,b],[[hub,a],[hub,b]],()=> '0/0','fork-wrap-fixture',flat);
 assert.equal(g.junctions.length,1);
 for(const e of g.edges)for(let i=1;i<e.points.length;i++)assert.ok(Math.abs(e.points[i].x-e.points[i-1].x)<131072,`${e.id}: fork stub must use the same unwrapped coordinate frame as the routed segment`);
});
