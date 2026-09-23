(function(){
"use strict";

const LEVEL=0;
const cache=new Map();
const proofCache=new Map();
const TYPE_RULES=Object.freeze({
  bed:Object.freeze({blocking:true,actions:Object.freeze(["sleep"])}),
  chair:Object.freeze({blocking:true,actions:Object.freeze(["sit"])}),
  table:Object.freeze({blocking:true,actions:Object.freeze(["eat","social","work"])}),
  counter:Object.freeze({blocking:true,actions:Object.freeze(["service","work"])}),
  workbench:Object.freeze({blocking:true,actions:Object.freeze(["craft","work"])}),
  hearth:Object.freeze({blocking:true,actions:Object.freeze(["cook","warm","eat"])}),
  storage:Object.freeze({blocking:true,actions:Object.freeze(["store","retrieve"])})
});
const SPECIAL_TYPES=Object.freeze({
  tavern:Object.freeze(["counter","table","chair"]),
  shop:Object.freeze(["counter","storage"]),
  workshop:Object.freeze(["workbench","storage"]),
  storehouse:Object.freeze(["storage","storage"]),
  barn:Object.freeze(["storage","workbench"]),
  meeting:Object.freeze(["table","chair"]),
  meeting_hall:Object.freeze(["table","chair"])
});

function pointKey(p){return p.x+","+p.y+","+(p.level??LEVEL)}
function point(x,y){return Object.freeze({x:String(x),y:String(y),level:LEVEL})}
function comparePoint(a,b){
  const ay=BigInt(a.y),by=BigInt(b.y); if(ay!==by)return ay<by?-1:1;
  const ax=BigInt(a.x),bx=BigInt(b.x); return ax<bx?-1:ax>bx?1:0;
}
function adjacent(a,b){return (BigInt(a.x)-BigInt(b.x)<0n?BigInt(b.x)-BigInt(a.x):BigInt(a.x)-BigInt(b.x))+(BigInt(a.y)-BigInt(b.y)<0n?BigInt(b.y)-BigInt(a.y):BigInt(a.y)-BigInt(b.y))===1n}
function typesFor(building){
  if(building.source==="house")return building.kind==="cabin"?["bed","hearth"]:["bed","table","chair"];
  return SPECIAL_TYPES[building.kind]||["storage","table"];
}
function orderedFloors(seed,building,type,index){
  return building.interiorFloorCells.slice().sort((a,b)=>{
    const ka=PRNG.foundationUint32(seed,"interior-object:"+building.id+":"+type+":"+index+":"+a.x+":"+a.y);
    const kb=PRNG.foundationUint32(seed,"interior-object:"+building.id+":"+type+":"+index+":"+b.x+":"+b.y);
    return ka-kb||comparePoint(a,b);
  });
}
function interactionFor(building,cell,occupied,reserved){
  return building.interiorFloorCells
    .filter(p=>adjacent(p,cell)&&!occupied.has(pointKey(p))&&!reserved.has(pointKey(p)))
    .sort(comparePoint)[0]||null;
}
function interactionsReachable(building,blocked,targetPoints){
  const floors=new Map(building.interiorFloorCells.map(p=>[pointKey(p),point(p.x,p.y)]));
  const targets=targetPoints.map(pointKey);
  if(targets.some(key=>!floors.has(key)||blocked.has(key)))return false;
  const startCandidates=[building.entrance?.immediateInside,building.interiorTarget]
    .filter(Boolean)
    .map(p=>point(p.x,p.y))
    .filter(p=>floors.has(pointKey(p))&&!blocked.has(pointKey(p)));
  const start=startCandidates[0]||[...floors.values()].find(p=>!blocked.has(pointKey(p)))||null;
  if(!start)return targets.length===0;
  const queue=[start],seen=new Set([pointKey(start)]);
  while(queue.length){
    const current=queue.shift();
    for(const [dx,dy] of [["1","0"],["-1","0"],["0","1"],["0","-1"]]){
      const next=WorldCoordinates.add(current,dx,dy);
      const candidate=point(next.x,next.y);
      const key=pointKey(candidate);
      if(seen.has(key)||blocked.has(key)||!floors.has(key))continue;
      seen.add(key);
      queue.push(candidate);
    }
  }
  return targets.every(key=>seen.has(key));
}
function buildFresh(seed){
  const occupied=new Set();
  const reserved=new Set();
  const objects=[];
  for(const building of BuildingInteriors.build(seed)){
    const protectedCells=new Set(
      [
        building.entrance?.door,
        building.entrance?.immediateInside,
        building.interiorTarget
      ].filter(Boolean).map(pointKey)
    );
    const buildingInteractions=[];
    const types=typesFor(building);
    types.forEach((type,index)=>{
      const rule=TYPE_RULES[type];
      if(!rule)return;
      for(const candidate of orderedFloors(seed,building,type,index)){
        const c=point(candidate.x,candidate.y);
        if(protectedCells.has(pointKey(c))||occupied.has(pointKey(c))||reserved.has(pointKey(c)))continue;
        const interaction=interactionFor(building,c,occupied,reserved);
        if(!interaction)continue;
        const ip=point(interaction.x,interaction.y);
        const prospectiveBlocked=new Set(occupied);
        if(rule.blocking)prospectiveBlocked.add(pointKey(c));
        if(!interactionsReachable(building,prospectiveBlocked,[...buildingInteractions,ip]))continue;
        const id=building.id+":"+type+":"+String(index+1).padStart(2,"0");
        objects.push(Object.freeze({
          id,type,buildingId:building.id,buildingLabel:building.label,
          room:candidate.room||null,coordinate:c,level:LEVEL,
          blocking:rule.blocking,actions:rule.actions,
          interactionPositions:Object.freeze([ip])
        }));
        if(rule.blocking)occupied.add(pointKey(c));
        reserved.add(pointKey(ip));
        buildingInteractions.push(ip);
        break;
      }
    });
  }
  return Object.freeze(objects);
}
function build(seed){const key=String(seed);if(!cache.has(key))cache.set(key,buildFresh(key));return cache.get(key)}
function blockingAt(seed,x,y){const k=String(x)+","+String(y)+",0";return build(seed).find(o=>o.blocking&&pointKey(o.coordinate)===k)||null}
function classifyNavigation(seed,x,y){
  const base=Walkability.classify(seed,x,y);
  const object=blockingAt(seed,x,y);
  if(!object)return base;
  return Object.freeze(Object.assign({},base,{walkable:false,blocksMovement:true,secondsPerTile:Infinity,barrierKind:"interior-object",objectId:object.id}));
}
function proof(seed){
  const key=String(seed);
  if(proofCache.has(key))return proofCache.get(key);
  const first=buildFresh(key),second=buildFresh(key);
  const deterministic=JSON.stringify(first)===JSON.stringify(second);
  const ids=new Set(first.map(o=>o.id));
  const uniqueIds=ids.size===first.length;
  const legalPlacement=first.every(o=>{
    const interior=BuildingInteriors.get(key,o.buildingId);
    const floor=interior?.interiorFloorCells.some(c=>c.x===o.coordinate.x&&c.y===o.coordinate.y);
    const base=Walkability.classify(key,o.coordinate.x,o.coordinate.y);
    return floor&&base?.category===Walkability.CATEGORY.INTERIOR&&base?.walkable;
  });
  const interactionsValid=first.every(o=>o.interactionPositions.every(p=>{
    const state=Walkability.classify(key,p.x,p.y);
    const interior=BuildingInteriors.get(key,o.buildingId);
    const route=interior?.entrance?.door?RoutePlanner.findRoute(key,interior.entrance.door,p):null;
    return state?.walkable&&adjacent(o.coordinate,p)&&route?.found;
  }));
  const blockingPass=first.filter(o=>o.blocking).every(o=>{
    const state=classifyNavigation(key,o.coordinate.x,o.coordinate.y);
    return !state?.walkable&&state?.barrierKind==="interior-object"&&state?.objectId===o.id;
  });
  const routeBlockingPass=first.filter(o=>o.blocking).every(o=>{
    const interior=BuildingInteriors.get(key,o.buildingId);
    const start=interior?.entrance?.door;
    if(!start)return false;
    const route=RoutePlanner.findRoute(key,start,o.coordinate);
    return route&&!route.found&&route.reason==="blocked-destination";
  });
  const buildingIds=new Set(first.map(o=>o.buildingId));
  const allBuildingsCovered=BuildingInteriors.build(key).every(b=>buildingIds.has(b.id));
  const result=Object.freeze({
    pass:deterministic&&uniqueIds&&legalPlacement&&interactionsValid&&blockingPass&&routeBlockingPass&&allBuildingsCovered,
    deterministic,uniqueIds,legalPlacement,interactionsValid,blockingPass,routeBlockingPass,allBuildingsCovered,
    objectCount:first.length,buildingCount:buildingIds.size,objects:first
  });
  proofCache.set(key,result);
  return result;
}
window.InteriorObjects=Object.freeze({LEVEL,TYPE_RULES,build,blockingAt,classifyNavigation,proof});
})();
