import {WORLD_SEED,WALK_SPEED_MPS,VILLAGE_SPACING_M} from './config.ts';
export type Place={id:string;code:string;name:string;x:number;z:number;kind:'city'|'village';continent:number;country:number;city:number};
export const continents=[{id:0,name:'Eldermere',x:0,z:6500},{id:1,name:'Westreach',x:-80000,z:6500},{id:2,name:'Dawnlands',x:80000,z:6500}];
export const countries=continents.flatMap(continent=>Array.from({length:10},(_,id)=>{
  const slot=(id+2)%10;
  return{id,continent:continent.id,code:`${WORLD_SEED}/CONT/${continent.id}/COUNTRY/${id}`,name:['Aldermarch','Briarhold','Greyvale','Oakward','Westwatch','Ashbourne','Thornreach','Highmere','Stonefen','Dunvale'][id],x:continent.x+(slot%5-2)*7000,z:Math.floor(slot/5)*13000};
}));
export const cities:Place[]=countries.flatMap(country=>[[0,-600],[-2400,2000],[2400,2000]].map(([dx,dz],city)=>{
  const id=`${country.continent}/${country.id}/${city}`;
  return{id,code:`${country.code}/CITY/${city}`,name:`${country.name} ${['Citadel','Market','Harbour'][city]}`,x:country.x+dx,z:country.z+dz,kind:'city' as const,continent:country.continent,country:country.id,city};
}));
export const villages:Place[]=cities.flatMap(city=>Array.from({length:3},(_,v)=>({
  ...city,id:`${city.id}/${v}`,code:`${city.code}/VILLAGE/${v}`,kind:'village' as const,
  name:city.continent===0&&city.country===0&&city.city===0&&v===0?'Alderwick':`${['Briarford','Oakmere','Thornfield'][v]} ${city.continent+1}.${city.country+1}.${city.city+1}`,
  x:city.x+v*VILLAGE_SPACING_M,z:city.z+600
})));
export const places=[...cities,...villages];
export const roads=cities.flatMap(city=>[0,1].map(index=>({
  code:`${city.code}/ROAD/${index}`,from:`${city.id}/${index}`,to:`${city.id}/${index+1}`,
  minX:city.x+index*VILLAGE_SPACING_M,maxX:city.x+(index+1)*VILLAGE_SPACING_M,z:city.z+600,length:VILLAGE_SPACING_M,
  walkSeconds:VILLAGE_SPACING_M/WALK_SPEED_MPS,fantasyWalkSeconds:VILLAGE_SPACING_M/WALK_SPEED_MPS*24
})));
// Immutable spatial buckets avoid scanning all settlements at every terrain sample.
const buckets=new Map<string,Place[]>();
for(const place of places){const key=`${Math.floor(place.x/2048)}/${Math.floor(place.z/2048)}`;const bucket=buckets.get(key)||[];bucket.push(place);buckets.set(key,bucket);}
export function nearbyPlaces(x:number,z:number):Place[]{
  const bx=Math.floor(x/2048),bz=Math.floor(z/2048),result:Place[]=[];
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)result.push(...(buckets.get(`${bx+dx}/${bz+dz}`)||[]));
  return result;
}
export function nearestPlace(x:number,z:number):Place|undefined{
  let result:Place|undefined,distance=Infinity;
  for(const place of nearbyPlaces(x,z)){const d=Math.hypot(x-place.x,z-place.z);if(d<distance){distance=d;result=place;}}
  return result;
}
export function continentAt(x:number,z:number){
  let result=continents[0];for(const c of continents)if(Math.hypot(x-c.x,z-c.z)<Math.hypot(x-result.x,z-result.z))result=c;
  return result;
}
export function continentalEnvelope(x:number,z:number){
  const c=continentAt(x,z),nx=(x-c.x)/(27000+c.id*3000),nz=(z-c.z)/(25000+(c.id%2)*2500);
  const angle=Math.atan2(nz,nx);
  const outline=1+.09*Math.sin(angle*3+c.id*1.3)+.05*Math.cos(angle*5-c.id);
  return Math.hypot(nx,nz)/outline;
}
export function roadAt(x:number,z:number){
  // City groups are far apart; nearby villages identify only relevant roads.
  const local=nearbyPlaces(x,z).filter(p=>p.kind==='village'&&Math.abs(z-p.z)<12&&x>=p.x-420&&x<=p.x+840);
  if(!local.length)return undefined;
  return roads.find(r=>Math.abs(z-r.z)<12&&x>=r.minX-8&&x<=r.maxX+8&&local.some(p=>p.id.startsWith(r.from.slice(0,r.from.lastIndexOf('/'))+'/')));
}
