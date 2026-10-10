import { featuresFor, field, heightAt, riverX, type Feature, type Tile } from "./world.ts";
import { roadAt, roadDistanceAt, roads } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { sourceToLonLat, wrapSourceX, SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { streetDistanceAt } from "./settlement-layout.ts";
import { climateSampleAt, polarBoundaryAt, TERRAIN_PALETTE, type RGB } from "./climate.ts";

type Point = [number, number, number];
export type Geometry = { positions: Float32Array; normals: Float32Array; colors: Uint8Array; indices: Uint32Array; uvs?: Float32Array };
export type TileGeometry = { terrain: Geometry; structures: Geometry; nature: Geometry; detail: Geometry };
const color = (r:number,g:number,b:number):[number,number,number] => [r,g,b];
const blend = (a:RGB,b:RGB,t:number):[number,number,number] => { const q=Math.max(0,Math.min(1,t)); return color(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q,a[2]+(b[2]-a[2])*q); };
const vary=(a:RGB,v:number):[number,number,number]=>color(Math.max(0,Math.min(255,a[0]+v)),Math.max(0,Math.min(255,a[1]+v)),Math.max(0,Math.min(255,a[2]+v)));
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/Math.max(1e-9,b-a)));return t*t*(3-2*t)};
const envelope=(v:number,a:number,b:number,c:number,d:number)=>smooth(a,b,v)*(1-smooth(c,d,v));
const STREET=color(170,151,113), CITY_STREET=color(157,139,106), STONE=color(164,162,143), TIMBER=color(76,57,42), PLASTER=color(210,190,145), GLASS=color(55,66,57);

class Builder {
  p:number[]=[]; n:number[]=[]; c:number[]=[]; i:number[]=[];
  triangle(a:Point,b:Point,c:Point,t:RGB){this.triangleGradient(a,b,c,t,t,t)}
  triangleGradient(a:Point,b:Point,c:Point,ta:RGB,tb:RGB,tc:RGB){
    const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1,s=this.p.length/3;
    for(const [q,t] of [[a,ta],[b,tb],[c,tc]] as [Point,RGB][]){this.p.push(...q);this.n.push(...n.map(x=>x/l));this.c.push(...t,255)} this.i.push(s,s+1,s+2);
  }
  quad(a:Point,b:Point,c:Point,d:Point,t:RGB){this.triangle(a,b,c,t);this.triangle(a,c,d,t)}
  quadGradient(a:Point,b:Point,c:Point,d:Point,ta:RGB,tb:RGB,tc:RGB,td:RGB){this.triangleGradient(a,b,c,ta,tb,tc);this.triangleGradient(a,c,d,ta,tc,td)}
  box(x:number,y:number,z:number,w:number,h:number,d:number,t:RGB){this.orientedBox(x,y,z,w,h,d,0,t)}
  orientedBox(x:number,y:number,z:number,w:number,h:number,d:number,a:number,t:RGB){
    const co=Math.cos(a),si=Math.sin(a),at=(lx:number,yy:number,lz:number):Point=>[x+lx*co+lz*si,yy,z-lx*si+lz*co],x0=-w/2,x1=w/2,z0=-d/2,z1=d/2,top=y+h;
    this.quad(at(x0,y,z0),at(x0,top,z0),at(x1,top,z0),at(x1,y,z0),t);this.quad(at(x1,y,z1),at(x1,top,z1),at(x0,top,z1),at(x0,y,z1),t);this.quad(at(x0,y,z1),at(x0,top,z1),at(x0,top,z0),at(x0,y,z0),t);this.quad(at(x1,y,z0),at(x1,top,z0),at(x1,top,z1),at(x1,y,z1),t);this.quad(at(x0,top,z0),at(x0,top,z1),at(x1,top,z1),at(x1,top,z0),t);
  }
  roof(x:number,y:number,z:number,w:number,d:number,r:number,a:number,t:RGB){
    const co=Math.cos(a),si=Math.sin(a),at=(lx:number,yy:number,lz:number):Point=>[x+lx*co+lz*si,yy,z-lx*si+lz*co],hw=w/2,hd=d/2,top=y+r;
    this.quad(at(-hw,y,-hd),at(0,top,-hd),at(0,top,hd),at(-hw,y,hd),t);this.quad(at(hw,y,hd),at(0,top,hd),at(0,top,-hd),at(hw,y,-hd),t);this.triangle(at(-hw,y,-hd),at(hw,y,-hd),at(0,top,-hd),t);this.triangle(at(hw,y,hd),at(-hw,y,hd),at(0,top,hd),t);
  }
  cone(x:number,y:number,z:number,r:number,h:number,t:RGB,sides=6){for(let i=0;i<sides;i++){const a=i*Math.PI*2/sides,b=(i+1)*Math.PI*2/sides;this.triangle([x+Math.cos(b)*r,y,z+Math.sin(b)*r],[x,y+h,z],[x+Math.cos(a)*r,y,z+Math.sin(a)*r],t)}}
  relativeTo(x:number,z:number){for(let i=0;i<this.p.length;i+=3){this.p[i]-=x;this.p[i+2]-=z}}
  finish():Geometry{return{positions:new Float32Array(this.p),normals:new Float32Array(this.n),colors:new Uint8Array(this.c),indices:new Uint32Array(this.i)}}
}

