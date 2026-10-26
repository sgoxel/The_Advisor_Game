import "./transport-inspector.css";
import { continuityCorridor } from "./geography.ts";
import {
  ensureTransportBridgeEvidence,
  transportBridgeByCode,
  transportGenerationTelemetry,
  type TransportBorderCrossing,
  type TransportBridge,
  type TransportFerryEdge,
  type TransportHarbor,
  type TransportJunction,
  type TransportRoadEdge,
} from "./transport-network.ts";
import { siteTransportAcceptanceSummary as transportAcceptanceSummary, siteTransportNetwork as transportNetwork, siteTransportRoadsNear as transportRoadsNear } from "./site-transport-network.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT, greatCircleDistance, sourceToLonLat } from "./planet.ts";
import { ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT, ROUTE_CORRIDOR_LEG_LIMIT, ROUTE_CORRIDOR_STATION_LIMIT, corridorStationEvidenceProgress, corridorUnsafeRoadExclusion, planTransportRouteCorridorByLeg, sampledCorridorStationFailure, transportProbeFrameBudgetReached } from "./transport-route-corridor.ts";
import { polylineTouchesViewport } from "./transport-viewport.ts";
import { sampledBridgeCrossingPass, transportBridgeSpanAt, transportBridgeSurfaceAt } from "./transport-bridge-surface.ts";
import { createTransportJunctionLookup } from "./transport-junction-index.ts";
import { createTransportWalkingIndex, selectedWalkingPreviewOrigin, selectedBridgePreviewDestinationBank, transportWalkingRequiredBridgeCut, transportWalkingRoute, transportWalkingDetourAfterUnsafeRoad, transportWalkingRouteThroughEdge, transportWalkingRouteToNearest, visibleWalkingPreviewEdgeCodes } from "./transport-walking-route.ts";
import { siteAccessBranchOnRoute, siteAccessParentRoadCode, siteAccessRoadStations, siteAccessSampleVerdict } from "./transport-site-access.ts";
import { finalSurfaceAt, finalSurfaceLocalSlopeAt } from "./world-core.ts";
import { createSiteRouteTimings } from "./transport-answer-timings.ts";

type AdvisorWorld = {
  setHalfHeight(height: number): void;
  setBridgeInspectionAngle(enabled: boolean): void;
  state: {
    presentation: string;
    scaleLabel: string;
    view: { x: number; z: number; halfHeight: number; aspect: number; yaw: number };
  };
  navigation: {
    setFocus(lon: number, lat: number): void;
    projectGround(x: number, z: number): { x: number; y: number };
  };
};

type Selection =
  | { kind: "road"; code: string }
  | { kind: "bridge"; code: string }
  | { kind: "border"; code: string }
  | { kind: "junction"; code: string }
  | { kind: "harbor"; code: string }
  | { kind: "ferry"; code: string }
  | { kind: "lake-detour"; code: string };

// Record the exact resolution-scale context, not a later camera state.
type FirstAnswerContext = Readonly<{
  scaleLabel: string;
  presentation: string;
  viewportWidth: number;
  viewportHeight: number;
}>;
function firstAnswerContext(state: AdvisorWorld["state"]): FirstAnswerContext {
  return Object.freeze({ scaleLabel: state.scaleLabel, presentation: state.presentation,
    viewportWidth: innerWidth, viewportHeight: innerHeight });
}
function firstAnswerContextText(context: FirstAnswerContext | null) {
  return context ? ` · ${context.scaleLabel} ${context.presentation} ${context.viewportWidth}×${context.viewportHeight}` : "";
}

type CachedQuery = Readonly<{
  edges: readonly TransportRoadEdge[];
  queryMs: number;
}>;

const SVG_NS = "http://www.w3.org/2000/svg";
const ROAD_SCALE_LIMIT = 100;
const QUERY_CACHE_LIMIT = 12;
const QUERY_EDGE_LIMIT = 96;
const BRIDGE_DETAIL_CACHE_LIMIT = 12;
const bridgeDetailCache = new Map<string, string>();
const queryCache = new Map<string, CachedQuery>();
const junctionsForRoadCodes = createTransportJunctionLookup(transportNetwork.junctions);
const transportNodesByCode = new Map(transportNetwork.nodes.map((node) => [node.code, node]));
// Cache stable SEED-owned critical-site targets only when a route is requested.
// Country and continent must both match; route choice remains graph-owned.
let siteTargetsByContinent: Map<number, Map<string, string[]>> | undefined;
function siteTargetsFor(continent: number, countryCode: string): readonly string[] {
  if (!siteTargetsByContinent) {
    const index = new Map<number, Map<string, string[]>>();
    for (const node of transportNetwork.nodes) {
      if (node.kind !== "site") continue;
      let countries = index.get(node.continent);
      if (!countries) { countries = new Map(); index.set(node.continent, countries); }
      let targets = countries.get(node.countryCode);
      if (!targets) { targets = []; countries.set(node.countryCode, targets); }
      targets.push(node.code);
    }
    siteTargetsByContinent = index;
  }
  return siteTargetsByContinent.get(continent)?.get(countryCode) ?? [];
}
let walkingIndex: ReturnType<typeof createTransportWalkingIndex> | undefined;
let queryCount = 0;
let queryCacheHits = 0;
let selection: Selection | undefined;
let lastFingerprint = "";
let lastQueryMs = 0;
let lastLocalRoads = 0;
let lastOverlayRoads = 0;
let lastOverlayBridges = 0;
let lastRoadInspectionMs: number | null = null;
let lastRoadInspectionStatus = "not requested";
let lastRoadAnswerContext: FirstAnswerContext | null = null;
// A nearest-road click before runtime readiness gets one retry, not an idle search.
let pendingNearestRoadOnWorld = false;
let roadRequestedAt: number | null = null;
let lastSiteRouteMs: number | null = null;
// One-shot time through a display opportunity, separate from graph computation.
let lastSiteRouteFrameMs: number | null = null;
let siteRouteFrameRevision = 0;
let lastSiteRouteStatus = "not requested";
let lastSiteRouteAnswerContext: FirstAnswerContext | null = null;
const siteRouteTimings = createSiteRouteTimings();
let siteRoute: ReturnType<typeof transportWalkingRouteToNearest> = null;
// A route requested before the world runtime exists is retried exactly once on readiness.
let pendingSiteRouteOnWorld = false;
let siteRouteRequestedAt: number | null = null;
let siteProbe: ReturnType<typeof siteAccessSampleVerdict> | null = null;
let siteProbeStatus = "not requested";
let siteProbeMs: number | null = null;
let siteProbeRevision = 0;
let corridorProbeRevision = 0;
let corridorProbeStatus = "not requested";
let corridorProbeMs: number | null = null;
let corridorProbeStations = 0;
let corridorProbePlannedStations = 0;
let corridorProbeFirstUnsafeRoad: string | null = null;
let corridorProbeFirstUnsafeStation: number | null = null;
let corridorProbeFirstUnsafeCause: string | null = null;
let corridorProbeFirstUnsafeIntervalGrade: number | null = null;
let corridorProbeFirstUnsafeSource: Readonly<{ x: number; z: number }> | null = null;
let corridorProbeFirstUnsafeLocalGrade: number | null = null;
let corridorProbeMaximumGrade: number | null = null;
// A failed physical probe may offer a different SEED graph hypothesis.
// This is never a validated walking route or a new selected map path.
let corridorGraphDetour: ReturnType<typeof transportWalkingRoute> = null;
let corridorGraphDetourPending = false;
let corridorSelectedBridgeConstraint: "selected-bridge-unsafe" | "graph-cut" | "not-proven" | null = null;
const corridorEdges = new Map(transportNetwork.roadEdges.map(edge => [edge.code, edge]));

