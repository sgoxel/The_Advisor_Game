import test from "node:test";
import assert from "node:assert/strict";
import { daylightAt } from "../src/daylight.ts";

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
