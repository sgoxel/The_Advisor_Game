import type { Resident } from "./simulation.ts";
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
  at(residentCode: string, tick: number) {
    const event = this.visits.get(residentCode);
    return event && Number.isSafeInteger(tick) && tick >= 0
      ? residentTransportJourneyAt(event.journey, tick) : undefined;
  }
  get count() { return this.visits.size; }
}
