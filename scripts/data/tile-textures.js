(function(){
"use strict";

const ROOT="assets/tiles/vector/";
const BASE=Object.freeze({
  grass:"grass.svg",
  forest:"forest.svg",
  dirt:"dirt.svg",
  mud:"mud.svg",
  road:"road.svg",
  bridge:"bridge.svg",
  square:"square.svg",
  path:"path.svg",
  plot:"plot.svg",
  water:"water.svg",
  rock:"rock.svg",
  sand:"sand.svg",
  farmland:"farmland.svg",
  floor:"floor_wood.svg",
  wall:"wall_n.svg",
  door:"door_s.svg"
});

const VARIANTS=Object.freeze({
  "floor-wood":"floor_wood.svg",
  "wall-n":"wall_n.svg",
  "wall-e":"wall_e.svg",
  "wall-s":"wall_s.svg",
  "wall-w":"wall_w.svg",
  "wall-corner-ne":"wall_corner_ne.svg",
  "wall-corner-se":"wall_corner_se.svg",
  "wall-corner-sw":"wall_corner_sw.svg",
  "wall-corner-nw":"wall_corner_nw.svg",
  "door-n":"door_n.svg",
  "door-e":"door_e.svg",
  "door-s":"door_s.svg",
  "door-w":"door_w.svg"
});

const NATURAL=new Set(["grass","forest","dirt","mud","water","rock","sand","farmland"]);

function asset(type,variant){
  const file=(variant&&VARIANTS[variant])||BASE[type];
  return file?ROOT+file:null;
}

function transition(type,north,east,south,west){
  if(!NATURAL.has(type))return null;
  const diff={
    n:NATURAL.has(north)&&north!==type,
    e:NATURAL.has(east)&&east!==type,
    s:NATURAL.has(south)&&south!==type,
    w:NATURAL.has(west)&&west!==type
  };
  const count=Object.values(diff).filter(Boolean).length;
  if(count===0)return null;

  if(count===3){
    const missing=!diff.n?"n":!diff.e?"e":!diff.s?"s":"w";
    const rotation={w:0,n:90,e:180,s:270}[missing];
    return Object.freeze({shape:"u",rotation,asset:ROOT+"transition_u.svg"});
  }

  if(count===2){
    if(diff.n&&diff.e)return Object.freeze({shape:"l",rotation:0,asset:ROOT+"transition_l.svg"});
    if(diff.e&&diff.s)return Object.freeze({shape:"l",rotation:90,asset:ROOT+"transition_l.svg"});
    if(diff.s&&diff.w)return Object.freeze({shape:"l",rotation:180,asset:ROOT+"transition_l.svg"});
    if(diff.w&&diff.n)return Object.freeze({shape:"l",rotation:270,asset:ROOT+"transition_l.svg"});
    return Object.freeze({
      shape:"c",
      rotation:(diff.n&&diff.s)?90:0,
      asset:ROOT+"transition_c.svg"
    });
  }

  if(count===1){
    const side=diff.n?"n":diff.e?"e":diff.s?"s":"w";
    const rotation={e:0,s:90,w:180,n:270}[side];
    return Object.freeze({shape:"c",rotation,asset:ROOT+"transition_c.svg"});
  }

  return Object.freeze({shape:"u",rotation:0,asset:ROOT+"transition_u.svg"});
}

window.TileTextures=Object.freeze({ROOT,BASE,VARIANTS,asset,transition});
})();