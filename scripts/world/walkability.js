(function(){
"use strict";

const CATEGORY=Object.freeze({
  ROUTE:"road-path",
  GROUND:"walkable-ground",
  DIFFICULT:"difficult-ground",
  INTERIOR:"building-interior",
  ENTRANCE:"building-entrance",
  WALL:"blocked-wall",
  WATER:"blocked-water",
  SOLID:"blocked-solid"
});

const RULES=Object.freeze({
  road:Object.freeze({category:CATEGORY.ROUTE,walkable:true,speedKey:"road"}),
  bridge:Object.freeze({category:CATEGORY.ROUTE,walkable:true,speedKey:"bridge"}),
  square:Object.freeze({category:CATEGORY.ROUTE,walkable:true,speedKey:"square"}),
  path:Object.freeze({category:CATEGORY.ROUTE,walkable:true,speedKey:"path"}),
  grass:Object.freeze({category:CATEGORY.GROUND,walkable:true,speedKey:"grass"}),
  dirt:Object.freeze({category:CATEGORY.GROUND,walkable:true,speedKey:"dirt"}),
  farmland:Object.freeze({category:CATEGORY.GROUND,walkable:true,speedKey:"farmland"}),
  plot:Object.freeze({category:CATEGORY.GROUND,walkable:true,speedKey:"plot"}),
  forest:Object.freeze({category:CATEGORY.DIFFICULT,walkable:true,speedKey:"forest"}),
  mud:Object.freeze({category:CATEGORY.DIFFICULT,walkable:true,speedKey:"mud"}),
  rock:Object.freeze({category:CATEGORY.DIFFICULT,walkable:true,speedKey:"rock"}),
  sand:Object.freeze({category:CATEGORY.DIFFICULT,walkable:true,speedKey:"sand"}),
  floor:Object.freeze({category:CATEGORY.INTERIOR,walkable:true,speedKmh:3.0}),
  door:Object.freeze({category:CATEGORY.ENTRANCE,walkable:true,speedKmh:3.0}),
  wall:Object.freeze({category:CATEGORY.WALL,walkable:false,speedKmh:0}),
  water:Object.freeze({category:CATEGORY.WATER,walkable:false,speedKmh:0}),
  building:Object.freeze({category:CATEGORY.SOLID,walkable:false,speedKmh:0})
});

const SLOPE_POLICY=WorldStandards.SLOPE_POLICY;
const elevationCache=new Map();
let elevationQueries=0,elevationCacheHits=0,transitionQueries=0,slopeBlockedTransitions=0;
let totalElevationMs=0,maxElevationMs=0;

function rememberElevation(key,value){
  elevationCache.set(key,value);
  if(elevationCache.size>Number(SLOPE_POLICY.elevationCacheLimit||32768)){
    const oldest=elevationCache.keys().next().value;
    if(oldest!==undefined)elevationCache.delete(oldest);
  }
  return value;
}
function elevationSample(seed,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue),y=WorldCoordinates.normalize(yValue);
  const key=String(seed)+"|"+x+"|"+y;
  if(elevationCache.has(key)){
    elevationCacheHits++;
    const cached=elevationCache.get(key);
    elevationCache.delete(key);elevationCache.set(key,cached);
    return cached;
  }
  const started=performance.now();
  elevationQueries++;
  const sourceElevationMeters=Number(GeographyFoundation.environment(seed,x,y)?.elevationMeters||0);
  const movementElevationMeters=sourceElevationMeters*Number(SLOPE_POLICY.localVerticalScale||0.05);
  const elapsed=performance.now()-started;
  totalElevationMs+=elapsed;maxElevationMs=Math.max(maxElevationMs,elapsed);
  return rememberElevation(key,Object.freeze({
    x,y,sourceElevationMeters,movementElevationMeters,
    source:"GeographyFoundation.environment",
    rendererIndependent:true
  }));
}
function slopeClassFor(angleDegrees){
  const a=Math.max(0,Number(angleDegrees)||0),b=SLOPE_POLICY.bandsDegrees;
  if(a<=b.gentle)return "gentle";
  if(a<=b.moderate)return "moderate";
  if(a<=b.steep)return "steep";
  if(a<=b.verySteep)return "very-steep";
  return "cliff";
}
function slopeMultiplierFor(slopeClass){
  const m=SLOPE_POLICY.movementMultipliers;
  if(slopeClass==="moderate")return Number(m.moderate||1.18);
  if(slopeClass==="steep")return Number(m.steep||1.55);
  if(slopeClass==="very-steep")return Number(m.verySteep||2.30);
  if(slopeClass==="cliff")return Infinity;
  return Number(m.gentle||1);
}
function slopeBetween(seed,fromValue,toValue){
  const from=WorldCoordinates.position(fromValue.x,fromValue.y);
  const to=WorldCoordinates.position(toValue.x,toValue.y);
  const dx=Number(BigInt(to.x)-BigInt(from.x)),dy=Number(BigInt(to.y)-BigInt(from.y));
  if(!Number.isSafeInteger(dx)||!Number.isSafeInteger(dy)||Math.abs(dx)>1||Math.abs(dy)>1||(dx===0&&dy===0)){
    return Object.freeze({valid:false,reason:"non-adjacent",from,to});
  }
  const a=elevationSample(seed,from.x,from.y),b=elevationSample(seed,to.x,to.y);
  const horizontalMeters=WorldStandards.TILE_METERS*Math.hypot(dx,dy);
  const sourceDeltaMeters=b.sourceElevationMeters-a.sourceElevationMeters;
  const movementDeltaMeters=b.movementElevationMeters-a.movementElevationMeters;
  const angleDegrees=Math.atan2(Math.abs(movementDeltaMeters),Math.max(1e-9,horizontalMeters))*180/Math.PI;
  const slopeClass=slopeClassFor(angleDegrees);
  return Object.freeze({
    valid:true,from,to,dx,dy,diagonal:dx!==0&&dy!==0,
    fromSourceElevationMeters:a.sourceElevationMeters,
    toSourceElevationMeters:b.sourceElevationMeters,
    sourceDeltaMeters,
    movementDeltaMeters,
    horizontalMeters,
    gradePercent:Math.abs(movementDeltaMeters)/Math.max(1e-9,horizontalMeters)*100,
    angleDegrees,
    slopeClass,
    rendererIndependent:true
  });
}
function isConstructedRouteState(state){return state?.category===CATEGORY.ROUTE}
function isGradedPadState(state){
  return Boolean(
    state?.buildingId||
    state?.category===CATEGORY.INTERIOR||
    state?.category===CATEGORY.ENTRANCE||
    state?.terrainType==="plot"
  );
}
function naturalVerySteepAllowed(fromState,toState){
  const types=new Set([String(fromState?.terrainType||""),String(toState?.terrainType||"")]);
  if(types.has("mud")||types.has("sand")||types.has("farmland")||types.has("water"))return false;
  return types.has("rock");
}
function transitionCore(seed,from,to,fromState,toState){
  if(!fromState?.walkable||!toState?.walkable){
    return Object.freeze({allowed:false,reason:"blocked-cell",seconds:Infinity,multiplier:Infinity,slope:null});
  }
  const slope=slopeBetween(seed,from,to);
  if(!slope.valid)return Object.freeze({allowed:false,reason:slope.reason,seconds:Infinity,multiplier:Infinity,slope});
  const distanceFactor=slope.diagonal?Math.SQRT2:1;
  const gradedPad=isGradedPadState(fromState)||isGradedPadState(toState);
  if(gradedPad){
    return Object.freeze({
      allowed:true,reason:"graded-building-pad",
      seconds:Number(toState.secondsPerTile)*distanceFactor,
      multiplier:1,slope,gradedPad:true,engineered:false
    });
  }
  const engineered=isConstructedRouteState(fromState)&&isConstructedRouteState(toState);
  if(slope.slopeClass==="cliff"){
    slopeBlockedTransitions++;
    return Object.freeze({allowed:false,reason:"cliff",seconds:Infinity,multiplier:Infinity,slope,gradedPad:false,engineered});
  }
  if(engineered&&slope.angleDegrees>Number(SLOPE_POLICY.engineeredMaxDegrees||33)){
    slopeBlockedTransitions++;
    return Object.freeze({allowed:false,reason:"engineered-grade-limit",seconds:Infinity,multiplier:Infinity,slope,gradedPad:false,engineered:true});
  }
  if(!engineered&&slope.slopeClass==="very-steep"&&!naturalVerySteepAllowed(fromState,toState)){
    slopeBlockedTransitions++;
    return Object.freeze({allowed:false,reason:"unsafe-very-steep-terrain",seconds:Infinity,multiplier:Infinity,slope,gradedPad:false,engineered:false});
  }
  let multiplier=slopeMultiplierFor(slope.slopeClass);
  if(engineered)multiplier=1+(multiplier-1)*Number(SLOPE_POLICY.engineeredPenaltyBlend||0.45);
  return Object.freeze({
    allowed:true,reason:engineered?"engineered-slope":"natural-slope",
    seconds:Number(toState.secondsPerTile)*distanceFactor*multiplier,
    multiplier,slope,gradedPad:false,engineered
  });
}
function transition(seed,fromValue,toValue,options){
  transitionQueries++;
  const from=WorldCoordinates.position(fromValue.x,fromValue.y),to=WorldCoordinates.position(toValue.x,toValue.y);
  const fromState=options?.fromState||classify(seed,from.x,from.y);
  const toState=options?.toState||classify(seed,to.x,to.y);
  const direct=transitionCore(seed,from,to,fromState,toState);
  if(!direct.allowed||!direct.slope?.diagonal)return direct;
  const dx=direct.slope.dx,dy=direct.slope.dy;
  const sideA=WorldCoordinates.add(from,String(dx),"0");
  const sideB=WorldCoordinates.add(from,"0",String(dy));
  const sideAState=classify(seed,sideA.x,sideA.y),sideBState=classify(seed,sideB.x,sideB.y);
  const routeA=
    transitionCore(seed,from,sideA,fromState,sideAState).allowed&&
    transitionCore(seed,sideA,to,sideAState,toState).allowed;
  const routeB=
    transitionCore(seed,from,sideB,fromState,sideBState).allowed&&
    transitionCore(seed,sideB,to,sideBState,toState).allowed;
  if(!routeA&&!routeB){
    slopeBlockedTransitions++;
    return Object.freeze({...direct,allowed:false,reason:"diagonal-cliff-corner",seconds:Infinity,multiplier:Infinity,cornerSafe:false});
  }
  return Object.freeze({...direct,cornerSafe:true});
}
function transitionSeconds(seed,from,to,options){
  return transition(seed,from,to,options)?.seconds??Infinity;
}
function slopeStats(){
  return Object.freeze({
    policy:SLOPE_POLICY,
    elevationCacheEntries:elevationCache.size,
    elevationQueries,elevationCacheHits,
    elevationCacheHitRate:(elevationQueries+elevationCacheHits)>0?elevationCacheHits/(elevationQueries+elevationCacheHits):0,
    transitionQueries,slopeBlockedTransitions,
    totalElevationMs:Number(totalElevationMs.toFixed(3)),
    maxElevationMs:Number(maxElevationMs.toFixed(3)),
    averageElevationMs:Number((elevationQueries?totalElevationMs/elevationQueries:0).toFixed(4)),
    rendererIndependent:true
  });
}
function clearSlopeCache(){
  elevationCache.clear();
  elevationQueries=0;elevationCacheHits=0;transitionQueries=0;slopeBlockedTransitions=0;
  totalElevationMs=0;maxElevationMs=0;
}

function ruleFor(type){
  return RULES[type]||RULES.building;
}

function speedFor(rule){
  if(Number.isFinite(rule.speedKmh))return rule.speedKmh;
  return Number(WorldStandards.WALK_SPEED_KMH[rule.speedKey]||0);
}

function secondsPerTile(speedKmh){
  const speed=Number(speedKmh);
  if(speed<=0)return Infinity;
  const metersPerSecond=speed*1000/3600;
  return WorldStandards.TILE_METERS/metersPerSecond;
}

function stateFromRule(tile,rule,extra){
  const speedKmh=speedFor(rule);
  return Object.freeze({
    x:tile.x,
    y:tile.y,
    terrainType:tile.type,
    category:rule.category,
    walkable:rule.walkable,
    blocksMovement:!rule.walkable,
    speedKmh,
    secondsPerTile:rule.walkable?secondsPerTile(speedKmh):Infinity,
    buildingId:tile.buildingId||null,
    room:tile.room||null,
    specialKind:tile.specialKind||null,
    barrierKind:extra?.barrierKind||null,
    doorwayKind:extra?.doorwayKind||null
  });
}

function classifyTile(tile){
  if(!tile)return null;
  return stateFromRule(tile,ruleFor(tile.type),null);
}

function authoritativeBuildingCell(seed,x,y){
  const local=StartingVillage.local(seed,x,y);
  if(!local)return null;
  const house=HousePlans.buildingAt(seed,local);
  if(house)return house.cell;
  const special=SpecialLots.buildingAt(seed,local);
  if(special)return special.cell;
  return null;
}

function classifyPrepared(seed,tile){
  if(!tile)return null;
  if(tile.type==="wall"){
    return stateFromRule(tile,RULES.wall,{barrierKind:"outer-wall"});
  }
  if(tile.type==="door"){
    return stateFromRule(tile,RULES.door,{doorwayKind:"exterior-door"});
  }
  if(tile.type==="floor"){
    const overlay=String(tile.overlayTextureKey||"").toLowerCase();
    if(overlay.includes("wall-")){
      return stateFromRule(tile,RULES.wall,{barrierKind:"interior-wall"});
    }
    if(overlay.includes("door-")){
      return stateFromRule(tile,RULES.door,{doorwayKind:"interior-door"});
    }
    return stateFromRule(tile,RULES.floor,null);
  }
  if(tile.type==="plot"){
    return stateFromRule(tile,RULES.plot,null);
  }
  return classifyTile(tile);
}

function classify(seed,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const tile=TerrainFoundation.getTile(seed,x,y);
  return classifyPrepared(seed,tile);
}

function isWalkable(seed,x,y){
  return !!classify(seed,x,y)?.walkable;
}

function movementSeconds(seed,x,y){
  return classify(seed,x,y)?.secondsPerTile??Infinity;
}

function sampleStructureRules(seed){
  let outerWallSamples=0;
  let outerWallsBlocked=0;
  let exteriorDoorSamples=0;
  let exteriorDoorsWalkable=0;
  let interiorFloorSamples=0;
  let interiorFloorsWalkable=0;
  let interiorWallSamples=0;
  let interiorWallsBlocked=0;
  let interiorDoorSamples=0;
  let interiorDoorsWalkable=0;
  let workyardSamples=0;
  let workyardWalkable=0;
  let accessTargetSamples=0;
  let accessTargetsWalkable=0;

  function inspectCell(cell,state){
    if(cell.type==="wall"){
      outerWallSamples++;
      if(!state.walkable&&state.category===CATEGORY.WALL&&state.barrierKind==="outer-wall")outerWallsBlocked++;
      return;
    }
    if(cell.type==="door"){
      exteriorDoorSamples++;
      if(state.walkable&&state.category===CATEGORY.ENTRANCE&&state.doorwayKind==="exterior-door")exteriorDoorsWalkable++;
      return;
    }
    if(cell.type==="floor"){
      if(typeof cell.overlayVariant==="string"&&cell.overlayVariant.startsWith("wall-")){
        interiorWallSamples++;
        if(!state.walkable&&state.category===CATEGORY.WALL&&state.barrierKind==="interior-wall")interiorWallsBlocked++;
      }else if(typeof cell.overlayVariant==="string"&&cell.overlayVariant.startsWith("door-")){
        interiorDoorSamples++;
        if(state.walkable&&state.category===CATEGORY.ENTRANCE&&state.doorwayKind==="interior-door")interiorDoorsWalkable++;
      }else{
        interiorFloorSamples++;
        if(state.walkable&&state.category===CATEGORY.INTERIOR)interiorFloorsWalkable++;
      }
    }
  }

  for(const plan of HousePlans.build(seed)){
    const b=plan.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const local=StartingVillage.local(seed,String(x),String(y));
        const cell=HousePlans.cellAt(seed,local);
        if(cell)inspectCell(cell,classify(seed,String(x),String(y)));
      }
    }
    if(plan.entrance?.target){
      accessTargetSamples++;
      if(classify(seed,String(plan.entrance.target.x),String(plan.entrance.target.y))?.walkable)accessTargetsWalkable++;
    }
  }

  for(const lot of SpecialLots.build(seed)){
    const b=lot.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const local=StartingVillage.local(seed,String(x),String(y));
        const cell=SpecialLots.cellAt(seed,local);
        if(!cell)continue;
        const state=classify(seed,String(x),String(y));
        if(lot.enterable){
          inspectCell(cell,state);
        }else{
          workyardSamples++;
          if(state.walkable&&state.category===CATEGORY.GROUND)workyardWalkable++;
        }
      }
    }
    if(lot.access?.target){
      accessTargetSamples++;
      if(classify(seed,String(lot.access.target.x),String(lot.access.target.y))?.walkable)accessTargetsWalkable++;
    }
  }

  return Object.freeze({
    outerWallSamples,outerWallsBlocked,
    exteriorDoorSamples,exteriorDoorsWalkable,
    interiorFloorSamples,interiorFloorsWalkable,
    interiorWallSamples,interiorWallsBlocked,
    interiorDoorSamples,interiorDoorsWalkable,
    workyardSamples,workyardWalkable,
    accessTargetSamples,accessTargetsWalkable,
    outerWallsPass:outerWallSamples>0&&outerWallsBlocked===outerWallSamples,
    exteriorDoorsPass:exteriorDoorSamples>0&&exteriorDoorsWalkable===exteriorDoorSamples,
    interiorsPass:interiorFloorSamples>0&&interiorFloorsWalkable===interiorFloorSamples,
    interiorWallsPass:interiorWallSamples>0&&interiorWallsBlocked===interiorWallSamples,
    interiorDoorsPass:interiorDoorSamples>0&&interiorDoorsWalkable===interiorDoorSamples,
    workyardPass:workyardSamples>0&&workyardWalkable===workyardSamples,
    accessTargetsPass:accessTargetSamples>0&&accessTargetsWalkable===accessTargetSamples
  });
}

