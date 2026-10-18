import { segmentIntersectsBox } from "./road-spatial-index.ts";
import { roadRepresentationAtScale } from "./surface-presentation.ts";
import { placeSymbol } from "./place-symbol.ts";
import {
  countries,
  roads,
  cities,
  villages,
  countryAtPosition,
  nearbyPlaces,
  politicalBorderSegments,
  politicalRegistryMinimumCountsForSeed,
  type Place,
} from "./geography.ts";
import { WORLD_SEED } from "./config.ts";
import { placeLabels, type Rect } from "./navigation.ts";
import {
  POLITICAL_BORDER_MAX_SCALE_DENOMINATOR,
  POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR,
  politicalOverlayOpacity,
} from "./political-presentation.ts";
import { RENDER_PLANET_RADIUS, SOURCE_PRESENTATION_WIDTH, sourceToLonLat } from "./planet.ts";
import { LocalRenderFrame } from "./render-frame.ts";
import { heightAt } from "./world.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const $svg = (id: string) => document.getElementById(id) as unknown as SVGSVGElement;
const ATLAS_UPDATE_INTERVAL_MS = 50;
const SIN_60 = Math.sin(Math.PI / 3);

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
type ScreenPoint = { x: number; y: number };

const counts = { ...politicalRegistryMinimumCountsForSeed(WORLD_SEED), cities: cities.length, villages: villages.length };
const labelNodes = new Map<string, HTMLElement>();
const labelSizes = new Map<string, { width: number; height: number }>();
let borderKey = "";
let borderSegments: ReturnType<typeof politicalBorderSegments> = [];
let renderFingerprint = "";
let iconsShown = false;
let politicalLabelState: { id: string; kind: string; x: number; y: number }[] = [];
let labelLayoutRevision = 0;
let labelLayoutSignature = "";
function publishLabelLayout(signature: string) {
  if (signature === labelLayoutSignature) return;
  labelLayoutSignature = signature;
  labelLayoutRevision++;
}

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

function screenFromRelative(state: AtlasState, dx: number, dy: number, dz: number): ScreenPoint {
  const sin = Math.sin(state.view.yaw),
    cos = Math.cos(state.view.yaw),
    right = dx * cos - dz * sin,
    up = -dx * SIN_60 * sin + dy * 0.5 - dz * SIN_60 * cos,
    halfHeight = state.view.halfHeight,
    halfWidth = halfHeight * state.view.aspect;
  return {
    x: innerWidth / 2 + (right / halfWidth) * (innerWidth / 2),
    y: innerHeight / 2 - (up / halfHeight) * (innerHeight / 2),
  };
}

/**
 * Match the renderer's own label handoff: project each canonical point in the
 * local ENU frame and on the focused sphere, then blend the two screen positions
 * by the same projectionTransition. Political truth never depends on the view.
 */