function compareCanonical(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const overlay = document.createElementNS(SVG_NS, "svg");
overlay.id = "transport-overlay";
overlay.classList.add("transport-overlay");
overlay.setAttribute("aria-hidden", "true");
document.body.append(overlay);

const panel = document.createElement("aside");
panel.id = "transport-panel";
panel.className = "panel transport-panel";
panel.hidden = true;
panel.innerHTML = `
  <div class="transport-heading">
    <div>
      <div class="eyebrow">TRANSPORT NETWORK</div>
      <h2>Canonical connections</h2>
    </div>
    <button type="button" id="transport-close" aria-label="Close transport network inspector">×</button>
  </div>
  <p class="hint">Map inspection only · roads are walking links; sea links are explicitly separate ferry edges.</p>
  <div class="transport-summary" id="transport-summary"></div>
  <div class="transport-actions">
    <button type="button" id="transport-nearest">Inspect nearest road</button>
    <button type="button" id="transport-site-route">Preview shortest road to reachable site</button>
    <button type="button" id="transport-site-access" disabled>Probe selected site's physical approach</button>
    <button type="button" id="transport-route-corridor" disabled>Probe walking route surface</button>
    <button type="button" id="transport-focus-unsafe" hidden>Show first unsafe station on map</button>
    <button type="button" id="transport-focus">Focus selection</button>
    <button type="button" id="transport-bridge-closeup" hidden>Inspect bridge from low 3D angle</button>
    <button type="button" id="transport-bridge-clearview" hidden>View bridge without inspector</button>
  </div>
  <div class="divider"></div>
  <!-- Put the requested first route answer before verbose SEED selection
       details; both regions retain all canonical facts and live semantics. -->
  <section id="transport-site-answer" aria-live="polite"></section>
  <section id="transport-selection" aria-live="polite"></section>
  <section id="transport-site-surface" aria-live="polite"></section>
  <section id="transport-corridor-result" aria-live="polite"></section>
  <div class="divider"></div>
  <div class="transport-metrics" id="transport-metrics"></div>
`;
document.body.append(panel);

const resumeButton = document.createElement("button");
resumeButton.id = "transport-resume";
resumeButton.type = "button";
resumeButton.className = "transport-resume";
resumeButton.textContent = "Return to transport inspector";
resumeButton.setAttribute("aria-controls", "transport-panel");
resumeButton.hidden = true;
document.body.append(resumeButton);

const openButton = document.createElement("button");
openButton.id = "open-transport";
openButton.type = "button";
openButton.textContent = "Inspect transport network →";
openButton.setAttribute("aria-controls", "transport-panel");
openButton.setAttribute("aria-expanded", "false");
openButton.className = "transport-open-button";

function world(): AdvisorWorld | undefined {
  return (window as unknown as { advisorWorld?: AdvisorWorld }).advisorWorld;
}

function scaleDenominator(value?: string) {
  const parsed = Number((value ?? "").replace("1/", ""));
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function selectedRoadCodes() {
  if (!selection) return new Set<string>();
  if (selection.kind === "road") return new Set([selection.code]);
  if (selection.kind === "bridge") {
    const bridge = transportBridgeByCode(selection.code);
    return new Set(bridge ? [bridge.roadCode] : []);
  }
  if (selection.kind === "border") {
    const crossing = transportNetwork.borderCrossings.find((candidate) => candidate.code === selection!.code);
    return new Set(crossing ? [crossing.roadCode] : []);
  }
  if (selection.kind === "junction") {
    const junction = transportNetwork.junctions.find((candidate) => candidate.code === selection!.code);
    return new Set(junction?.edgeCodes ?? []);
  }
  if (selection.kind === "harbor") {
    const harbor = transportNetwork.harbors.find((candidate) => candidate.code === selection!.code);
    return new Set(harbor ? [harbor.roadCode] : []);
  }
  return new Set<string>();
}

function projectSource(x: number, z: number) {
  return world()!.navigation.projectGround(x, z);
}

function inViewport(point: { x: number; y: number }, margin = 40) {
  return point.x >= -margin && point.x <= innerWidth + margin && point.y >= -margin && point.y <= innerHeight + margin;
}

function roadQuery(state: AdvisorWorld["state"]): CachedQuery {
  const radius = Math.min(16_384, Math.max(128, state.view.halfHeight * Math.hypot(1, state.view.aspect) * 1.4));
  const key = [state.view.x.toFixed(3), state.view.z.toFixed(3), radius.toFixed(2)].join("/");
  const cached = queryCache.get(key);
  if (cached) {
    queryCacheHits++;
    lastQueryMs = cached.queryMs;
    return cached;
  }
  const started = performance.now();
  const edges = transportRoadsNear(state.view.x, state.view.z, radius, QUERY_EDGE_LIMIT);
  const result = Object.freeze({ edges, queryMs: performance.now() - started });
  queryCount++;
  lastQueryMs = result.queryMs;
  queryCache.set(key, result);
  if (queryCache.size > QUERY_CACHE_LIMIT) queryCache.delete(queryCache.keys().next().value!);
  return result;
}

function pathFor(edge: TransportRoadEdge, state: AdvisorWorld["state"]) {
  const points = edge.centerline.map((point) => projectSource(point.x, point.z));
  if (!polylineTouchesViewport(points, innerWidth, innerHeight)) return undefined;
  return `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`;
}

function appendRoad(edge: TransportRoadEdge, state: AdvisorWorld["state"], selected: ReadonlySet<string>, preview = false, unsafeSampledRoad = false) {
  const d = pathFor(edge, state);
  if (!d) return false;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.classList.add("transport-road", `transport-road-${edge.roadClass}`);
  if (selected.has(edge.code)) path.classList.add("selected");
  if (preview) path.classList.add("route-preview");
  // Only the exact road with a rejected physical station gets unsafe color.
  if (preview && unsafeSampledRoad) path.classList.add("unsafe-physical-sample");
  path.dataset.transportCode = edge.code;
  overlay.append(path);
  return true;
}

function appendMarker(kind: "bridge" | "border" | "junction" | "harbor" | "unsafe", x: number, z: number, state: AdvisorWorld["state"], code: string, active: boolean) {
  const point = projectSource(x, z);
  if (!inViewport(point, 24)) return false;
  const marker = document.createElementNS(SVG_NS, kind === "harbor" ? "rect" : "circle");
  if (kind === "harbor") {
    marker.setAttribute("x", String(point.x - 4));
    marker.setAttribute("y", String(point.y - 4));
    marker.setAttribute("width", "8");
    marker.setAttribute("height", "8");
    marker.setAttribute("transform", `rotate(45 ${point.x} ${point.y})`);
  } else {
    marker.setAttribute("cx", String(point.x));
    marker.setAttribute("cy", String(point.y));
    marker.setAttribute("r", kind === "unsafe" ? "7" : kind === "junction" ? "4" : kind === "border" ? "4.5" : "3.5");
  }
  marker.classList.add("transport-marker", `transport-marker-${kind}`);
  if (active) marker.classList.add("selected");
  marker.dataset.transportCode = code;
  overlay.append(marker);
  return true;
}

function selectedEntityPosition() {
  if (!selection) return undefined;
  if (selection.kind === "road") {
    const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === selection!.code);
    return edge?.centerline[Math.floor(edge.centerline.length / 2)]?.position;
  }
  if (selection.kind === "bridge") return transportBridgeByCode(selection.code)?.position;
  if (selection.kind === "border") return transportNetwork.borderCrossings.find((candidate) => candidate.code === selection!.code)?.position;
  if (selection.kind === "junction") return transportNetwork.junctions.find((candidate) => candidate.code === selection!.code)?.position;
  if (selection.kind === "harbor") return transportNetwork.harbors.find((candidate) => candidate.code === selection!.code)?.position;
  if (selection.kind === "ferry") {
    const ferry = transportNetwork.ferryEdges.find((candidate) => candidate.code === selection!.code);
    return transportNetwork.harbors.find((candidate) => candidate.code === ferry?.fromHarborCode)?.position;
  }
  return continuityCorridor.road?.centerline?.[Math.floor((continuityCorridor.road.centerline?.length ?? 1) / 2)]?.position;
}

function setScale(denominator: number) {
  const select = document.querySelector<HTMLSelectElement>("#map-scale");
  if (!select) return;
  select.value = String(denominator);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function focusSelection() {
  const position = selectedEntityPosition(), runtime = world();
  if (!position || !runtime) return;
  runtime.navigation.setFocus(position.lon, position.lat);
  if (selection?.kind !== "ferry") setScale(100);
}

function focusFirstUnsafeStation() {
  const point = corridorProbeFirstUnsafeSource, runtime = world();
  // Never navigate to an old/stale failed route or invent a physical waypoint.
  if (!point || !siteRoute || !runtime || ![point.x, point.z].every(Number.isFinite)) return false;
  const position = sourceToLonLat(point.x, point.z);
  runtime.setBridgeInspectionAngle(false);
  runtime.navigation.setFocus(position.lon, position.lat);
  // Ordinary route overlay is visible only at 1/100 and closer.
  if (scaleDenominator(runtime.state.scaleLabel) > ROAD_SCALE_LIMIT) setScale(100);
  refreshOverlay(true);
  return true;
}

function codeText(code: string) {
  const node = document.createElement("code");
  node.textContent = code;
  return node.outerHTML;
}

function roadDetails(edge: TransportRoadEdge) {
  const elevations = edge.centerline.map((point) => point.elevationM),
    min = Math.min(...elevations), max = Math.max(...elevations);
  return `
    <div class="transport-kind walking">WALKING · ${edge.roadClass.toUpperCase()} ROAD</div>
    <h3>${codeText(edge.code)}</h3>
    <dl>
      <dt>Endpoints</dt><dd>${codeText(edge.from)} → ${codeText(edge.to)}</dd>
      <dt>Road-segment distance</dt><dd>${(edge.surfaceLengthM / 1000).toFixed(2)} km</dd>
      <dt>Estimated segment walking time</dt><dd>${(edge.fantasyWalkSeconds / 3600).toFixed(1)} fantasy hours · preview, not travel</dd>
      <dt>Countries</dt><dd>${edge.countryCodes.map(codeText).join(" · ")}</dd>
      <dt>Macro alignment</dt><dd>${edge.centerline.length} stations · ${min.toFixed(1)}–${max.toFixed(1)} m relief</dd>
      <dt>Terrain score</dt><dd>${Math.round(edge.terrainCost).toLocaleString()}</dd>
      <dt>Crossings</dt><dd>${edge.bridgeCodes.length} materialized bridge${edge.bridgeCodes.length === 1 ? "" : "s"}${edge.borderCrossingCode ? " · 1 political border" : ""}</dd>
    </dl>`;
}

function bridgeDetails(bridge: TransportBridge) {
  // Campaign-SEED bridge geometry and final-surface queries are camera/LOD
  // independent. Reopening an unchanged bridge must not resample ~70 points.
  const cached = bridgeDetailCache.get(bridge.code);
  if (cached !== undefined) return cached;
  const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === bridge.roadCode)!;
  // Selection-only final-surface query: a recorded river intersection does not
  // by itself establish a constructed, walkable deck in Simulation.
  const surface = transportBridgeSurfaceAt(bridge.x, bridge.z, edge.code);
  const span = transportBridgeSpanAt(bridge, edge);
  // A walkable centre point cannot certify both dry banks, road alignment or safe grade.
  // Keep this verdict explicitly sample-limited: whole-route traversal is not proven.
  const sampledCrossingPass = sampledBridgeCrossingPass(surface.centerDeckWalkable, span);
  const details = `
    <div class="transport-kind ${sampledCrossingPass ? "walking" : "transfer"}">${sampledCrossingPass ? "SAMPLED CROSSING · WALKABLE & GRADE PASS" : "CROSSING ACCESS · NOT CERTIFIED"}</div>
    <h3>${codeText(bridge.code)}</h3>
    <dl>
      <dt>Road</dt><dd>${codeText(bridge.roadCode)}</dd>
      <dt>Natural drainage</dt><dd>${codeText(bridge.drainageCode)}</dd>
      <dt>Span</dt><dd>${bridge.spanM.toFixed(1)} m</dd>
      <dt>Connection</dt><dd>${codeText(edge.from)} → ${codeText(edge.to)}</dd>
      <dt>Final-surface deck at crossing</dt><dd>${surface.centerDeckWalkable ? "Selected-road-owned walkable bridge surface" : "Selected road deck not certified"}</dd>
      <dt>Sampled river span</dt><dd>${span.matchingCrossing ? span.deckStationsWalkable ? `${span.wetStations} selected-road wet deck stations walkable` : "Missing selected-road-owned walkable deck at one or more wet stations" : "Cannot match recorded crossing to final river span"}</dd>
      <dt>Sampled bank approaches</dt><dd>${span.matchingCrossing ? span.bankStationsWalkable ? "Both nearby dry-bank samples walkable" : "One or both nearby bank samples not walkable" : "Not validated"}</dd>
      <dt>Approach road alignment</dt><dd>${span.matchingCrossing ? span.approachStationsOnRoad ? "All sampled stations within 2 m of the canonical road" : "One or both recorded road bank approaches are too short — not certified" : "Not validated"}</dd>
      <dt>Approach continuity probe</dt><dd>${span.matchingCrossing ? `${span.approachStations} stations (2–18 m each bank): ${span.approachStationsWalkable ? "on-road and walkable" : "off-road, obstructed or wet"}` : "Not validated"}</dd>
      <dt>Sampled approach grade</dt><dd>${span.matchingCrossing && span.approachMaxSampledGrade !== null ? `${(span.approachMaxSampledGrade * 100).toFixed(1)}% sampled maximum · ${!span.approachStationsOnRoad ? "off-road samples, grade not certified" : span.approachGradeWithinLimit ? "within 8% sample limit" : "exceeds 8% sample limit"}` : "Not validated"}</dd>
      <dt>Final-surface road ownership</dt><dd>${span.matchingCrossing ? span.routeStationsSurfaceOwned ? "Selected canonical road contributes at every sampled station" : "Selected road modifier absent at one or more stations — not certified" : "Not validated"}</dd>
      <dt>Sampled crossing route</dt><dd>${span.matchingCrossing ? `${span.routeStations} bounded stations spanning both 18 m approaches · ${span.routeStationsOnRoad ? "on canonical road" : "road alignment fails"} · ${span.routeStationsWalkable ? "walkable at all stations" : "physical road ownership or walkability not certified"}` : "Not validated"}</dd>
      <dt>Sampled crossing grade</dt><dd>${span.matchingCrossing && span.routeMaxSampledGrade !== null ? `${(span.routeMaxSampledGrade * 100).toFixed(1)}% maximum · ${span.routeGradeWithinLimit ? "sampled route passes 8% interval limit" : "not certified (alignment, walking or interval grade)"}` : "Not validated"}</dd>
      <dt>First unsafe sampled crossing interval</dt><dd>${!span.matchingCrossing || !span.routeStationsOnRoad ? "Not validated" :
        span.routeFirstUnsafeIntervalStation === null ? "No sampled interval exceeds 8%; unsampled passage not certified" :
        `Interval ending at station ${span.routeFirstUnsafeIntervalStation}: ${Number.isFinite(span.routeFirstUnsafeIntervalGrade) ? `${(span.routeFirstUnsafeIntervalGrade! * 100).toFixed(1)}%` : "invalid"} grade · above 8%; not certified`}</dd>
      <dt>Local final-surface legality</dt><dd>${span.matchingCrossing ? `${span.routeStationsTopLegal ? "Selected road owns legal top surface at all route stations" : `Route station ${span.routeFirstUnsafeStation ?? "unknown"}: ${span.routeFirstUnsafeCause ?? "alignment unverified"}`} · ${span.approachStationsTopLegal ? "both banks legally owned" : `${span.approachFirstUnsafeBank ?? "bank alignment"}: ${span.approachFirstUnsafeCause ?? "not certified"}`}` : "Not validated"}</dd>
      <dt>First unsafe local grade</dt><dd>${span.matchingCrossing ? [
        span.routeFirstUnsafeLocalGrade === null ? "" : `route station ${span.routeFirstUnsafeStation}: ${(span.routeFirstUnsafeLocalGrade * 100).toFixed(1)}% canonical local ground slope`,
        span.approachFirstUnsafeLocalGrade === null ? "" : `${span.approachFirstUnsafeBank}: ${(span.approachFirstUnsafeLocalGrade * 100).toFixed(1)}% canonical local ground slope`,
      ].filter(Boolean).join(" · ") || "No local difficult-slope failure measured" : "Not validated"} · distinct from sampled span averages</dd>
      <dt>Traversal scope</dt><dd>Bounded selected-crossing samples only · continuous full-route access not certified · map preview, not travel</dd>
    </dl>`;
  bridgeDetailCache.set(bridge.code, details);
  if (bridgeDetailCache.size > BRIDGE_DETAIL_CACHE_LIMIT)
    bridgeDetailCache.delete(bridgeDetailCache.keys().next().value!);
  return details;
}

function borderDetails(crossing: TransportBorderCrossing) {
  const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === crossing.roadCode)!;
  return `
    <div class="transport-kind walking">GRAPH CONNECTION · POLITICAL BORDER</div>
    <h3>${codeText(crossing.code)}</h3>
    <dl>
      <dt>Main road</dt><dd>${codeText(crossing.roadCode)}</dd>
      <dt>Countries</dt><dd>${crossing.countries.map(codeText).join(" ↔ ")}</dd>
      <dt>Road endpoints</dt><dd>${codeText(edge.from)} → ${codeText(edge.to)}</dd>
      <dt>Graph crossing</dt><dd>Recorded land-road connection · uninterrupted final-surface passage not certified · preview, not travel</dd>
    </dl>`;
}

