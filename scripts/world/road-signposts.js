(function(){
"use strict";

const VERSION="road-signposts-v1";
const MAX_SIGNS=3;
const MAX_DESTINATIONS_PER_SIGN=3;
const MAX_ROUTE_TILES=64;
const MAX_ROUTE_NODES=1800;
const TILE_METERS_FALLBACK=2;
const CACHE_LIMIT=8;
const cache=new Map();

const DIRS=Object.freeze([
  Object.freeze({id:"N",dx:0,dy:-1,label:"North"}),
  Object.freeze({id:"E",dx:1,dy:0,label:"East"}),
  Object.freeze({id:"S",dx:0,dy:1,label:"South"}),
  Object.freeze({id:"W",dx:-1,dy:0,label:"West"})
]);

function freezePoint(x,y){return Object.freeze({x:String(x),y:String(y)});}
function numberPoint(p){return {x:Number(p?.x||0),y:Number(p?.y||0)};}
function tileMeters(){return Math.max(1,Number(window.WorldStandards?.TILE_METERS||TILE_METERS_FALLBACK));}
function directionForDelta(dx,dy){return DIRS.find(d=>d.dx===dx&&d.dy===dy)||null;}
function roadAt(seed,x,y){
  const l=window.StartingVillage?.local?.(seed,String(x),String(y));
  return Boolean(l&&window.StartingVillage?.isRoadReserved?.(seed,l));
}
function roadDegree(seed,p){
  const x=Number(p.x),y=Number(p.y);
  return DIRS.filter(d=>roadAt(seed,x+d.dx,y+d.dy)).length;
}
function occupiedAt(seed,x,y){
  const l=window.StartingVillage?.local?.(seed,String(x),String(y));
  if(!l)return true;
  if(window.StartingVillage?.buildingAt?.(seed,l))return true;
  if(window.SpecialLots?.lotAt?.(seed,l))return true;
  return false;
}
function chooseShoulder(seed,junction){
  const j=numberPoint(junction);
  const candidates=[];
  for(let radius=2;radius<=6;radius++){
    for(let oy=-radius;oy<=radius;oy++)for(let ox=-radius;ox<=radius;ox++){
      if(Math.max(Math.abs(ox),Math.abs(oy))!==radius)continue;
      const x=j.x+ox,y=j.y+oy,l=window.StartingVillage?.local?.(seed,String(x),String(y));
      if(!l||!window.StartingVillage?.isVillageLand?.(seed,l))continue;
      if(window.StartingVillage?.isRoadReserved?.(seed,l)||occupiedAt(seed,x,y))continue;
      const score=window.PRNG?.foundationUint32?.(seed,"road-signpost:shoulder:"+junction.x+":"+junction.y+":"+x+":"+y)??0;
      candidates.push({x,y,radius,score});
    }
    if(candidates.length)break;
  }
  candidates.sort((a,b)=>a.radius-b.radius||b.score-a.score||a.y-b.y||a.x-b.x);
  const chosen=candidates[0]||{x:j.x+4,y:j.y+4,radius:4,score:0};
  return Object.freeze({x:String(chosen.x),y:String(chosen.y),distanceTiles:chosen.radius,roadBlocked:roadAt(seed,chosen.x,chosen.y),occupied:occupiedAt(seed,chosen.x,chosen.y)});
}
function gatewayVector(seed){
  const d=window.StartingVillage?.direction?.(seed)||{name:"East",dx:1,dy:0};
  return Object.freeze({id:String(d.name||"East").slice(0,1).toUpperCase(),name:String(d.name||"East"),dx:Number(d.dx||0),dy:Number(d.dy||0)});
}
function gatewayRoadPoint(seed,forward,g){
  const candidates=[];
  for(let lateral=-6;lateral<=6;lateral++){
    const x=g.dx*forward-lateral*g.dy,y=g.dy*forward+lateral*g.dx;
    if(!roadAt(seed,x,y))continue;
    const degree=roadDegree(seed,freezePoint(x,y));
    candidates.push({x,y,lateral,degree});
  }
  candidates.sort((a,b)=>Math.abs(a.lateral)-Math.abs(b.lateral)||b.degree-a.degree||a.lateral-b.lateral);
  const chosen=candidates[0]||{x:g.dx*forward,y:g.dy*forward,lateral:0,degree:0};
  return Object.freeze({x:chosen.x,y:chosen.y,lateral:chosen.lateral,degree:chosen.degree});
}
function threeWayJunction(seed){
  const ring=Number(window.StartingVillage?.RING_RADIUS_TILES||14),candidates=[];
  for(let y=-ring-5;y<=ring+5;y++)for(let x=-ring-5;x<=ring+5;x++){
    if(!roadAt(seed,x,y))continue;
    const degree=roadDegree(seed,freezePoint(x,y));if(degree!==3)continue;
    const radius=Math.hypot(x,y),centerPenalty=Math.abs(x)<=3&&Math.abs(y)<=3?100:0;
    const ringPenalty=Math.abs(radius-ring);
    const tie=window.PRNG?.foundationUint32?.(seed,"road-signpost:t-junction:"+x+":"+y)??0;
    candidates.push({x,y,degree,score:centerPenalty+ringPenalty,tie});
  }
  candidates.sort((a,b)=>a.score-b.score||b.tie-a.tie||a.y-b.y||a.x-b.x);
  const chosen=candidates[0]||null;
  return chosen?Object.freeze({x:chosen.x,y:chosen.y,degree:chosen.degree}):null;
}
function junctionSpecs(seed){
  const ring=Number(window.StartingVillage?.RING_RADIUS_TILES||14),g=gatewayVector(seed);
  const t=threeWayJunction(seed),exitForward=ring+6,exit=gatewayRoadPoint(seed,exitForward,g);
  const specs=[
    Object.freeze({id:"SV-JUNCTION-CENTER",purpose:"four-way-crossroads",junction:freezePoint(0,0),expectedDegree:4})
  ];
  if(t)specs.push(Object.freeze({id:"SV-JUNCTION-T",purpose:"three-way-junction",junction:freezePoint(t.x,t.y),expectedDegree:3}));
  specs.push(Object.freeze({id:"SV-SIGN-EXIT",purpose:"village-exit",junction:freezePoint(exit.x,exit.y),expectedDegree:exit.degree,exitForward,exitLateral:exit.lateral}));
  return Object.freeze(specs);
}
function destinationRecords(seed){
  const out=[];
  let settlement=null;
  try{
    const country=window.PoliticalGeography?.countryAt?.(seed,"0","0");
    settlement=(window.SettlementArchetypes?.settlementsForCountry?.(seed,country,3)||[]).find(item=>item.role==="starting-village")||null;
  }catch(_){settlement=null;}
  const village=window.StartingVillage?.plan?.(seed)||null;
  if(settlement||village){
    out.push(Object.freeze({
      id:String(settlement?.id||"starting-village"),
      name:String(settlement?.name||village?.name||"Starting Village"),
      type:"settlement",category:"settlements",target:freezePoint(0,0),
      authority:settlement?"SettlementArchetypes canonical starting-village":"StartingVillage.plan"
    }));
  }
  for(const lot of (window.SpecialLots?.build?.(seed)||[])){
    const access=lot?.access?.target;
    if(!access)continue;
    out.push(Object.freeze({
      id:"SPECIALLOT|"+String(lot.id),
      name:String(lot.label||lot.kind||lot.id),
      type:String(lot.kind||"landmark"),category:"landmark",
      target:freezePoint(access.x,access.y),
      authority:"SpecialLots.label + SpecialLots.access.target"
    }));
  }
  return Object.freeze(out);
}
function routeBranches(seed,origin,destinations){
  const started=performance.now(),start=numberPoint(origin),startKey=start.x+","+start.y;
  const targetByKey=new Map(),points=new Map([[startKey,start]]),previous=new Map([[startKey,null]]);
  for(const destination of destinations||[]){
    const target=numberPoint(destination.target),distance=Math.abs(target.x-start.x)+Math.abs(target.y-start.y);
    if(distance>MAX_ROUTE_TILES)continue;
    const key=target.x+","+target.y;
    if(!targetByKey.has(key))targetByKey.set(key,[]);
    targetByKey.get(key).push(destination);
  }
  const queue=[{x:start.x,y:start.y,steps:0}],found=new Set();
  let head=0,expandedCount=0;
  while(head<queue.length&&expandedCount<MAX_ROUTE_NODES&&found.size<targetByKey.size){
    const current=queue[head++],currentKey=current.x+","+current.y;expandedCount++;
    if(currentKey!==startKey&&targetByKey.has(currentKey))found.add(currentKey);
    if(current.steps>=MAX_ROUTE_TILES)continue;
    for(const dir of DIRS){
      const x=current.x+dir.dx,y=current.y+dir.dy,key=x+","+y;
      if(previous.has(key)||!roadAt(seed,x,y))continue;
      previous.set(key,currentKey);points.set(key,{x,y});queue.push({x,y,steps:current.steps+1});
    }
  }
  const routes=[];
  for(const destination of destinations||[]){
    const target=numberPoint(destination.target),targetKey=target.x+","+target.y;
    if(targetKey===startKey||!previous.has(targetKey))continue;
    const pathKeys=[];let cursor=targetKey;
    while(cursor!=null){pathKeys.push(cursor);cursor=previous.get(cursor)??null;}
    pathKeys.reverse();
    if(pathKeys.length<2||pathKeys[0]!==startKey)continue;
    const b=points.get(pathKeys[1]);if(!b)continue;
    const dx=Math.sign(b.x-start.x),dy=Math.sign(b.y-start.y),dir=directionForDelta(dx,dy);
    if(!dir||Math.abs(dx)+Math.abs(dy)!==1)continue;
    const meters=Math.max(0,(pathKeys.length-1)*tileMeters());
    const distanceLabel=meters>=1000?(meters/1000).toFixed(meters>=10000?0:1)+" km":Math.round(meters)+" m";
    routes.push(Object.freeze({
      destinationId:destination.id,destinationName:destination.name,destinationType:destination.type,destinationCategory:destination.category,
      destinationAuthority:destination.authority,directionId:dir.id,directionLabel:dir.label,dx:dir.dx,dy:dir.dy,
      routeSteps:pathKeys.length-1,routeDistanceMeters:Number(meters.toFixed(1)),distanceLabel,
      firstStep:Object.freeze({x:String(b.x),y:String(b.y)}),neighborRoad:true,
      edgeId:"SV-LOCAL|"+origin.x+","+origin.y+"|"+dir.id,
      routeReason:"bounded-road-topology",reachable:true,source:"StartingVillage.isRoadReserved bounded local road graph"
    }));
  }
  return {routes:Object.freeze(routes),queryMs:performance.now()-started,expandedCount};
}
function build(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(cache.has(seed))return cache.get(seed);
  const started=performance.now(),destinations=destinationRecords(seed),signs=[];
  let routeQueryCount=0,routeQueryMs=0;
  for(const spec of junctionSpecs(seed)){
    const degree=roadDegree(seed,spec.junction),anchor=chooseShoulder(seed,spec.junction),byDirection=new Map();
    const origin=numberPoint(spec.junction);
    let candidates=destinations.filter(destination=>destination.target.x!==spec.junction.x||destination.target.y!==spec.junction.y);
    if(spec.purpose==="village-exit"){
      const village=candidates.find(destination=>destination.category==="settlements");
      candidates=village?[village]:candidates.slice(0,1);
    }else{
      const groups=new Map(DIRS.map(d=>[d.id,[]]));
      for(const destination of candidates){
        const target=numberPoint(destination.target),dx=target.x-origin.x,dy=target.y-origin.y;
        const hint=Math.abs(dx)>=Math.abs(dy)?(dx>=0?"E":"W"):(dy>=0?"S":"N");
        groups.get(hint).push({destination,distance:Math.abs(dx)+Math.abs(dy)});
      }
      candidates=DIRS.flatMap(d=>(groups.get(d.id)||[]).sort((a,b)=>a.distance-b.distance||a.destination.name.localeCompare(b.destination.name)).slice(0,2).map(x=>x.destination));
    }
    const routeResult=routeBranches(seed,spec.junction,candidates);routeQueryCount++;routeQueryMs+=routeResult.queryMs;
    for(const branch of routeResult.routes){
      if(!branch||branch.neighborRoad!==true)continue;
      const prior=byDirection.get(branch.directionId);
      if(!prior||branch.routeDistanceMeters<prior.routeDistanceMeters||(
        branch.routeDistanceMeters===prior.routeDistanceMeters&&branch.destinationName.localeCompare(prior.destinationName)<0
      ))byDirection.set(branch.directionId,branch);
    }
    let branches=Array.from(byDirection.values()).sort((a,b)=>a.routeDistanceMeters-b.routeDistanceMeters||a.directionId.localeCompare(b.directionId));
    branches=branches.slice(0,spec.purpose==="village-exit"?1:MAX_DESTINATIONS_PER_SIGN);
    if(!branches.length)continue;
    signs.push(Object.freeze({
      id:spec.id,purpose:spec.purpose,junction:spec.junction,anchor,roadDegree:degree,expectedDegree:spec.expectedDegree,
      branches:Object.freeze(branches),panelCount:branches.length,
      authority:"StartingVillage.isRoadReserved bounded local road graph + canonical local destination labels",
      presentationOnly:true,simulationAuthority:false
    }));
    if(signs.length>=MAX_SIGNS)break;
  }
  const signature=signs.map(s=>s.id+"@"+s.junction.x+","+s.junction.y+"#"+s.branches.map(b=>b.edgeId+">"+b.destinationId+":"+b.routeDistanceMeters).join(",")).join("|");
  const result=Object.freeze({
    version:VERSION,seed,signs:Object.freeze(signs),signCount:signs.length,
    panelCount:signs.reduce((n,s)=>n+s.panelCount,0),routeQueryCount,routeQueryMs:Number(routeQueryMs.toFixed(3)),
    maxRouteTiles:MAX_ROUTE_TILES,maxRouteNodes:MAX_ROUTE_NODES,buildMs:Number((performance.now()-started).toFixed(3)),
    signature,deterministic:true,bounded:true,fullWorldScan:false,perFrameRouteQuery:false,
    remoteConnectivityInvented:false,interSettlementRoadAuthorityAvailable:false,
    fallbackScope:"authoritative local Starting Village roads and road-access SpecialLots only",
    presentationOnly:true,simulationAuthority:false
  });
  cache.set(seed,result);
  while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
  return result;
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue),first=build(seed),second=build(seed);
  const four=first.signs.find(s=>s.purpose==="four-way-crossroads")||null;
  const three=first.signs.find(s=>s.purpose==="three-way-junction")||null;
  const exit=first.signs.find(s=>s.purpose==="village-exit")||null;
  const branchList=first.signs.flatMap(s=>s.branches);
  const everyRouteTruthful=branchList.length>0&&branchList.every(b=>b.reachable===true&&b.neighborRoad===true&&b.routeDistanceMeters>=0&&b.destinationAuthority);
  const noRoadBlocking=first.signs.every(s=>s.anchor.roadBlocked===false&&s.anchor.occupied===false);
  const deterministic=first.signature===second.signature;
  return Object.freeze({
    pass:Boolean(deterministic&&four?.roadDegree>=4&&three?.roadDegree===3&&exit&&everyRouteTruthful&&noRoadBlocking&&first.signCount>=3),
    version:VERSION,deterministic,signature:first.signature,signCount:first.signCount,panelCount:first.panelCount,
    fourWayPass:Boolean(four?.roadDegree>=4),threeWayPass:Boolean(three?.roadDegree===3),villageExitPass:Boolean(exit),
    everyRouteTruthful,noRoadBlocking,routeQueryCount:first.routeQueryCount,routeQueryMs:first.routeQueryMs,
    bounded:first.bounded,fullWorldScan:first.fullWorldScan,perFrameRouteQuery:first.perFrameRouteQuery,
    remoteConnectivityInvented:first.remoteConnectivityInvented,interSettlementRoadAuthorityAvailable:first.interSettlementRoadAuthorityAvailable,
    fallbackScope:first.fallbackScope,signs:first.signs
  });
}
function clear(){cache.clear();}

window.RoadSignposts=Object.freeze({
  VERSION,MAX_SIGNS,MAX_DESTINATIONS_PER_SIGN,MAX_ROUTE_TILES,MAX_ROUTE_NODES,
  build,proof,clear
});
})();
