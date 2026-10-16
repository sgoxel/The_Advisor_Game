import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageMeasurements} from '../tools/report-zoom-coverage.mjs';

const sample=(ms,wanted,active,coverage)=>({ms,performance:{wantedCanonicalKeys:wanted,
  activeCanonicalKeys:active,withinBudget:true,generationReady:1,
  cpuResourceBytesEstimated:100,gpuResourceBytesEstimated:100},coverage,settled:false});
const record=trace=>({backend:'test',profile:'test',coldMs:20,errors:[],phases:[{
  name:'zoom-out',trace,state:{performance:{wantedCanonicalKeys:['destination']}}}]});

test('an old settled frame cannot pass destination latency',()=>{
  const old={...sample(1,['old'],['old']),settled:true};
  const destination={...sample(50,['destination'],['destination']),settled:true};
  const [result]=coverageMeasurements(record([old,destination]));
  assert.equal(result.firstCoherentMs,50);
  assert.equal(result.settledMs,50);
});

test('cached readiness without real render-layer coverage is rejected',()=>{
  const coverage={complete:true,canonicalKeys:['parent'],visibleCanonicalKeys:['parent'],
    layerDebug:{valid:false,culled:0}};
  const falseReady=sample(1,['destination'],[],coverage);
  assert.equal(coverageMeasurements(record([falseReady]))[0].firstCoherentMs,null);
  const drawn=sample(300,['destination'],[],{...coverage,layerDebug:{valid:true,culled:1}});
  assert.equal(coverageMeasurements(record([falseReady,drawn]))[0].firstCoherentMs,300);
  const missingParent=sample(200,['destination'],[],{...drawn.coverage,visibleCanonicalKeys:[]});
  assert.equal(coverageMeasurements(record([missingParent]))[0].firstCoherentMs,null);
});
