(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.CommandSetInterface=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const INTERFACE_VERSION="advisor-command-set-v1";
const CONTEXT_VERSION="advisor-command-context-v1";
const TILE_METERS=2;
const LIMITS=Object.freeze({
  maxPeople:12,
  maxPlaces:12,
  maxRoutes:24,
  maxInteractionTargets:12,
  personRadiusMeters:1600,
  placeRadiusMeters:40000
});
const ROOT_KEYS=Object.freeze(["commandId","parameters","proposalId","source"]);

function deepFreeze(value){
  if(!value||typeof value!=="object"||Object.isFrozen(value))return value;
  Object.freeze(value);
  Object.keys(value).forEach(key=>deepFreeze(value[key]));
  return value;
}
function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    const result={};
    Object.keys(value).sort().forEach(key=>{
      if(value[key]!==undefined)result[key]=canonicalize(value[key]);
    });
    return result;
  }
  return value;
}
function stableStringify(value){return JSON.stringify(canonicalize(value));}
function hashText(value){
  let hash=2166136261>>>0;
  for(const ch of String(value==null?"":value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function normalizeText(value,max=160){
  return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);
}
function normalizePoint(value){
  if(!value||value.x==null||value.y==null)return Object.freeze({x:"0",y:"0"});
  return Object.freeze({x:String(value.x),y:String(value.y)});
}
function coordinateDelta(a,b){
  try{return Number(BigInt(String(a))-BigInt(String(b)));}catch(_){return Number(a)-Number(b);}
}
function distanceMeters(a,b){
  const dx=coordinateDelta(a.x,b.x)*TILE_METERS,dy=coordinateDelta(a.y,b.y)*TILE_METERS;
  return Math.hypot(dx,dy);
}
function normalizeWhen(value){
  if(value==null)return null;
  if(typeof value==="string")return value.trim()||null;
  if(typeof value==="object"){
    const pad=n=>String(Math.max(0,Math.floor(Number(n)||0))).padStart(2,"0");
    if(Number.isFinite(Number(value.year))&&Number.isFinite(Number(value.month))&&Number.isFinite(Number(value.day))){
      return String(Math.floor(Number(value.year))).padStart(4,"0")+"-"+pad(value.month)+"-"+pad(value.day)+" "+pad(value.hour)+":"+pad(value.minute)+":"+pad(value.second);
    }
  }
  return String(value);
}
function param(name,type,required,options){
  return Object.freeze({name,type,required:Boolean(required),...(options||{})});
}
function schema(id,purpose,operationClass,intentIds,parameters,targetKinds,preconditions){
  return Object.freeze({
    id,purpose,operationClass,
    intentIds:Object.freeze(intentIds.slice()),
    actorTypes:Object.freeze(["protagonist"]),
    targetKinds:Object.freeze(targetKinds.slice()),
    parameters:Object.freeze(parameters.slice()),
    preconditions:Object.freeze(preconditions.slice()),
    validationContract:"fail-closed against current authoritative snapshot",
    resultShape:Object.freeze({
      ok:"boolean",status:"validated|rejected",reason:"stable string",
      commandId:"stable command id",snapshotId:"context snapshot id",
      validatedParameters:"sanitized proposal parameters"
    }),
    executionAuthority:false,
    simulationMutation:false
  });
}

const COMMANDS=Object.freeze([
  schema(
    "advisor.query_information",
    "Ask for currently grounded information without changing world state.",
    "query",
    ["advisor.info.request","advisor.info.location","advisor.status.question","advisor.inventory.question"],
    [
      param("topic","string",true,{maxLength:160}),
      param("targetId","target",false,{targetKinds:Object.freeze(["person","place"])})
    ],
    ["person","place"],
    ["target must be present in the current snapshot when targetId is supplied"]
  ),
  schema(
    "advisor.query_schedule",
    "Ask about the current authoritative schedule context for a known person.",
    "query",
    ["advisor.schedule.question"],
    [param("personId","target",true,{targetKinds:Object.freeze(["person"])})],
    ["person"],
    ["person must be currently available in the bounded person context"]
  ),
  schema(
    "advisor.propose_advice",
    "Record an Advisor suggestion for later character evaluation; this interface does not execute it.",
    "advice-proposal",
    ["advisor.warning","advisor.reminder"],
    [
      param("topic","string",true,{maxLength:160}),
      param("message","string",false,{maxLength:320})
    ],
    [],
    ["proposal remains non-binding until a separate character/Simulation evaluator acts"]
  ),
  schema(
    "advisor.propose_travel",
    "Propose travel to a currently valid authoritative destination.",
    "travel-proposal",
    ["advisor.travel.suggest"],
    [
      param("destinationId","target",true,{targetKinds:Object.freeze(["place"])}),
      param("routeId","target",false,{targetKinds:Object.freeze(["route"])})
    ],
    ["place","route"],
    ["destination must exist in the current place set","route, when supplied, must connect the destination"]
  ),
  schema(
    "advisor.propose_interaction",
    "Propose a local interaction with a currently available authoritative person/interaction target.",
    "interaction-proposal",
    ["advisor.interaction.request"],
    [
      param("personId","target",true,{targetKinds:Object.freeze(["person"])}),
      param("interactionTargetId","target",false,{targetKinds:Object.freeze(["interaction"])}),
      param("topic","string",false,{maxLength:160})
    ],
    ["person","interaction"],
    ["person must be current","interaction target, when supplied, must be associated with that person"]
  )
]);

const COMMAND_BY_ID=Object.freeze(Object.fromEntries(COMMANDS.map(item=>[item.id,item])));

function sourceDefaults(){
  const scope=root||globalThis;
  return Object.freeze({
    getResidentRoster(context){
      return scope.ResidentRoster?.build?.(context.seed,context.when)||[];
    },
    getDailyActivities(context){
      return scope.DailyActivity?.current?.(context.seed,context.when)
        ||scope.DailyActivity?.scheduleView?.(context.seed,context.when)
        ||[];
    },
    queryDestinations(context){
      return scope.WorldDestinations?.queryNearby?.(context.seed,context.origin,{
        radiusMeters:context.placeRadiusMeters,
        maxResults:context.maxPlaces
      })||Object.freeze({results:Object.freeze([]),diagnostics:Object.freeze({bounded:true,fullWorldScan:false})});
    },
    getCountry(context){
      if(context.country)return context.country;
      return scope.PoliticalGeography?.ownerAt?.(context.seed,context.origin.x,context.origin.y)||null;
    },
    getRoadGraph(context,country){
      if(!country)return null;
      return scope.WorldRoadGraph?.graphForCountry?.(context.seed,country,{radius:2,focus:context.origin})||null;
    },
    getKnownLeads(context){
      return scope.LocalRumors?.navigatorLeads?.(context.seed)||[];
    }
  });
}
function readSource(sources,name,...args){
  const fn=sources&&typeof sources[name]==="function"?sources[name]:null;
  if(!fn)return null;
  return fn(...args);
}
function contextConfig(configValue){
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const seed=normalizeText(config.seed||root?.SeedSystem?.getCampaign?.()?.seed||"",120);
  const when=normalizeWhen(config.when||root?.GameTime?.getTimestampKey?.()||root?.GameTime?.getNow?.());
  const origin=normalizePoint(config.origin||config.position||{x:"0",y:"0"});
  return Object.freeze({
    seed,
    when,
    origin,
    country:config.country||null,
    maxPeople:Math.max(1,Math.min(LIMITS.maxPeople,Math.floor(Number(config.maxPeople)||LIMITS.maxPeople))),
    maxPlaces:Math.max(1,Math.min(LIMITS.maxPlaces,Math.floor(Number(config.maxPlaces)||LIMITS.maxPlaces))),
    maxRoutes:Math.max(1,Math.min(LIMITS.maxRoutes,Math.floor(Number(config.maxRoutes)||LIMITS.maxRoutes))),
    maxInteractionTargets:Math.max(1,Math.min(LIMITS.maxInteractionTargets,Math.floor(Number(config.maxInteractionTargets)||LIMITS.maxInteractionTargets))),
    personRadiusMeters:Math.max(50,Math.min(5000,Number(config.personRadiusMeters)||LIMITS.personRadiusMeters)),
    placeRadiusMeters:Math.max(250,Math.min(80000,Number(config.placeRadiusMeters)||LIMITS.placeRadiusMeters))
  });
}
function activityByResident(activities){
  const map=new Map();
  for(const activity of Array.isArray(activities)?activities:[]){
    const id=String(activity?.residentId||activity?.actorId||"").trim();
    if(id&&!map.has(id))map.set(id,activity);
  }
  return map;
}
function personTargets(context,roster,activities){
  const byResident=activityByResident(activities),out=[];
  for(const resident of (Array.isArray(roster)?roster:[]).slice(0,LIMITS.maxPeople)){
    const id=String(resident?.id||"").trim();
    const activity=byResident.get(id);
    if(!id||!activity?.target)continue;
    const position=normalizePoint(activity.target);
    const distance=distanceMeters(context.origin,position);
    if(!Number.isFinite(distance)||distance>context.personRadiusMeters)continue;
    out.push(Object.freeze({
      id,kind:"person",name:normalizeText(resident.displayName||resident.name||id,120),
      distanceMeters:Number(distance.toFixed(2)),
      position,
      currentActivity:Object.freeze({
        state:normalizeText(activity.state||activity.kind||"",80),
        action:normalizeText(activity.intendedAction||activity.action||"",80),
        label:normalizeText(activity.label||"",120),
        buildingId:normalizeText(activity.buildingId||"",120)||null,
        interactionObjectId:normalizeText(activity.interactionObjectId||"",160)||null,
        interactionObjectType:normalizeText(activity.interactionObjectType||"",80)||null,
        targetSource:normalizeText(activity.targetSource||"",80)||null
      }),
      authority:"ResidentRoster + DailyActivity",
      worldAuthority:true
    }));
  }
  out.sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id));
  return Object.freeze(out.slice(0,context.maxPeople));
}
function placeTargets(context,destinationQuery,knownLeads){
  const leadIds=new Set((Array.isArray(knownLeads)?knownLeads:[]).map(item=>String(item?.id||"")).filter(Boolean));
  const out=[];
  for(const place of (Array.isArray(destinationQuery?.results)?destinationQuery.results:[]).slice(0,LIMITS.maxPlaces)){
    const id=String(place?.id||"").trim();
    if(!id||place.worldAuthority===false)continue;
    out.push(Object.freeze({
      id,kind:"place",name:normalizeText(place.name||id,140),type:normalizeText(place.type||"",80),
      category:normalizeText(place.category||"",80),
      distanceMeters:Number(Number(place.distanceMeters||0).toFixed(2)),
      position:normalizePoint(place.center||place.coordinates?.tile||{}),
      countryId:normalizeText(place.countryId||"",120)||null,
      regionId:normalizeText(place.regionId||"",120)||null,
      knownByRumorLead:leadIds.has(id),
      authority:normalizeText(place.authority||place.source||"WorldDestinations",180),
      worldAuthority:true
    }));
  }
  out.sort((a,b)=>a.distanceMeters-b.distanceMeters||a.id.localeCompare(b.id));
  return Object.freeze(out.slice(0,context.maxPlaces));
}
function routeTargets(context,graph,places){
  if(!graph)return Object.freeze([]);
  const placeIds=new Set(places.map(item=>item.id));
  const nodeIds=new Set((Array.isArray(graph.nodes)?graph.nodes:[]).map(node=>String(node.id)));
  const out=[];
  for(const edge of (Array.isArray(graph.edges)?graph.edges:[])){
    const id=String(edge?.id||"").trim(),aId=String(edge?.aId||""),bId=String(edge?.bId||"");
    if(!id||!nodeIds.has(aId)||!nodeIds.has(bId))continue;
    if(!placeIds.has(aId)||!placeIds.has(bId))continue;
    out.push(Object.freeze({
      id,kind:"route",aId,bId,
      roadClass:normalizeText(edge.roadClass||"",80),
      distanceMeters:Number(Number(edge.distanceMeters||0).toFixed(2)),
      authority:normalizeText(edge.authority||"WorldRoadGraph",180),
      worldAuthority:true
    }));
    if(out.length>=context.maxRoutes)break;
  }
  out.sort((a,b)=>a.id.localeCompare(b.id));
  return Object.freeze(out);
}
function interactionTargets(context,people){
  const grouped=new Map();
  for(const person of people){
    const activity=person.currentActivity||{},id=String(activity.interactionObjectId||"").trim();
    if(!id)continue;
    const existing=grouped.get(id)||{
      id,kind:"interaction",personIds:[],objectType:activity.interactionObjectType||null,
      buildingId:activity.buildingId||null,action:activity.action||null,
      position:person.position,authority:"DailyActivity current interaction target",worldAuthority:true
    };
    if(!existing.personIds.includes(person.id))existing.personIds.push(person.id);
    grouped.set(id,existing);
  }
  const out=[...grouped.values()].map(item=>Object.freeze({...item,personIds:Object.freeze(item.personIds.slice().sort())}));
  out.sort((a,b)=>a.id.localeCompare(b.id));
  return Object.freeze(out.slice(0,context.maxInteractionTargets));
}
function freezeSchemas(){return COMMANDS;}
function snapshotSignature(value){
  return "CMDCTX-"+hashText(stableStringify(value));
}
function buildSnapshot(configValue,sourceOverrides){
  const context=contextConfig(configValue),defaults=sourceDefaults(),sources=Object.freeze({...defaults,...(sourceOverrides||{})});
  const roster=readSource(sources,"getResidentRoster",context)||[];
  const activities=readSource(sources,"getDailyActivities",context)||[];
  const destinationQuery=readSource(sources,"queryDestinations",context)||{results:[],diagnostics:{}};
  const country=readSource(sources,"getCountry",context)||null;
  const graph=readSource(sources,"getRoadGraph",context,country)||null;
  const knownLeads=readSource(sources,"getKnownLeads",context)||[];
  const people=personTargets(context,roster,activities);
  const places=placeTargets(context,destinationQuery,knownLeads);
  const routes=routeTargets(context,graph,places);
  const interactions=interactionTargets(context,people);
  const countryId=String(country?.id||country?.countryId||graph?.countryId||"");
  const targetIds=Object.freeze({
    person:Object.freeze(people.map(item=>item.id)),
    place:Object.freeze(places.map(item=>item.id)),
    route:Object.freeze(routes.map(item=>item.id)),
    interaction:Object.freeze(interactions.map(item=>item.id))
  });
  const signatureInput={
    interfaceVersion:INTERFACE_VERSION,contextVersion:CONTEXT_VERSION,
    seed:context.seed,when:context.when,origin:context.origin,countryId,
    commands:COMMANDS.map(item=>item.id),targetIds
  };
  const snapshotId=snapshotSignature(signatureInput);
  const diagnostics=Object.freeze({
    residentRowsRead:Math.min(Array.isArray(roster)?roster.length:0,LIMITS.maxPeople),
    activityRowsRead:Math.min(Array.isArray(activities)?activities.length:0,LIMITS.maxPeople),
    destinationRowsRead:Math.min(Array.isArray(destinationQuery?.results)?destinationQuery.results.length:0,LIMITS.maxPlaces),
    roadNodeRowsRead:Math.min(Array.isArray(graph?.nodes)?graph.nodes.length:0,40),
    roadEdgeRowsRead:Math.min(Array.isArray(graph?.edges)?graph.edges.length:0,64),
    peopleExposed:people.length,placesExposed:places.length,routesExposed:routes.length,interactionTargetsExposed:interactions.length,
    destinationSourceBounded:destinationQuery?.diagnostics?.bounded!==false,
    destinationSourceFullWorldScan:Boolean(destinationQuery?.diagnostics?.fullWorldScan),
    roadSourceBounded:graph?.diagnostics?.bounded!==false,
    roadSourceFullWorldScan:Boolean(graph?.diagnostics?.fullWorldScan),
    bounded:destinationQuery?.diagnostics?.bounded!==false&&graph?.diagnostics?.bounded!==false,
    fullWorldScan:Boolean(destinationQuery?.diagnostics?.fullWorldScan||graph?.diagnostics?.fullWorldScan),
    renderStateAuthority:false,
    cameraAuthority:false,
    deviceAuthority:false,
    performanceAuthority:false,
    worldMutation:false,
    executionAuthority:false
  });
  return deepFreeze({
    interfaceVersion:INTERFACE_VERSION,contextVersion:CONTEXT_VERSION,snapshotId,
    context:Object.freeze({seed:context.seed,when:context.when,origin:context.origin,countryId:countryId||null}),
    commands:freezeSchemas(),
    targets:Object.freeze({people,places,routes,interactions}),
    targetIds,
    capabilities:Object.freeze({
      arbitraryJavaScript:false,rawObjectMutation:false,fileAccess:false,networkAccess:false,
      directStorageMutation:false,directWorldMutation:false,executionAuthority:false
    }),
    diagnostics
  });
}
function targetLookup(snapshot,kind,id){
  const key={person:"people",place:"places",route:"routes",interaction:"interactions"}[kind];
  if(!key)return null;
  return (snapshot?.targets?.[key]||[]).find(item=>item.id===String(id))||null;
}
function sanitizeString(value,max){
  if(typeof value!=="string")return null;
  const text=value.trim().replace(/\s+/g," ");
  if(!text||text.length>max)return null;
  return text;
}
function reject(snapshot,commandId,reason,details){
  return deepFreeze({
    ok:false,status:"rejected",reason,commandId:commandId||null,
    snapshotId:snapshot?.snapshotId||null,validatedParameters:null,
    details:details||null,worldMutation:false,executionAttempted:false
  });
}
function validateProposal(snapshotValue,proposalValue){
  const snapshot=snapshotValue&&typeof snapshotValue==="object"?snapshotValue:null;
  if(!snapshot||snapshot.interfaceVersion!==INTERFACE_VERSION)return reject(snapshot,null,"invalid-snapshot");
  const proposal=proposalValue&&typeof proposalValue==="object"?proposalValue:null;
  if(!proposal||Array.isArray(proposal))return reject(snapshot,null,"invalid-proposal");
  const extraRoot=Object.keys(proposal).filter(key=>!ROOT_KEYS.includes(key));
  if(extraRoot.length)return reject(snapshot,String(proposal.commandId||""),"unexpected-proposal-field",Object.freeze({fields:Object.freeze(extraRoot.sort())}));
  const commandId=String(proposal.commandId||"").trim(),command=COMMAND_BY_ID[commandId];
  if(!command)return reject(snapshot,commandId,"unknown-command");
  const parameters=proposal.parameters&&typeof proposal.parameters==="object"&&!Array.isArray(proposal.parameters)?proposal.parameters:{};
  const allowedNames=new Set(command.parameters.map(item=>item.name));
  const unexpected=Object.keys(parameters).filter(key=>!allowedNames.has(key));
  if(unexpected.length)return reject(snapshot,commandId,"unexpected-parameter",Object.freeze({fields:Object.freeze(unexpected.sort())}));
  const validated={};
  for(const spec of command.parameters){
    const present=Object.prototype.hasOwnProperty.call(parameters,spec.name);
    if(!present){
      if(spec.required)return reject(snapshot,commandId,"missing-parameter",Object.freeze({parameter:spec.name}));
      continue;
    }
    const value=parameters[spec.name];
    if(spec.type==="string"){
      const text=sanitizeString(value,Number(spec.maxLength)||160);
      if(text==null)return reject(snapshot,commandId,"invalid-string-parameter",Object.freeze({parameter:spec.name}));
      validated[spec.name]=text;
      continue;
    }
    if(spec.type==="target"){
      if(typeof value!=="string"||!value.trim())return reject(snapshot,commandId,"invalid-target-id",Object.freeze({parameter:spec.name}));
      const id=value.trim(),matches=[];
      for(const kind of spec.targetKinds||[]){
        const target=targetLookup(snapshot,kind,id);
        if(target)matches.push({kind,target});
      }
      if(!matches.length)return reject(snapshot,commandId,"target-unavailable",Object.freeze({parameter:spec.name,targetId:id}));
      validated[spec.name]=id;
    }
  }
  if(commandId==="advisor.propose_travel"&&validated.routeId){
    const route=targetLookup(snapshot,"route",validated.routeId);
    if(!route||!(route.aId===validated.destinationId||route.bId===validated.destinationId)){
      return reject(snapshot,commandId,"route-does-not-connect-destination");
    }
  }
  if(commandId==="advisor.propose_interaction"&&validated.interactionTargetId){
    const interaction=targetLookup(snapshot,"interaction",validated.interactionTargetId);
    if(!interaction||!interaction.personIds.includes(validated.personId)){
      return reject(snapshot,commandId,"interaction-target-not-associated-with-person");
    }
  }
  return deepFreeze({
    ok:true,status:"validated",reason:"proposal-valid",commandId,
    snapshotId:snapshot.snapshotId,
    proposalId:normalizeText(proposal.proposalId||"",160)||null,
    source:normalizeText(proposal.source||"",160)||null,
    validatedParameters:Object.freeze(validated),
    worldMutation:false,executionAttempted:false
  });
}
function serializeSnapshot(snapshot){return stableStringify(snapshot);}
function getCommandSchemas(){return COMMANDS;}

return deepFreeze({
  INTERFACE_VERSION,CONTEXT_VERSION,TILE_METERS,LIMITS,
  getCommandSchemas,buildSnapshot,validateProposal,serializeSnapshot
});
});
