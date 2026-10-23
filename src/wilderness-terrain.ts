import { WORLD_SEED } from './config.ts';
import { nearbyPlaces, roads, roadDistanceAt } from './geography.ts';
import { criticalSites, siteAccessRoads } from './sites.ts';
import { naturalSurfaceAt, drainageSegmentsInBounds, type NaturalSurface } from './hydrology.ts';
import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from './planet.ts';
import { sourceUnitsPerMetreAt } from './physical-scale.ts';
import { canonicalRoadBucketCells, canonicalRoadBucketX } from './road-spatial-index.ts';
import { climateSampleAt } from './climate.ts';

export type Landform={code:string;kind:'hill'|'cliff'|'lake'|'waterfall';x:number;z:number;radiusM:number;heightM:number;elevation:number;waterLevel:number;yaw:number;variant:number};
const CELL=256,LIMIT=128,cache=new Map<string,Landform|null>(),roadBuckets=new Map<string,typeof roads[number][]>();
let roadReferences=0;
const hash=(text:string)=>{let v=2166136261;for(let i=0;i<text.length;i++)v=Math.imul(v^text.charCodeAt(i),16777619);return v>>>0;};
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
// Index existing corridors once. Natural additions never move a road, town or quest site.
for(const road of [...roads,...siteAccessRoads])for(const [bx,bz]of canonicalRoadBucketCells(road,CELL,96,SOURCE_PRESENTATION_WIDTH)){
 const key=`${bx}/${bz}`,bucket=roadBuckets.get(key)||[];bucket.push(road);roadBuckets.set(key,bucket);roadReferences++;
}
export function landformCell(gx:number,gz:number):Landform|null{
 gx=canonicalRoadBucketX(gx,CELL,SOURCE_PRESENTATION_WIDTH);const key=`${gx}/${gz}`;
 if(cache.has(key)){const v=cache.get(key)!;cache.delete(key);cache.set(key,v);return v;}
 let result:Landform|null=null;
 for(let attempt=0;attempt<4&&!result;attempt++){
  const code=`${WORLD_SEED}/COUNTRYSIDE/${key}/${attempt}`,variant=hash(code),unit=(salt:string)=>hash(`${code}/${salt}`)/4294967296,
   x=wrapSourceX((gx+.3+unit('X')*.4)*CELL),z=(gz+.3+unit('Z')*.4)*CELL,p=sourceToLonLat(x,z),metric=sourceUnitsPerMetreAt(z);
  if(Math.abs(p.lat)>Math.PI*.41)continue;
  const base=naturalSurfaceAt(x,z),radiusM=100+unit('SIZE')*100;
  if(base.water.kind!=='none'||!base.walkable||base.groundHeight<18)continue;
  if(nearbyPlaces(x,z).some(t=>Math.hypot(wrapSourceX(x-t.x)/metric.x,(z-t.z)/metric.z)<radiusM+(t.kind==='city'?1900:850)))continue;
  if((roadBuckets.get(key)||[]).some(r=>roadDistanceAt(x,z,r)<(radiusM+90)*Math.max(metric.x,metric.z)))continue;
  if(criticalSites.some(t=>Math.hypot(wrapSourceX(x-t.x)/metric.x,(z-t.z)/metric.z)<radiusM+250))continue;
  const support=(radiusM+40)*Math.max(metric.x,metric.z);
  if(drainageSegmentsInBounds(x-support,z-support,support*2).some(r=>{
    const dx=wrapSourceX(r.bx-r.ax)/metric.x,dz=(r.bz-r.az)/metric.z,qx=wrapSourceX(x-r.ax)/metric.x,qz=(z-r.az)/metric.z,
      t=Math.max(0,Math.min(1,(qx*dx+qz*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(qx-dx*t,qz-dz*t)<radiusM+40;
  }))continue;
  // Reject existing wet ground and large relief: these small basins have their own contained catchment.
  const surroundings=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return naturalSurfaceAt(x+Math.cos(a)*radiusM*metric.x,z+Math.sin(a)*radiusM*metric.z);});
  if(surroundings.some(s=>s.water.kind!=='none'||Math.abs(s.groundHeight-base.groundHeight)>5))continue;
  let kind:Landform['kind']=(['hill','cliff','lake','waterfall'] as const)[hash(`${WORLD_SEED}/${key}/KIND`)%4];
  if((kind==='lake'||kind==='waterfall')&&climateSampleAt(p,base.groundHeight).moisture<.4)kind='hill';
  if(kind==='waterfall'&&surroundings.some(s=>Math.abs(s.groundHeight-base.groundHeight)>.6))continue;
  result={code,kind,x,z,radiusM,heightM:12+unit('HEIGHT')*15,elevation:base.groundHeight,
    waterLevel:kind==='lake'?Math.min(base.groundHeight,...surroundings.map(s=>s.groundHeight))-.6:base.groundHeight-.8,
    yaw:unit('YAW')*Math.PI*2,variant};
 }
 cache.set(key,result);while(cache.size>LIMIT)cache.delete(cache.keys().next().value!);return result;
}
export function nearbyLandforms(x:number,z:number,radius:number):Landform[]{
 const reach=Math.min(3,Math.ceil(radius/CELL)),gx=Math.floor(wrapSourceX(x)/CELL),gz=Math.floor(z/CELL),found:Landform[]=[];
 for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++){const f=landformCell(gx+dx,gz+dz);if(f&&Math.hypot(wrapSourceX(f.x-x),f.z-z)<=radius+80)found.push(f);}
 return found;
}
export function landformAt(x:number,z:number){
 const f=landformCell(Math.floor(wrapSourceX(x)/CELL),Math.floor(z/CELL));if(!f)return undefined;
 const m=sourceUnitsPerMetreAt(z),dx=wrapSourceX(x-f.x)/m.x,dz=(z-f.z)/m.z,c=Math.cos(f.yaw),s=Math.sin(f.yaw),a=dx*c+dz*s,b=-dx*s+dz*c,
   angle=Math.atan2(b,a),r=(f.kind==='lake'?Math.hypot(a/.78,b)*(1+.12*(Math.sin(angle*3+f.variant)+1)):Math.hypot(a,b))/f.radiusM;
 return r<1?{f,a,b,r}:undefined;
}
/** Final-surface base extension; input and existing freshwater remain unchanged outside the bounded footprint. */
export function wildernessTerrainAt(x:number,z:number,base:NaturalSurface):NaturalSurface{
 if(base.water.kind!=='none')return base;
 const q=landformAt(x,z);if(!q)return base;
 const {f,a,b,r}=q,edge=1-smooth(.7,1,r),water={kind:'none' as const,level:-Infinity,flowX:0,flowZ:0};
 if(f.kind==='hill')return {...base,groundHeight:base.groundHeight+f.heightM*(1-r*r)**2};
 if(f.kind==='cliff'){
  const height=f.heightM*smooth(-3,3,b)*edge,steep=Math.abs(b)<3&&edge>.5;
  return {...base,groundHeight:base.groundHeight+height,material:steep?'Highlands':base.material,walkable:!steep,cliff:steep,slope:steep?f.heightM/6:base.slope,vegetationDensityScale:steep?.08:base.vegetationDensityScale};
 }
 if(f.kind==='lake'){
  const level=f.waterLevel,groundHeight=mix(base.groundHeight,level-3,1-smooth(.55,1,r)),wet=groundHeight<level;
  return {...base,groundHeight,material:wet?'Lake':'Riverbank',water:wet?{...water,kind:'lake',level}:water,walkable:!wet,vegetationDensityScale:wet?0:.35};
 }
 // A spring-fed ledge, steep six-metre transition and connected plunge pool, contained within one terrain recipe.
 const plateau=smooth(-3,3,b)*f.heightM*edge,level=f.waterLevel+plateau,
  creek=Math.abs(a)<3&&b>-27&&b<55,pool=Math.hypot(a/19,(b+30)/17)<1,wet=creek||pool;
 return {...base,groundHeight:wet?level-1.4:base.groundHeight+plateau,
  material:wet?'River':Math.abs(b)<4?'Highlands':base.material,water:wet?{kind:'river',level,flowX:Math.sin(f.yaw),flowZ:-Math.cos(f.yaw)}:water,
  walkable:!wet&&!(Math.abs(b)<3&&edge>.5),vegetationDensityScale:wet?0:Math.abs(b)<6?.12:base.vegetationDensityScale};
}
export function wildernessTerrainCacheState(){return {cells:cache.size,limit:LIMIT,estimatedBytes:cache.size*320+roadReferences*8+roadBuckets.size*96};}
