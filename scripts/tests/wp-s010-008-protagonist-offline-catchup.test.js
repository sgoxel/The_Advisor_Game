const assert=require("assert");
const fs=require("fs");
const path=require("path");

global.window=global;
global.TextEncoder=global.TextEncoder||require("util").TextEncoder;
const repoRoot=path.resolve(__dirname,"../..");
const CatchUp=require(path.join(repoRoot,"scripts/world/protagonist-offline-catchup.js"));

function clone(v){return v==null||typeof v!=="object"?v:Array.isArray(v)?v.map(clone):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]))}
function addTime(ts,seconds){const [d,t]=ts.split(" "),[y,m,day]=d.split("-").map(Number),[h,mi,s]=t.split(":").map(Number),x=new Date(Date.UTC(y,m-1,day,h,mi,s)+seconds*1000),p=n=>String(n).padStart(2,"0");return String(x.getUTCFullYear()).padStart(4,"0")+"-"+p(x.getUTCMonth()+1)+"-"+p(x.getUTCDate())+" "+p(x.getUTCHours())+":"+p(x.getUTCMinutes())+":"+p(x.getUTCSeconds())}
function worldStub(){const store=new Map();return {structuralRef(seed,kind,actor,key){return{id:[seed,kind,actor,key].join("|")}},resolve(seed,ref){const current=store.get(ref.id);return current?{current:clone(current),delta:{revision:current.__revision||0}}:null},applyDelta(seed,ref,patch){const previous=store.get(ref.id)||{},revision=Number(previous.__revision||0)+1,current={...clone(previous),...clone(patch),__revision:revision};store.set(ref.id,current);return{ok:true,reason:"ok",entry:{revision}}},_store:store}}
function systems(start){
  const needsState={exists:false,last:start},healthState={exists:false,last:start,ops:new Set()},journeyState={active:{journeyId:"JRN-OFFLINE",status:"travelling",updatedFantasyTimestamp:start},history:[],remaining:18*3600};
  const needs={snapshot(){return needsState.exists?{compatible:true,exists:true,lastFantasyTimestamp:needsState.last}:{compatible:true,exists:false}},initialize(seed,id,when){needsState.exists=true;needsState.last=when;return{ok:true}},advance(seed,id,target){const changed=needsState.last!==target;needsState.last=target;return{ok:true,advancedSeconds:changed?1:0}}};
  const health={snapshot(){return healthState.exists?{compatible:true,exists:true,lastFantasyTimestamp:healthState.last}:{compatible:true,exists:false}},initialize(seed,id,when){healthState.exists=true;healthState.last=when;return{ok:true}},advance(seed,id,target,opt){assert.equal(opt.authority,"simulation");assert.equal(opt.authoritative,true);if(healthState.ops.has(opt.operationId))return{ok:true,duplicate:true,advancedSeconds:0};healthState.ops.add(opt.operationId);const changed=healthState.last!==target;healthState.last=target;return{ok:true,advancedSeconds:changed?1:0}}};
  const journey={snapshot(){return clone(journeyState)},advance(seed,opt){if(!journeyState.active)return{ok:false,reason:"no-active-journey"};const from=journeyState.active.updatedFantasyTimestamp,delta=Math.min(CatchUp.MAX_SEGMENT_SECONDS,journeyState.remaining),next=addTime(from,delta);journeyState.remaining-=delta;journeyState.active.updatedFantasyTimestamp=next;if(journeyState.remaining<=0){const row={...journeyState.active,status:"arrived",updatedFantasyTimestamp:next};journeyState.history.push(row);journeyState.active=null;return{ok:true,arrived:true,journey:row,processedSeconds:delta}}return{ok:true,arrived:false,journey:clone(journeyState.active),processedSeconds:delta}}};
  return {profile:{derive(){return{protagonistId:"PROTAGONIST-OFFLINE"}}},needs,health,journey,goals:{snapshot(){return{records:[{id:"GOAL-OFFLINE",status:"active"}]}}},actionRuntime:{snapshot(){return{pending:[{seed:"AGENT6-OFFLINE",attemptId:"PAX-OFFLINE"}],results:[]}}},state:{needsState,healthState,journeyState}};
}
async function scenario(){
  const seed="AGENT6-OFFLINE",start="1201-09-01 00:00:00",target=addTime(start,30*86400),world=worldStub(),sys=systems(start),svc=CatchUp.createService({worldState:world,...sys});
  const input={authority:CatchUp.RESUME_AUTHORITY,authoritative:true,startFantasyTimestamp:start,targetFantasyTimestamp:target,maxSegments:2,maxSlices:128};
  const begin=svc.begin(seed,input);assert(begin.ok&&!begin.complete);
  const firstSlice=svc.resumeSlice(seed,{maxSegments:2});assert(firstSlice.ok&&!firstSlice.complete);assert.equal(firstSlice.segmentsProcessed,2);
  const mid=svc.snapshot(seed);assert(mid.active);assert.equal(mid.active.sliceCount,1);
  const reloaded=CatchUp.createService({worldState:world,...sys});
  const final=await reloaded.resumeAuthoritativeInterval(seed,input);assert(final.ok&&final.complete,JSON.stringify(final));
  const snap=reloaded.snapshot(seed);assert(!snap.active);assert.equal(snap.lastAuthoritativeFantasyTimestamp,target);assert.equal(snap.lastSummary.references.actionAttemptIds[0],"PAX-OFFLINE");assert.equal(snap.lastSummary.references.goalIds[0],"GOAL-OFFLINE");assert.equal(snap.lastSummary.detailedUnseenEventsFabricated,false);assert.equal(snap.fullWorldScan,false);assert.equal(snap.perFrameScan,false);assert.equal(snap.perSecondReplay,false);assert.equal(snap.wallClockAuthority,false);assert(snap.lastSummary.segmentCount<=120);
  const duplicate=await reloaded.resumeAuthoritativeInterval(seed,input);assert(duplicate.ok&&duplicate.complete&&duplicate.duplicate);
  return {summary:snap.lastSummary,bounds:snap.bounds,healthOps:sys.state.healthState.ops.size};
}
(async()=>{
  assert.equal(CatchUp.VERSION,"protagonist-offline-catchup-v1");
  const a=await scenario(),b=await scenario();
  assert.deepStrictEqual(a.summary,b.summary,"same Campaign SEED + fantasy interval must replay identically");
  const zeroWorld=worldStub(),zeroSys=systems("1201-09-01 00:00:00"),zero=CatchUp.createService({worldState:zeroWorld,...zeroSys}),t="1201-09-01 00:00:00";
  const noOp=await zero.resumeAuthoritativeInterval("AGENT6-OFFLINE",{authority:CatchUp.RESUME_AUTHORITY,authoritative:true,startFantasyTimestamp:t,targetFantasyTimestamp:t});assert(noOp.ok&&noOp.complete);assert.equal(noOp.reason,"zero-elapsed-no-op");
  const rewind=zero.begin("AGENT6-OFFLINE",{authority:CatchUp.RESUME_AUTHORITY,authoritative:true,startFantasyTimestamp:addTime(t,3600),targetFantasyTimestamp:t});assert(!rewind.ok);assert.equal(rewind.reason,"cannot-rewind-offline-catchup");
  const wall=zero.begin("AGENT6-OFFLINE",{authority:CatchUp.RESUME_AUTHORITY,authoritative:true,startFantasyTimestamp:t,targetFantasyTimestamp:addTime(t,3600),realElapsedMs:1000});assert(!wall.ok);assert.equal(wall.reason,"wall-clock-input-forbidden");
  const html=fs.readFileSync(path.join(repoRoot,"index.html"),"utf8"),lazy=fs.readFileSync(path.join(repoRoot,"scripts/world/lazy-catchup.js"),"utf8");
  const script="scripts/world/protagonist-offline-catchup.js?v=protagonist-offline-catchup-v1";
  assert(html.includes(script),"canonical root must load ProtagonistOfflineCatchUp");
  assert(html.indexOf(script)>html.indexOf("scripts/world/protagonist-goal-progress.js?v=protagonist-goal-progress-v1"),"offline catch-up must load after Stage 10 state foundations");
  assert(lazy.includes("ProtagonistOfflineCatchUp")&&lazy.includes("resumeAuthoritativeInterval"),"world resume gate must invoke protagonist catch-up");
  console.log(JSON.stringify({wp:"WP-S010-008",status:"PASS",visual:"N/A",evidence:{longAbsenceDays:30,boundedMultiSlice:true,saveReloadMidCatchUp:true,deterministicReplay:true,zeroElapsedNoOp:true,rewindRejected:true,wallClockInputRejected:true,segmentCount:a.summary.segmentCount,sliceCount:a.summary.sliceCount,healthOperations:a.healthOps,references:a.summary.references,unsupportedAuthorities:a.summary.unsupportedAuthorities,bounds:a.bounds,fullWorldScan:false,perFrameScan:false,perSecondReplay:false,detailedUnseenEventsFabricated:false}}));
})().catch(error=>{console.error(error);process.exit(1)});
