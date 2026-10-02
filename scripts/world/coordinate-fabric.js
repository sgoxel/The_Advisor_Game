(function(){
"use strict";

const VERSION="seed-coordinate-fabric-v1";
const DEFAULT_CELL_SIZE_TILES=256;
const INSTANCES=new Map();

function hash32(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function clamp(v,a,b){return Math.min(b,Math.max(a,Number(v)||0));}
function floorDivBig(value,size){
  const v=BigInt(String(value)),s=BigInt(String(size));let q=v/s,r=v%s;
  if(r!==0n&&v<0n)q-=1n;
  return q;
}
function vector(x,y,z){return Object.freeze({x:Number(x),y:Number(y),z:Number(z)});}
function normalize3(x,y,z){const m=Math.hypot(Number(x)||0,Number(y)||0,Number(z)||0)||1;return vector((Number(x)||0)/m,(Number(y)||0)/m,(Number(z)||0)/m);}
function dot3(a,b){return Number(a?.x||0)*Number(b?.x||0)+Number(a?.y||0)*Number(b?.y||0)+Number(a?.z||0)*Number(b?.z||0);}
function tangentBasis(latitudeRadians,longitudeRadians){
  const lat=clamp(latitudeRadians,-Math.PI/2,Math.PI/2),lon=Number(longitudeRadians)||0;
  const c=Math.cos(lat),s=Math.sin(lat),cl=Math.cos(lon),sl=Math.sin(lon);
  const up=vector(c*sl,s,c*cl);
  const east=vector(cl,0,-sl);
  const north=vector(-s*sl,c,-s*cl);
  return Object.freeze({east,north,up});
}
function create(seedValue,options={}){
  if(!window.PlanetGeography)throw new Error("PlanetGeography must load before SeedCoordinateFabric");
  const seed=window.PlanetGeography.sanitizeSeed(seedValue);
  const radiusMeters=Math.max(1,Number(options.radiusMeters||window.PlanetGeography.DEFAULT_WORLD_RADIUS_METERS||637100));
  const tileMeters=Math.max(.001,Number(options.tileMeters||window.WorldStandards?.TILE_METERS||window.PlanetGeography.DEFAULT_TILE_METERS||2));
  const key=[seed,radiusMeters,tileMeters,VERSION].join("|");
  if(INSTANCES.has(key))return INSTANCES.get(key);

  const geography=window.PlanetGeography.create(seed);
  const registration=geography.registration||{};
  const revisionSignature="SCF-"+hash32([
    VERSION,seed,window.PlanetGeography.VERSION||"",
    radiusMeters,tileMeters,
    JSON.stringify(registration.originDirection||{}),
    JSON.stringify(registration.eastDirection||{}),
    JSON.stringify(registration.northDirection||{})
  ].join("|"));
  const cellCache=new Map();
  const stats={cacheHits:0,cacheMisses:0,regenerated:0,released:0};

  function registeredMetersForLatLon(latitudeRadians,longitudeRadians){
    const direction=window.PlanetGeography.directionFromLatLon(latitudeRadians,longitudeRadians);
    const origin=registration.originDirection,east=registration.eastDirection,north=registration.northDirection;
    if(direction&&origin&&east&&north){
      const registeredLatitudeRadians=Math.asin(clamp(dot3(direction,north),-1,1));
      const registeredLongitudeRadians=Math.atan2(dot3(direction,east),dot3(direction,origin));
      return Object.freeze({
        eastMeters:registeredLongitudeRadians*radiusMeters,
        northMeters:registeredLatitudeRadians*radiusMeters,
        registeredLatitudeRadians,registeredLongitudeRadians,
        authority:"Campaign-SEED -> SeedCoordinateFabric.seed-fixed-spherical-frame"
      });
    }
    const tile=worldTileForLatLon(latitudeRadians,longitudeRadians);
    return Object.freeze({
      eastMeters:Number(BigInt(tile.x))*tileMeters,
      northMeters:Number(BigInt(tile.y))*tileMeters,
      registeredLatitudeRadians:Number(BigInt(tile.y))*tileMeters/radiusMeters,
      registeredLongitudeRadians:Number(BigInt(tile.x))*tileMeters/radiusMeters,
      authority:"Campaign-SEED -> SeedCoordinateFabric.canonical-world-tile-fallback"
    });
  }
  function latLonForRegisteredMeters(eastMeters,northMeters){
    const origin=registration.originDirection,east=registration.eastDirection,north=registration.northDirection;
    if(origin&&east&&north){
      const registeredLatitudeRadians=clamp((Number(northMeters)||0)/radiusMeters,-Math.PI/2,Math.PI/2);
      const period=Math.PI*2*radiusMeters,half=period*.5;
      let wrappedEast=(Number(eastMeters)||0)%period;if(wrappedEast>half)wrappedEast-=period;else if(wrappedEast<-half)wrappedEast+=period;
      const registeredLongitudeRadians=wrappedEast/radiusMeters,c=Math.cos(registeredLatitudeRadians),s=Math.sin(registeredLatitudeRadians),cl=Math.cos(registeredLongitudeRadians),sl=Math.sin(registeredLongitudeRadians);
      const direction=normalize3(
        origin.x*c*cl+east.x*c*sl+north.x*s,
        origin.y*c*cl+east.y*c*sl+north.y*s,
        origin.z*c*cl+east.z*c*sl+north.z*s
      );
      const geo=window.PlanetGeography.latLonFromDirection(direction);
      return Object.freeze({
        latitudeRadians:Number(geo.latitudeRadians),longitudeRadians:Number(geo.longitudeRadians),
        latitudeDegrees:Number((Number(geo.latitudeRadians)*180/Math.PI).toFixed(6)),
        longitudeDegrees:Number((Number(geo.longitudeRadians)*180/Math.PI).toFixed(6)),
        registeredLatitudeRadians,registeredLongitudeRadians,
        registeredMeters:Object.freeze({east:wrappedEast,north:registeredLatitudeRadians*radiusMeters}),
        authority:"Campaign-SEED -> SeedCoordinateFabric.seed-fixed-spherical-frame"
      });
    }
    const x=String(Math.round((Number(eastMeters)||0)/tileMeters)),y=String(Math.round((Number(northMeters)||0)/tileMeters));
    return worldLatLonForTile(x,y);
  }
  function registeredDeltaMeters(originLatitudeRadians,originLongitudeRadians,targetLatitudeRadians,targetLongitudeRadians){
    const origin=registeredMetersForLatLon(originLatitudeRadians,originLongitudeRadians),target=registeredMetersForLatLon(targetLatitudeRadians,targetLongitudeRadians);
    const period=Math.PI*2*radiusMeters,half=period*.5;
    let eastMeters=Number(target.eastMeters)-Number(origin.eastMeters);
    if(eastMeters>half)eastMeters-=period;else if(eastMeters<-half)eastMeters+=period;
    return Object.freeze({
      eastMeters,northMeters:Number(target.northMeters)-Number(origin.northMeters),
      originRegisteredMeters:Object.freeze({east:Number(origin.eastMeters),north:Number(origin.northMeters)}),
      targetRegisteredMeters:Object.freeze({east:Number(target.eastMeters),north:Number(target.northMeters)}),
      authority:"Campaign-SEED -> SeedCoordinateFabric.registered-meter-delta"
    });
  }
  function worldLatLonForTile(xValue,yValue){
    const geo=geography.worldLatLonForTile(xValue,yValue,tileMeters,radiusMeters);
    return Object.freeze({
      latitudeRadians:Number(geo.latitudeRadians),longitudeRadians:Number(geo.longitudeRadians),
      latitudeDegrees:Number(geo.latitudeDegrees),longitudeDegrees:Number(geo.longitudeDegrees),
      worldTile:Object.freeze({x:String(geo.worldTile.x),y:String(geo.worldTile.y)})
    });
  }
  function worldTileForLatLon(latitudeRadians,longitudeRadians){
    const tile=geography.worldTileForLatLon(latitudeRadians,longitudeRadians,tileMeters,radiusMeters);
    return Object.freeze({x:String(tile.x),y:String(tile.y)});
  }
  function cellForTile(xValue,yValue,cellSizeTiles=DEFAULT_CELL_SIZE_TILES){
    const geo=worldLatLonForTile(xValue,yValue),size=Math.max(1,Math.round(Number(cellSizeTiles)||DEFAULT_CELL_SIZE_TILES));
    const cx=floorDivBig(geo.worldTile.x,size),cy=floorDivBig(geo.worldTile.y,size);
    const id="CELL|"+revisionSignature+"|"+size+"|"+cx.toString()+"|"+cy.toString();
    return Object.freeze({id,cellX:cx.toString(),cellY:cy.toString(),cellSizeTiles:size,cellSizeMeters:size*tileMeters});
  }
  function describeTile(xValue,yValue,cellSizeTiles=DEFAULT_CELL_SIZE_TILES){
    const geo=worldLatLonForTile(xValue,yValue),x=BigInt(geo.worldTile.x),y=BigInt(geo.worldTile.y);
    const basis=tangentBasis(geo.latitudeRadians,geo.longitudeRadians);
    const direction=window.PlanetGeography.directionFromLatLon(geo.latitudeRadians,geo.longitudeRadians);
    const round=geography.registrationRoundTrip(geo.worldTile.x,geo.worldTile.y,tileMeters,radiusMeters);
    return Object.freeze({
      seed,version:VERSION,revisionSignature,radiusMeters,tileMeters,
      worldTile:geo.worldTile,spatialCell:cellForTile(geo.worldTile.x,geo.worldTile.y,cellSizeTiles),
      latitudeRadians:geo.latitudeRadians,longitudeRadians:geo.longitudeRadians,
      latitudeDegrees:geo.latitudeDegrees,longitudeDegrees:geo.longitudeDegrees,
      registeredMeters:Object.freeze({east:Number(x)*tileMeters,north:Number(y)*tileMeters}),
      planetMeters:vector(direction.x*radiusMeters,direction.y*radiusMeters,direction.z*radiusMeters),
      tangentBasis:basis,
      roundTripErrorTiles:Number(round?.errorTiles||0),
      roundTripErrorMeters:Number((Number(round?.errorTiles||0)*tileMeters).toFixed(6)),
      authority:"Campaign-SEED -> PlanetGeography registration -> SeedCoordinateFabric"
    });
  }
  function describeLatLon(latitudeRadians,longitudeRadians,cellSizeTiles=DEFAULT_CELL_SIZE_TILES){
    const tile=worldTileForLatLon(latitudeRadians,longitudeRadians);
    return describeTile(tile.x,tile.y,cellSizeTiles);
  }
  function worldToLocal(originTile,targetTile){
    const origin=describeTile(originTile.x,originTile.y),target=describeTile(targetTile.x,targetTile.y);
    return Object.freeze({
      originTile:origin.worldTile,targetTile:target.worldTile,
      eastMeters:Number(BigInt(target.worldTile.x)-BigInt(origin.worldTile.x))*tileMeters,
      northMeters:Number(BigInt(target.worldTile.y)-BigInt(origin.worldTile.y))*tileMeters,
      authority:"canonical-registered-meter-delta"
    });
  }
  function localToWorldTile(originTile,eastMeters,northMeters){
    const origin=describeTile(originTile.x,originTile.y);
    const dx=BigInt(Math.round((Number(eastMeters)||0)/tileMeters)),dy=BigInt(Math.round((Number(northMeters)||0)/tileMeters));
    return worldLatLonForTile((BigInt(origin.worldTile.x)+dx).toString(),(BigInt(origin.worldTile.y)+dy).toString()).worldTile;
  }
  function materializeCell(tileValue,cellSizeTiles=DEFAULT_CELL_SIZE_TILES){
    const tile=tileValue?.x!==undefined?tileValue:worldTileForLatLon(tileValue?.latitudeRadians||0,tileValue?.longitudeRadians||0);
    const cell=cellForTile(tile.x,tile.y,cellSizeTiles);
    if(cellCache.has(cell.id)){stats.cacheHits++;return cellCache.get(cell.id);}
    stats.cacheMisses++;stats.regenerated++;
    const record=Object.freeze({
      ...cell,seed,revisionSignature,
      originWorldTile:Object.freeze({x:(BigInt(cell.cellX)*BigInt(cell.cellSizeTiles)).toString(),y:(BigInt(cell.cellY)*BigInt(cell.cellSizeTiles)).toString()}),
      signature:"STREAM-"+hash32([seed,revisionSignature,cell.id].join("|")),
      authority:"seed-regenerated-spatial-cell"
    });
    cellCache.set(cell.id,record);return record;
  }
  function releaseCell(id){if(cellCache.delete(String(id)))stats.released++;}
  function snapshot(centerTile){
    const center=centerTile?describeTile(centerTile.x,centerTile.y):describeTile("0","0");
    return Object.freeze({
      version:VERSION,seed,revisionSignature,radiusMeters,tileMeters,
      registrationAuthority:String(registration.authority||"PlanetGeography.seed-fixed-spherical-frame"),
      center,
      streamedCellIds:Object.freeze([...cellCache.keys()].sort()),
      cache:Object.freeze({...stats,activeCellCount:cellCache.size}),
      fullWorldScan:false,lazy:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true
    });
  }
  function verify(){
    const a=describeTile("0","0"),b=describeLatLon(a.latitudeRadians,a.longitudeRadians);
    const far=describeTile("123456","-65432");
    const local=worldToLocal(a.worldTile,far.worldTile),back=localToWorldTile(a.worldTile,local.eastMeters,local.northMeters);
    return Object.freeze({
      pass:a.roundTripErrorTiles<=1&&b.worldTile.x===a.worldTile.x&&b.worldTile.y===a.worldTile.y&&back.x===far.worldTile.x&&back.y===far.worldTile.y,
      origin:a,far,local,back,fullWorldScan:false
    });
  }

  const api=Object.freeze({
    VERSION,seed,revisionSignature,radiusMeters,tileMeters,
    worldLatLonForTile,worldTileForLatLon,registeredMetersForLatLon,latLonForRegisteredMeters,registeredDeltaMeters,describeTile,describeLatLon,cellForTile,
    worldToLocal,localToWorldTile,materializeCell,releaseCell,snapshot,verify,
    registration:Object.freeze({...registration})
  });
  INSTANCES.set(key,api);return api;
}

window.SeedCoordinateFabric=Object.freeze({VERSION,DEFAULT_CELL_SIZE_TILES,create});
})();