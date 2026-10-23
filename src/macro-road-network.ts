import { compareText } from "./compare-text.ts";
import {roadBucketCells} from './road-spatial-index.ts';
import {macroSampleAt} from './macro-geography.ts';
import {CANONICAL_PLANET_RADIUS, CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance, lonLatToSource, sourceToLonLat, wrapSourceX, type CanonicalPosition, type LonLat} from './planet.ts';

export const MACRO_ROAD_VERSION='macro-roads-v2';
export const MACRO_ROAD_LIMITS=Object.freeze({stages:12,lanes:7,maximumStations:26,junctionGroupsPerPlace:32,junctionDepth:3,corridorAttempts:3});
export const ROAD_FORK_POLICY=Object.freeze({minimumAngleDegrees:45,preferredMinimumDegrees:45,preferredMaximumDegrees:70,hardNearParallelDegrees:20,separationM:300,maximumRegenerationAttempts:12});
export type RoadNode={id:string;code:string;canonicalPosition:CanonicalPosition;x:number;z:number;continent:number;country:number;kind:'city'|'village'|'junction'};
export type RoadPoint={x:number;z:number;position:LonLat};
export type MacroRoadConnection={from:string;to:string;legs:{edgeId:string;reverse:boolean}[]};
type CoarseWater={ax:number;az:number;bx:number;bz:number;width:number};
export type MacroRoadEdge={id:string;from:RoadNode;to:RoadNode;points:readonly RoadPoint[];kind:'trunk'|'link';fallback:boolean};
const ownerKey=(n:RoadNode)=>`${n.continent}/${n.country}`;
const digest=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0)/4294967296;};
function destination(p:LonLat,bearing:number,distanceM:number):CanonicalPosition{
 const a=distanceM/CANONICAL_PLANET_RADIUS,lat=Math.asin(Math.sin(p.lat)*Math.cos(a)+Math.cos(p.lat)*Math.sin(a)*Math.cos(bearing)),
 lon=p.lon+Math.atan2(Math.sin(bearing)*Math.sin(a)*Math.cos(p.lat),Math.cos(a)-Math.sin(p.lat)*Math.sin(lat));
 return {lon:Math.atan2(Math.sin(lon),Math.cos(lon)),lat,elevation:0};
}
function bearing(a:LonLat,b:LonLat){const d=b.lon-a.lon;return Math.atan2(Math.sin(d)*Math.cos(b.lat),Math.cos(a.lat)*Math.sin(b.lat)-Math.sin(a.lat)*Math.cos(b.lat)*Math.cos(d));}
const angleDifference=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

/** Finite coarse graph only. No final cells, buildings or scenery are prepared.
 * Shared approaches become one physical trunk; connection records reference it.
 * Layered terrain search penalizes climb, high relief, obstacles and sharp turns. */
