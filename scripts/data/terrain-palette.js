(function(){
"use strict";

const TYPES=Object.freeze({
  grass:Object.freeze({id:"grass",label:"Grass",color:"#6F8A4C"}),
  forest:Object.freeze({id:"forest",label:"Forest",color:"#315B3A"}),
  dirt:Object.freeze({id:"dirt",label:"Dirt",color:"#9B7448"}),
  mud:Object.freeze({id:"mud",label:"Mud",color:"#66503B"}),
  road:Object.freeze({id:"road",label:"Road",color:"#B09A73"}),
  bridge:Object.freeze({id:"bridge",label:"Bridge",color:"#8E7048"}),
  square:Object.freeze({id:"square",label:"Public Square",color:"#9B927C"}),
  path:Object.freeze({id:"path",label:"Path",color:"#A58D67"}),
  plot:Object.freeze({id:"plot",label:"Reserved Plot",color:"#856B4F"}),
  building:Object.freeze({id:"building",label:"Building",color:"#7C6252"}),
  floor:Object.freeze({id:"floor",label:"Wood Floor",color:"#9A7955"}),
  wall:Object.freeze({id:"wall",label:"Top-down Wall",color:"#766555"}),
  door:Object.freeze({id:"door",label:"Door",color:"#8A6847"}),
  water:Object.freeze({id:"water",label:"Water",color:"#3F7190"}),
  rock:Object.freeze({id:"rock",label:"Rock",color:"#74756F"}),
  sand:Object.freeze({id:"sand",label:"Sand",color:"#BDA66F"}),
  farmland:Object.freeze({id:"farmland",label:"Farmland",color:"#7C8147"})
});

const ORDER=Object.freeze([
  "grass","forest","dirt","mud","road","bridge","square","path","plot","building","floor","wall","door","water","rock","sand","farmland"
]);

function get(type){
  return TYPES[type]||TYPES.grass;
}

function all(){
  return ORDER.map(id=>TYPES[id]);
}

window.TerrainPalette=Object.freeze({TYPES,ORDER,get,all});
})();
