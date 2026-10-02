(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ExternalLlmAdapter=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const ADAPTER_VERSION="advisor-llm-adapter-v1";
const REQUEST_VERSION="advisor-llm-request-v1";
const RESPONSE_VERSION="advisor-llm-response-v1";
const LIMITS=Object.freeze({
  maxInputLength:512,
  maxFacts:16,
  maxFactLength:320,
  maxRequestBytes:32768,
  maxResponseBytes:16384,
  maxTextLength:4000,
  maxProposals:4,
  maxProposalBytes:4096
});
const RESPONSE_KEYS=Object.freeze(["text","proposals"]);
const PROPOSAL_KEYS=Object.freeze(["commandId","parameters","proposalId"]);

function deepFreeze(value){
  if(!value||typeof value!=="object"||Object.isFrozen(value))return value;
  Object.freeze(value);
  Object.keys(value).forEach(key=>deepFreeze(value[key]));
  return value;
}
function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    const out={};
    Object.keys(value).sort().forEach(key=>{
      if(value[key]!==undefined)out[key]=canonicalize(value[key]);
    });
    return out;
  }
  return value;
}
function stableStringify(value){return JSON.stringify(canonicalize(value));}
function byteLength(value){
  const text=typeof value==="string"?value:stableStringify(value);
  if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;
  if(typeof Buffer!=="undefined")return Buffer.byteLength(text,"utf8");
  return unescape(encodeURIComponent(text)).length;
}
function hashText(value){
  let hash=2166136261>>>0;
  for(const ch of String(value==null?"":value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function normalizeText(value,max){
  return String(value==null?"":value).normalize?.("NFKC")
    ?.replace(/[\u2018\u2019]/g,"'")
    ?.replace(/\s+/g," ")
    ?.trim()
    ?.slice(0,max)
    ||String(value==null?"":value).replace(/\s+/g," ").trim().slice(0,max);
}
function plainObject(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function cloneJson(value){return JSON.parse(JSON.stringify(value));}
function safeCommandSet(){
  return root?.CommandSetInterface||null;
}
function resultBase(status,reason,requestId){
  return {
    adapterVersion:ADAPTER_VERSION,responseVersion:RESPONSE_VERSION,status,reason,requestId:requestId||null,
    text:null,validatedProposals:Object.freeze([]),proposalRejections:Object.freeze([]),
    fallbackRequired:status!=="ok",providerUsed:false,untrustedText:true,
    worldMutation:false,executionAttempted:false,simulationAuthority:false,
    providerSecretsRead:false,persisted:false
  };
}
function finish(base,extra){
  return deepFreeze(Object.assign(base,extra||{}));
}
function safeTarget(target){
  return Object.freeze({
    id:normalizeText(target?.id||"",160),
    kind:normalizeText(target?.kind||"",40),
    name:normalizeText(target?.name||target?.label||"",160)||null,
    type:normalizeText(target?.type||target?.objectType||"",80)||null,
    category:normalizeText(target?.category||"",80)||null
  });
}
function commandForProvider(command){
  return Object.freeze({
    id:command.id,purpose:command.purpose,operationClass:command.operationClass,
    intentIds:Object.freeze((command.intentIds||[]).slice()),
    targetKinds:Object.freeze((command.targetKinds||[]).slice()),
    parameters:Object.freeze((command.parameters||[]).map(spec=>Object.freeze({
      name:spec.name,type:spec.type,required:Boolean(spec.required),
      targetKinds:Object.freeze((spec.targetKinds||[]).slice()),
      maxLength:Number(spec.maxLength)||null
    })))
  });
}
function factForProvider(row,index){
  if(!plainObject(row))return null;
  const text=normalizeText(row.text||row.summary||row.value||"",LIMITS.maxFactLength);
  if(!text||row.grounded===false)return null;
  return Object.freeze({
    id:normalizeText(row.id||("fact-"+index),120),
    subject:normalizeText(row.subject||"",160)||null,
    text,
    source:normalizeText(row.source||row.sourceType||"authoritative-context",120),
    uncertain:Boolean(row.uncertain),
    grounded:true
  });
}
function buildRequest(configValue){
  const config=plainObject(configValue)?configValue:{};
  const snapshot=config.snapshot;
  const commandSet=config.commandSet||safeCommandSet();
  const messageRaw=String(config.message==null?"":config.message);
  if(messageRaw.length>LIMITS.maxInputLength)return finish(resultBase("rejected","input-too-long",null),{fallbackRequired:true});
  if(!snapshot||typeof snapshot!=="object"||!snapshot.snapshotId||!Array.isArray(snapshot.commands)){
    return finish(resultBase("rejected","invalid-command-snapshot",null),{fallbackRequired:true});
  }
  if(snapshot.diagnostics?.bounded===false||snapshot.diagnostics?.fullWorldScan===true){
    return finish(resultBase("rejected","unbounded-command-snapshot",String(snapshot.snapshotId)),{fallbackRequired:true});
  }
  if(!commandSet||typeof commandSet.validateProposal!=="function"){
    return finish(resultBase("unavailable","command-validator-unavailable",null),{fallbackRequired:true});
  }
  const message=normalizeText(messageRaw,LIMITS.maxInputLength);
  const context=plainObject(config.context)?config.context:{};
  const characterSource=plainObject(context.character)?context.character:{};
  const facts=(Array.isArray(context.facts)?context.facts:[])
    .slice(0,LIMITS.maxFacts).map(factForProvider).filter(Boolean);
  const targets=snapshot.targets||{};
  const requestCore={
    requestVersion:REQUEST_VERSION,
    message,
    character:Object.freeze({
      kind:"protagonist",
      id:normalizeText(characterSource.id||context.protagonistId||"protagonist",120)||"protagonist",
      name:normalizeText(characterSource.name||context.protagonistName||"Protagonist",120)||"Protagonist"
    }),
    authoritativeContext:Object.freeze({
      when:snapshot.context?.when||null,
      origin:snapshot.context?.origin||null,
      countryId:snapshot.context?.countryId||null,
      facts:Object.freeze(facts)
    }),
    commandSet:Object.freeze({
      interfaceVersion:snapshot.interfaceVersion||null,
      snapshotId:String(snapshot.snapshotId),
      commands:Object.freeze(snapshot.commands.map(commandForProvider)),
      targets:Object.freeze({
        people:Object.freeze((targets.people||[]).map(safeTarget)),
        places:Object.freeze((targets.places||[]).map(safeTarget)),
        routes:Object.freeze((targets.routes||[]).map(safeTarget)),
        interactions:Object.freeze((targets.interactions||[]).map(safeTarget))
      })
    }),
    rules:Object.freeze({
      outputShape:"JSON object with only text and proposals",
      freeFormTextExecutesActions:false,
      proposalsAreUntrusted:true,
      worldMutationAuthority:false,
      executionAuthority:false
    })
  };
  const requestId="LLMREQ-"+hashText(stableStringify(requestCore));
  const request=deepFreeze({...requestCore,requestId});
  const requestBytes=byteLength(request);
  if(requestBytes>LIMITS.maxRequestBytes){
    return finish(resultBase("rejected","request-too-large",requestId),{
      fallbackRequired:true,metrics:Object.freeze({requestBytes,maxRequestBytes:LIMITS.maxRequestBytes})
    });
  }
  return deepFreeze({ok:true,request,requestId,requestBytes,commandSet,snapshot});
}
function parseProviderResponse(raw){
  if(raw==null)return {ok:false,reason:"empty-provider-response",bytes:0};
  let bytes=0,value=raw;
  if(typeof raw==="string"){
    bytes=byteLength(raw);
    if(bytes>LIMITS.maxResponseBytes)return {ok:false,reason:"response-too-large",bytes};
    try{value=JSON.parse(raw);}catch(_){return {ok:false,reason:"malformed-json",bytes};}
  }else{
    try{
      const encoded=stableStringify(raw);
      bytes=byteLength(encoded);
      if(bytes>LIMITS.maxResponseBytes)return {ok:false,reason:"response-too-large",bytes};
    }catch(_){return {ok:false,reason:"unserializable-response",bytes:0};}
  }
  if(!plainObject(value))return {ok:false,reason:"invalid-response-shape",bytes};
  const extra=Object.keys(value).filter(key=>!RESPONSE_KEYS.includes(key));
  if(extra.length)return {ok:false,reason:"unexpected-response-field",bytes,details:Object.freeze({fields:Object.freeze(extra.sort())})};
  if(value.text!==undefined&&typeof value.text!=="string")return {ok:false,reason:"invalid-text-field",bytes};
  if(typeof value.text==="string"&&value.text.length>LIMITS.maxTextLength)return {ok:false,reason:"text-too-long",bytes};
  if(value.proposals!==undefined&&!Array.isArray(value.proposals))return {ok:false,reason:"invalid-proposals-field",bytes};
  if(Array.isArray(value.proposals)&&value.proposals.length>LIMITS.maxProposals)return {ok:false,reason:"too-many-proposals",bytes};
  const text=typeof value.text==="string"?normalizeText(value.text,LIMITS.maxTextLength):"";
  const proposals=Array.isArray(value.proposals)?value.proposals:[];
  if(!text&&!proposals.length)return {ok:false,reason:"empty-validated-response",bytes};
  return {ok:true,value,text,proposals,bytes};
}
function proposalSchemaCheck(proposal,index){
  if(!plainObject(proposal))return {ok:false,index,commandId:null,reason:"invalid-proposal-shape"};
  let bytes=0;
  try{bytes=byteLength(proposal);}catch(_){return {ok:false,index,commandId:null,reason:"unserializable-proposal"};}
  if(bytes>LIMITS.maxProposalBytes)return {ok:false,index,commandId:null,reason:"proposal-too-large"};
  const extra=Object.keys(proposal).filter(key=>!PROPOSAL_KEYS.includes(key));
  if(extra.length)return {ok:false,index,commandId:normalizeText(proposal.commandId||"",160)||null,reason:"unexpected-proposal-field",details:Object.freeze({fields:Object.freeze(extra.sort())})};
  if(typeof proposal.commandId!=="string"||!proposal.commandId.trim())return {ok:false,index,commandId:null,reason:"missing-command-id"};
  if(proposal.parameters!==undefined&&!plainObject(proposal.parameters))return {ok:false,index,commandId:proposal.commandId.trim(),reason:"invalid-parameters-shape"};
  if(proposal.proposalId!==undefined&&(typeof proposal.proposalId!=="string"||!proposal.proposalId.trim()))return {ok:false,index,commandId:proposal.commandId.trim(),reason:"invalid-proposal-id"};
  return {ok:true,bytes};
}
function validateProposals(parsed,built){
  const accepted=[],rejected=[];
  parsed.proposals.forEach((proposal,index)=>{
    const schema=proposalSchemaCheck(proposal,index);
    if(!schema.ok){rejected.push(Object.freeze(schema));return;}
    const candidate={
      commandId:proposal.commandId.trim(),
      parameters:proposal.parameters||{},
      proposalId:proposal.proposalId?proposal.proposalId.trim():("LLMPROP-"+String(index+1)),
      source:"external-llm"
    };
    const checked=built.commandSet.validateProposal(built.snapshot,candidate);
    if(!checked?.ok){
      rejected.push(Object.freeze({
        index,commandId:candidate.commandId,proposalId:candidate.proposalId,
        reason:normalizeText(checked?.reason||"proposal-rejected",160),
        details:checked?.details||null
      }));
      return;
    }
    accepted.push(Object.freeze({
      proposalId:checked.proposalId||candidate.proposalId,
      commandId:checked.commandId,
      snapshotId:checked.snapshotId,
      validatedParameters:checked.validatedParameters,
      source:"external-llm",
      untrustedProposal:true,
      worldMutation:false,
      executionAttempted:false
    }));
  });
  return Object.freeze({accepted:Object.freeze(accepted),rejected:Object.freeze(rejected)});
}
async function invoke(configValue){
  const config=plainObject(configValue)?configValue:{};
  const built=buildRequest(config);
  if(!built.ok)return built;
  const enabled=config.enabled!==false;
  if(!enabled){
    return finish(resultBase("disabled","provider-disabled",built.requestId),{
      fallbackRequired:true,providerUsed:false,
      metrics:Object.freeze({requestBytes:built.requestBytes,responseBytes:0,proposalsReceived:0,proposalsAccepted:0,proposalsRejected:0})
    });
  }
  const provider=config.provider;
  if(!provider||typeof provider.generate!=="function"||provider.isAvailable===false){
    return finish(resultBase("unavailable","provider-unavailable",built.requestId),{
      fallbackRequired:true,providerUsed:false,
      metrics:Object.freeze({requestBytes:built.requestBytes,responseBytes:0,proposalsReceived:0,proposalsAccepted:0,proposalsRejected:0})
    });
  }
  let raw;
  try{
    raw=await provider.generate(built.request);
  }catch(_){
    return finish(resultBase("provider-error","provider-call-failed",built.requestId),{
      fallbackRequired:true,providerUsed:true,
      metrics:Object.freeze({requestBytes:built.requestBytes,responseBytes:0,proposalsReceived:0,proposalsAccepted:0,proposalsRejected:0})
    });
  }
  const parsed=parseProviderResponse(raw);
  if(!parsed.ok){
    return finish(resultBase("invalid-response",parsed.reason,built.requestId),{
      fallbackRequired:true,providerUsed:true,
      details:parsed.details||null,
      metrics:Object.freeze({requestBytes:built.requestBytes,responseBytes:parsed.bytes||0,proposalsReceived:0,proposalsAccepted:0,proposalsRejected:0})
    });
  }
  const validation=validateProposals(parsed,built);
  const status=validation.rejected.length?(validation.accepted.length?"partial":"proposal-rejected"):"ok";
  const reason=status==="ok"?"provider-response-valid":status==="partial"?"some-proposals-rejected":"all-proposals-rejected";
  return finish(resultBase(status,reason,built.requestId),{
    text:parsed.text||null,
    validatedProposals:validation.accepted,
    proposalRejections:validation.rejected,
    fallbackRequired:status!=="ok"&&!parsed.text,
    providerUsed:true,
    metrics:Object.freeze({
      requestBytes:built.requestBytes,responseBytes:parsed.bytes,
      proposalsReceived:parsed.proposals.length,
      proposalsAccepted:validation.accepted.length,
      proposalsRejected:validation.rejected.length
    })
  });
}
function createFakeProvider(responseValue,optionsValue){
  const options=plainObject(optionsValue)?optionsValue:{};
  const available=options.available!==false;
  let calls=0,lastRequest=null;
  return Object.freeze({
    id:"deterministic-fake-provider-v1",
    isAvailable:available,
    async generate(request){
      calls+=1;
      lastRequest=request;
      if(options.throwError)throw new Error("fake-provider-error");
      const source=typeof responseValue==="function"?responseValue(request):responseValue;
      return cloneJson(source);
    },
    inspect(){return Object.freeze({calls,lastRequest});}
  });
}
function serializeResult(value){return stableStringify(value);}

return deepFreeze({
  ADAPTER_VERSION,REQUEST_VERSION,RESPONSE_VERSION,LIMITS,
  buildRequest,invoke,createFakeProvider,serializeResult
});
});
