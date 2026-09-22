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
  "rendererBackend","rendererCanvasCount","rendererTextureCount","rendererSourceMode",
  "rendererPreparedRegion","rendererVisibleRegion",
  "vRendererWebGL","vRendererCanvas","vRendererNoDomTiles","vRendererLogicalTextures","vRendererSvgCache","vRendererSimulation",
  "interiorBuildingCount","interiorHouseCount","interiorSpecialCount","interiorLevel","interiorHouseProof","interiorSpecialProof",
  "vInteriorDeterministic","vInteriorCoverage","vInteriorCollision","vInteriorForward","vInteriorReverse","vInteriorLevel",
  "buildingLayerCount","buildingRoofCount","buildingObjectCount","buildingProofState",
  "vBuildingLayers","vBuildingObjects","vBuildingWallDepth","vBuildingRoofCutaway","vBuildingDepthSort","vBuildingSimulation",
  "cameraHud","cameraCoordinate","cameraZoom","centerCameraButton","resetZoomButton","cameraX","cameraY","cameraProtagonistX","cameraProtagonistY","cameraZoomDetail","cameraTileSize",
  "vCameraStart","vCameraIndependent","vCameraWindow","vCameraReturn","vCameraWheelZoom","vCameraPinchZoom",
  "villageWorldScale","startingVillageName","villageGateway","villageCoreDiameter","villagePlotCount","villageMainlandEdge","villageBridgeMax","villageSpacingStandard",
  "vVillageCore","vVillageMainland","vVillageBridge","vVillagePlan","vVillageRepeat",
  "houseBuildingCount","houseTypeCount","houseMinRoomTiles","houseSvgCount",
  "blendVariantMode","blendJunctionMode","vBlendVariantDeterministic","vBlendVariantAB","vBlendDiagonal","vBlendJunctionPriority",
  "vHousePlan","vHouseRooms","vHouseWalls","vHouseEntrances","vHouseSvg","vHouseTransitions",
  "specialLotCount","specialEnterableCount","specialOutdoorCount","specialLotKinds",
  "vSpecialDeterministic","vSpecialCoverage","vSpecialEntrances","vSpecialOverlap",
  "walkSampleCount","walkClassCount","walkBlockedCount","walkWaterSamples",
  "vWalkDeterministic","vWalkCoverage","vWalkWalls","vWalkWater","vWalkEntrances","vWalkRoutes",
  "routeDestination","routeStepCount","routeTravelTime","routeEvaluatedCount","routePathPreview",
  "vRouteFound","vRouteDeterministic","vRouteBlocked","vRouteWalkability","vRouteEntrance","vRouteLocal",
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
    ["houseBuildingCount","houseTypeCount","houseMinRoomTiles","houseSvgCount","blendVariantMode","blendJunctionMode"].forEach(id=>e[id].textContent="—");
    ["vHousePlan","vHouseRooms","vHouseWalls","vHouseEntrances","vHouseSvg","vHouseTransitions","vBlendVariantDeterministic","vBlendVariantAB","vBlendDiagonal","vBlendJunctionPriority"].forEach(id=>setCheck(e[id],false,"WAITING"));
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
  const edge=TileTextures.blendSpecs("grass",{n:"water",e:"grass",s:"grass",w:"grass"});
  const corner=TileTextures.blendSpecs("grass",{n:"water",e:"water",s:"grass",w:"grass"});
  const peninsula=TileTextures.blendSpecs("grass",{n:"water",e:"water",s:"water",w:"grass"});
  const variantNeighbors={n:"water",e:"grass",s:"grass",w:"grass"};
  const stableA=TileTextures.blendSpecs("grass",variantNeighbors,{seed:campaign.seed,x:"17",y:"23"});
  const stableB=TileTextures.blendSpecs("grass",variantNeighbors,{seed:campaign.seed,x:"17",y:"23"});
  const diagonal=TileTextures.blendSpecs("grass",{
    n:"grass",e:"grass",s:"grass",w:"grass",
    ne:"water",se:"grass",sw:"grass",nw:"grass"
  },{seed:campaign.seed,x:"31",y:"41"});
  const cardinalOwnsCorner=TileTextures.blendSpecs("grass",{
    n:"water",e:"grass",s:"grass",w:"grass",
    ne:"water",se:"grass",sw:"grass",nw:"grass"
  },{seed:campaign.seed,x:"31",y:"41"});
  const highPriorityJunction=TileTextures.blendSpecs("grass",{
    n:"dirt",e:"forest",s:"grass",w:"grass",
    ne:"water",se:"grass",sw:"grass",nw:"grass"
  },{seed:campaign.seed,x:"32",y:"41"});
  const lowPriorityJunction=TileTextures.blendSpecs("grass",{
    n:"water",e:"dirt",s:"grass",w:"grass",
    ne:"forest",se:"grass",sw:"grass",nw:"grass"
  },{seed:campaign.seed,x:"33",y:"41"});
  const observedVariants=new Set();
  for(let y=0;y<12;y++){
    for(let x=0;x<12;x++){
      const sample=TileTextures.blendSpecs("grass",variantNeighbors,{seed:campaign.seed,x:String(x),y:String(y)});
      if(sample[0]?.variant)observedVariants.add(sample[0].variant);
    }
  }

  e.houseBuildingCount.textContent=String(proof.buildingCount);
  e.houseTypeCount.textContent=proof.normalHouseCount+" houses / "+proof.cabinCount+" cabins";
  e.houseMinRoomTiles.textContent=proof.minimumRoomTiles+" tiles / "+(proof.minimumRoomTiles*WorldStandards.TILE_METERS*WorldStandards.TILE_METERS)+" m²";
  e.houseSvgCount.textContent="63 vector SVG files";
  e.blendVariantMode.textContent=[...observedVariants].sort().join(" / ").toUpperCase()+" deterministic";
  e.blendJunctionMode.textContent="8-neighbor + priority";

  setCheck(e.vHousePlan,proof.pass&&proof.deterministic,"FAIL");
  setCheck(e.vHouseRooms,proof.roomsPass&&proof.minimumRoomTiles>=6,"FAIL");
  setCheck(e.vHouseWalls,proof.outerWallsPass&&proof.interiorWallsPass,"FAIL");
  setCheck(e.vHouseEntrances,proof.entrancesPass,"FAIL");
  setCheck(e.vHouseSvg,svgAssets.every(path=>typeof path==="string"&&path.endsWith(".svg")),"FAIL");
  setCheck(
    e.vHouseTransitions,
    edge.some(spec=>spec.shape==="edge")&&
    corner.some(spec=>spec.shape==="corner")&&
    peninsula.some(spec=>spec.shape==="peninsula"),
    "FAIL"
  );
  setCheck(
    e.vBlendVariantDeterministic,
    JSON.stringify(stableA)===JSON.stringify(stableB),
    "FAIL"
  );
  setCheck(
    e.vBlendVariantAB,
    observedVariants.has("a")&&observedVariants.has("b"),
    "FAIL"
  );
  setCheck(
    e.vBlendDiagonal,
    diagonal.some(spec=>spec.shape==="diagonal"&&spec.orientation==="ne"&&spec.terrain==="water")&&
    !cardinalOwnsCorner.some(spec=>spec.shape==="diagonal"&&spec.orientation==="ne"),
    "FAIL"
  );
  setCheck(
    e.vBlendJunctionPriority,
    highPriorityJunction.some(spec=>spec.shape==="diagonal"&&spec.terrain==="water")&&
    !lowPriorityJunction.some(spec=>spec.shape==="diagonal"&&spec.terrain==="forest"),
    "FAIL"
  );
}

