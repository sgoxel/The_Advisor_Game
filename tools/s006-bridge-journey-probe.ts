/** WP-S006-001-001: bounded, read-only candidate search for a genuine
 * same-SEED resident crossing a REAL canonical bridge on their working day.
 * Evidence only: never assign an actor a route, teleport, mutate SEED or
 * claim a graph-selected preview as an executed Simulation journey.
 * Run only on demand; absence is an explicit FAIL, not a synthetic fixture. */
import assert from "node:assert/strict";
import { cities, villages } from "../src/geography.ts";
import { CANONICAL_PLANET_RADIUS, greatCircleDistance, normalizeLongitude, sourceToLonLat, wrapSourceX } from "../src/planet.ts";
import { sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { finalSurfaceAt, resolvedSettlementHomeDoorFor } from "../src/world.ts";
import { transportNetwork, transportRoadsNear } from "../src/transport-network.ts";
import { populationOf, residentAt, residentFoundationAt, residentWalkableSurface } from "../src/simulation.ts";
import { tickAtLocalTime, localDayIndex, localWeekday } from "../src/clock.ts";
import { dailyPlan } from "../src/routines.ts";

const HOUR = 3600;
const places = [...villages.slice(0, 96), ...cities.slice(0, 16)];
// Demand-load at most twelve roads/settlement. Never scan the entire road
// graph into the cache or make camera/viewport state part of decisions.
for (const place of places) {
  const metres = sourceUnitsPerMetreAt(place.z);
  transportRoadsNear(place.x, place.z, Math.min(450, 4_500 * Math.max(metres.x, metres.z)), 12);
}
const byCode = new Map(transportNetwork.bridges.map(b => [b.code, b]));
const candidates = places.flatMap(place => [...byCode.values()]
  .map(bridge => ({ place, bridge, distance: greatCircleDistance(place.canonicalPosition, bridge.position) }))
  .filter(candidate => candidate.distance <= 4_000))
  .sort((a, b) => a.distance - b.distance || a.place.code.localeCompare(b.place.code) || a.bridge.code.localeCompare(b.bridge.code))
  .filter((candidate, i, all) => all.findIndex(previous => previous.place.code === candidate.place.code) === i);
console.log("S006 bridge witness search", JSON.stringify({
  settlements: places.length, discoveredRealBridges: byCode.size,
  nearbyPairs: candidates.length,
  nearestPairs: candidates.slice(0, 20).map(x => ({ place:x.place.name, bridge:x.bridge.code, distanceM: Math.round(x.distance) }))
}));
let groundedRoutes = 0, blockedRoutes = 0, realBridgeWindows = 0;
for (const { place, bridge } of candidates.slice(0, 20)) {
  const lon = place.canonicalPosition.lon,
    day = [1,2,3,4,5,6,7].find(d => localWeekday(tickAtLocalTime(d,12*HOUR,lon),lon) !== 6)!,
    noon = tickAtLocalTime(day, 12*HOUR, lon);
  let probed = 0;
  for (let index = 6; index < Math.min(populationOf(place), 160) && probed < 16; index++) {
    const foundation = residentFoundationAt(place, index);
    if (foundation.role !== "laborer" && foundation.role !== "farmer") continue;
    if (!resolvedSettlementHomeDoorFor(place, index)) continue;
    probed++;
    const plan = dailyPlan({
      code: foundation.code, role: foundation.role, ageGroup: foundation.ageGroup,
      guardShift: foundation.guardShift,
    }, foundation.traits, localDayIndex(noon, lon), localWeekday(noon, lon));
    const departures = plan.filter((step, i) => i > 0 &&
      step.anchor !== plan[i-1].anchor && (step.anchor === "work" || step.anchor === "home"));
    let actualBridge = 0;
    for (const departure of departures) {
      const first = residentAt(place, index, tickAtLocalTime(day, departure.start, lon));
      if (!first.grounded || first.route.startsWith("BLOCKED:")) { blockedRoutes++; continue; }
      if (first.activity !== "commute" || !first.travelDistanceM) continue;
      groundedRoutes++;
      const steps = Math.min(130, Math.ceil(first.travelDistanceM/24)+2);
      for (let sample=0; sample<steps; sample++) {
        const state = residentAt(place,index,tickAtLocalTime(day,departure.start+sample*24,lon));
        if (state.activity !== "commute") break;
        for (let j=1; j<(state.walkAhead?.length ?? 0); j++) {
          const a=state.walkAhead![j-1], b=state.walkAhead![j],
            m=greatCircleDistance(sourceToLonLat(a.x,a.z),sourceToLonLat(b.x,b.z)),
            n=Math.max(1,Math.ceil(m));
          assert.ok(n<80, "an ordinary walking window may not jump unbounded distance");
          for(let k=0;k<=n;k++) {
            const t=k/n, x=a.x+wrapSourceX(b.x-a.x)*t, z=a.z+(b.z-a.z)*t,
              surface=finalSurfaceAt(x,z);
            assert.ok(residentWalkableSurface(surface), "a resident crossed physically blocked ground");
            if(surface.traversal === "bridge" &&
              greatCircleDistance(sourceToLonLat(x,z),bridge.position) <= Math.max(bridge.spanM,35)) {
              actualBridge++;
            }
          }
        }
      }
    }
    if (actualBridge) {
      realBridgeWindows += actualBridge;
      const work=residentAt(place,index,tickAtLocalTime(day,15*HOUR,lon)),
        home=residentAt(place,index,tickAtLocalTime(day,23.9*HOUR,lon)),
        door=resolvedSettlementHomeDoorFor(place,index);
      assert.ok(door && work.grounded && work.activity==="work" && home.grounded && home.indoors &&
        home.route===foundation.homeEntrance && home.code===work.code &&
        greatCircleDistance(home.position,sourceToLonLat(door.x,door.z))<.05,
        "real bridge crossing still requires work arrival and original owned-door return");
      console.log("S006 BRIDGE JOURNEY FOUND", JSON.stringify({
        code:foundation.code,bridge:bridge.code,place:place.name,
        realBridgeWindows:actualBridge,work:work.workplace,home:home.homeEntrance,
      }));
      process.exit(0);
    }
  }
}
console.error("S006 ACCEPTANCE NOT MET: no genuine ordinary one-ID bridge-deck work/home journey in bounded seed sample.",JSON.stringify({nearbyPairs:candidates.length,groundedRoutes,blockedRoutes,realBridgeWindows}));
process.exitCode=2;
