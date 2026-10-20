import "./transport-inspector.css";
import { continuityCorridor } from "./geography.ts";
import {
  ensureTransportBridgeEvidence,
  transportAcceptanceSummary,
  transportGenerationTelemetry,
  transportNetwork,
  transportRoadsNear,
  type TransportBorderCrossing,
  type TransportBridge,
  type TransportFerryEdge,
  type TransportHarbor,
  type TransportJunction,
  type TransportRoadEdge,
} from "./transport-network.ts";
import { greatCircleDistance, sourceToLonLat, wrapSourceX } from "./planet.ts";
import { polylineTouchesViewport } from "./transport-viewport.ts";
import { createTransportJunctionLookup } from "./transport-junction-index.ts";

type AdvisorWorld = {
  state: {
    presentation: string;
    scaleLabel: string;
    view: { x: number; z: number; halfHeight: number; aspect: number; yaw: number };
  };
  navigation: { setFocus(lon: number, lat: number): void };
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
    <button type="button" id="transport-focus">Focus selection</button>
  </div>
  <div class="divider"></div>
  <section id="transport-selection" aria-live="polite"></section>
  <div class="divider"></div>
  <div class="transport-metrics" id="transport-metrics"></div>
`;
document.body.append(panel);

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
    const bridge = transportNetwork.bridges.find((candidate) => candidate.code === selection!.code);
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

function projectSource(x: number, z: number, state: AdvisorWorld["state"]) {
  const { view } = state;
  const scale = innerHeight / Math.max(1, view.halfHeight * 2);
  const dx = wrapSourceX(x - view.x), dz = z - view.z, yaw = view.yaw || 0;
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const depth = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return {
    x: innerWidth / 2 + right * scale,
    y: innerHeight / 2 + depth * Math.cos(Math.PI / 6) * scale,
  };
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
  const points = edge.centerline.map((point) => projectSource(point.x, point.z, state));
  if (!polylineTouchesViewport(points, innerWidth, innerHeight)) return undefined;
  return `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`;
}

function appendRoad(edge: TransportRoadEdge, state: AdvisorWorld["state"], selected: ReadonlySet<string>) {
  const d = pathFor(edge, state);
  if (!d) return false;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.classList.add("transport-road", `transport-road-${edge.roadClass}`);
  if (selected.has(edge.code)) path.classList.add("selected");
  path.dataset.transportCode = edge.code;
  overlay.append(path);
  return true;
}

function appendMarker(kind: "bridge" | "border" | "junction" | "harbor", x: number, z: number, state: AdvisorWorld["state"], code: string, active: boolean) {
  const point = projectSource(x, z, state);
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
  if (selection.kind === "bridge") return transportNetwork.bridges.find((candidate) => candidate.code === selection!.code)?.position;
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
  return `
    <div class="transport-kind walking">WALKING · RIVER BRIDGE</div>
    <h3>${codeText(bridge.code)}</h3>
    <dl>
      <dt>Road</dt><dd>${codeText(bridge.roadCode)}</dd>
      <dt>Natural drainage</dt><dd>${codeText(bridge.drainageCode)}</dd>
      <dt>Span</dt><dd>${bridge.spanM.toFixed(1)} m</dd>
      <dt>Connection</dt><dd>${codeText(edge.from)} → ${codeText(edge.to)}</dd>
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
  if (!selection) {
    target.innerHTML = `<p class="hint">Select a nearby road, or use an evidence target from the diagnostic interface.</p>`;
    return;
  }
  if (selection.kind === "road") {
    const edge = transportNetwork.roadEdges.find((candidate) => candidate.code === selection!.code);
    target.innerHTML = edge ? roadDetails(edge) : `<p>Road not found.</p>`;
  } else if (selection.kind === "bridge") {
    const bridge = transportNetwork.bridges.find((candidate) => candidate.code === selection!.code);
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

function renderSummary(state?: AdvisorWorld["state"]) {
  const summary = transportAcceptanceSummary();
  panel.querySelector<HTMLElement>("#transport-summary")!.innerHTML = `
    <span><b>${summary.roads}</b> roads</span>
    <span><b>${summary.junctions}</b> junctions</span>
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
      <dt>Domestic authority</dt><dd><code>${generation.domesticAuthority}</code> · ${generation.baseRoads} shared roads + ${generation.extensionRoads} S005 extensions</dd>
      <dt>Focus query</dt><dd>${lastQueryMs.toFixed(2)} ms · ${lastLocalRoads}/${QUERY_EDGE_LIMIT} records</dd>
      <dt>First road answer</dt><dd>${lastRoadInspectionStatus}${lastRoadInspectionMs === null ? "" : ` · ${lastRoadInspectionMs.toFixed(2)} ms`}</dd>
      <dt>Query/cache</dt><dd>${queryCount} searches · ${queryCacheHits} reuses · ${queryCache.size}/${QUERY_CACHE_LIMIT} cached</dd>
      <dt>Bridge detail</dt><dd>${generation.materializedBridges} records · ${generation.bridgeCacheRoads}/${generation.bridgeCacheLimit} road recipes cached · ${generation.bridgeCacheEvictions} evictions</dd>
      <dt>Visible overlay</dt><dd>${lastOverlayRoads} road paths · ${lastOverlayBridges} bridge markers</dd>
    </dl>`;
}

function openPanel() {
  panel.hidden = false;
  openButton.setAttribute("aria-expanded", "true");
  renderSelection();
  renderSummary(world()?.state);
  renderMetrics();
}

function chooseNearestRoad() {
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
  const points = continuityCorridor.road.centerline.map((point) => projectSource(point.x, point.z, state));
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
    const query = roadQuery(state), selected = selectedRoadCodes();
    lastLocalRoads = query.edges.length;
    for (const edge of query.edges) if (appendRoad(edge, state, selected)) lastOverlayRoads++;
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
    localRoads: lastLocalRoads,
    overlayRoads: lastOverlayRoads,
    overlayBridgeMarkers: lastOverlayBridges,
    roadScaleLimit: ROAD_SCALE_LIMIT,
    selection: selection ? { ...selection } : null,
  });
}

panel.querySelector<HTMLButtonElement>("#transport-close")!.onclick = () => {
  panel.hidden = true;
  openButton.setAttribute("aria-expanded", "false");
};
panel.querySelector<HTMLButtonElement>("#transport-nearest")!.onclick = chooseNearestRoad;
panel.querySelector<HTMLButtonElement>("#transport-focus")!.onclick = focusSelection;
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

void greatCircleDistance;
void sourceToLonLat;
