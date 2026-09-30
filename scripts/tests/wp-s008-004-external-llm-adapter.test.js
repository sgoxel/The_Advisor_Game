"use strict";
const assert=require("assert");
const CommandSet=require("../world/command-set-interface.js");
globalThis.CommandSetInterface=CommandSet;
const Adapter=require("../world/external-llm-adapter.js");

function activity(residentId,x,objectId){
  return Object.freeze({
    residentId,state:"work",intendedAction:"work",label:"Working",
    target:Object.freeze({x:String(x),y:"0"}),
    buildingId:"BLD-"+residentId,targetSource:"interior-interaction",
    interactionObjectId:objectId,interactionObjectType:"counter"
  });
}
const sources=Object.freeze({
  getResidentRoster(){return Object.freeze([Object.freeze({id:"R01",name:"Mira"})]);},
  getDailyActivities(){return Object.freeze([activity("R01",100,"OBJ-A")]);},
  queryDestinations(){return Object.freeze({
    results:Object.freeze([
      Object.freeze({id:"P1",name:"Alder Village",type:"village",category:"settlements",distanceMeters:400,center:{x:"200",y:"0"},countryId:"C1",worldAuthority:true,authority:"WorldDestinations"})
    ]),
    diagnostics:Object.freeze({bounded:true,fullWorldScan:false})
  });},
  getCountry(){return Object.freeze({id:"C1",name:"Cedar Realm"});},
  getRoadGraph(){return Object.freeze({countryId:"C1",nodes:Object.freeze([Object.freeze({id:"P1"})]),edges:Object.freeze([]),diagnostics:Object.freeze({bounded:true,fullWorldScan:false})});},
  getKnownLeads(){return Object.freeze([]);}
});
const snapshot=CommandSet.buildSnapshot({
  seed:"AGENT6-LLM-ADAPTER",when:"1126-09-30 11:12:03",origin:{x:"0",y:"0"}
},sources);
const base={
  message:"Please consider going to Alder Village.",
  snapshot,
  context:Object.freeze({
    seed:"AGENT6-LLM-ADAPTER",
    character:Object.freeze({id:"protagonist",name:"Edrin"}),
    facts:Object.freeze([
      Object.freeze({id:"F1",subject:"Alder Village",text:"Alder Village is the current nearby settlement.",source:"WorldDestinations",grounded:true})
    ]),
    viewport:{width:390,height:844},device:"phone",camera:{zoom:99}
  }),
  commandSet:CommandSet
};

let simulationTouched=false;
Object.defineProperty(globalThis,"Simulation",{
  configurable:true,
  get(){simulationTouched=true;throw new Error("ExternalLlmAdapter touched Simulation");}
});

