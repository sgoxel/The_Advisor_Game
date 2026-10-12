import { lonLatToFlat, sourceToLonLat, wrapSourceX, positionToEnu, enuToPosition, greatCircleDistance, type CanonicalPosition, type LonLat } from "../src/planet.ts";
import { planRoute, type TerrainSampler } from "../src/routing.ts";
import { drainageRecipesNear, surfaceAt, type DrainagePoint } from "../src/surface.ts";
import { CELL_SIZE } from "../src/world.ts";

const catchment="ADVISOR-0126-ALDERWICK/v4/HYDRO/36/15", blockedPos={lon:0.30633475959847445,lat:0.053296221975978095};
const approachA={lon:0.30633475959847445,lat:0.05376706995482778}, approachB={lon:0.30633475959847445,lat:0.052354532803461806};
const SEG=38,T=0.6873794834908561,SIDE_A=1,SIDE_B=-1,WIDTH=18.889379459433258,STEP=300;
const flat=lonLatToFlat(blockedPos.lon,blockedPos.lat), recipe=drainageRecipesNear(flat.x,flat.z,2).find(r=>r.code===catchment)!;
const path=recipe.points as readonly DrainagePoint[];
function fs(p:LonLat){const f=lonLatToFlat(p.lon,p.lat),x=Math.floor(f.x/CELL_SIZE)*CELL_SIZE+CELL_SIZE/2,z=Math.floor(f.z/CELL_SIZE)*CELL_SIZE+CELL_SIZE/2;return surfaceAt(x,z);}
const terrain:TerrainSampler=(p)=>{const s=fs(p);return{water:s.water!=="none"||!s.walkable,heightM:s.elevation,highland:s.traversal==="difficult"?1:0};};
function blocked(points:readonly LonLat[]){for(let k=1;k<points.length;k++){const a:CanonicalPosition={...points[k-1],elevation:0},b:CanonicalPosition={...points[k],elevation:0},d=positionToEnu(b,a),len=greatCircleDistance(a,b),steps=Math.max(1,Math.ceil(len/STEP));for(let s=0;s<steps;s++){const t=(s+.5)/steps,p=enuToPosition({east:d.east*t,north:d.north*t,up:0},a),q=fs(p);if(!q.walkable)return{segment:k,water:q.water};}}return null;}
function bank(i:number,s:number,c:number){const p=path[i],before=path[Math.max(0,i-1)],after=path[Math.min(path.length-1,i+1)];let dx=wrapSourceX(after.x-before.x),dz=after.z-before.z;if(Math.hypot(dx,dz)<1e-6){const n=i+1<path.length?path[i+1]:path[i-1];dx=wrapSourceX(n.x-p.x);dz=n.z-p.z;}const l=Math.hypot(dx,dz)||1;return sourceToLonLat(wrapSourceX(p.x+(-dz/l)*s*c),p.z+(dx/l)*s*c);}
function projected(s:number,c:number){const a=path[SEG],b=path[SEG+1],dx=wrapSourceX(b.x-a.x),dz=b.z-a.z,l=Math.hypot(dx,dz)||1,bx=wrapSourceX(a.x+dx*T),bz=a.z+dz*T;return sourceToLonLat(wrapSourceX(bx+(-dz/l)*s*c),bz+(dx/l)*s*c);}
function cap(sa:number,sb:number,c:number){const h=path[0],n=path[1],dx=wrapSourceX(n.x-h.x),dz=n.z-h.z,l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,px=-tz,pz=tx,u=c*2.35,sh=c*1.12,m=(s:number,f=1)=>sourceToLonLat(wrapSourceX(h.x-tx*u*f+px*s*sh),h.z-tz*u*f+pz*s*sh);return[m(sa,.76),sourceToLonLat(wrapSourceX(h.x-tx*u),h.z-tz*u),m(sb,.76)];}
function guide(c:number){const g:LonLat[]=[approachA,projected(SIDE_A,c)];for(let i=SEG;i>=0;i--)g.push(bank(i,SIDE_A,c));g.push(...cap(SIDE_A,SIDE_B,c));g.push(bank(0,SIDE_B,c));for(let i=1;i<=SEG;i++)g.push(bank(i,SIDE_B,c));g.push(projected(SIDE_B,c),approachB);return g;}
function connector(a:LonLat,b:LonLat){if(!blocked([a,b]))return{points:[a,b],astar:false};const p=planRoute({from:a,to:b,terrain,authoritativeTraversal:true});return p.found&&!blocked(p.points)?{points:p.points,astar:true}:undefined;}
function stitch(g:LonLat[]){if(!fs(g[0]).walkable||!fs(g[g.length-1]).walkable)return{ok:false,reason:"endpoint"};const dry=g.filter((p,i)=>i===0||i===g.length-1||fs(p).walkable),out:LonLat[]=[dry[0]];let astar=0;for(let i=1;i<dry.length;i++){const c=connector(dry[i-1],dry[i]);if(!c)return{ok:false,reason:"connector",i,from:dry[i-1],to:dry[i],wetRemoved:g.length-dry.length,astar};if(c.astar)astar++;out.push(...c.points.slice(1));}return{ok:true,guide:g.length,dry:dry.length,wetRemoved:g.length-dry.length,astar,points:out.length,finalBlocked:blocked(out)};}
const base=Math.max(30,WIDTH*2.2);const results=[1,1.35,1.8].map(f=>{const g=guide(base*f);return{factor:f,wet:g.map((p,i)=>({i,s:fs(p)})).filter(x=>!x.s.walkable).map(x=>({i:x.i,water:x.s.water,catchment:x.s.catchmentCode})),stitch:stitch(g)};});
console.log("WP15_SKIP_WET_PROBE="+JSON.stringify({base,results}));
