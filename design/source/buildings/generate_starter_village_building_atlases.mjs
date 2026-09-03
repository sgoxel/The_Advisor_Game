#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from '../../../tools/split_tile_atlas.mjs';

const SIZE=1024, CELL=256, GRID=4;
const here=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(here,{recursive:true});

const families={
  home:{family:'home',wall:'#8a6748',shade:'#6f513a',roof:'#7a463b',roof2:'#5f342e',accent:'#e0bb7c',cue:'hearth'},
  inn:{family:'lodging',wall:'#927451',shade:'#73583d',roof:'#783846',roof2:'#5b2935',accent:'#f0c96f',cue:'tables'},
  village_hall:{family:'landmark',wall:'#817464',shade:'#62594e',roof:'#526171',roof2:'#3c4651',accent:'#e1d7b4',cue:'council'},
  bakery:{family:'food-shop',wall:'#9a7148',shade:'#795637',roof:'#78493a',roof2:'#5c352c',accent:'#f1c27d',cue:'oven'},
  market:{family:'food-shop',wall:'#8c7653',shade:'#6e5d41',roof:'#5f7550',roof2:'#47583c',accent:'#e0c77b',cue:'stalls'},
  smithy:{family:'production',wall:'#6c6460',shade:'#504b49',roof:'#454349',roof2:'#302f33',accent:'#df8752',cue:'forge'},
  workshop:{family:'production',wall:'#7a644e',shade:'#5e4b3b',roof:'#544c40',roof2:'#3e3830',accent:'#c9a86a',cue:'bench'},
  guard_post:{family:'service',wall:'#6e7074',shade:'#53565a',roof:'#4b5966',roof2:'#37414a',accent:'#d2dae0',cue:'rack'},
  mill:{family:'agricultural',wall:'#8a795b',shade:'#6b5d46',roof:'#5b684f',roof2:'#43503b',accent:'#dac991',cue:'millstone'},
  farmstead:{family:'agricultural',wall:'#8c724d',shade:'#6e583a',roof:'#6b5c3e',roof2:'#50452f',accent:'#d7c66e',cue:'pantry'},
  storage:{family:'storage',wall:'#82684d',shade:'#614d39',roof:'#5b493b',roof2:'#42352c',accent:'#cdb07e',cue:'crates'},
  well:{family:'service',wall:'#6c7379',shade:'#50565b',roof:'#4b535b',roof2:'#373d43',accent:'#b9d0d8',cue:'well'}
};
const aliases={dwelling:'home',house:'home',tavern:'inn',lodging:'inn',hall:'village_hall',civic:'village_hall',shop:'market',food:'bakery',production:'workshop',guard:'guard_post',service:'guard_post',farm:'farmstead',agricultural:'farmstead',storehouse:'storage',barn:'storage'};

// Keep the established semantic keys so runtime/cache contracts stay stable. In #356
// they are explicitly reinterpreted as top-down plan positions rather than facade
// elevation pieces: roof_* = north cutaway boundary, wall_* = interior/side plan,
// base_* = south boundary, entrance = floor threshold, family_feature = interior cue.
const cells=[
  [0,0,'roof_corner_nw'],[0,1,'roof_edge_n'],[0,2,'roof_corner_ne'],[0,3,'roof_ridge'],
  [1,0,'wall_edge_w'],[1,1,'wall_center'],[1,2,'wall_edge_e'],[1,3,'wall_window'],
  [2,0,'base_corner_sw'],[2,1,'entrance'],[2,2,'base_corner_se'],[2,3,'family_feature']
].map(([row,col,type])=>({row,col,type}));
const unusedCells=[0,1,2,3].map(col=>({row:3,col}));

