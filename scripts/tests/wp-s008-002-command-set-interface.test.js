"use strict";
const assert=require("assert");
const CommandSet=require("../world/command-set-interface.js");

const sourceCalls={roster:0,activities:0,destinations:0,country:0,graph:0,leads:0};
const roster=Object.freeze([
  Object.freeze({id:"R01",name:"Mira"}),
  Object.freeze({id:"R02",name:"Tomas"}),
  Object.freeze({id:"R03",name:"Iven"}),
  Object.freeze({id:"R04",name:"Sera"})
]);
function activity(residentId,x,objectId,label){
  return Object.freeze({
    residentId,state:"work",intendedAction:"work",label,
    target:Object.freeze({x:String(x),y:"0"}),
    buildingId:"BLD-"+residentId,
    targetSource:"interior-interaction",
    interactionObjectId:objectId,
    interactionObjectType:"counter"
  });
}
const placeRows={
  A:[
    Object.freeze({id:"P1",name:"Alder Village",type:"village",category:"settlements",distanceMeters:400,center:{x:"200",y:"0"},countryId:"C1",regionId:"RG1",authority:"WorldDestinations",worldAuthority:true}),
    Object.freeze({id:"P2",name:"Stone Town",type:"town",category:"cities",distanceMeters:1200,center:{x:"600",y:"0"},countryId:"C1",regionId:"RG1",authority:"WorldDestinations",worldAuthority:true}),
    Object.freeze({id:"RUMOR-ONLY",name:"Unverified Hollow",type:"lead",category:"nature",distanceMeters:700,center:{x:"350",y:"0"},authority:"Rumor",worldAuthority:false})
  ],
  B:[
    Object.freeze({id:"P2",name:"Stone Town",type:"town",category:"cities",distanceMeters:900,center:{x:"10450",y:"0"},countryId:"C1",regionId:"RG1",authority:"WorldDestinations",worldAuthority:true}),
    Object.freeze({id:"P3",name:"Northwatch",type:"city",category:"cities",distanceMeters:1800,center:{x:"10900",y:"0"},countryId:"C1",regionId:"RG2",authority:"WorldDestinations",worldAuthority:true})
  ]
};
const graph=Object.freeze({
  countryId:"C1",
  nodes:Object.freeze([
    Object.freeze({id:"P1"}),Object.freeze({id:"P2"}),Object.freeze({id:"P3"})
  ]),
  edges:Object.freeze([
    Object.freeze({id:"E12",aId:"P1",bId:"P2",roadClass:"primary",distanceMeters:1700,authority:"WorldRoadGraph"}),
    Object.freeze({id:"E23",aId:"P2",bId:"P3",roadClass:"primary",distanceMeters:2400,authority:"WorldRoadGraph"})
  ]),
  diagnostics:Object.freeze({bounded:true,fullWorldScan:false})
});
const sources=Object.freeze({
  getResidentRoster(context){sourceCalls.roster++;return roster;},
  getDailyActivities(context){
    sourceCalls.activities++;
    return String(context.origin.x)==="0"
      ?Object.freeze([
        activity("R01",100,"OBJ-A","Smithing"),
        activity("R02",400,"OBJ-T","Trading"),
        activity("R03",1000,"OBJ-I","Farming"),
        activity("R04",5000,"OBJ-S","Guarding")
      ])
      :Object.freeze([
        activity("R01",10100,"OBJ-B","Smithing"),
        activity("R02",12000,"OBJ-T2","Trading"),
        activity("R03",15000,"OBJ-I2","Farming"),
        activity("R04",10300,"OBJ-S2","Guarding")
      ]);
  },
  queryDestinations(context){
    sourceCalls.destinations++;
    return Object.freeze({
      results:Object.freeze(String(context.origin.x)==="0"?placeRows.A:placeRows.B),
      diagnostics:Object.freeze({bounded:true,fullWorldScan:false})
    });
  },
  getCountry(){sourceCalls.country++;return Object.freeze({id:"C1",name:"Cedar Realm"});},
  getRoadGraph(){sourceCalls.graph++;return graph;},
  getKnownLeads(){sourceCalls.leads++;return Object.freeze([{id:"P2",leadId:"LEAD-P2",worldAuthority:false}]);}
});

