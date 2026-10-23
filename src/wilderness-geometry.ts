import { naturalSurfaceAt } from "./hydrology.ts";
import { finalSurfaceAt } from './world.ts';
import type { TileGeometry } from "./geometry.ts";
import { SiteBuilder, mergeGeometry } from "./site-geometry.ts";
import { nearbyWilderness } from "./wilderness.ts";
import { wrapSourceX } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { elevationToRenderY } from "./render-frame.ts";
import type { Tile } from "./world.ts";

/** Exterior landmarks only. Dungeon/cave interiors stay lazy until entered. */
export function appendWildernessGeometry(tile: Tile, data: TileGeometry) {
  if (tile.size > 128) return;
  const originX=tile.minX+tile.size/2,originZ=tile.minZ+tile.size/2,body=new SiteBuilder(),detail=new SiteBuilder();
  for(const site of nearbyWilderness(originX,originZ,tile.size+4,18)) {
    const x=originX+wrapSourceX(site.x-originX),z=site.z;
    if(x<tile.minX||x>=tile.minX+tile.size||z<tile.minZ||z>=tile.minZ+tile.size)continue;
    const metric=sourceUnitsPerMetreAt(z),y=elevationToRenderY(site.canonicalPosition.elevation),c=Math.cos(site.yaw),s=Math.sin(site.yaw),
      vertex=(a:number,b:number,h:number):readonly[number,number,number]=>{const px=x+(a*c-b*s)*metric.x,pz=z+(a*s+b*c)*metric.z;return[px-originX,elevationToRenderY(finalSurfaceAt(px,pz).groundHeight)+h*metric.z,pz-originZ];},
      box=(builder:SiteBuilder,a:number,b:number,h:number,w:number,height:number,d:number,tint:readonly[number,number,number])=>{
        const A=vertex(a-w/2,b-d/2,h),B=vertex(a+w/2,b-d/2,h),C=vertex(a+w/2,b+d/2,h),D=vertex(a-w/2,b+d/2,h),
          E=vertex(a-w/2,b-d/2,h+height),F=vertex(a+w/2,b-d/2,h+height),G=vertex(a+w/2,b+d/2,h+height),H=vertex(a-w/2,b+d/2,h+height);
        builder.quad(A,E,F,B,tint);builder.quad(C,G,H,D,tint);builder.quad(D,H,E,A,tint);builder.quad(B,F,G,C,tint);builder.quad(E,H,G,F,tint);
      },rock=(a:number,b:number,h:number,w:number,d:number,height:number)=>{
        const A=vertex(a-w/2,b-d/2,h),B=vertex(a+w/2,b-d/2,h),C=vertex(a+w/2,b+d/2,h),D=vertex(a-w/2,b+d/2,h),
          E=vertex(a-w*.27,b-d*.26,h+height*.76),F=vertex(a+w*.31,b-d*.24,h+height),G=vertex(a+w*.22,b+d*.3,h+height*.82),H=vertex(a-w*.34,b+d*.22,h+height*.66),tint=[112,117,103] as const;
        body.quad(A,E,F,B,tint);body.quad(B,F,G,C,tint);body.quad(C,G,H,D,tint);body.quad(D,H,E,A,tint);body.quad(E,H,G,F,tint);
      },stone=[112,117,103] as const,dark=[31,35,29] as const,timber=[101,73,45] as const;
    if(site.kind==="ruin"||site.kind==="dungeon") {
      // Broken perimeter and a roofless courtyard, rather than unrelated stacks of stone.
      for(const [a,b,w,d,i]of [[-7,-1,1.2,9,0],[7,3,1.2,7,1],[-4,7,6,1.2,2],[4,7,4,1.2,3],[-5,-7,4,1.2,4],[5,-7,4,1.2,5]])
        box(body,a,b,0,w,1+(site.variant>>>i)%4,d,stone);
      box(body,7,6,0,2.1,5.4,2.1,stone);
      if(site.kind==="dungeon") {
        box(body,-2.4,-4,0,1.2,4.1,2.5,stone);box(body,2.4,-4,0,1.2,4.1,2.5,stone);
        box(body,0,-4,3.5,5.9,.8,2.5,stone);box(body,0,-5.28,.08,3.6,3.4,.14,dark);
        for(let i=0;i<4;i++)box(body,0,-7-i*.6,0,4.2,.1+i*.12,.55,stone);
      }
      if(tile.size<=16)for(let i=0;i<12;i++)box(detail,Math.sin(i*2.4)*10,Math.cos(i*2.4)*9,0,.5+(i%3)*.3,.35,.7,stone);
    } else if(site.kind==="cave"||site.kind==="mine"||site.kind==="cliff") {
      if(site.kind==='cliff'&&site.code.includes('/COUNTRYSIDE/'))continue;
      if(site.kind==="cliff")for(let i=0;i<5;i++)rock((i-2)*3,3+(i%2),0,4,5,4+(site.variant>>>i)%5);
      else {rock(-3,1,0,3.4,5,4.8);rock(3.1,1.4,0,3.5,5.2,5.4);rock(0,2.6,3.1,5.8,5,2.8);
        box(body,0,0,.1,3.3,3.1,.18,dark);
        if(site.kind==="mine"){box(body,-2,-.5,0,.55,3.8,.65,timber);box(body,2,-.5,0,.55,3.8,.65,timber);box(body,0,-.5,3.4,4.8,.55,.7,timber);
          if(tile.size<=16)for(const a of [-.6,.6])box(detail,a,-4,.07,.1,.08,6,[74,76,72]);}
      }
    } else if(site.kind==="waterfall") {
      if(site.code.includes('/COUNTRYSIDE/'))continue; // Foam belongs to the actual water surface, without overlapping boards.
      const water=finalSurfaceAt(x,z),length=Math.hypot(water.water.flowX,water.water.flowZ)||1,ux=water.water.flowX/length,uz=water.water.flowZ/length;
      for(let row=0;row<8;row++){
        const vertex=(along:number,side:number):readonly[number,number,number]=>{
          const px=x+(ux*along-uz*side)*metric.x,pz=z+(uz*along+ux*side)*metric.z,surface=finalSurfaceAt(px,pz);
          return[px-originX,elevationToRenderY(surface.water.kind==="river"?surface.water.level+.12:water.water.level+.12),pz-originZ];
        };
        const a=-12+row*3,b=a+2.4;body.quad(vertex(a,-1.6),vertex(a,1.6),vertex(b,1.6),vertex(b,-1.6),row%2?[187,215,213]:[222,235,222]);
      }
    } else if(site.kind==="wild-meadow"&&tile.size<=16) {
      for(let i=0;i<32;i++)box(detail,Math.sin(i*2.4)*(2+i%12),Math.cos(i*2.4)*(2+i%10),.1,.18,.25,.18,i%2?[197,178,98]:[169,133,174]);
    }
    // Forest/hill/lake/waterfall markers describe existing natural surfaces, not substitute fake terrain.
  }
  data.structures=mergeGeometry(data.structures,body.finish());data.detail=mergeGeometry(data.detail,detail.finish());
}
