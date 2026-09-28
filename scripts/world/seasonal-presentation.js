(function(){
"use strict";

const VERSION="seasonal-presentation-v1";
const UPDATE_INTERVAL_MS=1500;
const PROFILE_CACHE_LIMIT=24;
const EVIDENCE_QUERY_KEY="seasonEvidence";
const DESKTOP_ACCENT_LIMIT=64;
const TABLET_ACCENT_LIMIT=40;
const PHONE_ACCENT_LIMIT=24;

let overlay=null,ctx=null,timer=null,resizeObserver=null,evidenceStamp=null,lastSnapshot=null;
let lastWidth=0,lastHeight=0,lastDpr=1,hidden=false;
let spatialKey="",spatialRegion=null,profileCache=new Map();
let spatialHits=0,profileHits=0,updateCount=0,lastUpdateMs=0,maxUpdateMs=0,drawCount=0,lastDrawMs=0,maxDrawMs=0;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function round(v,d=4){const f=10**d;return Math.round(Number(v)*f)/f}
function evidenceMode(){try{return new URLSearchParams(location.search).get(EVIDENCE_QUERY_KEY)==="1"}catch{return false}}
function fantasyNow(){return evidenceStamp||window.GameTime?.getNow?.()||null}
function stampKey(s){return s?[s.year,String(s.month).padStart(2,"0"),String(s.day).padStart(2,"0")].join("-"):"none"}
function deviceClass(){
  const w=Math.max(1,innerWidth||1),h=Math.max(1,innerHeight||1),short=Math.min(w,h),long=Math.max(w,h),coarse=Boolean(matchMedia?.("(pointer:coarse)")?.matches);
  if(short<=520||(long<=900&&short<=520))return "phone";
  if(short<=900||coarse)return "tablet";
  return "desktop";
}
function accentLimit(cls=deviceClass()){
  const base=cls==="phone"?PHONE_ACCENT_LIMIT:cls==="tablet"?TABLET_ACCENT_LIMIT:DESKTOP_ACCENT_LIMIT;
  return matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?Math.min(16,base):base;
}
function foundationUnit(seed,key){
  if(!window.PRNG?.foundationUint32)return 0;
  return Number(window.PRNG.foundationUint32(String(seed),String(key))>>>0)/4294967296;
}
function rootContext(tileOverride=null,stampOverride=null){
  const root=document.getElementById("planetStageRoot")||document.querySelector(".planet-stage-root");
  if(root?.dataset?.ready!=="true")return null;
  const seed=String(root.dataset.seed||"");if(!seed)return null;
  let tile=tileOverride;
  if(!tile){
    const raw=String(root.querySelector(".planet-world-center")?.dataset?.tile||""),parts=raw.split(",");
    if(parts.length===2&&parts[0]!==""&&parts[1]!=="")tile={x:parts[0],y:parts[1]};
  }
  if(!tile)return null;
  const stamp=stampOverride||fantasyNow();if(!stamp)return null;
  const normalized=Object.freeze({x:String(tile.x),y:String(tile.y)});
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
    tint=[150,218,128,.055];
  }else if(season==="summer"){
    foliage=clamp(.82+moist*.14-(dry?.16:0),.48,1);
    dryGrass=clamp((1-moist)*.46+(dry?.24:0)+(band==="warm"?.16:0),0,.78);
    flower=clamp(.12+moist*.16,.04,.34);
    tint=[244,197,110,.045+dryGrass*.035];
  }else if(season==="autumn"){
    foliage=clamp(.52+moist*.15,.38,.76);
    autumn=clamp(.58+(band==="temperate"?.20:band==="cold"?.12:-.10),.30,.86);
    leafFall=clamp(.34+autumn*.42+(dry?.08:0),.24,.82);
    tint=[207,123,55,.07+autumn*.045];
  }else{
    foliage=clamp(band==="warm"?.62:band==="temperate"?.34:.20,.12,.68);
    frost=clamp((band==="cold"?.62:band==="temperate"?.32:.08)+Math.max(0,10-temp)*.025+(dry?-.06:0),0,.92);
    snow=clamp((band==="cold"?.52:band==="temperate"?.13:.01)+Math.max(0,4-temp)*.045+(wet?.10:0)-(dry?.08:0),0,.90);
    tint=[190,214,226,.065+frost*.05+snow*.05];
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
  const root=document.getElementById("planetStageRoot")||document.querySelector(".planet-stage-root");if(!root)return null;
  if(overlay&&overlay.parentElement===root)return overlay;
  overlay?.remove?.();overlay=document.createElement("canvas");overlay.className="seasonal-presentation-overlay";overlay.setAttribute("aria-hidden","true");
  Object.assign(overlay.style,{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"2",display:"block"});
  root.appendChild(overlay);ctx=overlay.getContext("2d",{alpha:true,desynchronized:true});resizeOverlay();
  if(!resizeObserver&&"ResizeObserver" in window){resizeObserver=new ResizeObserver(()=>{resizeOverlay();if(lastSnapshot?.active)draw(lastSnapshot.profile,lastSnapshot.seed,lastSnapshot.accentLimit)});resizeObserver.observe(root)}
  return overlay;
}
function resizeOverlay(){
  if(!overlay)return;
  const r=overlay.getBoundingClientRect(),dpr=clamp(Number(devicePixelRatio||1),1,1.5),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(w===lastWidth&&h===lastHeight&&dpr===lastDpr)return;
  lastWidth=w;lastHeight=h;lastDpr=dpr;overlay.width=w;overlay.height=h;
}
function accentKind(profile,unit){
  const w=profile.accentWeights,total=w.flower+w.leaf+w.frost+w.snow;if(total<=.0001)return null;
  let x=unit*total;
  for(const k of ["flower","leaf","frost","snow"]){x-=w[k];if(x<=0)return k}
  return "flower";
}
function draw(profile,seed,limit){
  if(!ctx||!overlay||!profile)return Object.freeze({count:0,flower:0,leaf:0,frost:0,snow:0});
  const started=performance.now();resizeOverlay();const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
  const t=profile.tint;ctx.fillStyle="rgba("+t[0]+","+t[1]+","+t[2]+","+t[3]+")";ctx.fillRect(0,0,w,h);
  const intensity=clamp(profile.flowerDensity+profile.leafFall+profile.frost+profile.snow,0,1.8);
  const count=Math.min(limit,Math.max(0,Math.round(limit*clamp(intensity*.72,0,1))));
  const counts={count,flower:0,leaf:0,frost:0,snow:0};
  for(let i=0;i<count;i++){
    const prefix="season-accent:"+profile.signature+":"+i+":",x=foundationUnit(seed,prefix+"x")*w,y=(.16+foundationUnit(seed,prefix+"y")*.80)*h,kind=accentKind(profile,foundationUnit(seed,prefix+"kind"));
    if(!kind)continue;counts[kind]++;
    const sz=(1.2+foundationUnit(seed,prefix+"size")*2.8)*lastDpr;
    if(kind==="flower"){
      ctx.fillStyle=foundationUnit(seed,prefix+"hue")>.5?"rgba(255,219,108,.72)":"rgba(237,155,211,.68)";
      ctx.beginPath();ctx.arc(x,y,sz,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="rgba(255,247,205,.55)";ctx.beginPath();ctx.arc(x+sz*.8,y-sz*.55,sz*.58,0,Math.PI*2);ctx.fill();
    }else if(kind==="leaf"){
      ctx.save();ctx.translate(x,y);ctx.rotate(foundationUnit(seed,prefix+"rot")*Math.PI);ctx.fillStyle="rgba(205,111,45,.64)";ctx.fillRect(-sz*1.6,-sz*.55,sz*3.2,sz*1.1);ctx.restore();
    }else if(kind==="frost"){
      ctx.strokeStyle="rgba(226,242,246,.52)";ctx.lineWidth=Math.max(1,lastDpr*.65);ctx.beginPath();ctx.moveTo(x-sz,y);ctx.lineTo(x+sz,y);ctx.moveTo(x,y-sz);ctx.lineTo(x,y+sz);ctx.stroke();
    }else{
      ctx.fillStyle="rgba(244,250,255,.70)";ctx.beginPath();ctx.arc(x,y,sz*.75,0,Math.PI*2);ctx.fill();
    }
  }
  drawCount++;lastDrawMs=performance.now()-started;maxDrawMs=Math.max(maxDrawMs,lastDrawMs);
  return Object.freeze(counts);
}
function refresh(){
  const started=performance.now(),context=rootContext(),profile=buildProfile(context),root=context?.root||document.getElementById("planetStageRoot");
  const active=Boolean(context&&profile&&root?.dataset?.ready==="true"),cls=deviceClass(),limit=accentLimit(cls);
  let counts=Object.freeze({count:0,flower:0,leaf:0,frost:0,snow:0});
  if(active){ensureOverlay();counts=draw(profile,context.seed,limit)}
  else if(ctx&&overlay)ctx.clearRect(0,0,overlay.width,overlay.height);
  updateCount++;lastUpdateMs=performance.now()-started;maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  lastSnapshot=Object.freeze({
    version:VERSION,active,ready:Boolean(context&&profile),seed:context?.seed||null,focusTile:context?.tile||null,
    fantasyTime:context?Object.freeze({...context.stamp}):null,fantasyTimeKey:context?stampKey(context.stamp):null,evidenceMode:evidenceMode(),evidenceTimeOverride:Boolean(evidenceStamp),
    profile,season:profile?.season||"pending",seasonSignature:profile?.signature||null,
    region:context?Object.freeze({id:context.region.id,name:context.region.name,revision:context.region.revision,climate:context.region.identity?.climate||"unknown"}):null,
    deviceClass:cls,accentLimit:limit,accentCount:counts.count,flowerAccentCount:counts.flower,leafAccentCount:counts.leaf,frostAccentCount:counts.frost,snowAccentCount:counts.snow,
    overlayZIndex:2,cameraLocalPresentation:true,pooledAccents:true,materialParameterCount:2,instanceVariationCount:counts.count,
    updateIntervalMs:UPDATE_INTERVAL_MS,profileCacheEntries:profileCache.size,profileCacheLimit:PROFILE_CACHE_LIMIT,spatialCacheHits:spatialHits,profileCacheHits:profileHits,
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
  if(timer){clearInterval(timer);timer=null}resizeObserver?.disconnect?.();resizeObserver=null;overlay?.remove?.();overlay=null;ctx=null;lastSnapshot=null;profileCache.clear();spatialKey="";spatialRegion=null;
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