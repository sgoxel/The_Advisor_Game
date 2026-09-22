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

function frameFromModel(model){
  if(!model)return null;
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
    protagonistWorld:freezePoint(model.protagonistWorld),
    buildingCount:Array.isArray(model.buildingInteriors)?model.buildingInteriors.length:0,
    interiorObjectCount:Array.isArray(model.interiorObjects)?model.interiorObjects.length:0
  });
}

window.RendererContract=Object.freeze({
  version:CONTRACT_VERSION,
  simulationSnapshot,
  sameSimulation,
  frameFromModel
});
})();