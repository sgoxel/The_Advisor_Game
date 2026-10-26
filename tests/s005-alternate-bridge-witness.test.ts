import { test } from "node:test";
import assert from "node:assert/strict";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { transportBridgeByCode } from "../src/transport-network.ts";
import { createTransportWalkingIndex, transportWalkingRouteViaRequiredEdge } from "../src/transport-walking-route.ts";
import { planTransportRouteCorridorByLeg, sampledCorridorStationFailure } from "../src/transport-route-corridor.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt } from "../src/world-core.ts";
import { villages, roads, roadDistanceAt } from "../src/geography.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "../src/planet.ts";

/** Bounded source-only candidate search; no road, SEED, character or world mutation.
 * Only a complete strict final-surface PASS could become a future game witness. */
test("S005 alternate canonical owned bridge: gate-Y-site full physical witness scout", () => {
  const network = siteTransportNetwork;
  const bridgeCode = "ADVISOR-0126-ALDERWICK/macro-roads-v2/ROAD/J/0/11/1/1~J/0/11/1/3/BRIDGE/ADVISOR-0126-ALDERWICK-v5-DRAINAGE-0-69-MAIN-19";
  const bridge = transportBridgeByCode(bridgeCode);
  assert.ok(bridge, "the actual previously rendered owned crossing must still exist");
  const edgeByCode = new Map(network.roadEdges.map(e => [e.code, e]));
  const nodeByCode = new Map(network.nodes.map(n => [n.code, n]));
  const crossing = edgeByCode.get(bridge!.roadCode);
  assert.ok(crossing?.bridgeCodes.includes(bridgeCode), "same existing SEED bridge owns its real road");
  const index = createTransportWalkingIndex(network);
  const startCodes = [crossing!.from, crossing!.to];
  const hops = new Map(startCodes.map(code => [code, 0]));
  let frontier = [...startCodes];
  for (let depth = 0; depth < 4 && frontier.length && hops.size <= 256; depth++) {
    const next: string[] = [];
    for (const code of frontier) for (const step of index.adjacency.get(code) ?? []) {
      if (hops.has(step.node) || hops.size >= 256) continue;
      hops.set(step.node, depth + 1);
      next.push(step.node);
    }
    frontier = next.sort();
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const gateNodes = [...hops.keys()].map(code => nodeByCode.get(code))
    .filter((n): n is NonNullable<typeof n> => !!n && n.kind === "village")
    .sort((a,b)=>(hops.get(a.code)!-hops.get(b.code)!)||compare(a.code,b.code))
    .slice(0,12);
  const sites = network.nodes.filter(n => n.kind === "site" &&
    startCodes.some(code => {
      const bank = nodeByCode.get(code);
      return bank && bank.continent === n.continent && bank.countryCode === n.countryCode;
    })).sort((a,b)=>compare(a.code,b.code)).slice(0,12);
  const verdicts: { from: string; to: string; roads: number; stations: number; rejected: string }[] = [];
  const gateEligible = (villageNode: (typeof gateNodes)[number], firstCode: string) => {
    const place = villages.find(v => v.id === villageNode.sourceId);
    const road = roads.find(r => r.code === firstCode);
    return !!(place && road && settlementExteriorFor(place).gates.some(g => roadDistanceAt(g.x,g.z,road) <= 1e-4));
  };
  const started = performance.now();
  let examined = 0, graphCandidates = 0, firstLegal: {from:string;to:string;roads:number;stations:number;midpointStations:number;edges:readonly string[]}|null = null;
  // Limit independent graph candidates, sampled stations and wall-clock work.
  outer: for (const from of gateNodes) for (const to of sites) {
    if (examined >= 16 || performance.now()-started > 120_000) break outer;
    examined++;
    const route = transportWalkingRouteViaRequiredEdge(index, from.code, to.code, crossing!);
    if (!route || route.edgeCodes.length < 3 || route.edgeCodes.length > 12 ||
        !gateEligible(from, route.edgeCodes[0])) continue;
    graphCandidates++;
    const planned = planTransportRouteCorridorByLeg(route, edgeByCode, nodeByCode, index.adjacency);
    if (planned.status !== "ready") {
      verdicts.push({from:from.code,to:to.code,roads:route.edgeCodes.length,
        stations:0,rejected:`source plan ${planned.status}`});
      continue;
    }
    let previous: {x:number;z:number;height:number}|undefined, reason:string|null = null;
    for (const [i, station] of planned.stations.entries()) {
      if (performance.now()-started > 120_000) { reason="bounded 120-second scout budget"; break; }
      const surface = finalSurfaceAt(station.x,station.z);
      const localSlope = surface.deckHeight === null && surface.traversal === "open" && surface.walkable
        ? finalSurfaceLocalSlopeAt(station.x,station.z) : undefined;
      reason = sampledCorridorStationFailure(station,surface,localSlope);
      if (!reason && previous) {
        const metres = greatCircleDistance(sourceToLonLat(previous.x,previous.z),sourceToLonLat(station.x,station.z));
        const grade = metres>0 ? Math.abs(surface.surfaceHeight-previous.height)/metres : Infinity;
        if (!Number.isFinite(grade)||grade>.08) reason = "unsafe measured interval grade";
      }
      if (reason) {
        reason=`station ${i+1}/${planned.stations.length}: ${reason}`;
        break;
      }
      previous={x:station.x,z:station.z,height:surface.surfaceHeight};
    }
    // Do not stop at source-unit stations: a 7–15m interval can conceal
    // a water/grade failure. Sample the actual middle of EVERY interval as
    // a distinct final-surface point, with the same strict adjacent-grade gate.
    let midpointCount = 0;
    if (!reason) for (let i=1; i<planned.stations.length; i++) {
      if (performance.now()-started > 120_000) { reason="bounded dense witness time budget"; break; }
      const a=planned.stations[i-1], b=planned.stations[i], dx=wrapSourceX(b.x-a.x),
        mid={x:wrapSourceX(a.x+dx/2),z:(a.z+b.z)/2,edgeCode:b.edgeCode};
      const left=finalSurfaceAt(a.x,a.z),right=finalSurfaceAt(b.x,b.z),
        surface=finalSurfaceAt(mid.x,mid.z),
        slope=surface.deckHeight===null&&surface.traversal==="open"&&surface.walkable
          ? finalSurfaceLocalSlopeAt(mid.x,mid.z) : undefined;
      reason=sampledCorridorStationFailure(mid,surface,slope);
      if (!reason) {
        const l=greatCircleDistance(sourceToLonLat(a.x,a.z),sourceToLonLat(mid.x,mid.z)),
          rr=greatCircleDistance(sourceToLonLat(mid.x,mid.z),sourceToLonLat(b.x,b.z)),
          gradeA=l>0?Math.abs(surface.surfaceHeight-left.surfaceHeight)/l:Infinity,
          gradeB=rr>0?Math.abs(surface.surfaceHeight-right.surfaceHeight)/rr:Infinity;
        if (!Number.isFinite(gradeA)||!Number.isFinite(gradeB)||gradeA>.08||gradeB>.08)
          reason="unsafe half-interval grade";
      }
      if (reason) {reason=`midpoint after station ${i}/${planned.stations.length}: ${reason}`; break;}
      midpointCount++;
    }
    // Selected owned deck must truly cover wet samples and have dry sampled
    // road stations on both banks; no painted-over water or separate bridge.
    if (!reason) {
      const selected=planned.stations.filter(s=>s.edgeCode===crossing!.code),
        kinds=selected.map(s=>finalSurfaceAt(s.x,s.z).water.kind),
        firstWet=kinds.indexOf("river"), lastWet=kinds.lastIndexOf("river");
      if(firstWet<1||lastWet>=kinds.length-1||
          !kinds.slice(0,firstWet).includes("none")||
          !kinds.slice(lastWet+1).includes("none"))
        reason="selected source bridge lacks sampled wet deck with two dry banks";
      else {
        const at=selected[firstWet], surface=finalSurfaceAt(at.x,at.z);
        if(surface.deckHeight===null||surface.traversal!=="bridge")
          reason="selected wet bridge has no traversed deck";
      }
    }
    verdicts.push({from:from.code,to:to.code,roads:route.edgeCodes.length,
      stations:planned.stations.length,rejected:reason??`FULL half-interval PASS (${midpointCount}); actor still unverified`});
    if (!reason) {
      firstLegal={from:from.code,to:to.code,roads:route.edgeCodes.length,
        stations:planned.stations.length,midpointStations:midpointCount,edges:route.edgeCodes};
      break outer;
    }
  }
  console.log("S005_ALTERNATE_BRIDGE_WITNESS", JSON.stringify({
    bridge:bridgeCode, endpoints:startCodes,gateNodes:gateNodes.length,sites:sites.length,
    examined,graphCandidates,firstLegal,verdicts:verdicts.slice(0,16),
    elapsedMs:Math.round(performance.now()-started),
    caution:"source-only complete sampled stations, not between-station or Simulation actor travel"
  }));
  assert.ok(firstLegal, "no full physically sampled legal gate→selected bridge→site source witness within bounded candidate budget");
});