function junctionDetails(junction: TransportJunction) {
  return `
    <div class="transport-kind walking">GRAPH CONNECTION · SHARED JUNCTION</div>
    <h3>${codeText(junction.code)}</h3>
    <dl>
      <dt>Canonical node</dt><dd>${codeText(junction.nodeCode)}</dd>
      <dt>Connected roads</dt><dd>${junction.edgeCodes.length}</dd>
      <dt>Graph-connected roads</dt><dd>${junction.edgeCodes.map(codeText).join("<br>")}</dd>
      <dt>Physical traversal</dt><dd>Shared SEED node · continuous final-surface passage requires separate validation · preview, not travel</dd>
    </dl>`;
}

function harborDetails(harbor: TransportHarbor) {
  const ferries = transportNetwork.ferryEdges.filter((edge) => edge.fromHarborCode === harbor.code || edge.toHarborCode === harbor.code);
  return `
    <div class="transport-kind transfer">TRANSFER · ROAD-LINKED HARBOR</div>
    <h3>${codeText(harbor.code)}</h3>
    <dl>
      <dt>Country</dt><dd>${codeText(harbor.countryCode)}</dd>
      <dt>Walking approach</dt><dd>${codeText(harbor.roadCode)}</dd>
      <dt>Sea links</dt><dd>${ferries.length ? ferries.map((edge) => `<span class="sea-label">SEA / FERRY</span> ${codeText(edge.code)}`).join("<br>") : "None"}</dd>
    </dl>`;
}

function ferryDetails(ferry: TransportFerryEdge) {
  return `
    <div class="transport-kind sea">SEA / FERRY · NOT A WALKING ROAD</div>
    <h3>${codeText(ferry.code)}</h3>
    <dl>
      <dt>From harbor</dt><dd>${codeText(ferry.fromHarborCode)}</dd>
      <dt>To harbor</dt><dd>${codeText(ferry.toHarborCode)}</dd>
      <dt>Geodesic distance</dt><dd>${(ferry.distanceM / 1000).toFixed(1)} km</dd>
      <dt>Traversal type</dt><dd>Maritime transfer</dd>
    </dl>`;
}

function lakeDetourDetails() {
  const road = continuityCorridor.road;
  if (!road) return `<p>No canonical lake-detour evidence road is available.</p>`;
  return `
    <div class="transport-kind walking">WALKING · LAKE DETOUR</div>
    <h3>${codeText(road.code)}</h3>
    <dl>
      <dt>Canonical endpoints</dt><dd>${codeText(road.from)} → ${codeText(road.to)}</dd>
      <dt>Coarse stations</dt><dd>${road.centerline?.length ?? 2}</dd>
      <dt>Surface length</dt><dd>${(road.surfaceLengthM / 1000).toFixed(1)} km</dd>
      <dt>Evidence status</dt><dd>${continuityCorridor.evidence.status}</dd>
    </dl>`;
}

function renderSelection() {
  const target = panel.querySelector<HTMLElement>("#transport-selection")!;
  panel.querySelector<HTMLButtonElement>("#transport-bridge-closeup")!.hidden = selection?.kind !== "bridge";
  panel.querySelector<HTMLButtonElement>("#transport-bridge-clearview")!.hidden = selection?.kind !== "bridge";
  if (!selection) {
    target.innerHTML = `<p class="hint">Select a nearby road, or use an evidence target from the diagnostic interface.</p>`;
    return;
  }
  if (selection.kind === "road") {
    const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = edge ? roadDetails(edge) : `<p>Road not found.</p>`;
  } else if (selection.kind === "bridge") {
    const bridge = transportBridgeByCode(selection.code);
    target.innerHTML = bridge ? bridgeDetails(bridge) : `<p>Bridge not found.</p>`;
  } else if (selection.kind === "border") {
    const crossing = transportNetwork.borderCrossings.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = crossing ? borderDetails(crossing) : `<p>Border crossing not found.</p>`;
  } else if (selection.kind === "junction") {
    const junction = transportNetwork.junctions.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = junction ? junctionDetails(junction) : `<p>Junction not found.</p>`;
  } else if (selection.kind === "harbor") {
    const harbor = transportNetwork.harbors.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = harbor ? harborDetails(harbor) : `<p>Harbor not found.</p>`;
  } else if (selection.kind === "ferry") {
    const ferry = transportNetwork.ferryEdges.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = ferry ? ferryDetails(ferry) : `<p>Ferry not found.</p>`;
  } else target.innerHTML = lakeDetourDetails();
}

