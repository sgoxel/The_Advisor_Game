(function(){
"use strict";

const TILE_CACHE_LIMIT=32768;
const tileCache=new Map();
function tileCacheKey(seed,x,y){return String(seed||"")+"|"+String(x)+"|"+String(y)}
function rememberTile(key,tile){
  tileCache.set(key,tile);
  if(tileCache.size>TILE_CACHE_LIMIT){
    const oldest=tileCache.keys().next().value;
    if(oldest!==undefined)tileCache.delete(oldest);
  }
  return tile;
}

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
  const cacheKey=tileCacheKey(seedValue,x,y);
  const cached=tileCache.get(cacheKey);
  if(cached){
    tileCache.delete(cacheKey);
    tileCache.set(cacheKey,cached);
    return cached;
  }

  // Resolve the authoritative planning stack once. The previous implementation
  // called getType() and then repeated the building/local lookups for metadata.
  const local=StartingVillage.local(seedValue,x,y);
  const infrastructure=StartingVillage.infrastructureAt(seedValue,local);
  const houseBuilding=HousePlans.buildingAt(seedValue,local);
  const specialBuilding=SpecialLots.buildingAt(seedValue,local);
  const importantObject=StartingVillage.importantObjectAt(seedValue,local);
  const baseTerrain=GeographyFoundation.getTerrainType(seedValue,x,y);
  let type;
  if(infrastructure)type=StartingVillage.resolveInfrastructure(seedValue,local,infrastructure,baseTerrain);
  else if(houseBuilding)type=houseBuilding.type;
  else if(specialBuilding)type=specialBuilding.type;
  else if(importantObject)type=importantObject.type;
  else type=StartingVillage.resolveTerrain(seedValue,local,baseTerrain);

  const palette=TerrainPalette.get(type);
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
  return rememberTile(cacheKey,Object.freeze({
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
  }));
}

function cacheStats(){return Object.freeze({entries:tileCache.size,limit:TILE_CACHE_LIMIT});}
function clearCache(){tileCache.clear();}

window.TerrainFoundation=Object.freeze({getType,getTile,cacheStats,clearCache});
})();
