/*
  WP-112 / #461 + WP-104/I09 #490: unified static world presentation.
  Admin invariant: NPCs are the only normal independently dynamic world-image layer.
  Every non-NPC visual is flattened into one 100x100 RGBA logical-tile composite
  before it reaches the existing background texture upload path.
*/
(function installStaticTileCompositor(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  const VERSION = 'wp112-static-tile-compositor-v4-interior-cutaway-100px';
  const COMPOSITE_TILE_PX = 100;
  const SOURCE_TILE_PX = 256;
  const LOCAL_ROAD_TILE_PX = 100;
  const INTERIOR_CUTAWAY_TILE_PX = 100;
  const INTERIOR_CUTAWAY_FAMILY = 'interior_cutaway';
  const MAX_CACHE_TILES = 512;
  const CARDINAL = Object.freeze([
    {name:'N',dr:-1,dc:0},{name:'E',dr:0,dc:1},{name:'S',dr:1,dc:0},{name:'W',dr:0,dc:-1}
  ]);
  const BLOCKED_TERRAIN = new Set(['water','deep_water','wall','cliff','blocked']);
  const LEGACY_STATIC_LAYER_IDS = Object.freeze([
    'starterVillageRoadOverlay','starterVillageExteriorOverlay','worldObjectCompositionOverlay',
    'starterVillageDevOverlay','vectorLayerDebugOverlay','starterVillageInteriorOverlay'
  ]);
  const BUILDING_FAMILIES = new Set([
    'home','inn','village_hall','bakery','market','smithy','workshop','guard_post','mill','farmstead','storage','well'
  ]);
  const BUILDING_ALIASES = Object.freeze({
    dwelling:'home',house:'home',tavern:'inn',lodging:'inn',hall:'village_hall',civic:'village_hall',
    shop:'market',food:'bakery',production:'workshop',guard:'guard_post',service:'guard_post',
    farm:'farmstead',agricultural:'farmstead',storehouse:'storage',barn:'storage'
  });

  // #490: only semantic cells actually used by the shared runtime mapping are registered here.
  // All 90 occupied source cells remain truthfully described by the atlas manifest/descriptions.
  const INTERIOR_CUTAWAY_TYPES = Object.freeze([
    'wood_floor_horizontal_dark',
    'wood_floor_horizontal_mixed',
    'wood_floor_vertical_plank',
    'wood_floor_horizontal_rustic',
    'wood_floor_horizontal_light',
    'wood_floor_herringbone',
    'wood_floor_panel_inset',
    'stone_floor_cobble_light',
    'stone_floor_cobble_mossy',
    'stone_floor_flagstone_light',
    'earth_floor_compacted_dark',
    'timber_plaster_cutaway_wall_horizontal',
    'timber_plaster_cutaway_wall_vertical',
    'timber_plaster_cutaway_wall_l_01',
    'timber_plaster_cutaway_wall_l_02',
    'timber_plaster_window_wall_wide',
    'timber_doorway_frame_wide',
    'timber_post_single_01',
    'stone_cutaway_wall_horizontal',
    'stone_cutaway_wall_vertical',
    'stone_cutaway_wall_l_01',
    'stone_cutaway_wall_l_02',
    'stone_window_wall',
    'stone_arch_doorway',
    'stone_wall_niche'
  ]);
  const INTERIOR_FLOOR_BY_BUILDING_FAMILY = Object.freeze({
    home:'wood_floor_horizontal_dark',
    inn:'wood_floor_horizontal_mixed',
    village_hall:'wood_floor_herringbone',
    bakery:'stone_floor_flagstone_light',
    market:'wood_floor_horizontal_light',
    smithy:'stone_floor_cobble_light',
    workshop:'wood_floor_vertical_plank',
    guard_post:'stone_floor_flagstone_light',
    mill:'wood_floor_horizontal_rustic',
    farmstead:'earth_floor_compacted_dark',
    storage:'wood_floor_panel_inset',
    well:'stone_floor_cobble_mossy'
  });
  const STONE_CUTAWAY_FAMILIES = new Set(['village_hall','smithy','guard_post','well']);

  const imageCache = new Map();
  const tileCache = new Map();
  const invalidatedTiles = new Set();
  let registryModulePromise = null;
  let roadRegistry = null;
  let mainRoadRegistry = null;
  let buildingRegistry = null;
  let interiorCutawayRegistry = null;
  let objectRegistry = null;
  let objectRegistryEntries = [];
  let baseSnapshot = null;
  let baseCanvasIdentity = null;
  let lastStaticSignature = '';
  let renderHookInstalled = false;
  let composing = false;
  let composeQueued = false;
  let uploadQueued = false;
  let fullInvalidation = true;
  let lastOccupiedBuildingIds = new Set();
  let lastOccupancyChange = Object.freeze({changedBuildings:0,affectedTiles:0,occupiedBuildings:0});
  let lastStats = Object.freeze({
    version:VERSION,tilePixelSize:COMPOSITE_TILE_PX,staticTiles:0,overlays:0,roads:0,
    buildings:0,objects:0,cacheTiles:0,legacyLayersRemoved:0,reason:'not-composed'
  });

  const key = (r,c) => `${r},${c}`;
  const parseKey = value => String(value).split(',').map(Number);

  function makeCanvas(w,h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.trunc(w));
    canvas.height = Math.max(1,Math.trunc(h));
    return canvas;
  }

  function detachLegacyStaticLayers() {
    let removed = 0;
    if (typeof document === 'undefined') return removed;
    for (const id of LEGACY_STATIC_LAYER_IDS) {
      const node = document.getElementById(id);
      if (node) { node.remove(); removed++; }
    }
    return removed;
  }

  function worldDimensions() {
    const world = Game.State?.world;
    return {
      rows:Math.max(1,Math.trunc(Number(world?.rows)||100)),
      cols:Math.max(1,Math.trunc(Number(world?.cols)||100))
    };
  }

  function backgroundCellRect(bg,r,c) {
    const d = worldDimensions();
    return {x:c*bg.width/d.cols,y:r*bg.height/d.rows,width:bg.width/d.cols,height:bg.height/d.rows};
  }

  function validCell(r,c) {
    const d = worldDimensions();
    return Number.isInteger(r)&&Number.isInteger(c)&&r>=0&&c>=0&&r<d.rows&&c<d.cols;
  }

  function captureBaseSnapshot(force=false) {
    const bg = Game.State?.render?.worldBackgroundCanvas;
    if (!bg||!bg.width||!bg.height) return false;
    const changed = bg!==baseCanvasIdentity||!baseSnapshot||baseSnapshot.width!==bg.width||baseSnapshot.height!==bg.height;
    if (!force&&!changed) return false;
    const snapshot = makeCanvas(bg.width,bg.height);
    snapshot.getContext('2d').drawImage(bg,0,0);
    baseSnapshot=snapshot;
    baseCanvasIdentity=bg;
    lastStaticSignature='';
    fullInvalidation=true;
    tileCache.clear();
    return true;
  }

  function registryModule() {
    if (!registryModulePromise) registryModulePromise=import(new URL('js/tile_registry.js',document.baseURI).href);
    return registryModulePromise;
  }

  function interiorCutawayRegistryEntries() {
    return INTERIOR_CUTAWAY_TYPES.map(type => ({
      family:INTERIOR_CUTAWAY_FAMILY,
      type,
      size:INTERIOR_CUTAWAY_TILE_PX,
      source:`textures/tiles/interior_cutaway/interior_cutaway_${type}_100px.png`
    }));
  }

  async function ensureRegistries() {
    const module = await registryModule();
    if (!roadRegistry) roadRegistry=module.createCanonicalRoadTileRegistry();
    if (!mainRoadRegistry) mainRoadRegistry=module.createCanonicalMainRoadTileRegistry();
    if (!buildingRegistry) buildingRegistry=module.createCanonicalStarterBuildingTileRegistry();
    if (!interiorCutawayRegistry) interiorCutawayRegistry=new module.SemanticTileRegistry(interiorCutawayRegistryEntries());
    if (!objectRegistry) objectRegistry=new module.SemanticTileRegistry(objectRegistryEntries);
    return module;
  }

  async function configureObjectRegistry(entries) {
    const module=await registryModule();
    objectRegistryEntries=Array.isArray(entries)?entries.map(entry=>({...entry})):[];
    objectRegistry=new module.SemanticTileRegistry(objectRegistryEntries);
    invalidateAll('object-registry-change');
    return objectRegistryEntries.length;
  }

  function imageCacheKey(entry) { return `${entry.family}:${entry.type}:${entry.size}:${entry.source}`; }

  async function loadEntryImage(registry,family,type,size=SOURCE_TILE_PX) {
    const module=await ensureRegistries();
    const entry=registry.resolve(family,type,size);
    const cacheKey=imageCacheKey(entry),cached=imageCache.get(cacheKey);
    if (cached?.state==='ready') return cached.image;
    if (cached?.state==='error') throw cached.error;
    if (cached?.promise) return cached.promise;
    const record={state:'loading',image:null,error:null,promise:null};
    record.promise=new Promise((resolve,reject)=>{
      const image=new Image();
      image.decoding='async';
      image.onload=()=>{record.state='ready';record.image=image;resolve(image);};
      image.onerror=()=>{record.state='error';record.error=new Error(`Failed to load static tile asset ${entry.source}.`);reject(record.error);};
      image.src=module.resolveTileUrl(entry,document.baseURI);
    });
    imageCache.set(cacheKey,record);
    return record.promise;
  }

  function authoritativeRoadTiles() {
    const roads=Game.State?.world?.originVillage?.roadTiles;
    if (!Array.isArray(roads)) return [];
    const dedupe=new Map();
    for (const point of roads) {
      const r=Number(point?.row),c=Number(point?.col);
      if (validCell(r,c)) dedupe.set(key(r,c),{row:r,col:c});
    }
    return [...dedupe.values()].sort((a,b)=>a.row-b.row||a.col-b.col);
  }

  function roadTopology() {
    const roads=authoritativeRoadTiles(),set=new Set(roads.map(point=>key(point.row,point.col)));
    return roads.map(point=>{
      const links=CARDINAL.filter(direction=>set.has(key(point.row+direction.dr,point.col+direction.dc)));
      return {row:point.row,col:point.col,mask:links.map(direction=>direction.name).join(''),degree:links.length};
    });
  }

  function buildingFootprintSet() {
    const buildings=Game.State?.world?.originVillage?.buildings,out=new Set();
    if (!Array.isArray(buildings)) return out;
    for (const building of buildings) {
      if (building?.passable===true) continue;
      const footprint=building?.footprint,r=Number(footprint?.row),c=Number(footprint?.col),h=Number(footprint?.height),w=Number(footprint?.width);
      if (![r,c,h,w].every(Number.isFinite)) continue;
      const er=Number(building?.entrance?.row),ec=Number(building?.entrance?.col),entranceKey=Number.isInteger(er)&&Number.isInteger(ec)?key(er,ec):null;
      for (let rr=r;rr<r+h;rr++) for (let cc=c;cc<c+w;cc++) {
        const cellKey=key(rr,cc);
        if (cellKey!==entranceKey) out.add(cellKey);
      }
    }
    return out;
  }

  function invalidRoadTileSet(topology) {
    const occupied=buildingFootprintSet(),world=Game.State?.world,invalid=new Set();
    for (const tile of topology) {
      const cellKey=key(tile.row,tile.col),terrain=String(world?.terrain?.[tile.row]?.[tile.col]?.type||'').toLowerCase();
      if (occupied.has(cellKey)||BLOCKED_TERRAIN.has(terrain)) invalid.add(cellKey);
    }
    return invalid;
  }

  function roadVisual(tile) {
    if (!tile||tile.degree<=0) return null;
    const links=new Set(String(tile.mask||'').split('')),base={family:'road',size:LOCAL_ROAD_TILE_PX};
    if (tile.degree>=4) return {...base,type:'cross',quarterTurns:0};
    if (tile.degree===3) {
      // Compatibility source invariant retained for wp103_i09 regression: q={S:0,W:1,N:2,E:3}[m]
      const missing=CARDINAL.find(direction=>!links.has(direction.name))?.name;
      const quarterTurns={S:0,W:1,N:2,E:3}[missing];
      return quarterTurns===undefined?null:{...base,type:'t_junction',quarterTurns};
    }
    if (tile.degree===2) {
      if (links.has('N')&&links.has('S')) return {...base,type:'straight_vertical',quarterTurns:0};
      if (links.has('E')&&links.has('W')) return {...base,type:'straight_horizontal',quarterTurns:0};
      if (links.has('N')&&links.has('E')) return {...base,type:'turn_ne',quarterTurns:1};
      if (links.has('E')&&links.has('S')) return {...base,type:'turn_es',quarterTurns:2};
      if (links.has('S')&&links.has('W')) return {...base,type:'turn_sw',quarterTurns:3};
      if (links.has('W')&&links.has('N')) return {...base,type:'turn_wn',quarterTurns:0};
      return null;
    }
    const direction=CARDINAL.find(candidate=>links.has(candidate.name))?.name;
    if (direction==='N') return {...base,type:'straight_vertical',quarterTurns:0,clip:[0,0,100,50]};
    if (direction==='S') return {...base,type:'straight_vertical',quarterTurns:0,clip:[0,50,100,50]};
    if (direction==='W') return {...base,type:'straight_horizontal',quarterTurns:0,clip:[0,0,50,100]};
    if (direction==='E') return {...base,type:'straight_horizontal',quarterTurns:0,clip:[50,0,50,100]};
    return null;
  }

  function roadGrid() {
    const d=worldDimensions(),grid=Array.from({length:d.rows},()=>Array.from({length:d.cols},()=>null));
    for (const point of authoritativeRoadTiles()) grid[point.row][point.col]={type:'road'};
    return grid;
  }

  function mainRoadVisual(semantic) {
    if (!semantic||!Array.isArray(semantic.memberships)||!semantic.memberships.length) return null;
    if (semantic.kind==='main-road-intersection'||semantic.orientation==='cross') return {family:'main_road',type:'main_intersection_cross',quarterTurns:0};
    const membership=semantic.memberships[0];
    if (semantic.orientation==='vertical') {
      if (membership.longitudinalRole==='start'||membership.longitudinalRole==='end') return {family:'main_road',type:'main_transition_vertical',quarterTurns:0};
      return {family:'main_road',type:membership.lane==='a'?'main_straight_vertical_left':'main_straight_vertical_right',quarterTurns:0};
    }
    if (semantic.orientation==='horizontal') {
      if (membership.longitudinalRole==='start'||membership.longitudinalRole==='end') return {family:'main_road',type:'main_transition_horizontal',quarterTurns:0};
      return {family:'main_road',type:membership.lane==='a'?'main_straight_horizontal_top':'main_straight_horizontal_bottom',quarterTurns:0};
    }
    return null;
  }

  function canonicalBuildingFamily(building) {
    const raw=String(building?.type||'').toLowerCase(),family=BUILDING_ALIASES[raw]||raw;
    return BUILDING_FAMILIES.has(family)?family:null;
  }

  function buildingIdFor(building,family,r,c) { return String(building?.id||`${family}:${r}:${c}`); }

  function buildingFamilyById() {
    const out=new Map(),buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return out;
    for (const building of buildings) {
      const family=canonicalBuildingFamily(building),footprint=building?.footprint;
      if (!family||!footprint) continue;
      const r=Number(footprint.row),c=Number(footprint.col);
      if (!Number.isFinite(r)||!Number.isFinite(c)) continue;
      out.set(buildingIdFor(building,family,r,c),family);
    }
    return out;
  }

  function entranceCell(building) {
    const footprint=building?.footprint,entrance=building?.entrance;
    if (!footprint||!entrance) return null;
    const r=Number(footprint.row),c=Number(footprint.col),h=Number(footprint.height),w=Number(footprint.width),er=Number(entrance.row),ec=Number(entrance.col);
    if (![r,c,h,w,er,ec].every(Number.isFinite)) return null;
    if (er===r-1&&ec>=c&&ec<c+w) return {row:0,col:ec-c};
    if (er===r+h&&ec>=c&&ec<c+w) return {row:h-1,col:ec-c};
    if (ec===c-1&&er>=r&&er<r+h) return {row:er-r,col:0};
    if (ec===c+w&&er>=r&&er<r+h) return {row:er-r,col:w-1};
    return null;
  }

  function interiorBuildingIdAt(row,col) {
    const r=Number(row),c=Number(col);
    if (!Number.isFinite(r)||!Number.isFinite(c)) return null;
    try {
      const interior=Game.StarterVillageInteriors?.interiorAt?.(r,c);
      if (interior?.buildingId) return String(interior.buildingId);
    } catch (_) {}
    const id=Game.State?.world?.buildingInteriors?.floorIndex?.get?.(key(r,c));
    return id===undefined||id===null||id===''?null:String(id);
  }

  function occupiedBuildingIds() {
    const world=Game.State?.world,out=new Set(),actors=[world?.player,...(Array.isArray(world?.npcs)?world.npcs:[])];
    for (const actor of actors) {
      if (!actor||actor.active===false||actor.removed===true) continue;
      const id=interiorBuildingIdAt(actor.row,actor.col);
      if (id) out.add(id);
    }
    return out;
  }

  function markBuildingFootprintInvalid(buildingId) {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return 0;
    let affected=0;
    for (const building of buildings) {
      const family=canonicalBuildingFamily(building),footprint=building?.footprint;
      if (!family||!footprint) continue;
      const r=Number(footprint.row),c=Number(footprint.col),h=Math.trunc(Number(footprint.height)),w=Math.trunc(Number(footprint.width));
      if (![r,c,h,w].every(Number.isFinite)||h<=0||w<=0||buildingIdFor(building,family,r,c)!==String(buildingId)) continue;
      for (let lr=0;lr<h;lr++) for (let lc=0;lc<w;lc++) {
        const rr=r+lr,cc=c+lc;
        if (!validCell(rr,cc)) continue;
        invalidatedTiles.add(key(rr,cc));
        affected++;
      }
    }
    return affected;
  }

  function syncBuildingOccupancyInvalidation() {
    const current=occupiedBuildingIds(),changed=new Set([...current,...lastOccupiedBuildingIds].filter(id=>current.has(id)!==lastOccupiedBuildingIds.has(id)));
    let affectedTiles=0;
    for (const id of changed) affectedTiles+=markBuildingFootprintInvalid(id);
    lastOccupiedBuildingIds=current;
    const summary=Object.freeze({changedBuildings:changed.size,affectedTiles,occupiedBuildings:current.size});
    if (changed.size) lastOccupancyChange=summary;
    return summary;
  }

  function refreshBuildingOccupancy(reason='building-occupancy-change') {
    const summary=syncBuildingOccupancyInvalidation();
    if (summary.changedBuildings) queueCompose(reason);
    return summary;
  }

  function buildingSemanticType(building,lr,lc,h,w,door,cutaway=false) {
    const family=canonicalBuildingFamily(building);
    if (family==='well') return 'family_feature';
    if (door&&door.row===lr&&door.col===lc) return 'entrance';
    if (cutaway) {
      if (lr===0) return null;
      if (lr===h-1) {
        if (w===1) return 'wall_center';
        if (lc===0) return 'base_corner_sw';
        if (lc===w-1) return 'base_corner_se';
        return lc%2?'wall_window':'wall_center';
      }
      if (lc===0) return 'wall_edge_w';
      if (lc===w-1) return 'wall_edge_e';
      return null;
    }
    const featureRow=h>2?h-2:h-1,featureCol=Math.floor((w-1)/2);
    if (lr===featureRow&&lc===featureCol) return 'family_feature';
    if (lr===0) {
      if (w===1) return 'roof_ridge';
      if (lc===0) return 'roof_corner_nw';
      if (lc===w-1) return 'roof_corner_ne';
      if (lc===Math.floor(w/2)) return 'roof_ridge';
      return 'roof_edge_n';
    }
    if (lr===h-1) {
      if (w===1) return 'wall_center';
      if (lc===0) return 'base_corner_sw';
      if (lc===w-1) return 'base_corner_se';
      return lc%2?'wall_window':'wall_center';
    }
    if (lc===0) return 'wall_edge_w';
    if (lc===w-1) return 'wall_edge_e';
    return lc%2?'wall_window':'wall_center';
  }

  function buildingCells(occupied=occupiedBuildingIds()) {
    const buildings=Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    const cells=[];
    for (const building of buildings) {
      const family=canonicalBuildingFamily(building),footprint=building?.footprint;
      if (!family||!footprint) continue;
      const r=Number(footprint.row),c=Number(footprint.col),h=Math.trunc(Number(footprint.height)),w=Math.trunc(Number(footprint.width));
      if (![r,c,h,w].every(Number.isFinite)||h<=0||w<=0) continue;
      const door=entranceCell(building),buildingId=buildingIdFor(building,family,r,c),cutaway=occupied.has(buildingId);
      for (let lr=0;lr<h;lr++) for (let lc=0;lc<w;lc++) {
        const rr=r+lr,cc=c+lc,type=buildingSemanticType(building,lr,lc,h,w,door,cutaway);
        if (type&&validCell(rr,cc)) cells.push({row:rr,col:cc,family,type,buildingId,cutaway});
      }
    }
    return cells;
  }

  function buildingPresentationSnapshot() {
    const occupied=occupiedBuildingIds();
    return Object.freeze({
      authority:'presentation-only',
      occupiedBuildingIds:Object.freeze([...occupied].sort()),
      cells:Object.freeze(buildingCells(occupied).map(cell=>Object.freeze({...cell})))
    });
  }

  function sharedCutawaySemantic(buildingFamily,type) {
    const stone=STONE_CUTAWAY_FAMILIES.has(buildingFamily);
    if (type==='entrance') return stone?'stone_arch_doorway':'timber_doorway_frame_wide';
    if (type==='wall_window') return stone?'stone_window_wall':'timber_plaster_window_wall_wide';
    if (type==='wall_edge_w'||type==='wall_edge_e') return stone?'stone_cutaway_wall_vertical':'timber_plaster_cutaway_wall_vertical';
    if (type==='wall_center') return stone?'stone_cutaway_wall_horizontal':'timber_plaster_cutaway_wall_horizontal';
    if (type==='base_corner_sw') return stone?'stone_cutaway_wall_l_01':'timber_plaster_cutaway_wall_l_01';
    if (type==='base_corner_se') return stone?'stone_cutaway_wall_l_02':'timber_plaster_cutaway_wall_l_02';
    if (type==='family_feature') return stone?'stone_wall_niche':'timber_post_single_01';
    return null;
  }

  function interiorFloorCells(occupied=occupiedBuildingIds()) {
    const floorIndex=Game.State?.world?.buildingInteriors?.floorIndex;
    if (!floorIndex||typeof floorIndex.entries!=='function'||!occupied.size) return [];
    const familyById=buildingFamilyById(),cells=[];
    for (const [rawKey,rawId] of floorIndex.entries()) {
      const buildingId=String(rawId);
      if (!occupied.has(buildingId)) continue;
      const [row,col]=parseKey(rawKey),family=familyById.get(buildingId);
      const type=INTERIOR_FLOOR_BY_BUILDING_FAMILY[family]||'wood_floor_horizontal_dark';
      if (validCell(row,col)) cells.push({row,col,family:INTERIOR_CUTAWAY_FAMILY,type,size:INTERIOR_CUTAWAY_TILE_PX,buildingId});
    }
    return cells;
  }

  function parseSemanticKey(value) {
    const parts=String(value||'').split(':').map(item=>item.trim()).filter(Boolean);
    if (parts.length<2) return null;
    const size=parts.length>=3?Number(parts[2]):SOURCE_TILE_PX;
    return Number.isInteger(size)&&size>0?{family:parts[0],type:parts[1],size}:null;
  }

  function objectCells() {
    const descriptors=Game.State?.world?.objectPresentationDescriptors;
    if (!Array.isArray(descriptors)||!objectRegistry||!objectRegistryEntries.length) return [];
    const cells=[];
    for (const descriptor of descriptors) {
      if (!descriptor||descriptor.authority!=='simulation') continue;
      const semantic=parseSemanticKey(descriptor.visual?.semanticKey||descriptor.semanticType);
      if (!semantic||!objectRegistry.has(semantic.family,semantic.type,semantic.size)) continue;
      const occupied=descriptor.footprint?.occupiedCells;
      if (!Array.isArray(occupied)||occupied.length!==1) continue;
      const r=Number(occupied[0]?.row),c=Number(occupied[0]?.col);
      if (validCell(r,c)) cells.push({row:r,col:c,family:semantic.family,type:semantic.type,size:semantic.size,objectId:descriptor.objectId});
    }
    return cells;
  }

  function addOverlay(stacks,r,c,overlay) {
    if (!validCell(r,c)) return;
    const cellKey=key(r,c),list=stacks.get(cellKey)||[];
    list.push(overlay);
    stacks.set(cellKey,list);
  }

  async function buildOverlayStacks() {
    await ensureRegistries();
    const stacks=new Map(),topology=roadTopology(),invalid=invalidRoadTileSet(topology);
    let classification=null;
    try { classification=Game.MainRoadSemantics?.classify?.(roadGrid())||null; } catch (_) {}
    const main=new Map();
    for (const [cellKey,semantic] of Object.entries(classification?.cells||{})) {
      const visual=mainRoadVisual(semantic);
      if (visual) main.set(cellKey,visual);
    }
    for (const tile of topology) {
      const cellKey=key(tile.row,tile.col);
      if (invalid.has(cellKey)) continue;
      const visual=main.get(cellKey)||roadVisual(tile);
      if (visual) addOverlay(stacks,tile.row,tile.col,{...visual,category:10,source:'road'});
    }

    // #490: shared floors are composited before boundary/cutaway pieces and only while
    // a Simulation-backed actor occupies the corresponding building.
    for (const cell of interiorFloorCells()) {
      addOverlay(stacks,cell.row,cell.col,{
        family:INTERIOR_CUTAWAY_FAMILY,type:cell.type,size:INTERIOR_CUTAWAY_TILE_PX,
        category:15,source:`building:${cell.buildingId}`,interiorCutaway:true
      });
    }

    for (const cell of buildingCells()) {
      if (cell.cutaway) {
        const type=sharedCutawaySemantic(cell.family,cell.type);
        if (type) addOverlay(stacks,cell.row,cell.col,{
          family:INTERIOR_CUTAWAY_FAMILY,type,size:INTERIOR_CUTAWAY_TILE_PX,
          category:20,source:`building:${cell.buildingId}`,interiorCutaway:true
        });
      } else {
        addOverlay(stacks,cell.row,cell.col,{family:cell.family,type:cell.type,size:SOURCE_TILE_PX,category:20,source:`building:${cell.buildingId}`});
      }
    }
    for (const cell of objectCells()) addOverlay(stacks,cell.row,cell.col,{family:cell.family,type:cell.type,size:cell.size,category:30,source:`object:${cell.objectId}`,customRegistry:true});
    for (const list of stacks.values()) list.sort((a,b)=>a.category-b.category||String(a.family).localeCompare(String(b.family))||String(a.type).localeCompare(String(b.type))||String(a.source).localeCompare(String(b.source)));
    return stacks;
  }

  function staticSignature() {
    const world=Game.State?.world,village=world?.originVillage;
    const roads=Array.isArray(village?.roadTiles)?village.roadTiles.map(point=>`${point.row},${point.col}`).sort().join('|'):'';
    const buildings=Array.isArray(village?.buildings)?village.buildings.map(building=>{
      const footprint=building?.footprint||{},entrance=building?.entrance||{};
      return [building?.id,building?.type,footprint.row,footprint.col,footprint.height,footprint.width,entrance.row,entrance.col,building?.passable].join(':');
    }).sort().join('|'):'';
    const objects=Array.isArray(world?.objectPresentationDescriptors)?world.objectPresentationDescriptors.map(descriptor=>{
      const position=descriptor?.position||{};
      return [descriptor?.objectId,descriptor?.semanticType,position.regionX,position.regionY,position.row,position.col,descriptor?.visual?.semanticKey].join(':');
    }).sort().join('|'):'';
    const bg=Game.State?.render?.worldBackgroundCanvas;
    return `${world?.seed||''}|${world?.regionX||0},${world?.regionY||0}|${bg?.width||0}x${bg?.height||0}|r:${roads}|b:${buildings}|o:${objects}|or:${objectRegistryEntries.length}`;
  }

  function cachePut(cacheKey,canvas,signature) {
    if (tileCache.has(cacheKey)) tileCache.delete(cacheKey);
    tileCache.set(cacheKey,{canvas,signature,usedAt:Date.now()});
    while (tileCache.size>MAX_CACHE_TILES) tileCache.delete(tileCache.keys().next().value);
  }

  function drawOverlayImage(ctx,image,overlay) {
    ctx.save();
    const sourcePx=Math.max(1,Number(overlay?.size)||SOURCE_TILE_PX);
    if (overlay.clip) {
      const [sx,sy,sw,sh]=overlay.clip;
      ctx.beginPath();
      ctx.rect(sx/sourcePx*COMPOSITE_TILE_PX,sy/sourcePx*COMPOSITE_TILE_PX,sw/sourcePx*COMPOSITE_TILE_PX,sh/sourcePx*COMPOSITE_TILE_PX);
      ctx.clip();
    }
    if (overlay.quarterTurns) {
      ctx.translate(50,50);
      ctx.rotate(overlay.quarterTurns*Math.PI*.5);
      ctx.translate(-50,-50);
    }
    ctx.drawImage(image,0,0,100,100);
    ctx.restore();
  }

  async function composeCell(bg,r,c,overlays,signature) {
    const cacheKey=key(r,c),rect=backgroundCellRect(bg,r,c),canvas=makeCanvas(100,100),ctx=canvas.getContext('2d');
    if (!ctx||!baseSnapshot) return {drawn:0,tileCanvas:null};
    ctx.drawImage(baseSnapshot,rect.x,rect.y,rect.width,rect.height,0,0,100,100);
    let drawn=0;
    for (const overlay of overlays) {
      const registry=overlay.customRegistry?objectRegistry
        :overlay.family==='road'?roadRegistry
        :overlay.family==='main_road'?mainRoadRegistry
        :overlay.family===INTERIOR_CUTAWAY_FAMILY?interiorCutawayRegistry
        :buildingRegistry;
      if (!registry) continue;
      try {
        const image=await loadEntryImage(registry,overlay.family,overlay.type,overlay.size||SOURCE_TILE_PX);
        drawOverlayImage(ctx,image,overlay);
        drawn++;
      } catch (error) {
        console.warn(`Static tile overlay unavailable at ${cacheKey}: ${overlay.family}:${overlay.type}`,error);
      }
    }
    cachePut(cacheKey,canvas,signature);
    return {drawn,tileCanvas:canvas};
  }

  function requestBackgroundUpload() {
    if (uploadQueued) return;
    uploadQueued=true;
    global.requestAnimationFrame(()=>{
      uploadQueued=false;
      const render=Game.State?.render;
      if (render) {render.needsBackgroundUpload=true;render.backgroundTextureReady=false;}
      if (Game.Renderer?.renderWorld) Game.Renderer.renderWorld(false);
    });
  }

  async function composeNow(reason='manual') {
    if (composing) {composeQueued=true;return false;}
    composing=true;
    try {
      detachLegacyStaticLayers();
      const render=Game.State?.render,bg=render?.worldBackgroundCanvas;
      if (!bg||!bg.width||!bg.height) return false;
      if (!baseSnapshot||bg!==baseCanvasIdentity||baseSnapshot.width!==bg.width||baseSnapshot.height!==bg.height) captureBaseSnapshot(true);
      if (!baseSnapshot) return false;
      const occupancyChange=syncBuildingOccupancyInvalidation(),sig=staticSignature(),full=fullInvalidation||sig!==lastStaticSignature;
      if (!full&&invalidatedTiles.size===0) return true;
      const stacks=await buildOverlayStacks(),targets=full?new Set(stacks.keys()):new Set(invalidatedTiles),ctx=bg.getContext('2d');
      if (!ctx) return false;
      if (full) {
        ctx.clearRect(0,0,bg.width,bg.height);
        ctx.drawImage(baseSnapshot,0,0);
        tileCache.clear();
      } else for (const cellKey of targets) {
        const [r,c]=parseKey(cellKey);
        if (!validCell(r,c)) continue;
        const rect=backgroundCellRect(bg,r,c);
        ctx.drawImage(baseSnapshot,rect.x,rect.y,rect.width,rect.height,rect.x,rect.y,rect.width,rect.height);
        tileCache.delete(cellKey);
      }
      let overlays=0,roads=0,buildings=0,objects=0;
      const ordered=[...targets].sort((a,b)=>{const[ar,ac]=parseKey(a),[br,bc]=parseKey(b);return ar-br||ac-bc;});
      for (const cellKey of ordered) {
        const list=stacks.get(cellKey)||[];
        if (!list.length) continue;
        const [r,c]=parseKey(cellKey),result=await composeCell(bg,r,c,list,`${sig}|${cellKey}`);
        if (!result.tileCanvas) continue;
        const rect=backgroundCellRect(bg,r,c);
        ctx.drawImage(result.tileCanvas,rect.x,rect.y,rect.width,rect.height);
        overlays+=result.drawn;
        roads+=list.filter(overlay=>overlay.source==='road').length;
        buildings+=list.filter(overlay=>String(overlay.source).startsWith('building:')).length;
        objects+=list.filter(overlay=>String(overlay.source).startsWith('object:')).length;
      }
      lastStaticSignature=sig;
      invalidatedTiles.clear();
      fullInvalidation=false;
      lastStats=Object.freeze({
        version:VERSION,tilePixelSize:100,staticTiles:ordered.length,overlays,roads,buildings,objects,
        cacheTiles:tileCache.size,legacyLayersRemoved:detachLegacyStaticLayers(),reason,
        backgroundWidth:bg.width,backgroundHeight:bg.height,npcDynamicException:true,
        occupiedBuildings:lastOccupiedBuildingIds.size,occupancyChangedBuildings:occupancyChange.changedBuildings,
        occupancyAffectedTiles:occupancyChange.affectedTiles
      });
      requestBackgroundUpload();
      return true;
    } finally {
      composing=false;
      if (composeQueued) {composeQueued=false;queueCompose('queued');}
    }
  }

  function queueCompose(reason='scheduled') {
    if (composeQueued) return;
    composeQueued=true;
    global.requestAnimationFrame(()=>{
      composeQueued=false;
      composeNow(reason).catch(error=>console.warn('Static tile composition failed.',error));
    });
  }

  function invalidateTile(r,c,reason='static-change') {
    if (!validCell(r,c)) return false;
    invalidatedTiles.add(key(r,c));
    queueCompose(reason);
    return true;
  }

  function invalidateTiles(cells,reason='static-change') {
    if (!Array.isArray(cells)) return 0;
    let count=0;
    for (const cell of cells) if (invalidateTile(Number(cell?.row),Number(cell?.col),reason)) count++;
    return count;
  }

  function invalidateAll(reason='static-change') {
    fullInvalidation=true;
    lastStaticSignature='';
    queueCompose(reason);
    return true;
  }

  function installRenderHook() {
    if (renderHookInstalled||!Game.Renderer||typeof Game.Renderer.renderWorld!=='function') return false;
    const prior=Game.Renderer.renderWorld.bind(Game.Renderer);
    Game.Renderer.renderWorld=function(force) {
      const render=Game.State?.render,dirty=Boolean(render?.needsBackgroundRebuild),before=render?.worldBackgroundCanvas||null,result=prior(force),after=Game.State?.render?.worldBackgroundCanvas||null;
      if (!baseSnapshot||after!==baseCanvasIdentity||before!==after||dirty) {captureBaseSnapshot(true);fullInvalidation=true;}
      queueCompose(dirty?'base-background-rebuild':'render');
      return result;
    };
    renderHookInstalled=true;
    return true;
  }

  function initialize(attempt=0) {
    detachLegacyStaticLayers();
    if (!(Game.State&&Game.Renderer?.renderWorld)) {
      if (attempt<160) global.setTimeout(()=>initialize(attempt+1),50);
      return false;
    }
    installRenderHook();
    captureBaseSnapshot(false);
    queueCompose('initialize');
    return true;
  }

  Game.StaticTileCompositor=Object.freeze({
    version:VERSION,
    authority:'presentation-only',
    tilePixelSize:100,
    sourceTilePixelSize:256,
    localRoadSourceTilePixelSize:LOCAL_ROAD_TILE_PX,
    interiorCutawaySourceTilePixelSize:INTERIOR_CUTAWAY_TILE_PX,
    interiorCutawayFamily:INTERIOR_CUTAWAY_FAMILY,
    layerPolicy:'static-background-plus-dynamic-npc-only',
    npcDynamicException:true,
    configureObjectRegistry,
    composeNow,
    invalidateTile,
    invalidateTiles,
    invalidateAll,
    refreshBuildingOccupancy,
    buildingPresentationSnapshot,
    detachLegacyStaticLayers,
    diagnostics(){return{
      ...lastStats,
      invalidatedTiles:invalidatedTiles.size,
      fullInvalidation,
      objectRegistryEntries:objectRegistryEntries.length,
      occupiedBuildingIds:[...lastOccupiedBuildingIds].sort(),
      lastOccupancyChange
    };},
    initialize
  });

  if (typeof document!=='undefined'&&document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initialize(),{once:true});
  else initialize();
})(typeof window!=='undefined'?window:globalThis);
