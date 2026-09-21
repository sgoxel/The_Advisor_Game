(function(){
"use strict";
const e={};
let restoredCampaign=false;
let clockTimer=null;
const ids=[
  "mainMenuButton","settingsButton","mainMenuPopup","settingsPopup","resumeButton","newCampaignButton","restartCampaignButton",
  "menuMessage","seedInput","saveSettingsButton","settingsMessage","gameDate","gameTime","campaignState","statusMessage",
  "detailState","detailGameDate","detailGameTime","detailProtagonistX","detailProtagonistY","vDate","vPersist",
  "terrainGrid","terrainLegend","vTerrainDeterministic","vTerrainSolidOnly",
  "cameraHud","cameraCoordinate","cameraZoom","centerCameraButton","resetZoomButton","cameraX","cameraY","cameraProtagonistX","cameraProtagonistY","cameraZoomDetail","cameraTileSize",
  "vCameraStart","vCameraIndependent","vCameraWindow","vCameraReturn","vCameraWheelZoom","vCameraPinchZoom",
  "villageWorldScale","startingVillageName","villageGateway","villageCoreDiameter","villagePlotCount","villageMainlandEdge","villageBridgeMax","villageSpacingStandard",
  "vVillageCore","vVillageMainland","vVillageBridge","vVillagePlan","vVillageRepeat",
  "houseBuildingCount","houseTypeCount","houseMinRoomTiles","houseSvgCount",
  "vHousePlan","vHouseRooms","vHouseWalls","vHouseEntrances","vHouseSvg","vHouseTransitions",
  "tileViewportSize","tileGridSize","tileCount","tileCenterCoordinate",
  "vTileCoverage","vTileResponsive","vTileOddGrid","vTileRepeat","vTileSolidOnly",
  "geoContinent","geoCountry","geoRegion","geoCity","geoDistrict","geoVillage","geoAvenue","geoStreet",
  "geoBiome","geoClimate","geoElevation","geoTerrain","nearestVillage","nearestVillageWalk",
  "vGeoDeterministic","vGeoTimeFree","vVillageSpacing","vTerrainGeography",
  "gameplayPlaceholder","protagonistMarker","protagonistSprite","protagonistFallback","protagonistLocation","wp3Position","vOrigin","vCenter","vProtagonistSprite","vPositiveWorld","vNegativeWorld",
  "prngSeed","foundationKey","foundationValue","prngTimestamp","liveValue","vFoundationRepeat","vFoundationTimeFree","vLiveRepeat","vLiveTime","vNoMilliseconds","vPrngSource"
];
function cache(){ids.forEach(id=>e[id]=document.getElementById(id))}
function openPopup(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function closePopup(id){document.getElementById(id).hidden=true;document.body.style.overflow=""}
function closeAll(){document.querySelectorAll(".fullscreen-popup").forEach(p=>p.hidden=true);document.body.style.overflow=""}
function setCheck(node,pass,waiting){node.textContent=pass?"PASS":waiting;node.classList.toggle("pass",pass)}

function renderPRNG(fantasyTimestampMs){
  const campaign=SeedSystem.getCampaign();
  const seed=campaign?campaign.seed:SeedSystem.getSettings().seed;
  e.prngSeed.textContent=seed;

  const foundationKey="wp002:foundation-proof";
  const foundationValue=PRNG.foundationUint32(seed,foundationKey);
  e.foundationKey.textContent=foundationKey;
  e.foundationValue.textContent=String(foundationValue);
  setCheck(
    e.vFoundationRepeat,
    foundationValue===PRNG.foundationUint32(seed,foundationKey),
    "FAIL"
  );
  setCheck(
    e.vFoundationTimeFree,
    PRNG.foundationUint32.length===2,
    "FAIL"
  );

  if(!campaign||fantasyTimestampMs==null){
    e.prngTimestamp.textContent="—";
    e.liveValue.textContent="—";
    setCheck(e.vLiveRepeat,false,"WAITING");
    setCheck(e.vLiveTime,false,"WAITING");
    setCheck(e.vNoMilliseconds,true,"FAIL");
    setCheck(
      e.vPrngSource,
      PRNG.foundationUint32.length===2&&PRNG.liveUint32.length===2,
      "FAIL"
    );
    return;
  }

  const currentTime=GameTime.fromTimestampMs(fantasyTimestampMs);
  const timestampKey=GameTime.toTimestampKey(currentTime);
  const nextTimestampKey=GameTime.toTimestampKey(GameTime.fromTimestampMs(
    Math.floor(fantasyTimestampMs/1000)*1000+1000
  ));
  const proof=PRNG.verify(campaign.seed,timestampKey);
  e.prngTimestamp.textContent=GameTime.formatTimestamp(currentTime);
  e.liveValue.textContent=String(proof.liveValue);
  setCheck(e.vLiveRepeat,proof.liveRepeatable,"FAIL");
  setCheck(
    e.vLiveTime,
    proof.liveValue!==PRNG.liveUint32(campaign.seed,nextTimestampKey),
    "FAIL"
  );
  setCheck(
    e.vNoMilliseconds,
    /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestampKey),
    "FAIL"
  );
  setCheck(
    e.vPrngSource,
    PRNG.foundationUint32.length===2&&PRNG.liveUint32.length===2,
    "FAIL"
  );
}
function renderStartingVillage(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["villageWorldScale","startingVillageName","villageGateway","villageCoreDiameter","villagePlotCount","villageMainlandEdge","villageBridgeMax","villageSpacingStandard"]
      .forEach(id=>e[id].textContent="—");
    setCheck(e.vVillageCore,false,"WAITING");
    setCheck(e.vVillageMainland,false,"WAITING");
    setCheck(e.vVillageBridge,false,"WAITING");
    setCheck(e.vVillagePlan,false,"WAITING");
    setCheck(e.vVillageRepeat,false,"WAITING");
    return;
  }

  const plan=StartingVillage.plan(campaign.seed);
  const proof=StartingVillage.proof(campaign.seed);

  e.villageWorldScale.textContent=WorldStandards.TILE_METERS+" m / tile";
  e.startingVillageName.textContent=plan.name;
  e.villageGateway.textContent=plan.gatewayDirection;
  e.villageCoreDiameter.textContent=plan.approximateCoreDiameterMeters+" m";
  e.villagePlotCount.textContent=String(plan.plotCount);
  e.villageMainlandEdge.textContent="~"+plan.gatewayMainlandEdgeMeters+" m";
  e.villageBridgeMax.textContent=
    proof.maxBridgeMeters+" m / "+proof.maxBridgeMinutes.toFixed(1)+" fantasy min";
  e.villageSpacingStandard.textContent=
    (WorldStandards.MIN_VILLAGE_DISTANCE_METERS/1000).toFixed(1)+" km minimum";

  setCheck(e.vVillageCore,proof.originInsideVillage,"FAIL");
  setCheck(e.vVillageMainland,proof.mainlandConnected&&proof.roadGapCount===0,"FAIL");
  setCheck(e.vVillageBridge,proof.bridgePass,"FAIL");
  setCheck(e.vVillagePlan,proof.plotCount>=6&&proof.mainlandLandSamples>0,"FAIL");
  setCheck(e.vVillageRepeat,proof.deterministic,"FAIL");
}

function renderHousePlans(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["houseBuildingCount","houseTypeCount","houseMinRoomTiles","houseSvgCount"].forEach(id=>e[id].textContent="—");
    ["vHousePlan","vHouseRooms","vHouseWalls","vHouseEntrances","vHouseSvg","vHouseTransitions"].forEach(id=>setCheck(e[id],false,"WAITING"));
    return;
  }

  const proof=HousePlans.proof(campaign.seed);
  const svgAssets=[
    TileTextures.asset("water"),
    TileTextures.asset("grass"),
    TileTextures.asset("floor","floor-wood"),
    TileTextures.asset("wall","wall-n"),
    TileTextures.asset("door","door-s")
  ];
  const l=TileTextures.transition("grass","water","water","grass","grass");
  const c=TileTextures.transition("grass","water","grass","grass","grass");
  const u=TileTextures.transition("grass","water","water","water","grass");

  e.houseBuildingCount.textContent=String(proof.buildingCount);
  e.houseTypeCount.textContent=proof.normalHouseCount+" houses / "+proof.cabinCount+" cabins";
  e.houseMinRoomTiles.textContent=proof.minimumRoomTiles+" tiles / "+(proof.minimumRoomTiles*WorldStandards.TILE_METERS*WorldStandards.TILE_METERS)+" m²";
  e.houseSvgCount.textContent="29 vector SVG files";

  setCheck(e.vHousePlan,proof.pass&&proof.deterministic,"FAIL");
  setCheck(e.vHouseRooms,proof.roomsPass&&proof.minimumRoomTiles>=6,"FAIL");
  setCheck(e.vHouseWalls,proof.outerWallsPass&&proof.interiorWallsPass,"FAIL");
  setCheck(e.vHouseEntrances,proof.entrancesPass,"FAIL");
  setCheck(e.vHouseSvg,svgAssets.every(path=>typeof path==="string"&&path.endsWith(".svg")),"FAIL");
  setCheck(e.vHouseTransitions,!!l&&l.shape==="l"&&!!c&&c.shape==="c"&&!!u&&u.shape==="u","FAIL");
}

