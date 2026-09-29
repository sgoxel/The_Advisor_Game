"use strict";

const assert=require("assert");
global.window=global;
let perfClock=0;
global.performance={now:()=>++perfClock};

function hash32(value){
  let h=2166136261>>>0;
  for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
global.PRNG={foundationUint32:(seed,key)=>hash32(String(seed)+"|"+String(key))};
global.GameTime={getNow:()=>({year:1201,month:2,day:1,hour:12,minute:0,second:0})};
global.SettlementActivityRhythm={
  profileAtHour:(hour)=>{
    const night=Number(hour)>=22||Number(hour)<5;
    return night
      ?{band:"night",modifiers:{outdoorResidentShare:.18,marketPublicActivity:.08,ambientTrafficLikelihood:.16}}
      :{band:"daytime",modifiers:{outdoorResidentShare:.92,marketPublicActivity:.94,ambientTrafficLikelihood:.88}};
  }
};
global.Walkability={classify:()=>({walkable:true})};
global.GeographyFoundation={getTerrainType:()=>"grass"};
global.StartingVillage={local:()=>({}),isRoadReserved:()=>true};

const plans={
  village:Object.freeze({id:"V",name:"Proof Village",classId:"village",role:"local",center:Object.freeze({x:"0",y:"0"}),population:Object.freeze({planned:500})}),
  town:Object.freeze({id:"T",name:"Proof Town",classId:"town",role:"local",center:Object.freeze({x:"2000",y:"2000"}),population:Object.freeze({planned:2600})}),
  city:Object.freeze({id:"C",name:"Proof City",classId:"city",role:"local",center:Object.freeze({x:"5000",y:"5000"}),population:Object.freeze({planned:15000})})
};
const records=Object.values(plans).map(p=>Object.freeze({
  id:p.id,name:p.name,classId:p.classId,role:p.role,center:p.center,countryId:"COUNTRY",regionId:"REGION"
}));
global.SettlementArchetypes={
  proof:()=>({representatives:[
    {reason:"agricultural",plan:plans.village},
    {reason:"trade",plan:plans.town},
    {reason:"capital",plan:plans.city}
  ]}),
  settlementsForCountry:()=>Object.values(plans),
  canonicalSettlementsInBounds:()=>({settlements:records}),
  canonicalSettlementAtPoint:(_seed,classId,x,y)=>{
    const r=records.find(item=>item.classId===classId);if(!r)return null;
    const dx=Number(BigInt(String(r.center.x))-BigInt(String(x))),dy=Number(BigInt(String(r.center.y))-BigInt(String(y)));
    return Math.hypot(dx,dy)<=64?r:null;
  },
  build:(_seed,_center,options)=>plans[options.classHint]||null
};
let persistedCityPopulation=17250;
global.WorldState={
  settlementRef:(_seed,plan)=>({id:plan.id}),
  resolve:(_seed,ref)=>ref.id==="C"
    ?{current:{state:{aggregate:{population:persistedCityPopulation}}}}
    :{current:{state:{aggregate:{}}}}
};
global.PoliticalGeography={countryAt:()=>({id:"COUNTRY"})};

require("../../scripts/world/crowd-presentation.js");

const seed="WP-S004-010-UNIT";
const day={year:1201,month:2,day:1,hour:12,minute:0,second:0};
const night={...day,hour:23};

const verification=CrowdPresentation.verify(seed);
assert.strictEqual(verification.pass,true,"crowd verification failed");
assert.strictEqual(verification.deterministic,true);
assert.strictEqual(verification.densityOrder,true);
assert.strictEqual(verification.timeOrder,true);
assert.strictEqual(verification.authority,true);

const village=CrowdPresentation.snapshotForPlan(seed,plans.village,day,{mobile:false,avoidPoints:[]});
const town=CrowdPresentation.snapshotForPlan(seed,plans.town,day,{mobile:false,avoidPoints:[]});
const city=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:false,avoidPoints:[]});
const mobileCity=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:true,avoidPoints:[]});
const cityNight=CrowdPresentation.snapshotForPlan(seed,plans.city,night,{mobile:false,avoidPoints:[]});
const cityCore=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:false,avoidPoints:[],focus:plans.city.center});
const cityFringeFocus={x:String(BigInt(plans.city.center.x)+18n),y:plans.city.center.y};
const cityFringe=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:false,avoidPoints:[],focus:cityFringeFocus});
const resolvedCity=CrowdPresentation.snapshot(seed,day,plans.city.center,{mobile:false,avoidPoints:[]});

assert(village.activeCount<town.activeCount&&town.activeCount<city.activeCount,"class density order must be visible");
assert(cityNight.activeCount<city.activeCount,"night crowd must be lower than daytime");
assert.strictEqual(cityCore.districtBand,"core");
assert.strictEqual(cityFringe.districtBand,"fringe");
assert(cityFringe.activeCount<cityCore.activeCount,"fringe district must be less dense than city core");
assert.strictEqual(resolvedCity.settlementClass,"city","bounded hot-path resolver must find city at its center");
assert(Number.isFinite(resolvedCity.resolveMs)&&Number.isFinite(resolvedCity.totalUpdateMs),"hot-path timing telemetry missing");
assert(mobileCity.activeCount<=CrowdPresentation.MOBILE_ACTIVE_CROWD,"mobile cap exceeded");
assert(city.activeCount<=CrowdPresentation.MAX_ACTIVE_CROWD,"desktop cap exceeded");
assert.strictEqual(city.population,persistedCityPopulation,"persisted aggregate population not consumed");
assert.strictEqual(city.populationSource,"WorldState.current.state.aggregate.population");
assert(city.specs.every(s=>s.role==="crowd"&&s.presentationOnly===true&&s.authoritativeNpc===false&&s.selectable===false&&s.persistentIdentity===false&&s.collision===false));
assert.strictEqual(city.exactNpcReplacement,false);
assert.strictEqual(city.fullSettlementPerFrameScan,false);
assert.strictEqual(city.globalScan,false);
assert(city.candidateChecks<=CrowdPresentation.MAX_CANDIDATE_CHECKS);

const repeat=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:false,avoidPoints:[]});
assert.deepStrictEqual(repeat.specs,city.specs,"same SEED + fantasy time crowd must be deterministic");

const blocked=city.specs.slice(0,3).map(s=>s.point);
const avoided=CrowdPresentation.snapshotForPlan(seed,plans.city,day,{mobile:false,avoidPoints:blocked});
assert(avoided.specs.every(s=>!blocked.some(p=>p.x===s.point.x&&p.y===s.point.y)),"crowd overlapped exact actor avoidance point");
assert(avoided.activeCount<=city.activeCount,"avoidance must not increase requested density");

console.log(JSON.stringify({
  pass:true,
  counts:{village:village.activeCount,town:town.activeCount,city:city.activeCount,cityNight:cityNight.activeCount,mobileCity:mobileCity.activeCount,cityFringe:cityFringe.activeCount},
  populationSource:city.populationSource,
  bounded:{desktop:CrowdPresentation.MAX_ACTIVE_CROWD,mobile:CrowdPresentation.MOBILE_ACTIVE_CROWD,candidateChecks:city.candidateChecks},
  authority:{presentationOnly:city.presentationOnly,simulationAuthority:city.simulationAuthority,selectable:city.selectable,persistentIdentity:city.persistentIdentity,exactNpcReplacement:city.exactNpcReplacement}
},null,2));
