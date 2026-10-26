import type { Resident } from "./simulation.ts";
import { TIME_SCALE } from "./clock.ts";
import { sourceToLonLat } from "./planet.ts";
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
    if (this.visits.has(residentCode) || !Number.isSafeInteger(tick) || tick < 0 ||
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
  /** Never invent a second actor: overlay by exact original identity only. */
  project(resident: Resident, tick: number, elevationAt?: (x: number, z: number) => number) {
    const event = this.visits.get(resident.code);
    return event ? projectResidentSiteVisit(resident, event, tick, elevationAt) : resident;
  }
  at(residentCode: string, tick: number) {
    const event = this.visits.get(residentCode);
    return event && Number.isSafeInteger(tick) && tick >= 0
      ? residentTransportJourneyAt(event.journey, tick) : undefined;
  }
  get count() { return this.visits.size; }
}
