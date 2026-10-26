import type { Resident } from "./simulation.ts";
import { TIME_SCALE } from "./clock.ts";
import { sourceToLonLat, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt } from "./world-core.ts";
import type { TransportBridge, TransportNode, TransportRoadEdge } from "./transport-network.ts";
import {
  prepareResidentTransportJourneyWithApproach,
  residentTransportJourneyAt,
  type ResidentTravelDecision,
  type ValidatedResidentJourney,
} from "./resident-transport-journey.ts";

/** A self-directed choice from this SEED character's current personality,
 * mood and ordinary free-time activity. Route previews and Advisor requests
 * cannot set acceptedByResident: only this decision may start an event.
 * No random rolls, population-wide sampling, or UI-dependent authority. */
export function residentChoosesSiteVisit(
  actor: Pick<Resident, "code" | "grounded" | "indoors" | "route" | "activity" | "mood" | "traits">,
  fromNode: string, siteNode: string, tick: number,
): ResidentTravelDecision | null {
  if (!actor.code || !fromNode || !siteNode || fromNode === siteNode ||
      !Number.isSafeInteger(tick) || tick < 0 ||
      !actor.grounded || actor.indoors || actor.route.startsWith("BLOCKED:") ||
      !["stroll", "errand", "socialise"].includes(actor.activity)) return null;
  const personality = actor.traits.personality;
  if (![personality.curiosity, personality.sociability, actor.mood.value].every(Number.isFinite) ||
      actor.mood.value < -.3 ||
      personality.curiosity * .7 + personality.sociability * .3 < .55) return null;
  return Object.freeze({
    residentCode: actor.code, fromNode, siteNode, decidedTick: tick,
    acceptedByResident: true as const,
  });
}

type Source = Readonly<{ x: number; z: number }>;
type Edge = Pick<TransportRoadEdge, "code" | "from" | "to" | "centerline" | "bridgeCodes">;
type Node = Pick<TransportNode, "x" | "z">;
type Corridor = Readonly<{ from: string; to: string; edgeCodes: readonly string[] }>;
export type ResidentSiteVisitEvent = Readonly<{
  kind: "resident-site-visit";
  residentCode: string;
  decidedTick: number;
  fromNode: string;
  siteNode: string;
  journey: ValidatedResidentJourney;
}>;

/** Only an actual post-arrival character can choose to head for their owned
 * doorway. The Advisor cannot make a resident depart through this predicate. */
export function residentChoosesHomeReturn(
  actor: Pick<Resident, "grounded" | "traits" | "mood">,
) {
  const { diligence, curiosity } = actor.traits.personality;
  return actor.grounded && [diligence, curiosity, actor.mood.value].every(Number.isFinite) &&
    actor.mood.value >= -.65 && diligence * .65 + (1 - curiosity) * .35 >= .28;
}
export type ResidentHomeReturnEvent = Readonly<{
  residentCode: string;
  decidedTick: number;
  journey: ValidatedResidentJourney;
}>;
export type SavedResidentVisit = Readonly<{
  residentCode: string;
  decidedTick: number;
  from: string;
  to: string;
  edgeCodes: readonly string[];
  homeReturnTick?: number;
}>;



/**
 * Read-only projection of a previously Simulation-validated event onto its
 * ORIGINAL SEED resident. This must replace that actor's routine snapshot,
 * never be appended as a second character or accepted from a route preview.
 * The journey's own cumulative physical stations remain the only movement
 * authority; if more than 32 path corners lie in a render window, omit
 * animation rather than draw a shortcut through unverified ground.
 */
export function projectResidentSiteVisit(
  resident: Resident,
  event: ResidentSiteVisitEvent,
  tick: number,
  elevationAt: (x: number, z: number) => number =
    (x, z) => finalSurfaceAt(x, z).surfaceHeight,
): Resident {
  if (resident.code !== event.residentCode ||
      event.journey.residentCode !== resident.code ||
      event.decidedTick !== event.journey.departedTick ||
      !Number.isSafeInteger(tick) || tick < event.decidedTick) return resident;
  const step = residentTransportJourneyAt(event.journey, tick),
    elevation = elevationAt(step.x, step.z);
  if (!Number.isFinite(elevation)) return resident;
  const ahead = residentTransportJourneyAt(event.journey, tick + TIME_SCALE);
  let walkAhead: Source[] | undefined;
  if (step.status === "walking" && ahead.distanceM > step.distanceM) {
    const cumulative = event.journey.cumulativeMetres,
      points = event.journey.stations;
    let low = 0, high = cumulative.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (cumulative[mid] <= step.distanceM) low = mid + 1;
      else high = mid;
    }
    const window: Source[] = [{ x: step.x, z: step.z }];
    for (let i = low; i < cumulative.length && cumulative[i] < ahead.distanceM; i++) {
      if (window.length > 32) break;
      window.push(points[i]);
    }
    if (window.length <= 32) {
      window.push({ x: ahead.x, z: ahead.z });
      walkAhead = window;
    }
  }
  const resting = step.status === "resting", arrived = step.status === "arrived";
  return {
    ...resident, x: step.x, z: step.z,
    position: { ...sourceToLonLat(step.x, step.z), elevation },
    grounded: true, indoors: false,
    route: arrived ? `ARRIVED: ${event.siteNode}` : `SITE VISIT: ${event.siteNode}`,
    task: arrived ? "Arrived at verified site" :
      resting ? "Resting during verified journey" : "Travelling on verified SEED roads",
    activity: arrived ? "stroll" : resting ? "rest" : "commute",
    activityProgress: step.progress,
    travelProgress: step.progress, travelDistanceM: event.journey.distanceM,
    walkAhead,
  };
}

