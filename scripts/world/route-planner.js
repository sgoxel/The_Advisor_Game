(function(){
"use strict";

const DEFAULT_MAX_DISTANCE_TILES=192;
const DEFAULT_MAX_NODES=12000;
const DEFAULT_DETOUR_ALLOWANCE_TILES=48;
const DIRECTIONS=Object.freeze([
  Object.freeze({dx:"0",dy:"-1",order:0}),
  Object.freeze({dx:"1",dy:"0",order:1}),
  Object.freeze({dx:"0",dy:"1",order:2}),
  Object.freeze({dx:"-1",dy:"0",order:3})
]);
const proofCache=new Map();

function normalizePoint(value){
  if(!value||typeof value!=="object")throw new Error("Route point is required.");
  return WorldCoordinates.position(value.x,value.y);
}
function key(point){return WorldCoordinates.key(point)}
function absBig(value){return value<0n?-value:value}
function manhattan(a,b){
  const distance=absBig(BigInt(a.x)-BigInt(b.x))+absBig(BigInt(a.y)-BigInt(b.y));
  if(distance>BigInt(Number.MAX_SAFE_INTEGER))return Infinity;
  return Number(distance);
}
function maxWalkSpeedKmh(){
  const values=Object.values(WorldStandards.WALK_SPEED_KMH||{})
    .map(Number)
    .filter(value=>Number.isFinite(value)&&value>0);
  values.push(3.0);
  return Math.max(...values);
}
function heuristicSeconds(a,b){
  const speed=maxWalkSpeedKmh()*1000/3600;
  return speed>0?manhattan(a,b)*(WorldStandards.TILE_METERS/speed):0;
}
function compareBigText(a,b){
  const av=BigInt(a),bv=BigInt(b);
  return av<bv?-1:av>bv?1:0;
}
function compareQueueNode(a,b){
  if(Math.abs(a.f-b.f)>1e-9)return a.f-b.f;
  if(Math.abs(a.h-b.h)>1e-9)return a.h-b.h;
  if(Math.abs(a.g-b.g)>1e-9)return a.g-b.g;
  const y=compareBigText(a.point.y,b.point.y);
  if(y)return y;
  const x=compareBigText(a.point.x,b.point.x);
  if(x)return x;
  return a.order-b.order;
}

class MinHeap{
  constructor(){this.items=[]}
  get length(){return this.items.length}
  push(value){
    const items=this.items;
    items.push(value);
    let index=items.length-1;
    while(index>0){
      const parent=Math.floor((index-1)/2);
      if(compareQueueNode(items[parent],items[index])<=0)break;
      [items[parent],items[index]]=[items[index],items[parent]];
      index=parent;
    }
  }
  pop(){
    const items=this.items;
    if(!items.length)return null;
    const first=items[0];
    const last=items.pop();
    if(items.length&&last){
      items[0]=last;
      let index=0;
      while(true){
        const left=index*2+1;
        const right=left+1;
        let smallest=index;
        if(left<items.length&&compareQueueNode(items[left],items[smallest])<0)smallest=left;
        if(right<items.length&&compareQueueNode(items[right],items[smallest])<0)smallest=right;
        if(smallest===index)break;
        [items[index],items[smallest]]=[items[smallest],items[index]];
        index=smallest;
      }
    }
    return first;
  }
}

function frozenResult(data){
  return Object.freeze(data);
}
function failure(reason,start,destination,extra){
  return frozenResult(Object.assign({
    found:false,
    reason,
    start,
    destination,
    path:Object.freeze([]),
    pathKeys:Object.freeze([]),
    stepCount:0,
    totalSeconds:Infinity,
    evaluatedCount:0,
    expandedCount:0,
    blockedRejectedCount:0,
    searchRadius:0,
    maxNodes:0
  },extra||{}));
}
function reconstruct(cameFrom,points,currentKey){
  const keys=[currentKey];
  while(cameFrom.has(keys[keys.length-1])){
    keys.push(cameFrom.get(keys[keys.length-1]));
  }
  keys.reverse();
  const path=keys.map(item=>points.get(item)).filter(Boolean).map(point=>Object.freeze({x:point.x,y:point.y}));
  return {path:Object.freeze(path),pathKeys:Object.freeze(keys.slice())};
}

function findRoute(seed,startValue,destinationValue,options){
  const start=normalizePoint(startValue);
  const destination=normalizePoint(destinationValue);
  const opts=options||{};
  const maxDistance=Math.max(1,Math.floor(Number(opts.maxDistanceTiles||DEFAULT_MAX_DISTANCE_TILES)));
  const maxNodes=Math.max(64,Math.floor(Number(opts.maxNodes||DEFAULT_MAX_NODES)));
  const detourAllowance=Math.max(0,Math.floor(Number(opts.detourAllowanceTiles??DEFAULT_DETOUR_ALLOWANCE_TILES)));
  const direct=manhattan(start,destination);

  if(!Number.isFinite(direct)||direct>maxDistance){
    return failure("outside-local-range",start,destination,{searchRadius:maxDistance,maxNodes});
  }

  const startState=Walkability.classify(seed,start.x,start.y);
  if(!startState?.walkable)return failure("blocked-start",start,destination,{searchRadius:direct,maxNodes});
  const destinationState=Walkability.classify(seed,destination.x,destination.y);
  if(!destinationState?.walkable)return failure("blocked-destination",start,destination,{searchRadius:direct,maxNodes});

  if(key(start)===key(destination)){
    return frozenResult({
      found:true,
      reason:"ok",
      start,destination,
      path:Object.freeze([Object.freeze({x:start.x,y:start.y})]),
      pathKeys:Object.freeze([key(start)]),
      stepCount:0,
      totalSeconds:0,
      evaluatedCount:2,
      expandedCount:0,
      blockedRejectedCount:0,
      searchRadius:0,
      maxNodes
    });
  }

  const searchRadius=Math.min(maxDistance,direct+detourAllowance);
  const open=new MinHeap();
  const cameFrom=new Map();
  const points=new Map();
  const gScore=new Map();
  const stateCache=new Map();
  let evaluatedCount=2;
  let expandedCount=0;
  let blockedRejectedCount=0;
  let order=0;

  const startKey=key(start);
  points.set(startKey,start);
  gScore.set(startKey,0);
  stateCache.set(startKey,startState);
  open.push({
    point:start,
    g:0,
    h:heuristicSeconds(start,destination),
    f:heuristicSeconds(start,destination),
    order:order++
  });

  while(open.length){
    const current=open.pop();
    if(!current)break;
    const currentKey=key(current.point);
    const bestKnown=gScore.get(currentKey);
    if(bestKnown==null||current.g>bestKnown+1e-9)continue;

    if(currentKey===key(destination)){
      const rebuilt=reconstruct(cameFrom,points,currentKey);
      return frozenResult({
        found:true,
        reason:"ok",
        start,destination,
        path:rebuilt.path,
        pathKeys:rebuilt.pathKeys,
        stepCount:Math.max(0,rebuilt.path.length-1),
        totalSeconds:current.g,
        evaluatedCount,
        expandedCount,
        blockedRejectedCount,
        searchRadius,
        maxNodes
      });
    }

    expandedCount++;
    if(expandedCount>maxNodes){
      return failure("search-limit",start,destination,{
        evaluatedCount,expandedCount,blockedRejectedCount,searchRadius,maxNodes
      });
    }

    for(const direction of DIRECTIONS){
      const next=WorldCoordinates.add(current.point,direction.dx,direction.dy);
      if(manhattan(start,next)>searchRadius)continue;
      const nextKey=key(next);
      let state=stateCache.get(nextKey);
      if(!state){
        state=Walkability.classify(seed,next.x,next.y);
        stateCache.set(nextKey,state);
        evaluatedCount++;
      }
      if(!state?.walkable||!Number.isFinite(state.secondsPerTile)){
        blockedRejectedCount++;
        continue;
      }

      const tentative=current.g+state.secondsPerTile;
      const previous=gScore.get(nextKey);
      if(previous!=null&&tentative>=previous-1e-9)continue;

      cameFrom.set(nextKey,currentKey);
      points.set(nextKey,next);
      gScore.set(nextKey,tentative);
      const h=heuristicSeconds(next,destination);
      open.push({point:next,g:tentative,h,f:tentative+h,order:order++});
    }
  }

  return failure("unreachable",start,destination,{
    evaluatedCount,expandedCount,blockedRejectedCount,searchRadius,maxNodes
  });
}

function interiorPoint(seed,lot){
  if(!lot?.enterable||!lot.access)return null;
  let x=lot.access.x;
  let y=lot.access.y;
  if(lot.access.side==="N")y+=1;
  else if(lot.access.side==="S")y-=1;
  else if(lot.access.side==="W")x+=1;
  else if(lot.access.side==="E")x-=1;
  const point=WorldCoordinates.position(String(x),String(y));
  const state=Walkability.classify(seed,point.x,point.y);
  return state?.walkable?point:null;
}
function destinationChoice(seed){
  const start=WorldCoordinates.origin();
  const choices=SpecialLots.build(seed)
    .filter(lot=>lot.enterable)
    .map(lot=>({lot,point:interiorPoint(seed,lot)}))
    .filter(item=>item.point)
    .sort((a,b)=>{
      const distance=manhattan(b.point,start)-manhattan(a.point,start);
      if(distance)return distance;
      return a.lot.kind.localeCompare(b.lot.kind);
    });
  return choices[0]||null;
}
function blockedWallPoint(seed,lot){
  if(!lot)return null;
  const b=lot.bounds;
  for(let y=b.minY;y<=b.maxY;y++){
    for(let x=b.minX;x<=b.maxX;x++){
      if(x!==b.minX&&x!==b.maxX&&y!==b.minY&&y!==b.maxY)continue;
      if(x===lot.access.x&&y===lot.access.y)continue;
      const state=Walkability.classify(seed,String(x),String(y));
      if(!state?.walkable&&state?.barrierKind==="outer-wall"){
        return WorldCoordinates.position(String(x),String(y));
      }
    }
  }
  return null;
}
function routeSignature(route){
  if(!route?.found)return route?.reason||"none";
  return route.pathKeys.join("|")+"@"+route.totalSeconds.toFixed(6);
}
function proof(seed){
  const seedKey=String(seed);
  if(proofCache.has(seedKey))return proofCache.get(seedKey);

  const start=WorldCoordinates.origin();
  const choice=destinationChoice(seedKey);
  if(!choice){
    const unavailable=Object.freeze({pass:false,reason:"no-village-destination"});
    proofCache.set(seedKey,unavailable);
    return unavailable;
  }

  const first=findRoute(seedKey,start,choice.point);
  const second=findRoute(seedKey,start,choice.point);
  const blockedPoint=blockedWallPoint(seedKey,choice.lot);
  const blocked=blockedPoint?findRoute(seedKey,start,blockedPoint):null;

  const states=first.found
    ?first.path.map(point=>Walkability.classify(seedKey,point.x,point.y))
    :[];
  const deterministic=routeSignature(first)===routeSignature(second);
  const obeysWalkability=first.found&&states.every(state=>state?.walkable);
  const usesExteriorEntrance=states.some(state=>state?.doorwayKind==="exterior-door");
  const destinationState=Walkability.classify(seedKey,choice.point.x,choice.point.y);
  const destinationInterior=destinationState?.category===Walkability.CATEGORY.INTERIOR;
  const blockedDestinationRejected=!!blockedPoint&&!!blocked&&!blocked.found&&blocked.reason==="blocked-destination";
  const costCheck=first.found
    ?first.path.slice(1).reduce((total,point)=>total+Walkability.movementSeconds(seedKey,point.x,point.y),0)
    :Infinity;
  const movementCostPass=first.found&&Math.abs(costCheck-first.totalSeconds)<1e-6;
  const localEvaluationPass=
    first.found&&
    first.searchRadius<=DEFAULT_MAX_DISTANCE_TILES&&
    first.expandedCount<=first.maxNodes&&
    first.evaluatedCount>0;
  const roadPathSteps=states.filter(state=>state?.category===Walkability.CATEGORY.ROUTE).length;
  const difficultSteps=states.filter(state=>state?.category===Walkability.CATEGORY.DIFFICULT).length;
  const routePreview=first.found
    ?first.path.filter((_,index)=>index===0||index===first.path.length-1||index%Math.max(1,Math.floor(first.path.length/6))===0)
      .map(point=>"("+point.x+","+point.y+")").join(" → ")
    :"—";

  const result=Object.freeze({
    pass:
      first.found&&
      deterministic&&
      obeysWalkability&&
      usesExteriorEntrance&&
      destinationInterior&&
      blockedDestinationRejected&&
      movementCostPass&&
      localEvaluationPass,
    deterministic,
    obeysWalkability,
    usesExteriorEntrance,
    destinationInterior,
    blockedDestinationRejected,
    movementCostPass,
    localEvaluationPass,
    destinationLabel:choice.lot.label,
    destinationKind:choice.lot.kind,
    destination:Object.freeze({x:choice.point.x,y:choice.point.y}),
    blockedDestination:blockedPoint?Object.freeze({x:blockedPoint.x,y:blockedPoint.y}):null,
    stepCount:first.stepCount,
    totalSeconds:first.totalSeconds,
    evaluatedCount:first.evaluatedCount,
    expandedCount:first.expandedCount,
    blockedRejectedCount:first.blockedRejectedCount,
    roadPathSteps,
    difficultSteps,
    routePreview,
    route:first,
    blockedRoute:blocked
  });
  proofCache.set(seedKey,result);
  return result;
}

window.RoutePlanner=Object.freeze({
  DEFAULT_MAX_DISTANCE_TILES,
  DEFAULT_MAX_NODES,
  findRoute,
  proof
});
})();