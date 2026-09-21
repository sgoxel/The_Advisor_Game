(function(){
"use strict";

const structureCache=new Map();
const lotCache=new Map();

const STRUCTURE_TYPES=Object.freeze([
  Object.freeze({kind:"civic",label:"Village Hall",w:5,h:5,minRadius:6,maxRadius:13,floorVariant:"floor-stone",markerVariant:"marker-civic",room:"hall"}),
  Object.freeze({kind:"shop",label:"Market Shop",w:6,h:5,minRadius:8,maxRadius:17,floorVariant:"floor-stone",markerVariant:"marker-shop",room:"shop-floor"}),
  Object.freeze({kind:"tavern",label:"Tavern / Lodging",w:7,h:6,minRadius:8,maxRadius:19,floorVariant:"floor-wood",markerVariant:"marker-tavern",room:"common-room"}),
  Object.freeze({kind:"workshop",label:"Craft Workshop",w:6,h:5,minRadius:12,maxRadius:21,floorVariant:"floor-workshop",markerVariant:"marker-workshop",room:"work-floor"}),
  Object.freeze({kind:"barn",label:"Barn / Storage",w:7,h:5,minRadius:15,maxRadius:22,floorVariant:"floor-barn",markerVariant:"marker-barn",room:"storage"})
]);

const LOT_TYPES=Object.freeze([
  Object.freeze({kind:"market-yard",label:"Market Yard",w:4,h:3,nearKind:"shop",maxTargetDistance:10,minRadius:7,maxRadius:18}),
  Object.freeze({kind:"timber-yard",label:"Timber / Work Yard",w:5,h:3,nearKind:"workshop",maxTargetDistance:12,minRadius:13,maxRadius:22})
]);

function bounds(cx,cy,w,h){
  const minX=cx-Math.floor(w/2);
  const minY=cy-Math.floor(h/2);
  return Object.freeze({
    minX,minY,
    maxX:minX+w-1,
    maxY:minY+h-1,
    w,h
  });
}

function overlap(a,b,padding){
  const p=padding||0;
  return !(
    a.maxX+p<b.minX||
    b.maxX+p<a.minX||
    a.maxY+p<b.minY||
    b.maxY+p<a.minY
  );
}

function centerDistance(a,b){
  return Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy);
}

function surfaceType(seed,x,y){
  const l=StartingVillage.local(seed,String(x),String(y));
  if(!l)return "water";
  const base=GeographyFoundation.getTerrainType(seed,String(x),String(y));
  return StartingVillage.resolveTerrain(seed,l,base);
}

function roadTargets(seed,b){
  const out=[];
  for(let y=b.minY-5;y<=b.maxY+5;y++){
    for(let x=b.minX-5;x<=b.maxX+5;x++){
      const inside=x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY;
      if(inside)continue;
      const l=StartingVillage.local(seed,String(x),String(y));
      if(l&&StartingVillage.isRoadReserved(seed,l))out.push({x,y});
    }
  }
  return out;
}

function entranceCandidates(b){
  const out=[];
  for(let x=b.minX+1;x<=b.maxX-1;x++){
    out.push({x,y:b.minY,side:"N"});
    out.push({x,y:b.maxY,side:"S"});
  }
  for(let y=b.minY+1;y<=b.maxY-1;y++){
    out.push({x:b.minX,y,side:"W"});
    out.push({x:b.maxX,y,side:"E"});
  }
  return out;
}

function chooseEntrance(seed,id,b){
  let best=null;
  const targets=roadTargets(seed,b);
  for(const door of entranceCandidates(b)){
    for(const target of targets){
      const distance=Math.abs(door.x-target.x)+Math.abs(door.y-target.y);
      if(distance>5)continue;
      const score=PRNG.foundationUint32(
        seed,
        "wp008:entrance:"+id+":"+door.x+":"+door.y+":"+target.x+":"+target.y
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

function candidateCellsValid(seed,b){
  for(let y=b.minY;y<=b.maxY;y++){
    for(let x=b.minX;x<=b.maxX;x++){
      const l=StartingVillage.local(seed,String(x),String(y));
      if(!l||l.radius>23)return false;
      if(StartingVillage.isRoadReserved(seed,l))return false;
      if(StartingVillage.plotAt(seed,l))return false;
      if(surfaceType(seed,x,y)==="water")return false;
    }
  }
  return true;
}

function plotPaddingClear(seed,b,padding){
  for(const plot of StartingVillage.buildPlots(seed)){
    if(overlap(b,plot.bounds,padding))return false;
  }
  return true;
}

function buildStructures(seed){
  if(structureCache.has(seed))return structureCache.get(seed);
  const accepted=[];

  for(const def of STRUCTURE_TYPES){
    const candidates=[];
    for(let y=-22;y<=22;y++){
      for(let x=-22;x<=22;x++){
        const radius=Math.hypot(x,y);
        if(radius<def.minRadius||radius>def.maxRadius)continue;
        const rotate=(PRNG.foundationUint32(seed,"wp008:rotate:"+def.kind+":"+x+":"+y)&1)===1;
        const w=rotate?def.h:def.w;
        const h=rotate?def.w:def.h;
        const b=bounds(x,y,w,h);
        const score=PRNG.foundationUint32(seed,"wp008:candidate:"+def.kind+":"+x+":"+y);
        candidates.push({x,y,w,h,b,score});
      }
    }
    candidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);

    let chosen=null;
    for(const candidate of candidates){
      if(!candidateCellsValid(seed,candidate.b))continue;
      if(!plotPaddingClear(seed,candidate.b,1))continue;
      if(accepted.some(plan=>overlap(candidate.b,plan.bounds,1)))continue;
      const entrance=chooseEntrance(seed,def.kind,candidate.b);
      if(!entrance)continue;
      chosen=Object.freeze({
        id:"S"+(accepted.length+1),
        kind:def.kind,
        label:def.label,
        cx:candidate.x,
        cy:candidate.y,
        w:candidate.w,
        h:candidate.h,
        bounds:candidate.b,
        entrance,
        floorVariant:def.floorVariant,
        markerVariant:def.markerVariant,
        room:def.room,
        phase:"buildings"
      });
      break;
    }
    if(chosen)accepted.push(chosen);
  }

  const frozen=Object.freeze(accepted);
  structureCache.set(seed,frozen);
  return frozen;
}

function buildLots(seed){
  if(lotCache.has(seed))return lotCache.get(seed);
  const structures=buildStructures(seed);
  const accepted=[];

  for(const def of LOT_TYPES){
    const target=structures.find(plan=>plan.kind===def.nearKind)||null;
    const candidates=[];
    for(let y=-22;y<=22;y++){
      for(let x=-22;x<=22;x++){
        const radius=Math.hypot(x,y);
        if(radius<def.minRadius||radius>def.maxRadius)continue;
        const rotate=(PRNG.foundationUint32(seed,"wp008:lot-rotate:"+def.kind+":"+x+":"+y)&1)===1;
        const w=rotate?def.h:def.w;
        const h=rotate?def.w:def.h;
        const b=bounds(x,y,w,h);
        const targetDistance=target?Math.abs(x-target.cx)+Math.abs(y-target.cy):999;
        if(target&&targetDistance>def.maxTargetDistance)continue;
        const score=PRNG.foundationUint32(seed,"wp008:lot-candidate:"+def.kind+":"+x+":"+y);
        candidates.push({x,y,w,h,b,targetDistance,score});
      }
    }
    candidates.sort((a,b)=>
      a.targetDistance-b.targetDistance||
      b.score-a.score||
      a.y-b.y||
      a.x-b.x
    );

    let chosen=null;
    for(const candidate of candidates){
      if(!candidateCellsValid(seed,candidate.b))continue;
      if(!plotPaddingClear(seed,candidate.b,1))continue;
      if(structures.some(plan=>overlap(candidate.b,plan.bounds,1)))continue;
      if(accepted.some(lot=>overlap(candidate.b,lot.bounds,1)))continue;
      const targets=roadTargets(seed,candidate.b);
      if(!targets.length)continue;
      const nearest=Math.min(...targets.map(point=>{
        const dx=Math.max(candidate.b.minX-point.x,0,point.x-candidate.b.maxX);
        const dy=Math.max(candidate.b.minY-point.y,0,point.y-candidate.b.maxY);
        return dx+dy;
      }));
      if(nearest>4)continue;
      chosen=Object.freeze({
        id:"L"+(accepted.length+1),
        kind:def.kind,
        label:def.label,
        cx:candidate.x,
        cy:candidate.y,
        w:candidate.w,
        h:candidate.h,
        bounds:candidate.b,
        nearKind:def.nearKind,
        targetDistance:target?centerDistance({cx:x,cy:y},target):null,
        roadAccessTiles:nearest,
        phase:"buildings"
      });
      break;
    }
    if(chosen)accepted.push(chosen);
  }

  const frozen=Object.freeze(accepted);
  lotCache.set(seed,frozen);
  return frozen;
}

function structureAt(seed,l){
  if(!l)return null;
  for(const plan of buildStructures(seed)){
    const b=plan.bounds;
    if(l.x>=b.minX&&l.x<=b.maxX&&l.y>=b.minY&&l.y<=b.maxY)return plan;
  }
  return null;
}

function lotAt(seed,l){
  if(!l)return null;
  for(const lot of buildLots(seed)){
    const b=lot.bounds;
    if(l.x>=b.minX&&l.x<=b.maxX&&l.y>=b.minY&&l.y<=b.maxY)return lot;
  }
  return null;
}

function wallVariant(b,x,y){
  const n=y===b.minY;
  const e=x===b.maxX;
  const s=y===b.maxY;
  const w=x===b.minX;
  if(n&&e)return "wall-corner-ne";
  if(e&&s)return "wall-corner-se";
  if(s&&w)return "wall-corner-sw";
  if(w&&n)return "wall-corner-nw";
  if(n)return "wall-n";
  if(e)return "wall-e";
  if(s)return "wall-s";
  return "wall-w";
}

function cellAt(seed,l){
  const plan=structureAt(seed,l);
  if(!plan)return null;
  const b=plan.bounds;
  const border=l.x===b.minX||l.x===b.maxX||l.y===b.minY||l.y===b.maxY;
  if(border){
    if(l.x===plan.entrance.x&&l.y===plan.entrance.y){
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

  const centerX=Math.round((b.minX+b.maxX)/2);
  const centerY=Math.round((b.minY+b.maxY)/2);
  return Object.freeze({
    type:"floor",
    textureVariant:plan.floorVariant,
    overlayVariant:(l.x===centerX&&l.y===centerY)?plan.markerVariant:null,
    room:plan.room,
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
    plan:cell.plan
  });
}

function lotReservationAt(seed,l){
  const lot=lotAt(seed,l);
  if(!lot)return null;
  return Object.freeze({
    phase:"buildings",
    type:"yard",
    lot
  });
}

function proof(seed){
  const structures=buildStructures(seed);
  const repeatedStructures=buildStructures(seed);
  const lots=buildLots(seed);
  const repeatedLots=buildLots(seed);
  let structureRoadOverlapCount=0;
  let structureHouseOverlapCount=0;
  let structureWaterOverlapCount=0;
  let structurePairOverlapCount=0;
  let lotRoadOverlapCount=0;
  let lotHouseOverlapCount=0;
  let lotWaterOverlapCount=0;
  let lotStructureOverlapCount=0;
  let entrancePass=true;
  let lotAccessPass=true;

  for(let i=0;i<structures.length;i++){
    const plan=structures[i];
    if(!plan.entrance||plan.entrance.accessLengthTiles>5)entrancePass=false;
    for(let j=i+1;j<structures.length;j++){
      if(overlap(plan.bounds,structures[j].bounds,0))structurePairOverlapCount++;
    }
    for(let y=plan.bounds.minY;y<=plan.bounds.maxY;y++){
      for(let x=plan.bounds.minX;x<=plan.bounds.maxX;x++){
        const l=StartingVillage.local(seed,String(x),String(y));
        if(StartingVillage.isRoadReserved(seed,l))structureRoadOverlapCount++;
        if(StartingVillage.plotAt(seed,l))structureHouseOverlapCount++;
        if(surfaceType(seed,x,y)==="water")structureWaterOverlapCount++;
      }
    }
  }

  for(const lot of lots){
    if(lot.roadAccessTiles>4)lotAccessPass=false;
    for(let y=lot.bounds.minY;y<=lot.bounds.maxY;y++){
      for(let x=lot.bounds.minX;x<=lot.bounds.maxX;x++){
        const l=StartingVillage.local(seed,String(x),String(y));
        if(StartingVillage.isRoadReserved(seed,l))lotRoadOverlapCount++;
        if(StartingVillage.plotAt(seed,l))lotHouseOverlapCount++;
        if(surfaceType(seed,x,y)==="water")lotWaterOverlapCount++;
        if(structureAt(seed,l))lotStructureOverlapCount++;
      }
    }
  }

  const kinds=structures.map(plan=>plan.kind).sort();
  const expectedKinds=STRUCTURE_TYPES.map(def=>def.kind).sort();
  const deterministic=
    JSON.stringify(structures)===JSON.stringify(repeatedStructures)&&
    JSON.stringify(lots)===JSON.stringify(repeatedLots);
  const pass=
    deterministic&&
    structures.length===STRUCTURE_TYPES.length&&
    lots.length===LOT_TYPES.length&&
    JSON.stringify(kinds)===JSON.stringify(expectedKinds)&&
    entrancePass&&lotAccessPass&&
    structureRoadOverlapCount===0&&
    structureHouseOverlapCount===0&&
    structureWaterOverlapCount===0&&
    structurePairOverlapCount===0&&
    lotRoadOverlapCount===0&&
    lotHouseOverlapCount===0&&
    lotWaterOverlapCount===0&&
    lotStructureOverlapCount===0;

  return Object.freeze({
    deterministic,
    structureCount:structures.length,
    lotCount:lots.length,
    kinds:Object.freeze(kinds),
    lotKinds:Object.freeze(lots.map(lot=>lot.kind).sort()),
    entrancePass,
    lotAccessPass,
    structureRoadOverlapCount,
    structureHouseOverlapCount,
    structureWaterOverlapCount,
    structurePairOverlapCount,
    lotRoadOverlapCount,
    lotHouseOverlapCount,
    lotWaterOverlapCount,
    lotStructureOverlapCount,
    pass
  });
}

window.SpecialBuildings=Object.freeze({
  STRUCTURE_TYPES,LOT_TYPES,
  buildStructures,buildLots,
  structureAt,lotAt,cellAt,buildingAt,lotReservationAt,proof
});
})();