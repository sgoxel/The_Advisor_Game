import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { sourceToLonLat, CANONICAL_METRES_PER_SOURCE_UNIT } from "../src/planet.ts";
import { climateSampleAt } from "../src/climate.ts";
import { naturalSurfaceAt } from "../src/hydrology.ts";
import { finalSurfaceAt, type Tile } from "../src/world.ts";
import { nearbyWilderness } from "../src/wilderness.ts";
import { forestCoverForTile } from "../src/forest-cover.ts";
import { buildVegetationGeometry } from "../src/vegetation-render.ts";
import { appendWildernessGeometry } from "../src/wilderness-geometry.ts";
import { elevationToRenderY } from "../src/render-frame.ts";
import type { Geometry, TileGeometry } from "../src/geometry.ts";

const tile=(x:number,z:number,size:number):Tile=>({minX:x,minZ:z,size,key:`forest-test/${x}/${z}/${size}`,level:0,x:0,z:0});
function forestFixture() {
  for(const place of villages.slice(0,20))for(const [dx,dz]of [[60,50],[-70,40],[140,-50]]) {
    const t=tile(place.x+dx,place.z+dz,8);
    if(forestCoverForTile(t).patches.length>80)return t;
  }
  throw Error("No dense seeded forest fixture");
}
test("countryside sites are diverse, stable across visits and bounded by focus",()=>{
  const p=villages[0],first=nearbyWilderness(p.x,p.z,600,60);
  assert.ok(first.length>12);assert.deepEqual(nearbyWilderness(p.x,p.z,600,60),first);
  const kinds=new Set(first.map(s=>s.kind));
  for(const kind of ["forest","ruin","dungeon"] as const)assert.ok(kinds.has(kind));
  assert.ok(nearbyWilderness(p.x,p.z,600,8).length<=8);
  assert.equal(new Set(first.map(s=>s.code)).size,first.length);
  for(const site of first){
    const s=naturalSurfaceAt(site.x,site.z);
    if(site.kind==="lake")assert.equal(s.water.kind,"lake");
    else if(site.kind==="waterfall")assert.equal(s.water.kind,"river");
    else assert.ok(finalSurfaceAt(site.x,site.z).walkable && s.water.kind==="none");
    if(site.kind==="forest")assert.ok(climateSampleAt(site.canonicalPosition).forestFamily);
  }
});
test("forest interiors contain dense metre-scaled trees and subdivide without rerolling",()=>{
  const t=forestFixture(),forest=forestCoverForTile(t),children=[];
  for(const dx of [0,4])for(const dz of [0,4])children.push(...forestCoverForTile(tile(t.minX+dx,t.minZ+dz,4)).patches);
  assert.ok(forest.fine && forest.patches.length>80);
  assert.deepEqual(children.map(p=>p.code).sort(),forest.patches.map(p=>p.code).sort());
  for(const tree of forest.patches){assert.ok(tree.heightM>=9&&tree.heightM<16);assert.ok(tree.radiusM<5);assert.equal(finalSurfaceAt(tree.x,tree.z).water.kind,"none");}
  const mesh=buildVegetationGeometry(t);assert.ok(mesh.geometry.indices.length/3<=8192);assert.equal(mesh.telemetry.forestRepresentation,"trees");
});
test("forest canopy stays batched and bounded at overview LOD",()=>{
  const t=forestFixture(),mesh=buildVegetationGeometry(tile(t.minX,t.minZ,128));
  assert.equal(mesh.telemetry.forestRepresentation,"canopy");assert.ok(mesh.telemetry.visibleInstances>0);
  assert.ok(mesh.telemetry.drawCalls<=1 && mesh.geometry.indices.length/3<=8192);
});
test("inhabited clearing no longer erases kilometres of countryside",()=>{
  const p=villages[0],x=p.x+900/CANONICAL_METRES_PER_SOURCE_UNIT/Math.cos(p.canonicalPosition.lat),z=p.z,
    surface=finalSurfaceAt(x,z);
  assert.ok(!surface.contributingModifierIds.includes(`${p.code}/PAD`));
  assert.ok(finalSurfaceAt(p.x,p.z).contributingModifierIds.includes(`${p.code}/PAD`));
  assert.ok(Number.isFinite(sourceToLonLat(x,z).lat));
});

test("seeded ruin wall heights stay above their foundation for unsigned variants",()=>{
  const p=villages[0],sites=nearbyWilderness(p.x,p.z,600,60).filter(s=>s.kind==="ruin"||s.kind==="dungeon");
  assert.ok(sites.some(s=>s.variant>0x7fffffff));
  const empty=():Geometry=>({positions:new Float32Array(),normals:new Float32Array(),colors:new Uint8Array(),indices:new Uint32Array()});
  for(const site of sites){
    const t=tile(site.x-2,site.z-2,4),data:TileGeometry={terrain:empty(),structures:empty(),nature:empty(),detail:empty()};
    appendWildernessGeometry(t,data);assert.ok(data.structures.indices.length>0);
    const base=elevationToRenderY(site.canonicalPosition.elevation);
    for(let i=1;i<data.structures.positions.length;i+=3)assert.ok(data.structures.positions[i]>=base-1e-4,"wall extends below foundation");
  }
});
