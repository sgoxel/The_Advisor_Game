import assert from "node:assert/strict";
import test from "node:test";
import { tickAtLocalTime } from "../src/clock.ts";
import { sourceToLonLat } from "../src/planet.ts";
import { villages } from "../src/geography.ts";
import { residentAt, residentLocalTransportApproach, residentLocalTransportSegmentLegal } from "../src/simulation.ts";
import { planTransportRouteCorridorByLeg } from "../src/transport-route-corridor.ts";
import { prepareResidentTransportJourney, prepareResidentTransportJourneyWithApproach, prepareResidentTransportReturnJourney, residentTransportJourneyAt } from "../src/resident-transport-journey.ts";
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
  assert.ok(Math.abs((planned.stations.find(s => s.edgeCode === "d")?.x ?? Infinity) - 7) < 1e-6,
    "the first outgoing-road sample is already over the river deck");
  const journey = prepareResidentTransportJourney(resident, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(journey, "real signed-off source stations and owned wet bridge must admit journey");
  assert.deepEqual(journey!.edgeCodes, codes);
  assert.equal(journey!.stations[0].x, resident.x);
  assert.ok(Math.abs((journey!.stations.at(-1)?.x ?? Infinity) - nodes.get(route.to)!.x) < 1e-6);
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
  assert.ok(Math.abs(after.x - nodes.get(route.to)!.x) < 1e-6,
    "arrival has the canonical site coordinate within source projection precision");
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

test("already-arrived actor can prepare and traverse a freshly validated reverse five-road trip", () => {
  const outward = prepareResidentTransportJourney(resident, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(outward);
  const returnTick = departure + 10_000,
    arrived = residentTransportJourneyAt(outward!, returnTick),
    actor = { ...resident, x: arrived.x, z: arrived.z },
    chooseReturn = { ...decision, fromNode: route.to, siteNode: route.from,
      decidedTick: returnTick };
  assert.equal(arrived.status, "arrived", "return must follow actual outward arrival");
  const back = prepareResidentTransportReturnJourney(actor, chooseReturn,
    outward!, route.from, roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(back, "fresh opposite direction must prove the same physical bridge and both banks");
  assert.deepEqual(back!.edgeCodes, [...codes].reverse());
  assert.ok(Math.abs(back!.stations[0].x - arrived.x) < 1e-6, "no jump at return departure");
  assert.equal(residentTransportJourneyAt(back!, returnTick - 1).status, "not-departed");
  assert.equal(residentTransportJourneyAt(back!, returnTick).progress, 0);
  const moving = residentTransportJourneyAt(back!, returnTick + 5);
  assert.equal(moving.residentCode, resident.code);
  assert.ok(moving.progress > 0 && moving.progress < 1);
  const homeward = residentTransportJourneyAt(back!, returnTick + 10_000);
  assert.equal(homeward.status, "arrived");
  assert.ok(Math.abs(homeward.x - resident.x) < 1e-6,
    "reached actual departure node only after time-resolved return");
});

test("return refuses before actual arrival, different resident, lost wet deck, and wrong destination", () => {
  const outward = prepareResidentTransportJourney(resident, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(outward);
  const returnTick = departure + 10_000,
    arrived = residentTransportJourneyAt(outward!, returnTick),
    actor = { ...resident, x: arrived.x, z: arrived.z },
    chooseReturn = { ...decision, fromNode: route.to, siteNode: route.from,
      decidedTick: returnTick },
    run = (
      candidate = actor, choice = chooseReturn,
      surface = (x: number, z: number) => surfaceAt(x,z),
      origin = route.from,
    ) => prepareResidentTransportReturnJourney(candidate, choice, outward!, origin,
      roads, nodes, adjacency, bridges, surface);
  assert.equal(run(actor, { ...chooseReturn, decidedTick: departure + 1 }), null,
    "a site position is not a completed outward journey before elapsed time");
  assert.equal(run({ ...actor, code: "other-resident" }), null);
  assert.equal(run({ ...actor, x: 0 }), null,
    "no teleport from a source position instead of the physical site");
  assert.equal(run(actor, chooseReturn, (x,z) => surfaceAt(x,z,true)), null,
    "a removed deck blocks an otherwise proven reverse crossing");
  assert.equal(run(actor, { ...chooseReturn, siteNode: "unrelated-node" }), null);
  assert.equal(run(actor, chooseReturn, (x,z) => surfaceAt(x,z), "unrelated-node"), null);
});

test("a real start position moves along a legal local approach before the same five SEED roads", () => {
  const actor = { ...resident, x: -2 },
    approach = [{ x: -2, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 0 }],
    legalStreet = (a: {x:number;z:number}, b: {x:number;z:number}) =>
      a.z === 0 && b.z === 0 && b.x > a.x;
  assert.equal(prepareResidentTransportJourney(actor, decision, route,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z)), null,
    "a remote actor never receives a free teleport to the macro node");
  const journey = prepareResidentTransportJourneyWithApproach(actor, decision, route,
    roads, nodes, adjacency, bridges, approach, legalStreet, (x,z) => surfaceAt(x,z));
  assert.ok(journey);
  assert.equal(journey!.residentCode, actor.code);
  assert.deepEqual(journey!.edgeCodes, [...codes]);
  assert.equal(journey!.macroStart?.x, 0, "the actual road origin remains canonical");
  assert.equal(journey!.stations[0].x, actor.x);
  assert.ok(journey!.distanceM > 0);
  assert.equal(residentTransportJourneyAt(journey!, departure).x, actor.x);
  const onApproach = residentTransportJourneyAt(journey!, departure + 5);
  assert.ok(onApproach.x > actor.x && onApproach.x < 0,
    "local movement happens before macro-road movement");
  const atSite = residentTransportJourneyAt(journey!, departure + 10_000);
  assert.equal(atSite.status, "arrived");
  assert.ok(Math.abs(atSite.x - nodes.get(route.to)!.x) < 1e-6);
  const returnDecision = { ...decision, fromNode: route.to, siteNode: route.from,
    decidedTick: departure + 10_000 };
  const reverse = prepareResidentTransportReturnJourney(
    { ...actor, x: atSite.x, z: atSite.z }, returnDecision, journey!, route.from,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z));
  assert.ok(reverse, "completed actor may revalidate a reverse road trip to the canonical gate");
  assert.equal(reverse!.stations.at(-1)?.x, 0,
    "arrival at the macro gate does not falsely claim the separate home connector");
});

test("unverified gate approach, blocked streets and steep local slopes refuse without moving the actor", () => {
  const actor = { ...resident, x: -2 },
    approach = [{ x: -2, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 0 }],
    legal = () => true,
    run = (
      person = actor,
      path: readonly { x: number; z: number }[] = approach,
      segmentLegal: (a: {x:number;z:number}, b:{x:number;z:number})=>boolean = legal,
      surface = (x: number, z: number) => surfaceAt(x,z),
    ) => prepareResidentTransportJourneyWithApproach(person, decision, route,
      roads, nodes, adjacency, bridges, path, segmentLegal, surface);
  assert.equal(run(actor, approach, () => false), null,
    "the town's enclosure/street validator owns legal gate passage");
  assert.equal(run(actor, [{x:-2,z:0}, {x:-1,z:0}, {x:1,z:0}]), null,
    "the street path cannot miss the exact canonical macro origin");
  assert.equal(run({ ...actor, x: -1.9 }), null, "no invented approach departure");
  assert.equal(run({ ...actor, indoors: true }), null);
  assert.equal(run(actor, approach, legal, (x,z) => Math.abs(x + 1) < .01
    ? { ...surfaceAt(x,z), water: { kind: "river", level: .5 },
        walkable: false, traversal: "blocked" } as FinalSurface
    : surfaceAt(x,z)), null, "a flooded local street is not a gate");
  assert.equal(run(actor, approach, legal, (x,z) => Math.abs(x + 1) < .01
    ? { ...surfaceAt(x,z), surfaceHeight: 10 } as FinalSurface
    : surfaceAt(x,z)), null, "a steep interval cannot be hidden before the macro road");
  assert.equal(run(actor, approach, legal, (x,z) => surfaceAt(x,z,true)), null,
    "the same owned bridge still has to exist beyond the legal approach");
});

test("actual Greyfield SEED actor supplies only his own verified local street origin", () => {
  const place = villages.find(village => village.name === "Greyfield");
  assert.ok(place);
  const noon = tickAtLocalTime(1, 12 * 3_600, place!.canonicalPosition.lon),
    actor = residentAt(place!, 15, noon);
  assert.equal(actor.code, `${place!.code}/RESIDENT/15`);
  assert.ok(actor.grounded && !actor.indoors,
    "existing independently scheduled far-bank maintenance worker must be outdoors");
  const samePlace = { x: actor.x, z: actor.z },
    local = residentLocalTransportApproach(place!, actor, samePlace);
  assert.ok(local && local.length >= 2, "actual SEED resident's current physical position must resolve");
  assert.ok(Math.abs(local![0].x - actor.x) < 1e-6);
  assert.ok(Math.abs(local!.at(-1)!.z - actor.z) < 1e-6);
  assert.equal(residentLocalTransportSegmentLegal(place!, local![0], local![1]), true);
  assert.equal(residentLocalTransportApproach(place!, { ...actor, code: "impostor" }, samePlace), null);
  assert.equal(residentLocalTransportApproach(place!, { ...actor, grounded: false }, samePlace), null);
  assert.equal(residentLocalTransportApproach(place!, { ...actor, indoors: true }, samePlace), null);
});
