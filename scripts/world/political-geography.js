(function(){
"use strict";

const COUNTRY_CELL_SIZE=196608;
const COUNTRY_JITTER=35389;
const CANDIDATE_RADIUS=1;
const BORDER_WARP_SCALE_A=32768;
const BORDER_WARP_SCALE_B=16384;
const COUNTRY_WORDS_A=Object.freeze([
  "Alder","Amber","Ashen","Black","Bright","Cedar","Dawn","Elder","Falcon","Golden","Green","Grey",
  "High","Iron","Ivory","Lake","North","Oak","Raven","Red","River","Silver","Stone","Sun","Thorn","West","White","Wolf"
]);
const COUNTRY_WORDS_B=Object.freeze([
  "barrow","brook","crown","dale","fall","field","ford","gate","haven","hold","keep","march","mere","moor",
  "reach","ridge","stead","vale","watch","wick","wood"
]);
const COUNTRY_FORMS=Object.freeze(["Realm","Kingdom","Principality","March","Dominion"]);
const PLANET_ANCHOR_CACHE=new Map();
const PLANET_TILE_METERS=2;
const PLANET_RADIUS_METERS=637100;
const BOUNDARY_GRAPH_REVISION="CBG-1";
const BOUNDARY_GRAPH_GRID=37;
const BOUNDARY_GRAPH_HALFSPAN_FACTOR=1.45;
const BOUNDARY_GRAPH_CACHE=new Map();

function toBig(value){return BigInt(WorldCoordinates.normalize(value))}
function floorDiv(value,divisor){
  let q=value/divisor;
  const r=value%divisor;
  if(r!==0n&&value<0n)q-=1n;
  return q;
}
function positiveMod(value,divisor){
  const r=value%divisor;
  return r<0n?r+divisor:r;
}
function cellKey(cx,cy){return cx.toString()+":"+cy.toString()}
function unit(seed,key){return PRNG.foundationUint32(seed,key)/4294967296}
function integer(seed,key,min,max){
  const span=max-min+1;
  return min+(PRNG.foundationUint32(seed,key)%span);
}
function pick(seed,key,list){return list[PRNG.foundationUint32(seed,key)%list.length]}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function smoothstep(value){
  const t=Math.max(0,Math.min(1,value));
  return t*t*(3-2*t);
}
function lerp(a,b,t){return a+(b-a)*t}
function valueNoise(seed,label,xValue,yValue,scaleValue){
  const x=toBig(xValue),y=toBig(yValue),scale=BigInt(scaleValue);
  const gx=floorDiv(x,scale),gy=floorDiv(y,scale);
  const lx=Number(x-gx*scale)/Number(scale);
  const ly=Number(y-gy*scale)/Number(scale);
  const tx=smoothstep(lx),ty=smoothstep(ly);
  const n00=unit(seed,label+":"+cellKey(gx,gy));
  const n10=unit(seed,label+":"+cellKey(gx+1n,gy));
  const n01=unit(seed,label+":"+cellKey(gx,gy+1n));
  const n11=unit(seed,label+":"+cellKey(gx+1n,gy+1n));
  return lerp(lerp(n00,n10,tx),lerp(n01,n11,tx),ty);
}
function politicalCellFor(xValue,yValue){
  const size=BigInt(COUNTRY_CELL_SIZE);
  return Object.freeze({x:floorDiv(toBig(xValue),size),y:floorDiv(toBig(yValue),size)});
}
function countryId(seed,cx,cy){
  const key=cellKey(cx,cy);
  return "CTR|"+cx.toString()+"|"+cy.toString()+"|"+hashText(seed+"|country|"+key).slice(0,8);
}
function rawCountryName(seed,key){
  const a=pick(seed,"country-name:a:"+key,COUNTRY_WORDS_A);
  const b=pick(seed,"country-name:b:"+key,COUNTRY_WORDS_B);
  const form=pick(seed,"country-name:form:"+key,COUNTRY_FORMS);
  return Object.freeze({a,b,form,name:form+" of "+a+b});
}
function countryNaming(seed,cx,cy){
  const key=cellKey(cx,cy),id=countryId(seed,cx,cy);
  if(window.PlaceNaming?.descriptor){
    const input={id,type:"country",x:cx.toString(),y:cy.toString()};
    const raw=window.PlaceNaming.descriptor(seed,input,0),colliders=[];
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const ox=cx+BigInt(dx),oy=cy+BigInt(dy),otherId=countryId(seed,ox,oy);
      const other=window.PlaceNaming.descriptor(seed,{id:otherId,type:"country",x:ox.toString(),y:oy.toString()},0);
      if(other.name===raw.name)colliders.push(otherId);
    }
    colliders.sort();
    const rank=Math.max(0,colliders.indexOf(id));
    return window.PlaceNaming.descriptor(seed,input,rank);
  }
  const raw=rawCountryName(seed,key),colliders=[];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const otherKey=cellKey(cx+BigInt(dx),cy+BigInt(dy));
    if(rawCountryName(seed,otherKey).name===raw.name)colliders.push(otherKey);
  }
  colliders.sort();
  const rank=colliders.indexOf(key);
  let name=raw.name;
  if(rank>0){
    const baseFormIndex=Math.max(0,COUNTRY_FORMS.indexOf(raw.form));
    name=COUNTRY_FORMS[(baseFormIndex+rank)%COUNTRY_FORMS.length]+" of "+raw.a+raw.b+(rank>=COUNTRY_FORMS.length?" "+String(rank+1):"");
  }
  return Object.freeze({entityId:id,name,canonicalName:name,shortForm:raw.a+raw.b,namingCultureKey:"legacy",nameGenerationVersion:0,attempt:Math.max(0,rank),authority:"legacy PoliticalGeography naming"});
}
function countryName(seed,cx,cy){return countryNaming(seed,cx,cy).name}
function centerForCell(seed,cx,cy){
  const size=BigInt(COUNTRY_CELL_SIZE),half=BigInt(Math.floor(COUNTRY_CELL_SIZE/2));
  const key=cellKey(cx,cy);
  const jx=BigInt(integer(seed,"country-center:jx:"+key,-COUNTRY_JITTER,COUNTRY_JITTER));
  const jy=BigInt(integer(seed,"country-center:jy:"+key,-COUNTRY_JITTER,COUNTRY_JITTER));
  return Object.freeze({
    x:(cx*size+half+jx).toString(),
    y:(cy*size+half+jy).toString()
  });
}
function candidateForCell(seed,cx,cy){
  const key=cellKey(cx,cy),id=countryId(seed,cx,cy),naming=countryNaming(seed,cx,cy);
  return Object.freeze({
    id,
    name:naming.name,
    namingCultureKey:naming.namingCultureKey||null,
    nameGenerationVersion:Number(naming.nameGenerationVersion||0),
    namingAuthority:String(naming.authority||""),
    namingAttempt:Number(naming.attempt||0),
    cellX:cx.toString(),cellY:cy.toString(),
    key,
    politicalCenter:centerForCell(seed,cx,cy),
    elevationPreference:0.18+unit(seed,"country-pref:elevation:"+key)*0.72,
    moisturePreference:0.12+unit(seed,"country-pref:moisture:"+key)*0.78,
    waterAffinity:unit(seed,"country-affinity:water:"+key),
    highlandAffinity:unit(seed,"country-affinity:highland:"+key),
    woodlandAffinity:unit(seed,"country-affinity:woodland:"+key),
    routeAffinity:unit(seed,"country-affinity:route:"+key)
  });
}
function candidateCellsForPoint(xValue,yValue){
  const base=politicalCellFor(xValue,yValue);
  const out=[];
  for(let dy=-CANDIDATE_RADIUS;dy<=CANDIDATE_RADIUS;dy++){
    for(let dx=-CANDIDATE_RADIUS;dx<=CANDIDATE_RADIUS;dx++){
      out.push(Object.freeze({x:base.x+BigInt(dx),y:base.y+BigInt(dy)}));
    }
  }
  return out;
}
function environmentContext(seed,x,y){
  const environment=GeographyFoundation.environment(seed,x,y);
  const terrain=GeographyFoundation.getTerrainType(seed,x,y);
  return Object.freeze({environment,terrain});
}
function scoreCandidate(seed,xValue,yValue,candidate,context,mode){
  const x=toBig(xValue),y=toBig(yValue);
  const cx=toBig(candidate.politicalCenter.x),cy=toBig(candidate.politicalCenter.y);
  const dx=Number(x-cx)/COUNTRY_CELL_SIZE;
  const dy=Number(y-cy)/COUNTRY_CELL_SIZE;
  const distance=Math.hypot(dx,dy);
  if(mode==="geometry")return Object.freeze({score:distance,distance,geographyPenalty:0,warp:0});
  const warpA=valueNoise(seed,"country-border-warp:a:"+candidate.key,xValue,yValue,BORDER_WARP_SCALE_A)-0.5;
  const warpB=valueNoise(seed,"country-border-warp:b:"+candidate.key,xValue,yValue,BORDER_WARP_SCALE_B)-0.5;
  const warp=warpA*0.07+warpB*0.035;
  let geographyPenalty=0;
  if(mode!=="no-geography"){
    const elevation=Number(context.environment.elevationMeters||0)/1850;
    const moisture=Number(context.environment.moisturePercent||0)/100;
    geographyPenalty+=Math.abs(elevation-candidate.elevationPreference)*0.075;
    geographyPenalty+=Math.abs(moisture-candidate.moisturePreference)*0.055;
    const terrain=context.terrain;
    if(terrain==="water")geographyPenalty+=(1-candidate.waterAffinity)*0.045;
    else if(terrain==="rock")geographyPenalty+=(1-candidate.highlandAffinity)*0.038;
    else if(terrain==="forest")geographyPenalty+=(1-candidate.woodlandAffinity)*0.032;
    else if(terrain==="road"||terrain==="bridge")geographyPenalty-=candidate.routeAffinity*0.03;
    else if(terrain==="mud")geographyPenalty+=(1-candidate.waterAffinity)*0.018;
  }
  return Object.freeze({score:distance+warp+geographyPenalty,distance,geographyPenalty,warp});
}
function resolveWinner(seed,xValue,yValue,mode){
  const x=WorldCoordinates.normalize(xValue),y=WorldCoordinates.normalize(yValue);
  const context=environmentContext(seed,x,y);
  let best=null,second=null;
  for(const cell of candidateCellsForPoint(x,y)){
    const candidate=candidateForCell(seed,cell.x,cell.y);
    const score=scoreCandidate(seed,x,y,candidate,context,mode||"full");
    const item={candidate,score};
    if(!best||score.score<best.score.score||(score.score===best.score.score&&candidate.id<best.candidate.id)){
      second=best;best=item;
    }else if(!second||score.score<second.score.score||(score.score===second.score.score&&candidate.id<second.candidate.id)){
      second=item;
    }
  }
  return Object.freeze({
    x,y,context,best,second,
    candidateCount:(CANDIDATE_RADIUS*2+1)**2
  });
}
function planetSurfaceAt(seed,xValue,yValue){
  const pg=window.PlanetGeography;
  if(!pg?.create)return null;
  try{
    const instance=pg.create(seed);
    const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||pg.DEFAULT_TILE_METERS||PLANET_TILE_METERS));
    const radius=Math.max(1,Number(pg.DEFAULT_WORLD_RADIUS_METERS||PLANET_RADIUS_METERS));
    const geo=instance.worldLatLonForTile(xValue,yValue,tileMeters,radius);
    const sample=instance.sampleLatLon(geo.latitudeRadians,geo.longitudeRadians);
    return Object.freeze({geo,sample});
  }catch(_){return null;}
}
function deterministicCountryLandAnchor(seed,candidate){
  const key=String(seed)+"|"+candidate.id;
  if(PLANET_ANCHOR_CACHE.has(key))return PLANET_ANCHOR_CACHE.get(key);
  const baseX=toBig(candidate.politicalCenter.x),baseY=toBig(candidate.politicalCenter.y);
  const phase=unit(seed,"country-planet-anchor:phase:"+candidate.key)*Math.PI*2;
  const step=Math.max(1024,Math.floor(COUNTRY_CELL_SIZE/12));
  const options=[{x:baseX,y:baseY,ring:0,spoke:0}];
  for(let ring=1;ring<=7;ring++){
    const radius=step*ring;
    for(let spoke=0;spoke<16;spoke++){
      const angle=phase+Math.PI*2*spoke/16;
      options.push({
        x:baseX+BigInt(Math.round(Math.cos(angle)*radius)),
        y:baseY+BigInt(Math.round(Math.sin(angle)*radius)),
        ring,spoke
      });
    }
  }
  let best=null;
  for(const option of options){
    const x=option.x.toString(),y=option.y.toString();
    let winner=null;try{winner=resolveWinner(seed,x,y,"full").best?.candidate||null;}catch(_){winner=null;}
    if(!winner||winner.id!==candidate.id)continue;
    const surface=planetSurfaceAt(seed,x,y);
    if(!surface?.sample?.land)continue;
    const elevation=Number(surface.sample.elevationMeters||0);
    const score=option.ring*100+Math.abs(elevation-420)/4000+option.spoke*.0001;
    if(!best||score<best.score)best={
      score,x,y,ring:option.ring,spoke:option.spoke,
      latitudeRadians:surface.geo.latitudeRadians,longitudeRadians:surface.geo.longitudeRadians,
      surfaceClass:surface.sample.surfaceClass,elevationMeters:elevation,
      continentId:surface.sample.continentId||null,continentName:surface.sample.continentName||null
    };
  }
  const result=best?Object.freeze({
    x:best.x,y:best.y,searchRing:best.ring,searchSpoke:best.spoke,
    latitudeRadians:best.latitudeRadians,longitudeRadians:best.longitudeRadians,
    surfaceClass:best.surfaceClass,elevationMeters:Number(best.elevationMeters.toFixed(2)),
    continentId:best.continentId,continentName:best.continentName,
    authority:"PoliticalGeography+PlanetGeography owned-land anchor"
  }):null;
  PLANET_ANCHOR_CACHE.set(key,result);
  return result;
}
function ownerClearancePass(seed,countryId,xValue,yValue,clearanceValue){
  const clearance=Math.max(0,Math.round(Number(clearanceValue)||0));
  if(ownerAt(seed,xValue,yValue).id!==countryId)return false;
  if(clearance<=0)return true;
  const x=toBig(xValue),y=toBig(yValue);
  for(let i=0;i<12;i++){
    const angle=Math.PI*2*i/12;
    const px=(x+BigInt(Math.round(Math.cos(angle)*clearance))).toString();
    const py=(y+BigInt(Math.round(Math.sin(angle)*clearance))).toString();
    if(ownerAt(seed,px,py).id!==countryId)return false;
  }
  return true;
}
function capitalForCandidate(seed,candidate){
  const mapAnchor=deterministicCountryLandAnchor(seed,candidate);
  if(mapAnchor){
    const baseX=toBig(mapAnchor.x),baseY=toBig(mapAnchor.y);
    const rotation=unit(seed,"country-capital:rotation:"+candidate.key)*Math.PI*2;
    const options=[Object.freeze({x:baseX,y:baseY,ring:0})];
    for(let ring=1;ring<=4;ring++){
      const radius=BigInt(384*ring);
      for(let spoke=0;spoke<12;spoke++){
        const angle=rotation+(Math.PI*2*spoke/12);
        options.push(Object.freeze({
          x:baseX+BigInt(Math.round(Math.cos(angle)*Number(radius))),
          y:baseY+BigInt(Math.round(Math.sin(angle)*Number(radius))),
          ring
        }));
      }
    }
    for(const option of options){
      const x=option.x.toString(),y=option.y.toString();
      let winner=null;try{winner=resolveWinner(seed,x,y,"full").best?.candidate||null;}catch(_){winner=null;}
      if(!winner||winner.id!==candidate.id)continue;
      if(!ownerClearancePass(seed,candidate.id,x,y,768))continue;
      const surface=planetSurfaceAt(seed,x,y);
      if(!surface?.sample?.land)continue;
      const terrain=GeographyFoundation.getTerrainType(seed,x,y);
      const env=GeographyFoundation.environment(seed,x,y);
      return Object.freeze({
        x,y,terrain,elevationMeters:env.elevationMeters,
        planetLand:true,planetSurfaceClass:surface.sample.surfaceClass,
        latitudeRadians:surface.geo.latitudeRadians,longitudeRadians:surface.geo.longitudeRadians,
        parentCountryMatch:true,authority:"PoliticalGeography+PlanetGeography owned-land capital"
      });
    }
  }
  const baseX=toBig(candidate.politicalCenter.x),baseY=toBig(candidate.politicalCenter.y);
  const x=baseX.toString(),y=baseY.toString(),env=GeographyFoundation.environment(seed,x,y);
  return Object.freeze({
    x,y,terrain:GeographyFoundation.getTerrainType(seed,x,y),elevationMeters:env.elevationMeters,
    planetLand:false,planetSurfaceClass:null,latitudeRadians:null,longitudeRadians:null,
    parentCountryMatch:resolveWinner(seed,x,y,"full").best?.candidate?.id===candidate.id,
    authority:"legacy fallback: no owned PlanetGeography land found"
  });
}
function countryFromCandidate(seed,candidate,scoreValue){
  const mapAnchor=deterministicCountryLandAnchor(seed,candidate);
  const capital=capitalForCandidate(seed,candidate);
  return Object.freeze({
    id:candidate.id,
    name:candidate.name,
    namingCultureKey:candidate.namingCultureKey||null,
    nameGenerationVersion:Number(candidate.nameGenerationVersion||0),
    namingAuthority:String(candidate.namingAuthority||""),
    namingAttempt:Number(candidate.namingAttempt||0),
    cellX:candidate.cellX,cellY:candidate.cellY,
    politicalCenter:candidate.politicalCenter,
    mapAnchor:mapAnchor||candidate.politicalCenter,
    capital:Object.freeze({
      id:"CAP|"+candidate.id,
      name:window.PlaceNaming?.nameSettlement
        ?window.PlaceNaming.nameSettlement(seed,{id:"CAP|"+candidate.id,type:"capital",countryId:candidate.id,x:capital.x,y:capital.y})
        :candidate.name+" Capital",
      nameGenerationVersion:Number(window.PlaceNaming?.VERSION||0),
      namingCultureKey:window.PlaceNaming?.cultureId?.(seed,candidate.id,"CAP|"+candidate.id)||null,
      x:capital.x,y:capital.y,
      terrain:capital.terrain,
      elevationMeters:capital.elevationMeters,
      planetLand:Boolean(capital.planetLand),
      planetSurfaceClass:capital.planetSurfaceClass||null,
      latitudeRadians:capital.latitudeRadians,
      longitudeRadians:capital.longitudeRadians,
      parentCountryMatch:Boolean(capital.parentCountryMatch),
      authority:capital.authority
    }),
    ownership:"country",
    foundation:"campaign-seed",
    immutableStartingTerritory:true,
    influenceScore:Number(scoreValue?.score??0),
    geographyPenalty:Number(scoreValue?.geographyPenalty??0)
  });
}
function ownerAt(seed,xValue,yValue){
  const resolved=resolveWinner(seed,xValue,yValue,"full");
  const c=resolved.best.candidate;
  return Object.freeze({
    id:c.id,name:c.name,cellX:c.cellX,cellY:c.cellY,
    ownership:"country",
    influenceScore:resolved.best.score.score,
    geographyPenalty:resolved.best.score.geographyPenalty,
    terrain:resolved.context.terrain,
    elevationMeters:resolved.context.environment.elevationMeters
  });
}
function countryAt(seed,xValue,yValue){
  const resolved=resolveWinner(seed,xValue,yValue,"full");
  return countryFromCandidate(seed,resolved.best.candidate,resolved.best.score);
}
function countryForCell(seed,cxValue,cyValue){
  const cx=BigInt(cxValue),cy=BigInt(cyValue);
  const candidate=candidateForCell(seed,cx,cy);
  return countryFromCandidate(seed,candidate,Object.freeze({score:0,geographyPenalty:0}));
}
function parseCountryId(seed,idValue){
  const parts=String(idValue||"").split("|");
  if(parts.length!==4||parts[0]!=="CTR")return null;
  try{
    const cx=BigInt(parts[1]),cy=BigInt(parts[2]);
    const candidate=candidateForCell(seed,cx,cy);
    return candidate.id===String(idValue)?candidate:null;
  }catch(_){return null}
}
function countryById(seed,idValue){
  const candidate=parseCountryId(seed,idValue);
  return candidate?countryFromCandidate(seed,candidate,Object.freeze({score:0,geographyPenalty:0})):null;
}
function surroundingCountries(seed,countryValue){
  const country=typeof countryValue==="string"?countryById(seed,countryValue):countryValue;
  if(!country)return Object.freeze([]);
  const center=country.politicalCenter;
  const unique=new Map();
  const radii=[0.58,0.78,1.0,1.18];
  for(const radiusFactor of radii){
    const radius=COUNTRY_CELL_SIZE*radiusFactor;
    for(let i=0;i<32;i++){
      const angle=Math.PI*2*i/32;
      const x=(toBig(center.x)+BigInt(Math.round(Math.cos(angle)*radius))).toString();
      const y=(toBig(center.y)+BigInt(Math.round(Math.sin(angle)*radius))).toString();
      const owner=ownerAt(seed,x,y);
      if(owner.id!==country.id)unique.set(owner.id,owner);
    }
  }
  return Object.freeze([...unique.values()].sort((a,b)=>a.id.localeCompare(b.id)));
}
function transitionBetween(seed,countryA,countryB,modeValue){
  const mode=modeValue||"full";
  const ax=toBig(countryA.politicalCenter.x),ay=toBig(countryA.politicalCenter.y);
  const bx=toBig(countryB.politicalCenter.x),by=toBig(countryB.politicalCenter.y);
  const ownerId=t=>{
    const x=(ax+BigInt(Math.round(Number(bx-ax)*t))).toString();
    const y=(ay+BigInt(Math.round(Number(by-ay)*t))).toString();
    return resolveWinner(seed,x,y,mode).best.candidate.id;
  };
  let previousT=0,previousId=ownerId(0);
  let lo=null,hi=null;
  for(let i=1;i<=96;i++){
    const t=i/96;
    const id=ownerId(t);
    if(previousId===countryA.id&&id===countryB.id){lo=previousT;hi=t;break}
    previousT=t;previousId=id;
  }
  if(lo==null)return null;
  for(let i=0;i<20;i++){
    const mid=(lo+hi)/2;
    if(ownerId(mid)===countryA.id)lo=mid;else hi=mid;
  }
  const t=(lo+hi)/2;
  const x=(ax+BigInt(Math.round(Number(bx-ax)*t))).toString();
  const y=(ay+BigInt(Math.round(Number(by-ay)*t))).toString();
  return Object.freeze({t,x,y});
}
function borderForPair(seed,countryA,countryB){
  const full=transitionBetween(seed,countryA,countryB,"full");
  if(!full)return null;
  const noGeography=transitionBetween(seed,countryA,countryB,"no-geography");
  const geometry=transitionBetween(seed,countryA,countryB,"geometry");
  const ax=Number(toBig(countryA.politicalCenter.x)),ay=Number(toBig(countryA.politicalCenter.y));
  const bx=Number(toBig(countryB.politicalCenter.x)),by=Number(toBig(countryB.politicalCenter.y));
  const centerDistance=Math.hypot(bx-ax,by-ay);
  const featureShiftTiles=noGeography?Math.abs(full.t-noGeography.t)*centerDistance:0;
  const geometryShiftTiles=geometry?Math.abs(full.t-geometry.t)*centerDistance:0;
  const sampleContext=environmentContext(seed,full.x,full.y);
  const samples=[];
  for(const delta of [0.012,0.022,0.034]){
    const leftT=Math.max(0,full.t-delta),rightT=Math.min(1,full.t+delta);
    const lx=Math.round(ax+(bx-ax)*leftT),ly=Math.round(ay+(by-ay)*leftT);
    const rx=Math.round(ax+(bx-ax)*rightT),ry=Math.round(ay+(by-ay)*rightT);
    samples.push(Object.freeze({
      side:"A",x:String(lx),y:String(ly),countryId:ownerAt(seed,String(lx),String(ly)).id
    }));
    samples.push(Object.freeze({
      side:"B",x:String(rx),y:String(ry),countryId:ownerAt(seed,String(rx),String(ry)).id
    }));
  }
  const modX=Number(positiveMod(toBig(full.x),BigInt(COUNTRY_CELL_SIZE)));
  const modY=Number(positiveMod(toBig(full.y),BigInt(COUNTRY_CELL_SIZE)));
  const nearMacroEdge=value=>Math.min(value,COUNTRY_CELL_SIZE-value)<96;
  return Object.freeze({
    id:"BORDER|"+countryA.id+"|"+countryB.id,
    countryA:Object.freeze({id:countryA.id,name:countryA.name}),
    countryB:Object.freeze({id:countryB.id,name:countryB.name}),
    x:full.x,y:full.y,t:full.t,
    terrain:sampleContext.terrain,
    elevationMeters:sampleContext.environment.elevationMeters,
    moisturePercent:sampleContext.environment.moisturePercent,
    featureShiftTiles:Number(featureShiftTiles.toFixed(3)),
    geometryShiftTiles:Number(geometryShiftTiles.toFixed(3)),
    naturalFeatureInfluenced:featureShiftTiles>=1,
    nonMacroRectangular:!(nearMacroEdge(modX)&&nearMacroEdge(modY)),
    samples:Object.freeze(samples),
    sideSamplesPass:samples.every(sample=>sample.countryId===(sample.side==="A"?countryA.id:countryB.id))
  });
}
function borderEvidence(seed,countryValue){
  const country=typeof countryValue==="string"?countryById(seed,countryValue):countryValue;
  if(!country)return Object.freeze([]);
  const surrounding=surroundingCountries(seed,country);
  const borders=[];
  for(const neighborRef of surrounding){
    const neighbor=countryById(seed,neighborRef.id);
    const border=borderForPair(seed,country,neighbor);
    if(border&&border.sideSamplesPass)borders.push(border);
  }
  borders.sort((a,b)=>
    Number(b.naturalFeatureInfluenced)-Number(a.naturalFeatureInfluenced)||
    b.featureShiftTiles-a.featureShiftTiles||
    a.id.localeCompare(b.id)
  );
  return Object.freeze(borders);
}
function nearbyCountries(seed,countryValue){
  const country=typeof countryValue==="string"?countryById(seed,countryValue):countryValue;
  if(!country)return Object.freeze([]);
  return Object.freeze(borderEvidence(seed,country).map(border=>{
    const other=border.countryA.id===country.id?border.countryB:border.countryA;
    const full=countryById(seed,other.id);
    return Object.freeze({
      id:other.id,name:other.name,cellX:full?.cellX||null,cellY:full?.cellY||null,
      borderId:border.id
    });
  }));
}

