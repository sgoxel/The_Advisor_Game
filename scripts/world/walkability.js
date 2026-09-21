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

function classify(seed,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const tile=TerrainFoundation.getTile(seed,x,y);
  const cell=authoritativeBuildingCell(seed,x,y);

  if(cell){
    if(cell.type==="wall"){
      return stateFromRule(tile,RULES.wall,{barrierKind:"outer-wall"});
    }
    if(cell.type==="door"){
      return stateFromRule(tile,RULES.door,{doorwayKind:"exterior-door"});
    }
    if(cell.type==="floor"){
      if(typeof cell.overlayVariant==="string"&&cell.overlayVariant.startsWith("wall-")){
        return stateFromRule(tile,RULES.wall,{barrierKind:"interior-wall"});
      }
      if(typeof cell.overlayVariant==="string"&&cell.overlayVariant.startsWith("door-")){
        return stateFromRule(tile,RULES.door,{doorwayKind:"interior-door"});
      }
      return stateFromRule(tile,RULES.floor,null);
    }
    if(cell.type==="plot"){
      return stateFromRule(tile,RULES.plot,null);
    }
  }

  return classifyTile(tile);
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
  CATEGORY,RULES,
  ruleFor,classifyTile,classify,isWalkable,movementSeconds,proof
});
})();