function renderSiteRoute() {
  const target = panel.querySelector<HTMLElement>("#transport-site-answer")!;
  if (!siteRoute) {
    target.textContent = lastSiteRouteStatus === "not requested" ? "" :
      `Walking graph preview: ${lastSiteRouteStatus}. No physical traversal certified.`;
    return;
  }
  // First-answer facts and the physical-certification boundary precede long
  // immutable SEED IDs. On 1920×1080 the inspector scrolls; essential graph
  // distance/time and NOT TRAVEL must be visible before any scrolling.
  target.innerHTML = `<div class="eyebrow">CANONICAL WALKING GRAPH PREVIEW · NOT TRAVEL</div>
    <dl>
      <dt>Measured graph distance</dt><dd>${(siteRoute.distanceM / 1000).toFixed(2)} km</dd>
      <dt>Estimated good-road time</dt><dd>${(siteRoute.fantasyWalkSeconds / 3600).toFixed(2)} fantasy hours</dd>
      <dt>Physical passage</dt><dd>NOT CERTIFIED · road grades, river banks and character movement require separate validation</dd>
      <dt>Selected crossing constraint</dt><dd>${selection?.kind === "bridge" ? "Route starts by traversing the chosen bridge-owned road; no ferry or edge retracing" : "Unconstrained shortest road route"}</dd>
      <dt>Canonical walking edges</dt><dd>${siteRoute.edgeCodes.length} · no ferry segments</dd>
      <dt>Map preview</dt><dd>Visible route segments highlighted in teal at 1/100 and closer · distant segments appear as you pan · no guaranteed physical passage</dd>
      <dt>Evidence limit</dt><dd>Graph route only · individual physical road grades and bank-to-bank crossings not fully certified · character has not moved</dd>
    </dl>
    <details class="transport-route-provenance">
      <summary>View exact SEED origin and site IDs</summary>
      <dl>
        <dt>From road endpoint</dt><dd>${codeText(siteRoute.from)}</dd>
        <dt>Reachable site by graph</dt><dd>${codeText(siteRoute.to)}</dd>
      </dl>
    </details>`;
}

function renderSiteAccessProbe() {
  const target = panel.querySelector<HTMLElement>("#transport-site-surface")!;
  if (!siteProbe) {
    target.textContent = siteProbeStatus === "not requested" ? "" :
      `Physical site approach: ${siteProbeStatus}. No whole-route traversal certified.`;
    return;
  }
  const grade = siteProbe.maximumGrade === null ? "not measured" :
    Number.isFinite(siteProbe.maximumGrade) ? `${(siteProbe.maximumGrade * 100).toFixed(1)}%` : "invalid";
  target.innerHTML = `<div class="eyebrow">FINAL-SURFACE SITE APPROACH · ${siteProbe.sampledPass
    ? siteProbe.terminalGeometryOnly ? "SAMPLED PROFILE OK · TERMINAL OWNER UNVERIFIED" : "SAMPLED PASS"
    : "NOT CERTIFIED"}</div>
    <dl>
      <dt>Recorded road</dt><dd>${siteProbe.onRecordedRoad ? "Source-owned branch and/or exact parent junction geometry" : "Missing canonical branch/junction evidence"}</dd>
      <dt>Terminal surface evidence</dt><dd>${siteProbe.terminalGeometryOnly ? "SEED parent geometry joins; incident final-surface road owner unverified" : "No geometry-only terminal fallback"}</dd>
      <dt>Samples</dt><dd>${siteProbe.stationCount}/${siteProbe.expectedStations} · each profile span's ends and midpoint</dd>
      <dt>Ground/deck passage</dt><dd>${siteProbe.supportedWater && siteProbe.walkable ? siteProbe.dry ? "Sampled stations dry and walkable" : "Sampled dry ground / river-deck stations walkable; deck ownership checked separately" : "One or more samples have unsupported water, blocked ground/deck or missing evidence"}</dd>
      <dt>Top bridge ownership</dt><dd>${siteProbe.topSurfaceOwned ? "No unrelated top deck at sampled stations" : "Top deck or traversal mismatch; not certified"}</dd>
      <dt>Sampled span max grade</dt><dd>${grade} · ${siteProbe.gradeWithinLimit ? "spans and local road slopes within limit" : "span or local surface grade not certified"}</dd>
      <dt>First unsafe station</dt><dd>${siteProbe.firstUnsafeCause
        ? `${siteProbe.firstUnsafeStation === null ? "Profile" : `Station ${siteProbe.firstUnsafeStation}`}: ${siteProbe.firstUnsafeCause}`
        : "No failed sampled gate; gaps between samples remain unverified"}</dd>
      <dt>Evidence boundary</dt><dd>Selected site's own access branch only · unsampled gaps, rest of graph route and character movement not certified</dd>
    </dl>`;
}

function renderCorridorProbe() {
  // A sampled failure is actionable only while its exact SEED route is selected.
  panel.querySelector<HTMLButtonElement>("#transport-focus-unsafe")!.hidden =
    corridorProbeFirstUnsafeSource === null || !siteRoute;
  const target = panel.querySelector<HTMLElement>("#transport-corridor-result")!;
  const route = siteRoute ? `${siteRoute.from} → ${siteRoute.to} (${siteRoute.edgeCodes.length} canonical roads)` : "no selected walking route";
  const progress = corridorStationEvidenceProgress(
    corridorProbeStations, corridorProbePlannedStations, corridorProbeFirstUnsafeStation);
  const source = corridorProbeFirstUnsafeSource
    ? ` · unsafe source x ${corridorProbeFirstUnsafeSource.x.toFixed(5)}, z ${corridorProbeFirstUnsafeSource.z.toFixed(5)}` : "";
  const localGrade = corridorProbeFirstUnsafeLocalGrade === null ? "" :
    ` · first unsafe canonical local slope ${Number.isFinite(corridorProbeFirstUnsafeLocalGrade) ? `${(corridorProbeFirstUnsafeLocalGrade * 100).toFixed(1)}%` : "invalid"}`;
  const intervalGrade = corridorProbeFirstUnsafeIntervalGrade === null ? "" :
    ` · first unsafe sampled interval grade ${Number.isFinite(corridorProbeFirstUnsafeIntervalGrade) ? `${(corridorProbeFirstUnsafeIntervalGrade * 100).toFixed(1)}%` : "invalid"}`;
  const detour = corridorProbeFirstUnsafeRoad && corridorSelectedBridgeConstraint !== "selected-bridge-unsafe"
    ? corridorGraphDetourPending ? " · Checking an alternative SEED graph path; physical passage not certified"
    : corridorGraphDetour
      ? ` · Alternative SEED graph preview excluding that road: ${corridorGraphDetour.edgeCodes.length} roads, ${(corridorGraphDetour.distanceM / 1000).toFixed(2)} km, ${(corridorGraphDetour.fantasyWalkSeconds / 3600).toFixed(2)} estimated fantasy hours (graph only)${selection?.kind === "bridge" ? corridorGraphDetour.edgeCodes.includes(transportBridgeByCode(selection.code)?.roadCode ?? "") ? " · selected bridge retained" : " · selected bridge bypassed" : ""}; grades and physical passage NOT certified`
      : selection?.kind === "bridge"
        ? " · No non-retracing selected-bridge graph candidate found within 12 roads / 4096 states with that unsafe road excluded; physical passage NOT certified"
        : " · No same-endpoint walking graph detour exists with that road excluded; physical passage NOT certified"
    : "";
  const bridgeConstraint = corridorSelectedBridgeConstraint === "selected-bridge-unsafe"
    ? " · The selected bridge road itself failed physical sampling; excluding it cannot preserve this crossing"
    : corridorSelectedBridgeConstraint === "graph-cut"
      ? " · Selected bridge GRAPH CUT: with the unsafe road excluded, no same-endpoint graph path can use this bridge"
      : corridorSelectedBridgeConstraint === "not-proven"
        ? " · Selected bridge connectivity is not ruled out by the graph cut, but no alternative crossing is certified"
        : "";
  if (corridorProbeStatus === "not requested") {
    target.textContent = siteRoute
      ? "Selected-route physical access: PENDING — final-surface road and bridge passage not yet probed. Graph distance and Fantasy-Time are a preview, not certified traversal; use Probe walking route surface for bounded samples. Character has not moved."
      : lastSiteRouteStatus === "not requested" ? ""
      : lastSiteRouteStatus === "world authority pending"
        ? "Selected-route physical access: PENDING — world authority has not loaded; no graph or physical passage certified. Character has not moved."
        : "Selected-route physical access: UNAVAILABLE — no canonical walking route selected. No traversal or character movement certified.";
    return;
  }
  const detailedEvidence =
    `Selected-route final-surface diagnostic · ${route}: ${corridorProbeStatus === "checking final surface in bounded frame batches" ? "PENDING — " : ""}${corridorProbeStatus}. ${progress}${corridorProbeFirstUnsafeRoad ? ` · first unsafe road ${corridorProbeFirstUnsafeRoad}` : ""}${corridorProbeFirstUnsafeCause ? ` · cause ${corridorProbeFirstUnsafeCause}` : ""}${source}${localGrade}${intervalGrade}${corridorProbeMaximumGrade === null ? "" : ` · sampled maximum grade ${Number.isFinite(corridorProbeMaximumGrade) ? `${(corridorProbeMaximumGrade * 100).toFixed(1)}%` : "invalid"}`}${corridorProbeMs === null ? "" : ` · ${corridorProbeMs.toFixed(2)} ms elapsed`}${detour}${bridgeConstraint}. Map preview only; no uninterrupted passage or character travel certified.`;
  const pending = corridorProbeStatus === "checking final surface in bounded frame batches";
  const fullSampled = corridorProbeStatus.startsWith("sampled centerline passes at every planned station");
  const shortVerdict = corridorProbeFirstUnsafeCause
    ? `NOT TRAVERSABLE · Station ${corridorProbeFirstUnsafeStation ?? "?"}/${corridorProbePlannedStations}: ${corridorProbeFirstUnsafeCause}`
    : pending ? `CHECKING · ${corridorProbeStations}/${corridorProbePlannedStations} stations sampled; not certified`
    : fullSampled ? `SAMPLED CENTERLINE PASS · ${corridorProbeStations}/${corridorProbePlannedStations}; between-station and character passage unverified`
    : "NOT CERTIFIED · Selected route has incomplete or invalid physical evidence";
  const verdict = document.createElement("p");
  verdict.className = "transport-route-verdict";
  verdict.textContent = `${shortVerdict}. Graph preview only; character has not moved.`;
  const details = document.createElement("details");
  details.className = "transport-route-provenance";
  const summary = document.createElement("summary");
  summary.textContent = "View exact SEED roads, grades and detour evidence";
  const evidence = document.createElement("p");
  evidence.className = "transport-route-evidence";
  evidence.textContent = detailedEvidence;
  details.append(summary, evidence);
  target.replaceChildren(verdict, details);
}

