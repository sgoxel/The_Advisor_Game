(function(){
"use strict";

const INTEGER=/^-?\d+$/;

function normalize(value){
  const text=String(value==null?"":value).trim();
  if(!INTEGER.test(text))throw new Error("World coordinate must be a signed integer.");
  return BigInt(text).toString();
}

function position(x,y){
  return Object.freeze({x:normalize(x),y:normalize(y)});
}

function origin(){
  return position("0","0");
}

function add(pos,dx,dy){
  const current=position(pos.x,pos.y);
  return position(
    (BigInt(current.x)+BigInt(normalize(dx))).toString(),
    (BigInt(current.y)+BigInt(normalize(dy))).toString()
  );
}

function key(pos){
  const current=position(pos.x,pos.y);
  return current.x+","+current.y;
}

function isOrigin(pos){
  const current=position(pos.x,pos.y);
  return current.x==="0"&&current.y==="0";
}

function verifyUnbounded(){
  const huge="1"+"0".repeat(120);
  const positive=position(huge,huge);
  const negative=position("-"+huge,"-"+huge);
  return Object.freeze({
    positive,
    negative,
    positiveValid:positive.x===huge&&positive.y===huge,
    negativeValid:negative.x==="-"+huge&&negative.y==="-"+huge
  });
}

window.WorldCoordinates=Object.freeze({
  normalize,position,origin,add,key,isOrigin,verifyUnbounded
});
})();
