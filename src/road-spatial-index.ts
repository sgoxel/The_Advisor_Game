/** Conservative segment/bucket intersection. Presentation coordinates only;
 * membership accelerates queries and never determines road or terrain identity. */
export function segmentIntersectsBox(ax:number,az:number,bx:number,bz:number,minX:number,minZ:number,maxX:number,maxZ:number){
  let low=0,high=1;
  for(const [a,d,min,max] of [[ax,bx-ax,minX,maxX],[az,bz-az,minZ,maxZ]]){
    if(d===0){if(a<min||a>max)return false;continue;}
    const t0=(min-a)/d,t1=(max-a)/d;
    low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));
    if(low>high)return false;
  }
  return true;
}
type RoadPath={fromX:number;fromZ:number;toX:number;toZ:number;centerline?:readonly {x:number;z:number}[]};
/** Index the swept polyline, avoiding the empty interior of its bounding box.
 * Expanded boxes conservatively include every point within the support radius. */
export function roadBucketCells(road:RoadPath,size:number,support:number,shiftX=0):[number,number][]{
  const points=road.centerline??[{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}],seen=new Set<string>(),result:[number,number][]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],ax=a.x+shiftX,bx=b.x+shiftX,
      minBX=Math.floor((Math.min(ax,bx)-support)/size),maxBX=Math.floor((Math.max(ax,bx)+support)/size),
      minBZ=Math.floor((Math.min(a.z,b.z)-support)/size),maxBZ=Math.floor((Math.max(a.z,b.z)+support)/size);
    for(let z=minBZ;z<=maxBZ;z++)for(let x=minBX;x<=maxBX;x++){
      const key=`${x}/${z}`;
      if(seen.has(key)||!segmentIntersectsBox(ax,a.z,bx,b.z,x*size-support,z*size-support,(x+1)*size+support,(z+1)*size+support))continue;
      seen.add(key);result.push([x,z]);
    }
  }
  return result;
}

/** Queries normalize longitude first. Store only canonical buckets, including
 * shifted support at either seam, rather than two unreachable world copies. */
export function canonicalRoadBucketCells(road:RoadPath,size:number,support:number,width:number):[number,number][]{
 // The physical/source lookup uses shortest wrapped segments. Index those same
 // segments, not a false world-spanning chord between opposite seam aliases.
 const source=road.centerline??[{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}];
 const points:{x:number;z:number}[]=[];
 for(let i=0;i<source.length;i++){
  const previous=source[i-1],point=source[i],
    delta=previous?((point.x-previous.x+width/2)%width+width)%width-width/2:0;
  points.push({x:previous?points[i-1].x+delta:point.x,z:point.z});
 }
 const unwrapped:RoadPath={fromX:points[0]?.x??road.fromX,fromZ:road.fromZ,toX:points.at(-1)?.x??road.toX,toZ:road.toZ,centerline:points};
 const min=-width/2/size,max=width/2/size,seen=new Set<string>(),cells:[number,number][]=[];
 for(const shift of [-width,0,width])for(const [x,z] of roadBucketCells(unwrapped,size,support,shift)){
  const key=`${x}/${z}`;if(x<min||x>=max||seen.has(key))continue;
  seen.add(key);cells.push([x,z]);
 }
 return cells;
}
export function canonicalRoadBucketX(x:number,size:number,width:number){const count=width/size;return ((x+count/2)%count+count)%count-count/2;}
