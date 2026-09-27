(function(){
"use strict";

const VERSION="ambient-audio-v1";
const UPDATE_INTERVAL_MS=500;
const VOICE_LIMIT=4;
const ONE_SHOT_LIMIT=2;
const MAX_POSITIONAL_DISTANCE_METERS=220;
const DEFAULT_MASTER_VOLUME=.55;

let context=null;
let masterGain=null;
let timer=null;
let unlocked=false;
let muted=false;
let masterVolume=DEFAULT_MASTER_VOLUME;
let voices=new Map();
let bufferCache=new Map();
let lastSnapshot=null;
let updateCount=0;
let lastUpdateMs=0;
let maxUpdateMs=0;
let voiceStarts=0;
let voiceStops=0;
let unlockAttempts=0;
let unlockSuccesses=0;
let gestureArmed=true;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function hash32(text){
  let h=2166136261>>>0;
  for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
function seededUnit(seed){
  let x=(hash32(seed)||1)>>>0;
  return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296};
}
function currentSeed(stage){
  return String(window.SeedSystem?.getCampaign?.()?.seed||stage?.activeSeed||window.SeedSystem?.getSettings?.()?.seed||"");
}
function fantasyNow(){
  return window.GameTime?.getNow?.()||null;
}
function fantasyHour(stamp){
  if(!stamp)return 12;
  return ((Number(stamp.hour)||0)%24+24)%24+(Number(stamp.minute)||0)/60;
}
function tileMeters(){return Number(window.WorldStandards?.TILE_METERS||2)}
function tileDeltaMeters(a,b){
  try{return Number(BigInt(String(a||0))-BigInt(String(b||0)))*tileMeters()}catch{return (Number(a||0)-Number(b||0))*tileMeters()}
}
function lotCenter(lot){
  const b=lot?.bounds||{};
  return Object.freeze({
    x:String(lot?.cx??Math.round((Number(b.minX||0)+Number(b.maxX||0))/2)),
    y:String(lot?.cy??Math.round((Number(b.minY||0)+Number(b.maxY||0))/2))
  });
}
function attenuation(distance,radius){return clamp(1-distance/Math.max(1,radius),0,1)}
function soundProfile(type){
  const table={
    "village-chatter":{radius:150,gain:.15,priority:8,broad:false},
    "smithy-hammer":{radius:88,gain:.20,priority:10,broad:false},
    "market-murmur":{radius:96,gain:.17,priority:9,broad:false},
    "tavern-ambience":{radius:80,gain:.16,priority:8,broad:false},
    "farm-work":{radius:92,gain:.12,priority:6,broad:false},
    "water-ambience":{radius:MAX_POSITIONAL_DISTANCE_METERS,gain:.18,priority:9,broad:true},
    "woodland-birds":{radius:MAX_POSITIONAL_DISTANCE_METERS,gain:.14,priority:7,broad:true},
    "plains-wind":{radius:MAX_POSITIONAL_DISTANCE_METERS,gain:.12,priority:6,broad:true},
    "night-insects":{radius:MAX_POSITIONAL_DISTANCE_METERS,gain:.13,priority:8,broad:true}
  };
  return table[type]||{radius:100,gain:.1,priority:1,broad:false};
}
function makeZone(id,type,label,eastMeters,northMeters,authority,activityCount=0){
  const profile=soundProfile(type),distance=profile.broad?0:Math.hypot(eastMeters,northMeters);
  const gain=profile.gain*(profile.broad?1:attenuation(distance,profile.radius));
  return Object.freeze({
    id:String(id),type,label:String(label),eastMeters:Number(eastMeters.toFixed(2)),northMeters:Number(northMeters.toFixed(2)),
    distanceMeters:Number(distance.toFixed(2)),radiusMeters:profile.radius,priority:profile.priority,
    gain:Number(gain.toFixed(4)),broad:profile.broad,activityCount:Number(activityCount||0),
    authority:String(authority),deterministic:true,simulationAuthority:false
  });
}
function localBiome(sample){
  if(!sample)return "unknown";
  if(!sample.land)return "water";
  if(sample.surfaceClass==="coast")return "coast";
  if(Number(sample.elevationMeters)>1550||Number(sample.mountainInfluence)>.22)return "rocky";
  if(Number(sample.moisture)>.49)return "wooded";
  return "grassland";
}
function activityCounts(seed,when){
  const current=window.DailyActivity?.current?.(seed,when)||[];
  const byBuilding=new Map();
  let awake=0;
  for(const state of current){
    if(!state)continue;
    if(state.state!=="sleep")awake++;
    const id=state.buildingId;
    if(id&&state.state!=="sleep")byBuilding.set(String(id),(byBuilding.get(String(id))||0)+1);
  }
  return Object.freeze({current,awake,byBuilding});
}
function contextZones(){
  const stage=window.PlanetStage?.snapshot?.();
  if(!stage?.ready)return Object.freeze({stage:null,zones:Object.freeze([]),seed:"",hour:null,biome:"unknown",activityCount:0});
  const seed=currentSeed(stage);
  if(!seed)return Object.freeze({stage,zones:Object.freeze([]),seed:"",hour:null,biome:"unknown",activityCount:0});
  const when=fantasyNow(),hour=fantasyHour(when),focus=stage.canonicalFocus?.worldTile||{x:"0",y:"0"};
  const localAudible=Number(stage.zoom?.scalar||0)>=.84;
  const activity=activityCounts(seed,when),zones=[];
  const lots=window.SpecialLots?.build?.(seed)||[];
  const village=window.StartingVillage?.plan?.(seed)||null;
  if(localAudible&&village){
    const center=village.center||{x:"0",y:"0"},east=tileDeltaMeters(center.x,focus.x),north=tileDeltaMeters(center.y,focus.y);
    const distance=Math.hypot(east,north);
    if(activity.awake>=2&&distance<=170){
      zones.push(makeZone("village-chatter","village-chatter","Village chatter",east,north,"DailyActivity.current + StartingVillage.plan",activity.awake));
    }
  }
  if(localAudible){
    for(const lot of lots){
      const count=activity.byBuilding.get(String(lot.id))||0;
      if(count<=0)continue;
      const center=lotCenter(lot),east=tileDeltaMeters(center.x,focus.x),north=tileDeltaMeters(center.y,focus.y);
      let type=null,label=lot.label||lot.kind||lot.function;
      if(lot.function==="craft")type="smithy-hammer";
      else if(lot.function==="market")type="market-murmur";
      else if(lot.function==="lodging")type="tavern-ambience";
      else if(lot.function==="farm")type="farm-work";
      if(!type)continue;
      const zone=makeZone("lot-"+lot.id,type,label,east,north,"SpecialLots.build + DailyActivity.current",count);
      if(zone.distanceMeters<=zone.radiusMeters)zones.push(zone);
    }
  }
  const geo=window.PlanetGeography?.create?.(seed);
  const lat=(Number(stage.canonicalFocus?.latitudeDegrees)||0)*Math.PI/180;
  const lon=(Number(stage.canonicalFocus?.longitudeDegrees)||0)*Math.PI/180;
  const sample=geo?.sampleLatLon?.(lat,lon)||null,biome=localBiome(sample);
  if(localAudible&&sample){
    if(!sample.land||biome==="coast"){
      zones.push(makeZone("broad-water","water-ambience","Nearby water",0,0,"PlanetGeography.sampleLatLon",1));
    }else if(biome==="wooded"){
      if(hour>=5&&hour<19)zones.push(makeZone("broad-wooded","woodland-birds","Woodland ambience",0,0,"PlanetGeography.sampleLatLon + GameTime.getNow",1));
    }else{
      zones.push(makeZone("broad-wind","plains-wind","Open-land wind",0,0,"PlanetGeography.sampleLatLon",1));
    }
    if((hour>=19||hour<5)&&sample.land){
      zones.push(makeZone("broad-night","night-insects","Night insects",0,0,"GameTime.getNow + PlanetGeography.sampleLatLon",1));
    }
  }
  return Object.freeze({stage,zones:Object.freeze(zones),seed,hour:Number(hour.toFixed(3)),biome,activityCount:activity.current.length});
}
function scoreZone(zone){return zone.priority*100000-zone.distanceMeters*100-zone.id.length}
function selectZones(zones){
  return zones.filter(z=>z.gain>.002).slice().sort((a,b)=>scoreZone(b)-scoreZone(a)||a.id.localeCompare(b.id)).slice(0,VOICE_LIMIT);
}
function ensureContext(){
  if(context)return context;
  const Ctor=window.AudioContext||window.webkitAudioContext;
  if(!Ctor)return null;
  context=new Ctor({latencyHint:"interactive"});
  masterGain=context.createGain();
  masterGain.gain.value=muted?0:masterVolume;
  masterGain.connect(context.destination);
  return context;
}
function buildBuffer(type,seed){
  const ctx=ensureContext();if(!ctx)return null;
  const key=type+"|"+seed+"|"+ctx.sampleRate;
  if(bufferCache.has(key))return bufferCache.get(key);
  const seconds=1.5,length=Math.max(1,Math.floor(ctx.sampleRate*seconds)),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0),rnd=seededUnit(seed+"|audio|"+type);
  const base=90+(hash32(type+"|"+seed)%140);
  for(let i=0;i<length;i++){
    const t=i/ctx.sampleRate,phase=(t%seconds)/seconds,noise=rnd()*2-1;
    let v=0;
    if(type==="plains-wind")v=noise*(.18+.16*Math.sin(t*Math.PI*2*.23))+.025*Math.sin(t*Math.PI*2*base*.18);
    else if(type==="water-ambience")v=noise*(.15+.10*Math.sin(t*Math.PI*2*.67))+.045*Math.sin(t*Math.PI*2*55);
    else if(type==="woodland-birds"){
      const chirp=(phase>.16&&phase<.22)||(phase>.61&&phase<.69)?Math.sin(t*Math.PI*2*(900+600*phase))*.20:0;
      v=noise*.035+chirp;
    }else if(type==="night-insects")v=Math.sin(t*Math.PI*2*(2100+(hash32(seed)%500)))*(.055+.04*(Math.sin(t*Math.PI*2*3.3)>.25?1:0));
    else if(type==="smithy-hammer"){
      const beat=(t%.46),hit=Math.exp(-beat*28);
      v=hit*(noise*.34+Math.sin(t*Math.PI*2*95)*.26);
    }else if(type==="village-chatter"||type==="market-murmur"||type==="tavern-ambience"){
      v=(Math.sin(t*Math.PI*2*base)+Math.sin(t*Math.PI*2*(base*1.37)))*.045+noise*(type==="market-murmur"?.08:.055);
      if(type==="tavern-ambience"&&phase>.72&&phase<.735)v+=Math.sin(t*Math.PI*2*1200)*.12;
    }else if(type==="farm-work"){
      const beat=(t%.73),hit=Math.exp(-beat*18);v=noise*.05+hit*Math.sin(t*Math.PI*2*130)*.12;
    }else v=noise*.04;
    data[i]=clamp(v,-.72,.72);
  }
  bufferCache.set(key,buffer);return buffer;
}
function stopVoice(id,immediate=false){
  const voice=voices.get(id);if(!voice)return;
  voices.delete(id);voiceStops++;
  try{
    const now=context?.currentTime||0;
    if(!immediate&&voice.gain?.gain){voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.06);setTimeout(()=>{try{voice.source.stop()}catch{};try{voice.source.disconnect()}catch{}},220);}
    else{voice.source.stop();voice.source.disconnect();}
  }catch{}
}
function stopAllVoices(immediate=false){for(const id of Array.from(voices.keys()))stopVoice(id,immediate)}
function voicePan(zone){return zone.broad?0:clamp(zone.eastMeters/Math.max(1,zone.radiusMeters),-1,1)}
function startVoice(zone,seed){
  const ctx=ensureContext();if(!ctx||ctx.state!=="running")return null;
  const buffer=buildBuffer(zone.type,seed);if(!buffer)return null;
  const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();
  source.buffer=buffer;source.loop=true;gain.gain.value=0;pan.pan.value=voicePan(zone);
  source.connect(gain);gain.connect(pan);pan.connect(masterGain);source.start();
  const now=ctx.currentTime;gain.gain.setTargetAtTime(zone.gain,now,.08);
  const voice={id:zone.id,type:zone.type,source,gain,pan,zone};voices.set(zone.id,voice);voiceStarts++;return voice;
}
function syncVoices(selected,seed){
  const wanted=new Set(selected.map(z=>z.id));
  for(const id of Array.from(voices.keys()))if(!wanted.has(id))stopVoice(id);
  if(!unlocked||!context||context.state!=="running")return;
  const now=context.currentTime;
  for(const zone of selected){
    let voice=voices.get(zone.id);
    if(!voice)voice=startVoice(zone,seed);
    if(!voice)continue;
    voice.zone=zone;voice.pan.pan.setTargetAtTime(voicePan(zone),now,.10);
    voice.gain.gain.setTargetAtTime(zone.gain,now,.10);
  }
}
function refresh(){
  const started=performance.now(),contextState=context?.state||"uninitialized";
  const planned=contextZones(),selected=selectZones(planned.zones);
  syncVoices(selected,planned.seed);
  updateCount++;lastUpdateMs=performance.now()-started;maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  lastSnapshot=Object.freeze({
    version:VERSION,available:Boolean(window.AudioContext||window.webkitAudioContext),gestureArmed,unlocked,
    contextState:context?.state||contextState,muted,masterVolume,updateIntervalMs:UPDATE_INTERVAL_MS,
    voiceLimit:VOICE_LIMIT,oneShotLimit:ONE_SHOT_LIMIT,activeVoiceCount:voices.size,activeOneShotCount:0,
    candidateZoneCount:planned.zones.length,selectedZoneCount:selected.length,activeZoneIds:Object.freeze(Array.from(voices.keys())),
    selectedZoneTypes:Object.freeze(selected.map(z=>z.type)),zones:Object.freeze(selected.map(z=>Object.freeze({...z}))),
    focusBiome:planned.biome,fantasyHour:planned.hour,activitySampleCount:planned.activityCount,
    updateCount,lastUpdateMs:Number(lastUpdateMs.toFixed(4)),maxUpdateMs:Number(maxUpdateMs.toFixed(4)),
    voiceStarts,voiceStops,bufferCount:bufferCache.size,unlockAttempts,unlockSuccesses,
    autoplayPolicy:"trusted-user-gesture",positionalModel:"bounded stereo-pan + distance attenuation",
    authoritativeSources:Object.freeze(["PlanetStage.canonicalFocus","PlanetGeography.sampleLatLon","StartingVillage.plan","SpecialLots.build","DailyActivity.current","GameTime.getNow"]),
    fullWorldScan:false,presentationOnly:true,simulationAuthority:false,deterministicContextSelection:true,perFrameScan:false
  });
  return lastSnapshot;
}
async function requestEnable(){
  unlockAttempts++;
  const ctx=ensureContext();
  if(!ctx){refresh();return snapshot()}
  try{await ctx.resume()}catch{}
  unlocked=ctx.state==="running";
  if(unlocked){unlockSuccesses++;gestureArmed=false;removeGestureListeners();}
  refresh();return snapshot();
}
function onTrustedGesture(event){if(event?.isTrusted===false)return;requestEnable()}
function addGestureListeners(){
  if(!gestureArmed)return;
  window.addEventListener("pointerdown",onTrustedGesture,{passive:true});
  window.addEventListener("touchstart",onTrustedGesture,{passive:true});
  window.addEventListener("keydown",onTrustedGesture,{passive:true});
  window.addEventListener("click",onTrustedGesture,{passive:true});
}
function removeGestureListeners(){
  window.removeEventListener("pointerdown",onTrustedGesture);
  window.removeEventListener("touchstart",onTrustedGesture);
  window.removeEventListener("keydown",onTrustedGesture);
  window.removeEventListener("click",onTrustedGesture);
}
function setMuted(value){
  muted=Boolean(value);if(masterGain&&context){masterGain.gain.setTargetAtTime(muted?0:masterVolume,context.currentTime,.05)}
  return refresh();
}
function setMasterVolume(value){
  masterVolume=clamp(Number(value)||0,0,1);if(masterGain&&context&&!muted)masterGain.gain.setTargetAtTime(masterVolume,context.currentTime,.05);
  return refresh();
}
function snapshot(){return lastSnapshot||refresh()}
function shutdown(){
  if(timer){clearInterval(timer);timer=null}
  removeGestureListeners();stopAllVoices(true);try{context?.close?.()}catch{}
  context=null;masterGain=null;unlocked=false;bufferCache=new Map();lastSnapshot=null;
}
function bootstrap(){
  addGestureListeners();
  refresh();
  timer=setInterval(()=>{if(document.hidden){stopAllVoices();return}refresh()},UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopAllVoices();else refresh()});
}
window.AmbientAudio=Object.freeze({VERSION,snapshot,refresh,requestEnable,setMuted,setMasterVolume,shutdown,constants:Object.freeze({UPDATE_INTERVAL_MS,VOICE_LIMIT,ONE_SHOT_LIMIT,MAX_POSITIONAL_DISTANCE_METERS})});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootstrap,{once:true});else bootstrap();
})();