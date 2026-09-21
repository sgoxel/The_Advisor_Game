(function(){
"use strict";

function getType(seedValue,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const local=StartingVillage.local(seedValue,x,y);

  // Planning order is authoritative. Terrain is intentionally calculated last.
  const infrastructure=StartingVillage.infrastructureAt(seedValue,local);
  const building=HousePlans.buildingAt(seedValue,local);
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
  const local=StartingVillage.local(seedValue,x,y);
  const building=HousePlans.buildingAt(seedValue,local);
  const cell=building?building.cell:null;
  const textureVariant=cell?cell.textureVariant:null;
  const overlayVariant=cell?cell.overlayVariant:null;
  return Object.freeze({
    x,y,type,
    label:palette.label,
    color:palette.color,
    texture:TileTextures.asset(type,textureVariant),
    overlayTexture:overlayVariant?TileTextures.asset(type,overlayVariant):null,
    buildingId:cell?cell.plan.id:null,
    room:cell?cell.room:null
  });
}

window.TerrainFoundation=Object.freeze({getType,getTile});
})();
