(function(){
"use strict";

const VERSION="1.0.0";
const WINDOW_HOURS=6;
const COOLDOWN_WINDOWS=3;
const MACRO_CELL_TILES=48;
const LOCAL_RADIUS_TILES=14;
const MAX_EXACT_ACTORS=4;
const AUTO_TICK_MS=1000;
const RARE_THRESHOLD_PER_1000=180; // one eligible window per 18h block; ~6% per 6h window.

const CATALOG=Object.freeze([
  Object.freeze({id:"traveling-merchant",title:"Traveling merchant",icon:"◇",roles:["market","traveler"],minActors:2,maxActors:3,road:true,day:true,weight:20,summary:"A merchant and companion have paused along the route with trade goods."}),
  Object.freeze({id:"wandering-bard",title:"Wandering storyteller",icon:"♪",roles:["traveler"],minActors:1,maxActors:2,road:false,day:false,weight:10,summary:"A wandering storyteller is passing through the area."}),
  Object.freeze({id:"small-caravan",title:"Small caravan",icon:"◆",roles:["traveler","market"],minActors:3,maxActors:4,road:true,day:true,weight:18,summary:"A compact caravan is moving between settlements."}),
  Object.freeze({id:"pilgrims",title:"Pilgrims on the road",icon:"△",roles:["traveler"],minActors:2,maxActors:4,road:true,day:true,weight:10,summary:"A small pilgrim group is making steady progress along the route."}),
  Object.freeze({id:"road-patrol",title:"Road patrol",icon:"⬟",roles:["guard"],minActors:2,maxActors:4,road:true,day:false,weight:14,summary:"A patrol is checking the road and nearby approaches."}),
  Object.freeze({id:"messenger",title:"Passing messenger",icon:"➤",roles:["traveler"],minActors:1,maxActors:1,road:true,day:true,weight:15,summary:"A messenger is hurrying between settlements."}),
  Object.freeze({id:"hunter-party",title:"Hunter party",icon:"⌁",roles:["farmer","traveler"],minActors:2,maxActors:3,road:false,day:true,biomes:["Woodland","Highland"],weight:8,summary:"A small hunting party is crossing the local wilderness."}),
  Object.freeze({id:"unusual-animal-sighting",title:"Unusual animal sighting",icon:"✦",roles:["traveler"],minActors:1,maxActors:2,road:false,day:false,biomes:["Woodland","Highland","Grassland"],weight:5,summary:"A rare animal sighting briefly interrupts the journey."})
]);

const proofBySeed=new Map();
const lastBySeed=new Map();
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
function hash32(seed,key){
  if(window.PRNG?.foundationUint32)return window.PRNG.foundationUint32(String(seed),String(key))>>>0;
  let h=2166136261>>>0;
  for(const ch of String(seed)+"|"+String(key)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
  return h>>>0;
}
function requiredSeed(value){const seed=String(value==null?"":value);if(!seed)throw new Error("Campaign SEED is required.");return seed}
function point(value){
  if(!value||value.x==null||value.y==null)throw new Error("Travel point is required.");
  return freeze({x:String(value.x),y:String(value.y),level:Number(value.level||0)});
}
function normalizeTimestamp(value){
  if(value&&typeof value==="object"){
    const pad=n=>String(n).padStart(2,"0");
    return String(value.year).padStart(4,"0")+"-"+pad(value.month)+"-"+pad(value.day)+" "+pad(value.hour||0)+":"+pad(value.minute||0)+":"+pad(value.second||0);
  }
  const s=String(value==null?"":value);
  if(!/^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))throw new Error("Fantasy timestamp must be YYYY-MM-DD HH:MM:SS.");
  return s;
}
function timestampParts(value){
  const s=normalizeTimestamp(value),m=s.match(/^(\d+)-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return {key:s,year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6])};
}
function windowInfo(value){
  const p=timestampParts(value);
  const ms=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const index=Math.floor(ms/(WINDOW_HOURS*3600000));
  const cooldownBlock=Math.floor(index/COOLDOWN_WINDOWS),offset=((index%COOLDOWN_WINDOWS)+COOLDOWN_WINDOWS)%COOLDOWN_WINDOWS;
  return freeze({...p,index,cooldownBlock,offset,daylight:p.hour>=6&&p.hour<20});
}
function floorDivBig(v,d){
  let q=v/d,r=v%d;
  if(r!==0n&&((r>0n)!==(d>0n)))q-=1n;
  return q;
}
function macroCell(p){
  const size=BigInt(MACRO_CELL_TILES),x=BigInt(p.x),y=BigInt(p.y);
  const cx=floorDivBig(x,size),cy=floorDivBig(y,size);
  return freeze({x:cx.toString(),y:cy.toString(),originX:(cx*size).toString(),originY:(cy*size).toString()});
}
function distanceTiles(a,b){
  try{
    const dx=Number(BigInt(String(a.x))-BigInt(String(b.x))),dy=Number(BigInt(String(a.y))-BigInt(String(b.y)));
    return Math.hypot(dx,dy);
  }catch(_){return Infinity}
}
function context(seedValue,pointValue,timestampValue){
  const seed=requiredSeed(seedValue),p=point(pointValue),stamp=normalizeTimestamp(timestampValue),env=window.GeographyFoundation?.environment?.(seed,p.x,p.y)||{};
  const terrain=String(window.GeographyFoundation?.getTerrainType?.(seed,p.x,p.y)||"unknown");
  const road=window.GeographyFoundation?.mainRoadInfo?.(seed,p.x,p.y)||null;
  const country=window.PoliticalGeography?.countryAt?.(seed,p.x,p.y)||null;
  const region=window.RegionProfile?.at?.(seed,p.x,p.y)||null;
  return freeze({
    seed,point:p,timestamp:stamp,terrain,biome:String(env.biome||"Unknown"),climate:String(env.climate||"Unknown"),
    onRoad:Boolean(road),roadType:road?.type||null,roadContext:road?String(road.context||road.networkKind||"local-road"):"off-road",
    countryId:country?.id?String(country.id):null,countryName:country?.name?String(country.name):null,
    regionId:region?.id?String(region.id):String(window.GeographyFoundation?.hierarchy?.(seed,p.x,p.y)?.region||"unknown-region"),
    regionName:region?.name?String(region.name):null,
    defense:Number(region?.specialization?.defense||0),trade:Number(region?.specialization?.trade||0),
    deterministic:true,seedAndFantasyTimeOnly:true
  });
}
function eligible(spec,ctx,w){
  if(spec.road&&!ctx.onRoad)return false;
  if(spec.day&&!w.daylight)return false;
  if(spec.biomes&&spec.biomes.length&&!spec.biomes.includes(ctx.biome))return false;
  if(spec.id==="road-patrol"&&ctx.defense<0.18&&ctx.onRoad===false)return false;
  return true;
}
function anchorFor(seed,cell,block){
  const size=BigInt(MACRO_CELL_TILES),ox=BigInt(cell.originX),oy=BigInt(cell.originY);
  const jx=(hash32(seed,"travel-encounter:anchor-x:"+cell.x+":"+cell.y+":"+block)%17)-8;
  const jy=(hash32(seed,"travel-encounter:anchor-y:"+cell.x+":"+cell.y+":"+block)%17)-8;
  return freeze({x:(ox+size/2n+BigInt(jx)).toString(),y:(oy+size/2n+BigInt(jy)).toString(),level:0});
}
function chooseType(seed,ctx,w,cell){
  const pool=CATALOG.filter(spec=>eligible(spec,ctx,w));
  if(!pool.length)return null;
  const weighted=pool.map(spec=>{
    let weight=spec.weight;
    if(spec.id==="traveling-merchant"&&ctx.trade>.5)weight+=6;
    if(spec.id==="road-patrol"&&ctx.defense>.5)weight+=6;
    if(spec.id==="hunter-party"&&["Woodland","Highland"].includes(ctx.biome))weight+=8;
    return {spec,weight};
  });
  const total=weighted.reduce((n,x)=>n+x.weight,0);
  let pick=hash32(seed,"travel-encounter:type:"+ctx.regionId+":"+cell.x+":"+cell.y+":"+w.cooldownBlock)%Math.max(1,total);
  for(const row of weighted){if(pick<row.weight)return row.spec;pick-=row.weight}
  return weighted[weighted.length-1].spec;
}
function actorsFor(seed,spec,anchor,w,ctx){
  const span=Math.max(1,spec.maxActors-spec.minActors+1),count=Math.min(MAX_EXACT_ACTORS,spec.minActors+(hash32(seed,"travel-encounter:count:"+spec.id+":"+w.cooldownBlock+":"+anchor.x+":"+anchor.y)%span));
  const offsets=[[0,0],[2,0],[-2,1],[1,-2],[-1,-2],[2,2]],actors=[];
  for(let i=0;i<count;i++){
    const off=offsets[i%offsets.length],role=spec.roles[i%spec.roles.length],x=(BigInt(anchor.x)+BigInt(off[0])).toString(),y=(BigInt(anchor.y)+BigInt(off[1])).toString();
    actors.push(freeze({
      id:"TRE|"+spec.id+"|"+w.cooldownBlock+"|"+i,role:"travel-encounter",visualRole:role,
      point:freeze({x,y,level:0}),presentationOffset:freeze({x:0,y:0}),
      travelEncounter:true,encounterType:spec.id,height:1.62,elevation:.02,
      presentationOnly:true,simulationAuthority:false,persistentIdentity:false,selectable:false,collision:false
    }));
  }
  return freeze(actors);
}
function descriptor(seedValue,pointValue,timestampValue,forcedType){
  const seed=requiredSeed(seedValue),p=point(pointValue),w=windowInfo(timestampValue),cell=macroCell(p),ctx=context(seed,p,w.key);
  const chosenOffset=hash32(seed,"travel-encounter:cooldown-slot:"+ctx.regionId+":"+cell.x+":"+cell.y+":"+w.cooldownBlock)%COOLDOWN_WINDOWS;
  if(forcedType==null&&w.offset!==chosenOffset)return null;
  const rarity=hash32(seed,"travel-encounter:rarity:"+ctx.regionId+":"+cell.x+":"+cell.y+":"+w.cooldownBlock)%1000;
  if(forcedType==null&&rarity>=RARE_THRESHOLD_PER_1000)return null;
  const spec=forcedType?CATALOG.find(x=>x.id===String(forcedType)):chooseType(seed,ctx,w,cell);
  if(!spec)return null;
  const anchor=anchorFor(seed,cell,w.cooldownBlock),actors=actorsFor(seed,spec,anchor,w,ctx);
  return freeze({
    id:"TRE|"+String(hash32(seed,[ctx.regionId,cell.x,cell.y,w.cooldownBlock,spec.id].join("|")).toString(16).toUpperCase()),
    type:spec.id,title:spec.title,icon:spec.icon,summary:spec.summary,
    anchor,macroCell:cell,windowIndex:w.index,cooldownBlock:w.cooldownBlock,windowHours:WINDOW_HOURS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,
    startedWindow:w.key.slice(0,13)+":00:00",actorCount:actors.length,actors,
    context:ctx,rare:true,authoritativeOutcome:false,politicalOutcome:false,
    identityAuthority:"Campaign SEED + Fantasy Game Time + deterministic local context",
    distantMode:"summary-only",exactMaterializationRadiusTiles:LOCAL_RADIUS_TILES,
    pooledPresentation:true,fullWorldScan:false,perFrameScan:false
  });
}
function probe(seedValue,pointValue,timestampValue){return descriptor(seedValue,pointValue,timestampValue,null)}
function localPresentation(seedValue,focusValue,timestampValue,optionsValue){
  const started=typeof performance!=="undefined"&&performance.now?performance.now():0,seed=requiredSeed(seedValue),focus=point(focusValue),stamp=normalizeTimestamp(timestampValue);
  const proof=proofBySeed.get(seed)||null,event=proof?.event||descriptor(seed,focus,stamp,null);
  const distance=event?distanceTiles(focus,event.anchor):Infinity,active=Boolean(event&&distance<=LOCAL_RADIUS_TILES);
  const exactActors=active?event.actors:Object.freeze([]);
  const elapsed=started&&performance.now?performance.now()-started:0;
  const result=freeze({
    version:VERSION,seed,active,encounter:event?freeze(clone(event)):null,exactActors,
    exactActorCount:exactActors.length,distanceTiles:Number.isFinite(distance)?Number(distance.toFixed(3)):null,
    mobilePresentation:Boolean(optionsValue?.mobile),poolCapacity:MAX_EXACT_ACTORS,
    updateMs:Number(elapsed.toFixed(3)),rareThresholdPer1000:RARE_THRESHOLD_PER_1000,
    windowHours:WINDOW_HOURS,cooldownWindows:COOLDOWN_WINDOWS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,
    localRadiusTiles:LOCAL_RADIUS_TILES,summaryOnly:Boolean(event&&!active),exactOnlyNearRelevance:true,
    deterministic:true,seedAndFantasyTimeOnly:true,eventDriven:true,fullWorldScan:false,perFrameScan:false,
    presentationOnlyActors:true,simulationAuthority:true,presentationAuthority:false
  });
  lastBySeed.set(seed,result);renderCard(result);return result;
}
function stream(seedValue,samplesValue){
  const seed=requiredSeed(seedValue),samples=Array.isArray(samplesValue)?samplesValue:[],events=[];
  for(let i=0;i<samples.length;i++){
    const sample=samples[i]||{},event=probe(seed,sample.point,sample.timestamp);
    if(event)events.push(freeze({sampleIndex:i,id:event.id,type:event.type,anchor:event.anchor,windowIndex:event.windowIndex,cooldownBlock:event.cooldownBlock,regionId:event.context.regionId}));
  }
  return freeze(events);
}
function proofActivate(seedValue,typeValue,anchorValue,timestampValue){
  const seed=requiredSeed(seedValue),type=String(typeValue||""),anchor=point(anchorValue),stamp=normalizeTimestamp(timestampValue);
  if(!CATALOG.some(x=>x.id===type))throw new Error("Unknown encounter type: "+type);
  const event=descriptor(seed,anchor,stamp,type);proofBySeed.set(seed,freeze({event}));
  const view=localPresentation(seed,event.anchor,stamp,{proof:true});
  return freeze({pass:Boolean(view.active&&view.encounter?.type===type&&view.exactActorCount===event.actorCount),event:view.encounter,snapshot:view});
}
function clearProof(seedValue){
  const seed=requiredSeed(seedValue);proofBySeed.delete(seed);lastBySeed.delete(seed);renderCard(null);return true;
}
function snapshot(seedValue){
  const seed=String(seedValue||"");return lastBySeed.get(seed)||freeze({
    version:VERSION,seed:seed||null,active:false,encounter:null,exactActors:Object.freeze([]),exactActorCount:0,
    poolCapacity:MAX_EXACT_ACTORS,rareThresholdPer1000:RARE_THRESHOLD_PER_1000,windowHours:WINDOW_HOURS,
    cooldownWindows:COOLDOWN_WINDOWS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,localRadiusTiles:LOCAL_RADIUS_TILES,
    deterministic:true,seedAndFantasyTimeOnly:true,eventDriven:true,fullWorldScan:false,perFrameScan:false,
    presentationOnlyActors:true,simulationAuthority:true,presentationAuthority:false
  });
}
function card(){
  if(typeof document==="undefined")return null;
  let node=document.getElementById("travelEncounterCard");if(node)return node;
  const root=document.getElementById("planetStageRoot")||document.body;if(!root)return null;
  node=document.createElement("aside");node.id="travelEncounterCard";node.className="travel-encounter-card";node.hidden=true;node.setAttribute("aria-live","polite");
  node.innerHTML='<div class="travel-encounter-kicker">RARE ENCOUNTER</div><div class="travel-encounter-row"><span class="travel-encounter-icon"></span><div><strong class="travel-encounter-title"></strong><p class="travel-encounter-summary"></p></div></div><div class="travel-encounter-meta"></div>';
  root.appendChild(node);return node;
}
function renderCard(viewValue){
  if(typeof document==="undefined")return null;
  const node=card();if(!node)return null;const view=viewValue||null,event=view?.active?view.encounter:null;
  node.hidden=!event;node.dataset.active=String(Boolean(event));node.dataset.encounterType=event?.type||"";
  if(event){
    node.querySelector(".travel-encounter-icon").textContent=event.icon;
    node.querySelector(".travel-encounter-title").textContent=event.title;
    node.querySelector(".travel-encounter-summary").textContent=event.summary;
    const road=event.context.onRoad?(event.context.roadType||"road"):"off-road";
    node.querySelector(".travel-encounter-meta").textContent=(event.context.regionName||event.context.regionId)+" · "+event.context.biome+" · "+road+" · "+event.actorCount+" traveler"+(event.actorCount===1?"":"s");
  }
  return event;
}
function autoTick(){
  try{
    const stage=window.PlanetStage?.snapshot?.(),seed=stage?.activeSeed||window.SeedSystem?.getCampaign?.()?.seed,focus=stage?.canonicalFocus?.worldTile,stamp=window.GameTime?.getTimestampKey?.();
    if(seed&&focus&&stamp)localPresentation(seed,focus,stamp,{auto:true});else renderCard(null);
  }catch(_){}
}
function startAuto(){if(typeof window==="undefined"||autoTimer)return;autoTimer=window.setInterval(autoTick,AUTO_TICK_MS);}

if(typeof window!=="undefined"){
  if(typeof document!=="undefined"&&document.readyState==="loading")document.addEventListener("DOMContentLoaded",startAuto,{once:true});
  else startAuto();
}

window.TravelEncounters=Object.freeze({
  VERSION,WINDOW_HOURS,COOLDOWN_WINDOWS,MACRO_CELL_TILES,LOCAL_RADIUS_TILES,MAX_EXACT_ACTORS,RARE_THRESHOLD_PER_1000,CATALOG,
  context,probe,stream,localPresentation,snapshot,proofActivate,clearProof,renderCard
});
})();