import test from 'node:test';
import assert from 'node:assert/strict';
import {lonLatToSource} from '../src/planet.ts';
import {buildTile} from '../src/geometry.ts';
import {villages} from '../src/geography.ts';
import {tileForPosition,finalSurfaceAt} from '../src/world.ts';
test('terrain-only coverage omits properties and road paint without changing authority',()=>{
 const home=villages[0],tile=tileForPosition(home.x,home.z,12),before=finalSurfaceAt(home.x,home.z);
 const preview=buildTile(tile,{terrainOnly:true}),detail=buildTile(tile);
 for(const group of ['structures','nature','detail'] as const)assert.equal(preview[group].indices.length,0);
 assert.ok(detail.structures.indices.length>0);
 assert.ok(preview.terrain.indices.length<detail.terrain.indices.length);
 for(let i=3;i<preview.terrain.colors.length;i+=4)assert.equal(preview.terrain.colors[i],0);
 assert.deepEqual(finalSurfaceAt(home.x,home.z),before);
});

test('adaptive coverage remains bounded and leaves detailed mesh unchanged',()=>{
 const tile=tileForPosition(villages[0].x,villages[0].z,11);
 const before=buildTile(tile);
 const preview=buildTile(tile,{terrainOnly:true});
 assert.ok(preview.terrain.indices.length<=64*256*6);
 assert.ok(preview.terrain.positions.every(Number.isFinite));
 assert.deepEqual(buildTile(tile),before);
});

test('coastal coverage subdivides material boundaries within a fixed mesh bound',()=>{
 const p=lonLatToSource(-Math.PI/6,-61*Math.PI/180),tile=tileForPosition(p.x,p.z,8);
 const preview=buildTile(tile,{terrainOnly:true});
 assert.ok(preview.terrain.indices.length>64*6,'shore must receive more than the uniform grid');
 assert.ok(preview.terrain.indices.length<=64*256*6,'four subdivision levels are a hard bound');
});

test('cold preview uses bounded material refinement and keeps canonical detail untouched', () => {
 const home = villages[0], tile = tileForPosition(home.x, home.z, 12);
 const detailed = buildTile(tile);
 const preview = buildTile(tile, { terrainOnly: true });
 // At most four children at the dry-land level and sixteen at water
 // boundaries: temporary background terrain cannot monopolize generation.
 assert.ok(preview.terrain.indices.length <= 64 * 16 * 6);
 assert.ok(preview.terrain.indices.length < detailed.terrain.indices.length);
 assert.deepEqual(buildTile(tile), detailed);
});
