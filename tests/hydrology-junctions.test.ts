import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDrainageJunctions}from'../src/hydrology-junctions.ts';
import type{DrainageRecipe}from'../src/hydrology.ts';
const recipe=(code:string,points:{x:number;z:number;bed:number}[]):DrainageRecipe=>({code,continentId:0,width:1,points,tributary:[],outlet:'ocean'});
const inputs=[recipe('SEED/B',[{x:0,z:-100,bed:30},{x:0,z:100,bed:0}]),recipe('SEED/A',[{x:-100,z:0,bed:40},{x:100,z:0,bed:0}])];
test('crossing channels share one contained downhill junction and acyclic outlet flow',()=>{
 const result=reconcileDrainageJunctions(inputs);
 for(const r of result.recipes){const join=r.points.find(p=>p.x===0&&p.z===0);assert.ok(join);assert.equal(join.bed,15);for(let i=1;i<r.points.length;i++)assert.ok(r.points[i].bed<=r.points[i-1].bed);}
 assert.equal(result.summary.cyclicNodes,0);assert.equal(result.summary.unreachableOutlets,0);
});
test('junction recipes and flow reconstruct independently of input iteration order',()=>{
 const a=reconcileDrainageJunctions(inputs),b=reconcileDrainageJunctions([...inputs].reverse()),sorted=(r:readonly DrainageRecipe[])=>[...r].sort((a,b)=>a.code.localeCompare(b.code));
 assert.deepEqual(sorted(a.recipes),sorted(b.recipes));assert.deepEqual([...a.flowDirection].sort(),[...b.flowDirection].sort());
});
