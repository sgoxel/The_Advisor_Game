const registryStarted=performance.now();
const {countries,cities,villages,continents,countryAtPosition,macroPopulationSummary,roads,roadConnections,roadJunctions,roadNetworkTelemetry}=await import('../src/geography.ts');
const registryImportMs=performance.now()-registryStarted;
import {macroSampleAt,macroFeatureDistanceM} from '../src/macro-geography.ts';
import {CANONICAL_PLANET_RADIUS} from '../src/planet.ts';
import fs from 'node:fs';
import {freshwaterAccessAt} from '../src/hydrology.ts';
const start=performance.now();
const points=[];let area=0; const byCountry=new Map(countries.map(c=>[c.code,{areaKm2:0,suitableKm2:0}]));
for(let lat=-84;lat<=84;lat+=2) for(let lon=-180;lon<180;lon+=2){
 const p={lon:lon*Math.PI/180,lat:lat*Math.PI/180},m=macroSampleAt(p);if(!m.land||m.domain!=='Mainland')continue;
 const c=countryAtPosition(p),w=(2*Math.PI/180*CANONICAL_PLANET_RADIUS)**2*Math.cos(p.lat)/1e6;
 area+=w;const a=byCountry.get(c.code);a.areaKm2+=w;if(m.reliefM<90)a.suitableKm2+=w;
 const cd=Math.min(...cities.filter(x=>x.continent===c.continent).map(x=>macroFeatureDistanceM(p,x.canonicalPosition))),vd=Math.min(...villages.filter(x=>x.continent===c.continent).map(x=>macroFeatureDistanceM(p,x.canonicalPosition)));
 points.push({lon,lat,country:c.code,continent:c.continent,relief:m.reliefM,cityDistanceKm:cd/1000,villageDistanceKm:vd/1000});
}
const quantile=(values,q)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
function borderShare(records){
 let border=0;
 for(const record of records){const p=record.canonicalPosition,a=10000/CANONICAL_PLANET_RADIUS;
  for(let i=0;i<16;i++){const b=i*Math.PI/8,lat=Math.asin(Math.sin(p.lat)*Math.cos(a)+Math.cos(p.lat)*Math.sin(a)*Math.cos(b)),lon=p.lon+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(p.lat),Math.cos(a)-Math.sin(p.lat)*Math.sin(lat)),owner=countryAtPosition({lon,lat});
   if(owner&&!(owner.continent===record.continent&&owner.id===record.country)){border++;break;}
  }
 }
 return border/records.length;
}
const roadById=new Map(roads.map(r=>[r.networkId,r]));
const connectionLengths=roadConnections.map(c=>c.legs.reduce((n,l)=>n+roadById.get(l.edgeId).surfaceLengthM,0)/1000);
const lengths=roads.map(r=>r.surfaceLengthM/1000),roadStats={count:roads.length,medianKm:quantile([...lengths],.5),p90Km:quantile([...lengths],.9),maxKm:Math.max(...lengths),over23km:lengths.filter(d=>d>23).length};
const result={roadStats,roadNetwork:roadNetworkTelemetry,roadJunctions,roadConnections,roads,connectionStats:{count:connectionLengths.length,medianKm:quantile([...connectionLengths],.5),p90Km:quantile([...connectionLengths],.9),maxKm:Math.max(...connectionLengths),over23km:connectionLengths.filter(d=>d>23).length},population:macroPopulationSummary,registryImportMs,counts:{countries:countries.length,cities:cities.length,villages:villages.length},landAreaKm2:area,countryAreas:[...byCountry].map(([code,s])=>({code,...s})),cityWithin10kmOfForeignBorder: borderShare(cities),coverage:{cityMedianKm:quantile(points.map(p=>p.cityDistanceKm),.5),cityP90Km:quantile(points.map(p=>p.cityDistanceKm),.9),villageMedianKm:quantile(points.map(p=>p.villageDistanceKm),.5),villageP90Km:quantile(points.map(p=>p.villageDistanceKm),.9)},freshwaterVillageCount: villages.filter(v=>freshwaterAccessAt(v.canonicalPosition).nearby).length,continents,countries,cities,villages,points,auditMs:performance.now()-start};
fs.writeFileSync(process.argv[2],JSON.stringify(result)); console.log(JSON.stringify({counts:result.counts,areaKm2:area,coverage:result.coverage,borderShare:result.cityWithin10kmOfForeignBorder,registryImportMs,countryCityRange:[Math.min(...macroPopulationSummary.countries.map(c=>c.cities)),Math.max(...macroPopulationSummary.countries.map(c=>c.cities))],countryAreaRange:[Math.min(...result.countryAreas.map(x=>x.areaKm2)),Math.max(...result.countryAreas.map(x=>x.areaKm2))]}));

if(process.argv[3]){ const old=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));console.log(JSON.stringify({baselineBorderShare:borderShare(old.cities)})); }