function resetCorridorProbe() {
  corridorProbeRevision++;
  corridorProbeStatus = "not requested";
  corridorProbeMs = null;
  corridorProbeStations = 0;
  corridorProbePlannedStations = 0;
  corridorProbeFirstUnsafeRoad = null;
  corridorProbeFirstUnsafeStation = null;
  corridorProbeFirstUnsafeCause = null;
  corridorProbeFirstUnsafeIntervalGrade = null;
  corridorProbeFirstUnsafeSource = null;
  corridorProbeFirstUnsafeLocalGrade = null;
  corridorProbeMaximumGrade = null;
  corridorGraphDetour = null;
  corridorGraphDetourPending = false;
  corridorSelectedBridgeConstraint = null;
  // Reset any stale physical-warning overlay when the selected route resets.
  lastFingerprint = "";
  panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = !siteRoute;
  renderCorridorProbe();
}

function probeRouteCorridor() {
  if (!siteRoute) return;
  const started = performance.now();
  const plan = planTransportRouteCorridorByLeg(siteRoute, corridorEdges, transportNodesByCode, walkingIndex?.adjacency),
    revision = ++corridorProbeRevision;
  corridorProbeMs = null;
  corridorProbeStations = 0;
  corridorProbePlannedStations = plan.status === "ready" ? plan.stations.length : 0;
  corridorProbeFirstUnsafeRoad = null;
  corridorProbeFirstUnsafeStation = null;
  corridorProbeFirstUnsafeCause = null;
  corridorProbeFirstUnsafeIntervalGrade = null;
  corridorProbeFirstUnsafeSource = null;
  corridorProbeFirstUnsafeLocalGrade = null;
  corridorProbeMaximumGrade = null;
  corridorGraphDetour = null;
  corridorGraphDetourPending = false;
  corridorSelectedBridgeConstraint = null;
  if (plan.status !== "ready") {
    corridorProbeStatus = plan.status === "over-budget"
      ? plan.reason === "raw-source-waypoints"
        ? `raw source waypoint limit (${ROUTE_CORRIDOR_STATION_LIMIT * 2}) reached at ${plan.edgeCode}; not certified`
        : plan.reason === "route-legs"
          ? `on-demand route limit (${ROUTE_CORRIDOR_LEG_LIMIT} canonical roads) reached at ${plan.edgeCode}; not certified`
          : plan.reason === "route-stations"
            ? `complete-route station limit (${ROUTE_CORRIDOR_EXTENDED_STATION_LIMIT}) reached at ${plan.edgeCode}; not certified`
            : `per-road sampled station limit (${ROUTE_CORRIDOR_STATION_LIMIT}) reached at ${plan.edgeCode}; not certified`
      : plan.reason === "repeated-road"
        ? `repeated canonical road ${plan.edgeCode}; non-retracing physical passage not certified`
        : plan.reason === "repeated-node"
          ? `revisited canonical graph node on road ${plan.edgeCode}; non-retracing physical passage not certified`
        : plan.reason === "source-chain"
          ? `source road ${plan.edgeCode} has invalid endpoint, graph incidence or destination; not certified`
          : "invalid source-owned physical path; not certified";
    corridorProbeMs = performance.now() - started;
    renderCorridorProbe();
    renderMetrics();
    return;
  }
  // Optional diagnostics share the main thread. Retire an unfinished site
  // probe before scheduling this corridor, retaining any completed evidence.
  if (siteProbeStatus === "checking final surface in bounded frame batches") {
    siteProbeRevision++;
    siteProbeStatus = "interrupted by walking-route probe; restart on demand";
    panel.querySelector<HTMLButtonElement>("#transport-site-access")!.disabled = false;
    renderSiteAccessProbe();
  }
  corridorProbeStatus = "checking final surface in bounded frame batches";
  panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = true;
  renderCorridorProbe();
  let previousHeight: number | null = null;
  const step = () => {
    if (revision !== corridorProbeRevision) return;
    const frameStarted = performance.now(), previousProgress = corridorProbeStations;
    for (let i = 0; i < 8 && corridorProbeStations < plan.stations.length; i++) {
      const index = corridorProbeStations, station = plan.stations[index],
        surface = finalSurfaceAt(station.x, station.z);
      // "open" can remain walkable at 8–15% slope; the selected road
      // corridor still requires the stricter canonical 8% road limit.
      const localRoadSlope = surface.deckHeight === null && surface.traversal === "open" && surface.walkable
        ? finalSurfaceLocalSlopeAt(station.x, station.z) : undefined;
      const failure = sampledCorridorStationFailure(station, surface, localRoadSlope);
      if (failure !== null) {
        corridorProbeFirstUnsafeRoad = corridorUnsafeRoadExclusion(station);
        corridorProbeFirstUnsafeStation = index + 1;
        corridorProbeFirstUnsafeCause = failure;
        corridorProbeFirstUnsafeSource = Object.freeze({ x: station.x, z: station.z });
        // Only a failing on-demand station incurs this extra canonical gradient.
        if (failure === "unsafe local road slope")
          corridorProbeFirstUnsafeLocalGrade = localRoadSlope ?? finalSurfaceLocalSlopeAt(station.x, station.z);
        corridorProbeStatus = `station ${index + 1}: ${failure}${corridorProbeFirstUnsafeRoad ? "" : "; shared canonical node; no single road can be excluded for a detour"}; not certified`;
        break;
      }
      if (previousHeight !== null) {
        const previous = plan.stations[index - 1],
          metres = greatCircleDistance(sourceToLonLat(previous.x, previous.z), sourceToLonLat(station.x, station.z)),
          grade = metres > 0 ? Math.abs(surface.surfaceHeight - previousHeight) / metres : Infinity;
        corridorProbeMaximumGrade = Math.max(corridorProbeMaximumGrade ?? 0, grade);
        if (!Number.isFinite(grade) || grade > .08) {
          corridorProbeFirstUnsafeRoad = corridorUnsafeRoadExclusion(station);
          corridorProbeFirstUnsafeStation = index + 1;
          corridorProbeFirstUnsafeCause = Number.isFinite(grade)
            ? "sampled interval grade exceeds 8%" : "invalid sampled interval grade";
          corridorProbeFirstUnsafeIntervalGrade = grade;
          corridorProbeFirstUnsafeSource = Object.freeze({ x: station.x, z: station.z });
          corridorProbeStatus = `station ${index + 1}: ${corridorProbeFirstUnsafeCause}${corridorProbeFirstUnsafeRoad ? "" : "; shared canonical node; no single road can be excluded for a detour"}; not certified`;
          break;
        }
      }
      previousHeight = surface.surfaceHeight;
      corridorProbeStations++;
      // One complete station per frame minimum; expensive final-surface reads
      // yield before the next one instead of monopolizing a phone frame.
      if (transportProbeFrameBudgetReached(i + 1, performance.now() - frameStarted)) break;
    }
    if (corridorProbeStatus !== "checking final surface in bounded frame batches") {
      // The physical first failure is immediately visible. Never spend that
      // already-costly sampling frame on a graph search or a bridge-component
      // flood. These remain bounded, read-only, on-demand follow-up hypotheses.
      corridorProbeMs = performance.now() - started;
      panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = false;
      const route = siteRoute, unsafeRoad = corridorProbeFirstUnsafeRoad,
        bridgeCode = selection?.kind === "bridge" ? selection.code : null,
        index = walkingIndex;
      const selectedBridge = bridgeCode ? transportBridgeByCode(bridgeCode) : undefined;
      const bridgeRoad = selectedBridge && corridorEdges.get(selectedBridge.roadCode);
      // Once the exact chosen bridge road fails, an alternate path cannot
      // preserve it. Explain that decisive fact now, without a fake search.
      const selectedBridgeUnsafe = !!unsafeRoad && !!bridgeRoad && unsafeRoad === bridgeRoad.code;
      if (selectedBridgeUnsafe) corridorSelectedBridgeConstraint = "selected-bridge-unsafe";
      corridorGraphDetourPending = !!unsafeRoad && !!route && !!index && !selectedBridgeUnsafe;
      renderCorridorProbe();
      renderMetrics();
      // The probe completion is an on-demand event: reveal the actual failed
      // station pin immediately rather than waiting for a camera change.
      if (corridorProbeFirstUnsafeSource) refreshOverlay(true);
      if (unsafeRoad && route && index && !selectedBridgeUnsafe) requestAnimationFrame(() => {
        if (revision !== corridorProbeRevision) return;
        const excluded = new Set([unsafeRoad]);
        corridorGraphDetour = bridgeCode && !bridgeRoad ? null :
          transportWalkingDetourAfterUnsafeRoad(index, route.from, route.to, unsafeRoad, bridgeRoad);
        corridorGraphDetourPending = false;
        renderCorridorProbe();
        if (!bridgeCode) return;
        // A second animation frame prevents the selected-bridge component flood
        // from stacking with the alternate path search in a single phone frame.
        requestAnimationFrame(() => {
          if (revision !== corridorProbeRevision) return;
          if (!bridgeRoad) return;
          const cut = transportWalkingRequiredBridgeCut(
            index, route.from, route.to, bridgeRoad, excluded);
          corridorSelectedBridgeConstraint = cut.status === "invalid" ? null : cut.status;
          renderCorridorProbe();
        });
      });
    } else if (corridorProbeStations < plan.stations.length) {
      // Variable-size batches may jump across station 64 without landing on it.
      // Update at most once per frame when a 64-station milestone is crossed.
      if (Math.floor(corridorProbeStations / 64) > Math.floor(previousProgress / 64)) renderCorridorProbe();
      requestAnimationFrame(step);
    } else {
      corridorProbeStatus = "sampled centerline passes at every planned station; between-station and actor passage not certified";
      corridorProbeMs = performance.now() - started;
      panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = false;
      renderCorridorProbe();
      renderMetrics();
    }
  };
  requestAnimationFrame(step);
}