function rgb(hex){const n=parseInt(hex.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];}
function shade(hex,amount){return rgb(hex).map(v=>Math.max(0,Math.min(255,Math.round(v+amount))));}
function px(buf,x,y,c,a=255){if(x<0||y<0||x>=SIZE||y>=SIZE)return;const i=(y*SIZE+x)*4;buf[i]=c[0];buf[i+1]=c[1];buf[i+2]=c[2];buf[i+3]=a;}
function rect(buf,x,y,w,h,c,a=255){for(let yy=Math.max(0,y);yy<Math.min(SIZE,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(SIZE,x+w);xx++)px(buf,xx,yy,c,a);}
function line(buf,x0,y0,x1,y1,c,width=1){const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let e=dx+dy;for(;;){rect(buf,x0-Math.floor(width/2),y0-Math.floor(width/2),width,width,c);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}}
function poly(buf,points,c){const ys=points.map(p=>p[1]);for(let y=Math.floor(Math.min(...ys));y<=Math.ceil(Math.max(...ys));y++){const xs=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)rect(buf,Math.ceil(xs[i]),y,Math.floor(xs[i+1])-Math.ceil(xs[i])+1,1,c);}}
function cellOrigin(cell){return [cell.col*CELL,cell.row*CELL];}
function frame(buf,x,y,w,h,fill,border){rect(buf,x,y,w,h,fill);rect(buf,x,y,w,5,border);rect(buf,x,y+h-5,w,5,border);rect(buf,x,y,5,h,border);rect(buf,x+w-5,y,5,h,border);}
function floorTexture(buf,ox,oy,s,salt=0){const floor=shade(s.wall,30),joint=shade(s.wall,12),light=shade(s.wall,42);rect(buf,ox+4,oy+4,248,248,floor);for(let y=oy+20;y<oy+252;y+=34)line(buf,ox+8,y,ox+248,y,joint,2);let column=0;for(let x=ox+18;x<ox+252;x+=48,column++){const offset=((column+salt)%2)*17;for(let y=oy+20+offset;y<oy+252;y+=68)line(buf,x,y,x,Math.min(oy+252,y+34),light,2);}}
function wallBand(buf,ox,oy,side,s){const outer=shade(s.shade,-30),inner=rgb(s.wall),cap=shade(s.wall,38);if(side==='north'){rect(buf,ox+4,oy+4,248,38,outer);rect(buf,ox+8,oy+10,240,22,inner);rect(buf,ox+8,oy+32,240,6,cap);}else if(side==='south'){rect(buf,ox+4,oy+214,248,38,outer);rect(buf,ox+8,oy+220,240,22,inner);rect(buf,ox+8,oy+214,240,6,cap);}else if(side==='west'){rect(buf,ox+4,oy+4,38,248,outer);rect(buf,ox+10,oy+8,22,240,inner);rect(buf,ox+32,oy+8,6,240,cap);}else if(side==='east'){rect(buf,ox+214,oy+4,38,248,outer);rect(buf,ox+220,oy+8,22,240,inner);rect(buf,ox+214,oy+8,6,240,cap);}}
function cornerPost(buf,ox,oy,x,y,s){rect(buf,ox+x,oy+y,30,30,shade(s.shade,-36));rect(buf,ox+x+5,oy+y+5,20,20,shade(s.wall,16));}

function roofPiece(buf,ox,oy,type,s){
  floorTexture(buf,ox,oy,s,type.length);
  wallBand(buf,ox,oy,'north',s);
  if(type==='roof_corner_nw'){wallBand(buf,ox,oy,'west',s);cornerPost(buf,ox,oy,8,8,s);}
  else if(type==='roof_corner_ne'){wallBand(buf,ox,oy,'east',s);cornerPost(buf,ox,oy,218,8,s);}
  else if(type==='roof_ridge'){
    // Legacy key becomes a subtle north-wall support/cutaway shadow, never a roof face.
    rect(buf,ox+104,oy+10,48,28,shade(s.roof2,-8));
    rect(buf,ox+112,oy+38,32,20,shade(s.roof,18),150);
  }
}

function wallPiece(buf,ox,oy,type,s){
  floorTexture(buf,ox,oy,s,type.length);
  if(type==='wall_edge_w')wallBand(buf,ox,oy,'west',s);
  if(type==='wall_edge_e')wallBand(buf,ox,oy,'east',s);
  if(type==='wall_window'){
    // Interior readability cue: a low rug/table footprint instead of a facade window.
    rect(buf,ox+62,oy+70,132,116,shade(s.accent,-30));
    rect(buf,ox+72,oy+80,112,96,shade(s.accent,5));
    line(buf,ox+128,oy+84,ox+128,oy+172,shade(s.accent,-45),4);
  }
}

function basePiece(buf,ox,oy,type,s){
  floorTexture(buf,ox,oy,s,17+type.length);
  if(type==='base_corner_sw'){wallBand(buf,ox,oy,'west',s);wallBand(buf,ox,oy,'south',s);cornerPost(buf,ox,oy,8,218,s);return;}
  if(type==='base_corner_se'){wallBand(buf,ox,oy,'east',s);wallBand(buf,ox,oy,'south',s);cornerPost(buf,ox,oy,218,218,s);return;}
  if(type==='entrance'){
    // South boundary with a clear central threshold/gap aligned to authoritative entrance.
    wallBand(buf,ox,oy,'south',s);
    rect(buf,ox+82,oy+210,92,46,shade(s.wall,34));
    rect(buf,ox+90,oy+218,76,38,shade(s.accent,-12));
    line(buf,ox+90,oy+218,ox+166,oy+218,shade(s.accent,28),5);
    return;
  }
  wallBand(buf,ox,oy,'south',s);
}

