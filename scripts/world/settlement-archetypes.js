(function(){
"use strict";

const VERSION=2;
const SUPPORTED_CLASSES=Object.freeze(["hamlet","village","town","city","national-capital"]);
const CLASS_SCALE=Object.freeze({
  hamlet:Object.freeze({population:[35,140],road:0.26,publicSpace:0.18,market:0.16,defense:0.18}),
  village:Object.freeze({population:[120,620],road:0.38,publicSpace:0.30,market:0.30,defense:0.26}),
  town:Object.freeze({population:[550,3200],road:0.58,publicSpace:0.48,market:0.56,defense:0.42}),
  city:Object.freeze({population:[2800,18000],road:0.78,publicSpace:0.68,market:0.74,defense:0.58}),
  "national-capital":Object.freeze({population:[14000,65000],road:0.96,publicSpace:0.94,market:0.90,defense:0.82})
});
const cache=new Map();
const catalogCache=new Map();
const proofCache=new Map();
const HIERARCHY_VERSION=1;
const REGION_CELL_SIZE_FALLBACK=8192;
const HIERARCHY_TILE_METERS=Math.max(0.001,Number(WorldStandards.TILE_METERS||2));
const HIERARCHY_QUERY_CELL_LIMIT=225;
const HIERARCHY_CLASS_ORDER=Object.freeze(["city","town","village","hamlet"]);
const HIERARCHY_CLASS_SPECS=Object.freeze({
  city:Object.freeze({
    cellTiles:Math.max(1024,Number(WorldStandards.CITY_CELL_SIZE_TILES||16384)),
    jitterTiles:Math.max(0,Number(WorldStandards.CITY_JITTER_TILES||1024)),
    minSameClassMeters:Math.max(12000,Number(WorldStandards.MIN_CITY_CENTER_DISTANCE_METERS||20480)),
    higherClearanceMeters:0,
    basePresence:0.24,
    suitabilityPresence:0.52
  }),
  town:Object.freeze({
    cellTiles:8192,jitterTiles:640,minSameClassMeters:12200,higherClearanceMeters:7000,
    basePresence:0.34,suitabilityPresence:0.50
  }),
  village:Object.freeze({
    cellTiles:Math.max(1024,Number(WorldStandards.VILLAGE_CELL_SIZE_TILES||2200)),
    jitterTiles:Math.max(0,Number(WorldStandards.VILLAGE_JITTER_TILES||100)),
    minSameClassMeters:Math.max(3000,Number(WorldStandards.MIN_VILLAGE_DISTANCE_METERS||3600)),
    higherClearanceMeters:3000,
    basePresence:0.56,
    suitabilityPresence:0.36
  }),
  hamlet:Object.freeze({
    cellTiles:1100,jitterTiles:90,minSameClassMeters:1650,higherClearanceMeters:1400,
    basePresence:0.44,suitabilityPresence:0.36
  })
});
const HIERARCHY_NAME_START=Object.freeze(["Alder","Ash","Bright","Cedar","Dawn","Elder","Falcon","Green","Grey","High","Iron","Lake","Oak","Raven","Red","River","Silver","Stone","Thorn","West","White","Wolf"]);
const HIERARCHY_NAME_END=Object.freeze({
  town:Object.freeze(["Cross","Ford","Market","Bridge","Gate","Reach","Haven","Watch","Hold","Port"]),
  hamlet:Object.freeze(["stead","wick","field","brook","wood","mere","dale","moor"])
});
const hierarchyRawCache=new Map();
const hierarchyAcceptedCache=new Map();
const hierarchyPlanetCache=new Map();
const hierarchyCapitalCache=new Map();

function hierarchyFloorDiv(value,divisor){
  const v=BigInt(String(value)),d=BigInt(String(divisor));
  let q=v/d,r=v%d;if(r!==0n&&v<0n)q-=1n;return q;
}
function hierarchyCellFor(classId,x,y){
  const spec=HIERARCHY_CLASS_SPECS[classId];
  if(!spec)return null;
  const size=BigInt(spec.cellTiles);
  return Object.freeze({x:hierarchyFloorDiv(x,size),y:hierarchyFloorDiv(y,size)});
}
function hierarchyDistanceMeters(a,b){
  const dx=Number(BigInt(String(a.x))-BigInt(String(b.x)))*HIERARCHY_TILE_METERS;
  const dy=Number(BigInt(String(a.y))-BigInt(String(b.y)))*HIERARCHY_TILE_METERS;
  return Math.hypot(dx,dy);
}
function hierarchyCoordinateDiagnostics(seed,xValue,yValue){
  const x=String(xValue),y=String(yValue);
  const registeredMeters=Object.freeze({
    east:Number(BigInt(x))*HIERARCHY_TILE_METERS,
    north:Number(BigInt(y))*HIERARCHY_TILE_METERS
  });
  let latitudeRadians=null,longitudeRadians=null,latitudeDegrees=null,longitudeDegrees=null;
  try{
    const pg=window.PlanetGeography;
    if(pg?.create){
      let instance=hierarchyPlanetCache.get(seed)||null;
      if(!instance){instance=pg.create(seed);hierarchyPlanetCache.set(seed,instance);}
      const radius=Math.max(1,Number(pg.DEFAULT_WORLD_RADIUS_METERS||637100));
      const geo=instance.worldLatLonForTile(x,y,HIERARCHY_TILE_METERS,radius);
      latitudeRadians=Number(geo.latitudeRadians);
      longitudeRadians=Number(geo.longitudeRadians);
      latitudeDegrees=Number(geo.latitudeDegrees);
      longitudeDegrees=Number(geo.longitudeDegrees);
    }
  }catch(_){}
  return Object.freeze({
    tile:Object.freeze({x,y}),registeredMeters,
    latitudeRadians,longitudeRadians,latitudeDegrees,longitudeDegrees,
    authority:"SeedCoordinateFabric/PlanetGeography registration"
  });
}
function hierarchyRoadNetworkRole(record){
  const importance=String(record?.importanceClass||record?.classId||"");
  if(importance==="national-capital")return "national-hub";
  if(importance==="major-city")return "primary-hub";
  if(record?.classId==="city")return "primary-node";
  if(record?.classId==="town")return "secondary-node";
  if(record?.classId==="village")return "local-node";
  return "feeder-node";
}
function hierarchyPriority(record){
  const importance=String(record?.importanceClass||record?.classId||"");
  if(importance==="national-capital")return 5;
  if(importance==="major-city")return 4;
  if(record?.classId==="city")return 3;
  if(record?.classId==="town")return 2;
  if(record?.classId==="village")return 1;
  return 0;
}
function hierarchyTerrainScore(terrain){
  return ({road:1,bridge:0.96,farmland:0.94,grass:0.88,forest:0.70,dirt:0.68,mud:0.45,sand:0.40,rock:0.28,water:0})[String(terrain)]??0.55;
}
function hierarchySuitability(seed,classId,x,y,region,terrain,env){
  const identity=region?.identity||{};
  const elevation=Math.max(0,Number(env?.elevationMeters||0));
  const moisture=clamp01(Number(env?.moisturePercent||50)/100);
  const terrainScore=hierarchyTerrainScore(terrain);
  const route=clamp01(identity.transportAccessibility??0.45);
  const agriculture=clamp01(identity.agriculturalSuitability??0.45);
  const water=clamp01(identity.waterAccess??0.45);
  const resource=clamp01((identity.mineralPotential??0.4)*0.45+(identity.timberAvailability??0.4)*0.25+agriculture*0.30);
  const elevationScore=clamp01(1-elevation/2600);
  const seedSignal=unit(seed,"settlement-hierarchy:suitability:"+classId+":"+String(x)+":"+String(y));
  const classBias=classId==="city"
    ? route*0.34+water*0.15+resource*0.16+agriculture*0.09
    : classId==="town"
      ? route*0.28+agriculture*0.18+water*0.14+resource*0.14
      : agriculture*0.28+water*0.18+route*0.12+moisture*0.10;
  return clamp01(terrainScore*0.22+elevationScore*0.13+classBias+seedSignal*0.12);
}
function hierarchyName(seed,classId,cx,cy,region,fallback){
  if(fallback)return String(fallback);
  const key=classId+":"+String(cx)+":"+String(cy);
  const start=HIERARCHY_NAME_START[PRNG.foundationUint32(seed,"settlement-hierarchy:name:start:"+key)%HIERARCHY_NAME_START.length];
  const suffixes=HIERARCHY_NAME_END[classId]||HIERARCHY_NAME_END.hamlet;
  const end=suffixes[PRNG.foundationUint32(seed,"settlement-hierarchy:name:end:"+key)%suffixes.length];
  const regionLead=String(region?.name||"").replace(/\s+(Province|Region)$/i,"").trim();
  return (regionLead&&unit(seed,"settlement-hierarchy:name:region:"+key)>.56?regionLead+" ":"")+start+end;
}
function hierarchyCellMatches(classId,x,y,cx,cy){
  const cell=hierarchyCellFor(classId,x,y);
  return Boolean(cell&&cell.x===BigInt(String(cx))&&cell.y===BigInt(String(cy)));
}
function hierarchyLegalPoint(seed,classId,cx,cy,baseX,baseY){
  const spec=HIERARCHY_CLASS_SPECS[classId],step=Math.max(48,Math.floor(spec.cellTiles/10));
  const offsets=[
    [0,0],[step,0],[-step,0],[0,step],[0,-step],
    [step,step],[-step,step],[step,-step],[-step,-step],
    [step*2,0],[-step*2,0],[0,step*2],[0,-step*2]
  ];
  let best=null;
  for(const [dx,dy] of offsets){
    const x=(BigInt(String(baseX))+BigInt(dx)).toString(),y=(BigInt(String(baseY))+BigInt(dy)).toString();
    if(!hierarchyCellMatches(classId,x,y,cx,cy))continue;
    let owner=null,region=null,terrain="water",env=null;
    try{
      owner=PoliticalGeography.ownerAt(seed,x,y)||null;
      if(!owner)continue;
      terrain=GeographyFoundation.getTerrainType(seed,x,y);
      if(terrain==="water")continue;
      env=GeographyFoundation.environment(seed,x,y);
      region=RegionProfile.at(seed,x,y);
    }catch(_){continue;}
    if(!region)continue;
    const suitability=hierarchySuitability(seed,classId,x,y,region,terrain,env);
    const movement=Math.abs(dx)+Math.abs(dy);
    const score=suitability-movement/Math.max(1,spec.cellTiles*20);
    if(!best||score>best.score||(score===best.score&&(String(x)+"|"+String(y))<(best.x+"|"+best.y))){
      best={score,x,y,owner,region,terrain,env,suitability};
    }
  }
  return best;
}
function hierarchyRawCandidate(seedValue,classId,cxValue,cyValue){
  const seed=String(seedValue==null?"":seedValue),spec=HIERARCHY_CLASS_SPECS[classId];
  if(!spec)return null;
  const cx=BigInt(String(cxValue)),cy=BigInt(String(cyValue)),cacheKey=seed+"|"+classId+"|"+cx+"|"+cy;
  if(hierarchyRawCache.has(cacheKey))return hierarchyRawCache.get(cacheKey);
  let x=null,y=null,name=null,owner=null,region=null,terrain=null,env=null,suitability=0,source="canonical-cell";
  if(classId==="city"){
    let city=null;
    try{city=GeographyFoundation.cityAtCell(seed,cx,cy)||null;}catch(_){city=null;}
    if(!city){hierarchyRawCache.set(cacheKey,null);return null;}
    x=String(city.x);y=String(city.y);name=String(city.name||"");
    try{
      owner=PoliticalGeography.ownerAt(seed,x,y)||null;
      terrain=GeographyFoundation.getTerrainType(seed,x,y);
      env=GeographyFoundation.environment(seed,x,y);
      region=RegionProfile.at(seed,x,y);
    }catch(_){}
    if(!owner||!region||terrain==="water"){hierarchyRawCache.set(cacheKey,null);return null;}
    suitability=hierarchySuitability(seed,classId,x,y,region,terrain,env);
    source="GeographyFoundation.cityAtCell";
  }else if(classId==="village"){
    let village=null;
    try{village=GeographyFoundation.villageAtCell(seed,cx,cy)||null;}catch(_){village=null;}
    if(!village){hierarchyRawCache.set(cacheKey,null);return null;}
    x=String(village.x);y=String(village.y);name=String(village.name||"");
    try{
      owner=PoliticalGeography.ownerAt(seed,x,y)||null;
      terrain=GeographyFoundation.getTerrainType(seed,x,y);
      env=GeographyFoundation.environment(seed,x,y);
      region=RegionProfile.at(seed,x,y);
    }catch(_){}
    if(!owner||!region||terrain==="water"){hierarchyRawCache.set(cacheKey,null);return null;}
    suitability=hierarchySuitability(seed,classId,x,y,region,terrain,env);
    source="GeographyFoundation.villageAtCell";
  }else{
    const size=BigInt(spec.cellTiles),half=BigInt(Math.floor(spec.cellTiles/2));
    const key=classId+":"+cx+":"+cy;
    const jx=BigInt(Math.round((unit(seed,"settlement-hierarchy:jx:"+key)*2-1)*spec.jitterTiles));
    const jy=BigInt(Math.round((unit(seed,"settlement-hierarchy:jy:"+key)*2-1)*spec.jitterTiles));
    const baseX=(cx*size+half+jx).toString(),baseY=(cy*size+half+jy).toString();
    const legal=hierarchyLegalPoint(seed,classId,cx,cy,baseX,baseY);
    if(!legal){hierarchyRawCache.set(cacheKey,null);return null;}
    ({x,y,owner,region,terrain,env,suitability}=legal);
    name=hierarchyName(seed,classId,cx,cy,region,null);
  }
  const forcedStartingVillage=classId==="village"&&String(x)==="0"&&String(y)==="0";
  const candidateRank=unit(seed,"settlement-hierarchy:rank:"+classId+":"+cx+":"+cy);
  const presenceLimit=clamp01(spec.basePresence+spec.suitabilityPresence*suitability);
  if(!forcedStartingVillage&&candidateRank>presenceLimit){hierarchyRawCache.set(cacheKey,null);return null;}
  const competitionScore=clamp01(suitability*0.68+candidateRank*0.32);
  const importanceClass=classId==="city"&&suitability>=0.70&&competitionScore>=0.67?"major-city":classId;
  const id="HSET|"+classId.toUpperCase()+"|"+hashText(seed+"|"+classId+"|"+cx+"|"+cy);
  const generationCellId="HSC|"+classId.toUpperCase()+"|"+cx+"|"+cy;
  const carryingCapacity=clamp01(
    suitability*0.62+
    clamp01(region?.identity?.agriculturalSuitability??0.45)*0.14+
    clamp01(region?.identity?.transportAccessibility??0.45)*0.14+
    clamp01(region?.identity?.waterAccess??0.45)*0.10
  );
  const record=Object.freeze({
    id,name:hierarchyName(seed,classId,cx,cy,region,name),classId,importanceClass,
    role:forcedStartingVillage?"starting-village":importanceClass==="major-city"?"major-city":"local",
    center:Object.freeze({x:String(x),y:String(y),terrain:String(terrain||"")}),
    countryId:String(owner.id),regionId:String(region.id),
    generationCell:Object.freeze({id:generationCellId,classId,cellX:cx.toString(),cellY:cy.toString(),cellSizeTiles:spec.cellTiles}),
    coordinates:hierarchyCoordinateDiagnostics(seed,x,y),
    candidateRank:round(candidateRank,6),competitionScore:round(competitionScore,6),
    competitionKey:classId+":"+cx+":"+cy+":"+round(competitionScore,6),
    suitability:round(suitability,6),carryingCapacity:round(carryingCapacity,6),
    terrainValidity:Object.freeze({land:terrain!=="water",terrain:String(terrain||""),ownerMatch:true}),
    authority:"Campaign SEED + canonical settlement cell + fixed geography/politics",
    source,roadNetworkRole:hierarchyRoadNetworkRole({classId,importanceClass}),
    seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true,
    cacheRegenerationSignature:"HSET-"+hashText([HIERARCHY_VERSION,seed,classId,cx,cy,x,y,owner.id,region.id,importanceClass,round(suitability,4)].join("|"))
  });
  hierarchyRawCache.set(cacheKey,record);
  return record;
}
function hierarchySameClassWinner(seed,record){
  const spec=HIERARCHY_CLASS_SPECS[record.classId],cx=BigInt(record.generationCell.cellX),cy=BigInt(record.generationCell.cellY);
  for(let oy=-1n;oy<=1n;oy++)for(let ox=-1n;ox<=1n;ox++){
    if(ox===0n&&oy===0n)continue;
    const other=hierarchyRawCandidate(seed,record.classId,cx+ox,cy+oy);
    if(!other)continue;
    const distance=hierarchyDistanceMeters(record.center,other.center);
    if(distance+0.01>=spec.minSameClassMeters)continue;
    if(Number(other.competitionScore)>Number(record.competitionScore)+1e-9)return false;
    if(Math.abs(Number(other.competitionScore)-Number(record.competitionScore))<=1e-9&&String(other.id)<String(record.id))return false;
  }
  return true;
}
function hierarchyCapitalForRecord(seed,record){
  const countryId=String(record?.countryId||"");
  if(!countryId)return null;
  const cacheKey=String(seed)+"|"+countryId;
  if(hierarchyCapitalCache.has(cacheKey))return hierarchyCapitalCache.get(cacheKey);
  let result=null;
  try{
    const country=PoliticalGeography.countryById(seed,countryId)||null;
    if(country?.capital){
      result=Object.freeze({
        id:String(country.capital.id),name:String(country.capital.name),classId:"national-capital",importanceClass:"national-capital",
        role:"national-capital",center:Object.freeze({x:String(country.capital.x),y:String(country.capital.y),terrain:GeographyFoundation.getTerrainType(seed,country.capital.x,country.capital.y)}),
        countryId:String(country.id),regionId:String(RegionProfile.at(seed,country.capital.x,country.capital.y)?.id||""),
        generationCell:Object.freeze({id:"CAP|"+country.id,classId:"national-capital",cellX:null,cellY:null,cellSizeTiles:null}),
        coordinates:hierarchyCoordinateDiagnostics(seed,country.capital.x,country.capital.y),
        candidateRank:1,competitionScore:1,competitionKey:"capital:"+country.id,suitability:1,carryingCapacity:1,
        terrainValidity:Object.freeze({land:true,terrain:GeographyFoundation.getTerrainType(seed,country.capital.x,country.capital.y),ownerMatch:true}),
        authority:"PoliticalGeography.capital",source:"PoliticalGeography.capital",roadNetworkRole:"national-hub",
        seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true,
        cacheRegenerationSignature:"CAP-"+hashText(seed+"|"+country.id+"|"+country.capital.id+"|"+country.capital.x+"|"+country.capital.y)
      });
    }
  }catch(_){result=null;}
  hierarchyCapitalCache.set(cacheKey,result);
  return result;
}
function hierarchyNearbyRawWinners(seed,classId,point){
  const cell=hierarchyCellFor(classId,point.x,point.y);if(!cell)return [];
  const out=[];
  for(let oy=-1n;oy<=1n;oy++)for(let ox=-1n;ox<=1n;ox++){
    const raw=hierarchyRawCandidate(seed,classId,cell.x+ox,cell.y+oy);
    if(raw&&hierarchySameClassWinner(seed,raw))out.push(raw);
  }
  return out;
}
function hierarchyHigherClearancePass(seed,record){
  if(record?.role==="starting-village")return true;
  const capital=hierarchyCapitalForRecord(seed,record);
  if(record.classId==="city"){
    return !capital||capital.id===record.id||hierarchyDistanceMeters(record.center,capital.center)+0.01>=HIERARCHY_CLASS_SPECS.city.minSameClassMeters;
  }
  const blockers=[];
  if(capital)blockers.push(capital);
  for(const classId of record.classId==="town"?["city"]:record.classId==="village"?["city","town"]:["city","town","village"]){
    blockers.push(...hierarchyNearbyRawWinners(seed,classId,record.center));
  }
  const clearance=HIERARCHY_CLASS_SPECS[record.classId].higherClearanceMeters;
  return !blockers.some(other=>other.id!==record.id&&hierarchyDistanceMeters(record.center,other.center)+0.01<clearance);
}
function canonicalSettlementAtCell(seedValue,classIdValue,cxValue,cyValue){
  const seed=String(seedValue==null?"":seedValue),classId=String(classIdValue||"");
  if(!HIERARCHY_CLASS_SPECS[classId])return null;
  const cx=BigInt(String(cxValue)),cy=BigInt(String(cyValue)),key=seed+"|"+classId+"|"+cx+"|"+cy;
  if(hierarchyAcceptedCache.has(key))return hierarchyAcceptedCache.get(key);
  const raw=hierarchyRawCandidate(seed,classId,cx,cy);
  if(!raw||!hierarchySameClassWinner(seed,raw)||!hierarchyHigherClearancePass(seed,raw)){
    hierarchyAcceptedCache.set(key,null);return null;
  }
  hierarchyAcceptedCache.set(key,raw);return raw;
}
function canonicalSettlementAtPoint(seedValue,classIdValue,x,y){
  const classId=String(classIdValue||"");
  const cell=hierarchyCellFor(classId,x,y);
  return cell?canonicalSettlementAtCell(seedValue,classId,cell.x,cell.y):null;
}
function hierarchyBoundedCells(minX,maxX,minY,maxY,classId){
  const a=hierarchyCellFor(classId,minX,minY),b=hierarchyCellFor(classId,maxX,maxY);
  if(!a||!b)return Object.freeze([]);
  const centerX=(a.x+b.x)/2n,centerY=(a.y+b.y)/2n,cells=[];
  for(let cy=a.y-1n;cy<=b.y+1n;cy++)for(let cx=a.x-1n;cx<=b.x+1n;cx++){
    const dx=Number(cx-centerX),dy=Number(cy-centerY);
    cells.push({x:cx,y:cy,distance:dx*dx+dy*dy});
  }
  cells.sort((p,q)=>p.distance-q.distance||p.y<q.y?-1:p.y>q.y?1:p.x<q.x?-1:p.x>q.x?1:0);
  return Object.freeze(cells.slice(0,HIERARCHY_QUERY_CELL_LIMIT).map(cell=>Object.freeze({x:cell.x,y:cell.y})));
}
function canonicalSettlementsInBounds(seedValue,boundsValue,classesValue){
  const seed=String(seedValue==null?"":seedValue),bounds=boundsValue||{};
  let minX=BigInt(String(bounds.minX??"0")),maxX=BigInt(String(bounds.maxX??"0")),minY=BigInt(String(bounds.minY??"0")),maxY=BigInt(String(bounds.maxY??"0"));
  if(minX>maxX)[minX,maxX]=[maxX,minX];if(minY>maxY)[minY,maxY]=[maxY,minY];
  const requested=Array.isArray(classesValue)?classesValue.map(String):HIERARCHY_CLASS_ORDER.slice();
  const classes=[...new Set(requested.map(value=>value==="major-city"?"city":value).filter(value=>HIERARCHY_CLASS_SPECS[value]))];
  const records=[],seen=new Set();let queryCellCount=0;
  for(const classId of classes){
    const cells=hierarchyBoundedCells(minX,maxX,minY,maxY,classId);queryCellCount+=cells.length;
    for(const cell of cells){
      const record=canonicalSettlementAtCell(seed,classId,cell.x,cell.y);if(!record||seen.has(record.id))continue;
      const x=BigInt(record.center.x),y=BigInt(record.center.y);
      if(x<minX||x>maxX||y<minY||y>maxY)continue;
      seen.add(record.id);records.push(record);
    }
  }
  if(requested.includes("national-capital")||requested.includes("capital")){
    const samples=[[minX,minY],[maxX,minY],[minX,maxY],[maxX,maxY],[(minX+maxX)/2n,(minY+maxY)/2n]],countries=new Map();
    for(const [x,y] of samples)try{const country=PoliticalGeography.countryAt(seed,x.toString(),y.toString());if(country)countries.set(country.id,country);}catch(_){}
    for(const country of countries.values()){
      const cap=hierarchyCapitalForRecord(seed,{countryId:country.id});
      if(!cap||seen.has(cap.id))continue;
      const x=BigInt(cap.center.x),y=BigInt(cap.center.y);
      if(x<minX||x>maxX||y<minY||y>maxY)continue;
      seen.add(cap.id);records.push(cap);
    }
  }
  records.sort((a,b)=>hierarchyPriority(b)-hierarchyPriority(a)||a.id.localeCompare(b.id));
  const enriched=records.map(record=>{
    let nearestSame=null,nearestHigher=null;
    for(const other of records){
      if(other.id===record.id)continue;
      const d=hierarchyDistanceMeters(record.center,other.center);
      if(other.classId===record.classId&&(nearestSame==null||d<nearestSame))nearestSame=d;
      if(hierarchyPriority(other)>hierarchyPriority(record)&&(nearestHigher==null||d<nearestHigher))nearestHigher=d;
    }
    return Object.freeze({...record,
      nearestSameClassMeters:nearestSame==null?null:round(nearestSame,3),
      nearestHigherClassMeters:nearestHigher==null?null:round(nearestHigher,3)
    });
  });
  const classCounts={};for(const item of enriched)classCounts[item.importanceClass]=(classCounts[item.importanceClass]||0)+1;
  const signature="HIDX-"+hashText(enriched.map(item=>[item.id,item.classId,item.importanceClass,item.center.x,item.center.y,item.countryId,item.regionId].join(":")).join("|"));
  return Object.freeze({
    settlements:Object.freeze(enriched),
    diagnostics:Object.freeze({
      revision:"settlement-hierarchy-v"+HIERARCHY_VERSION,signature,classCounts:Object.freeze(classCounts),
      queryCellCount,boundedQueryCellLimit:HIERARCHY_QUERY_CELL_LIMIT*classes.length,bounded:true,fullWorldScan:false,
      seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true,
      requestedClasses:Object.freeze(requested.slice()),resolvedClasses:Object.freeze(classes.slice())
    })
  });
}
function canonicalHierarchySnapshot(seedValue,xValue,yValue,radiusMetersValue){
  const seed=String(seedValue==null?"":seedValue),x=BigInt(String(xValue??"0")),y=BigInt(String(yValue??"0"));
  const radiusMeters=Math.max(1000,Math.min(80000,Number(radiusMetersValue??10000))),radiusTiles=BigInt(Math.ceil(radiusMeters/HIERARCHY_TILE_METERS));
  const query=canonicalSettlementsInBounds(seed,{
    minX:(x-radiusTiles).toString(),maxX:(x+radiusTiles).toString(),minY:(y-radiusTiles).toString(),maxY:(y+radiusTiles).toString()
  },["national-capital","city","town","village"]);
  const settlements=query.settlements,cityClass=settlements.filter(item=>["national-capital","major-city","city"].includes(item.importanceClass));
  let minCityClassSpacingMeters=null,duplicateNearCount=0;
  for(let i=0;i<settlements.length;i++)for(let j=i+1;j<settlements.length;j++){
    const d=hierarchyDistanceMeters(settlements[i].center,settlements[j].center);
    if(cityClass.includes(settlements[i])&&cityClass.includes(settlements[j])&&(minCityClassSpacingMeters==null||d<minCityClassSpacingMeters))minCityClassSpacingMeters=d;
    if(d<50&&settlements[i].id!==settlements[j].id)duplicateNearCount++;
  }
  const requiredCitySpacing=Math.max(0,Number(HIERARCHY_CLASS_SPECS.city.minSameClassMeters||0));
  const densityScore=settlements.length?settlements.reduce((sum,item)=>sum+Number(item.carryingCapacity||0),0)/settlements.length:0;
  const centerTerrain=(()=>{try{return GeographyFoundation.getTerrainType(seed,x.toString(),y.toString())}catch(_){return "water"}})();
  return Object.freeze({
    seed,center:Object.freeze({x:x.toString(),y:y.toString()}),radiusMeters,
    revision:query.diagnostics.revision,signature:query.diagnostics.signature,settlements,
    classCounts:query.diagnostics.classCounts,settlementCount:settlements.length,
    cityClassCount:cityClass.length,minCityClassSpacingMeters:minCityClassSpacingMeters==null?null:round(minCityClassSpacingMeters,3),
    requiredCitySpacingMeters:requiredCitySpacing,cityClassSpacingPass:minCityClassSpacingMeters==null||minCityClassSpacingMeters+2>=requiredCitySpacing,
    duplicateNearCount,densityScore:round(densityScore,6),centerLand:centerTerrain!=="water",
    queryCellCount:query.diagnostics.queryCellCount,bounded:query.diagnostics.bounded,fullWorldScan:false,
    seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true
  });
}
function clearCanonicalHierarchyCache(){
  hierarchyRawCache.clear();hierarchyAcceptedCache.clear();hierarchyCapitalCache.clear();
  return Object.freeze({raw:0,accepted:0,capital:0,revision:"settlement-hierarchy-v"+HIERARCHY_VERSION});
}
function canonicalHierarchyProof(seedValue,xValue="0",yValue="0"){
  const seed=String(seedValue==null?"":seedValue),before=canonicalHierarchySnapshot(seed,xValue,yValue,50000);
  const radiusTiles=BigInt(Math.ceil(50000/HIERARCHY_TILE_METERS)),x=BigInt(String(xValue)),y=BigInt(String(yValue));
  const reverse=canonicalSettlementsInBounds(seed,{minX:(x-radiusTiles).toString(),maxX:(x+radiusTiles).toString(),minY:(y-radiusTiles).toString(),maxY:(y+radiusTiles).toString()},["village","town","city","national-capital"]);
  clearCanonicalHierarchyCache();
  const rebuilt=canonicalHierarchySnapshot(seed,xValue,yValue,50000);
  return Object.freeze({
    pass:before.signature===rebuilt.signature&&before.signature===reverse.diagnostics.signature&&before.cityClassSpacingPass&&before.duplicateNearCount===0,
    seed,signature:before.signature,rebuiltSignature:rebuilt.signature,reverseOrderSignature:reverse.diagnostics.signature,
    regenerationStable:before.signature===rebuilt.signature,generationOrderIndependent:before.signature===reverse.diagnostics.signature,
    cityClassSpacingPass:before.cityClassSpacingPass,duplicateNearCount:before.duplicateNearCount,
    requiredCitySpacingMeters:before.requiredCitySpacingMeters,minCityClassSpacingMeters:before.minCityClassSpacingMeters,
    bounded:before.bounded,fullWorldScan:false,seedOnly:true,cameraIndependent:true,viewportIndependent:true,lodIndependent:true,streamingOrderIndependent:true
  });
}

function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
function round(value,digits=4){
  const factor=10**digits;
  return Math.round(Number(value)*factor)/factor;
}
function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function distance(a,b){
  const dx=Number(BigInt(a.x)-BigInt(b.x));
  const dy=Number(BigInt(a.y)-BigInt(b.y));
  return Math.hypot(dx,dy);
}
function prosperityBand(value){
  const v=clamp01(value);
  if(v<0.28)return "strained";
  if(v<0.44)return "modest";
  if(v<0.62)return "stable";
  if(v<0.78)return "prosperous";
  return "wealthy";
}
function populationBand(classId,prosperity,seed,key){
  const scale=CLASS_SCALE[classId]||CLASS_SCALE.village;
  const min=scale.population[0],max=scale.population[1];
  const weighted=0.20+clamp01(prosperity)*0.58+unit(seed,"settlement:population:"+key)*0.22;
  const planned=Math.round(min+(max-min)*clamp01(weighted));
  return Object.freeze({min,max,planned,label:min.toLocaleString("en-US")+"–"+max.toLocaleString("en-US")});
}
function countryFromInput(seed,countryValue){
  if(countryValue&&typeof countryValue==="object"&&countryValue.id)return PoliticalGeography.countryById(seed,countryValue.id)||countryValue;
  if(typeof countryValue==="string")return PoliticalGeography.countryById(seed,countryValue);
  if(countryValue&&typeof countryValue==="object"&&countryValue.x!=null&&countryValue.y!=null)return PoliticalGeography.countryAt(seed,countryValue.x,countryValue.y);
  return PoliticalGeography.countryAt(seed,"0","0");
}
function placementClearanceForOptions(options){
  if(options?.role==="national-capital"||options?.classHint==="national-capital")return 640;
  if(options?.role==="regional-seat")return 448;
  if(options?.role==="starting-village")return 384;
  return 320;
}
function legalCenter(seed,country,desired,options){
  const canonical=options?.canonicalRecord||null;
  if(canonical){
    const x=String(canonical.center?.x??desired.x),y=String(canonical.center?.y??desired.y);
    let owner=null,terrain="water",environment=null;
    try{
      owner=PoliticalGeography.ownerAt(seed,x,y)||null;
      terrain=GeographyFoundation.getTerrainType(seed,x,y);
      environment=GeographyFoundation.environment(seed,x,y);
    }catch(_){return null;}
    if(!owner||owner.id!==country.id||terrain==="water")return null;
    return Object.freeze({x,y,terrain,environment,placement:null});
  }
  const baseX=BigInt(desired.x),baseY=BigInt(desired.y);
  const offsets=[[0,0]];
  for(const radius of [96,192,384,768,1536,3072]){
    for(let spoke=0;spoke<12;spoke++){
      const angle=Math.PI*2*spoke/12;
      offsets.push([Math.round(Math.cos(angle)*radius),Math.round(Math.sin(angle)*radius)]);
    }
  }
  const clearance=placementClearanceForOptions(options);
  let best=null;
  for(const [dx,dy] of offsets){
    const x=(baseX+BigInt(dx)).toString(),y=(baseY+BigInt(dy)).toString();
    const owner=PoliticalGeography.ownerAt(seed,x,y);
    if(!owner||owner.id!==country.id)continue;
    const terrain=GeographyFoundation.getTerrainType(seed,x,y);
    if(terrain==="water")continue;
    const placement=PoliticalGeography.validatePlacement?.(seed,{x,y,countryId:country.id,clearanceTiles:clearance,footprintRadiusTiles:192})||null;
    if(placement&&placement.valid!==true)continue;
    const env=GeographyFoundation.environment(seed,x,y);
    const terrainPenalty=terrain==="rock"?0.22:terrain==="mud"?0.15:0;
    const elevationPenalty=Math.min(0.22,Number(env.elevationMeters||0)/9000);
    const roadBonus=(terrain==="road"||terrain==="bridge")?-0.12:0;
    const score=terrainPenalty+elevationPenalty+roadBonus+(Math.abs(dx)+Math.abs(dy))/12000;
    if(!best||score<best.score)best={score,x,y,terrain,environment:env,placement};
  }
  if(!best)return null;
  return Object.freeze({x:best.x,y:best.y,terrain:best.terrain,environment:best.environment,placement:best.placement||null});
}
function borderContext(seed,country,center){
  const nearest=PoliticalGeography.nearestBorder?.(seed,center.x,center.y,country.id)||null;
  if(!nearest)return Object.freeze({
    nearBorder:false,proximity:0,distanceTiles:null,neighborCountryId:null,
    relationId:null,relationRevision:null,tradeAccess:0.3,militaryTension:0.2,borderOpenness:0.2,warState:false,
    graphRevision:null,graphSignature:null
  });
  const pair=nearest.ownerPair||[];
  const neighborId=pair[0]===country.id?pair[1]:pair[0];
  const relation=neighborId?window.CountryRelations?.build?.(seed,country.id,neighborId)||null:null;
  const proximity=clamp01(1-Number(nearest.distanceTiles||0)/5200);
  const point=nearest.nearestPoint||center;
  return Object.freeze({
    nearBorder:proximity>=0.42,
    proximity:round(proximity),
    distanceTiles:Math.round(Number(nearest.distanceTiles||0)),
    neighborCountryId:neighborId||null,
    borderId:nearest.borderId||null,
    borderEdgeId:nearest.edgeId||null,
    borderTerrain:GeographyFoundation.getTerrainType(seed,point.x,point.y),
    relationId:relation?.id||null,
    relationRevision:relation?.revision||null,
    tradeAccess:round(relation?.shared?.tradeAccess??0.3),
    militaryTension:round(relation?.shared?.militaryTension??0.2),
    borderOpenness:round(relation?.shared?.borderOpenness??0.2),
    warState:Boolean(relation?.shared?.warState),
    graphRevision:nearest.graphRevision||null,graphSignature:nearest.graphSignature||null
  });
}
function localContext(seed,country,center,region){
  const env=center.environment||GeographyFoundation.environment(seed,center.x,center.y);
  const terrain=center.terrain||GeographyFoundation.getTerrainType(seed,center.x,center.y);
  const identity=region.identity;
  const localAgriculture=clamp01(
    identity.agriculturalSuitability*0.72+
    ((terrain==="farmland"||terrain==="grass")?0.20:terrain==="rock"? -0.16:0)+
    (1-Math.min(1,Number(env.elevationMeters||0)/1900))*0.08
  );
  const localTimber=clamp01(identity.timberAvailability*0.78+(terrain==="forest"?0.22:0));
  const localMineral=clamp01(identity.mineralPotential*0.76+(terrain==="rock"?0.18:0)+Math.min(0.06,Number(env.elevationMeters||0)/24000));
  const localWater=clamp01(identity.waterAccess*0.86+(terrain==="sand"||terrain==="mud"?0.08:0));
  const routeAccess=clamp01(identity.transportAccessibility*0.78+((terrain==="road"||terrain==="bridge")?0.22:0));
  return Object.freeze({
    terrain,biome:env.biome,climate:env.climate,elevationMeters:Number(env.elevationMeters||0),
    moisturePercent:Number(env.moisturePercent||0),temperatureC:Number(env.temperatureC||0),
    resources:Object.freeze({
      agriculture:round(localAgriculture),timber:round(localTimber),mineral:round(localMineral),water:round(localWater)
    }),
    routeAccess:round(routeAccess),
    coastalAccess:localWater>=0.36,
    geographyAuthority:"GeographyFoundation",
    resourceAuthority:"RegionProfile + local fixed geography"
  });
}
function classFor(seed,key,countryProfile,region,local,border,options){
  if(options?.classHint&&SUPPORTED_CLASSES.includes(options.classHint))return options.classHint;
  if(options?.role==="national-capital")return "national-capital";
  const localProsperity=clamp01(countryProfile.wealth.value+region.prosperity.modifier);
  const signal=clamp01(
    0.08+countryProfile.wealth.value*0.13+countryProfile.tendencies.infrastructure*0.11+
    localProsperity*0.13+local.routeAccess*0.22+region.specialization.trade*0.11+
    local.resources.agriculture*0.05+local.resources.mineral*0.04+unit(seed,"settlement:size:"+key)*0.13+
    (options?.role==="regional-seat"?0.08:0)-(options?.role==="satellite"?0.12:0)
  );
  if(signal<0.34)return "hamlet";
  if(signal<0.49)return "village";
  if(signal<0.66)return "town";
  return "city";
}
function subtypeWeights(countryProfile,region,local,border,classId){
  const c=countryProfile.tendencies,s=region.specialization,r=local.resources;
  const physicalPort=local.coastalAccess&&r.water>=0.28;
  const agriculture=clamp01(s.agriculture*0.46+r.agriculture*0.36+c.agriculture*0.18);
  const forestry=clamp01(s.forestry*0.52+r.timber*0.34+c.craftProduction*0.14);
  const mining=clamp01(s.mining*0.48+r.mineral*0.40+c.mining*0.12);
  const trade=clamp01(s.trade*0.35+local.routeAccess*0.25+c.tradeOpenness*0.20+border.tradeAccess*0.12+border.borderOpenness*0.08);
  const port=physicalPort?clamp01(s.maritime*0.38+r.water*0.34+c.maritime*0.20+trade*0.08):0;
  const frontier=clamp01(border.proximity*0.44+border.militaryTension*0.28+c.militaryEmphasis*0.18+(1-border.borderOpenness)*0.10);
  const fortified=clamp01(s.defense*0.40+c.fortification*0.30+border.proximity*0.18+border.militaryTension*0.12+(classId==="national-capital"?0.12:0));
  const mixed=clamp01(0.30+(1-Math.max(agriculture,forestry,mining,trade,port,frontier))*0.50);
  const values={agricultural:agriculture,forest:forestry,mining,trade,port,frontier,fortified,mixed};
  const rounded=Object.freeze(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,round(v)])));
  const tags=Object.freeze(Object.entries(rounded)
    .filter(([key,value])=>value>=0.42&&(key!=="port"||physicalPort))
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,4).map(([key])=>key));
  return Object.freeze({weights:rounded,tags:tags.length?tags:Object.freeze(["mixed"]),physicalPort});
}
function buildingFunctions(classId,subtypes){
  const required=new Set(["housing","water-access","local-road-access"]);
  const optional=new Set(["farm-support","small-market","craft-workshop","storehouse"]);
  if(classId!=="hamlet")required.add("communal-space");
  if(["town","city","national-capital"].includes(classId)){required.add("market");required.add("administration");required.add("lodging");}
  if(["city","national-capital"].includes(classId)){required.add("district-services");required.add("large-storage");optional.add("guild-hall");}
  if(classId==="national-capital"){required.add("national-government");required.add("major-civic-space");required.add("garrison");}
  if(subtypes.tags.includes("agricultural")){required.add("food-storage");optional.add("mill");}
  if(subtypes.tags.includes("mining")){required.add("ore-storage");optional.add("smelter");}
  if(subtypes.tags.includes("trade")){required.add("market");optional.add("caravan-yard");}
  if(subtypes.tags.includes("port")){required.add("dock-or-wharf");optional.add("fish-market");}
  if(subtypes.tags.includes("fortified")||subtypes.tags.includes("frontier")){required.add("defensive-post");optional.add("wall-or-palisade");}
  if(subtypes.tags.includes("forest"))optional.add("timber-yard");
  return Object.freeze({required:Object.freeze([...required]),optional:Object.freeze([...optional])});
}
function architectureKeys(countryProfile,region,local,subtypes){
  const keys=[...countryProfile.culturalKeys,
    countryProfile.architecture.primaryMaterial,countryProfile.architecture.roofStyle,
    countryProfile.architecture.settlementPattern,countryProfile.architecture.civicStyle,
    "terrain:"+local.terrain,"biome:"+local.biome,"region:"+region.identity.dominantTerrain
  ];
  for(const tag of subtypes.tags)keys.push("settlement:"+tag);
  return Object.freeze([...new Set(keys)].slice(0,12));
}
function planName(seed,country,region,classId,subtypes,key,options){
  if(options?.nameHint)return String(options.nameHint);
  if(classId==="national-capital")return country.capital.name;
  const lead=(region.name||"Local").replace(/\s+(Province|Region)$/i,"");
  const suffixByTag={agricultural:["Fields","Grange","Meadow"],forest:["Wood","Timber","Grove"],mining:["Delve","Forge","Quarry"],trade:["Cross","Market","Ford"],port:["Harbor","Quay","Haven"],frontier:["March","Watch","Gate"],fortified:["Keep","Ward","Hold"],mixed:["stead","ton","wick"]};
  const tag=subtypes.tags[0]||"mixed",choices=suffixByTag[tag]||suffixByTag.mixed;
  return lead+" "+choices[PRNG.foundationUint32(seed,"settlement:name:"+key)%choices.length];
}
function planningSignature(plan){
  return [plan.classId,plan.subtypes.tags.join(","),Math.round(plan.prosperity.value*10),Math.round(plan.defenseTendency*10),Math.round(plan.tradeMarketTendency*10),plan.roadScale.band,plan.publicSpaceScale.band,plan.architectureKeys.slice(0,5).join(",")].join("|");
}
function contextSignature(plan){
  const r=plan.inputs.regionIdentity,l=plan.inputs.local;
  return [plan.countryId,plan.regionId,r.dominantTerrain,r.dominantBiome,Math.round(l.resources.agriculture*5),Math.round(l.resources.mineral*5),Math.round(l.resources.water*5),Math.round(l.routeAccess*5),Math.round(plan.inputs.border.proximity*5)].join("|");
}
function build(seedValue,centerValue,optionsValue){
  const seed=String(seedValue==null?"":seedValue);
  const options=optionsValue||{};
  const desired=Object.freeze({x:String(centerValue?.x??"0"),y:String(centerValue?.y??"0")});
  const country=countryFromInput(seed,options.countryId?String(options.countryId):desired);
  if(!country)return null;
  const center=legalCenter(seed,country,desired,options);
  if(!center)return null;
  const region=RegionProfile.at(seed,center.x,center.y);
  const countryProfile=CountryProfile.build(seed,country.id);
  if(!region||!countryProfile)return null;
  const local=localContext(seed,country,center,region);
  const border=borderContext(seed,country,center);
  const role=String(options.role||"local");
  const key=[country.id,region.id,center.x,center.y,role,options.classHint||""].join("|");
  const cacheKey=seed+"|"+key;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const canonical=options.canonicalRecord||null;
  const classId=canonical?String(canonical.classId):classFor(seed,key,countryProfile,region,local,border,options);
  const subtypes=subtypeWeights(countryProfile,region,local,border,classId);
  const footprintRadius={hamlet:40,village:72,town:112,city:160,"national-capital":240}[classId]||96;
  const placement=canonical
    ?(PoliticalGeography.validatePlacement?.(seed,{
        x:center.x,y:center.y,countryId:country.id,clearanceTiles:0,footprintRadiusTiles:0
      })||Object.freeze({valid:true,parentOwnerMatch:true,footprintCrossesBorder:false,borderDistanceTiles:null,reason:"canonical-point-validator-unavailable"}))
    :(PoliticalGeography.validatePlacement?.(seed,{
        x:center.x,y:center.y,countryId:country.id,
        clearanceTiles:footprintRadius+96,footprintRadiusTiles:footprintRadius
      })||Object.freeze({valid:true,parentOwnerMatch:true,footprintCrossesBorder:false,borderDistanceTiles:null,reason:"validator-unavailable"}));
  if(placement.valid!==true)return null;
  const prosperityValue=clamp01(
    countryProfile.wealth.value*0.46+(countryProfile.wealth.value+region.prosperity.modifier)*0.24+
    local.routeAccess*0.12+subtypes.weights.trade*0.08+unit(seed,"settlement:prosperity:"+key)*0.10
  );
  const scale=CLASS_SCALE[classId];
  const defense=clamp01(scale.defense*0.34+subtypes.weights.fortified*0.44+countryProfile.tendencies.militaryEmphasis*0.12+border.militaryTension*0.10);
  const tradeMarket=clamp01(scale.market*0.34+subtypes.weights.trade*0.42+local.routeAccess*0.16+border.tradeAccess*0.08);
  const roadValue=clamp01(scale.road*0.50+countryProfile.tendencies.infrastructure*0.20+local.routeAccess*0.30);
  const publicValue=clamp01(scale.publicSpace*0.58+countryProfile.governance.administrativeCapacity*0.18+prosperityValue*0.24);
  const population=populationBand(classId,prosperityValue,seed,key);
  const functions=buildingFunctions(classId,subtypes);
  const architecture=architectureKeys(countryProfile,region,local,subtypes);
  const id=canonical?String(canonical.id):"SET|"+hashText(seed+"|"+key);
  const revision="SAF-"+hashText([VERSION,id,countryProfile.revision,region.revision,border.relationRevision||"none",classId,subtypes.tags.join(","),prosperityValue,defense,tradeMarket,canonical?.cacheRegenerationSignature||"legacy"].join("|"));
  const plan=Object.freeze({
    version:VERSION,id,revision,
    name:canonical?String(canonical.name):planName(seed,country,region,classId,subtypes,key,options),
    countryId:country.id,countryName:country.name,regionId:region.id,regionName:region.name,
    center:Object.freeze({x:center.x,y:center.y,terrain:center.terrain}),
    placement:Object.freeze({...placement,authority:"PoliticalGeography.validatePlacement"}),
    role,classId,
    subtypes,
    population,
    prosperity:Object.freeze({value:round(prosperityValue),band:prosperityBand(prosperityValue)}),
    defenseTendency:round(defense),tradeMarketTendency:round(tradeMarket),
    roadScale:Object.freeze({value:round(roadValue),band:roadValue>=0.74?"major":roadValue>=0.48?"structured":roadValue>=0.30?"local":"minimal"}),
    publicSpaceScale:Object.freeze({value:round(publicValue),band:publicValue>=0.78?"monumental":publicValue>=0.56?"civic":publicValue>=0.34?"communal":"small"}),
    buildingFunctions:functions,
    architectureKeys:architecture,
    generation:Object.freeze({
      desiredCenter:Object.freeze({x:desired.x,y:desired.y}),
      countryId:country.id,role,
      classHint:options.classHint||null,nameHint:options.nameHint||null,
      canonicalSettlementId:canonical?.id||null,
      canonicalGenerationCell:canonical?.generationCell||null,
      canonicalRecord:canonical||null
    }),
    inputs:Object.freeze({
      countryProfileRevision:countryProfile.revision,
      regionProfileRevision:region.revision,
      regionIdentity:Object.freeze({
        dominantTerrain:region.identity.dominantTerrain,dominantBiome:region.identity.dominantBiome,
        agriculturalSuitability:region.identity.agriculturalSuitability,timberAvailability:region.identity.timberAvailability,
        mineralPotential:region.identity.mineralPotential,waterAccess:region.identity.waterAccess,
        transportAccessibility:region.identity.transportAccessibility,defensibility:region.identity.defensibility
      }),
      local,
      border,
      placement:Object.freeze({...placement}),
      role,
      precedence:Object.freeze(["CountryProfile","RegionProfile","local fixed geography/resources"])
    }),
    foundation:Object.freeze({
      source:canonical?"canonical settlement hierarchy + campaign-seed + country-profile + region-profile + local-geography + route/border context":"campaign-seed + country-profile + region-profile + local-geography + route/border context",
      canonicalSettlementId:canonical?.id||null,
      canonicalGenerationCellId:canonical?.generationCell?.id||null,
      canonicalHierarchyRevision:canonical?"settlement-hierarchy-v"+HIERARCHY_VERSION:null,
      immutable:true,fantasyTimeDependent:false,lazy:true,renderIndependent:true,
      countryAuthority:"PoliticalGeography",countryProfileAuthority:"CountryProfile",regionAuthority:"RegionProfile",
      politicalBoundaryAuthority:"PoliticalGeography.canonicalBoundaryGraph",
      placementAuthority:"PoliticalGeography.validatePlacement",
      localTerrainAuthority:"GeographyFoundation",diplomacyAuthority:"CountryRelations",
      terrainMutation:false,resourceMutation:false,npcPopulationCreated:false,physicalLayoutCreated:false,
      dynamicOverlayCompatible:true
    })
  });
  cache.set(cacheKey,plan);
  return plan;
}
function satelliteCenter(seed,country,region,index){
  const seat=region.administrativeSeat;
  const key=region.id+"|"+index;
  const angle=unit(seed,"settlement:satellite-angle:"+key)*Math.PI*2;
  const radius=480+Math.round(unit(seed,"settlement:satellite-radius:"+key)*1050);
  return Object.freeze({
    x:(BigInt(seat.x)+BigInt(Math.round(Math.cos(angle)*radius))).toString(),
    y:(BigInt(seat.y)+BigInt(Math.round(Math.sifunction settlementsForCountry(seedValue,countryValue,radiusValue){
  const seed=String(seedValue==null?"":seedValue);
  const country=countryFromInput(seed,countryValue);
  if(!country)return Object.freeze([]);
  const radius=Math.max(1,Math.min(4,Number(radiusValue??3)));
  const cacheKey=seed+"|"+country.id+"|"+radius+"|canonical-v"+HIERARCHY_VERSION;
  if(catalogCache.has(cacheKey))return catalogCache.get(cacheKey);

  const out=[],seen=new Set();
  const addRecord=record=>{
    if(!record||record.countryId!==country.id||seen.has(record.id))return;
    const role=record.role||(
      record.classId==="national-capital"?"national-capital":
      record.importanceClass==="major-city"?"major-city":
      record.classId==="city"?"regional-center":
      record.classId==="town"?"market-town":
      record.classId==="village"?"village":"hamlet"
    );
    const plan=build(seed,record.center,{
      countryId:country.id,role,classHint:record.classId,nameHint:record.name,canonicalRecord:record
    });
    if(plan&&!seen.has(plan.id)){seen.add(plan.id);out.push(plan);}
  };

  addRecord(hierarchyCapitalForRecord(seed,{countryId:country.id}));

  const center=country.politicalCenter||country.mapAnchor||country.capital;
  const span=BigInt(Math.max(REGION_CELL_SIZE_FALLBACK,Math.round(radius*REGION_CELL_SIZE_FALLBACK)));
  const cx=BigInt(String(center?.x??country.capital?.x??"0"));
  const cy=BigInt(String(center?.y??country.capital?.y??"0"));
  const query=canonicalSettlementsInBounds(seed,{
    minX:(cx-span).toString(),maxX:(cx+span).toString(),
    minY:(cy-span).toString(),maxY:(cy+span).toString()
  },["city","town","village","hamlet"]);
  for(const record of query.settlements||[])addRecord(record);

  try{
    const originCountry=PoliticalGeography.countryAt(seed,"0","0");
    if(originCountry?.id===country.id){
      const originVillage=canonicalSettlementAtPoint(seed,"village","0","0");
      if(originVillage)addRecord(originVillage);
    }
  }catch(_){}

  const frozen=Object.freeze(out.sort((a,b)=>{
    const priority={"national-capital":0,city:1,town:2,village:3,hamlet:4};
    return (priority[a.classId]??9)-(priority[b.classId]??9)||a.id.localeCompare(b.id);
  }));
  catalogCache.set(cacheKey,frozen);
  return frozen;
}t(cacheKey,frozen);
  return frozen;
}
function sampleCatalog(seed){
  const origin=PoliticalGeography.countryAt(seed,"0","0");
  const countries=[origin];
  for(const profile of CountryProfile.sampleCountries(seed)){
    const country=PoliticalGeography.countryById(seed,profile.countryId);
    if(country&&!countries.some(item=>item.id===country.id))countries.push(country);
    if(countries.length>=4)break;
  }
  return Object.freeze(countries.flatMap(country=>settlementsForCountry(seed,country,2)));
}
function scoreReason(plan,reason){
  if(reason==="agricultural")return plan.subtypes.weights.agricultural+(plan.classId==="village"?0.25:plan.classId==="hamlet"?0.12:0);
  if(reason==="mining")return plan.subtypes.weights.mining+(plan.classId==="town"?0.12:0);
  if(reason==="trade")return plan.subtypes.weights.trade+(plan.classId==="town"?0.22:plan.classId==="city"?0.14:0);
  if(reason==="frontier-fortified")return Math.max(plan.subtypes.weights.frontier,plan.subtypes.weights.fortified)+plan.inputs.border.proximity*0.20;
  if(reason==="capital")return plan.classId==="national-capital"?2:0;
  return 0;
}
function representatives(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const plans=[...sampleCatalog(seed)];
  const picks=[];
  const add=(reason,plan)=>{if(plan&&!picks.some(item=>item.plan.id===plan.id))picks.push(Object.freeze({reason,plan}))};
  for(const reason of ["agricultural","mining","trade","frontier-fortified","capital"]){
    let pool=[...plans];
    if(reason==="agricultural"){
      const sized=pool.filter(plan=>plan.classId==="village"||plan.classId==="hamlet");
      if(sized.length)pool=sized;
    }else if(reason==="trade"){
      const sized=pool.filter(plan=>plan.classId==="town"||plan.classId==="city");
      if(sized.length)pool=sized;
    }else if(reason==="capital"){
      const capitals=pool.filter(plan=>plan.classId==="national-capital");
      if(capitals.length)pool=capitals;
    }
    const ranked=pool.sort((a,b)=>scoreReason(b,reason)-scoreReason(a,reason)||a.id.localeCompare(b.id));
    add(reason,ranked.find(plan=>!picks.some(item=>item.plan.id===plan.id))||ranked[0]);
  }
  for(const plan of plans)if(picks.length<5)add("mixed",plan);
  return Object.freeze(picks.slice(0,5));
}
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  if(proofCache.has(seed))return proofCache.get(seed);
  const plans=sampleCatalog(seed);
  const reps=representatives(seed);
  const rebuilt=reps.map(item=>{
    const g=item.plan.generation;
    return Object.freeze({reason:item.reason,plan:build(seed,g.desiredCenter,{
      countryId:g.countryId,role:g.role,classHint:g.classHint,nameHint:g.nameHint,
      canonicalRecord:g.canonicalRecord||null
    })});
  });
  const deterministic=JSON.stringify(reps)===JSON.stringify(rebuilt);
  const timeIndependent=plans.every(plan=>plan.foundation.fantasyTimeDependent===false);
  const numericValid=plans.every(plan=>[
    plan.prosperity.value,plan.defenseTendency,plan.tradeMarketTendency,plan.roadScale.value,plan.publicSpaceScale.value,
    ...Object.values(plan.subtypes.weights)
  ].every(value=>Number.isFinite(value)&&value>=0&&value<=1));
  const geographyValid=plans.every(plan=>
    plan.center.terrain!=="water"&&PoliticalGeography.ownerAt(seed,plan.center.x,plan.center.y).id===plan.countryId
  );
  const borderPlacementValid=plans.every(plan=>
    plan.placement?.valid===true&&plan.placement?.parentOwnerMatch===true&&plan.placement?.footprintCrossesBorder===false
  );
  const physicalConstraints=plans.every(plan=>
    plan.inputs.local.coastalAccess||plan.subtypes.weights.port===0
  );
  const classSupport=SUPPORTED_CLASSES.length===5&&SUPPORTED_CLASSES.every(id=>CLASS_SCALE[id]);
  const classCount=new Set(plans.map(plan=>plan.classId)).size;
  const subtypeCount=new Set(plans.flatMap(plan=>plan.subtypes.tags)).size;
  const capitalPlans=plans.filter(plan=>plan.classId==="national-capital");
  const capitalScale=capitalPlans.length>=2&&capitalPlans.every(plan=>plan.population.min>=CLASS_SCALE.city.population[1]*0.7&&plan.buildingFunctions.required.includes("national-government"));
  const contextComplete=plans.every(plan=>
    plan.inputs.countryProfileRevision&&plan.inputs.regionProfileRevision&&plan.inputs.regionIdentity&&plan.inputs.local&&plan.inputs.border&&
    plan.inputs.precedence.join(">").includes("CountryProfile>RegionProfile>local fixed geography/resources")
  );
  let sameCountryPairs=0,contextualDifferences=0;
  for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++){
    if(plans[i].countryId!==plans[j].countryId||plans[i].regionId===plans[j].regionId)continue;
    sameCountryPairs++;
    if(contextSignature(plans[i])!==contextSignature(plans[j])&&planningSignature(plans[i])!==planningSignature(plans[j]))contextualDifferences++;
  }
  const countryRegionTerrainInfluence=sameCountryPairs>=3&&contextualDifferences>=Math.min(3,sameCountryPairs);
  const differentContexts=plans.filter((plan,index)=>plans.findIndex(other=>contextSignature(other)===contextSignature(plan))===index);
  const uniquePlanSignatures=new Set(differentContexts.map(planningSignature)).size;
  const cloneAvoidance=differentContexts.length<2||uniquePlanSignatures>=Math.min(differentContexts.length,4);
  const roleCoverage=new Set(plans.map(plan=>plan.role));
  const genericPlanner=roleCoverage.has("regional-seat")&&roleCoverage.has("satellite")&&roleCoverage.has("national-capital");
  const lazyQueryable=plans.every(plan=>plan.foundation.lazy&&plan.foundation.renderIndependent&&!plan.foundation.physicalLayoutCreated);
  const authorityPreserved=plans.every(plan=>!plan.foundation.terrainMutation&&!plan.foundation.resourceMutation&&!plan.foundation.npcPopulationCreated);
  const evidenceReasons=new Set(reps.map(item=>item.reason));
  const representativeCoverage=["agricultural","mining","trade","frontier-fortified","capital"].every(reason=>evidenceReasons.has(reason));
  const pass=Boolean(
    plans.length>=12&&reps.length===5&&deterministic&&timeIndependent&&numericValid&&geographyValid&&borderPlacementValid&&physicalConstraints&&classSupport&&
    classCount>=3&&subtypeCount>=4&&capitalScale&&contextComplete&&countryRegionTerrainInfluence&&cloneAvoidance&&genericPlanner&&
    lazyQueryable&&authorityPreserved&&representativeCoverage
  );
  const result=Object.freeze({
    pass,campaignSeed:seed,planCount:plans.length,representativeCount:reps.length,
    deterministic,timeIndependent,numericValid,geographyValid,borderPlacementValid,physicalConstraints,classSupport,
    classCount,subtypeCount,capitalScale,contextComplete,countryRegionTerrainInfluence,cloneAvoidance,genericPlanner,
    lazyQueryable,authorityPreserved,representativeCoverage,
    supportedClasses:SUPPORTED_CLASSES,representatives:reps,
    authority:"settlement-archetype-planning-foundation",
    terrainMutation:false,resourceMutation:false,npcPopulationCreated:false,physicalLayoutCreated:false,
    liveEconomyCreated:false,renderDependency:false,fullWorldMaterialized:false
  });
  proofCache.set(seed,result);
  return result;
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value)*100)+"%"}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderBar(label,value){
  return "<div class=\"region-profile-bar\"><span>"+escapeHtml(label)+"</span><strong>"+escapeHtml(percent(value))+"</strong><i><b style=\"width:"+escapeHtml(percent(value))+"\"></b></i></div>";
}
function renderDebugPanel(seedValue,planIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("settlementArchetypeProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.representatives.length)return Object.freeze({verification,plan:null});
  const index=Math.abs(Number(planIndexValue)||0)%verification.representatives.length;
  const selected=verification.representatives[index],plan=selected.plan;
  const select=root.querySelector("#settlementArchetypeSelect");
  if(select){
    select.innerHTML=verification.representatives.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+escapeHtml(item.reason+" · "+item.plan.name+" · "+item.plan.classId)+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    settlementArchetypeName:plan.name,
    settlementArchetypeId:plan.id,
    settlementArchetypeCountry:plan.countryName+" · "+plan.countryId,
    settlementArchetypeRegion:plan.regionName+" · "+plan.regionId,
    settlementArchetypeClass:plan.classId+" · "+selected.reason,
    settlementArchetypeCenter:"("+plan.center.x+","+plan.center.y+") · "+plan.center.terrain,
    settlementArchetypePopulation:plan.population.planned.toLocaleString("en-US")+" planned · band "+plan.population.label,
    settlementArchetypeProsperity:plan.prosperity.band+" · "+percent(plan.prosperity.value),
    settlementArchetypeContext:
      "terrain "+plan.inputs.local.terrain+" · agri "+percent(plan.inputs.local.resources.agriculture)+" · mineral "+percent(plan.inputs.local.resources.mineral)+
      " · water "+percent(plan.inputs.local.resources.water)+" · route "+percent(plan.inputs.local.routeAccess)+" · border "+percent(plan.inputs.border.proximity),
    settlementArchetypePlanning:
      "defense "+percent(plan.defenseTendency)+" · market "+percent(plan.tradeMarketTendency)+" · roads "+plan.roadScale.band+" · public "+plan.publicSpaceScale.band,
    settlementArchetypeRevision:plan.revision
  };
  for(const [id,value] of Object.entries(values)){const node=root.querySelector("#"+id);if(node)node.textContent=value;}
  const tags=root.querySelector("#settlementArchetypeTags");
  if(tags)tags.innerHTML=plan.subtypes.tags.map(tag=>"<span class=\"diplomacy-agreement active\">"+escapeHtml(tag)+"</span>").join("");
  const bars=root.querySelector("#settlementArchetypeWeights");
  if(bars){
    const w=plan.subtypes.weights;
    bars.innerHTML=[["Agriculture",w.agricultural],["Forest",w.forest],["Mining",w.mining],["Trade",w.trade],["Port",w.port],["Frontier",w.frontier],["Fortified",w.fortified]]
      .map(([label,value])=>renderBar(label,value)).join("");
  }
  const functions=root.querySelector("#settlementArchetypeFunctions");
  if(functions)functions.textContent="Required: "+plan.buildingFunctions.required.join(", ")+" · Optional: "+plan.buildingFunctions.optional.join(", ");
  const architecture=root.querySelector("#settlementArchetypeArchitecture");
  if(architecture)architecture.textContent=plan.architectureKeys.join(" · ");
  const comparison=root.querySelector("#settlementArchetypeComparison");
  if(comparison){
    comparison.innerHTML=verification.representatives.map(item=>{
      const p=item.plan;
      return "<li class=\""+(p.id===plan.id?"selected":"")+"\"><div><strong>"+escapeHtml(p.name)+"</strong>"+
        "<small>"+escapeHtml(item.reason+" · "+p.countryName+" / "+p.regionName+" · "+p.subtypes.tags.join(" / "))+"</small></div>"+
        "<span>"+escapeHtml(p.classId)+"</span><span>Pop "+escapeHtml(String(p.population.planned))+"</span>"+
        "<span>Market "+escapeHtml(percent(p.tradeMarketTendency))+"</span><span>Defense "+escapeHtml(percent(p.defenseTendency))+"</span></li>";
    }).join("");
  }
  setCheck("vSettlementDeterministic",verification.deterministic&&verification.timeIndependent);
  setCheck("vSettlementClasses",verification.classSupport&&verification.classCount>=3&&verification.capitalScale);
  setCheck("vSettlementContext",verification.contextComplete&&verification.countryRegionTerrainInfluence&&verification.cloneAvoidance);
  setCheck("vSettlementGeography",verification.geographyValid&&verification.physicalConstraints);
  setCheck("vSettlementOutputs",verification.numericValid&&verification.subtypeCount>=4&&verification.genericPlanner&&verification.representativeCoverage);
  setCheck("vSettlementAuthority",verification.lazyQueryable&&verification.authorityPreserved&&!verification.terrainMutation&&!verification.resourceMutation&&!verification.npcPopulationCreated&&!verification.physicalLayoutCreated&&!verification.liveEconomyCreated&&!verification.renderDependency);
  root.dataset.planIndex=String(index);
  root.dataset.planId=plan.id;
  root.dataset.revision=plan.revision;
  root.dataset.reason=selected.reason;
  root.dataset.classId=plan.classId;
  root.dataset.countryId=plan.countryId;
  root.dataset.regionId=plan.regionId;
  root.dataset.context=contextSignature(plan);
  root.dataset.planning=planningSignature(plan);
  root.dataset.market=String(plan.tradeMarketTendency);
  root.dataset.defense=String(plan.defenseTendency);
  root.dataset.port=String(plan.subtypes.weights.port);
  root.dataset.coastal=String(plan.inputs.local.coastalAccess);
  return Object.freeze({verification,plan,selected,index});
}

const api=Object.freeze({
  VERSION,SUPPORTED_CLASSES,CLASS_SCALE,build,settlementsForCountry,representatives,proof,renderDebugPanel,
  HIERARCHY_VERSION,HIERARCHY_CLASS_ORDER,HIERARCHY_CLASS_SPECS,
  canonicalSettlementAtCell,canonicalSettlementAtPoint,canonicalSettlementsInBounds,
  canonicalHierarchySnapshot,canonicalHierarchyProof,clearCanonicalHierarchyCache
});
window.SettlementArchetypes=api;
window.SettlementPlanner=api;
})();
