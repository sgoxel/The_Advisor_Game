"use strict";

const assert=require("assert");
const fs=require("fs");
const path=require("path");

global.window=global;
let perfClock=0;
global.performance={now:()=>{perfClock+=0.125;return perfClock;}};

function hash32(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
global.PRNG={liveAddressedUint32:(seed,timestamp,kind,entity,slot)=>hash32([seed,timestamp,kind,entity,slot].join("|"))};

require("../../scripts/world/simulation-budget.js");
require("../../scripts/core/event-scheduler.js");

const seed="WP-S007-010-STRESS";
const due="1200-06-15 12:00:08";
const events=Array.from({length:160},(_,i)=>({
  fantasyTimestamp:"1200-06-15 12:00:"+String(i%8).padStart(2,"0"),
  systemKind:["country","region","settlement","npc"][i%4],
  entityId:"ENTITY:"+String(i).padStart(3,"0"),
  slotKey:"slot:"+String(i%7),
  payload:{ordinal:i}
}));

function drain(mode){
  EventScheduler.reset(seed);
  WorldSimulationBudget.reset(seed);
  if(mode==="constrained"){
    for(let i=0;i<12;i++)WorldSimulationBudget.recordVisibleFrame(i<8?42:17,seed);
  }else{
    for(let i=0;i<12;i++)WorldSimulationBudget.recordVisibleFrame(16.5,seed);
  }
  EventScheduler.scheduleMany(seed,[...events].reverse());
  const rows=[],batchSizes=[];
  let guard=0;
  while(EventScheduler.snapshot(seed).pending){
    const batch=EventScheduler.processDue(seed,due,{
      maxEvents:32,
      priority:mode==="current"?"current":"background"
    });
    batchSizes.push(batch.processedCount);
    for(const item of batch.processed)rows.push(item.event.address+"|"+item.randomUint32);
    assert(batch.processedCount>0||!batch.hasMoreDue,"scheduler made no progress while due work remained");
    if(++guard>1000)throw new Error("bounded drain guard exceeded");
  }
  return {rows,batchSizes,snapshot:WorldSimulationBudget.snapshot(seed)};
}

const constrained=drain("constrained");
const current=drain("current");
assert.deepStrictEqual(constrained.rows,current.rows,"processing budget changed authoritative event order/outcome");
assert(Math.max(...constrained.batchSizes)<=8,"constrained background event slice exceeded 8");
assert(Math.max(...current.batchSizes)<=32,"current-authority event slice exceeded 32");

WorldSimulationBudget.reset(seed);
WorldSimulationBudget.recordTierSnapshot(seed,{
  counts:{global:8,regional:2,local:1,exact:1,exactNpcHandles:24,representedPopulation:52000},
  candidateCount:12,materializations:5,dematerializations:2,deferredPromotions:4,
  serializedBytes:16384,lastUpdateMs:2.4
});
WorldSimulationBudget.recordRevisionRefresh(seed,{country:3,region:7,settlement:11});
WorldSimulationBudget.recordPersistence(seed,{
  reads:12,writes:4,writeBehindDepth:7,dirtyRecords:9,checkpointWrites:1,
  cacheHits:40,cacheMisses:5,regenerations:2,cacheBytes:65536,evictions:3,quotaErrors:0,
  lastReadMs:1.2,lastWriteMs:2.8
});
for(let i=0;i<18;i++)WorldSimulationBudget.enqueueBackground(seed,{
  id:"BG:"+String(i).padStart(2,"0"),kind:i%2?"preload":"writeback",
  priority:i<4?"nearby":"distant",dueTimestamp:"1200-06-15 12:00:"+String(i%9).padStart(2,"0")
});
const backgroundOrder=[];
while(WorldSimulationBudget.snapshot(seed).background.pending){
  const run=WorldSimulationBudget.drainBackground(seed,item=>{backgroundOrder.push(item.id);return item.id;},{priority:"background"});
  assert(run.processedCount<=WorldSimulationBudget.BUDGETS.backgroundJobsPerSlice,"background slice cap exceeded");
}
const budget=WorldSimulationBudget.snapshot(seed);
const proof=WorldSimulationBudget.proof(seed+"-PROOF");

const root=path.resolve(__dirname,"../..");
const lazy=fs.readFileSync(path.join(root,"scripts/world/lazy-catchup.js"),"utf8");
const tiers=fs.readFileSync(path.join(root,"scripts/world/simulation-tiers.js"),"utf8");
const globalSim=fs.readFileSync(path.join(root,"scripts/world/global-country-simulation.js"),"utf8");
const regionalSim=fs.readFileSync(path.join(root,"scripts/world/regional-settlement-simulation.js"),"utf8");
const stage=fs.readFileSync(path.join(root,"scripts/world/planet-stage.js"),"utf8");

const checks={
  deterministicEventOutcome:constrained.rows.join("\n")===current.rows.join("\n"),
  schedulerBackpressure:Math.max(...constrained.batchSizes)<=8&&Math.max(...current.batchSizes)<=32,
  centralProof:proof.pass===true&&proof.finalOutcomeBudgetInvariant===true,
  tierBounds:budget.tiers.counts.exact<=1&&budget.tiers.counts.exactNpcHandles<=24&&budget.tiers.candidates<=12,
  tierTelemetry:budget.tiers.materializations===5&&budget.tiers.dematerializations===2&&budget.tiers.deferredPromotions===4,
  aggregateRefreshTelemetry:globalSim.includes("recordRevisionRefresh")&&regionalSim.includes("recordRevisionRefresh"),
  persistenceTelemetry:budget.persistence.writeBehindDepth===7&&budget.persistence.dirtyRecords===9&&budget.persistence.cacheBytes===65536,
  boundedBackground:backgroundOrder.length===18&&budget.background.pending===0&&budget.background.queueLimit===128,
  incrementalCatchup:lazy.includes('WorldSimulationBudget?.limit?.("catchUpBatches"')&&lazy.includes("setTimeout(resolve,0)")&&lazy.includes("while(batches<maxBatches)"),
  liveFrameCorrelation:stage.includes("WorldSimulationBudget?.recordVisibleFrame?.(ms,activeSeed)"),
  noFullWorldFrameScan:budget.fullWorldScan===false&&budget.perFrameWorldScan===false&&tiers.includes("candidateSettlements:12")
};
const passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length,score=Number((passed/total*10).toFixed(1));
for(const [name,ok] of Object.entries(checks))assert.strictEqual(ok,true,name+" failed");
assert(score>7,"runtime verification score must exceed 7/10");

console.log(JSON.stringify({
  pass:true,score,checks,
  eventBatches:{constrainedMax:Math.max(...constrained.batchSizes),currentMax:Math.max(...current.batchSizes),events:constrained.rows.length},
  tiers:budget.tiers,
  persistence:budget.persistence,
  queues:budget.queues,
  background:{processed:backgroundOrder.length,pending:budget.background.pending},
  authority:{telemetryAuthority:budget.telemetryAuthority,finalOutcomeBudgetInvariant:budget.finalOutcomeBudgetInvariant,fullWorldScan:budget.fullWorldScan,perFrameWorldScan:budget.perFrameWorldScan}
},null,2));
