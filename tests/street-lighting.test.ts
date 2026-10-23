import test from 'node:test';
import assert from 'node:assert/strict';
import {closeLightingEnabled,eveningLightWeight,facadeWindows,mainStreetLampAnchors} from '../src/street-lighting.ts';
import {daylightAt} from '../src/daylight.ts';
import {villages} from '../src/geography.ts';
import {settlementExteriorFor} from '../src/settlement-exterior.ts';
import {featuresFor,tileForPosition} from '../src/world.ts';
import {buildTile} from '../src/geometry.ts';

test('light meshes are eligible only at 1/1 and closer, with smooth evening illumination',()=>{
 for(const scale of [.2,.5,1])assert.equal(closeLightingEnabled(scale),true);
 for(const scale of [0,-1,1.01,2,5,50,Infinity,NaN])assert.equal(closeLightingEnabled(scale),false);
 assert.equal(eveningLightWeight(daylightAt(12*3600).daylight),0);
 assert.ok(eveningLightWeight(daylightAt(19*3600).daylight)>0);
 assert.equal(eveningLightWeight(daylightAt(23*3600).daylight),1);
});
test('windows fit exterior storeys, remain metre sized and leave the front door clear',()=>{
 for(const [w,d,h,f] of [[2.4,3.4,2.8,1],[6,8,2.8,1],[8,10,5.6,2],[24,28,10,3]]){
  const windows=facadeWindows(w,d,h,f);assert.ok(windows.length>0&&windows.length<=48);
  assert.deepEqual(windows,facadeWindows(w,d,h,f));
  for(const v of windows){assert.ok(v.y>=0&&v.y+v.height<h);assert.ok(v.width<=.8&&v.height<=1);
   if(v.yaw===0&&v.y<2)assert.ok(Math.abs(v.x)-v.width/2>.45,'window intersects front door');
   assert.equal('room' in v,false);
  }
 }
});
test('seeded main street lamps have stable bounded anchors and exterior-only batched geometry',()=>{
 const place=villages[0],anchors=mainStreetLampAnchors(settlementExteriorFor(place));
 assert.ok(anchors.length>0&&anchors.length<=128*5);
 assert.deepEqual(anchors,mainStreetLampAnchors(settlementExteriorFor(place)));
 assert.equal(new Set(anchors.map(p=>p.id)).size,anchors.length);
 const lamps=anchors.flatMap(a=>featuresFor(tileForPosition(a.candidates[0].x,a.candidates[0].z,15)).filter(f=>f.kind==='street-lamp'));
 assert.ok(lamps.length>0,'fixture must contain actual non-colliding lamps');
 const lamp=lamps[0],tile=tileForPosition(lamp.x,lamp.z,15),geometry=buildTile(tile);
 console.log('LAMP_FIXTURE',JSON.stringify({x:lamp.x,z:lamp.z,id:lamp.code}));
 for(const name of ['closeDetail','nightGlow','lampPools'] as const){
  assert.ok(geometry[name]!.indices.length>0,name);
  assert.ok(geometry[name]!.positions.every(Number.isFinite));
 }
 assert.deepEqual(geometry.nightGlow,buildTile(tile).nightGlow);
 assert.equal(buildTile(tile,{terrainOnly:true}).nightGlow,undefined);
 assert.equal(buildTile(tileForPosition(lamp.x,lamp.z,11)).nightGlow,undefined);
});
