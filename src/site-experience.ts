import "./site-experience.css";
import {
  criticalSites,
  nearbyCriticalSites,
  siteAcceptanceSummary,
  type CriticalSite,
} from "./sites.ts";
import { overlaps, type Rect } from "./navigation.ts";
import { wrapSourceX } from "./planet.ts";

declare global {
  interface Window {
    advisorWorld?: any;
    advisorSites?: any;
    politicalAtlas?: any;
  }
}

type SiteDetail = {
  signature: string;
  stones: number;
  walls: number;
  props: number;
};

type PlacementSite = {
  site: CriticalSite;
  point: { x: number; y: number };
  accessPoint: { x: number; y: number };
  detailed: boolean;
  placementId: string;
};

const DETAIL_CACHE_LIMIT = 48;
const markerNodes = new Map<string, HTMLButtonElement>();
const detailCache = new Map<string, SiteDetail>();
let selectedCode: string | null = null;
let lastFingerprint = "";
let lastVisibleCodes: string[] = [];
let lastPoliticalObstacleCount = 0;

function detailFor(site: CriticalSite): SiteDetail {
  let detail = detailCache.get(site.code);
  if (detail) {
    detailCache.delete(site.code);
    detailCache.set(site.code, detail);
    return detail;
  }
  const variant = site.variant;
  detail = {
    signature: `${site.code}/${site.archetype}/${variant % 97}/${site.radiusM}`,
    stones: site.kind === "ruin" ? 4 + (variant % 5) : 5 + (variant % 7),
    walls: site.kind === "ruin" ? 3 + (variant % 4) : 0,
    props: 2 + (variant % 4),
  };
  detailCache.set(site.code, detail);
  while (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldest = detailCache.keys().next().value as string | undefined;
    if (!oldest) break;
    detailCache.delete(oldest);
  }
  return detail;
}

