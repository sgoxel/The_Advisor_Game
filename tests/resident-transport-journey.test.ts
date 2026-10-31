import assert from "node:assert/strict";
import test from "node:test";
import { REAL_EPOCH_MS, TIME_SCALE, localWeekday, tickAtLocalTime } from "../src/clock.ts";
import { greatCircleDistance, sourceToLonLat } from "../src/planet.ts";
import { villages } from "../src/geography.ts";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { transportBridgeByCode } from "../src/transport-network.ts";
import { createTransportWalkingIndex, transportWalkingRouteViaRequiredEdge } from "../src/transport-walking-route.ts";
import { residentAt, residentLocalTransportApproach, residentLocalTransportSegmentLegal } from "../src/simulation.ts";
import { planTransportRouteCorridorByLeg } from "../src/transport-route-corridor.ts";
import { prepareResidentTransportJourney, prepareResidentTransportJourneyWithApproach, prepareResidentTransportReturnJourney, appendResidentReturnToOwnedDoor, residentTransportJourneyAt } from "../src/resident-transport-journey.ts";
import type { FinalSurface } from "../src/final-surface.ts";
import { finalSurfaceAt } from "../src/world-core.ts";
import { ResidentSiteVisitJournal, residentChoosesSiteVisit } from "../src/resident-transport-events.ts";
import { siteVisitCorridors } from "../src/site-visit-advice.ts";
import type { TransportNetwork } from "../src/transport-network.ts";
import { LazySimulation, type Resident } from "../src/simulation.ts";
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

  // An autonomous return or visit may be approved at night. The first tick
  // must honestly report resting with unchanged real SEED feet, not "walking"
  // while the bounded Fantasy Time schedule forbids movement.
  const nightDeparture = tickAtLocalTime(2, 23 * 3600, scaled.originLongitude);
  const waiting = { ...scaled, departedTick: nightDeparture };
  const first = residentTransportJourneyAt(waiting, nightDeparture),
    next = residentTransportJourneyAt(waiting, nightDeparture + 1);
  assert.equal(first.status, "resting", "no phantom first-second bridge movement at 23:00");
  assert.equal(first.progress, 0);
  assert.equal(next.status, "resting");
  assert.deepEqual({ x: first.x, z: first.z }, { x: next.x, z: next.z },
    "approved overnight trip stays at the original legal starting feet until daylight");
  assert.equal(residentTransportJourneyAt(waiting, nightDeparture - 1).status, "not-departed");
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
  assert.ok(Math.abs(residentTransportJourneyAt(journey!, departure).x - actor.x) < 1e-6,
    "source-coordinate round-trip must preserve the actual departure point within precision");
  const onApproach = residentTransportJourneyAt(journey!, departure + 5);
  assert.ok(onApproach.x > actor.x && onApproach.x < 0,
    "local movement happens before macro-road movement");
  const atSite = residentTransportJourneyAt(journey!, departure + 10_000);
  assert.equal(atSite.status, "arrived");
  assert.ok(Math.abs(atSite.x - nodes.get(route.to)!.x) < 1e-6);
  const returnDecision = { ...decision, fromNode: route.to, siteNode: route.from,
    decidedTick: departure + 10_000 };
  const returnedActor = { ...actor, x: atSite.x, z: atSite.z },
    reverse = prepareResidentTransportReturnJourney(
      returnedActor, returnDecision, journey!, route.from,
      roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z),
      () => 0, (from,to) => from.z === 0 && to.z === 0 && to.x < from.x);
  assert.ok(reverse, "completed actor revalidates both the owned bridge and real local street return");
  assert.equal(reverse!.stations.at(-1)?.x, actor.x,
    "arrival is the actual actor departure, not a free move to the macro gate");
  assert.ok(reverse!.distanceM > journey!.distanceM - 1,
    "the full return includes the previously legal street connector");
  const arrivedHomeward = residentTransportJourneyAt(reverse!, returnDecision.decidedTick + 10_000);
  assert.equal(arrivedHomeward.status, "arrived");
  assert.ok(Math.abs(arrivedHomeward.x - actor.x) < 1e-6,
    "no teleport, only time-resolved return to original position");
  assert.equal(prepareResidentTransportReturnJourney(
    returnedActor, returnDecision, journey!, route.from,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z)), null,
    "a historical outward street validation cannot certify a return without current Simulation street authority");
  assert.equal(prepareResidentTransportReturnJourney(
    returnedActor, returnDecision, journey!, route.from,
    roads, nodes, adjacency, bridges, (x,z) => surfaceAt(x,z),
    () => 0, () => false), null,
    "closed street/gate must reject even when the long bridge remains legal");
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

