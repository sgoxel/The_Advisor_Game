(function(root,factory){
"use strict";
const api=factory(root||globalThis);
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.ProtagonistJourney=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
"use strict";

const VERSION="protagonist-journey-v1";
const SCHEMA="ProtagonistJourneyLedger";
const SCHEMA_VERSION=1;
const REGISTRY_KIND="protagonist-journey-ledger";
const REGISTRY_KEY="persistent-journeys";
const MAX_HISTORY=8;
const MAX_SEGMENTS=64;
const MAX_ROUTE_STEPS=2048;
const MAX_LEDGER_BYTES=64*1024;
const MAX_ADVANCE_SECONDS=21600;
const STATUS_VALUES=Object.freeze(["travelling","paused","interrupted","cancelled","arrived"]);

function freeze(value){if(value==null||typeof value!=="object"||Object.isFrozen(value))return value;for(const item of Object.values(value))freeze(item);return Object.freeze(value);}
function clone(value){if(value==null||typeof value!=="object")return value;if(Array.isArray(value))return value.map(clone);const out={};for(const [k,v] of Object.entries(value))out[k]=clone(v);return out;}
function stable(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";}
function hashText(value){let h=2166136261>>>0;for(const ch of String(value==null?"":value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return(h>>>0).toString(16).toUpperCase().padStart(8,"0");}
function utf8Bytes(value){const text=String(value==null?"":value);if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(text).length;return unescape(encodeURIComponent(text)).length;}
function clean(value,max=160){return String(value==null?"":value).trim().replace(/\s+/g," ").slice(0,max);}
function cleanId(value,max=160){return clean(value,max).replace(/[^A-Za-z0-9:_|.@/\-]/g,"-");}
function plain(value){return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function point(value){if(!plain(value)||value.x==null||value.y==null)return null;return freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});}
function samePoint(a,b){return Boolean(a&&b&&String(a.x)===String(b.x)&&String(a.y)===String(b.y)&&Number(a.level||0)===Number(b.level||0));}
function validWhen(value){return /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(value||""));}
function timestamp(value){const out=clean(value,32);if(!validWhen(out))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");return out;}
function timestampParts(value){const m=String(value||"").match(/^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;const p={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};if(p.mo<1||p.mo>12||p.d<1||p.d>31||p.h>23||p.mi>59||p.s>59)return null;return p;}
function daysFromCivil(y,m,d){y-=m<=2?1:0;const era=Math.floor(y/400),yoe=y-era*400,mp=m+(m>2?-3:9),doy=Math.floor((153*mp+2)/5)+d-1,doe=yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy;return era*146097+doe;}
function secondIndex(value){const p=timestampParts(value);return p?daysFromCivil(p.y,p.mo,p.d)*86400+p.h*3600+p.mi*60+p.s:null;}
function currentTimestamp(){return root?.GameTime?.getTimestampKey?.()||null;}
function requiredSeed(value){const seed=clean(value,160);if(!seed)throw new Error("Campaign SEED is required.");return seed;}
function identityKey(value){return cleanId(value||"protagonist",96)||"protagonist";}
function protagonistId(seed,key){
  try{const p=root?.ProtagonistProfile?.derive?.(seed,key);if(p?.protagonistId)return String(p.protagonistId);}catch(_){}
  return "PROTAGONIST-"+hashText(seed+"|"+key+"|identity-v1");
}
function direction(from,to){
  const dx=BigInt(String(to.x))-BigInt(String(from.x)),dy=BigInt(String(to.y))-BigInt(String(from.y));
  return {dx:dx<0n?-1:dx>0n?1:0,dy:dy<0n?-1:dy>0n?1:0,steps:Number((dx<0n?-dx:dx)+(dy<0n?-dy:dy))};
}
function surfaceFor(seed,to){
  try{
    const state=root?.Walkability?.classify?.(seed,to.x,to.y);
    const terrain=cleanId(state?.terrainType||"",40).toLowerCase();
    const speeds=root?.WorldStandards?.WALK_SPEED_KMH||{};
    if(terrain&&Number(speeds[terrain])>0)return terrain;
    const category=String(state?.category||"").toLowerCase();
    if(category.includes("route"))return "road";
    if(category.includes("difficult"))return terrain||"difficult";
    if(category.includes("interior"))return "building";
  }catch(_){}
  return "unknown";
}
function fallbackEdgeSeconds(surface,distanceMeters){
  const speeds=root?.WorldStandards?.WALK_SPEED_KMH||{};
  const speed=Number(speeds[surface]||speeds.grass||3);
  return speed>0?distanceMeters/(speed*1000/3600):Infinity;
}
function normalizeRoutePlannerResult(seed,route,originValue,destinationValue){
  const origin=point(originValue),destination=point(destinationValue);
  if(!origin||!destination)return {ok:false,reason:"route-endpoints-required"};
  if(!route?.found)return {ok:false,reason:cleanId(route?.reason||"route-unavailable",120)||"route-unavailable"};
  const path=Array.isArray(route.path)?route.path.map(point).filter(Boolean):[];
  if(path.length<2)return {ok:false,reason:"route-zero-distance"};
  if(path.length-1>MAX_ROUTE_STEPS)return {ok:false,reason:"route-step-limit-exceeded"};
  if(!samePoint(path[0],origin)||!samePoint(path[path.length-1],destination))return {ok:false,reason:"route-endpoint-mismatch"};
  const tileMeters=Math.max(0.001,Number(root?.WorldStandards?.TILE_METERS||2));
  const raw=[];
  for(let i=1;i<path.length;i++){
    const from=path[i-1],to=path[i],d=direction(from,to);
    if(d.steps<=0)return {ok:false,reason:"route-nonmoving-edge"};
    const distanceMeters=tileMeters*d.steps;
    let seconds=NaN;
    try{seconds=Number(root?.RoutePlanner?.routeEdgeCost?.(seed,from,to)?.seconds);}catch(_){}
    const surface=surfaceFor(seed,to);
    if(!Number.isFinite(seconds)||seconds<=0)seconds=fallbackEdgeSeconds(surface,distanceMeters);
    if(!Number.isFinite(seconds)||seconds<=0)return {ok:false,reason:"route-edge-time-invalid"};
    raw.push({from,to,dx:d.dx,dy:d.dy,surface,distanceMeters,seconds});
  }
  const segments=[];
  for(const edge of raw){
    const prev=segments[segments.length-1];
    if(prev&&prev.dx===edge.dx&&prev.dy===edge.dy&&prev.surface===edge.surface){
      prev.to=edge.to;prev.distanceMeters+=edge.distanceMeters;prev.seconds+=edge.seconds;continue;
    }
    segments.push(clone(edge));
    if(segments.length>MAX_SEGMENTS)return {ok:false,reason:"route-segment-limit-exceeded"};
  }
  for(const seg of segments){
    seg.distanceMeters=Number(seg.distanceMeters.toFixed(6));
    seg.seconds=Number(seg.seconds.toFixed(6));
    seg.speedKmh=Number((seg.distanceMeters/seg.seconds*3.6).toFixed(6));
    delete seg.dx;delete seg.dy;
  }
  const totalMeters=Number(segments.reduce((n,s)=>n+s.distanceMeters,0).toFixed(6));
  const totalSeconds=Number(segments.reduce((n,s)=>n+s.seconds,0).toFixed(6));
  if(totalMeters<=0||totalSeconds<=0)return {ok:false,reason:"route-zero-distance"};
  const basis={origin,destination,path:path.map(p=>[p.x,p.y,p.level||0]),segments:segments.map(s=>[s.from.x,s.from.y,s.to.x,s.to.y,s.surface,s.distanceMeters,s.seconds])};
  const signature="RSIG-"+hashText(stable(basis));
  return freeze({ok:true,reason:"route-valid",source:"RoutePlanner",routeId:"ROUTE-"+hashText(stable({seed,signature,origin,destination})),signature,origin,destination,segments:freeze(segments.map(freeze)),totalMeters,totalSeconds,stepCount:path.length-1});
}
function defaultRouteValidator(seed,origin,destination,expectedSignature){
  const planner=root?.RoutePlanner;
  if(!planner?.findRoute)return freeze({ok:false,reason:"route-planner-unavailable"});
  const route=planner.findRoute(seed,origin,destination,{maxDistanceTiles:MAX_ROUTE_STEPS,maxNodes:12000});
  const normalized=normalizeRoutePlannerResult(seed,route,origin,destination);
  if(!normalized.ok)return freeze(normalized);
  if(expectedSignature&&normalized.signature!==expectedSignature)return freeze({ok:false,reason:"route-stale",expectedSignature,currentSignature:normalized.signature});
  return normalized;
}
function normalizeValidatedRoute(value){
  if(!plain(value)||value.ok!==true)return null;
  const origin=point(value.origin),destination=point(value.destination),segments=Array.isArray(value.segments)?value.segments:[];
  if(!origin||!destination||samePoint(origin,destination)||!segments.length||segments.length>MAX_SEGMENTS)return null;
  const normalized=[];
  for(const seg of segments){
    const from=point(seg.from),to=point(seg.to),distanceMeters=Number(seg.distanceMeters),seconds=Number(seg.seconds);
    if(!from||!to||!Number.isFinite(distanceMeters)||distanceMeters<=0||!Number.isFinite(seconds)||seconds<=0)return null;
    normalized.push(freeze({from,to,surface:cleanId(seg.surface||"unknown",40)||"unknown",distanceMeters:Number(distanceMeters.toFixed(6)),seconds:Number(seconds.toFixed(6)),speedKmh:Number((distanceMeters/seconds*3.6).toFixed(6))}));
  }
  if(!samePoint(normalized[0].from,origin)||!samePoint(normalized[normalized.length-1].to,destination))return null;
  for(let i=1;i<normalized.length;i++)if(!samePoint(normalized[i-1].to,normalized[i].from))return null;
  const totalMeters=Number(normalized.reduce((n,s)=>n+s.distanceMeters,0).toFixed(6)),totalSeconds=Number(normalized.reduce((n,s)=>n+s.seconds,0).toFixed(6));
  const signature=cleanId(value.signature,160),routeId=cleanId(value.routeId,160);
  if(!/^RSIG-[0-9A-F]{8}$/.test(signature)||!/^ROUTE-[0-9A-F]{8}$/.test(routeId))return null;
  return freeze({ok:true,reason:"route-valid",source:clean(value.source||"validated-route",80),routeId,signature,origin,destination,segments:freeze(normalized),totalMeters,totalSeconds,stepCount:Number(value.stepCount||normalized.length)});
}
function registryContext(worldState,seedValue,identityValue){
  const seed=requiredSeed(seedValue),key=identityKey(identityValue),actorId=protagonistId(seed,key);
  const ref=worldState?.structuralRef?.(seed,REGISTRY_KIND,actorId,REGISTRY_KEY,{role:"persistent-protagonist-journey",protagonistId:actorId,identityKey:key,authority:"ProtagonistJourney travel-progress state"})||null;
  return freeze({seed,identityKey:key,protagonistId:actorId,ref});
}
function emptyLedger(ctx){return {schema:SCHEMA,schemaVersion:SCHEMA_VERSION,version:VERSION,seed:ctx.seed,protagonistId:ctx.protagonistId,identityKey:ctx.identityKey,registryId:ctx.ref?.id||null,revision:0,active:null,history:[],bounds:{maxHistory:MAX_HISTORY,maxSegments:MAX_SEGMENTS,maxBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}};}
function activeShapeValid(row){
  if(!row||!/^JRN-[0-9A-F]{8}$/.test(String(row.journeyId||""))||!["travelling","paused","interrupted"].includes(row.status))return false;
  if(!validWhen(row.startedFantasyTimestamp)||!validWhen(row.updatedFantasyTimestamp)||!row.route||!Array.isArray(row.route.segments)||row.route.segments.length>MAX_SEGMENTS)return false;
  if(!/^ROUTE-[0-9A-F]{8}$/.test(String(row.route.routeId||""))||!/^RSIG-[0-9A-F]{8}$/.test(String(row.route.signature||"")))return false;
  if(!Number.isFinite(Number(row.progressMeters))||row.progressMeters<0||row.progressMeters>row.route.totalMeters+1e-6)return false;
  if(!Number.isInteger(row.segmentIndex)||row.segmentIndex<0||row.segmentIndex>row.route.segments.length)return false;
  return true;
}
function historyShapeValid(row){return Boolean(row&&/^JRN-[0-9A-F]{8}$/.test(String(row.journeyId||""))&&["cancelled","arrived"].includes(row.status)&&validWhen(row.startedFantasyTimestamp)&&validWhen(row.updatedFantasyTimestamp)&&/^ROUTE-[0-9A-F]{8}$/.test(String(row.routeId||""))&&/^RSIG-[0-9A-F]{8}$/.test(String(row.routeSignature||"")));}
function ledgerCompatible(raw,ctx){
  if(!plain(raw)||raw.schema!==SCHEMA||Number(raw.schemaVersion)!==SCHEMA_VERSION||raw.version!==VERSION||raw.seed!==ctx.seed||raw.protagonistId!==ctx.protagonistId||raw.identityKey!==ctx.identityKey||raw.registryId!==(ctx.ref?.id||null))return false;
  if(raw.active!=null&&!activeShapeValid(raw.active))return false;
  if(!Array.isArray(raw.history)||raw.history.length>MAX_HISTORY||!raw.history.every(historyShapeValid))return false;
  return utf8Bytes(stable(raw))<=MAX_LEDGER_BYTES;
}
function terminalSummary(row){
  return freeze({journeyId:row.journeyId,actorId:row.actorId,status:row.status,reason:row.reason||null,startedFantasyTimestamp:row.startedFantasyTimestamp,updatedFantasyTimestamp:row.updatedFantasyTimestamp,routeId:row.route.routeId,routeSignature:row.route.signature,origin:row.route.origin,destination:row.route.destination,totalMeters:row.route.totalMeters,totalSeconds:row.route.totalSeconds,progressMeters:Number(row.progressMeters.toFixed(6)),progressRatio:Number((row.progressMeters/row.route.totalMeters).toFixed(6)),finalRoutePoint:row.status==="arrived"?row.route.destination:null});
}
function positionProjection(row){
  if(!row)return null;
  if(row.status==="arrived"||row.segmentIndex>=row.route.segments.length)return freeze({atEndpoint:true,point:row.route.destination});
  const seg=row.route.segments[row.segmentIndex],fraction=Math.max(0,Math.min(1,Number(row.segmentElapsedSeconds||0)/seg.seconds));
  return freeze({atEndpoint:false,from:seg.from,to:seg.to,fraction:Number(fraction.toFixed(6)),surface:seg.surface});
}

function createService(optionsValue){
  const options=plain(optionsValue)?optionsValue:{};
  const world=()=>options.worldState||root?.WorldState;
  const validate=(seed,origin,destination,expected)=> {
    const raw=(options.routeValidator||defaultRouteValidator)(seed,origin,destination,expected);
    const normalized=normalizeValidatedRoute(raw)||raw;
    if(!normalized?.ok)return freeze({ok:false,reason:cleanId(normalized?.reason||"route-invalid",120)||"route-invalid"});
    if(expected&&normalized.signature!==expected)return freeze({ok:false,reason:"route-stale",expectedSignature:expected,currentSignature:normalized.signature});
    return normalized;
  };
  function readLedger(seedValue,identityValue){
    const ws=world(),ctx=registryContext(ws,seedValue,identityValue),resolved=ctx.ref&&ws?.resolve?.(ctx.seed,ctx.ref)||null,raw=resolved?.current?.protagonistJourney;
    if(raw==null)return {ctx,resolved,compatible:true,exists:false,ledger:emptyLedger(ctx),reason:"empty"};
    if(!ledgerCompatible(raw,ctx))return {ctx,resolved,compatible:false,exists:true,ledger:null,reason:"ledger-incompatible"};
    return {ctx,resolved,compatible:true,exists:true,ledger:clone(raw),reason:"ok"};
  }
  function writeLedger(seedValue,identityValue,ledgerValue,reasonValue){
    const ws=world(),read=readLedger(seedValue,identityValue),ctx=read.ctx;
    if(!read.compatible)return freeze({ok:false,reason:read.reason});
    if(!ctx.ref||!ws?.applyDelta)return freeze({ok:false,reason:"world-state-unavailable"});
    const next=clone(ledgerValue);next.schema=SCHEMA;next.schemaVersion=SCHEMA_VERSION;next.version=VERSION;next.seed=ctx.seed;next.protagonistId=ctx.protagonistId;next.identityKey=ctx.identityKey;next.registryId=ctx.ref.id;next.revision=Math.max(0,Number(next.revision)||0)+1;
    if(!ledgerCompatible(next,ctx))return freeze({ok:false,reason:"ledger-invalid-or-over-budget"});
    const result=ws.applyDelta(ctx.seed,ctx.ref,{protagonistJourney:next},String(reasonValue||"protagonist-journey"));
    return freeze({ok:Boolean(result?.ok),reason:result?.reason||"ok",ledgerRevision:next.revision,deltaRevision:Number(result?.entry?.revision||0),serializedBytes:utf8Bytes(stable(next))});
  }
  function start(seedValue,inputValue,identityValue){
    let seed;try{seed=requiredSeed(seedValue);}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const input=plain(inputValue)?inputValue:{},read=readLedger(seed,identityValue);
    if(!read.compatible)return freeze({ok:false,reason:read.reason});
    let when;try{when=timestamp(input.fantasyTimestamp||input.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    if(read.ledger.active)return freeze({ok:false,reason:"active-journey-exists",journey:freeze(clone(read.ledger.active))});
    const origin=point(input.origin),destination=point(input.destination);
    if(!origin||!destination)return freeze({ok:false,reason:"route-endpoints-required"});
    if(samePoint(origin,destination))return freeze({ok:false,reason:"route-zero-distance"});
    const checked=validate(seed,origin,destination,input.routeSignature||null);
    if(!checked.ok)return freeze({ok:false,reason:checked.reason});
    const route=normalizeValidatedRoute(checked);if(!route)return freeze({ok:false,reason:"route-normalization-failed"});
    const actorId=read.ctx.protagonistId,externalKey=cleanId(input.externalKey||input.attemptId||input.planId||"",160)||null;
    const journeyId="JRN-"+hashText(stable({seed,actorId,when,routeSignature:route.signature,origin,destination,externalKey}));
    const existing=read.ledger.history.find(x=>x.journeyId===journeyId);if(existing)return freeze({ok:true,reason:"duplicate-terminal",duplicate:true,journey:freeze(clone(existing))});
    const active={journeyId,actorId,status:"travelling",reason:"started",startedFantasyTimestamp:when,updatedFantasyTimestamp:when,revision:1,externalKey,route,progressMeters:0,travelledFantasySeconds:0,segmentIndex:0,segmentElapsedSeconds:0,routeValidationSource:route.source};
    const next=clone(read.ledger);next.active=active;
    const write=writeLedger(seed,identityValue,next,"protagonist-journey-start:"+journeyId);
    return freeze({...write,duplicate:false,journey:write.ok?freeze({...clone(active),routeProjection:positionProjection(active)}):null});
  }
  function mutateStatus(seedValue,status,optionsValue,identityValue){
    const seed=requiredSeed(seedValue),options=plain(optionsValue)?optionsValue:{},read=readLedger(seed,identityValue);
    if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const current=read.ledger.active;if(!current)return freeze({ok:false,reason:"no-active-journey"});
    let when;try{when=timestamp(options.fantasyTimestamp||options.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    if(secondIndex(when)<secondIndex(current.updatedFantasyTimestamp))return freeze({ok:false,reason:"cannot-rewind-journey-chronology"});
    const allowed={travelling:["paused","interrupted","cancelled"],paused:["travelling","interrupted","cancelled"],interrupted:["travelling","paused","cancelled"]};
    if(!allowed[current.status]?.includes(status))return freeze({ok:false,reason:"invalid-status-transition"});
    const row=clone(current);row.status=status;row.reason=clean(options.reason||status,160)||status;row.updatedFantasyTimestamp=when;row.revision++;
    const next=clone(read.ledger);
    if(status==="cancelled"){next.active=null;next.history.push(clone(terminalSummary(row)));next.history=next.history.slice(-MAX_HISTORY);}
    else next.active=row;
    const write=writeLedger(seed,identityValue,next,"protagonist-journey-"+status+":"+row.journeyId);
    return freeze({...write,journey:write.ok?freeze(status==="cancelled"?clone(next.history[next.history.length-1]):{...clone(row),routeProjection:positionProjection(row)}):null});
  }
  function pause(seed,options,identity){return mutateStatus(seed,"paused",options,identity);}
  function interrupt(seed,options,identity){return mutateStatus(seed,"interrupted",options,identity);}
  function resume(seed,options,identity){return mutateStatus(seed,"travelling",options,identity);}
  function cancel(seed,options,identity){return mutateStatus(seed,"cancelled",options,identity);}
  function advance(seedValue,optionsValue,identityValue){
    const seed=requiredSeed(seedValue),options=plain(optionsValue)?optionsValue:{},read=readLedger(seed,identityValue);
    if(!read.compatible)return freeze({ok:false,reason:read.reason});
    const current=read.ledger.active;if(!current)return freeze({ok:false,reason:"no-active-journey"});
    if(current.status!=="travelling")return freeze({ok:false,reason:"journey-not-travelling",status:current.status});
    let when;try{when=timestamp(options.fantasyTimestamp||options.when||currentTimestamp());}catch(error){return freeze({ok:false,reason:String(error.message||error)});}
    const now=secondIndex(when),previous=secondIndex(current.updatedFantasyTimestamp);
    if(now<previous)return freeze({ok:false,reason:"cannot-rewind-journey-chronology"});
    const revalidated=validate(seed,current.route.origin,current.route.destination,current.route.signature);
    if(!revalidated.ok)return freeze({ok:false,reason:revalidated.reason,journeyId:current.journeyId,progressMeters:current.progressMeters});
    const elapsed=Math.max(0,now-previous);if(elapsed===0)return freeze({ok:true,reason:"no-time-elapsed",journey:freeze({...clone(current),routeProjection:positionProjection(current)}),processedSeconds:0,unprocessedSeconds:0});
    let budget=Math.min(elapsed,MAX_ADVANCE_SECONDS),remaining=budget,row=clone(current),used=0;
    while(remaining>1e-9&&row.segmentIndex<row.route.segments.length){
      const seg=row.route.segments[row.segmentIndex],left=Math.max(0,seg.seconds-row.segmentElapsedSeconds),take=Math.min(remaining,left),fraction=take/seg.seconds;
      row.segmentElapsedSeconds=Number((row.segmentElapsedSeconds+take).toFixed(6));
      row.progressMeters=Number(Math.min(row.route.totalMeters,row.progressMeters+seg.distanceMeters*fraction).toFixed(6));
      row.travelledFantasySeconds=Number((row.travelledFantasySeconds+take).toFixed(6));
      remaining-=take;used+=take;
      if(row.segmentElapsedSeconds>=seg.seconds-1e-6){row.segmentIndex++;row.segmentElapsedSeconds=0;}
    }
    row.updatedFantasyTimestamp=when;row.revision++;
    let arrived=false;
    if(row.segmentIndex>=row.route.segments.length||row.progressMeters>=row.route.totalMeters-1e-6){
      arrived=true;row.status="arrived";row.reason="validated-route-endpoint-reached";row.progressMeters=row.route.totalMeters;row.segmentIndex=row.route.segments.length;row.segmentElapsedSeconds=0;
    }else row.reason="travel-progress";
    const next=clone(read.ledger);
    if(arrived){next.active=null;next.history.push(clone(terminalSummary(row)));next.history=next.history.slice(-MAX_HISTORY);}
    else next.active=row;
    const write=writeLedger(seed,identityValue,next,arrived?"protagonist-journey-arrived:"+row.journeyId:"protagonist-journey-progress:"+row.journeyId);
    const journey=arrived?clone(next.history[next.history.length-1]):{...clone(row),routeProjection:positionProjection(row)};
    return freeze({...write,arrived,journey:write.ok?freeze(journey):null,processedSeconds:Number(used.toFixed(6)),unprocessedSeconds:Number(Math.max(0,elapsed-used).toFixed(6)),boundedAdvance:elapsed>MAX_ADVANCE_SECONDS});
  }
  function snapshot(seedValue,identityValue){
    const seed=requiredSeed(seedValue),read=readLedger(seed,identityValue);
    if(!read.compatible)return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,compatible:false,reason:read.reason,active:null,history:freeze([]),bounded:true});
    const active=read.ledger.active?freeze({...clone(read.ledger.active),routeProjection:positionProjection(read.ledger.active)}):null;
    return freeze({version:VERSION,schema:SCHEMA,schemaVersion:SCHEMA_VERSION,seed,protagonistId:read.ctx.protagonistId,identityKey:read.ctx.identityKey,registryId:read.ctx.ref?.id||null,compatible:true,reason:read.reason,active,history:freeze(read.ledger.history.map(x=>freeze(clone(x)))),historyCount:read.ledger.history.length,serializedBytes:utf8Bytes(stable(read.ledger)),bounds:freeze({maxHistory:MAX_HISTORY,maxSegments:MAX_SEGMENTS,maxRouteSteps:MAX_ROUTE_STEPS,maxLedgerBytes:MAX_LEDGER_BYTES,maxAdvanceSeconds:MAX_ADVANCE_SECONDS}),persistenceAuthority:"WorldState CampaignStateDelta",chronologyAuthority:"Fantasy Game Time",routeAuthority:"RoutePlanner validated route",worldPositionAuthority:false,directPositionMutation:false,teleportation:false,fullWorldScan:false,perFramePathPlanning:false,cameraDependency:false,viewportDependency:false,deviceDependency:false});
  }
  return freeze({start,advance,pause,interrupt,resume,cancel,snapshot});
}

const service=createService();
return freeze({VERSION,SCHEMA,SCHEMA_VERSION,REGISTRY_KIND,REGISTRY_KEY,MAX_HISTORY,MAX_SEGMENTS,MAX_ROUTE_STEPS,MAX_LEDGER_BYTES,MAX_ADVANCE_SECONDS,STATUS_VALUES,createService,start:service.start,advance:service.advance,pause:service.pause,interrupt:service.interrupt,resume:service.resume,cancel:service.cancel,snapshot:service.snapshot});
});
