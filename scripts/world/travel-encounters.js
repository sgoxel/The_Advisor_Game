(function(){
"use strict";

const VERSION="2.0.0";
const WINDOW_HOURS=6;
const COOLDOWN_WINDOWS=3;
const MACRO_CELL_TILES=48;
const LOCAL_RADIUS_TILES=14;
const MAX_EXACT_ACTORS=4;
const MAX_VISUAL_ANCHOR_CHECKS=81;
const VISUAL_ANCHOR_RADIUS_TILES=10;
const AUTO_TICK_MS=1000;
const RARE_THRESHOLD_PER_1000=180;

const CATALOG=Object.freeze([
  Object.freeze({id:"traveling-merchant",title:"Traveling merchant",icon:"◇",roles:["merchant","traveler"],props:["pack","satchel"],minActors:2,maxActors:3,road:true,day:true,weight:20,summary:"A merchant and companion have paused along the route with trade goods."}),
  Object.freeze({id:"wandering-bard",title:"Wandering storyteller",icon:"♪",roles:["bard"],props:["lute"],minActors:1,maxActors:2,road:false,day:false,weight:10,summary:"A wandering storyteller is passing through the area."}),
  Object.freeze({id:"small-caravan",title:"Small caravan",icon:"◆",roles:["caravan","merchant"],props:["pack","bundle"],minActors:3,maxActors:4,road:true,day:true,weight:18,summary:"A compact caravan is moving between settlements."}),
  Object.freeze({id:"pilgrims",title:"Pilgrims on the road",icon:"△",roles:["pilgrim"],props:["staff"],minActors:2,maxActors:4,road:true,day:true,weight:10,summary:"A small pilgrim group is making steady progress along the route."}),
  Object.freeze({id:"road-patrol",title:"Road patrol",icon:"⬟",roles:["guard"],props:["spear"],minActors:2,maxActors:4,road:true,day:false,weight:14,summary:"A patrol is checking the road and nearby approaches."}),
  Object.freeze({id:"messenger",title:"Passing messenger",icon:"➤",roles:["messenger"],props:["satchel"],minActors:1,maxActors:1,road:true,day:true,weight:15,summary:"A messenger is hurrying between settlements."}),
  Object.freeze({id:"hunter-party",title:"Hunter party",icon:"⌁",roles:["hunter"],props:["bow"],minActors:2,maxActors:3,road:false,day:true,biomes:["Woodland","Highland"],weight:8,summary:"A small hunting party is crossing the local wilderness."}),
  Object.freeze({id:"unusual-animal-sighting",title:"Unusual animal sighting",icon:"✦",roles:["traveler"],props:["field-pack"],minActors:1,maxActors:2,road:false,day:false,biomes:["Woodland","Highland","Grassland"],weight:5,summary:"A rare animal sighting briefly interrupts the journey."})
]);

const proofBySeed=new Map();
const lastBySeed=new Map();
const geoBySeed=new Map();
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
  const p=timestampParts(value),ms=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const index=Math.floor(ms/(WINDOW_HOURS*3600000)),cooldownBlock=Math.floor(index/COOLDOWN_WINDOWS),offset=((index%COOLDOWN_WINDOWS)+COOLDOWN_WINDOWS)%COOLDOWN_WINDOWS;
  return freeze({...p,index,cooldownBlock,offset,daylight:p.hour>=6&&p.hour<20});
}
function floorDivBig(v,d){let q=v/d,r=v%d;if(r!==0n&&((r>0n)!==(d>0n)))q-=1n;return q}
function macroCell(p){
  const size=BigInt(MACRO_CELL_TILES),x=BigInt(p.x),y=BigInt(p.y),cx=floorDivBig(x,size),cy=floorDivBig(y,size);
  return freeze({x:cx.toString(),y:cy.toString(),originX:(cx*size).toString(),originY:(cy*size).toString()});
}
function distanceTiles(a,b){
  try{return Math.hypot(Number(BigInt(String(a.x))-BigInt(String(b.x))),Number(BigInt(String(a.y))-BigInt(String(b.y))))}
  catch(_){return Infinity}
}
function planetInstance(seed){
  if(geoBySeed.has(seed))return geoBySeed.get(seed);
  let instance=null;try{instance=window.PlanetGeography?.create?.(seed)||null}catch(_){instance=null}
  geoBySeed.set(seed,instance);return instance;
}
function planetSurface(seed,p){
  try{
    const pg=planetInstance(seed);
    if(!pg)return freeze({available:false,land:null,latitudeRadians:null,longitudeRadians:null});
    const tileMeters=Math.max(1,Number(window.GeographyFoundation?.TILE_METERS||window.WorldStandards?.TILE_METERS||2));
    const radius=Math.max(1,Number(window.PlanetGeography?.DEFAULT_WORLD_RADIUS_METERS||637100));
    const geo=pg.worldLatLonForTile(String(p.x),String(p.y),tileMeters,radius);
    const sample=pg.sampleLatLon(geo.latitudeRadians,geo.longitudeRadians);
    return freeze({available:true,land:Boolean(sample?.land),latitudeRadians:Number(geo.latitudeRadians),longitudeRadians:Number(geo.longitudeRadians),elevationMeters:Number(sample?.elevationMeters||0)});
  }catch(_){return freeze({available:true,land:false,latitudeRadians:null,longitudeRadians:null,elevationMeters:0})}
}
function context(seedValue,pointValue,timestampValue){
  const seed=requiredSeed(seedValue),p=point(pointValue),stamp=normalizeTimestamp(timestampValue);
  const env=window.GeographyFoundation?.environment?.(seed,p.x,p.y)||{},terrain=String(window.GeographyFoundation?.getTerrainType?.(seed,p.x,p.y)||"unknown");
  const road=window.GeographyFoundation?.mainRoadInfo?.(seed,p.x,p.y)||null,country=window.PoliticalGeography?.countryAt?.(seed,p.x,p.y)||null,region=window.RegionProfile?.at?.(seed,p.x,p.y)||null;
  const surface=planetSurface(seed,p),terrainLand=!/^(water|ocean|lake)$/i.test(terrain),surfaceLand=surface.available?surface.land:terrainLand;
  return freeze({
    seed,point:p,timestamp:stamp,terrain,biome:String(env.biome||"Unknown"),climate:String(env.climate||"Unknown"),
    onRoad:Boolean(road),roadType:road?.type||null,roadContext:road?String(road.context||road.networkKind||"local-road"):"off-road",
    countryId:country?.id?String(country.id):null,countryName:country?.name?String(country.name):null,
    regionId:region?.id?String(region.id):String(window.GeographyFoundation?.hierarchy?.(seed,p.x,p.y)?.region||"unknown-region"),
    regionName:region?.name?String(region.name):null,defense:Number(region?.specialization?.defense||0),trade:Number(region?.specialization?.trade||0),
    planetSurface:surface,terrainLand,surfaceLand,visualSurfaceValid:Boolean(terrainLand&&surfaceLand),
    deterministic:true,seedAndFantasyTimeOnly:true
  });
}
function eligible(spec,ctx,w){
  if(!ctx.visualSurfaceValid)return false;
  if(spec.road&&!ctx.onRoad)return false;
  if(spec.day&&!w.daylight)return false;
  if(spec.biomes?.length&&!spec.biomes.includes(ctx.biome))return false;
  return true;
}
function visualOffsets(seed,key){
  const rows=[];
  for(let r=0;r<=VISUAL_ANCHOR_RADIUS_TILES;r++){
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      rows.push({dx,dy,rank:hash32(seed,"travel-encounter:visual-anchor:"+key+":"+dx+":"+dy)});
    }
  }
  rows.sort((a,b)=>a.rank-b.rank||Math.abs(a.dx)+Math.abs(a.dy)-Math.abs(b.dx)-Math.abs(b.dy)||a.dx-b.dx||a.dy-b.dy);
  return rows.slice(0,MAX_VISUAL_ANCHOR_CHECKS);
}
function resolveVisualAnchor(seedValue,pointValue,timestampValue,typeValue=null,keyValue="natural"){
  const seed=requiredSeed(seedValue),base=point(pointValue),stamp=normalizeTimestamp(timestampValue),spec=typeValue?CATALOG.find(x=>x.id===String(typeValue)):null;
  const offsets=visualOffsets(seed,String(keyValue)+"|"+String(typeValue||"any")+"|"+base.x+"|"+base.y);
  let checked=0;
  for(const off of offsets){
    checked++;
    const p=freeze({x:(BigInt(base.x)+BigInt(off.dx)).toString(),y:(BigInt(base.y)+BigInt(off.dy)).toString(),level:0}),ctx=context(seed,p,stamp);
    if(!ctx.visualSurfaceValid)continue;
    if(spec?.road&&!ctx.onRoad)continue;
    return freeze({valid:true,point:p,context:ctx,checkedCount:checked,maxChecks:MAX_VISUAL_ANCHOR_CHECKS,radiusTiles:VISUAL_ANCHOR_RADIUS_TILES,source:spec?.road?"bounded-canonical-road-land":"bounded-canonical-land",planetSurfaceAgreement:true});
  }
  return freeze({valid:false,point:null,context:null,checkedCount:checked,maxChecks:MAX_VISUAL_ANCHOR_CHECKS,radiusTiles:VISUAL_ANCHOR_RADIUS_TILES,source:"no-valid-canonical-surface",planetSurfaceAgreement:false});
}
function anchorFor(seed,cell,block){
  const size=BigInt(MACRO_CELL_TILES),ox=BigInt(cell.originX),oy=BigInt(cell.originY);
  const jx=(hash32(seed,"travel-encounter:anchor-x:"+cell.x+":"+cell.y+":"+block)%17)-8,jy=(hash32(seed,"travel-encounter:anchor-y:"+cell.x+":"+cell.y+":"+block)%17)-8;
  return freeze({x:(ox+size/2n+BigInt(jx)).toString(),y:(oy+size/2n+BigInt(jy)).toString(),level:0});
}
function chooseType(seed,ctx,w,cell){
  const pool=CATALOG.filter(spec=>eligible(spec,ctx,w));if(!pool.length)return null;
  const weighted=pool.map(spec=>{let weight=spec.weight;if(spec.id==="traveling-merchant"&&ctx.trade>.5)weight+=6;if(spec.id==="road-patrol"&&ctx.defense>.5)weight+=6;if(spec.id==="hunter-party"&&["Woodland","Highland"].includes(ctx.biome))weight+=8;return {spec,weight};});
  const total=weighted.reduce((n,x)=>n+x.weight,0);let pick=hash32(seed,"travel-encounter:type:"+ctx.regionId+":"+cell.x+":"+cell.y+":"+w.cooldownBlock)%Math.max(1,total);
  for(const row of weighted){if(pick<row.weight)return row.spec;pick-=row.weight}return weighted[weighted.length-1].spec;
}
function actorsFor(seed,spec,anchor,w){
  const span=Math.max(1,spec.maxActors-spec.minActors+1),count=Math.min(MAX_EXACT_ACTORS,spec.minActors+(hash32(seed,"travel-encounter:count:"+spec.id+":"+w.cooldownBlock+":"+anchor.x+":"+anchor.y)%span));
  const offsets=[[0,0],[-.72,.22],[.72,.22],[-.38,-.72],[.38,-.72]],actors=[];
  for(let i=0;i<count;i++){
    const role=spec.roles[i%spec.roles.length],propKind=spec.props[i%spec.props.length],off=offsets[i%offsets.length];
    actors.push(freeze({
      id:"TRE|"+spec.id+"|"+w.cooldownBlock+"|"+i,role:"travel-encounter",visualRole:role,propKind,
      point:anchor,presentationOffset:freeze({x:off[0],y:off[1]}),travelEncounter:true,encounterType:spec.id,
      height:1.76,elevation:.02,presentationOnly:true,simulationAuthority:false,persistentIdentity:false,selectable:false,collision:false
    }));
  }
  return freeze(actors);
}
function descriptor(seedValue,pointValue,timestampValue,forcedType=null){
  const seed=requiredSeed(seedValue),p=point(pointValue),w=windowInfo(timestampValue),cell=macroCell(p),rawAnchor=anchorFor(seed,cell,w.cooldownBlock);
  if(forcedType==null){
    const chosenOffset=hash32(seed,"travel-encounter:cooldown-slot:"+cell.x+":"+cell.y+":"+w.cooldownBlock)%COOLDOWN_WINDOWS;
    if(w.offset!==chosenOffset)return null;
    const rarity=hash32(seed,"travel-encounter:rarity:"+cell.x+":"+cell.y+":"+w.cooldownBlock)%1000;
    if(rarity>=RARE_THRESHOLD_PER_1000)return null;
  }
  let visual=resolveVisualAnchor(seed,rawAnchor,w.key,forcedType,"descriptor:"+cell.x+":"+cell.y+":"+w.cooldownBlock);
  if(!visual.valid)return null;
  let ctx=visual.context,spec=forcedType?CATALOG.find(x=>x.id===String(forcedType)):chooseType(seed,ctx,w,cell);
  if(!spec)return null;
  if(spec.road&&!ctx.onRoad){
    visual=resolveVisualAnchor(seed,rawAnchor,w.key,spec.id,"road-reanchor:"+cell.x+":"+cell.y+":"+w.cooldownBlock);
    if(!visual.valid)return null;ctx=visual.context;
  }
  if(!eligible(spec,ctx,w))return null;
  const anchor=visual.point,actors=actorsFor(seed,spec,anchor,w);
  return freeze({
    id:"TRE|"+String(hash32(seed,[ctx.regionId,cell.x,cell.y,w.cooldownBlock,spec.id,anchor.x,anchor.y].join("|")).toString(16).toUpperCase()),
    type:spec.id,title:spec.title,icon:spec.icon,summary:spec.summary,anchor,rawAnchor,visualAnchor:visual,
    macroCell:cell,windowIndex:w.index,cooldownBlock:w.cooldownBlock,windowHours:WINDOW_HOURS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,
    startedWindow:w.key.slice(0,13)+":00:00",actorCount:actors.length,actors,context:ctx,rare:true,authoritativeOutcome:false,politicalOutcome:false,
    identityAuthority:"Campaign SEED + Fantasy Game Time + deterministic local context",distantMode:"summary-only",exactMaterializationRadiusTiles:LOCAL_RADIUS_TILES,
    pooledPresentation:true,visualPresentationRevision:"travel-encounter-silhouette-v2",fullWorldScan:false,perFrameScan:false
  });
}
function probe(seedValue,pointValue,timestampValue){return descriptor(seedValue,pointValue,timestampValue,null)}
function localPresentation(seedValue,focusValue,timestampValue,optionsValue){
  const started=typeof performance!=="undefined"&&performance.now?performance.now():0,seed=requiredSeed(seedValue),focus=point(focusValue),stamp=normalizeTimestamp(timestampValue);
  const proof=proofBySeed.get(seed)||null,event=proof?.event||descriptor(seed,focus,stamp,null),distance=event?distanceTiles(focus,event.anchor):Infinity,active=Boolean(event&&distance<=LOCAL_RADIUS_TILES);
  const exactActors=active?event.actors:Object.freeze([]),elapsed=started&&performance.now?performance.now()-started:0;
  const result=freeze({
    version:VERSION,seed,active,encounter:event?freeze(clone(event)):null,exactActors,exactActorCount:exactActors.length,distanceTiles:Number.isFinite(distance)?Number(distance.toFixed(3)):null,
    mobilePresentation:Boolean(optionsValue?.mobile),poolCapacity:MAX_EXACT_ACTORS,updateMs:Number(elapsed.toFixed(3)),rareThresholdPer1000:RARE_THRESHOLD_PER_1000,
    windowHours:WINDOW_HOURS,cooldownWindows:COOLDOWN_WINDOWS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,localRadiusTiles:LOCAL_RADIUS_TILES,
    summaryOnly:Boolean(event&&!active),exactOnlyNearRelevance:true,deterministic:true,seedAndFantasyTimeOnly:true,eventDriven:true,fullWorldScan:false,perFrameScan:false,
    presentationOnlyActors:true,simulationAuthority:true,presentationAuthority:false,visualAnchorRequired:true
  });
  lastBySeed.set(seed,result);renderCard(result);return result;
}
function stream(seedValue,samplesValue){
  const seed=requiredSeed(seedValue),samples=Array.isArray(samplesValue)?samplesValue:[],events=[];
  for(let i=0;i<samples.length;i++){const sample=samples[i]||{},event=probe(seed,sample.point,sample.timestamp);if(event)events.push(freeze({sampleIndex:i,id:event.id,type:event.type,anchor:event.anchor,windowIndex:event.windowIndex,cooldownBlock:event.cooldownBlock,regionId:event.context.regionId}));}
  return freeze(events);
}
function proofActivate(seedValue,typeValue,anchorValue,timestampValue){
  const seed=requiredSeed(seedValue),type=String(typeValue||""),baseAnchor=point(anchorValue),stamp=normalizeTimestamp(timestampValue),spec=CATALOG.find(x=>x.id===type);
  if(!spec)throw new Error("Unknown encounter type: "+type);
  const w=windowInfo(stamp),cell=macroCell(baseAnchor),visual=resolveVisualAnchor(seed,baseAnchor,stamp,type,"proof:"+type+":"+w.cooldownBlock);
  if(!visual.valid)return freeze({pass:false,reason:"no-valid-visual-anchor",visual});
  const anchor=visual.point,ctx=visual.context,actors=actorsFor(seed,spec,anchor,w);
  const event=freeze({
    id:"TRE|PROOF|"+String(hash32(seed,[type,w.cooldownBlock,anchor.x,anchor.y].join("|")).toString(16).toUpperCase()),type,title:spec.title,icon:spec.icon,summary:spec.summary,
    anchor,rawAnchor:baseAnchor,visualAnchor:visual,macroCell:cell,windowIndex:w.index,cooldownBlock:w.cooldownBlock,windowHours:WINDOW_HOURS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,
    startedWindow:w.key.slice(0,13)+":00:00",actorCount:actors.length,actors,context:ctx,rare:true,authoritativeOutcome:false,politicalOutcome:false,
    identityAuthority:"Campaign SEED + Fantasy Game Time + deterministic local context",distantMode:"summary-only",exactMaterializationRadiusTiles:LOCAL_RADIUS_TILES,
    pooledPresentation:true,visualPresentationRevision:"travel-encounter-silhouette-v2",proofControlledPlacement:true,fullWorldScan:false,perFrameScan:false
  });
  proofBySeed.set(seed,freeze({event}));
  const view=localPresentation(seed,anchor,stamp,{proof:true});
  return freeze({pass:Boolean(view.active&&view.encounter?.type===type&&view.exactActorCount===event.actorCount&&ctx.visualSurfaceValid),event:view.encounter,snapshot:view});
}
function clearProof(seedValue){const seed=requiredSeed(seedValue);proofBySeed.delete(seed);lastBySeed.delete(seed);renderCard(null);return true}
function snapshot(seedValue){
  const seed=String(seedValue||"");return lastBySeed.get(seed)||freeze({
    version:VERSION,seed:seed||null,active:false,encounter:null,exactActors:Object.freeze([]),exactActorCount:0,poolCapacity:MAX_EXACT_ACTORS,
    rareThresholdPer1000:RARE_THRESHOLD_PER_1000,windowHours:WINDOW_HOURS,cooldownWindows:COOLDOWN_WINDOWS,cooldownHours:WINDOW_HOURS*COOLDOWN_WINDOWS,
    localRadiusTiles:LOCAL_RADIUS_TILES,deterministic:true,seedAndFantasyTimeOnly:true,eventDriven:true,fullWorldScan:false,perFrameScan:false,
    presentationOnlyActors:true,simulationAuthority:true,presentationAuthority:false,visualAnchorRequired:true
  });
}
function card(){
  if(typeof document==="undefined")return null;
  let node=document.getElementById("travelEncounterCard");if(node)return node;
  const root=document.getElementById("planetStageRoot")||document.body;if(!root)return null;
  node=document.createElement("aside");node.id="travelEncounterCard";node.className="travel-encounter-card";node.hidden=true;node.setAttribute("aria-live","polite");node.dataset.safeSlot="bottom-center";
  node.innerHTML='<div class="travel-encounter-kicker">RARE ENCOUNTER</div><div class="travel-encounter-row"><span class="travel-encounter-icon"></span><div><strong class="travel-encounter-title"></strong><p class="travel-encounter-summary"></p></div></div><div class="travel-encounter-meta"></div>';
  root.appendChild(node);return node;
}
function renderCard(viewValue){
  if(typeof document==="undefined")return null;
  const node=card();if(!node)return null;const view=viewValue||null,event=view?.active?view.encounter:null;
  node.hidden=!event;node.dataset.active=String(Boolean(event));node.dataset.encounterType=event?.type||"";
  if(event){
    node.querySelector(".travel-encounter-icon").textContent=event.icon;node.querySelector(".travel-encounter-title").textContent=event.title;node.querySelector(".travel-encounter-summary").textContent=event.summary;
    const road=event.context.onRoad?(event.context.roadType||"road"):"off-road";
    node.querySelector(".travel-encounter-meta").textContent=(event.context.regionName||event.context.regionId)+" · "+event.context.biome+" · "+road+" · "+event.actorCount+" traveler"+(event.actorCount===1?"":"s");
  }
  return event;
}
function autoTick(){
  try{
    const stage=window.PlanetStage?.snapshot?.(),seed=stage?.activeSeed||window.SeedSystem?.getCampaign?.()?.seed,focus=stage?.canonicalFocus?.worldTile,stamp=window.GameTime?.getTimestampKey?.()||window.GameTime?.getNow?.()||null;
    if(seed&&focus&&stamp)localPresentation(seed,focus,stamp,{auto:true});else renderCard(null);
  }catch(_){}
}
function startAuto(){if(typeof window==="undefined"||autoTimer)return;autoTimer=window.setInterval(autoTick,AUTO_TICK_MS)}

if(typeof window!=="undefined"){if(typeof document!=="undefined"&&document.readyState==="loading")document.addEventListener("DOMContentLoaded",startAuto,{once:true});else startAuto();}
window.TravelEncounters=Object.freeze({
  VERSION,WINDOW_HOURS,COOLDOWN_WINDOWS,MACRO_CELL_TILES,LOCAL_RADIUS_TILES,MAX_EXACT_ACTORS,MAX_VISUAL_ANCHOR_CHECKS,VISUAL_ANCHOR_RADIUS_TILES,RARE_THRESHOLD_PER_1000,CATALOG,
  context,resolveVisualAnchor,probe,stream,localPresentation,snapshot,proofActivate,clearProof,renderCard
});
})();