export function terrainTint(x:number,z:number,scale=32,elevationM?:number):[number,number,number]{
  const pos=sourceToLonLat(x,z),macro=macroSampleAt(pos),elevation=elevationM??heightAt(x,z),sample=climateSampleAt(pos,elevation);
  if(macro.domain==="Mainland"&&elevation<0.1)return color(76,128,148);
  if(macro.domain==="Mainland"&&Math.abs(wrapSourceX(x-riverX(z)))<32)return color(151,143,99);
  const road=roadAt(x,z); if(road&&roadDistanceAt(x,z,road)<5)return STREET;
  const detailScale=sample.forestFamily?42:68,variation=(field(x,z,detailScale,44)-0.5)*6,temp=sample.temperatureC,moist=sample.moisture,land=!["ocean","lake","sea-ice"].includes(sample.terrainClass);
  if(!land){const lat=Math.abs(pos.lat)/(Math.PI/2),ice=smooth(-0.018,0.018,lat-polarBoundaryAt(pos)),water=sample.terrainClass==="lake"?TERRAIN_PALETTE.lake:TERRAIN_PALETTE.ocean;return blend(water,TERRAIN_PALETTE["sea-ice"],ice)}
  let base:[number,number,number]=[...TERRAIN_PALETTE.desert];
  base=blend(base,TERRAIN_PALETTE["bare-earth"],smooth(0.18,0.28,moist));base=blend(base,TERRAIN_PALETTE.dryland,smooth(0.25,0.38,moist));base=blend(base,TERRAIN_PALETTE.grassland,smooth(0.34,0.52,moist));base=blend(base,TERRAIN_PALETTE.meadow,smooth(0.58,0.72,moist)*smooth(1,7,temp));
  const low=1-smooth(0.2,0.48,macro.mountainIntensity),con=envelope(temp,-10,-3,7,11)*smooth(0.35,0.52,moist)*low,forest=envelope(temp,6,11,20,24)*smooth(0.48,0.64,moist)*low,dry=smooth(15,20,temp)*smooth(0.3,0.4,moist)*(1-smooth(0.54,0.64,moist))*low;
  base=blend(base,TERRAIN_PALETTE["conifer-forest"],con*0.9);base=blend(base,TERRAIN_PALETTE["temperate-forest"],forest*0.92);base=blend(base,TERRAIN_PALETTE["dry-woodland"],dry*0.84);
  const coast=Math.max(0,sample.coastDistanceM),beach=(1-smooth(35,190,coast))*(1-smooth(0.5,0.72,sample.ruggedness)),cliff=smooth(0.55,0.79,sample.ruggedness);base=blend(base,TERRAIN_PALETTE.beach,beach*0.92);base=blend(base,TERRAIN_PALETTE.cliff,cliff*0.82);
  const high=Math.max(smooth(130,235,elevation),smooth(0.13,0.34,macro.mountainIntensity)),mount=macro.volcanic?TERRAIN_PALETTE.volcanic:TERRAIN_PALETTE.highland;base=blend(base,mount,high*(macro.volcanic?0.96:0.72));
  const snow=(1-smooth(5,9,temp))*smooth(sample.snowLineM-55,sample.snowLineM+55,elevation),lat=Math.abs(pos.lat)/(Math.PI/2),polar=smooth(-0.025,0.02,lat-polarBoundaryAt(pos)),polarBase=temp< -11||elevation>Math.max(120,sample.snowLineM*0.5)?TERRAIN_PALETTE["polar-ice"]:TERRAIN_PALETTE.tundra;base=blend(base,TERRAIN_PALETTE["snowy-mountain"],snow);base=blend(base,polarBase,polar);
  const canonical=vary(base,variation*((snow>0.65||polar>0.65)?0.3:1));if(scale>512)return canonical;const sd=streetDistanceAt(x,z);return sd<6?blend(canonical,STREET,0.35*(1-smooth(4,6,sd))):canonical;
}