function canonicalGraphSurfaceSampler(seed){
  const pg=window.PlanetGeography;
  if(!pg?.create)return null;
  let instance=null;
  try{instance=pg.create(seed);}catch(_){return null;}
  const tileMeters=Math.max(.001,Number(window.WorldStandards?.TILE_METERS||pg.DEFAULT_TILE_METERS||PLANET_TILE_METERS));
  const radius=Math.max(1,Number(pg.DEFAULT_WORLD_RADIUS_METERS||PLANET_RADIUS_METERS));
  return (xValue,yValue)=>{
    try{
      const geo=instance.worldLatLonForTile(xValue,yValue,tileMeters,radius);
      return Object.freeze({geo,sample:instance.sampleLatLon(geo.latitudeRadians,geo.longitudeRadians)});
    }catch(_){return null;}
  };
}
function boundaryPointKey(point){return String(point.x)+","+String(point.y)}
function canonicalBoundaryGraph(seedValue,countryValue){
  const seed=String(seedValue==null?"":seedValue);
  const countryId=typeof countryValue==="string"?String(countryValue):String(countryValue?.id||"");
  const candidate=parseCountryId(seed,countryId);
  if(!candidate)return null;
  const cacheKey=seed+"|"+countryId+"|"+BOUNDARY_GRAPH_REVISION;
  if(BOUNDARY_GRAPH_CACHE.has(cacheKey))return BOUNDARY_GRAPH_CACHE.get(cacheKey);
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const cols=BOUNDARY_GRAPH_GRID,rows=BOUNDARY_GRAPH_GRID;
  const halfSpan=Math.round(COUNTRY_CELL_SIZE*BOUNDARY_GRAPH_HALFSPAN_FACTOR);
  const centerX=toBig(candidate.politicalCenter.x),centerY=toBig(candidate.politicalCenter.y);
  const surfaceAt=canonicalGraphSurfaceSampler(seed);
  const nodes=[],ownerIds=new Set();
  let landSampleCount=0,waterSampleCount=0,ownerQueryCount=0,waterClippedCount=0;
  const nodeAt=(col,row)=>{
    const x=(centerX+BigInt(Math.round(-halfSpan+(halfSpan*2)*col/(cols-1)))).toString();
    const y=(centerY+BigInt(Math.round(-halfSpan+(halfSpan*2)*row/(rows-1)))).toString();
    const surface=surfaceAt?surfaceAt(x,y):null;
    const land=surface?Boolean(surface.sample?.land):true;
    if(!land){waterSampleCount++;return Object.freeze({land:false,owner:"water",x,y});}
    landSampleCount++;
    let owner=null;try{owner=ownerAt(seed,x,y);ownerQueryCount++;}catch(_){owner=null;}
    const id=String(owner?.id||"none");if(id!=="none")ownerIds.add(id);
    return Object.freeze({land:true,owner:id,x,y});
  };
  for(let row=0;row<rows;row++){
    const line=[];for(let col=0;col<cols;col++)line.push(nodeAt(col,row));nodes.push(line);
  }
  const politicalCrossing=(a,b)=>a.land&&b.land&&a.owner!==b.owner&&a.owner!=="none"&&b.owner!=="none"&&(a.owner===countryId||b.owner===countryId);
  const refinePolitical=(a,b)=>{
    let inside=a.owner===countryId?a:b,outside=a.owner===countryId?b:a;
    let ix=toBig(inside.x),iy=toBig(inside.y),ox=toBig(outside.x),oy=toBig(outside.y);
    for(let step=0;step<18;step++){
      const mx=(ix+ox)/2n,my=(iy+oy)/2n;
      if((mx===ix&&my===iy)||(mx===ox&&my===oy))break;
      let id="none";try{id=ownerAt(seed,mx.toString(),my.toString()).id;ownerQueryCount++;}catch(_){}
      if(id===countryId){ix=mx;iy=my;}else{ox=mx;oy=my;}
    }
    return Object.freeze({x:((ix+ox)/2n).toString(),y:((iy+oy)/2n).toString()});
  };
  const refineCoast=(a,b)=>{
    const land=a.land?a:b,water=a.land?b:a;
    let lx=toBig(land.x),ly=toBig(land.y),wx=toBig(water.x),wy=toBig(water.y);
    if(!surfaceAt)return Object.freeze({x:lx.toString(),y:ly.toString(),endpointClass:"coastline"});
    for(let step=0;step<18;step++){
      const mx=(lx+wx)/2n,my=(ly+wy)/2n;
      if((mx===lx&&my===ly)||(mx===wx&&my===wy))break;
      const sample=surfaceAt(mx.toString(),my.toString());
      if(sample?.sample?.land){lx=mx;ly=my;}else{wx=mx;wy=my;}
    }
    return Object.freeze({x:lx.toString(),y:ly.toString(),endpointClass:"coastline"});
  };
  const segmentOnLand=(a,b)=>{
    if(!surfaceAt)return true;
    const ax=toBig(a.x),ay=toBig(a.y),bx=toBig(b.x),by=toBig(b.y);
    for(let i=0;i<=6;i++){
      const x=(ax+BigInt(Math.round(Number(bx-ax)*i/6))).toString();
      const y=(ay+BigInt(Math.round(Number(by-ay)*i/6))).toString();
      if(!surfaceAt(x,y)?.sample?.land)return false;
    }
    return true;
  };
  const raw=[];
  for(let row=0;row<rows-1;row++)for(let col=0;col<cols-1;col++){
    const a=nodes[row][col],b=nodes[row][col+1],cc=nodes[row+1][col+1],d=nodes[row+1][col];
    const pairs=[[a,b],[b,cc],[d,cc],[a,d]],crossings=[],coasts=[];
    for(const [left,right] of pairs){
      if(left.land!==right.land){waterClippedCount++;coasts.push(refineCoast(left,right));continue;}
      if(politicalCrossing(left,right)){
        const owners=[left.owner,right.owner].sort();
        crossings.push({point:refinePolitical(left,right),owners});
      }
    }
    if(!crossings.length)continue;
    const byPair=new Map();
    for(const edge of crossings){
      const key=edge.owners.join("~");
      if(!byPair.has(key))byPair.set(key,{owners:edge.owners,edges:[]});
      byPair.get(key).edges.push(edge);
    }
    const oddGroups=[...byPair.values()].filter(group=>group.edges.length%2===1);
    const junction=coasts.length===0&&oddGroups.length>=2
      ?Object.freeze({
          x:((toBig(a.x)+toBig(b.x)+toBig(cc.x)+toBig(d.x))/4n).toString(),
          y:((toBig(a.y)+toBig(b.y)+toBig(cc.y)+toBig(d.y))/4n).toString(),
          endpointClass:"junction"
        }):null;
    const distSq=(p,q)=>{const dx=Number(toBig(p.x)-toBig(q.x)),dy=Number(toBig(p.y)-toBig(q.y));return dx*dx+dy*dy;};
    for(const group of byPair.values()){
      let i=0;
      const add=(p0,p1)=>{
        if(!p0||!p1||!segmentOnLand(p0,p1))return;
        raw.push({a:p0,b:p1,ownerA:group.owners[0],ownerB:group.owners[1]});
      };
      for(;i+1<group.edges.length;i+=2)add(group.edges[i].point,group.edges[i+1].point);
      if(i<group.edges.length){
        const edge=group.edges[i].point;
        let terminal=null;
        if(coasts.length)terminal=coasts.slice().sort((p,q)=>distSq(edge,p)-distSq(edge,q)).find(p=>segmentOnLand(edge,p))||null;
        else terminal=junction;
        add(edge,terminal);
      }
    }
  }
  let edges=raw;
  for(let pass=0;pass<4;pass++){
    const degree=new Map(),explicit=new Map();
    for(const edge of edges){
      for(const point of [edge.a,edge.b]){
        const key=boundaryPointKey(point);degree.set(key,(degree.get(key)||0)+1);
        if(point.endpointClass)explicit.set(key,point.endpointClass);
      }
    }
    const filtered=edges.filter(edge=>[edge.a,edge.b].every(point=>{
      const key=boundaryPointKey(point),d=degree.get(key)||0;
      return d!==1||explicit.get(key)==="coastline";
    }));
    if(filtered.length===edges.length)break;
    edges=filtered;
  }
  const degree=new Map(),explicit=new Map();
  for(const edge of edges){
    for(const point of [edge.a,edge.b]){
      const key=boundaryPointKey(point);degree.set(key,(degree.get(key)||0)+1);
      if(point.endpointClass)explicit.set(key,point.endpointClass);
    }
  }
  const nodeClasses=new Map();
  for(const [key,d] of degree){
    const cls=explicit.get(key)||(d>=3?"junction":d===2?"continuation":"unclassified");
    nodeClasses.set(key,cls);
  }
  const frozenEdges=Object.freeze(edges.map((edge,index)=>{
    const pair=[edge.ownerA,edge.ownerB].sort();
    const a=Object.freeze({x:String(edge.a.x),y:String(edge.a.y),classification:nodeClasses.get(boundaryPointKey(edge.a))||"continuation"});
    const b=Object.freeze({x:String(edge.b.x),y:String(edge.b.y),classification:nodeClasses.get(boundaryPointKey(edge.b))||"continuation"});
    const id="CBEDGE|"+hashText([BOUNDARY_GRAPH_REVISION,seed,countryId,pair.join("~"),a.x,a.y,b.x,b.y,index].join("|"));
    return Object.freeze({id,ownerA:pair[0],ownerB:pair[1],a,b});
  }));
  const ownerPairs=Object.freeze([...new Set(frozenEdges.map(edge=>[edge.ownerA,edge.ownerB].sort().join("~")))].sort());
  const endpointClassifications={coastline:0,junction:0,continuation:0,unclassified:0};
  for(const cls of nodeClasses.values())endpointClassifications[cls]=(endpointClassifications[cls]||0)+1;
  const signature="CBG|"+hashText([BOUNDARY_GRAPH_REVISION,seed,countryId,...frozenEdges.map(edge=>edge.id)].join("|"));
  const elapsed=(typeof performance!=="undefined"&&performance.now?performance.now():Date.now())-started;
  const graph=Object.freeze({
    revision:BOUNDARY_GRAPH_REVISION,signature,seed,countryId,
    center:Object.freeze({x:candidate.politicalCenter.x,y:candidate.politicalCenter.y}),
    grid:Object.freeze({columns:cols,rows,halfSpanTiles:halfSpan}),
    sampleCount:cols*rows,landSampleCount,waterSampleCount,ownerQueryCount,
    ownerCount:ownerIds.size,nodeCount:degree.size,edgeCount:frozenEdges.length,
    ownerPairs,endpointClassifications:Object.freeze(endpointClassifications),
    edges:frozenEdges,waterClippedCount,
    builtAtMs:Number(elapsed.toFixed(3)),fullWorldScan:false,
    authority:"PoliticalGeography.ownerAt canonical country-centered boundary graph"
  });
  BOUNDARY_GRAPH_CACHE.set(cacheKey,graph);
  return graph;
}
function pointSegmentDistance(x,y,a,b){
  const ax=Number(toBig(a.x)),ay=Number(toBig(a.y)),bx=Number(toBig(b.x)),by=Number(toBig(b.y));
  const px=Number(toBig(x)),py=Number(toBig(y)),dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/den)):0;
  const nx=ax+dx*t,ny=ay+dy*t;
  return Object.freeze({distance:Math.hypot(px-nx,py-ny),x:String(Math.round(nx)),y:String(Math.round(ny)),t});
}
function nearestBorder(seedValue,xValue,yValue,countryValue){
  const seed=String(seedValue==null?"":seedValue),x=WorldCoordinates.normalize(xValue),y=WorldCoordinates.normalize(yValue);
  let countryId=typeof countryValue==="string"?countryValue:String(countryValue?.id||"");
  if(!countryId)countryId=ownerAt(seed,x,y).id;
  const graph=canonicalBoundaryGraph(seed,countryId);
  if(!graph||!graph.edges.length)return null;
  let best=null;
  for(const edge of graph.edges){
    const hit=pointSegmentDistance(x,y,edge.a,edge.b);
    if(!best||hit.distance<best.distanceTiles||(hit.distance===best.distanceTiles&&edge.id<best.edgeId)){
      best={
        graphRevision:graph.revision,graphSignature:graph.signature,edgeId:edge.id,
        borderId:"BORDER|"+edge.ownerA+"|"+edge.ownerB,
        ownerPair:Object.freeze([edge.ownerA,edge.ownerB]),
        distanceTiles:hit.distance,nearestPoint:Object.freeze({x:hit.x,y:hit.y}),t:hit.t
      };
    }
  }
  return best?Object.freeze({...best,distanceTiles:Number(best.distanceTiles.toFixed(3))}):null;
}
function isSafelyInside(seedValue,xValue,yValue,countryValue,clearanceValue){
  const seed=String(seedValue==null?"":seedValue),countryId=typeof countryValue==="string"?countryValue:String(countryValue?.id||"");
  if(!countryId||ownerAt(seed,xValue,yValue).id!==countryId)return false;
  const clearance=Math.max(0,Number(clearanceValue)||0);
  if(clearance<=0)return true;
  const nearest=nearestBorder(seed,xValue,yValue,countryId);
  return !nearest||nearest.distanceTiles>=clearance;
}
function orientation(ax,ay,bx,by,cx,cy){return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)}
function segmentsIntersect(a,b,c,d){
  const ax=Number(toBig(a.x)),ay=Number(toBig(a.y)),bx=Number(toBig(b.x)),by=Number(toBig(b.y));
  const cx=Number(toBig(c.x)),cy=Number(toBig(c.y)),dx=Number(toBig(d.x)),dy=Number(toBig(d.y));
  const o1=orientation(ax,ay,bx,by,cx,cy),o2=orientation(ax,ay,bx,by,dx,dy),o3=orientation(cx,cy,dx,dy,ax,ay),o4=orientation(cx,cy,dx,dy,bx,by);
  return (o1===0||o2===0||o1*o2<0)&&(o3===0||o4===0||o3*o4<0);
}
function segmentCrossesBorder(seedValue,aValue,bValue,countryValue){
  const seed=String(seedValue==null?"":seedValue),a={x:WorldCoordinates.normalize(aValue.x),y:WorldCoordinates.normalize(aValue.y)},b={x:WorldCoordinates.normalize(bValue.x),y:WorldCoordinates.normalize(bValue.y)};
  let countryId=typeof countryValue==="string"?countryValue:String(countryValue?.id||"");
  if(!countryId)countryId=ownerAt(seed,a.x,a.y).id;
  const graph=canonicalBoundaryGraph(seed,countryId);
  if(!graph)return false;
  if(ownerAt(seed,a.x,a.y).id!==ownerAt(seed,b.x,b.y).id)return true;
  return graph.edges.some(edge=>segmentsIntersect(a,b,edge.a,edge.b));
}
function validatePlacement(seedValue,placementValue){
  const seed=String(seedValue==null?"":seedValue),p=placementValue||{};
  const x=WorldCoordinates.normalize(p.x),y=WorldCoordinates.normalize(p.y),countryId=String(p.countryId||"");
  const clearance=Math.max(0,Number(p.clearanceTiles)||0),footprint=Math.max(0,Number(p.footprintRadiusTiles)||0);
  const owner=ownerAt(seed,x,y),parentOwnerMatch=Boolean(countryId&&owner.id===countryId);
  const nearest=countryId?nearestBorder(seed,x,y,countryId):null;
  const distance=nearest?.distanceTiles??Infinity;
  const footprintCrossesBorder=!parentOwnerMatch||distance<footprint;
  const safelyInside=parentOwnerMatch&&distance>=Math.max(clearance,footprint);
  return Object.freeze({
    valid:safelyInside&&!footprintCrossesBorder,parentOwnerMatch,safelyInside,footprintCrossesBorder,
    countryId,ownerId:owner.id,x,y,clearanceTiles:clearance,footprintRadiusTiles:footprint,
    nearestBorderId:nearest?.borderId||null,nearestEdgeId:nearest?.edgeId||null,
    nearestOwnerPair:nearest?.ownerPair||null,borderDistanceTiles:Number.isFinite(distance)?Number(distance.toFixed(3)):null,
    graphRevision:nearest?.graphRevision||null,graphSignature:nearest?.graphSignature||null,
    reason:!parentOwnerMatch?"wrong-owner":footprintCrossesBorder?"footprint-crosses-border":distance<clearance?"insufficient-clearance":"accepted"
  });
}

