(function(){
"use strict";

const LEVEL=0;
const TILE_AREA_M2=WorldStandards.TILE_METERS*WorldStandards.TILE_METERS;
const modelCache=new Map();
const proofCache=new Map();

function point(x,y){
  const p=WorldCoordinates.position(String(x),String(y));
  return Object.freeze({x:p.x,y:p.y,level:LEVEL});
}

function manhattan(a,b){
  if(!a||!b)return Infinity;
  return Number((BigInt(a.x)>BigInt(b.x)?BigInt(a.x)-BigInt(b.x):BigInt(b.x)-BigInt(a.x))+
    (BigInt(a.y)>BigInt(b.y)?BigInt(a.y)-BigInt(b.y):BigInt(b.y)-BigInt(a.y)));
}

function neighborFromDoor(door,inside){
  const delta={
    N:inside?{x:0,y:1}:{x:0,y:-1},
    S:inside?{x:0,y:-1}:{x:0,y:1},
    W:inside?{x:1,y:0}:{x:-1,y:0},
    E:inside?{x:-1,y:0}:{x:1,y:0}
  }[door.side];
  return point(BigInt(door.x)+BigInt(delta.x),BigInt(door.y)+BigInt(delta.y));
}

function houseSources(seed){
  return HousePlans.build(seed).map(plan=>Object.freeze({
    id:plan.id,
    source:"house",
    kind:plan.kind,
    label:(plan.kind==="cabin"?"Cabin ":"House ")+plan.id,
    bounds:plan.bounds,
    entrance:plan.entrance,
    roomDefinitions:plan.rooms,
    cellAt:(x,y)=>HousePlans.cellAt(seed,StartingVillage.local(seed,String(x),String(y)))
  }));
}

function specialSources(seed){
  return SpecialLots.build(seed)
    .filter(lot=>lot.enterable)
    .map(lot=>Object.freeze({
      id:lot.id,
      source:"special",
      kind:lot.kind,
      label:lot.label,
      bounds:lot.bounds,
      entrance:lot.access,
      roomDefinitions:Object.freeze([
        Object.freeze({
          id:lot.function,
          label:lot.label+" Interior",
          floorTiles:Math.max(0,(lot.bounds.w-2)*(lot.bounds.h-2))
        })
      ]),
      cellAt:(x,y)=>SpecialLots.cellAt(seed,StartingVillage.local(seed,String(x),String(y)))
    }));
}

function describe(seed,source){
  const exteriorWalls=[];
  const interiorWalls=[];
  const exteriorDoors=[];
  const interiorDoors=[];
  const interiorFloors=[];
  const cells=[];
  const roomCounts=new Map();

  for(let y=source.bounds.minY;y<=source.bounds.maxY;y++){
    for(let x=source.bounds.minX;x<=source.bounds.maxX;x++){
      const cell=source.cellAt(x,y);
      if(!cell)continue;
      const state=Walkability.classify(seed,String(x),String(y));
      const record=Object.freeze({
        x:String(x),
        y:String(y),
        level:LEVEL,
        type:cell.type,
        room:cell.room||null,
        walkable:Boolean(state?.walkable),
        category:state?.category||null,
        barrierKind:state?.barrierKind||null,
        doorwayKind:state?.doorwayKind||null
      });
      cells.push(record);

      if(state?.barrierKind==="outer-wall")exteriorWalls.push(record);
      else if(state?.barrierKind==="interior-wall")interiorWalls.push(record);
      else if(state?.doorwayKind==="exterior-door")exteriorDoors.push(record);
      else if(state?.doorwayKind==="interior-door")interiorDoors.push(record);
      else if(state?.category===Walkability.CATEGORY.INTERIOR&&state?.walkable){
        interiorFloors.push(record);
        if(record.room)roomCounts.set(record.room,(roomCounts.get(record.room)||0)+1);
      }
    }
  }

  const door=source.entrance?point(source.entrance.x,source.entrance.y):null;
  const outdoorAccess=source.entrance?.target
    ?point(source.entrance.target.x,source.entrance.target.y)
    :null;
  const immediateInside=door?neighborFromDoor({...door,side:source.entrance.side},true):null;
  const immediateOutside=door?neighborFromDoor({...door,side:source.entrance.side},false):null;

  const interiorTarget=interiorFloors.slice().sort((a,b)=>{
    const distance=manhattan(a,door)-manhattan(b,door);
    if(distance)return distance;
    const y=BigInt(a.y)-BigInt(b.y);
    if(y!==0n)return y<0n?-1:1;
    const x=BigInt(a.x)-BigInt(b.x);
    return x<0n?-1:x>0n?1:0;
  })[0]||null;

  const rooms=source.roomDefinitions.map(def=>Object.freeze({
    id:def.id,
    label:def.label,
    level:LEVEL,
    plannedFloorTiles:Number(def.floorTiles||0),
    plannedAreaM2:Number(def.floorTiles||0)*TILE_AREA_M2,
    walkableFloorTiles:roomCounts.get(def.id)||0,
    walkableAreaM2:(roomCounts.get(def.id)||0)*TILE_AREA_M2
  }));

  return Object.freeze({
    id:source.id,
    source:source.source,
    kind:source.kind,
    label:source.label,
    level:LEVEL,
    bounds:source.bounds,
    entrance:Object.freeze({
      door,
      side:source.entrance?.side||null,
      outdoorAccess,
      immediateInside,
      immediateOutside
    }),
    rooms:Object.freeze(rooms),
    cells:Object.freeze(cells),
    interiorFloorCells:Object.freeze(interiorFloors),
    exteriorWallCells:Object.freeze(exteriorWalls),
    interiorWallCells:Object.freeze(interiorWalls),
    exteriorDoorCells:Object.freeze(exteriorDoors),
    interiorDoorCells:Object.freeze(interiorDoors),
    interiorTarget:interiorTarget?point(interiorTarget.x,interiorTarget.y):null
  });
}

function buildFresh(seed){
  const key=String(seed);
  const sources=[...houseSources(key),...specialSources(key)];
  return Object.freeze(sources.map(source=>describe(key,source)));
}

function build(seed){
  const key=String(seed);
  if(!modelCache.has(key))modelCache.set(key,buildFresh(key));
  return modelCache.get(key);
}

function get(seed,id){
  return build(seed).find(item=>item.id===id)||null;
}

function samePoint(a,b){
  return !!a&&!!b&&a.x===b.x&&a.y===b.y&&a.level===b.level;
}

function routeContains(route,target){
  return Boolean(route?.found&&target&&route.path.some(p=>p.x===target.x&&p.y===target.y));
}

function routeWalkable(seed,route){
  return Boolean(route?.found&&route.path.every(p=>Walkability.classify(seed,p.x,p.y)?.walkable));
}

function buildingProof(seed,interior){
  const outside=interior.entrance.outdoorAccess;
  const door=interior.entrance.door;
  const inside=interior.entrance.immediateInside;
  const immediateOutside=interior.entrance.immediateOutside;
  const target=interior.interiorTarget;

  const outsideState=outside?Walkability.classify(seed,outside.x,outside.y):null;
  const doorState=door?Walkability.classify(seed,door.x,door.y):null;
  const insideState=inside?Walkability.classify(seed,inside.x,inside.y):null;
  const immediateOutsideState=immediateOutside?Walkability.classify(seed,immediateOutside.x,immediateOutside.y):null;

  const forward=outside&&target?RoutePlanner.findRoute(seed,outside,target):null;
  const reverse=outside&&target?RoutePlanner.findRoute(seed,target,outside):null;

  const wallsBlocked=[...interior.exteriorWallCells,...interior.interiorWallCells]
    .every(cell=>!Walkability.classify(seed,cell.x,cell.y)?.walkable);
  const floorsWalkable=interior.interiorFloorCells.length>0&&
    interior.interiorFloorCells.every(cell=>Walkability.classify(seed,cell.x,cell.y)?.walkable);
  const doorsWalkable=interior.exteriorDoorCells.length===1&&
    [...interior.exteriorDoorCells,...interior.interiorDoorCells]
      .every(cell=>Walkability.classify(seed,cell.x,cell.y)?.walkable);
  const levelPass=interior.level===0&&interior.cells.every(cell=>cell.level===0)&&
    interior.rooms.every(room=>room.level===0);
  const continuousDoor=Boolean(
    door&&inside&&immediateOutside&&
    doorState?.walkable&&doorState?.doorwayKind==="exterior-door"&&
    insideState?.walkable&&
    immediateOutsideState?.walkable&&
    manhattan(door,inside)===1&&
    manhattan(door,immediateOutside)===1
  );
  const forwardPass=Boolean(
    forward?.found&&routeContains(forward,door)&&routeWalkable(seed,forward)
  );
  const reversePass=Boolean(
    reverse?.found&&routeContains(reverse,door)&&routeWalkable(seed,reverse)
  );
  const outdoorAccessPass=Boolean(
    outsideState?.walkable&&outsideState?.category===Walkability.CATEGORY.ROUTE
  );
  const roomPass=interior.rooms.length>0&&interior.rooms.every(room=>
    room.plannedFloorTiles>0&&room.plannedAreaM2===room.plannedFloorTiles*TILE_AREA_M2
  );

  return Object.freeze({
    id:interior.id,
    source:interior.source,
    kind:interior.kind,
    label:interior.label,
    level:interior.level,
    entrance:interior.entrance,
    interiorTarget:interior.interiorTarget,
    roomCount:interior.rooms.length,
    rooms:interior.rooms,
    interiorFloorCount:interior.interiorFloorCells.length,
    exteriorWallCount:interior.exteriorWallCells.length,
    interiorWallCount:interior.interiorWallCells.length,
    interiorDoorCount:interior.interiorDoorCells.length,
    floorsWalkable,
    doorsWalkable,
    wallsBlocked,
    levelPass,
    continuousDoor,
    outdoorAccessPass,
    forwardPass,
    reversePass,
    forwardSteps:forward?.stepCount??0,
    reverseSteps:reverse?.stepCount??0,
    forwardRoute:forward,
    reverseRoute:reverse,
    pass:
      floorsWalkable&&doorsWalkable&&wallsBlocked&&levelPass&&continuousDoor&&
      outdoorAccessPass&&roomPass&&forwardPass&&reversePass
  });
}

function proof(seed){
  const key=String(seed);
  if(proofCache.has(key))return proofCache.get(key);

  const first=buildFresh(key);
  const second=buildFresh(key);
  const deterministic=JSON.stringify(first)===JSON.stringify(second);
  const buildings=Object.freeze(first.map(interior=>buildingProof(key,interior)));
  const houseCount=buildings.filter(item=>item.source==="house").length;
  const specialCount=buildings.filter(item=>item.source==="special").length;
  const representativeHouse=buildings.find(item=>item.source==="house")||null;
  const representativeSpecial=buildings.find(item=>item.source==="special")||null;
  const allLevelZero=buildings.every(item=>item.levelPass);
  const allConnected=buildings.every(item=>item.continuousDoor);
  const allForward=buildings.every(item=>item.forwardPass);
  const allReverse=buildings.every(item=>item.reversePass);
  const allWallsBlocked=buildings.every(item=>item.wallsBlocked);
  const allFloorsDoorsWalkable=buildings.every(item=>item.floorsWalkable&&item.doorsWalkable);
  const allPass=buildings.length===12&&houseCount===6&&specialCount===6&&
    buildings.every(item=>item.pass);

  const result=Object.freeze({
    pass:deterministic&&allPass,
    deterministic,
    level:LEVEL,
    tileAreaM2:TILE_AREA_M2,
    buildingCount:buildings.length,
    houseCount,
    specialBuildingCount:specialCount,
    allLevelZero,
    allConnected,
    allForward,
    allReverse,
    allWallsBlocked,
    allFloorsDoorsWalkable,
    buildings,
    representativeHouse,
    representativeSpecial
  });
  proofCache.set(key,result);
  return result;
}

window.BuildingInteriors=Object.freeze({
  LEVEL,TILE_AREA_M2,
  build,get,proof
});
})();