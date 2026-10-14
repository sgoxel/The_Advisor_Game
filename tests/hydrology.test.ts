import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  drainageRecipes,
  drainageCoarseSegments,
  drainageSegmentsInBounds,
  hydrologyTopology,
  naturalElevationAt,
  freshwaterAccessAt,
  freshwaterCrossingAt,
  FRESHWATER_ACCESS_RADIUS_M,
  freshwaterCrossingSpanMAt,
  hydrologyTelemetry,
  naturalSurfaceAt,
} from "../src/hydrology.ts";
import { MACRO_PLAN, macroSampleAt } from "../src/macro-geography.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_WIDTH, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { villages } from "../src/geography.ts";
import { RURAL_BRIDGE_MAX_LENGTH_M } from "../src/world.ts";

test("each continent has multiple independent bounded drainage recipes", () => {
  assert.ok(drainageRecipes.length >= MACRO_PLAN.continents.length * 3);
  for (let continentId = 0; continentId < MACRO_PLAN.continents.length; continentId++)
    assert.ok(
      drainageRecipes.filter((recipe) => recipe.continentId === continentId).length >= 3,
      `continent ${continentId} has too few drainage recipes`,
    );
});

test("main channels and tributaries descend monotonically into ocean or lake authority", () => {
  for (const recipe of drainageRecipes) {
    assert.ok(recipe.points.length >= 8, `${recipe.code} is too short`);
    for (const path of [recipe.points, recipe.tributary])
      for (let i = 1; i < path.length; i++)
        assert.ok(path[i].bed <= path[i - 1].bed + 1e-9, `${recipe.code} bed rises at ${i}`);

    const end = recipe.points.at(-1)!;
    const domain = macroSampleAt(sourceToLonLat(end.x, end.z)).domain;
    assert.equal(domain, recipe.outlet === "lake" ? "Lake" : "Ocean", `${recipe.code} has a false outlet`);
  }
});

test("natural freshwater is one shared non-walkable surface and legal rural crossings fit the cap", () => {
  for (const recipe of drainageRecipes) {
    const a = recipe.points[Math.max(1, Math.floor(recipe.points.length / 2) - 1)];
    const b = recipe.points[Math.floor(recipe.points.length / 2)];
    const x = wrapSourceX(a.x + wrapSourceX(b.x - a.x) * 0.5);
    const z = a.z + (b.z - a.z) * 0.5;
    const sample = naturalSurfaceAt(x, z);
    assert.equal(sample.water.kind, "river", `${recipe.code} midpoint is not freshwater`);
    assert.equal(sample.walkable, false);
    assert.equal(sample.material, "River");
    const spanM = freshwaterCrossingSpanMAt(x, z);
    assert.ok(spanM > 0 && spanM <= RURAL_BRIDGE_MAX_LENGTH_M, `${recipe.code} crossing exceeds rural bridge cap`);
  }
});

test("natural authority repeats exactly across source wrap and stays query-bounded", () => {
  const recipe = drainageRecipes[0];
  assert.ok(recipe);
  const point = recipe.points[Math.floor(recipe.points.length / 2)];
  const before = hydrologyTelemetry();
  for (let i = 0; i < 48; i++) {
    const x = point.x + i * 17;
    const z = point.z + i * 11;
    const a = naturalSurfaceAt(x, z);
    const b = naturalSurfaceAt(x + SOURCE_PRESENTATION_WIDTH, z);
    assert.equal(a.material, b.material);
    assert.equal(a.water.kind, b.water.kind);
    assert.ok(Math.abs(a.groundHeight - b.groundHeight) < 1e-9);
    assert.equal(a.walkable, b.walkable);
  }
  const after = hydrologyTelemetry();
  const checks = after.segmentChecks - before.segmentChecks;
  assert.ok(checks < 48 * 2 * 160, `spatial query examined too many segments: ${checks}`);
});

