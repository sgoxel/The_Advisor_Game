import {closeLightingWeight} from "../src/street-lighting.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {daylightAt, daylightAtLongitude, advanceDaylight} from "../src/daylight.ts";

test("local evening darkens the whole surface while retaining ambient visibility",()=>{
 const noon=daylightAt(12*3600),dusk=daylightAt(20.5*3600),night=daylightAt(23*3600);
 assert.deepEqual(noon.terrainTint,[1,1,1]);
 for(const light of [dusk,night]){
  assert.ok(light.terrainTint.every(channel=>channel<.65));
  assert.ok(light.ambient.every(channel=>channel>=.23));
  assert.ok(light.sunIntensity<noon.sunIntensity);
 }
});

test("daylight wraps at midnight and changes smoothly throughout the local day",()=>{
 assert.deepEqual(daylightAt(0),daylightAt(86400));
 for(let second=0;second<86400;second+=60){
  const a=daylightAt(second),b=daylightAt(second+1);
  assert.ok(a.terrainTint.every((v,i)=>Math.abs(v-b.terrainTint[i])<.002));
  assert.ok(a.ambient.every((v,i)=>Math.abs(v-b.ambient[i])<.002));
 }
});


const angleDistance=(a:number,b:number)=>Math.abs(((b-a+180)%360+360)%360-180);
test("sun/moon direction has no dawn, dusk or midnight jump",()=>{
 for(let second=0;second<86400;second++) assert.ok(angleDistance(daylightAt(second).sunYaw,daylightAt(second+1).sunYaw)<.1,`yaw jump at ${second}`);
});
test("rendered local conditions blend across every time zone and longitude wrap",()=>{
 for(const tick of [0,18000,50000]) for(let zone=0;zone<=14;zone++){
  const lon=-Math.PI+zone*2*Math.PI/14,a=daylightAtLongitude(tick,lon-1e-8),b=daylightAtLongitude(tick,lon+1e-8);
  assert.ok(a.terrainTint.every((v,i)=>Math.abs(v-b.terrainTint[i])<1e-6));
  assert.ok(angleDistance(a.sunYaw,b.sunYaw)<1e-4);
 }
});
test("frame easing is bounded, reversible, frame-rate independent and safe after a long pause",()=>{
 const day=daylightAt(43200),night=daylightAt(0),step=advanceDaylight(day,night,1/60);
 assert.ok(step.terrainTint[0]<day.terrainTint[0]&&step.terrainTint[0]>night.terrainTint[0]);
 const paused=advanceDaylight(day,night,120);assert.ok(Math.abs(paused.terrainTint[0]-day.terrainTint[0])<.06);
 let a=day,b=day;for(let i=0;i<120;i++)a=advanceDaylight(a,night,1/60);for(let i=0;i<60;i++)b=advanceDaylight(b,night,1/30);
 assert.ok(a.terrainTint.every((v,i)=>Math.abs(v-b.terrainTint[i])<1e-10));
 assert.ok(advanceDaylight(a,day,1/60).terrainTint[0]>a.terrainTint[0]);
 assert.deepEqual(advanceDaylight(undefined,night,1/60),night);
});

test("lamp glow fades continuously to zero before leaving the 1/1 stop",()=>{
 assert.equal(closeLightingWeight(.2),1);assert.equal(closeLightingWeight(1),1);assert.equal(closeLightingWeight(Math.SQRT2),0);
 let last=1;for(let i=1;i<=100;i++){const weight=closeLightingWeight(1+(Math.SQRT2-1)*i/100);assert.ok(weight<=last&&last-weight<.02);last=weight;}
});
