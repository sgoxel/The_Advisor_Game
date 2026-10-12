import { roadAt, villages } from "../src/geography.ts";
import {
  ROUTE_CELL_MIN_M,
  ROUTE_MAX_CELLS,
  ROUTE_MAX_EXPANSIONS,
  macroTerrainSampler,
  planRoute,
} from "../src/routing.ts";
import {
  enuToPosition,
  greatCircleDistance,
  lonLatToFlat,
  positionToEnu,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "../src/planet.ts";
import { drainageRecipesNear, surfaceAt, type DrainagePoint } from "../src/surface.ts";
import { CELL_SIZE } from "../src/world.ts";

const A = "1/2/0/1", B = "1/5/1/0";
const from = villages.find((v) => v.id === A)!;
const to = villages.find((v) => v.id === B)!;
const STEP = 300;

function state(position: LonLat) {
  const flat = lonLatToFlat(position.lon, position.lat);
  const x = Math.floor(flat.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  const z = Math.floor(flat.z / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  return { surface: surfaceAt(x, z), road: roadAt(x, z), x, z };
}
function validate(points: readonly LonLat[]) {
  for (let k = 1; k < points.length; k++) {
    const a: CanonicalPosition = { ...points[k - 1], elevation: 0 };
    const b: CanonicalPosition = { ...points[k], elevation: 0 };
    const d = positionToEnu(b, a);
    const len = greatCircleDistance(a, b);
    const steps = Math.max(1, Math.ceil(len / STEP));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const p = enuToPosition({ east: d.east * t, north: d.north * t, up: 0 }, a);
      const q = state(p);
      if (!q.surface.walkable) return { segmentIndex: k, stepIndex: s, steps, position: { lon: p.lon, lat: p.lat }, x: q.x, z: q.z, water: q.surface.water, catchmentCode: q.surface.catchmentCode };
    }
  }
  return null;
}
function dryApproaches(points: readonly LonLat[], blocked: any) {
  const a: CanonicalPosition = { ...points[blocked.segmentIndex - 1], elevation: 0 };
  const b: CanonicalPosition = { ...points[blocked.segmentIndex], elevation: 0 };
  const d = positionToEnu(b, a);
  const at = (s: number) => {
    const t = (s + 0.5) / blocked.steps;
    const p = enuToPosition({ east: d.east * t, north: d.north * t, up: 0 }, a);
    return { lon: p.lon, lat: p.lat };
  };
  let before: LonLat | undefined, after: LonLat | undefined;
  for (let s = blocked.stepIndex - 1; s >= 0; s--) { const p = at(s); if (state(p).surface.walkable) { before = p; break; } }
  if (!before && state(a).surface.walkable) before = { lon: a.lon, lat: a.lat };
  for (let s = blocked.stepIndex + 1; s < blocked.steps; s++) { const p = at(s); if (state(p).surface.walkable) { after = p; break; } }
  if (!after && state(b).surface.walkable) after = { lon: b.lon, lat: b.lat };
  return before && after ? [before, after] as const : undefined;
}
function projection(x:number,z:number,a:DrainagePoint,b:DrainagePoint){const dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,qx=wrapSourceX(x-a.x),qz=z-a.z,l=dx*dx+dz*dz,t=l<=1e-9?0:Math.max(0,Math.min(1,(qx*dx+qz*dz)/l));return{distance:Math.hypot(qx-dx*t,qz-dz*t),t};}
function nearest(recipe:any,x:number,z:number){let best:any;for(const entry of [{path:recipe.points,width:recipe.width},{path:recipe.tributary,width:recipe.width*.62}])for(let i=0;i+1<entry.path.length;i++){const p=projection(x,z,entry.path[i],entry.path[i+1]);if(!best||p.distance<best.distance)best={...entry,segmentIndex:i,...p};}return best;}
function side(point:{x:number;z:number},a:DrainagePoint,b:DrainagePoint){const dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,qx=wrapSourceX(point.x-a.x),qz=point.z-a.z;return dx*qz-dz*qx<0?-1:1;}
function bank(path:readonly DrainagePoint[],i:number,s:number,c:number){const p=path[i],b=path[Math.max(0,i-1)],a=path[Math.min(path.length-1,i+1)];let dx=wrapSourceX(a.x-b.x),dz=a.z-b.z;if(Math.hypot(dx,dz)<1e-6){const n=i+1<path.length?path[i+1]:path[i-1];dx=wrapSourceX(n.x-p.x);dz=n.z-p.z;}const l=Math.hypot(dx,dz)||1;return sourceToLonLat(wrapSourceX(p.x+(-dz/l)*s*c),p.z+(dx/l)*s*c);}
function projected(path:readonly DrainagePoint[],i:number,t:number,s:number,c:number){const a=path[i],b=path[i+1],dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,l=Math.hypot(dx,dz)||1,bx=wrapSourceX(a.x+dx*t),bz=a.z+dz*t;return sourceToLonLat(wrapSourceX(bx+(-dz/l)*s*c),bz+(dx/l)*s*c);}
function cap(path:readonly DrainagePoint[],sa:number,sb:number,c:number){const h=path[0],n=path[1],dx=wrapSourceX(n.x-h.x),dz=n.z-h.z,l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,px=-tz,pz=tx,u=c*2.35,sh=c*1.12,m=(s:number,f=1)=>sourceToLonLat(wrapSourceX(h.x-tx*u*f+px*s*sh),h.z-tz*u*f+pz*s*sh);return[m(sa,.76),sourceToLonLat(wrapSourceX(h.x-tx*u),h.z-tz*u),m(sb,.76)];}

function component(fromP:LonLat,toP:LonLat,guide:readonly LonLat[],edgeSafe=false,targetRadius=0){
  const origin:CanonicalPosition={...fromP,elevation:0}; const dest=positionToEnu({...toP,elevation:0},origin); const ge=guide.map(p=>positionToEnu({...p,elevation:0},origin)); const pad=800;
  const minE=Math.min(0,dest.east,...ge.map(p=>p.east))-pad,maxE=Math.max(0,dest.east,...ge.map(p=>p.east))+pad,minN=Math.min(0,dest.north,...ge.map(p=>p.north))-pad,maxN=Math.max(0,dest.north,...ge.map(p=>p.north))+pad;
  let cell=Math.max(ROUTE_CELL_MIN_M,Math.ceil(Math.sqrt(((maxE-minE)*(maxN-minN))/ROUTE_MAX_CELLS))),i0=0,i1=0,j0=0,j1=0,w=0,h=0,total=ROUTE_MAX_CELLS+1; while(total>ROUTE_MAX_CELLS){i0=Math.floor(minE/cell);i1=Math.ceil(maxE/cell);j0=Math.floor(minN/cell);j1=Math.ceil(maxN/cell);w=i1-i0+1;h=j1-j0+1;total=w*h;if(total>ROUTE_MAX_CELLS)cell++;}
  const inside=(i:number,j:number)=>i>=i0&&i<=i1&&j>=j0&&j<=j1,idx=(i:number,j:number)=>(j-j0)*w+(i-i0),point=(i:number,j:number)=>{const p=enuToPosition({east:i*cell,north:j*cell,up:0},origin);return{lon:p.lon,lat:p.lat};};
  const sampled=new Uint8Array(total),pass=new Uint8Array(total); const ok=(i:number,j:number)=>{if(!inside(i,j))return false;const k=idx(i,j);if(!sampled[k]){sampled[k]=1;pass[k]=state(point(i,j)).surface.walkable?1:0;}return pass[k]===1;};
  const si=0,sj=0,ri=Math.round(dest.east/cell),rj=Math.round(dest.north/cell); const targets=new Set<number>();
  for(let dj=-targetRadius;dj<=targetRadius;dj++)for(let di=-targetRadius;di<=targetRadius;di++){const ei=ri+di,ej=rj+dj;if(!inside(ei,ej)||!ok(ei,ej))continue;if(validate([point(ei,ej),toP])===null)targets.add(idx(ei,ej));}
  if(!ok(si,sj)||targets.size===0)return{cell,total,startPass:ok(si,sj),targetCandidates:targets.size,reached:false};
  const par=new Int32Array(total).fill(-1),vis=new Uint8Array(total),q=new Int32Array(total),start=idx(si,sj),moves=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]] as const;let head=0,tail=0,exp=0,hit=-1;q[tail++]=start;vis[start]=1;
  while(head<tail&&exp<Math.min(ROUTE_MAX_EXPANSIONS,total)){const cur=q[head++];if(targets.has(cur)){hit=cur;break;}exp++;const ci=(cur%w)+i0,cj=Math.floor(cur/w)+j0;for(const[di,dj]of moves){const ni=ci+di,nj=cj+dj;if(!inside(ni,nj)||!ok(ni,nj))continue;if(di&&dj&&(!ok(ci+di,cj)||!ok(ci,cj+dj)))continue;if(edgeSafe&&validate([point(ci,cj),point(ni,nj)])!==null)continue;const n=idx(ni,nj);if(vis[n])continue;vis[n]=1;par[n]=cur;q[tail++]=n;}}
  if(hit<0)return{cell,total,startPass:true,targetCandidates:targets.size,reached:false,expansions:exp,visited:tail};
  const cells:number[]=[];for(let cur=hit;cur!==-1;cur=par[cur]){cells.push(cur);if(cur===start)break;}cells.reverse();const pts:LonLat[]=[fromP];for(let x=1;x<cells.length;x++){const cur=cells[x],i=(cur%w)+i0,j=Math.floor(cur/w)+j0;pts.push(point(i,j));}pts.push(toP);return{cell,total,startPass:true,targetCandidates:targets.size,reached:true,expansions:exp,visited:tail,pathCells:cells.length,blocked:validate(pts)};
}