test("natural terrain/hydrology source uses no runtime random or wall-clock authority", () => {
  const source = readFileSync(new URL("../src/hydrology.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/);
});


test("freshwater predates settlements and reaches a strict majority of village cores",()=>{
  const near=villages.filter(v=>freshwaterAccessAt(v.canonicalPosition).distanceM<=FRESHWATER_ACCESS_RADIUS_M);
  assert.ok(near.length>villages.length/2,`${near.length}/${villages.length} within ${FRESHWATER_ACCESS_RADIUS_M}m`);
  for(const v of villages){const s=naturalSurfaceAt(v.x,v.z);assert.equal(s.water.kind,'none',v.code);assert.ok(s.walkable,v.code);}
});

test("fine main and tributary samples remain downhill until their existing water outlet",()=>{
  for(const recipe of drainageRecipes)for(const path of [recipe.points,recipe.tributary]){
    let prior=Infinity,finished=false;
    for(let i=1;i<path.length;i++)for(let j=1;j<=16;j++){
      const a=path[i-1],b=path[i],t=j/16,x=wrapSourceX(a.x+wrapSourceX(b.x-a.x)*t),z=a.z+(b.z-a.z)*t,s=naturalSurfaceAt(x,z);
      if(s.water.kind==='lake'||s.water.kind==='ocean'){finished=true;continue;}
      assert.equal(finished,false,`${recipe.code} exits its outlet`);
      assert.equal(s.water.kind,'river',`${recipe.code} has a dry discontinuity`);
      assert.ok(s.groundHeight<=prior+1e-6,`${recipe.code} fine bed rises`);prior=s.groundHeight;
    }
  }
});

test("crossing angle rejects parallel decks and measures physical oblique span",()=>{
  const segment=drainageCoarseSegments.find(s=>{
    const dx=wrapSourceX(s.bx-s.ax),dz=s.bz-s.az,len=Math.hypot(dx,dz),x=wrapSourceX(s.ax+dx*.5),z=(s.az+s.bz)*.5;
    if(s.width>2.5||len<80||Math.cos(sourceToLonLat(x,z).lat)<.3)return false;
    return drainageSegmentsInBounds(x-128,z-128,256).every(other=>{
      if(other.code===s.code)return true;
      const vx=wrapSourceX(other.bx-other.ax),vz=other.bz-other.az,qx=wrapSourceX(x-other.ax),qz=z-other.az,t=Math.max(0,Math.min(1,(qx*vx+qz*vz)/(vx*vx+vz*vz||1)));
      return Math.hypot(qx-vx*t,qz-vz*t)>20;
    });
  });
  assert.ok(segment,'a real isolated narrow reach is required');
  const dx=wrapSourceX(segment.bx-segment.ax),dz=segment.bz-segment.az,x=wrapSourceX(segment.ax+dx*.5),z=(segment.az+segment.bz)*.5,c=Math.cos(sourceToLonLat(x,z).lat),
    perpendicular=freshwaterCrossingAt(x,z,-dz/c,dx*c),oblique=freshwaterCrossingAt(x,z,(-dz+dx*c)/c,dx*c+dz),
    expected=2*segment.width*CANONICAL_METRES_PER_SOURCE_UNIT*Math.hypot(dx,dz)/Math.hypot(dz/c,dx);
  assert.equal(freshwaterCrossingAt(x,z,dx,dz),null);
  assert.ok(perpendicular&&oblique);
  assert.ok(Math.abs(perpendicular.spanM-expected)<1e-5);
  assert.ok(Math.abs(oblique.spanM-expected*Math.SQRT2)<1e-5);
});

test('basin junction flow is acyclic and every node reaches an authoritative outlet',()=>{
  assert.ok(hydrologyTopology.junctions>0);
  assert.equal(hydrologyTopology.cyclicNodes,0);
  assert.equal(hydrologyTopology.unreachableOutlets,0);
});

test('interior channels and their immediate dry banks contain the water surface',()=>{
 for(const recipe of drainageRecipes)for(const [kind,path]of [['main',recipe.points],['tributary',recipe.tributary]]as const)
 for(let i=1;i<path.length;i++)for(let j=1;j<=8;j++){
  const a=path[i-1],b=path[i],dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,len=Math.hypot(dx,dz)||1,t=j/8,x=wrapSourceX(a.x+dx*t),z=a.z+dz*t,s=naturalSurfaceAt(x,z);
  if(s.water.kind!=='river')continue;
  assert.ok(s.water.level<=naturalElevationAt(x,z)+1e-6,`${recipe.code} floats above terrain`);
  const width=recipe.width*(kind==='main'?1:.62);
  for(const n of [-width-.1,width+.1]){const bank=naturalSurfaceAt(x-dz/len*n,z+dx/len*n);if(bank.water.kind==='none')assert.ok(bank.groundHeight+1e-6>=s.water.level,`${recipe.code} floats above bank`);}
 }
});

test("main-channel water remains incised below natural terrain support between stations", () => {
  let samples = 0;
  for (const recipe of drainageRecipes)
    for (let index = 1; index < recipe.points.length; index++) {
      const a = recipe.points[index - 1],
        b = recipe.points[index],
        dx = wrapSourceX(b.x - a.x),
        dz = b.z - a.z;
      for (let sampleIndex = 1; sampleIndex <= 16; sampleIndex++) {
        const t = sampleIndex / 16,
          x = wrapSourceX(a.x + dx * t),
          z = a.z + dz * t,
          macro = macroSampleAt(sourceToLonLat(x, z));
        if (!macro.land) continue;
        const sample = naturalSurfaceAt(x, z);
        assert.equal(sample.water.kind, "river", `${recipe.code} interior channel is dry`);
        const naturalSupport = naturalElevationAt(x, z);
        assert.ok(
          sample.water.level <= naturalSupport + 1e-6,
          `${recipe.code} water exceeds natural support by ${(sample.water.level - naturalSupport).toFixed(6)}m`,
        );
        samples++;
      }
    }
  assert.ok(samples > 1000, `expected broad containment coverage, got ${samples}`);
});