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

/**
 * Town streets that end by running alongside another street are joined to it instead of overlapping it.
 * Walking in from each end, the tail that stays within half-widths + 1.5 m of another street's centreline
 * is cut, and the street ends on that street's closest centreline point, which is also inserted into the
 * other street, so both share one junction vertex (drawn with a round joint; walkers get a real node).
 * The main street (index 0) and street ends near a gate are never moved, and a street is never removed.
 */
export function mergeStreetJunctions(
  streets: readonly { points: readonly Point[]; widthM: number }[],
  gates: readonly Point[] = [],
): Point[][] {
  const out = streets.map((street) => street.points.map((point) => ({ ...point })));
  if (!out.length || !out[0].length) return out;
  const metric = sourceUnitsPerMetreAt(out[0][0].z),
    metres = (a: Point, b: Point) => Math.hypot(wrapSourceX(a.x - b.x) / metric.x, (a.z - b.z) / metric.z),
    closestOn = (path: readonly Point[], p: Point) => {
      let best = { point: path[0], segment: 0, distance: metres(path[0], p) };
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], dx = wrapSourceX(path[i].x - a.x), dz = path[i].z - a.z, qx = wrapSourceX(p.x - a.x), qz = p.z - a.z,
          lengthSq = (dx / metric.x) ** 2 + (dz / metric.z) ** 2,
          t = lengthSq ? Math.max(0, Math.min(1, ((qx * dx) / metric.x ** 2 + (qz * dz) / metric.z ** 2) / lengthSq)) : 0,
          point = { x: wrapSourceX(a.x + dx * t), z: a.z + dz * t }, distance = metres(point, p);
        if (distance < best.distance) best = { point, segment: i, distance };
      }
      return best;
    };
  for (let t = 1; t < out.length; t++) for (const atStart of [false, true]) for (let s = 0; s < out.length; s++) {
    if (s === t || out[s].length < 2 || out[t].length < 2) continue;
    const path = atStart ? [...out[t]].reverse() : out[t], end = path[path.length - 1];
    if (gates.some((gate) => metres(gate, end) < 12)) continue;
    const near = (streets[s].widthM + streets[t].widthM) / 2 + 1.5;
    let keep = path.length, cut = 0;
    // `cut` is the length of the overlapping run only (between removed points), not the approach to it.
    while (keep > 2 && closestOn(out[s], path[keep - 1]).distance < near) {
      if (keep < path.length) cut += metres(path[keep - 1], path[keep]);
      keep--;
    }
    if (keep < path.length && closestOn(out[s], path[keep - 1]).distance < near) cut += metres(path[keep - 1], path[keep]);
    // Nothing overlaps; or the street is genuinely parallel for a long way (a real neighbouring lane, keep it).
    if (keep === path.length || cut > 35) continue;
    // Already joined (only the end touches, and it sits on the other street): nothing to tidy.
    if (keep === path.length - 1 && closestOn(out[s], end).distance < .3) continue;
    const junction = closestOn(out[s], path[keep - 1]);
    const trimmed = [...path.slice(0, keep), junction.point];
    out[t] = atStart ? trimmed.reverse() : trimmed;
    const target = out[s], before = target[junction.segment - 1], after = target[junction.segment];
    if (junction.segment > 0 && metres(junction.point, before) > .3 && metres(junction.point, after) > .3)
      target.splice(junction.segment, 0, { ...junction.point });
  }
  return out;
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
