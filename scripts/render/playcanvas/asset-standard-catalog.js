(function(){
"use strict";

const MODEL_URL="assets/models/wp-s003-005-002/representative_asset_set.gltf";
const WORLD_TILE_METERS=2;

const MATERIAL_FAMILIES=Object.freeze({
  wall:"mat.wall.plaster.warm",
  roof:"mat.roof.clay.dark",
  wood:"mat.wood.oak",
  leaf:"mat.leaf.green",
  terrain:"mat.terrain.grass",
  stone:"mat.stone.gray"
});

const TEXTURE_TIERS=Object.freeze({
  low:Object.freeze({maxBaseColor:256,maxNormal:256,maxAuxiliary:128}),
  standard:Object.freeze({maxBaseColor:512,maxNormal:512,maxAuxiliary:256}),
  high:Object.freeze({maxBaseColor:1024,maxNormal:1024,maxAuxiliary:512}),
  ultra:Object.freeze({maxBaseColor:2048,maxNormal:2048,maxAuxiliary:1024})
});

const ASSETS=Object.freeze({
  "terrain.patch.prototype":Object.freeze({
    logicalKey:"terrain.patch.prototype",
    url:MODEL_URL,
    nodePrefix:"asset.terrain.",
    category:"terrain-support",
    static:true,
    instancingEligible:false,
    lod:Object.freeze({mode:"none"}),
    boundsMeters:Object.freeze({x:8,y:.5,z:8}),
    pivot:"ground-center",
    collisionAuthority:"Simulation",
    presentationOnly:true
  }),
  "building.house.prototype":Object.freeze({
    logicalKey:"building.house.prototype",
    url:MODEL_URL,
    nodePrefix:"asset.building.house.",
    category:"building",
    static:true,
    instancingEligible:false,
    lod:Object.freeze({mode:"none"}),
    boundsMeters:Object.freeze({x:6.6,y:4.7,z:5.6}),
    footprintMeters:Object.freeze({x:6,z:5}),
    pivot:"footprint-center-ground",
    collisionAuthority:"Simulation",
    presentationOnly:true
  }),
  "interior.workbench.prototype":Object.freeze({
    logicalKey:"interior.workbench.prototype",
    url:MODEL_URL,
    nodePrefix:"asset.interior.workbench.",
    category:"interior-prop",
    static:true,
    instancingEligible:true,
    lod:Object.freeze({mode:"none"}),
    boundsMeters:Object.freeze({x:2.4,y:.94,z:.9}),
    pivot:"ground-center",
    collisionAuthority:"Simulation",
    presentationOnly:true
  }),
  "environment.tree.prototype":Object.freeze({
    logicalKey:"environment.tree.prototype",
    url:MODEL_URL,
    nodePrefix:"asset.environment.tree.",
    category:"environment-prop",
    static:true,
    instancingEligible:true,
    lod:Object.freeze({mode:"none",reason:"prototype-under-mobile-budget"}),
    boundsMeters:Object.freeze({x:3.2,y:4.5,z:3.2}),
    pivot:"ground-center",
    collisionAuthority:"Simulation",
    presentationOnly:true
  })
});

function entries(){return Object.values(ASSETS)}
function get(key){return ASSETS[String(key)]||null}
function proof(){
  const list=entries();
  return Object.freeze({
    version:"1.0.0",
    runtimeFormat:"glTF 2.0",
    worldTileMeters:WORLD_TILE_METERS,
    coordinateSystem:Object.freeze({up:"+Y",worldX:"+X",worldY:"+Z"}),
    materials:MATERIAL_FAMILIES,
    textureTiers:TEXTURE_TIERS,
    assetCount:list.length,
    deterministicLogicalKeys:list.every(item=>item.logicalKey&&item.url&&item.nodePrefix),
    rendererOnly:list.every(item=>item.presentationOnly&&item.collisionAuthority==="Simulation"),
    instancingEligible:list.filter(item=>item.instancingEligible).map(item=>item.logicalKey),
    boundsDefined:list.every(item=>item.boundsMeters?.x>0&&item.boundsMeters?.y>0&&item.boundsMeters?.z>0)
  });
}

window.PlayCanvasAssetStandard=Object.freeze({
  version:"1.0.0",
  modelUrl:MODEL_URL,
  worldTileMeters:WORLD_TILE_METERS,
  materialFamilies:MATERIAL_FAMILIES,
  textureTiers:TEXTURE_TIERS,
  assets:ASSETS,
  entries,
  get,
  proof
});
})();