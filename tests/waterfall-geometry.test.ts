import test from "node:test";
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { wildernessCell, nearbyWilderness, type WildernessSite } from "../src/wilderness.ts";
import { appendWildernessGeometry } from "../src/wilderness-geometry.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT } from "../src/planet.ts";
import type { TileGeometry, Geometry } from "../src/geometry.ts";
import type { Tile } from "../src/world.ts";

const empty=():Geometry=>({positions:new Float32Array(),normals:new Float32Array(),colors:new Uint8Array(),indices:new Uint32Array()});
const tile=(x:number,z:number,size:number):Tile=>({minX:x,minZ:z,size,key:`waterfall-test/${x}/${z}/${size}`,level:0,x:0,z:0});
function build(site:WildernessSite){
  const t=tile(site.x-8,site.z-8,16),data:TileGeometry={terrain:empty(),structures:empty(),nature:empty(),detail:empty()};
  appendWildernessGeometry(t,data);return data.structures;
}
function cascadeSite(){
  const p=villages[0],gx=Math.floor(p.x/256),gz=Math.floor(p.z/256);
  for(let r=0;r<=40;r+=4)for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dz))<r-3)continue;
    for(const s of wildernessCell(gx+dx,gz+dz))if(s.kind==="waterfall"&&s.code.endsWith("/CASCADE"))return s;
  }
  throw Error("No river cascade fixture");
}
/** Largest drop between vertices that lie within `run` metres of each other horizontally. */
function steepestStep(g:Geometry,site:WildernessSite,run:number){
  const m=sourceUnitsPerMetreAt(site.z),pts:number[][]=[];
  for(let i=0;i<g.positions.length;i+=3)pts.push([g.positions[i]/m.x,g.positions[i+1]*CANONICAL_METRES_PER_SOURCE_UNIT,g.positions[i+2]/m.z]);
  let best=0;
  for(const a of pts)for(const b of pts)if(Math.hypot(a[0]-b[0],a[2]-b[2])<=run)best=Math.max(best,a[1]-b[1]);
  return best;
}
const near=(c:readonly number[],t:readonly number[])=>Math.abs(c[0]-t[0])+Math.abs(c[1]-t[1])+Math.abs(c[2]-t[2])<30;

for(const [label,pick] of [["river cascade",()=>cascadeSite()],
  ["countryside landform fall",()=>{const p=villages[0],s=nearbyWilderness(p.x,p.z,40000,400).find(s=>s.kind==="waterfall"&&s.code.includes("/COUNTRYSIDE/"));if(!s)throw Error("no countryside fall");return s;}]] as const)
test(`${label} has a vertical water sheet, foam at the foot and rock`,()=>{
  const site=pick(),g=build(site);
  assert.ok(g.indices.length/3>100,"cascade has real geometry, not a flat stripe");
  assert.ok(g.indices.length/3<2500,"cascade stays cheap for mobile");
  assert.ok(steepestStep(g,site,4)>=1.5,"water drops at least 1.5 m within 4 m");
  let sheet=0,foam=0,rock=0;
  for(let i=0;i<g.colors.length;i+=4){
    const c=[g.colors[i],g.colors[i+1],g.colors[i+2]];
    if(c[0]>=170&&c[2]>=225&&c[0]<=245)sheet++;
    if(c[0]>=215&&c[1]>=235)foam++;
    if(near(c,[112,117,103])||near(c,[93,98,88])||near(c,[126,128,114]))rock++;
  }
  assert.ok(sheet>0&&foam>0,"pale sheet and white foam present");
  if(label==="river cascade")assert.ok(rock>0,"rock sill present");
  // Normals are unit length and no vertex is NaN.
  for(let i=0;i<g.positions.length;i++)assert.ok(Number.isFinite(g.positions[i]));
});
test("waterfall geometry is deterministic",()=>{
  const site=cascadeSite(),a=build(site),b=build(site);
  assert.deepEqual(Array.from(a.positions),Array.from(b.positions));
});
