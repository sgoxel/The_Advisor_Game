import "./site-experience.css";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAcceptanceSummary,
  type CriticalSite,
} from "./sites.ts";
import { placeLabels, type Rect } from "./navigation.ts";
import { wrapSourceX } from "./planet.ts";

declare global {
  interface Window {
    advisorWorld?: any;
    advisorSites?: any;
  }
}

type SiteDetail = Readonly<{
  signature: string;
  stones: number;
  walls: number;
  props: number;
}>;
type ProjectedSite = Readonly<{
  site: CriticalSite;
  x: number;
  y: number;
  accessX: number;
  accessY: number;
  distance: number;
}>;

const markerNodes = new Map<string, HTMLButtonElement>();
const labelNodes = new Map<string, HTMLDivElement>();
const labelSizes = new Map<string, { width: number; height: number }>();
const detailCache = new Map<string, SiteDetail>();
let selectedCode: string | null = null;
let lastFingerprint = "";
let lastVisibleCodes: string[] = [];
let lastDetailedCodes: string[] = [];

function detailFor(site: CriticalSite): SiteDetail {
  let detail = detailCache.get(site.code);
  if (!detail) {
    const variant = site.variant;
    detail = Object.freeze({
      signature: `${site.code}/${site.archetype}/${variant % 97}/${site.radiusM}`,
      stones: site.kind === "ruin" ? 4 + (variant % 5) : 5 + (variant % 7),
      walls: site.kind === "ruin" ? 3 + (variant % 4) : 0,
      props: 2 + (variant % 4),
    });
    detailCache.set(site.code, detail);
  }
  return detail;
}

