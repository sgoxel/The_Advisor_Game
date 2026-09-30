"use strict";

const assert=require("assert");
const Surface=require("../ui/advisor-chat.js");

assert.equal(Surface.VERSION,"advisor-chat-surface-v1");
assert.equal(Surface.MAX_THREADS,8);
assert.equal(Surface.MAX_TEXT,480);

const activeEvaluation={
  decision:"accepted",
  decisionId:"PCD-A",
  executionId:"PCE-A",
  proposal:{proposalId:"PROP-A"},
  execution:{attempted:true,state:"active",actionExecuted:true,ok:true,authoritativeResult:{ok:true,status:"active"}}
};
assert.equal(Surface.authoritativeCompleted(activeEvaluation),false,"active execution must never be called completed");
assert.equal(Surface.statusFor({evaluation:activeEvaluation,reply:true}),"accepted");

const completedEvaluation={
  decision:"accepted",
  decisionId:"PCD-B",
  executionId:"PCE-B",
  proposal:{proposalId:"PROP-B"},
  execution:{attempted:true,state:"completed",actionExecuted:true,ok:true,authoritativeResult:{ok:true,id:"ACT-B",status:"completed"}}
};
assert.equal(Surface.authoritativeCompleted(completedEvaluation),true);
assert.equal(Surface.statusFor({evaluation:completedEvaluation,reply:true}),"completed");

const unexecutedRecord={
  routing:{mode:"local-library"},
  links:{proposalIds:["PROP-C"]},
  outcome:{state:"unexecuted",simulationResultId:null,authoritativeExecution:false}
};
assert.equal(Surface.recordCompleted(unexecutedRecord),false);
assert.equal(Surface.statusFor({record:unexecutedRecord,reply:true}),"considering");

const completedRecord={
  routing:{mode:"local-library"},
  links:{proposalIds:["PROP-D"],simulationResultIds:["PCE-D"]},
  outcome:{state:"completed",simulationResultId:"PCE-D",authoritativeResultId:"ACT-D",authoritativeExecution:true}
};
assert.equal(Surface.recordCompleted(completedRecord),true);
assert.equal(Surface.statusFor({record:completedRecord,reply:true}),"completed");

assert.equal(Surface.statusFor({routing:{mode:"clarification-needed"},reply:true}),"clarification");
assert.equal(Surface.statusFor({advice:{status:"rejected"},reply:true}),"rejected");
assert.equal(Surface.statusFor({advice:{status:"modified"},reply:true}),"modified");
assert.equal(Surface.statusFor({advice:{status:"deferred"},reply:true}),"deferred");
assert.equal(Surface.statusFor({advice:{status:"accepted"},reply:true}),"accepted");
assert.equal(Surface.statusFor({advice:{status:"delivered"},reply:true}),"proposal");

const evidence=Surface.evidenceThreads();
assert.equal(evidence.length,4);
assert.deepEqual(evidence.map(row=>row.status),["replied","clarification","rejected","completed"]);
assert.equal(evidence[3].record.outcome.authoritativeExecution,true);
assert.equal(evidence[3].record.outcome.state,"completed");
assert.ok(evidence[3].record.outcome.simulationResultId);
assert.ok(evidence[2].evaluation.decisionId);
assert.equal(evidence[2].evaluation.execution.actionExecuted,false);
assert.equal(evidence[1].routing.mode,"clarification-needed");

const snapshot=Surface.snapshot();
assert.equal(snapshot.eventDriven,true);
assert.equal(snapshot.perFrameRerender,false);
assert.equal(snapshot.fullWorldScan,false);
assert.equal(snapshot.directWorldMutation,false);
assert.equal(snapshot.simulationAuthority,false);

console.log(JSON.stringify({
  pass:true,
  wp:"WP-S008-007",
  version:Surface.VERSION,
  evidenceStatuses:evidence.map(row=>row.status),
  completedBackedBySimulation:Boolean(evidence[3].record.outcome.authoritativeExecution&&evidence[3].record.outcome.simulationResultId),
  activeExecutionSuppressed:Surface.authoritativeCompleted(activeEvaluation)===false,
  eventDriven:snapshot.eventDriven,
  perFrameRerender:snapshot.perFrameRerender,
  fullWorldScan:snapshot.fullWorldScan,
  directWorldMutation:snapshot.directWorldMutation,
  simulationAuthority:snapshot.simulationAuthority
},null,2));
