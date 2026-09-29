(function(){
"use strict";

const VERSION=2;
const TILE_METERS=2;
const POI_CELL_TILES=8192;
const MAX_QUERY_RADIUS_METERS=80000;
const MAX_QUERY_RESULTS=24;
const MAX_QUERY_CELLS=169;
const ACTIVE_POI_QUERY_CELLS=24;
const LOCAL_POI_CELL_QUERY_LIMIT=9;
const SAMPLE_STEP_TILES=96;
const FAR_SAMPLE_STEP_TILES=384;
const POI_CELL_CACHE_LIMIT=512;
const CONTEXT_CACHE_LIMIT=1024;
const contextCache=new Map();
const SETTLEMENT_CELL_LIMIT_PER_CLASS=4;
const SETTLEMENT_RESULT_LIMIT_PER_CLASS=2;
const SETTLEMENT_QUERY_CACHE_LIMIT=128;
const settlementQueryCache=new Map();
const poiCellCache=new Map();
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
function namesFor(seed,type,x,y,meta){
  const input={...(meta||{}),type,id:String(meta?.id||[type,x,y].join("|")),x:String(x),y:String(y)};
  try{
    const canonical=window.PlaceNaming?.descriptor?.(seed,input);
    if(canonical)return Object.freeze({
      name:String(canonical.name),authority:String(canonical.authority||"PlaceNaming"),
      namingCultureKey:canonical.namingCultureKey||null,
      nameGenerationVersion:Number(canonical.nameGenerationVersion||0),
      identityKey:canonical.identityKey||null
    });
  }catch(_){}
  const h=hash32(String(seed)+"|destination-name|"+type+"|"+String(x)+"|"+String(y)),stem=NAME_STEMS[h%NAME_STEMS.length],suffixes=TYPE_SUFFIX[type]||["Place"],suffix=suffixes[(h>>>8)%suffixes.length];
  return Object.freeze({name:stem+" "+suffix,authority:"SEED fallback pending canonical toponymy",namingCultureKey:"legacy",nameGenerationVersion:0,identityKey:null});
}
function safeTerrain(seed,x,y){try{return String(window.GeographyFoundation?.getTerrainType?.(seed,String(x),String(y))||"water");}catch(_){return "water";}}
function safeEnvironment(seed,x,y){try{return window.GeographyFoundation?.environment?.(seed,String(x),String(y))||Object.freeze({elevationMeters:0,moisturePercent:50,biome:"Unknown"});}catch(_){return Object.freeze({elevationMeters:0,moisturePercent:50,biome:"Unknown"});}}
function meterCoordinate(tileValue){
  const tile=BigInt(String(tileValue));
  return Number.isInteger(TILE_METERS)?(tile*BigInt(TILE_METERS)).toString():String(Number(tile)*TILE_METERS);
}
function samplePoint(seed,x,y){
  try{
    const field=window.WorldField?.sample?.(seed,meterCoordinate(x),meterCoordinate(y));
    if(field)return Object.freeze({
      x:String(x),y:String(y),terrain:String(field.surfaceType||"water"),
      elevationMeters:Number(field.elevationMeters)||0,moisturePercent:Number(field.moisturePercent)||0,
      biome:String(field.biome||""),waterKind:field.waterKind||null
    });
  }catch(_){}
  const terrain=safeTerrain(seed,x,y),env=safeEnvironment(seed,x,y);
  return Object.freeze({x:String(x),y:String(y),terrain,elevationMeters:Number(env.elevationMeters)||0,moisturePercent:Number(env.moisturePercent)||0,biome:String(env.biome||""),waterKind:null});
}
function contextAt(seed,xValue,yValue){
  const x=BigInt(String(xValue)),y=BigInt(String(yValue)),cacheKey=String(seed)+"|"+x+"|"+y;
  if(contextCache.has(cacheKey))return contextCache.get(cacheKey);
  const step=BigInt(SAMPLE_STEP_TILES),nearOffsets=[[0n,0n],[step,0n],[-step,0n],[0n,step],[0n,-step]];
  const near=nearOffsets.map(([dx,dy])=>samplePoint(seed,x+dx,y+dy)),center=near[0],elevations=near.map(p=>p.elevationMeters);
  const waterNear=near.filter(p=>p.terrain==="water").length;
  const forestNear=near.filter(p=>p.terrain==="forest"||/forest|woodland/i.test(p.biome)).length;
  const rockNear=near.filter(p=>p.terrain==="rock").length;
  const openNear=near.filter(p=>["grass","farmland","dirt","sand"].includes(p.terrain)).length;
  const cardinals=near.slice(1,5),waterArms=cardinals.filter(p=>p.terrain==="water").length,landNear=near.length-waterNear;
  const oppositeWater=(cardinals[0].terrain==="water"&&cardinals[1].terrain==="water")||(cardinals[2].terrain==="water"&&cardinals[3].terrain==="water");
  const east=cardinals[0].elevationMeters,west=cardinals[1].elevationMeters,south=cardinals[2].elevationMeters,north=cardinals[3].elevationMeters,c=center.elevationMeters;
  const sampleMeters=Math.max(1,SAMPLE_STEP_TILES*TILE_METERS),gradientX=(east-west)/(2*sampleMeters),gradientY=(south-north)/(2*sampleMeters);
  const slopeDegrees=Math.atan(Math.hypot(gradientX,gradientY))*180/Math.PI,slopeMeters=Math.max(...elevations)-Math.min(...elevations);
  const xSaddle=Math.min(Math.min(east,west)-c,c-Math.max(north,south)),ySaddle=Math.min(Math.min(north,south)-c,c-Math.max(east,west));
  const saddleStrength=Math.max(0,xSaddle,ySaddle),passSignal=clamp((saddleStrength-2)/24,0,1)*clamp((slopeMeters-34)/150,0,1),cliffSignal=clamp((slopeDegrees-31)/25,0,1)*clamp((slopeMeters-72)/220,0,1);
  const result=Object.freeze({
    center,near:freezeArray(near),far:Object.freeze([]),waterNear,forestNear,rockNear,openNear,
    roadNear:false,waterArms,landNear,oppositeWater,slopeMeters,
    maxElevationMeters:Math.max(...elevations),minElevationMeters:Math.min(...elevations),
    slopeDegrees:Number(slopeDegrees.toFixed(3)),passSignal:Number(passSignal.toFixed(4)),
    cliffSignal:Number(cliffSignal.toFixed(4)),landformKind:passSignal>=.12?"pass":cliffSignal>=.22?"cliff":slopeDegrees>=8?"slope":"plain"
  });
  contextCache.set(cacheKey,result);if(contextCache.size>CONTEXT_CACHE_LIMIT)contextCache.delete(contextCache.keys().next().value);
  return result;
}
function rawCandidate(seed,type,x,y,score,importance,radius,description,tags,evidence){return Object.freeze({
  id:"WDEST|"+String(type).toUpperCase()+"|"+hash32(String(seed)+"|"+type+"|"+String(x)+"|"+String(y)).toString(16).padStart(8,"0"),
  type,category:categoryForType(type),center:Object.freeze({x:String(x),y:String(y)}),score:Number(score.toFixed(6)),importance:clamp(importance,1,5),footprintRadiusMeters:Math.max(20,Math.round(radius)),description:String(description),activityTags:Object.freeze((tags||[]).map(String)),evidence:Object.freeze({...evidence}),source:"bounded destination cell",worldAuthority:true
});}
function poiCandidatesForCell(seed,cxValue,cyValue){
  const cx=BigInt(String(cxValue)),cy=BigInt(String(cyValue)),cacheKey=String(seed)+"|"+cx+"|"+cy;
  if(poiCellCache.has(cacheKey))return poiCellCache.get(cacheKey);
  const size=BigInt(POI_CELL_TILES),baseX=cx*size,baseY=cy*size;
  const jx=BigInt(Math.round((unit(seed,"jx:"+cx+":"+cy)*.72+.14)*POI_CELL_TILES)),jy=BigInt(Math.round((unit(seed,"jy:"+cx+":"+cy)*.72+.14)*POI_CELL_TILES));
  const x=baseX+jx,y=baseY+jy,ctx=contextAt(seed,x,y),c=ctx.center,h=unit(seed,"history:"+cx+":"+cy),g=unit(seed,"activity:"+cx+":"+cy),out=[];
  let roadNear=false;
  if(h>.83||(ctx.waterNear>=2&&h>.58)){let routeTerrain="";try{routeTerrain=safeTerrain(seed,x,y);}catch(_){}roadNear=["road","bridge"].includes(routeTerrain);}
  const ev={terrain:c.terrain,elevationMeters:c.elevationMeters,biome:c.biome,waterSamples:ctx.waterNear,forestSamples:ctx.forestNear,rockSamples:ctx.rockNear,openSamples:ctx.openNear,slopeMeters:Math.round(ctx.slopeMeters),roadNear,waterArms:ctx.waterArms};
  if(c.terrain==="water"){
    if(c.waterKind==="river"&&ctx.waterArms>=3&&ctx.landNear>=2)out.push(rawCandidate(seed,"confluence",x,y,.90,3,420,"A meeting of seeded river corridors with multiple approach arms.",["water","navigation","river"],ev));
    else if(c.waterKind==="river"&&(ctx.oppositeWater||ctx.waterArms>=2))out.push(rawCandidate(seed,"river-location",x,y,.78,2,500,"A notable reach on the continuous seeded river field.",["water","river"],ev));
    if(c.waterKind==="river"&&ctx.slopeMeters>=120&&ctx.landNear>=2)out.push(rawCandidate(seed,"waterfall",x,y,.86,3,260,"A steep seeded river transition where local relief drops sharply.",["water","landmark","river"],ev));
  }else{
    if(ctx.cliffSignal>=.22||(ctx.slopeMeters>=180&&c.elevationMeters>=500))out.push(rawCandidate(seed,"cliff",x,y,.79,3,360,"A steep exposed escarpment derived from the continuous landform field.",["rock","landmark"],ev));
    else if((c.terrain==="rock"||ctx.rockNear>=3)&&ctx.slopeMeters>=80)out.push(rawCandidate(seed,"outcrop",x,y,.72,2,230,"An exposed rocky outcrop supported by seeded terrain and relief.",["rock","gathering"],ev));
    if(ctx.passSignal>=.12&&c.elevationMeters>=320)out.push(rawCandidate(seed,"mountain-pass",x,y,.74,3,460,"A traversable seeded highland saddle identified by the landform field.",["travel","highland"],ev));
    if((c.terrain==="rock"||ctx.rockNear>=2)&&ctx.slopeMeters>=180&&unit(seed,"cave:"+cx+":"+cy)>.72)out.push(rawCandidate(seed,"cave",x,y,.70,2,140,"A cave site where rocky relief supports a plausible opening.",["rock","shelter"],ev));
    if(ctx.forestNear>=4)out.push(rawCandidate(seed,"forest",x,y,.68+ctx.forestNear/100,2,700,"A notable grove or forest pocket grounded in the local biome.",["woodland","gathering"],ev));
  }
  if(c.terrain!=="water"&&(ctx.waterNear>=2||ctx.waterArms>=1))out.push(rawCandidate(seed,"fishing",x,y,.65+ctx.waterNear/20,2,620,"A fishing area placed beside reachable seeded water.",["fishing","water-access"],ev));
  if(c.terrain!=="water"&&(ctx.forestNear>=3||["Woodland","Highland"].includes(c.biome))&&!roadNear&&g>.18)out.push(rawCandidate(seed,"hunting",x,y,.61+ctx.forestNear/20,2,1100,"A hunting area derived from wilderness cover, relief and low route pressure.",["hunting","wilderness"],ev));
  if(c.terrain!=="water"&&ctx.openNear>=4&&g>.36)out.push(rawCandidate(seed,"grazing",x,y,.60+ctx.openNear/30,1,900,"Open country suitable for grazing, derived from seeded ground cover.",["grazing","open-country"],ev));
  if(c.terrain!=="water"&&(ctx.forestNear>=3||ctx.rockNear>=2)&&g>.42)out.push(rawCandidate(seed,"gathering",x,y,.58+(ctx.forestNear+ctx.rockNear)/40,1,520,"A gathering area tied to local woodland or exposed material resources.",["gathering","resources"],ev));
  if(c.terrain!=="water"&&c.elevationMeters<2600&&(roadNear||["rock","dirt","grass"].includes(c.terrain))&&h>.83){
    const historicType=roadNear?(ctx.slopeMeters>450?"tower":"ruin"):(ctx.slopeMeters>650?"fort":"ruin");
    out.push(rawCandidate(seed,historicType,x,y,.69+h/10,historicType==="fort"?3:2,historicType==="fort"?360:240,roadNear?"A historical site on a plausible seeded travel approach.":"A historical site on suitable dry terrain with deterministic regional context.",["historical",roadNear?"route-access":"terrain-access"],ev));
  }
  if((c.terrain==="bridge"||roadNear)&&ctx.waterNear>=2&&h>.58)out.push(rawCandidate(seed,"bridge",x,y,.76,2,180,"A strategically notable crossing where seeded route and water geography meet.",["crossing","route","water"],ev));
  out.sort((a,b)=>b.score-a.score||b.importance-a.importance||a.id.localeCompare(b.id));
  const result=Object.freeze(out.slice(0,4));
  poiCellCache.set(cacheKey,result);
  if(poiCellCache.size>POI_CELL_CACHE_LIMIT)poiCellCache.delete(poiCellCache.keys().next().value);
  return result;
}
function settlementRaw(record){
  const type=settlementType(record),importance=settlementImportance(record);
  return Object.freeze({id:String(record.id),type,category:categoryForType(type),center:Object.freeze({x:String(record.center.x),y:String(record.center.y)}),score:1+importance/10,importance,footprintRadiusMeters:settlementRadius(record),description:type==="capital"?"National political center from the canonical settlement hierarchy.":"Canonical "+type+" from the SEED settlement hierarchy.",activityTags:Object.freeze(["settlement",String(record.roadNetworkRole||"local-node")]),evidence:Object.freeze({terrain:String(record.center.terrain||""),settlementClass:String(record.classId||""),importanceClass:String(record.importanceClass||""),generationCellId:String(record.generationCell?.id||"")}),source:String(record.authority||"SettlementArchetypes"),worldAuthority:true,countryId:String(record.countryId||""),regionId:String(record.regionId||""),canonicalName:String(record.name||"")});
}
function enrich(seed,raw){
  const x=raw.center.x,y=raw.center.y,coordinates=coordinatesFor(seed,x,y);
  let country=null,region=null;try{country=raw.countryId?window.PoliticalGeography?.countryById?.(seed,raw.countryId)||null:window.PoliticalGeography?.ownerAt?.(seed,x,y)||null;}catch(_){}try{region=window.RegionProfile?.descriptorAt?.(seed,x,y)||window.RegionProfile?.at?.(seed,x,y)||null;}catch(_){}
  const type=raw.type,countryId=String(raw.countryId||country?.id||""),regionId=String(raw.regionId||region?.id||"");
  const nameInfo=namesFor(seed,type,x,y,{id:String(raw.id),countryId,regionId});
  const resolvedName=raw.canonicalName&&Number(nameInfo.nameGenerationVersion||0)===0?String(raw.canonicalName):String(nameInfo.name);
  const terrain=raw.evidence?.terrain||safeTerrain(seed,x,y),walkable=terrain!=="water",roadAccessClass=raw.type==="capital"||raw.type==="city"?"primary":raw.category==="cities"?"regional":raw.evidence?.roadNear?"local-road":raw.type==="bridge"?"crossing":"off-road";
  const defaultDiscoveryState=raw.importance>=3||["capital","city","town"].includes(type)?"known":"discoverable";
  return Object.freeze({...raw,name:resolvedName,namingAuthority:nameInfo.authority,namingCultureKey:nameInfo.namingCultureKey||null,nameGenerationVersion:Number(nameInfo.nameGenerationVersion||0),namingIdentityKey:nameInfo.identityKey||null,coordinates,countryId,countryName:String(country?.name||""),regionId,regionName:String(region?.name||""),discoverability:Object.freeze({defaultState:defaultDiscoveryState,requiresLocalMaterialization:false}),navigation:Object.freeze({suitable:walkable||raw.category==="water",walkableAnchor:walkable,roadAccessClass,roadGraphAuthority:window.WorldRoadGraph?"WorldRoadGraph":"local geography fallback",localChunkRequired:false}),strategicVisibilityTier:strategicTier(type,raw.importance),seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true,localMaterialized:false,authority:"Campaign SEED + fixed geography + canonical settlement hierarchy"});
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
function settlementClassesForRadius(radiusMeters){
  const classes=["national-capital","city","town"];
  if(radiusMeters<=50000)classes.push("village");
  if(radiusMeters<=20000)classes.push("hamlet");
  return classes;
}
function orderedCellsForClass(origin,classId,radiusMeters){
  const spec=window.SettlementArchetypes?.HIERARCHY_CLASS_SPECS?.[classId];
  if(!spec)return Object.freeze([]);
  const size=BigInt(spec.cellTiles),cx=floorDiv(origin.x,size),cy=floorDiv(origin.y,size);
  const radiusTiles=BigInt(Math.ceil(radiusMeters/TILE_METERS)),maxRing=Math.max(0,Math.ceil(Number(radiusTiles)/Number(size))),cells=[];
  for(let oy=-maxRing;oy<=maxRing;oy++)for(let ox=-maxRing;ox<=maxRing;ox++)cells.push({cx:cx+BigInt(ox),cy:cy+BigInt(oy),d2:ox*ox+oy*oy});
  cells.sort((a,b)=>a.d2-b.d2||(a.cy<b.cy?-1:a.cy>b.cy?1:a.cx<b.cx?-1:a.cx>b.cx?1:0));
  return Object.freeze(cells.slice(0,SETTLEMENT_CELL_LIMIT_PER_CLASS));
}
function boundedSettlementQuery(seed,origin,radiusMeters){
  const classes=settlementClassesForRadius(radiusMeters),cacheKey=[seed,origin.x,origin.y,Math.round(radiusMeters),classes.join(",")].join("|");
  if(settlementQueryCache.has(cacheKey))return settlementQueryCache.get(cacheKey);
  const records=[],seen=new Set();let queryCellCount=0;
  const radiusTiles=BigInt(Math.ceil(radiusMeters/TILE_METERS)),ox=BigInt(origin.x),oy=BigInt(origin.y),minX=ox-radiusTiles,maxX=ox+radiusTiles,minY=oy-radiusTiles,maxY=oy+radiusTiles;
  if(classes.includes("national-capital")){
    try{
      const caps=window.SettlementArchetypes?.canonicalSettlementsInBounds?.(seed,{minX:String(minX),maxX:String(maxX),minY:String(minY),maxY:String(maxY)},["national-capital"]);
      queryCellCount+=Number(caps?.diagnostics?.queryCellCount||0);
      for(const record of caps?.settlements||[])if(!seen.has(record.id)){seen.add(record.id);records.push(record);}
    }catch(_){}
  }
  for(const classId of classes.filter(x=>x!=="national-capital")){
    let accepted=0;
    for(const cell of orderedCellsForClass(origin,classId,radiusMeters)){
      queryCellCount++;
      let record=null;try{record=window.SettlementArchetypes?.canonicalSettlementAtCell?.(seed,classId,cell.cx,cell.cy)||null;}catch(_){record=null;}
      if(!record||seen.has(record.id)||tileDistanceMeters(origin,record.center)>radiusMeters)continue;
      seen.add(record.id);records.push(record);accepted++;
      if(accepted>=SETTLEMENT_RESULT_LIMIT_PER_CLASS)break;
    }
  }
  records.sort((a,b)=>tileDistanceMeters(origin,a.center)-tileDistanceMeters(origin,b.center)||String(a.id).localeCompare(String(b.id)));
  const result=Object.freeze({settlements:Object.freeze(records),diagnostics:Object.freeze({queryCellCount,bounded:true,classes:Object.freeze(classes.slice()),cellLimitPerClass:SETTLEMENT_CELL_LIMIT_PER_CLASS,resultLimitPerClass:SETTLEMENT_RESULT_LIMIT_PER_CLASS,cacheHit:false})});
  settlementQueryCache.set(cacheKey,result);if(settlementQueryCache.size>SETTLEMENT_QUERY_CACHE_LIMIT)settlementQueryCache.delete(settlementQueryCache.keys().next().value);
  return result;
}
function queryNearby(seedValue,originValue,optionsValue){
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now(),seed=String(seedValue==null?"":seedValue),origin=normalizeOrigin(seed,originValue||{}),options=optionsValue||{};
  const radiusMeters=clamp(options.radiusMeters==null?40000:options.radiusMeters,250,MAX_QUERY_RADIUS_METERS),maxResults=Math.max(1,Math.min(MAX_QUERY_RESULTS,Math.floor(Number(options.maxResults)||16))),minImportance=clamp(options.minImportance||1,1,5),categories=normalizeCategories(options.categories||options.category),types=normalizeCategories(options.types||options.type);
  const radiusTiles=BigInt(Math.ceil(radiusMeters/TILE_METERS)),ox=BigInt(origin.x),oy=BigInt(origin.y),minX=ox-radiusTiles,maxX=ox+radiusTiles,minY=oy-radiusTiles,maxY=oy+radiusTiles;
  const phaseNow=()=>typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const settlementStarted=phaseNow(),settlementQuery=boundedSettlementQuery(seed,origin,radiusMeters),settlementEnded=phaseNow(),settlementClasses=settlementQuery.diagnostics.classes;
  const raw=[];for(const record of settlementQuery.settlements||[])raw.push(settlementRaw(record));
  const minCx=floorDiv(minX,POI_CELL_TILES),maxCx=floorDiv(maxX,POI_CELL_TILES),minCy=floorDiv(minY,POI_CELL_TILES),maxCy=floorDiv(maxY,POI_CELL_TILES),cells=[];
  const ccx=floorDiv(ox,POI_CELL_TILES),ccy=floorDiv(oy,POI_CELL_TILES);
  for(let cy=minCy;cy<=maxCy;cy++)for(let cx=minCx;cx<=maxCx;cx++){const dx=Number(cx-ccx),dy=Number(cy-ccy);cells.push({cx,cy,d:dx*dx+dy*dy});}
  cells.sort((a,b)=>{
    if(a.d!==b.d)return a.d-b.d;
    if(a.cy!==b.cy)return a.cy<b.cy?-1:1;
    if(a.cx!==b.cx)return a.cx<b.cx?-1:1;
    return 0;
  });const boundedCells=cells.slice(0,Math.min(MAX_QUERY_CELLS,ACTIVE_POI_QUERY_CELLS));
  const poiStarted=phaseNow();
  for(const cell of boundedCells)raw.push(...poiCandidatesForCell(seed,cell.cx,cell.cy));
  const poiEnded=phaseNow(),filterStarted=phaseNow();
  const settlementAnchors=raw.filter(item=>["hamlet","village","town","city","capital"].includes(item.type));
  const unique=new Map();for(const rawItem of raw){let item=rawItem;const distance=tileDistanceMeters(origin,item.center);if(distance>radiusMeters+item.footprintRadiusMeters)continue;if(item.importance<minImportance)continue;if(categories&&!categories.has(item.category))continue;if(types&&!types.has(item.type))continue;if(item.type==="hunting"){let nearest=Infinity;for(const settlement of settlementAnchors)nearest=Math.min(nearest,tileDistanceMeters(item.center,settlement.center));if(nearest<1800)continue;item=Object.freeze({...item,evidence:Object.freeze({...item.evidence,settlementPressureMeters:Number.isFinite(nearest)?Number(nearest.toFixed(1)):null})});}const prev=unique.get(item.id);if(!prev||distance<prev.distance)unique.set(item.id,{item,distance});}
  const ranked=[...unique.values()].sort((a,b)=>a.distance-b.distance||b.item.importance-a.item.importance||b.item.score-a.item.score||a.item.id.localeCompare(b.item.id)),filterEnded=phaseNow(),enrichStarted=phaseNow();
  const results=[];for(const entry of ranked){const item=enrich(seed,entry.item);if(!discoveredPass(item,options))continue;const dir=bearing(origin,item.center);results.push(Object.freeze({...item,distanceMeters:Number(entry.distance.toFixed(2)),bearingDegrees:dir.degrees,directionLabel:dir.label}));if(results.length>=maxResults)break;}
  const ended=phaseNow();
  return Object.freeze({seed,origin,radiusMeters,results:Object.freeze(results),diagnostics:Object.freeze({version:VERSION,queryMs:Number((ended-started).toFixed(3)),phaseMs:Object.freeze({settlements:Number((settlementEnded-settlementStarted).toFixed(3)),poi:Number((poiEnded-poiStarted).toFixed(3)),filterRank:Number((filterEnded-filterStarted).toFixed(3)),enrich:Number((ended-enrichStarted).toFixed(3))}),queryCellCount:boundedCells.length,maxQueryCells:MAX_QUERY_CELLS,activePoiQueryCellLimit:ACTIVE_POI_QUERY_CELLS,settlementQueryCellCount:Number(settlementQuery.diagnostics?.queryCellCount||0),settlementClasses:Object.freeze(settlementClasses.slice()),poiCellCacheSize:poiCellCache.size,poiCellCacheLimit:POI_CELL_CACHE_LIMIT,candidateCount:raw.length,resultCount:results.length,bounded:true,fullWorldScan:false,localChunkMaterialization:false,descriptorOnly:true,seedOnly:true,cameraIndependent:true,viewportIndependent:true})});
}
function poiCell(seedValue,cxValue,cyValue){
  const seed=String(seedValue==null?"":seedValue),cx=String(cxValue),cy=String(cyValue);
  const results=poiCandidatesForCell(seed,cx,cy);
  return Object.freeze({
    seed,cx,cy,results,
    diagnostics:Object.freeze({
      version:VERSION,queryCellCount:1,maxQueryCells:LOCAL_POI_CELL_QUERY_LIMIT,
      resultCount:results.length,bounded:true,fullWorldScan:false,localChunkMaterialization:false,
      descriptorOnly:true,seedOnly:true,cameraIndependent:true,viewportIndependent:true
    })
  });
}
function descriptorById(seedValue,idValue,originValue,optionsValue){const id=String(idValue||"");if(!id)return null;const query=queryNearby(seedValue,originValue||{x:"0",y:"0"},{...(optionsValue||{}),radiusMeters:optionsValue?.radiusMeters||MAX_QUERY_RADIUS_METERS,maxResults:MAX_QUERY_RESULTS});return query.results.find(item=>item.id===id)||null;}
function signature(query){return hash32((query?.results||[]).map(item=>[item.id,item.type,item.center.x,item.center.y,item.countryId,item.regionId,item.importance].join(":")).join("|")).toString(16).padStart(8,"0");}
function verify(seedValue,originValue){const seed=String(seedValue==null?"":seedValue),origin=normalizeOrigin(seed,originValue||{x:"0",y:"0"}),a=queryNearby(seed,origin,{radiusMeters:80000,maxResults:32}),b=queryNearby(seed,origin,{radiusMeters:80000,maxResults:32}),sa=signature(a),sb=signature(b),settlement=a.results.some(x=>["hamlet","village","town","city","capital"].includes(x.type)),nonSettlement=a.results.some(x=>!["hamlet","village","town","city","capital"].includes(x.type));return Object.freeze({pass:sa===sb&&settlement&&nonSettlement&&a.diagnostics.bounded&&!a.diagnostics.fullWorldScan&&!a.diagnostics.localChunkMaterialization,seed,signatureA:sa,signatureB:sb,deterministic:sa===sb,settlement,nonSettlement,query:a});}

window.WorldDestinations=Object.freeze({VERSION,TILE_METERS,POI_CELL_TILES,MAX_QUERY_RADIUS_METERS,MAX_QUERY_RESULTS,MAX_QUERY_CELLS,ACTIVE_POI_QUERY_CELLS,LOCAL_POI_CELL_QUERY_LIMIT,POI_CELL_CACHE_LIMIT,CONTEXT_CACHE_LIMIT,SETTLEMENT_CELL_LIMIT_PER_CLASS,SETTLEMENT_RESULT_LIMIT_PER_CLASS,SETTLEMENT_QUERY_CACHE_LIMIT,queryNearby,poiCell,descriptorById,verify,signature});
})();
