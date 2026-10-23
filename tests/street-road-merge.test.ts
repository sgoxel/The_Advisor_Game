import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStreetWithRoads, sharedStreetSegments } from '../src/street-road-merge.ts';
import { roads, villages, roadDistanceAt, type Road } from '../src/geography.ts';
import { sourceUnitsPerMetreAt, metresToSource } from '../src/physical-scale.ts';
import { forestBodiesVisibleAtScale } from '../src/surface-presentation.ts';
import { featuresFor, tileForPosition } from '../src/world.ts';
import { roadWidthM } from '../src/road-dimensions.ts';

test('nearby parallel streets share the route; perpendicular and separate streets remain separate',()=>{
 const m=sourceUnitsPerMetreAt(0),p=(x:number,z:number)=>({x:x*m.x,z:z*m.z}),
  road={code:'fixture',fromX:0,fromZ:0,toX:100*m.x,toZ:0,centerline:[p(0,0),p(100,0)]} as Road,
  nearby=[p(10,7),p(50,8),p(90,7)],far=[p(10,30),p(90,30)],cross=[p(50,-20),p(50,0),p(50,20)];
 const merged=mergeStreetWithRoads(nearby,5.4,[road]);
 for(const [i,x]of [10,50,90].entries()){assert.ok(Math.abs(merged[i].x-p(x,0).x)<1e-8);assert.ok(Math.abs(merged[i].z)<1e-8);}
 assert.deepEqual(sharedStreetSegments(merged,3,[road]),[1,2]);
 assert.deepEqual(mergeStreetWithRoads(far,5.4,[road]),far);
 assert.deepEqual(mergeStreetWithRoads(cross,5.4,[road]),cross);
 assert.deepEqual(road.centerline,[p(0,0),p(100,0)],'transport route must remain fixed');
});

test('forest bodies give way to flat coverage at 1/1 and farther out',()=>{
 for(const scale of [.2,.5,.9])assert.equal(forestBodiesVisibleAtScale(scale),true);
 for(const scale of [1,2,5,50,1000])assert.equal(forestBodiesVisibleAtScale(scale),false);
});

test('Alderwick roadside props clear intercity carriageways, including their full footprint',()=>{
 const place=villages[0],m=sourceUnitsPerMetreAt(place.z),props=new Map();
 for(const [dx,dz]of [[0,0],[-60,0],[60,0],[0,-50],[0,50]]){
  for(const f of featuresFor(tileForPosition(place.x+dx*m.x,place.z+dz*m.z,15)))
   if(f.kind==='street-lamp'||f.kind==='roadside-tree')props.set(f.code,f);
 }
 assert.ok(props.size>0,'fixture must exercise actual roadside props');
 for(const f of props.values())for(const road of roads){
  const radius=f.kind==='roadside-tree'?3.2:.65;
  assert.ok(roadDistanceAt(f.x,f.z,road)>=metresToSource(roadWidthM(road)/2+radius)-1e-7,f.code);
 }
});
