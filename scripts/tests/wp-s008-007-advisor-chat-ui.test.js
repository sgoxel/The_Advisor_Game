"use strict";

const assert=require("assert");

delete global.AdvisorConversationUI;
delete global.ConversationTransactions;
require("../world/conversation-transactions.js");
const Ledger=global.ConversationTransactions;
const UI=require("../ui/advisor-conversation-ui.js");

assert.strictEqual(UI.VERSION,"advisor-chat-ui-v1");
assert.deepStrictEqual(UI.EVIDENCE_MODES,["ordinary","ambiguous","rejected","completed"]);

const proof=UI.proof();
assert.strictEqual(proof.pass,true);
assert.strictEqual(proof.deterministicEvidence,true);
assert.strictEqual(proof.eventDriven,true);
assert.strictEqual(proof.perFrameConversationRender,false);
assert.strictEqual(proof.fullWorldScan,false);
assert.strictEqual(proof.directWorldMutation,false);
assert.strictEqual(proof.directExecution,false);
assert.strictEqual(proof.modes.ordinary.some(row=>row.key==="local"),true);
assert.strictEqual(proof.modes.ordinary.some(row=>row.key==="considering"),true);
assert.strictEqual(proof.modes.ambiguous.some(row=>row.key==="clarification"),true);
assert.strictEqual(proof.modes.rejected.some(row=>row.key==="rejected"),true);
assert.strictEqual(proof.modes.rejected.some(row=>row.key==="deferred"),true);
assert.strictEqual(proof.modes.completed.some(row=>row.key==="completed"),true);

const falseCompletion={
  routing:{mode:"local-library"},
  presentation:{decisionState:"accepted",replyText:"Accepted.",replyCharacterId:"protagonist",replyCharacterName:"Protagonist"},
  links:{proposalIds:["P1"],decisionIds:["D1"],simulationResultIds:["PCE-1"]},
  outcome:{state:"unexecuted",simulationResultId:null,authoritativeExecution:false}
};
assert.strictEqual(UI.completedBacked(falseCompletion),false);
assert.strictEqual(UI.statusFor(falseCompletion).key,"accepted","accepted decision must not be shown as completed");

const activeClaim={
  ...falseCompletion,
  outcome:{state:"unexecuted",simulationResultId:"PCE-ACTIVE",authoritativeExecution:false}
};
assert.notStrictEqual(UI.statusFor(activeClaim).key,"completed","active/unexecuted Simulation state must not be labeled completed");

const completed=UI.evidenceRecords("completed")[0];
assert.strictEqual(UI.completedBacked(completed),true);
assert.strictEqual(UI.statusFor(completed).key,"completed");
const completedView=UI.viewRecord(completed);
assert.strictEqual(completedView.authoritativeCompletion,true);
assert.strictEqual(completedView.simulationResultIds[0],"PCE-EVID-DONE");

const normalized=Ledger.normalizeRecord("WP-S008-007-SEED",{
  fantasyTimestamp:"1201-09-30 12:10:00",
  message:{messageId:"M-TRACE",role:"player",text:"Consider the gate."},
  routing:{
    mode:"local-library",
    selectedIntentId:"advisor.interaction.request",
    intentCandidates:[{intentId:"advisor.interaction.request"}],
    sourceMetadata:{responseSource:"sentence-library"},
    reply:"I will consider it.",
    character:{id:"protagonist",name:"Protagonist"}
  },
  proposalId:"P-TRACE",
  presentation:{
    replyText:"I will consider it.",
    replyCharacterId:"protagonist",
    replyCharacterName:"Protagonist",
    decisionState:"considering",
    responseSource:"sentence-library",
    traceAvailable:true
  }
});
assert.strictEqual(normalized.presentation.replyText,"I will consider it.");
assert.strictEqual(normalized.presentation.decisionState,"considering");
assert.strictEqual(normalized.presentation.providerPayloadPersisted,false);
assert.deepStrictEqual(normalized.routing.recognizedIntentIds,["advisor.interaction.request"]);
assert.strictEqual(normalized.outcome.state,"unexecuted");
assert.strictEqual(normalized.authority.fullWorldScan,false);
assert.strictEqual(normalized.authority.wholeCampaignScan,false);

