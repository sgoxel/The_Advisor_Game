"use strict";
const assert=require("assert");
const fs=require("fs");
const vm=require("vm");

global.window=globalThis;
global.document=undefined;
global.CustomEvent=function(){};
global.dispatchEvent=()=>{};
global.addEventListener=()=>{};
global.setInterval=()=>1;
let perf=0;global.performance={now:()=>{perf+=0.12;return perf;}};

function clone(v){return v==null? v:JSON.parse(JSON.stringify(v))}
function merge(base,patch){
  if(patch==null||typeof patch!=="object"||Array.isArray(patch))return clone(patch);
  const out=(base&&typeof base==="object"&&!Array.isArray(base))?clone(base):{};
  for(const [k,v] of Object.entries(patch))out[k]=(v&&typeof v==="object"&&!Array.isArray(v))?merge(out[k],v):clone(v);
  return out;
}
function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return (h>>>0).toString(16).toUpperCase().padStart(8,"0")}
const states=new Map();
function store(seed){if(!states.has(seed))states.set(seed,{sequence:0,entries:{}});return states.get(seed)}
global.WorldState={
  structuralRef:(seed,kind,parent,structuralKey,initial)=>({id:"STR|"+kind.toUpperCase()+"|"+hash([seed,kind,parent,structuralKey].join("|")),kind,key:{parentId:parent,structuralKey,initial:clone(initial)}}),
  resolve:(seed,ref)=>{
    const s=store(seed),e=s.entries[ref.id]||null;
    const base={id:ref.id,kind:ref.kind,parentId:ref.key.parentId,structuralKey:ref.key.structuralKey,initial:clone(ref.key.initial||{})};
    const current=merge(base,e?.changes||{});
    return {entityRef:ref,delta:e?clone(e):null,current,currentSignature:hash(JSON.stringify(current))};
  },
  applyDelta:(seed,ref,changes,reason)=>{
    const s=store(seed),prev=s.entries[ref.id];s.sequence++;
    const entry={entityId:ref.id,entityKind:ref.kind,revision:(prev?.revision||0)+1,sequence:s.sequence,reason:String(reason||""),changes:merge(prev?.changes||{},changes)};
    s.entries[ref.id]=entry;
    return {ok:true,entry:clone(entry),resolved:global.WorldState.resolve(seed,ref)};
  },
  serializeState:(seed)=>({schema:"CampaignStateDelta",seed,entries:clone(store(seed).entries),sequence:store(seed).sequence}),
  restoreSerializedState:(seed,serialized)=>{states.set(seed,{sequence:Number(serialized.sequence||0),entries:clone(serialized.entries||{})});return {ok:true}}
};
global.StartingVillage={plan:seed=>({name:"Oakmere",center:{x:"0",y:"0"},seed})};
global.HousePlans={build:()=>[
  {id:"H1",kind:"house",bounds:{minX:4,maxX:9,minY:7,maxY:11},entrance:{target:{x:3,y:9}}},
  {id:"H2",kind:"house",bounds:{minX:-9,maxX:-4,minY:6,maxY:10},entrance:{target:{x:-3,y:8}}},
  {id:"H3",kind:"cabin",bounds:{minX:8,maxX:12,minY:-11,maxY:-6},entrance:{target:{x:7,y:-8}}}
]};
global.SeedSystem={getCampaign:()=>null};
global.GameTime={getTimestampKey:()=>null};

vm.runInThisContext(fs.readFileSync("scripts/world/persistent-consequences.js","utf8"),{filename:"persistent-consequences.js"});

const seed="WP-S007-012-TEST",start="1201-03-02 09:00:00";
PersistentConsequences.proofReset(seed);

const deterministicA=PersistentConsequences.descriptor(seed,"damaged-building",start);
const deterministicB=PersistentConsequences.descriptor(seed,"damaged-building",start);
const alt=PersistentConsequences.descriptor(seed+"-ALT","damaged-building",start);
assert.deepStrictEqual(deterministicA,deterministicB,"same SEED consequence descriptor changed");
assert.notStrictEqual(deterministicA.id,alt.id,"alternate SEED reused stable consequence ID");