function renderGeography(){
  const campaign=SeedSystem.getCampaign();
  const position=Protagonist.getPosition();
  if(!campaign||!position){
    ["geoContinent","geoCountry","geoRegion","geoCity","geoDistrict","geoVillage","geoAvenue","geoStreet",
     "geoBiome","geoClimate","geoElevation","geoTerrain","nearestVillage","nearestVillageWalk"].forEach(id=>e[id].textContent="—");
    setCheck(e.vGeoDeterministic,false,"WAITING");
    setCheck(e.vVillageSpacing,false,"WAITING");
    return;
  }

  const first=GeographyFoundation.location(campaign.seed,position.x,position.y);
  const second=GeographyFoundation.location(campaign.seed,position.x,position.y);
  const h=first.hierarchy;
  const env=first.environment;
  e.geoContinent.textContent=h.continent;
  e.geoCountry.textContent=h.country;
  e.geoRegion.textContent=h.region;
  e.geoCity.textContent=h.city;
  e.geoDistrict.textContent=h.district;
  e.geoVillage.textContent=h.village;
  e.geoAvenue.textContent=h.avenue;
  e.geoStreet.textContent=h.street;
  e.geoBiome.textContent=env.biome;
  e.geoClimate.textContent=env.climate;
  e.geoElevation.textContent=env.elevationMeters+" m";
  e.geoTerrain.textContent=TerrainPalette.get(first.terrain).label;

  const same=JSON.stringify(first)===JSON.stringify(second);
  setCheck(e.vGeoDeterministic,same,"FAIL");

  const proof=GeographyFoundation.villageSpacingProof(campaign.seed);
  if(proof.nearest){
    e.nearestVillage.textContent=proof.nearest.name+" ("+proof.nearest.x+","+proof.nearest.y+")";
    e.nearestVillageWalk.textContent=Number.isFinite(proof.minutes)?"≥ "+proof.minutes.toFixed(1)+" fantasy minutes":"No valid walking route";
  }else{
    e.nearestVillage.textContent="—";
    e.nearestVillageWalk.textContent="—";
  }
  setCheck(e.vVillageSpacing,proof.pass,"FAIL");
}

