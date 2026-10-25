import { naturalSurfaceAt } from "./hydrology.ts";
import { finalSurfaceAt } from './world.ts';
import type { TileGeometry } from "./geometry.ts";
import { SiteBuilder, mergeGeometry } from "./site-geometry.ts";
import { nearbyWilderness } from "./wilderness.ts";
import { wrapSourceX } from "./planet.ts";
import { sourceUnitsPerMetreAt } from "./physical-scale.ts";
import { elevationToRenderY } from "./render-frame.ts";
import type { Tile } from "./world.ts";
import type { WildernessSite } from "./wilderness.ts";

type P3=readonly[number,number,number];
type Tint=readonly[number,number,number];
// Falling water: clearer pale blue near the lip, aerated white near the foot, with alternating vertical streaks.
const sheetTint=(fall:number,column:number):Tint=>{
  // fall 0 = lip, 1 = foot; every other column is a slightly brighter streak.
  const streak=column%2?10:0,t=Math.min(1,Math.max(0,fall));
  return[Math.min(255,Math.round(176+t*66+streak)),Math.min(255,Math.round(214+t*32+streak*.6)),Math.min(255,Math.round(236+t*14))];
};
const FOAM:readonly Tint[]=[[247,252,250],[233,246,245],[214,236,240]];
const ROCK:readonly Tint[]=[[112,117,103],[93,98,88],[126,128,114]];

/** Add a quad whose normal faces `dir` (render-space direction), so lighting is right whatever the winding. */
function facing(builder:SiteBuilder,a:P3,b:P3,c:P3,d:P3,tint:Tint,dir:P3){
  const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],
    n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  if(n[0]*dir[0]+n[1]*dir[1]+n[2]*dir[2]<0)builder.quad(d,c,b,a,tint);else builder.quad(a,b,c,d,tint);
}

/**
 * Cascade presentation: a rock sill across the whole river, a pale sheet of falling water, foam and spray at the foot, and
 * the river continuing below. It is built on top of the existing river surface; hydrology, levels and terrain stay untouched.
 * Seed-landform (COUNTRYSIDE) waterfalls already have a real steep terrain step, so only the sheet, foam and rocks are added.
 */