const local=(f:Feature,ox:number,oz:number):[number,number]=>{const a=f.angle??0,c=Math.cos(a),s=Math.sin(a);return[f.x+ox*c+oz*s,f.z-ox*s+oz*c]};
const fbox=(b:Builder,f:Feature,ox:number,oy:number,oz:number,w:number,h:number,d:number,t:RGB)=>{const[x,z]=local(f,ox,oz);b.orientedBox(x,f.y+oy,z,w,h,d,f.angle??0,t)};
const froof=(b:Builder,f:Feature,ox:number,oy:number,oz:number,w:number,d:number,r:number,t:RGB)=>{const[x,z]=local(f,ox,oz);b.roof(x,f.y+oy,z,w,d,r,f.angle??0,t)};
function streetRibbon(b:Builder,f:Feature){const a=f.angle??0,c=Math.cos(a),s=Math.sin(a),half=(f.length??0)/2,hw=(f.width??4)/2,t=f.role==="city"?CITY_STREET:STREET,edge=(along:number,side:number):Point=>{const x=f.x+along*s+side*hw*c,z=f.z+along*c-side*hw*s;return[x,heightAt(x,z)+0.12,z]},r0=edge(-half,-1),r1=edge(0,-1),r2=edge(half,-1),l0=edge(-half,1),l1=edge(0,1),l2=edge(half,1);b.quad(r0,r1,l1,l0,t);b.quad(r1,r2,l2,l1,t)}

function building(f:Feature,near:boolean,b:Builder,d:Builder,v:number){
  const w=f.width??8,dep=f.depth??8,floors=f.floors??1,h=floors*3.2,front=dep/2+0.08,roof=color(108+(v%24),65+(v%15),48),door=()=>near&&fbox(d,f,0,0,front,1.25,2.25,0.16,TIMBER),windows=()=>{if(!near)return;for(const ox of [-w*0.25,w*0.25])fbox(d,f,ox,Math.min(2.3,h*0.45),front,0.95,1,0.12,GLASS)};
  switch(f.role){
    case"market":for(const sx of[-1,1])for(const sz of[-1,1])fbox(b,f,sx*(w/2-0.35),0,sz*(dep/2-0.35),0.45,3.5,0.45,TIMBER);froof(b,f,0,3.5,0,w+1,dep+1,1.8,color(151,74,58));for(const ox of[-w/4,0,w/4])fbox(b,f,ox,0,0,1.6,1,1.5,color(145,109,66));break;
    case"blacksmith":fbox(b,f,0,-0.3,0,w,h+0.3,dep,STONE);froof(b,f,0,h,0,w+1,dep+1,2.4,color(87,70,62));fbox(b,f,w*0.28,h+0.4,-dep*0.2,1.15,3.8,1.15,STONE);fbox(b,f,-w/2-1.4,2.4,0,2.7,0.25,dep*0.75,color(83,63,48));door();break;
    case"barn":fbox(b,f,0,-0.3,0,w,h+1.7,dep,color(96,70,49));froof(b,f,0,h+1.4,0,w+1,dep+1,w*0.55,color(61,49,40));if(near)fbox(d,f,0,0,front,w*0.48,h*0.7,0.15,color(69,51,37));break;
    case"inn":fbox(b,f,0,-0.3,0,w,h+0.3,dep,color(128,94,66));froof(b,f,0,h,0,w+1.2,dep+1.2,3.1,color(88,54,43));fbox(b,f,w/2-0.55,h*0.55,dep/2+0.6,1.35,1,0.15,color(171,78,49));door();windows();break;
    case"butcher":fbox(b,f,0,-0.3,0,w,h+0.3,dep,PLASTER);froof(b,f,0,h,0,w+1,dep+1,2.6,roof);for(const ox of[-w*0.3,0,w*0.3])fbox(b,f,ox,2.35,dep/2+0.65,w*0.28,0.15,1.3,ox===0?color(232,222,200):color(171,78,49));door();windows();break;
    case"farmstead":fbox(b,f,0,-0.3,0,w,3.1,dep,PLASTER);froof(b,f,0,2.8,0,w+1,dep+1,2,roof);for(const side of[-1,1])fbox(b,f,side*(w/2+1.6),0,dep/2+2.7,0.16,1.3,0.16,TIMBER);fbox(b,f,0,0.9,dep/2+2.7,w+3.2,0.14,0.14,TIMBER);door();windows();break;
    case"guard-office":fbox(b,f,0,-0.3,0,w,h+0.3,dep,STONE);fbox(b,f,0,h,0,w+0.7,0.4,dep+0.7,color(119,117,104));for(const sx of[-1,1])for(const sz of[-1,1])fbox(b,f,sx*(w/2-0.35),h+0.35,sz*(dep/2-0.35),0.65,0.9,0.65,STONE);door();windows();break;
    default:fbox(b,f,0,-0.3,0,w,h+0.3,dep,PLASTER);froof(b,f,0,h,0,w+1,dep+1,2.7,roof);if(near){fbox(d,f,0,h*0.55,0,w+0.08,0.2,dep+0.1,TIMBER);door();windows();fbox(d,f,w*0.28,h+0.7,-dep*0.2,0.75,1.6,0.75,STONE)}
  }
}

