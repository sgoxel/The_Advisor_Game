import type { Road } from "./geography.ts";
import { wrapSourceX } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { roadWidthM } from "./road-dimensions.ts";

type Point={x:number;z:number};
/** Keep the transport route fixed; a nearby parallel town street shares its centreline. */
export function mergeStreetWithRoads(points:readonly Point[],widthM:number,roads:readonly Road[]):Point[]{
  return points.map((point,index)=>{
    const metric=sourceUnitsPerMetreAt(point.z),before=points[Math.max(0,index-1)],after=points[Math.min(points.length-1,index+1)],
      sx=wrapSourceX(after.x-before.x)/metric.x,sz=(after.z-before.z)/metric.z,sl=Math.hypot(sx,sz);
    let best=Infinity,chosen={...point};
    for(const road of roads){
      const path=road.centerline||[{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}];
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],dx=wrapSourceX(b.x-a.x)/metric.x,dz=(b.z-a.z)/metric.z,length=Math.hypot(dx,dz);
        if(!sl||!length||Math.abs(sx*dx+sz*dz)/(sl*length)<Math.SQRT1_2)continue;
        const qx=wrapSourceX(point.x-a.x)/metric.x,qz=(point.z-a.z)/metric.z,t=(qx*dx+qz*dz)/(length*length);
        if(t<0||t>1)continue;
        const distance=Math.hypot(qx-dx*t,qz-dz*t);
        if(distance<=8+widthM/2&&distance<best){best=distance;chosen={x:wrapSourceX(a.x+dx*t*metric.x),z:a.z+dz*t*metric.z};}
      }
    }
    return chosen;
  });
}

/** Omit duplicate town ribbons only where the existing road already covers their full width. */
export function sharedStreetSegments(points:readonly Point[],widthM:number,roads:readonly Road[]):number[]{
  const result:number[]=[];
  for(let index=1;index<points.length;index++){
    const a=points[index-1],b=points[index],samples=[a,{x:wrapSourceX(a.x+wrapSourceX(b.x-a.x)/2),z:(a.z+b.z)/2},b];
    if(roads.some(road=>roadWidthM(road)>=widthM&&samples.every(p=>{
      const m=sourceUnitsPerMetreAt(p.z),path=road.centerline||[{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}];
      return path.slice(1).some((end,i)=>{
        const start=path[i],dx=wrapSourceX(end.x-start.x)/m.x,dz=(end.z-start.z)/m.z,
          qx=wrapSourceX(p.x-start.x)/m.x,qz=(p.z-start.z)/m.z,t=Math.max(0,Math.min(1,(qx*dx+qz*dz)/(dx*dx+dz*dz||1)));
        return Math.hypot(qx-t*dx,qz-t*dz)<.15;
      });
    })))result.push(index);
  }
  return result;
}
