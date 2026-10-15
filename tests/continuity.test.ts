import {rebuildNaturalSurface} from "../src/natural-surface-mesh.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalCell, sourceToLonLat, lonLatToSource, cubeFaceToUnit, unitToLonLat, type CubeFace } from "../src/planet.ts";
import { logicalRegion, regionBoundaries, boundaryPoint, addressedSample, beginQuery, advanceQuery, recipeKey, CONTINUITY_LIMITS } from "../src/continuity.ts";
import { createContinuityService } from "../src/continuity-runtime.ts";
import { roads, villages, continuityCorridor, roadDistanceAt } from "../src/geography.ts";
import { finalSurfaceAt } from "../src/world.ts";
import { createMacroPlan, macroSampleAt } from "../src/macro-geography.ts";
import { composeFinalSurface } from "../src/final-surface.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_RADIUS } from "../src/planet.ts";
import { defineContinuityCorridor, clippedStationRange, CORRIDOR_LIMITS } from "../src/continuity-corridor.ts";
import { canonicalCellNeighbor, canonicalCellCenter } from "../src/spatial-authority.ts";
import { buildTile } from "../src/geometry.ts";
import { refineTileSurfacePresentation } from "../src/surface-refinement.ts";
import { tileAt, tileForPosition } from "../src/world.ts";

