import { test } from "node:test";
import assert from "node:assert/strict";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { transportBridgeByCode } from "../src/transport-network.ts";
import { createTransportWalkingIndex, transportWalkingRouteViaRequiredEdge } from "../src/transport-walking-route.ts";
import { planTransportRouteCorridorByLeg, sampledCorridorStationFailure } from "../src/transport-route-corridor.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt } from "../src/world-core.ts";
import { villages, roads, roadDistanceAt } from "../src/geography.ts";
import { settlementExteriorFor } from "../src/settlement-exterior.ts";
import { greatCircleDistance, sourceToLonLat } from "../src/planet.ts";

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
  let examined = 0, graphCandidates = 0, firstLegal: {from:string;to:string;roads:number;stations:number}|null = null;
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
    verdicts.push({from:from.code,to:to.code,roads:route.edgeCodes.length,
      stations:planned.stations.length,rejected:reason??"FULL sampled surface PASS; actor still unverified"});
    if (!reason) {
      firstLegal={from:from.code,to:to.code,roads:route.edgeCodes.length,
        stations:planned.stations.length};
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