/** Simulation-owned event journal for one on-demand, independently decided
 * site departure. The resolver must use the original Simulation residentAt
 * for the supplied absolute Fantasy tick. Failed decision, local gate, owned
 * deck, full source route, or grade never enter history.
 *
 * This is event *preparation* authority, NOT persistence/render integration.
 * Worker and main views must share its event projection before real travel
 * can be presented. The bounded one-event-per-actor rule refuses overwritten
 * journeys instead of silently teleporting an existing actor. */
export class ResidentSiteVisitJournal {
  private readonly visits = new Map<string, ResidentSiteVisitEvent>();
  private readonly returns = new Map<string, ResidentHomeReturnEvent>();
  private readonly resolveResident: (code: string, tick: number) => Resident | undefined;
  constructor(resolveResident: (code: string, tick: number) => Resident | undefined) {
    this.resolveResident = resolveResident;
  }

  tryStart(
    residentCode: string, tick: number, corridor: Corridor,
    roads: ReadonlyMap<string, Edge>,
    nodes: ReadonlyMap<string, Node>,
    adjacency: ReadonlyMap<string, readonly { edge: Edge }[]>,
    bridges: readonly Pick<TransportBridge, "roadCode">[],
    localApproach: (actor: Resident, gate: Node) => readonly Source[] | null,
    localSegmentLegal: (a: Source, b: Source) => boolean,
    surfaceAt?: Parameters<typeof prepareResidentTransportJourneyWithApproach>[9],
    slopeAt?: Parameters<typeof prepareResidentTransportJourneyWithApproach>[10],
  ): ResidentSiteVisitEvent | null {
    if (this.visits.size >= 16 || this.visits.has(residentCode) || !Number.isSafeInteger(tick) || tick < 0 ||
        !nodes.has(corridor.from) || !nodes.has(corridor.to)) return null;
    const actor = this.resolveResident(residentCode, tick);
    if (!actor || actor.code !== residentCode ||
        !Number.isFinite(actor.x) || !Number.isFinite(actor.z)) return null;
    const choice = residentChoosesSiteVisit(actor, corridor.from, corridor.to, tick);
    if (!choice) return null;
    const approach = localApproach(actor, nodes.get(corridor.from)!);
    if (!approach) return null;
    const journey = prepareResidentTransportJourneyWithApproach(
      actor, choice, corridor, roads, nodes, adjacency, bridges,
      approach, localSegmentLegal, surfaceAt, slopeAt,
    );
    if (!journey) return null;
    const event: ResidentSiteVisitEvent = Object.freeze({
      kind: "resident-site-visit", residentCode, decidedTick: tick,
      fromNode: corridor.from, siteNode: corridor.to, journey,
    });
    this.visits.set(residentCode, event);
    return event;
  }

  eventFor(residentCode: string) { return this.visits.get(residentCode); }
  returnFor(residentCode: string) { return this.returns.get(residentCode); }
  /** Append ONLY a Simulation-validated return after actual site arrival and
   * original SEED actor's independent homeward choice. Refuse duplicate events. */
  tryRecordHomeReturn(
    residentCode: string, tick: number, journey: ValidatedResidentJourney,
    ownedDoor: Source,
  ): ResidentHomeReturnEvent | null {
    const original = this.visits.get(residentCode);
    if (!original || this.returns.has(residentCode) ||
        !Number.isSafeInteger(tick) || tick <= original.decidedTick ||
        !Number.isFinite(ownedDoor.x) || !Number.isFinite(ownedDoor.z) ||
        journey.residentCode !== residentCode || journey.departedTick !== tick ||
        journey.siteNode !== original.fromNode ||
        residentTransportJourneyAt(original.journey, tick).status !== "arrived" ||
        !journey.stations.length ||
        Math.hypot(wrapSourceX(journey.stations[0].x -
          original.journey.stations[original.journey.stations.length - 1].x),
          journey.stations[0].z -
          original.journey.stations[original.journey.stations.length - 1].z) > .0001 ||
        Math.hypot(wrapSourceX(journey.stations[journey.stations.length - 1].x - ownedDoor.x),
          journey.stations[journey.stations.length - 1].z - ownedDoor.z) > .0001)
      return null;
    const actor = this.resolveResident(residentCode, tick);
    if (!actor || actor.code !== residentCode || !residentChoosesHomeReturn(actor))
      return null;
    const event = Object.freeze({ residentCode, decidedTick: tick, journey });
    this.returns.set(residentCode, event);
    return event;
  }