test("Simulation site-departure entry refuses invented residents without an event", async () => {
  const sim = new LazySimulation();
  sim.advance(departure);
  assert.equal(await sim.restoreSiteVisitHistory({
    version: 1, seed: "ADVISOR-0126-ALDERWICK", foundation: "v5",
    visits: [{ residentCode: "invented", decidedTick: 1,
      from: route.from, to: route.to, edgeCodes: codes }],
  }), false, "stored event may not manufacture a SEED person or validated travel");
  assert.deepEqual(sim.savedSiteVisitHistory().visits, [],
    "failed restore is atomic; no partial accepted journey leaks");
  assert.equal(await sim.restoreSiteVisitHistory({
    version: 1, seed: "wrong-world", foundation: "v5", visits: [],
  }), false, "different SEED versions cannot overwrite character history");
  assert.equal(await sim.tryBeginSelfDirectedSiteVisit("invented-resident", route), null);
  const advice = await sim.considerAdvisorSiteVisit("invented-resident");
  assert.equal(advice.started, false, "an Advisor click cannot create a fabricated actor");
  assert.equal(sim.preparedSiteVisitFor("invented-resident"), undefined);
  assert.equal(await sim.tryBeginSelfDirectedSiteVisit(resident.code,
    { ...route, edgeCodes: [] }), null,
    "no empty route can create an accepted Simulation event");
  assert.equal(sim.preparedSiteVisitFor(resident.code), undefined);
});


test("Advisor visit candidates are bounded SEED graph hypotheses, not fabricated actor movement", () => {
  const networkNodes = [...nodes.entries()].map(([code, source], i) => ({
    code, sourceId: i === 0 ? "real-original-settlement" : code,
    kind: i === 0 ? "village" : i === 5 ? "site" : "junction",
    countryCode: "same-real-country", continent: 0,
    x: source.x, z: source.z,
    position: { ...sourceToLonLat(source.x, source.z), elevation: 1 },
  }));
  const network = {
    nodes: networkNodes,
    roadEdges: [...roads.values()].map(edge => ({
      ...edge, surfaceLengthM: 100, fantasyWalkSeconds: 100,
    })),
    bridges: [{ roadCode: "d", code: "original-wet-crossing", x: 7, z: 0 }],
  } as unknown as TransportNetwork;
  const corridors = siteVisitCorridors(network, "real-original-settlement");
  assert.equal(corridors.length, 1);
  assert.deepEqual(corridors[0], route,
    "use the actual five-edge topology including the owned wet bridge, not a shortcut");
  assert.deepEqual(siteVisitCorridors(network, "real-original-settlement"), corridors,
    "SEED candidate ordering never depends on random or rendering state");
  assert.deepEqual(siteVisitCorridors(network, "invented-settlement"), []);
  assert.deepEqual(siteVisitCorridors({ ...network, bridges: [] }, "real-original-settlement"), [],
    "no owned wet bridge means no bridge-site itinerary proposal");
  const otherCountry = {
    ...network, nodes: networkNodes.map(node =>
      node.kind === "site" ? { ...node, countryCode: "another-country" } : node),
  } as TransportNetwork;
  assert.deepEqual(siteVisitCorridors(otherCountry, "real-original-settlement"), [],
    "same-country site candidates never invent a cross-border permission");
});

/** Independent choice/event ledger under a controlled source-surface fixture:
 * this is NOT yet visible worker-main gameplay or persistent home arrival. */
