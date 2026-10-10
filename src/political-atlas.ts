import {
  cities,
  countries,
  countryAtPosition,
  nearbyPlaces,
  politicalBorderSegments,
  politicalRegistryCountsForSeed,
  villages,
  type Place,
} from "./geography.ts";
import { WORLD_SEED } from "./config.ts";
import { placeLabels, type Rect } from "./navigation.ts";
import { politicalOverlayOpacity } from "./political-presentation.ts";
import { LocalRenderFrame } from "./render-frame.ts";
import { heightAt } from "./world.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const $svg = (id: string) => document.getElementById(id) as unknown as SVGSVGElement;
const ATLAS_UPDATE_INTERVAL_MS = 50;

type AtlasState = {
  presentation: "flat" | "globe" | "transition";
  scaleLabel: string;
  navigation: { focus: { lon: number; lat: number } };
  view: { x: number; z: number; halfHeight: number; aspect: number; yaw: number };
  handoff?: { projectionTransition: number };
};
type AdvisorWorld = { state: AtlasState };
type LabelCandidate = {
  id: string;
  name: string;
  kind: "country" | "city" | "village";
  x: number;
  z: number;
  priority: number;
};

const counts = politicalRegistryCountsForSeed(WORLD_SEED);
const countryByCode = new Map(countries.map((country) => [country.code, country]));
const labelNodes = new Map<string, HTMLElement>();
const labelSizes = new Map<string, { width: number; height: number }>();
let borderKey = "";
let borderSegments: ReturnType<typeof politicalBorderSegments> = [];
let renderFingerprint = "";
let politicalLabelState: { id: string; kind: string; x: number; y: number }[] = [];

function denominator(scaleLabel: string) {
  const match = /1\/(\d+)/.exec(scaleLabel),
    value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : 10_000;
}

function projectionTransition(state: AtlasState) {
  if (Number.isFinite(state.handoff?.projectionTransition))
    return state.handoff!.projectionTransition;
  return state.presentation === "globe" ? 1 : 0;
}

function project(
  frame: LocalRenderFrame,
  state: AtlasState,
  x: number,
  z: number,
  elevation = heightAt(x, z) + 2,
) {
  const focusHeight = Math.max(0, heightAt(state.view.x, state.view.z)),
    focus = frame.sourceToRender(state.view.x, state.view.z, focusHeight),
    point = frame.sourceToRender(x, z, Math.max(0, elevation)),
    dx = point.x - focus.x,
    dy = point.y - focus.y,
    dz = point.z - focus.z,
    sin = Math.sin(state.view.yaw),
    cos = Math.cos(state.view.yaw),
    right = dx * cos - dz * sin,
    up = -dx * 0.8660254037844386 * sin + dy * 0.5 - dz * 0.8660254037844386 * cos,
    halfHeight = state.view.halfHeight,
    halfWidth = halfHeight * state.view.aspect;
  return {
    x: innerWidth / 2 + (right / halfWidth) * (innerWidth / 2),
    y: innerHeight / 2 - (up / halfHeight) * (innerHeight / 2),
  };
}

function visiblePlaces(state: AtlasState) {
  const result = new Map<string, Place>(),
    halfWidth = state.view.halfHeight * state.view.aspect;
  for (const dz of [-0.62, 0, 0.62])
    for (const dx of [-0.62, 0, 0.62])
      for (const place of nearbyPlaces(
        state.view.x + halfWidth * dx,
        state.view.z + state.view.halfHeight * dz,
      ))
        result.set(place.id, place);
  return [...result.values()];
}

function obstacles(): Rect[] {
  return [
    "masthead",
    "region-panel",
    "cell-panel",
    "travel-panel",
    "bottom-bar",
    "map-controls",
    "telemetry",
    "focus-coordinates",
    "centre-marker",
  ]
    .flatMap((name) => Array.from(document.querySelectorAll(`#${name},.${name}`)))
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width && rect.height)
    .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
}

