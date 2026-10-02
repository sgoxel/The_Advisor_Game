(function(){
"use strict";

const VERSION="1.1.0";
const REPRESENTATIVE_GLTF="assets/models/wp-s003-005-002/representative_asset_set.gltf";
const WORLD_KEYS=Object.freeze({
  prototypeSet:"world.prototype.representative-set",
  terrainGrass:"world.terrain.grass",
  roadEarth:"world.terrain.road-earth",
  water:"world.terrain.water",
  bridge:"world.prop.bridge",
  house:"world.building.house",
  tree:"world.prop.tree",
  stone:"world.prop.stone",
  marker:"world.prop.marker",
  interior:"world.interior.basic"
});

function unique(values){return Object.freeze([...new Set(values.filter(Boolean).map(String))].sort());}
function regionKey(frame){return String(frame?.regionKey||"region:unknown");}

function requirements(frame){
  const keys=[WORLD_KEYS.terrainGrass,WORLD_KEYS.prototypeSet];
  const tiles=Array.isArray(frame?.tiles)?frame.tiles:[];
  const buildings=Array.isArray(frame?.buildings)?frame.buildings:[];
  const interiors=Array.isArray(frame?.buildingInteriors)?frame.buildingInteriors:[];
  const props=Array.isArray(frame?.props)?frame.props:[];

  for(const tile of tiles){
    const type=String(tile?.type||tile?.terrain||"").toLowerCase();
    if(type.includes("road")||type.includes("path"))keys.push(WORLD_KEYS.roadEarth);
    if(type.includes("water")||type.includes("river"))keys.push(WORLD_KEYS.water);
    if(type.includes("bridge"))keys.push(WORLD_KEYS.bridge);
    if(type.includes("forest")||type.includes("tree"))keys.push(WORLD_KEYS.tree);
    if(tile?.buildingId)keys.push(WORLD_KEYS.house);
    if(tile?.room||tile?.specialKind)keys.push(WORLD_KEYS.interior);
  }
  if(buildings.length)keys.push(WORLD_KEYS.house);
  if(interiors.length)keys.push(WORLD_KEYS.interior);
  for(const prop of props){
    const type=String(prop?.type||prop?.kind||"").toLowerCase();
    if(type.includes("tree")||type.includes("forest"))keys.push(WORLD_KEYS.tree);
    else if(type.includes("stone")||type.includes("rock"))keys.push(WORLD_KEYS.stone);
    else if(type.includes("marker")||type.includes("sign"))keys.push(WORLD_KEYS.marker);
    else if(type.includes("bridge"))keys.push(WORLD_KEYS.bridge);
  }
  if(buildings.length||interiors.length||props.length||keys.some(key=>[
    WORLD_KEYS.roadEarth,WORLD_KEYS.water,WORLD_KEYS.bridge,WORLD_KEYS.tree
  ].includes(key)))keys.push(WORLD_KEYS.prototypeSet);
  return Object.freeze({regionKey:regionKey(frame),keys:unique(keys)});
}

function registerBaseline(manager){
  if(!manager?.register)return false;
  manager.register(WORLD_KEYS.prototypeSet,{type:"container",url:REPRESENTATIVE_GLTF,character:false,options:{}});
  manager.register(WORLD_KEYS.terrainGrass,{type:"material",url:null,character:false,options:{family:"terrain"}});
  manager.register(WORLD_KEYS.roadEarth,{type:"material",url:null,character:false,options:{family:"terrain"}});
  manager.register(WORLD_KEYS.water,{type:"material",url:null,character:false,options:{family:"terrain"}});
  manager.register(WORLD_KEYS.bridge,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  manager.register(WORLD_KEYS.house,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  manager.register(WORLD_KEYS.tree,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  manager.register(WORLD_KEYS.stone,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  manager.register(WORLD_KEYS.marker,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  manager.register(WORLD_KEYS.interior,{type:"container",url:null,character:false,options:{prototype:WORLD_KEYS.prototypeSet}});
  return true;
}

async function prepareFrame(manager,frame,{retainRegionKeys=[]}={}){
  if(!manager?.prepareRegion)throw new Error("PlayCanvas world asset preparation manager is unavailable");
  const required=requirements(frame);
  const result=await manager.prepareRegion(required.regionKey,required.keys,{retainRegionKeys});
  return Object.freeze({
    ready:Boolean(result?.ready&&!result?.stale&&manager.isReady?.(required.regionKey)),
    stale:Boolean(result?.stale),
    regionKey:required.regionKey,
    keys:required.keys,
    keyCount:required.keys.length,
    preparation:result||null
  });
}

window.PlayCanvasWorldAssets=Object.freeze({
  VERSION,REPRESENTATIVE_GLTF,WORLD_KEYS,requirements,registerBaseline,
  registerProceduralBaseline:registerBaseline,
  prepareFrame
});
})();