function project(
  frame: LocalRenderFrame,
  state: AtlasState,
  x: number,
  z: number,
  elevation = heightAt(x, z) + 2,
): ScreenPoint | undefined {
  const focusHeight = Math.max(0, heightAt(state.view.x, state.view.z)),
    focus = frame.sourceToRender(state.view.x, state.view.z, focusHeight),
    point = frame.sourceToRender(x, z, Math.max(0, elevation)),
    flat = screenFromRelative(
      state,
      point.x - focus.x,
      point.y - focus.y,
      point.z - focus.z,
    ),
    transition = projectionTransition(state);
  if (transition <= 0.001) return flat;

  const canonical = sourceToLonLat(x, z),
    centre = state.navigation.focus,
    deltaLon = canonical.lon - centre.lon,
    cosLat = Math.cos(canonical.lat),
    sinLat = Math.sin(canonical.lat),
    cosCentre = Math.cos(centre.lat),
    sinCentre = Math.sin(centre.lat),
    gx = cosLat * Math.sin(deltaLon),
    gy = sinCentre * sinLat + cosCentre * cosLat * Math.cos(deltaLon),
    gz = -cosCentre * sinLat + sinCentre * cosLat * Math.cos(deltaLon),
    yawSin = Math.sin(state.view.yaw),
    yawCos = Math.cos(state.view.yaw),
    frontness = gx * yawSin * 0.5 + gy * SIN_60 + gz * yawCos * 0.5;

  if (frontness < 0.08 && transition > 0.55) return undefined;
  if (frontness <= 0) return flat;

  const globe = screenFromRelative(
    state,
    gx * RENDER_PLANET_RADIUS,
    (gy - 1) * RENDER_PLANET_RADIUS,
    gz * RENDER_PLANET_RADIUS,
  );
  return {
    x: flat.x + (globe.x - flat.x) * transition,
    y: flat.y + (globe.y - flat.y) * transition,
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
  const context = $("map-context");
  // Keep the established compact handoff/globe panel envelope. Local political
  // context returns automatically when the view is fully flat again.
  context.hidden = state.presentation !== "flat";
  if (context.hidden) return;

  const owner = countryAtPosition(state.navigation.focus);
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
      POLITICAL_BORDER_MAX_SCALE_DENOMINATOR,
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
    if (nextSegments.length || !borderSegments.length) borderSegments = nextSegments;
  }
  const commands: string[] = [];
  for (const segment of borderSegments) {
    const a = project(frame, state, segment.ax, segment.az, heightAt(segment.ax, segment.az) + 2.2),
      b = project(frame, state, segment.bx, segment.bz, heightAt(segment.bx, segment.bz) + 2.2);
    if (!a || !b) continue;
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
  if (iconsShown !== (scale >= 50)) {
    iconsShown = scale >= 50;
    labelSizes.clear();
  }
  const root = $("political-labels"),
    leaders = $svg("political-label-leaders"),
    opacity = politicalOverlayOpacity(
      state.presentation,
      projectionTransition(state),
      scale,
      POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR,
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
    publishLabelLayout("");
    return;
  }

  const projected: (LabelCandidate & { sx: number; sy: number; distance: number })[] = [];
  for (const candidate of [
    ...countries.map(labelCandidateFromCountry),
    ...places.map(labelCandidateFromPlace),
  ]) {
    const screen = project(frame, state, candidate.x, candidate.z),
      margin = candidate.kind === "country" ? 10 : 18;
    if (!screen) continue;
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
    const existing = labelNodes.get(item.id);
    if (existing) {
      if (!labelSizes.has(item.id)) {
        const rect = existing.getBoundingClientRect();
        labelSizes.set(item.id, { width: rect.width, height: rect.height });
      }
      continue;
    }
    const node = document.createElement("div");
    node.className = `political-label ${item.kind}`;
    node.setAttribute("aria-label", `${item.kind}: ${item.name}`);
    if (item.kind !== "country") {
      const symbol = document.createElement("span");
      symbol.className = "place-symbol";
      symbol.innerHTML = placeSymbol(item.kind);
      const name = document.createElement("span");
      name.className = "place-name";
      name.textContent = item.name;
      node.append(symbol, name);
    } else node.textContent = item.name;
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
  // Publish only material layout changes after the final label transforms.
  publishLabelLayout(placed.map(p =>
    [p.id, Math.round(p.rect.x * 2) / 2, Math.round(p.rect.y * 2) / 2,
      Math.round(p.rect.width), Math.round(p.rect.height)].join(":")
  ).join("|"));
}

// Mid-scale cartography projects the same canonical road stations used by
// terrain/traversal. Culling precedes fine height queries; no hidden scenery is built.
const roadNodes=new Map<string,SVGPathElement>();
let visibleRoadCount=0,visibleRoadPoints=0;
function updateCartographicRoads(state:AtlasState,frame:LocalRenderFrame,scale:number){
 const root=$svg('cartographic-roads');
 if(roadRepresentationAtScale(scale)!=='cartographic'){root.style.display='none';visibleRoadCount=0;visibleRoadPoints=0;return;}
 root.style.display='block';
 const radius=Math.hypot(state.view.halfHeight*state.view.aspect,state.view.halfHeight)*2,
  candidates=roads.flatMap(road=>[-SOURCE_PRESENTATION_WIDTH,0,SOURCE_PRESENTATION_WIDTH].flatMap(shift=>
   road.maxX+shift<state.view.x-radius||road.minX+shift>state.view.x+radius||road.maxZ<state.view.z-radius||road.minZ>state.view.z+radius?[]:[{road,shift,distance:Math.hypot((road.minX+road.maxX)/2+shift-state.view.x,(road.minZ+road.maxZ)/2-state.view.z)}]))
  .sort((a,b)=>a.distance-b.distance||a.road.networkId.localeCompare(b.road.networkId)).slice(0,innerWidth<700?128:256),visible=new Set<string>();
 visibleRoadPoints=0;
 for(const {road,shift} of candidates){
  const id=`${road.networkId}/${shift}`,path=road.centerline||[{x:road.fromX,z:road.fromZ},{x:road.toX,z:road.toZ}],commands:string[]=[];
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i];
   if(!segmentIntersectsBox(a.x+shift,a.z,b.x+shift,b.z,state.view.x-radius,state.view.z-radius,state.view.x+radius,state.view.z+radius))continue;
   const p=project(frame,state,a.x+shift,a.z),q=project(frame,state,b.x+shift,b.z);if(!p||!q)continue;
   commands.push(`M${p.x.toFixed(2)},${p.y.toFixed(2)} L${q.x.toFixed(2)},${q.y.toFixed(2)}`);visibleRoadPoints+=2;
  }
  if(!commands.length)continue;
  visible.add(id);let node=roadNodes.get(id);
  if(!node){node=document.createElementNS(SVG_NS,'path');node.dataset.roadId=road.networkId;root.append(node);roadNodes.set(id,node);}
  node.setAttribute('d',commands.join(' '));
 }
 for(const [id,node] of roadNodes)if(!visible.has(id)){node.remove();roadNodes.delete(id);}
 visibleRoadCount=visible.size;
}

