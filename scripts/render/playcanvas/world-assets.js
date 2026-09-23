(function(){
"use strict";

/* Pure requirement catalog: Simulation/world code supplies semantic content;
   renderer preparation translates it to stable logical asset keys. File URLs
   and PlayCanvas asset IDs never escape this module. */
const WORLD_KEYS=Object.freeze({
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
  const keys=[WORLD_KEYS.terrainGrass];
  const tiles=Array.isArray(frame?.tiles)?frame.tiles:[];
  const buildings=Array.isArray(frame?.buildings)?frame.buildings:[];
  const interiors=Array.isArray(frame?.buildingInteriors)?frame.buildingInteriors:[];
  const props=Array.isArray(frame?.props)?frame.props:[];

  for(const tile of tiles){
    const type=String(tile?.type||tile?.terrain||"").toLowerCase();
    if(type.includes("road")||type.includes("path"))keys.push(WORLD_KEYS.roadEarth);
    if(type.includes("water")||type.includes("river"))keys.push(WORLD_KEYS.water);
    if(type.includes("bridge"))keys.push(WORLD_KEYS.bridge);
  }
  if(buildings.length)keys.push(WORLD_KEYS.house);
  if(interiors.length)keys.push(WORLD_KEYS.interior);
  for(const prop of props){
    const type=String(prop?.type||prop?.kind||"").toLowerCase();
    if(type.includes("tree"))keys.push(WORLD_KEYS.tree);
    else if(type.includes("stone")||type.includes("rock"))keys.push(WORLD_KEYS.stone);
    else if(type.includes("marker")||type.includes("sign"))keys.push(WORLD_KEYS.marker);
    else if(type.includes("bridge"))keys.push(WORLD_KEYS.bridge);
  }
  return Object.freeze({regionKey:regionKey(frame),keys:unique(keys)});
}

function registerProceduralBaseline(manager){
  if(!manager?.register)return false;
  /* These keys describe resources already created by the PlayCanvas scene
     bootstrap. Null URLs deliberately perform no network/decode work. GLB and
     texture-backed replacements can later reuse the same logical keys. */
  for(const key of Object.values(WORLD_KEYS))manager.register(key,{type:"container",url:null,character:false,options:{procedural:true}});
  return true;
}

window.PlayCanvasWorldAssets=Object.freeze({WORLD_KEYS,requirements,registerProceduralBaseline});
})();
