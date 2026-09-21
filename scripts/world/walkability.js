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

function classifyTile(tile){
  if(!tile)return null;
  const rule=ruleFor(tile.type);
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
    specialKind:tile.specialKind||null
  });
}

function classify(seed,x,y){
  return classifyTile(TerrainFoundation.getTile(seed,x,y));
}

function isWalkable(seed,x,y){
  return !!classify(seed,x,y)?.walkable;
}

function movementSeconds(seed,x,y){
  return classify(seed,x,y)?.secondsPerTile??Infinity;
}

function sampleStructureRules(seed){
  let wallSamples=0;
  let wallBlocked=0;
  let entranceSamples=0;
  let entranceWalkable=0;
  let interiorSamples=0;
  let interiorWalkable=0;
  let workyardSamples=0;
  let workyardWalkable=0;

  const housePlans=HousePlans.build(seed);
  for(const plan of housePlans){
    const b=plan.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const state=classify(seed,String(x),String(y));
        if(state.terrainType==="wall"){
          wallSamples++;
          if(!state.walkable&&state.category===CATEGORY.WALL)wallBlocked++;
        }else if(state.terrainType==="door"){
          entranceSamples++;
          if(state.walkable&&state.category===CATEGORY.ENTRANCE)entranceWalkable++;
        }else if(state.terrainType==="floor"){
          interiorSamples++;
          if(state.walkable&&state.category===CATEGORY.INTERIOR)interiorWalkable++;
        }
      }
    }
  }

  for(const lot of SpecialLots.build(seed)){
    const b=lot.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const state=classify(seed,String(x),String(y));
        if(lot.enterable){
          if(state.terrainType==="wall"){
            wallSamples++;
            if(!state.walkable&&state.category===CATEGORY.WALL)wallBlocked++;
          }else if(state.terrainType==="door"){
            entranceSamples++;
            if(state.walkable&&state.category===CATEGORY.ENTRANCE)entranceWalkable++;
          }else if(state.terrainType==="floor"){
            interiorSamples++;
            if(state.walkable&&state.category===CATEGORY.INTERIOR)interiorWalkable++;
          }
        }else{
          workyardSamples++;
          if(state.walkable&&state.category===CATEGORY.GROUND)workyardWalkable++;
        }
      }
    }
  }

  return Object.freeze({
    wallSamples,wallBlocked,
    entranceSamples,entranceWalkable,
    interiorSamples,interiorWalkable,
    workyardSamples,workyardWalkable,
    wallsPass:wallSamples>0&&wallBlocked===wallSamples,
    entrancesPass:entranceSamples>0&&entranceWalkable===entranceSamples,
    interiorsPass:interiorSamples>0&&interiorWalkable===interiorSamples,
    workyardPass:workyardSamples>0&&workyardWalkable===workyardSamples
  });
}

function proof(seed){
  const radius=30;
  let sampleCount=0;
  let deterministic=true;
  let classifiedCount=0;
  let blockedCount=0;
  let walkableCount=0;
  let waterSamples=0;
  let waterBlocked=0;
  const categories=new Set();

  for(let y=-radius;y<=radius;y+=2){
    for(let x=-radius;x<=radius;x+=2){
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
      structure.wallsPass&&
      structure.entrancesPass&&
      structure.interiorsPass&&
      structure.workyardPass
  });
}

window.Walkability=Object.freeze({
  CATEGORY,RULES,
  ruleFor,classifyTile,classify,isWalkable,movementSeconds,proof
});
})();