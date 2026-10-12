import { villages } from "../src/geography.ts";
import { politicalRouteWaypoints } from "../src/political-route-topology.ts";
import { planRoute, type TerrainSampler } from "../src/routing.ts";
import { lonLatToFlat, positionToEnu, enuToPosition, greatCircleDistance, type CanonicalPosition, type LonLat } from "../src/planet.ts";
import { surfaceAt } from "../src/surface.ts";
import { CELL_SIZE } from "../src/world.ts";

const from=villages.find(v=>v.id==="1/2/0/1")!,to=villages.find(v=>v.id==="1/5/1/0")!,STEP=300,LEG_MAX=60000;
function fs(p:LonLat){const f=lonLatToFlat(p.lon,p.lat),x=Math.floor(f.x/CELL_SIZE)*CELL_SIZE+CELL_SIZE/2,z=Math.floor(f.z/CELL_SIZE)*CELL_SIZE+CELL_SIZE/2;return surfaceAt(x,z);}
const terrain:TerrainSampler=p=>{const s=fs(p);return{water:s.water!=="none"||!s.walkable,heightM:s.elevation,highland:s.traversal==="difficult"?1:0};};
function blocked(points:readonly LonLat[]){for(let k=1;k<points.length;k++){const a:CanonicalPosition={...points[k-1],elevation:0},b:CanonicalPosition={...points[k],elevation:0},d=positionToEnu(b,a),len=greatCircleDistance(a,b),steps=Math.max(1,Math.ceil(len/STEP));for(let s=0;s<steps;s++){const t=(s+.5)/steps,p=enuToPosition({east:d.east*t,north:d.north*t,up:0},a),q=fs(p);if(!q.walkable)return{segment:k,water:q.water,catchment:q.catchmentCode};}}return null;}
function bounded(points:readonly LonLat[]){const out:LonLat[]=[points[0]];for(let i=1;i<points.length;i++){const a:CanonicalPosition={...points[i-1],elevation:0},b:CanonicalPosition={...points[i],elevation:0},len=greatCircleDistance(a,b),parts=Math.max(1,Math.ceil(len/LEG_MAX)),d=positionToEnu(b,a);for(let p=1;p<parts;p++){const t=p/parts,q=enuToPosition({east:d.east*t,north:d.north*t,up:0},a);out.push({lon:q.lon,lat:q.lat});}out.push(points[i]);}return out;}
const topo=politicalRouteWaypoints(from,to);if(!topo){console.log('WP15_POLITICAL_PROBE='+JSON.stringify({topology:false}));process.exit(0);}const pts=bounded(topo),legs=[] as any[];let all=true,totalExp=0;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],geo=greatCircleDistance(a,b),direct=blocked([a,b]);if(!direct){legs.push({i,geo,direct:true});continue;}const r=planRoute({from:a,to:b,terrain,authoritativeTraversal:true});totalExp+=r.expansions;const final=r.found?blocked(r.points):null;legs.push({i,geo,direct:false,block:direct,found:r.found,reason:r.reason,cell:r.cellSizeM,attempts:r.attempts,exp:r.expansions,points:r.points.length,final});if(!r.found||final){all=false;break;}}
console.log('WP15_POLITICAL_PROBE='+JSON.stringify({topology:true,rawWaypoints:topo.length,boundedWaypoints:pts.length,all,totalExp,legs}));
