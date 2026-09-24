(function(){
"use strict";

const CONTRACT_VERSION="1.0.0";

function stringCoordinate(value){
  if(value===null||value===undefined)return null;
  try{return WorldCoordinates.normalize(value)}
  catch(_){return String(value)}
}

function freezePoint(point){
  if(!point)return null;
  return Object.freeze({
    x:stringCoordinate(point.x),
    y:stringCoordinate(point.y),
    level:Number(point.level??0)
  });
}

function simulationSnapshot(){
  const campaign=window.SeedSystem?.getCampaign?.()||null;
  const protagonist=window.Protagonist?.getPosition?.()||null;
  const center=campaign&&window.Camera?.getCenter?Camera.getCenter():null;
  return Object.freeze({
    campaignActive:Boolean(campaign),
    campaignSeed:campaign?.seed??null,
    protagonist:freezePoint(protagonist),
    cameraCenter:freezePoint(center),
    cameraZoom:Number(window.Camera?.getZoom?.()??1)
  });
}

function sameSimulation(a,b){
  if(!a||!b)return false;
  return JSON.stringify(a)===JSON.stringify(b);
}

function localTerrainFrame(model){
  const columns=Math.max(0,Number(model?.columns||0));
  const rows=Math.max(0,Number(model?.rows||0));
  const tiles=Array.isArray(model?.tiles)?model.tiles:[];
  const center=freezePoint(model?.center);
  const ready=Boolean(columns>0&&rows>0&&center&&tiles.length===columns*rows);
  const cells=ready?tiles.map((tile,index)=>Object.freeze({
    row:Number(tile?.row??Math.floor(index/columns)),
    col:Number(tile?.col??(index%columns)),
    x:stringCoordinate(tile?.x),
    y:stringCoordinate(tile?.y),
    type:String(tile?.type||"grass")
  })):Object.freeze([]);
  return Object.freeze({
    ready,
    source:"renderer-frame",
    generatedForMiniMap:false,
    columns,
    rows,
    tileCount:cells.length,
    center,
    regionKey:model?.regionKey??null,
    projection:"soft-dimetric",
    projectionBasis:Object.freeze({x:.66,y:.28}),
    cells:Object.freeze(cells),
    simulationAuthorityPreserved:true
  });
}

function frameFromModel(model){
  if(!model)return null;
  const visibleCharacters=Array.isArray(model.visibleCharacters)
    ?model.visibleCharacters.map(character=>Object.freeze({
      id:String(character?.id||""),
      role:String(character?.role||"resident"),
      textureUrl:character?.textureUrl?String(character.textureUrl):null,
      assetUrl:character?.assetUrl?String(character.assetUrl):null,
      frameUrls:Array.isArray(character?.frameUrls)?character.frameUrls.map(url=>String(url)) : null,
      frameIndex:Number(character?.frameIndex||0),
      point:freezePoint(character?.point),
      height:Number(character?.height||0),
      elevation:Number(character?.elevation||0),
      flipX:Boolean(character?.flipX),
      residentId:character?.residentId?String(character.residentId):null,
      residentName:character?.residentName?String(character.residentName):null,
      profession:character?.profession?String(character.profession):null,
      activity:character?.activity?String(character.activity):null,
      activityLabel:character?.activityLabel?String(character.activityLabel):null,
      buildingId:character?.buildingId?String(character.buildingId):null
    }))
    :Object.freeze([]);
  return Object.freeze({
    width:Number(model.width||0),
    height:Number(model.height||0),
    columns:Number(model.columns||0),
    rows:Number(model.rows||0),
    tileSize:Number(model.tileSize||0),
    center:freezePoint(model.center),
    seed:model.seed??null,
    regionKey:model.regionKey??null,
    tileCount:Array.isArray(model.tiles)?model.tiles.length:0,
    localTerrain:localTerrainFrame(model),
    protagonistWorld:freezePoint(model.protagonistWorld),
    buildingCount:Array.isArray(model.buildingInteriors)?model.buildingInteriors.length:0,
    interiorObjectCount:Array.isArray(model.interiorObjects)?model.interiorObjects.length:0,
    visibleCharacters,
    visibleCharacterCount:Array.isArray(model.visibleCharacters)?model.visibleCharacters.length:0,
    simulatedCharacterCount:Number(model.simulatedCharacterCount||0)
  });
}

window.RendererContract=Object.freeze({
  version:CONTRACT_VERSION,
  simulationSnapshot,
  sameSimulation,
  frameFromModel
});
})();