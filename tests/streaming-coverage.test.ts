import assert from 'node:assert/strict';
import test from 'node:test';
import {coverageKey,nextStreamingJob,deferOptionalDetailForFirstResident,progressiveDetailKeys,visibleCoverageKeys} from '../src/streaming-coverage.ts';
import type {Tile} from '../src/world.ts';
const tile=(key:string)=>({key} as Tile), root=tile('root'), fine=[tile('a'),tile('b')], coarse=[tile('parent')];
test('root then current-view terrain precede fine decoration work',()=>{
  assert.equal(nextStreamingJob(root,fine,coarse,new Set())?.tile.key,'root');
  assert.deepEqual(nextStreamingJob(root,fine,coarse,new Set(['root'])),{tile:coarse[0],kind:'coverage'});
  assert.deepEqual(nextStreamingJob(root,fine,coarse,new Set(['root',coverageKey(coarse[0])])),{tile:fine[0],kind:'detail'});
});
test('warm complete detail needs no preview generation',()=>{
  assert.equal(nextStreamingJob(root,fine,coarse,new Set(['root','a','b'])),undefined);
});
test('selection reversal never dispatches the abandoned queue',()=>{
  const cached=new Set(['root',coverageKey(coarse[0])]);
  assert.equal(nextStreamingJob(root,[tile('new-view')],coarse,cached)?.tile.key,'new-view');
});
test('terrain readiness never clears still-visible detail while replacement LOD is incomplete',()=>{
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a']),['old'],false),['old']);
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a']),['old'],true),['old']);
});
test('ready current patches appear without waiting for a slow sibling',()=>{
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a']),[],true),['a']);
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a','b']),['a'],true),['a','b']);
});
test('preview cache identity never replaces full canonical detail',()=>{
  const cached=new Set(['root',coverageKey(coarse[0]),coverageKey(fine[0])]);
  assert.equal(nextStreamingJob(root,fine,coarse,cached)?.kind,'detail');
  assert.deepEqual(progressiveDetailKeys(['a','b'],cached,[],true),[]);
});
test('terrain background fits alongside both fading detail sets and the root',()=>{
  const keys=['p0','p1','p2'],cached=new Set(keys);
  assert.deepEqual(visibleCoverageKeys(keys,cached,87,89),['p0']);
  assert.deepEqual(visibleCoverageKeys(keys,cached,89,89),[]);
  assert.deepEqual(visibleCoverageKeys(keys,cached,44,89),keys);
});


test('refinement swaps all children of an old patch together; disjoint new areas arrive independently',()=>{
 const hit=(a:string,b:string)=>a===b || (a==='parent'&&['a','b'].includes(b)) || (b==='parent'&&['a','b'].includes(a));
 assert.deepEqual(progressiveDetailKeys(['a','b','new'],new Set(['a','new']),['parent'],true,hit),['parent','new']);
 assert.deepEqual(progressiveDetailKeys(['a','b','new'],new Set(['a','b','new']),['parent'],true,hit),['a','b','new']);
 assert.deepEqual(progressiveDetailKeys(['parent','new'],new Set(['parent']),['a','b'],true,hit),['parent']);
});

test('panning drops only old patches outside the new footprint; retained LOD stays bounded',()=>{
 const hit=(a:string,b:string)=>a===b || (a==='old'&&b==='a');
 assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['b']),['old','outside'],true,hit),['old','b']);
 assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['b']),['old'],true,hit,1),['old']);
});

test('cold resident CPU reservation defers only optional detail and always expires', () => {
 const detailed = { tile: fine[0], kind: 'detail' as const },
   preview = { tile: coarse[0], kind: 'coverage' as const };
 assert.equal(deferOptionalDetailForFirstResident(detailed, 2, true, 3000), true);
 assert.equal(deferOptionalDetailForFirstResident(preview, 2, true, 3000), false);
 assert.equal(deferOptionalDetailForFirstResident(detailed, 0, true, 3000), false);
 assert.equal(deferOptionalDetailForFirstResident(detailed, 2, false, 3000), false);
 assert.equal(deferOptionalDetailForFirstResident(detailed, 2, true, 45000), false);
 assert.equal(deferOptionalDetailForFirstResident(detailed, 2, true, null), false);
 assert.equal(deferOptionalDetailForFirstResident(detailed, 2, true, NaN), false);
 assert.equal(deferOptionalDetailForFirstResident(undefined, 2, true, 3000), false);
});