(async()=>{
  let capturedRequest=null;
  const textProvider=Adapter.createFakeProvider(request=>{
    capturedRequest=request;
    return {text:"I can discuss that request, but I have not executed anything.",proposals:[]};
  });
  const textOnly=await Adapter.invoke({...base,provider:textProvider});
  assert.strictEqual(textOnly.status,"ok");
  assert.strictEqual(textOnly.validatedProposals.length,0);
  assert.strictEqual(textOnly.executionAttempted,false);
  assert.strictEqual(textOnly.worldMutation,false);
  assert.strictEqual(textOnly.untrustedText,true);
  assert.ok(capturedRequest.commandSet.snapshotId===snapshot.snapshotId);
  assert.ok(capturedRequest.commandSet.commands.length===5);
  assert.ok(capturedRequest.commandSet.targets.places.some(x=>x.id==="P1"));
  assert.strictEqual(capturedRequest.rules.executionAuthority,false);
  assert.ok(!JSON.stringify(capturedRequest).includes("apiKey"));

  const validProvider=Adapter.createFakeProvider({
    text:"I can propose that destination for consideration.",
    proposals:[{proposalId:"LP1",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}}]
  });
  const valid=await Adapter.invoke({...base,provider:validProvider});
  assert.strictEqual(valid.status,"ok");
  assert.strictEqual(valid.validatedProposals.length,1);
  assert.strictEqual(valid.validatedProposals[0].commandId,"advisor.propose_travel");
  assert.strictEqual(valid.validatedProposals[0].validatedParameters.destinationId,"P1");
  assert.strictEqual(valid.validatedProposals[0].executionAttempted,false);
  assert.strictEqual(valid.validatedProposals[0].worldMutation,false);
  assert.strictEqual(valid.validatedProposals[0].source,"external-llm");

  const unknown=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    text:"No execution.",proposals:[{proposalId:"BAD1",commandId:"advisor.execute_javascript",parameters:{code:"globalThis.hacked=true"}}]
  })});
  assert.strictEqual(unknown.status,"proposal-rejected");
  assert.strictEqual(unknown.validatedProposals.length,0);
  assert.strictEqual(unknown.proposalRejections[0].reason,"unknown-command");

  const invalidTarget=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    text:"No execution.",proposals:[{proposalId:"BAD2",commandId:"advisor.propose_travel",parameters:{destinationId:"P999"}}]
  })});
  assert.strictEqual(invalidTarget.status,"proposal-rejected");
  assert.strictEqual(invalidTarget.proposalRejections[0].reason,"target-unavailable");

  const extraProposalField=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    proposals:[{proposalId:"BAD3",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"},teleport:true}]
  })});
  assert.strictEqual(extraProposalField.status,"proposal-rejected");
  assert.strictEqual(extraProposalField.proposalRejections[0].reason,"unexpected-proposal-field");

  const extraParameter=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    proposals:[{proposalId:"BAD4",commandId:"advisor.propose_travel",parameters:{destinationId:"P1",teleport:true}}]
  })});
  assert.strictEqual(extraParameter.status,"proposal-rejected");
  assert.strictEqual(extraParameter.proposalRejections[0].reason,"unexpected-parameter");

  const unsafeSnapshot=Object.freeze({
    ...snapshot,
    diagnostics:Object.freeze({...snapshot.diagnostics,bounded:false,fullWorldScan:true})
  });
  let unsafeCalls=0;
  const unsafe=await Adapter.invoke({
    ...base,
    snapshot:unsafeSnapshot,
    provider:Object.freeze({isAvailable:true,async generate(){unsafeCalls++;return {text:"must not run"};}})
  });
  assert.strictEqual(unsafe.status,"rejected");
  assert.strictEqual(unsafe.reason,"unbounded-command-snapshot");
  assert.strictEqual(unsafeCalls,0);
  assert.strictEqual(unsafe.fallbackRequired,true);

  const falseSuccessText=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    text:"I have already teleported and completed the task.",proposals:[]
  })});
  assert.strictEqual(falseSuccessText.status,"ok");
  assert.strictEqual(falseSuccessText.untrustedText,true);
  assert.strictEqual(falseSuccessText.executionAttempted,false);
  assert.strictEqual(falseSuccessText.worldMutation,false);

  const malformed=await Adapter.invoke({...base,provider:Object.freeze({
    isAvailable:true,async generate(){return "{not-json";}
  })});
  assert.strictEqual(malformed.status,"invalid-response");
  assert.strictEqual(malformed.reason,"malformed-json");
  assert.strictEqual(malformed.fallbackRequired,true);

  const extraRoot=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    text:"hello",proposals:[],toolCall:{name:"runCode"}
  })});
  assert.strictEqual(extraRoot.status,"invalid-response");
  assert.strictEqual(extraRoot.reason,"unexpected-response-field");

  const oversized=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
    text:"x".repeat(Adapter.LIMITS.maxTextLength+1),proposals:[]
  })});
  assert.strictEqual(oversized.status,"invalid-response");
  assert.ok(["text-too-long","response-too-large"].includes(oversized.reason));

  let disabledCalls=0;
  const disabledProvider=Object.freeze({isAvailable:true,async generate(){disabledCalls++;return {text:"should not run"};}});
  const disabled=await Adapter.invoke({...base,provider:disabledProvider,enabled:false});
  assert.strictEqual(disabled.status,"disabled");
  assert.strictEqual(disabled.reason,"provider-disabled");
  assert.strictEqual(disabled.providerUsed,false);
  assert.strictEqual(disabledCalls,0);
  assert.strictEqual(disabled.fallbackRequired,true);

  const unavailable=await Adapter.invoke({...base,provider:Adapter.createFakeProvider({text:"unused"},{available:false})});
  assert.strictEqual(unavailable.status,"unavailable");
  assert.strictEqual(unavailable.reason,"provider-unavailable");
  assert.strictEqual(unavailable.providerUsed,false);
  assert.strictEqual(unavailable.fallbackRequired,true);

  const secret="TOP-SECRET-API-KEY-DO-NOT-LEAK";
  const errorProvider=Object.freeze({
    apiKey:secret,isAvailable:true,
    async generate(request){
      assert.ok(!JSON.stringify(request).includes(secret));
      throw new Error("failure mentioning "+secret);
    }
  });
  const providerError=await Adapter.invoke({...base,provider:errorProvider});
  assert.strictEqual(providerError.status,"provider-error");
  assert.strictEqual(providerError.reason,"provider-call-failed");
  assert.ok(!JSON.stringify(providerError).includes(secret));
  assert.strictEqual(providerError.persisted,false);
  assert.strictEqual(providerError.providerSecretsRead,false);

  const replayProvider=Adapter.createFakeProvider({
    text:"Stable response.",proposals:[{proposalId:"LP2",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}}]
  });
  const baseline=Adapter.serializeResult(await Adapter.invoke({...base,provider:replayProvider}));
  for(let i=0;i<40;i++){
    assert.strictEqual(Adapter.serializeResult(await Adapter.invoke({...base,provider:Adapter.createFakeProvider({
      text:"Stable response.",proposals:[{proposalId:"LP2",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}}]
    })})),baseline);
  }
  const presentationVariant=Adapter.serializeResult(await Adapter.invoke({
    ...base,
    context:{...base.context,viewport:{width:1920,height:1080},device:"desktop",camera:{zoom:.2},fps:9},
    provider:Adapter.createFakeProvider({
      text:"Stable response.",proposals:[{proposalId:"LP2",commandId:"advisor.propose_travel",parameters:{destinationId:"P1"}}]
    })
  }));
  assert.strictEqual(presentationVariant,baseline);

  assert.strictEqual(simulationTouched,false);
  delete globalThis.Simulation;

  for(const result of [textOnly,valid,unknown,invalidTarget,extraProposalField,extraParameter,unsafe,falseSuccessText,malformed,extraRoot,oversized,disabled,unavailable,providerError]){
    assert.strictEqual(result.worldMutation,false);
    assert.strictEqual(result.executionAttempted,false);
    assert.strictEqual(result.simulationAuthority,false);
    assert.strictEqual(result.persisted,false);
  }

  const evidence={
    wp:"WP-S008-004",
    classification:"FUNCTIONAL",
    visual:"N/A — provider adapter/validation boundary introduces no rendered surface",
    pass:true,
    adapterVersion:Adapter.ADAPTER_VERSION,
    requestVersion:Adapter.REQUEST_VERSION,
    snapshotId:snapshot.snapshotId,
    cases:{
      textOnly:textOnly.status,
      validProposal:{status:valid.status,commandId:valid.validatedProposals[0].commandId,target:valid.validatedProposals[0].validatedParameters.destinationId},
      unknownCommand:unknown.proposalRejections[0].reason,
      invalidTarget:invalidTarget.proposalRejections[0].reason,
      unexpectedProposalField:extraProposalField.proposalRejections[0].reason,
      unexpectedParameter:extraParameter.proposalRejections[0].reason,
      unboundedSnapshot:unsafe.reason,
      falseSuccessTextUntrusted:falseSuccessText.untrustedText,
      malformed:malformed.reason,
      providerDisabled:disabled.reason,
      providerUnavailable:unavailable.reason,
      providerError:providerError.reason
    },
    deterministicReplay:true,
    presentationIndependent:true,
    simulationTouched,
    worldMutation:false,
    executionAttempted:false,
    persisted:false,
    providerSecretsRead:false,
    limits:Adapter.LIMITS
  };
  console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
