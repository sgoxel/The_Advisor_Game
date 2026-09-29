(function(){
"use strict";

const VERSION="contextual-npc-reactions-v1";
const MAX_QUEUED_EVENTS=24;
const MAX_EVENTS_PER_ADVANCE=4;
const MAX_ACTIVE_REACTIONS=2;
const COOLDOWN_FANTASY_MINUTES=8;
const CLOSE_FOLLOW_SECONDS=4;
const CLOSE_DISTANCE_TILES=1;
const CONTEXT_DISTANCE_TILES=3;

let seedKey="";
let queue=[];
let active=new Map();
let cooldownUntilMinute=new Map();
let sequence=0;
let processedEventCount=0;
let acceptedEventCount=0;
let suppressedLowSalienceCount=0;
let suppressedCooldownCount=0;
let suppressedActiveCount=0;
let droppedEventCount=0;
let candidateCheckCount=0;
let maxCandidateChecksPerAdvance=0;
let advanceCount=0;
let lastUpdateMs=0;
let maxUpdateMs=0;
let proofActive=false;
let presentationSignature="";
let presentationRenderCount=0;

function renderPresentation(){
  if(typeof document==="undefined")return;
  const signature=[...active.values()].map(r=>r.id+":"+r.text).join("|");
  if(signature===presentationSignature)return;
  presentationSignature=signature;presentationRenderCount++;
  let layer=document.getElementById("contextualReactionLayer");
  if(!active.size){
    layer?.remove?.();
    return;
  }
  if(!layer){
    layer=document.createElement("div");
    layer.id="contextualReactionLayer";
    layer.setAttribute("aria-live","polite");
    Object.assign(layer.style,{
      position:"absolute",right:"max(12px,env(safe-area-inset-right))",bottom:"max(74px,calc(env(safe-area-inset-bottom) + 74px))",
      zIndex:"18",display:"grid",gap:"6px",maxWidth:"min(340px,calc(100vw - 24px))",pointerEvents:"none"
    });
    (document.getElementById("planetStageRoot")||document.body).appendChild(layer);
  }
  layer.replaceChildren();
  for(const reaction of active.values()){
    const card=document.createElement("div");
    card.className="contextual-npc-reaction";
    Object.assign(card.style,{
      padding:"7px 10px",border:"1px solid rgba(230,205,144,.72)",borderRadius:"10px",
      background:"rgba(9,15,20,.90)",boxShadow:"0 5px 18px rgba(0,0,0,.34)",
      color:"#f6eed7",font:"600 12px/1.28 system-ui,sans-serif",letterSpacing:".01em",
      backdropFilter:"blur(5px)"
    });
    const name=document.createElement("strong");
    name.textContent=reaction.residentId+" · "+reaction.kind.replace(/-/g," ");
    Object.assign(name.style,{display:"block",fontSize:"9px",textTransform:"uppercase",letterSpacing:".10em",color:"#e2c982",marginBottom:"2px"});
    const text=document.createElement("span");text.textContent=reaction.text;
    card.append(name,text);layer.appendChild(card);
  }
}

function point(value){
  if(!value||value.x==null||value.y==null)return null;
  try{
    const p=window.WorldCoordinates?.position?.(String(value.x),String(value.y));
    if(p)return Object.freeze({x:String(p.x),y:String(p.y),level:Number(p.level||0)});
  }catch(_){}
  return Object.freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});
}
function number(value){const n=Number(value);return Number.isFinite(n)?n:0}
function distance(a,b){return Math.abs(number(a?.x)-number(b?.x))+Math.abs(number(a?.y)-number(b?.y))}
function samePoint(a,b){return !!a&&!!b&&String(a.x)===String(b.x)&&String(a.y)===String(b.y)}
function timeParts(when){
  const t=when&&typeof when==="object"?when:(window.GameTime?.getNow?.()||null);
  return t||{year:0,month:1,day:1,hour:12,minute:0,second:0};
}
function fantasyMinute(when){
  const t=timeParts(when);
  return Math.floor(Date.UTC(Number(t.year||0),Math.max(0,Number(t.month||1)-1),Number(t.day||1),Number(t.hour||0),Number(t.minute||0),Number(t.second||0))/60000);
}
function slotKey(when){
  const t=timeParts(when),minute=Math.floor(Number(t.minute||0)/5)*5;
  return [t.year,String(t.month).padStart(2,"0"),String(t.day).padStart(2,"0"),String(t.hour).padStart(2,"0"),String(minute).padStart(2,"0")].join("-");
}
function navigation(seed,p){
  if(!p)return null;
  try{
    return window.InteriorObjects?.classifyNavigation?.(seed,p.x,p.y)||
      window.Walkability?.classify?.(seed,p.x,p.y)||null;
  }catch(_){return null}
}
function normalizeSource(value){
  const source=String(value||"simulation-protagonist");
  return ["campaign-protagonist","simulation-protagonist","evidence-authoritative-context"].includes(source)
    ?source:"simulation-protagonist";
}
function reset(seedValue){
  seedKey=String(seedValue==null?"":seedValue);
  queue=[];
  active=new Map();
  cooldownUntilMinute=new Map();
  sequence=0;
  processedEventCount=0;
  acceptedEventCount=0;
  suppressedLowSalienceCount=0;
  suppressedCooldownCount=0;
  suppressedActiveCount=0;
  droppedEventCount=0;
  candidateCheckCount=0;
  maxCandidateChecksPerAdvance=0;
  advanceCount=0;
  lastUpdateMs=0;
  maxUpdateMs=0;
  proofActive=false;
  presentationSignature="";
  if(typeof document!=="undefined")document.getElementById("contextualReactionLayer")?.remove?.();
  return snapshot();
}
function ensure(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(seed!==seedKey)reset(seed);
  return Boolean(seed);
}
function notify(value){
  const input=value&&typeof value==="object"?value:{};
  const residentId=String(input.residentId||"");
  const protagonist=point(input.protagonist||input.protagonistPosition);
  if(!residentId||!protagonist)return Object.freeze({accepted:false,reason:"missing-authoritative-context"});
  if(queue.length>=MAX_QUEUED_EVENTS){
    droppedEventCount++;
    return Object.freeze({accepted:false,reason:"queue-bounded"});
  }
  const event=Object.freeze({
    id:"CTX-E"+String(++sequence).padStart(5,"0"),
    residentId,
    kind:String(input.kind||"proximity"),
    protagonist,
    proximitySeconds:Math.max(0,Number(input.proximitySeconds)||0),
    disturbance:Boolean(input.disturbance),
    source:normalizeSource(input.source),
    when:timeParts(input.when),
    note:String(input.note||"")
  });
  queue.push(event);
  return Object.freeze({accepted:true,event});
}
function relationshipValues(seed,residentId){
  try{
    const context=window.SocialState?.dialogueContext?.(seed,residentId);
    return context?.values||null;
  }catch(_){return null}
}
function choice(seed,when,residentId,kind,length){
  const domain="contextual-reaction:"+slotKey(when)+":"+residentId+":"+kind;
  return Number(window.PRNG?.foundationUint32?.(seed,domain)||0)%Math.max(1,length);
}
function reactionTemplate(seed,when,residentId,kind,social){
  const warm=Number(social?.trust||0)>=.62&&Number(social?.suspicion||0)<=.38;
  const templates={
    "doorway-block":warm
      ?["Mind the doorway, please.","Could I get through there?"]
      :["Please clear the doorway.","I need to pass."],
    "close-follow":warm
      ?["You can walk beside me.","Need something while we walk?"]
      :["Could you give me a little room?","You're rather close."],
    "workplace-interrupt":warm
      ?["Give me a moment to finish this.","I'm working, but I heard you."]
      :["I'm in the middle of work.","Please give me a moment."],
    "space-collision":["Careful there.","A little room, please."],
    "disturbance":["What was that?","Something nearby changed."],
    "late-night-approach":warm
      ?["Late evening. Need something?","You're out late too."]
      :["Evening. What do you need?","It's late. Keep some distance."]
  };
  const rows=templates[kind]||["Hmm.","I noticed that."];
  return rows[choice(seed,when,residentId,kind,rows.length)];
}
function evaluate(seed,event,resident,when){
  if(!resident?.position)return null;
  const protagonist=event.protagonist,residentPosition=point(resident.position);
  const d=distance(protagonist,residentPosition);
  const activity=resident.activity||{};
  const nav=navigation(seed,protagonist);
  const action=String(activity.intendedAction||activity.action||"").toLowerCase();
  const state=String(activity.state||"").toLowerCase();
  const busy=Boolean(resident.actionExecution?.holdsPosition||resident.workCycle||["work","working","sleep","craft","service"].includes(state)||["work","craft","service","sleep"].includes(action));
  const kind=event.kind;
  let valid=false,salience=0,holdsPosition=false,duration=2.4;

  if(kind==="doorway-block"){
    const doorway=Boolean(nav?.doorwayKind==="exterior-door"||nav?.category==="entrance");
    valid=doorway&&d<=2&&Boolean(samePoint(resident.nextPosition,protagonist)||resident.status==="moving");
    salience=valid?1:0;holdsPosition=valid;duration=1.2;
  }else if(kind==="close-follow"){
    valid=d<=CLOSE_DISTANCE_TILES&&event.proximitySeconds>=CLOSE_FOLLOW_SECONDS;
    salience=valid?0.82:0;
  }else if(kind==="workplace-interrupt"){
    const activityBuilding=String(activity.buildingId||resident.workplaceId||"");
    valid=busy&&Boolean(activityBuilding)&&String(nav?.buildingId||"")===activityBuilding&&d<=CONTEXT_DISTANCE_TILES;
    salience=valid?0.9:0;
  }else if(kind==="space-collision"){
    valid=d===0;salience=valid?0.96:0;holdsPosition=valid;duration=1.0;
  }else if(kind==="disturbance"){
    valid=event.disturbance&&d<=CONTEXT_DISTANCE_TILES;salience=valid?0.75:0;
  }else if(kind==="late-night-approach"){
    const hour=Number(timeParts(when).hour||0);
    valid=(hour>=22||hour<5)&&d<=2;salience=valid?0.72:0;
  }else if(kind==="proximity"){
    // Ordinary passing is intentionally calm. Only a sustained immediate-space
    // presence graduates into a contextual reaction.
    valid=d<=CLOSE_DISTANCE_TILES&&event.proximitySeconds>=CLOSE_FOLLOW_SECONDS;
    salience=valid?0.72:0;
  }

  if(!valid||salience<.7)return null;
  const social=relationshipValues(seed,event.residentId);
  return Object.freeze({
    kind:kind==="proximity"?"close-follow":kind,
    salience:Number(salience.toFixed(3)),
    holdsPosition,
    durationSeconds:duration,
    text:reactionTemplate(seed,when,event.residentId,kind==="proximity"?"close-follow":kind,social),
    socialSource:social?"SocialState.dialogueContext":"deterministic-neutral-baseline",
    distanceTiles:d,
    protagonistNavigation:Object.freeze({
      category:nav?.category||null,buildingId:nav?.buildingId||null,doorwayKind:nav?.doorwayKind||null
    })
  });
}
function reactionSnapshot(reaction){
  if(!reaction)return null;
  return Object.freeze({
    id:reaction.id,residentId:reaction.residentId,kind:reaction.kind,text:reaction.text,
    salience:reaction.salience,holdsPosition:Boolean(reaction.holdsPosition),
    elapsedSeconds:Number(reaction.elapsed.toFixed(3)),durationSeconds:reaction.durationSeconds,
    remainingSeconds:Number(Math.max(0,reaction.durationSeconds-reaction.elapsed).toFixed(3)),
    source:reaction.source,socialSource:reaction.socialSource,distanceTiles:reaction.distanceTiles,
    protagonistNavigation:reaction.protagonistNavigation,
    deterministic:true,routeMutation:false,scheduleMutation:false,forcedProtagonistMovement:false
  });
}
function advanceActive(seconds){
  const dt=Math.max(0,Number(seconds)||0);
  for(const [residentId,reaction] of [...active.entries()]){
    reaction.elapsed+=dt;
    if(reaction.elapsed+1e-9>=reaction.durationSeconds)active.delete(residentId);
  }
  renderPresentation();
}
function processEvent(seed,event,residentLookup,when){
  processedEventCount++;
  if(active.has(event.residentId)){suppressedActiveCount++;return null}
  const minute=fantasyMinute(event.when||when);
  if(Number(cooldownUntilMinute.get(event.residentId)||-Infinity)>minute){
    suppressedCooldownCount++;
    return null;
  }
  candidateCheckCount++;
  const resident=typeof residentLookup==="function"?residentLookup(event.residentId):null;
  if(!resident){suppressedLowSalienceCount++;return null}
  const evaluated=evaluate(seed,event,resident,event.when||when);
  if(!evaluated){suppressedLowSalienceCount++;return null}
  if(active.size>=MAX_ACTIVE_REACTIONS){suppressedLowSalienceCount++;return null}
  const reaction={
    id:"CTX-R"+String(acceptedEventCount+1).padStart(5,"0")+"-"+String(window.PRNG?.foundationUint32?.(seed,"contextual-reaction-id:"+slotKey(event.when||when)+":"+event.residentId+":"+evaluated.kind)||0).toString(16).toUpperCase(),
    residentId:event.residentId,kind:evaluated.kind,text:evaluated.text,salience:evaluated.salience,
    holdsPosition:evaluated.holdsPosition,durationSeconds:evaluated.durationSeconds,elapsed:0,
    source:event.source,socialSource:evaluated.socialSource,distanceTiles:evaluated.distanceTiles,
    protagonistNavigation:evaluated.protagonistNavigation
  };
  active.set(event.residentId,reaction);
  cooldownUntilMinute.set(event.residentId,minute+COOLDOWN_FANTASY_MINUTES);
  renderPresentation();
  acceptedEventCount++;
  return reactionSnapshot(reaction);
}
function advance(request){
  const started=performance.now();
  const seed=String(request?.seed||seedKey||"");
  if(!ensure(seed))return snapshot();
  const when=request?.when||window.GameTime?.getNow?.()||timeParts(null);
  advanceActive(request?.seconds);
  let checksBefore=candidateCheckCount,processed=0;
  while(queue.length&&processed<MAX_EVENTS_PER_ADVANCE){
    const event=queue.shift();
    processEvent(seed,event,request?.residentLookup,when);
    processed++;
  }
  const checks=candidateCheckCount-checksBefore;
  maxCandidateChecksPerAdvance=Math.max(maxCandidateChecksPerAdvance,checks);
  advanceCount++;
  const elapsed=performance.now()-started;
  lastUpdateMs=Number(elapsed.toFixed(4));maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  return snapshot();
}
function stateFor(residentId){return reactionSnapshot(active.get(String(residentId||"")))}
function snapshot(){
  const reactions=Object.freeze([...active.values()].map(reactionSnapshot));
  return Object.freeze({
    version:VERSION,seed:seedKey||null,maxQueuedEvents:MAX_QUEUED_EVENTS,maxEventsPerAdvance:MAX_EVENTS_PER_ADVANCE,
    maxActiveReactions:MAX_ACTIVE_REACTIONS,cooldownFantasyMinutes:COOLDOWN_FANTASY_MINUTES,
    closeFollowSeconds:CLOSE_FOLLOW_SECONDS,closeDistanceTiles:CLOSE_DISTANCE_TILES,
    queuedEventCount:queue.length,activeReactionCount:reactions.length,reactions,
    processedEventCount,acceptedEventCount,suppressedLowSalienceCount,suppressedCooldownCount,suppressedActiveCount,droppedEventCount,
    candidateCheckCount,maxCandidateChecksPerAdvance,advanceCount,lastUpdateMs,maxUpdateMs,
    presentationCount:active.size,presentationRenderCount,
    decisionAuthority:"SEED + fantasy time slot + authoritative local event context",
    relationshipAuthority:"SocialState dialogue context when available",
    eventDriven:true,globalNpcScan:false,perFrameNpcScan:false,routeMutation:false,scheduleMutation:false,
    forcedProtagonistMovement:false,crimeAuthority:false,ownershipAuthority:false,proofActive
  });
}
function proofDefinitions(seed){
  const roster=window.DailyActivity?.build?.(seed)||[];
  const indoor=roster.find(r=>r.workplaceEnterable&&r.workplaceId)||roster[0]||null;
  const follower=roster.find(r=>r.id!==indoor?.id)||roster[1]||roster[0]||null;
  const passer=roster.find(r=>r.id!==indoor?.id&&r.id!==follower?.id)||roster[2]||follower;
  const doorwayResident=roster.find(r=>r.homePlanId)||roster[0]||null;
  if(!indoor||!follower||!passer||!doorwayResident)return [];
  const home=window.BuildingInteriors?.get?.(seed,doorwayResident.homePlanId);
  const door=point(home?.entrance?.door),outside=point(home?.entrance?.immediateOutside||home?.entrance?.outdoorAccess);
  const workPoint=point(indoor.workplaceTarget);
  const workWhen={year:1201,month:2,day:1,hour:10,minute:30,second:0};
  const baseWork=window.DailyActivity?.resolveActionTarget?.(seed,indoor,workWhen)||{
    state:"work",action:"work",intendedAction:"work",buildingId:indoor.workplaceId,target:workPoint
  };
  const followerPoint=outside||point(follower.homeTarget)||point({x:0,y:0});
  const passPoint=point({x:String(number(followerPoint.x)+3),y:followerPoint.y});
  return [
    Object.freeze({
      id:"doorway-block",residentId:doorwayResident.id,residentPosition:outside,when:{year:1201,month:2,day:1,hour:17,minute:30,second:0},
      event:{kind:"doorway-block",residentId:doorwayResident.id,protagonist:door,source:"evidence-authoritative-context"},
      resident:{id:doorwayResident.id,position:outside,nextPosition:door,status:"moving",activity:{state:"return-home",action:"move",buildingId:doorwayResident.homePlanId}}
    }),
    Object.freeze({
      id:"close-follow",residentId:follower.id,residentPosition:followerPoint,when:{year:1201,month:2,day:1,hour:16,minute:10,second:0},
      event:{kind:"close-follow",residentId:follower.id,protagonist:followerPoint,proximitySeconds:CLOSE_FOLLOW_SECONDS+1,source:"evidence-authoritative-context"},
      resident:{id:follower.id,position:followerPoint,status:"moving",activity:{state:"return-home",action:"move"}}
    }),
    Object.freeze({
      id:"workplace-interrupt",residentId:indoor.id,residentPosition:workPoint,when:workWhen,
      event:{kind:"workplace-interrupt",residentId:indoor.id,protagonist:workPoint,source:"evidence-authoritative-context"},
      resident:{id:indoor.id,position:workPoint,status:"arrived",workplaceId:indoor.workplaceId,activity:baseWork,workCycle:{stepId:"proof-work"}}
    }),
    Object.freeze({
      id:"harmless-pass",residentId:passer.id,residentPosition:followerPoint,when:{year:1201,month:2,day:1,hour:13,minute:0,second:0},
      event:{kind:"proximity",residentId:passer.id,protagonist:passPoint,proximitySeconds:.5,source:"evidence-authoritative-context"},
      resident:{id:passer.id,position:followerPoint,status:"moving",activity:{state:"travel",action:"move"}}
    })
  ].filter(row=>row.residentPosition&&row.event.protagonist);
}
function executeProof(seed){
  const definitions=proofDefinitions(seed),results=[];
  reset(seed);proofActive=true;
  for(const def of definitions){
    const before=snapshot();
    notify({...def.event,when:def.when});
    advance({seed,when:def.when,seconds:.1,residentLookup:id=>String(id)===def.residentId?def.resident:null});
    const reaction=stateFor(def.residentId);
    results.push(Object.freeze({
      id:def.id,residentId:def.residentId,residentPosition:def.residentPosition,protagonist:def.event.protagonist,
      reaction,reactionCreated:Boolean(reaction),acceptedDelta:snapshot().acceptedEventCount-before.acceptedEventCount,
      lowSalienceDelta:snapshot().suppressedLowSalienceCount-before.suppressedLowSalienceCount
    }));
    advance({seed,when:def.when,seconds:4,residentLookup:()=>def.resident});
  }
  const close=definitions.find(row=>row.id==="close-follow");
  let cooldownSuppressed=false;
  if(close){
    reset(seed);proofActive=true;
    notify({...close.event,when:close.when});
    advance({seed,when:close.when,seconds:.1,residentLookup:id=>String(id)===close.residentId?close.resident:null});
    advance({seed,when:close.when,seconds:4,residentLookup:()=>close.resident});
    const before=snapshot().suppressedCooldownCount;
    notify({...close.event,when:close.when});
    advance({seed,when:close.when,seconds:.1,residentLookup:id=>String(id)===close.residentId?close.resident:null});
    cooldownSuppressed=snapshot().suppressedCooldownCount>before&&!stateFor(close.residentId);
  }
  const byId=Object.fromEntries(results.map(r=>[r.id,r]));
  const pass=Boolean(
    byId["doorway-block"]?.reactionCreated&&byId["doorway-block"]?.reaction?.holdsPosition&&
    byId["close-follow"]?.reactionCreated&&!byId["close-follow"]?.reaction?.holdsPosition&&
    byId["workplace-interrupt"]?.reactionCreated&&
    byId["harmless-pass"]&&!byId["harmless-pass"].reactionCreated&&byId["harmless-pass"].lowSalienceDelta>0&&
    cooldownSuppressed
  );
  const signature=results.map(r=>[r.id,r.reaction?.kind||"none",r.reaction?.text||"",r.reaction?.holdsPosition?1:0].join(":")).join("|")+"|cooldown:"+(cooldownSuppressed?1:0);
  return {pass,results:Object.freeze(results),cooldownSuppressed,signature};
}
function verify(seedValue){
  const seed=String(seedValue||"");
  const first=executeProof(seed);
  const firstSignature=first.signature;
  const second=executeProof(seed);
  const deterministic=firstSignature===second.signature;
  const final=snapshot();
  const pass=Boolean(first.pass&&second.pass&&deterministic&&final.maxCandidateChecksPerAdvance<=MAX_EVENTS_PER_ADVANCE);
  reset(seed);
  return Object.freeze({
    pass,deterministic,cooldownSuppressed:first.cooldownSuppressed,cases:first.results,
    caseCount:first.results.length,signature:firstSignature,
    boundedCandidateChecks:true,maxEventsPerAdvance:MAX_EVENTS_PER_ADVANCE,
    eventDriven:true,globalNpcScan:false,perFrameNpcScan:false,
    routeMutation:false,scheduleMutation:false,forcedProtagonistMovement:false,
    decisionAuthority:"SEED + fantasy time + authoritative local context"
  });
}
function beginProof(seedValue,caseId){
  const seed=String(seedValue||""),def=proofDefinitions(seed).find(row=>row.id===String(caseId||""));
  if(!def)return null;
  reset(seed);proofActive=true;
  notify({...def.event,when:def.when});
  advance({seed,when:def.when,seconds:.1,residentLookup:id=>String(id)===def.residentId?def.resident:null});
  return Object.freeze({
    caseId:def.id,residentId:def.residentId,residentPosition:def.residentPosition,protagonist:def.event.protagonist,
    when:def.when,reaction:stateFor(def.residentId),snapshot:snapshot()
  });
}
function endProof(){proofActive=false;return reset(seedKey)}

window.ContextualReactions=Object.freeze({
  VERSION,MAX_QUEUED_EVENTS,MAX_EVENTS_PER_ADVANCE,MAX_ACTIVE_REACTIONS,COOLDOWN_FANTASY_MINUTES,CLOSE_FOLLOW_SECONDS,
  ensure,reset,notify,observeProtagonist:notify,advance,stateFor,snapshot,verify,beginProof,endProof
});
})();