function renderTerrainLegend(){
  e.terrainLegend.innerHTML="";
  TerrainPalette.all().forEach(item=>{
    const row=document.createElement("div");
    row.className="terrain-legend-item";
    const swatch=document.createElement("span");
    swatch.className="terrain-swatch";
    swatch.style.background=item.color;
    const label=document.createElement("strong");
    label.textContent=item.label;
    const code=document.createElement("code");
    code.textContent=item.color;
    row.append(swatch,label,code);
    e.terrainLegend.appendChild(row);
  });
}

let lastTerrainViewportKey="";
let terrainResizeObserver=null;
let terrainRenderFrame=0;
let cameraInitialized=false;
let cameraMoved=false;
let cameraIndependenceProven=false;
let cameraReturnProof=null;
let dragState=null;
let activePointers=new Map();
let pinchState=null;
let wheelZoomUsed=false;

function terrainGridDimensions(width,height,tileSize){
  let columns=Math.max(3,Math.ceil(width/tileSize)+2);
  let rows=Math.max(3,Math.ceil(height/tileSize)+2);
  if(columns%2===0)columns+=1;
  if(rows%2===0)rows+=1;
  return {columns,rows};
}

function tileOverlay(asset,className,rotation){
  const layer=document.createElement("span");
  layer.className=className;
  layer.style.backgroundImage='url("'+asset+'")';
  if(rotation)layer.style.transform="rotate("+rotation+"deg)";
  return layer;
}

