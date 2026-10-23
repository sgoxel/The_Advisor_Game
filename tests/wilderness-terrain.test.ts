import test from 'node:test';
import assert from 'node:assert/strict';
import {villages,places,roads} from '../src/geography.ts';
import {nearbyLandforms,landformAt,wildernessTerrainAt,wildernessTerrainCacheState,type Landform} from '../src/wilderness-terrain.ts';
import {naturalSurfaceAt} from '../src/hydrology.ts';
import {sourceUnitsPerMetreAt} from '../src/physical-scale.ts';
import {finalSurfaceAt,tileForPosition} from '../src/world.ts';
import {nearbyWilderness} from '../src/wilderness.ts';
import {buildTile} from '../src/geometry.ts';
import {rebuildNaturalSurface,NATURAL_MESH_LIMITS} from '../src/natural-surface-mesh.ts';

const fixtures=new Map<string,Landform>();
test('all continents have real countryside relief and water formations; all requested POI types can be discovered',()=>{
 const kinds=new Set<string>();
 for(const continent of new Set(villages.map(v=>v.continent))){
  const local=new Set<string>();
  const region=villages.filter(v=>v.continent===continent),sample=Array.from({length:20},(_,i)=>region[Math.floor(i*(region.length-1)/19)]);
  for(const v of sample){
   for(const f of nearbyLandforms(v.x,v.z,700)){local.add(f.kind);if(!fixtures.has(f.kind))fixtures.set(f.kind,f);
    if(kinds.size<10)for(const s of nearbyWilderness(f.x,f.z,600,100))kinds.add(s.kind);
   }
   if(local.size===4&&kinds.size===10)break;
  }
  for(const kind of ['hill','cliff','lake','waterfall'])assert.ok(local.has(kind),`${continent}: ${kind}`);
 }
 for(const kind of ['ruin','dungeon','cave','mine','forest','lake','waterfall','cliff','hill','wild-meadow'])assert.ok(kinds.has(kind),kind);
});
test('new basins and cascades have physical water, relief and dry surrounding land',()=>{
 assert.equal(fixtures.size,4);
 for(const f of fixtures.values()){
  const m=sourceUnitsPerMetreAt(f.z),at=(a:number,b:number)=>({x:f.x+(a*Math.cos(f.yaw)-b*Math.sin(f.yaw))*m.x,z:f.z+(a*Math.sin(f.yaw)+b*Math.cos(f.yaw))*m.z}),
   surface=finalSurfaceAt(f.x,f.z),base=naturalSurfaceAt(f.x,f.z);
  if(f.kind==='lake'){assert.equal(surface.water.kind,'lake');assert.ok(surface.groundHeight<surface.water.level);assert.equal(surface.walkable,false);}
  if(f.kind==='hill')assert.ok(surface.groundHeight>base.groundHeight+10);
  if(f.kind==='cliff')assert.equal(surface.walkable,false);
  if(f.kind==='waterfall'){
   const upper=at(0,12),lower=at(0,-12),a=finalSurfaceAt(upper.x,upper.z),b=finalSurfaceAt(lower.x,lower.z);
   assert.equal(a.water.kind,'river');assert.equal(b.water.kind,'river');assert.ok(a.water.level-b.water.level>10);
   assert.equal(surface.walkable,false);
  }
  const edge=at(f.radiusM*1.01,0),dry=naturalSurfaceAt(edge.x,edge.z);
  assert.deepEqual(wildernessTerrainAt(edge.x,edge.z,dry),dry);
 }
});
test('town centres and transport stations retain their original natural base; recipe memory is bounded',()=>{
 for(const p of places)assert.equal(landformAt(p.x,p.z),undefined,p.code);
 for(const r of roads.slice(0,64))for(const p of r.centerline||[{x:r.fromX,z:r.fromZ},{x:r.toX,z:r.toZ}])assert.equal(landformAt(p.x,p.z),undefined,r.code);
 const c=wildernessTerrainCacheState();assert.ok(c.cells<=c.limit&&c.estimatedBytes>0);
});
test('focused formation terrain meshes use the composed water and relief within unchanged caps',()=>{
 for(const f of fixtures.values()){
  const tile=tileForPosition(f.x,f.z,15),mesh=rebuildNaturalSurface(tile,buildTile(tile,{terrainOnly:true}).terrain);
  assert.equal(mesh.replaced,true);assert.ok(mesh.leaves<=NATURAL_MESH_LIMITS.leaves&&mesh.samples<=NATURAL_MESH_LIMITS.samples);
  assert.ok(mesh.geometry.positions.every(Number.isFinite));
  for(let i=0;i<mesh.surfaceVertices;i++){
    const p=mesh.geometry.positions,s=finalSurfaceAt(tile.minX+tile.size/2+p[i*3],tile.minZ+tile.size/2+p[i*3+2]),
      expected=s.water.kind==='none'?s.groundHeight:s.water.level+.0025;
    assert.ok(Math.abs(p[i*3+1]-expected)<.001,'mesh must follow the authoritative terrain/water height');
  }
 }
});
