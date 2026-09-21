(function(){
"use strict";

let center=WorldCoordinates.origin();

function getCenter(){
  return WorldCoordinates.position(center.x,center.y);
}

function setCenter(x,y){
  center=WorldCoordinates.position(x,y);
  return getCenter();
}

function pan(dx,dy){
  center=WorldCoordinates.add(center,dx,dy);
  return getCenter();
}

function centerOn(position){
  if(!position)return getCenter();
  return setCenter(position.x,position.y);
}

function reset(){
  center=WorldCoordinates.origin();
  return getCenter();
}

function offsetFrom(position){
  if(!position)return null;
  return Object.freeze({
    x:(BigInt(WorldCoordinates.normalize(position.x))-BigInt(center.x)).toString(),
    y:(BigInt(WorldCoordinates.normalize(position.y))-BigInt(center.y)).toString()
  });
}

window.Camera=Object.freeze({getCenter,setCenter,pan,centerOn,reset,offsetFrom});
})();
