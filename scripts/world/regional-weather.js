(function(){
"use strict";

const VERSION="regional-weather-v1";
const UPDATE_INTERVAL_MS=750;
const PERIOD_HOURS=3;
const DESKTOP_PARTICLE_LIMIT=96;
const TABLET_PARTICLE_LIMIT=64;
const PHONE_PARTICLE_LIMIT=40;
const EVIDENCE_QUERY_KEY="weatherEvidence";

let overlay=null;
let ctx=null;
let timer=null;
let raf=0;
let resizeObserver=null;
let evidenceStamp=null;
let lastSnapshot=null;
let lastStateKey="";
let particles=[];
let updateCount=0;
let frameCount=0;
let lastUpdateMs=0;
let maxUpdateMs=0;
let lastFrameMs=0;
let maxFrameMs=0;
let lastWidth=0;
let lastHeight=0;
let lastDpr=1;
let hidden=false;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function round(v,digits=4){const f=10**digits;return Math.round(Number(v)*f)/f}
function currentSeed(stage){return String(window.SeedSystem?.getCampaign?.()?.seed||stage?.activeSeed||window.SeedSystem?.getSettings?.()?.seed||"")}
function evidenceMode(){try{return new URLSearchParams(location.search).get(EVIDENCE_QUERY_KEY)==="1"}catch{return false}}
function fantasyNow(){return evidenceStamp||window.GameTime?.getNow?.()||null}
function stampKey(stamp){
  if(!stamp)return "none";
  return [stamp.year,String(stamp.month).padStart(2,"0"),String(stamp.day).padStart(2,"0"),String(stamp.hour).padStart(2,"0"),String(stamp.minute||0).padStart(2,"0")].join("-");
}
function stampMs(stamp){
  if(!stamp)return 0;
  return Date.UTC(Number(stamp.year)||0,Math.max(0,(Number(stamp.month)||1)-1),Number(stamp.day)||1,Number(stamp.hour)||0,Number(stamp.minute)||0,Number(stamp.second)||0);
}
function fromMs(ms){
  const d=new Date(ms);
  return Object.freeze({year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()});
}
function foundationUnit(seed,key){
  if(!window.PRNG?.foundationUint32)return null;
  return Number(window.PRNG.foundationUint32(String(seed),String(key))>>>0)/4294967296;
}
function deviceClass(){
  const w=Math.max(1,window.innerWidth||1),h=Math.max(1,window.innerHeight||1),short=Math.min(w,h),long=Math.max(w,h),coarse=Boolean(window.matchMedia?.("(pointer:coarse)")?.matches);
  if(short<=520||(long<=900&&short<=520))return "phone";
  if(short<=900||coarse)return "tablet";
  return "desktop";
}
function particleLimit(){
  const cls=deviceClass();
  const base=cls==="phone"?PHONE_PARTICLE_LIMIT:cls==="tablet"?TABLET_PARTICLE_LIMIT:DESKTOP_PARTICLE_LIMIT;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?Math.min(24,base):base;
}
function focusContext(tileOverride=null,stampOverride=null){
  const stage=window.PlanetStage?.snapshot?.()||null;
  if(!stage?.ready)return null;
  const seed=currentSeed(stage);if(!seed)return null;
  const tile=tileOverride||stage.canonicalFocus?.worldTile||{x:"0",y:"0"};
  const stamp=stampOverride||fantasyNow();if(!stamp)return null;
  const region=window.RegionProfile?.at?.(seed,String(tile.x),String(tile.y))||null;
  if(!region)return null;
  const lat=Number(stage.canonicalFocus?.latitudeDegrees||0)*Math.PI/180,lon=Number(stage.canonicalFocus?.longitudeDegrees||0)*Math.PI/180;
  const geo=window.PlanetGeography?.create?.(seed)||null;
  const surface=geo?.sampleLatLon?.(lat,lon)||null;
  return Object.freeze({stage,seed,tile:Object.freeze({x:String(tile.x),y:String(tile.y)}),stamp,region,surface});
}
function seasonFactor(month){
  const m=Math.max(1,Math.min(12,Number(month)||1));
  if(m===12||m<=2)return Object.freeze({wet:.12,fog:.08,storm:-.02,wind:.08});
  if(m<=5)return Object.freeze({wet:.14,fog:.06,storm:.02,wind:.02});
  if(m<=8)return Object.freeze({wet:-.10,fog:-.04,storm:.06,wind:.01});
  return Object.freeze({wet:.07,fog:.08,storm:.03,wind:.06});
}
function chooseWeather(context){
  if(!context||!window.PRNG?.foundationUint32)return null;
  const i=context.region.identity||{},haz=i.hazards||{},stamp=context.stamp;
  const bucket=Math.floor((Number(stamp.hour)||0)/PERIOD_HOURS);
  const period=[stamp.year,stamp.month,stamp.day,bucket].join(":");
  const regionalKey=[context.region.id,context.region.revision,period].join("|");
  const roll=foundationUnit(context.seed,"regional-weather:state:"+regionalKey);
  const intensityRoll=foundationUnit(context.seed,"regional-weather:intensity:"+regionalKey);
  const directionRoll=foundationUnit(context.seed,"regional-weather:wind-direction:"+regionalKey);
  if(roll==null||intensityRoll==null||directionRoll==null)return null;
  const moisture=clamp(Number(i.averageMoisturePercent||50)/100,0,1),water=clamp(Number(i.waterAccess||0),0,1),rugged=clamp(Number(haz.rugged||0),0,1),flood=clamp(Number(haz.flood||0),0,1),drought=clamp(Number(haz.drought||0),0,1),season=seasonFactor(stamp.month);
  const weights={
    clear:Math.max(.08,.28+(1-moisture)*.24+drought*.13-season.wet*.28),
    cloudy:Math.max(.08,.20+moisture*.13),
    rain:Math.max(.06,.12+moisture*.31+water*.08+season.wet*.35),
    fog:Math.max(.04,.07+moisture*.11+water*.14+season.fog*.32),
    windy:Math.max(.05,.10+rugged*.12+season.wind*.34),
    storm:Math.max(.025,.035+flood*.08+moisture*.06+Math.max(0,season.storm)*.25)
  };
  const order=["clear","cloudy","rain","fog","windy","storm"],total=order.reduce((sum,k)=>sum+weights[k],0);
  let cursor=roll*total,state="clear";
  for(const key of order){cursor-=weights[key];if(cursor<=0){state=key;break}}
  const baseIntensity={clear:.12,cloudy:.38,rain:.62,fog:.58,windy:.54,storm:.82}[state];
  const spread={clear:.18,cloudy:.28,rain:.28,fog:.25,windy:.34,storm:.18}[state];
  const intensity=clamp(baseIntensity+(intensityRoll-.5)*spread,.05,1);
  const windIntensity=clamp((state==="windy"?.62:state==="storm"?.78:state==="rain"?.32:.12)+rugged*.18+(intensityRoll-.5)*.12,0,1);
  const precipitation=state==="rain"?intensity:state==="storm"?clamp(intensity+.12,0,1):0;
  const fog=state==="fog"?clamp(.42+intensity*.42,0,1):state==="rain"?clamp(.10+intensity*.10,0,.24):state==="storm"?.18:state==="cloudy"?.08:0;
  const wetness=precipitation>0?clamp(.32+precipitation*.62,0,1):state==="fog"?.16:0;
  const shelterPreferred=(state==="rain"&&intensity>=.55)||state==="storm";
  const signature="RW|"+context.seed+"|"+regionalKey+"|"+state+"|"+Math.round(intensity*1000);
  return Object.freeze({
    state,intensity:round(intensity),precipitation:round(precipitation),fog:round(fog),wetness:round(wetness),windIntensity:round(windIntensity),windDirectionDegrees:round(directionRoll*360,2),shelterPreferred,
    periodHours:PERIOD_HOURS,periodBucket:bucket,periodKey:period,regionalKey,signature,
    regionId:context.region.id,regionName:context.region.name,regionRevision:context.region.revision,
    climate:String(i.climate||"unknown"),averageMoisturePercent:Number(i.averageMoisturePercent||0),averageTemperatureC:Number(i.averageTemperatureC||0),waterAccess:Number(i.waterAccess||0),
    authority:"SEED + RegionProfile + fantasy time",deterministic:true
  });
}
function previewAt(tile,stamp){const c=focusContext(tile,stamp);return chooseWeather(c)}
function findEvidenceTimes(states,tile=null,baseStamp=null,maxDays=180){
  const requested=Array.from(new Set((states||["clear","rain","fog"]).map(String))),found={};
  const base=baseStamp||window.GameTime?.getNow?.()||{year:1100,month:1,day:1,hour:0,minute:0,second:0};
  const start=Date.UTC(base.year,Math.max(0,base.month-1),base.day,0,0,0),steps=Math.max(1,Math.floor(Number(maxDays)||180))*24/PERIOD_HOURS;
  for(let step=0;step<steps&&Object.keys(found).length<requested.length;step++){
    const stamp=fromMs(start+step*PERIOD_HOURS*3600000),weather=previewAt(tile,stamp);if(!weather)continue;
    if(requested.includes(weather.state)&&!found[weather.state])found[weather.state]=Object.freeze({stamp,weather});
  }
  return Object.freeze(found);
}
function ensureOverlay(){
  const root=document.getElementById("planetStageRoot")||document.querySelector(".planet-stage-root");
  if(!root)return null;
  if(overlay&&overlay.parentElement===root)return overlay;
  overlay?.remove?.();
  overlay=document.createElement("canvas");overlay.className="regional-weather-overlay";overlay.setAttribute("aria-hidden","true");
  Object.assign(overlay.style,{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none",zIndex:"3",display:"block"});
  root.appendChild(overlay);ctx=overlay.getContext("2d",{alpha:true,desynchronized:true});
  resizeOverlay();
  if(!resizeObserver&&"ResizeObserver" in window){resizeObserver=new ResizeObserver(resizeOverlay);resizeObserver.observe(root)}
  return overlay;
}
function resizeOverlay(){
  if(!overlay)return;
  const rect=overlay.getBoundingClientRect(),dpr=clamp(Number(window.devicePixelRatio||1),1,1.5),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
  if(w===lastWidth&&h===lastHeight&&dpr===lastDpr)return;
  lastWidth=w;lastHeight=h;lastDpr=dpr;overlay.width=w;overlay.height=h;
}
function initParticles(weather){
  const count=weather&&(weather.precipitation>0||weather.state==="windy"||weather.state==="fog")?particleLimit():0,arr=[];
  const seed=currentSeed(window.PlanetStage?.snapshot?.()||{});
  for(let index=0;index<count;index++){
    const prefix="regional-weather:particle:"+weather.signature+":"+index+":";
    const u=foundationUnit(seed,prefix+"x")??0;
    const v=foundationUnit(seed,prefix+"y")??0;
    const speed=foundationUnit(seed,prefix+"speed")??0;
    const size=foundationUnit(seed,prefix+"size")??0;
    arr.push({u,v,speed,size});
  }
  particles=arr;
}
function renderWash(weather,w,h){
  if(!ctx)return;
  if(weather.state==="clear"){
    const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,"rgba(255,220,150,0.035)");g.addColorStop(.58,"rgba(255,255,255,0)");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);return;
  }
  const table={cloudy:[38,48,62,.16],rain:[30,45,61,.24],fog:[204,214,216,.28],windy:[38,50,56,.08],storm:[19,29,43,.34]};
  const c=table[weather.state]||table.cloudy;ctx.fillStyle="rgba("+c[0]+","+c[1]+","+c[2]+","+c[3]+")";ctx.fillRect(0,0,w,h);
  if(weather.fog>0){
    const fogAlpha=.08+weather.fog*.22;
    for(let i=0;i<5;i++){
      const x=w*(.1+i*.22),y=h*(.28+(i%2)*.18),r=Math.max(w,h)*(.20+.035*i),g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,"rgba(225,232,230,"+fogAlpha+")");g.addColorStop(1,"rgba(225,232,230,0)");ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    }
  }
}
function renderParticles(weather,w,h,stamp){
  if(!ctx||!particles.length)return;
  const t=(stampMs(stamp)/1000)%120,angle=(weather.windDirectionDegrees||0)*Math.PI/180,windX=Math.sin(angle)*weather.windIntensity;
  if(weather.precipitation>0){
    ctx.save();ctx.lineCap="round";ctx.strokeStyle=weather.state==="storm"?"rgba(190,218,235,.70)":"rgba(188,216,230,.56)";ctx.lineWidth=Math.max(1,lastDpr*.8);
    const length=10+weather.intensity*18;
    for(const p of particles){
      const phase=(p.v+t*(.45+p.speed*.55))%1,x=((p.u+t*windX*.015)%1+1)%1*w,y=phase*h,dx=windX*length*.75;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx,y+length);ctx.stroke();
    }
    ctx.restore();
  }else if(weather.state==="windy"){
    ctx.save();ctx.strokeStyle="rgba(220,226,205,.34)";ctx.lineWidth=Math.max(1,lastDpr*.7);
    for(let i=0;i<Math.min(particles.length,42);i++){const p=particles[i],x=((p.u+t*.022*windX)%1+1)%1*w,y=p.v*h,len=8+p.size*17;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(angle)*len,y+Math.sin(angle)*len*.38);ctx.stroke()}
    ctx.restore();
  }
}
function updateCanvasFilter(weather){
  const canvas=document.getElementById("planetCanvas");if(!canvas)return;
  let filter="";
  if(weather.state==="cloudy")filter="brightness(.93) saturate(.88)";
  else if(weather.state==="rain")filter="brightness(.86) saturate(.78) contrast(1.04)";
  else if(weather.state==="fog")filter="brightness(1.03) saturate(.70) contrast(.88)";
  else if(weather.state==="storm")filter="brightness(.74) saturate(.70) contrast(1.08)";
  else if(weather.state==="windy")filter="brightness(.98) saturate(.94)";
  canvas.style.transition="filter .35s ease";canvas.style.filter=filter;
}
function scheduleHook(context,weather){
  const available=Boolean(window.DailyActivity?.current),states=available?(window.DailyActivity.current(context.seed,context.stamp)||[]):[];
  const candidates=states.filter(item=>item&&item.state!=="sleep");
  return Object.freeze({
    available,preferShelter:Boolean(weather.shelterPreferred),condition:weather.state,intensity:weather.intensity,
    candidateResidentCount:candidates.length,totalResidentCount:states.length,
    recommendedTargetClass:weather.shelterPreferred?"indoors-or-covered":null,
    applied:false,mutation:false,fallbackSafe:true,authority:"read-only weather behavior hook"
  });
}
function frame(){
  raf=0;if(hidden||!lastSnapshot?.active||!overlay||!ctx)return;
  const started=performance.now();resizeOverlay();const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
  renderWash(lastSnapshot.weather,w,h);renderParticles(lastSnapshot.weather,w,h,lastSnapshot.fantasyTime);
  frameCount++;lastFrameMs=performance.now()-started;maxFrameMs=Math.max(maxFrameMs,lastFrameMs);
  raf=requestAnimationFrame(frame);
}
function ensureFrameLoop(){if(!raf&&!hidden&&lastSnapshot?.active)raf=requestAnimationFrame(frame)}
function refresh(){
  const started=performance.now(),context=focusContext(),weather=chooseWeather(context);
  const root=document.getElementById("planetStageRoot")||document.querySelector(".planet-stage-root"),active=Boolean(context&&weather&&root?.dataset?.ready==="true");
  if(active)ensureOverlay();
  if(weather&&weather.signature!==lastStateKey){lastStateKey=weather.signature;initParticles(weather)}
  if(weather)updateCanvasFilter(weather);
  const hook=context&&weather?scheduleHook(context,weather):Object.freeze({available:false,preferShelter:false,candidateResidentCount:0,totalResidentCount:0,applied:false,mutation:false,fallbackSafe:true});
  updateCount++;lastUpdateMs=performance.now()-started;maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  const limit=particleLimit(),particleCount=weather?(weather.precipitation>0?Math.min(limit,Math.max(12,Math.round(limit*weather.precipitation))):weather.state==="windy"?Math.min(limit,42):weather.state==="fog"?Math.min(limit,24):0):0;
  if(particles.length!==particleCount&&weather){particles=particles.slice(0,particleCount);while(particles.length<particleCount){const index=particles.length,prefix="regional-weather:particle:"+weather.signature+":"+index+":";particles.push({u:foundationUnit(context.seed,prefix+"x")||0,v:foundationUnit(context.seed,prefix+"y")||0,speed:foundationUnit(context.seed,prefix+"speed")||0,size:foundationUnit(context.seed,prefix+"size")||0})}}
  lastSnapshot=Object.freeze({
    version:VERSION,active,ready:Boolean(context&&weather),weather,weatherState:weather?.state||"pending",weatherSignature:weather?.signature||null,
    fantasyTime:context?Object.freeze({...context.stamp}):null,fantasyTimeKey:context?stampKey(context.stamp):null,evidenceTimeOverride:Boolean(evidenceStamp),evidenceMode:evidenceMode(),
    region:context?Object.freeze({id:context.region.id,name:context.region.name,revision:context.region.revision,parentCountryId:context.region.parentCountryId,climate:context.region.identity?.climate||"unknown"}):null,
    focusTile:context?.tile||null,updateIntervalMs:UPDATE_INTERVAL_MS,periodHours:PERIOD_HOURS,deviceClass:deviceClass(),particleLimit:limit,activeParticleCount:particleCount,particlePoolSize:particles.length,
    pooledParticles:true,cameraLocalParticles:true,canvasOverlay:true,overlayZIndex:3,mapLabelsRemainAbove:true,
    fogAlpha:weather?.fog||0,wetness:weather?.wetness||0,windMotionIntensity:weather?.windIntensity||0,
    scheduleHook:hook,audioHints:Object.freeze({rainGain:round((weather?.precipitation||0)*.18),windGain:round((weather?.windIntensity||0)*.12),waterAmbienceBoost:round((weather?.state==="rain"||weather?.state==="storm")?.08:0)}),
    updateCount,frameCount,lastUpdateMs:round(lastUpdateMs),maxUpdateMs:round(maxUpdateMs),lastFrameMs:round(lastFrameMs),maxFrameMs:round(maxFrameMs),
    authoritativeSources:Object.freeze(["SeedSystem campaign SEED","RegionProfile.at","GameTime.getNow","PlanetStage.canonicalFocus","PRNG.foundationUint32"]),
    deterministicState:true,regional:true,presentationOnly:true,simulationAuthority:false,terrainMutation:false,scheduleMutation:false,fullWorldScan:false,perFrameWorldScan:false
  });
  if(active)ensureFrameLoop();else{if(raf){cancelAnimationFrame(raf);raf=0}if(ctx&&overlay)ctx.clearRect(0,0,overlay.width,overlay.height)}
  return lastSnapshot;
}
function snapshot(){return lastSnapshot||refresh()}
function setEvidenceStamp(stamp){
  if(!evidenceMode())throw new Error("RegionalWeather evidence time override requires ?"+EVIDENCE_QUERY_KEY+"=1");
  evidenceStamp=stamp?Object.freeze({year:Number(stamp.year),month:Number(stamp.month),day:Number(stamp.day),hour:Number(stamp.hour||0),minute:Number(stamp.minute||0),second:Number(stamp.second||0)}):null;
  return refresh();
}
function clearEvidenceStamp(){evidenceStamp=null;return refresh()}
function shutdown(){
  if(timer){clearInterval(timer);timer=null}if(raf){cancelAnimationFrame(raf);raf=0}resizeObserver?.disconnect?.();resizeObserver=null;
  const canvas=document.getElementById("planetCanvas");if(canvas)canvas.style.filter="";
  overlay?.remove?.();overlay=null;ctx=null;particles=[];lastSnapshot=null;lastStateKey="";
}
function bootstrap(){
  refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange",()=>{hidden=document.hidden;if(hidden){if(raf){cancelAnimationFrame(raf);raf=0}}else{refresh();ensureFrameLoop()}});
}
window.RegionalWeather=Object.freeze({VERSION,snapshot,refresh,previewAt,findEvidenceTimes,setEvidenceStamp,clearEvidenceStamp,shutdown,constants:Object.freeze({UPDATE_INTERVAL_MS,PERIOD_HOURS,DESKTOP_PARTICLE_LIMIT,TABLET_PARTICLE_LIMIT,PHONE_PARTICLE_LIMIT})});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootstrap,{once:true});else bootstrap();
})();