function ensureUi() {
  if (document.getElementById("critical-site-layer")) return;

  const layer = document.createElement("div");
  layer.id = "critical-site-layer";
  layer.setAttribute("aria-label", "Discoverable ruins and critical places");
  document.body.append(layer);

  const labels = document.createElement("div");
  labels.id = "critical-site-labels";
  labels.setAttribute("aria-hidden", "true");
  document.body.append(labels);

  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.id = "critical-site-overlay";
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);

  const panel = document.createElement("aside");
  panel.id = "critical-site-panel";
  panel.className = "panel critical-site-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="eyebrow">IMPORTANT PLACE <button id="close-critical-site" aria-label="Close important-place inspector">×</button></div>
    <h2 id="critical-site-name"></h2>
    <p id="critical-site-kind" class="site-kind"></p>
    <div class="divider"></div>
    <div class="seed-label">CANONICAL SITE</div>
    <code id="critical-site-code"></code>
    <dl>
      <dt>Country</dt><dd id="critical-site-country"></dd>
      <dt>Archetype</dt><dd id="critical-site-archetype"></dd>
      <dt>Road access</dt><dd id="critical-site-road"></dd>
      <dt>Access walk</dt><dd id="critical-site-distance"></dd>
      <dt>Prepared ground</dt><dd id="critical-site-ground"></dd>
      <dt>Detail residency</dt><dd id="critical-site-residency"></dd>
    </dl>
    <div class="region-actions"><button id="focus-critical-site">Focus site geometry</button></div>
    <p class="hint">Inspection reads existing SEED-defined data. It never creates, rerolls, or relocates this place.</p>`;
  document.body.append(panel);

  panel.querySelector<HTMLButtonElement>("#close-critical-site")!.onclick = () => selectSite(null);
  panel.querySelector<HTMLButtonElement>("#focus-critical-site")!.onclick = () => {
    const site = criticalSites.find((item) => item.code === selectedCode);
    if (!site || !window.advisorWorld) return;
    window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
    window.advisorWorld.setHalfHeight(150);
  };
}

function selectSite(code: string | null) {
  selectedCode = code;
  const panel = document.getElementById("critical-site-panel") as HTMLElement | null;
  if (!panel) return;
  if (!code) {
    panel.hidden = true;
    for (const marker of markerNodes.values()) marker.setAttribute("aria-pressed", "false");
    return;
  }
  const site = criticalSites.find((item) => item.code === code);
  if (!site) return;
  const detail = detailFor(site);
  panel.hidden = false;
  (document.getElementById("critical-site-name") as HTMLElement).textContent = site.name;
  (document.getElementById("critical-site-kind") as HTMLElement).textContent =
    site.kind === "ruin" ? "Seeded ruin · priority 9" : "Critical place · priority 9";
  (document.getElementById("critical-site-code") as HTMLElement).textContent = site.code;
  (document.getElementById("critical-site-country") as HTMLElement).textContent = site.countryName;
  (document.getElementById("critical-site-archetype") as HTMLElement).textContent =
    site.archetype.replaceAll("-", " ");
  (document.getElementById("critical-site-road") as HTMLElement).textContent = site.access.roadCode;
  (document.getElementById("critical-site-distance") as HTMLElement).textContent =
    `${Math.round(site.access.lengthM)} m to a legal road junction`;
  (document.getElementById("critical-site-ground") as HTMLElement).textContent =
    `${site.radiusM} m usable core + ${site.falloffM} m blend`;
  (document.getElementById("critical-site-residency") as HTMLElement).textContent =
    `${detail.signature} · selected only`;
  for (const [id, marker] of markerNodes)
    marker.setAttribute("aria-pressed", id === code ? "true" : "false");
}

function project(x: number, z: number, view: any) {
  const dx = wrapSourceX(x - view.x),
    dz = z - view.z,
    c = Math.cos(view.yaw),
    s = Math.sin(view.yaw),
    right = dx * c - dz * s,
    forward = dx * s + dz * c,
    halfWidth = view.halfHeight * view.aspect;
  return {
    x: innerWidth / 2 + (right / halfWidth) * (innerWidth / 2),
    y: innerHeight / 2 + (forward * 0.8660254 / view.halfHeight) * (innerHeight / 2),
  };
}

function markerFor(site: CriticalSite) {
  let marker = markerNodes.get(site.code);
  if (marker) return marker;
  marker = document.createElement("button");
  marker.type = "button";
  marker.className = `critical-site-marker ${site.kind}`;
  marker.dataset.code = site.code;
  marker.setAttribute("aria-label", `${site.name}. Inspect important place.`);
  marker.setAttribute("aria-pressed", "false");
  marker.innerHTML = `<span class="site-glyph" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></span>`;
  marker.onclick = () => selectSite(site.code);
  document.getElementById("critical-site-layer")!.append(marker);
  markerNodes.set(site.code, marker);
  return marker;
}

function labelFor(site: CriticalSite) {
  let label = labelNodes.get(site.code);
  if (label) return label;
  label = document.createElement("div");
  label.className = `critical-site-label ${site.kind}`;
  label.dataset.code = site.code;
  label.textContent = site.name;
  document.getElementById("critical-site-labels")!.append(label);
  labelNodes.set(site.code, label);
  return label;
}

function layoutObstacles(): Rect[] {
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
    "critical-site-panel",
  ]
    .flatMap((name) => Array.from(document.querySelectorAll(`#${name},.${name}`)))
    .concat(Array.from(document.querySelectorAll(".map-label,.political-label")))
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width && rect.height)
    .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
}

function line(
  overlay: SVGSVGElement,
  className: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "line");
  element.setAttribute("x1", String(x1));
  element.setAttribute("y1", String(y1));
  element.setAttribute("x2", String(x2));
  element.setAttribute("y2", String(y2));
  element.setAttribute("class", className);
  overlay.append(element);
}