let appendCalls=0;
let appended=null;
global.SeedSystem={
  getCampaign(){return {seed:"WP-S008-007-LIVE",protagonistId:"protagonist"}},
  getSettings(){return {seed:"WP-S008-007-LIVE"}}
};
global.GameTime={getTimestampKey(){return "1201-09-30 12:12:00"}};
global.LocalConversationRouter={
  route(text,context){
    assert.strictEqual(text,"How are things?");
    assert.strictEqual(context.seed,"WP-S008-007-LIVE");
    assert.strictEqual(context.protagonistId,"protagonist");
    assert.strictEqual(context.externalAiEnabled,false);
    return Object.freeze({
      mode:"local-library",
      reply:"Protagonist: The village is calm.",
      selectedIntentId:"advisor.status.question",
      intentCandidates:Object.freeze([{intentId:"advisor.status.question"}]),
      character:Object.freeze({id:"protagonist",name:"Protagonist"}),
      sourceMetadata:Object.freeze({responseSource:"sentence-library"})
    });
  }
};
global.ConversationTransactions={
  appendExchange(seed,message,routing,extra){
    appendCalls++;
    appended={seed,message,routing,extra};
    return {ok:true,record:{id:"CTX-LIVE"}};
  }
};
global.ProtagonistCommandEvaluator={evaluate(){throw new Error("UI must not evaluate/execute protagonist commands")}};
global.ActionExecutor={execute(){throw new Error("UI must not execute actions")}};

const live=UI.recordMessage("How are things?");
assert.strictEqual(live.ok,true);
assert.strictEqual(live.stored,true);
assert.strictEqual(live.worldMutation,false);
assert.strictEqual(live.actionExecuted,false);
assert.strictEqual(live.evaluatorCalled,false);
assert.strictEqual(appendCalls,1);
assert.strictEqual(appended.seed,"WP-S008-007-LIVE");
assert.strictEqual(appended.message.role,"player");
assert.strictEqual(appended.routing.mode,"local-library");
assert.strictEqual(appended.extra.fantasyTimestamp,"1201-09-30 12:12:00");

let counselCalls=0;
global.AdvisorChannel={
  recordAdvice(seed,config,protagonistId){
    counselCalls++;
    assert.strictEqual(seed,"WP-S008-007-LIVE");
    assert.strictEqual(protagonistId,"protagonist");
    assert.strictEqual(config.topic,"Check the mill ledger.");
    return {id:"ADV-EVID"};
  }
};
const counsel=UI.deliverCounsel("Check the mill ledger.","Mill");
assert.strictEqual(counsel.ok,true);
assert.strictEqual(counsel.proposalOnly,true);
assert.strictEqual(counsel.worldMutation,false);
assert.strictEqual(counsel.actionExecuted,false);
assert.strictEqual(counselCalls,1);

const snapshot=UI.snapshot();
assert.strictEqual(snapshot.authority.eventDriven,true);
assert.strictEqual(snapshot.authority.perFrameConversationRender,false);
assert.strictEqual(snapshot.authority.fullWorldScan,false);
assert.strictEqual(snapshot.authority.directWorldMutation,false);
assert.strictEqual(snapshot.authority.directExecution,false);
assert.strictEqual(snapshot.authority.protagonistDecisionBypass,false);
assert.strictEqual(snapshot.authority.simulationCompletionGate,true);
assert.strictEqual(snapshot.authority.providerPayloadRendered,false);
assert.strictEqual(snapshot.limits.maxTranscriptRecords,12);
assert.strictEqual(snapshot.limits.maxCounselRows,4);

console.log(JSON.stringify({
  wp:"WP-S008-007",
  pass:true,
  visualClass:"MIXED",
  statuses:{
    ordinary:proof.modes.ordinary.map(row=>row.key),
    ambiguous:proof.modes.ambiguous.map(row=>row.key),
    decision:proof.modes.rejected.map(row=>row.key),
    completed:proof.modes.completed.map(row=>row.key)
  },
  completionGate:{
    falseClaim:UI.statusFor(falseCompletion).key,
    activeClaim:UI.statusFor(activeClaim).key,
    authoritative:UI.statusFor(completed).key
  },
  bounded:{
    maxTranscriptRecords:snapshot.limits.maxTranscriptRecords,
    maxCounselRows:snapshot.limits.maxCounselRows,
    fullWorldScan:snapshot.authority.fullWorldScan,
    perFrameConversationRender:snapshot.authority.perFrameConversationRender
  },
  authority:{
    directWorldMutation:live.worldMutation,
    directExecution:live.actionExecuted,
    protagonistDecisionBypass:snapshot.authority.protagonistDecisionBypass,
    evaluatorCalled:live.evaluatorCalled
  }
},null,2));
