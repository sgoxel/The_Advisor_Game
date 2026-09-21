(function(){
"use strict";

const LOT_DEFINITIONS=Object.freeze([
  Object.freeze({kind:"tavern",label:"Tavern & Lodging",w:6,h:5,enterable:true,function:"lodging"}),
  Object.freeze({kind:"shop",label:"Village Shop",w:5,h:4,enterable:true,function:"market"}),
  Object.freeze({kind:"workshop",label:"Craft Workshop",w:5,h:4,enterable:true,function:"craft"}),
  Object.freeze({kind:"storehouse",label:"Storehouse",w:5,h:4,enterable:true,function:"storage"}),
  Object.freeze({kind:"barn",label:"Farm Barn",w:6,h:5,enterable:true,function:"farm"}),
  Object.freeze({kind:"meeting-hall",label:"Village Meeting Hall",w:6,h:5,enterable:true,function:"civic"}),
  Object.freeze({kind:"workyard",label:"Outdoor Workyard",w:5,h:4,enterable:false,function:"outdoor-work"})
]);

const planCache=new Map();

function boundsFor(cx,cy,w,h){
  const minX=cx-Math.floor(w/2);
  const minY=cy-Math.floor(h/2);
  return Object.freeze({minX,minY,maxX:minX+w-1,maxY:minY+h-1,w,h});
}

function boundsOverlap(a,b,padding){
  const p=padding||0;
  return !(
    a.maxX+p<b.minX||
    b.maxX+p<a.minX||
    a.maxY+p<b.minY||
    b.maxY+p<a.minY
  );
}

function perimeterCandidates(bounds){
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
  for(let y=bounds.minY-6;y<=bounds.maxY+6;y++){
    for(let x=bounds.minX-6;x<=bounds.maxX+6;x++){
      const inside=x>=bounds.minX&&x<=bounds.maxX&&y>=bounds.minY&&y<=bounds.maxY;
      if(inside)continue;
      const l=StartingVillage.local(seed,String(x),String(y));
      if(l&&StartingVillage.isRoadReserved(seed,l))out.push({x,y});
    }
  }
  return out;
}

function chooseAccess(seed,kind,bounds){
  let best=null;
  const targets=roadTargets(seed,bounds);
  for(const edge of perimeterCandidates(bounds)){
    for(const target of targets){
      const distance=Math.abs(edge.x-target.x)+Math.abs(edge.y-target.y);
      if(distance>6)continue;
      const score=PRNG.foundationUint32(
        seed,
        "wp008:access:"+kind+":"+edge.x+":"+edge.y+":"+target.x+":"+target.y
      );
      if(!best||distance<best.distance||(distance===best.distance&&score>best.score)){
        best={edge,target,distance,score};
      }
    }
  }
  if(!best)return null;
  return Object.freeze({
    x:best.edge.x,
    y:best.edge.y,
    side:best.edge.side,
    target:Object.freeze({x:best.target.x,y:best.target.y}),
    accessLengthTiles:best.distance
  });
}

function backgroundTerrain(seed,x,y){
  const l=StartingVillage.local(seed,String(x),String(y));
  if(!l)return null;
  const base=GeographyFoundation.getTerrainType(seed,String(x),String(y));
  return StartingVillage.resolveTerrain(seed,l,base);
}

function candidateValid(seed,bounds,accepted){
  for(const housePlot of StartingVillage.buildPlots(seed)){
    if(boundsOverlap(bounds,housePlot.bounds,1))return false;
  }
  for(const lot of accepted){
    if(boundsOverlap(bounds,lot.bounds,0))return false;
  }

  for(let y=bounds.minY;y<=bounds.maxY;y++){
    for(let x=bounds.minX;x<=bounds.maxX;x++){
      const l=StartingVillage.local(seed,String(x),String(y));
      if(!l||!StartingVillage.isVillageLand(seed,l))return false;
      if(StartingVillage.isRoadReserved(seed,l))return false;
      if(backgroundTerrain(seed,x,y)==="water")return false;
    }
  }
  return true;
}

function build(seed){
  if(planCache.has(seed))return planCache.get(seed);
  const accepted=[];

  for(const definition of LOT_DEFINITIONS){
    const candidates=[];
    for(let y=-22;y<=22;y++){
      for(let x=-22;x<=22;x++){
        const radius=Math.hypot(x,y);
        if(radius<7||radius>22)continue;
        const score=PRNG.foundationUint32(
          seed,
          "wp008:candidate:"+definition.kind+":"+x+":"+y
        );
        candidates.push({x,y,score});
      }
    }
    candidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);

    let selected=null;
    for(const candidate of candidates){
      const rotate=(PRNG.foundationUint32(
        seed,
        "wp008:rotate:"+definition.kind+":"+candidate.x+":"+candidate.y
      )&1)===1;
      const w=rotate?definition.h:definition.w;
      const h=rotate?definition.w:definition.h;
      const bounds=boundsFor(candidate.x,candidate.y,w,h);
      if(!candidateValid(seed,bounds,accepted))continue;
      const access=chooseAccess(seed,definition.kind,bounds);
      if(!access)continue;

      selected=Object.freeze({
        id:"S"+(accepted.length+1),
        kind:definition.kind,
        label:definition.label,
        function:definition.function,
        enterable:definition.enterable,
        cx:candidate.x,
        cy:candidate.y,
        w,h,
        bounds,
        access,
        phase:"buildings"
      });
      break;
    }
    if(selected)accepted.push(selected);
  }

  const frozen=Object.freeze(accepted.slice());
  planCache.set(seed,frozen);
  return frozen;
}

function lotAt(seed,l){
  if(!l)return null;
  for(const lot of build(seed)){
    const b=lot.bounds;
    if(l.x>=b.minX&&l.x<=b.maxX&&l.y>=b.minY&&l.y<=b.maxY)return lot;
  }
  return null;
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
  const lot=lotAt(seed,l);
  if(!lot)return null;

  if(!lot.enterable){
    return Object.freeze({
      type:"plot",
      textureVariant:null,
      overlayVariant:null,
      room:"workyard",
      lot
    });
  }

  const b=lot.bounds;
  const border=l.x===b.minX||l.x===b.maxX||l.y===b.minY||l.y===b.maxY;
  if(border){
    if(l.x===lot.access.x&&l.y===lot.access.y){
      return Object.freeze({
        type:"door",
        textureVariant:"door-"+lot.access.side.toLowerCase(),
        overlayVariant:null,
        room:null,
        lot
      });
    }
    return Object.freeze({
      type:"wall",
      textureVariant:wallVariant(b,l.x,l.y),
      overlayVariant:null,
      room:null,
      lot
    });
  }

  return Object.freeze({
    type:"floor",
    textureVariant:"floor-wood",
    overlayVariant:null,
    room:lot.function,
    lot
  });
}

function buildingAt(seed,l){
  const cell=cellAt(seed,l);
  if(!cell)return null;
  return Object.freeze({
    phase:"buildings",
    type:cell.type,
    cell,
    lot:cell.lot
  });
}

function proof(seed){
  const first=build(seed);
  const second=build(seed);
  const kinds=new Set(first.map(lot=>lot.kind));
  let roadOverlapCount=0;
  let waterOverlapCount=0;
  let houseOverlapCount=0;
  let lotOverlapCount=0;
  let entrancesPass=true;

  for(let i=0;i<first.length;i++){
    const lot=first[i];
    if(!lot.access||lot.access.accessLengthTiles>6)entrancesPass=false;
    const accessLocal=StartingVillage.local(seed,String(lot.access.target.x),String(lot.access.target.y));
    if(!accessLocal||!StartingVillage.isRoadReserved(seed,accessLocal))entrancesPass=false;

    for(const house of StartingVillage.buildPlots(seed)){
      if(boundsOverlap(lot.bounds,house.bounds,0))houseOverlapCount++;
    }
    for(let j=i+1;j<first.length;j++){
      if(boundsOverlap(lot.bounds,first[j].bounds,0))lotOverlapCount++;
    }

    for(let y=lot.bounds.minY;y<=lot.bounds.maxY;y++){
      for(let x=lot.bounds.minX;x<=lot.bounds.maxX;x++){
        const l=StartingVillage.local(seed,String(x),String(y));
        if(StartingVillage.isRoadReserved(seed,l))roadOverlapCount++;
        if(backgroundTerrain(seed,x,y)==="water")waterOverlapCount++;
      }
    }
  }

  const requiredKinds=LOT_DEFINITIONS.map(def=>def.kind);
  const typeCoveragePass=requiredKinds.every(kind=>kinds.has(kind));
  const enterableCount=first.filter(lot=>lot.enterable).length;
  const outdoorCount=first.filter(lot=>!lot.enterable).length;
  const deterministic=JSON.stringify(first)===JSON.stringify(second);
  const overlapPass=
    roadOverlapCount===0&&
    waterOverlapCount===0&&
    houseOverlapCount===0&&
    lotOverlapCount===0;
  const pass=
    deterministic&&
    first.length===LOT_DEFINITIONS.length&&
    typeCoveragePass&&
    enterableCount===6&&
    outdoorCount===1&&
    entrancesPass&&
    overlapPass;

  return Object.freeze({
    deterministic,
    lotCount:first.length,
    enterableCount,
    outdoorCount,
    kinds:Object.freeze([...kinds].sort()),
    typeCoveragePass,
    entrancesPass,
    overlapPass,
    roadOverlapCount,
    waterOverlapCount,
    houseOverlapCount,
    lotOverlapCount,
    pass
  });
}

window.SpecialLots=Object.freeze({
  LOT_DEFINITIONS,
  build,lotAt,cellAt,buildingAt,proof
});
})();