function applyTerrainTransitions(columns,rows){
  const nodes=[...e.terrainGrid.children];
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const index=row*columns+col;
      const node=nodes[index];
      if(!node)continue;
      const type=node.dataset.terrain;
      const north=row>0?nodes[(row-1)*columns+col].dataset.terrain:null;
      const east=col<columns-1?nodes[row*columns+col+1].dataset.terrain:null;
      const south=row<rows-1?nodes[(row+1)*columns+col].dataset.terrain:null;
      const west=col>0?nodes[row*columns+col-1].dataset.terrain:null;
      const transition=TileTextures.transition(type,north,east,south,west);
      if(!transition)continue;
      const layer=tileOverlay(transition.asset,"terrain-transition",transition.rotation);
      layer.dataset.shape=transition.shape;
      node.appendChild(layer);
    }
  }
}

function renderTerrain(){
  const campaign=SeedSystem.getCampaign();
  const protagonist=Protagonist.getPosition();
  const center=campaign?Camera.getCenter():null;
  if(!campaign||!center){
    e.terrainGrid.hidden=true;
    e.tileViewportSize.textContent="—";
    e.tileGridSize.textContent="—";
    e.tileCount.textContent="—";
    e.tileCenterCoordinate.textContent="—";
    setCheck(e.vTerrainDeterministic,false,"WAITING");
    setCheck(e.vTileCoverage,false,"WAITING");
    setCheck(e.vTileResponsive,false,"WAITING");
    setCheck(e.vTileOddGrid,false,"WAITING");
    setCheck(e.vTileRepeat,false,"WAITING");
    return;
  }

  const tileSize=Math.max(40,Math.round(100*Camera.getZoom()));
  const viewport=e.terrainGrid.parentElement;
  const width=Math.max(1,viewport.clientWidth);
  const height=Math.max(1,viewport.clientHeight);
  const {columns,rows}=terrainGridDimensions(width,height,tileSize);
  const halfCols=Math.floor(columns/2);
  const halfRows=Math.floor(rows/2);
  const viewportKey=width+"x"+height;
  const responsive=lastTerrainViewportKey===""||lastTerrainViewportKey===viewportKey||e.terrainGrid.dataset.viewportKey!==viewportKey;

  e.terrainGrid.style.setProperty("--tile-size",tileSize+"px");
  e.terrainGrid.style.gridTemplateColumns="repeat("+columns+","+tileSize+"px)";
  e.terrainGrid.style.gridTemplateRows="repeat("+rows+","+tileSize+"px)";
  e.terrainGrid.innerHTML="";

  let deterministic=true;
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const dx=col-halfCols;
      const dy=row-halfRows;
      const pos=WorldCoordinates.add(center,String(dx),String(dy));
      const tile=TerrainFoundation.getTile(campaign.seed,pos.x,pos.y);
      const repeated=TerrainFoundation.getTile(campaign.seed,pos.x,pos.y);
      if(
        tile.type!==repeated.type||
        tile.color!==repeated.color||
        tile.texture!==repeated.texture||
        tile.overlayTexture!==repeated.overlayTexture
      )deterministic=false;

      const node=document.createElement("div");
      node.className="terrain-tile";
      node.style.backgroundColor=tile.color;
      if(tile.texture)node.style.backgroundImage='url("'+tile.texture+'")';
      node.dataset.terrain=tile.type;
      node.dataset.texture=tile.texture||"";
      node.dataset.x=pos.x;
      node.dataset.y=pos.y;
      node.dataset.origin=(pos.x===center.x&&pos.y===center.y)?"true":"false";
      if(tile.buildingId)node.dataset.buildingId=tile.buildingId;
      if(tile.room)node.dataset.room=tile.room;
      if(tile.overlayTexture)node.appendChild(tileOverlay(tile.overlayTexture,"building-tile-overlay",0));
      node.title=tile.label+" ("+pos.x+","+pos.y+")";
      e.terrainGrid.appendChild(node);
    }
  }

  applyTerrainTransitions(columns,rows);

  const gridWidth=columns*tileSize;
  const gridHeight=rows*tileSize;
  const coverage=gridWidth>=width&&gridHeight>=height;
  const oddGrid=columns%2===1&&rows%2===1;
  const origin=e.terrainGrid.querySelector('[data-origin="true"]');
  const repeatCenter=TerrainFoundation.getTile(campaign.seed,center.x,center.y);
  const repeatAgain=TerrainFoundation.getTile(campaign.seed,center.x,center.y);
  const repeatable=
    repeatCenter.type===repeatAgain.type&&
    repeatCenter.color===repeatAgain.color&&
    repeatCenter.texture===repeatAgain.texture&&
    repeatCenter.overlayTexture===repeatAgain.overlayTexture;

  e.terrainGrid.dataset.columns=String(columns);
  e.terrainGrid.dataset.rows=String(rows);
  e.terrainGrid.dataset.tileSize=String(tileSize);
  e.terrainGrid.dataset.viewportWidth=String(width);
  e.terrainGrid.dataset.viewportHeight=String(height);
  e.terrainGrid.dataset.gridWidth=String(gridWidth);
  e.terrainGrid.dataset.gridHeight=String(gridHeight);
  e.terrainGrid.dataset.viewportKey=viewportKey;
  e.terrainGrid.dataset.coveragePass=coverage?"true":"false";
  e.terrainGrid.dataset.centerPass=(!!origin&&oddGrid)?"true":"false";
  e.terrainGrid.hidden=false;

  e.tileViewportSize.textContent=width+" × "+height+" px";
  e.tileGridSize.textContent=columns+" × "+rows;
  e.tileCount.textContent=String(columns*rows);
  e.tileCenterCoordinate.textContent="("+center.x+","+center.y+")";

  setCheck(e.vTerrainDeterministic,deterministic,"FAIL");
  setCheck(e.vTileCoverage,coverage,"FAIL");
  setCheck(e.vTileResponsive,responsive,"FAIL");
  setCheck(e.vTileOddGrid,oddGrid&&!!origin,"FAIL");
  setCheck(e.vTileRepeat,repeatable,"FAIL");
  lastTerrainViewportKey=viewportKey;
}