const focus = sourceToLonLat((roads[0].fromX + roads[0].toX)/2, (roads[0].fromZ + roads[0].toZ)/2);
const service = () => createContinuityService("fixture", roads, finalSurfaceAt);
test("coarse coverage retains no fine work and the local lake-detour ground follows composed truth", () => {
  const root=tileAt(0,0,0),empty={positions:new Float32Array(),normals:new Float32Array(),colors:new Uint8Array(),indices:new Uint32Array()},
    coarse={terrain:empty,structures:empty,nature:empty,detail:empty};
  assert.equal(refineTileSurfacePresentation(root,coarse),coarse);
  assert.equal(coarse.structures.positions.length,0);
  const corridor=roads.find(road=>road.centerline)!;
  assert.ok(corridor);
  const station=corridor.centerline![16],tile=tileForPosition(station.x,station.z,14),base=buildTile(tile),natural=rebuildNaturalSurface(tile,base.terrain);
  base.terrain=natural.geometry;
  const result=refineTileSurfacePresentation(tile,base,natural.replaced),originX=tile.minX+tile.size/2,originZ=tile.minZ+tile.size/2;
  let rendered=0;
  for(let vertex=0;vertex<result.terrain.positions.length/3;vertex++) {
    if(result.terrain.normals[vertex*3+1]<=0||![112,92,62].every((value,i)=>result.terrain.colors[vertex*4+i]===value))continue;
    const p=vertex*3,x=originX+result.terrain.positions[p],z=originZ+result.terrain.positions[p+2];
    const surface=finalSurfaceAt(x,z);
    if(surface.groundMaterial!=="Road"||surface.reservedUse!==corridor.code||roadDistanceAt(x,z,corridor)>=5)continue;
    assert.equal(surface.water.kind,"none");assert.ok(surface.walkable);
    assert.ok(Math.abs(result.terrain.positions[p+1]-surface.groundHeight)<.026,"rendered detour must follow its actual prepared height");
    assert.deepEqual(Array.from(result.terrain.colors.slice(vertex*4,vertex*4+3)),[112,92,62],"detour must be visible on the common ground");
    rendered++;
  }
  assert.ok(rendered>0,"actual polyline detour must receive visible local prepared ground");
  assert.ok(result.terrain.positions.length/3<4096,"local prepared ground must retain the fixed geometry bound");
});
test("integer geometric boundaries have exactly two incident owners across six faces and corners", () => {
  const edges = new Map<string, number>();
  for (let face = 0; face < 6; face++) for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    const p = unitToLonLat(cubeFaceToUnit(face as CubeFace, (u+.5)/4-1, (v+.5)/4-1)), cell = canonicalCell(p.lon,p.lat,3,"fixture");
    for (const edge of regionBoundaries(cell,"fixture")) edges.set(edge.id,(edges.get(edge.id)||0)+1);
  }
  assert.equal(edges.size,768);
  assert.ok([...edges.values()].every(count => count === 2));
});
test("ten SEED macro plans reconstruct shared terrain/road profiles in shuffled, reversed and evicted order", () => {
  for (let seedIndex = 0; seedIndex < 10; seedIndex++) {
    const seed = `fixture-${seedIndex}`, plan=createMacroPlan(seed), lake=plan.lakes[0], center=lonLatToSource(lake.center.lon,lake.center.lat), radius=lake.radiusRad*SOURCE_PRESENTATION_RADIUS*Math.max(1,lake.aspect)*2.8,
      destinations=Array.from({length:16},(_,i)=>{
        const angle=i*Math.PI/8,position=sourceToLonLat(center.x+Math.cos(angle)*radius/Math.cos(lake.center.lat),center.z+Math.sin(angle)*radius);
        return {...villages[0],id:`${seed}/${i}`,code:`${seed}/DEST/${i}`,continent:lake.continent,canonicalPosition:{...position,elevation:0},...lonLatToSource(position.lon,position.lat)};
      }).filter(place=>macroSampleAt(place.canonicalPosition,plan).land), corridor=defineContinuityCorridor(destinations,roads[0],plan.lakes,position=>macroSampleAt(position,plan),seed);
    assert.ok(corridor.road,`no valid bounded corridor for ${seed}`);
    const road=corridor.road, point=sourceToLonLat(road.centerline![15].x,road.centerline![15].z),
      sample=(x:number,z:number)=>{
        const terrain=macroSampleAt(sourceToLonLat(x,z),plan),wet=!terrain.land;
        return composeFinalSurface({groundHeight:wet?-1.2:5+terrain.reliefM,material:wet?"Lake":"Meadow",water:{kind:wet?"lake":"none",level:wet?0:-Infinity,flowX:0,flowZ:0},walkable:!wet,vegetationDensityScale:1,reservedUse:null},roadDistanceAt(x,z,road)<5?[{id:road.code,priority:8,material:"Road",vegetationDensityScale:0}]:[]);
      }, region = logicalRegion(point,seed), cells = [region, canonicalCellNeighbor(region,1,0,seed), canonicalCellNeighbor(region,0,1,seed)],
      points = cells.map(cell => boundaryPoint(regionBoundaries(cell,seed)[0],.5));
    const a = createContinuityService(seed,[road],sample), expected = points.map(point => a.inspectRegion(point));
    assert.ok(expected.some(result=>result.ports.length));
    for (const order of [[2,0,1],[2,1,0],[0,1,2]]) for (const i of order) {
      a.clearContinuityDetail();
      assert.deepEqual(a.inspectRegion(points[i]),expected[i]);
    }
    const b = createContinuityService(seed,[road],sample);
    assert.deepEqual(b.inspectRegion(points[0]),expected[0]);
    assert.equal(a.continuityTelemetry().recursiveRequests,0);
  }
});
test("shared road records agree from both regions and match runtime final surface exactly", () => {
  const a = service(), result = a.inspectRegion(focus);
  assert.ok(result.ports.some(port => port.status === "legal"));
  for (const port of result.ports) {
    const edge = result.edges.find(edge => edge.id === port.edgeId)!;
    const p = lonLatToSource(port.position.lon, port.position.lat);
    assert.deepEqual(port.surface,finalSurfaceAt(p.x,p.z));
    assert.notDeepEqual(port.position,boundaryPoint(edge,.5));
    const source = port.position;
    const neighbors = [logicalRegion({lon:source.lon+1e-7,lat:source.lat},"fixture"),logicalRegion({lon:source.lon-1e-7,lat:source.lat},"fixture"),logicalRegion({lon:source.lon,lat:source.lat+1e-7},"fixture"),logicalRegion({lon:source.lon,lat:source.lat-1e-7},"fixture")];
    let matches = 0;
    for (const neighbor of neighbors) {
      const e = regionBoundaries(neighbor,"fixture").find(e => e.id === port.edgeId);
      if (!e) continue;
      const midpoint = canonicalCellCenter(neighbor), next = a.inspectRegion(midpoint).ports.find(p => p.id === port.id);
      if (next) { assert.deepEqual(next,port); matches++; }
    }
    assert.ok(matches >= 2);
    assert.ok(Math.abs(port.elevationM-port.surface.surfaceHeight)<=.01);
  }
});
test("wrap, exact poles, cube face endpoints and domain-separated slot encodings remain stable", () => {
  for (const point of [{lon:Math.PI,lat:.2},{lon:-Math.PI,lat:.2},{lon:0,lat:Math.PI/2},{lon:0,lat:-Math.PI/2}]) {
    assert.equal(logicalRegion(point).id,logicalRegion({...point,lon:point.lon+Math.PI*2}).id);
  }
  assert.equal(logicalRegion({lon:1,lat:Math.PI/2}).id,logicalRegion({lon:-2,lat:Math.PI/2}).id);
  assert.notEqual(recipeKey("a/b","c"),recipeKey("a","b/c"));
  assert.notEqual(addressedSample("ROAD","edge",0),addressedSample("TREE","edge",0));
});
test("deterministic continuation quotas and cancellation cannot select a different foundation", () => {
  const positions = Array.from({length:81},(_,i)=>({lon:focus.lon+i*1e-8,lat:focus.lat}));
  const expected = positions.map(p=> {const s=lonLatToSource(p.lon,p.lat);return finalSurfaceAt(s.x,s.z);});
  for (const quota of [1,8,81]) {
    const a=service(), job=a.terrainQuery(focus,positions);let cursor=job.request;
    while(cursor.status!=="complete") cursor=job.advance(cursor,quota);
    assert.equal(cursor.values.length,81);
    assert.equal(a.continuityTelemetry().pendingQueries,0);
    const direct=advanceQuery(beginQuery("address",positions),p=> {const s=lonLatToSource(p.lon,p.lat);return finalSurfaceAt(s.x,s.z);},81);
    assert.deepEqual(cursor.values,direct.values);
  }
  assert.equal(expected.length,81);
  assert.throws(()=>beginQuery("too-large",[...positions,focus]),RangeError);
  const a=service(), pending=Array.from({length:4},()=>a.terrainQuery(focus,positions));
  assert.throws(()=>a.terrainQuery(focus,positions),/queue full/);
  pending.forEach(job=>job.cancel());
  assert.equal(a.continuityTelemetry().pendingQueries,0);
});
test("unrelated metadata grows only coarse scan cost, never local fine generation", () => {
  const far={...roads[0], code:"unrelated",fromX:0,toX:1,fromZ:0,toZ:0,minX:0,maxX:1,minZ:0,maxZ:0}, a=service(), b=createContinuityService("fixture",[...roads,...Array.from({length:2000},(_,i)=>({...far,code:`unrelated-${i}`}))],finalSurfaceAt);
  assert.deepEqual(a.inspectRegion(focus),b.inspectRegion(focus));
  assert.equal(a.continuityTelemetry().portSamples,b.continuityTelemetry().portSamples);
  assert.ok(b.continuityTelemetry().coarseRoadChecks>a.continuityTelemetry().coarseRoadChecks);
});
test("persisted revision survives detail eviction without changing semantic port identity", () => {
  const original=service().inspectRegion(focus), events=[{id:"closed-road",sequence:1,time:"0126-12-04 22:00:00",featureId:roads[0].code}],
    affectedIds=original.ports.filter(port=>port.surface.contributingModifierIds.includes(events[0].featureId)).map(port=>port.id),
    sample=(x:number,z:number)=>{const value=finalSurfaceAt(x,z);return value.contributingModifierIds.includes(events[0].featureId)?{...value,walkable:false,traversal:"blocked" as const}:value;},
    a=createContinuityService("fixture",roads,sample,"event-1"), changed=a.inspectRegion(focus),
    changedById=new Map(changed.ports.map(port=>[port.id,port]));
  assert.ok(affectedIds.length>0,"fixture must contain at least one crossing affected by the persisted road revision");
  assert.ok(affectedIds.every(id=>changedById.get(id)?.status==="blocked"));
  assert.deepEqual(changed.ports.map(p=>p.id),original.ports.map(p=>p.id));
  for(const port of original.ports)if(!affectedIds.includes(port.id))assert.deepEqual(changedById.get(port.id),port);
  for(let i=0;i<10;i++){a.clearContinuityDetail();assert.deepEqual(a.inspectRegion(focus),changed);}
  const replay=createContinuityService("fixture",roads,sample,"event-1");
  assert.deepEqual(replay.inspectRegion(focus),changed);
});
test("cache churn stays inside fixed region/edge/port limits",()=>{
  const a=service();
  for(let i=0;i<80;i++)a.inspectRegion({lon:focus.lon+i*.04,lat:focus.lat});
  const t=a.continuityTelemetry();
  assert.ok(t.cachedRegions<=32 && t.cachedEdges<=128 && t.cachedPorts<=256);
  assert.equal(CONTINUITY_LIMITS.level,7);
  assert.equal(t.recursiveRequests,0);
});
test("corner crossings have one immutable record across incident cube faces",()=>{
  const vertex=unitToLonLat(cubeFaceToUnit(0,-1,1)),a=lonLatToSource(vertex.lon-.001,vertex.lat-.001),b=lonLatToSource(vertex.lon+.001,vertex.lat+.001),
    road={...roads[0],code:"corner/ROAD",fromX:a.x,fromZ:a.z,toX:b.x,toZ:b.z,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minZ:Math.min(a.z,b.z),maxZ:Math.max(a.z,b.z)},
    sample=()=>composeFinalSurface({groundHeight:1,material:"Road",water:{kind:"none",level:-Infinity,flowX:0,flowZ:0},walkable:true,vegetationDensityScale:0,reservedUse:null},[]),
    s=createContinuityService("corner",[road],sample), records=[];
  for(const dx of [-1e-5,1e-5])for(const dy of [-1e-5,1e-5]){
    const cell=logicalRegion({lon:vertex.lon+dx,lat:vertex.lat+dy},"corner"),r=s.inspectRegion(canonicalCellCenter(cell));
    records.push(...r.ports.filter(p=>Math.abs(p.position.lon-vertex.lon)<1e-8&&Math.abs(p.position.lat-vertex.lat)<1e-8));
    assert.equal(new Set(r.ports.map(p=>p.id)).size,r.ports.length);
  }
  assert.ok(records.length>=3);assert.equal(new Set(records.map(p=>p.id)).size,1);
  records.forEach(record=>assert.deepEqual(record,records[0]));
  assert.ok(Object.isFrozen(records[0])&&Object.isFrozen(records[0].surface));
  assert.throws(()=>addressedSample("ROAD","edge",NaN),RangeError);
  assert.throws(()=>beginQuery("point",[vertex]).positions.push(vertex),TypeError);
});
test("the runtime corridor rejects a lake midpoint and joins actual destinations without blocked stations",()=>{
  const road=continuityCorridor.road!;
  assert.equal(continuityCorridor.evidence.status,"ready");
  assert.ok(road.centerline!.length<=CORRIDOR_LIMITS.stations);
  assert.equal(macroSampleAt(continuityCorridor.evidence.rejectedMidpoint!).domain,"Lake");
  let checked=0;
  for(let i=0;i<road.centerline!.length-1;i++){
    const a=road.centerline![i],b=road.centerline![i+1],count=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/2);
    assert.ok(count<=8192);
    for(let j=0;j<=count;j++){
      const t=j/count,surface=finalSurfaceAt(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
      assert.equal(surface.walkable,true);assert.equal(surface.water.kind,"none");checked++;
    }
  }
  assert.ok(checked>8000);
  assert.ok(villages.some(v=>v.id===road.from)&&villages.some(v=>v.id===road.to));
  const range=clippedStationRange(0,0,100000,0,50000,-16,32,50000);
  assert.ok(range[1]-range[0]<=23,"small visible request must not scan all 50,000 stations");
  const failure=defineContinuityCorridor(villages,roads[0],[]);
  assert.equal(failure.evidence.status,"generation-failure");assert.equal(failure.road,undefined);
});
