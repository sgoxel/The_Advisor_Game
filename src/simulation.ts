import {countries,places,type Place} from './geography.ts';
import {WORLD_SEED,WALK_SPEED_MPS} from './config.ts';
import {digest,heightAt,cellAt} from './world.ts';
import {TIME_SCALE} from './clock.ts';
export type Resident={code:string;home:string;index:number;variant:number;x:number;z:number;task:string};
export type CountryState={code:string;population:number;grain:number;lastTick:number;tier:'live'|'interested'|'coarse'};
const populationOf=(place:Place)=>place.kind==='city'?2400:80;
export function summaryAt(code:string,tick:number):CountryState{
  const baseline=digest(code)%5000;
  // Analytical catch-up is independent of update cadence and render interest.
  return{code,population:7920,grain:baseline+Math.floor(tick/60)*12,lastTick:tick,tier:'coarse'};
}
export function residentAt(place:Place,index:number,tick:number):Resident{
  const code=`${place.code}/RESIDENT/${index}`,variant=digest(code),span=place.kind==='city'?250:28;
  // Four deterministic lanes around a settlement; no stochastic destination selection.
  const radius=12+variant%span,speed=WALK_SPEED_MPS/TIME_SCALE,perimeter=radius*8;
  const distance=(tick*speed+variant%Math.ceil(perimeter))%perimeter;
  const side=Math.floor(distance/(radius*2)),along=distance%(radius*2);
  let dx=0,dz=0;
  if(side===0){dx=-radius+along;dz=-radius;}else if(side===1){dx=radius;dz=-radius+along;}else if(side===2){dx=radius-along;dz=radius;}else{dx=-radius;dz=radius-along;}
  // Keep/house interiors are not implemented yet: use the two central street axes.
  const horizontal=index%2===0;
  const offset=Math.abs(horizontal?dx:dz);
  const x=place.x+(horizontal?dx:0),z=place.z+(horizontal?0:dz);
  const legal=heightAt(x,z)>.1;
  return{code,home:place.id,index,variant,x:legal?x:place.x,z:legal?z:place.z,task:offset<4?'Trading':index%3===0?'Patrolling':'Walking'};
}
export class LazySimulation{
  tick=0;activeCountry='';interested=new Set<string>();
  summaries=new Map<string,CountryState>();residents=new Map<string,Resident[]>();
  setFocus(place:Place|undefined){if(place)this.activeCountry=countries.find(c=>c.continent===place.continent&&c.id===place.country)!.code;}
  setInterest(code:string){this.interested.clear();this.interested.add(code);}
  advance(tick:number){
    if(tick<this.tick)throw new RangeError('Simulation time must move forward');this.tick=tick;
    for(const country of countries){
      const live=country.code===this.activeCountry,interested=this.interested.has(country.code),interval=live?1:interested?30:300;
      const previous=this.summaries.get(country.code);
      const tier=live?'live':interested?'interested':'coarse';
      if(!previous||live||previous.tier!==tier||tick-previous.lastTick>=interval){const state=summaryAt(country.code,tick);state.tier=tier;this.summaries.set(country.code,state);}
      if(live&&!this.residents.has(country.code)){
        this.residents.set(country.code,places.filter(p=>p.continent===country.continent&&p.country===country.id).flatMap(p=>Array.from({length:populationOf(p)},(_,i)=>residentAt(p,i,tick))));
      }else if(live){
        const pool=this.residents.get(country.code)!;
        const homes=new Map(places.filter(p=>p.continent===country.continent&&p.country===country.id).map(p=>[p.id,p]));
        for(let i=0;i<pool.length;i++)pool[i]=residentAt(homes.get(pool[i].home)!,pool[i].index,tick);
      }
    }
    // Country detail is reconstructible: inactive pools don't remain allocated.
    for(const code of this.residents.keys())if(code!==this.activeCountry)this.residents.delete(code);
  }
  focusedResidents(x:number,z:number,radius:number){return [...this.residents.values()].flat().filter(r=>Math.hypot(r.x-x,r.z-z)<=radius);}
  get stats(){return{tick:this.tick,countries:this.summaries.size,liveCountries:this.residents.size,residents:[...this.residents.values()].reduce((n,r)=>n+r.length,0),coarseCountries:[...this.summaries.values()].filter(s=>s.tier==='coarse').length};}
}