function renderSpecialLots(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["specialLotCount","specialEnterableCount","specialOutdoorCount","specialLotKinds"].forEach(id=>e[id].textContent="—");
    ["vSpecialDeterministic","vSpecialCoverage","vSpecialEntrances","vSpecialOverlap"].forEach(id=>setCheck(e[id],false,"WAITING"));
    return;
  }

  const proof=SpecialLots.proof(campaign.seed);
  e.specialLotCount.textContent=String(proof.lotCount);
  e.specialEnterableCount.textContent=String(proof.enterableCount);
  e.specialOutdoorCount.textContent=String(proof.outdoorCount);
  e.specialLotKinds.textContent=proof.kinds.join(", ");

  setCheck(e.vSpecialDeterministic,proof.deterministic,"FAIL");
  setCheck(
    e.vSpecialCoverage,
    proof.lotCount===7&&proof.typeCoveragePass&&proof.enterableCount===6&&proof.outdoorCount===1,
    "FAIL"
  );
  setCheck(e.vSpecialEntrances,proof.entrancesPass,"FAIL");
  setCheck(e.vSpecialOverlap,proof.overlapPass,"FAIL");
}

function renderWalkability(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["walkSampleCount","walkClassCount","walkBlockedCount","walkWaterSamples"].forEach(id=>e[id].textContent="—");
    ["vWalkDeterministic","vWalkCoverage","vWalkWalls","vWalkWater","vWalkEntrances","vWalkRoutes"].forEach(id=>setCheck(e[id],false,"WAITING"));
    return;
  }

  const proof=Walkability.proof(campaign.seed);
  const structure=proof.structure;
  e.walkSampleCount.textContent=String(proof.sampleCount);
  e.walkClassCount.textContent=String(proof.categories.length);
  e.walkBlockedCount.textContent=String(proof.blockedCount);
  e.walkWaterSamples.textContent=String(proof.waterSamples);

  setCheck(e.vWalkDeterministic,proof.deterministic,"FAIL");
  setCheck(e.vWalkCoverage,proof.classificationCoverage,"FAIL");
  setCheck(
    e.vWalkWalls,
    structure.outerWallsPass&&structure.interiorWallsPass,
    "FAIL"
  );
  setCheck(
    e.vWalkWater,
    proof.waterRulePass&&(proof.waterSamples===0||proof.waterBlocked===proof.waterSamples),
    "FAIL"
  );
  setCheck(
    e.vWalkEntrances,
    structure.exteriorDoorsPass&&
    structure.interiorDoorsPass&&
    structure.interiorsPass&&
    structure.workyardPass&&
    structure.accessTargetsPass,
    "FAIL"
  );
  setCheck(e.vWalkRoutes,proof.routeRulesPass&&proof.difficultRulesPass,"FAIL");
}