const base={
  seed:"AGENT6-COMMAND-SET",
  when:"1126-09-30 10:40:00",
  origin:{x:"0",y:"0"},
  personRadiusMeters:1600,
  placeRadiusMeters:40000
};
const a=CommandSet.buildSnapshot(base,sources);
const aRepeat=CommandSet.buildSnapshot({...base,device:"phone",camera:{zoom:99},viewport:{width:390,height:844},fps:12},sources);
assert.strictEqual(CommandSet.serializeSnapshot(a),CommandSet.serializeSnapshot(aRepeat),"presentation/device fields must not affect snapshot");

assert.strictEqual(a.interfaceVersion,"advisor-command-set-v1");
assert.strictEqual(a.contextVersion,"advisor-command-context-v1");
assert.strictEqual(a.commands.length,5);
assert.deepStrictEqual(a.targetIds.person,["R01","R02"]);
assert.deepStrictEqual(a.targetIds.place,["P1","P2"]);
assert.deepStrictEqual(a.targetIds.route,["E12"]);
assert.deepStrictEqual(a.targetIds.interaction,["OBJ-A","OBJ-T"]);
assert.strictEqual(a.targets.places.find(x=>x.id==="P2").knownByRumorLead,true);
assert.strictEqual(a.targets.places.some(x=>x.id==="RUMOR-ONLY"),false,"non-authoritative rumor-only place must be excluded");
assert.strictEqual(a.capabilities.arbitraryJavaScript,false);
assert.strictEqual(a.capabilities.rawObjectMutation,false);
assert.strictEqual(a.capabilities.fileAccess,false);
assert.strictEqual(a.capabilities.networkAccess,false);
assert.strictEqual(a.capabilities.directWorldMutation,false);
assert.strictEqual(a.capabilities.executionAuthority,false);
assert.strictEqual(a.diagnostics.fullWorldScan,false);
assert.strictEqual(a.diagnostics.bounded,true);
assert.strictEqual(a.diagnostics.renderStateAuthority,false);
assert.strictEqual(a.diagnostics.worldMutation,false);

const b=CommandSet.buildSnapshot({...base,origin:{x:"10000",y:"0"}},sources);
assert.deepStrictEqual(b.targetIds.person,["R01","R04"]);
assert.deepStrictEqual(b.targetIds.place,["P2","P3"]);
assert.deepStrictEqual(b.targetIds.route,["E23"]);
assert.deepStrictEqual(b.targetIds.interaction,["OBJ-B","OBJ-S2"]);
assert.strictEqual(b.targets.places.find(x=>x.id==="P2").name,a.targets.places.find(x=>x.id==="P2").name,"shared authoritative target identity changed");
assert.deepStrictEqual(b.commands,a.commands,"command schemas changed with context");

const validInfo=CommandSet.validateProposal(a,{
  commandId:"advisor.query_information",
  parameters:{topic:"market work",targetId:"P1"},
  proposalId:"Q1",source:"sentence-library"
});
assert.strictEqual(validInfo.ok,true);
assert.strictEqual(validInfo.executionAttempted,false);
assert.strictEqual(validInfo.worldMutation,false);

const validSchedule=CommandSet.validateProposal(a,{
  commandId:"advisor.query_schedule",
  parameters:{personId:"R01"}
});
assert.strictEqual(validSchedule.ok,true);

const validAdvice=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_advice",
  parameters:{topic:"ford safety",message:"Avoid the flooded crossing tonight."}
});
assert.strictEqual(validAdvice.ok,true);

const validTravel=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_travel",
  parameters:{destinationId:"P2",routeId:"E12"}
});
assert.strictEqual(validTravel.ok,true);

