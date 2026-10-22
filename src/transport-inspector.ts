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
import { planTransportRouteCorridor, sampledCorridorStationPass } from "./transport-route-corridor.ts";
import { polylineTouchesViewport } from "./transport-viewport.ts";
import { sampledBridgeCrossingPass, transportBridgeSpanAt, transportBridgeSurfaceAt } from "./transport-bridge-surface.ts";
import { createTransportJunctionLookup } from "./transport-junction-index.ts";
import { createTransportWalkingIndex, selectedWalkingPreviewOrigin, transportWalkingRouteThroughEdge, transportWalkingRouteToNearest, visibleWalkingPreviewEdgeCodes } from "./transport-walking-route.ts";
import { siteAccessParentRoadCode, siteAccessRoadStations, siteAccessSampleVerdict } from "./transport-site-access.ts";
import { finalSurfaceAt } from "./world-core.ts";

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

type CachedQuery = Readonly<{
  edges: readonly TransportRoadEdge[];
  queryMs: number;
}>;

const SVG_NS = "http://www.w3.org/2000/svg";
const ROAD_SCALE_LIMIT = 100;
const QUERY_CACHE_LIMIT = 12;
const QUERY_EDGE_LIMIT = 96;
const queryCache = new Map<string, CachedQuery>();
const junctionsForRoadCodes = createTransportJunctionLookup(transportNetwork.junctions);
const transportNodesByCode = new Map(transportNetwork.nodes.map((node) => [node.code, node]));
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
let lastSiteRouteMs: number | null = null;
let lastSiteRouteStatus = "not requested";
let siteRoute: ReturnType<typeof transportWalkingRouteToNearest> = null;
let siteProbe: ReturnType<typeof siteAccessSampleVerdict> | null = null;
let siteProbeStatus = "not requested";
let siteProbeMs: number | null = null;
let siteProbeRevision = 0;
let corridorProbeRevision = 0;
let corridorProbeStatus = "not requested";
let corridorProbeStations = 0;
let corridorProbeMaximumGrade: number | null = null;
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
    <button type="button" id="transport-focus">Focus selection</button>
    <button type="button" id="transport-bridge-closeup" hidden>Inspect bridge from low 3D angle</button>
    <button type="button" id="transport-bridge-clearview" hidden>View bridge without inspector</button>
  </div>
  <div class="divider"></div>
  <section id="transport-selection" aria-live="polite"></section>
  <section id="transport-site-answer" aria-live="polite"></section>
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

function appendRoad(edge: TransportRoadEdge, state: AdvisorWorld["state"], selected: ReadonlySet<string>, preview = false) {
  const d = pathFor(edge, state);
  if (!d) return false;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.classList.add("transport-road", `transport-road-${edge.roadClass}`);
  if (selected.has(edge.code)) path.classList.add("selected");
  if (preview) path.classList.add("route-preview");
  path.dataset.transportCode = edge.code;
  overlay.append(path);
  return true;
}

function appendMarker(kind: "bridge" | "border" | "junction" | "harbor", x: number, z: number, state: AdvisorWorld["state"], code: string, active: boolean) {
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
    marker.setAttribute("r", kind === "junction" ? "4" : kind === "border" ? "4.5" : "3.5");
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
  const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === bridge.roadCode)!;
  // Selection-only final-surface query: a recorded river intersection does not
  // by itself establish a constructed, walkable deck in Simulation.
  const surface = transportBridgeSurfaceAt(bridge.x, bridge.z, edge.code);
  const span = transportBridgeSpanAt(bridge, edge);
  // A walkable centre point cannot certify both dry banks, road alignment or safe grade.
  // Keep this verdict explicitly sample-limited: whole-route traversal is not proven.
  const sampledCrossingPass = sampledBridgeCrossingPass(surface.centerDeckWalkable, span);
  return `
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
      <dt>Sampled crossing grade</dt><dd>${span.matchingCrossing && span.routeMaxSampledGrade !== null ? `${(span.routeMaxSampledGrade * 100).toFixed(1)}% maximum · ${span.routeGradeWithinLimit ? "sampled route passes 8% limit" : "not certified (alignment, walking or grade)"}` : "Not validated"}</dd>
      <dt>Traversal scope</dt><dd>Bounded selected-crossing samples only · continuous full-route access not certified · map preview, not travel</dd>
    </dl>`;
}