test("Simulation-owned site-visit decision refuses orders and journals only a fully verified departure", () => {
  const actor = {
    ...resident, x: -2, z: 0, activity: "stroll",
    mood: { value: .4, label: "hopeful" },
    traits: { personality: { curiosity: .9, sociability: .8, piety: .5,
      temper: .1, diligence: .5 }, abilities: { strength: 8,
      dexterity: 8, constitution: 8, knowledge: 8, wisdom: 8, charisma: 8 },
      temperament: "inquisitive" },
  } as Resident;
  const approach = [{x:-2,z:0},{x:-1,z:0},{x:0,z:0}],
    permitted = (a: {x:number;z:number}, b: {x:number;z:number}) =>
      a.z === 0 && b.z === 0 && b.x > a.x,
    start = (journal: ResidentSiteVisitJournal,
      source = (x:number,z:number) => surfaceAt(x,z),
      street = permitted,
    ) => journal.tryStart(actor.code, departure, route, roads, nodes, adjacency,
      bridges, () => approach, street, source);
  assert.equal(residentChoosesSiteVisit({ ...actor, activity: "work" }, route.from, route.to, departure), null,
    "Advisor route selection may not override an actual scheduled job");
  assert.equal(residentChoosesSiteVisit({ ...actor, indoors: true }, route.from, route.to, departure), null);
  assert.equal(residentChoosesSiteVisit({ ...actor, mood: {...actor.mood, value: -.9} },
    route.from, route.to, departure), null);
  assert.equal(residentChoosesSiteVisit({ ...actor, traits: { ...actor.traits, personality:
    { ...actor.traits.personality, curiosity: .1, sociability: .1 } } },
    route.from, route.to, departure), null);
  assert.equal(start(new ResidentSiteVisitJournal(() => actor), (x,z)=>surfaceAt(x,z,true)), null,
    "no owned wet deck never creates a travel event");
  assert.equal(start(new ResidentSiteVisitJournal(() => actor), (x,z)=>surfaceAt(x,z),
    () => false), null, "a denied gate street never creates an event");
  const wrong = new ResidentSiteVisitJournal(() => ({ ...actor, code: "different" }));
  assert.equal(start(wrong), null, "resident identity mismatch fails closed");
  assert.equal(wrong.count, 0);
  const events = new ResidentSiteVisitJournal((code) => code === actor.code ? actor : undefined);
  const accepted = start(events);
  assert.ok(accepted, "character chooses for its own motives, and Simulation proves the real five-edge physical fixture");
  assert.equal(accepted!.kind, "resident-site-visit");
  assert.equal(accepted!.residentCode, actor.code);
  assert.equal(events.count, 1);
  assert.equal(start(events), null, "an active original actor may not acquire a duplicate overlapping journey");
  assert.equal(events.at(actor.code, departure - 1)?.status, "not-departed");
  const walking = events.at(actor.code, departure + 5);
  assert.equal(walking?.status, "walking");
  assert.ok(walking!.x > actor.x && walking!.x < 0, "real street movement precedes the bridge route");
  const arrived = events.at(actor.code, departure + 10000);
  assert.equal(arrived?.status, "arrived");
  assert.ok(Math.abs(arrived!.x - nodes.get(route.to)!.x) < 1e-6);
  assert.deepEqual(events.at(actor.code, departure + 5), walking,
    "absolute Fantasy Time replays the same committed SEED actor event");
  assert.equal(events.at("different", departure + 5), undefined);

  const original = { ...actor, home: "original-owned-home", homeBuilding: "original-house",
    position: { ...sourceToLonLat(actor.x, actor.z), elevation: 1 } } as Resident;
  assert.strictEqual(events.project(original, departure - 1, () => 1), original,
    "before an accepted departure, the canonical ordinary routine remains unchanged");
  const projected = events.project(original, departure + 5, () => 1);
  assert.equal(projected.code, original.code);
  assert.equal(projected.home, "original-owned-home");
  assert.equal(projected.homeBuilding, "original-house");
  assert.equal(projected.indoors, false);
  assert.equal(projected.activity, "commute");
  assert.ok(projected.x > original.x && projected.x < nodes.get(route.to)!.x);
  assert.ok(projected.walkAhead && projected.walkAhead.length >= 2,
    "render motion follows timed physically verified station windows");
  assert.deepEqual(events.project(original, departure + 5, () => 1), projected,
    "same Fantasy tick and original identity reproduce one deterministic actor");
  const atSite = events.project(original, departure + 10000, () => 1);
  assert.equal(atSite.activity, "stroll");
  assert.equal(atSite.travelProgress, 1);
  assert.equal(atSite.walkAhead, undefined);
  assert.ok(Math.abs(atSite.x - nodes.get(route.to)!.x) < 1e-6);
  const otherResident = { ...original, code: "unrelated-original" } as Resident;
  assert.strictEqual(events.project(otherResident, departure + 5, () => 1), otherResident,
    "a visit may not spawn or displace another canonical SEED identity");

  const queryAtWalking = {
    x: walking!.x, z: walking!.z, radius: .05, limit: 8,
  };
  const projectedQuery = events.visible([original], departure + 5, queryAtWalking);
  assert.equal(projectedQuery.length, 1);
  assert.equal(projectedQuery[0].code, original.code);
  assert.ok(Math.abs(projectedQuery[0].x - walking!.x) < 1e-7,
    "worker routine record must be replaced by the validated physical location");
  const oldHomeQuery = events.visible([original], departure + 5, {
    x: original.x, z: original.z, radius: .05, limit: 8,
  });
  assert.deepEqual(oldHomeQuery, [],
    "the same actor may not remain as a routine ghost at the original home");
  const nearSite = events.visible([], departure + 10000, {
    x: nodes.get(route.to)!.x, z: 0, radius: .05, limit: 8,
  });
  assert.equal(nearSite.length, 1);
  assert.equal(nearSite[0].code, original.code);
  assert.equal(nearSite[0].activity, "stroll",
    "visitor remains the original actor when worker routine spatial index misses the site");
  const unrelated = { ...otherResident, x: walking!.x } as Resident;
  const together = events.visible([original, unrelated], departure + 5, { ...queryAtWalking, limit: 2 });
  assert.deepEqual(together.map(r => r.code), [original.code, unrelated.code],
    "projected traveller takes exactly one slot; unrelated SEED actor remains");
  assert.deepEqual(events.visible([original, unrelated], departure + 5,
    { ...queryAtWalking, limit: 1 }).map(r => r.code), [original.code],
    "projection respects the existing strict visible resident budget");
  assert.deepEqual(events.visible([original], departure - 1, {
    x: original.x, z: original.z, radius: 1, limit: 8,
  }), [original], "events may not change a pre-departure worker routine snapshot");

  // Decisive home acceptance: a real site arrival is required; the full
  // five-edge wet bridge is checked again and the final owned-house step is
  // independently verified, not an implied teleport from the old street stop.
  const returnTick = departure + 10000, atDestination = events.at(actor.code, returnTick);
  assert.equal(atDestination?.status, "arrived");
  const returnDecision = { acceptedByResident: true as const,
    residentCode: actor.code, fromNode: route.to, siteNode: route.from,
    decidedTick: returnTick };
  const reverse = prepareResidentTransportReturnJourney(
    { ...actor, x: atDestination!.x, z: atDestination!.z },
    returnDecision, accepted!.journey, route.from,
    roads, nodes, adjacency, bridges, (x,z)=>surfaceAt(x,z),
    () => 0, (from,to) => from.z === 0 && to.z === 0 && to.x < from.x);
  assert.ok(reverse, "full return must reprove the bridge and original local gate");
  assert.equal(reverse!.stations.at(-1)!.x, original.x);
  const ownedDoor = { x: -3, z: 0 },
    street = [{ x: original.x, z: original.z }, ownedDoor],
    homeward = appendResidentReturnToOwnedDoor(reverse!, street,
      (from,to) => from.z === 0 && to.z === 0 && to.x < from.x,
      (x,z) => surfaceAt(x,z), () => 0);
  assert.ok(homeward, "owned door has a separate real lawful town-street leg");
  assert.ok(homeward!.distanceM > reverse!.distanceM);
  assert.equal(homeward!.stations.at(-1)!.x, ownedDoor.x);
  assert.equal(appendResidentReturnToOwnedDoor(reverse!, street, () => false,
    (x,z) => surfaceAt(x,z)), null,
    "a blocked owned-home street refuses, even if the river bridge remains valid");
  assert.equal(appendResidentReturnToOwnedDoor(reverse!, street, () => true,
    (x,z) => ({ ...surfaceAt(x,z), surfaceHeight: x < -2.4 ? 100 : 1 }),
    () => 0), null, "steep doorstep approach cannot be bypassed");
  assert.equal(events.tryRecordHomeReturn(actor.code, departure + 1, homeward!, ownedDoor), null,
    "an Advisor cannot start a return before the site is physically reached");
  assert.ok(events.tryRecordHomeReturn(actor.code, returnTick, homeward!, ownedDoor),
    "post-arrival autonomous return may begin only after lawful owned-door verification");
  assert.equal(events.tryRecordHomeReturn(actor.code, returnTick, homeward!, ownedDoor), null,
    "duplicate homeward journeys cannot start");
  const homeArrived = events.at(actor.code, returnTick + 10000);
  assert.equal(homeArrived?.status, "arrived");
  assert.ok(Math.abs(homeArrived!.x - ownedDoor.x) < 1e-6);
  const atOwnedDoor = events.project(original, returnTick + 10000, () => 1);
  assert.equal(atOwnedDoor.code, original.code);
  assert.equal(atOwnedDoor.route, "HOME: owned doorway reached");
  assert.equal(atOwnedDoor.homeBuilding, original.homeBuilding);
  assert.deepEqual(events.savedVisits(), [{
    residentCode: actor.code, decidedTick: departure,
    from: route.from, to: route.to, edgeCodes: [...codes],
    homeReturnTick: returnTick,
  }], "durable journal exports route IDs and timestamps only, never untrusted positions");

});