function updateContext(state: AtlasState, places: Place[]) {
  const owner = countryAtPosition(state.navigation.focus),
    context = $("map-context");
  if (!owner) {
    context.textContent = "Open water · no political owner";
    return;
  }
  let nearest: Place | undefined,
    nearestDistance = Infinity;
  for (const place of places) {
    if (place.continent !== owner.continent || place.country !== owner.id) continue;
    const dx = place.x - state.view.x,
      dz = place.z - state.view.z,
      d = dx * dx + dz * dz;
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = place;
    }
  }
  context.textContent = nearest
    ? `${owner.name} · near ${nearest.name}`
    : owner.name;
}

function updateBorders(state: AtlasState, frame: LocalRenderFrame, scale: number) {
  const svg = $svg("political-borders"),
    opacity = politicalOverlayOpacity(
      state.presentation,
      projectionTransition(state),
      scale,
      2500,
    );
  svg.style.opacity = opacity.toFixed(3);
  if (opacity <= 0) {
    svg.replaceChildren();
    return;
  }
  const quantum = Math.max(64, state.view.halfHeight / 7),
    key = [
      Math.round(state.view.x / quantum),
      Math.round(state.view.z / quantum),
      Math.round(Math.log2(state.view.halfHeight) * 6),
      Math.round(state.view.aspect * 20),
    ].join("/");
  if (key !== borderKey) {
    borderKey = key;
    const nextSegments = politicalBorderSegments(
      Math.round(state.view.x / quantum) * quantum,
      Math.round(state.view.z / quantum) * quantum,
      state.view.halfHeight,
      state.view.aspect,
      innerWidth < 700 ? 28 : 38,
      innerWidth < 700 ? 22 : 28,
    );
    // A coarse marching window can legitimately contain no boundary. During a
    // tiny zoom/handoff change, however, retaining the previous canonical world
    // segments is safer than flashing the whole political layer off; segments
    // that are no longer near the view are culled below in screen space.
    if (nextSegments.length || !borderSegments.length) borderSegments = nextSegments;
  }
  const commands: string[] = [];
  for (const segment of borderSegments) {
    const a = project(frame, state, segment.ax, segment.az, heightAt(segment.ax, segment.az) + 2.2),
      b = project(frame, state, segment.bx, segment.bz, heightAt(segment.bx, segment.bz) + 2.2);
    if (
      (a.x < -30 && b.x < -30) ||
      (a.x > innerWidth + 30 && b.x > innerWidth + 30) ||
      (a.y < -30 && b.y < -30) ||
      (a.y > innerHeight + 30 && b.y > innerHeight + 30)
    )
      continue;
    commands.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
  }
  const d = commands.join("");
  const underlay = document.createElementNS(SVG_NS, "path"),
    line = document.createElementNS(SVG_NS, "path");
  underlay.setAttribute("class", "political-border-underlay");
  underlay.setAttribute("d", d);
  line.setAttribute("class", "political-border-line");
  line.setAttribute("d", d);
  svg.replaceChildren(underlay, line);
}

function labelCandidateFromCountry(country: (typeof countries)[number]): LabelCandidate {
  return {
    id: `political-country-${country.code}`,
    name: country.name,
    kind: "country",
    x: country.x,
    z: country.z,
    priority: 3,
  };
}
function labelCandidateFromPlace(place: Place): LabelCandidate {
  return {
    id: `political-${place.kind}-${place.id}`,
    name: place.name,
    kind: place.kind,
    x: place.x,
    z: place.z,
    priority: place.kind === "city" ? 2 : 1,
  };
}

