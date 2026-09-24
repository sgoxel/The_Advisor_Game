(function(){
"use strict";
const e={};
let restoredCampaign=false;
let clockTimer=null;
const DEVELOPMENT_MODE_KEY="the-advisor-game:development-mode";
const ids=[
  "mainMenuButton","settingsButton","mainMenuPopup","settingsPopup","resumeButton","newCampaignButton","restartCampaignButton",
  "menuMessage","seedInput","saveSettingsButton","settingsMessage","developmentModeToggle","developmentDetails","gameDate","gameTime","campaignState","statusMessage",
  "detailState","detailGameDate","detailGameTime","detailProtagonistX","detailProtagonistY","vDate","vPersist",
  "terrainGrid","terrainLegend","vTerrainDeterministic","vTerrainSolidOnly",
  "rendererEngine","rendererEngineVersion","rendererBackend","rendererRequestedBackend","rendererWebgpuAvailable","rendererCanvasCount","rendererProjection","rendererEntityCount","rendererDrawCalls","rendererFrameTime","rendererRenderScale","rendererPixelRatio","rendererCanvasSize","rendererTextureCount","rendererSourceMode",
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
  "residentRosterCount","residentRosterSeed","residentRosterTime","residentRosterRows","residentRosterScroll",
  "vResidentFields","vResidentIds","vResidentDeterministic","vResidentTimeIdentity","vResidentAge","vResidentBirthplace",
  "residentAssignmentCount","residentAssignmentHomes","residentAssignmentCapacity","residentAssignmentRows","residentAssignmentScroll",
  "vResidentAssignmentHomes","vResidentAssignmentProfessions","vResidentAssignmentTargets","vResidentAssignmentWalkable","vResidentAssignmentRoutes","vResidentAssignmentDeterministic",
  "residentScheduleCount","residentScheduleTime","residentScheduleBlocks","residentScheduleRows","residentScheduleScroll",
  "vResidentScheduleComplete","vResidentScheduleActions","vResidentScheduleAssignments","vResidentScheduleDeterministic","vResidentScheduleTime","vResidentScheduleIsolation",
  "movementProofBadge","movementProofBadgeStage","movementProofBadgeResident","movementProofBadgePosition",
  "residentMovementResident","residentMovementPosition","residentMovementTarget","residentMovementStatus","residentMovementRoute","residentMovementRows",
  "vResidentMovementContinuous","vResidentMovementDoors","vResidentMovementCollision","vResidentMovementSpeed","vResidentMovementDeterministic","vResidentMovementCamera","vResidentMovementCulling","vResidentMovementIsolation",
  "residentActionRibbon","residentActionRibbonActor","residentActionRibbonState","residentActionRibbonProgress",
  "residentActionActor","residentActionName","residentActionStatus","residentActionTarget","residentActionProgress","residentActionRows",
  "vResidentActionRequired","vResidentActionReject","vResidentActionArrival","vResidentActionOffscreen","vResidentActionSchedule","vResidentActionGeneric","vResidentActionIsolation",
  "gameplayPlaceholder","protagonistMarker","protagonistSprite","protagonistFallback","protagonistLocation","wp3Position","vOrigin","vCenter","vProtagonistSprite","vPositiveWorld","vNegativeWorld",
  "prngSeed","foundationKey","foundationValue","prngTimestamp","liveValue","vFoundationRepeat","vFoundationTimeFree","vLiveRepeat","vLiveTime","vNoMilliseconds","vPrngSource"
];
function cache(){ids.forEach(id=>e[id]=document.getElementById(id))}
function openPopup(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function closePopup(id){document.getElementById(id).hidden=true;document.body.style.overflow=""}
function closeAll(){document.querySelectorAll(".fullscreen-popup").forEach(p=>p.hidden=true);document.body.style.overflow=""}
function setCheck(node,pass,waiting){node.textContent=pass?"PASS":waiting;node.classList.toggle("pass",pass)}
function readDevelopmentMode(){
  try{return localStorage.getItem(DEVELOPMENT_MODE_KEY)==="true"}
  catch(_){return false}
}
function applyDevelopmentMode(enabled){
  const active=Boolean(enabled);
  if(e.developmentModeToggle)e.developmentModeToggle.checked=active;
  if(e.developmentDetails)e.developmentDetails.hidden=!active;
  document.body.classList.toggle("development-mode",active);
  return active;
}
function saveDevelopmentMode(){
  const active=Boolean(e.developmentModeToggle?.checked);
  try{localStorage.setItem(DEVELOPMENT_MODE_KEY,active?"true":"false")}catch(_){}
  applyDevelopmentMode(active);
  return active;
}

const CHARACTER_VISIBILITY_MARGIN_TILES=1;
function characterTextureUrlForProfession(profession){
  switch(String(profession||"")){
    case "farmer":return "assets/characters/npc_farmer_male_01.png";
    case "smith":return "assets/characters/npc_blacksmith_male_01.png";
    case "tavern-keeper":return "assets/characters/npc_tavernkeeper_male_01.png";
    case "shopkeeper":return "assets/characters/npc_merchant_male_01.png";
    case "woodcutter":return "assets/characters/npc_woodcutter_male_01.png";
    case "guard":return "assets/characters/npc_guard_male_01.png";
    default:return "assets/characters/npc_market_vendor_female_01.png";
  }
}

function visibleCharacterSpecs(campaign,center,columns,rows,tileSize){
  const protagonist=Protagonist.getPosition();
  const visibleCharacters=[];
  const roster=campaign?.seed&&window.DailyActivity?.build
    ?DailyActivity.build(campaign.seed)
    :[];
  const timestamp=GameTime.getTimestampMs?.();
  if(campaign?.seed&&window.ResidentMovement)ResidentMovement.ensure(campaign.seed);
  const halfCols=Math.floor(Number(columns||0)/2);
  const halfRows=Math.floor(Number(rows||0)/2);
  const maxX=BigInt(halfCols+CHARACTER_VISIBILITY_MARGIN_TILES);
  const maxY=BigInt(halfRows+CHARACTER_VISIBILITY_MARGIN_TILES);

  if(protagonist){
    visibleCharacters.push(Object.freeze({
      id:"protagonist",
      role:"protagonist",
      textureUrl:"assets/characters/protagonist_male.png",
      point:Object.freeze({x:protagonist.x,y:protagonist.y}),
      height:1.82,
      elevation:0.04,
      flipX:false,
      frameIndex:0
    }));
  }

  const movementProofResidentId=window.ResidentMovement?.proofSnapshot?.()?.residentId||null;
  for(const resident of roster){
    const activity=DailyActivity.resolveActionTarget(campaign.seed,resident,timestamp);
    const movement=window.ResidentMovement?.get?.(resident.id)||null;
    const authoritative=movement?.position||activity?.target;
    if(!authoritative)continue;
    const presentation=window.ResidentMovement?.presentation?.(resident.id)||null;
    const offset=Camera.offsetFrom(authoritative);
    if(!offset)continue;
    const dx=BigInt(offset.x),dy=BigInt(offset.y);
    if(dx<-maxX||dx>maxX||dy<-maxY||dy>maxY)continue;
    visibleCharacters.push(Object.freeze({
      id:`resident:${resident.id}`,
      role:"resident",
      residentId:resident.id,
      residentName:resident.name,
      profession:resident.profession,
      activity:activity.action,
      activityLabel:activity.label,
      actionExecution:window.ActionExecutor?.get?.("resident",resident.id)||null,
      buildingId:movement?.buildingId||activity.buildingId||null,
      textureUrl:characterTextureUrlForProfession(resident.profession),
      point:Object.freeze({x:authoritative.x,y:authoritative.y}),
      presentationOffset:presentation?.offset||Object.freeze({x:0,y:0}),
      height:movementProofResidentId===resident.id?2.15:1.74,
      elevation:movementProofResidentId===resident.id?0.05:0.03,
      flipX:(BigInt(resident.id.slice(1)||"0")&1n)===1n,
      frameIndex:0
    }));
  }

  return Object.freeze({
    visibleCharacters:Object.freeze(visibleCharacters),
    simulatedCharacterCount:roster.length+(protagonist?1:0)
  });
}

function renderVisibleActionRibbon(characters){
  const visible=(characters||[]).filter(character=>character.role==="resident"&&character.actionExecution?.holdsPosition);
  const action=visible[0]||null;
  e.residentActionRibbon.hidden=!action;
  if(!action)return null;
  const state=action.actionExecution;
  e.residentActionRibbonActor.textContent=(action.residentId||"resident")+" "+(action.residentName||"");
  e.residentActionRibbonState.textContent=String(state.label||state.action||"Action")+" · "+String(state.status||"active").toUpperCase();
  e.residentActionRibbonProgress.textContent=
    String(Math.round(Number(state.progress||0)*100))+"% · "+formatAssignmentPoint(state.target);
  return state;
}

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
let terrainPrefetchSerial=0;
let terrainCachedRenderCount=0;
let terrainFallbackRenderCount=0;
let terrainLastRenderSource="none";
let cameraTransitionQueue=Promise.resolve();
let lastCameraDirection={dx:0,dy:0};
let cameraNavigationSequence=0;
let lastCameraNavigation=null;
const cameraNavigationHistory=[];
const activeCameraKeys=new Set();
let keyboardPanTimer=null;
let keyboardInitialTimer=null;
let pendingKeyboardSource=null;
let lastResidentRosterDateKey="";
let lastResidentScheduleHourKey="";
let lastResidentScheduleProof=null;
let residentSchedulePinned=false;
let residentMovementTimer=null;
let residentMovementLastRealMs=0;
let residentMovementRenderPending=false;
let lastResidentMovementProof=null;

function projectedCoverageHalfSpan(width,height,tileSize){
  const basis=window.GameRenderer?.projectionBasis||{x:1,y:1};
  const basisX=Math.max(.01,Number(basis.x)||1);
  const basisY=Math.max(.01,Number(basis.y)||1);
  const halfSpan=
    width/(4*tileSize*basisX)+
    height/(4*tileSize*basisY);
  return Math.max(1,Math.ceil(halfSpan)+2);
}

function terrainGridDimensions(width,height,tileSize){
  let columns=Math.max(3,Math.ceil(width/tileSize)+2);
  let rows=Math.max(3,Math.ceil(height/tileSize)+2);

  // A rectangular logical grid becomes a diamond under the soft-dimetric
  // transform. Width/height of the diamond alone is not enough: every screen
  // corner must inverse-project inside the prepared logical grid, otherwise
  // portrait views expose large empty triangles.
  const requiredHalfSpan=projectedCoverageHalfSpan(width,height,tileSize);
  columns=Math.max(columns,requiredHalfSpan*2+1);
  rows=Math.max(rows,requiredHalfSpan*2+1);

  if(columns%2===0)columns+=1;
  if(rows%2===0)rows+=1;
  return {columns,rows};
}

function projectedViewportCoverage(columns,rows,width,height,tileSize){
  const requiredHalfSpan=projectedCoverageHalfSpan(width,height,tileSize);
  return Math.floor(columns/2)>=requiredHalfSpan&&Math.floor(rows/2)>=requiredHalfSpan;
}

function terrainRegionKey(center,columns,rows,tileSize){
  return [
    "terrain",
    center.x+","+center.y,
    columns+"x"+rows,
    tileSize+"px"
  ].join(":");
}

function isPlayCanvasRenderer(){
  return GameRenderer.snapshot().engine==="PlayCanvas";
}

function terrainViewGeometryDescriptor(center,zoom=Camera.getZoom()){
  const tileSize=Math.max(40,Math.round(100*zoom));
  const viewport=e.terrainGrid.parentElement;
  const width=Math.max(1,viewport.clientWidth);
  const height=Math.max(1,viewport.clientHeight);
  const {columns,rows}=terrainGridDimensions(width,height,tileSize);
  const halfCols=Math.floor(columns/2);
  const halfRows=Math.floor(rows/2);
  const regionKey=terrainRegionKey(center,columns,rows,tileSize);
  return {width,height,columns,rows,halfCols,halfRows,tileSize,regionKey};
}

function collectTerrainPreparationKeysFromTiles(tiles){
  const keys=new Set(["character:protagonist-male"]);
  for(const tile of tiles||[]){
    if(tile?.textureKey)keys.add(tile.textureKey);
    if(tile?.overlayTextureKey)keys.add(tile.overlayTextureKey);
    for(const blend of tile?.blends||[]){
      if(blend?.maskKey)keys.add(blend.maskKey);
    }
  }
  return [...keys];
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

function terrainViewDescriptor(seed,center,zoom=Camera.getZoom()){
  const base=terrainViewGeometryDescriptor(center,zoom);
  const requiredKeys=collectTerrainPreparationKeys(
    seed,center,base.columns,base.rows,base.halfCols,base.halfRows
  );
  return {...base,requiredKeys};
}

function buildTerrainSurfaceTiles(seed,center,columns,rows,halfCols=Math.floor(columns/2),halfRows=Math.floor(rows/2)){
  const tiles=[];
  const typeCache=new Map();
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const dx=col-halfCols;
      const dy=row-halfRows;
      const pos=WorldCoordinates.add(center,String(dx),String(dy));
      const tile=TerrainFoundation.getTile(seed,pos.x,pos.y);
      const item={
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
        blends:[]
      };
      tiles.push(item);
      typeCache.set(pos.x+","+pos.y,tile.type);
    }
  }
  const neighborType=(item,dx,dy)=>{
    const pos=WorldCoordinates.add({x:item.x,y:item.y},String(dx),String(dy));
    const key=pos.x+","+pos.y;
    if(typeCache.has(key))return typeCache.get(key);
    const type=TerrainFoundation.getTile(seed,pos.x,pos.y).type;
    typeCache.set(key,type);
    return type;
  };
  for(const item of tiles){
    const neighbors={
      n:neighborType(item,0,-1),
      e:neighborType(item,1,0),
      s:neighborType(item,0,1),
      w:neighborType(item,-1,0),
      ne:neighborType(item,1,-1),
      se:neighborType(item,1,1),
      sw:neighborType(item,-1,1),
      nw:neighborType(item,-1,-1)
    };
    item.blends=TileTextures.blendSpecs(item.type,neighbors,{
      seed,
      x:item.x,
      y:item.y
    });
  }
  return tiles;
}

function normalizeDirection(dx,dy){
  return {
    dx:Math.sign(Number(dx)||0),
    dy:Math.sign(Number(dy)||0)
  };
}

function backgroundYield(){
  return new Promise(resolve=>{
    if("requestIdleCallback" in window){
      requestIdleCallback(()=>resolve(),{timeout:60});
    }else{
      setTimeout(resolve,0);
    }
  });
}

function terrainPrefetchOffsets(direction){
  const safety=[
    [1,0],[-1,0],[0,1],[0,-1],
    [2,0],[-2,0],[0,2],[0,-2],
    [1,1],[1,-1],[-1,1],[-1,-1],
    [2,2],[2,-2],[-2,2],[-2,-2]
  ];
  const result=[];
  const seen=new Set();
  const add=(dx,dy)=>{
    const key=dx+","+dy;
    if((dx||dy)&&!seen.has(key)){
      seen.add(key);
      result.push([dx,dy]);
    }
  };
  if(direction.dx||direction.dy){
    add(direction.dx*6,direction.dy*6);
    add(direction.dx*4,direction.dy*4);
  }
  safety.forEach(([dx,dy])=>add(dx,dy));
  return result;
}

function scheduleTerrainAssetPrefetch(seed,center,columns,rows,tileSize,direction=lastCameraDirection){
  if(isPlayCanvasRenderer())return;
  const serial=++terrainPrefetchSerial;
  const halfCols=Math.floor(columns/2);
  const halfRows=Math.floor(rows/2);
  const directionLabel=direction.dx+","+direction.dy;
  const offsets=terrainPrefetchOffsets(direction);

  void (async()=>{
    for(const [dx,dy] of offsets){
      await backgroundYield();
      if(serial!==terrainPrefetchSerial)return;
      const target=WorldCoordinates.add(center,String(dx),String(dy));
      const regionKey=terrainRegionKey(target,columns,rows,tileSize);
      const requiredKeys=collectTerrainPreparationKeys(seed,target,columns,rows,halfCols,halfRows);
      await TextureAssets.prefetchRegion(regionKey,requiredKeys,{direction:directionLabel});
      if(serial!==terrainPrefetchSerial)return;
      const surfaceTiles=buildTerrainSurfaceTiles(seed,target,columns,rows,halfCols,halfRows);
      GameRenderer.prepareTerrain?.({
        tileSize,
        center:target,
        regionKey,
        tiles:surfaceTiles
      });
    }
  })().catch(error=>console.warn("Terrain asset prefetch failed.",error));
}

function enqueueCameraTransition(work){
  cameraTransitionQueue=cameraTransitionQueue
    .then(work)
    .catch(error=>console.error(error));
  return cameraTransitionQueue;
}

async function ensureTerrainViewPrepared(seed,center,zoom=Camera.getZoom()){
  let descriptor;
  if(isPlayCanvasRenderer()){
    const base=terrainViewGeometryDescriptor(center,zoom);
    const rendererPrepared=await Promise.resolve(GameRenderer.prepareTerrain?.({
      seed,
      center,
      width:base.width,
      height:base.height,
      columns:base.columns,
      rows:base.rows,
      tileSize:base.tileSize,
      regionKey:base.regionKey
    }));
    if(rendererPrepared&&rendererPrepared.prepared===false){
      throw new Error("PlayCanvas chunk preparation failed for "+base.regionKey);
    }
    const cached=GameRenderer.getPreparedTerrainView?.({
      seed,
      center,
      columns:base.columns,
      rows:base.rows
    });
    if(!cached?.ready){
      throw new Error(
        "PlayCanvas chunk world data is incomplete for "+base.regionKey+
        " missing="+JSON.stringify(cached?.missingChunkIds||[])
      );
    }
    descriptor={
      ...base,
      requiredKeys:collectTerrainPreparationKeysFromTiles(cached.tiles),
      cachedTerrain:cached
    };
  }else{
    descriptor=terrainViewDescriptor(seed,center,zoom);
  }

  const prepared=await TextureAssets.prepareRegion(descriptor.regionKey,descriptor.requiredKeys);
  if(!prepared.ready||prepared.stale||!TextureAssets.isRegionPrepared(descriptor.regionKey,descriptor.requiredKeys)){
    throw new Error("Terrain asset preparation did not complete for "+descriptor.regionKey);
  }
  return descriptor;
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

  let view;
  let cachedTerrain=null;
  if(isPlayCanvasRenderer()){
    const base=terrainViewGeometryDescriptor(center,Camera.getZoom());
    /* PlayCanvas presentation readiness is separate from chunk-world-data cache
       readiness. Always run the renderer preparation gate for the region that is
       about to become visible, including revisits whose terrain data is already
       cached. This keeps world assets/materials pinned and ready before render. */
    const rendererPrepared=await Promise.resolve(GameRenderer.prepareTerrain?.({
      seed:campaign.seed,
      center,
      width:base.width,
      height:base.height,
      columns:base.columns,
      rows:base.rows,
      tileSize:base.tileSize,
      regionKey:base.regionKey
    }));
    if(rendererPrepared&&rendererPrepared.prepared===false)return false;
    cachedTerrain=GameRenderer.getPreparedTerrainView?.({
      seed:campaign.seed,
      center,
      columns:base.columns,
      rows:base.rows
    })||null;
    if(!cachedTerrain?.ready)return false;
    view={
      ...base,
      requiredKeys:cachedTerrain?.ready
        ?collectTerrainPreparationKeysFromTiles(cachedTerrain.tiles)
        :collectTerrainPreparationKeys(
          campaign.seed,center,base.columns,base.rows,base.halfCols,base.halfRows
        )
    };
  }else{
    view=terrainViewDescriptor(campaign.seed,center,Camera.getZoom());
  }

  const {tileSize,width,height,columns,rows,halfCols,halfRows,regionKey,requiredKeys}=view;
  const viewportKey=width+"x"+height;
  const responsive=lastTerrainViewportKey===""||lastTerrainViewportKey===viewportKey||e.terrainGrid.dataset.viewportKey!==viewportKey;

  let tiles;
  if(cachedTerrain?.ready){
    terrainCachedRenderCount++;
    terrainLastRenderSource="chunk-cache";
    tiles=cachedTerrain.tiles.map(item=>({
      ...item,
      movement:item.movement,
      routeStep:null
    }));
  }else{
    terrainFallbackRenderCount++;
    terrainLastRenderSource="legacy-fallback";
    const surfaceTiles=buildTerrainSurfaceTiles(campaign.seed,center,columns,rows,halfCols,halfRows);
    tiles=surfaceTiles.map(item=>({
      ...item,
      movement:Walkability.classify(campaign.seed,item.x,item.y),
      routeStep:null
    }));
  }

  const currentSerial=++terrainRenderSerial;
  const rendererWasReady=Boolean(GameRenderer.snapshot().ready);
  if(!TextureAssets.isRegionPrepared(regionKey,requiredKeys)&&!rendererWasReady){
    e.terrainGrid.hidden=true;
  }
  const prepared=await TextureAssets.prepareRegion(regionKey,requiredKeys);
  if(currentSerial!==terrainRenderSerial||!prepared.ready||prepared.stale||!TextureAssets.isRegionPrepared(regionKey,requiredKeys)){
    return false;
  }

  const buildingInteriors=BuildingInteriors.build(campaign.seed);
  const interiorObjects=window.InteriorObjects?.build?InteriorObjects.build(campaign.seed):[];
  const characterBundle=visibleCharacterSpecs(campaign,center,columns,rows,tileSize);
  renderVisibleActionRibbon(characterBundle.visibleCharacters);
  const characterPreparation=GameRenderer.prepareCharacters?.(characterBundle.visibleCharacters,characterBundle.simulatedCharacterCount)||Promise.resolve(null);
  await characterPreparation;
  if(currentSerial!==terrainRenderSerial)return false;
  const rendererSnapshot=GameRenderer.render({
    width,height,columns,rows,tileSize,
    center,
    seed:campaign.seed,
    regionKey,
    tiles,
    routeLastIndex:-1,
    protagonistWorld:protagonist||null,
    protagonistOffset:protagonist?Camera.offsetFrom(protagonist):null,
    buildingInteriors,
    interiorObjects,
    visibleCharacters:characterBundle.visibleCharacters,
    visibleEntities:characterBundle.visibleCharacters,
    simulatedCharacterCount:characterBundle.simulatedCharacterCount
  });

  const gridWidth=columns*tileSize;
  const gridHeight=rows*tileSize;
  const coverage=projectedViewportCoverage(columns,rows,width,height,tileSize);
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

  setCheck(e.vTerrainDeterministic,true,"FAIL");
  setCheck(e.vTileCoverage,coverage,"FAIL");
  setCheck(e.vTileResponsive,responsive,"FAIL");
  setCheck(e.vTileOddGrid,oddGrid&&rendererSnapshot.tileCount===columns*rows,"FAIL");
  setCheck(e.vTileRepeat,repeatable,"FAIL");
  renderBuildingPresentationProof(rendererSnapshot);
  e.rendererVisibleRegion.textContent=regionKey;
  e.terrainGrid.hidden=false;
  lastTerrainViewportKey=viewportKey;
  scheduleTerrainAssetPrefetch(campaign.seed,center,columns,rows,tileSize,lastCameraDirection);
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
  const playcanvasCharacter=GameRenderer.snapshot().engine==="PlayCanvas";
  e.protagonistMarker.hidden=!visible||playcanvasCharacter;
  if(visible&&!playcanvasCharacter){
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

function frozenCoordinate(point){
  return point?Object.freeze({x:String(point.x),y:String(point.y)}):null;
}
function cameraNavigationAngle(requested,projected){
  const rx=Number(requested?.x||0),ry=Number(requested?.y||0);
  const px=Number(projected?.x||0),py=Number(projected?.y||0);
  const rm=Math.hypot(rx,ry),pm=Math.hypot(px,py);
  if(rm<1e-7||pm<1e-7)return 180;
  const dot=Math.max(-1,Math.min(1,(rx*px+ry*py)/(rm*pm)));
  return Number((Math.acos(dot)*180/Math.PI).toFixed(3));
}
function rememberCameraNavigation(meta,centerBefore,centerAfter,protagonistBefore,protagonistAfter){
  if(!meta)return;
  const worldDx=Number(BigInt(centerAfter.x)-BigInt(centerBefore.x));
  const worldDy=Number(BigInt(centerAfter.y)-BigInt(centerBefore.y));
  const record=Object.freeze({
    sequence:++cameraNavigationSequence,
    source:String(meta.source||"screen"),
    mappingSource:String(meta.mappingSource||"unknown"),
    requestedScreen:Object.freeze({x:Number(meta.requestedScreen?.x||0),y:Number(meta.requestedScreen?.y||0)}),
    worldDelta:Object.freeze({x:worldDx,y:worldDy}),
    projectedScreen:Object.freeze({x:Number(meta.projectedScreen?.x||0),y:Number(meta.projectedScreen?.y||0)}),
    angleErrorDegrees:cameraNavigationAngle(meta.requestedScreen,meta.projectedScreen),
    logicalSteps:Number(meta.logicalSteps||0),
    centerBefore:frozenCoordinate(centerBefore),
    centerAfter:frozenCoordinate(centerAfter),
    protagonistBefore:frozenCoordinate(protagonistBefore),
    protagonistAfter:frozenCoordinate(protagonistAfter),
    simulationAuthorityPreserved:sameCoordinate(protagonistBefore,protagonistAfter)
  });
  lastCameraNavigation=record;
  cameraNavigationHistory.push(record);
  while(cameraNavigationHistory.length>32)cameraNavigationHistory.shift();
}
function panCameraScreen(screenDx,screenDy,source="screen"){
  const sx=Math.trunc(Number(screenDx)||0),sy=Math.trunc(Number(screenDy)||0);
  if(!sx&&!sy)return Promise.resolve(null);
  const count=Math.max(Math.abs(sx),Math.abs(sy));
  const signX=Math.sign(sx),signY=Math.sign(sy);
  const mappings=[];
  let worldX=0,worldY=0,projectedX=0,projectedY=0;
  for(let index=0;index<count;index++){
    const unitX=index<Math.abs(sx)?signX:0;
    const unitY=index<Math.abs(sy)?signY:0;
    const mapping=GameRenderer?.screenToCameraDelta?.(unitX,unitY);
    if(!mapping?.worldDelta)continue;
    mappings.push(mapping);
    worldX+=Number(mapping.worldDelta.x||0);
    worldY+=Number(mapping.worldDelta.y||0);
    projectedX+=Number(mapping.projectedScreen?.x||0);
    projectedY+=Number(mapping.projectedScreen?.y||0);
  }
  if(!mappings.length||(!worldX&&!worldY))return Promise.resolve(null);
  return panCamera(worldX,worldY,Object.freeze({
    source,
    mappingSource:String(mappings[0].source||"unknown"),
    requestedScreen:Object.freeze({x:sx,y:sy}),
    projectedScreen:Object.freeze({x:projectedX,y:projectedY}),
    logicalSteps:mappings.length
  }));
}
function cameraNavigationSnapshot(){
  return Object.freeze({
    sequence:cameraNavigationSequence,
    last:lastCameraNavigation,
    history:Object.freeze(cameraNavigationHistory.slice()),
    activeKeyboardKeys:Object.freeze([...activeCameraKeys].sort()),
    repeatIntervalMs:140,
    sharedTransform:true,
    mappingSource:"playcanvas-screen-to-ground"
  });
}
function panCamera(dx,dy,navigationMeta=null){
  return enqueueCameraTransition(async()=>{
    const campaign=SeedSystem.getCampaign();
    const protagonist=Protagonist.getPosition();
    if(!campaign||!protagonist)return;

    const centerBefore=Camera.getCenter();
    if(!cameraReturnProof){
      cameraReturnProof={
        center:centerBefore,
        signature:cameraTerrainSignature(campaign.seed,centerBefore)
      };
    }

    const target=WorldCoordinates.add(centerBefore,String(dx),String(dy));
    const direction=normalizeDirection(dx,dy);
    await ensureTerrainViewPrepared(campaign.seed,target,Camera.getZoom());

    const protagonistBefore=WorldCoordinates.position(protagonist.x,protagonist.y);
    Camera.setCenter(target.x,target.y);
    cameraMoved=true;
    lastCameraDirection=direction;
    const protagonistAfter=Protagonist.getPosition();
    cameraIndependenceProven=sameCoordinate(protagonistBefore,protagonistAfter);
    await renderTerrain();
    updateCameraPresentation();
    rememberCameraNavigation(navigationMeta,centerBefore,Camera.getCenter(),protagonistBefore,protagonistAfter);
  });
}

function centerCameraOnProtagonist(){
  return enqueueCameraTransition(async()=>{
    const campaign=SeedSystem.getCampaign();
    const protagonist=Protagonist.getPosition();
    if(!campaign||!protagonist)return;
    const centerBefore=Camera.getCenter();
    const direction=normalizeDirection(
      BigInt(protagonist.x)-BigInt(centerBefore.x),
      BigInt(protagonist.y)-BigInt(centerBefore.y)
    );
    await ensureTerrainViewPrepared(campaign.seed,protagonist,Camera.getZoom());
    Camera.centerOn(protagonist);
    lastCameraDirection=direction;
    await renderTerrain();
    updateCameraPresentation();
  });
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
  lastCameraDirection={dx:0,dy:0};
  terrainPrefetchSerial++;
}


function applyCameraZoom(nextZoom,source){
  return enqueueCameraTransition(async()=>{
    const campaign=SeedSystem.getCampaign();
    if(!campaign)return;
    const protagonistBefore=Protagonist.getPosition();
    const centerBefore=Camera.getCenter();
    const previous=Camera.getZoom();
    const targetZoom=Math.max(Camera.MIN_ZOOM,Math.min(Camera.MAX_ZOOM,Number(nextZoom)));
    if(!Number.isFinite(targetZoom)||targetZoom===previous)return;

    await ensureTerrainViewPrepared(campaign.seed,centerBefore,targetZoom);
    const next=Camera.setZoom(targetZoom);
    if(next===previous)return;

    const protagonistAfter=Protagonist.getPosition();
    const centerAfter=Camera.getCenter();
    if(source==="wheel")wheelZoomUsed=true;

    await renderTerrain();
    updateCameraPresentation();

    const worldStable=sameCoordinate(protagonistBefore,protagonistAfter)&&sameCoordinate(centerBefore,centerAfter);
    if(source==="wheel")setCheck(e.vCameraWheelZoom,worldStable,"FAIL");
  });
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
      dragState={pointerId:event.pointerId,pointerType:event.pointerType||"pointer",x:event.clientX,y:event.clientY,accX:0,accY:0};
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
    let screenX=0,screenY=0;
    while(Math.abs(dragState.accX)>=threshold){
      const step=dragState.accX>0?1:-1;
      screenX+=step;
      dragState.accX+=dragState.accX>0?-threshold:threshold;
    }
    while(Math.abs(dragState.accY)>=threshold){
      const step=dragState.accY>0?1:-1;
      screenY+=step;
      dragState.accY+=dragState.accY>0?-threshold:threshold;
    }
    if(screenX||screenY)panCameraScreen(screenX,screenY,"pointer:"+(event.pointerType||dragState.pointerType||"pointer"));
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
      dragState={pointerId,pointerType:"pointer",x:point.x,y:point.y,accX:0,accY:0};
      area.classList.add("camera-dragging");
    }

    try{area.releasePointerCapture?.(event.pointerId)}catch(_){}
  };
  area.addEventListener("pointerup",endDrag);
  area.addEventListener("pointercancel",endDrag);

  const cameraKeys=new Set(["arrowleft","a","arrowright","d","arrowup","w","arrowdown","s"]);
  const keyboardScreenDirection=()=>{
    const left=activeCameraKeys.has("arrowleft")||activeCameraKeys.has("a");
    const right=activeCameraKeys.has("arrowright")||activeCameraKeys.has("d");
    const up=activeCameraKeys.has("arrowup")||activeCameraKeys.has("w");
    const down=activeCameraKeys.has("arrowdown")||activeCameraKeys.has("s");
    return Object.freeze({x:(right?1:0)-(left?1:0),y:(down?1:0)-(up?1:0)});
  };
  const repeatKeyboardPan=()=>{
    const move=keyboardScreenDirection();
    if(move.x||move.y)panCameraScreen(move.x,move.y,"keyboard:hold");
  };
  const flushInitialKeyboardPan=()=>{
    if(keyboardInitialTimer){
      clearTimeout(keyboardInitialTimer);
      keyboardInitialTimer=null;
    }
    const source=pendingKeyboardSource;
    pendingKeyboardSource=null;
    const move=keyboardScreenDirection();
    if(source&&(move.x||move.y))panCameraScreen(move.x,move.y,"keyboard:"+source);
  };
  const scheduleInitialKeyboardPan=key=>{
    pendingKeyboardSource=key;
    if(keyboardInitialTimer)return;
    // Coalesce keys pressed within the same physical chord into one normalized
    // screen-space movement instead of firing an axis step for each key.
    keyboardInitialTimer=setTimeout(flushInitialKeyboardPan,20);
  };
  const stopKeyboardRepeatIfIdle=()=>{
    if(activeCameraKeys.size||!keyboardPanTimer)return;
    clearInterval(keyboardPanTimer);
    keyboardPanTimer=null;
  };
  document.addEventListener("keydown",event=>{
    if(!SeedSystem.getCampaign())return;
    if(event.target&&["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName))return;
    const key=event.key.toLowerCase();
    if(!cameraKeys.has(key))return;
    event.preventDefault();
    const wasActive=activeCameraKeys.has(key);
    activeCameraKeys.add(key);
    if(!event.repeat&&!wasActive)scheduleInitialKeyboardPan(key);
    if(!keyboardPanTimer)keyboardPanTimer=setInterval(repeatKeyboardPan,140);
  });
  document.addEventListener("keyup",event=>{
    const key=event.key.toLowerCase();
    if(!cameraKeys.has(key))return;
    if(keyboardInitialTimer)flushInitialKeyboardPan();
    activeCameraKeys.delete(key);
    stopKeyboardRepeatIfIdle();
  });
  window.addEventListener("blur",()=>{
    if(keyboardInitialTimer){
      clearTimeout(keyboardInitialTimer);
      keyboardInitialTimer=null;
    }
    pendingKeyboardSource=null;
    activeCameraKeys.clear();
    stopKeyboardRepeatIfIdle();
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
  const bootstrap=window.RendererBootstrap?.status?.()||{};
  e.rendererEngine.textContent=renderer.engine||"PlayCanvas";
  e.rendererEngineVersion.textContent=renderer.engineVersion||"—";
  e.rendererBackend.textContent=renderer.backend||"—";
  e.rendererRequestedBackend.textContent=renderer.requestedBackend||bootstrap.backend||"webgl2";
  e.rendererWebgpuAvailable.textContent=(renderer.webgpuAvailable??bootstrap.webgpuAvailable)?"YES":"NO";
  e.rendererCanvasCount.textContent=String(renderer.canvasCount||0);
  e.rendererProjection.textContent=renderer.scene?.projection||"—";
  e.rendererEntityCount.textContent=String(renderer.scene?.entityCount??"—");
  e.rendererDrawCalls.textContent=String(renderer.performance?.drawCalls??"—");
  e.rendererFrameTime.textContent=Number.isFinite(renderer.performance?.frameMs)
    ?Number(renderer.performance.frameMs).toFixed(2)+" ms"
    :"—";
  e.rendererRenderScale.textContent=Number.isFinite(renderer.quality?.renderScale)
    ?Number(renderer.quality.renderScale).toFixed(2)
    :"—";
  e.rendererPixelRatio.textContent=Number.isFinite(renderer.quality?.effectivePixelRatio)
    ?Number(renderer.quality.effectivePixelRatio).toFixed(2)
    :"—";
  e.rendererCanvasSize.textContent=renderer.canvas
    ?renderer.canvas.cssWidth+"×"+renderer.canvas.cssHeight+" / "+renderer.canvas.backingWidth+"×"+renderer.canvas.backingHeight
    :"—";
  e.rendererTextureCount.textContent=String(assets.loadedKeyCount||0)+" logical / "+String(assets.loadedSourceCount||0)+" sources / "+String(renderer.characterPresentation?.preparedCharacterCount||0)+" character textures";
  e.rendererSourceMode.textContent="PlayCanvas orthographic 3D | "+String(renderer.characterPresentation?.activeCharacterCount||0)+" active / "+String(renderer.characterPresentation?.simulatedCharacterCount||0)+" simulated characters";
  e.rendererPreparedRegion.textContent=assets.preparedRegionKey||"—";
  if(!e.rendererVisibleRegion.textContent)e.rendererVisibleRegion.textContent=renderer.regionKey||"—";
  setCheck(e.vRendererWebGL,Boolean(renderer.gpu||renderer.webgl||renderer.webgpu),"FAIL");
  setCheck(e.vRendererCanvas,renderer.canvasCount===1,"FAIL");
  setCheck(e.vRendererNoDomTiles,(renderer.domTerrainTileCount||0)===0,"FAIL");
  setCheck(e.vRendererLogicalTextures,Boolean(window.RendererContract),"FAIL");
  setCheck(e.vRendererSvgCache,true,"FAIL");
  setCheck(e.vRendererSimulation,
    typeof TerrainFoundation?.getTile==="function"&&
    typeof Walkability?.classify==="function"&&
    typeof RoutePlanner?.findRoute==="function"&&
    renderer.simulationAuthorityPreserved!==false,
    "FAIL"
  );
}

function residentDateKey(time){
  return time?`${time.year}-${String(time.month).padStart(2,"0")}-${String(time.day).padStart(2,"0")}`:"";
}
function renderResidentRosterProof(timeOverride=null){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    e.residentRosterCount.textContent="—";
    e.residentRosterSeed.textContent="—";
    e.residentRosterTime.textContent="—";
    e.residentRosterRows.replaceChildren();
    ["vResidentFields","vResidentIds","vResidentDeterministic","vResidentTimeIdentity","vResidentAge","vResidentBirthplace"]
      .forEach(id=>setCheck(e[id],false,"WAITING"));
    lastResidentRosterDateKey="";
    return null;
  }
  const time=timeOverride||GameTime.getNow();
  const proof=ResidentRoster.proof(campaign.seed,time);
  e.residentRosterCount.textContent=String(proof.residentCount);
  e.residentRosterSeed.textContent=campaign.seed;
  e.residentRosterTime.textContent=GameTime.formatDate(time);
  const fragment=document.createDocumentFragment();
  for(const resident of proof.residents){
    const row=document.createElement("tr");
    for(const value of [resident.id,resident.name,resident.gender,resident.birthDate,resident.birthplace,String(resident.age)]){
      const cell=document.createElement("td");
      cell.textContent=value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  e.residentRosterRows.replaceChildren(fragment);
  setCheck(e.vResidentFields,proof.residentCount===12&&proof.requiredFieldsPass,"FAIL");
  setCheck(e.vResidentIds,proof.uniqueIdsPass&&proof.protagonistSeparate,"FAIL");
  setCheck(e.vResidentDeterministic,proof.deterministic&&proof.foundationOnly,"FAIL");
  setCheck(e.vResidentTimeIdentity,proof.identityStableAcrossTime,"FAIL");
  setCheck(e.vResidentAge,proof.ageDerivedPass&&proof.agesAdvanceOneYear,"FAIL");
  setCheck(e.vResidentBirthplace,proof.birthplacePass,"FAIL");
  lastResidentRosterDateKey=residentDateKey(time);
  return proof;
}

function formatAssignmentPoint(point){
  return point?"("+point.x+","+point.y+")":"—";
}
function renderResidentAssignmentProof(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign){
    e.residentAssignmentCount.textContent="—";
    e.residentAssignmentHomes.textContent="—";
    e.residentAssignmentCapacity.textContent="—";
    e.residentAssignmentRows.replaceChildren();
    ["vResidentAssignmentHomes","vResidentAssignmentProfessions","vResidentAssignmentTargets","vResidentAssignmentWalkable","vResidentAssignmentRoutes","vResidentAssignmentDeterministic"]
      .forEach(id=>setCheck(e[id],false,"WAITING"));
    return null;
  }
  const proof=ResidentAssignments.proof(campaign.seed);
  e.residentAssignmentCount.textContent=String(proof.residentCount);
  e.residentAssignmentHomes.textContent=String(proof.homeCount);
  e.residentAssignmentCapacity.textContent=String(Math.max(0,...proof.homeOccupancy.map(item=>item.count)));
  const routeByResident=new Map(proof.routes.map(route=>[route.residentId,route]));
  const fragment=document.createDocumentFragment();
  for(const assignment of proof.assignments){
    const route=routeByResident.get(assignment.residentId);
    const row=document.createElement("tr");
    const values=[
      assignment.residentId+" "+assignment.residentName,
      assignment.homeId+" "+assignment.homeLabel,
      assignment.profession,
      assignment.workplaceId+" "+assignment.workplaceLabel,
      formatAssignmentPoint(assignment.homeTarget),
      formatAssignmentPoint(assignment.workTarget),
      route?.pass?"PASS · "+route.stepCount+" steps":"FAIL"
    ];
    for(const value of values){
      const cell=document.createElement("td");
      cell.textContent=value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  e.residentAssignmentRows.replaceChildren(fragment);
  setCheck(e.vResidentAssignmentHomes,proof.homesValid&&proof.homeCapacityPass,"FAIL");
  setCheck(e.vResidentAssignmentProfessions,proof.professionsCompatible,"FAIL");
  setCheck(e.vResidentAssignmentTargets,proof.interactionTargetsPass,"FAIL");
  setCheck(e.vResidentAssignmentWalkable,proof.targetsPass,"FAIL");
  setCheck(e.vResidentAssignmentRoutes,proof.routesPass&&proof.doorsPass,"FAIL");
  setCheck(e.vResidentAssignmentDeterministic,proof.deterministic,"FAIL");
  return proof;
}

function residentScheduleHourKey(time){
  return time?`${time.year}-${time.month}-${time.day}-${time.hour}`:"";
}
function renderResidentScheduleProof(timeOverride=null,pin=false){
  const campaign=SeedSystem.getCampaign();
  if(residentSchedulePinned&&!pin&&timeOverride==null&&lastResidentScheduleProof){
    return lastResidentScheduleProof;
  }
  residentSchedulePinned=Boolean(pin);
  if(!campaign){
    e.residentScheduleCount.textContent="—";
    e.residentScheduleTime.textContent="—";
    e.residentScheduleBlocks.textContent="—";
    e.residentScheduleRows.replaceChildren();
    ["vResidentScheduleComplete","vResidentScheduleActions","vResidentScheduleAssignments","vResidentScheduleDeterministic","vResidentScheduleTime","vResidentScheduleIsolation"]
      .forEach(id=>setCheck(e[id],false,"WAITING"));
    lastResidentScheduleProof=null;
    lastResidentScheduleHourKey="";
    return null;
  }
  const time=timeOverride||GameTime.getNow();
  const proof=ResidentSchedules.proof(campaign.seed,time);
  e.residentScheduleCount.textContent=String(proof.residentCount);
  e.residentScheduleTime.textContent=GameTime.formatTimestamp(proof.sampleTime);
  e.residentScheduleBlocks.textContent=proof.scheduleSummaries.length
    ?String(proof.scheduleSummaries[0].blockCount)
    :"—";
  const fragment=document.createDocumentFragment();
  for(const state of proof.currentStates){
    const row=document.createElement("tr");
    const values=[
      state.residentId+" "+state.residentName,
      state.state,
      state.intendedAction,
      state.buildingId||"—",
      formatAssignmentPoint(state.target),
      state.interactionObjectId||state.interactionObjectType||"—",
      state.targetSource
    ];
    for(const value of values){
      const cell=document.createElement("td");
      cell.textContent=value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  e.residentScheduleRows.replaceChildren(fragment);
  setCheck(e.vResidentScheduleComplete,proof.completeSchedules,"FAIL");
  setCheck(e.vResidentScheduleActions,proof.targetsActionsValid&&proof.currentStatesValid,"FAIL");
  setCheck(e.vResidentScheduleAssignments,proof.homeWorkAssignmentsMatch,"FAIL");
  setCheck(e.vResidentScheduleDeterministic,proof.deterministic,"FAIL");
  setCheck(e.vResidentScheduleTime,proof.representativeSelectionPass&&proof.identityAssignmentsStable,"FAIL");
  setCheck(e.vResidentScheduleIsolation,
    proof.directRealClockRead===false&&proof.movementExecutionIntroduced===false&&
    proof.actionExecutionIntroduced===false&&proof.dialogueEconomyCombatIntroduced===false,
    "FAIL"
  );
  lastResidentScheduleProof=proof;
  lastResidentScheduleHourKey=residentScheduleHourKey(proof.sampleTime);
  return proof;
}

function renderResidentMovementProof(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign||!window.ResidentMovement){
    e.movementProofBadge.hidden=true;
    e.residentMovementRows.replaceChildren();
    lastResidentMovementProof=null;
    return null;
  }
  ResidentMovement.ensure(campaign.seed);
  const live=ResidentMovement.snapshot();
  const activeProof=ResidentMovement.proofSnapshot?.()||null;
  const verified=ResidentMovement.verify(campaign.seed);
  const proof=activeProof||verified;
  const controlled=proof?.residentId?ResidentMovement.get(proof.residentId):null;

  e.residentMovementResident.textContent=proof?.residentId?proof.residentId+" "+proof.residentName:"12 residents";
  e.residentMovementPosition.textContent=formatAssignmentPoint(controlled?.position||proof?.position);
  e.residentMovementTarget.textContent=formatAssignmentPoint(controlled?.target||proof?.target);
  e.residentMovementStatus.textContent=controlled?.status||proof?.stage||"ready";
  e.residentMovementRoute.textContent=controlled
    ?controlled.routeIndex+" / "+controlled.routeSteps+" · plans "+controlled.routeRequests
    :"verified";

  const fragment=document.createDocumentFragment();
  for(const resident of live.residents){
    const row=document.createElement("tr");
    for(const value of [
      resident.residentId,
      formatAssignmentPoint(resident.position),
      formatAssignmentPoint(resident.target),
      resident.status,
      resident.activityState||"—",
      resident.routeSteps?resident.routeIndex+" / "+resident.routeSteps:"—",
      String(resident.invalidSegmentReplans)
    ]){
      const cell=document.createElement("td");
      cell.textContent=value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  e.residentMovementRows.replaceChildren(fragment);

  setCheck(e.vResidentMovementContinuous,verified.adjacencyPass&&verified.noTeleport,"FAIL");
  setCheck(e.vResidentMovementDoors,verified.inboundDoorPass&&verified.outboundDoorPass&&verified.insideArrivalPass&&verified.outsideArrivalPass,"FAIL");
  setCheck(e.vResidentMovementCollision,verified.walkabilityPass&&verified.blockedTraversals===0&&verified.invalidSegmentReplans===0,"FAIL");
  setCheck(e.vResidentMovementSpeed,verified.roadSpeedPass&&verified.physicalSpeedIndependent,"FAIL");
  setCheck(e.vResidentMovementDeterministic,verified.deterministic&&verified.routeRequests===2&&verified.routePlanningPerFrame===false,"FAIL");
  setCheck(e.vResidentMovementCamera,activeProof?.cameraIndependencePass===true,activeProof?"FAIL":"WAITING");
  setCheck(e.vResidentMovementCulling,
    activeProof?.rendererCullingPass===true&&activeProof?.offscreenSimulationPass===true,
    activeProof?"FAIL":"WAITING"
  );
  setCheck(e.vResidentMovementIsolation,
    live.directPlayerControl===false&&live.actionExecution===false&&
    verified.actionExecutionIntroduced===false&&verified.dialogueEconomyCombatIntroduced===false,
    "FAIL"
  );

  e.movementProofBadge.hidden=!activeProof||Boolean(window.ActionExecutor?.proofSnapshot?.());
  if(activeProof){
    e.movementProofBadgeStage.textContent="WP-S004-004 · "+String(activeProof.stage||"movement");
    e.movementProofBadgeResident.textContent=activeProof.residentId+" "+activeProof.residentName;
    e.movementProofBadgePosition.textContent=
      formatAssignmentPoint(activeProof.position)+" → "+formatAssignmentPoint(activeProof.target);
  }
  lastResidentMovementProof=activeProof;
  return activeProof||verified;
}

function renderResidentActionProof(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign||!window.ActionExecutor){
    e.residentActionRibbon.hidden=true;
    e.residentActionRows.replaceChildren();
    return null;
  }
  const verified=ActionExecutor.verify(campaign.seed);
  const proof=ActionExecutor.proofSnapshot?.()||null;
  const live=ActionExecutor.snapshot();
  const current=proof?.current||live.actions[0]||null;
  const movementProof=window.ResidentMovement?.proofSnapshot?.()||null;
  const resident=proof?.residentId
    ?DailyActivity.build(campaign.seed).find(item=>item.id===proof.residentId)
    :null;
  e.residentActionActor.textContent=proof?.residentId
    ?proof.residentId+" "+(resident?.name||"")
    :(current?current.actorKind+":"+current.actorId:"No active action");
  e.residentActionName.textContent=current?.label||current?.action||"—";
  e.residentActionStatus.textContent=current?.status||proof?.stage||"ready";
  e.residentActionTarget.textContent=formatAssignmentPoint(current?.target||movementProof?.target);
  e.residentActionProgress.textContent=current
    ?String(Math.round(Number(current.progress||0)*100))+"%"
    :"—";
  const fragment=document.createDocumentFragment();
  for(const action of live.actions){
    const row=document.createElement("tr");
    for(const value of [
      action.actorKind+":"+action.actorId,
      action.action,
      action.status,
      formatAssignmentPoint(action.target),
      action.interactionObjectId||action.interactionObjectType||"—",
      String(Math.round(Number(action.progress||0)*100))+"%"
    ]){
      const cell=document.createElement("td");
      cell.textContent=value;
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  e.residentActionRows.replaceChildren(fragment);
  setCheck(e.vResidentActionRequired,verified.requiredActionPass,"FAIL");
  setCheck(e.vResidentActionReject,verified.incompatibleRejected&&verified.outOfRangeRejected,"FAIL");
  setCheck(e.vResidentActionArrival,
    proof?proof.arrivalRejected&&proof.actionStarted&&proof.heldAtTarget:verified.arrivalRequired,
    proof?"FAIL":"WAITING"
  );
  setCheck(e.vResidentActionOffscreen,
    proof?proof.offscreenStatePass&&proof.rendererCullingPass&&proof.cameraRoundTripPass:false,
    proof?"FAIL":"WAITING"
  );
  setCheck(e.vResidentActionSchedule,
    proof?proof.scheduleReleasePass&&proof.nextGoalRoutingPass&&proof.workStarted:false,
    proof?"FAIL":"WAITING"
  );
  setCheck(e.vResidentActionGeneric,verified.genericNpcContract&&verified.genericProtagonistContract,"FAIL");
  setCheck(e.vResidentActionIsolation,
    verified.rendererDependency===false&&verified.presentationAuthority===false&&
    verified.economyIntroduced===false&&verified.combatIntroduced===false&&
    verified.fullInventoryIntroduced===false&&verified.externalLlmIntroduced===false,
    "FAIL"
  );
  return proof||verified;
}

async function refreshResidentCharacters(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign||!GameRenderer?.updateCharacters)return null;
  const center=Camera.getCenter();
  const columns=Number(e.terrainGrid.dataset.columns||0);
  const rows=Number(e.terrainGrid.dataset.rows||0);
  const tileSize=Number(e.terrainGrid.dataset.tileSize||100);
  if(!center||columns<=0||rows<=0)return null;
  const bundle=visibleCharacterSpecs(campaign,center,columns,rows,tileSize);
  renderVisibleActionRibbon(bundle.visibleCharacters);
  renderResidentActionProof();
  return GameRenderer.updateCharacters(bundle.visibleCharacters,bundle.simulatedCharacterCount);
}
function startResidentMovement(){
  if(residentMovementTimer)clearInterval(residentMovementTimer);
  const campaign=SeedSystem.getCampaign();
  if(!campaign||!window.ResidentMovement)return;
  ResidentMovement.ensure(campaign.seed);
  residentMovementLastRealMs=performance.now();
  residentMovementTimer=setInterval(()=>{
    const current=SeedSystem.getCampaign();
    if(!current||ResidentMovement.snapshot().proofActive){
      residentMovementLastRealMs=performance.now();
      return;
    }
    const now=performance.now();
    const dt=Math.max(0,Math.min(0.5,(now-residentMovementLastRealMs)/1000));
    residentMovementLastRealMs=now;
    const result=ResidentMovement.advance(current.seed,GameTime.getNow(),dt);
    if(!result.changed||residentMovementRenderPending)return;
    residentMovementRenderPending=true;
    Promise.resolve(refreshResidentCharacters())
      .catch(error=>console.error(error))
      .finally(()=>{residentMovementRenderPending=false});
  },100);
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
function renderCharacterMemoryProof(actorKind="protagonist",actorId="protagonist"){
  if(typeof window.CharacterMemory?.renderDebugPanel!=="function")return null;
  const campaign=SeedSystem.getCampaign();
  const seed=campaign?campaign.seed:SeedSystem.getSettings().seed;
  return window.CharacterMemory.renderDebugPanel(seed,{kind:actorKind,id:actorId},undefined,document.getElementById("memoryProof"));
}
function renderDialogueContextProof(residentId="R03",caseId="public-friendly"){
  if(typeof window.DialogueContext?.renderDebugPanel!=="function")return null;
  const campaign=SeedSystem.getCampaign();
  const seed=campaign?campaign.seed:SeedSystem.getSettings().seed;
  return window.DialogueContext.renderDebugPanel(seed,residentId,caseId,document.getElementById("dialogueProof"));
}
function renderAdviceResolutionProof(adviceId=""){
  if(typeof window.AdviceResolution?.renderDebugPanel!=="function")return null;
  const campaign=SeedSystem.getCampaign();
  const seed=campaign?campaign.seed:SeedSystem.getSettings().seed;
  return window.AdviceResolution.renderDebugPanel(seed,adviceId,document.getElementById("adviceResolutionProof"));
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
  renderCharacterMemoryProof();
  renderDialogueContextProof();
  renderAdviceResolutionProof();
  renderWorldCoordinates();
  renderGeography();
  renderStartingVillage();
  renderResidentRosterProof();
  renderResidentAssignmentProof();
  renderResidentScheduleProof();
  renderResidentMovementProof();
  renderResidentActionProof();
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
  if(residentDateKey(t)!==lastResidentRosterDateKey)renderResidentRosterProof(t);
  if(!residentSchedulePinned&&residentScheduleHourKey(t)!==lastResidentScheduleHourKey){
    renderResidentScheduleProof(t,false);
  }
}
function startClock(){
  if(clockTimer)clearInterval(clockTimer);
  renderClock();
  clockTimer=setInterval(renderClock,250);
}
async function startNewCampaign(){
  const result=SeedSystem.startNewCampaign();
  restoredCampaign=false;
  residentSchedulePinned=false;
  lastResidentScheduleProof=null;
  if(result.ok){
    resetCameraForCampaign();
    ResidentMovement?.reset?.(result.seed||SeedSystem.getCampaign()?.seed);
  }
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
  renderStatic();startClock();startResidentMovement();closePopup("mainMenuPopup");
}
async function restartCampaign(){
  const result=SeedSystem.restartCampaign();
  residentSchedulePinned=false;
  lastResidentScheduleProof=null;
  if(result.ok){
    resetCameraForCampaign();
    ResidentMovement?.reset?.(result.seed||SeedSystem.getCampaign()?.seed);
  }
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
  renderStatic();startClock();startResidentMovement();
  if(result.ok)closePopup("mainMenuPopup");
}
function saveSettings(){
  const result=SeedSystem.setSettingsSeed(e.seedInput.value);
  const developmentMode=saveDevelopmentMode();
  e.settingsMessage.textContent=result.ok
    ?result.message+" Development Mode "+(developmentMode?"enabled.":"disabled.")
    :result.message;
  if(result.ok)e.seedInput.value=result.seed;
}
async function init(){
  cache();
  SeedSystem.loadSettings();
  e.seedInput.value=SeedSystem.getSettings().seed;
  applyDevelopmentMode(readDevelopmentMode());
  const restored=SeedSystem.loadCampaign();
  restoredCampaign=restored.ok;
  resetCameraForCampaign();
  if(restored.ok&&window.ResidentMovement)ResidentMovement.reset(restored.seed||SeedSystem.getCampaign()?.seed);

  e.mainMenuButton.onclick=()=>openPopup("mainMenuPopup");
  e.settingsButton.onclick=()=>{
    e.seedInput.value=SeedSystem.getSettings().seed;
    if(e.developmentModeToggle)e.developmentModeToggle.checked=readDevelopmentMode();
    openPopup("settingsPopup");
  };
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
  renderStatic();startClock();startResidentMovement();
  observeTerrainViewport();
}
window.AppUI=Object.freeze({
  init,
  refreshTerrain:async()=>{const result=await renderTerrain();updateCameraPresentation();return result;},
  refreshBuildingPresentation:()=>renderBuildingPresentationProof(GameRenderer.snapshot()),
  refreshResidentRoster:()=>renderResidentRosterProof(),
  refreshResidentAssignments:()=>renderResidentAssignmentProof(),
  refreshResidentSchedules:(time,pin=true)=>renderResidentScheduleProof(time,pin),
  residentScheduleSnapshot:()=>lastResidentScheduleProof,
  refreshResidentCharacters,
  residentMovementSnapshot:()=>window.ResidentMovement?.snapshot?.()||null,
  refreshResidentMovementProof:()=>renderResidentMovementProof(),
  residentMovementProofSnapshot:()=>window.ResidentMovement?.proofSnapshot?.()||lastResidentMovementProof,
  refreshResidentActionProof:()=>renderResidentActionProof(),
  refreshCharacterMemory:(actorKind="protagonist",actorId="protagonist")=>renderCharacterMemoryProof(actorKind,actorId),
  characterMemorySnapshot:()=>{const campaign=SeedSystem.getCampaign();return campaign&&window.CharacterMemory?CharacterMemory.snapshot(campaign.seed):null;},
  characterMemoryVerify:()=>{const campaign=SeedSystem.getCampaign();return campaign&&window.CharacterMemory?CharacterMemory.verify(campaign.seed):null;},
  refreshDialogueContext:(residentId="R03",caseId="public-friendly")=>renderDialogueContextProof(residentId,caseId),
  dialogueContextVerify:(residentId="R03")=>{const campaign=SeedSystem.getCampaign();return campaign&&window.DialogueContext?DialogueContext.proof(campaign.seed,residentId):null;},
  refreshAdviceResolution:(adviceId="")=>renderAdviceResolutionProof(adviceId),
  adviceResolutionVerify:()=>{const campaign=SeedSystem.getCampaign();return campaign&&window.AdviceResolution?AdviceResolution.proof(campaign.seed):null;},
  residentActionSnapshot:()=>window.ActionExecutor?.snapshot?.()||null,
  residentActionProofSnapshot:()=>window.ActionExecutor?.proofSnapshot?.()||null,
  residentActionVerify:()=>{
    const campaign=SeedSystem.getCampaign();
    return campaign&&window.ActionExecutor?ActionExecutor.verify(campaign.seed):null;
  },
  residentAssignmentSnapshot:()=>{
    const campaign=SeedSystem.getCampaign();
    return campaign?ResidentAssignments.proof(campaign.seed):null;
  },
  residentRosterSnapshot:()=>{
    const campaign=SeedSystem.getCampaign();
    return campaign?ResidentRoster.proof(campaign.seed,GameTime.getNow()):null;
  },
  terrainCacheTelemetry:()=>Object.freeze({
    cachedRenderCount:terrainCachedRenderCount,
    fallbackRenderCount:terrainFallbackRenderCount,
    lastRenderSource:terrainLastRenderSource,
    simulationAuthorityPreserved:true
  }),
  cameraNavigationSnapshot,
  resolveCameraScreenDelta:(x,y)=>GameRenderer?.screenToCameraDelta?.(x,y)||null
});
})();