// Overview cities remain visible without instantiating settlements or full labels.
const overviewNodes=new Map<string,SVGCircleElement>();
let overviewCityCount=0;
function updateSettlementOverview(state:AtlasState,frame:LocalRenderFrame,scale:number){
  const root=$svg("settlement-overview");
  if(scale<=POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR){root.style.display="none";overviewCityCount=0;return;}
  root.style.display="block";
  const candidates=cities.flatMap(city=>{
    const point=project(frame,state,city.x,city.z,0);
    return point&&point.x>=10&&point.x<=innerWidth-10&&point.y>=80&&point.y<=innerHeight-110?[{city,point,distance:Math.hypot(point.x-innerWidth/2,point.y-innerHeight/2)}]:[];
  }).sort((a,b)=>(a.city.city===0?0:1)-(b.city.city===0?0:1)||a.distance-b.distance||a.city.id.localeCompare(b.city.id)).slice(0,innerWidth<700?60:160);
  const visible=new Set(candidates.map(c=>c.city.id));
  for(const [id,node] of overviewNodes)if(!visible.has(id)){node.remove();overviewNodes.delete(id);}
  for(const {city,point} of candidates){
    let node=overviewNodes.get(city.id);
    if(!node){node=document.createElementNS(SVG_NS,"circle");const title=document.createElementNS(SVG_NS,"title");title.textContent=city.name;node.append(title);root.append(node);overviewNodes.set(city.id,node);}
    node.setAttribute("cx",point.x.toFixed(1));node.setAttribute("cy",point.y.toFixed(1));
    node.setAttribute("r",city.city===0?"4.5":"2.8");node.setAttribute("class",city.city===0?"capital":"city");
  }
  overviewCityCount=candidates.length;
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
    updateSettlementOverview(state, frame, scale);
    updateCartographicRoads(state,frame,scale);
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
        labelLayoutRevision,
        overviewCityCount,
        visibleRoadCount,visibleRoadPoints,
        presentationBytesEstimated:roadNodes.size*8192+overviewNodes.size*1024,
        borderKey,
      };
    },
  },
});
update();