function borderDetails(crossing: TransportBorderCrossing) {
  const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === crossing.roadCode)!;
  return `
    <div class="transport-kind walking">WALKING · POLITICAL BORDER CROSSING</div>
    <h3>${codeText(crossing.code)}</h3>
    <dl>
      <dt>Main road</dt><dd>${codeText(crossing.roadCode)}</dd>
      <dt>Countries</dt><dd>${crossing.countries.map(codeText).join(" ↔ ")}</dd>
      <dt>Road endpoints</dt><dd>${codeText(edge.from)} → ${codeText(edge.to)}</dd>
      <dt>Traversal</dt><dd>Continuous land road · explicit canonical crossing</dd>
    </dl>`;
}

function junctionDetails(junction: TransportJunction) {
  return `
    <div class="transport-kind walking">WALKING · SHARED JUNCTION</div>
    <h3>${codeText(junction.code)}</h3>
    <dl>
      <dt>Canonical node</dt><dd>${codeText(junction.nodeCode)}</dd>
      <dt>Connected roads</dt><dd>${junction.edgeCodes.length}</dd>
      <dt>Traversable edges</dt><dd>${junction.edgeCodes.map(codeText).join("<br>")}</dd>
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
  target.innerHTML = `<div class="eyebrow">CANONICAL WALKING GRAPH PREVIEW · NOT TRAVEL</div>
    <dl>
      <dt>From road endpoint</dt><dd>${codeText(siteRoute.from)}</dd>
      <dt>Reachable site by graph</dt><dd>${codeText(siteRoute.to)}</dd>
      <dt>Selected crossing constraint</dt><dd>${selection?.kind === "bridge" ? "Route starts by traversing the chosen bridge-owned road; no ferry or edge retracing" : "Unconstrained shortest road route"}</dd>
      <dt>Measured graph distance</dt><dd>${(siteRoute.distanceM / 1000).toFixed(2)} km</dd>
      <dt>Estimated good-road time</dt><dd>${(siteRoute.fantasyWalkSeconds / 3600).toFixed(2)} fantasy hours</dd>
      <dt>Canonical walking edges</dt><dd>${siteRoute.edgeCodes.length} · no ferry segments</dd>
      <dt>Map preview</dt><dd>Visible route segments highlighted in teal at 1/100 and closer · distant segments appear as you pan · no guaranteed physical passage</dd>
      <dt>Evidence limit</dt><dd>Graph route only · individual physical road grades and bank-to-bank crossings not fully certified · character has not moved</dd>
    </dl>`;
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
      <dt>Ground passage</dt><dd>${siteProbe.dry && siteProbe.walkable ? "Sampled stations dry and walkable" : "One or more samples wet, blocked or missing"}</dd>
      <dt>Top bridge ownership</dt><dd>${siteProbe.topSurfaceOwned ? "No unrelated top deck at sampled stations" : "Top deck or traversal mismatch; not certified"}</dd>
      <dt>Sampled span max grade</dt><dd>${grade} · ${siteProbe.gradeWithinLimit ? "spans and local road slopes within limit" : "span or local surface grade not certified"}</dd>
      <dt>Evidence boundary</dt><dd>Selected site's own access branch only · unsampled gaps, rest of graph route and character movement not certified</dd>
    </dl>`;
}

function renderCorridorProbe() {
  const target = panel.querySelector<HTMLElement>("#transport-corridor-result")!;
  target.textContent = corridorProbeStatus === "not requested" ? "" :
    `Selected-route final-surface diagnostic: ${corridorProbeStatus}. ${corridorProbeStations} sampled stations${corridorProbeMaximumGrade === null ? "" : ` · sampled maximum grade ${(corridorProbeMaximumGrade * 100).toFixed(1)}%`}. Map preview only; no uninterrupted passage or character travel certified.`;
}