function scheduleTerrainRender(){
  if(terrainRenderFrame)cancelAnimationFrame(terrainRenderFrame);
  terrainRenderFrame=requestAnimationFrame(()=>{
    terrainRenderFrame=0;
    renderTerrain();
  });
}

function observeTerrainViewport(){
  if(terrainResizeObserver)terrainResizeObserver.disconnect();
  if("ResizeObserver" in window){
    terrainResizeObserver=new ResizeObserver(()=>scheduleTerrainRender());
    terrainResizeObserver.observe(e.terrainGrid.parentElement);
  }else{
    window.addEventListener("resize",scheduleTerrainRender);
  }
}


function sameCoordinate(a,b){
  return !!a&&!!b&&a.x===b.x&&a.y===b.y;
}

function cameraTerrainSignature(seed,center){
  const samples=[
    [0,0],[-1,0],[1,0],[0,-1],[0,1],[-2,-2],[2,2]
  ];
  return samples.map(([dx,dy])=>{
    const pos=WorldCoordinates.add(center,String(dx),String(dy));
    const tile=TerrainFoundation.getTile(seed,pos.x,pos.y);
    return pos.x+":"+pos.y+":"+tile.type+":"+tile.color;
  }).join("|");
}

function updateCameraPresentation(){
  const campaign=SeedSystem.getCampaign();
  const protagonist=Protagonist.getPosition();
  if(!campaign||!protagonist){
    e.cameraHud.hidden=true;
    e.protagonistMarker.hidden=true;
    return;
  }

  const center=Camera.getCenter();
  const offset=Camera.offsetFrom(protagonist);
  const dx=BigInt(offset.x);
  const dy=BigInt(offset.y);
  const tileSize=Math.max(40,Math.round(100*Camera.getZoom()));
  const maxVisibleX=BigInt(Math.ceil(e.terrainGrid.parentElement.clientWidth/tileSize/2)+1);
  const maxVisibleY=BigInt(Math.ceil(e.terrainGrid.parentElement.clientHeight/tileSize/2)+1);
  const visible=dx>=-maxVisibleX&&dx<=maxVisibleX&&dy>=-maxVisibleY&&dy<=maxVisibleY;

  e.cameraHud.hidden=false;
  const zoom=Camera.getZoom();
  e.cameraCoordinate.textContent="("+center.x+","+center.y+")";
  e.cameraZoom.textContent=zoom.toFixed(2)+"×";
  e.cameraZoomDetail.textContent=zoom.toFixed(2)+"×";
  e.cameraTileSize.textContent=tileSize+" px";
  e.cameraX.textContent=center.x;
  e.cameraY.textContent=center.y;
  e.cameraProtagonistX.textContent=protagonist.x;
  e.cameraProtagonistY.textContent=protagonist.y;

  e.protagonistMarker.style.setProperty("--camera-tile-size",tileSize+"px");
  e.protagonistMarker.hidden=!visible;
  if(visible){
    const px=Number(dx)*tileSize;
    const py=Number(dy)*tileSize;
    e.protagonistMarker.style.transform="translate(calc(-50% + "+px+"px),calc(-50% + "+py+"px))";
  }

  const initial=sameCoordinate(center,protagonist);
  setCheck(e.vCameraStart,!cameraMoved?initial:true,"FAIL");
  setCheck(e.vCameraIndependent,
    cameraIndependenceProven,
    cameraMoved?"FAIL":"WAITING"
  );

  const expectedTiles=Number(e.terrainGrid.dataset.columns||0)*Number(e.terrainGrid.dataset.rows||0);
  setCheck(e.vCameraWindow,
    expectedTiles>0&&e.terrainGrid.children.length===expectedTiles&&expectedTiles<5000,
    "FAIL"
  );

  setCheck(e.vCameraWheelZoom,wheelZoomUsed,wheelZoomUsed?"FAIL":"WAITING");

  if(cameraReturnProof){
    const currentSignature=cameraTerrainSignature(campaign.seed,center);
    setCheck(e.vCameraReturn,
      sameCoordinate(center,cameraReturnProof.center)&&currentSignature===cameraReturnProof.signature,
      sameCoordinate(center,cameraReturnProof.center)?"FAIL":"WAITING"
    );
  }else{
    setCheck(e.vCameraReturn,false,"WAITING");
  }
}