test("actual Greyfield SEED actor supplies only his own verified local street origin", () => {
  const place = villages.find(village => village.name === "Greyfield");
  assert.ok(place);
  const longitude = place!.canonicalPosition.lon,
    day = [1, 2, 3, 4, 5, 6, 7].find(d =>
      localWeekday(tickAtLocalTime(d, 12 * 3_600, longitude), longitude) !== 6)!,
    samples = [6, 8, 10, 12, 14, 16, 18].map(hour =>
      residentAt(place!, 15, tickAtLocalTime(day, hour * 3_600, longitude))),
    actor = samples.find(r => r.grounded && !r.indoors);
  assert.ok(actor, "the real worker has an outdoor position on the fixed SEED workday");
  assert.equal(actor!.code, `${place!.code}/RESIDENT/15`);
  const samePlace = { x: actor!.x, z: actor!.z },
    local = residentLocalTransportApproach(place!, actor!, samePlace);
  assert.ok(local && local.length >= 2, "actual SEED resident's current physical position must resolve");
  assert.ok(Math.abs(local![0].x - actor!.x) < 1e-6);
  assert.ok(Math.abs(local!.at(-1)!.z - actor!.z) < 1e-6);
  assert.equal(residentLocalTransportSegmentLegal(place!, local![0], local![1]), true);
  assert.equal(residentLocalTransportApproach(place!, { ...actor!, code: "impostor" }, samePlace), null);
  assert.equal(residentLocalTransportApproach(place!, { ...actor!, grounded: false }, samePlace), null);
  assert.equal(residentLocalTransportApproach(place!, { ...actor!, indoors: true }, samePlace), null);
});


