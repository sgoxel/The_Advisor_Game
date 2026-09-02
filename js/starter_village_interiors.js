/*
  R04 / #253: seamless starter-village interiors derived from authoritative
  SpatialWorld building descriptors. No detached interior scene is created.
*/
(function installStarterVillageInteriors(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-starter-village-interiors-v2';
  let lastWorld = null;
  let lastVillage = null;
  let overlay = null;
  let rafId = 0;

  function tags(tile) {
    if (!tile) return null;
    if (tile.tags instanceof Set) return tile.tags;
    if (Array.isArray(tile.tags)) { tile.tags = new Set(tile.tags); return tile.tags; }
    tile.tags = new Set(); return tile.tags;
  }
  function add(tile, tag) { const set = tags(tile); if (set) set.add(tag); }
  function remove(tile, tag) { const set = tags(tile); if (set) set.delete(tag); }
  function key(row, col) { return `${row},${col}`; }

  function descriptorFor(building) {
    const f = building?.footprint, e = building?.entrance;
    if (!f || !e || building.passable === true) return null;
    const row0=Number(f.row), col0=Number(f.col), row1=row0+Number(f.height)-1, col1=col0+Number(f.width)-1;
    if (![row0,col0,row1,col1].every(Number.isFinite) || row1-row0<2 || col1-col0<2) return null;
    let door;
    if (Number(e.row)<row0) door={row:row0,col:Math.max(col0+1,Math.min(col1-1,Number(e.col)))};
    else if (Number(e.row)>row1) door={row:row1,col:Math.max(col0+1,Math.min(col1-1,Number(e.col)))};
    else if (Number(e.col)<col0) door={row:Math.max(row0+1,Math.min(row1-1,Number(e.row))),col:col0};
    else door={row:Math.max(row0+1,Math.min(row1-1,Number(e.row))),col:col1};
    const walls=[], floors=[];
    for(let row=row0;row<=row1;row+=1) for(let col=col0;col<=col1;col+=1){
      const boundary=row===row0||row===row1||col===col0||col===col1, point={row,col};
      if(boundary&&(row!==door.row||col!==door.col)) walls.push(point); else floors.push(point);
    }
    const rooms=(Array.isArray(building.rooms)?building.rooms:[]).map(room=>Object.freeze({id:String(room.id),purpose:String(room.purpose||'primary'),row:Number(room.row),col:Number(room.col),width:Number(room.width),height:Number(room.height)}));
    return Object.freeze({schemaVersion:1,version:VERSION,authority:'simulation-derived',buildingId:String(building.id),buildingType:String(building.type||'building'),footprint:Object.freeze({...f}),entrance:Object.freeze({row:Number(e.row),col:Number(e.col)}),door:Object.freeze(door),rooms:Object.freeze(rooms),walls:Object.freeze(walls.map(Object.freeze)),floors:Object.freeze(floors.map(Object.freeze))});
  }

  function clearBlockingTerrain(tile) {
    if (!tile) return;
    tile.type='settlement'; tile.blocked=false; tile.obstacle=false;
    for (const tag of ['blocked','obstacle','water','lake','river','mountain','forest','building-wall']) remove(tile,tag);
    add(tile,'settlement');
  }

  function materialize(world) {
    const village=world?.originVillage;
    if(!world||!Array.isArray(world.terrain)||!Array.isArray(village?.buildings)) return false;
    if(world===lastWorld&&village===lastVillage&&world.buildingInteriors?.version===VERSION) return true;
    const interiors=village.buildings.map(descriptorFor).filter(Boolean), floorIndex=new Map(), wallIndex=new Map();
    for(const interior of interiors){
      for(const point of interior.walls){const tile=world.terrain[point.row]?.[point.col];if(!tile)continue;tile.type='settlement';tile.blocked=true;add(tile,'settlement');add(tile,'blocked');add(tile,'building-wall');add(tile,`building:${interior.buildingId}`);wallIndex.set(key(point.row,point.col),interior.buildingId);}
      for(const point of interior.floors){const tile=world.terrain[point.row]?.[point.col];if(!tile)continue;clearBlockingTerrain(tile);add(tile,'building-interior');add(tile,'building-floor');add(tile,`building:${interior.buildingId}`);floorIndex.set(key(point.row,point.col),interior.buildingId);}
      const entranceTile=world.terrain[interior.entrance.row]?.[interior.entrance.col];
      if(entranceTile){clearBlockingTerrain(entranceTile);add(entranceTile,'building-entrance');add(entranceTile,`building:${interior.buildingId}`);}
      const doorTile=world.terrain[interior.door.row]?.[interior.door.col];
      if(doorTile){clearBlockingTerrain(doorTile);add(doorTile,'building-door');add(doorTile,'building-interior');add(doorTile,`building:${interior.buildingId}`);}
    }
    world.buildingInteriors=Object.freeze({schemaVersion:1,version:VERSION,authority:'simulation-derived',seed:String(world.seed||Game.State?.settings?.seed||''),interiors:Object.freeze(interiors),floorIndex,wallIndex});
    lastWorld=world;lastVillage=village;return true;
  }

  function interiorAt(row,col){const state=Game.State?.world?.buildingInteriors;const id=state?.floorIndex?.get(key(Number(row),Number(col)));return id?state.interiors.find(item=>item.buildingId===id)||null:null;}
  function ensureOverlay(){const host=document.getElementById('center-area'),gameCanvas=Game.State?.dom?.canvas||document.getElementById('gameCanvas');if(!host||!gameCanvas)return null;if(overlay?.isConnected)return overlay;overlay=document.createElement('canvas');overlay.id='starterVillageInteriorOverlay';overlay.setAttribute('aria-hidden','true');overlay.tabIndex=-1;Object.assign(overlay.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'2'});host.appendChild(overlay);return overlay;}
  function project(row,col){const p=Game.Renderer?.gridToScreen?.(row,col,0,0);return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;}
  function polygonForRect(rect){const r=Number(rect.row),c=Number(rect.col),h=Number(rect.height),w=Number(rect.width),points=[project(r,c),project(r,c+w),project(r+h,c+w),project(r+h,c)];return points.every(Boolean)?points:null;}
  function drawPolygon(ctx,points,fill,stroke){ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i+=1)ctx.lineTo(points[i].x,points[i].y);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}}
  function render(){const canvas=ensureOverlay(),world=Game.State?.world,player=world?.player;if(!canvas||!world||!player)return;const active=interiorAt(player.row,player.col),exterior=document.getElementById('starterVillageExteriorOverlay');if(!active){if(canvas.dataset.activeBuildingId){const width=Math.max(1,canvas.clientWidth||Game.State?.dom?.canvas?.clientWidth||1),height=Math.max(1,canvas.clientHeight||Game.State?.dom?.canvas?.clientHeight||1),dpr=Math.max(1,global.devicePixelRatio||1);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}const ctx=canvas.getContext('2d');if(ctx){ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);}}canvas.dataset.activeBuildingId='';if(exterior)exterior.style.opacity='1';return;}const width=Math.max(1,canvas.clientWidth||Game.State?.dom?.canvas?.clientWidth||1),height=Math.max(1,canvas.clientHeight||Game.State?.dom?.canvas?.clientHeight||1),dpr=Math.max(1,global.devicePixelRatio||1);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);canvas.dataset.activeBuildingId=active.buildingId;if(exterior)exterior.style.opacity='0.24';const footprint=polygonForRect(active.footprint);if(footprint)drawPolygon(ctx,footprint,'rgba(93,75,54,.82)','rgba(236,217,178,.86)');for(const room of active.rooms){const points=polygonForRect({row:room.row,col:room.col,width:room.width,height:room.height});if(points)drawPolygon(ctx,points,'rgba(177,143,91,.18)','rgba(61,48,38,.82)');}const door=project(active.door.row+.5,active.door.col+.5);if(door){ctx.fillStyle='#e8c981';ctx.beginPath();ctx.arc(door.x,door.y,4,0,Math.PI*2);ctx.fill();}}
  function frame(){materialize(Game.State?.world);render();rafId=global.requestAnimationFrame?global.requestAnimationFrame(frame):0;}
  function install(){materialize(Game.State?.world);if(!rafId&&global.requestAnimationFrame)rafId=global.requestAnimationFrame(frame);return true;}
  Game.StarterVillageInteriors=Object.freeze({version:VERSION,authority:'simulation-derived',install,materialize,interiorAt,descriptorFor,snapshot(){const s=Game.State?.world?.buildingInteriors;return s?{schemaVersion:s.schemaVersion,version:s.version,authority:s.authority,seed:s.seed,interiors:s.interiors}:null;}});
  if(typeof document!=='undefined'){if(document.readyState==='loading')global.addEventListener('DOMContentLoaded',install,{once:true});else install();}
})(typeof window!=='undefined'?window:globalThis);
