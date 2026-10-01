(function(){
"use strict";

const VERSION="1.2.0";
const START_KIND="local-vignette-start";
const END_KIND="local-vignette-end";
const MAX_ACTIVE_EVENTS=2;
const MAX_PARTICIPANTS=4;
const MAX_DAYS_TRACKED=4;
const PROCESS_LIMIT=8;
const AUTO_TICK_MS=1000;

const CATALOG=Object.freeze([
  Object.freeze({id:"market-day-setup",title:"Market-day setup",icon:"⚒",minute:8*60+20,durationMinutes:55,preferred:["shopkeeper","farmer","guard"],description:"Residents prepare stalls and supplies for the village market."}),
  Object.freeze({id:"village-gathering",title:"Village gathering",icon:"◉",minute:12*60+10,durationMinutes:45,preferred:["tavern-keeper","guard","farmer"],description:"A small public gathering briefly changes the village routine."}),
  Object.freeze({id:"minor-argument",title:"Minor public dispute",icon:"!",minute:16*60+15,durationMinutes:24,preferred:["guard","shopkeeper","woodcutter"],description:"A brief disagreement draws a few nearby residents before dispersing."}),
  Object.freeze({id:"predator-warning",title:"Nearby predator warning",icon:"▲",minute:19*60+5,durationMinutes:35,preferred:["guard","woodcutter","farmer"],description:"Residents pause normal activity while a local warning is passed around."})
]);

const runtimeBySeed=new Map();
let activeSeed=null;
let autoTimer=0;

function clone(v){
  if(v==null||typeof v!=="object")return v;
  if(Array.isArray(v))return v.map(clone);
  const out={};for(const [k,x] of Object.entries(v))out[k]=clone(x);return out;
}
function freeze(v){
  if(v==null||typeof v!=="object"||Object.isFrozen(v))return v;
  for(const x of Object.values(v))freeze(x);return Object.freeze(v);
}
function hashText(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function requiredSeed(value){
  const seed=String(value==null?"":value);if(!seed)throw new Error("Campaign SEED is required.");return seed;
}
function normalizeTimestamp(value){
  const s=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");
  return s;
}
function state(seedValue){
  const seed=requiredSeed(seedValue);
  if(!runtimeBySeed.has(seed))runtimeBySeed.set(seed,{
    seed,plannedDays:[],active:new Map(),residentIndex:new Map(),
    started:0,ended:0,processedBatches:0,maxBatch:0,lastProcessedTimestamp:null,
    renderCount:0,lastRenderMs:0,maxRenderMs:0,lastEventId:null,
    cardPlacementCount:0,lastCardPlacementMs:0,maxCardPlacementMs:0,lastCardPlacement:"top-right",lastCardParticipantBoundCount:0,lastCardOverlapArea:0
  });
  return runtimeBySeed.get(seed);
}
function parts(timestamp){
  const m=normalizeTimestamp(timestamp).match(/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return {year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])};
}
function stamp(p){
  const pad=n=>String(n).padStart(2,"0");
  return String(p.year).padStart(4,"0")+"-"+pad(p.month)+"-"+pad(p.day)+" "+pad(p.hour)+":"+pad(p.minute)+":"+pad(p.second||0);
}
function addMinutes(timestamp,minutes){
  const p=parts(timestamp);
  const d=new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second||0));
  d.setUTCMinutes(d.getUTCMinutes()+Number(minutes||0));
  return stamp({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()});
}
function dayKey(timestamp){return normalizeTimestamp(timestamp).slice(0,10)}
function minuteTimestamp(day,minute){
  const h=Math.floor(minute/60),m=((minute%60)+60)%60;
  return day+" "+String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":00";
}
function score(seed,day,type,residentId){
  if(window.PRNG?.liveAddressedUint32)return window.PRNG.liveAddressedUint32(seed,day+" 00:00:00","local-vignette-plan",String(residentId),String(type))>>>0;
  return parseInt(hashText([seed,day,type,residentId].join("|")),16)>>>0;
}
function roster(seed){return (window.DailyActivity?.build?.(seed)||[]).slice(0,12)}
function targetOf(resident){
  const p=resident?.workplaceTarget||resident?.homeTarget||null;
  if(!p)return null;
  return freeze({x:String(p.x),y:String(p.y),level:Number(p.level||0)});
}
function pickParticipants(seed,day,spec,residents){
  const ranked=residents.map(r=>{
    const preferred=Math.max(0,spec.preferred.indexOf(String(r.profession||"")));
    const preference=spec.preferred.includes(String(r.profession||""))?spec.preferred.indexOf(String(r.profession||"")):99;
    return {resident:r,preference,score:score(seed,day,spec.id,r.id)};
  }).filter(x=>targetOf(x.resident)).sort((a,b)=>a.preference-b.preference||a.score-b.score||String(a.resident.id).localeCompare(String(b.resident.id)));
  const desired=Math.min(MAX_PARTICIPANTS,Math.max(2,2+(score(seed,day,spec.id,"count")%3)));
  return ranked.slice(0,desired).map(x=>x.resident);
}
function locationFor(spec,participants){
  const preferred=participants.find(r=>spec.preferred.includes(String(r.profession||"")))||participants[0]||null;
  const anchor=targetOf(preferred);
  if(!anchor)return null;
  const source=preferred.workplaceTarget?"workplaceTarget":"homeTarget";
  const label=preferred.workplaceId?String(preferred.workplaceId).replace(/[-_:]+/g," "):"village activity point";
  return freeze({anchor,label,source,residentId:preferred.id});
}
function stagingPoint(seed,x,y,strict){
  const classify=window.Walkability?.classify;if(typeof classify!=="function")return null;
  let center=null;try{center=classify(seed,String(x),String(y));}catch(_){center=null}
  if(!center?.walkable||center?.buildingId)return null;
  if(strict){
    // Keep event actors out of the immediate roof/footprint occlusion zone.
    // This is event-time bounded validation, never a per-frame scan.
    const clearance=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]];
    for(const [dx,dy] of clearance){
      let nav=null;try{nav=classify(seed,String(x+BigInt(dx)),String(y+BigInt(dy)));}catch(_){nav=null}
      if(nav?.buildingId)return null;
    }
  }
  return freeze({x:String(x),y:String(y),level:Number(center.level||0)});
}
function stagingTargets(seed,day,spec,anchor,participants){
  const count=Math.min(MAX_PARTICIPANTS,participants.length),ax=BigInt(anchor.x),ay=BigInt(anchor.y),centerCandidates=[];
  for(let radius=3;radius<=5;radius++){
    const ring=[];
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){
      if(Math.max(Math.abs(ox),Math.abs(oy))!==radius)continue;
      ring.push({ox,oy,tie:score(seed,day,spec.id,"cluster-center:"+radius+":"+ox+":"+oy)});
    }
    ring.sort((u,v)=>u.tie-v.tie||u.oy-v.oy||u.ox-v.ox);centerCandidates.push(...ring);
  }
  const tryCenter=(candidate,strict)=>{
    const cx=ax+BigInt(candidate.ox),cy=ay+BigInt(candidate.oy),center=stagingPoint(seed,cx,cy,strict);
    if(!center)return null;
    const offsets=[];
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)offsets.push({ox,oy,tie:score(seed,day,spec.id,"cluster-slot:"+center.x+":"+center.y+":"+ox+":"+oy)});
    offsets.sort((u,v)=>{
      const uc=u.ox===0&&u.oy===0?0:1,vc=v.ox===0&&v.oy===0?0:1;
      return uc-vc||u.tie-v.tie||u.oy-v.oy||u.ox-v.ox;
    });
    const out=[];
    for(const slot of offsets){
      if(out.length>=count)break;
      const x=cx+BigInt(slot.ox),y=cy+BigInt(slot.oy),fromAnchor=Math.max(Math.abs(Number(x-ax)),Math.abs(Number(y-ay)));
      if(fromAnchor<2||fromAnchor>6)continue;
      const point=stagingPoint(seed,x,y,strict);if(!point||out.some(p=>p.x===point.x&&p.y===point.y))continue;
      out.push(point);
    }
    return out.length>=count?{center,targets:out.slice(0,count)}:null;
  };
  let cluster=null;
  for(const strict of [true,false]){
    for(const candidate of centerCandidates){cluster=tryCenter(candidate,strict);if(cluster)break;}
    if(cluster)break;
  }
  if(cluster)return freeze({center:cluster.center,targets:freeze(cluster.targets),clusterRadiusTiles:1,source:"compact-walkable-cluster-v2"});
  const fallback=[];
  for(const candidate of centerCandidates){
    if(fallback.length>=count)break;
    const point=stagingPoint(seed,ax+BigInt(candidate.ox),ay+BigInt(candidate.oy),false);
    if(point&&!fallback.some(p=>p.x===point.x&&p.y===point.y))fallback.push(point);
  }
  while(fallback.length<count)fallback.push(freeze({x:String(anchor.x),y:String(anchor.y),level:Number(anchor.level||0)}));
  return freeze({center:fallback[0]||anchor,targets:freeze(fallback.slice(0,count)),clusterRadiusTiles:null,source:"bounded-walkable-staging-fallback"});
}
function descriptor(seed,day,spec){
  const residents=roster(seed),participants=pickParticipants(seed,day,spec,residents);
  if(participants.length<2)return null;
  const location=locationFor(spec,participants);if(!location)return null;
  const staging=stagingTargets(seed,day,spec,location.anchor,participants);
  const jitter=(score(seed,day,spec.id,"slot")%21)-10;
  const startTimestamp=minuteTimestamp(day,spec.minute+jitter);
  const durationMinutes=spec.durationMinutes+(score(seed,day,spec.id,"duration")%16);
  const eventId="LVE|"+hashText([seed,day,spec.id].join("|"));
  return freeze({
    id:eventId,type:spec.id,title:spec.title,icon:spec.icon,description:spec.description,
    startTimestamp,endTimestamp:addMinutes(startTimestamp,durationMinutes),durationMinutes,
    location,stagingCenter:staging.center,stagingRadiusTiles:staging.clusterRadiusTiles,stagingMode:staging.source,
    participants:Object.freeze(participants.map((r,index)=>freeze({
      id:String(r.id),name:String(r.displayName||r.name||r.id),profession:String(r.profession||"resident"),
      existingTarget:targetOf(r),eventTarget:staging.targets[index]||location.anchor,
      eventTargetSource:staging.targets[index]&&(staging.targets[index].x!==location.anchor.x||staging.targets[index].y!==location.anchor.y)?"bounded-walkable-staging":"event-anchor-fallback"
    }))),
    participantCount:participants.length,seedOnly:true,scheduleOverride:true,temporary:true
  });
}
function planDay(seedValue,dayValue){
  const seed=requiredSeed(seedValue),day=String(dayValue||"");
  if(!/^\d{4,}-\d{2}-\d{2}$/.test(day))throw new Error("Day must be YYYY-MM-DD.");
  return freeze(CATALOG.map(spec=>descriptor(seed,day,spec)).filter(Boolean));
}
function scheduleDescriptor(seed,event,slotPrefix="day"){
  const scheduler=window.EventScheduler;if(!scheduler?.schedule)return false;
  scheduler.schedule(seed,{
    fantasyTimestamp:event.startTimestamp,systemKind:START_KIND,entityId:event.id,slotKey:slotPrefix+":start:"+event.type,
    payload:{event:clone(event)}
  });
  scheduler.schedule(seed,{
    fantasyTimestamp:event.endTimestamp,systemKind:END_KIND,entityId:event.id,slotKey:slotPrefix+":end:"+event.type,
    payload:{eventId:event.id,type:event.type}
  });
  return true;
}
function ensureScheduled(seedValue,nowValue){
  const seed=requiredSeed(seedValue),now=normalizeTimestamp(nowValue),mem=state(seed),day=dayKey(now);
  if(mem.plannedDays.includes(day))return freeze({day,scheduled:0,alreadyPlanned:true});
  const events=planDay(seed,day);
  let scheduled=0;for(const event of events)if(scheduleDescriptor(seed,event,"day:"+day))scheduled+=2;
  mem.plannedDays.push(day);if(mem.plannedDays.length>MAX_DAYS_TRACKED)mem.plannedDays.splice(0,mem.plannedDays.length-MAX_DAYS_TRACKED);
  return freeze({day,scheduled,alreadyPlanned:false,eventCount:events.length});
}
function rebuildResidentIndex(mem){
  mem.residentIndex.clear();
  const active=[...mem.active.values()].sort((a,b)=>a.startTimestamp.localeCompare(b.startTimestamp)||a.id.localeCompare(b.id));
  for(const event of active){
    for(const p of event.participants){
      if(!mem.residentIndex.has(p.id))mem.residentIndex.set(p.id,event.id);
    }
  }
}
function activate(mem,event){
  if(!event||mem.active.has(event.id))return;
  if(mem.active.size>=MAX_ACTIVE_EVENTS){
    const oldest=[...mem.active.values()].sort((a,b)=>a.startTimestamp.localeCompare(b.startTimestamp)||a.id.localeCompare(b.id))[0];
    if(oldest)mem.active.delete(oldest.id);
  }
  mem.active.set(event.id,freeze(clone(event)));mem.started++;mem.lastEventId=event.id;rebuildResidentIndex(mem);
}
function deactivate(mem,eventId){
  if(mem.active.delete(String(eventId||""))){mem.ended++;rebuildResidentIndex(mem);}
}
function processEvent(mem,record){
  const event=record?.event||record;
  if(event.systemKind===START_KIND)activate(mem,event.payload?.event);
  else if(event.systemKind===END_KIND)deactivate(mem,event.payload?.eventId||event.entityId);
  return {kind:event.systemKind,eventId:event.entityId};
}
function advance(seedValue,nowValue,optionsValue){
  const seed=requiredSeed(seedValue),now=normalizeTimestamp(nowValue),mem=state(seed),options=optionsValue||{};
  activeSeed=seed;if(options.ensureScheduled!==false)ensureScheduled(seed,now);
  if(mem.lastProcessedTimestamp===now){renderCard(seed);return snapshot(seed);}
  const result=window.EventScheduler?.processDue?.(seed,now,{
    maxEvents:PROCESS_LIMIT,priority:"nearby",systemKinds:[START_KIND,END_KIND],
    handle:(event,randomUint32)=>processEvent(mem,{event,randomUint32})
  })||{processedCount:0,processed:[],pendingMatching:0,hasMoreDue:false};
  mem.processedBatches++;mem.maxBatch=Math.max(mem.maxBatch,Number(result.processedCount||0));mem.lastProcessedTimestamp=now;
  renderCard(seed);
  return snapshot(seed);
}
function stateFor(residentId,seedValue){
  const seed=String(seedValue||activeSeed||"");if(!seed||!runtimeBySeed.has(seed))return null;
  const mem=runtimeBySeed.get(seed),id=String(residentId||""),eventId=mem.residentIndex.get(id);if(!eventId)return null;
  const event=mem.active.get(eventId);if(!event)return null;
  const participant=event.participants.find(p=>p.id===id)||null;
  const target=participant?.eventTarget||event.location.anchor;
  return freeze({
    eventId:event.id,type:event.type,title:event.title,scheduleOverride:true,
    target,location:event.location,participant,stagingRevision:"compact-walkable-cluster-v2",
    activityOverride:freeze({
      state:"local-event",action:"gather",intendedAction:"gather",
      target,buildingId:null,targetSource:"local-event-vignette",
      eventId:event.id,eventType:event.type
    })
  });
}
function activeEvents(seedValue){
  const seed=String(seedValue||activeSeed||"");if(!seed||!runtimeBySeed.has(seed))return Object.freeze([]);
  return Object.freeze([...runtimeBySeed.get(seed).active.values()].sort((a,b)=>a.startTimestamp.localeCompare(b.startTimestamp)||a.id.localeCompare(b.id)));
}
function card(){
  if(typeof document==="undefined")return null;
  let node=document.getElementById("localEventVignette");
  if(node)return node;
  const root=document.getElementById("planetStageRoot")||document.body;if(!root)return null;
  node=document.createElement("aside");node.id="localEventVignette";node.className="local-event-vignette";node.hidden=true;
  node.setAttribute("aria-live","polite");
  node.innerHTML='<div class="local-event-kicker">LOCAL EVENT</div><div class="local-event-row"><span class="local-event-icon"></span><div><strong class="local-event-title"></strong><p class="local-event-description"></p></div></div><div class="local-event-meta"></div><div class="local-event-participants"></div>';
  root.appendChild(node);return node;
}
const CARD_PLACEMENTS=Object.freeze(["top-right","bottom-right","bottom-left"]);
function rectOverlapArea(a,b){
  if(!a||!b)return 0;
  const w=Math.max(0,Math.min(Number(a.right),Number(b.right))-Math.max(Number(a.left),Number(b.left)));
  const h=Math.max(0,Math.min(Number(a.bottom),Number(b.bottom))-Math.max(Number(a.top),Number(b.top)));
  return w*h;
}
function participantScreenBounds(event){
  const out=[];
  for(const participant of (event?.participants||[]).slice(0,MAX_PARTICIPANTS)){
    const visual=window.PlanetStage?.workCycleEvidenceState?.(participant.id)||null;
    if(!visual?.visible||!visual?.inViewport)continue;
    let b=visual.eventSilhouetteBoundsPx||visual.bodyBoundsPx||null;
    if(!b&&visual.screen){
      const size=visual.eventSilhouetteScreenSizePx||visual.bodyScreenSizePx||null;
      if(size){
        const hw=Math.max(0,Number(size.width||0))/2,hh=Math.max(0,Number(size.height||0))/2;
        b={left:Number(visual.screen.x)-hw,right:Number(visual.screen.x)+hw,top:Number(visual.screen.y)-hh,bottom:Number(visual.screen.y)+hh};
      }
    }
    if(!b||![b.left,b.right,b.top,b.bottom].every(Number.isFinite))continue;
    const pad=6;out.push(Object.freeze({residentId:String(participant.id),left:b.left-pad,right:b.right+pad,top:b.top-pad,bottom:b.bottom+pad}));
  }
  return Object.freeze(out);
}
function placeCard(node,event,seed){
  if(!node||node.hidden||!event)return;
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now(),bounds=participantScreenBounds(event);
  let best=CARD_PLACEMENTS[0],bestOverlap=Infinity;
  for(const placement of CARD_PLACEMENTS){
    node.dataset.placement=placement;
    const r=node.getBoundingClientRect?.();if(!r)continue;
    const cardRect={left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    const overlap=bounds.reduce((sum,b)=>sum+rectOverlapArea(cardRect,b),0);
    if(overlap<bestOverlap){bestOverlap=overlap;best=placement;}
    if(overlap<=.5)break;
  }
  node.dataset.placement=best;
  node.dataset.placementRevision="participant-aware-safe-slots-v1";
  node.dataset.participantBoundCount=String(bounds.length);
  node.dataset.participantOverlapArea=String(Number((Number.isFinite(bestOverlap)?bestOverlap:0).toFixed(3)));
  if(seed&&runtimeBySeed.has(seed)){
    const mem=runtimeBySeed.get(seed),elapsed=(typeof performance!=="undefined"&&performance.now?performance.now():Date.now())-started;
    mem.cardPlacementCount++;mem.lastCardPlacementMs=elapsed;mem.maxCardPlacementMs=Math.max(mem.maxCardPlacementMs,elapsed);
    mem.lastCardPlacement=best;mem.lastCardParticipantBoundCount=bounds.length;mem.lastCardOverlapArea=Number((Number.isFinite(bestOverlap)?bestOverlap:0).toFixed(3));
  }
}
function renderCard(seedValue){
  if(typeof document==="undefined")return null;
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const seed=String(seedValue||activeSeed||""),events=activeEvents(seed),node=card();if(!node)return null;
  const event=events[0]||null;node.hidden=!event;node.dataset.active=String(Boolean(event));node.dataset.eventType=event?.type||"";
  if(event){
    const q=s=>node.querySelector(s);
    if(q(".local-event-icon"))q(".local-event-icon").textContent=event.icon;
    if(q(".local-event-title"))q(".local-event-title").textContent=event.title;
    if(q(".local-event-description"))q(".local-event-description").textContent=event.description;
    if(q(".local-event-meta"))q(".local-event-meta").textContent=event.location.label+" · until "+event.endTimestamp.slice(11,16);
    if(q(".local-event-participants"))q(".local-event-participants").textContent=event.participants.map(p=>p.name).join(" · ");
    placeCard(node,event,seed);
    if(typeof window!=="undefined"&&window.requestAnimationFrame)window.requestAnimationFrame(()=>{
      if(!node.hidden&&node.dataset.eventType===event.type)placeCard(node,event,seed);
    });
  }else{
    node.dataset.placement="top-right";node.dataset.placementRevision="participant-aware-safe-slots-v1";
    node.dataset.participantBoundCount="0";node.dataset.participantOverlapArea="0";
  }
  if(seed&&runtimeBySeed.has(seed)){
    const mem=runtimeBySeed.get(seed),elapsed=(typeof performance!=="undefined"&&performance.now?performance.now():Date.now())-started;
    mem.renderCount++;mem.lastRenderMs=elapsed;mem.maxRenderMs=Math.max(mem.maxRenderMs,elapsed);
  }
  return event;
}
function snapshot(seedValue){
  const seed=String(seedValue||activeSeed||"");if(!seed||!runtimeBySeed.has(seed))return freeze({
    version:VERSION,seed:seed||null,activeCount:0,participantCount:0,maxActiveEvents:MAX_ACTIVE_EVENTS,maxParticipants:MAX_PARTICIPANTS,
    eventDriven:true,perFrameScan:false,fullSettlementPerFrameScan:false,fullWorldScan:false,distantSummaryOnly:true
  });
  const mem=runtimeBySeed.get(seed),events=activeEvents(seed);
  return freeze({
    version:VERSION,seed,activeCount:events.length,activeEventIds:Object.freeze(events.map(e=>e.id)),activeTypes:Object.freeze(events.map(e=>e.type)),
    participantCount:events.reduce((n,e)=>n+e.participantCount,0),maxActiveEvents:MAX_ACTIVE_EVENTS,maxParticipants:MAX_PARTICIPANTS,
    plannedDays:Object.freeze(mem.plannedDays.slice()),started:mem.started,ended:mem.ended,processedBatches:mem.processedBatches,maxBatch:mem.maxBatch,
    lastProcessedTimestamp:mem.lastProcessedTimestamp,lastEventId:mem.lastEventId,
    renderCount:mem.renderCount,lastRenderMs:Number(mem.lastRenderMs.toFixed(3)),maxRenderMs:Number(mem.maxRenderMs.toFixed(3)),
    cardPlacementCount:mem.cardPlacementCount,lastCardPlacementMs:Number(mem.lastCardPlacementMs.toFixed(3)),maxCardPlacementMs:Number(mem.maxCardPlacementMs.toFixed(3)),
    lastCardPlacement:mem.lastCardPlacement,lastCardParticipantBoundCount:mem.lastCardParticipantBoundCount,lastCardOverlapArea:mem.lastCardOverlapArea,
    cardPlacementRevision:"participant-aware-safe-slots-v1",cardPlacementSlots:CARD_PLACEMENTS,
    eventDriven:true,perFrameScan:false,fullSettlementPerFrameScan:false,fullWorldScan:false,distantSummaryOnly:true,
    simulationAuthority:true,presentationAuthority:false,participantSource:"DailyActivity bounded resident roster",
    events:Object.freeze(events.map(e=>freeze(clone(e))))
  });
}
function clearActive(seedValue){
  const mem=state(seedValue);mem.active.clear();mem.residentIndex.clear();renderCard(seedValue);return snapshot(seedValue);
}
function proofActivate(seedValue,typeValue,nowValue="1201-02-01 12:00:00"){
  const seed=requiredSeed(seedValue),type=String(typeValue||""),now=normalizeTimestamp(nowValue),spec=CATALOG.find(x=>x.id===type);
  if(!spec)throw new Error("Unknown vignette type: "+type);
  activeSeed=seed;clearActive(seed);
  const base=descriptor(seed,dayKey(now),spec);if(!base)throw new Error("Unable to build vignette proof event.");
  const event=freeze({...clone(base),id:"LVE|PROOF|"+hashText([seed,type,now].join("|")),startTimestamp:now,endTimestamp:addMinutes(now,45)});
  scheduleDescriptor(seed,event,"proof:"+type+":"+now);
  const result=window.EventScheduler.processDue(seed,now,{maxEvents:PROCESS_LIMIT,priority:"current",systemKinds:[START_KIND],handle:e=>processEvent(state(seed),{event:e})});
  state(seed).lastProcessedTimestamp=now;renderCard(seed);
  return freeze({pass:Boolean(result.processedCount===1&&activeEvents(seed)[0]?.type===type),event:activeEvents(seed)[0]||null,snapshot:snapshot(seed)});
}
function proof(seedValue){
  const seed=requiredSeed(seedValue),day="1201-02-01",events=planDay(seed,day),types=events.map(e=>e.type);
  const uniqueParticipants=events.every(e=>new Set(e.participants.map(p=>p.id)).size===e.participantCount);
  const realTargets=events.every(e=>e.participants.every(p=>p.existingTarget&&p.id));
  const deterministic=JSON.stringify(planDay(seed,day))===JSON.stringify(planDay(seed,day));
  const alternate=JSON.stringify(planDay(seed+"-ALT",day))!==JSON.stringify(events);
  const fourTypes=CATALOG.every(x=>types.includes(x.id));
  return freeze({
    pass:Boolean(fourTypes&&uniqueParticipants&&realTargets&&deterministic&&alternate),
    version:VERSION,types:Object.freeze(types),eventCount:events.length,deterministic,alternateSeedDiverges:alternate,
    uniqueParticipants,realResidentTargets:realTargets,maxParticipants:MAX_PARTICIPANTS,maxActiveEvents:MAX_ACTIVE_EVENTS,
    schedulerKinds:Object.freeze([START_KIND,END_KIND]),eventDriven:true,perFrameScan:false,fullSettlementPerFrameScan:false,fullWorldScan:false,
    events:Object.freeze(events.map(e=>freeze(clone(e))))
  });
}
function reset(seedValue){
  const seed=requiredSeed(seedValue);runtimeBySeed.delete(seed);if(activeSeed===seed)activeSeed=null;renderCard(seed);return true;
}
function autoTick(){
  try{
    const campaign=window.SeedSystem?.getCampaign?.(),seed=campaign?.seed,now=window.GameTime?.getTimestampKey?.();
    if(seed&&now)advance(seed,now);else renderCard(seed);
  }catch(_){}
}
function startAuto(){
  if(typeof window==="undefined"||autoTimer)return;
  autoTimer=window.setInterval(autoTick,AUTO_TICK_MS);autoTick();
}
if(typeof window!=="undefined"){
  if(typeof document!=="undefined"&&document.readyState==="loading")document.addEventListener("DOMContentLoaded",startAuto,{once:true});
  else startAuto();
}

window.LocalEventVignettes=Object.freeze({
  VERSION,START_KIND,END_KIND,MAX_ACTIVE_EVENTS,MAX_PARTICIPANTS,PROCESS_LIMIT,CATALOG,
  planDay,ensureScheduled,advance,stateFor,activeEvents,snapshot,renderCard,proofActivate,clearActive,proof,reset
});
})();