function updateLabels(state: AtlasState, frame: LocalRenderFrame, scale: number, places: Place[]) {
  const root = $("political-labels"),
    leaders = $svg("political-label-leaders"),
    opacity = politicalOverlayOpacity(
      state.presentation,
      projectionTransition(state),
      scale,
      1000,
    ),
    detailed = opacity > 0;
  document.body.classList.toggle("political-detail-labels", detailed);
  root.style.opacity = opacity.toFixed(3);
  leaders.style.opacity = opacity.toFixed(3);
  if (!detailed) {
    root.replaceChildren();
    leaders.replaceChildren();
    labelNodes.clear();
    labelSizes.clear();
    politicalLabelState = [];
    return;
  }

  const projected: (LabelCandidate & { sx: number; sy: number; distance: number })[] = [];
  for (const candidate of [
    ...countries.map(labelCandidateFromCountry),
    ...places.map(labelCandidateFromPlace),
  ]) {
    const screen = project(frame, state, candidate.x, candidate.z),
      margin = candidate.kind === "country" ? 10 : 18;
    if (
      screen.x < margin ||
      screen.x > innerWidth - margin ||
      screen.y < 82 ||
      screen.y > innerHeight - 105
    )
      continue;
    projected.push({
      ...candidate,
      sx: screen.x,
      sy: screen.y,
      distance: Math.hypot(screen.x - innerWidth / 2, screen.y - innerHeight / 2),
    });
  }
  projected.sort(
    (a, b) => b.priority - a.priority || a.distance - b.distance || a.id.localeCompare(b.id),
  );
  const caps = innerWidth < 700
      ? { country: 2, city: 4, village: 5 }
      : { country: 4, city: 8, village: 12 },
    chosen: typeof projected = [];
  for (const kind of ["country", "city", "village"] as const)
    chosen.push(...projected.filter((item) => item.kind === kind).slice(0, caps[kind]));
  chosen.sort((a, b) => b.priority - a.priority || a.distance - b.distance || a.id.localeCompare(b.id));

  const visible = new Set(chosen.map((item) => item.id));
  for (const [id, node] of labelNodes)
    if (!visible.has(id)) {
      node.remove();
      labelNodes.delete(id);
      labelSizes.delete(id);
    }
  for (const item of chosen) {
    if (labelNodes.has(item.id)) continue;
    const node = document.createElement("div");
    node.className = `political-label ${item.kind}`;
    node.textContent = item.name;
    root.append(node);
    labelNodes.set(item.id, node);
    const rect = node.getBoundingClientRect();
    labelSizes.set(item.id, { width: rect.width, height: rect.height });
  }
  const anchors = chosen.map((item) => {
    const size = labelSizes.get(item.id)!;
    return {
      id: item.id,
      x: item.sx,
      y: item.sy,
      width: size.width,
      height: size.height,
    };
  });
  const placed = placeLabels(anchors, innerWidth, innerHeight, obstacles());
  leaders.replaceChildren();
  politicalLabelState = [];
  for (const placement of placed) {
    const item = chosen.find((candidate) => candidate.id === placement.id)!;
    labelNodes.get(placement.id)!.style.transform =
      `translate(${placement.rect.x}px,${placement.rect.y}px)`;
    politicalLabelState.push({ id: placement.id, kind: item.kind, x: placement.x, y: placement.y });
    if (!placement.leader) continue;
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(placement.x));
    line.setAttribute("y1", String(placement.y));
    line.setAttribute("x2", String(placement.endX));
    line.setAttribute("y2", String(placement.endY));
    leaders.append(line);
  }
}

function scheduleUpdate() {
  window.setTimeout(update, ATLAS_UPDATE_INTERVAL_MS);
}

function update() {
  const advisor = (window as unknown as { advisorWorld?: AdvisorWorld }).advisorWorld;
  if (!advisor) {
    scheduleUpdate();
    return;
  }
  const state = advisor.state,
    scale = denominator(state.scaleLabel),
    fingerprint = [
      state.presentation,
      scale,
      Math.round(projectionTransition(state) * 1000),
      Math.round(state.view.x * 10),
      Math.round(state.view.z * 10),
      Math.round(state.view.halfHeight * 10),
      Math.round(state.view.yaw * 1000),
      innerWidth,
      innerHeight,
    ].join("/");
  if (fingerprint !== renderFingerprint) {
    renderFingerprint = fingerprint;
    const places = visiblePlaces(state),
      frame = new LocalRenderFrame(state.view.x, state.view.z);
    updateContext(state, places);
    updateBorders(state, frame, scale);
    updateLabels(state, frame, scale, places);
  }
  scheduleUpdate();
}

const countNode = $("region-counts");
countNode.innerHTML =
  `${counts.continents} continents · ${counts.countries} countries<br />` +
  `${counts.cities} cities · ${counts.villages} villages`;

Object.defineProperty(window, "politicalAtlas", {
  value: {
    counts,
    countryAtPosition,
    get state() {
      return {
        borderSegments: borderSegments.length,
        labels: politicalLabelState,
        borderKey,
      };
    },
  },
});
update();