const coarse=planRoute({from:from.canonicalPosition,to:to.canonicalPosition,terrain:macroTerrainSampler});
const candidate=coarse.found?coarse.points:[{lon:from.canonicalPosition.lon,lat:from.canonicalPosition.lat},{lon:to.canonicalPosition.lon,lat:to.canonicalPosition.lat}];
const blocked=validate(candidate)!; const approaches=dryApproaches(candidate,blocked)!; const flat=lonLatToFlat(blocked.position.lon,blocked.position.lat); const recipe=drainageRecipesNear(flat.x,flat.z,2).find(r=>r.code===blocked.catchmentCode)!; const hit=nearest(recipe,flat.x,flat.z); const sa0=lonLatToFlat(approaches[0].lon,approaches[0].lat),sb0=lonLatToFlat(approaches[1].lon,approaches[1].lat); let sa=side(sa0,hit.path[hit.segmentIndex],hit.path[hit.segmentIndex+1]),sb=side(sb0,hit.path[hit.segmentIndex],hit.path[hit.segmentIndex+1]);if(sa===sb)sb=-sa;
const attempts=[];for(const factor of [1,1.35,1.8]){const c=Math.max(30,hit.width*2.2)*factor;const g:LonLat[]=[approaches[0],projected(hit.path,hit.segmentIndex,hit.t,sa,c)];for(let i=hit.segmentIndex;i>=0;i--)g.push(bank(hit.path,i,sa,c));g.push(...cap(hit.path,sa,sb,c));g.push(bank(hit.path,0,sb,c));for(let i=1;i<=hit.segmentIndex;i++)g.push(bank(hit.path,i,sb,c));g.push(projected(hit.path,hit.segmentIndex,hit.t,sb,c),approaches[1]);attempts.push({factor,clearance:c,badWaypoints:g.map((p,i)=>({i,s:state(p).surface})).filter(x=>!x.s.walkable).map(x=>({i:x.i,water:x.s.water,catchmentCode:x.s.catchmentCode})),current:component(approaches[0],approaches[1],g,false,0),edgeSafe:component(approaches[0],approaches[1],g,true,0),edgeSafeTargets:component(approaches[0],approaches[1],g,true,2)});}
console.log("WP15_ROUTE_DEBUG="+JSON.stringify({from:{country:from.country,pos:from.canonicalPosition},to:{country:to.country,pos:to.canonicalPosition},coarse:{found:coarse.found,reason:coarse.reason,points:coarse.points.length,expansions:coarse.expansions},blocked,approaches,recipe:recipe.code,hit:{segmentIndex:hit.segmentIndex,t:hit.t,width:hit.width,distance:hit.distance,pathLength:hit.path.length},sides:[sa,sb],attempts}));
