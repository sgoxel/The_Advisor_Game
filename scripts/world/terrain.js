(function(){
"use strict";

function getType(seedValue,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const local=StartingVillage.local(seedValue,x,y);

  // Planning order is authoritative. Terrain is intentionally calculated last.
  const infrastructure=StartingVillage.infrastructureAt(seedValue,local);
  const houseBuilding=HousePlans.buildingAt(seedValue,local);
  const specialBuilding=SpecialLots.buildingAt(seedValue,local);
  const importantObject=StartingVillage.importantObjectAt(seedValue,local);
  const baseTerrain=GeographyFoundation.getTerrainType(seedValue,x,y);

  if(infrastructure){
    return StartingVillage.resolveInfrastructure(seedValue,local,infrastructure,baseTerrain);
  }
  if(houseBuilding)return houseBuilding.type;
  if(specialBuilding)return specialBuilding.type;
  if(importantObject)return importantObject.type;
  return StartingVillage.resolveTerrain(seedValue,local,baseTerrain);
}

function getTile(seedValue,xValue,yValue){
  const x=WorldCoordinates.normalize(xValue);
  const y=WorldCoordinates.normalize(yValue);
  const type=getType(seedValue,x,y);
  const palette=TerrainPalette.get(type);
  const local=StartingVillage.local(seedValue,x,y);
  const houseBuilding=HousePlans.buildingAt(seedValue,local);
  const specialBuilding=SpecialLots.buildingAt(seedValue,local);
  const building=houseBuilding||specialBuilding;
  const cell=building?building.cell:null;
  const textureVariant=cell?cell.textureVariant:null;
  const overlayVariant=cell?cell.overlayVariant:null;
  const presentationColor=cell?.presentationColor||(
    (type==="wall"||type==="door")
      ?TerrainPalette.get("floor").color
      :palette.color
  );
  const buildingId=cell?(cell.plan?.id||cell.lot?.id||null):null;
  const specialKind=cell?.lot?.kind||null;
  const specialLabel=cell?.lot?.label||null;
  return Object.freeze({
    x,y,type,
    label:specialLabel||palette.label,
    color:presentationColor,
    texture:TileTextures.asset(type,textureVariant),
    textureKey:TileTextures.assetKey(type,textureVariant),
    overlayTexture:overlayVariant?TileTextures.asset(type,overlayVariant):null,
    overlayTextureKey:overlayVariant?TileTextures.assetKey(type,overlayVariant):null,
    buildingId,
    room:cell?cell.room:null,
    specialKind,
    specialLabel
  });
}

window.TerrainFoundation=Object.freeze({getType,getTile});
})();