function renderRoutePlanning(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["routeDestination","routeStepCount","routeTravelTime","routeEvaluatedCount","routePathPreview"].forEach(id=>e[id].textContent="—");
    ["vRouteFound","vRouteDeterministic","vRouteBlocked","vRouteWalkability","vRouteEntrance","vRouteLocal"].forEach(id=>setCheck(e[id],false,"WAITING"));
    return;
  }

  const proof=RoutePlanner.proof(campaign.seed);
  if(!proof.route){
    e.routeDestination.textContent="Unavailable";
    e.routeStepCount.textContent="—";
    e.routeTravelTime.textContent="—";
    e.routeEvaluatedCount.textContent="—";
    e.routePathPreview.textContent="—";
    ["vRouteFound","vRouteDeterministic","vRouteBlocked","vRouteWalkability","vRouteEntrance","vRouteLocal"].forEach(id=>setCheck(e[id],false,"FAIL"));
    return;
  }

  e.routeDestination.textContent=proof.destinationLabel+" ("+proof.destination.x+","+proof.destination.y+")";
  e.routeStepCount.textContent=String(proof.stepCount);
  e.routeTravelTime.textContent=Number.isFinite(proof.totalSeconds)?proof.totalSeconds.toFixed(1)+" s":"—";
  e.routeEvaluatedCount.textContent=String(proof.evaluatedCount);
  e.routePathPreview.textContent=proof.routePreview;

  setCheck(e.vRouteFound,proof.route.found&&proof.destinationInterior,"FAIL");
  setCheck(e.vRouteDeterministic,proof.deterministic,"FAIL");
  setCheck(e.vRouteBlocked,proof.blockedDestinationRejected,"FAIL");
  setCheck(e.vRouteWalkability,proof.obeysWalkability&&proof.movementCostPass,"FAIL");
  setCheck(e.vRouteEntrance,proof.usesExteriorEntrance,"FAIL");
  setCheck(e.vRouteLocal,proof.localEvaluationPass,"FAIL");
}

