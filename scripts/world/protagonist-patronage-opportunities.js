(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistPatronageOpportunities=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";
const VERSION="protagonist-patronage-opportunities-v1",SCHEMA="ProtagonistPatronageOpportunityLedger",SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-patronage-opportunity-ledger",REGISTRY_KEY="patronage-opportunity-decisions";
const INTENTS=Object.freeze(["mentorship-training","service-sponsorship","advancement-sponsorship"]);
const DECISIONS=Object.freeze(["accepted","deferred","rejected"]);
const MAX_CANDIDATES=12,MAX_RESULTS=9,MAX_PER_INTENT=3,MAX_DECISIONS=48,MAX_QUERY_RESULTS=12,MAX_LEDGER_BYTES=49152,WINDOW_DAYS=14;
const PROFESSIONS=Object.freeze(["farmer","smith","tavern-keeper","shopkeeper","woodcutter","guard"]);
const SERVICE_PROFESSIONS=Object.freeze(["smith","tavern-keeper","shopkeeper","guard"]);
const ADVANCEMENT_PROFESSIONS=Object.freeze(["tavern-keeper","shopkeeper","guard"]);
const THRESHOLDS=Object.freeze({
  "mentorship-training":Object.freeze({trust:0.45,respect:0.40,maxSuspicion:0.65}),
  "service-sponsorship":Object.freeze({trust:0.55,respect:0.50,maxSuspicion:0.55}),
  "advancement-sponsorship":Object.freeze({trust:0.70,respect:0.65,maxSuspicion:0.40})
});
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,C(x)]))}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v??"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function B(v){return typeof TextEncoder!=="undefined"?new TextEncoder().encode(String(v)).length:String(v).length}
function T(v,n=160){return String(v??"").trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=160){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function P(v){return!!v&&typeof v==="object"&&!Array.isArray(v)}
function seed(v){const s=T(v);if(!s)throw new Error("Campaign SEED is required.");return s}
function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""))}
function ts(v){const x=T(v,32);if(!validTs(x))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return x}
function ref(kind,idValue){const id=I(idValue,160),k=I(kind,64);return k&&id?F({kind:k,id}):null}
function refIn(v){if(!P(v))return null;return ref(v.kind||v.type||"entity",v.id||v.refId||v.entityId)}
function actor(seedValue,identityValue){try{return root?.ProtagonistProfile?.derive?.(seedValue,identityValue)?.protagonistId||("PROTAGONIST-"+H(seedValue+"|"+identityValue+"|identity-v1"))}catch(_){return"PROTAGONIST-"+H(seedValue+"|"+identityValue+"|identity-v1")}}
function parts(v){const m=/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v||""));if(!m)return null;return{y:+m[1],m:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]}}
function dayNumber(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe-719468}
function civil(day){let z=day+719468;const era=Math.floor(z/146097),doe=z-era*146097,yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);let y=yoe+era*400;const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100)),mp=Math.floor((5*doy+2)/153),d=doy-Math.floor((153*mp+2)/5)+1,m=mp+(mp<10?3:-9);y+=m<=2?1:0;return{y,m,d}}
function stampFromDay(day){const c=civil(day),pad=x=>String(x).padStart(2,"0");return String(c.y).padStart(4,"0")+"-"+pad(c.m)+"-"+pad(c.d)+" 00:00:00"}
function cycle(whenValue){const p=parts(whenValue);if(!p)throw new Error("Fantasy timestamp invalid.");const day=dayNumber(p.y,p.m,p.d),startDay=Math.floor(day/WINDOW_DAYS)*WINDOW_DAYS,endDay=startDay+WINDOW_DAYS;return F({key:"CYCLE-"+startDay,start:stampFromDay(startDay),end:stampFromDay(endDay),startDay,endDay})}
function number(v,fallback=0){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback}
function ctx(seedValue,identityValue){const s=seed(seedValue),identityKey=I(identityValue||"protagonist",96)||"protagonist",protagonistId=actor(s,identityKey),ws=root?.WorldState,structural=ws?.structuralRef?.(s,REGISTRY_KIND,protagonistId,REGISTRY_KEY,{role:"protagonist-patronage-opportunities",protagonistId,identityKey,authority:"ProtagonistPatronageOpportunities"})||null;return F({seed:s,identityKey,protagonistId,ref:structural})}
function residentRows(seedValue){
 const rows=(root?.DailyActivity?.build?.(seedValue)||[]).slice(0,MAX_CANDIDATES),out=[];
 for(const r of rows){
  const residentId=I(r?.id),professionId=I(r?.profession,80).toLowerCase(),workplaceId=I(r?.workplaceId),label=T(r?.displayName||r?.name||residentId,96),workFunction=I(r?.workFunction||r?.workplaceFunction,80).toLowerCase();
  if(!residentId||!professionId||!workplaceId||!PROFESSIONS.includes(professionId))continue;
  out.push(F({residentId,displayName:label,professionId,workFunction,workplaceId,workplaceLabel:T(r?.workplaceLabel||workplaceId,96)}));
 }
 return F(out);
}
function roleSupports(intent,professionId){
 if(intent==="mentorship-training")return PROFESSIONS.includes(professionId);
 if(intent==="service-sponsorship")return SERVICE_PROFESSIONS.includes(professionId);
 if(intent==="advancement-sponsorship")return ADVANCEMENT_PROFESSIONS.includes(professionId);
 return false;
}
function safeRecognition(seedValue,residentId){try{return root?.CharacterMemory?.recognition?.(seedValue,residentId)||null}catch(_){return null}}
function safeSocial(seedValue,residentId){try{return root?.SocialState?.dialogueContext?.(seedValue,residentId)||null}catch(_){return null}}
function safeAuthority(seedValue,identityValue){try{return root?.ProtagonistAuthority?.snapshot?.(seedValue,identityValue)||null}catch(_){return null}}
function safeEmployment(seedValue,whenValue,identityValue){try{return root?.ProtagonistEmployment?.current?.(seedValue,whenValue,identityValue)||null}catch(_){return null}}
function prerequisite(seedValue,whenValue,row,intent,identityValue){
 const rec=safeRecognition(seedValue,row.residentId),social=safeSocial(seedValue,row.residentId),threshold=THRESHOLDS[intent],v=social?.values||{},trust=number(v.trust),respect=number(v.respect),suspicion=number(v.suspicion),known=rec?.metBefore===true,roleQualified=roleSupports(intent,row.professionId);
 const authority=safeAuthority(seedValue,identityValue),employment=safeEmployment(seedValue,whenValue,identityValue),blockers=[];
 if(!known)blockers.push("known-resident-required");
 if(!roleQualified)blockers.push("qualified-source-role-required");
 if(trust<threshold.trust)blockers.push("trust-below-threshold");
 if(respect<threshold.respect)blockers.push("respect-below-threshold");
 if(suspicion>threshold.maxSuspicion)blockers.push("suspicion-too-high");
 if(!row.workplaceId)blockers.push("real-workplace-required");
 return F({satisfied:blockers.length===0,blockers:F(blockers),knownResident:known,familiarity:rec?.familiarity||"stranger",relationship:F({trust,respect,suspicion}),threshold:F(C(threshold)),roleQualified,sourceRole:F({professionId:row.professionId,workFunction:row.workFunction}),authorityContext:F({roleId:authority?.currentRole?.roleId||null,rankTier:authority?.currentRole?.rankTier??null,readOnly:true}),employmentContext:F({status:employment?.status||"unknown",contractId:employment?.contract?.id||null,readOnly:true}),sourceRefs:F([ref("resident",row.residentId),ref("workplace",row.workplaceId)].filter(Boolean)),readOnly:true});
}
function intentLabel(intent){return intent==="mentorship-training"?"Mentorship / training support":intent==="service-sponsorship"?"Service sponsorship":"Advancement sponsorship"}
function buildOpportunity(seedValue,whenValue,row,intent,identityValue){
 const cy=cycle(whenValue),pre=prerequisite(seedValue,whenValue,row,intent,identityValue),payload={version:VERSION,seed:seedValue,cycle:cy.key,intent,residentId:row.residentId,professionId:row.professionId,workplaceId:row.workplaceId},opportunityId="PAT-"+H(S(payload)),liveSignature="PATSIG-"+H("A|"+S(payload)+"|"+S(pre))+H("B|"+S(payload)+"|"+S(pre));
 return F({opportunityId,intent,intentLabel:intentLabel(intent),sourceNpcRef:ref("resident",row.residentId),sourceNpcLabel:row.displayName,sourceRole:F({professionId:row.professionId,workFunction:row.workFunction}),locationRef:ref("workplace",row.workplaceId),locationLabel:row.workplaceLabel,opensAt:cy.start,expiresAt:cy.end,cycleKey:cy.key,prerequisites:pre,liveSignature,available:pre.satisfied===true,offerMeaning:intent==="mentorship-training"?"grounded invitation to discuss training support":intent==="service-sponsorship"?"grounded invitation to discuss service sponsorship":"grounded invitation to discuss an advancement recommendation",rankGuaranteed:false,appointmentGuaranteed:false,skillGrant:false,wealthGrant:false,authorityGrant:false,relationshipGrant:false,readOnly:true});
}
function list(seedValue,whenValue,optionsValue={},identityValue){
 let s,when;try{s=seed(seedValue);when=ts(whenValue)}catch(_){return F([])}
 const rows=residentRows(s),byIntent={};for(const i of INTENTS)byIntent[i]=[];
 for(const row of rows){for(const intent of INTENTS){const o=buildOpportunity(s,when,row,intent,identityValue);if(o.available)byIntent[intent].push(o)}}
 const selected=[];
 for(const intent of INTENTS){byIntent[intent].sort((a,b)=>{const av=parseInt(H(s+"|"+a.cycleKey+"|"+intent+"|"+a.sourceNpcRef.id),16),bv=parseInt(H(s+"|"+b.cycleKey+"|"+intent+"|"+b.sourceNpcRef.id),16);return av-bv||a.opportunityId.localeCompare(b.opportunityId)});selected.push(...byIntent[intent].slice(0,MAX_PER_INTENT))}
 const intent=I(optionsValue?.intent,64),npc=I(optionsValue?.sourceNpcId,160),limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(optionsValue?.limit)||MAX_RESULTS)));
 return F(selected.filter(x=>(!intent||x.intent===intent)&&(!npc||x.sourceNpcRef.id===npc)).sort((a,b)=>a.intent.localeCompare(b.intent)||a.opportunityId.localeCompare(b.opportunityId)).slice(0,limit));
}
function inspectCandidate(seedValue,whenValue,residentIdValue,intentValue,identityValue){
 let s,when;try{s=seed(seedValue);when=ts(whenValue)}catch(e){return F({ok:false,reason:String(e.message||e)})}
 const residentId=I(residentIdValue),intent=I(intentValue,64);if(!INTENTS.includes(intent))return F({ok:false,reason:"intent-invalid"});
 const row=residentRows(s).find(x=>x.residentId===residentId);if(!row)return F({ok:false,reason:"source-resident-unavailable"});
 const opportunity=buildOpportunity(s,when,row,intent,identityValue);return F({ok:true,reason:opportunity.available?"available":"blocked",opportunity});
}
function get(seedValue,whenValue,opportunityIdValue,identityValue){const id=I(opportunityIdValue);return list(seedValue,whenValue,{limit:MAX_QUERY_RESULTS},identityValue).find(x=>x.opportunityId===id)||null}
function empty(c){return{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:c.seed,protagonistId:c.protagonistId,identityKey:c.identityKey,registryId:c.ref?.id||null,revision:0,decisions:[]}}
function validDecision(x){return P(x)&&/^PDEC-[0-9A-F]{8}$/.test(String(x.id||""))&&I(x.decisionId)&&/^PAT-[0-9A-F]{8}$/.test(String(x.opportunityId||""))&&INTENTS.includes(x.intent)&&refIn(x.sourceNpcRef)&&refIn(x.locationRef)&&DECISIONS.includes(x.decision)&&validTs(x.decidedAt)&&["accepted-awaiting-simulation","deferred","rejected"].includes(x.status)&&/^PDECSIG-[0-9A-F]{16}$/.test(String(x.signature||""))}
function compatible(l,c){
 if(!P(l)||l.schema!==SCHEMA||l.schemaVersion!==SCHEMA_VERSION||l.version!==VERSION||l.seed!==c.seed||l.protagonistId!==c.protagonistId||l.identityKey!==c.identityKey||l.registryId!==(c.ref?.id||null)||!Number.isInteger(l.revision)||l.revision<0||!Array.isArray(l.decisions)||l.decisions.length>MAX_DECISIONS)return false;
 const ids=new Set(),decisionIds=new Set();for(const x of l.decisions){if(!validDecision(x)||ids.has(x.id)||decisionIds.has(x.decisionId))return false;ids.add(x.id);decisionIds.add(x.decisionId)}
 return B(S(l))<=MAX_LEDGER_BYTES;
}
function read(seedValue,identityValue){
 const c=ctx(seedValue,identityValue),resolved=c.ref&&root?.WorldState?.resolve?.(c.seed,c.ref),raw=resolved?.current?.protagonistPatronageOpportunities;
 if(raw==null)return{ok:true,c,ledger:empty(c),reason:"empty"};
 return compatible(raw,c)?{ok:true,c,ledger:C(raw),reason:"ok"}:{ok:false,c,ledger:null,reason:"patronage-opportunity-ledger-incompatible"};
}
function write(seedValue,identityValue,l,reason){
 const r=read(seedValue,identityValue);if(!r.ok)return F({ok:false,reason:r.reason});if(!r.c.ref||!root?.WorldState?.applyDelta)return F({ok:false,reason:"world-state-unavailable"});
 const n=C(l);Object.assign(n,{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:r.c.seed,protagonistId:r.c.protagonistId,identityKey:r.c.identityKey,registryId:r.c.ref.id,revision:(Number(n.revision)||0)+1});
 if(!compatible(n,r.c))return F({ok:false,reason:"patronage-opportunity-invalid-or-over-budget"});
 const out=root.WorldState.applyDelta(r.c.seed,r.c.ref,{protagonistPatronageOpportunities:n},reason);return F({ok:!!out?.ok,reason:out?.reason||"ok",ledgerRevision:n.revision,serializedBytes:B(S(n)),deltaRevision:Number(out?.entry?.revision||0)});
}
function protagonistAuth(v){
 const x=P(v)?v:{};if(x.authority!=="protagonist"||x.protagonistOwned!==true)return{ok:false,reason:"protagonist-decision-authority-required"};
 const decisionId=I(x.decisionId||x.operationId||x.id);if(!decisionId)return{ok:false,reason:"decision-id-required"};
 try{return{ok:true,decisionId,fantasyTimestamp:ts(x.fantasyTimestamp||x.timestamp)}}catch(e){return{ok:false,reason:String(e.message||e)}}
}
function decisionSignature(c,a,o,decision){const payload=S({version:VERSION,seed:c.seed,protagonistId:c.protagonistId,decisionId:a.decisionId,opportunityId:o.opportunityId,liveSignature:o.liveSignature,decision});return"PDECSIG-"+H("A|"+payload)+H("B|"+payload)}
function proposal(o){return F({proposalOnly:true,opportunityId:o.opportunityId,action:"speak",targetId:o.sourceNpcRef.id,targetRef:o.sourceNpcRef,locationRef:o.locationRef,intent:o.intent,route:"ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",requiresTerminalSimulation:true,directActionExecution:false,directRankMutation:false,directSkillMutation:false,directWealthMutation:false,directAuthorityMutation:false})}
function evaluate(seedValue,opportunityIdValue,decisionValue,optionsValue,identityValue){
 let s;try{s=seed(seedValue)}catch(e){return F({ok:false,reason:String(e.message||e)})}
 const a=protagonistAuth(optionsValue);if(!a.ok)return F(a);const decision=I(decisionValue,32).toLowerCase();if(!DECISIONS.includes(decision))return F({ok:false,reason:"decision-invalid"});
 const opportunity=get(s,a.fantasyTimestamp,opportunityIdValue,identityValue);if(!opportunity)return F({ok:false,reason:"opportunity-unavailable-or-stale"});
 const r=read(s,identityValue);if(!r.ok)return F({ok:false,reason:r.reason});const sig=decisionSignature(r.c,a,opportunity,decision),found=r.ledger.decisions.find(x=>x.decisionId===a.decisionId);
 if(found){if(found.signature!==sig)return F({ok:false,reason:"duplicate-decision-conflict"});return F({ok:true,reason:"duplicate-decision",duplicate:true,decisionRecord:F(C(found)),interactionProposal:found.decision==="accepted"?proposal(opportunity):null})}
 const record=F({id:"PDEC-"+H(sig),decisionId:a.decisionId,opportunityId:opportunity.opportunityId,opportunityLiveSignature:opportunity.liveSignature,intent:opportunity.intent,sourceNpcRef:opportunity.sourceNpcRef,locationRef:opportunity.locationRef,decision,status:decision==="accepted"?"accepted-awaiting-simulation":decision,decidedAt:a.fantasyTimestamp,signature:sig});
 const l=C(r.ledger);l.decisions=[...l.decisions,C(record)].slice(-MAX_DECISIONS);const w=write(s,identityValue,l,"protagonist-patronage-opportunity-evaluate:"+record.id);
 return F({...w,duplicate:false,decisionRecord:w.ok?record:null,interactionProposal:w.ok&&decision==="accepted"?proposal(opportunity):null,directRankMutation:false,directSkillMutation:false,directWealthMutation:false,directAuthorityMutation:false,directRelationshipMutation:false});
}
function decisions(seedValue,optionsValue={},identityValue){
 const r=read(seedValue,identityValue);if(!r.ok)return F([]);const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(optionsValue?.limit)||MAX_QUERY_RESULTS))),status=I(optionsValue?.status,48),intent=I(optionsValue?.intent,64);
 return F(C(r.ledger.decisions).reverse().filter(x=>(!status||x.status===status)&&(!intent||x.intent===intent)).slice(0,limit).map(F));
}
function snapshot(seedValue,identityValue){
 const r=read(seedValue,identityValue);if(!r.ok)return F({version:VERSION,compatible:false,reason:r.reason,decisions:F([])});
 return F({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,decisionCount:r.ledger.decisions.length,decisions:F(C(r.ledger.decisions).map(F)),serializedBytes:B(S(r.ledger)),bounds:F({maxCandidates:MAX_CANDIDATES,maxResults:MAX_RESULTS,maxPerIntent:MAX_PER_INTENT,maxDecisions:MAX_DECISIONS,maxQueryResults:MAX_QUERY_RESULTS,maxLedgerBytes:MAX_LEDGER_BYTES,windowDays:WINDOW_DAYS}),candidateAuthority:"bounded DailyActivity resident/workplace/profession context",knowledgeAuthority:"CharacterMemory recognition only",relationshipAuthority:"SocialState read-only context",roleContextAuthority:"ProtagonistAuthority read-only",employmentContextAuthority:"ProtagonistEmployment read-only",timingAuthority:"Campaign SEED + Fantasy Game Time",decisionAuthority:"explicit protagonist-owned evaluation",actionBoundary:"proposal only -> ProtagonistActionRuntime -> ProtagonistCommandEvaluator -> Simulation",persistenceAuthority:"WorldState CampaignStateDelta",bounded:true,eventDriven:true,fullWorldScan:false,fullSettlementScan:false,wholeHistoryScan:false,perFrameGeneration:false,directActionExecution:false,directRankMutation:false,directSkillMutation:false,directWealthMutation:false,directAuthorityMutation:false,directRelationshipMutation:false,patronFabrication:false,titleFabrication:false,promotionGuarantee:false,uiAuthority:false,advisorAuthority:false,llmAuthority:false});
}
return F({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,INTENTS,DECISIONS,MAX_CANDIDATES,MAX_RESULTS,MAX_PER_INTENT,MAX_DECISIONS,MAX_QUERY_RESULTS,MAX_LEDGER_BYTES,WINDOW_DAYS,list,get,inspectCandidate,evaluate,decisions,snapshot});
});