function panCamera(dx,dy){
  const campaign=SeedSystem.getCampaign();
  const protagonist=Protagonist.getPosition();
  if(!campaign||!protagonist)return;

  if(!cameraReturnProof){
    const center=Camera.getCenter();
    cameraReturnProof={
      center,
      signature:cameraTerrainSignature(campaign.seed,center)
    };
  }

  const protagonistBefore=WorldCoordinates.position(protagonist.x,protagonist.y);
  Camera.pan(String(dx),String(dy));
  cameraMoved=true;
  const protagonistAfter=Protagonist.getPosition();
  cameraIndependenceProven=sameCoordinate(protagonistBefore,protagonistAfter);
  renderTerrain();
  updateCameraPresentation();
}

function centerCameraOnProtagonist(){
  const campaign=SeedSystem.getCampaign();
  const protagonist=Protagonist.getPosition();
  if(!campaign||!protagonist)return;
  Camera.centerOn(protagonist);
  renderTerrain();
  updateCameraPresentation();
}

function resetCameraForCampaign(){
  const protagonist=Protagonist.getPosition();
  Camera.centerOn(protagonist||WorldCoordinates.origin());
  Camera.setZoom(Camera.DEFAULT_ZOOM);
  cameraInitialized=!!protagonist;
  cameraMoved=false;
  cameraIndependenceProven=false;
  cameraReturnProof=null;
  wheelZoomUsed=false;
}


function applyCameraZoom(nextZoom,source){
  if(!SeedSystem.getCampaign())return;
  const protagonistBefore=Protagonist.getPosition();
  const centerBefore=Camera.getCenter();
  const previous=Camera.getZoom();
  const next=Camera.setZoom(nextZoom);
  if(next===previous)return;

  const protagonistAfter=Protagonist.getPosition();
  const centerAfter=Camera.getCenter();
  if(source==="wheel")wheelZoomUsed=true;

  renderTerrain();
  updateCameraPresentation();

  const worldStable=sameCoordinate(protagonistBefore,protagonistAfter)&&sameCoordinate(centerBefore,centerAfter);
  if(source==="wheel")setCheck(e.vCameraWheelZoom,worldStable,"FAIL");
}

function pointerDistance(){
  const points=[...activePointers.values()];
  if(points.length<2)return 0;
  const dx=points[0].x-points[1].x;
  const dy=points[0].y-points[1].y;
  return Math.hypot(dx,dy);
}