function formatInteriorRepresentative(item){
  if(!item)return "—";
  const door=item.entrance?.door;
  const inside=item.interiorTarget;
  const roomText=(item.rooms||[]).map(room=>room.label+" "+room.plannedAreaM2+"m²").join(", ");
  return item.label+
    " · door ("+(door?.x||"?")+","+(door?.y||"?")+")"+
    " · target ("+(inside?.x||"?")+","+(inside?.y||"?")+")"+
    " · "+roomText+
    " · out→in "+item.forwardSteps+" steps / in→out "+item.reverseSteps+" steps";
}

function renderBuildingInteriors(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    ["interiorBuildingCount","interiorHouseCount","interiorSpecialCount","interiorLevel","interiorHouseProof","interiorSpecialProof"]
      .forEach(id=>e[id].textContent="—");
    ["vInteriorDeterministic","vInteriorCoverage","vInteriorCollision","vInteriorForward","vInteriorReverse","vInteriorLevel"]
      .forEach(id=>setCheck(e[id],false,"WAITING"));
    return;
  }

  const proof=BuildingInteriors.proof(campaign.seed);
  e.interiorBuildingCount.textContent=String(proof.buildingCount);
  e.interiorHouseCount.textContent=String(proof.houseCount);
  e.interiorSpecialCount.textContent=String(proof.specialBuildingCount);
  e.interiorLevel.textContent="level = "+String(proof.level);
  e.interiorHouseProof.textContent=formatInteriorRepresentative(proof.representativeHouse);
  e.interiorSpecialProof.textContent=formatInteriorRepresentative(proof.representativeSpecial);

  setCheck(e.vInteriorDeterministic,proof.deterministic,"FAIL");
  setCheck(
    e.vInteriorCoverage,
    proof.buildingCount===12&&proof.houseCount===6&&proof.specialBuildingCount===6&&proof.allConnected,
    "FAIL"
  );
  setCheck(
    e.vInteriorCollision,
    proof.allWallsBlocked&&proof.allFloorsDoorsWalkable,
    "FAIL"
  );
  setCheck(e.vInteriorForward,proof.allForward,"FAIL");
  setCheck(e.vInteriorReverse,proof.allReverse,"FAIL");
  setCheck(e.vInteriorLevel,proof.allLevelZero&&proof.level===0,"FAIL");
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
let terrainRenderSerial=0;

function terrainGridDimensions(width,height,tileSize){
  let columns=Math.max(3,Math.ceil(width/tileSize)+2);
  let rows=Math.max(3,Math.ceil(height/tileSize)+2);
  if(columns%2===0)columns+=1;
  if(rows%2===0)rows+=1;
  return {columns,rows};
}

function terrainRegionKey(center,columns,rows,tileSize){
  return [
    "terrain",
    center.x+","+center.y,
    columns+"x"+rows,
    tileSize+"px"
  ].join(":");
}

