(function(){
"use strict";

const BLOCK_SIZE=8n;

function toBigInt(value){
  return BigInt(WorldCoordinates.normalize(value));
}

function floorDiv(value,divisor){
  let q=value/divisor;
  const r=value%divisor;
  if(r!==0n&&value<0n)q-=1n;
  return q;
}

function positiveMod(value,divisor){
  const r=value%divisor;
  return r<0n?r+divisor:r;
}

function unit(seed,key){
  return PRNG.foundationUint32(seed,key)/4294967296;
}

function baseType(seed,x,y){
  const bx=floorDiv(x,BLOCK_SIZE);
  const by=floorDiv(y,BLOCK_SIZE);
  const macro=unit(seed,"terrain:macro:"+bx+":"+by);
  const local=unit(seed,"terrain:tile:"+x+":"+y);

  if(macro<0.12)return "water";
  if(macro<0.28)return local<0.72?"forest":"grass";
  if(macro<0.62)return local<0.78?"grass":"farmland";
  if(macro<0.74)return local<0.70?"dirt":"grass";
  if(macro<0.82)return local<0.76?"mud":"dirt";
  if(macro<0.91)return local<0.74?"rock":"dirt";
  return local<0.70?"sand":"grass";
}

function roadOrBuilding(seed,x,y,base){
  if(base==="water")return base;

  const bx=floorDiv(x,BLOCK_SIZE);
  const by=floorDiv(y,BLOCK_SIZE);
  const lx=positiveMod(x,BLOCK_SIZE);
  const ly=positiveMod(y,BLOCK_SIZE);

  const settled=unit(seed,"settlement-preview:"+bx+":"+by)<0.26;
  if(!settled)return base;

  const roadX=BigInt(PRNG.foundationUint32(seed,"road-x:"+bx+":"+by)%8);
  const roadY=BigInt(PRNG.foundationUint32(seed,"road-y:"+bx+":"+by)%8);
  const onRoad=lx===roadX||ly===roadY;

  if(onRoad)return "road";

  const nearRoad=
    (lx>0n&&lx-1n===roadX)||(lx<7n&&lx+1n===roadX)||
    (ly>0n&&ly-1n===roadY)||(ly<7n&&ly+1n===roadY);

  if(nearRoad&&unit(seed,"building-preview:"+x+":"+y)<0.28)return "building";
  return base;
}

function getType(seedValue,xValue,yValue){
  const x=toBigInt(xValue);
  const y=toBigInt(yValue);

  // Keep the starting origin readable until the full WP-004 geography generator replaces this preview.
  if(x===0n&&y===0n)return "grass";

  const base=baseType(seedValue,x,y);
  return roadOrBuilding(seedValue,x,y,base);
}

function getTile(seedValue,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const type=getType(seedValue,x,y);
  const palette=TerrainPalette.get(type);
  return Object.freeze({x,y,type,label:palette.label,color:palette.color});
}

window.TerrainFoundation=Object.freeze({getType,getTile});
})();
