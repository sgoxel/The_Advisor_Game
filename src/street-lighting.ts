import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { wrapSourceX } from "./planet.ts";
import type { SettlementExteriorPlan } from "./settlement-exterior.ts";

export const closeLightingEnabled = (scale:number) => scale>0 && scale<=1;
/** Fade out before the nearest-stop label crosses from 1/1 to 1/2. */
export function closeLightingWeight(scale:number){
 const t=Math.max(0,Math.min(1,(scale-1)/(Math.SQRT2-1)));
 return 1-t*t*(3-2*t);
}
export const eveningLightWeight = (daylight:number) => Math.max(0,Math.min(1,(.85-daylight)/.65));
export type FacadeWindow={x:number;z:number;y:number;yaw:number;width:number;height:number};
/** Metre-sized exterior openings only; no room or interior generation. */
export function facadeWindows(width:number,depth:number,height:number,storeys:number):FacadeWindow[]{
 const result:FacadeWindow[]=[];
 for(let floor=0;floor<Math.min(3,storeys);floor++)for(let wall=0;wall<4;wall++){
  const span=wall%2?depth:width,count=Math.min(4,Math.max(1,Math.floor((span-.8)/2.2))),yaw=wall*Math.PI/2,
   distance=(wall%2?width:depth)/2+.035;
  for(let i=0;i<count;i++){
   const along=(i-(count-1)/2)*Math.min(2.3,span/(count+1));
   if(wall===0&&floor===0&&Math.abs(along)<.9)continue; // front door
   const w=Math.min(.8,span/(count+1)*.65),h=Math.min(1, height/storeys*.37),
    y=floor*height/storeys+Math.min(1.05,height/storeys*.38);
   result.push({x:along*Math.cos(yaw)+distance*Math.sin(yaw),z:-along*Math.sin(yaw)+distance*Math.cos(yaw),y,yaw,width:w,height:h});
  }
 }
 return result;
}
export type LampAnchor={id:string;yaw:number;candidates:{x:number;z:number}[]};
const cache=new WeakMap<SettlementExteriorPlan,readonly LampAnchor[]>();
/** Fixed 28 m spacing, alternating verges; at most 128 lamps per main street. */
export function mainStreetLampAnchors(plan:SettlementExteriorPlan):readonly LampAnchor[]{
 const cached=cache.get(plan);if(cached)return cached;
 const result:LampAnchor[]=[];
 for(const [streetIndex,street]of plan.streets.entries()){
  if(streetIndex!==0&&!/\/(MAIN|HIGH-STREET|MARKET-SPINE|GATE-ROAD|QUAY)$/.test(street.id))continue;
  let cumulative=0,next=14,index=0;
  for(let segment=1;segment<street.points.length&&index<128;segment++){
   const a=street.points[segment-1],b=street.points[segment],scale=sourceUnitsPerMetreAt((a.z+b.z)/2),
    dx=wrapSourceX(b.x-a.x)/scale.x,dz=(b.z-a.z)/scale.z,length=Math.hypot(dx,dz);
   if(length<.001)continue;
   while(next<=cumulative+length&&index<128){
    const t=(next-cumulative)/length,x=wrapSourceX(a.x+wrapSourceX(b.x-a.x)*t),z=a.z+(b.z-a.z)*t,
     metric=sourceUnitsPerMetreAt(z),side=index%2?1:-1,
     // Stored street width is source units; recover its metre width.
     offset=street.width/metric.z/2+.9,
     candidates=[0,3,-3].map(shift=>({x:wrapSourceX(x+(-dz/length*side*offset+dx/length*shift)*metric.x),z:z+(dx/length*side*offset+dz/length*shift)*metric.z}));
    result.push({id:`${street.id}/LAMP/${index}`,yaw:Math.atan2(dx,dz),candidates});index++;next+=28;
   }
   cumulative+=length;
  }
 }
 cache.set(plan,result);return result;
}