function resetSiteAccessProbe() {
  resetCorridorProbe();
  siteProbeRevision++;
  siteProbe = null;
  siteProbeStatus = "not requested";
  siteProbeMs = null;
  panel.querySelector<HTMLButtonElement>("#transport-site-access")!.disabled = !siteRoute;
  renderSiteAccessProbe();
}

function probeSiteAccess() {
  const route = siteRoute, branch = route && siteAccessBranchOnRoute(route, transportNetwork.roadEdges);
  if (!branch) {
    siteProbeStatus = "selected route does not end on its canonical site-access branch";
    renderSiteAccessProbe();
    return;
  }
  const stations = siteAccessRoadStations(branch);
  if (!stations.length) {
    siteProbeStatus = "physical access recipe exceeds bounded profile or is invalid";
    renderSiteAccessProbe();
    return;
  }
  // A selected site probe has priority over a still-running full corridor;
  // a stale frame returns by revision without doing further surface queries.
  if (corridorProbeStatus === "checking final surface in bounded frame batches") {
    corridorProbeRevision++;
    corridorProbeStatus = "interrupted by site-approach probe; restart on demand";
    panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = false;
    renderCorridorProbe();
  }
  const revision = ++siteProbeRevision, started = performance.now(),
    surfaces: ReturnType<typeof finalSurfaceAt>[] = [],
    localRoadSlopes: (number | null)[] = [];
  siteProbe = null;
  siteProbeStatus = "checking final surface in bounded frame batches";
  panel.querySelector<HTMLButtonElement>("#transport-site-access")!.disabled = true;
  renderSiteAccessProbe();
  const step = () => {
    if (revision !== siteProbeRevision) return;
    const frameStarted = performance.now(), firstStation = surfaces.length;
    const limit = Math.min(stations.length, firstStation + 4);
    while (surfaces.length < limit) {
      const point = stations[surfaces.length];
      const surface = finalSurfaceAt(point.x, point.z);
      surfaces.push(surface);
      // Only a user-requested bounded site probe pays for open-ground
      // gradients; ordinary finalSurfaceAt already flags >8% "road" grade.
      localRoadSlopes.push(surface.deckHeight === null && surface.traversal === "open" && surface.walkable
        ? finalSurfaceLocalSlopeAt(point.x, point.z) : null);
      if (transportProbeFrameBudgetReached(surfaces.length - firstStation,
        performance.now() - frameStarted)) break;
    }
    if (surfaces.length < stations.length) requestAnimationFrame(step);
    else {
      const parentCode = siteAccessParentRoadCode(branch);
      // An ordinary macro link may also have roadClass "access". Include
      // every canonical incident edge; the verifier accepts an alternate
      // top-surface owner only if it resolves to a registered physical road
      // whose centerline actually reaches this exact SEED junction.
      const junctionRoadCodes = new Set((walkingIndex?.adjacency.get(branch.to) ?? [])
        .map(step => step.edge.code));
      if (parentCode && !junctionRoadCodes.has(parentCode)) junctionRoadCodes.clear();
      siteProbe = siteAccessSampleVerdict(branch, surfaces, junctionRoadCodes, localRoadSlopes);
      siteProbeStatus = !siteProbe.sampledPass ? "sampled physical approach not certified"
        : siteProbe.terminalGeometryOnly ? "sampled profile pass; terminal surface road owner unverified"
        : "sampled physical approach pass";
      siteProbeMs = performance.now() - started;
      panel.querySelector<HTMLButtonElement>("#transport-site-access")!.disabled = false;
      renderSiteAccessProbe();
      renderMetrics();
    }
  };
  requestAnimationFrame(step);
}

function chooseNearestSiteRoute() {
  // A newer route request supersedes a pending first-road selection.
  if (pendingNearestRoadOnWorld) lastRoadInspectionStatus = "canceled by site-route request before world readiness";
  pendingNearestRoadOnWorld = false;
  roadRequestedAt = null;
  const started = siteRouteRequestedAt ?? performance.now(), runtime = world(),
    frameRevision = ++siteRouteFrameRevision;
  lastSiteRouteFrameMs = null;
  siteRoute = null;
  // The SEED graph is authoritative without a graphics device. An explicitly
  // selected road/bridge/Y has its own canonical focus even during WebGPU
  // initialization/failure; only a map-focus search needs renderer view state.
  const waitingForMapFocus = !runtime && !selection;
  pendingSiteRouteOnWorld = waitingForMapFocus;
  if (waitingForMapFocus) lastSiteRouteStatus = "world authority pending";
  else {
    const selectedFocus = runtime
      ? sourceToLonLat(runtime.state.view.x, runtime.state.view.z)
      : selectedEntityPosition();
    // A chosen Y/harbor is an exact graph node, and a chosen road/crossing
    // starts from its own endpoint. Only no-selection uses the nearest road.
    const fallback = !selection && runtime ? roadQuery(runtime.state).edges[0] : undefined;
    const selectedBridge = selection?.kind === "bridge"
      ? transportBridgeByCode(selection.code) : undefined;
    const from = selectedFocus && selectedWalkingPreviewOrigin(
      selection, selectedFocus,
      transportNetwork, transportNodesByCode, fallback, selectedBridge,
    );
    const selectedBridgeRoad = selectedBridge
      ? transportNetwork.roadEdges.find(edge => edge.code === selectedBridge.roadCode)
      : undefined;
    const siteTargetBank = selection?.kind === "bridge"
      ? from && selectedBridgeRoad
        ? selectedBridgePreviewDestinationBank(from, selectedBridgeRoad, transportNodesByCode)
        : undefined
      : from;
    const sites = siteTargetBank
      ? siteTargetsFor(siteTargetBank.continent, siteTargetBank.countryCode) : [];
    if (!from) lastSiteRouteStatus = selection?.kind === "ferry"
      ? "selected ferry is maritime, not a walking origin; select a harbor or road"
      : selection ? "selected item has no canonical walking origin"
      : "no canonical road near map focus";
    else if (!sites.length) lastSiteRouteStatus = selection?.kind === "bridge"
      ? "no critical site on the selected bridge's far bank"
      : "no same-country critical site endpoint";
    else {
      walkingIndex ??= createTransportWalkingIndex(transportNetwork);
      siteRoute = selection?.kind === "bridge"
        ? selectedBridgeRoad
          ? transportWalkingRouteThroughEdge(walkingIndex, from.code, selectedBridgeRoad, sites)
          : null
        : transportWalkingRouteToNearest(walkingIndex, from.code, sites);
      lastSiteRouteStatus = siteRoute ? "canonical walking graph preview ready"
        : selection?.kind === "bridge" ? "no walking route to a site through the selected bridge without retracing its road"
        : "no reachable same-country site by walking road";
    }
  }
  // SEED-selected graph facts are useful without a renderer. Only a route
  // depending on an unknown map focus remains pending until graphics is ready.
  lastSiteRouteMs = waitingForMapFocus ? null : performance.now() - started;
  lastSiteRouteAnswerContext = runtime ? firstAnswerContext(runtime.state) : null;
  const requestScale = runtime?.state.scaleLabel;
  const timingSample = !waitingForMapFocus && requestScale && lastSiteRouteMs !== null
    ? siteRouteTimings.record(requestScale, lastSiteRouteMs, siteRoute !== null) : null;
  if (!waitingForMapFocus) siteRouteRequestedAt = null;
  resetSiteAccessProbe();
  renderSiteRoute();
  renderMetrics();
  // The existing frame loop redraws the overlay once from the new SEED
  // route. Do not synchronously reproject up to 96 SVG roads during the
  // first-answer click; the answer DOM is authoritative immediately.
  lastFingerprint = "";
  if (!waitingForMapFocus) {
    // Two one-shot animation frames allow the new route DOM and SVG preview
    // a display opportunity. This is NOT a measured pixel-paint timestamp,
    // nor a 3D mesh-settling timer. Stale/cancelled views cannot win.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (frameRevision !== siteRouteFrameRevision || panel.hidden || !requestScale ||
          world()?.state.scaleLabel !== requestScale) return;
      lastSiteRouteFrameMs = performance.now() - started;
      siteRouteTimings.markFrame(timingSample, lastSiteRouteFrameMs, requestScale);
      renderMetrics();
    }));
  }
}

let lastSummaryMarkup = "";
let lastMetricsMarkup = "";
function renderSummary(state?: AdvisorWorld["state"]) {
  const summary = transportAcceptanceSummary();
  const markup = `
    <span><b>${summary.roads}</b> roads</span>
    <span><b>${summary.junctions}</b> junctions</span>
    <span><b>${summary.siteAccessBranches}</b> critical-site links</span>
    <span><b>${summary.bridges}</b> local bridge records</span>
    <span><b>${summary.harbors}</b> harbors</span>
    <span><b>${summary.ferries}</b> sea links</span>
    <span class="transport-scale-state ${state && scaleDenominator(state.scaleLabel) <= ROAD_SCALE_LIMIT ? "visible" : "hidden"}">
      Road layer ${state ? (scaleDenominator(state.scaleLabel) <= ROAD_SCALE_LIMIT ? "visible" : "hidden beyond 1/100") : "waiting"}
    </span>`;
  if (markup !== lastSummaryMarkup) {
    panel.querySelector<HTMLElement>("#transport-summary")!.innerHTML = markup;
    lastSummaryMarkup = markup;
  }
}