function collectTerrainPreparationKeys(seed,center,columns,rows,halfCols,halfRows){
  const keys=new Set(["character:protagonist-male"]);
  const ringColumns=columns+2;
  const ringRows=rows+2;
  const cells=[];
  for(let row=-1;row<=rows;row++){
    for(let col=-1;col<=columns;col++){
      const dx=col-halfCols;
      const dy=row-halfRows;
      const pos=WorldCoordinates.add(center,String(dx),String(dy));
      const tile=TerrainFoundation.getTile(seed,pos.x,pos.y);
      cells.push({
        row:row+1,
        col:col+1,
        x:pos.x,
        y:pos.y,
        type:tile.type,
        textureKey:tile.textureKey,
        overlayTextureKey:tile.overlayTextureKey
      });
    }
  }
  const cellAt=(row,col)=> (row<0||row>=ringRows||col<0||col>=ringColumns)?null:cells[row*ringColumns+col];
  for(const cell of cells){
    if(cell.textureKey)keys.add(cell.textureKey);
    if(cell.overlayTextureKey)keys.add(cell.overlayTextureKey);
  }
  for(const cell of cells){
    const neighbors={
      n:cellAt(cell.row-1,cell.col)?.type||null,
      e:cellAt(cell.row,cell.col+1)?.type||null,
      s:cellAt(cell.row+1,cell.col)?.type||null,
      w:cellAt(cell.row,cell.col-1)?.type||null,
      ne:cellAt(cell.row-1,cell.col+1)?.type||null,
      se:cellAt(cell.row+1,cell.col+1)?.type||null,
      sw:cellAt(cell.row+1,cell.col-1)?.type||null,
      nw:cellAt(cell.row-1,cell.col-1)?.type||null
    };
    const blends=TileTextures.blendSpecs(cell.type,neighbors,{
      seed,
      x:cell.x,
      y:cell.y
    });
    for(const blend of blends){
      if(blend?.maskKey)keys.add(blend.maskKey);
    }
  }
  return [...keys];
}

