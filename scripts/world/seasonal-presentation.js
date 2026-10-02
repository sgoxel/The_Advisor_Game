(function(){
"use strict";

const VERSION="seasonal-presentation-v2";
const UPDATE_INTERVAL_MS=1500;
const PROFILE_CACHE_LIMIT=24;
const EVIDENCE_QUERY_KEY="seasonEvidence";
const DESKTOP_ACCENT_LIMIT=64;
const TABLET_ACCENT_LIMIT=40;
const PHONE_ACCENT_LIMIT=24;
const MAX_ACCENT_FOOTPRINT_HEIGHT_METERS=140;
const ACCENT_GRID_METERS=4;
const ANCHOR_REPROJECT_INTERVAL_MS=32;

let overlay=null,ctx=null,groundWash=null,timer=null,resizeObserver=null,evidenceStamp=null,lastSnapshot=null;
let lastWidth=0,lastHeight=0,lastDpr=1,hidden=false;
let spatialKey="",spatialRegion=null,profileCache=new Map();
let spatialHits=0,profileHits=0,updateCount=0,lastUpdateMs=0,maxUpdateMs=0,drawCount=0,lastDrawMs=0,maxDrawMs=0;
let rootNode=null,centerMarker=null,coarsePointerQuery=null,reducedMotionQuery=null,pendingDraw=0,pendingPlan=null,lastGroundSignature="",contextObserver=null,cachedRootReady=false,cachedSeed="",cachedTile=null;
let activePlan=null,activeProfile=null,activeSeed="",lastProjectedSamples=Object.freeze([]),lastRenderedAccentCount=0,anchorProjectionUpdates=0;
let anchorFollowRaf=0,anchorFollowUntil=0,lastAnchorFrameAt=0,navigationListenersBound=false;

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
        else if(record.attributeName==="data-local-decorative-eligible"&&lastSnapshot?.active)refresh();
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
  contextObserver.observe(root,{attributes:true,attributeFilter:["data-ready","data-seed","data-tile","data-local-decorative-eligible"],childList:true,subtree:true});
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
function floorDivBigInt(value,divisor){
  let q=value/divisor,r=value%divisor;
  if(r<0n)q-=1n;
  return q;
}
function emptyAccentPlan(view=null){
  return Object.freeze({entries:Object.freeze([]),counts:Object.freeze({count:0,flower:0,leaf:0,frost:0,snow:0}),view,worldAnchored:true,anchorMode:"canonical-world-tile-grid"});
}
function stageView(root=stageRoot()){
  const stage=window.PlanetStage?.snapshot?.()||null;
  if(!stage?.ready)return null;
  const focusTile=stage.canonicalFocus?.worldTile||null,focusScreen=stage.canonicalFocus?.screenSpaceFocus||null;
  const widthMeters=Number(stage.zoom?.visibleFootprintWidthMeters||0),heightMeters=Number(stage.zoom?.visibleFootprintHeightMeters||0);
  const rect=root?.getBoundingClientRect?.()||null,cssWidth=Math.max(1,Number(rect?.width||innerWidth||1)),cssHeight=Math.max(1,Number(rect?.height||innerHeight||1));
  if(!focusTile||!Number.isFinite(widthMeters)||!Number.isFinite(heightMeters)||widthMeters<=0||heightMeters<=0)return null;
  const localDecorative=String(root?.dataset?.localDecorativeEligible||"true")!=="false";
  const tangent=Boolean(stage.projection?.tangentPatchActive);
  const physicalScaleEligible=localDecorative&&tangent&&heightMeters<=MAX_ACCENT_FOOTPRINT_HEIGHT_METERS;
  return Object.freeze({
    focusTile:Object.freeze({x:String(focusTile.x),y:String(focusTile.y)}),
    focusX:Number.isFinite(Number(focusScreen?.screenX))?Number(focusScreen.screenX):cssWidth*.5,
    focusY:Number.isFinite(Number(focusScreen?.screenY))?Number(focusScreen.screenY):cssHeight*.5,
    widthMeters,heightMeters,cssWidth,cssHeight,physicalScaleEligible,tangent,localDecorative,
    scaleLabel:String(stage.zoom?.scaleLabel||""),scaleIndex:Number(stage.zoom?.scaleIndex||0)
  });
}
function projectAccent(entry,view){
  if(!entry||!view?.focusTile)return null;
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||2));
  let dxTiles=0,dyTiles=0;
  try{
    dxTiles=Number(BigInt(String(entry.tileX))-BigInt(String(view.focusTile.x)));
    dyTiles=Number(BigInt(String(entry.tileY))-BigInt(String(view.focusTile.y)));
  }catch{return null}
  const eastMeters=dxTiles*tileMeters+Number(entry.jitterEastMeters||0),northMeters=dyTiles*tileMeters+Number(entry.jitterNorthMeters||0);
  const x=view.focusX+(eastMeters/view.widthMeters)*view.cssWidth;
  const y=view.focusY-(northMeters/view.heightMeters)*view.cssHeight;
  const sizeCss=(Number(entry.worldSizeMeters||0)/view.heightMeters)*view.cssHeight;
  return Object.freeze({id:entry.id,x,y,sizeCss,eastMeters,northMeters});
}
function requestAnchorFollow(durationMs=900){
  anchorFollowUntil=Math.max(anchorFollowUntil,performance.now()+Math.max(120,Number(durationMs)||900));
  if(!anchorFollowRaf)anchorFollowRaf=requestAnimationFrame(anchorFollowTick);
}
function anchorFollowTick(now){
  anchorFollowRaf=0;
  if(now-lastAnchorFrameAt>=ANCHOR_REPROJECT_INTERVAL_MS&&lastSnapshot?.active&&activePlan&&activeProfile){
    lastAnchorFrameAt=now;
    const view=stageView();
    draw(activeProfile,activeSeed,activePlan,view);
  }
  if(now<anchorFollowUntil&&lastSnapshot?.active)anchorFollowRaf=requestAnimationFrame(anchorFollowTick);
}
function onNavigationInput(event){
  if(event?.type==="pointermove"&&!event.buttons)return;
  requestAnchorFollow();
}
function bindNavigationListeners(){
  if(navigationListenersBound)return;
  navigationListenersBound=true;
  window.addEventListener("wheel",onNavigationInput,{passive:true,capture:true});
  window.addEventListener("pointermove",onNavigationInput,{passive:true,capture:true});
  window.addEventListener("touchmove",onNavigationInput,{passive:true,capture:true});
}
function unbindNavigationListeners(){
  if(!navigationListenersBound)return;
  navigationListenersBound=false;
  window.removeEventListener("wheel",onNavigationInput,true);
  window.removeEventListener("pointermove",onNavigationInput,true);
  window.removeEventListener("touchmove",onNavigationInput,true);
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
function accentPlan(profile,seed,limit,view){
  if(!profile||!view?.physicalScaleEligible||limit<=0)return emptyAccentPlan(view);
  const intensity=clamp(profile.flowerDensity+profile.leafFall+profile.frost+profile.snow,0,1.8);
  const targetCount=Math.min(limit,Math.max(0,Math.round(limit*clamp(intensity*.72,0,1))));
  if(targetCount<=0)return emptyAccentPlan(view);
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||2));
  const gridTiles=Math.max(1,Math.round(ACCENT_GRID_METERS/tileMeters)),gridTileBig=BigInt(gridTiles),fx=BigInt(String(view.focusTile.x)),fy=BigInt(String(view.focusTile.y));
  const centerCellX=floorDivBigInt(fx,gridTileBig),centerCellY=floorDivBigInt(fy,gridTileBig);
  // Keep one bounded focus-local materialization window for every eligible
  // close zoom. With an unchanged focus this preserves exactly the same
  // canonical anchor cohort while zoom only changes projection and apparent size.
  const aspect=Math.max(.6,Math.min(2.4,view.cssWidth/Math.max(1,view.cssHeight)));
  const materializedWidthMeters=MAX_ACCENT_FOOTPRINT_HEIGHT_METERS*aspect;
  const radiusX=Math.min(48,Math.max(2,Math.ceil(materializedWidthMeters*.58/(gridTiles*tileMeters))+1));
  const radiusY=Math.min(48,Math.max(2,Math.ceil(MAX_ACCENT_FOOTPRINT_HEIGHT_METERS*.58/(gridTiles*tileMeters))+1));
  const candidates=[];
  for(let oy=-radiusY;oy<=radiusY;oy++)for(let ox=-radiusX;ox<=radiusX;ox++){
    const cellX=centerCellX+BigInt(ox),cellY=centerCellY+BigInt(oy),tileX=cellX*gridTileBig,tileY=cellY*gridTileBig;
    const id=tileX.toString()+","+tileY.toString(),base="season-field:"+id+":";
    candidates.push({
      id,tileX:tileX.toString(),tileY:tileY.toString(),
      priority:foundationUnit(seed,base+"priority"),
      jitterEastMeters:(foundationUnit(seed,base+"jx")-.5)*ACCENT_GRID_METERS*.66,
      jitterNorthMeters:(foundationUnit(seed,base+"jy")-.5)*ACCENT_GRID_METERS*.66
    });
  }
  candidates.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  const entries=[],counts={count:0,flower:0,leaf:0,frost:0,snow:0};
  for(const candidate of candidates.slice(0,targetCount)){
    const prefix="season-accent:"+profile.signature+":"+candidate.id+":",kind=accentKind(profile,foundationUnit(seed,prefix+"kind"));if(!kind)continue;
    const sizeUnit=foundationUnit(seed,prefix+"size");
    const worldSizeMeters=kind==="flower"?.18+sizeUnit*.20:kind==="leaf"?.20+sizeUnit*.26:kind==="frost"?.34+sizeUnit*.36:.30+sizeUnit*.34;
    counts[kind]++;counts.count++;
    entries.push(Object.freeze({
      id:candidate.id,kind,tileX:candidate.tileX,tileY:candidate.tileY,
      jitterEastMeters:round(candidate.jitterEastMeters,3),jitterNorthMeters:round(candidate.jitterNorthMeters,3),
      worldSizeMeters:round(worldSizeMeters,3),rot:foundationUnit(seed,prefix+"rot"),hue:foundationUnit(seed,prefix+"hue")
    }));
  }
  return Object.freeze({entries:Object.freeze(entries),counts:Object.freeze(counts),view,worldAnchored:true,anchorMode:"canonical-world-tile-grid"});
}
function applyGroundTreatment(profile,seed){
  if(!groundWash||!profile)return;
  if(lastGroundSignature===profile.signature)return;lastGroundSignature=profile.signature;
  let color="132,210,116",strength=.10;
  if(profile.season==="summer"){color="214,164,74";strength=.07+profile.dryGrass*.10}
  else if(profile.season==="autumn"){color="194,93,36";strength=.09+profile.autumnFoliage*.10}
  else if(profile.season==="winter"){color="205,226,235";strength=.08+profile.frost*.08+profile.snow*.08}
  else strength=.09+profile.flowerDensity*.04;
  const a=Math.min(.24,strength);
  groundWash.style.opacity="1";
  // Seasonal ground tone is deliberately uniform. Localized seasonal microdetail
  // is projected from canonical world anchors below rather than painted at fixed
  // normalized screen positions.
  groundWash.style.background="linear-gradient(rgba("+color+","+a.toFixed(3)+"),rgba("+profile.tint[0]+","+profile.tint[1]+","+profile.tint[2]+","+(profile.tint[3]*.34).toFixed(3)+"))";
}
function draw(profile,seed,plan,viewOverride=null){
  if(!ctx||!overlay||!profile||!plan)return;
  const started=performance.now();if(!lastWidth||!lastHeight)resizeOverlay();const w=overlay.width,h=overlay.height;ctx.clearRect(0,0,w,h);
  const view=viewOverride||stageView(),scaleX=w/Math.max(1,view?.cssWidth||w),scaleY=h/Math.max(1,view?.cssHeight||h);
  const t=profile.tint;ctx.fillStyle="rgba("+t[0]+","+t[1]+","+t[2]+","+Math.min(.12,t[3]*.38)+")";ctx.fillRect(0,0,w,h);
  const projectedSamples=[];let rendered=0;
  if(view?.physicalScaleEligible){
    for(const e of plan.entries){
      const p=projectAccent(e,view);if(!p)continue;
      const x=p.x*scaleX,y=p.y*scaleY,sz=p.sizeCss*scaleY;
      if(sz<.55*lastDpr||x<-sz*3||x>w+sz*3||y<-sz*3||y>h+sz*3)continue;
      rendered++;
      if(projectedSamples.length<8)projectedSamples.push(Object.freeze({id:e.id,kind:e.kind,screenX:round(p.x,2),screenY:round(p.y,2),sizePx:round(p.sizeCss,2),eastMeters:round(p.eastMeters,3),northMeters:round(p.northMeters,3),worldSizeMeters:e.worldSizeMeters}));
      if(e.kind==="flower"){
        ctx.fillStyle=e.hue>.5?"rgba(255,221,99,.82)":"rgba(241,155,213,.78)";
        for(let petal=0;petal<3;petal++){const a=petal*Math.PI*2/3;ctx.beginPath();ctx.arc(x+Math.cos(a)*sz*.58,y+Math.sin(a)*sz*.34,sz*.58,0,Math.PI*2);ctx.fill()}
        ctx.fillStyle="rgba(246,242,185,.82)";ctx.beginPath();ctx.arc(x,y,sz*.34,0,Math.PI*2);ctx.fill();
      }else if(e.kind==="leaf"){
        ctx.save();ctx.translate(x,y);ctx.rotate(e.rot*Math.PI);ctx.fillStyle=e.hue>.52?"rgba(206,103,38,.76)":"rgba(168,79,35,.72)";ctx.beginPath();ctx.ellipse(0,0,sz*1.35,sz*.52,0,0,Math.PI*2);ctx.fill();ctx.restore();
      }else if(e.kind==="frost"){
        ctx.strokeStyle="rgba(231,245,248,.70)";ctx.lineWidth=Math.max(.65,lastDpr*.58);for(let a=0;a<3;a++){const r=a*Math.PI/3;ctx.beginPath();ctx.moveTo(x-Math.cos(r)*sz*.92,y-Math.sin(r)*sz*.52);ctx.lineTo(x+Math.cos(r)*sz*.92,y+Math.sin(r)*sz*.52);ctx.stroke()}
      }else{
        ctx.fillStyle="rgba(244,250,255,.50)";ctx.beginPath();ctx.ellipse(x,y,sz*1.45,sz*.55,e.rot*Math.PI,0,Math.PI*2);ctx.fill();
      }
    }
  }
  lastProjectedSamples=Object.freeze(projectedSamples);lastRenderedAccentCount=rendered;anchorProjectionUpdates++;
  drawCount++;lastDrawMs=performance.now()-started;maxDrawMs=Math.max(maxDrawMs,lastDrawMs);
  if(lastSnapshot)lastSnapshot=Object.freeze({...lastSnapshot,drawCount,lastDrawMs:round(lastDrawMs),maxDrawMs:round(maxDrawMs),renderedAccentCount:lastRenderedAccentCount,anchorProjectionUpdates,accentProjectionSamples:lastProjectedSamples});
}
function scheduleDraw(profile,seed,plan){
  pendingPlan=plan;activePlan=plan;activeProfile=profile;activeSeed=seed;
  if(pendingDraw)return;
  pendingDraw=requestAnimationFrame(()=>{pendingDraw=0;const next=pendingPlan;pendingPlan=null;if(lastSnapshot?.active&&next)draw(profile,seed,next,stageView())});
}
function refresh(){
  const started=performance.now(),contextStarted=performance.now(),context=rootContext(),contextMs=performance.now()-contextStarted,profileStarted=performance.now(),profile=buildProfile(context),profileMs=performance.now()-profileStarted,root=context?.root||stageRoot();
  const active=Boolean(context&&profile&&root?.dataset?.ready==="true"),view=active?stageView(root):null,mapScaleAccentEligible=Boolean(view?.physicalScaleEligible),cls=deviceClass(),limit=accentLimit(cls),planStarted=performance.now(),plan=profile?accentPlan(profile,context?.seed||"",mapScaleAccentEligible?limit:0,view):emptyAccentPlan(view),planMs=performance.now()-planStarted,counts=plan.counts;
  if(active){ensureOverlay();applyGroundTreatment(profile,context.seed);scheduleDraw(profile,context.seed,plan)}
  else{activePlan=null;activeProfile=null;activeSeed="";lastProjectedSamples=Object.freeze([]);lastRenderedAccentCount=0;if(ctx&&overlay)ctx.clearRect(0,0,overlay.width,overlay.height);if(groundWash)groundWash.style.background="none"}
  updateCount++;lastUpdateMs=performance.now()-started;maxUpdateMs=Math.max(maxUpdateMs,lastUpdateMs);
  lastSnapshot=Object.freeze({
    version:VERSION,active,ready:Boolean(context&&profile),seed:context?.seed||null,focusTile:context?.tile||null,
    fantasyTime:context?Object.freeze({...context.stamp}):null,fantasyTimeKey:context?stampKey(context.stamp):null,evidenceMode:evidenceMode(),evidenceTimeOverride:Boolean(evidenceStamp),
    profile,season:profile?.season||"pending",seasonSignature:profile?.signature||null,
    region:context?Object.freeze({id:context.region.id,name:context.region.name,revision:context.region.revision,climate:context.region.identity?.climate||"unknown"}):null,
    deviceClass:cls,accentLimit:limit,accentCount:counts.count,flowerAccentCount:counts.flower,leafAccentCount:counts.leaf,frostAccentCount:counts.frost,snowAccentCount:counts.snow,
    mapScaleAccentEligible,mapScaleAccentSuppressed:Boolean(active&&!mapScaleAccentEligible),physicalScaleAccentSuppressed:Boolean(active&&!mapScaleAccentEligible),maxAccentFootprintHeightMeters:MAX_ACCENT_FOOTPRINT_HEIGHT_METERS,
    accentFootprintWidthMeters:view?round(view.widthMeters,3):null,accentFootprintHeightMeters:view?round(view.heightMeters,3):null,accentScaleLabel:view?.scaleLabel||null,
    overlayZIndex:2,cameraLocalPresentation:true,pooledAccents:true,worldAnchoredAccents:true,screenSpaceNormalizedAccents:false,accentAnchorMode:"canonical-world-tile-grid",
    renderedAccentCount:lastRenderedAccentCount,anchorProjectionUpdates,accentProjectionSamples:lastProjectedSamples,
    groundTreatmentActive:Boolean(active&&groundWash),groundTreatmentMode:"uniform-seasonal-tint",groundPatchCount:active?1:0,materialParameterCount:3,instanceVariationCount:counts.count,
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
  if(timer){clearInterval(timer);timer=null}if(pendingDraw){cancelAnimationFrame(pendingDraw);pendingDraw=0}if(anchorFollowRaf){cancelAnimationFrame(anchorFollowRaf);anchorFollowRaf=0}unbindNavigationListeners();resizeObserver?.disconnect?.();resizeObserver=null;contextObserver?.disconnect?.();contextObserver=null;groundWash?.remove?.();groundWash=null;overlay?.remove?.();overlay=null;ctx=null;lastSnapshot=null;pendingPlan=null;activePlan=null;activeProfile=null;activeSeed="";lastProjectedSamples=Object.freeze([]);lastRenderedAccentCount=0;lastGroundSignature="";profileCache.clear();spatialKey="";spatialRegion=null;rootNode=null;centerMarker=null;cachedRootReady=false;cachedSeed="";cachedTile=null;coarsePointerQuery=null;reducedMotionQuery=null;
}
function bootstrap(){
  bindNavigationListeners();refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange",()=>{hidden=document.hidden;if(!hidden)refresh()});
}
window.SeasonalPresentation=Object.freeze({
  VERSION,snapshot,refresh,previewAt,setEvidenceStamp,clearEvidenceStamp,shutdown,
  constants:Object.freeze({UPDATE_INTERVAL_MS,PROFILE_CACHE_LIMIT,DESKTOP_ACCENT_LIMIT,TABLET_ACCENT_LIMIT,PHONE_ACCENT_LIMIT,MAX_ACCENT_FOOTPRINT_HEIGHT_METERS,ACCENT_GRID_METERS,ANCHOR_REPROJECT_INTERVAL_MS})
});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootstrap,{once:true});else bootstrap();
})();