(function(){
"use strict";

const MIN_ZOOM=0.5;
const MAX_ZOOM=2.0;
const DEFAULT_ZOOM=1.0;
const ZOOM_STEP=0.1;

let center=WorldCoordinates.origin();
let zoom=DEFAULT_ZOOM;

function clampZoom(value){
  const number=Number(value);
  if(!Number.isFinite(number))return zoom;
  return Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,number));
}

function roundZoom(value){
  return Math.round(value*1000)/1000;
}

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

function getZoom(){
  return zoom;
}

function setZoom(value){
  zoom=roundZoom(clampZoom(value));
  return zoom;
}

function zoomBy(delta){
  return setZoom(zoom+Number(delta||0));
}

function zoomIn(){
  return zoomBy(ZOOM_STEP);
}

function zoomOut(){
  return zoomBy(-ZOOM_STEP);
}

function reset(){
  center=WorldCoordinates.origin();
  zoom=DEFAULT_ZOOM;
  return Object.freeze({center:getCenter(),zoom});
}

function offsetFrom(position){
  if(!position)return null;
  return Object.freeze({
    x:(BigInt(WorldCoordinates.normalize(position.x))-BigInt(center.x)).toString(),
    y:(BigInt(WorldCoordinates.normalize(position.y))-BigInt(center.y)).toString()
  });
}

window.Camera=Object.freeze({
  MIN_ZOOM,MAX_ZOOM,DEFAULT_ZOOM,ZOOM_STEP,
  getCenter,setCenter,pan,centerOn,
  getZoom,setZoom,zoomBy,zoomIn,zoomOut,
  reset,offsetFrom
});
})();
