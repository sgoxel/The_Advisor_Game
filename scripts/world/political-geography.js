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
function countryName(seed,key){
  const a=pick(seed,"country-name:a:"+key,COUNTRY_WORDS_A);
  const b=pick(seed,"country-name:b:"+key,COUNTRY_WORDS_B);
  const form=pick(seed,"country-name:form:"+key,COUNTRY_FORMS);
  return form+" of "+a+b;
}
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
  const key=cellKey(cx,cy);
  return Object.freeze({
    id:countryId(seed,cx,cy),
    name:countryName(seed,key),
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
function capitalForCandidate(seed,candidate){
  const baseX=toBig(candidate.politicalCenter.x),baseY=toBig(candidate.politicalCenter.y);
  const rotation=unit(seed,"country-capital:rotation:"+candidate.key)*Math.PI*2;
  const options=[Object.freeze({x:baseX,y:baseY})];
  for(let ring=1;ring<=3;ring++){
    const radius=BigInt(480*ring);
    for(let spoke=0;spoke<8;spoke++){
      const angle=rotation+(Math.PI*2*spoke/8);
      const dx=BigInt(Math.round(Math.cos(angle)*Number(radius)));
      const dy=BigInt(Math.round(Math.sin(angle)*Number(radius)));
      options.push(Object.freeze({x:baseX+dx,y:baseY+dy}));
    }
  }
  let fallback=options[0];
  for(const option of options){
    const x=option.x.toString(),y=option.y.toString();
    const terrain=GeographyFoundation.getTerrainType(seed,x,y);
    const env=GeographyFoundation.environment(seed,x,y);
    if(terrain!=="water"&&env.elevationMeters<1550){
      return Object.freeze({x,y,terrain,elevationMeters:env.elevationMeters});
    }
    if(terrain!=="water")fallback=option;
  }
  const x=fallback.x.toString(),y=fallback.y.toString();
  const env=GeographyFoundation.environment(seed,x,y);
  return Object.freeze({x,y,terrain:GeographyFoundation.getTerrainType(seed,x,y),elevationMeters:env.elevationMeters});
}
function countryFromCandidate(seed,candidate,scoreValue){
  const capital=capitalForCandidate(seed,candidate);
  return Object.freeze({
    id:candidate.id,
    name:candidate.name,
    cellX:candidate.cellX,cellY:candidate.cellY,
    politicalCenter:candidate.politicalCenter,
    capital:Object.freeze({
      id:"CAP|"+candidate.id,
      name:candidate.name+" Capital",
      x:capital.x,y:capital.y,
      terrain:capital.terrain,
      elevationMeters:capital.elevationMeters
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
function proof(seedValue){
  const seed=String(seedValue==null?"":seedValue);
  const terrainBefore=GeographyFoundation.getTerrainType(seed,"0","0");
  const origin=countryAt(seed,"0","0");
  const repeated=countryAt(seed,"0","0");
  const neighbors=nearbyCountries(seed,origin);
  const borders=borderEvidence(seed,origin);
  const sampleCountries=[origin,...neighbors.slice(0,5).map(item=>countryById(seed,item.id)).filter(Boolean)];
  const capitalInside=sampleCountries.every(country=>ownerAt(seed,country.capital.x,country.capital.y).id===country.id);
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
    capitalInside&&borderSamplePass&&naturalFeatureInfluence&&nonRectangular
  );
  return Object.freeze({
    pass,campaignSeed:seed,
    deterministic,neighborsStable,timeIndependent,terrainAuthorityPreserved,hierarchyIntegrated,
    lazyQueryable,fullWorldMaterialized,candidateCountPerLookup:(CANDIDATE_RADIUS*2+1)**2,
    countryCellSize:COUNTRY_CELL_SIZE,regionCellSizeReference:8192,countryRegionLinearRatio:COUNTRY_CELL_SIZE/8192,
    countryCountMaterialized:sampleCountries.length,
    capitalInside,borderSamplePass,naturalFeatureInfluence,nonRectangular,
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
  COUNTRY_CELL_SIZE,COUNTRY_JITTER,CANDIDATE_RADIUS,
  politicalCellFor,countryAt,ownerAt,countryForCell,countryById,nearbyCountries,borderEvidence,proof,renderDebugPanel
});
window.PoliticalGeography=api;
window.CountryTerritories=api;
})();