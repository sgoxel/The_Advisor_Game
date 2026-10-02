(function(){
"use strict";
const root=typeof window!=="undefined"?window:globalThis;
const VERSION="local-security-incidents-v1";
const SCHEMA="LocalSecurityIncidentState";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="local-security-incident-registry";
const REGISTRY_KEY="starting-village-security-v1";
const CATEGORIES=Object.freeze(["threat","dispute","crime","banditry","security","assault"]);
const SEVERITIES=Object.freeze(["minor","moderate","serious","critical"]);
const MAX_INCIDENTS=32,MAX_OPERATIONS=64,MAX_QUERY_RESULTS=12,MAX_ACTOR_REFS=6,MAX_ACTOR_READS=24,MAX_LOCATION_READS=24,MAX_STATE_BYTES=65536,LOCAL_RADIUS_TILES=96;
const telemetryState={reads:0,writes:0,records:0,resolutions:0,duplicates:0,rejections:0,queries:0,actorReads:0,locationReads:0};
function C(v){if(v==null||typeof v!=="object")return v;if(Array.isArray(v))return v.map(C);const o={};for(const[k,x]of Object.entries(v))o[k]=C(x);return o}
function F(v){if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;for(const x of Object.values(v))F(x);return Object.freeze(v)}
function S(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return"["+v.map(S).join(",")+"]";return"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+S(v[k])).join(",")+"}"}
function H(v){let h=2166136261>>>0;for(const ch of String(v==null?"":v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0")}
function B(v){const t=String(v==null?"":v);return typeof TextEncoder!=="undefined"?new TextEncoder().encode(t).length:t.length}
function T(v,n=180){return String(v==null?"":v).trim().replace(/\s+/g," ").slice(0,n)}
function I(v,n=180){return T(v,n).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-")}
function seed(v){const s=T(v,160);if(!s)throw new Error("Campaign SEED is required.");return s}
function bump(k,n=1){telemetryState[k]=Math.min(Number.MAX_SAFE_INTEGER,(telemetryState[k]||0)+n)}
function validTs(v){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(v||""))}
function now(){return root.GameTime?.getTimestampKey?.()||null}
function parts(v){const m=String(v||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;return{y:Number(m[1]),m:Number(m[2]),d:Number(m[3]),h:Number(m[4]),i:Number(m[5]),s:Number(m[6])}}
function dayIndex(y,m,d){const yy=y-(m<=2?1:0),era=Math.floor(yy/400),yoe=yy-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe}
function sec(v){const p=parts(v);return p?dayIndex(p.y,p.m,p.d)*86400+p.h*3600+p.i*60+p.s:null}
function sourceRef(v){if(!v||typeof v!=="object")return null;const kind=I(v.kind||v.type||"",80),id=I(v.id||v.entityId||"",180);return kind&&id?F({kind,id}):null}
function category(v){const x=I(v,40).toLowerCase();return CATEGORIES.includes(x)?x:null}
function severity(v){const x=I(v,32).toLowerCase();return SEVERITIES.includes(x)?x:null}
function settlementContext(seedValue){
 const s=seed(seedValue),plan=root.StartingVillage?.plan?.(s)||null;
 if(!plan?.center)return F({ok:false,seed:s,reason:"starting-village-unavailable",plan:null,ref:null});
 const ref=root.WorldState?.structuralRef?.(s,REGISTRY_KIND,"WORLD",REGISTRY_KEY,{role:"starting-village-security",name:String(plan.name||"Starting Village"),center:C(plan.center),authority:"LocalSecurityIncidents"})||null;
 return F({ok:Boolean(ref),seed:s,reason:ref?"ok":"world-state-unavailable",plan:C(plan),ref});
}
function localCoordinate(plan,xValue,yValue){
 try{
  const x=BigInt(String(xValue)),y=BigInt(String(yValue)),cx=BigInt(String(plan.center.x)),cy=BigInt(String(plan.center.y));
  const dx=Number(x-cx),dy=Number(y-cy),distance=Math.hypot(dx,dy);
  if(!Number.isFinite(distance)||distance>LOCAL_RADIUS_TILES)return null;
  return F({kind:"coordinate",id:"COORD|"+x.toString()+"|"+y.toString(),x:x.toString(),y:y.toString(),distanceTiles:Number(distance.toFixed(3))});
 }catch(_){return null}
}
function locationRef(seedValue,v,planValue){
 const s=seed(seedValue),plan=planValue||root.StartingVillage?.plan?.(s)||null;if(!plan?.center||!v||typeof v!=="object")return null;
 const kind=I(v.kind,40).toLowerCase(),id=I(v.id,180);
 if(kind==="settlement"&&id==="starting-village")return F({kind,id,label:String(plan.name||"Starting Village")});
 if(kind==="coordinate")return localCoordinate(plan,v.x,v.y);
 if(kind==="building"){
  const houses=(root.HousePlans?.build?.(s)||[]).slice(0,MAX_LOCATION_READS),lots=(root.SpecialLots?.build?.(s)||[]).slice(0,MAX_LOCATION_READS);
  bump("locationReads",houses.length+lots.length);
  const found=[...houses,...lots].find(x=>I(x?.id,180)===id)||null;
  if(!found)return null;
  return F({kind,id,label:T(found.label||found.kind||id,120)});
 }
 return null;
}
function actorRef(seedValue,v){
 const s=seed(seedValue);if(!v||typeof v!=="object")return null;
 const kind=I(v.kind,40).toLowerCase(),id=I(v.id,180),role=I(v.role||"participant",40).toLowerCase();
 if(kind==="resident"){
  const roster=(root.DailyActivity?.build?.(s)||[]).slice(0,MAX_ACTOR_READS);bump("actorReads",roster.length);
  const resident=roster.find(x=>I(x?.id,180)===id)||null;if(!resident)return null;
  return F({kind,id,role,label:T(resident.displayName||resident.name||id,120)});
 }
 if(kind==="protagonist"){
  let canonical="protagonist";try{canonical=I(root.ProtagonistProfile?.derive?.(s,"protagonist")?.protagonistId||canonical,180)}catch(_){}
  if(id!=="protagonist"&&id!==canonical)return null;
  return F({kind,id:canonical,role,label:"Protagonist"});
 }
 return null;
}
function actorRefs(seedValue,values){
 const rows=Array.isArray(values)?values:[];if(rows.length>MAX_ACTOR_REFS)return null;
 const out=[];for(const v of rows){const ref=actorRef(seedValue,v);if(!ref)return null;out.push(ref)}
 return F(out);
}
function empty(ctx){return{schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,registryId:ctx.ref?.id||null,revision:1,lastFantasyTimestamp:null,incidents:[],operations:[]}}
function compatible(raw,ctx){
 if(!raw||typeof raw!=="object"||raw.schema!==SCHEMA||raw.schemaVersion!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.registryId!==(ctx.ref?.id||null))return false;
 if(!Number.isInteger(raw.revision)||raw.revision<1||!Array.isArray(raw.incidents)||raw.incidents.length>MAX_INCIDENTS||!Array.isArray(raw.operations)||raw.operations.length>MAX_OPERATIONS)return false;
 if(raw.lastFantasyTimestamp!==null&&!validTs(raw.lastFantasyTimestamp))return false;
 const ids=new Set();
 for(const r of raw.incidents){
  if(!r||!/^SEC-[0-9A-F]{8}$/.test(String(r.id||""))||ids.has(r.id)||!category(r.category)||!severity(r.severity)||!["confirmed","reported"].includes(r.epistemicStatus)||!["active","resolved"].includes(r.status)||!validTs(r.startedTimestamp)||!validTs(r.updatedTimestamp)||!r.locationRef||!sourceRef(r.sourceRef)||!Array.isArray(r.actorRefs)||r.actorRefs.length>MAX_ACTOR_REFS)return false;
  if(r.status==="resolved"&&(!r.resolution||!validTs(r.resolution.fantasyTimestamp)||!sourceRef(r.resolution.sourceRef)))return false;
  if(r.legalGuilt!==null||r.relationshipOutcome!==null||r.combatOutcome!==null)return false;
  ids.add(r.id);
 }
 const ops=new Set();for(const op of raw.operations){if(!op||!I(op.key,260)||!/^SECSIG-[0-9A-F]{8}$/.test(String(op.signature||""))||!/^SEC-[0-9A-F]{8}$/.test(String(op.incidentId||""))||ops.has(op.key))return false;ops.add(op.key)}
 return B(S(raw))<=MAX_STATE_BYTES;
}
function read(seedValue){bump("reads");const ctx=settlementContext(seedValue);if(!ctx.ok)return{ctx,ok:false,reason:ctx.reason,state:null};const resolved=root.WorldState?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.localSecurityIncidentState;if(raw==null)return{ctx,ok:true,reason:"empty",state:empty(ctx)};return compatible(raw,ctx)?{ctx,ok:true,reason:"ok",state:C(raw)}:{ctx,ok:false,reason:"incident-state-incompatible",state:null}}
function write(ctx,state,reason){if(!ctx?.ref||!root.WorldState?.applyDelta)return F({ok:false,reason:"world-state-unavailable"});if(!compatible(state,ctx))return F({ok:false,reason:"incident-state-invalid"});const bytes=B(S(state));if(bytes>MAX_STATE_BYTES)return F({ok:false,reason:"incident-state-size-exceeded",serializedBytes:bytes});const out=root.WorldState.applyDelta(ctx.seed,ctx.ref,{localSecurityIncidentState:C(state)},String(reason||"local-security-incidents"));if(out?.ok)bump("writes");return F({ok:Boolean(out?.ok),reason:out?.reason||"ok",serializedBytes:bytes,registryRevision:state.revision,deltaRevision:Number(out?.entry?.revision||0)})}
function operationKey(system,operationId){return I(system,80)+"|"+I(operationId,180)}
function authoritativeOptions(s,o){
 const system=I(o.sourceSystem||"",80);
 if(!["Simulation","EventScheduler","WorldState"].includes(system))return null;
 if(o.authoritative!==true||o.validated!==true||T(o.campaignSeed,160)!==s)return null;
 return system;
}
function explicitReportOptions(s,o){
 const system=I(o.sourceSystem||"",80);
 if(o.authority!=="bounded-explicit-evidence"||o.authoritative===true||o.validated===true||T(o.campaignSeed,160)!==s)return null;
 if(!["ResidentReport","EventReport"].includes(system))return null;
 return system;
}
function normalizeCreate(seedValue,inputValue,optionsValue){
 const s=seed(seedValue),input=inputValue&&typeof inputValue==="object"?inputValue:{},o=optionsValue&&typeof optionsValue==="object"?optionsValue:{};
 const op=I(o.operationId||o.eventId,180),when=String(o.fantasyTimestamp||o.timestamp||now()||""),cat=category(input.category),sev=severity(input.severity),src=sourceRef(input.sourceRef||input.source);
 if(!op)return F({ok:false,reason:"operation-id-required"});if(!validTs(when))return F({ok:false,reason:"fantasy-timestamp-required"});if(!cat||!sev||!src)return F({ok:false,reason:"incident-evidence-invalid"});
 const ctx=settlementContext(s);if(!ctx.ok)return F({ok:false,reason:ctx.reason});
 const loc=locationRef(s,input.locationRef||input.location,ctx.plan);if(!loc)return F({ok:false,reason:"grounded-local-location-required"});
 const actors=actorRefs(s,input.actorRefs||input.actors);if(!actors)return F({ok:false,reason:"grounded-actor-reference-required"});
 const authSystem=authoritativeOptions(s,o),reportSystem=explicitReportOptions(s,o),epistemicStatus=authSystem?"confirmed":reportSystem?"reported":null,sourceSystem=authSystem||reportSystem;
 if(!epistemicStatus)return F({ok:false,reason:"validated-authority-or-bounded-report-required"});
 if(epistemicStatus==="confirmed"&&actors.length===0)return F({ok:false,reason:"confirmed-incident-actor-required"});
 if(epistemicStatus==="reported"&&!actors.some(x=>x.role==="reporter"||x.role==="witness"))return F({ok:false,reason:"reported-incident-reporter-required"});
 const summary=T(input.summary||input.label||cat,240);if(!summary)return F({ok:false,reason:"incident-summary-required"});
 const id="SEC-"+H(S({seed:s,category:cat,locationRef:loc,sourceSystem,sourceRef:src,startedTimestamp:when}));
 const opKey=operationKey(sourceSystem,op),signature="SECSIG-"+H(S({kind:"create",id,opKey,category:cat,severity:sev,epistemicStatus,summary,locationRef:loc,actorRefs:actors,sourceRef:src,fantasyTimestamp:when}));
 return F({ok:true,ctx,operationId:op,operationKey:opKey,signature,incident:F({id,category:cat,severity:sev,epistemicStatus,status:"active",summary,locationRef:loc,actorRefs:actors,sourceSystem,sourceRef:src,startedTimestamp:when,updatedTimestamp:when,resolution:null,legalGuilt:null,relationshipOutcome:null,combatOutcome:null})});
}
function record(seedValue,inputValue,optionsValue){
 let n;try{n=normalizeCreate(seedValue,inputValue,optionsValue)}catch(err){bump("rejections");return F({ok:false,reason:String(err.message||err)})}if(!n.ok){bump("rejections");return n}
 const r=read(n.ctx.seed);if(!r.ok){bump("rejections");return F({ok:false,reason:r.reason})}
 const existingOp=r.state.operations.find(x=>x.key===n.operationKey);if(existingOp){if(existingOp.signature!==n.signature){bump("rejections");return F({ok:false,reason:"duplicate-operation-conflict",incidentId:existingOp.incidentId})}bump("duplicates");return F({ok:true,reason:"duplicate",duplicate:true,incident:r.state.incidents.find(x=>x.id===existingOp.incidentId)||null,snapshot:snapshot(n.ctx.seed)})}
 const existingIncident=r.state.incidents.find(x=>x.id===n.incident.id);if(existingIncident){bump("duplicates");return F({ok:true,reason:"duplicate-incident",duplicate:true,incident:C(existingIncident),snapshot:snapshot(n.ctx.seed)})}
 const next=C(r.state);next.incidents=[...next.incidents,C(n.incident)].slice(-MAX_INCIDENTS);next.operations=[...next.operations,{key:n.operationKey,signature:n.signature,incidentId:n.incident.id}].slice(-MAX_OPERATIONS);next.revision+=1;next.lastFantasyTimestamp=n.incident.updatedTimestamp;
 const out=write(n.ctx,next,"local-security-incident:create:"+n.incident.id);if(!out.ok){bump("rejections");return out}bump("records");return F({...out,duplicate:false,incident:C(n.incident),snapshot:snapshot(n.ctx.seed)});
}
function resolveIncident(seedValue,incidentIdValue,evidenceValue,optionsValue){
 let s;try{s=seed(seedValue)}catch(err){bump("rejections");return F({ok:false,reason:String(err.message||err)})}
 const id=I(incidentIdValue,180),e=evidenceValue&&typeof evidenceValue==="object"?evidenceValue:{},o=optionsValue&&typeof optionsValue==="object"?optionsValue:{},system=authoritativeOptions(s,o),src=sourceRef(e.sourceRef||e.source),op=I(o.operationId||o.eventId,180),when=String(o.fantasyTimestamp||o.timestamp||now()||"");
 if(!id||!op||!validTs(when)||!system||!src||e.terminal!==true||!["resolved","cleared","dismissed"].includes(I(e.outcome,40).toLowerCase())){bump("rejections");return F({ok:false,reason:"validated-terminal-resolution-evidence-required"})}
 const r=read(s);if(!r.ok){bump("rejections");return F({ok:false,reason:r.reason})}const current=r.state.incidents.find(x=>x.id===id);if(!current){bump("rejections");return F({ok:false,reason:"incident-not-found"})}
 if(sec(when)<sec(current.startedTimestamp)){bump("rejections");return F({ok:false,reason:"resolution-before-incident"})}
 const opKey=operationKey(system,op),signature="SECSIG-"+H(S({kind:"resolve",id,opKey,outcome:I(e.outcome,40).toLowerCase(),sourceRef:src,fantasyTimestamp:when}));
 const existingOp=r.state.operations.find(x=>x.key===opKey);if(existingOp){if(existingOp.signature!==signature){bump("rejections");return F({ok:false,reason:"duplicate-operation-conflict",incidentId:id})}bump("duplicates");return F({ok:true,reason:"duplicate",duplicate:true,incident:C(r.state.incidents.find(x=>x.id===id)),snapshot:snapshot(s)})}
 if(current.status==="resolved"){bump("rejections");return F({ok:false,reason:"incident-already-resolved"})}
 const next=C(r.state),updated=C(current);updated.status="resolved";updated.updatedTimestamp=when;updated.resolution={outcome:I(e.outcome,40).toLowerCase(),sourceSystem:system,sourceRef:src,fantasyTimestamp:when};next.incidents=next.incidents.map(x=>x.id===id?updated:x);next.operations=[...next.operations,{key:opKey,signature,incidentId:id}].slice(-MAX_OPERATIONS);next.revision+=1;next.lastFantasyTimestamp=when;
 const out=write(r.ctx,next,"local-security-incident:resolve:"+id);if(!out.ok){bump("rejections");return out}bump("resolutions");return F({...out,duplicate:false,incident:F(updated),snapshot:snapshot(s)});
}
function snapshot(seedValue){
 let r;try{r=read(seedValue)}catch(err){return F({version:VERSION,compatible:false,reason:String(err.message||err),bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false})}
 if(!r.ok)return F({version:VERSION,compatible:false,reason:r.reason,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false});
 const st=r.state;return F({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,compatible:true,seed:r.ctx.seed,registryId:r.ctx.ref?.id||null,revision:st.revision,lastFantasyTimestamp:st.lastFantasyTimestamp,incidents:st.incidents.map(C),incidentCount:st.incidents.length,activeCount:st.incidents.filter(x=>x.status==="active").length,resolvedCount:st.incidents.filter(x=>x.status==="resolved").length,confirmedCount:st.incidents.filter(x=>x.epistemicStatus==="confirmed").length,reportedCount:st.incidents.filter(x=>x.epistemicStatus==="reported").length,operationCount:st.operations.length,serializedBytes:B(S(st)),maxStateBytes:MAX_STATE_BYTES,maxIncidents:MAX_INCIDENTS,maxOperations:MAX_OPERATIONS,maxActorRefs:MAX_ACTOR_REFS,maxActorReads:MAX_ACTOR_READS,maxLocationReads:MAX_LOCATION_READS,maxQueryResults:MAX_QUERY_RESULTS,localRadiusTiles:LOCAL_RADIUS_TILES,persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",confirmationAuthority:"validated Simulation/EventScheduler/WorldState evidence only",reportedEvidenceAuthority:"bounded explicit resident/event reports remain uncertain",legalAuthority:false,legalGuiltAuthority:false,combatResolutionAuthority:false,arrestAuthority:false,relationshipAuthority:false,propertyTransferAuthority:false,hiddenTruthReveal:false,directActionExecution:false,directWorldMutation:false,bounded:true,eventDriven:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false});
}
function list(seedValue,optionsValue){
 bump("queries");const o=optionsValue&&typeof optionsValue==="object"?optionsValue:{},snap=snapshot(seedValue);if(!snap.compatible)return F([]);
 const limit=Math.max(0,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(o.limit)||MAX_QUERY_RESULTS))),cat=o.category?category(o.category):null,status=o.status&&["active","resolved"].includes(I(o.status,20).toLowerCase())?I(o.status,20).toLowerCase():null,ep=o.epistemicStatus&&["confirmed","reported"].includes(I(o.epistemicStatus,20).toLowerCase())?I(o.epistemicStatus,20).toLowerCase():null;
 return F(snap.incidents.filter(x=>(!cat||x.category===cat)&&(!status||x.status===status)&&(!ep||x.epistemicStatus===ep)).sort((a,b)=>b.updatedTimestamp.localeCompare(a.updatedTimestamp)||b.id.localeCompare(a.id)).slice(0,limit).map(C));
}
function telemetry(){return F({...telemetryState,maxIncidents:MAX_INCIDENTS,maxOperations:MAX_OPERATIONS,maxQueryResults:MAX_QUERY_RESULTS,maxActorRefs:MAX_ACTOR_REFS,maxActorReads:MAX_ACTOR_READS,maxLocationReads:MAX_LOCATION_READS,maxStateBytes:MAX_STATE_BYTES,eventDriven:true,bounded:true,fullWorldScan:false,wholeSettlementScan:false,wholeHistoryScan:false,perFrameScan:false})}
function proof(seedValue){
 const s=seed(seedValue),base=root.DailyActivity?.build?.(s)||[],resident=base[0],when="1201-07-03 10:15:00";if(!resident)return F({pass:false,reason:"resident-unavailable"});
 const confirmed=record(s,{category:"banditry",severity:"serious",summary:"A validated local banditry incident.",locationRef:{kind:"settlement",id:"starting-village"},actorRefs:[{kind:"resident",id:resident.id,role:"witness"}],sourceRef:{kind:"simulation-event",id:"SIM-SEC-PROOF"}},{authority:"simulation",sourceSystem:"Simulation",authoritative:true,validated:true,campaignSeed:s,operationId:"SEC-PROOF-CREATE",fantasyTimestamp:when});
 const reported=record(s,{category:"security",severity:"moderate",summary:"A resident reports suspicious activity.",locationRef:{kind:"settlement",id:"starting-village"},actorRefs:[{kind:"resident",id:resident.id,role:"reporter"}],sourceRef:{kind:"resident-report",id:"REP-SEC-PROOF"}},{authority:"bounded-explicit-evidence",sourceSystem:"ResidentReport",authoritative:false,validated:false,campaignSeed:s,operationId:"SEC-PROOF-REPORT",fantasyTimestamp:"1201-07-03 10:16:00"});
 const closed=confirmed.ok?resolveIncident(s,confirmed.incident.id,{terminal:true,outcome:"resolved",sourceRef:{kind:"simulation-result",id:"SIM-SEC-PROOF-END"}},{authority:"simulation",sourceSystem:"Simulation",authoritative:true,validated:true,campaignSeed:s,operationId:"SEC-PROOF-RESOLVE",fantasyTimestamp:"1201-07-03 10:20:00"}):{ok:false};
 const snap=snapshot(s);return F({pass:Boolean(confirmed.ok&&reported.ok&&closed.ok&&snap.confirmedCount>=1&&snap.reportedCount>=1&&snap.resolvedCount>=1),confirmed,reported,closed,snapshot:snap,visual:"N/A"});
}
const api=F({VERSION,SCHEMA,SCHEMA_VERSION,CATEGORIES,SEVERITIES,MAX_INCIDENTS,MAX_OPERATIONS,MAX_QUERY_RESULTS,MAX_ACTOR_REFS,MAX_ACTOR_READS,MAX_LOCATION_READS,MAX_STATE_BYTES,LOCAL_RADIUS_TILES,record,resolveIncident,list,snapshot,telemetry,proof});
root.LocalSecurityIncidents=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();