const validInteraction=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_interaction",
  parameters:{personId:"R01",interactionTargetId:"OBJ-A",topic:"work"}
});
assert.strictEqual(validInteraction.ok,true);

const stalePerson=CommandSet.validateProposal(b,{
  commandId:"advisor.propose_interaction",
  parameters:{personId:"R02",topic:"work"}
});
assert.strictEqual(stalePerson.ok,false);
assert.strictEqual(stalePerson.reason,"target-unavailable");

const stalePlace=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_travel",
  parameters:{destinationId:"P3"}
});
assert.strictEqual(stalePlace.ok,false);
assert.strictEqual(stalePlace.reason,"target-unavailable");

const unknown=CommandSet.validateProposal(a,{
  commandId:"advisor.execute_javascript",
  parameters:{code:"globalThis.compromised=true"}
});
assert.strictEqual(unknown.ok,false);
assert.strictEqual(unknown.reason,"unknown-command");

const extraParam=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_travel",
  parameters:{destinationId:"P2",teleport:true}
});
assert.strictEqual(extraParam.ok,false);
assert.strictEqual(extraParam.reason,"unexpected-parameter");

const mismatchedInteraction=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_interaction",
  parameters:{personId:"R02",interactionTargetId:"OBJ-A"}
});
assert.strictEqual(mismatchedInteraction.ok,false);
assert.strictEqual(mismatchedInteraction.reason,"interaction-target-not-associated-with-person");

const badRoute=CommandSet.validateProposal(a,{
  commandId:"advisor.propose_travel",
  parameters:{destinationId:"P1",routeId:"E23"}
});
assert.strictEqual(badRoute.ok,false);
assert.strictEqual(badRoute.reason,"target-unavailable");

let simulationTouched=false;
Object.defineProperty(globalThis,"Simulation",{
  configurable:true,
  get(){simulationTouched=true;throw new Error("CommandSetInterface touched Simulation");}
});
CommandSet.buildSnapshot(base,sources);
delete globalThis.Simulation;
assert.strictEqual(simulationTouched,false);

for(const schema of CommandSet.getCommandSchemas()){
  assert.strictEqual(schema.executionAuthority,false);
  assert.strictEqual(schema.simulationMutation,false);
  assert.ok(schema.validationContract.includes("fail-closed"));
}
assert.ok(a.diagnostics.residentRowsRead<=12);
assert.ok(a.diagnostics.activityRowsRead<=12);
assert.ok(a.diagnostics.destinationRowsRead<=12);
assert.ok(a.diagnostics.roadNodeRowsRead<=40);
assert.ok(a.diagnostics.roadEdgeRowsRead<=64);
assert.ok(a.targets.people.length<=CommandSet.LIMITS.maxPeople);
assert.ok(a.targets.places.length<=CommandSet.LIMITS.maxPlaces);
assert.ok(a.targets.routes.length<=CommandSet.LIMITS.maxRoutes);
assert.ok(a.targets.interactions.length<=CommandSet.LIMITS.maxInteractionTargets);

const result={
  wp:"WP-S008-002",
  classification:"FUNCTIONAL",
  pass:true,
  interfaceVersion:a.interfaceVersion,
  snapshotA:a.snapshotId,
  snapshotB:b.snapshotId,
  commandIds:a.commands.map(x=>x.id),
  contextA:a.targetIds,
  contextB:b.targetIds,
  validation:{
    allowed:[validInfo.status,validSchedule.status,validAdvice.status,validTravel.status,validInteraction.status],
    stalePerson:stalePerson.reason,
    stalePlace:stalePlace.reason,
    unknownCommand:unknown.reason,
    unexpectedParameter:extraParam.reason,
    mismatchedInteraction:mismatchedInteraction.reason
  },
  deterministicAcrossPresentation:true,
  sharedAuthorityStable:true,
  boundedDiagnostics:a.diagnostics,
  simulationTouched,
  sourceCalls,
  visual:"N/A — functional command-schema/context filtering layer with no new rendered surface"
};
console.log(JSON.stringify(result,null,2));
