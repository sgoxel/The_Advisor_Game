#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgbaPng } from '../../../tools/split_tile_atlas.mjs';

const SIZE=1024, CELL=256, GRID=4;
const here=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(here,{recursive:true});

const families={
  home:{family:'home',wall:'#8a6748',shade:'#6f513a',roof:'#7a463b',roof2:'#5f342e',accent:'#e0bb7c',cue:'chimney'},
  inn:{family:'lodging',wall:'#927451',shade:'#73583d',roof:'#783846',roof2:'#5b2935',accent:'#f0c96f',cue:'sign'},
  village_hall:{family:'landmark',wall:'#817464',shade:'#62594e',roof:'#526171',roof2:'#3c4651',accent:'#e1d7b4',cue:'banner'},
  bakery:{family:'food-shop',wall:'#9a7148',shade:'#795637',roof:'#78493a',roof2:'#5c352c',accent:'#f1c27d',cue:'awning'},
  market:{family:'food-shop',wall:'#8c7653',shade:'#6e5d41',roof:'#5f7550',roof2:'#47583c',accent:'#e0c77b',cue:'awning'},
  smithy:{family:'production',wall:'#6c6460',shade:'#504b49',roof:'#454349',roof2:'#302f33',accent:'#df8752',cue:'forge'},
  workshop:{family:'production',wall:'#7a644e',shade:'#5e4b3b',roof:'#544c40',roof2:'#3e3830',accent:'#c9a86a',cue:'awning'},
  guard_post:{family:'service',wall:'#6e7074',shade:'#53565a',roof:'#4b5966',roof2:'#37414a',accent:'#d2dae0',cue:'banner'},
  mill:{family:'agricultural',wall:'#8a795b',shade:'#6b5d46',roof:'#5b684f',roof2:'#43503b',accent:'#dac991',cue:'mill'},
  farmstead:{family:'agricultural',wall:'#8c724d',shade:'#6e583a',roof:'#6b5c3e',roof2:'#50452f',accent:'#d7c66e',cue:'farm'},
  storage:{family:'storage',wall:'#82684d',shade:'#614d39',roof:'#5b493b',roof2:'#42352c',accent:'#cdb07e',cue:'crate'},
  well:{family:'service',wall:'#6c7379',shade:'#50565b',roof:'#4b535b',roof2:'#373d43',accent:'#b9d0d8',cue:'well'}
};
const aliases={dwelling:'home',house:'home',tavern:'inn',lodging:'inn',hall:'village_hall',civic:'village_hall',shop:'market',food:'bakery',production:'workshop',guard:'guard_post',service:'guard_post',farm:'farmstead',agricultural:'farmstead',storehouse:'storage',barn:'storage'};
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
function texture(buf,x,y,w,h,base,salt){const dark=shade(base,-18),light=shade(base,12);for(let yy=y+8;yy<y+h-8;yy+=16){for(let xx=x+8;xx<x+w-8;xx+=16){const k=((xx*17+yy*31+salt*43)>>>0)%7;if(k===0)rect(buf,xx,yy,8,3,dark);else if(k===1)rect(buf,xx,yy,6,2,light);}}}
function roofPiece(buf,ox,oy,type,s){const roof=rgb(type==='roof_ridge'?s.roof2:s.roof),edge=shade(s.roof2,-18),light=shade(s.roof,18);if(type==='roof_edge_n'){poly(buf,[[ox+8,oy+222],[ox+32,oy+70],[ox+224,oy+70],[ox+248,oy+222]],roof);line(buf,ox+32,oy+70,ox+224,oy+70,light,5);}
else if(type==='roof_ridge'){poly(buf,[[ox+18,oy+220],[ox+128,oy+42],[ox+238,oy+220]],roof);line(buf,ox+128,oy+42,ox+128,oy+220,light,5);}
else {const left=type.endsWith('nw');const pts=left?[[ox+8,oy+222],[ox+38,oy+76],[ox+246,oy+76],[ox+246,oy+222]]:[[ox+10,oy+76],[ox+218,oy+76],[ox+248,oy+222],[ox+10,oy+222]];poly(buf,pts,roof);line(buf,left?ox+38:ox+10,oy+76,left?ox+246:ox+218,oy+76,light,5);}rect(buf,ox+10,oy+218,236,10,edge);}
function wallPiece(buf,ox,oy,type,s){const wall=rgb(type==='wall_edge_e'?s.shade:s.wall),border=shade(s.shade,-24);frame(buf,ox+8,oy+26,240,216,wall,border);texture(buf,ox+8,oy+26,240,216,s.wall,type.length);if(type==='wall_window'){rect(buf,ox+76,oy+76,104,92,shade(s.accent,-20));rect(buf,ox+84,oy+84,88,76,[48,66,72]);line(buf,ox+128,oy+84,ox+128,oy+160,rgb(s.accent),5);line(buf,ox+84,oy+122,ox+172,oy+122,rgb(s.accent),5);}if(type==='wall_edge_w')rect(buf,ox+8,oy+26,18,216,shade(s.shade,-32));if(type==='wall_edge_e')rect(buf,ox+230,oy+26,18,216,shade(s.shade,-32));}
function basePiece(buf,ox,oy,type,s){const base=rgb(s.wall),border=shade(s.shade,-28);frame(buf,ox+8,oy+16,240,224,base,border);texture(buf,ox+8,oy+16,240,224,s.wall,17+type.length);rect(buf,ox+8,oy+206,240,34,shade(s.shade,-12));if(type==='entrance'){rect(buf,ox+78,oy+58,100,182,shade(s.roof2,-10));rect(buf,ox+88,oy+70,80,170,shade(s.wall,-28));rect(buf,ox+150,oy+150,9,9,rgb(s.accent));rect(buf,ox+68,oy+42,120,18,rgb(s.accent));}}
function feature(buf,ox,oy,s){const accent=rgb(s.accent),dark=shade(s.shade,-34),roof=rgb(s.roof);if(s.cue==='chimney'){rect(buf,ox+94,oy+56,68,150,shade(s.wall,-18));rect(buf,ox+82,oy+48,92,22,dark);rect(buf,ox+105,oy+88,46,12,accent);}else if(s.cue==='sign'){rect(buf,ox+120,oy+42,12,190,dark);rect(buf,ox+52,oy+54,150,88,accent);rect(buf,ox+62,oy+64,130,68,roof);}else if(s.cue==='banner'){rect(buf,ox+66,oy+28,12,204,dark);poly(buf,[[ox+78,oy+42],[ox+208,oy+72],[ox+78,oy+126]],accent);}else if(s.cue==='awning'){poly(buf,[[ox+36,oy+74],[ox+220,oy+74],[ox+196,oy+150],[ox+60,oy+150]],accent);for(let x=60;x<196;x+=32)rect(buf,ox+x,oy+80,14,64,roof);}else if(s.cue==='forge'){rect(buf,ox+54,oy+84,148,124,dark);poly(buf,[[ox+76,oy+198],[ox+128,oy+94],[ox+180,oy+198]],shade(s.accent,18));rect(buf,ox+110,oy+44,36,54,shade(s.wall,-25));}else if(s.cue==='mill'){rect(buf,ox+118,oy+86,20,120,dark);for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;line(buf,ox+128,oy+118,Math.round(ox+128+Math.cos(a)*92),Math.round(oy+118+Math.sin(a)*92),accent,10);}rect(buf,ox+114,oy+104,28,28,roof);}else if(s.cue==='farm'){for(let y=82;y<=182;y+=34)line(buf,ox+38,y+oy,ox+218,y+oy,accent,8);for(let x=66;x<=194;x+=64)line(buf,ox+x,oy+58,ox+x,oy+210,dark,7);}else if(s.cue==='crate'){for(const [x,y] of [[54,86],[126,86],[90,154]]){frame(buf,ox+x,oy+y,76,72,rgb(s.wall),dark);line(buf,ox+x+8,oy+y+8,ox+x+68,oy+y+64,accent,5);line(buf,ox+x+68,oy+y+8,ox+x+8,oy+y+64,accent,5);}}else if(s.cue==='well'){rect(buf,ox+72,oy+132,112,76,shade(s.wall,-8));poly(buf,[[ox+54,oy+132],[ox+128,oy+68],[ox+202,oy+132]],roof);rect(buf,ox+82,oy+44,10,170,dark);rect(buf,ox+164,oy+44,10,170,dark);line(buf,ox+87,oy+56,ox+169,oy+56,accent,8);rect(buf,ox+100,oy+160,56,32,[38,57,63]);}}
function paintFamily(name,s){const buf=Buffer.alloc(SIZE*SIZE*4,0);for(const cell of cells){const [ox,oy]=cellOrigin(cell);if(cell.type.startsWith('roof'))roofPiece(buf,ox,oy,cell.type,s);else if(cell.type.startsWith('wall'))wallPiece(buf,ox,oy,cell.type,s);else if(cell.type==='family_feature')feature(buf,ox,oy,s);else basePiece(buf,ox,oy,cell.type,s);}return buf;}
function manifest(name,s){return {schemaVersion:1,family:name,visualFamily:s.family,atlas:{width:SIZE,height:SIZE,columns:GRID,rows:GRID,cellSize:CELL},authority:'presentation-only',source:'Original deterministic starter-village building tile art generated for #348.',composition:{logicalCellOwnership:'building-only',entranceSemantic:'entrance',repeatable:['roof_edge_n','wall_center'],overhang:'none; pixels never redefine collision/footprint/occupancy'},cells,unusedCells};}

for(const [name,s] of Object.entries(families)){
  const buf=paintFamily(name,s);
  fs.writeFileSync(path.join(here,`${name}_starter_1024.png`),encodeRgbaPng(SIZE,SIZE,buf));
  fs.writeFileSync(path.join(here,`${name}_starter_1024.cells.json`),JSON.stringify(manifest(name,s),null,2)+'\n');
}
fs.writeFileSync(path.join(here,'starter_village_building_aliases.json'),JSON.stringify({schemaVersion:1,authority:'presentation-only',canonicalTypes:Object.keys(families),aliases},null,2)+'\n');
console.log(`Generated ${Object.keys(families).length} canonical 4x4 starter-village building atlases.`);