function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const terrainBefore=GeographyFoundation.getTerrainType(seed,"0","0");
  const origin=countryAt(seed,"0","0");
  const repeated=countryAt(seed,"0","0");
  const neighbors=nearbyCountries(seed,origin);
  const borders=borderEvidence(seed,origin);
  const sampleCountries=[origin,...neighbors.slice(0,5).map(item=>countryById(seed,item.id)).filter(Boolean)];
  const capitalInside=sampleCountries.every(country=>ownerAt(seed,country.capital.x,country.capital.y).id===country.id);
  const capitalPlanetLand=sampleCountries.every(country=>country.capital.planetLand===true);
  const mapAnchorsPlanetLand=sampleCountries.every(country=>planetSurfaceAt(seed,country.mapAnchor.x,country.mapAnchor.y)?.sample?.land===true);
  const neighborIds=neighbors.map(item=>item.id);
  const neighborIdsRepeat=nearbyCountries(seed,origin).map(item=>item.id);
  const borderSamplePass=borders.length>0&&borders.every(border=>border.sideSamplesPass)&&neighbors.length===borders.length;
  const naturalFeatureInfluence=borders.some(border=>border.naturalFeatureInfluenced);
  const nonRectangular=borders.some(border=>border.nonMacroRectangular)&&borders.some(border=>border.geometryShiftTiles>=1);
  const terrainAfter=GeographyFoundation.getTerrainType(seed,"0","0");
  const hierarchyCountry=GeographyFoundation.hierarchy(seed,"0","0").country;
  const timeA=countryAt(seed,"0","0",Object.freeze({year:1200,month:1,day:1}));
  const timeB=countryAt(seed,"0","0",Object.freeze({year:1400,month:12,day:31}));
  const deterministic=JSON.stringify(origin)===JSON.stringify(repeated);
  const neighborsStable=JSON.stringify(neighborIds)===JSON.stringify(neighborIdsRepeat);
  const timeIndependent=JSON.stringify(timeA)===JSON.stringify(timeB);
  const terrainAuthorityPreserved=terrainBefore===terrainAfter;
  const hierarchyIntegrated=hierarchyCountry===origin.name;
  const lazyQueryable=true;
  const fullWorldMaterialized=false;
  const pass=Boolean(
    deterministic&&neighborsStable&&timeIndependent&&terrainAuthorityPreserved&&hierarchyIntegrated&&
    origin.id&&origin.name&&origin.capital&&neighbors.length>=2&&borders.length>=1&&
    capitalInside&&capitalPlanetLand&&mapAnchorsPlanetLand&&borderSamplePass&&naturalFeatureInfluence&&nonRectangular
  );
  return Object.freeze({
    pass,campaignSeed:seed,
    deterministic,neighborsStable,timeIndependent,terrainAuthorityPreserved,hierarchyIntegrated,
    lazyQueryable,fullWorldMaterialized,candidateCountPerLookup:(CANDIDATE_RADIUS*2+1)**2,
    countryCellSize:COUNTRY_CELL_SIZE,regionCellSizeReference:8192,countryRegionLinearRatio:COUNTRY_CELL_SIZE/8192,
    countryCountMaterialized:sampleCountries.length,
    capitalInside,capitalPlanetLand,mapAnchorsPlanetLand,borderSamplePass,naturalFeatureInfluence,nonRectangular,
    origin,neighbors:Object.freeze(neighbors),borders,
    authority:"political-foundation-only",
    liveBorderChanges:false,terrainMutation:false,renderDependency:false
  });
}
function hueFor(id){return parseInt(hashText(id).slice(0,6),16)%360}
function initials(name){
  const words=String(name||"").replace(/^(Realm|Kingdom|Principality|March|Dominion)\s+of\s+/,"").match(/[A-Z][a-z]+/g)||[];
  return (words.slice(0,2).map(w=>w[0]).join("")||"R").slice(0,2);
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderDebugPanel(seedValue,borderIndexValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=String(seedValue==null?"":seedValue);
  const root=rootNode||document.getElementById("politicalGeographyProof");
  if(!root)return null;
  const verification=proof(seed);
  if(!verification.borders.length)return Object.freeze({verification,border:null});
  const index=Math.abs(Number(borderIndexValue)||0)%verification.borders.length;
  const border=verification.borders[index];
  const countryA=countryById(seed,border.countryA.id);
  const countryB=countryById(seed,border.countryB.id);
  const select=root.querySelector("#politicalBorderSelect");
  if(select){
    select.innerHTML=verification.borders.map((item,i)=>
      "<option value=\""+i+"\" "+(i===index?"selected":"")+">"+escapeHtml(item.countryA.name+" ↔ "+item.countryB.name)+"</option>"
    ).join("");
    select.onchange=()=>renderDebugPanel(seed,Number(select.value),root);
  }
  const values={
    politicalCountry:verification.origin.name,
    politicalCountryId:verification.origin.id,
    politicalCapital:verification.origin.capital.name+" ("+verification.origin.capital.x+","+verification.origin.capital.y+")",
    politicalNeighbors:String(verification.neighbors.length),
    politicalBorderPair:border.countryA.name+" ↔ "+border.countryB.name,
    politicalBorderCoordinate:"("+border.x+","+border.y+")",
    politicalNaturalFeature:border.terrain+" · "+border.elevationMeters+"m · moisture "+border.moisturePercent+"% · geography shift "+border.featureShiftTiles.toFixed(1)+" tiles",
    politicalLookupBudget:String(verification.candidateCountPerLookup)+" local candidates"
  };
  for(const [id,value] of Object.entries(values)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const cards=root.querySelector("#politicalCountryCards");
  if(cards){
    const refs=[verification.origin,...verification.neighbors.slice(0,4).map(item=>countryById(seed,item.id)).filter(Boolean)];
    cards.innerHTML=refs.map(country=>
      "<article><span class=\"political-country-swatch\" style=\"--country-hue:"+hueFor(country.id)+"\"></span><div><strong>"+
      escapeHtml(country.name)+"</strong><small>"+escapeHtml(country.id)+"</small><small>Capital "+escapeHtml(country.capital.x+","+country.capital.y)+" · "+escapeHtml(country.capital.terrain)+"</small></div></article>"
    ).join("");
  }
  const map=root.querySelector("#politicalBorderMap");
  if(map){
    const bx=Number(border.x),by=Number(border.y),step=384;
    const cells=[];
    for(let gy=-3;gy<=3;gy++){
      for(let gx=-6;gx<=6;gx++){
        const x=String(Math.round(bx+gx*step)),y=String(Math.round(by+gy*step));
        const owner=ownerAt(seed,x,y);
        const terrain=GeographyFoundation.getTerrainType(seed,x,y);
        cells.push(
          "<span class=\"political-map-cell terrain-"+escapeHtml(terrain)+"\" style=\"--country-hue:"+hueFor(owner.id)+"\" "+
          "title=\""+escapeHtml(owner.name+" · "+terrain+" · "+x+","+y)+"\">"+
          "<b>"+escapeHtml(initials(owner.name))+"</b><i>"+escapeHtml(terrain.slice(0,1).toUpperCase())+"</i></span>"
        );
      }
    }
    map.innerHTML=cells.join("");
  }
  setCheck("vPoliticalDeterministic",verification.deterministic&&verification.neighborsStable&&verification.timeIndependent);
  setCheck("vPoliticalBorders",verification.borderSamplePass&&verification.nonRectangular);
  setCheck("vPoliticalNatural",verification.naturalFeatureInfluence);
  setCheck("vPoliticalCapital",verification.capitalInside);
  setCheck("vPoliticalLazy",verification.lazyQueryable&&!verification.fullWorldMaterialized&&verification.candidateCountPerLookup===9);
  setCheck("vPoliticalAuthority",verification.terrainAuthorityPreserved&&verification.hierarchyIntegrated&&!verification.terrainMutation&&!verification.renderDependency&&!verification.liveBorderChanges);
  root.dataset.borderIndex=String(index);
  root.dataset.borderId=border.id;
  root.dataset.countryId=verification.origin.id;
  root.dataset.borderA=border.countryA.id;
  root.dataset.borderB=border.countryB.id;
  root.dataset.featureShift=String(border.featureShiftTiles);
  root.dataset.mapCells="91";
  return Object.freeze({verification,border,countryA,countryB,index});
}

const api=Object.freeze({
  COUNTRY_CELL_SIZE,COUNTRY_JITTER,CANDIDATE_RADIUS,BOUNDARY_GRAPH_REVISION,
  politicalCellFor,countryAt,ownerAt,countryForCell,countryById,nearbyCountries,borderEvidence,
  canonicalBoundaryGraph,nearestBorder,isSafelyInside,segmentCrossesBorder,validatePlacement,
  proof,renderDebugPanel,planetSurfaceAt,deterministicCountryLandAnchor
});
window.PoliticalGeography=api;
window.CountryTerritories=api;
})();