function render() {
  ensureUi();
  const world = window.advisorWorld;
  if (!world?.state?.ready) return requestAnimationFrame(render);
  const state = world.state,
    view = state.view,
    denominator = Number(String(state.scaleLabel).replace("1/", "")),
    flat = state.presentation === "flat";
  if (!flat || !Number.isFinite(denominator) || denominator > 1000) {
    for (const marker of markerNodes.values()) marker.hidden = true;
    for (const label of labelNodes.values()) label.hidden = true;
    document.querySelector<SVGSVGElement>("#critical-site-overlay")!.replaceChildren();
    lastVisibleCodes = [];
    lastDetailedCodes = [];
    return requestAnimationFrame(render);
  }

  const radius = Math.hypot(view.halfHeight * view.aspect, view.halfHeight) * 1.4,
    nearby = nearbyCriticalSites(view.x, view.z, radius, 32),
    projected: ProjectedSite[] = nearby.map((site) => {
      const point = project(site.x, site.z, view),
        accessPoint = project(site.access.x, site.access.z, view);
      return {
        site,
        x: point.x,
        y: point.y,
        accessX: accessPoint.x,
        accessY: accessPoint.y,
        distance: Math.hypot(wrapSourceX(site.x - view.x), site.z - view.z),
      };
    });

  const obstacleKey = layoutObstacles()
      .map((item) => `${Math.round(item.x)}/${Math.round(item.y)}/${Math.round(item.width)}/${Math.round(item.height)}`)
      .join("|"),
    fingerprint = `${Math.round(view.x)}/${Math.round(view.z)}/${Math.round(view.halfHeight)}/${Math.round(view.yaw * 1000)}/${innerWidth}/${innerHeight}/${projected.map((item) => item.site.code).join("|")}/${obstacleKey}`;
  if (fingerprint !== lastFingerprint) {
    lastFingerprint = fingerprint;
    const visibleCodes = new Set<string>(),
      detailedCodes: string[] = [],
      overlay = document.querySelector<SVGSVGElement>("#critical-site-overlay")!;
    overlay.replaceChildren();

    for (const item of projected) {
      const marker = markerFor(item.site),
        visible =
          item.x >= 16 &&
          item.x <= innerWidth - 16 &&
          item.y >= 82 &&
          item.y <= innerHeight - 105;
      marker.hidden = !visible;
      if (!visible) continue;
      visibleCodes.add(item.site.code);
      marker.style.transform = `translate(${Math.round(item.x)}px,${Math.round(item.y)}px)`;
      const detailed = view.halfHeight <= 450 && item.distance <= 900;
      marker.classList.toggle("detailed", detailed);
      if (detailed) detailedCodes.push(item.site.code);
      if (
        item.accessX > 0 &&
        item.accessX < innerWidth &&
        item.accessY > 0 &&
        item.accessY < innerHeight
      )
        line(
          overlay,
          item.site.kind === "ruin" ? "site-access ruin-access" : "site-access critical-access",
          item.x,
          item.y,
          item.accessX,
          item.accessY,
        );
    }

    for (const [code, marker] of markerNodes)
      if (!visibleCodes.has(code)) marker.hidden = true;
    for (const [code, label] of labelNodes)
      if (!visibleCodes.has(code)) label.hidden = true;

    const obstacles = layoutObstacles().concat(
        [...visibleCodes]
          .map((code) => markerNodes.get(code)!.getBoundingClientRect())
          .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
      ),
      placementToSite = new Map<string, CriticalSite>(),
      anchors = [...visibleCodes].map((code) => {
        const item = projected.find((candidate) => candidate.site.code === code)!,
          label = labelFor(item.site);
        label.hidden = false;
        let size = labelSizes.get(code);
        if (!size) {
          const rect = label.getBoundingClientRect();
          size = { width: rect.width, height: rect.height };
          labelSizes.set(code, size);
        }
        const priorityPrefix = item.site.kind === "critical-place" ? "0" : "1",
          id = `${priorityPrefix}/${code}`;
        placementToSite.set(id, item.site);
        return { id, x: item.x, y: item.y, width: size.width, height: size.height };
      }),
      placed = placeLabels(anchors, innerWidth, innerHeight, obstacles);

    for (const placement of placed) {
      const site = placementToSite.get(placement.id)!;
      labelNodes.get(site.code)!.style.transform =
        `translate(${Math.round(placement.rect.x)}px,${Math.round(placement.rect.y)}px)`;
      if (placement.leader)
        line(
          overlay,
          "site-label-leader",
          placement.x,
          placement.y,
          placement.endX,
          placement.endY,
        );
    }

    lastVisibleCodes = [...visibleCodes].sort();
    lastDetailedCodes = detailedCodes.sort();
  }
  requestAnimationFrame(render);
}

function installDiagnostic() {
  Object.defineProperty(window, "advisorSites", {
    value: {
      sites: criticalSites,
      summary: siteAcceptanceSummary(),
      inspect(code: string) {
        const site = criticalSites.find((item) => item.code === code);
        return site ? { ...site, detail: detailFor(site) } : null;
      },
      select(code: string | null) {
        selectSite(code);
      },
      get state() {
        return {
          selectedCode,
          visibleCodes: [...lastVisibleCodes],
          visibleCount: lastVisibleCodes.length,
          detailedCodes: [...lastDetailedCodes],
          detailedCount: lastDetailedCodes.length,
          cachedDetails: detailCache.size,
        };
      },
    },
    configurable: false,
    writable: false,
  });
}

installDiagnostic();
requestAnimationFrame(render);
