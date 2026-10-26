import assert from "node:assert/strict";
import test from "node:test";
import { tickAtLocalTime } from "../src/clock.ts";
import { sourceToLonLat } from "../src/planet.ts";
import { planTransportRouteCorridorByLeg } from "../src/transport-route-corridor.ts";
import { prepareResidentTransportJourney, residentTransportJourneyAt } from "../src/resident-transport-journey.ts";
import type { FinalSurface } from "../src/final-surface.ts";
import type { TransportRoadEdge, TransportNode, TransportBridge } from "../src/transport-network.ts";

const codes = ["a","b","c","d","e"] as const;
const nodes = new Map<string, Pick<TransportNode, "x" | "z">>(
  Array.from({ length: 6 }, (_, i) => [`node-${i}`, { x: i * 2, z: 0 }]),
);
const roads = new Map<string, Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline" | "bridgeCodes">>(
  codes.map((code, i) => [code, {
    code, from: `node-${i}`, to: `node-${i + 1}`,
    centerline: [{ x: i * 2, z: 0 }, { x: i * 2 + 2, z: 0 }] as TransportRoadEdge["centerline"],
    bridgeCodes: code === "d" ? ["wet-crossing"] : [],
  }]),
);
const adjacency = new Map<string, { edge: (typeof roads extends ReadonlyMap<string, infer T> ? T : never) }[]>(
  Array.from(nodes.keys(), node => [node, [...roads.values()]
    .filter(edge => edge.from === node || edge.to === node).map(edge => ({ edge }))]),
);
const route = { from: "node-0", to: "node-5", edgeCodes: [...codes] };
const bridges: Pick<TransportBridge, "roadCode">[] = [{ roadCode: "d" }];
const resident = { code: "SEED/VILLAGE/RESIDENT/7", x: 0, z: 0, grounded: true,
  indoors: false, route: "SEED/VILLAGE/GATE/0" };
const departure = tickAtLocalTime(1, 7 * 3600, sourceToLonLat(0, 0).lon);
const decision = { acceptedByResident: true as const, residentCode: resident.code,
  fromNode: route.from, siteNode: route.to, decidedTick: departure };

function surfaceAt(x: number, _z: number, deckRemoved = false) {
  const roadIndex = Math.max(0, Math.min(4, Math.ceil(x / 2) - 1)),
    road = codes[roadIndex],
    junction = Math.abs(x / 2 - Math.round(x / 2)) < 1e-7,
    next = codes[roadIndex + 1],
    owned = next && junction ? [road, next] : [road],
    wet = Math.abs(x - 7) < .25,
    deck = wet && !deckRemoved;
  return {
    water: { kind: wet ? "river" : "none", level: .5 },
    groundHeight: wet ? 0 : 1,
    surfaceHeight: deck ? 1.3 : wet ? 0 : 1,
    deckHeight: deck ? 1.3 : null,
    traversal: wet ? (deck ? "bridge" : "blocked") : "road",
    walkable: !wet || deck,
    contributingModifierIds: owned,
    groundMaterialOwnerId: road,
    deckOwnerIds: deck ? ["d"] : [],
  } as unknown as FinalSurface;
}

test("synthetic five-road actor fixture preserves lawful shared-bank and arrival semantics", () => {
  const planned = planTransportRouteCorridorByLeg(route, roads, nodes, adjacency);
  assert.equal(planned.status, "ready");
  if (planned.status !== "ready") return;
  assert.equal(planned.stations.find(s => s.joinedEdgeCode === "d")?.edgeCode, "c",
    "verified incoming Y station is the dry bank of outgoing bridge road");
  assert.equal(planned.stations.find(s => s.edgeCode === "d")?.x, 7,
    "the first outgoing-road sample is already over the river deck");
  const journey = prepareResidentTransportJourney(resident, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(journey, "real signed-off source stations and owned wet bridge must admit journey");
  assert.deepEqual(journey!.edgeCodes, codes);
  assert.equal(journey!.stations[0].x, resident.x);
  assert.equal(journey!.stations.at(-1)?.x, nodes.get(route.to)?.x);
  const departureState = residentTransportJourneyAt(journey!, departure);
  assert.equal(departureState.x, resident.x);
  assert.equal(departureState.progress, 0);
  const moving = residentTransportJourneyAt(journey!, departure + 5);
  assert.equal(moving.residentCode, resident.code);
  assert.equal(moving.status, "walking");
  assert.ok(moving.x > 0 && moving.x < 10);
  assert.ok(moving.progress > 0 && moving.progress < 1);
  const after = residentTransportJourneyAt(journey!, departure + 10000);
  assert.equal(after.residentCode, resident.code);
  assert.equal(after.status, "arrived");
  assert.equal(after.x, nodes.get(route.to)?.x);
  assert.equal(after.progress, 1);
  assert.deepEqual(residentTransportJourneyAt(journey!, departure + 5), moving,
    "absolute Fantasy Time replay is deterministic");
});

test("missing actual wet deck, wrong actor, denied decision and remote origin all refuse creation", () => {
  const args = [route, roads, nodes, adjacency, bridges] as const;
  assert.equal(prepareResidentTransportJourney(resident, decision, ...args,
    (x,z) => surfaceAt(x,z,true)), null);
  assert.equal(prepareResidentTransportJourney(resident, decision, ...args,
    (x,z) => Math.abs(x - 6) < .25
      ? { ...surfaceAt(x,z), water: { kind: "river", level: .5 },
          traversal: "bridge", deckHeight: 1, surfaceHeight: 1, deckOwnerIds: ["d"] } as FinalSurface
      : surfaceAt(x,z)), null, "a wet junction cannot stand in for the required dry bank");
  assert.equal(prepareResidentTransportJourney({ ...resident, code: "different" }, decision, ...args,
    (x,z) => surfaceAt(x,z)), null);
  assert.equal(prepareResidentTransportJourney({ ...resident, x: 50 }, decision, ...args,
    (x,z) => surfaceAt(x,z)), null);
  assert.equal(prepareResidentTransportJourney(resident,
    { ...decision, acceptedByResident: false as never }, ...args,
    (x,z) => surfaceAt(x,z)), null);
  assert.equal(prepareResidentTransportJourney(resident, decision,
    { ...route, edgeCodes: ["a","c","b","d","e"] }, roads, nodes, adjacency, bridges,
    (x,z) => surfaceAt(x,z)), null);
});

test("long accepted journey stops for overnight Fantasy Time instead of teleporting", () => {
  const base = prepareResidentTransportJourney(resident, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(base);
  // Pure projection test of a multi-day trip: scale the path's already
  // validated cumulative distances without claiming a new physical witness.
  const scaled = { ...base!, cumulativeMetres: base!.cumulativeMetres.map(n=>n*1000),
    distanceM: base!.distanceM*1000 };
  const atNight = tickAtLocalTime(1, 23 * 3600, base!.originLongitude);
  const overnight = residentTransportJourneyAt(scaled, atNight);
  assert.equal(overnight.status, "resting");
  assert.ok(overnight.progress > 0 && overnight.progress < 1);
  assert.deepEqual(residentTransportJourneyAt(scaled, atNight + 3 * 3600), overnight,
    "same resident is stationary through overnight rest");
  const later = residentTransportJourneyAt(scaled, atNight + 12 * 3600);
  assert.ok(later.progress > overnight.progress, "walking resumes after legal local dawn");
});