/** Full original-Campaign-SEED acceptance — unlike synthetic route witnesses,
 * the actor independently chooses the trip at a fixed rest-day Fantasy tick.
 * Only a handful of original residents and two outdoor dayparts are examined,
 * with no population sweep or invented positions. */
test("a real independently deciding SEED resident reaches a legal bridge site and reloads the same travel", async () => {
  const originCode = "ADVISOR-0126-ALDERWICK/v5/TRANSPORT/NODE/PLACE/0/11/1/2",
    siteCode = "ADVISOR-0126-ALDERWICK/v5/TRANSPORT/NODE/SITE/ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/11/SITE/0",
    bridgeCode = "ADVISOR-0126-ALDERWICK/macro-roads-v2/ROAD/J/0/11/1/1~J/0/11/1/3/BRIDGE/ADVISOR-0126-ALDERWICK-v5-DRAINAGE-0-69-MAIN-19",
    origin = siteTransportNetwork.nodes.find(node => node.code === originCode),
    place = villages.find(v => v.id === origin?.sourceId),
    ownedBridge = transportBridgeByCode(bridgeCode);
  assert.ok(origin && place && ownedBridge);
  const walking = createTransportWalkingIndex(siteTransportNetwork),
    requiredEdge = siteTransportNetwork.roadEdges.find(e => e.code === ownedBridge!.roadCode);
  assert.ok(requiredEdge);
  const corridor = transportWalkingRouteViaRequiredEdge(walking, originCode, siteCode, requiredEdge!);
  assert.ok(corridor && corridor.edgeCodes.length === 5,
    "real SEED gate-to-site must cross the actual owned wet bridge");
  const day = [1,2,3,4,5,6,7,8].find(d =>
    localWeekday(tickAtLocalTime(d, 14*3600, place!.canonicalPosition.lon),
      place!.canonicalPosition.lon) === 6);
  assert.ok(day !== undefined, "a stable original SEED rest day exists");
  let accepted: Awaited<ReturnType<LazySimulation["tryBeginSelfDirectedSiteVisit"]>> = null;
  let selected: LazySimulation | undefined, decidedTick = 0, chosenCode = "";
  // Intentionally narrow fixed SEED actors with independently favourable
  // personality scores; actual schedules and street/bridge proofs may refuse.
  outer: for (const index of [3,4,6,8,9,10,11,14,16,21,26]) {
    for (const hour of [11,14,15]) {
      const tick = tickAtLocalTime(day!, hour*3600, place!.canonicalPosition.lon),
        actor = residentAt(place!, index, tick);
      if (!residentChoosesSiteVisit(actor, originCode, siteCode, tick)) continue;
      const sim = new LazySimulation();
      sim.setFocus(place!);
      sim.advance(tick);
      const event = await sim.tryBeginSelfDirectedSiteVisit(actor.code, corridor!);
      if (!event) continue;
      accepted = event; selected = sim; decidedTick = tick; chosenCode = actor.code;
      break outer;
    }
  }
  assert.ok(accepted && selected,
    "one actual autonomous SEED resident must lawfully decide and traverse the preverified owned-bridge itinerary");
  const options = siteVisitCorridors(siteTransportNetwork, place!.id);
  assert.deepEqual(options[0], { from: originCode, to: siteCode, edgeCodes: [...corridor!.edgeCodes] },
    "on-screen Advisor suggestion must surface this truly lawful original Campaign-SEED route first");
  const advised = new LazySimulation();
  advised.setFocus(place!);
  advised.advance(decidedTick);
  const response = await advised.considerAdvisorSiteVisit(chosenCode);
  assert.equal(response.started, true,
    "the actual player Advisor path must preserve the original resident's independent acceptance");
  assert.deepEqual(advised.preparedSiteVisitFor(chosenCode)?.journey.edgeCodes,
    accepted!.journey.edgeCodes, "UI advice cannot substitute a different route or fabricated destination");
  const originalEvent = advised.preparedSiteVisitFor(chosenCode);
  const exported = advised.savedSiteVisitHistory();
  const failedImport = advised.restoreSiteVisitHistory({
    ...exported,
    visits: [...exported.visits, { residentCode: "INVENTED/PERSON",
      decidedTick, from: originCode, to: siteCode,
      edgeCodes: [...corridor!.edgeCodes] }],
  });
  assert.strictEqual(advised.preparedSiteVisitFor(chosenCode), originalEvent,
    "slow historical revalidation must not erase or expose half-restored live actor");
  assert.equal(await failedImport, false,
    "one fictitious later event makes the entire saved ledger refuse atomically");
  assert.strictEqual(advised.preparedSiteVisitFor(chosenCode), originalEvent,
    "failed import preserves the previously accepted original resident object");
  // An actual accepted actor may outlive a slow routine-worker snapshot. The
  // source traveller at present Fantasy Time, not that older query tick,
  // must own the rendered road position and ongoing metre-paced walk.
  assert.equal(advised.acceptedSiteVisitCount, 1);
  const oldRoutine = residentAt(place!, Number(chosenCode.split("/").at(-1)), decidedTick),
    liveTick = decidedTick + 3 * TIME_SCALE;
  advised.advance(liveTick);
  const liveTraveller = advised.projectedResidentByCode(chosenCode);
  assert.ok(liveTraveller);
  const camera = { x: liveTraveller!.x, z: liveTraveller!.z, radius: 32, limit: 8 },
    projected = advised.projectResidentView([oldRoutine], liveTick, camera),
    oldProjection = advised.projectResidentView([oldRoutine], decidedTick, camera);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].code, chosenCode);
  assert.ok(Math.hypot(projected[0].x - liveTraveller!.x, projected[0].z - liveTraveller!.z) < 1e-8,
    "slow worker cannot pin the real traveller to an old road station");
  assert.ok(oldProjection.length === 1 &&
    Math.hypot(oldProjection[0].x - liveTraveller!.x, oldProjection[0].z - liveTraveller!.z) > 1e-8,
    "the old snapshot's Fantasy Time would display a stale foot position");
  const destinationTick = decidedTick + 30*86400;
  selected!.advance(destinationTick);
  const arrived = selected!.projectedResidentByCode(chosenCode);
  assert.ok(arrived);
  assert.equal(arrived!.code, chosenCode);
  assert.equal(arrived!.route, `ARRIVED: ${siteCode}`);
  assert.ok(Math.abs(arrived!.x - siteTransportNetwork.nodes.find(n => n.code === siteCode)!.x) < 1e-6);
  const replay = new LazySimulation();
  replay.advance(destinationTick);
  assert.equal(await replay.restoreSiteVisitHistory(selected!.savedSiteVisitHistory()), true,
    "saved canonical event must recompute the same physical original-person visit");
  assert.deepEqual(replay.projectedResidentByCode(chosenCode), arrived,
    "Fantasy Time replay restores the original site arrival without trusting saved coordinates");
  const outboundHistory = selected!.savedSiteVisitHistory();
  const targetStations = accepted!.journey.stations;
  const bridgeIndex = targetStations.reduce((best, point, i) => {
    const distance = (p: typeof point) => Math.hypot(p.x - ownedBridge!.x, p.z - ownedBridge!.z);
    return distance(point) < distance(targetStations[best]) ? i : best;
  }, 0);
  const bridgeMetres = accepted!.journey.cumulativeMetres[bridgeIndex];
  let lowTick = decidedTick, highTick = destinationTick;
  while (lowTick < highTick) {
    const middle = Math.floor((lowTick + highTick) / 2);
    if (residentTransportJourneyAt(accepted!.journey, middle).distanceM < bridgeMetres)
      lowTick = middle + 1;
    else highTick = middle;
  }
  const bridgePoint = residentTransportJourneyAt(accepted!.journey, lowTick);
  assert.ok(Math.hypot(bridgePoint.x - ownedBridge!.x, bridgePoint.z - ownedBridge!.z) < 2,
    "the actual site traveller's screenshot tick must coincide with the existing wet deck");
  const home = await selected!.considerAdvisorHomeReturn(chosenCode);
  assert.equal(typeof home.started, "boolean");
  let ownedDoorPoint: { x: number; z: number } | undefined;
  if (home.started) {
    const next = destinationTick + 30*86400;
    selected!.advance(next);
    const atHome = selected!.projectedResidentByCode(chosenCode);
    ownedDoorPoint = atHome && { x: atHome.x, z: atHome.z };
    assert.equal(atHome?.route, "HOME: owned doorway reached",
      "when the original actor chooses home, the final station is the actual owned door");
    const loaded = new LazySimulation();
    loaded.advance(next);
    assert.equal(await loaded.restoreSiteVisitHistory(selected!.savedSiteVisitHistory()), true,
      "accepted home return must also revalidate on durable replay");
    assert.deepEqual(loaded.projectedResidentByCode(chosenCode), atHome);
  } else {
    assert.match(home.message, /declined|door|street|deck|grade|unlawful/,
      "a blocked return must be an explicit truthful refusal, not a teleported success");
  }
  // Only an explicit screenshot-tool CI fixture request writes a small proof
  // envelope. It contains the exact independently validated original SEED
  // decisions and is NEVER imported into game state without full revalidation.
  if (process.env.S005_VISUAL_WITNESS) {
    const { mkdirSync, writeFileSync } = await import("node:fs"),
      { dirname } = await import("node:path"),
      file = process.env.S005_VISUAL_WITNESS,
      // Fixed screenshot clocks must reproduce the EXACT original Fantasy tick.
      // Rounding to the next whole real second advances up to TIME_SCALE
      // fantasy seconds and moves the actor off the selected wet deck.
      fixedMs = (tick: number) => REAL_EPOCH_MS +
        Math.round((tick + 0.5) * 1000 / TIME_SCALE),
      door = selected!.residentByCode(chosenCode)!.homeEntrance;
    for (const tick of [lowTick, destinationTick, destinationTick + 30*86400])
      assert.equal(Math.floor((fixedMs(tick) - REAL_EPOCH_MS) * TIME_SCALE / 1000), tick,
        "captured browser time must project the actual canonical SEED event tick");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      residentCode: chosenCode, ownedDoorCode: door,
      originCode, siteCode, bridgeCode,
      site: { x: arrived!.x, z: arrived!.z },
      bridge: { x: bridgePoint.x, z: bridgePoint.z },
      ownedDoorPoint,
      bridgeFixedMs: fixedMs(lowTick),
      siteFixedMs: fixedMs(destinationTick),
      homeFixedMs: fixedMs(destinationTick + 30*86400),
      homeStarted: home.started, homeMessage: home.message,
      outboundHistory, homeHistory: selected!.savedSiteVisitHistory(),
    }, null, 2));
  }
});