function renderMetrics() {
  const generation = transportGenerationTelemetry();
  const markup = `
    <div class="eyebrow">BOUNDED INSPECTION</div>
    <dl>
      <dt>Topology digest</dt><dd><code>${transportNetwork.digest}</code></dd>
      <dt>Domestic authority</dt><dd><code>${generation.domesticAuthority}</code> · ${generation.baseRoads} shared roads + ${generation.extensionRoads} S005 extensions + ${transportAcceptanceSummary().siteAccessBranches} canonical site branches</dd>
      <dt>Focus query</dt><dd>${lastQueryMs.toFixed(2)} ms · ${lastLocalRoads}/${QUERY_EDGE_LIMIT} records</dd>
      <dt>First road answer</dt><dd>${lastRoadInspectionStatus}${lastRoadInspectionMs === null ? "" : ` · ${lastRoadInspectionMs.toFixed(2)} ms`}${firstAnswerContextText(lastRoadAnswerContext)}</dd>
      <dt>Walking graph answer</dt><dd>${lastSiteRouteStatus}${lastSiteRouteMs === null ? "" : ` · ${lastSiteRouteMs.toFixed(2)} ms calculation`}${lastSiteRouteFrameMs === null ? "" : ` · ${lastSiteRouteFrameMs.toFixed(2)} ms display-frame opportunity`}${firstAnswerContextText(lastSiteRouteAnswerContext)}</dd>
      <dt>Physical site approach</dt><dd>${siteProbeStatus}${siteProbeMs === null ? "" : ` · ${siteProbeMs.toFixed(2)} ms`}</dd>
      <dt>Selected-route surface diagnostic</dt><dd>${corridorProbeStatus}${corridorProbeMs === null ? "" : ` · ${corridorProbeMs.toFixed(2)} ms`}</dd>
      <dt>Query/cache</dt><dd>${queryCount} searches · ${queryCacheHits} reuses · ${queryCache.size}/${QUERY_CACHE_LIMIT} cached</dd>
      <dt>Bridge detail</dt><dd>${generation.materializedBridges} records · ${generation.bridgeCacheRoads}/${generation.bridgeCacheLimit} road recipes cached · ${generation.bridgeCacheEvictions} evictions</dd>
      <dt>Visible overlay</dt><dd>${lastOverlayRoads} road paths · ${lastOverlayBridges} bridge markers</dd>
    </dl>`;
  if (markup !== lastMetricsMarkup) {
    panel.querySelector<HTMLElement>("#transport-metrics")!.innerHTML = markup;
    lastMetricsMarkup = markup;
  }
}

function openPanel() {
  panel.hidden = false;
  resumeButton.hidden = true;
  overlay.style.display = "";
  openButton.setAttribute("aria-expanded", "true");
  renderSelection();
  renderSiteRoute();
  renderSiteAccessProbe();
  renderSummary(world()?.state);
  renderMetrics();
}

function chooseNearestRoad() {
  siteRouteFrameRevision++;
  lastSiteRouteFrameMs = null;
  pendingSiteRouteOnWorld = false;
  siteRouteRequestedAt = null;
  const started = roadRequestedAt ?? performance.now(), runtime = world();
  pendingNearestRoadOnWorld = !runtime;
  siteRoute = null;
  lastSiteRouteStatus = "not requested";
  lastSiteRouteMs = null;
  lastSiteRouteAnswerContext = null;
  resetSiteAccessProbe();
  renderSiteRoute();
  if (!runtime) {
    selection = undefined;
    renderSelection(); // Clear bridge-only actions from the previous selection.
    lastRoadInspectionStatus = "world authority pending";
    panel.querySelector<HTMLElement>("#transport-selection")!.textContent = "World authority is still preparing. No road has been selected.";
  } else {
    const query = roadQuery(runtime.state);
    // transportRoadsNear ranks by canonical segment distance, not screen vertices.
    const edge = query.edges[0];
    selection = edge ? { kind: "road", code: edge.code } : undefined;
    if (edge) {
      renderSelection(); // Source distance/time facts are usable before optional mesh refinement.
      lastRoadInspectionStatus = "canonical segment facts ready";
    } else {
      renderSelection(); // No road: hide controls tied to a now-cleared bridge.
      panel.querySelector<HTMLElement>("#transport-selection")!.textContent = "No canonical walking road was found near this focus. Pan to a road-connected area and retry.";
      lastRoadInspectionStatus = "no nearby canonical road";
    }
  }
  // Include the actual user-observed readiness wait in first-answer time.
  lastRoadInspectionMs = runtime ? performance.now() - started : null;
  lastRoadAnswerContext = runtime ? firstAnswerContext(runtime.state) : null;
  if (runtime) roadRequestedAt = null;
  renderMetrics();
  lastFingerprint = "";
}

