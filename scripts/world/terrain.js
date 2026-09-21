(function(){
"use strict";

function getType(seedValue,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const local=StartingVillage.local(seedValue,x,y);

  // Planning order is authoritative. Terrain is intentionally calculated last.
  const infrastructure=StartingVillage.infrastructureAt(seedValue,local);
  const building=StartingVillage.buildingAt(seedValue,local);
  const importantObject=StartingVillage.importantObjectAt(seedValue,local);
  const baseTerrain=GeographyFoundation.getTerrainType(seedValue,x,y);

  if(infrastructure){
    return StartingVillage.resolveInfrastructure(seedValue,local,infrastructure,baseTerrain);
  }
  if(building)return building.type;
  if(importantObject)return importantObject.type;
  return StartingVillage.resolveTerrain(seedValue,local,baseTerrain);
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
