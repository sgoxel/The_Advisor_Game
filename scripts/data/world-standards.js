(function(){
"use strict";

const TILE_METERS=2;
const WALK_SPEED_KMH=Object.freeze({
  road:3.6,
  bridge:3.6,
  dirt:3.2,
  grass:3.0,
  farmland:2.8,
  sand:2.3,
  forest:2.2,
  mud:1.8,
  rock:1.6,
  water:0,
  building:0,
  square:3.6,
  path:3.0,
  plot:2.8
});

const MIN_VILLAGE_WALK_MINUTES=60;
const FASTEST_NORMAL_WALK_KMH=WALK_SPEED_KMH.road;
const MIN_VILLAGE_DISTANCE_METERS=FASTEST_NORMAL_WALK_KMH*1000*(MIN_VILLAGE_WALK_MINUTES/60);
const MIN_VILLAGE_DISTANCE_TILES=Math.ceil(MIN_VILLAGE_DISTANCE_METERS/TILE_METERS);

// 4.4 km nominal village-cell spacing with +/-200 m jitter gives a
// >=4.0 km direct center separation in adjacent cells.
const VILLAGE_CELL_SIZE_TILES=2200;
const VILLAGE_JITTER_TILES=100;

const MAX_BRIDGE_WALK_MINUTES=10;
const BRIDGE_TIME_LIMIT_METERS=FASTEST_NORMAL_WALK_KMH*1000*(MAX_BRIDGE_WALK_MINUTES/60);
const PRACTICAL_RURAL_BRIDGE_MAX_METERS=120;
const MAX_RURAL_BRIDGE_TILES=Math.floor(
  Math.min(BRIDGE_TIME_LIMIT_METERS,PRACTICAL_RURAL_BRIDGE_MAX_METERS)/TILE_METERS
);

const ROAD_WIDTH_TILES=Object.freeze({
  capital:10,
  city:6,
  town:4,
  village:3,
  wilderness:2,
  rough:1,
  bridge:4
});

function tilesToMeters(tiles){return Number(tiles)*TILE_METERS}
function metersToTiles(meters){return Number(meters)/TILE_METERS}
function walkMinutes(distanceMeters,speedKmh){
  const speed=Number(speedKmh);
  return speed>0?Number(distanceMeters)/(speed*1000/60):Infinity;
}

window.WorldStandards=Object.freeze({
  TILE_METERS,WALK_SPEED_KMH,
  MIN_VILLAGE_WALK_MINUTES,FASTEST_NORMAL_WALK_KMH,
  MIN_VILLAGE_DISTANCE_METERS,MIN_VILLAGE_DISTANCE_TILES,
  VILLAGE_CELL_SIZE_TILES,VILLAGE_JITTER_TILES,
  MAX_BRIDGE_WALK_MINUTES,BRIDGE_TIME_LIMIT_METERS,
  PRACTICAL_RURAL_BRIDGE_MAX_METERS,MAX_RURAL_BRIDGE_TILES,
  ROAD_WIDTH_TILES,
  tilesToMeters,metersToTiles,walkMinutes
});
})();