function appendLakeDetour(state: AdvisorWorld["state"]) {
  if (selection?.kind !== "lake-detour" || !continuityCorridor.road?.centerline) return false;
  const points = continuityCorridor.road.centerline.map((point) => projectSource(point.x, point.z));
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`);
  path.classList.add("transport-road", "transport-road-continuity", "selected");
  overlay.append(path);
  return true;
}

function refreshOverlay(force = false) {
  const runtime = world();
  if (!runtime) return;
  const { state } = runtime;
  const fingerprint = [state.presentation, state.scaleLabel, state.view.x.toFixed(4), state.view.z.toFixed(4), state.view.halfHeight.toFixed(4), state.view.yaw.toFixed(4), innerWidth, innerHeight, selection?.kind ?? "", selection?.code ?? ""].join("/");
  if (!force && fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  overlay.replaceChildren();
  const roadsVisible = state.presentation === "flat" && scaleDenominator(state.scaleLabel) <= ROAD_SCALE_LIMIT;
  overlay.classList.toggle("visible", roadsVisible);
  lastOverlayRoads = 0;
  lastOverlayBridges = 0;
  if (roadsVisible) {
    const query = roadQuery(state), selected = selectedRoadCodes(),
      preview = visibleWalkingPreviewEdgeCodes(siteRoute, query.edges);
    lastLocalRoads = query.edges.length;
    // Graph preview draws last so the real path cannot disappear below other road strokes.
    for (const edge of query.edges)
      if (!preview.has(edge.code) && appendRoad(edge, state, selected)) lastOverlayRoads++;
    for (const edge of query.edges)
      if (preview.has(edge.code) && appendRoad(edge, state, selected, true,
        corridorProbeFirstUnsafeSource !== null && corridorProbeFirstUnsafeRoad === edge.code)) lastOverlayRoads++;
    appendLakeDetour(state);
    const localCodes = new Set(query.edges.map((edge) => edge.code));
    for (const bridge of transportNetwork.bridges)
      if (localCodes.has(bridge.roadCode) && appendMarker("bridge", bridge.x, bridge.z, state, bridge.code, selection?.kind === "bridge" && selection.code === bridge.code)) lastOverlayBridges++;
    for (const crossing of transportNetwork.borderCrossings)
      if (localCodes.has(crossing.roadCode)) appendMarker("border", crossing.x, crossing.z, state, crossing.code, selection?.kind === "border" && selection.code === crossing.code);
    for (const junction of junctionsForRoadCodes(localCodes)) {
      const node = transportNodesByCode.get(junction.nodeCode);
      if (node) appendMarker("junction", node.x, node.z, state, junction.code, selection?.kind === "junction" && selection.code === junction.code);
    }
    for (const harbor of transportNetwork.harbors)
      if (localCodes.has(harbor.roadCode)) appendMarker("harbor", harbor.x, harbor.z, state, harbor.code, selection?.kind === "harbor" && selection.code === harbor.code);
    // A red pin denotes only the sampled first unsafe source coordinate,
    // never an invented destination or certified route. Always draw above roads.
    if (siteRoute && corridorProbeFirstUnsafeSource && corridorProbeFirstUnsafeStation !== null)
      appendMarker("unsafe", corridorProbeFirstUnsafeSource.x, corridorProbeFirstUnsafeSource.z,
        state, `unsafe station ${corridorProbeFirstUnsafeStation}`, true);
  } else lastLocalRoads = 0;
  if (!panel.hidden) {
    renderSummary(state);
    renderMetrics();
  }
}

function selectEvidence(kind: "bridge" | "border-crossing" | "lake-detour" | "mountain-pass" | "junction" | "harbor" | "ferry", bridgeCode?: string) {
  siteRouteFrameRevision++;
  lastSiteRouteFrameMs = null;
  // An explicit new selection cancels an older deferred first-road request.
  if (pendingNearestRoadOnWorld) lastRoadInspectionStatus = "canceled by evidence selection before world readiness";
  pendingNearestRoadOnWorld = false;
  roadRequestedAt = null;
  // A missing diagnostic target must not silently retain the previous one.
  pendingSiteRouteOnWorld = false;
  siteRouteRequestedAt = null;
  selection = undefined;
  if (kind === "bridge") {
    // Explicitly selected SEED bridge codes must not drift with nearby LRU
    // discoveries, viewport, renderer or capture ordering. Invalid codes fail
    // closed; diagnostic selection never invents a bridge or moves an actor.
    const bridge = bridgeCode === undefined ? ensureTransportBridgeEvidence() : transportBridgeByCode(bridgeCode);
    if (bridge) selection = { kind: "bridge", code: bridge.code };
  } else if (kind === "border-crossing") {
    const crossing = [...transportNetwork.borderCrossings]
      .filter((candidate) => transportNetwork.roadEdges.some((edge) => edge.code === candidate.roadCode && edge.roadClass === "main"))
      .sort((a, b) => compareCanonical(a.code, b.code))[0];
    if (crossing) selection = { kind: "border", code: crossing.code };
  } else if (kind === "lake-detour") {
    if (continuityCorridor.road) selection = { kind: "lake-detour", code: continuityCorridor.road.code };
  } else if (kind === "mountain-pass") {
    const edge = [...transportNetwork.roadEdges].sort((a, b) => b.maxNaturalReliefM - a.maxNaturalReliefM || compareCanonical(a.code, b.code))[0];
    if (edge) selection = { kind: "road", code: edge.code };
  } else if (kind === "junction") {
    const junction = [...transportNetwork.junctions].sort((a, b) => b.edgeCodes.length - a.edgeCodes.length || compareCanonical(a.code, b.code))[0];
    if (junction) selection = { kind: "junction", code: junction.code };
  } else if (kind === "harbor") {
    const harbor = [...transportNetwork.harbors].sort((a, b) => compareCanonical(a.code, b.code))[0];
    if (harbor) selection = { kind: "harbor", code: harbor.code };
  } else {
    const ferry = [...transportNetwork.ferryEdges].sort((a, b) => compareCanonical(a.code, b.code))[0];
    if (ferry) selection = { kind: "ferry", code: ferry.code };
  }
  siteRoute = null;
  lastSiteRouteStatus = "not requested";
  lastSiteRouteMs = null;
  lastSiteRouteAnswerContext = null;
  resetSiteAccessProbe();
  openPanel();
  if (!selection)
    panel.querySelector<HTMLElement>("#transport-selection")!.textContent = `Canonical ${kind.replace("-", " ")} evidence unavailable. No location selected.`;
  focusSelection();
  refreshOverlay(true);
  return selection;
}

function evidenceSummary() {
  const bridge = transportNetwork.bridges.slice().sort((a, b) => compareCanonical(a.code, b.code))[0],
    borderCrossing = [...transportNetwork.borderCrossings]
      .filter((candidate) => transportNetwork.roadEdges.some((edge) => edge.code === candidate.roadCode && edge.roadClass === "main"))
      .sort((a, b) => compareCanonical(a.code, b.code))[0],
    junction = [...transportNetwork.junctions].sort((a, b) => b.edgeCodes.length - a.edgeCodes.length || compareCanonical(a.code, b.code))[0],
    mountainPass = [...transportNetwork.roadEdges].sort((a, b) => b.maxNaturalReliefM - a.maxNaturalReliefM || compareCanonical(a.code, b.code))[0],
    harbor = [...transportNetwork.harbors].sort((a, b) => compareCanonical(a.code, b.code))[0],
    ferry = [...transportNetwork.ferryEdges].sort((a, b) => compareCanonical(a.code, b.code))[0];
  return Object.freeze({
    bridge: bridge?.code ?? null,
    borderCrossing: borderCrossing?.code ?? null,
    lakeDetour: continuityCorridor.road?.code ?? null,
    mountainPass: mountainPass?.code ?? null,
    junction: junction?.code ?? null,
    harbor: harbor?.code ?? null,
    ferry: ferry?.code ?? null,
  });
}

function telemetry() {
  return Object.freeze({
    digest: transportNetwork.digest,
    topology: transportAcceptanceSummary(),
    generation: transportGenerationTelemetry(),
    queryCount,
    queryCacheHits,
    queryCacheEntries: queryCache.size,
    queryCacheLimit: QUERY_CACHE_LIMIT,
    lastQueryMs,
    firstRoadInspectionMs: lastRoadInspectionMs,
    firstRoadInspectionStatus: lastRoadInspectionStatus,
    firstRoadInspectionContext: lastRoadAnswerContext,
    firstSiteRouteMs: lastSiteRouteMs,
    firstSiteRouteFrameMs: lastSiteRouteFrameMs,
    firstSiteRouteStatus: lastSiteRouteStatus,
    firstSiteRouteContext: lastSiteRouteAnswerContext,
    fourScaleSiteRouteTimings: siteRouteTimings.snapshot(),
    siteAccessProbeStatus: siteProbeStatus,
    siteAccessProbeStations: siteProbe?.stationCount ?? 0,
    siteAccessProbeMs: siteProbeMs,
    corridorProbeStatus,
    corridorProbeMs,
    corridorProbeStations,
    corridorProbePlannedStations,
    corridorProbeFirstUnsafeRoad,
    corridorSelectedBridgeConstraint,
    corridorProbeFirstUnsafeStation,
    corridorProbeFirstUnsafeCause,
    corridorProbeFirstUnsafeIntervalGrade,
    corridorProbeFirstUnsafeSource,
    corridorProbeFirstUnsafeLocalGrade,
    corridorProbeMaximumGrade,
    siteRouteEdges: siteRoute?.edgeCodes.length ?? 0,
    bridgeDetailCacheEntries: bridgeDetailCache.size,
    bridgeDetailCacheLimit: BRIDGE_DETAIL_CACHE_LIMIT,
    localRoads: lastLocalRoads,
    overlayRoads: lastOverlayRoads,
    overlayBridgeMarkers: lastOverlayBridges,
    roadScaleLimit: ROAD_SCALE_LIMIT,
    selection: selection ? { ...selection } : null,
  });
}

panel.querySelector<HTMLButtonElement>("#transport-close")!.onclick = () => {
  siteRouteFrameRevision++;
  if (pendingNearestRoadOnWorld) lastRoadInspectionStatus = "canceled when inspector closed before world readiness";
  if (pendingSiteRouteOnWorld) lastSiteRouteStatus = "canceled when inspector closed before world readiness";
  pendingNearestRoadOnWorld = false;
  roadRequestedAt = null;
  pendingSiteRouteOnWorld = false;
  siteRouteRequestedAt = null;
  // Hidden diagnostics must not keep sampling final surfaces on a phone.
  resetSiteAccessProbe();
  world()?.setBridgeInspectionAngle(false);
  panel.hidden = true;
  resumeButton.hidden = true;
  overlay.style.display = "";
  openButton.setAttribute("aria-expanded", "false");
};
panel.querySelector<HTMLButtonElement>("#transport-nearest")!.onclick = () => {
  roadRequestedAt = performance.now();
  chooseNearestRoad();
};
panel.querySelector<HTMLButtonElement>("#transport-site-route")!.onclick = () => {
  siteRouteRequestedAt = performance.now();
  chooseNearestSiteRoute();
};
panel.querySelector<HTMLButtonElement>("#transport-site-access")!.onclick = probeSiteAccess;
panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.onclick = probeRouteCorridor;
panel.querySelector<HTMLButtonElement>("#transport-focus-unsafe")!.onclick = focusFirstUnsafeStation;
panel.querySelector<HTMLButtonElement>("#transport-focus")!.onclick = focusSelection;
function inspectBridgeIn3D() {
  if (selection?.kind !== "bridge") return false;
  const bridge = transportBridgeByCode(selection.code), runtime = world();
  if (!bridge || !runtime) return false;
  // Only the camera changes: bridge ownership and Simulation remain canonical.
  runtime.navigation.setFocus(bridge.position.lon, bridge.position.lat);
  // The atlas half-height is in source units, not metres. Fixed 24 meant
  // ~733m tall even at a 118m crossing and hid 1.15m guardrail faces.
  // Fit this actual SEED-owned river span plus both 18m bank approaches
  // and 36m visual clearance; only presentation scale changes.
  const spanWithBanksM = bridge.spanM + 2 * 18 + 36;
  const detailHalfHeight = Math.max(2, Math.min(24,
    spanWithBanksM / (2 * CANONICAL_METRES_PER_SOURCE_UNIT)));
  runtime.setHalfHeight(detailHalfHeight);
  runtime.setBridgeInspectionAngle(true);
  refreshOverlay(true);
  return true;
}
panel.querySelector<HTMLButtonElement>("#transport-bridge-closeup")!.onclick = () => {
  inspectBridgeIn3D();
};
panel.querySelector<HTMLButtonElement>("#transport-bridge-clearview")!.onclick = () => {
  if (!inspectBridgeIn3D()) return;
  siteRouteFrameRevision++;
  // Suspend unrelated route probes and deferred requests in map-only view.
  if (pendingNearestRoadOnWorld) lastRoadInspectionStatus = "canceled for bridge clear view before world readiness";
  if (pendingSiteRouteOnWorld) lastSiteRouteStatus = "canceled for bridge clear view before world readiness";
  pendingNearestRoadOnWorld = false;
  roadRequestedAt = null;
  pendingSiteRouteOnWorld = false;
  siteRouteRequestedAt = null;
  resetSiteAccessProbe();
  // Reveal the actual rendered deck and rails without hiding the return path.
  // Graph inspection facts remain unchanged and return on the same selection.
  panel.hidden = true;
  overlay.style.display = "none";
  openButton.setAttribute("aria-expanded", "false");
  resumeButton.hidden = false;
  resumeButton.focus();
};
resumeButton.onclick = openPanel;
openButton.onclick = openPanel;

const actions = document.querySelector(".region-actions");
if (actions?.parentElement) actions.parentElement.insertBefore(openButton, actions.nextSibling);
else document.body.append(openButton);

const advisorTransport = Object.freeze({
  network: transportNetwork,
  get evidence() { return evidenceSummary(); },
  open: openPanel,
  selectEvidence,
  focusEvidence: selectEvidence,
  telemetry,
  refresh: () => refreshOverlay(true),
});
Object.defineProperty(window, "advisorTransport", {
  value: advisorTransport,
  configurable: true,
});

function frame() {
  // No polling/search on settled frames: only a prior explicit pending click
  // authorizes one resolution after the authoritative world becomes available.
  if (pendingSiteRouteOnWorld && !panel.hidden && world()) {
    pendingSiteRouteOnWorld = false;
    chooseNearestSiteRoute();
  }
  if (pendingNearestRoadOnWorld && !panel.hidden && world()) {
    pendingNearestRoadOnWorld = false;
    chooseNearestRoad();
  }
  refreshOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

for (const [name, code] of Object.entries(evidenceSummary()))
  if (name !== "bridge" && !code) console.warn(`Transport evidence target unavailable: ${name}`);