export function createMacroRoadNetwork(places:readonly RoadNode[],links:readonly (readonly [RoadNode,RoadNode])[],ownerAt:(p:LonLat)=>string|undefined,seed:string,sample:typeof macroSampleAt=macroSampleAt,waterSegments:readonly CoarseWater[]=[]){
 let coarseSamples=0,maxStates=0,fallbacks=0,unbridgeableCrossings=0;

 const waterBuckets=new Map<string,CoarseWater[]>(),waterSize=8192;
 for(const river of waterSegments)for(const shift of [-262144,0,262144])for(const [x,z] of roadBucketCells({fromX:river.ax,fromZ:river.az,toX:river.ax+wrapSourceX(river.bx-river.ax),toZ:river.bz},waterSize,river.width,shift)){
  const key=`${x}/${z}`,list=waterBuckets.get(key)||[];list.push(river);waterBuckets.set(key,list);
 }
 const inWater=(p:LonLat,margin=0)=>{const q=lonLatToSource(p.lon,p.lat);return (waterBuckets.get(`${Math.floor(q.x/waterSize)}/${Math.floor(q.z/waterSize)}`)||[]).some(r=>{
  const ax=q.x+wrapSourceX(r.ax-q.x),dx=wrapSourceX(r.bx-r.ax),dz=r.bz-r.az,t=Math.max(0,Math.min(1,((q.x-ax)*dx+(q.z-r.az)*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(q.x-ax-dx*t,q.z-r.az-dz*t)<r.width+margin;
 });};
 const terrain=(p:LonLat)=>{coarseSamples++;return sample(p);},
 legal=(p:LonLat,key:string)=>{const t=terrain(p);return t.land&&t.domain!=='Lake'&&ownerAt(p)===key;},
 lineLegal=(a:LonLat,b:LonLat,key:string,steps=8)=>{const d=greatCircleDistance(a,b),az=bearing(a,b);for(let i=0;i<=steps;i++)if(!legal(destination(a,az,d*i/steps),key))return false;return true;};
 // The canonical world graph always contains city/backbone links. Bound only its
 // optional village-to-village trade degree; standalone road-network callers keep
 // every supplied link and therefore retain the generic shared-fork contract.
 const canonicalVillageGraph=places.some(p=>p.kind==='city'),
  linkKey=(a:RoadNode,b:RoadNode)=>a.id<b.id?`${a.id}|${b.id}`:`${b.id}|${a.id}`,
  tradeDegree=new Map<string,number>(),selectedTradeLinks=new Set<string>();
 if(canonicalVillageGraph)for(const [a,b] of [...links].filter(([a,b])=>a.kind==='village'&&b.kind==='village').sort((left,right)=>compareText(linkKey(left[0],left[1]), linkKey(right[0],right[1])))){
  if((tradeDegree.get(a.id)||0)>=1||(tradeDegree.get(b.id)||0)>=1)continue;
  selectedTradeLinks.add(linkKey(a,b));tradeDegree.set(a.id,1);tradeDegree.set(b.id,1);
 }
 const activeLinks=canonicalVillageGraph?links.filter(([a,b])=>a.kind!=='village'||b.kind!=='village'||selectedTradeLinks.has(linkKey(a,b))):links,
  neighbours=new Map(places.map(p=>[p.id,[] as RoadNode[]]));
 for(const [a,b] of activeLinks){neighbours.get(a.id)!.push(b);neighbours.get(b.id)!.push(a);}
 // One shared-approach owner per logical connection. Otherwise deep forks at
 // both ends can pass each other and create a folded-back central road. Higher
 // degree hubs share first; SEED breaks equal-degree ties, independent of order.
 const ownsApproach=(hub:RoadNode,leaf:RoadNode)=>{const a=neighbours.get(hub.id)!.length,b=neighbours.get(leaf.id)!.length;if(a!==b)return a>b;const low=hub.id<leaf.id?hub:leaf,high=hub.id<leaf.id?leaf:hub,owner=digest(`${seed}/${low.id}/${high.id}/approach-owner`)<.5?low:high;return owner.id===hub.id;};
 const junctions:RoadNode[]=[],approaches=new Map<string,RoadNode[]>();
 const approachKey=(a:RoadNode,b:RoadNode)=>`${a.id}>${b.id}`;
 type Approach={node:RoadNode;leaves:RoadNode[];depth:number;distance:Map<string,number>;children?:[Approach,Approach]};
 let maximumJunctionDepth=0,maximumForkAttempts=0,rejectedForkCandidates=0;
 const minimumArmAngle=(p:LonLat,ends:readonly LonLat[])=>Math.min(...ends.flatMap((a,i)=>ends.slice(i+1).map(b=>angleDifference(bearing(p,a),bearing(p,b))*180/Math.PI)));
 const forkChildren=new Map<string,[RoadNode,RoadNode]>();
 const validStub=(p:LonLat,target:LonLat,key:string)=>{const length=greatCircleDistance(p,target),end=destination(p,bearing(p,target),Math.min(ROAD_FORK_POLICY.separationM,length*.25));return lineLegal(p,end,key,4)&&!inWater(end,2);};
 for(const hub of [...places].sort((a,b)=>compareText(a.id, b.id))){
  let groups:Approach[]=[...new Map(neighbours.get(hub.id)!.map(n=>[n.id,n])).values()].sort((a,b)=>compareText(a.id, b.id))
   .map(node=>({node,leaves:[node],depth:0,distance:new Map([[node.id,0]])}));
  let slot=0;
  while(slot<MACRO_ROAD_LIMITS.junctionGroupsPerPlace){
   const pairs:{a:Approach;b:Approach;angle:number}[]=[];
   for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
    const a=groups[i],b=groups[j];
    if([...a.leaves,...b.leaves].some(n=>!ownsApproach(hub,n)))continue;
    if(Math.max(a.depth,b.depth)>=MACRO_ROAD_LIMITS.junctionDepth||[...a.leaves,...b.leaves].some(n=>greatCircleDistance(hub.canonicalPosition,n.canonicalPosition)<=6500))continue;
    const angle=angleDifference(bearing(hub.canonicalPosition,a.node.canonicalPosition),bearing(hub.canonicalPosition,b.node.canonicalPosition));
    if(angle<65*Math.PI/180)pairs.push({a,b,angle});
   }
   pairs.sort((a,b)=>a.angle-b.angle||compareText(a.a.node.id, b.a.node.id)||compareText(a.b.node.id, b.b.node.id));
   let accepted=false;
   for(const pair of pairs){
    const a=pair.a.node,b=pair.b.node,azA=bearing(hub.canonicalPosition,a.canonicalPosition),azB=bearing(hub.canonicalPosition,b.canonicalPosition),
     az=Math.atan2(Math.sin(azA)+Math.sin(azB),Math.cos(azA)+Math.cos(azB)),
     da=greatCircleDistance(hub.canonicalPosition,a.canonicalPosition),db=greatCircleDistance(hub.canonicalPosition,b.canonicalPosition),
     radius=Math.min(da,db)-ROAD_FORK_POLICY.separationM,key=ownerKey(hub);
    if(radius<ROAD_FORK_POLICY.separationM*2)continue;
    let chosen:CanonicalPosition|undefined,best=Infinity;
    for(let attempt=0;attempt<ROAD_FORK_POLICY.maximumRegenerationAttempts;attempt++){
     maximumForkAttempts=Math.max(maximumForkAttempts,attempt+1);
     const token=`${seed}/${hub.id}/${slot}/${a.id}/${b.id}/${attempt}`,
      offset=(digest(token+'/az')-.5)*.12,
      target=ROAD_FORK_POLICY.preferredMinimumDegrees+(ROAD_FORK_POLICY.preferredMaximumDegrees-ROAD_FORK_POLICY.preferredMinimumDegrees)*digest(token+'/angle'),
      pointAt=(r:number)=>destination(hub.canonicalPosition,az+offset,r),
      branchAngle=(p:LonLat)=>angleDifference(bearing(p,a.canonicalPosition),bearing(p,b.canonicalPosition))*180/Math.PI;
     let low:number=ROAD_FORK_POLICY.separationM,high=radius;
     if(branchAngle(pointAt(high))<target){rejectedForkCandidates++;continue;}
     // Fixed numerical root solve is separate from the twelve recipe candidates.
     for(let step=0;step<16;step++){const mid=(low+high)/2;if(branchAngle(pointAt(mid))<target)low=mid;else high=mid;}
     const p=pointAt(high),t=terrain(p),hp=greatCircleDistance(hub.canonicalPosition,p),pa=greatCircleDistance(p,a.canonicalPosition),pb=greatCircleDistance(p,b.canonicalPosition),angle=branchAngle(p);
     if(angle<ROAD_FORK_POLICY.preferredMinimumDegrees||angle>ROAD_FORK_POLICY.preferredMaximumDegrees||minimumArmAngle(p,[hub.canonicalPosition,a.canonicalPosition,b.canonicalPosition])<ROAD_FORK_POLICY.minimumAngleDegrees){rejectedForkCandidates++;continue;}
     if(!t.land||t.domain==='Lake'||t.reliefM>140||ownerAt(p)!==key||inWater(p,20)||Math.min(pa,pb)<ROAD_FORK_POLICY.separationM)continue;
     if(junctions.some(j=>greatCircleDistance(p,j.canonicalPosition)<ROAD_FORK_POLICY.separationM))continue;
     if(![hub,a,b].every(n=>validStub(p,n.canonicalPosition,key)))continue;
     // A new parent may move an older fork's trunk direction; recheck that fork.
     if([a,b].some(child=>{const ends=forkChildren.get(child.id);return ends&&(minimumArmAngle(child.canonicalPosition,[p,...ends.map(n=>n.canonicalPosition)])<ROAD_FORK_POLICY.minimumAngleDegrees||!validStub(child.canonicalPosition,p,key));}))continue;
     // Each merge must save physical road length, while every original approach
     // retains a reasonable distance from its hub. Nested Y nodes share the savings.
     if(hp+pa+pb>(da+db)*.99)continue;
     if(pair.a.leaves.some(n=>hp+pa+pair.a.distance.get(n.id)!>greatCircleDistance(hub.canonicalPosition,n.canonicalPosition)*1.12)||
        pair.b.leaves.some(n=>hp+pb+pair.b.distance.get(n.id)!>greatCircleDistance(hub.canonicalPosition,n.canonicalPosition)*1.12))continue;
     if(!lineLegal(hub.canonicalPosition,p,key)||!lineLegal(p,a.canonicalPosition,key)||!lineLegal(p,b.canonicalPosition,key))continue;
     const cost=t.reliefM*8+Math.abs(offset)*500+Math.abs(angle-57.5)*8+(hp+pa+pb)*.002+digest(token+'/cost');
     if(cost<best){best=cost;chosen=p;}
    }
    if(!chosen)continue;
    const source=lonLatToSource(chosen.lon,chosen.lat),node:RoadNode={continent:hub.continent,country:hub.country,id:`J/${hub.id}/${slot}`,code:`${seed}/${MACRO_ROAD_VERSION}/J/${hub.id}/${slot}`,kind:'junction',canonicalPosition:chosen,x:source.x,z:source.z},distance=new Map<string,number>();
    for(const child of [pair.a,pair.b]){const d=greatCircleDistance(chosen,child.node.canonicalPosition);for(const leaf of child.leaves)distance.set(leaf.id,d+child.distance.get(leaf.id)!);}
    const depth=Math.max(pair.a.depth,pair.b.depth)+1,group:Approach={node,leaves:[...pair.a.leaves,...pair.b.leaves],depth,distance,children:[pair.a,pair.b]};
    forkChildren.set(node.id,[a,b]);junctions.push(node);groups=groups.filter(g=>g!==pair.a&&g!==pair.b);groups.push(group);groups.sort((a,b)=>compareText(a.node.id, b.node.id));
    maximumJunctionDepth=Math.max(maximumJunctionDepth,depth);slot++;accepted=true;break;
   }
   if(!accepted)break;
  }
  const register=(group:Approach,path:RoadNode[])=>{
   if(!group.children){approaches.set(approachKey(hub,group.node),path);return;}
   const next=[...path,group.node];for(const child of group.children)register(child,next);
  };
  for(const group of groups)register(group,[hub]);
 }
 function routeTerrain(from:RoadNode,to:RoadNode,id:string,attempt=0):{points:RoadPoint[];fallback:boolean}{
  const a=from.canonicalPosition,b=to.canonicalPosition,length=greatCircleDistance(a,b),az=bearing(a,b),stages=Math.max(4,Math.min(MACRO_ROAD_LIMITS.stages,Math.ceil(length/4000)+attempt*2)),
   width=Math.min(20000,Math.max(1000,length*.18)*(1+attempt)),key=ownerKey(from),rows=[] as {lane:number;point:RoadPoint;height:number;mountain:number;legal:boolean}[][];
  for(let stage=0;stage<=stages;stage++){
   const t=stage/stages,base=stage===0?a:stage===stages?b:destination(a,az,length*t),row=[] as typeof rows[number];
   for(const lane of stage===0||stage===stages?[0]:[-3,-2,-1,0,1,2,3]){
    const position=lane===0?base:destination(base,az+(lane<0?-Math.PI/2:Math.PI/2),Math.abs(lane)/3*width*Math.sin(Math.PI*t)),
     source=lonLatToSource(position.lon,position.lat),m=terrain(position);
    row.push({lane,point:{x:from.x+wrapSourceX(source.x-from.x),z:source.z,position:{lon:position.lon,lat:position.lat}},height:m.reliefM,mountain:m.mountainIntensity,legal:m.land&&m.domain!=='Lake'&&ownerAt(position)===key&&!inWater(position)});
   }
   rows.push(row);
  }
  const localWater=new Set<CoarseWater>(),all=rows.flat().map(n=>n.point),minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minZ=Math.min(...all.map(p=>p.z)),maxZ=Math.max(...all.map(p=>p.z));
  for(let z=Math.floor(minZ/waterSize);z<=Math.floor(maxZ/waterSize);z++)for(let x=Math.floor(minX/waterSize);x<=Math.floor(maxX/waterSize);x++)for(const r of waterBuckets.get(`${x}/${z}`)||[])localWater.add(r);
  const crossingCost=(a:RoadPoint,b:RoadPoint)=>{let cost=0;const dx=b.x-a.x,dz=b.z-a.z;
   for(const r of localWater){const ax=a.x+wrapSourceX(r.ax-a.x),vx=wrapSourceX(r.bx-r.ax),vz=r.bz-r.az,det=dx*vz-dz*vx;
    if(Math.abs(det)<1e-9)continue;
    const qx=ax-a.x,qz=r.az-a.z,t=(qx*vz-qz*vx)/det,u=(qx*dz-qz*dx)/det;
    if(t<0||t>1||u<0||u>1)continue;
    const sine=Math.abs(det)/(Math.hypot(dx,dz)*Math.hypot(vx,vz)||1),span=2*r.width*CANONICAL_METRES_PER_SOURCE_UNIT/Math.max(.001,sine);
    if(span>120){unbridgeableCrossings++;return Infinity;}
    cost+=1500+span*30;
   }return cost;
  };
  type State={lane:number;previousLane:number;cost:number;node:typeof rows[number][number];previous?:State};
  let states:State[]=[{lane:0,previousLane:0,cost:0,node:rows[0][0]}];
  for(let stage=1;stage<=stages;stage++){
   const next=new Map<string,State>(),edgeCosts=new Map<string,number>();
   for(const state of states)for(const node of rows[stage]){
    if(!node.legal)continue;
    const edgeKey=`${state.lane}/${node.lane}`;
    let cost=edgeCosts.get(edgeKey);
    if(cost===undefined){
     const distance=greatCircleDistance(state.node.point.position,node.point.position),mid=sourceToLonLat((state.node.point.x+node.point.x)/2,(state.node.point.z+node.point.z)/2),m=terrain(mid),
      grade=Math.max(Math.abs(node.height-state.node.height),Math.abs(m.reliefM-state.node.height)*2,Math.abs(node.height-m.reliefM)*2)/Math.max(1,distance);
     cost=!m.land||m.domain==='Lake'||ownerAt(mid)!==key?Infinity:distance*(1+m.mountainIntensity*3+Math.max(0,m.reliefM-25)*.006+Math.pow(grade/.06,2)*5)+crossingCost(state.node.point,node.point);
     edgeCosts.set(edgeKey,cost);
    }
    if(!Number.isFinite(cost))continue;
    let turn=0;
    if(state.previous){const p=state.previous.node.point,q=state.node.point,r=node.point,cos=Math.max(.2,Math.cos(q.position.lat)),ux=(q.x-p.x)*cos,uz=q.z-p.z,vx=(r.x-q.x)*cos,vz=r.z-q.z;
     turn=(1-(ux*vx+uz*vz)/(Math.hypot(ux,uz)*Math.hypot(vx,vz)||1))*greatCircleDistance(q.position,r.position)*.7;
    }
    const total=state.cost+cost+turn+digest(`${seed}/${id}/${stage}/${node.lane}`)*.01,k=`${state.lane}/${node.lane}`,old=next.get(k);
    if(!old||total<old.cost)next.set(k,{lane:node.lane,previousLane:state.lane,cost:total,node,previous:state});
   }
   states=[...next.values()];maxStates=Math.max(maxStates,states.length);
   if(!states.length)break;
  }
  let best=states.sort((a,b)=>a.cost-b.cost||a.lane-b.lane)[0];
  // Three finite corridors widen/refine only when necessary. Never emit a known
  // illegal straight road when the terrain search cannot connect its endpoints.
  if(!best||best.node!==rows[stages][0]){if(attempt+1<MACRO_ROAD_LIMITS.corridorAttempts)return routeTerrain(from,to,id,attempt+1);throw new RangeError(`No legal coarse road corridor: ${id}`);}
  const path:RoadPoint[]=[];for(let state:State|undefined=best;state;state=state.previous)path.push(state.node.point);path.reverse();
  // Remove near-collinear stations only. Keep terrain-selected deviations.
  for(let i=path.length-2;i>0;i--){const a=path[i-1],p=path[i],b=path[i+1],dx=b.x-a.x,dz=b.z-a.z,t=((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),deviation=Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)*CANONICAL_METRES_PER_SOURCE_UNIT;
   if(deviation<15&&Number.isFinite(crossingCost(a,b))&&legal(sourceToLonLat((a.x+b.x)/2,(a.z+b.z)/2),key))path.splice(i,1);
  }
  // One bounded corner-rounding pass, preserving exact shared graph nodes.
  const smooth=[path[0]];
  for(let i=1;i<path.length-1;i++){
   const p=path[i],a=path[i-1],b=path[i+1],point=(q:RoadPoint,t:number)=>{const x=p.x+(q.x-p.x)*t,z=p.z+(q.z-p.z)*t;return{x,z,position:sourceToLonLat(x,z)};},u=point(a,.18),v=point(b,.18);
   if(!inWater(u.position)&&!inWater(v.position)&&Number.isFinite(crossingCost(u,v))&&legal(u.position,key)&&legal(v.position,key)&&legal(sourceToLonLat((u.x+v.x)/2,(u.z+v.z)/2),key))smooth.push(u,v);else smooth.push(p);
  }
  smooth.push(path.at(-1)!);return {points:smooth,fallback:false};
 }
 const edges=new Map<string,MacroRoadEdge>();
 function edge(from:RoadNode,to:RoadNode,kind:MacroRoadEdge['kind']){
  const forward=from.id<to.id,a=forward?from:to,b=forward?to:from,id=`${a.id}~${b.id}`;
  if(!edges.has(id)){
   const stub=(node:RoadNode,target:RoadNode):RoadNode=>{if(node.kind!=='junction')return node;const p=destination(node.canonicalPosition,bearing(node.canonicalPosition,target.canonicalPosition),Math.min(ROAD_FORK_POLICY.separationM,greatCircleDistance(node.canonicalPosition,target.canonicalPosition)*.25)),q=lonLatToSource(p.lon,p.lat);return {...node,id:node.id+'/approach',canonicalPosition:p,x:q.x,z:q.z,kind:'village'};},
    start=stub(a,b),finish=stub(b,a),result=routeTerrain(start,finish,id),points=[...result.points];
   // Preserve legal local approach rays so terrain search cannot collapse a fork
   // back into two near-parallel first segments after choosing valid topology.
   if(start!==a)points.unshift({x:a.x,z:a.z,position:{lon:a.canonicalPosition.lon,lat:a.canonicalPosition.lat}});
   if(finish!==b)points.push({x:b.x,z:b.z,position:{lon:b.canonicalPosition.lon,lat:b.canonicalPosition.lat}});
   const continuous=points.map(p=>({...p,x:a.x+wrapSourceX(p.x-a.x)}));
   // A coincident route/stub station has no meaningful departure bearing.
   // Keep exact graph endpoints, remove sub-centimetre duplicate stations.
   for(let i=continuous.length-2;i>0;i--)if(greatCircleDistance(continuous[i].position,continuous[i+1].position)<.01||greatCircleDistance(continuous[i-1].position,continuous[i].position)<.01)continuous.splice(i,1);
   edges.set(id,{id,from:a,to:b,points:continuous,kind,fallback:result.fallback});
  }
  return {edgeId:id,reverse:!forward};
 }
 const connections:MacroRoadConnection[]=[];
 for(const [from,to] of activeLinks){
  const a=approaches.get(approachKey(from,to))??[from],b=approaches.get(approachKey(to,from))??[to],legs=[] as MacroRoadConnection['legs'];
  for(let i=1;i<a.length;i++)legs.push(edge(a[i-1],a[i],'trunk'));
  legs.push(edge(a.at(-1)!,b.at(-1)!,'link'));
  for(let i=b.length-1;i>0;i--)legs.push(edge(b[i],b[i-1],'trunk'));
  connections.push({from:from.id,to:to.id,legs});
 }
 // Terrain routing can introduce acute approaches at the other end of a
 // logical connection even when the distant coarse fork was legal. Merge those
 // ACTUAL first segments locally; both routes reference one physical stem.
 // This bounded pass never reroutes the distant terrain-selected alignment.
 for (const hub of [...places].sort((a,b)=>compareText(a.id, b.id))) {
  for(let slot=0;slot<8;slot++) {
   const incident=[...edges.values()].filter(e=>e.from.id===hub.id||e.to.id===hub.id),
    outward=(e:MacroRoadEdge)=>e.from.id===hub.id?[...e.points]:[...e.points].reverse(),
    pairs=incident.flatMap((a,i)=>incident.slice(i+1).map(b=>({a,b,angle:angleDifference(bearing(hub.canonicalPosition,outward(a)[1].position),bearing(hub.canonicalPosition,outward(b)[1].position))})))
     .filter(p=>p.angle<Math.PI/4-1e-8).sort((a,b)=>a.angle-b.angle||compareText(a.a.id, b.a.id)||compareText(a.b.id, b.b.id));
   let merged=false;
   for(const pair of pairs) {
    const pa=outward(pair.a),pb=outward(pair.b),azA=bearing(hub.canonicalPosition,pa[1].position),azB=bearing(hub.canonicalPosition,pb[1].position),
     az=Math.atan2(Math.sin(azA)+Math.sin(azB),Math.cos(azA)+Math.cos(azB)),
     maxD=Math.min(300,greatCircleDistance(hub.canonicalPosition,pa[1].position)*.8,greatCircleDistance(hub.canonicalPosition,pb[1].position)*.8),key=ownerKey(hub);
    for(let attempt=0;attempt<8&&!merged;attempt++) {
     const d=maxD*[1,.8,.6,.4,.2,.1,.05,.02][attempt],r=d*(Math.cos(pair.angle/2)-Math.sin(pair.angle/2)/Math.tan(Math.PI/6));
     if(r<1)continue;
     const p=destination(hub.canonicalPosition,az,r),a=destination(hub.canonicalPosition,azA,d),b=destination(hub.canonicalPosition,azB,d);
     if(minimumArmAngle(p,[hub.canonicalPosition,a,b])<45)continue;
     if(junctions.some(j=>greatCircleDistance(p,j.canonicalPosition)<1))continue;
     const dryLine=(u:LonLat,v:LonLat)=>lineLegal(u,v,key,8)&&Array.from({length:9},(_,i)=>destination(u,bearing(u,v),greatCircleDistance(u,v)*i/8)).every(q=>!inWater(q,4));
     if(![hub.canonicalPosition,a,b].every(q=>dryLine(p,q))){
      continue;
     }
     const q=lonLatToSource(p.lon,p.lat),node:RoadNode={...hub,id:`J/LOCAL/${hub.id}/${slot}`,code:`${seed}/${MACRO_ROAD_VERSION}/J/LOCAL/${hub.id}/${slot}`,kind:'junction',canonicalPosition:p,x:q.x,z:q.z},
      point=(v:LonLat):RoadPoint=>{const q=lonLatToSource(v.lon,v.lat);return {x:hub.x+wrapSourceX(q.x-hub.x),z:q.z,position:v};},
      stemId=`${hub.id}~${node.id}`;
     for(const [old,tap] of [[pair.a,a],[pair.b,b]] as const) {
      const fromHub=old.from.id===hub.id,path=[point(p),point(tap),...outward(old).slice(1)].map(v=>({...v,x:hub.x+wrapSourceX(v.x-hub.x)}));
      for(const c of connections)c.legs=c.legs.flatMap(leg=>{
       if(leg.edgeId!==old.id)return [leg];
       const stem={edgeId:stemId,reverse:!(fromHub!==leg.reverse)};
       return fromHub!==leg.reverse?[stem,leg]:[leg,stem];
      });
      edges.set(old.id,{...old,from:fromHub?node:old.from,to:fromHub?old.to:node,points:fromHub?path:path.reverse()});
     }
     edges.set(stemId,{id:stemId,from:hub,to:node,points:[point(hub.canonicalPosition),point(p)],kind:'trunk',fallback:false});
     junctions.push(node);merged=true;
    }
    if(merged)break;
   }
   if(!merged)break;
  }
 }
 const physical=[...edges.values()],bent=physical.filter(e=>e.points.length>2&&e.points.some(p=>{const a=e.points[0],b=e.points.at(-1)!,dx=b.x-a.x,dz=b.z-a.z,t=((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1);return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t)*CANONICAL_METRES_PER_SOURCE_UNIT>100;})).length;
 const forkAngles=junctions.map(j=>{const ends=physical.filter(e=>e.from.id===j.id||e.to.id===j.id).map(e=>e.from.id===j.id?e.points[1].position:e.points.at(-2)!.position);return minimumArmAngle(j.canonicalPosition,ends);});
 let minimumJunctionSeparationM=Infinity;for(let i=0;i<junctions.length;i++)for(let k=i+1;k<junctions.length;k++)minimumJunctionSeparationM=Math.min(minimumJunctionSeparationM,greatCircleDistance(junctions[i].canonicalPosition,junctions[k].canonicalPosition));
 return {junctions,connections,edges:physical,telemetry:{version:MACRO_ROAD_VERSION,forkPolicy:ROAD_FORK_POLICY,maximumForkAttempts,rejectedForkCandidates,minimumForkAngleDegrees:forkAngles.length?Math.min(...forkAngles):null,minimumJunctionSeparationM:Number.isFinite(minimumJunctionSeparationM)?minimumJunctionSeparationM:null,junctions:junctions.length,sharedTrunks:physical.filter(e=>e.kind==='trunk').length,physicalEdges:physical.length,connections:connections.length,bentEdges:bent,coarseSamples,maxStates,maximumJunctionDepth,fallbacks,unbridgeableCrossings,maximumStations:Math.max(...physical.map(e=>e.points.length))}};
}