  /** Persist only canonical identities, timestamps and original road codes.
   * Never accept serialized x/z path samples, height, acceptedByResident,
   * character position or arrival as trusted Simulation data. */
  savedVisits(): SavedResidentVisit[] {
    return [...this.visits.values()].map(event => Object.freeze({
      residentCode: event.residentCode,
      decidedTick: event.decidedTick,
      from: event.fromNode, to: event.siteNode,
      edgeCodes: Object.freeze([...event.journey.edgeCodes]),
      ...(this.returns.has(event.residentCode)
        ? { homeReturnTick: this.returns.get(event.residentCode)!.decidedTick } : {}),
    }));
  }

  /** Never invent a second actor: overlay by exact original identity only. */
  project(resident: Resident, tick: number, elevationAt?: (x: number, z: number) => number) {
    const event = this.visits.get(resident.code), home = this.returns.get(resident.code);
    if (!event) return resident;
    if (home && tick >= home.decidedTick) {
      const projected = projectResidentSiteVisit(resident, {
        ...event, decidedTick: home.decidedTick, siteNode: event.fromNode,
        journey: home.journey,
      }, tick, elevationAt);
      const arrived = residentTransportJourneyAt(home.journey, tick).status === "arrived";
      return { ...projected,
        route: arrived ? "HOME: owned doorway reached" : "HOME RETURN: verified streets",
        task: arrived ? "Returned to owned home door" : "Returning home on verified roads",
      };
    }
    return projectResidentSiteVisit(resident, event, tick, elevationAt);
  }

  /**
   * Worker population remains a bounded SEED routine snapshot. Main Simulation
   * overlays only its OWN previously-accepted events by original code and
   * physical projected location. A visitor leaving their home is removed from
   * the home view; near the site the SAME identity takes a visible slot even
   * if the worker's routine spatial index could not discover them there.
   *
   * At most sixteen prepared journeys may be held in this temporary in-memory
   * journal; each read examines those only once per resident snapshot (never
   * a frame), does not write worker state, and refuses oversized/new events.
   */
  visible(
    residents: Resident[], tick: number,
    view: Readonly<{ x: number; z: number; radius: number; limit: number }>,
  ): Resident[] {
    const limit = Math.max(0, Math.floor(view.limit));
    if (!Number.isFinite(limit) || !limit) return [];
    if (!this.visits.size || !Number.isSafeInteger(tick) || tick < 0 ||
        ![view.x, view.z, view.radius].every(Number.isFinite) || view.radius < 0)
      return residents.slice(0, limit);
    const inView = (actor: Resident) =>
      Math.hypot(wrapSourceX(actor.x - view.x), actor.z - view.z) <= view.radius;
    const routine = residents.flatMap(actor => {
      const projected = this.project(actor, tick);
      // Workers may still include the traveller near their original house.
      // Refuse that stale routine location rather than double-spawning them.
      return this.visits.has(actor.code) && tick >= this.visits.get(actor.code)!.decidedTick &&
        !inView(projected) ? [] : [projected];
    });
    const travelling: Resident[] = [];
    for (const event of this.visits.values()) {
      if (tick < event.decidedTick) continue;
      const original = this.resolveResident(event.residentCode, tick);
      if (!original || original.code !== event.residentCode) continue;
      const projected = this.project(original, tick);
      if (projected.grounded && !projected.indoors && inView(projected))
        travelling.push(projected);
    }
    // Deterministic accepted-event priority, with one single instance per code.
    // Worker routine residents keep their existing order and quota otherwise.
    const used = new Set(travelling.map(actor => actor.code));
    return [...travelling, ...routine.filter(actor => !used.has(actor.code))].slice(0, limit);
  }

  at(residentCode: string, tick: number) {
    const event = this.visits.get(residentCode), home = this.returns.get(residentCode);
    return Number.isSafeInteger(tick) && tick >= 0
      ? home && tick >= home.decidedTick
        ? residentTransportJourneyAt(home.journey, tick)
        : event ? residentTransportJourneyAt(event.journey, tick) : undefined
      : undefined;
  }
  get count() { return this.visits.size; }
}
