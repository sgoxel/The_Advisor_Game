(function(){
"use strict";

const VERSION="world-road-graph-v1";
const TILE_METERS=Math.max(1,Number(window.WorldStandards?.TILE_METERS||2));
const MAX_NODES=40;
const MAX_EDGES=64;
const MAX_REDUNDANCY_EDGES=10;
const MAX_ROUTE_EXPANSIONS=96;
const GRAPH_CACHE_LIMIT=16;
const CORRIDOR_SAMPLES=11;
const CATALOG_CELL_LIMIT_PER_CLASS=4;
const CATALOG_RESULT_LIMIT_PER_CLASS=2;
const LATERAL_OFFSETS=Object.freeze([-1,-0.6,-0.3,0,0.3,0.6,1]);
const graphCache=new Map();

function now(){return typeof performance!=="undefined"&&performance.now?performance.now():Date.now()}
function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0))}
function hash32(value){let h=2166136261>>>0;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h>>>0}
function hashText(value){return hash32(value).toString(16).toUpperCase().padStart(8,"0")}
function distanceTiles(a,b){const dx=Number(BigInt(String(b.x))-BigInt(String(a.x))),dy=Number(BigInt(String(b.y))-BigInt(String(a.y)));return Math.hypot(dx,dy)}
function distanceMeters(a,b){return distanceTiles(a,b)*TILE_METERS}
function priority(node){
  const importance=String(node?.importanceClass||node?.classId||"");
  if(importance==="national-capital")return 5;
  if(importance==="major-city")return 4;
  if(node?.classId==="city")return 3;
  if(node?.classId==="town")return 2;
  if(node?.classId==="village")return 1;
  return 0;
}
function roadClass(a,b){
  const lo=Math.min(priority(a),priority(b)),hi=Math.max(priority(a),priority(b));
  if(lo>=3)return "trunk";
  if(hi>=3&&lo>=2)return "primary";
  if(lo>=1)return "secondary";
  return "local";
}
function terrainPenalty(type){
  return ({road:0.72,bridge:0.74,farmland:0.92,grass:1,forest:1.24,dirt:1.04,mud:1.62,sand:1.48,rock:1.82,water:4.6})[String(type)]??1.18;
}
function safeSample(seed,xValue,yValue){
  const x=String(xValue),y=String(yValue);
  let terrain="grass",env={elevationMeters:0,biome:"Unknown"};
  try{terrain=String(window.GeographyFoundation?.getTerrainType?.(seed,x,y)||terrain)}catch(_){}
  try{env=window.GeographyFoundation?.environment?.(seed,x,y)||env}catch(_){}
  return Object.freeze({x,y,terrain,elevationMeters:Number(env.elevationMeters||0),biome:String(env.biome||"")});
}
function pointOnLine(a,b,t,lateralTiles){
  const ax=Number(BigInt(String(a.x))),ay=Number(BigInt(String(a.y)));
  const bx=Number(BigInt(String(b.x))),by=Number(BigInt(String(b.y)));
  const dx=bx-ax,dy=by-ay,len=Math.max(1,Math.hypot(dx,dy));
  const px=-dy/len,py=dx/len;
  return Object.freeze({
    x:String(Math.round(ax+dx*t+px*lateralTiles)),
    y:String(Math.round(ay+dy*t+py*lateralTiles))
  });
}
function previewCost(seed,a,b){
  const direct=distanceTiles(a,b),steps=5;
  let cost=direct,water=0,rock=0,relief=0,last=null;
  for(let i=0;i<=steps;i++){
    const p=pointOnLine(a,b,i/steps,0),s=safeSample(seed,p.x,p.y);
    cost+=terrainPenalty(s.terrain)*Math.max(1,direct/steps)*0.07;
    if(s.terrain==="water")water++;
    if(s.terrain==="rock")rock++;
    if(last)relief+=Math.abs(s.elevationMeters-last.elevationMeters);
    last=s;
  }
  return Object.freeze({score:cost+water*direct*0.42+rock*direct*0.05+relief*0.9,water,rock,relief});
}
function corridor(seed,a,b,edgeKey){
  const started=now(),directTiles=Math.max(1,distanceTiles(a,b));
  const lateralScale=clamp(directTiles/14,72,1200);
  const points=[],samples=[],crossings=[];
  let previous=null,pathTiles=0,maxGrade=0,offsetCount=0,candidateEvaluations=0;
  for(let i=0;i<CORRIDOR_SAMPLES;i++){
    const t=i/(CORRIDOR_SAMPLES-1);
    let chosen=null;
    for(const offsetUnit of (i===0||i===CORRIDOR_SAMPLES-1?[0]:LATERAL_OFFSETS)){
      const p=pointOnLine(a,b,t,offsetUnit*lateralScale),s=safeSample(seed,p.x,p.y);
      candidateEvaluations++;
      let score=terrainPenalty(s.terrain)*14+Math.abs(offsetUnit)*1.8+s.elevationMeters/1800;
      if(previous){
        const segment=Math.max(1,distanceTiles(previous,s)),rise=Math.abs(s.elevationMeters-previous.elevationMeters);
        const grade=rise/(segment*TILE_METERS);
        score+=grade*42;
        if(previous.terrain==="water"||s.terrain==="water")score+=7.5;
      }
      score+=(hash32(seed+"|road-corridor|"+edgeKey+"|"+i+"|"+offsetUnit)%997)/997000;
      if(!chosen||score<chosen.score)chosen={...s,score,offsetUnit};
    }
    if(!chosen)continue;
    if(chosen.offsetUnit!==0)offsetCount++;
    if(previous){
      const segment=distanceTiles(previous,chosen),rise=Math.abs(chosen.elevationMeters-previous.elevationMeters),grade=rise/Math.max(1,segment*TILE_METERS);
      pathTiles+=segment;maxGrade=Math.max(maxGrade,grade);
      if(previous.terrain!=="water"&&chosen.terrain==="water"){
        crossings.push(Object.freeze({id:"CROSS|"+hashText(edgeKey+"|"+i),kind:"water-entry",x:chosen.x,y:chosen.y,authority:"GeographyFoundation terrain sample"}));
      }else if(previous.terrain==="water"&&chosen.terrain!=="water"){
        crossings.push(Object.freeze({id:"CROSS|"+hashText(edgeKey+"|"+i),kind:"water-exit",x:previous.x,y:previous.y,authority:"GeographyFoundation terrain sample"}));
      }
    }
    points.push(Object.freeze({x:chosen.x,y:chosen.y,elevationMeters:Math.round(chosen.elevationMeters),terrain:chosen.terrain}));
    samples.push(Object.freeze({terrain:chosen.terrain,elevationMeters:Math.round(chosen.elevationMeters),offsetUnit:Number(chosen.offsetUnit)}));
    previous=chosen;
  }
  return Object.freeze({
    points:Object.freeze(points),samples:Object.freeze(samples),crossings:Object.freeze(crossings),
    directDistanceMeters:Number((directTiles*TILE_METERS).toFixed(1)),
    routeDistanceMeters:Number((Math.max(pathTiles,directTiles)*TILE_METERS).toFixed(1)),
    detourRatio:Number((Math.max(pathTiles,directTiles)/directTiles).toFixed(4)),
    maxGrade:Number(maxGrade.toFixed(4)),offsetSampleCount:offsetCount,
    candidateEvaluations,geographyInfluenced:candidateEvaluations>points.length,
    planningMs:Number((now()-started).toFixed(3)),
    localChunkMaterialization:false
  });
}
function normalizeCountry(seed,input){
  if(input&&typeof input==="object"&&input.id)return input;
  if(typeof input==="string")return window.PoliticalGeography?.countryById?.(seed,input)||null;
  if(input&&typeof input==="object"&&input.x!=null&&input.y!=null)return window.PoliticalGeography?.countryAt?.(seed,String(input.x),String(input.y))||null;
  return window.PoliticalGeography?.countryAt?.(seed,"0","0")||null;
}
function floorDiv(value,divisor){
  const v=BigInt(String(value)),d=BigInt(String(divisor));let q=v/d,r=v%d;
  if(r!==0n&&v<0n)q-=1n;return q;
}
function orderedSettlementCells(point,classId,radiusMeters){
  const spec=window.SettlementArchetypes?.HIERARCHY_CLASS_SPECS?.[classId];
  if(!spec)return Object.freeze([]);
  const size=BigInt(spec.cellTiles),cx=floorDiv(point.x,size),cy=floorDiv(point.y,size);
  const radiusTiles=Math.max(1,Math.ceil(radiusMeters/TILE_METERS));
  const maxRing=Math.max(1,Math.min(4,Math.ceil(radiusTiles/Number(size)))),cells=[];
  for(let oy=-maxRing;oy<=maxRing;oy++)for(let ox=-maxRing;ox<=maxRing;ox++){
    cells.push({cx:cx+BigInt(ox),cy:cy+BigInt(oy),d2:ox*ox+oy*oy});
  }
  cells.sort((a,b)=>a.d2-b.d2||(a.cy<b.cy?-1:a.cy>b.cy?1:a.cx<b.cx?-1:a.cx>b.cx?1:0));
  return Object.freeze(cells.slice(0,CATALOG_CELL_LIMIT_PER_CLASS));
}
function capitalRecord(seed,country){
  const cap=country?.capital;if(!cap?.id||cap.x==null||cap.y==null)return null;
  let region=null;try{region=window.RegionProfile?.descriptorAt?.(seed,String(cap.x),String(cap.y))||window.RegionProfile?.at?.(seed,String(cap.x),String(cap.y))||null}catch(_){}
  return Object.freeze({
    id:String(cap.id),name:String(cap.name||country.name||"Capital"),classId:"national-capital",importanceClass:"national-capital",
    role:"national-capital",roadNetworkRole:"national-hub",countryId:String(country.id),regionId:String(region?.id||""),
    center:Object.freeze({x:String(cap.x),y:String(cap.y)}),authority:"PoliticalGeography.capital"
  });
}
function boundedSettlementCatalog(seed,country,radius,focusValue){
  const started=now(),records=[],seen=new Set();let queryCellCount=0;
  const add=record=>{
    if(!record||seen.has(String(record.id))||String(record.countryId||"")!==String(country.id))return false;
    seen.add(String(record.id));records.push(record);return true;
  };
  add(capitalRecord(seed,country));
  let originCountry=null;try{originCountry=window.PoliticalGeography?.countryAt?.(seed,"0","0")||null}catch(_){}
  const originOwned=String(originCountry?.id||"")===String(country.id);
  const focus=focusValue&&focusValue.x!=null&&focusValue.y!=null
    ?Object.freeze({x:String(focusValue.x),y:String(focusValue.y)})
    :originOwned?Object.freeze({x:"0",y:"0"})
    :Object.freeze({x:String(country.capital?.x??country.mapAnchor?.x??"0"),y:String(country.capital?.y??country.mapAnchor?.y??"0")});
  if(originOwned){
    try{add(window.SettlementArchetypes?.canonicalSettlementAtPoint?.(seed,"village","0","0")||null)}catch(_){}
  }
  const radiusMeters=[0,18000,26000,36000,48000][radius]||36000;
  const centers=[focus];
  const cap=country.capital?Object.freeze({x:String(country.capital.x),y:String(country.capital.y)}):null;
  if(cap&&distanceMeters(focus,cap)>12000)centers.push(cap);
  const classes=["city","town","village","hamlet"];
  for(let centerIndex=0;centerIndex<centers.length;centerIndex++){
    const center=centers[centerIndex],activeClasses=centerIndex===0?classes:["city","town"];
    for(const classId of activeClasses){
      let accepted=0;
      for(const cell of orderedSettlementCells(center,classId,radiusMeters)){
        queryCellCount++;
        let record=null;
        try{record=window.SettlementArchetypes?.canonicalSettlementAtCell?.(seed,classId,cell.cx,cell.cy)||null}catch(_){record=null}
        if(!record||String(record.countryId||"")!==String(country.id))continue;
        if(distanceMeters(center,record.center)>radiusMeters)continue;
        if(add(record))accepted++;
        if(accepted>=CATALOG_RESULT_LIMIT_PER_CLASS)break;
      }
    }
  }
  records.sort((a,b)=>priority(b)-priority(a)||distanceMeters(focus,a.center)-distanceMeters(focus,b.center)||String(a.id).localeCompare(String(b.id)));
  return Object.freeze({
    records:Object.freeze(records.slice(0,MAX_NODES)),focus,
    diagnostics:Object.freeze({
      queryCellCount,centerCount:centers.length,recordCount:Math.min(records.length,MAX_NODES),
      cellLimitPerClass:CATALOG_CELL_LIMIT_PER_CLASS,resultLimitPerClass:CATALOG_RESULT_LIMIT_PER_CLASS,
      planningMs:Number((now()-started).toFixed(3)),bounded:true,fullWorldScan:false
    })
  });
}
function localApproach(seed,node){
  if(node?.role!=="starting-village")return Object.freeze({kind:"settlement-center",anchor:Object.freeze({x:String(node.center.x),y:String(node.center.y)}),authority:"SettlementArchetypes.center"});
  try{
    const direction=window.StartingVillage?.direction?.(seed)||null,ring=Number(window.StartingVillage?.RING_RADIUS_TILES||14);
    if(direction)return Object.freeze({
      kind:"starting-village-gateway",
      anchor:Object.freeze({x:String(Number(direction.dx||0)*(ring+6)),y:String(Number(direction.dy||0)*(ring+6))}),
      direction:String(direction.name||""),authority:"StartingVillage.direction + reserved-road gateway"
    });
  }catch(_){}
  return Object.freeze({kind:"settlement-center",anchor:Object.freeze({x:String(node.center.x),y:String(node.center.y)}),authority:"SettlementArchetypes.center"});
}
function nodeDescriptor(seed,record){
  return Object.freeze({
    id:String(record.id),name:String(record.name||record.id),classId:String(record.classId||"settlement"),
    importanceClass:String(record.importanceClass||record.classId||"settlement"),priority:priority(record),
    role:String(record.role||"local"),roadNetworkRole:String(record.roadNetworkRole||"local-node"),
    countryId:String(record.countryId||""),regionId:String(record.regionId||""),
    center:Object.freeze({x:String(record.center.x),y:String(record.center.y)}),
    localApproach:localApproach(seed,record),
    authority:String(record.authority||"SettlementArchetypes")
  });
}
function parentBand(node){
  const p=priority(node);
  if(p<=0)return 1;
  if(p===1)return 2;
  if(p===2)return 3;
  if(p===3)return 4;
  return 5;
}
function candidateParents(node,connected){
  const preferred=connected.filter(other=>priority(other)>=parentBand(node));
  const pool=preferred.length?preferred:connected.filter(other=>priority(other)>=priority(node));
  return (pool.length?pool:connected).slice().sort((a,b)=>distanceTiles(node.center,a.center)-distanceTiles(node.center,b.center)||b.priority-a.priority||a.id.localeCompare(b.id)).slice(0,6);
}
function makeEdge(seed,a,b,index,kindReason){
  const ids=[a.id,b.id].sort(),edgeId="WROAD|"+hashText(seed+"|"+ids.join("|")+"|"+kindReason),geometry=corridor(seed,a.center,b.center,edgeId);
  return Object.freeze({
    id:edgeId,aId:a.id,bId:b.id,roadClass:roadClass(a,b),hierarchyReason:kindReason,
    distanceMeters:geometry.routeDistanceMeters,straightLineMeters:geometry.directDistanceMeters,
    weight:Number((geometry.routeDistanceMeters*(1+geometry.maxGrade*1.8)+(geometry.crossings.length?geometry.routeDistanceMeters*0.08:0)).toFixed(2)),
    geometry,crossingCount:geometry.crossings.length,sharedCorridorEligible:true,
    localDetailedSegmentsMaterialized:0,descriptorOnly:true,authority:"WorldRoadGraph + GeographyFoundation"
  });
}
function edgeKey(aId,bId){return [String(aId),String(bId)].sort().join("|")}
function graphForCountry(seedValue,countryValue,optionsValue){
  const seed=String(seedValue==null?"":seedValue),country=normalizeCountry(seed,countryValue),options=optionsValue||{};
  if(!country)return null;
  const radius=Math.max(1,Math.min(4,Number(options.radius??4))),focusKey=options.focus&&options.focus.x!=null&&options.focus.y!=null?String(options.focus.x)+","+String(options.focus.y):"auto",cacheKey=[VERSION,seed,country.id,radius,focusKey].join("|");
  if(graphCache.has(cacheKey))return graphCache.get(cacheKey);
  const persistentOptions=focusKey==="auto"?{
    seed,family:"road-graph",recordId:String(country.id)+"|r"+radius+"|country-partition",familyVersion:VERSION,
    dependencySignature:["road",VERSION,"settlement",Number(window.SettlementArchetypes?.VERSION||0),"hierarchy",Number(window.SettlementArchetypes?.HIERARCHY_VERSION||0),"planet",Number(window.PlanetGeography?.VERSION||0)].join("|"),
    regenCost:24,importance:5
  }:null;
  const persisted=persistentOptions?(window.GeneratedWorldStore?.peek?.(persistentOptions)||null):null;
  if(persisted){graphCache.set(cacheKey,persisted);return graphCache.get(cacheKey);}
  const started=now();
  const catalog=boundedSettlementCatalog(seed,country,radius,options.focus);
  const records=catalog.records;
  const nodes=records.map(record=>nodeDescriptor(seed,record)).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  if(!nodes.length)return Object.freeze({version:VERSION,seed,countryId:String(country.id),nodes:Object.freeze([]),edges:Object.freeze([]),junctions:Object.freeze([]),signature:"EMPTY",diagnostics:Object.freeze({bounded:true,fullWorldScan:false,nodeCount:0,edgeCount:0,connectedComponents:0})});
  const edges=[],connected=[nodes[0]],seenEdges=new Set(),candidateComparisons=[];
  for(const node of nodes.slice(1)){
    const candidates=candidateParents(node,connected);
    let best=null;
    for(const candidate of candidates){
      const preview=previewCost(seed,node.center,candidate.center),hierarchyPenalty=Math.max(0,priority(node)-priority(candidate))*distanceTiles(node.center,candidate.center)*0.35;
      const score=preview.score+hierarchyPenalty;
      candidateComparisons.push(Object.freeze({nodeId:node.id,candidateId:candidate.id,score:Number(score.toFixed(2)),waterSamples:preview.water,reliefMeters:Number(preview.relief.toFixed(1))}));
      if(!best||score<best.score||(score===best.score&&candidate.id<best.candidate.id))best={candidate,score};
    }
    if(!best)best={candidate:connected[0],score:0};
    const k=edgeKey(node.id,best.candidate.id);
    if(!seenEdges.has(k)&&edges.length<MAX_EDGES){edges.push(makeEdge(seed,node,best.candidate,edges.length,"hierarchy-backbone"));seenEdges.add(k)}
    connected.push(node);
  }
  const high=nodes.filter(node=>node.priority>=2);
  let redundancy=0;
  for(const node of high){
    if(redundancy>=MAX_REDUNDANCY_EDGES||edges.length>=MAX_EDGES)break;
    const alternatives=high.filter(other=>other.id!==node.id&&!seenEdges.has(edgeKey(node.id,other.id))).sort((a,b)=>distanceTiles(node.center,a.center)-distanceTiles(node.center,b.center)||b.priority-a.priority||a.id.localeCompare(b.id));
    const other=alternatives[0];if(!other)continue;
    const direct=distanceMeters(node.center,other.center);
    if(direct>52000)continue;
    edges.push(makeEdge(seed,node,other,edges.length,"strategic-redundancy"));
    seenEdges.add(edgeKey(node.id,other.id));redundancy++;
  }
  const adjacency=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){adjacency.get(edge.aId)?.push(edge);adjacency.get(edge.bId)?.push(edge)}
  const junctions=[];
  for(const node of nodes){
    const connectedEdges=adjacency.get(node.id)||[];
    if(connectedEdges.length<3)continue;
    const branches=connectedEdges.map(edge=>{
      const otherId=edge.aId===node.id?edge.bId:edge.aId,other=nodes.find(item=>item.id===otherId);
      const dx=Number(BigInt(other.center.x)-BigInt(node.center.x)),dy=Number(BigInt(other.center.y)-BigInt(node.center.y));
      const degrees=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
      return Object.freeze({edgeId:edge.id,destinationId:other.id,destinationName:other.name,roadClass:edge.roadClass,bearingDegrees:Number(degrees.toFixed(1))});
    }).sort((a,b)=>a.bearingDegrees-b.bearingDegrees||a.edgeId.localeCompare(b.edgeId));
    junctions.push(Object.freeze({id:"WJUNC|"+hashText(seed+"|"+node.id),nodeId:node.id,name:node.name,degree:connectedEdges.length,branches:Object.freeze(branches),authority:"WorldRoadGraph adjacency"}));
  }
  const classCounts={},edgeClassCounts={};
  for(const node of nodes)classCounts[node.importanceClass]=(classCounts[node.importanceClass]||0)+1;
  for(const edge of edges)edgeClassCounts[edge.roadClass]=(edgeClassCounts[edge.roadClass]||0)+1;
  const signature="WRG-"+hashText([VERSION,seed,country.id,...nodes.map(n=>n.id+"@"+n.center.x+","+n.center.y),...edges.map(e=>e.id+":"+e.aId+">"+e.bId+":"+e.roadClass+":"+e.geometry.points.map(p=>p.x+","+p.y).join(";"))].join("|"));
  const result=Object.freeze({
    version:VERSION,seed,countryId:String(country.id),countryName:String(country.name||""),radius,
    nodes:Object.freeze(nodes),edges:Object.freeze(edges),junctions:Object.freeze(junctions),signature,
    diagnostics:Object.freeze({
      nodeCount:nodes.length,edgeCount:edges.length,junctionCount:junctions.length,
      nodeClassCounts:Object.freeze(classCounts),edgeClassCounts:Object.freeze(edgeClassCounts),
      connectedComponents:nodes.length?1:0,redundancyEdgeCount:redundancy,
      candidateComparisonCount:candidateComparisons.length,
      geographyInfluencedEdgeCount:edges.filter(edge=>edge.geometry.geographyInfluenced).length,
      detouredEdgeCount:edges.filter(edge=>edge.geometry.offsetSampleCount>0).length,
      waterCrossingCount:edges.reduce((sum,edge)=>sum+edge.crossingCount,0),
      totalCorridorSamples:edges.reduce((sum,edge)=>sum+edge.geometry.samples.length,0),
      maxNodes:MAX_NODES,maxEdges:MAX_EDGES,maxRedundancyEdges:MAX_REDUNDANCY_EDGES,
      catalogQueryCellCount:catalog.diagnostics.queryCellCount,catalogCenterCount:catalog.diagnostics.centerCount,
      catalogRecordCount:catalog.diagnostics.recordCount,catalogPlanningMs:catalog.diagnostics.planningMs,
      catalogCellLimitPerClass:CATALOG_CELL_LIMIT_PER_CLASS,catalogResultLimitPerClass:CATALOG_RESULT_LIMIT_PER_CLASS,
      planningMs:Number((now()-started).toFixed(3)),bounded:true,fullWorldScan:false,
      localChunkMaterialization:false,detailedSegmentsMaterialized:0,perFramePlanning:false,
      cameraIndependent:true,viewportIndependent:true,seedOnly:true
    })
  });
  graphCache.set(cacheKey,result);while(graphCache.size>GRAPH_CACHE_LIMIT)graphCache.delete(graphCache.keys().next().value);
  if(persistentOptions)window.GeneratedWorldStore?.recordGenerated?.(persistentOptions,result);
  return result;
}
function route(seedValue,countryValue,fromIdValue,toIdValue,optionsValue){
  const started=now(),graph=graphForCountry(seedValue,countryValue,optionsValue),fromId=String(fromIdValue||""),toId=String(toIdValue||"");
  if(!graph)return Object.freeze({found:false,reason:"graph-unavailable",edgeIds:Object.freeze([]),nodeIds:Object.freeze([]),queryMs:Number((now()-started).toFixed(3))});
  if(fromId===toId&&graph.nodes.some(node=>node.id===fromId))return Object.freeze({found:true,fromId,toId,edgeIds:Object.freeze([]),nodeIds:Object.freeze([fromId]),distanceMeters:0,queryMs:Number((now()-started).toFixed(3)),expandedNodes:0});
  const adj=new Map(graph.nodes.map(node=>[node.id,[]]));
  for(const edge of graph.edges){adj.get(edge.aId)?.push({edge,to:edge.bId});adj.get(edge.bId)?.push({edge,to:edge.aId})}
  const dist=new Map([[fromId,0]]),prev=new Map(),open=[{id:fromId,cost:0}];let expanded=0;
  while(open.length&&expanded<MAX_ROUTE_EXPANSIONS){
    open.sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id));const current=open.shift();
    if(current.cost!==dist.get(current.id))continue;
    if(current.id===toId)break;expanded++;
    for(const step of (adj.get(current.id)||[])){
      const next=current.cost+Number(step.edge.weight||step.edge.distanceMeters||0),prior=dist.get(step.to);
      if(prior==null||next<prior-1e-9){dist.set(step.to,next);prev.set(step.to,{from:current.id,edge:step.edge});open.push({id:step.to,cost:next})}
    }
  }
  if(!dist.has(toId))return Object.freeze({found:false,reason:"unreachable",fromId,toId,edgeIds:Object.freeze([]),nodeIds:Object.freeze([]),queryMs:Number((now()-started).toFixed(3)),expandedNodes:expanded});
  const edgeIds=[],nodeIds=[toId];let cursor=toId,distance=0;
  while(cursor!==fromId){const step=prev.get(cursor);if(!step)break;edgeIds.push(step.edge.id);distance+=Number(step.edge.distanceMeters||0);cursor=step.from;nodeIds.push(cursor)}
  edgeIds.reverse();nodeIds.reverse();
  return Object.freeze({found:cursor===fromId,fromId,toId,edgeIds:Object.freeze(edgeIds),nodeIds:Object.freeze(nodeIds),distanceMeters:Number(distance.toFixed(1)),queryMs:Number((now()-started).toFixed(3)),expandedNodes:expanded,bounded:expanded<=MAX_ROUTE_EXPANSIONS,localChunkMaterialization:false});
}
function nearestNode(seedValue,countryValue,pointValue,optionsValue){
  const graph=graphForCountry(seedValue,countryValue,optionsValue);if(!graph||!pointValue)return null;
  const point={x:String(pointValue.x),y:String(pointValue.y)};
  return graph.nodes.slice().sort((a,b)=>distanceTiles(point,a.center)-distanceTiles(point,b.center)||b.priority-a.priority||a.id.localeCompare(b.id))[0]||null;
}
function proof(seedValue,countryValue){
  const seed=String(seedValue==null?"":seedValue),country=normalizeCountry(seed,countryValue),graph=graphForCountry(seed,country,{radius:4});
  if(!graph)return Object.freeze({pass:false,reason:"country-unavailable"});
  const rebuiltSignature=(()=>{graphCache.clear();return graphForCountry(seed,country,{radius:4})?.signature||""})();
  const nodes=graph.nodes,root=nodes[0]||null,leaves=nodes.filter(node=>node.id!==root?.id).slice(-Math.min(6,Math.max(0,nodes.length-1)));
  const routes=leaves.map(node=>route(seed,country,node.id,root.id,{radius:4}));
  const edgeUse=new Map();for(const r of routes)for(const id of r.edgeIds)edgeUse.set(id,(edgeUse.get(id)||0)+1);
  const shared=[...edgeUse.entries()].filter(([,count])=>count>=2).map(([edgeId,count])=>Object.freeze({edgeId,count}));
  const everyConnected=nodes.length<=1||nodes.every(node=>graph.edges.some(edge=>edge.aId===node.id||edge.bId===node.id));
  const routePass=routes.every(r=>r.found&&r.bounded&&r.localChunkMaterialization===false);
  return Object.freeze({
    pass:Boolean(graph.signature===rebuiltSignature&&everyConnected&&routePass&&graph.diagnostics.connectedComponents===1&&graph.diagnostics.bounded&&!graph.diagnostics.fullWorldScan&&graph.diagnostics.localChunkMaterialization===false&&graph.edges.length>=Math.max(0,graph.nodes.length-1)),
    version:VERSION,seed,countryId:graph.countryId,signature:graph.signature,rebuiltSignature,
    deterministic:graph.signature===rebuiltSignature,everyConnected,routePass,sharedCorridors:Object.freeze(shared),
    representativeRoutes:Object.freeze(routes),nodeCount:graph.nodes.length,edgeCount:graph.edges.length,junctionCount:graph.junctions.length,
    diagnostics:graph.diagnostics
  });
}
function clear(){graphCache.clear()}

window.WorldRoadGraph=Object.freeze({
  VERSION,MAX_NODES,MAX_EDGES,MAX_REDUNDANCY_EDGES,MAX_ROUTE_EXPANSIONS,GRAPH_CACHE_LIMIT,CATALOG_CELL_LIMIT_PER_CLASS,CATALOG_RESULT_LIMIT_PER_CLASS,
  graphForCountry,route,nearestNode,proof,clear
});
})();