export function buildTile(t:Tile):TileGeometry{
  const terrain=new Builder(),structures=new Builder(),nature=new Builder(),detail=new Builder(),res=Math.min(16,t.size/2),step=t.size/res;
  for(let z=0;z<res;z++)for(let x=0;x<res;x++){const ax=t.minX+x*step,az=t.minZ+z*step,p=(px:number,pz:number):Point=>[px,heightAt(px,pz),pz],a=p(ax,az),b=p(ax,az+step),c=p(ax+step,az+step),d=p(ax+step,az);if(Math.max(a[1],b[1],c[1],d[1])>0)terrain.quadGradient(a,b,c,d,terrainTint(a[0],a[2],t.size,a[1]),terrainTint(b[0],b[2],t.size,b[1]),terrainTint(c[0],c[2],t.size,c[1]),terrainTint(d[0],d[2],t.size,d[1]));if(z===0)terrain.quad(a,d,[d[0],d[1]-12,d[2]],[a[0],a[1]-12,a[2]],terrainTint(ax,az,t.size,a[1]));if(z===res-1)terrain.quad(c,b,[b[0],b[1]-12,b[2]],[c[0],c[1]-12,c[2]],terrainTint(ax,az,t.size,c[1]));if(x===0)terrain.quad(b,a,[a[0],a[1]-12,a[2]],[b[0],b[1]-12,b[2]],terrainTint(ax,az,t.size,b[1]));if(x===res-1)terrain.quad(d,c,[c[0],c[1]-12,c[2]],[d[0],d[1]-12,d[2]],terrainTint(ax,az,t.size,d[1]))}
  const water=(x:number,z:number):RGB=>{if(heightAt(x,z)<=0)return terrainTint(x,z);const p=sourceToLonLat(x,z);return blend(TERRAIN_PALETTE.ocean,TERRAIN_PALETTE["sea-ice"],smooth(-0.018,0.018,Math.abs(p.lat)/(Math.PI/2)-polarBoundaryAt(p)))};
  terrain.quadGradient([t.minX,0,t.minZ],[t.minX,0,t.minZ+t.size],[t.minX+t.size,0,t.minZ+t.size],[t.minX+t.size,0,t.minZ],water(t.minX,t.minZ),water(t.minX,t.minZ+t.size),water(t.minX+t.size,t.minZ+t.size),water(t.minX+t.size,t.minZ));
  if(t.size<=512)for(const f of featuresFor(t)){const{x,y,z,variant:v}=f;if(f.kind==="house")building(f,t.size<=64,structures,detail,v);else if(f.kind==="keep"){const w=f.width??20,dep=f.depth??18,a=f.angle??0;structures.orientedBox(x,y-0.3,z,w,10.3,dep,a,STONE);structures.roof(x,y+10,z,w+1,dep+1,4,a,color(65,81,88));for(const ox of[-w/2-2,w/2+2])for(const oz of[-dep/2+2,dep/2-2]){fbox(structures,f,ox,-0.3,oz,4.2,13.3,4.2,color(154,154,135));const[qx,qz]=local(f,ox,oz);structures.cone(qx,y+13,qz,3.6,5,color(62,80,87),4)}}else if(f.kind==="tree"){const fam=climateSampleAt(sourceToLonLat(x,z),y).forestFamily;if(!fam)continue;const h=7+(v%5),r=2.4+(v%9)/10;nature.box(x,y-0.1,z,fam==="temperate-deciduous-mixed"?0.78:0.62,h*0.56,fam==="temperate-deciduous-mixed"?0.78:0.62,TIMBER);if(fam==="conifer-boreal"){nature.cone(x,y+1.2,z,r,h*0.8,color(45+(v%10),82+(v%12),59),6);nature.cone(x,y+h*0.42,z,r*0.72,h*0.55,color(56,94+(v%12),65),6)}else{nature.cone(x,y+h*0.34,z,r*1.15,h*0.48,color(69+(v%14),115+(v%17),64),8);nature.cone(x+r*0.3,y+h*0.48,z,r*0.72,h*0.31,color(81,127,70),7)}}else if(f.kind==="rock")nature.box(x,y-0.2,z,1.5+(v%3),1+(v%2),1.9,color(133,143,123));else if(f.kind==="field"){const w=f.width??18,dep=f.depth??18;fbox(nature,f,0,0.03,0,w,0.15,dep,color(158,132,66));if(t.size<=64)for(let row=0;row<8;row++)fbox(detail,f,-w/2+(row+1)*w/9,0.2,0,0.65,0.45,Math.max(2,dep-2),color(184,158,83))}else if(f.kind==="street")streetRibbon(structures,f);else if(f.kind==="wall")structures.orientedBox(x,y-0.2,z,0.8,2.2,f.length??16,f.angle??0,f.role==="city"?STONE:color(104,78,52));else if(f.kind==="gate"){const half=(f.width??6)/2;for(const s of[-1,1])fbox(structures,f,s*(half+0.6),-0.2,0,1.2,3.6,1.2,STONE);fbox(structures,f,0,3,0,2*half+1.2,0.8,1.2,STONE)}else if(f.kind==="guard-post"){fbox(structures,f,0,0,0,1.8,2.6,1.8,STONE);froof(structures,f,0,2.6,0,2.2,2.2,0.9,color(116,69,47))}else if(f.kind==="well"&&t.size<=64){structures.box(x,y,z,2.3,1,2.3,STONE);detail.box(x,y+1.02,z,1.4,0.04,1.4,color(39,59,56));for(const ox of[-1.2,1.2])detail.box(x+ox,y,z,0.18,3,0.18,TIMBER);detail.roof(x,y+3,z,3,3,1,0,color(116,69,47))}}
  if(t.size<=512)for(const road of roads){if(road.z<t.minZ||road.z>=t.minZ+t.size)continue;for(let x=Math.max(t.minX,Math.ceil(road.minX/2)*2);x<Math.min(t.minX+t.size,road.maxX);x+=2)if(heightAt(x,road.z)<2.9){structures.box(x+1,2.8,road.z,2,0.2,10,color(115,88,56));if(t.size<=64)for(const oz of[-4.5,4.5]){detail.box(x+1,3.9,road.z+oz,2,0.18,0.18,color(83,65,46));detail.box(x,3,road.z+oz,0.2,1.2,0.2,color(83,65,46))}}}
  const ox=t.minX+t.size/2,oz=t.minZ+t.size/2,uvs=new Float32Array(terrain.p.length/3*2);for(let i=0,v=0;i<terrain.p.length;i+=3,v+=2){uvs[v]=terrain.p[i]/SOURCE_PRESENTATION_WIDTH+0.5;uvs[v+1]=Math.max(0,Math.min(1,0.5+terrain.p[i+2]*2/SOURCE_PRESENTATION_WIDTH))}for(const b of[terrain,structures,nature,detail])b.relativeTo(ox,oz);return{terrain:{...terrain.finish(),uvs},structures:structures.finish(),nature:nature.finish(),detail:detail.finish()};
}
