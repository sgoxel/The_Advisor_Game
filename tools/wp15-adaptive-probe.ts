import { roads, villages } from "../src/geography.ts";
import { lonLatToFlat, sourceToLonLat, wrapSourceX, positionToEnu, enuToPosition, greatCircleDistance, type CanonicalPosition, type LonLat } from "../src/planet.ts";
import { planRoute, macroTerrainSampler, type RoadSegment } from "../src/routing.ts";
import { drainageRecipesNear, surfaceAt, type DrainagePoint } from "../src/surface.ts";
import { CELL_SIZE } from "../src/world.ts";

const FROM = "1/2/0/1", TO = "1/5/1/0", STEP = 300;
const from = villages.find(v => v.id === FROM)!;
const to = villages.find(v => v.id === TO)!;
const roadSegments: readonly RoadSegment[] = roads.map(r => ({ code:r.code, from:r.fromPosition, to:r.toPosition }));

function finalSurface(p: LonLat) {
  const flat = lonLatToFlat(p.lon, p.lat), x = Math.floor(flat.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2, z = Math.floor(flat.z / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  return { ...surfaceAt(x,z), x, z };
}
function firstBlocked(points: readonly LonLat[]) {
  for (let k=1;k<points.length;k++) {
    const a:CanonicalPosition={...points[k-1],elevation:0}, b:CanonicalPosition={...points[k],elevation:0}, d=positionToEnu(b,a), len=greatCircleDistance(a,b), steps=Math.max(1,Math.ceil(len/STEP));
    for(let s=0;s<steps;s++) { const t=(s+.5)/steps, p=enuToPosition({east:d.east*t,north:d.north*t,up:0},a), q=finalSurface(p); if(!q.walkable) return {segmentIndex:k,stepIndex:s,steps,t,position:{lon:p.lon,lat:p.lat},surface:q}; }
  }
  return undefined;
}
const directValid=(a:LonLat,b:LonLat)=>!firstBlocked([a,b]);
function approaches(points:readonly LonLat[], blocked:any) {
  const a:CanonicalPosition={...points[blocked.segmentIndex-1],elevation:0}, b:CanonicalPosition={...points[blocked.segmentIndex],elevation:0}, d=positionToEnu(b,a);
  const at=(s:number)=>{const t=(s+.5)/blocked.steps,p=enuToPosition({east:d.east*t,north:d.north*t,up:0},a);return{lon:p.lon,lat:p.lat};};
  let before:LonLat|undefined, after:LonLat|undefined;
  for(let s=blocked.stepIndex-1;s>=0;s--){const p=at(s);if(finalSurface(p).walkable){before=p;break;}}
  if(!before&&finalSurface(a).walkable)before={lon:a.lon,lat:a.lat};
  for(let s=blocked.stepIndex+1;s<blocked.steps;s++){const p=at(s);if(finalSurface(p).walkable){after=p;break;}}
  if(!after&&finalSurface(b).walkable)after={lon:b.lon,lat:b.lat};
  return before&&after?[before,after] as const:undefined;
}
function proj(x:number,z:number,a:DrainagePoint,b:DrainagePoint){const dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,qx=wrapSourceX(x-a.x),qz=z-a.z,l=dx*dx+dz*dz,t=l<=1e-9?0:Math.max(0,Math.min(1,(qx*dx+qz*dz)/l));return{distance:Math.hypot(qx-dx*t,qz-dz*t),t};}
function nearest(recipe:any,x:number,z:number){let best:any;for(const entry of [{path:recipe.points,width:recipe.width},{path:recipe.tributary,width:recipe.width*.62}])for(let i=0;i+1<entry.path.length;i++){const p=proj(x,z,entry.path[i],entry.path[i+1]);if(!best||p.distance<best.distance)best={...entry,segmentIndex:i,...p};}return best;}
function side(point:{x:number;z:number},a:DrainagePoint,b:DrainagePoint){const dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,qx=wrapSourceX(point.x-a.x),qz=point.z-a.z;return dx*qz-dz*qx<0?-1:1;}
function bank(path:readonly DrainagePoint[],i:number,s:number,c:number){const p=path[i],before=path[Math.max(0,i-1)],after=path[Math.min(path.length-1,i+1)];let dx=wrapSourceX(after.x-before.x),dz=after.z-before.z;if(Math.hypot(dx,dz)<1e-6){const n=i+1<path.length?path[i+1]:path[i-1];dx=wrapSourceX(n.x-p.x);dz=n.z-p.z;}const l=Math.hypot(dx,dz)||1;return sourceToLonLat(wrapSourceX(p.x+(-dz/l)*s*c),p.z+(dx/l)*s*c);}
function projected(path:readonly DrainagePoint[],i:number,t:number,s:number,c:number){const a=path[i],b=path[i+1],dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,l=Math.hypot(dx,dz)||1,bx=wrapSourceX(a.x+dx*t),bz=a.z+dz*t;return sourceToLonLat(wrapSourceX(bx+(-dz/l)*s*c),bz+(dx/l)*s*c);}
function cap(path:readonly DrainagePoint[],sa:number,sb:number,c:number){const h=path[0],n=path[1],dx=wrapSourceX(n.x-h.x),dz=n.z-h.z,l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,px=-tz,pz=tx,u=c*2.35,sh=c*1.12,m=(s:number,f=1)=>sourceToLonLat(wrapSourceX(h.x-tx*u*f+px*s*sh),h.z-tz*u*f+pz*s*sh);return[m(sa,.76),sourceToLonLat(wrapSourceX(h.x-tx*u),h.z-tz*u),m(sb,.76)];}

const coarse=planRoute({from:from.canonicalPosition,to:to.canonicalPosition,roads:roadSegments,terrain:macroTerrainSampler});
const route=coarse.found?coarse.points:[{lon:from.canonicalPosition.lon,lat:from.canonicalPosition.lat},{lon:to.canonicalPosition.lon,lat:to.canonicalPosition.lat}];
const blocked=firstBlocked(route)!; const aps=approaches(route,blocked)!; const fs=lonLatToFlat(blocked.position.lon,blocked.position.lat); const recipe=drainageRecipesNear(fs.x,fs.z,2).find(r=>r.code===blocked.surface.catchmentCode)!; const hit=nearest(recipe,fs.x,fs.z); const aa=lonLatToFlat(aps[0].lon,aps[0].lat), bb=lonLatToFlat(aps[1].lon,aps[1].lat); let sa=side(aa,hit.path[hit.segmentIndex],hit.path[hit.segmentIndex+1]), sb=side(bb,hit.path[hit.segmentIndex],hit.path[hit.segmentIndex+1]); if(sa===sb)sb=-sa; const base=Math.max(30,hit.width*2.2);

function simulate(factors:readonly number[]){
  const out:LonLat[]=[aps[0]]; let floor=0;
  const append=(make:(c:number)=>LonLat,label:string)=>{for(let i=floor;i<factors.length;i++){const p=make(base*factors[i]), q=finalSurface(p); if(q.walkable&&directValid(out[out.length-1],p)){out.push(p);floor=i;return {ok:true,label,factor:factors[i],i};}}return {ok:false,label,floor,factors:factors.slice(floor).map(f=>{const p=make(base*f),q=finalSurface(p);return{f,walkable:q.walkable,water:q.water,direct:directValid(out[out.length-1],p)};})};};
  let r=append(c=>projected(hit.path,hit.segmentIndex,hit.t,sa,c),"A-projected"); if(!r.ok)return{ok:false,fail:r};
  for(let i=hit.segmentIndex;i>=0;i--){r=append(c=>bank(hit.path,i,sa,c),`A-bank-${i}`);if(!r.ok)return{ok:false,fail:r};}
  let capOK=false, capReport:any; for(let fi=floor;fi<factors.length;fi++){const checkpoint=out.length, cps=cap(hit.path,sa,sb,base*factors[fi]);let ok=true;for(let ci=0;ci<cps.length;ci++){const q=finalSurface(cps[ci]);if(!q.walkable||!directValid(out[out.length-1],cps[ci])){ok=false;capReport={fi,factor:factors[fi],ci,walkable:q.walkable,water:q.water,direct:directValid(out[out.length-1],cps[ci])};break;}out.push(cps[ci]);}if(ok){floor=fi;capOK=true;break;}out.length=checkpoint;} if(!capOK)return{ok:false,fail:{label:"cap",capReport}};
  r=append(c=>bank(hit.path,0,sb,c),"B-bank-0");if(!r.ok)return{ok:false,fail:r};
  for(let i=1;i<=hit.segmentIndex;i++){r=append(c=>bank(hit.path,i,sb,c),`B-bank-${i}`);if(!r.ok)return{ok:false,fail:r};}
  r=append(c=>projected(hit.path,hit.segmentIndex,hit.t,sb,c),"B-projected");if(!r.ok)return{ok:false,fail:r};
  const end=finalSurface(aps[1]); if(!end.walkable||!directValid(out[out.length-1],aps[1]))return{ok:false,fail:{label:"approachB",walkable:end.walkable,water:end.water,direct:directValid(out[out.length-1],aps[1])}};
  out.push(aps[1]); return{ok:true,points:out.length,finalBlocked:firstBlocked(out),finalFactor:factors[floor]};
}

const current=[1,1.35,1.8,2.4,3.2,4.2,5.5,7] as const, extended=[1,1.35,1.8,2.4,3.2,4.2,5.5,7,9,12,16,22] as const;
const index27=current.concat().map(f=>{const p=bank(hit.path,27,sb,base*f),q=finalSurface(p);return{factor:f,walkable:q.walkable,water:q.water,x:q.x,z:q.z};});
const index27extended=extended.map(f=>{const p=bank(hit.path,27,sb,base*f),q=finalSurface(p);return{factor:f,walkable:q.walkable,water:q.water,x:q.x,z:q.z};});
console.log("WP15_ADAPTIVE_PROBE="+JSON.stringify({coarse:{found:coarse.found,points:coarse.points.length},blocked:{water:blocked.surface.water,catchmentCode:blocked.surface.catchmentCode},hit:{segmentIndex:hit.segmentIndex,t:hit.t,width:hit.width,pathLength:hit.path.length},sides:[sa,sb],base,index27,index27extended,current:simulate(current),extended:simulate(extended)}));