export function appendWaterfall(site:WildernessSite,x:number,z:number,originX:number,originZ:number,body:SiteBuilder){
  const metric=sourceUnitsPerMetreAt(z),centre=finalSurfaceAt(x,z);
  if(centre.water.kind!=="river")return;
  const flowLength=Math.hypot(centre.water.flowX,centre.water.flowZ)||1,ux=centre.water.flowX/flowLength,uz=centre.water.flowZ/flowLength,
    seeded=site.code.includes('/COUNTRYSIDE/'),
    rnd=(i:number)=>(Math.imul(site.variant^Math.imul(i+1,0x9e3779b1),0x85ebca6b)>>>0)/4294967296,
    memo=new Map<string,{px:number,pz:number,wet:boolean,level:number,ground:number}>(),
    sample=(along:number,side:number)=>{
      const key=`${Math.round(along*8)}/${Math.round(side*8)}`,hit=memo.get(key);if(hit)return hit;
      const px=x+(ux*along-uz*side)*metric.x,pz=z+(uz*along+ux*side)*metric.z,surface=finalSurfaceAt(px,pz),
        wet=surface.water.kind==="river"||surface.water.kind==="lake",value={px,pz,wet,level:wet?surface.water.level:surface.groundHeight,ground:surface.groundHeight};
      memo.set(key,value);return value;
    },
    level=(along:number,side:number)=>sample(along,side).level,
    at=(along:number,side:number,elevation:number):P3=>{const s=sample(along,side);return[s.px-originX,elevationToRenderY(elevation),s.pz-originZ];},
    /** Distance from the centreline to the wet edge, found by bisection (the river is a few tens of metres wide). */
    edge=(along:number,sign:number)=>{
      let lo=0,hi=45;if(sample(along,sign*hi).wet)return hi;
      for(let i=0;i<6;i++){const mid=(lo+hi)/2;if(sample(along,sign*mid).wet)lo=mid;else hi=mid;}
      return Math.max(1.5,lo);
    },
    toward:P3=[ux,0,uz],
    drop=Math.max(0,level(-16,0)-level(16,0)),
    height=seeded?0:Math.min(6,Math.max(3.5,drop*.6)),
    sill=level(0,0)+height,
    // Rows upstream of the lip carry the raised pool; downstream rows carry foam and the river continues on its own surface.
    ramp=(along:number)=>{const t=Math.min(1,Math.max(0,(along+15)/10));return t*t*(3-2*t);},
    top=(along:number,side:number)=>seeded?level(along,side)+.12:Math.max(level(along,side)+.12,level(0,0)+height*ramp(along)),
    columns=(left:number,right:number)=>Math.min(36,Math.max(3,Math.round((left+right)/2.2)));
  const lipLeft=edge(0,-1),lipRight=edge(0,1),n=columns(lipLeft,lipRight);

  if(seeded){
    // Sheet follows the existing terrain step (steep sill of the landform), pushed a little downstream so it is never buried.
    const rows=[-3.6,-2.4,-1.2,-.3,.3,1.2,2.4,3.6];
    for(let j=0;j<n;j++){
      const s0=-lipLeft+(lipLeft+lipRight)*j/n,s1=-lipLeft+(lipLeft+lipRight)*(j+1)/n;
      for(let r=0;r<rows.length-1;r++){
        const a0=rows[r],a1=rows[r+1],tint=sheetTint((r+.5)/(rows.length-1),j);
        const P=(a:number,s:number):P3=>{const v=at(a+.35,s,level(a,s)+.1);return v;};
        facing(body,P(a0,s0),P(a0,s1),P(a1,s1),P(a1,s0),tint,[ux*.6,.8,uz*.6]);
      }
    }
  } else {
    // Rock sill: banks of the raised pool, one strip per metre-scale row upstream of the lip.
    const rows=[-15,-11,-7,-4,-2,0];
    for(let r=0;r<rows.length-1;r++)for(const sign of [-1,1]){
      const a0=rows[r],a1=rows[r+1],e0=edge(a0,sign),e1=edge(a1,sign),o0=sign*(e0+2.2),o1=sign*(e1+2.2),i0=sign*e0,i1=sign*e1,
        t0=top(a0,i0)+.35,t1=top(a1,i1)+.35,b0=Math.min(sample(a0,i0).ground,sample(a0,o0).ground)-.5,b1=Math.min(sample(a1,i1).ground,sample(a1,o1).ground)-.5,
        tint=ROCK[(r+(sign>0?1:0))%ROCK.length];
      facing(body,at(a0,i0,t0),at(a1,i1,t1),at(a1,o1,t1),at(a0,o0,t0),tint,[0,1,0]);
      facing(body,at(a0,i0,b0),at(a1,i1,b1),at(a1,i1,t1),at(a0,i0,t0),ROCK[1],[sign*uz,0,-sign*ux]);
      facing(body,at(a0,o0,b0),at(a1,o1,b1),at(a1,o1,t1),at(a0,o0,t0),ROCK[1],[sign*-uz,0,sign*ux]);
    }
    // Raised pool surface with foam streaks speeding up towards the lip.
    for(let r=0;r<rows.length-1;r++){
      const a0=rows[r],a1=rows[r+1],l0=edge(a0,-1),l1=edge(a1,-1),r0=edge(a0,1),r1=edge(a1,1),m=columns(l0,r0);
      for(let j=0;j<m;j++){
        const f0=j/m,f1=(j+1)/m,P=(a:number,l:number,rr:number,f:number):P3=>{const s=-l+(l+rr)*f;return at(a,s,top(a,s));},
          streak=r>=rows.length-3&&j%2===0;
        facing(body,P(a0,l0,r0,f0),P(a0,l0,r0,f1),P(a1,l1,r1,f1),P(a1,l1,r1,f0),[92,148,170],[0,1,0]);
        if(streak){const g0=f0+(f1-f0)*.3,g1=f0+(f1-f0)*.7,Q=(a:number,l:number,rr:number,f:number):P3=>{const v=P(a,l,rr,f);return[v[0],v[1]+.004,v[2]];};
          facing(body,Q(a0,l0,r0,g0),Q(a0,l0,r0,g1),Q(a1,l1,r1,g1),Q(a1,l1,r1,g0),FOAM[1],[0,1,0]);}
      }
    }
    // Sill front: bare rock face under the sheet's lip, so the sheet never floats.
    const frontTop=(s:number)=>sill+.3;
    for(let j=0;j<n;j++){
      const s0=-lipLeft+(lipLeft+lipRight)*j/n,s1=-lipLeft+(lipLeft+lipRight)*(j+1)/n;
      facing(body,at(.55,s0,level(.9,s0)+.1),at(.55,s1,level(.9,s1)+.1),at(0,s1,frontTop(s1)),at(0,s0,frontTop(s0)),ROCK[1+j%2],toward);
    }
    // Falling sheet: two bands high, alternating pale vertical stripes.
    const mid=(s:number)=>(sill+level(.95,s))/2+.2;
    for(let j=0;j<n;j++){
      const s0=-lipLeft+(lipLeft+lipRight)*j/n,s1=-lipLeft+(lipLeft+lipRight)*(j+1)/n;
      facing(body,at(.75,s0,level(1.1,s0)+.1),at(.75,s1,level(1.1,s1)+.1),at(.45,s1,mid(s1)),at(.45,s0,mid(s0)),sheetTint(.8,j),toward);
      facing(body,at(.45,s0,mid(s0)),at(.45,s1,mid(s1)),at(.1,s1,sill+.12),at(.1,s0,sill+.12),sheetTint(.2,j),toward);
    }
  }
  // Foam at the foot: a jagged, brighter band across the river, and a few spray puffs.
  const footA=seeded?3.4:1.1,foamLength=seeded?8:3.6,foamRows=[footA,footA+foamLength*.4,footA+foamLength*.75,footA+foamLength];
  const fl=[0,1,2,3].map(i=>edge(foamRows[i],-1)),fr=[0,1,2,3].map(i=>edge(foamRows[i],1));
  const fm=columns(fl[0],fr[0]);
  for(let j=0;j<fm;j++)for(let r=0;r<3;r++){
    if(rnd(j*7+r+120)>[1,.72,.42][r])continue;
    const f0=j/fm,f1=(j+1)/fm,P=(row:number,f:number):P3=>{const s=-fl[row]+(fl[row]+fr[row])*f;return at(foamRows[row],s,level(foamRows[row],s)+.14+row*.01);};
    facing(body,P(r,f0),P(r,f1),P(r+1,f1),P(r+1,f0),r===0||rnd(j*5+r+90)<.6?FOAM[0]:FOAM[1+(j+r)%2],[0,1,0]);
  }
  for(let i=0;i<Math.min(22,Math.round((lipLeft+lipRight)/1.6)+4);i++){
    const s=-lipLeft*.9+(lipLeft+lipRight)*.9*rnd(i*3+1),along=footA-.1+rnd(i*3+2)*1.8,size=.7+rnd(i*3+3)*1.1,base=level(along,s)+.08,tint=FOAM[i%3];
    const A=at(along-size/2,s-size/2,base),B=at(along+size/2,s-size/2,base),C=at(along+size/2,s+size/2,base),D=at(along-size/2,s+size/2,base),
      E=at(along-size*.3,s-size*.3,base+size*.9),F=at(along+size*.3,s-size*.3,base+size*.9),G=at(along+size*.3,s+size*.3,base+size*.9),H=at(along-size*.3,s+size*.3,base+size*.9);
    body.quad(A,E,F,B,tint);body.quad(B,F,G,C,tint);body.quad(C,G,H,D,tint);body.quad(D,H,E,A,tint);body.quad(E,H,G,F,tint);
  }
  // Boulders flanking the foot of the fall.
  for(let i=0;i<6;i++){
    const sign=i%2?1:-1,s=sign*((i%2?lipRight:lipLeft)*(.55+rnd(i+40)*.4)),along=footA+rnd(i+50)*3.4-.6,size=1.3+rnd(i+60)*1.6,base=Math.min(sample(along,s).ground,level(along,s))-.3,tint=ROCK[i%ROCK.length];
    const A=at(along-size/2,s-size/2,base),B=at(along+size/2,s-size/2,base),C=at(along+size/2,s+size/2,base),D=at(along-size/2,s+size/2,base),
      E=at(along-size*.26,s-size*.28,base+size*.75),F=at(along+size*.3,s-size*.25,base+size*.95),G=at(along+size*.25,s+size*.3,base+size*.8),H=at(along-size*.32,s+size*.22,base+size*.62);
    body.quad(A,E,F,B,tint);body.quad(B,F,G,C,tint);body.quad(C,G,H,D,tint);body.quad(D,H,E,A,tint);body.quad(E,H,G,F,tint);
  }
}

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
      appendWaterfall(site,x,z,originX,originZ,body);
    } else if(site.kind==="wild-meadow"&&tile.size<=16) {
      for(let i=0;i<32;i++)box(detail,Math.sin(i*2.4)*(2+i%12),Math.cos(i*2.4)*(2+i%10),.1,.18,.25,.18,i%2?[197,178,98]:[169,133,174]);
    }
    // Forest/hill/lake/waterfall markers describe existing natural surfaces, not substitute fake terrain.
  }
  data.structures=mergeGeometry(data.structures,body.finish());data.detail=mergeGeometry(data.detail,detail.finish());
}
