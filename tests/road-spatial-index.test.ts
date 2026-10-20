import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roadBucketCells,segmentIntersectsBox,canonicalRoadBucketCells,canonicalRoadBucketX} from '../src/road-spatial-index.ts';
const distance=(x:number,z:number,a:{x:number;z:number},b:{x:number;z:number})=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);};
test('sparse road index conservatively retains supported points at segments, corners, endpoints and wrap shifts',()=>{
 const paths=[[{x:0,z:0},{x:5000,z:5000}],[{x:2048,z:-4096},{x:2048,z:8192}],[{x:-1,z:0},{x:1,z:0}],[{x:-5000,z:-5000},{x:5000,z:-5000},{x:5000,z:5000},{x:-5000,z:5000}]];
 for(const points of paths)for(const shift of [-262144,0,262144]){
  const road={fromX:points[0].x,fromZ:points[0].z,toX:points.at(-1)!.x,toZ:points.at(-1)!.z,centerline:points},keys=new Set(roadBucketCells(road,2048,12,shift).map(([x,z])=>`${x}/${z}`));
  for(let i=1;i<points.length;i++)for(let station=0;station<=100;station++)for(const [ox,oz] of [[0,0],[-12,0],[12,0],[0,-12],[0,12]]){
   const a=points[i-1],b=points[i],x=a.x+(b.x-a.x)*station/100+ox,z=a.z+(b.z-a.z)*station/100+oz;
   assert.ok(distance(x,z,a,b)<=12.00000001);
   assert.ok(keys.has(`${Math.floor((x+shift)/2048)}/${Math.floor(z/2048)}`));
  }
 }
 assert.equal(segmentIntersectsBox(-10,0,10,0,-1,-1,1,1),true);
 assert.equal(segmentIntersectsBox(-10,2,10,2,-1,-1,1,1),false);
});
test('long diagonal and curved roads do not index empty bounding-box interiors',()=>{
 const diagonal=roadBucketCells({fromX:0,fromZ:0,toX:100000,toZ:100000},2048,12);
 assert.ok(diagonal.length<250,`diagonal references ${diagonal.length} instead of >2400 rectangle cells`);
 const curve={fromX:-10000,fromZ:-10000,toX:-10000,toZ:10000,centerline:[{x:-10000,z:-10000},{x:10000,z:-10000},{x:10000,z:10000},{x:-10000,z:10000}]};
 assert.ok(!roadBucketCells(curve,2048,12).some(([x,z])=>x===0&&z===0));
});

test('canonical buckets drop unreachable wrap copies while retaining seam and wide-clearance lookup',()=>{
 const width=262144,size=2048,wrap=(x:number)=>((x+width/2)%width+width)%width-width/2;
 for(const points of [[{x:0,z:0},{x:20000,z:20000}],[{x:width/2-900,z:0},{x:width/2+900,z:1000}],[{x:-width/2-900,z:0},{x:-width/2+900,z:1000}]]){
  const road={fromX:points[0].x,fromZ:points[0].z,toX:points[1].x,toZ:points[1].z,centerline:points},cells=canonicalRoadBucketCells(road,size,12,width),keys=new Set(cells.map(([x,z])=>`${x}/${z}`));
  assert.ok(cells.every(([x])=>x>=-width/2/size&&x<width/2/size));
  for(let i=0;i<=100;i++)for(const [ox,oz] of [[0,0],[12,0],[-12,0],[0,12],[0,-12],[200,0],[-200,0]]){
   const a=points[0],b=points[1],x=wrap(a.x+(b.x-a.x)*i/100+ox),z=a.z+(b.z-a.z)*i/100+oz,reach=Math.abs(ox)>12?1:0;
   let found=false;for(let dz=-reach;dz<=reach;dz++)for(let dx=-reach;dx<=reach;dx++)if(keys.has(`${canonicalRoadBucketX(Math.floor(x/size)+dx,size,width)}/${Math.floor(z/size)+dz}`))found=true;
   assert.ok(found,'canonical support must survive wrapped bucket queries');
  }
 }
 const straight={fromX:0,fromZ:0,toX:20000,toZ:20000};
 assert.equal(canonicalRoadBucketCells(straight,size,12,width).length,roadBucketCells(straight,size,12).length);
});

test('canonical road buckets follow the shortest seam crossing rather than a false world-spanning chord',()=>{
 const width=262144,size=2048,half=width/2,wrap=(x:number)=>((x+half)%width+width)%width-half;
 const a={x:half-9000,z:0},b={x:-half+9000,z:0};
 for(const points of [[a,b],[b,a]]){
  const road={fromX:points[0].x,fromZ:0,toX:points[1].x,toZ:0,centerline:points},
    cells=canonicalRoadBucketCells(road,size,12,width),
    indexed=new Set(cells.map(([x,z])=>`${x}/${z}`));
  assert.ok(cells.length<24,`seam crossing indexed ${cells.length} cells instead of local support`);
  assert.ok(!indexed.has('0/0'),'the opposite-seam road must not index the world centre');
  for(let station=0;station<=100;station++){
   const x=wrap(points[0].x+(points[0]===a?1:-1)*18000*station/100),
     bx=canonicalRoadBucketX(Math.floor(x/size),size,width);
   assert.ok(indexed.has(`${bx}/0`),`physical station ${station} missing near seam`);
  }
 }
});
