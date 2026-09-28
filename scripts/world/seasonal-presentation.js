(function(){
"use strict";

const VERSION="seasonal-presentation-v1";
const UPDATE_INTERVAL_MS=1500;
const PROFILE_CACHE_LIMIT=24;
const EVIDENCE_QUERY_KEY="seasonEvidence";
const DESKTOP_ACCENT_LIMIT=64;
const TABLET_ACCENT_LIMIT=40;
const PHONE_ACCENT_LIMIT=24;

let overlay=null,ctx=null,groundWash=null,timer=null,resizeObserver=null,evidenceStamp=null,lastSnapshot=null;
let lastWidth=0,lastHeight=0,lastDpr=1,hidden=false;
let spatialKey="",spatialRegion=null,profileCache=new Map();
let spatialHits=0,profileHits=0,updateCount=0,lastUpdateMs=0,maxUpdateMs=0,drawCount=0,lastDrawMs=0,maxDrawMs=0;
let rootNode=null,centerMarker=null,coarsePointerQuery=null,reducedMotionQuery=null,pendingDraw=0,pendingPlan=null,lastGroundSignature="",contextObserver=null,cachedRootReady=false,cachedSeed="",cachedTile=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function round(v,d=4){const f=10**d;return Math.round(Number(v)*f)/f}
function evidenceMode(){try{return new URLSearchParams(location.search).get(EVIDENCE_QUERY_KEY)==="1"}catch{return false}}
function fantasyNow(){return evidenceStamp||window.GameTime?.getNow?.()||null}
function stampKey(s){return s?[s.year,String(s.month).padStart(2,"0"),String(s.day).padStart(2,"0")].join("-"):"none"}
function deviceClass(){
  const w=Math.max(1,innerWidth||1),h=Math.max(1,innerHeight||1),short=Math.min(w,h),long=Math.max(w,h);
  if(!coarsePointerQuery&&window.matchMedia)coarsePointerQuery=matchMedia("(pointer:coarse)");
  const coarse=Boolean(coarsePointerQuery?.matches);
  if(short<=520||(long<=900&&short<=520))return "phone";
  if(short<=900||coarse)return "tablet";
  return "desktop";
}
function accentLimit(cls=deviceClass()){
  const base=cls==="phone"?PHONE_ACCENT_LIMIT:cls==="tablet"?TABLET_ACCENT_LIMIT:DESKTOP_ACCENT_LIMIT;
  if(!reducedMotionQuery&&window.matchMedia)reducedMotionQuery=matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotionQuery?.matches?Math.min(16,base):base;
}
function cacheMarkerTile(marker){
  const raw=String(marker?.dataset?.tile||""),parts=raw.split(",");
  if(parts.length===2&&parts[0]!==""&&parts[1]!=="")cachedTile=Object.freeze({x:parts[0],y:parts[1]});
}
function bindContextObserver(root){
  if(!root||contextObserver)return;
  cachedRootReady=root.dataset.ready==="true";cachedSeed=String(root.dataset.seed||"");
  centerMarker=root.querySelector(".planet-world-center");cacheMarkerTile(centerMarker);
  if(!("MutationObserver" in window))return;
  contextObserver=new MutationObserver(records=>{
    for(const record of records){
      const target=record.target;
      if(target===root){
        if(record.attributeName==="data-ready")cachedRootReady=root.dataset.ready==="true";
        else if(record.attributeName==="data-seed")cachedSeed=String(root.dataset.seed||"");
      }
      if(record.attributeName==="data-tile"&&target?.classList?.contains("planet-world-center")){centerMarker=target;cacheMarkerTile(target)}
      if(record.type==="childList"){
        for(const node of record.addedNodes||[]){
          if(node?.nodeType!==1)continue;
          const marker=node.matches?.(".planet-world-center")?node:node.querySelector?.(".planet-world-center");
          if(marker){centerMarker=marker;cacheMarkerTile(marker)}
        }
      }
    }
  });
  contextObserver.observe(root,{attributes:true,attributeFilter:["data-ready","data-seed","data-tile"],childList:true,subtree:true});
}
function stageRoot(){
  if(rootNode)return rootNode;
  rootNode=document.getElementById("planetStageRoot")||document.querySelector(".planet-stage-root");
  centerMarker=null;bindContextObserver(rootNode);return rootNode;
}
function foundationUnit(seed,key){
  if(!window.PRNG?.foundationUint32)return 0;
  return Number(window.PRNG.foundationUint32(String(seed),String(key))>>>0)/4294967296;
}
function rootContext(tileOverride=null,stampOverride=null){
  const root=stageRoot();
  if(!cachedRootReady)return null;
  const seed=cachedSeed;if(!seed)return null;
  const tile=tileOverride||cachedTile;if(!tile)return null;
  const stamp=stampOverride||fantasyNow();if(!stamp)return null;
  const normalized=tileOverride?Object.freeze({x:String(tile.x),y:String(tile.y)}):tile;
  const key=seed+"|"+normalized.x+"|"+normalized.y;
  let region=null;
  if(key===spatialKey&&spatialRegion){region=spatialRegion;spatialHits++;}
  else{
    region=window.RegionProfile?.at?.(seed,normalized.x,normalized.y)||null;
    if(region){spatialKey=key;spatialRegion=region;}
  }
  if(!region)return null;
  return Object.freeze({root,seed,tile:normalized,stamp,region});
}
function seasonForMonth(month){
  const m=Math.max(1,Math.min(12,Number(month)||1));
  if(m>=3&&m<=5)return "spring";
  if(m>=6&&m<=8)return "summer";
  if(m>=9&&m<=11)return "autumn";
  return "winter";
}
function climateBand(identity){
  const c=String(identity?.climate||"Temperate");
  if(c.startsWith("Cold"))return "cold";
  if(c.startsWith("Warm"))return "warm";
  return "temperate";
}
function buildProfile(context){
  if(!context)return null;
  const i=context.region.identity||{},season=seasonForMonth(context.stamp.month),band=climateBand(i);
  const dry=String(i.climate||"").includes("Dry"),wet=String(i.climate||"").includes("Wet");
  const temp=Number(i.averageTemperatureC||0),moist=clamp(Number(i.averageMoisturePercent||50)/100,0,1);
  const key=[context.seed,context.region.id,context.region.revision,context.stamp.year,season].join("|");
  if(profileCache.has(key)){
    const cached=profileCache.get(key);profileCache.delete(key);profileCache.set(key,cached);profileHits++;return cached;
  }
  let foliage=.72,flower=0,dryGrass=0,autumn=.0,leafFall=0,frost=0,snow=0,tint=[255,255,255,0];
  if(season==="spring"){
    foliage=clamp(.72+moist*.22+(wet?.08:0)-(dry?.12:0),.45,1);
    flower=clamp(.28+moist*.40+(band==="temperate"?.16:band==="warm"?.06:-.06),.08,.82);
    tint=[132,210,116,.105];
  }else if(season==="summer"){
    foliage=clamp(.82+moist*.14-(dry?.16:0),.48,1);
    dryGrass=clamp((1-moist)*.46+(dry?.24:0)+(band==="warm"?.16:0),0,.78);
    flower=clamp(.12+moist*.16,.04,.34);
    tint=[238,190,100,.075+dryGrass*.085];
  }else if(season==="autumn"){
    foliage=clamp(.52+moist*.15,.38,.76);
    autumn=clamp(.58+(band==="temperate"?.20:band==="cold"?.12:-.10),.30,.86);
    leafFall=clamp(.34+autumn*.42+(dry?.08:0),.24,.82);
    tint=[199,111,42,.115+autumn*.075];
  }else{
    foliage=clamp(band==="warm"?.62:band==="temperate"?.34:.20,.12,.68);
    frost=clamp((band==="cold"?.62:band==="temperate"?.32:.08)+Math.max(0,10-temp)*.025+(dry?-.06:0),0,.92);
    snow=clamp((band==="cold"?.52:band==="temperate"?.13:.01)+Math.max(0,4-temp)*.045+(wet?.10:0)-(dry?.08:0),0,.90);
    tint=[188,216,230,.10+frost*.075+snow*.09];
  }
  const accentWeights={flower,leaf:leafFall,frost,snow};
  const totalAccent=Object.values(accentWeights).reduce((a,b)=>a+b,0);
  const signature="SEASON|"+context.seed+"|"+context.region.revision+"|"+context.stamp.year+"|"+season+"|"+band+"|"+Math.round(foliage*1000)+"|"+Math.round(totalAccent*1000);
  const profile=Object.freeze({
    season,climateBand:band,climate:String(i.climate||"unknown"),averageTemperatureC:temp,averageMoisturePercent:Number(i.averageMoisturePercent||0),
    foliageDensity:round(foliage),flowerDensity:round(flower),dryGrass:round(dryGrass),autumnFoliage:round(autumn),leafFall:round(leafFall),frost:round(frost),snow:round(snow),
    tint:Object.freeze(tint.map((v,idx)=>idx<3?Number(v):round(v))),accentWeights:Object.freeze(accentWeights),signature,
    regionId:context.region.id,regionName:context.region.name,regionRevision:context.region.revision,
    authority:"Campaign SEED + RegionProfile climate + fantasy calendar",deterministic:true,climateOverrideApplied:true
  });
  profileCache.set(key,profile);while(profileCache.size>PROFILE_CACHE_LIMIT)profileCache.delete(profileCache.keys().next().value);
  return profile;
}
function previewAt(tile,stamp){return buildProfile(rootContext(tile,stamp))}
function ensureOverlay(){
  const root=stageRoot();if(!root)return null;
  if(overlay&&overlay.parentElement===root)return overlay;
  groundWash?.remove?.();overlay?.remove?.();
  groundWash=document.createElement("div");groundWash.className="seasonal-ground-treatment";groundWash.setAttribute("aria-hidden","true");
  Object.assign(groundWash.style,{position:"absolute",inset:"0",pointerEvents:"none",zIndex:"1",display:"block",mixBlendMode:"soft-light"});
  overlay=document.createElement("canvas");overlay.className="seasonal-presentation-overlay";overlay.setAttribute("aria-hidden","true");
  Object.assign(overlay.style,{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"2",display:"block"});
  root.appendChild(groundWash);root.appendChild(overlay);ctx=overlay.getContext("2d",{alpha:true,desynchronized:true});resizeOverlay();
  if(!resizeObserver&&"ResizeObserver" in window){resizeObserver=new ResizeObserver(entries=>{resizeOverlay(entries?.[0]?.contentRect||null);if(lastSnapshot?.active&&pendingPlan)scheduleDraw(lastSnapshot.profile,lastSnapshot.seed,pendingPlan)});resizeObserver.observe(root)}
  return overlay;
}
function resizeOverlay(rectOverride=null){
  if(!overlay)return;
  const r=rectOverride||overlay.getBoundingClientRect(),dpr=clamp(Number(devicePixelRatio||1),1,1.5),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(w===lastWidth&&h===lastHeight&&dpr===lastDpr)return;
  lastWidth=w;lastHeight=h;lastDpr=dpr;overlay.width=w;overlay.height=h;
}
function accentKind(profile,unit){
  const w=profile.accentWeights,total=w.flower+w.leaf+w.frost+w.snow;if(total<=.0001)return null;
  let x=unit*total;
  for(const k of ["flower","leaf","frost","snow"]){x-=w[k];if(x<=0)return k}
  return "flower";
}
function accentPlan(profile,seed,limit){
  const intensity=clamp(profile.flowerDensity+profile.leafFall+profile.frost+profile.snow,0,1.8);
  const count=Math.min(limit,Math.max(0,Math.round(limit*clamp(intensity*.72,0,1)))),entries=[],counts={count,flower:0,leaf:0,frost:0,snow:0};
  for(let i=0;i<count;i++){
    const prefix="season-accent:"+profile.signature+":"+i+":",kind=accentKind(profile,foundationUnit(seed,prefix+"kind"));if(!kind)continue;
    counts[kind]++;entries.push(Object.freeze({kind,x:foundationUnit(seed,prefix+"x"),y:.18+foundationUnit(seed,prefix+"y")*.76,size:foundationUnit(seed,prefix+"size"),rot:foundationUnit(seed,prefix+"rot"),hue:foundationUnit(seed,prefix+"hue")}));
  }
  return Object.freeze({entries:Object.freeze(entries),counts:Object.freeze(counts)});
}
function applyGroundTreatment(profile,seed){
  if(!groundWash||!profile)return;
  if(lastGroundSignature===profile.signature)return;lastGroundSignature=profile.signature;
  const u=(k)=>Math.round(12+foundationUnit(seed,"season-ground:"+profile.signature+":"+k)*76);
  let color="132,210,116",strength=.18;
  if(profile.season==="summer"){color="214,164,74";strength=.14+profile.dryGrass*.20}
  else if(profile.season==="autumn"){color="194,93,36";strength=.22+profile.autumnFoliage*.18}
  else if(profile.season==="winter"){color="205,226,235";strength=.17+profile.frost*.15+profile.snow*.18}
  else strength=.20+profile.flowerDensity*.08;
  const a=Math.min(.48,strength),a2=Math.min(.32,a*.68),x1=u("x1"),y1=u("y1"),x2=u("x2"),y2=u("y2"),x3=u("x3"),y3=u("y3");
  groundWash.style.opacity="1";
  groundWash.style.background=[
    "radial-gradient(ellipse at "+x1+"% "+y1+"%, rgba("+color+","+a.toFixed(3)+") 0%, rgba("+color+","+(a*.46).toFixed(3)+") 28%, rgba("+color+",0) 66%)",
    "radial-gradient(ellipse at "+x2+"% "+y2+"%, rgba("+color+","+a2.toFixed(3)+") 0%, rgba("+color+",0) 62%)",
    "radial-gradient(ellipse at "+x3+"% "+y3+"%, rgba("+color+","+(a2*.86).toFixed(3)+") 0%, rgba("+color+",0) 58%)",
    "linear-gradient(rgba("+profile.tint[0]+","+profile.tint[1]+","+profile.tint[2]+","+(profile.tint[3]*.72).toFixed(3)+"),rgba("+profile.tint[0]+","+profile.tint[1]+","+profile.tint[2]+","+(profile.tint[3]*.42).toFixed(3)+"))"
  ].join(",");
}
function draw(profile,seed,plan){
  if(!ctx||!overlay||!profile||!plan)return;
  const started=performance.now();if(!lastWidth||!lastHeight)resizeOverlay();const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
  const t=profile.tint;ctx.fillStyle="rgba("+t[0]+","+t[1]+","+t[2]+","+Math.min(.16,t[3]*.52)+")";ctx.fillRect(0,0,w,h);
  for(const e of plan.entries){
    const x=e.x*w,y=e.y*h,sz=(1.8+e.size*3.6)*lastDpr;
    if(e.kind==="flower"){
      ctx.fillStyle=e.hue>.5?"rgba(255,221,99,.82)":"rgba(241,155,213,.78)";
      for(let p=0;p<3;p++){const a=p*Math.PI*2/3;ctx.beginPath();ctx.arc(x+Math.cos(a)*sz*.72,y+Math.sin(a)*sz*.38,sz*.72,0,Math.PI*2);ctx.fill()}
      ctx.fillStyle="rgba(246,242,185,.82)";ctx.beginPath();ctx.arc(x,y,sz*.42,0,Math.PI*2);ctx.fill();
    }else if(e.kind==="leaf"){
      ctx.save();ctx.translate(x,y);ctx.rotate(e.rot*Math.PI);ctx.fillStyle=e.hue>.52?"rgba(206,103,38,.76)":"rgba(168,79,35,.72)";ctx.beginPath();ctx.ellipse(0,0,sz*2.0,sz*.72,0,0,Math.PI*2);ctx.fill();ctx.restore();
    }else if(e.kind==="frost"){
      ctx.strokeStyle="rgba(231,245,248,.72)";ctx.lineWidth=Math.max(1,lastDpr*.72);for(let a=0;a<3;a++){const r=a*Math.PI/3;ctx.beginPath();ctx.moveTo(x-Math.cos(r)*sz*1.35,y-Math.sin(r)*sz*.72);ctx.lineTo(x+Math.cos(r)*sz*1.35,y+Math.sin(r)*sz*.72);ctx.stroke()}
    }else{
      ctx.fillStyle="rgba(244,250,255,.54)";ctx.beginPath();ctx.ellipse(x,y,sz*2.5,sz*.82,e.rot*Math.PI,0,Math.PI*2);ctx.fill();
    }
  }
  drawCount++;lastDrawMs=performance.now()-started;maxDrawMs=Math.max(maxDrawMs,lastDrawMs);
  if(lastSnapshot)lastSnapshot=Object.freeze({...lastSnapshot,drawCount,lastDrawMs:round(lastDrawMs),maxDrawMs:round(maxDrawMs)});
}
function scheduleDraw(profile,seed,plan){
  pendingPlan=plan;if(pendingDraw)return;
  pendingDraw=requestAnimationFrame(()=>{pendingDraw=0;const next=pendingPlan;pendingPlan=null;if(lastSnapshot?.active&&next)draw(profile,seed,next)});
}
function refresh(){
  const started=performance.now(),contextStarted=performance.now(),context=rootContext(),contextMs=performance.now()-contextStarted,profileStarted=performance.now(),profile=buildProfile(context),profileMs=performance.now()-profileStarted,root=context?.root||stageRoot();
  const active=Boolean(context&&profile&&root?.dataset?.ready==="true"),cls=deviceClass(),limit=accentLimit(cls),planStarted=performance.now(),plan=profile?accentPlan(profile,context?.seed||"",limit):Object.freeze({entries:Object.freeze([]),counts:Object.freeze({count:0,flower:0,leaf:0,frost:0,snow:0})}),planMs=performance.now()-planStarted,counts=plan.counts;
  if(active){ensureOverlay();applyGroundTreatment(profile,context.seed);scheduleDraw(profile,context.seed,plan)}
  else{if(ctx&&overlay)ctx.clearRect(0,0,overlay.width,overlay.height);if(groundWash)groundWash.style.background="none"}
  updateCount++;lastUpdateMs=performance.now()-started;maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  lastSnapshot=Object.freeze({
    version:VERSION,active,ready:Boolean(context&&profile),seed:context?.seed||null,focusTile:context?.tile||null,
    fantasyTime:context?Object.freeze({...context.stamp}):null,fantasyTimeKey:context?stampKey(context.stamp):null,evidenceMode:evidenceMode(),evidenceTimeOverride:Boolean(evidenceStamp),
    profile,season:profile?.season||"pending",seasonSignature:profile?.signature||null,
    region:context?Object.freeze({id:context.region.id,name:context.region.name,revision:context.region.revision,climate:context.region.identity?.climate||"unknown"}):null,
    deviceClass:cls,accentLimit:limit,accentCount:counts.count,flowerAccentCount:counts.flower,leafAccentCount:counts.leaf,frostAccentCount:counts.frost,snowAccentCount:counts.snow,
    overlayZIndex:2,cameraLocalPresentation:true,pooledAccents:true,groundTreatmentActive:Boolean(active&&groundWash),groundPatchCount:active?3:0,materialParameterCount:3,instanceVariationCount:counts.count,
    updateIntervalMs:UPDATE_INTERVAL_MS,profileCacheEntries:profileCache.size,profileCacheLimit:PROFILE_CACHE_LIMIT,spatialCacheHits:spatialHits,profileCacheHits:profileHits,
    updatePhasesMs:Object.freeze({context:round(contextMs),profile:round(profileMs),plan:round(planMs)}),
    updateCount,lastUpdateMs:round(lastUpdateMs),maxUpdateMs:round(maxUpdateMs),drawCount,lastDrawMs:round(lastDrawMs),maxDrawMs:round(maxDrawMs),
    deterministic:true,presentationOnly:true,simulationAuthority:false,climateMutation:false,resourceMutation:false,fullWorldScan:false,perFrameWorldScan:false,lazyRelevantOnly:true
  });
  return lastSnapshot;
}
function snapshot(){return lastSnapshot||refresh()}
function setEvidenceStamp(stamp){
  if(!evidenceMode())throw new Error("SeasonalPresentation evidence time override requires ?"+EVIDENCE_QUERY_KEY+"=1");
  evidenceStamp=stamp?Object.freeze({year:Number(stamp.year),month:Number(stamp.month),day:Number(stamp.day||15),hour:Number(stamp.hour||12),minute:Number(stamp.minute||0),second:Number(stamp.second||0)}):null;
  return refresh();
}
function clearEvidenceStamp(){evidenceStamp=null;return refresh()}
function shutdown(){
  if(timer){clearInterval(timer);timer=null}if(pendingDraw){cancelAnimationFrame(pendingDraw);pendingDraw=0}resizeObserver?.disconnect?.();resizeObserver=null;contextObserver?.disconnect?.();contextObserver=null;groundWash?.remove?.();groundWash=null;overlay?.remove?.();overlay=null;ctx=null;lastSnapshot=null;pendingPlan=null;lastGroundSignature="";profileCache.clear();spatialKey="";spatialRegion=null;rootNode=null;centerMarker=null;cachedRootReady=false;cachedSeed="";cachedTile=null;coarsePointerQuery=null;reducedMotionQuery=null;
}
function bootstrap(){
  refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange",()=>{hidden=document.hidden;if(!hidden)refresh()});
}
window.SeasonalPresentation=Object.freeze({
  VERSION,snapshot,refresh,previewAt,setEvidenceStamp,clearEvidenceStamp,shutdown,
  constants:Object.freeze({UPDATE_INTERVAL_MS,PROFILE_CACHE_LIMIT,DESKTOP_ACCENT_LIMIT,TABLET_ACCENT_LIMIT,PHONE_ACCENT_LIMIT})
});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootstrap,{once:true});else bootstrap();
})();