function proof(seed){
  const radius=34;
  let sampleCount=0;
  let deterministic=true;
  let classifiedCount=0;
  let blockedCount=0;
  let walkableCount=0;
  let waterSamples=0;
  let waterBlocked=0;
  const categories=new Set();

  for(let y=-radius;y<=radius;y++){
    for(let x=-radius;x<=radius;x++){
      const a=classify(seed,String(x),String(y));
      const b=classify(seed,String(x),String(y));
      sampleCount++;
      if(JSON.stringify(a)!==JSON.stringify(b))deterministic=false;
      if(a&&a.category){
        classifiedCount++;
        categories.add(a.category);
      }
      if(a?.walkable)walkableCount++;
      else blockedCount++;
      if(a?.terrainType==="water"){
        waterSamples++;
        if(!a.walkable&&a.category===CATEGORY.WATER)waterBlocked++;
      }
    }
  }

  const structure=sampleStructureRules(seed);
  const routeTypes=["road","bridge","square","path"];
  const routeRulesPass=routeTypes.every(type=>{
    const rule=ruleFor(type);
    return rule.walkable&&rule.category===CATEGORY.ROUTE&&speedFor(rule)>0;
  });
  const difficultTypes=["forest","mud","rock","sand"];
  const difficultRulesPass=difficultTypes.every(type=>{
    const rule=ruleFor(type);
    return rule.walkable&&rule.category===CATEGORY.DIFFICULT&&speedFor(rule)>0;
  });
  const waterRule=ruleFor("water");
  const waterRulePass=!waterRule.walkable&&waterRule.category===CATEGORY.WATER&&speedFor(waterRule)===0;
  const classificationCoverage=classifiedCount===sampleCount;

  return Object.freeze({
    deterministic,
    sampleCount,
    classifiedCount,
    classificationCoverage,
    walkableCount,
    blockedCount,
    categories:Object.freeze([...categories].sort()),
    waterSamples,
    waterBlocked,
    waterRulePass,
    routeRulesPass,
    difficultRulesPass,
    structure,
    pass:
      deterministic&&
      classificationCoverage&&
      routeRulesPass&&
      difficultRulesPass&&
      waterRulePass&&
      (waterSamples===0||waterBlocked===waterSamples)&&
      structure.outerWallsPass&&
      structure.exteriorDoorsPass&&
      structure.interiorsPass&&
      structure.interiorWallsPass&&
      structure.interiorDoorsPass&&
      structure.workyardPass&&
      structure.accessTargetsPass
  });
}

window.Walkability=Object.freeze({
  CATEGORY,RULES,SLOPE_POLICY,
  ruleFor,classifyTile,classifyPrepared,classify,isWalkable,movementSeconds,
  elevationSample,slopeBetween,transition,transitionSeconds,slopeStats,clearSlopeCache,proof
});
})();