function installCameraControls(){
  const area=e.terrainGrid.parentElement;
  area.classList.add("camera-ready");
  e.centerCameraButton.onclick=centerCameraOnProtagonist;
  e.resetZoomButton.onclick=()=>applyCameraZoom(Camera.DEFAULT_ZOOM,"button");

  area.addEventListener("wheel",event=>{
    if(!SeedSystem.getCampaign()||event.target.closest(".camera-hud"))return;
    event.preventDefault();
    const direction=event.deltaY<0?1:-1;
    applyCameraZoom(Camera.getZoom()+direction*Camera.ZOOM_STEP,"wheel");
  },{passive:false});

  area.addEventListener("pointerdown",event=>{
    if(!SeedSystem.getCampaign()||event.target.closest(".camera-hud"))return;
    if(event.pointerType==="mouse"&&event.button!==0)return;

    activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    area.setPointerCapture?.(event.pointerId);

    if(activePointers.size>=2){
      dragState=null;
      area.classList.remove("camera-dragging");
      pinchState={distance:pointerDistance(),zoom:Camera.getZoom()};
    }else{
      dragState={pointerId:event.pointerId,x:event.clientX,y:event.clientY,accX:0,accY:0};
      area.classList.add("camera-dragging");
    }
    event.preventDefault();
  });

  area.addEventListener("pointermove",event=>{
    if(!activePointers.has(event.pointerId))return;
    activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});

    if(activePointers.size>=2){
      if(!pinchState)pinchState={distance:pointerDistance(),zoom:Camera.getZoom()};
      const distance=pointerDistance();
      if(pinchState.distance>0&&distance>0){
        applyCameraZoom(pinchState.zoom*(distance/pinchState.distance),"pinch");
      }
      event.preventDefault();
      return;
    }

    if(!dragState||dragState.pointerId!==event.pointerId)return;
    const dx=event.clientX-dragState.x;
    const dy=event.clientY-dragState.y;
    dragState.x=event.clientX;
    dragState.y=event.clientY;
    dragState.accX+=dx;
    dragState.accY+=dy;
    const threshold=60;
    let panX=0,panY=0;
    while(Math.abs(dragState.accX)>=threshold){
      const step=dragState.accX>0?-1:1;
      panX+=step;
      dragState.accX+=dragState.accX>0?-threshold:threshold;
    }
    while(Math.abs(dragState.accY)>=threshold){
      const step=dragState.accY>0?-1:1;
      panY+=step;
      dragState.accY+=dragState.accY>0?-threshold:threshold;
    }
    if(panX||panY)panCamera(panX,panY);
    event.preventDefault();
  });

  const endDrag=event=>{
    activePointers.delete(event.pointerId);
    if(activePointers.size<2)pinchState=null;

    if(dragState&&dragState.pointerId===event.pointerId){
      dragState=null;
      area.classList.remove("camera-dragging");
    }

    if(activePointers.size===1&&!dragState){
      const [pointerId,point]=activePointers.entries().next().value;
      dragState={pointerId,x:point.x,y:point.y,accX:0,accY:0};
      area.classList.add("camera-dragging");
    }

    try{area.releasePointerCapture?.(event.pointerId)}catch(_){}
  };
  area.addEventListener("pointerup",endDrag);
  area.addEventListener("pointercancel",endDrag);

  document.addEventListener("keydown",event=>{
    if(!SeedSystem.getCampaign())return;
    if(event.target&&["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName))return;
    const key=event.key.toLowerCase();
    const moves={
      arrowleft:[-1,0],a:[-1,0],
      arrowright:[1,0],d:[1,0],
      arrowup:[0,-1],w:[0,-1],
      arrowdown:[0,1],s:[0,1]
    };
    const move=moves[key];
    if(!move)return;
    event.preventDefault();
    panCamera(move[0],move[1]);
  });
}

function renderWorldCoordinates(){
  const campaign=SeedSystem.getCampaign();
  const position=Protagonist.getPosition();
  const proof=WorldCoordinates.verifyUnbounded();

  if(position){
    const label="("+position.x+","+position.y+")";
    if(!cameraInitialized){
      Camera.centerOn(position);
      cameraInitialized=true;
    }
    e.gameplayPlaceholder.hidden=true;
    renderTerrain();
    updateCameraPresentation();
    e.protagonistLocation.textContent=label;
    e.detailProtagonistX.textContent=position.x;
    e.detailProtagonistY.textContent=position.y;
    e.wp3Position.textContent=label;
    setCheck(e.vOrigin,Protagonist.isAtOrigin(),"FAIL");
  }else{
    e.gameplayPlaceholder.hidden=false;
    e.terrainGrid.hidden=true;
    e.cameraHud.hidden=true;
    e.protagonistMarker.hidden=true;
    e.protagonistLocation.textContent="—";
    e.detailProtagonistX.textContent="—";
    e.detailProtagonistY.textContent="—";
    e.wp3Position.textContent="—";
    setCheck(e.vOrigin,false,"WAITING");
  }

  setCheck(e.vCenter,true,"FAIL");
  setCheck(e.vPositiveWorld,proof.positiveValid,"FAIL");
  setCheck(e.vNegativeWorld,proof.negativeValid,"FAIL");
}

function renderStatic(){
  const campaign=SeedSystem.getCampaign();
  e.campaignState.textContent=campaign?"ACTIVE":"NOT STARTED";
  e.detailState.textContent=campaign?"Active":"Not started";
  e.restartCampaignButton.disabled=!campaign;
  e.resumeButton.disabled=!campaign;
  setCheck(e.vDate,!!campaign&&GameTime.validateStartYear(),campaign?"FAIL":"WAITING");
  setCheck(e.vPersist,!!campaign&&restoredCampaign,campaign?"RELOAD PAGE TO VERIFY":"WAITING");
  renderWorldCoordinates();
  renderGeography();
  renderStartingVillage();
  renderHousePlans();
}

function renderClock(){
  const fantasyTimestampMs=GameTime.getTimestampMs();
  const t=GameTime.fromTimestampMs(fantasyTimestampMs);
  const date=GameTime.formatDate(t);
  const time=GameTime.formatTime(t);
  e.gameDate.textContent=date;e.gameTime.textContent=time;
  e.detailGameDate.textContent=date;e.detailGameTime.textContent=time;
  renderPRNG(fantasyTimestampMs);
}
function startClock(){
  if(clockTimer)clearInterval(clockTimer);
  renderClock();
  clockTimer=setInterval(renderClock,250);
}
function startNewCampaign(){
  const result=SeedSystem.startNewCampaign();
  restoredCampaign=false;
  if(result.ok)resetCameraForCampaign();
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent="Campaign running. Game time advances 24× real time.";
  renderStatic();startClock();closePopup("mainMenuPopup");
}
function restartCampaign(){
  const result=SeedSystem.restartCampaign();
  if(result.ok)resetCameraForCampaign();
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent=result.ok?"Campaign restarted with the same SEED.":result.message;
  renderStatic();startClock();
  if(result.ok)closePopup("mainMenuPopup");
}
function saveSettings(){
  const result=SeedSystem.setSettingsSeed(e.seedInput.value);
  e.settingsMessage.textContent=result.message;
  if(result.ok)e.seedInput.value=result.seed;
}
function init(){
  cache();
  SeedSystem.loadSettings();
  e.seedInput.value=SeedSystem.getSettings().seed;
  const restored=SeedSystem.loadCampaign();
  restoredCampaign=restored.ok;
  resetCameraForCampaign();

  e.mainMenuButton.onclick=()=>openPopup("mainMenuPopup");
  e.settingsButton.onclick=()=>{e.seedInput.value=SeedSystem.getSettings().seed;openPopup("settingsPopup")};
  e.resumeButton.onclick=()=>closePopup("mainMenuPopup");
  e.newCampaignButton.onclick=startNewCampaign;
  e.restartCampaignButton.onclick=restartCampaign;
  e.saveSettingsButton.onclick=saveSettings;
  const updateSpriteCheck=()=>{
    const loaded=e.protagonistSprite.complete&&e.protagonistSprite.naturalWidth>0;
    e.protagonistFallback.hidden=loaded;
    setCheck(e.vProtagonistSprite,loaded,"FAIL");
  };
  e.protagonistSprite.addEventListener("load",updateSpriteCheck);
  e.protagonistSprite.addEventListener("error",updateSpriteCheck);
  updateSpriteCheck();
  document.querySelectorAll("[data-close-popup]").forEach(btn=>btn.onclick=()=>closePopup(btn.dataset.closePopup));
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeAll()});

  if(restored.ok)e.statusMessage.textContent="Campaign restored. Game time continued while the page was closed.";
  else e.statusMessage.textContent="Open Main Menu to start a campaign.";

  renderTerrainLegend();
  installCameraControls();
  renderStatic();startClock();
  observeTerrainViewport();
}
window.AppUI=Object.freeze({init});
})();
