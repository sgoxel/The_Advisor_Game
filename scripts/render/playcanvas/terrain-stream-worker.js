"use strict";

self.window=self;
importScripts(
  "../../data/world-standards.js",
  "../../world/coordinates.js",
  "../../core/prng.js",
  "../../world/geography.js"
);

const pending=[];
const cancelled=new Set();
let running=false;

function postFailure(id,error){
  self.postMessage({type:"error",id,error:String(error?.message||error||"terrain-worker-error")});
}

function schedule(){
  if(running||!pending.length)return;
  running=true;
  const job=pending.shift();
  step(job);
}

function step(job){
  if(cancelled.has(job.id)){
    cancelled.delete(job.id);
    running=false;
    self.postMessage({type:"cancelled",id:job.id});
    schedule();
    return;
  }
  const started=performance.now();
  let processed=0;
  try{
    while(job.cursor<job.cells.length&&processed<24){
      const cell=job.cells[job.cursor++];
      const type=GeographyFoundation.getTerrainType(job.seed,cell.x,cell.y);
      job.results.push({index:cell.index,x:cell.x,y:cell.y,type:String(type||"grass")});
      processed++;
      if(processed>=1&&performance.now()-started>=6)break;
    }
  }catch(error){
    running=false;
    postFailure(job.id,error);
    schedule();
    return;
  }
  if(job.cursor>=job.cells.length){
    running=false;
    self.postMessage({
      type:"complete",
      id:job.id,
      results:job.results,
      cells:job.results.length,
      workerMs:Number((performance.now()-job.startedAt).toFixed(3))
    });
    schedule();
    return;
  }
  running=false;
  pending.push(job);
  setTimeout(schedule,0);
}

self.onmessage=event=>{
  const message=event?.data||{};
  if(message.type==="cancel"){
    cancelled.add(String(message.id||""));
    return;
  }
  if(message.type!=="prepare")return;
  const id=String(message.id||"");
  const cells=Array.isArray(message.cells)?message.cells:[];
  if(!id||!cells.length){
    postFailure(id,"invalid-terrain-worker-job");
    return;
  }
  pending.unshift({
    id,
    seed:String(message.seed||""),
    cells:cells.map(cell=>({
      index:Number(cell.index),
      x:String(cell.x),
      y:String(cell.y)
    })),
    cursor:0,
    results:[],
    startedAt:performance.now()
  });
  schedule();
};
