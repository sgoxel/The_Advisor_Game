/*
  R04 / #244 + #329: presentation-only starter-village exteriors.
  Placement/type/footprint/entrance remain Simulation authority.
*/
(function installStarterVillageExteriors() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-exteriors-v4-projection-bounds';
  const MODE = 'authoritative-building-silhouettes';

  const STYLES = Object.freeze({
    home: { family:'home', wall:'#8a6748', shade:'#6f513a', roof:'#7a463b', roof2:'#5f342e', accent:'#e0bb7c', cue:'chimney' },
    inn: { family:'lodging', wall:'#927451', shade:'#73583d', roof:'#783846', roof2:'#5b2935', accent:'#f0c96f', cue:'sign' },
    village_hall: { family:'landmark', wall:'#817464', shade:'#62594e', roof:'#526171', roof2:'#3c4651', accent:'#e1d7b4', cue:'banner' },
    bakery: { family:'food-shop', wall:'#9a7148', shade:'#795637', roof:'#78493a', roof2:'#5c352c', accent:'#f1c27d', cue:'awning' },
    market: { family:'food-shop', wall:'#8c7653', shade:'#6e5d41', roof:'#5f7550', roof2:'#47583c', accent:'#e0c77b', cue:'awning' },
    smithy: { family:'production', wall:'#6c6460', shade:'#504b49', roof:'#454349', roof2:'#302f33', accent:'#df8752', cue:'forge' },
    workshop: { family:'production', wall:'#7a644e', shade:'#5e4b3b', roof:'#544c40', roof2:'#3e3830', accent:'#c9a86a', cue:'awning' },
    guard_post: { family:'service', wall:'#6e7074', shade:'#53565a', roof:'#4b5966', roof2:'#37414a', accent:'#d2dae0', cue:'banner' },
    mill: { family:'agricultural', wall:'#8a795b', shade:'#6b5d46', roof:'#5b684f', roof2:'#43503b', accent:'#dac991', cue:'mill' },
    farmstead: { family:'agricultural', wall:'#8c724d', shade:'#6e583a', roof:'#6b5c3e', roof2:'#50452f', accent:'#d7c66e', cue:'farm' },
    storage: { family:'storage', wall:'#82684d', shade:'#614d39', roof:'#5b493b', roof2:'#42352c', accent:'#cdb07e', cue:'awning' },
    well: { family:'service', wall:'#6c7379', shade:'#50565b', roof:'#4b535b', roof2:'#373d43', accent:'#b9d0d8', cue:'well' }
  });
  const ALIASES = Object.freeze({
    dwelling:'home', house:'home', tavern:'inn', lodging:'inn', hall:'village_hall', civic:'village_hall',
    shop:'market', food:'bakery', production:'workshop', guard:'guard_post', service:'guard_post',
    farm:'farmstead', agricultural:'farmstead', storehouse:'storage', barn:'storage'
  });
  const FALLBACK = { family:'inhabited-neutral', wall:'#7d7162', shade:'#5f5549', roof:'#5e5147', roof2:'#443b34', accent:'#d2c3a4', cue:'chimney' };

  let overlayCanvas = null;
  let renderHookInstalled = false;
  let rejectedProjectionCount = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function styleFor(building) {
    const raw = String(building?.type || '').toLowerCase();
    return STYLES[ALIASES[raw] || raw] || FALLBACK;
  }

  function ensureOverlay() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'starterVillageExteriorOverlay';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    overlayCanvas.tabIndex = -1;
    Object.assign(overlayCanvas.style, {
      position:'absolute', inset:'0', width:'100%', height:'100%', pointerEvents:'none', zIndex:'1'
    });
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function project(row, col) {
    const p = Game.Renderer?.gridToScreen(row, col, 0, 0);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }

  function center(points) {
    return { x:points.reduce((s,p)=>s+p.x,0)/points.length, y:points.reduce((s,p)=>s+p.y,0)/points.length };
  }

  function bounds(points) {
    return {
      minX:Math.min(...points.map(p=>p.x)), maxX:Math.max(...points.map(p=>p.x)),
      minY:Math.min(...points.map(p=>p.y)), maxY:Math.max(...points.map(p=>p.y))
    };
  }

  function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i], b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) * 0.5;
  }

  function safeFootprint(points, width, height) {
    if (!Array.isArray(points) || points.length !== 4 || !points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    const b = bounds(points);
    const spanX = b.maxX - b.minX;
    const spanY = b.maxY - b.minY;
    if (spanX > Math.max(320, width * 0.78) || spanY > Math.max(260, height * 0.78)) return false;
    if (polygonArea(points) > width * height * 0.42) return false;
    return true;
  }

  function footprintPolygon(footprint, width, height) {
    if (!footprint) return null;
    const r = Number(footprint.row), c = Number(footprint.col);
    const h = Number(footprint.height), w = Number(footprint.width);
    if (![r,c,h,w].every(Number.isFinite) || h <= 0 || w <= 0) return null;
    const points = [project(r,c), project(r,c+w), project(r+h,c+w), project(r+h,c)];
    if (!safeFootprint(points, width, height)) {
      rejectedProjectionCount += 1;
      return null;
    }
    return points;
  }

  function inset(points, scale) {
    const c = center(points);
    return points.map(p => ({ x:c.x+(p.x-c.x)*scale, y:c.y+(p.y-c.y)*scale }));
  }

  function path(ctx, points, close=true) {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i=1;i<points.length;i+=1) ctx.lineTo(points[i].x, points[i].y);
    if (close) ctx.closePath();
  }

  function footprintTerrainStats(building) {
    const terrain = Game.State?.world?.terrain, f = building?.footprint;
    if (!Array.isArray(terrain) || !f) return { total:0, settlement:0 };
    const r=Number(f.row), c=Number(f.col), h=Number(f.height), w=Number(f.width);
    if (![r,c,h,w].every(Number.isFinite) || h<=0 || w<=0) return { total:0, settlement:0 };
    let total=0, settlement=0;
    for (let row=r; row<r+h; row+=1) for (let col=c; col<c+w; col+=1) {
      const tile=terrain[row]?.[col]; if (!tile) continue;
      total+=1; if (String(tile.type||'')==='settlement') settlement+=1;
    }
    return { total, settlement };
  }

  function entranceCue(ctx, building, style, c, b) {
    const e=project(Number(building.entrance?.row), Number(building.entrance?.col));
    if (!e) return;
    const dx=c.x-e.x, dy=c.y-e.y, d=Math.hypot(dx,dy)||1;
    const span = Math.max(1, b.maxX-b.minX, b.maxY-b.minY);
    if (d > Math.max(96, span * 4)) return;
    const len=Math.min(d, clamp(Math.min(b.maxX-b.minX,b.maxY-b.minY)*0.34,8,22));
    const end={x:e.x+dx/d*len,y:e.y+dy/d*len};
    ctx.save();
    ctx.strokeStyle=style.accent; ctx.lineWidth=2;
    path(ctx,[e,end],false); ctx.stroke();
    const q=clamp(Math.min(b.maxX-b.minX,b.maxY-b.minY)*0.07,2.5,5);
    ctx.fillStyle='#3b2b22'; ctx.strokeStyle=style.accent; ctx.lineWidth=1;
    path(ctx,[{x:e.x,y:e.y-q},{x:e.x+q,y:e.y},{x:e.x,y:e.y+q},{x:e.x-q,y:e.y}]);
    ctx.fill(); ctx.stroke(); ctx.restore();
  }

  function typeCue(ctx, style, apex, c, b) {
    const u=clamp(Math.min(b.maxX-b.minX,b.maxY-b.minY)*0.10,3,8);
    ctx.save(); ctx.strokeStyle='#2f2925'; ctx.fillStyle=style.accent; ctx.lineWidth=clamp(u*.22,1,2);
    if (style.cue==='well') {
      ctx.beginPath(); ctx.ellipse(c.x,c.y-u*.25,u*1.35,u*.72,0,0,Math.PI*2); ctx.fillStyle=style.wall; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(c.x,c.y-u*.3,u*.75,u*.34,0,0,Math.PI*2); ctx.fillStyle='#24333a'; ctx.fill();
    } else if (style.cue==='chimney' || style.cue==='forge') {
      const x=apex.x+u*.65, y=apex.y+u*.35;
      ctx.fillStyle=style.cue==='forge'?'#51423b':'#665248'; ctx.fillRect(x,y-u*1.35,u*.55,u*1.15); ctx.strokeRect(x,y-u*1.35,u*.55,u*1.15);
      if (style.cue==='forge') { ctx.fillStyle=style.accent; ctx.beginPath(); ctx.arc(x+u*.28,y-u*1.55,u*.18,0,Math.PI*2); ctx.fill(); }
    } else if (style.cue==='sign') {
      const x=c.x+u*1.2, y=c.y-u*.2; path(ctx,[{x,y:y-u*2},{x,y:y+u*.4}],false); ctx.stroke();
      ctx.fillStyle=style.accent; ctx.fillRect(x,y-u*1.8,u*1.25,u*.72); ctx.strokeRect(x,y-u*1.8,u*1.25,u*.72);
    } else if (style.cue==='banner') {
      const top=apex.y-u*2.4; path(ctx,[{x:apex.x,y:apex.y+u*.25},{x:apex.x,y:top}],false); ctx.stroke();
      ctx.fillStyle=style.accent; path(ctx,[{x:apex.x,y:top},{x:apex.x+u*1.45,y:top+u*.45},{x:apex.x,y:top+u*.95}]); ctx.fill(); ctx.stroke();
    } else if (style.cue==='awning') {
      const y=c.y-u*.45; ctx.fillStyle=style.accent;
      path(ctx,[{x:c.x-u*1.6,y},{x:c.x+u*1.6,y},{x:c.x+u*1.25,y:y+u*.8},{x:c.x-u*1.25,y:y+u*.8}]); ctx.fill(); ctx.stroke();
    } else if (style.cue==='mill') {
      const hub={x:apex.x+u*.1,y:apex.y-u*.5}; ctx.beginPath(); ctx.arc(hub.x,hub.y,u*.22,0,Math.PI*2); ctx.fill();
      for(let i=0;i<4;i+=1){const a=Math.PI*.25+i*Math.PI*.5;path(ctx,[hub,{x:hub.x+Math.cos(a)*u*2.1,y:hub.y+Math.sin(a)*u*2.1}],false);ctx.stroke();}
    } else if (style.cue==='farm') {
      ctx.strokeStyle=style.accent; for(let i=-1;i<=1;i+=1){const y=c.y+u*(1.25+i*.45);path(ctx,[{x:c.x-u*1.5,y},{x:c.x+u*1.5,y}],false);ctx.stroke();}
    }
    ctx.restore();
  }

  function drawBuilding(ctx, building, width, height) {
    const footprint=footprintPolygon(building.footprint,width,height); if (!footprint) return false;
    const fb=bounds(footprint);
    if (fb.maxX < -36 || fb.maxY < -48 || fb.minX > width+36 || fb.minY > height+48) return false;
    const style=styleFor(building), fw=fb.maxX-fb.minX, fh=fb.maxY-fb.minY;
    const ground=inset(footprint, style.family==='landmark'||style.family==='lodging' ? .82 : .74);
    const b=bounds(ground), c=center(ground);

    if (style.cue==='well') { typeCue(ctx,style,c,c,b); entranceCue(ctx,building,style,c,b); return true; }

    const wallH=clamp(Math.max(fh*.18,fw*.055),4,15), roofH=clamp(Math.max(fh*.28,fw*.065),6,20);
    const eaves=ground.map(p=>({x:p.x,y:p.y-wallH})), rc=center(eaves);
    const apex={x:rc.x,y:rc.y-roofH*(style.family==='landmark'?1.18:1)};

    ctx.save(); ctx.lineJoin='round';
    ctx.strokeStyle='rgba(54,43,34,.38)'; ctx.lineWidth=1; ctx.setLineDash([3,3]); path(ctx,footprint); ctx.stroke(); ctx.setLineDash([]);

    for (const face of [
      {p:[eaves[1],ground[1],ground[2],eaves[2]],fill:style.wall},
      {p:[eaves[2],ground[2],ground[3],eaves[3]],fill:style.shade}
    ]) {
      path(ctx,face.p); ctx.fillStyle=face.fill; ctx.globalAlpha=building.passable?.78:.96; ctx.fill(); ctx.globalAlpha=1;
      ctx.strokeStyle='rgba(38,31,27,.9)'; ctx.lineWidth=1.2; ctx.stroke();
    }

    for(let i=0;i<4;i+=1){
      const n=(i+1)%4; path(ctx,[eaves[i],eaves[n],apex]); ctx.fillStyle=i%2?style.roof2:style.roof;
      ctx.globalAlpha=building.passable?.84:.98; ctx.fill(); ctx.globalAlpha=1; ctx.strokeStyle='rgba(35,28,25,.92)'; ctx.lineWidth=1.1; ctx.stroke();
    }

    ctx.strokeStyle='rgba(238,220,187,.24)'; ctx.lineWidth=1;
    path(ctx,[apex,eaves[0]],false); ctx.stroke(); path(ctx,[apex,eaves[2]],false); ctx.stroke();
    typeCue(ctx,style,apex,c,b); entranceCue(ctx,building,style,c,b);
    ctx.restore(); return true;
  }

  function snapshotDescriptors() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    return buildings.map(b=>({id:b.id,type:b.type,role:b.role,passable:b.passable===true,footprint:b.footprint?{...b.footprint}:null,entrance:b.entrance?{...b.entrance}:null}));
  }

  function snapshotPresentationPlan() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    return buildings.map(b=>{const s=styleFor(b);return{id:b.id,type:b.type,family:s.family,cue:s.cue,footprint:b.footprint?{...b.footprint}:null,entrance:b.entrance?{...b.entrance}:null};});
  }

  function snapshotPlaceholderCoverage() {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    return buildings.map(b=>({id:b.id,type:b.type,...footprintTerrainStats(b)}));
  }

  function drawPresentation() {
    const canvas=ensureOverlay(), buildings=Game.State?.world?.originVillage?.buildings;
    if (!canvas || !Game.Renderer || !Array.isArray(buildings)) return false;
    const width=Math.max(1,canvas.clientWidth||Game.State?.dom?.canvas?.clientWidth||1);
    const height=Math.max(1,canvas.clientHeight||Game.State?.dom?.canvas?.clientHeight||1);
    const dpr=Math.max(1,window.devicePixelRatio||1), tw=Math.round(width*dpr), th=Math.round(height*dpr);
    if(canvas.width!==tw||canvas.height!==th){canvas.width=tw;canvas.height=th;}
    const ctx=canvas.getContext('2d'); if(!ctx) return false;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);

    rejectedProjectionCount=0;
    let visible=0; const types=new Set();
    for(const b of buildings) if(drawBuilding(ctx,b,width,height)){visible+=1;types.add(String(b.type||'unknown'));}

    const coverage=snapshotPlaceholderCoverage();
    const fully=coverage.filter(x=>x.total>0&&x.settlement===x.total).length;
    const covered=coverage.reduce((s,x)=>s+x.settlement,0), total=coverage.reduce((s,x)=>s+x.total,0);
    const families=new Set(snapshotPresentationPlan().map(x=>x.family));
    Object.assign(canvas.dataset,{
      buildingCount:String(buildings.length), visibleBuildingCount:String(visible), visibleBuildingTypes:Array.from(types).sort().join(','),
      visualFamilies:Array.from(families).sort().join(','), presentationAuthority:'presentation-only', descriptorSource:'originVillage.buildings',
      regionSize:String(Game.State?.world?.rows||0), presentationMode:MODE, placeholderMode:'none', rectangleOverlay:'disabled',
      fullyStoneCoveredBuildings:String(fully), stoneCoveredTiles:String(covered), footprintTiles:String(total),
      projectionGuard:'bounded-footprint', rejectedProjectionCount:String(rejectedProjectionCount)
    });
    return true;
  }

  function installRenderHook() {
    const Renderer=Game.Renderer;
    if(!Renderer||typeof Renderer.renderWorld!=='function'||renderHookInstalled) return false;
    const renderWorld=Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld=function starterVillageExteriorAwareRenderWorld(force){const result=renderWorld(force);drawPresentation();return result;};
    renderHookInstalled=true; return true;
  }

  function detachPresentation(){if(overlayCanvas?.parentNode)overlayCanvas.parentNode.removeChild(overlayCanvas);overlayCanvas=null;}
  function initialize(){ensureOverlay();installRenderHook();drawPresentation();}

  Game.StarterVillageExteriors=Object.freeze({
    version:VERSION, authority:'presentation-only', descriptorSource:'originVillage.buildings', presentationMode:MODE,
    snapshotDescriptors, snapshotPresentationPlan, snapshotPlaceholderCoverage, safeFootprint, ensureOverlay, drawPresentation, detachPresentation
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();