async function renderTerrain(){
  const campaign=SeedSystem.getCampaign();
  const protagonist=Protagonist.getPosition();
  const center=campaign?Camera.getCenter():null;
  if(!campaign||!center){
    e.terrainGrid.hidden=true;
    GameRenderer.clear();
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
  const regionKey=terrainRegionKey(center,columns,rows,tileSize);
  const responsive=lastTerrainViewportKey===""||lastTerrainViewportKey===viewportKey||e.terrainGrid.dataset.viewportKey!==viewportKey;
  const routeProof=(renderTerrain._routeProofSeed===campaign.seed&&renderTerrain._routeProof)||RoutePlanner.proof(campaign.seed);
  renderTerrain._routeProofSeed=campaign.seed;
  renderTerrain._routeProof=routeProof;
  const routeIndex=new Map(
    routeProof.route?.path?.map((point,index)=>[point.x+","+point.y,index])||[]
  );
  const routeLastIndex=routeProof.route?.path?.length?routeProof.route.path.length-1:-1;

  const tiles=[];
  let deterministic=true;
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const dx=col-halfCols;
      const dy=row-halfRows;
      const pos=WorldCoordinates.add(center,String(dx),String(dy));
      const tile=TerrainFoundation.getTile(campaign.seed,pos.x,pos.y);
      const movement=Walkability.classify(campaign.seed,pos.x,pos.y);
      const routeStep=routeIndex.get(pos.x+","+pos.y);
      tiles.push({
        row,col,
        x:pos.x,
        y:pos.y,
        type:tile.type,
        color:tile.color,
        textureKey:tile.textureKey,
        overlayTextureKey:tile.overlayTextureKey,
        buildingId:tile.buildingId,
        room:tile.room,
        specialKind:tile.specialKind,
        movement,
        routeStep:routeStep===undefined?null:routeStep,
        blends:[]
      });
    }
  }

  const tileAt=(row,col)=>(row<0||row>=rows||col<0||col>=columns)?null:tiles[row*columns+col];
  for(const item of tiles){
    const row=item.row,col=item.col;
    const neighbors={
      n:tileAt(row-1,col)?.type||null,
      e:tileAt(row,col+1)?.type||null,
      s:tileAt(row+1,col)?.type||null,
      w:tileAt(row,col-1)?.type||null,
      ne:tileAt(row-1,col+1)?.type||null,
      se:tileAt(row+1,col+1)?.type||null,
      sw:tileAt(row+1,col-1)?.type||null,
      nw:tileAt(row-1,col-1)?.type||null
    };
    item.blends=TileTextures.blendSpecs(item.type,neighbors,{
      seed:campaign.seed,
      x:item.x,
      y:item.y
    });
  }

  const requiredKeys=collectTerrainPreparationKeys(campaign.seed,center,columns,rows,halfCols,halfRows);
  const currentSerial=++terrainRenderSerial;
  if(!TextureAssets.isRegionPrepared(regionKey,requiredKeys)){
    e.terrainGrid.hidden=true;
    const prepared=await TextureAssets.prepareRegion(regionKey,requiredKeys);
    if(currentSerial!==terrainRenderSerial||!prepared.ready||prepared.stale||!TextureAssets.isRegionPrepared(regionKey,requiredKeys)){
      return false;
    }
  }

  const buildingInteriors=BuildingInteriors.build(campaign.seed);
  const interiorObjects=window.InteriorObjects?.build?InteriorObjects.build(campaign.seed):[];
  const rendererSnapshot=GameRenderer.render({
    width,height,columns,rows,tileSize,
    center,
    seed:campaign.seed,
    regionKey,
    tiles,
    routeLastIndex,
    protagonistWorld:protagonist||null,
    protagonistOffset:protagonist?Camera.offsetFrom(protagonist):null,
    buildingInteriors,
    interiorObjects
  });

  const gridWidth=columns*tileSize;
  const gridHeight=rows*tileSize;
  const coverage=gridWidth>=width&&gridHeight>=height;
  const oddGrid=columns%2===1&&rows%2===1;
  const repeatable=true;

  e.terrainGrid.dataset.columns=String(columns);
  e.terrainGrid.dataset.rows=String(rows);
  e.terrainGrid.dataset.tileSize=String(tileSize);
  e.terrainGrid.dataset.viewportWidth=String(width);
  e.terrainGrid.dataset.viewportHeight=String(height);
  e.terrainGrid.dataset.gridWidth=String(gridWidth);
  e.terrainGrid.dataset.gridHeight=String(gridHeight);
  e.terrainGrid.dataset.viewportKey=viewportKey;
  e.terrainGrid.dataset.regionKey=regionKey;
  e.terrainGrid.dataset.coveragePass=coverage?"true":"false";
  e.terrainGrid.dataset.centerPass=(oddGrid&&rendererSnapshot.tileCount===columns*rows)?"true":"false";

  e.tileViewportSize.textContent=width+" × "+height+" px";
  e.tileGridSize.textContent=columns+" × "+rows;
  e.tileCount.textContent=String(rendererSnapshot.tileCount);
  e.tileCenterCoordinate.textContent="("+center.x+","+center.y+")";

  setCheck(e.vTerrainDeterministic,deterministic,"FAIL");
  setCheck(e.vTileCoverage,coverage,"FAIL");
  setCheck(e.vTileResponsive,responsive,"FAIL");
  setCheck(e.vTileOddGrid,oddGrid&&rendererSnapshot.tileCount===columns*rows,"FAIL");
  setCheck(e.vTileRepeat,repeatable,"FAIL");
  renderBuildingPresentationProof(rendererSnapshot);
  e.rendererVisibleRegion.textContent=regionKey;
  e.terrainGrid.hidden=false;
  lastTerrainViewportKey=viewportKey;
  return true;
}

