import assert from 'node:assert/strict';
import test from 'node:test';
import {coverageKey,nextStreamingJob,progressiveDetailKeys,visibleCoverageKeys} from '../src/streaming-coverage.ts';
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
test('retain previous detail until every background terrain patch is ready',()=>{
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a']),['old'],false),['old']);
  assert.deepEqual(progressiveDetailKeys(['a','b'],new Set(['a']),['old'],true),[]);
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
