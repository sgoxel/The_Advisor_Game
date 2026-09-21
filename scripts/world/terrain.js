(function(){
"use strict";

function getType(seedValue,xValue,yValue){
  return GeographyFoundation.getTerrainType(seedValue,xValue,yValue);
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
