/*
  R04 / #244 + #329 + #349: presentation-only starter-village exteriors.
  Placement/type/footprint/entrance remain Simulation authority.
  Normal rendering uses cached semantic raster tiles; vectors are loading/error fallback only.
*/
(function installStarterVillageExteriors() {
  'use strict';
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-exteriors-v6-semantic-mosaic';
  const MODE = 'authoritative-building-silhouettes';
  const RENDER_BACKEND = 'semantic-raster-building-tiles';
  const COMPOSITION_MODE = 'screen-space-semantic-mosaic';
  const TILE_SIZE = 256;
  const TILE_TYPES = Object.freeze([
    'roof_corner_nw','roof_edge_n','roof_corner_ne','roof_ridge',
    'wall_edge_w','wall_center','wall_edge_e','wall_window',
    'base_corner_sw','entrance','base_corner_se','family_feature'
  ]);

  const STYLES = Object.freeze({
    home:{family:'home',cue:'chimney',wall:'#8a6748',roof:'#7a463b'},
    inn:{family:'lodging',cue:'sign',wall:'#927451',roof:'#783846'},
    village_hall:{family:'landmark',cue:'banner',wall:'#817464',roof:'#526171'},
    bakery:{family:'food-shop',cue:'awning',wall:'#9a7148',roof:'#78493a'},
    market:{family:'food-shop',cue:'awning',wall:'#8c7653',roof:'#5f7550'},
    smithy:{family:'production',cue:'forge',wall:'#6c6460',roof:'#454349'},
    workshop:{family:'production',cue:'awning',wall:'#7a644e',roof:'#544c40'},
    guard_post:{family:'service',cue:'banner',wall:'#6e7074',roof:'#4b5966'},
    mill:{family:'agricultural',cue:'mill',wall:'#8a795b',roof:'#5b684f'},
    farmstead:{family:'agricultural',cue:'farm',wall:'#8c724d',roof:'#6b5c3e'},
    storage:{family:'storage',cue:'awning',wall:'#82684d',roof:'#5b493b'},
    well:{family:'service',cue:'well',wall:'#6c7379',roof:'#4b535b'}
  });
  const ALIASES = Object.freeze({
    dwelling:'home',house:'home',tavern:'inn',lodging:'inn',hall:'village_hall',civic:'village_hall',
    shop:'market',food:'bakery',production:'workshop',guard:'guard_post',service:'guard_post',
    farm:'farmstead',agricultural:'farmstead',storehouse:'storage',barn:'storage'
  });
  const FALLBACK = Object.freeze({family:'inhabited-neutral',cue:'chimney',wall:'#7d7162',roof:'#5e5147'});

  let overlayCanvas = null;
  let renderHookInstalled = false;
  let rejectedProjectionCount = 0;
  let registry = null;
  let registryLoadStarted = false;
  let registryError = null;
  let redrawQueued = false;
  const imageCache = new Map();

  function canonicalFamily(building) {
    const raw = String(building?.type || '').toLowerCase();
    const family = ALIASES[raw] || raw;
    return STYLES[family] ? family : null;
  }

  function styleFor(building) {
    const family = canonicalFamily(building);
    return family ? STYLES[family] : FALLBACK;
  }

  function ensureOverlay() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'starterVillageExteriorOverlay';
    overlayCanvas.setAttribute('aria-hidden','true');
    overlayCanvas.tabIndex = -1;
    Object.assign(overlayCanvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'1'});
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function project(row,col) {
    const p = Game.Renderer?.gridToScreen(row,col,0,0);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }

  function bounds(points) {
    return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))};
  }

  function polygonArea(points) {
    let sum=0;
    for(let i=0;i<points.length;i+=1){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y;}
    return Math.abs(sum)*0.5;
  }

  function safeFootprint(points,width,height) {
    if(!Array.isArray(points)||points.length!==4||!points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)))return false;
    const b=bounds(points),spanX=b.maxX-b.minX,spanY=b.maxY-b.minY;
    if(spanX>Math.max(320,width*0.78)||spanY>Math.max(260,height*0.78))return false;
    return polygonArea(points)<=width*height*0.42;
  }

  function footprintPolygon(footprint,width,height) {
    if(!footprint)return null;
    const r=Number(footprint.row),c=Number(footprint.col),h=Number(footprint.height),w=Number(footprint.width);
    if(![r,c,h,w].every(Number.isFinite)||h<=0||w<=0)return null;
    const points=[project(r,c),project(r,c+w),project(r+h,c+w),project(r+h,c)];
    if(!safeFootprint(points,width,height)){rejectedProjectionCount+=1;return null;}
    return points;
  }

  function footprintTerrainStats(building) {
    const terrain=Game.State?.world?.terrain,f=building?.footprint;
    if(!Array.isArray(terrain)||!f)return{total:0,settlement:0};
    const r=Number(f.row),c=Number(f.col),h=Number(f.height),w=Number(f.width);
    if(![r,c,h,w].every(Number.isFinite)||h<=0||w<=0)return{total:0,settlement:0};
    let total=0,settlement=0;
    for(let row=r;row<r+h;row+=1)for(let col=c;col<c+w;col+=1){const tile=terrain[row]?.[col];if(!tile)continue;total+=1;if(String(tile.type||'')==='settlement')settlement+=1;}
    return{total,settlement};
  }

  function queueRedraw() {
    if(redrawQueued)return;
    redrawQueued=true;
    requestAnimationFrame(()=>{redrawQueued=false;drawPresentation();});
  }

  function ensureRegistry() {
    if(registry||registryLoadStarted)return;
    registryLoadStarted=true;
    const url=new URL('js/tile_registry.js',document.baseURI).href;
    import(url).then(mod=>{
      registry=mod.createCanonicalStarterBuildingTileRegistry();
      registryError=null;
      primeCurrentFamilies();
      queueRedraw();
    }).catch(error=>{registryError=String(error?.message||error);queueRedraw();});
  }

  function cacheKey(family,type){return `${family}:${type}:${TILE_SIZE}`;}

  function ensureImage(family,type) {
    if(!registry)return null;
    const key=cacheKey(family,type);
    const cached=imageCache.get(key);
    if(cached?.state==='ready')return cached.image;
    if(cached)return null;
    let entry;
    try{entry=registry.resolve(family,type,TILE_SIZE);}catch(error){imageCache.set(key,{state:'error',error:String(error?.message||error)});return null;}
    const image=new Image();
    image.decoding='async';
    imageCache.set(key,{state:'loading',image,source:entry.source});
    image.onload=()=>{imageCache.set(key,{state:'ready',image,source:entry.source});queueRedraw();};
    image.onerror=()=>{imageCache.set(key,{state:'error',image,source:entry.source,error:'image-load-failed'});queueRedraw();};
    image.src=new URL(entry.source,document.baseURI).href;
    return null;
  }

  function primeCurrentFamilies() {
    if(!registry)return;
    const buildings=Game.State?.world?.originVillage?.buildings;
    if(!Array.isArray(buildings))return;
    const families=new Set(buildings.map(canonicalFamily).filter(Boolean));
    for(const family of families)for(const type of TILE_TYPES)ensureImage(family,type);
  }

  function entranceCell(building) {
    const f=building?.footprint,e=building?.entrance;
    if(!f||!e)return null;
    const r=Number(f.row),c=Number(f.col),h=Number(f.height),w=Number(f.width),er=Number(e.row),ec=Number(e.col);
    if(![r,c,h,w,er,ec].every(Number.isFinite))return null;
    if(er===r-1&&ec>=c&&ec<c+w)return{row:0,col:ec-c,side:'north'};
    if(er===r+h&&ec>=c&&ec<c+w)return{row:h-1,col:ec-c,side:'south'};
    if(ec===c-1&&er>=r&&er<r+h)return{row:er-r,col:0,side:'west'};
    if(ec===c+w&&er>=r&&er<r+h)return{row:er-r,col:w-1,side:'east'};
    return null;
  }

  function semanticType(building,localRow,localCol,h,w,door) {
    const family=canonicalFamily(building);
    if(family==='well')return 'family_feature';
    if(door&&door.row===localRow&&door.col===localCol)return 'entrance';
    const featureRow=h>2?h-2:h-1,featureCol=Math.floor((w-1)/2);
    if(localRow===featureRow&&localCol===featureCol)return 'family_feature';
    if(localRow===0){
      if(w===1)return 'roof_ridge';
      if(localCol===0)return 'roof_corner_nw';
      if(localCol===w-1)return 'roof_corner_ne';
      if(localCol===Math.floor(w/2))return 'roof_ridge';
      return 'roof_edge_n';
    }
    if(localRow===h-1){
      if(w===1)return 'wall_center';
      if(localCol===0)return 'base_corner_sw';
      if(localCol===w-1)return 'base_corner_se';
      return localCol%2?'wall_window':'wall_center';
    }
    if(localCol===0)return 'wall_edge_w';
    if(localCol===w-1)return 'wall_edge_e';
    return localCol%2?'wall_window':'wall_center';
  }

  function rasterPlan(building) {
    const f=building?.footprint,family=canonicalFamily(building);
    if(!f||!family)return null;
    const r=Number(f.row),c=Number(f.col),h=Math.trunc(Number(f.height)),w=Math.trunc(Number(f.width));
    if(![r,c,h,w].every(Number.isFinite)||h<=0||w<=0)return null;
    const door=entranceCell(building),cells=[];
    for(let lr=0;lr<h;lr+=1)for(let lc=0;lc<w;lc+=1)cells.push({row:r+lr,col:c+lc,localRow:lr,localCol:lc,type:semanticType(building,lr,lc,h,w,door)});
    return{family,row:r,col:c,height:h,width:w,cells,door};
  }

  function imageStateForPlan(plan) {
    if(!registry)return 'loading';
    let loading=false;
    for(const type of new Set(plan.cells.map(cell=>cell.type))){
      const image=ensureImage(plan.family,type);
      if(image)continue;
      const state=imageCache.get(cacheKey(plan.family,type))?.state;
      if(state==='error')return 'error';
      loading=true;
    }
    return loading?'loading':'ready';
  }

  function presentationEnvelope(footprint,plan) {
    const b=bounds(footprint),spanX=b.maxX-b.minX,spanY=b.maxY-b.minY;
    if(!(spanX>0&&spanY>0&&plan?.width>0&&plan?.height>0))return null;
    return{minX:b.minX,minY:b.minY,maxX:b.maxX,maxY:b.maxY,width:spanX,height:spanY,cellWidth:spanX/plan.width,cellHeight:spanY/plan.height};
  }

  function rasterCellRect(envelope,cell) {
    return{x:envelope.minX+cell.localCol*envelope.cellWidth,y:envelope.minY+cell.localRow*envelope.cellHeight,width:envelope.cellWidth,height:envelope.cellHeight};
  }

  function drawRasterCell(ctx,image,envelope,cell,width,height) {
    const rect=rasterCellRect(envelope,cell);
    if(![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return false;
    if(rect.x+rect.width<-36||rect.y+rect.height<-48||rect.x>width+36||rect.y>height+48)return false;
    ctx.save();
    ctx.imageSmoothingEnabled=false;
    ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
    ctx.drawImage(image,0,0,TILE_SIZE,TILE_SIZE,rect.x,rect.y,rect.width,rect.height);
    ctx.restore();
    return true;
  }

  function drawRasterBuilding(ctx,building,width,height) {
    const footprint=footprintPolygon(building.footprint,width,height);
    if(!footprint)return{drawn:false,state:'guarded'};
    const fb=bounds(footprint);
    if(fb.maxX<-36||fb.maxY<-48||fb.minX>width+36||fb.minY>height+48)return{drawn:false,state:'offscreen'};
    const plan=rasterPlan(building);
    if(!plan)return{drawn:false,state:'unsupported'};
    const state=imageStateForPlan(plan);
    if(state!=='ready')return{drawn:false,state};
    const envelope=presentationEnvelope(footprint,plan);
    if(!envelope)return{drawn:false,state:'guarded'};
    let cells=0;
    for(const cell of plan.cells){const image=ensureImage(plan.family,cell.type);if(image&&drawRasterCell(ctx,image,envelope,cell,width,height))cells+=1;}
    return{drawn:cells>0,state:'ready',cells,family:plan.family,envelope};
  }

  function drawVectorFallback(ctx,building,width,height) {
    const footprint=footprintPolygon(building.footprint,width,height);if(!footprint)return false;
    const b=bounds(footprint);if(b.maxX<-36||b.maxY<-48||b.minX>width+36||b.minY>height+48)return false;
    const style=styleFor(building);
    ctx.save();ctx.globalAlpha=building.passable?.72:.9;ctx.fillStyle=style.wall;ctx.strokeStyle=style.roof;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(footprint[0].x,footprint[0].y);for(let i=1;i<footprint.length;i+=1)ctx.lineTo(footprint[i].x,footprint[i].y);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    return true;
  }

  function snapshotDescriptors() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if(!Array.isArray(buildings))return[];
    return buildings.map(b=>({id:b.id,type:b.type,role:b.role,passable:b.passable===true,footprint:b.footprint?{...b.footprint}:null,entrance:b.entrance?{...b.entrance}:null}));
  }

  function snapshotPresentationPlan() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if(!Array.isArray(buildings))return[];
    const canvas=overlayCanvas,width=Math.max(1,canvas?.clientWidth||Game.State?.dom?.canvas?.clientWidth||1),height=Math.max(1,canvas?.clientHeight||Game.State?.dom?.canvas?.clientHeight||1);
    return buildings.map(b=>{
      const s=styleFor(b),plan=rasterPlan(b),footprint=plan?footprintPolygon(b.footprint,width,height):null,envelope=footprint?presentationEnvelope(footprint,plan):null;
      return{id:b.id,type:b.type,family:s.family,cue:s.cue,tileFamily:plan?.family||null,tileTypes:plan?[...new Set(plan.cells.map(x=>x.type))].sort():[],cells:plan?plan.cells.map(x=>({localRow:x.localRow,localCol:x.localCol,type:x.type})):[],door:plan?.door?{...plan.door}:null,compositionMode:COMPOSITION_MODE,screenEnvelope:envelope?{minX:envelope.minX,minY:envelope.minY,maxX:envelope.maxX,maxY:envelope.maxY,cellWidth:envelope.cellWidth,cellHeight:envelope.cellHeight}:null,footprint:b.footprint?{...b.footprint}:null,entrance:b.entrance?{...b.entrance}:null};
    });
  }

  function snapshotPlaceholderCoverage() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if(!Array.isArray(buildings))return[];
    return buildings.map(b=>({id:b.id,type:b.type,...footprintTerrainStats(b)}));
  }

  function snapshotTileCache() {
    const entries=[...imageCache.entries()].map(([key,value])=>({key,state:value.state,source:value.source||null})).sort((a,b)=>a.key.localeCompare(b.key));
    return{registryReady:Boolean(registry),registryError,entries,ready:entries.filter(x=>x.state==='ready').length,loading:entries.filter(x=>x.state==='loading').length,error:entries.filter(x=>x.state==='error').length};
  }

  function drawPresentation() {
    ensureRegistry();primeCurrentFamilies();
    const canvas=ensureOverlay(),buildings=Game.State?.world?.originVillage?.buildings;
    if(!canvas||!Game.Renderer||!Array.isArray(buildings))return false;
    const width=Math.max(1,canvas.clientWidth||Game.State?.dom?.canvas?.clientWidth||1),height=Math.max(1,canvas.clientHeight||Game.State?.dom?.canvas?.clientHeight||1);
    const dpr=Math.max(1,window.devicePixelRatio||1),tw=Math.round(width*dpr),th=Math.round(height*dpr);
    if(canvas.width!==tw||canvas.height!==th){canvas.width=tw;canvas.height=th;}
    const ctx=canvas.getContext('2d');if(!ctx)return false;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);

    rejectedProjectionCount=0;
    let visible=0,rasterBuildings=0,fallbackBuildings=0,rasterCells=0;const types=new Set(),tileFamilies=new Set();
    for(const building of buildings){
      const raster=drawRasterBuilding(ctx,building,width,height);
      if(raster.drawn){visible+=1;rasterBuildings+=1;rasterCells+=raster.cells||0;types.add(String(building.type||'unknown'));if(raster.family)tileFamilies.add(raster.family);continue;}
      if(drawVectorFallback(ctx,building,width,height)){visible+=1;fallbackBuildings+=1;types.add(String(building.type||'unknown'));}
    }

    const coverage=snapshotPlaceholderCoverage(),fully=coverage.filter(x=>x.total>0&&x.settlement===x.total).length;
    const covered=coverage.reduce((s,x)=>s+x.settlement,0),total=coverage.reduce((s,x)=>s+x.total,0),families=new Set(snapshotPresentationPlan().map(x=>x.family));
    const cache=snapshotTileCache();
    const assetState=registryError?'error':(!registry||cache.loading>0?'loading':(cache.error>0?'degraded':'ready'));
    Object.assign(canvas.dataset,{
      buildingCount:String(buildings.length),visibleBuildingCount:String(visible),visibleBuildingTypes:Array.from(types).sort().join(','),visualFamilies:Array.from(families).sort().join(','),
      presentationAuthority:'presentation-only',descriptorSource:'originVillage.buildings',regionSize:String(Game.State?.world?.rows||0),presentationMode:MODE,placeholderMode:'none',rectangleOverlay:'disabled',
      fullyStoneCoveredBuildings:String(fully),stoneCoveredTiles:String(covered),footprintTiles:String(total),projectionGuard:'bounded-footprint',rejectedProjectionCount:String(rejectedProjectionCount),
      renderBackend:RENDER_BACKEND,compositionMode:COMPOSITION_MODE,tileAssetState:assetState,rasterBuildingCount:String(rasterBuildings),vectorFallbackBuildingCount:String(fallbackBuildings),rasterCellCount:String(rasterCells),tileFamilies:Array.from(tileFamilies).sort().join(','),tileCacheReady:String(cache.ready),tileCacheError:String(cache.error)
    });
    return true;
  }

  function installRenderHook() {
    const Renderer=Game.Renderer;
    if(!Renderer||typeof Renderer.renderWorld!=='function'||renderHookInstalled)return false;
    const renderWorld=Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld=function starterVillageExteriorAwareRenderWorld(force){const result=renderWorld(force);drawPresentation();return result;};
    renderHookInstalled=true;return true;
  }

  function detachPresentation(){if(overlayCanvas?.parentNode)overlayCanvas.parentNode.removeChild(overlayCanvas);overlayCanvas=null;}
  function initialize(){ensureOverlay();ensureRegistry();installRenderHook();drawPresentation();}

  Game.StarterVillageExteriors=Object.freeze({
    version:VERSION,authority:'presentation-only',descriptorSource:'originVillage.buildings',presentationMode:MODE,renderBackend:RENDER_BACKEND,compositionMode:COMPOSITION_MODE,
    snapshotDescriptors,snapshotPresentationPlan,snapshotPlaceholderCoverage,snapshotTileCache,safeFootprint,ensureOverlay,drawPresentation,detachPresentation
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();