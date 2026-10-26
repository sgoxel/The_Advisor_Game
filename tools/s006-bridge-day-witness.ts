/**
 * S006 mandatory functional acceptance candidate: genuine canonical
 * same-SEED-ID owned home -> gate -> real bridge -> work -> exact door.
 * Demand only three near-bridge settlements; no fake actor, bridge, worksite,
 * route or clock, and no graph-only preview is accepted as Simulation travel.
 */
import assert from "node:assert/strict";
import { villages } from "../src/geography.ts";
import { CANONICAL_PLANET_RADIUS, greatCircleDistance, normalizeLongitude, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { finalSurfaceAt, resolvedSettlementHomeDoorFor } from "../src/world.ts";
import { transportNetwork, transportRoadsNear } from "../src/transport-network.ts";
import { populationOf, residentAt, residentFoundationAt, residentWalkableSurface, legalEnclosureSegment } from "../src/simulation.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { tickAtLocalTime, localDayIndex, localWeekday } from "../src/clock.ts";
import { dailyPlan } from "../src/routines.ts";

const HOUR=3600;
const targets = ["Hearthstead","Briarham","Greyfield"];
let tested = 0, assignedNear = 0, moving = 0, deckWindows = 0, gateCrossings = 0;
for (const name of targets) {
  const place = villages.find(p => p.name === name);
  if (!place) continue;
  const scale=sourceUnitsPerMetreAt(place.z);
  transportRoadsNear(place.x,place.z,Math.min(16_384,6500*Math.max(scale.x,scale.z)),12);
  const bridges=transportNetwork.bridges.filter(b =>
    greatCircleDistance(place.canonicalPosition,b.position) <= 5000);
  const lon=place.canonicalPosition.lon,lat=place.canonicalPosition.lat,
    offset=(p:{x:number;z:number})=>{
      const ll=sourceToLonLat(p.x,p.z);
      return {eastM:normalizeLongitude(ll.lon-lon)*CANONICAL_PLANET_RADIUS*Math.max(1e-9,Math.abs(Math.cos(lat))),
        northM:(ll.lat-lat)*CANONICAL_PLANET_RADIUS};
    },
    canonical=(p:{eastM:number;northM:number})=>({
      lon:normalizeLongitude(lon+p.eastM/(CANONICAL_PLANET_RADIUS*Math.max(1e-9,Math.abs(Math.cos(lat))))),
      lat:lat+p.northM/CANONICAL_PLANET_RADIUS,
    }),
    exterior=settlementExteriorFor(place),
    border=exterior.border.map(offset),gates=exterior.gates.map(offset),
    day=[1,2,3,4,5,6,7].find(d=>localWeekday(tickAtLocalTime(d,12*HOUR,lon),lon)!==6)!,
    noon=tickAtLocalTime(day,12*HOUR,lon);
  let workers=0,near=0,active=0;
  for(let i=6;i<Math.min(populationOf(place),180);i++){
    const f=residentFoundationAt(place,i);
    if (f.role!=="laborer"&&f.role!=="farmer")continue;
    workers++;
    const door=resolvedSettlementHomeDoorFor(place,i);
    if(!door)continue;
    const work=canonical(f.workOffset),
      candidateBridges=bridges.filter(b=>greatCircleDistance(work,b.position)<1200);
    if(!candidateBridges.length)continue;
    near++;assignedNear++;tested++;
    const plan=dailyPlan({code:f.code,role:f.role,ageGroup:f.ageGroup,guardShift:f.guardShift},
      f.traits,localDayIndex(noon,lon),localWeekday(noon,lon)),
      transitions=plan.filter((p,j)=>j>0&&p.anchor!==plan[j-1].anchor &&
        (p.anchor==="work"||p.anchor==="home"));
    let deck=0,gatesCrossed=0;
    for(const departure of transitions){
      const start=residentAt(place,i,tickAtLocalTime(day,departure.start,lon));
      if(start.activity!=="commute"||!start.travelDistanceM)continue;
      active++;moving++;
      for(let sample=0;sample<Math.min(290,Math.ceil(start.travelDistanceM/24)+2);sample++){
        const actor=residentAt(place,i,tickAtLocalTime(day,departure.start+sample*24,lon));
        if(actor.activity!=="commute")break;
        for(let j=1;j<(actor.walkAhead?.length??0);j++){
          const a=actor.walkAhead![j-1],b=actor.walkAhead![j],
            from=offset(a),to=offset(b);
          assert.ok(legalEnclosureSegment(from,to,border,gates), "SEED wall/gate must remain physical authority");
          if(!legalEnclosureSegment(from,to,border,[]))gatesCrossed++;
          const length=greatCircleDistance(sourceToLonLat(a.x,a.z),sourceToLonLat(b.x,b.z)),
            steps=Math.max(1,Math.ceil(length));
          assert.ok(steps<80,"no fake teleported walking window");
          for(let k=0;k<=steps;k++){
            const t=k/steps,x=a.x+wrapSourceX(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,
              surface=finalSurfaceAt(x,z),pos=sourceToLonLat(x,z);
            assert.ok(residentWalkableSurface(surface),"no walking through absent bridge or water");
            if(surface.traversal==="bridge"&&surface.water.kind!=="none"&&
               candidateBridges.some(bridge=>greatCircleDistance(pos,bridge.position)<
                 Math.max(bridge.spanM,30)))deck++;
          }
        }
      }
    }
    deckWindows+=deck;gateCrossings+=gatesCrossed;
    if(deck&&gatesCrossed>=2){
      const work=residentAt(place,i,tickAtLocalTime(day,15*HOUR,lon)),
        home=residentAt(place,i,tickAtLocalTime(day,23.9*HOUR,lon));
      assert.ok(work.grounded&&work.activity==="work"&&home.grounded&&home.indoors&&
        home.code===f.code&&home.route===f.homeEntrance &&
        greatCircleDistance(home.position,sourceToLonLat(door.x,door.z))<.05,
        "same resident must reach actual work and return to precisely owned door");
      console.log("S006 AUTHENTIC SAME-RESIDENT BRIDGE DAY",JSON.stringify({
        resident:f.code,place:name,work:f.workplace,home:f.homeEntrance,deckWindows:deck,gateCrossings:gatesCrossed}));
      process.exit(0);
    }
  }
  console.log("S006 near-bridge work candidates",JSON.stringify({
    place:name,realBridges:bridges.length,workers,assignedNearBridge:near,
    inspectedWorkLegs:active}));
}
console.error("S006 FULL BRIDGE DAY STILL NOT PROVEN",JSON.stringify({targets,tested,assignedNear,moving,deckWindows,gateCrossings}));
process.exitCode=2;