function feature(buf,ox,oy,s){
  floorTexture(buf,ox,oy,s,71);
  const accent=rgb(s.accent),dark=shade(s.shade,-34),roof=rgb(s.roof);
  if(s.cue==='hearth'){
    rect(buf,ox+74,oy+72,108,112,dark);rect(buf,ox+86,oy+84,84,88,shade(s.wall,-16));rect(buf,ox+104,oy+104,48,48,shade(s.accent,18));
  }else if(s.cue==='tables'){
    for(const [x,y] of [[54,58],[142,58],[98,146]]){rect(buf,ox+x,oy+y,60,42,dark);rect(buf,ox+x+6,oy+y+6,48,30,accent);}
  }else if(s.cue==='council'){
    rect(buf,ox+42,oy+64,172,54,dark);rect(buf,ox+50,oy+72,156,38,accent);for(let x=58;x<=190;x+=44)rect(buf,ox+x,oy+142,24,42,roof);
  }else if(s.cue==='oven'){
    rect(buf,ox+60,oy+58,136,138,dark);poly(buf,[[ox+74,oy+172],[ox+128,oy+82],[ox+182,oy+172]],shade(s.accent,8));rect(buf,ox+104,oy+126,48,52,[62,44,34]);
  }else if(s.cue==='stalls'){
    for(const y of [62,142]){rect(buf,ox+42,oy+y,172,44,dark);for(let x=52;x<204;x+=38)rect(buf,ox+x,oy+y+8,28,28,accent);}
  }else if(s.cue==='forge'){
    rect(buf,ox+54,oy+76,148,124,dark);rect(buf,ox+78,oy+98,76,76,shade(s.accent,18));rect(buf,ox+162,oy+104,28,68,roof);line(buf,ox+64,oy+210,ox+198,oy+210,dark,8);
  }else if(s.cue==='bench'){
    rect(buf,ox+42,oy+64,172,54,dark);rect(buf,ox+50,oy+72,156,38,accent);for(let x=58;x<196;x+=34)rect(buf,ox+x,oy+136,20,62,roof);
  }else if(s.cue==='rack'){
    rect(buf,ox+54,oy+54,148,18,dark);rect(buf,ox+54,oy+184,148,18,dark);for(let x=70;x<=186;x+=29)line(buf,ox+x,oy+70,ox+x,oy+182,accent,6);
  }else if(s.cue==='millstone'){
    for(let r=70;r>=8;r-=8){const c=r%16===0?dark:accent;for(let a=0;a<360;a+=4){const rad=a*Math.PI/180;rect(buf,Math.round(ox+128+Math.cos(rad)*r),Math.round(oy+128+Math.sin(rad)*r),4,4,c);}}rect(buf,ox+120,oy+72,16,112,roof);
  }else if(s.cue==='pantry'){
    for(const [x,y] of [[50,58],[134,58],[50,142],[134,142]]){frame(buf,ox+x,oy+y,72,58,shade(s.wall,-8),dark);rect(buf,ox+x+10,oy+y+10,52,12,accent);}
  }else if(s.cue==='crates'){
    for(const [x,y] of [[48,54],[132,54],[90,138]]){frame(buf,ox+x,oy+y,76,72,rgb(s.wall),dark);line(buf,ox+x+8,oy+y+8,ox+x+68,oy+y+64,accent,5);line(buf,ox+x+68,oy+y+8,ox+x+8,oy+y+64,accent,5);}
  }else if(s.cue==='well'){
    for(let r=76;r>=52;r-=6){const c=r%12===0?shade(s.wall,-12):accent;for(let a=0;a<360;a+=5){const rad=a*Math.PI/180;rect(buf,Math.round(ox+128+Math.cos(rad)*r),Math.round(oy+128+Math.sin(rad)*r),5,5,c);}}rect(buf,ox+86,oy+118,84,28,[38,57,63]);
  }
}

function paintFamily(name,s){const buf=Buffer.alloc(SIZE*SIZE*4,0);for(const cell of cells){const [ox,oy]=cellOrigin(cell);if(cell.type.startsWith('roof'))roofPiece(buf,ox,oy,cell.type,s);else if(cell.type.startsWith('wall'))wallPiece(buf,ox,oy,cell.type,s);else if(cell.type==='family_feature')feature(buf,ox,oy,s);else basePiece(buf,ox,oy,cell.type,s);}return buf;}
function manifest(name,s){return {schemaVersion:1,family:name,visualFamily:s.family,atlas:{width:SIZE,height:SIZE,columns:GRID,rows:GRID,cellSize:CELL},authority:'presentation-only',source:'Original deterministic top-down/open-roof starter-village building tile art generated for #356.',composition:{view:'top-down-open-roof',logicalCellOwnership:'building-only',entranceSemantic:'entrance',northBoundary:['roof_corner_nw','roof_edge_n','roof_corner_ne','roof_ridge'],interior:['wall_center','wall_window','family_feature'],sideBoundary:['wall_edge_w','wall_edge_e'],southBoundary:['base_corner_sw','entrance','base_corner_se'],overhang:'none; pixels never redefine collision/footprint/occupancy'},cells,unusedCells};}

for(const [name,s] of Object.entries(families)){
  const buf=paintFamily(name,s);
  fs.writeFileSync(path.join(here,`${name}_starter_1024.png`),encodeRgbaPng(SIZE,SIZE,buf));
  fs.writeFileSync(path.join(here,`${name}_starter_1024.cells.json`),JSON.stringify(manifest(name,s),null,2)+'\n');
}
fs.writeFileSync(path.join(here,'starter_village_building_aliases.json'),JSON.stringify({schemaVersion:1,authority:'presentation-only',presentation:'top-down-open-roof',canonicalTypes:Object.keys(families),aliases},null,2)+'\n');
console.log(`Generated ${Object.keys(families).length} canonical top-down/open-roof starter-village building atlases.`);
