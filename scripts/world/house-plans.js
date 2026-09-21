(function(){
"use strict";

const planCache=new Map();

function entranceCandidates(bounds){
  const out=[];
  for(let x=bounds.minX+1;x<=bounds.maxX-1;x++){
    out.push({x,y:bounds.minY,side:"N"});
    out.push({x,y:bounds.maxY,side:"S"});
  }
  for(let y=bounds.minY+1;y<=bounds.maxY-1;y++){
    out.push({x:bounds.minX,y,side:"W"});
    out.push({x:bounds.maxX,y,side:"E"});
  }
  return out;
}

function roadTargets(seed,bounds){
  const out=[];
  for(let y=bounds.minY-3;y<=bounds.maxY+3;y++){
    for(let x=bounds.minX-3;x<=bounds.maxX+3;x++){
      const inside=x>=bounds.minX&&x<=bounds.maxX&&y>=bounds.minY&&y<=bounds.maxY;
      if(inside)continue;
      const l=StartingVillage.local(seed,String(x),String(y));
      if(l&&StartingVillage.isRoadReserved(seed,l))out.push({x,y});
    }
  }
  return out;
}

function chooseEntrance(seed,plot){
  let best=null;
  for(const door of entranceCandidates(plot.bounds)){
    for(const target of roadTargets(seed,plot.bounds)){
      const distance=Math.abs(door.x-target.x)+Math.abs(door.y-target.y);
      if(distance>5)continue;
      const score=PRNG.foundationUint32(
        seed,
        "wp007b:entry:"+plot.id+":"+door.x+":"+door.y+":"+target.x+":"+target.y
      );
      if(!best||distance<best.distance||(distance===best.distance&&score>best.score)){
        best={door,target,distance,score};
      }
    }
  }
  if(!best)return null;
  return Object.freeze({
    x:best.door.x,
    y:best.door.y,
    side:best.door.side,
    target:Object.freeze({x:best.target.x,y:best.target.y}),
    accessLengthTiles:best.distance
  });
}

function build(seed){
  if(planCache.has(seed))return planCache.get(seed);
  const plans=StartingVillage.buildPlots(seed).map((plot,index)=>{
    const bounds=plot.bounds;
    const interior=Object.freeze({
      minX:bounds.minX+1,
      maxX:bounds.maxX-1,
      minY:bounds.minY+1,
      maxY:bounds.maxY-1
    });
    const interiorWidth=interior.maxX-interior.minX+1;
    const interiorHeight=interior.maxY-interior.minY+1;
    const floorTiles=interiorWidth*interiorHeight;
    const kind=(index%3===2)?"cabin":"house";
    const entrance=chooseEntrance(seed,plot);
    const partitionAxis=interiorWidth>=interiorHeight?"x":"y";
    let split=null;
    let interiorDoor=null;
    let rooms;

    if(kind==="house"){
      if(partitionAxis==="x"){
        split=interior.minX+Math.floor(interiorWidth/2)-1;
        interiorDoor=Object.freeze({
          x:split,
          y:interior.minY+Math.floor(interiorHeight/2),
          side:"E"
        });
        const first=(split-interior.minX+1)*interiorHeight;
        rooms=Object.freeze([
          Object.freeze({id:"living",label:"Living Room",floorTiles:first}),
          Object.freeze({id:"bedroom",label:"Bedroom",floorTiles:floorTiles-first})
        ]);
      }else{
        split=interior.minY+Math.floor(interiorHeight/2)-1;
        interiorDoor=Object.freeze({
          x:interior.minX+Math.floor(interiorWidth/2),
          y:split,
          side:"S"
        });
        const first=interiorWidth*(split-interior.minY+1);
        rooms=Object.freeze([
          Object.freeze({id:"living",label:"Living Room",floorTiles:first}),
          Object.freeze({id:"bedroom",label:"Bedroom",floorTiles:floorTiles-first})
        ]);
      }
    }else{
      rooms=Object.freeze([
        Object.freeze({id:"cabin",label:"Cabin Room",floorTiles})
      ]);
    }

    return Object.freeze({
      id:"H"+(index+1),
      plotId:plot.id,
      kind,
      bounds,
      interior,
      floorTiles,
      entrance,
      partitionAxis,
      split,
      interiorDoor,
      rooms
    });
  });
  const frozen=Object.freeze(plans);
  planCache.set(seed,frozen);
  return frozen;
}

function forPlot(seed,plotId){
  return build(seed).find(plan=>plan.plotId===plotId)||null;
}

function wallVariant(bounds,x,y){
  const n=y===bounds.minY;
  const e=x===bounds.maxX;
  const s=y===bounds.maxY;
  const w=x===bounds.minX;
  if(n&&e)return "wall-corner-ne";
  if(e&&s)return "wall-corner-se";
  if(s&&w)return "wall-corner-sw";
  if(w&&n)return "wall-corner-nw";
  if(n)return "wall-n";
  if(e)return "wall-e";
  if(s)return "wall-s";
  if(w)return "wall-w";
  return "wall-n";
}

function cellAt(seed,l){
  if(!l)return null;
  const plot=StartingVillage.plotAt(seed,l);
  if(!plot)return null;
  const plan=forPlot(seed,plot.id);
  if(!plan)return null;
  const b=plan.bounds;
  const border=l.x===b.minX||l.x===b.maxX||l.y===b.minY||l.y===b.maxY;

  if(border){
    if(plan.entrance&&l.x===plan.entrance.x&&l.y===plan.entrance.y){
      return Object.freeze({
        type:"door",
        textureVariant:"door-"+plan.entrance.side.toLowerCase(),
        overlayVariant:null,
        room:null,
        plan
      });
    }
    return Object.freeze({
      type:"wall",
      textureVariant:wallVariant(b,l.x,l.y),
      overlayVariant:null,
      room:null,
      plan
    });
  }

  let room=plan.rooms[0].id;
  let overlayVariant=null;
  if(plan.kind==="house"){
    if(plan.partitionAxis==="x"){
      room=l.x<=plan.split?"living":"bedroom";
      if(l.x===plan.split){
        overlayVariant=(plan.interiorDoor&&l.y===plan.interiorDoor.y)?"door-e":"wall-e";
      }
    }else{
      room=l.y<=plan.split?"living":"bedroom";
      if(l.y===plan.split){
        overlayVariant=(plan.interiorDoor&&l.x===plan.interiorDoor.x)?"door-s":"wall-s";
      }
    }
  }

  return Object.freeze({
    type:"floor",
    textureVariant:"floor-wood",
    overlayVariant,
    room,
    plan
  });
}

function buildingAt(seed,l){
  const cell=cellAt(seed,l);
  if(!cell)return null;
  return Object.freeze({
    phase:"buildings",
    type:cell.type,
    cell,
    plan:cell.plan,
    plot:StartingVillage.plotAt(seed,l)
  });
}

function proof(seed){
  const first=build(seed);
  const repeated=build(seed);
  let cabinCount=0;
  let normalHouseCount=0;
  let roomsPass=true;
  let outerWallsPass=true;
  let interiorWallsPass=true;
  let entrancesPass=true;
  let minimumRoomTiles=Infinity;

  for(const plan of first){
    if(plan.kind==="cabin")cabinCount++;
    else normalHouseCount++;

    for(const room of plan.rooms){
      minimumRoomTiles=Math.min(minimumRoomTiles,room.floorTiles);
      if(room.floorTiles<6)roomsPass=false;
    }

    if(plan.kind==="house"){
      const ids=new Set(plan.rooms.map(room=>room.id));
      if(!ids.has("living")||!ids.has("bedroom"))roomsPass=false;
      if(!plan.interiorDoor)interiorWallsPass=false;
    }

    if(!plan.entrance||plan.entrance.accessLengthTiles>5)entrancesPass=false;

    const b=plan.bounds;
    for(let y=b.minY;y<=b.maxY;y++){
      for(let x=b.minX;x<=b.maxX;x++){
        const border=x===b.minX||x===b.maxX||y===b.minY||y===b.maxY;
        if(!border)continue;
        const l=StartingVillage.local(seed,String(x),String(y));
        const cell=cellAt(seed,l);
        if(!cell||(cell.type!=="wall"&&cell.type!=="door"))outerWallsPass=false;
      }
    }
  }

  const deterministic=JSON.stringify(first)===JSON.stringify(repeated);
  const pass=
    deterministic&&
    first.length===6&&
    cabinCount>0&&
    normalHouseCount>0&&
    roomsPass&&
    outerWallsPass&&
    interiorWallsPass&&
    entrancesPass;

  return Object.freeze({
    deterministic,
    buildingCount:first.length,
    cabinCount,
    normalHouseCount,
    minimumRoomTiles:Number.isFinite(minimumRoomTiles)?minimumRoomTiles:0,
    roomsPass,
    outerWallsPass,
    interiorWallsPass,
    entrancesPass,
    pass
  });
}

window.HousePlans=Object.freeze({build,forPlot,cellAt,buildingAt,proof});
})();