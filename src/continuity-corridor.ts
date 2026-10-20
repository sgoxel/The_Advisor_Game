import { WORLD_SEED } from "./config.ts";
import { macroLakes, macroSampleAt, type LakeRecipe } from "./macro-geography.ts";
import { greatCircleDistance, lonLatToSource, sourceToLonLat, wrapSourceX, CANONICAL_METRES_PER_SOURCE_UNIT, SOURCE_PRESENTATION_RADIUS, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { addressedSample, CONTINUITY_VERSION } from "./continuity.ts";
import { travelMetrics } from "./travel.ts";
import type { Place, Road } from "./geography.ts";

export const CORRIDOR_LIMITS = Object.freeze({ lakes: 6, destinations: 16, pairs: 120, alternatives: 16, samples: 81, stations: 34 });
export function* roadFragmentsInBounds(roads: readonly Road[], minX: number, minZ: number, size: number) {
  for (const road of roads) {
    if(!road.centerline){yield road;continue;}
    for(let i=0;i<road.centerline.length-1;i++) {
      const a=road.centerline[i],b=road.centerline[i+1],
        // Renderer clipping must follow the same short canonical seam segment
        // as roadDistanceAt, transport buckets and legal bridge discovery.
        deltaX=b.x-a.x,
        toX=Math.abs(deltaX)<SOURCE_PRESENTATION_WIDTH/2?b.x:a.x+wrapSourceX(deltaX);
      const fragment={...road,fromX:a.x,fromZ:a.z,toX,toZ:b.z,minX:Math.min(a.x,toX),maxX:Math.max(a.x,toX),minZ:Math.min(a.z,b.z),maxZ:Math.max(a.z,b.z)};
      if(fragment.maxZ<minZ-6||fragment.minZ>minZ+size+6)continue;
      if([-SOURCE_PRESENTATION_WIDTH,0,SOURCE_PRESENTATION_WIDTH].some(shift=>fragment.maxX+shift>=minX-6&&fragment.minX+shift<=minX+size+6))yield fragment;
    }
  }
}
export function clippedStationRange(ax:number,az:number,bx:number,bz:number,minX:number,minZ:number,size:number,count:number) {
  let low=0,high=1;
  for(const [a,d,min,max] of [[ax,bx-ax,minX-6,minX+size+6],[az,bz-az,minZ-6,minZ+size+6]]){
    if(d===0){if(a<min||a>max)return [0,0];continue;}
    const t0=(min-a)/d,t1=(max-a)/d;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));
    if(low>high)return [0,0];
  }
  return [Math.max(0,Math.floor(low*count)),Math.min(count,Math.ceil(high*count))];
}
/** One compact coarse proof corridor. No fine cells, meshes, houses or residents are prepared. */
export function defineContinuityCorridor(villages: readonly Place[], template: Road, lakes: readonly LakeRecipe[] = macroLakes, sample: typeof macroSampleAt = macroSampleAt, seed = WORLD_SEED) {
  let coarseSamples = 0;
  for (const lake of lakes.slice(0, CORRIDOR_LIMITS.lakes)) {
    const center = lonLatToSource(lake.center.lon,lake.center.lat), candidates = villages.filter(v=>v.continent===lake.continent)
      .sort((a,b)=>greatCircleDistance(a.canonicalPosition,lake.center)-greatCircleDistance(b.canonicalPosition,lake.center)||(a.code<b.code?-1:a.code>b.code?1:0)).slice(0,16);
    for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++) {
      const from=candidates[a],to=candidates[b], toX=from.x+wrapSourceX(to.x-from.x), midpoint=sourceToLonLat((from.x+toX)/2,(from.z+to.z)/2);
      coarseSamples++;
      if(sample(midpoint).domain!=="Lake")continue;
      const cx=from.x+wrapSourceX(center.x-from.x), cz=center.z,
        startAngle=Math.atan2(from.z-cz,(from.x-cx)*Math.cos(lake.center.lat)), endAngle=Math.atan2(to.z-cz,(toX-cx)*Math.cos(lake.center.lat)),
        shortest=((endAngle-startAngle+Math.PI*3)%(Math.PI*2))-Math.PI,
        preferred=addressedSample("ROAD-DETOUR",lake.code,0,seed)<.5?1:-1;
      for(let attempt=0;attempt<16;attempt++) {
        const radius=lake.radiusRad*SOURCE_PRESENTATION_RADIUS*Math.max(1,lake.aspect)*(1.2+Math.floor(attempt/2)*.15),
          direction=attempt%2===0?preferred:-preferred,
          sweep=direction>0?(shortest>=0?shortest:shortest+Math.PI*2):(shortest<=0?shortest:shortest-Math.PI*2),
          centerline=[{x:from.x,z:from.z},...Array.from({length:32},(_,i)=>{
            const angle=startAngle+sweep*i/31;return{x:cx+Math.cos(angle)*radius/Math.cos(lake.center.lat),z:cz+Math.sin(angle)*radius};
          }),{x:toX,z:to.z}];
        let valid=true, lengthM=0, previousRelief: number | undefined;
        for(let i=0;i<centerline.length-1;i++){
          const p=centerline[i],q=centerline[i+1],segmentM=greatCircleDistance(sourceToLonLat(p.x,p.z),sourceToLonLat(q.x,q.z));lengthM+=segmentM;
          // Endpoints and midpoint of each coarse interval: at most 67 coarse samples.
          for(const t of [0,.5]){
            const position=sourceToLonLat(p.x+(q.x-p.x)*t,p.z+(q.z-p.z)*t), terrain=sample(position);coarseSamples++;
            if(!terrain.land || Math.abs(position.lat)>=75*Math.PI/180 || (previousRelief!==undefined && Math.abs(terrain.reliefM-previousRelief)>Math.max(1,segmentM*.025))){valid=false;break;}
            previousRelief=terrain.reliefM;
          }
          if(!valid)break;
        }
        if(!valid || lengthM>greatCircleDistance(from.canonicalPosition,to.canonicalPosition)*3)continue;
        const xs=centerline.map(p=>p.x), zs=centerline.map(p=>p.z),travel=travelMetrics(lengthM,"good-road"),
          road: Road={...template,networkKind:"detour",networkId:`${seed}/${lake.code}/DETOUR`,coarseFallback:false,code:`${seed}/${CONTINUITY_VERSION}/ROAD/${lake.code}/DETOUR`,from:from.id,to:to.id,
            fromX:from.x,fromZ:from.z,toX,toZ:to.z,fromPosition:from.canonicalPosition,toPosition:to.canonicalPosition,
            minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),z:(from.z+to.z)/2,
            centerline:Object.freeze(centerline.map(point=>Object.freeze({...point,position:Object.freeze(sourceToLonLat(point.x,point.z))}))),presentationLengthSourceUnits:lengthM/CANONICAL_METRES_PER_SOURCE_UNIT,surfaceLengthM:lengthM,fantasyWalkSeconds:travel.fantasySeconds,realWalkSeconds:travel.realSeconds};
        Object.freeze(road);
        return {road, evidence:{lakeId:lake.code,rejectedMidpoint:midpoint,selectedAlternative:attempt,coarseSamples,stations:centerline.length,dependencyRegions:0,status:"ready" as const}};
      }
    }
  }
  return {road:undefined,evidence:{status:"generation-failure" as const,coarseSamples,dependencyRegions:0}};
}