/** Exact Campaign-SEED village→owned-wet-bridge→critical-site candidate;
 * this proves an existing actor CAN receive a validated itinerary, not that
 * a caller's acceptedByResident flag is a genuine independent NPC decision.
 * All actor starts are reconstructed from normal Simulation routines. */
test("actual SEED village resident can join the fixed legal five-road wet-bridge source route", () => {
  const originCode = "ADVISOR-0126-ALDERWICK/v5/TRANSPORT/NODE/PLACE/0/11/1/2",
    siteCode = "ADVISOR-0126-ALDERWICK/v5/TRANSPORT/NODE/SITE/ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/11/SITE/0",
    crossingCode = "ADVISOR-0126-ALDERWICK/macro-roads-v2/ROAD/J/0/11/1/1~J/0/11/1/3/BRIDGE/ADVISOR-0126-ALDERWICK-v5-DRAINAGE-0-69-MAIN-19",
    transport = siteTransportNetwork,
    origin = transport.nodes.find(node => node.code === originCode),
    place = villages.find(village => village.id === origin?.sourceId),
    ownedBridge = transportBridgeByCode(crossingCode);
  assert.ok(origin && place && ownedBridge, "fixed existing village/bridge source identities remain canonical");
  const edges = new Map(transport.roadEdges.map(edge => [edge.code, edge])),
    nodesByCode = new Map(transport.nodes.map(node => [node.code, node])),
    bridgeRoad = edges.get(ownedBridge!.roadCode),
    index = createTransportWalkingIndex(transport);
  assert.ok(bridgeRoad);
  const route = transportWalkingRouteViaRequiredEdge(index, originCode, siteCode, bridgeRoad!);
  assert.ok(route && route.edgeCodes.length === 5 && route.edgeCodes[3] === bridgeRoad!.code,
    "same independently proven five-road route must still lead to the actual critical site");

  const longitude = place!.canonicalPosition.lon,
    day = [1, 2, 3, 4, 5, 6, 7].find(d =>
      localWeekday(tickAtLocalTime(d, 12 * 3600, longitude), longitude) !== 6)!,
    attempts: string[] = [];
  let witness: ReturnType<typeof prepareResidentTransportJourneyWithApproach> = null,
    chosen: ReturnType<typeof residentAt> | undefined;
  // Bounded, fixed actor order: never create an actor at the requested node,
  // choose a different site, bypass a blocked gate, or search a population.
  for (const residentIndex of [1, 6, 7, 15]) {
    for (const hour of [10, 12, 16]) {
      const tick = tickAtLocalTime(day, hour * 3600, longitude),
        actor = residentAt(place!, residentIndex, tick);
      if (!actor.grounded || actor.indoors || actor.route.startsWith("BLOCKED:")) {
        attempts.push(`${residentIndex}@${hour}: normal routine not outdoor/grounded`);
        continue;
      }
      const approach = residentLocalTransportApproach(place!, actor, origin!);
      if (!approach) {
        attempts.push(`${residentIndex}@${hour}: no existing legal street-to-node path`);
        continue;
      }
      const decision = {
        acceptedByResident: true as const, residentCode: actor.code,
        fromNode: originCode, siteNode: siteCode, decidedTick: tick,
      };
      witness = prepareResidentTransportJourneyWithApproach(actor, decision, route!,
        edges, nodesByCode, index.adjacency, transport.bridges, approach,
        (from, to) => residentLocalTransportSegmentLegal(place!, from, to));
      if (!witness) {
        attempts.push(`${residentIndex}@${hour}: strict current final-surface proof refused`);
        continue;
      }
      chosen = actor;
      break;
    }
    if (witness) break;
  }
  assert.ok(witness && chosen,
    `no original scheduled SEED actor can lawfully join fixed gate→bridge→site route: ${attempts.join("; ")}`);
  assert.equal(witness!.residentCode, chosen!.code);
  assert.equal(witness!.edgeCodes.length, 5);
  assert.ok(witness!.macroStart);
  assert.ok(witness!.distanceM > 0);
  const atStart = residentTransportJourneyAt(witness!, witness!.departedTick),
    atEnd = residentTransportJourneyAt(witness!, witness!.departedTick + 30 * 86400);
  assert.ok(Math.abs(atStart.x - chosen!.x) < 1e-6);
  assert.equal(atEnd.status, "arrived",
    "projected site arrival must follow positive finite walking time, not a teleport");
  assert.ok(Math.abs(atEnd.x - nodesByCode.get(siteCode)!.x) < 1e-6);
  assert.ok(Math.abs(atEnd.z - nodesByCode.get(siteCode)!.z) < 1e-6);
  // A fresh reverse proof returns only to the exact canonical macro-road
  // origin; walking all the way back to the resident's home is still separate.
  const later = witness!.departedTick + 30 * 86400,
    returnDecision = { acceptedByResident: true as const, residentCode: chosen!.code,
      fromNode: siteCode, siteNode: originCode, decidedTick: later },
    reverse = prepareResidentTransportReturnJourney(
      { ...chosen!, x: atEnd.x, z: atEnd.z }, returnDecision, witness!, originCode,
      edges, nodesByCode, index.adjacency, transport.bridges,
      undefined, undefined, (from,to) => residentLocalTransportSegmentLegal(place!, from, to));
  assert.ok(reverse, "current physical source must independently validate the opposite crossing and town street");
  assert.deepEqual(reverse!.edgeCodes, [...route!.edgeCodes].reverse());
  assert.ok(Math.abs(reverse!.stations.at(-1)!.x - chosen!.x) < 1e-6);
  assert.ok(Math.abs(reverse!.stations.at(-1)!.z - chosen!.z) < 1e-6,
    "real SEED resident returns along valid gate street to the actual departure, not an invented home door");
  // A valid reversed graph alone is not a returning resident. Project the
  // SAME original SEED actor at the real MAIN-19 deck using fantasy seconds,
  // then check the physical top under the moving feet on both sides of that tick.
  const bridgeStation = reverse!.stations.reduce((best, point, i) =>
    Math.hypot(point.x - ownedBridge!.x, point.z - ownedBridge!.z) <
      Math.hypot(reverse!.stations[best].x - ownedBridge!.x, reverse!.stations[best].z - ownedBridge!.z)
      ? i : best, 0);
  const bridgeDistance = reverse!.cumulativeMetres[bridgeStation];
  let beforeTick = later, afterTick = later + 30 * 86400;
  while (beforeTick < afterTick) {
    const middle = Math.floor((beforeTick + afterTick) / 2);
    if (residentTransportJourneyAt(reverse!, middle).distanceM < bridgeDistance)
      beforeTick = middle + 1;
    else afterTick = middle;
  }
  const returning = residentTransportJourneyAt(reverse!, beforeTick),
    previous = residentTransportJourneyAt(reverse!, beforeTick - 1),
    following = residentTransportJourneyAt(reverse!, beforeTick + 1),
    deck = finalSurfaceAt(returning.x, returning.z),
    physicalStep = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      greatCircleDistance(sourceToLonLat(a.x, a.z), sourceToLonLat(b.x, b.z));
  assert.equal(returning.residentCode, chosen!.code,
    "reverse crossing stays with the original actor, not a recreated bridge marker");
  assert.ok(physicalStep(returning, ownedBridge!) < ownedBridge!.spanM / 2,
    "actual reverse footsteps reach the SAME recorded bridge, not a nearby road");
  assert.equal(deck.water.kind, "river", "reverse crossing must physically pass over wet water");
  assert.equal(deck.traversal, "bridge");
  assert.equal(deck.surfaceHeight, deck.deckHeight,
    "returning actor stands on the real composed bridge top");
  assert.ok(deck.walkable && deck.deckOwnerIds.includes(bridgeRoad!.code),
    "wet crossing is owned by the identical lawful SEED bridge road");
  for (const [a, b] of [[previous, returning], [returning, following]]) {
    assert.ok(b.distanceM >= a.distanceM &&
      physicalStep(a, b) <= b.distanceM - a.distanceM + .1,
      "one fantasy second cannot teleport the same actor across a missing bank");
  }
  const returned = residentTransportJourneyAt(reverse!, later + 30 * 86400);
  assert.equal(returned.status, "arrived", "return actually finishes on the original street");
  assert.equal(returned.residentCode, chosen!.code);
  assert.ok(physicalStep(returned, chosen!) < .01,
    "full reverse travel ends at the original real resident's departure feet");
});
