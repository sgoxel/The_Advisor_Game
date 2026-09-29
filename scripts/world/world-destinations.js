(function(){
"use strict";

const VERSION=1;
const TILE_METERS=2;
const POI_CELL_TILES=8192;
const MAX_QUERY_RADIUS_METERS=80000;
const MAX_QUERY_RESULTS=32;
const MAX_QUERY_CELLS=169;
const SAMPLE_STEP_TILES=96;
const FAR_SAMPLE_STEP_TILES=384;
const NAME_STEMS=Object.freeze(["Alder","Ash","Black","Bright","Cedar","Dawn","Elder","Falcon","Green","Grey","High","Iron","Kings","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","Vale","West","White","Wolf"]);
const TYPE_SUFFIX=Object.freeze({
  ruin:["Watch","Keep","Hall","Rest"],fort:["Fort","Watch","Hold"],tower:["Tower","Watch","Beacon"],bridge:["Bridge","Crossing","Ford"],
  lake:["Lake","Mere","Water"],"river-location":["Reach","Bend","Ford"],confluence:["Meeting","Confluence","Fork"],waterfall:["Falls","Cascade","Drop"],
  cliff:["Cliffs","Scar","Crag"],outcrop:["Crag","Rocks","Tor"],"mountain-pass":["Pass","Gap","Gate"],cave:["Cave","Hollow","Grotto"],forest:["Wood","Grove","Forest"],
  hunting:["Chase","Hunt","Wilds"],fishing:["Fishery","Waters","Reach"],grazing:["Downs","Pastures","Meadow"],gathering:["Gathering","Forage","Grounds"]
});

function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function hash32(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function unit(seed,label){return hash32(String(seed)+"|world-destination|"+String(label))/4294967295;}
function floorDiv(value,divisor){const v=BigInt(String(value)),d=BigInt(String(divisor));let q=v/d,r=v%d;if(r!==0n&&v<0n)q-=1n;return q;}
function tileDistanceMeters(a,b){const dx=Number(BigInt(String(a.x))-BigInt(String(b.x)))*TILE_METERS,dy=Number(BigInt(String(a.y))-BigInt(String(b.y)))*TILE_METERS;return Math.hypot(dx,dy);}
function bearing(a,b){const dx=Number(BigInt(String(b.x))-BigInt(String(a.x))),dy=Number(BigInt(String(b.y))-BigInt(String(a.y)));const degrees=(Math.atan2(dx,dy)*180/Math.PI+360)%360;const dirs=["N","NE","E","SE","S","SW","W","NW"];return Object.freeze({degrees:Number(degrees.toFixed(2)),label:dirs[Math.round(degrees/45)%8]});}
function freezeArray(values){return Object.freeze(values.map(item=>Object.freeze(item)));}
function categoryForType(type){
  if(["hamlet","village"].includes(type))return "settlements";
  if(["town","city","capital"].includes(type))return "cities";
  if(["ruin","fort","tower","bridge"].includes(type))return "historical";
  if(type==="hunting")return "hunting";if(type==="fishing")return "fishing";
  if(["lake","river-location","confluence","waterfall"].includes(type))return "water";
  return "nature";
}
function strategicTier(type,importance){
  if(type==="capital"||importance>=5)return "continent";
  if(type==="city"||importance>=4)return "country";
  if(type==="town"||importance>=3)return "region";
  return "local";
}
function settlementImportance(record){const value=String(record?.importanceClass||record?.classId||"");if(value==="national-capital")return 5;if(value==="major-city")return 4;if(record?.classId==="city")return 4;if(record?.classId==="town")return 3;if(record?.classId==="village")return 2;return 1;}
function settlementRadius(record){const value=String(record?.importanceClass||record?.classId||"");return value==="national-capital"?9000:value==="major-city"||record?.classId==="city"?6000:record?.classId==="town"?2800:record?.classId==="village"?1200:650;}
function settlementType(record){return String(record?.importanceClass)==="national-capital"||String(record?.classId)==="national-capital"?"capital":String(record?.classId||"settlement");}
function coordinatesFor(seed,x,y){
  const tile=Object.freeze({x:String(x),y:String(y)});let latitudeRadians=null,longitudeRadians=null,latitudeDegrees=null,longitudeDegrees=null;
  try{const pg=window.PlanetGeography?.create?.(seed);if(pg){const geo=pg.worldLatLonForTile(tile.x,tile.y,TILE_METERS,window.PlanetGeography.DEFAULT_WORLD_RADIUS_METERS);latitudeRadians=Number(geo.latitudeRadians);longitudeRadians=Number(geo.longitudeRadians);latitudeDegrees=Number(geo.latitudeDegrees);longitudeDegrees=Number(geo.longitudeDegrees);}}catch(_){}
  return Object.freeze({tile,registeredMeters:Object.freeze({east:Number(BigInt(tile.x))*TILE_METERS,north:Number(BigInt(tile.y))*TILE_METERS}),latitudeRadians,longitudeRadians,latitudeDegrees,longitudeDegrees,authority:"PlanetGeography registered world coordinate"});
}
function namesFor(seed,type,x,y){
  try{const external=window.PlaceNaming?.nameDestination?.(seed,{type,x:String(x),y:String(y)});if(external)return Object.freeze({name:String(external),authority:"PlaceNaming"});}catch(_){}
  const h=hash32(String(seed)+"|destination-name|"+type+"|"+String(x)+"|"+String(y)),stem=NAME_STEMS[h%NAME_STEMS.length],suffixes=TYPE_SUFFIX[type]||["Place"],suffix=suffixes[(h>>>8)%suffixes.length];
  return Object.freeze({name:stem+" "+suffix,authority:"SEED fallback pending canonical toponymy"});
}
function safeTerrain(seed,x,y){try{return String(window.GeographyFoundation?.getTerrainType?.(seed,String(x),String(y))||"water");}catch(_){return "water";}}
function safeEnvironment(seed,x,y){try{return window.GeographyFoundation?.environment?.(seed,String(x),String(y))||Object.freeze({elevationMeters:0,moisturePercent:50,biome:"Unknown"});}catch(_){return Object.freeze({elevationMeters:0,moisturePercent:50,biome:"Unknown"});}}
function samplePoint(seed,x,y){const terrain=safeTerrain(seed,x,y),env=safeEnvironment(seed,x,y);return Object.freeze({x:String(x),y:String(y),terrain,elevationMeters:Number(env.elevationMeters)||0,moisturePercent:Number(env.moisturePercent)||0,biome:String(env.biome||"")});}
function contextAt(seed,xValue,yValue){
  const x=BigInt(String(xValue)),y=BigInt(String(yValue)),s=BigInt(SAMPLE_STEP_TILES),f=BigInt(FAR_SAMPLE_STEP_TILES);
  const nearOffsets=[[0n,0n],[s,0n],[-s,0n],[0n,s],[0n,-s],[s,s],[-s,s],[s,-s],[-s,-s]];
  const farOffsets=[[f,0n],[-f,0n],[0n,f],[0n,-f]];
  const near=nearOffsets.map(([dx,dy])=>samplePoint(seed,x+dx,y+dy)),far=farOffsets.map(([dx,dy])=>samplePoint(seed,x+dx,y+dy)),center=near[0];
  const all=[...near,...far],elevations=all.map(p=>p.elevationMeters),waterNear=near.filter(p=>p.terrain==="water").length,forestNear=near.filter(p=>p.terrain==="forest").length,rockNear=near.filter(p=>p.terrain==="rock").length,openNear=near.filter(p=>["grass","farmland","dirt","sand"].includes(p.terrain)).length,roadNear=near.some(p=>["road","bridge"].includes(p.terrain));
  const cardinals=near.slice(1,5),waterArms=cardinals.filter(p=>p.terrain==="water").length,landNear=near.length-waterNear;
  const oppositeWater=(cardinals[0].terrain==="water"&&cardinals[1].terrain==="water")||(cardinals[2].terrain==="water"&&cardinals[3].terrain==="water");
  return Object.freeze({center,near:freezeArray(near),far:freezeArray(far),waterNear,forestNear,rockNear,openNear,roadNear,waterArms,landNear,oppositeWater,slopeMeters:Math.max(...elevations)-Math.min(...elevations),maxElevationMeters:Math.max(...elevations),minElevationMeters:Math.min(...elevations)});
}
function rawCandidate(seed,type,x,y,score,importance,radius,description,tags,evidence){return Object.freeze({
  id:"WDEST|"+String(type).toUpperCase()+"|"+hash32(String(seed)+"|"+type+"|"+String(x)+"|"+String(y)).toString(16).padStart(8,"0"),
  type,category:categoryForType(type),center:Object.freeze({x:String(x),y:String(y)}),score:Number(score.toFixed(6)),importance:clamp(importance,1,5),footprintRadiusMeters:Math.max(20,Math.round(radius)),description:String(description),activityTags:Object.freeze((tags||[]).map(String)),evidence:Object.freeze({...evidence}),source:"bounded destination cell",worldAuthority:true
});}
function poiCandidatesForCell(seed,cxValue,cyValue){
  const cx=BigInt(String(cxValue)),cy=BigInt(String(cyValue)),size=BigInt(POI_CELL_TILES),baseX=cx*size,baseY=cy*size;
  const jx=BigInt(Math.round((unit(seed,"jx:"+cx+":"+cy)*.72+.14)*POI_CELL_TILES)),jy=BigInt(Math.round((unit(seed,"jy:"+cx+":"+cy)*.72+.14)*POI_CELL_TILES));
  const x=baseX+jx,y=baseY+jy,ctx=contextAt(seed,x,y),c=ctx.center,h=unit(seed,"history:"+cx+":"+cy),g=unit(seed,"activity:"+cx+":"+cy),out=[];
  const ev={terrain:c.terrain,elevationMeters:c.elevationMeters,biome:c.biome,waterSamples:ctx.waterNear,forestSamples:ctx.forestNear,rockSamples:ctx.rockNear,openSamples:ctx.openNear,slopeMeters:Math.round(ctx.slopeMeters),roadNear:ctx.roadNear,waterArms:ctx.waterArms};
  if(c.terrain==="water"){
    if(ctx.waterNear>=7)out.push(rawCandidate(seed,"lake",x,y,.82+ctx.waterNear/100,3,900,"A stable inland water body defined by the seeded hydrography.",["water","fishing"],ev));
    else if(ctx.waterArms>=3&&ctx.landNear>=2)out.push(rawCandidate(seed,"confluence",x,y,.90,3,420,"A meeting of seeded water corridors with multiple approach arms.",["water","navigation"],ev));
    else if(ctx.oppositeWater)out.push(rawCandidate(seed,"river-location",x,y,.78,2,500,"A notable reach along a narrow seeded water corridor.",["water","river"],ev));
    if(ctx.slopeMeters>=220&&ctx.landNear>=2)out.push(rawCandidate(seed,"waterfall",x,y,.86,3,260,"A steep seeded water transition where local relief drops sharply.",["water","landmark"],ev));
  }else{
    if(ctx.slopeMeters>=700&&c.elevationMeters>=500)out.push(rawCandidate(seed,"cliff",x,y,.79,3,360,"A steep exposed escarpment derived from local elevation relief.",["rock","landmark"],ev));
    else if((c.terrain==="rock"||ctx.rockNear>=3)&&ctx.slopeMeters>=260)out.push(rawCandidate(seed,"outcrop",x,y,.72,2,230,"An exposed rocky outcrop supported by seeded terrain and slope.",["rock","gathering"],ev));
    if(c.elevationMeters>=720&&ctx.slopeMeters>=300&&unit(seed,"pass:"+cx+":"+cy)>.48)out.push(rawCandidate(seed,"mountain-pass",x,y,.74,3,460,"A comparatively traversable highland saddle between steeper approaches.",["travel","highland"],ev));
    if((c.terrain==="rock"||ctx.rockNear>=2)&&ctx.slopeMeters>=180&&unit(seed,"cave:"+cx+":"+cy)>.72)out.push(rawCandidate(seed,"cave",x,y,.70,2,140,"A cave site where rocky relief supports a plausible opening.",["rock","shelter"],ev));
    if(ctx.forestNear>=5)out.push(rawCandidate(seed,"forest",x,y,.68+ctx.forestNear/100,2,700,"A notable grove or forest pocket grounded in the local biome.",["woodland","gathering"],ev));
  }
  if(c.terrain!=="water"&&(ctx.waterNear>=2||ctx.waterArms>=1))out.push(rawCandidate(seed,"fishing",x,y,.65+ctx.waterNear/20,2,620,"A fishing area placed beside reachable seeded water.",["fishing","water-access"],ev));
  if(c.terrain!=="water"&&(ctx.forestNear>=3||["Woodland","Highland"].includes(c.biome))&&!ctx.roadNear&&g>.18)out.push(rawCandidate(seed,"hunting",x,y,.61+ctx.forestNear/20,2,1100,"A hunting area derived from wilderness cover, relief and low route pressure.",["hunting","wilderness"],ev));
  if(c.terrain!=="water"&&ctx.openNear>=6&&g>.36)out.push(rawCandidate(seed,"grazing",x,y,.60+ctx.openNear/30,1,900,"Open country suitable for grazing, derived from seeded ground cover.",["grazing","open-country"],ev));
  if(c.terrain!=="water"&&(ctx.forestNear>=3||ctx.rockNear>=2)&&g>.42)out.push(rawCandidate(seed,"gathering",x,y,.58+(ctx.forestNear+ctx.rockNear)/40,1,520,"A gathering area tied to local woodland or exposed material resources.",["gathering","resources"],ev));
  if(c.terrain!=="water"&&c.elevationMeters<2600&&(ctx.roadNear||["rock","dirt","grass"].includes(c.terrain))&&h>.83){
    const historicType=ctx.roadNear?(ctx.slopeMeters>450?"tower":"ruin"):(ctx.slopeMeters>650?"fort":"ruin");
    out.push(rawCandidate(seed,historicType,x,y,.69+h/10,historicType==="fort"?3:2,historicType==="fort"?360:240,ctx.roadNear?"A historical site on a plausible seeded travel approach.":"A historical site on suitable dry terrain with deterministic regional context.",["historical",ctx.roadNear?"route-access":"terrain-access"],ev));
  }
  if((c.terrain==="bridge"||ctx.roadNear)&&ctx.waterNear>=2&&h>.58)out.push(rawCandidate(seed,"bridge",x,y,.76,2,180,"A strategically notable crossing where seeded route and water geography meet.",["crossing","route","water"],ev));
  out.sort((a,b)=>b.score-a.score||b.importance-a.importance||a.id.localeCompare(b.id));
  return Object.freeze(out.slice(0,4));
}
function settlementRaw(record){
  const type=settlementType(record),importance=settlementImportance(record);
  return Object.freeze({id:String(record.id),type,category:categoryForType(type),center:Object.freeze({x:String(record.center.x),y:String(record.center.y)}),score:1+importance/10,importance,footprintRadiusMeters:settlementRadius(record),description:type==="capital"?"National political center from the canonical settlement hierarchy.":"Canonical "+type+" from the SEED settlement hierarchy.",activityTags:Object.freeze(["settlement",String(record.roadNetworkRole||"local-node")]),evidence:Object.freeze({terrain:String(record.center.terrain||""),settlementClass:String(record.classId||""),importanceClass:String(record.importanceClass||""),generationCellId:String(record.generationCell?.id||"")}),source:String(record.authority||"SettlementArchetypes"),worldAuthority:true,countryId:String(record.countryId||""),regionId:String(record.regionId||""),canonicalName:String(record.name||"")});
}
function enrich(seed,raw){
  const x=raw.center.x,y=raw.center.y,coordinates=coordinatesFor(seed,x,y),context=window.GeographyFoundation?.hierarchy?.(seed,x,y)||{};
  let country=null,region=null;try{country=window.PoliticalGeography?.ownerAt?.(seed,x,y)||null;}catch(_){}try{region=window.RegionProfile?.at?.(seed,x,y)||null;}catch(_){}
  const type=raw.type,nameInfo=raw.canonicalName?Object.freeze({name:raw.canonicalName,authority:"SettlementArchetypes canonical name"}):namesFor(seed,type,x,y);
  const terrain=raw.evidence?.terrain||safeTerrain(seed,x,y),walkable=terrain!=="water",roadAccessClass=raw.type==="capital"||raw.type==="city"?"primary":raw.category==="cities"?"regional":raw.evidence?.roadNear?"local-road":raw.type==="bridge"?"crossing":"off-road";
  const defaultDiscoveryState=raw.importance>=3||["capital","city","town"].includes(type)?"known":"discoverable";
  return Object.freeze({...raw,name:nameInfo.name,namingAuthority:nameInfo.authority,coordinates,countryId:String(raw.countryId||country?.id||""),countryName:String(country?.name||context.country||""),regionId:String(raw.regionId||region?.id||""),regionName:String(region?.name||context.region||""),discoverability:Object.freeze({defaultState:defaultDiscoveryState,requiresLocalMaterialization:false}),navigation:Object.freeze({suitable:walkable||raw.category==="water",walkableAnchor:walkable,roadAccessClass,roadGraphAuthority:window.WorldRoadGraph?"WorldRoadGraph":"local geography fallback",localChunkRequired:false}),strategicVisibilityTier:strategicTier(type,raw.importance),seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true,localMaterialized:false,authority:"Campaign SEED + fixed geography + canonical settlement hierarchy"});
}
function normalizeOrigin(seed,origin){
  if(origin&&origin.x!=null&&origin.y!=null)return Object.freeze({x:String(origin.x),y:String(origin.y)});
  if(origin&&(Number.isFinite(Number(origin.latitudeRadians))||Number.isFinite(Number(origin.latitudeDegrees)))){
    const lat=Number.isFinite(Number(origin.latitudeRadians))?Number(origin.latitudeRadians):Number(origin.latitudeDegrees)*Math.PI/180,lon=Number.isFinite(Number(origin.longitudeRadians))?Number(origin.longitudeRadians):Number(origin.longitudeDegrees||0)*Math.PI/180;
    const pg=window.PlanetGeography?.create?.(seed);if(pg){const tile=pg.worldTileForLatLon(lat,lon,TILE_METERS,window.PlanetGeography.DEFAULT_WORLD_RADIUS_METERS);return Object.freeze({x:String(tile.x),y:String(tile.y)});}
  }
  return Object.freeze({x:"0",y:"0"});
}
function normalizeCategories(value){if(value==null)return null;const list=Array.isArray(value)?value:[value];return new Set(list.map(String));}
function discoveredPass(item,options){if(!options.discoveredOnly)return true;if(item.discoverability?.defaultState==="known")return true;const ids=options.discoveredIds instanceof Set?options.discoveredIds:new Set((options.discoveredIds||[]).map(String));return ids.has(String(item.id));}
function queryNearby(seedValue,originValue,optionsValue){
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now(),seed=String(seedValue==null?"":seedValue),origin=normalizeOrigin(seed,originValue||{}),options=optionsValue||{};
  const radiusMeters=clamp(options.radiusMeters==null?40000:options.radiusMeters,250,MAX_QUERY_RADIUS_METERS),maxResults=Math.max(1,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.maxResults)||16))),minImportance=clamp(options.minImportance||1,1,5),categories=normalizeCategories(options.categories||options.category),types=normalizeCategories(options.types||options.type);
  const radiusTiles=BigInt(Math.ceil(radiusMeters/TILE_METERS)),ox=BigInt(origin.x),oy=BigInt(origin.y),minX=ox-radiusTiles,maxX=ox+radiusTiles,minY=oy-radiusTiles,maxY=oy+radiusTiles;
  let settlementQuery={settlements:[],diagnostics:{queryCellCount:0}};try{settlementQuery=window.SettlementArchetypes?.canonicalSettlementsInBounds?.(seed,{minX:String(minX),maxX:String(maxX),minY:String(minY),maxY:String(maxY)},["national-capital","city","town","village","hamlet"])||settlementQuery;}catch(_){}
  const raw=[];for(const record of settlementQuery.settlements||[])raw.push(settlementRaw(record));
  const minCx=floorDiv(minX,POI_CELL_TILES),maxCx=floorDiv(maxX,POI_CELL_TILES),minCy=floorDiv(minY,POI_CELL_TILES),maxCy=floorDiv(maxY,POI_CELL_TILES),cells=[];
  const ccx=floorDiv(ox,POI_CELL_TILES),ccy=floorDiv(oy,POI_CELL_TILES);
  for(let cy=minCy;cy<=maxCy;cy++)for(let cx=minCx;cx<=maxCx;cx++){const dx=Number(cx-ccx),dy=Number(cy-ccy);cells.push({cx,cy,d:dx*dx+dy*dy});}
  cells.sort((a,b)=>{
    if(a.d!==b.d)return a.d-b.d;
    if(a.cy!==b.cy)return a.cy<b.cy?-1:1;
    if(a.cx!==b.cx)return a.cx<b.cx?-1:1;
    return 0;
  });const boundedCells=cells.slice(0,MAX_QUERY_CELLS);
  for(const cell of boundedCells)raw.push(...poiCandidatesForCell(seed,cell.cx,cell.cy));
  const unique=new Map();for(const item of raw){const distance=tileDistanceMeters(origin,item.center);if(distance>radiusMeters+item.footprintRadiusMeters)continue;if(item.importance<minImportance)continue;if(categories&&!categories.has(item.category))continue;if(types&&!types.has(item.type))continue;const prev=unique.get(item.id);if(!prev||distance<prev.distance)unique.set(item.id,{item,distance});}
  const ranked=[...unique.values()].sort((a,b)=>a.distance-b.distance||b.item.importance-a.item.importance||b.item.score-a.item.score||a.item.id.localeCompare(b.item.id));
  const results=[];for(const entry of ranked){const item=enrich(seed,entry.item);if(!discoveredPass(item,options))continue;const dir=bearing(origin,item.center);results.push(Object.freeze({...item,distanceMeters:Number(entry.distance.toFixed(2)),bearingDegrees:dir.degrees,directionLabel:dir.label}));if(results.length>=maxResults)break;}
  const ended=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  return Object.freeze({seed,origin,radiusMeters,results:Object.freeze(results),diagnostics:Object.freeze({version:VERSION,queryMs:Number((ended-started).toFixed(3)),queryCellCount:boundedCells.length,maxQueryCells:MAX_QUERY_CELLS,settlementQueryCellCount:Number(settlementQuery.diagnostics?.queryCellCount||0),candidateCount:raw.length,resultCount:results.length,bounded:true,fullWorldScan:false,localChunkMaterialization:false,descriptorOnly:true,seedOnly:true,cameraIndependent:true,viewportIndependent:true})});
}
function descriptorById(seedValue,idValue,originValue,optionsValue){const id=String(idValue||"");if(!id)return null;const query=queryNearby(seedValue,originValue||{x:"0",y:"0"},{...(optionsValue||{}),radiusMeters:optionsValue?.radiusMeters||MAX_QUERY_RADIUS_METERS,maxResults:MAX_QUERY_RESULTS});return query.results.find(item=>item.id===id)||null;}
function signature(query){return hash32((query?.results||[]).map(item=>[item.id,item.type,item.center.x,item.center.y,item.countryId,item.regionId,item.importance].join(":")).join("|")).toString(16).padStart(8,"0");}
function verify(seedValue,originValue){const seed=String(seedValue==null?"":seedValue),origin=normalizeOrigin(seed,originValue||{x:"0",y:"0"}),a=queryNearby(seed,origin,{radiusMeters:80000,maxResults:32}),b=queryNearby(seed,origin,{radiusMeters:80000,maxResults:32}),sa=signature(a),sb=signature(b),settlement=a.results.some(x=>["hamlet","village","town","city","capital"].includes(x.type)),nonSettlement=a.results.some(x=>!["hamlet","village","town","city","capital"].includes(x.type));return Object.freeze({pass:sa===sb&&settlement&&nonSettlement&&a.diagnostics.bounded&&!a.diagnostics.fullWorldScan&&!a.diagnostics.localChunkMaterialization,seed,signatureA:sa,signatureB:sb,deterministic:sa===sb,settlement,nonSettlement,query:a});}

window.WorldDestinations=Object.freeze({VERSION,TILE_METERS,POI_CELL_TILES,MAX_QUERY_RADIUS_METERS,MAX_QUERY_RESULTS,MAX_QUERY_CELLS,queryNearby,descriptorById,verify,signature});
})();