const applied=[
  PersistentConsequences.activate(seed,"damaged-building",start),
  PersistentConsequences.activate(seed,"road-blockage",start),
  PersistentConsequences.activate(seed,"abandoned-workplace",start)
];
assert(applied.every(x=>x.ok),"controlled consequence activation failed");
let snap=PersistentConsequences.snapshot(seed);
assert.strictEqual(snap.recordCount,3,"expected three persistent consequences");
assert.strictEqual(snap.activeCount,3,"all three consequences should initially be active");
assert.strictEqual(new Set(snap.records.map(x=>x.id)).size,3,"consequence IDs are not stable/unique");
assert(snap.records.every(x=>x.scheduleRoutingImpact===false&&x.scheduleRoutingValidated===false),"unvalidated schedule/routing authority leaked from consequence projection");
assert(PersistentConsequences.forBuilding(seed,"H1").some(x=>x.type==="damaged-building"),"building projection adapter did not resolve damage");
const road=PersistentConsequences.projection(seed).records.find(x=>x.type==="road-blockage");
assert(road&&PersistentConsequences.forRoad(seed,road.target.anchor.x,road.target.anchor.y).length===1,"road projection adapter failed");

const persisted=clone(WorldState.serializeState(seed));
assert(Object.keys(persisted.entries).length===1,"consequences should stay in one sparse local settlement delta");
const beforeSignature=snap.sourceCurrentSignature;
states.delete(seed);
WorldState.restoreSerializedState(seed,persisted);
snap=PersistentConsequences.snapshot(seed);
assert.strictEqual(snap.recordCount,3,"persistent consequence state did not restore");
assert.strictEqual(snap.sourceCurrentSignature,beforeSignature,"restored consequence projection signature drifted");

const advanced=PersistentConsequences.advance(seed,"1201-03-02 15:01:00");
assert.strictEqual(advanced.activeCount,0,"time-qualified consequences did not recover");
assert.strictEqual(advanced.recoveredCount,3,"recovered consequence count mismatch");
assert(advanced.records.every(x=>x.recovery?.recoveredAtTimestamp==="1201-03-02 15:01:00"),"recovery timestamp was not authoritative fantasy time");
assert(advanced.records.every(x=>x.presentationRevision===2),"recovery did not revise presentation state");

PersistentConsequences.proofReset(seed);
for(let i=0;i<12;i++){
  const hh=String(9+Math.floor(i/2)).padStart(2,"0"),mm=i%2?"30":"00";
  PersistentConsequences.activate(seed,Object.keys(PersistentConsequences.TYPES)[i%3],`1201-03-03 ${hh}:${mm}:00`);
}
snap=PersistentConsequences.snapshot(seed);
assert(snap.recordCount<=PersistentConsequences.MAX_LOCAL_RECORDS,"local consequence registry exceeded hard bound");
assert.strictEqual(snap.fullWorldScan,false);
assert.strictEqual(snap.fullSettlementPerFrameScan,false);
assert.strictEqual(snap.perFrameScan,false);
assert.strictEqual(snap.lazyLocal,true);
assert.strictEqual(snap.historyReplay,false);
assert(snap.maxResolveMs<50,"bounded local resolve exceeded 50 ms in deterministic proof");

const source=fs.readFileSync("scripts/world/persistent-consequences.js","utf8");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("styles/main.css","utf8");
assert(source.includes("WorldState.applyDelta"),"PersistentConsequences must persist through authoritative WorldState deltas");
assert(source.includes('window.addEventListener?.("advisor:world-state-delta-change"'),"projection does not react to lazy delta revisions");
assert(html.includes("scripts/world/persistent-consequences.js"),"production HTML missing PersistentConsequences");
assert(html.indexOf("scripts/world/persistent-consequences.js")<html.indexOf("scripts/world/planet-stage.js"),"consequence projection must load before PlanetStage");
assert(css.includes(".persistent-world-consequence"),"persistent consequence panel styles missing");

console.log(JSON.stringify({
  pass:true,wp:"WP-S007-012",classification:"MIXED",
  types:Object.keys(PersistentConsequences.TYPES),
  persistence:{sparseSettlementDeltaEntries:Object.keys(persisted.entries).length,restoredSignature:beforeSignature},
  recovery:{activeAfterAdvance:advanced.activeCount,recoveredAfterAdvance:advanced.recoveredCount},
  bounds:{maxLocalRecords:PersistentConsequences.MAX_LOCAL_RECORDS,maxVisibleRecords:PersistentConsequences.MAX_VISIBLE_RECORDS,maxRecoveryPerAdvance:PersistentConsequences.MAX_RECOVERY_PER_ADVANCE},
  architecture:{eventDriven:snap.eventDriven,perFrameScan:snap.perFrameScan,fullSettlementPerFrameScan:snap.fullSettlementPerFrameScan,fullWorldScan:snap.fullWorldScan,lazyLocal:snap.lazyLocal,historyReplay:snap.historyReplay}
},null,2));