function resetCorridorProbe() {
  corridorProbeRevision++;
  corridorProbeStatus = "not requested";
  corridorProbeStations = 0;
  corridorProbeMaximumGrade = null;
  panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = !siteRoute;
  renderCorridorProbe();
}

function probeRouteCorridor() {
  if (!siteRoute) return;
  const plan = planTransportRouteCorridor(siteRoute, corridorEdges, transportNodesByCode), revision = ++corridorProbeRevision;
  corridorProbeStations = 0;
  corridorProbeMaximumGrade = null;
  if (plan.status !== "ready") {
    corridorProbeStatus = plan.status === "over-budget" ? "route exceeds bounded 4096-station probe; not certified" : "invalid source-owned physical path; not certified";
    renderCorridorProbe();
    return;
  }
  corridorProbeStatus = "checking final surface in bounded frame batches";
  panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = true;
  renderCorridorProbe();
  let previousHeight: number | null = null;
  const step = () => {
    if (revision !== corridorProbeRevision) return;
    for (let i = 0; i < 8 && corridorProbeStations < plan.stations.length; i++) {
      const index = corridorProbeStations, station = plan.stations[index],
        surface = finalSurfaceAt(station.x, station.z);
      if (!sampledCorridorStationPass(station, surface)) {
        corridorProbeStatus = `road ownership, water or walkability fails at station ${index + 1}; not certified`;
        break;
      }
      if (previousHeight !== null) {
        const previous = plan.stations[index - 1],
          metres = greatCircleDistance(sourceToLonLat(previous.x, previous.z), sourceToLonLat(station.x, station.z)),
          grade = metres > 0 ? Math.abs(surface.surfaceHeight - previousHeight) / metres : Infinity;
        corridorProbeMaximumGrade = Math.max(corridorProbeMaximumGrade ?? 0, grade);
        if (!Number.isFinite(grade) || grade > .08) {
          corridorProbeStatus = `sampled grade exceeds 8% at station ${index + 1}; not certified`;
          break;
        }
      }
      previousHeight = surface.surfaceHeight;
      corridorProbeStations++;
    }
    if (corridorProbeStatus !== "checking final surface in bounded frame batches") {
      panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = false;
      renderCorridorProbe();
    } else if (corridorProbeStations < plan.stations.length) requestAnimationFrame(step);
    else {
      corridorProbeStatus = "sampled centerline passes at every planned station; between-station and actor passage not certified";
      panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.disabled = false;
      renderCorridorProbe();
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
  const route = siteRoute, branch = route && transportNetwork.roadEdges.find(edge =>
    edge.roadClass === "access" && edge.from === route.to);
  if (!branch) {
    siteProbeStatus = "no canonical terminal site branch";
    renderSiteAccessProbe();
    return;
  }
  const stations = siteAccessRoadStations(branch);
  if (!stations.length) {
    siteProbeStatus = "physical access recipe exceeds bounded profile or is invalid";
    renderSiteAccessProbe();
    return;
  }
  const revision = ++siteProbeRevision, started = performance.now(),
    surfaces: ReturnType<typeof finalSurfaceAt>[] = [];
  siteProbe = null;
  siteProbeStatus = "checking final surface in bounded frame batches";
  panel.querySelector<HTMLButtonElement>("#transport-site-access")!.disabled = true;
  renderSiteAccessProbe();
  const step = () => {
    if (revision !== siteProbeRevision) return;
    const limit = Math.min(stations.length, surfaces.length + 4);
    while (surfaces.length < limit) {
      const point = stations[surfaces.length];
      surfaces.push(finalSurfaceAt(point.x, point.z));
    }
    if (surfaces.length < stations.length) requestAnimationFrame(step);
    else {
      const parentCode = siteAccessParentRoadCode(branch);
      const junctionRoadCodes = new Set((walkingIndex?.adjacency.get(branch.to) ?? [])
        .filter(step => step.edge.code === parentCode && step.edge.roadClass !== "access")
        .map(step => step.edge.code));
      siteProbe = siteAccessSampleVerdict(branch, surfaces, junctionRoadCodes);
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
  const started = performance.now(), runtime = world();
  siteRoute = null;
  if (!runtime) lastSiteRouteStatus = "world authority pending";
  else {
    // A chosen Y/harbor is an exact graph node, and a chosen road/crossing
    // starts from its own endpoint. Only no-selection uses the nearest road.
    const fallback = selection ? undefined : roadQuery(runtime.state).edges[0];
    const selectedBridgeRoadCode = selection?.kind === "bridge"
      ? transportBridgeByCode(selection.code)?.roadCode : undefined;
    const from = selectedWalkingPreviewOrigin(
      selection, sourceToLonLat(runtime.state.view.x, runtime.state.view.z),
      transportNetwork, transportNodesByCode, fallback, selectedBridgeRoadCode,
    );
    const sites = from ? transportNetwork.nodes.filter(node =>
      node.kind === "site" && node.countryCode === from.countryCode &&
      node.continent === from.continent).map(node => node.code) : [];
    if (!from) lastSiteRouteStatus = selection?.kind === "ferry"
      ? "selected ferry is maritime, not a walking origin; select a harbor or road"
      : selection ? "selected item has no canonical walking origin"
      : "no canonical road near map focus";
    else if (!sites.length) lastSiteRouteStatus = "no same-country critical site endpoint";
    else {
      walkingIndex ??= createTransportWalkingIndex(transportNetwork);
      const selectedBridgeRoad = selectedBridgeRoadCode
        ? transportNetwork.roadEdges.find(edge => edge.code === selectedBridgeRoadCode)
        : undefined;
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
  lastSiteRouteMs = performance.now() - started;
  resetSiteAccessProbe();
  renderSiteRoute();
  renderMetrics();
  // Route state is independent of map navigation; repaint the local overlay now.
  lastFingerprint = "";
  refreshOverlay(true);
}

function renderSummary(state?: AdvisorWorld["state"]) {
  const summary = transportAcceptanceSummary();
  panel.querySelector<HTMLElement>("#transport-summary")!.innerHTML = `
    <span><b>${summary.roads}</b> roads</span>
    <span><b>${summary.junctions}</b> junctions</span>
    <span><b>${summary.siteAccessBranches}</b> critical-site links</span>
    <span><b>${summary.bridges}</b> local bridge records</span>
    <span><b>${summary.harbors}</b> harbors</span>
    <span><b>${summary.ferries}</b> sea links</span>
    <span class="transport-scale-state ${state && scaleDenominator(state.scaleLabel) <= ROAD_SCALE_LIMIT ? "visible" : "hidden"}">
      Road layer ${state ? (scaleDenominator(state.scaleLabel) <= ROAD_SCALE_LIMIT ? "visible" : "hidden beyond 1/100") : "waiting"}
    </span>`;
}

function renderMetrics() {
  const generation = transportGenerationTelemetry();
  panel.querySelector<HTMLElement>("#transport-metrics")!.innerHTML = `
    <div class="eyebrow">BOUNDED INSPECTION</div>
    <dl>
      <dt>Topology digest</dt><dd><code>${transportNetwork.digest}</code></dd>
      <dt>Domestic authority</dt><dd><code>${generation.domesticAuthority}</code> · ${generation.baseRoads} shared roads + ${generation.extensionRoads} S005 extensions + ${transportAcceptanceSummary().siteAccessBranches} canonical site branches</dd>
      <dt>Focus query</dt><dd>${lastQueryMs.toFixed(2)} ms · ${lastLocalRoads}/${QUERY_EDGE_LIMIT} records</dd>
      <dt>First road answer</dt><dd>${lastRoadInspectionStatus}${lastRoadInspectionMs === null ? "" : ` · ${lastRoadInspectionMs.toFixed(2)} ms`}</dd>
      <dt>Walking graph answer</dt><dd>${lastSiteRouteStatus}${lastSiteRouteMs === null ? "" : ` · ${lastSiteRouteMs.toFixed(2)} ms`}</dd>
      <dt>Physical site approach</dt><dd>${siteProbeStatus}${siteProbeMs === null ? "" : ` · ${siteProbeMs.toFixed(2)} ms`}</dd>
      <dt>Query/cache</dt><dd>${queryCount} searches · ${queryCacheHits} reuses · ${queryCache.size}/${QUERY_CACHE_LIMIT} cached</dd>
      <dt>Bridge detail</dt><dd>${generation.materializedBridges} records · ${generation.bridgeCacheRoads}/${generation.bridgeCacheLimit} road recipes cached · ${generation.bridgeCacheEvictions} evictions</dd>
      <dt>Visible overlay</dt><dd>${lastOverlayRoads} road paths · ${lastOverlayBridges} bridge markers</dd>
    </dl>`;
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
  siteRoute = null;
  lastSiteRouteStatus = "not requested";
  lastSiteRouteMs = null;
  resetSiteAccessProbe();
  renderSiteRoute();
  const started = performance.now();
  const runtime = world();
  if (!runtime) {
    selection = undefined;
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
      panel.querySelector<HTMLElement>("#transport-selection")!.textContent = "No canonical walking road was found near this focus. Pan to a road-connected area and retry.";
      lastRoadInspectionStatus = "no nearby canonical road";
    }
  }
  lastRoadInspectionMs = performance.now() - started;
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
      if (preview.has(edge.code) && appendRoad(edge, state, selected, true)) lastOverlayRoads++;
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
  } else lastLocalRoads = 0;
  if (!panel.hidden) {
    renderSummary(state);
    renderMetrics();
  }
}

function selectEvidence(kind: "bridge" | "border-crossing" | "lake-detour" | "mountain-pass" | "junction" | "harbor" | "ferry") {
  if (kind === "bridge") {
    const bridge = ensureTransportBridgeEvidence();
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
  resetSiteAccessProbe();
  openPanel();
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
    firstSiteRouteMs: lastSiteRouteMs,
    firstSiteRouteStatus: lastSiteRouteStatus,
    siteAccessProbeStatus: siteProbeStatus,
    siteAccessProbeStations: siteProbe?.stationCount ?? 0,
    siteAccessProbeMs: siteProbeMs,
    corridorProbeStatus,
    corridorProbeStations,
    corridorProbeMaximumGrade,
    siteRouteEdges: siteRoute?.edgeCodes.length ?? 0,
    localRoads: lastLocalRoads,
    overlayRoads: lastOverlayRoads,
    overlayBridgeMarkers: lastOverlayBridges,
    roadScaleLimit: ROAD_SCALE_LIMIT,
    selection: selection ? { ...selection } : null,
  });
}

panel.querySelector<HTMLButtonElement>("#transport-close")!.onclick = () => {
  world()?.setBridgeInspectionAngle(false);
  panel.hidden = true;
  resumeButton.hidden = true;
  overlay.style.display = "";
  openButton.setAttribute("aria-expanded", "false");
};
panel.querySelector<HTMLButtonElement>("#transport-nearest")!.onclick = chooseNearestRoad;
panel.querySelector<HTMLButtonElement>("#transport-site-route")!.onclick = chooseNearestSiteRoute;
panel.querySelector<HTMLButtonElement>("#transport-site-access")!.onclick = probeSiteAccess;
panel.querySelector<HTMLButtonElement>("#transport-route-corridor")!.onclick = probeRouteCorridor;
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
  refreshOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

for (const [name, code] of Object.entries(evidenceSummary()))
  if (name !== "bridge" && !code) console.warn(`Transport evidence target unavailable: ${name}`);