function ensureUi() {
  if (document.getElementById("critical-site-layer")) return;
  const layer = document.createElement("div");
  layer.id = "critical-site-layer";
  layer.setAttribute("aria-label", "Discoverable ruins and critical places");
  document.body.append(layer);

  // Access/leader lines sit UNDER the markers so glyphs stay crisp.
  const access = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  access.id = "critical-site-access";
  access.setAttribute("aria-hidden", "true");
  document.body.insertBefore(access, layer);

  const panel = document.createElement("aside");
  panel.id = "critical-site-panel";
  panel.className = "panel critical-site-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="eyebrow"><span id="critical-site-eyebrow">IMPORTANT PLACE</span> <button id="close-critical-site" aria-label="Close important-place inspector">×</button></div>
    <h2 id="critical-site-name"></h2>
    <p id="critical-site-kind" class="site-kind"></p>
    <div class="divider"></div>
    <div class="seed-label">CANONICAL SITE</div>
    <code id="critical-site-code"></code>
    <dl>
      <dt>Road access</dt><dd id="critical-site-road"></dd>
      <dt>Access walk</dt><dd id="critical-site-distance"></dd>
      <dt>Country</dt><dd id="critical-site-country"></dd>
      <dt>Archetype</dt><dd id="critical-site-archetype"></dd>
      <dt>Prepared ground</dt><dd id="critical-site-ground"></dd>
      <dt>Structures</dt><dd id="critical-site-residency"></dd>
    </dl>
    <div class="region-actions"><button id="focus-critical-site">Focus site</button></div>
    <p class="hint">Inspection reveals existing SEED-defined data; it never creates or rerolls this place.</p>`;
  document.body.append(panel);
  panel.querySelector<HTMLButtonElement>("#close-critical-site")!.onclick = () => selectSite(null);
  panel.querySelector<HTMLButtonElement>("#focus-critical-site")!.onclick = () => {
    const site = criticalSites.find((item) => item.code === selectedCode);
    if (!site || !window.advisorWorld) return;
    window.advisorWorld.navigation.setFocus(
      site.canonicalPosition.lon,
      site.canonicalPosition.lat,
    );
    window.advisorWorld.setHalfHeight(420);
  };
}

function selectSite(code: string | null) {
  selectedCode = code;
  lastFingerprint = "";
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
  (document.getElementById("critical-site-eyebrow") as HTMLElement).textContent =
    site.kind === "ruin" ? "RUIN" : "IMPORTANT PLACE";
  (document.getElementById("critical-site-name") as HTMLElement).textContent = site.name;
  (document.getElementById("critical-site-kind") as HTMLElement).textContent =
    site.kind === "ruin" ? "Historic ruin" : "Important place";
  (document.getElementById("critical-site-code") as HTMLElement).textContent = site.code;
  (document.getElementById("critical-site-country") as HTMLElement).textContent = site.countryName;
  (document.getElementById("critical-site-archetype") as HTMLElement).textContent =
    site.archetype.replaceAll("-", " ");
  (document.getElementById("critical-site-road") as HTMLElement).textContent =
    site.access.roadCode;
  (document.getElementById("critical-site-distance") as HTMLElement).textContent =
    `${Math.round(site.access.lengthM)} m to legal road junction`;
  (document.getElementById("critical-site-ground") as HTMLElement).textContent =
    `${Math.round(site.radiusM)} m usable core + ${Math.round(site.falloffM)} m blend`;
  (document.getElementById("critical-site-residency") as HTMLElement).textContent =
    site.kind === "ruin" ? "Broken stone walls and a ruined tower" : "Standing stones around a central altar";
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
  marker.innerHTML = `
    <span class="site-glyph" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></span>
    <span class="site-label">${site.name}</span>`;
  marker.onclick = () => selectSite(site.code);
  document.getElementById("critical-site-layer")!.append(marker);
  markerNodes.set(site.code, marker);
  return marker;
}

function labelObstacles(): Rect[] {
  const selectors = [
    "#masthead",
    "#region-panel",
    "#cell-panel",
    "#travel-panel",
    "#critical-site-panel:not([hidden])",
    "#bottom-bar",
    "#map-controls",
    "#telemetry",
    "#focus-coordinates",
    "#centre-marker",
    "#political-labels .political-label",
  ];
  const rects = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter((node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    })
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  lastPoliticalObstacleCount = document.querySelectorAll("#political-labels .political-label").length;
  return rects;
}

/** Estimate used only when the label has no layout box yet. */
function labelWidth(site: CriticalSite) {
  const textWidth = 28 + site.name.length * (innerWidth < 620 ? 5.4 : 6.2);
  return Math.min(innerWidth < 620 ? 150 : 240, Math.max(72, textWidth));
}

const SVG_NS = "http://www.w3.org/2000/svg";

function appendLine(
  layer: SVGSVGElement,
  className: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("class", className);
  layer.append(line);
}

function appendAnchor(layer: SVGSVGElement, x: number, y: number) {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", "4.5");
  dot.setAttribute("class", "site-anchor");
  layer.append(dot);
}

type SitePlacement = {
  entry: PlacementSite;
  rect: Rect;
  /** Distance from the true site to the glyph centre, in px. */
  shift: number;
};

const RING_STEP = 16;
const RING_MAX = 480;
const RING_DIRECTIONS = 16;
// Cardinal directions first so ties between equal distances are deterministic.
const RING_ORDER = [12, 4, 0, 8, 14, 10, 2, 6, 13, 11, 5, 3, 15, 9, 1, 7];

/**
 * Deterministic declutter: the glyph centre starts on the true site and, when
 * the box collides, moves outward ring by ring so the nearest free slot wins
 * (normally well inside ~120 px desktop / ~90 px phone). When nothing close is
 * free the nearest free ring or grid slot further out is used, so no site is
 * ever hidden.
 */
function placeSites(
  entries: { entry: PlacementSite; width: number; height: number }[],
  obstacles: Rect[],
): SitePlacement[] {
  const occupied = [...obstacles];
  return [...entries]
    .sort((a, b) => (a.entry.placementId < b.entry.placementId ? -1 : a.entry.placementId > b.entry.placementId ? 1 : 0))
    .map(({ entry, width, height }) => {
      const w = Math.min(width, innerWidth - 16),
        h = height,
        px = entry.point.x,
        py = entry.point.y,
        at = (cx: number, cy: number): Rect => ({
          x: Math.max(8, Math.min(innerWidth - w - 8, cx - 22)),
          y: Math.max(8, Math.min(innerHeight - h - 8, cy - 22)),
          width: w,
          height: h,
        }),
        free = (r: Rect) => !occupied.some((o) => overlaps(r, o, 5));
      let rect: Rect | null = null;
      for (let radius = 0; radius <= RING_MAX && !rect; radius += RING_STEP) {
        const count = radius === 0 ? 1 : RING_DIRECTIONS;
        for (let i = 0; i < count; i++) {
          const angle = (RING_ORDER[i] / RING_DIRECTIONS) * Math.PI * 2,
            candidate = at(px + Math.cos(angle) * radius, py + Math.sin(angle) * radius);
          if (free(candidate)) {
            rect = candidate;
            break;
          }
        }
      }
      if (!rect) {
        // Crowded viewport: nearest free coarse grid slot, else least displaced.
        let best: Rect | null = null,
          bestDistance = Infinity;
        for (let y = 8; y <= innerHeight - h - 8; y += 12)
          for (let x = 8; x <= innerWidth - w - 8; x += 24) {
            const candidate = { x, y, width: w, height: h },
              distance = Math.hypot(x + 22 - px, y + 22 - py);
            if (distance < bestDistance && free(candidate)) {
              best = candidate;
              bestDistance = distance;
            }
          }
        rect = best ?? at(px, py);
      }
      occupied.push(rect);
      return { entry, rect, shift: Math.hypot(rect.x + 22 - px, rect.y + 22 - py) };
    });
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
    document.querySelector<SVGSVGElement>("#critical-site-access")!.replaceChildren();
    lastVisibleCodes = [];
    return requestAnimationFrame(render);
  }

  const radius = Math.hypot(view.halfHeight * view.aspect, view.halfHeight) * 1.35,
    visible = nearbyCriticalSites(view.x, view.z, radius, innerWidth < 600 ? 8 : 14),
    politicalFingerprint = (window.politicalAtlas?.state?.labels ?? [])
      .map((label: any) => `${label.id}/${Math.round(label.x)}/${Math.round(label.y)}`)
      .join("|"),
    fingerprint = `${Math.round(view.x)}/${Math.round(view.z)}/${Math.round(view.halfHeight)}/${Math.round(view.yaw * 1000)}/${innerWidth}/${innerHeight}/${visible.map((s) => s.code).join("|")}/${politicalFingerprint}`;
  if (fingerprint !== lastFingerprint) {
    lastFingerprint = fingerprint;
    const visibleSet = new Set(visible.map((site) => site.code)),
      accessLayer = document.querySelector<SVGSVGElement>("#critical-site-access")!;
    accessLayer.replaceChildren();
    for (const marker of markerNodes.values()) marker.hidden = !visibleSet.has(marker.dataset.code!);

    const eligible: PlacementSite[] = [];
    for (const site of visible) {
      const point = project(site.x, site.z, view),
        accessPoint = project(site.access.x, site.access.z, view),
        marker = markerFor(site),
        detailed =
          view.halfHeight <= 700 &&
          Math.hypot(wrapSourceX(site.x - view.x), site.z - view.z) <= 1200;
      marker.classList.toggle("detailed", detailed);
      if (detailed) {
        const detail = detailFor(site);
        marker.style.setProperty("--site-variant", String(detail.stones));
      }
      const inView =
        point.x >= 22 &&
        point.x <= innerWidth - 22 &&
        point.y >= 82 &&
        point.y <= innerHeight - 105;
      marker.hidden = !inView;
      if (!inView) continue;
      const rank = selectedCode === site.code ? 0 : site.kind === "critical-place" ? 1 : 2;
      eligible.push({
        site,
        point,
        accessPoint,
        detailed,
        placementId: `${rank}/${site.code}`,
      });
    }

    // Measure the real label box (wrapping included) so declutter matches what is drawn.
    const sized = eligible.map((entry) => {
      const marker = markerNodes.get(entry.site.code)!;
      marker.hidden = false;
      const label = marker.querySelector<HTMLElement>(".site-label"),
        labelW = label?.offsetWidth || labelWidth(entry.site),
        labelH = label?.offsetHeight || 22;
      return { entry, width: 46 + labelW, height: Math.max(44, 10 + labelH) };
    });
    const placements = placeSites(sized, labelObstacles());

    lastVisibleCodes = [];
    for (const placement of placements) {
      const entry = placement.entry,
        marker = markerNodes.get(entry.site.code)!,
        cx = placement.rect.x + 22,
        cy = placement.rect.y + 22;
      marker.hidden = false;
      marker.style.transform = `translate(${Math.round(cx)}px,${Math.round(cy)}px)`;
      lastVisibleCodes.push(entry.site.code);
      // The site is in view (eligible), so its access line is always drawn;
      // the SVG clips it when the junction projects off-screen.
      const accessClass = entry.site.kind === "ruin" ? "ruin-access" : "critical-access";
      appendLine(accessLayer, "access-casing", entry.point.x, entry.point.y, entry.accessPoint.x, entry.accessPoint.y);
      appendLine(accessLayer, accessClass, entry.point.x, entry.point.y, entry.accessPoint.x, entry.accessPoint.y);
      if (placement.shift > 18) {
        // Callout from the displaced glyph edge back to the true site.
        const ux = (entry.point.x - cx) / placement.shift,
          uy = (entry.point.y - cy) / placement.shift,
          startX = cx + ux * 17,
          startY = cy + uy * 17;
        appendLine(accessLayer, "site-label-leader-halo", startX, startY, entry.point.x, entry.point.y);
        appendLine(accessLayer, "site-label-leader", startX, startY, entry.point.x, entry.point.y);
        appendAnchor(accessLayer, entry.point.x, entry.point.y);
      }
    }
    if (selectedCode && !criticalSites.some((site) => site.code === selectedCode)) selectSite(null);
  }
  requestAnimationFrame(render);
}

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
        detailedCount: lastVisibleCodes.filter((code) => detailCache.has(code)).length,
        cachedDetails: detailCache.size,
        detailCacheLimit: DETAIL_CACHE_LIMIT,
        declutterSystem: "navigation.placeLabels",
        politicalObstacleCount: lastPoliticalObstacleCount,
      };
    },
  },
  configurable: false,
  writable: false,
});

requestAnimationFrame(render);