function scheduleTerrainRender(){
  if(terrainRenderFrame)cancelAnimationFrame(terrainRenderFrame);
  terrainRenderFrame=requestAnimationFrame(()=>{
    terrainRenderFrame=0;
    void renderTerrain().catch(error=>console.error(error));
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
  const rendererTiles=GameRenderer.snapshot().tileCount||0;
  setCheck(e.vCameraWindow,
    expectedTiles>0&&rendererTiles===expectedTiles&&expectedTiles<5000,
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
  const rendererReady=GameRenderer.snapshot().ready;

  if(position){
    const label="("+position.x+","+position.y+")";
    if(!cameraInitialized){
      Camera.centerOn(position);
      cameraInitialized=true;
    }
    e.gameplayPlaceholder.hidden=true;
    if(!rendererReady){
      void renderTerrain().catch(error=>console.error(error));
    }
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

function renderBuildingPresentationProof(renderer=GameRenderer.snapshot()){
  const presentation=renderer?.buildingPresentation||{};
  const layers=Array.isArray(presentation.layerOrder)?presentation.layerOrder:[];
  const expected=[
    "ground-floor",
    "lower-structure-objects",
    "shadows",
    "characters-entities",
    "upper-walls-foreground",
    "roof-ceiling",
    "verification-route"
  ];
  e.buildingLayerCount.textContent=layers.length?layers.length+" ordered layers":"—";
  e.buildingRoofCount.textContent=String(presentation.roofCount??0);
  e.buildingObjectCount.textContent=String(presentation.visibleInteriorObjectCount??0);
  e.buildingProofState.textContent=presentation.proofState||"normal gameplay";

  setCheck(
    e.vBuildingLayers,
    expected.every((name,index)=>layers[index]===name),
    "FAIL"
  );
  setCheck(
    e.vBuildingObjects,
    typeof window.InteriorObjects?.build==="function"&&
      Number.isFinite(Number(presentation.visibleInteriorObjectCount??0)),
    "FAIL"
  );
  setCheck(
    e.vBuildingWallDepth,
    Number(presentation.visibleWallCapCount||0)>0,
    "WAITING FOR VISIBLE BUILDING"
  );
  const roofProof=presentation.proofState==="inside"||presentation.proofState==="behind"
    ?Boolean(presentation.cutawayActive)&&Number(presentation.roofAlpha)<0.5
    :Number(presentation.roofCount||0)>0;
  setCheck(e.vBuildingRoofCutaway,roofProof,"WAITING FOR VISIBLE BUILDING");
  setCheck(
    e.vBuildingDepthSort,
    Boolean(presentation.ySortedEntities)&&Number.isFinite(Number(presentation.foregroundObjectCount??0)),
    "FAIL"
  );
  setCheck(
    e.vBuildingSimulation,
    presentation.simulationAuthorityPreserved===true&&
      typeof BuildingInteriors?.build==="function"&&
      typeof Walkability?.classify==="function"&&
      typeof RoutePlanner?.findRoute==="function",
    "FAIL"
  );
}

function renderRendererProof(){
  const renderer=GameRenderer.snapshot();
  const assets=TextureAssets.stats();
  e.rendererBackend.textContent=renderer.backend||"—";
  e.rendererCanvasCount.textContent=String(renderer.canvasCount||0);
  e.rendererTextureCount.textContent=String(assets.loadedKeyCount||0)+" logical / "+String(assets.loadedSourceCount||0)+" sources";
  e.rendererSourceMode.textContent=(assets.svgSourceCount||0)+" SVG draft / "+(assets.pngSourceCount||0)+" PNG";
  e.rendererPreparedRegion.textContent=assets.preparedRegionKey||"—";
  if(!e.rendererVisibleRegion.textContent)e.rendererVisibleRegion.textContent=renderer.regionKey||"—";
  setCheck(e.vRendererWebGL,Boolean(renderer.webgl),"FAIL");
  setCheck(e.vRendererCanvas,renderer.canvasCount===1,"FAIL");
  setCheck(e.vRendererNoDomTiles,(renderer.domTerrainTileCount||0)===0,"FAIL");
  setCheck(e.vRendererLogicalTextures,Boolean(renderer.logicalTextureKeyPass)&&assets.loadedKeyCount>0,"FAIL");
  setCheck(e.vRendererSvgCache,assets.svgSourceCount>0&&assets.ready,"FAIL");
  setCheck(e.vRendererSimulation,
    typeof TerrainFoundation?.getTile==="function"&&
    typeof Walkability?.classify==="function"&&
    typeof RoutePlanner?.findRoute==="function",
    "FAIL"
  );
}

function renderAdviceLog(){
  if(typeof window.AdvisorChannel?.renderAdvicePanel !== "function") return;
  const campaign=SeedSystem.getCampaign();
  const seed=campaign ? campaign.seed : SeedSystem.getSettings().seed;
  const protagonistId=(campaign && campaign.protagonistId) || "protagonist";
  const panel=document.getElementById("advisorPanel");
  if(panel){
    window.AdvisorChannel.renderAdvicePanel(seed, protagonistId, panel);
  }
}

function renderStatic(){
  const campaign=SeedSystem.getCampaign();
  e.campaignState.textContent=campaign?"ACTIVE":"NOT STARTED";
  e.detailState.textContent=campaign?"Active":"Not started";
  e.restartCampaignButton.disabled=!campaign;
  e.resumeButton.disabled=!campaign;
  setCheck(e.vDate,!!campaign&&GameTime.validateStartYear(),campaign?"FAIL":"WAITING");
  setCheck(e.vPersist,!!campaign&&restoredCampaign,campaign?"RELOAD PAGE TO VERIFY":"WAITING");
  renderAdviceLog();
  renderWorldCoordinates();
  renderGeography();
  renderStartingVillage();
  renderHousePlans();
  renderSpecialLots();
  renderWalkability();
  renderRoutePlanning();
  renderBuildingInteriors();
  renderBuildingPresentationProof();
  renderRendererProof();
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
async function startNewCampaign(){
  const result=SeedSystem.startNewCampaign();
  restoredCampaign=false;
  if(result.ok)resetCameraForCampaign();
  e.menuMessage.textContent=result.message;
  if(result.ok){
    try{
      await renderTerrain();
    }catch(error){
      console.error(error);
      e.statusMessage.textContent="Renderer startup failed: "+String(error);
      return;
    }
  }
  e.statusMessage.textContent="Campaign running. Game time advances 24× real time.";
  renderStatic();startClock();closePopup("mainMenuPopup");
}
async function restartCampaign(){
  const result=SeedSystem.restartCampaign();
  if(result.ok)resetCameraForCampaign();
  e.menuMessage.textContent=result.message;
  if(result.ok){
    try{
      await renderTerrain();
    }catch(error){
      console.error(error);
      e.statusMessage.textContent="Renderer startup failed: "+String(error);
      return;
    }
  }
  e.statusMessage.textContent=result.ok?"Campaign restarted with the same SEED.":result.message;
  renderStatic();startClock();
  if(result.ok)closePopup("mainMenuPopup");
}
function saveSettings(){
  const result=SeedSystem.setSettingsSeed(e.seedInput.value);
  e.settingsMessage.textContent=result.message;
  if(result.ok)e.seedInput.value=result.seed;
}
async function init(){
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
  e.statusMessage.textContent="Loading GPU renderer and draft textures…";
  try{
    await GameRenderer.init(e.terrainGrid);
    await renderTerrain();
  }catch(error){
    console.error(error);
    e.statusMessage.textContent="Renderer startup failed: "+String(error);
    throw error;
  }
  renderStatic();startClock();
  observeTerrainViewport();
}
window.AppUI=Object.freeze({
  init,
  refreshBuildingPresentation:()=>renderBuildingPresentationProof(GameRenderer.snapshot())
});
})();
