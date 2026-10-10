import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainTint, buildTile } from '../src/geometry.ts';
import { globeSurfaceColor } from '../src/globe-surface.ts';
import { localDetailWeight, LOD_BLEND_SECONDS } from '../src/surface-presentation.ts';
import { tileAt, tileForPosition, heightAt } from '../src/world.ts';
import { lonLatToFlat } from '../src/planet.ts';
import { polarBoundaryAt } from '../src/climate.ts';

test('all tile sizes share exact canonical material albedo, including roads and poles', () => {
  for (const [lon,lat] of [[0,0],[-1.05,-0.2],[Math.PI,0.3],[-Math.PI,0.3],[0.4,Math.PI/2],[0.4,-Math.PI/2],[0.9,0.7]]) {
    const p = lonLatToFlat(lon,lat), elevation = heightAt(p.x,p.z);
    const expected = terrainTint(p.x,p.z,32,elevation);
    for (const size of [2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,262144])
      assert.deepEqual(terrainTint(p.x,p.z,size,elevation),expected);
    assert.deepEqual(globeSurfaceColor(p.x,p.z), [...new Uint8Array(terrainTint(p.x,p.z))]);
  }
});
test('continuous detail filtering has compatible endpoints and bounded transition', () => {
  assert.equal(localDetailWeight(70),1);
  assert.equal(localDetailWeight(900),0);
  for (const threshold of [70,230,512,900,4172])
    assert.ok(Math.abs(localDetailWeight(threshold*1.0001)-localDetailWeight(threshold*0.9999)) < 0.0002);
  let previous = 1;
  for(let h=2;h<10000;h*=1.03) { const value=localDetailWeight(h); assert.ok(value<=previous); previous=value; }
  assert.ok(LOD_BLEND_SECONDS > 0 && LOD_BLEND_SECONDS <= 0.3);
});
test('terrain texture coordinates join exactly at tile and longitude boundaries', () => {
  const a=buildTile(tileAt(8,127,127)).terrain, b=buildTile(tileAt(8,128,127)).terrain;
  assert.equal(a.uvs!.length, a.positions.length/3*2);
  assert.equal(b.uvs!.length, b.positions.length/3*2);
  assert.ok([...a.uvs!].every(Number.isFinite));
  const edge=(g:typeof a,u:number) => [...new Set(Array.from(g.uvs!).filter((v,i)=> i%2===1 && g.uvs![i-1]===u))].sort();
  assert.deepEqual(edge(a,0.5),edge(b,0.5));
  assert.ok(Array.from(buildTile(tileAt(8,0,127)).terrain.uvs!).some((v,i)=>i%2===0&&v===0));
  assert.ok(Array.from(buildTile(tileAt(8,255,127)).terrain.uvs!).some((v,i)=>i%2===0&&v===1));
});
test('visible polar water plane shares the continuous globe ice margin', () => {
  let point: {x:number,z:number}|undefined;
  for(let lon=-Math.PI;lon<Math.PI;lon+=0.1){
    const lat=polarBoundaryAt({lon,lat:1})*Math.PI/2;
    const p=lonLatToFlat(lon,lat);
    if(heightAt(p.x,p.z)<0){point=p;break;}
  }
  assert.ok(point,'fixture must cross open polar water');
  const tile=tileForPosition(point.x,point.z,12), ground=buildTile(tile).terrain;
  const originX=tile.minX+tile.size/2,originZ=tile.minZ+tile.size/2;
  for(let v=ground.positions.length/3-6;v<ground.positions.length/3;v++){
    const x=originX+ground.positions[v*3],z=originZ+ground.positions[v*3+2];
    assert.equal(ground.positions[v*3+1],0);
    assert.deepEqual([...ground.colors.subarray(v*4,v*4+3)],[...new Uint8Array(terrainTint(x,z))]);
  }
});
