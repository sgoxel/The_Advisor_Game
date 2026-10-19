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
    politicalAtlas?: { state: { labelLayoutRevision?: number } };
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

type SitePlacement = {
  entry: PlacementSite;
  rect: Rect;
  shift: number;
};

const DETAIL_CACHE_LIMIT = 48;
const MARKER_NODE_LIMIT = 48;
const MOBILE_SITE_LIMIT = 6;
const DESKTOP_SITE_LIMIT = 12;
const SVG_NS = "http://www.w3.org/2000/svg";
const markerNodes = new Map<string, HTMLButtonElement>();
const detailCache = new Map<string, SiteDetail>();
let selectedCode: string | null = null;
let selectedSite: CriticalSite | null = null;
let lastFingerprint = "";
let lastVisibleCodes: string[] = [];
let lastPoliticalObstacleCount = 0;
let framePending = false;
let uiLayoutRevision = 0;
let placementPassCount = 0;
let obstacleMeasureCount = 0;
let nearbyQueryCount = 0;
// Reuse only the exact current-view SEED query. Camera/zoom/viewport changes
// recompute normally; the one-entry cache never affects site ownership or order.
let nearbyViewCache: {
  x: number; z: number; radius: number; limit: number; sites: CriticalSite[];
} | null = null;

function sitesInView(x: number, z: number, radius: number, limit: number) {
  const cached = nearbyViewCache;
  if (cached && cached.x === x && cached.z === z &&
      cached.radius === radius && cached.limit === limit) return cached.sites;
  const sites = nearbyCriticalSites(x, z, radius, limit);
  nearbyViewCache = { x, z, radius, limit, sites };
  nearbyQueryCount++;
  return sites;
}

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

  const access = document.createElementNS(SVG_NS, "svg");
  access.id = "critical-site-access";
  access.setAttribute("aria-hidden", "true");
  document.body.append(access);

  const layer = document.createElement("div");
  layer.id = "critical-site-layer";
  layer.setAttribute("aria-label", "Discoverable ruins and critical places");
  document.body.append(layer);

  const panel = document.createElement("aside");
  panel.id = "critical-site-panel";
  panel.className = "panel critical-site-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="eyebrow"><span id="critical-site-eyebrow">IMPORTANT PLACE</span><button id="close-critical-site" aria-label="Close important-place inspector">×</button></div>
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
    <p class="hint">Inspection reveals existing SEED-defined data; it never creates or rerolls this place.</p>
    <p id="critical-site-scroll-cue" class="site-scroll-cue" aria-hidden="true" hidden>Scroll for more details ↓</p>`;
  document.body.append(panel);

  panel.querySelector<HTMLButtonElement>("#close-critical-site")!.onclick = () => selectSite(null);
  panel.querySelector<HTMLButtonElement>("#focus-critical-site")!.onclick = () => {
    const site = criticalSites.find((item) => item.code === selectedCode);
    if (!site || !window.advisorWorld) return;
    window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
    window.advisorWorld.setHalfHeight(420);
  };

  // Panel and HUD geometry invalidates site placement only when materially changed.
  // Political labels have their own post-layout revision, read in render().
  const tracked = ["#region-panel", "#cell-panel", "#travel-panel",
    "#critical-site-panel", ".masthead", ".bottom-bar", ".map-controls",
    ".telemetry", "#focus-coordinates", "#centre-marker"]
    .map(selector => document.querySelector<HTMLElement>(selector))
    .filter((node): node is HTMLElement => Boolean(node));
  const changed = () => { uiLayoutRevision++; };
  const changes = new MutationObserver(changed);
  const sizes = new ResizeObserver((entries) => {
    changed();
    if (entries.some(entry => entry.target === panel)) updateSiteScrollCue();
  });
  for (const node of tracked) {
    changes.observe(node, { attributes: true, attributeFilter: ["class", "hidden"] });
    sizes.observe(node);
  }
  panel.addEventListener("scroll", updateSiteScrollCue, { passive: true });
  // React synchronously to the political renderer's final label transforms.
  // Its explicit revision event fires only for material placement changes.
  window.addEventListener("advisor-political-label-layout", () => {
    uiLayoutRevision++;
    render();
  });
}

function updateSiteScrollCue() {
  const panel = document.getElementById("critical-site-panel");
  const cue = document.getElementById("critical-site-scroll-cue");
  if (!panel || !cue || panel.hidden) return;
  const cueHeight = cue.hidden ? 0 : cue.getBoundingClientRect().height;
  const overflow = panel.scrollHeight - cueHeight - panel.clientHeight;
  const remaining = panel.scrollHeight - panel.clientHeight - panel.scrollTop;
  cue.hidden = overflow <= 8 || remaining <= cueHeight + 8;
}

function selectSite(code: string | null) {
  const nextSite = code ? criticalSites.find(site => site.code === code) : null;
  // An unknown code cannot supersede a valid inspection or its canonical focus.
  if (code && !nextSite) return;
  selectedCode = code;
  selectedSite = nextSite ?? null;
  lastFingerprint = "";
  const panel = document.getElementById("critical-site-panel") as HTMLElement | null;
  if (!panel) return;
  document.getElementById("critical-site-layer")?.classList.toggle("inspecting", Boolean(code));
  if (!code) {
    panel.hidden = true;
    for (const marker of markerNodes.values()) marker.setAttribute("aria-pressed", "false");
    return;
  }
  const site = selectedSite;
  if (!site) return;
  detailFor(site);
  panel.hidden = false;
  panel.scrollTop = 0;
  (document.getElementById("critical-site-eyebrow") as HTMLElement).textContent =
    site.kind === "ruin" ? "RUIN" : "IMPORTANT PLACE";
  (document.getElementById("critical-site-name") as HTMLElement).textContent = site.name;
  (document.getElementById("critical-site-kind") as HTMLElement).textContent =
    site.kind === "ruin" ? "Historic ruin" : "Important place";
  (document.getElementById("critical-site-code") as HTMLElement).textContent = site.code;
  (document.getElementById("critical-site-country") as HTMLElement).textContent = site.countryName;
  (document.getElementById("critical-site-archetype") as HTMLElement).textContent =
    site.archetype.replaceAll("-", " ");
  (document.getElementById("critical-site-road") as HTMLElement).textContent = site.access.roadCode;
  (document.getElementById("critical-site-distance") as HTMLElement).textContent =
    `${Math.round(site.access.lengthM)} m to legal road junction`;
  (document.getElementById("critical-site-ground") as HTMLElement).textContent =
    `${Math.round(site.radiusM)} m usable core + ${Math.round(site.falloffM)} m blend`;
  (document.getElementById("critical-site-residency") as HTMLElement).textContent =
    site.kind === "ruin"
      ? "Broken stone walls and a ruined tower"
      : "Standing stones around a central altar";
  for (const [id, marker] of markerNodes)
    marker.setAttribute("aria-pressed", id === code ? "true" : "false");
  requestAnimationFrame(updateSiteScrollCue);
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
  const glyph = document.createElement("span"),
    label = document.createElement("span");
  glyph.className = "site-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = "<i></i><i></i><i></i><i></i><b></b>";
  label.className = "site-label";
  label.textContent = site.name;
  marker.append(glyph, label);
  marker.onclick = () => selectSite(site.code);
  document.getElementById("critical-site-layer")!.append(marker);
  markerNodes.set(site.code, marker);
  return marker;
}

// Keep only bounded, reusable DOM markers across atlas navigation.
function pruneMarkerNodes(visible: Set<string>) {
  for (const [code, node] of markerNodes) {
    if (markerNodes.size <= MARKER_NODE_LIMIT) break;
    if (code === selectedCode || visible.has(code)) continue;
    node.remove();
    markerNodes.delete(code);
  }
}

const obstacleSelectors = [
  ".masthead",
  "#region-panel",
  "#cell-panel",
  "#travel-panel",
  "#critical-site-panel:not([hidden])",
  ".bottom-bar",
  ".map-controls",
  ".telemetry",
  "#focus-coordinates",
  "#centre-marker",
  "#political-labels .political-label",
];

type SiteObstacle = Rect & { focusCrosshair: boolean };
function labelObstacles(): SiteObstacle[] {
  obstacleMeasureCount++;
  const nodes = obstacleSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  lastPoliticalObstacleCount = document.querySelectorAll("#political-labels .political-label").length;
  return nodes
    .filter((node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    })
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .map(({ node, rect }) => ({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      focusCrosshair: node.id === "centre-marker",
    }));
}

function labelWidth(site: CriticalSite) {
  const textWidth = 24 + site.name.length * (innerWidth < 620 ? 4.7 : 6.0);
  return Math.min(innerWidth < 620 ? 108 : 220, Math.max(70, textWidth));
}

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
  dot.setAttribute("r", "3");
  dot.setAttribute("class", "site-anchor");
  layer.append(dot);
}

const RING_STEP = 12;
const RING_MAX = 300;
const RING_DIRECTIONS = 16;
const RING_ORDER = [12, 4, 0, 8, 14, 10, 2, 6, 13, 11, 5, 3, 15, 9, 1, 7];

type SiteLeader = { x1: number; y1: number; x2: number; y2: number };
function candidateLeader(entry: PlacementSite, rect: Rect): SiteLeader | null {
  const cx = rect.x + 22, cy = rect.y + 22,
    shift = Math.hypot(cx - entry.point.x, cy - entry.point.y);
  if (shift <= 24) return null;
  const ux = (entry.point.x - cx) / shift,
    uy = (entry.point.y - cy) / shift;
  return { x1: cx + ux * 16, y1: cy + uy * 16, x2: entry.point.x, y2: entry.point.y };
}

function placeSites(
  entries: { entry: PlacementSite; width: number; height: number; inspecting: boolean }[],
  obstacles: SiteObstacle[],
): SitePlacement[] {
  const occupied = [...obstacles],
    reservedLeaders: SiteLeader[] = [];
  return [...entries]
    .sort((a, b) =>
      a.entry.placementId < b.entry.placementId ? -1 : a.entry.placementId > b.entry.placementId ? 1 : 0,
    )
    .flatMap(({ entry, width, height, inspecting }) => {
      const w = Math.min(width, innerWidth - 16),
        h = Math.min(height, innerHeight - 16),
        preferredX = entry.point.x + (inspecting ? 0 : entry.detailed ? -42 : 0),
        preferredY = entry.point.y + (inspecting ? 0 : entry.detailed ? -34 : 0),
        at = (cx: number, cy: number): Rect => ({
          x: Math.max(8, Math.min(innerWidth - w - 8, cx - 22)),
          y: Math.max(8, Math.min(innerHeight - h - 8, cy - 22)),
          width: w,
          height: h,
        }),
        free = (rect: Rect) => {
          // The selected 44px inspection glyph owns its canonical focus anchor.
          // It may cover that one non-interactive crosshair, never a panel,
          // political card, or another site's reserved label/leader.
          if (occupied.some((other) =>
            !(inspecting && other.focusCrosshair &&
              entry.point.x >= other.x && entry.point.x <= other.x + other.width &&
              entry.point.y >= other.y && entry.point.y <= other.y + other.height) &&
            overlaps(rect, other, 5))) return false;
          const leader = candidateLeader(entry, rect);
          // A site anchor can legitimately sit beneath the focus crosshair.
          // Only its own anchored leader may enter that crosshair; all other
          // site labels, HUD/political obstacles, and occupied slots still count.
          const leaderObstacles = occupied.filter((other) => !other.focusCrosshair ||
            entry.point.x < other.x || entry.point.x > other.x + other.width ||
            entry.point.y < other.y || entry.point.y > other.y + other.height);
          return (!leader || leaderClear(leader.x1, leader.y1, leader.x2, leader.y2, leaderObstacles)) &&
            reservedLeaders.every(line => leaderClear(line.x1, line.y1, line.x2, line.y2, [rect]));
        };
      let rect: Rect | null = null;
      for (let radius = 0; radius <= RING_MAX && !rect; radius += RING_STEP) {
        const count = radius === 0 ? 1 : RING_DIRECTIONS;
        for (let index = 0; index < count; index++) {
          const angle = (RING_ORDER[index] / RING_DIRECTIONS) * Math.PI * 2,
            candidate = at(
              preferredX + Math.cos(angle) * radius,
              preferredY + Math.sin(angle) * radius,
            );
          if (free(candidate)) {
            rect = candidate;
            break;
          }
        }
      }
      if (!rect) {
        let nearest: Rect | null = null,
          nearestDistance = Infinity;
        for (let y = 8; y <= innerHeight - h - 8; y += 10)
          for (let x = 8; x <= innerWidth - w - 8; x += 12) {
            const candidate = { x, y, width: w, height: h },
              distance = Math.hypot(x + 22 - preferredX, y + 22 - preferredY);
            if (distance < nearestDistance && free(candidate)) {
              nearest = candidate;
              nearestDistance = distance;
            }
          }
        rect = nearest;
      }
      // Never replace a failed free-slot search with an overlapping marker.
      // Higher-priority nearby sites have already reserved their own space.
      if (!rect) return [];
      occupied.push({ ...rect, focusCrosshair: false });
      const leader = candidateLeader(entry, rect);
      if (leader) reservedLeaders.push(leader);
      return [{
        entry,
        rect,
        shift: Math.hypot(rect.x + 22 - entry.point.x, rect.y + 22 - entry.point.y),
      }];
    });
}

function leaderClear(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Rect[],
) {
  // Exact segment/rectangle clipping, including narrow obstacles and endpoints.
  const dx = x2 - x1, dy = y2 - y1;
  return !obstacles.some((rect) => {
    const gap = 4,
      left = rect.x - gap,
      right = rect.x + rect.width + gap,
      top = rect.y - gap,
      bottom = rect.y + rect.height + gap;
    let start = 0, end = 1;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) start = Math.max(start, t);
      else end = Math.min(end, t);
      return start <= end;
    };
    return clip(-dx, x1 - left) && clip(dx, right - x1) &&
      clip(-dy, y1 - top) && clip(dy, bottom - y1);
  });
}

function scheduleRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    render();
  });
}

function render() {
  ensureUi();
  const world = window.advisorWorld;
  if (!world?.state?.ready) return scheduleRender();
  const state = world.state,
    view = state.view,
    denominator = Number(String(state.scaleLabel).replace("1/", "")),
    flat = state.presentation === "flat";

  if (!flat || !Number.isFinite(denominator) || denominator > 1000) {
    // Transition out once; subsequent unchanged wide-view frames must not
    // rewrite every marker and SVG child list.
    if (lastFingerprint || lastVisibleCodes.length) {
      for (const marker of markerNodes.values())
        if (!marker.hidden) marker.hidden = true;
      const access = document.querySelector<SVGSVGElement>("#critical-site-access")!;
      if (access.childElementCount) access.replaceChildren();
      lastVisibleCodes = [];
      lastFingerprint = "";
    }
    return scheduleRender();
  }

  const radius = Math.hypot(view.halfHeight * view.aspect, view.halfHeight) * 1.35,
    limit = innerWidth < 600 ? MOBILE_SITE_LIMIT : DESKTOP_SITE_LIMIT,
    queried = sitesInView(view.x, view.z, radius, limit),
    // Selection has first placement priority. Preserve it within the existing
    // bounded discovery budget even when nearer unselected sites fill the query.
    selectedInView = selectedSite,
    visible = selectedInView &&
      Math.hypot(wrapSourceX(selectedInView.x - view.x), selectedInView.z - view.z) <= radius &&
      !queried.some(site => site.code === selectedInView.code)
        ? [...queried.slice(0, limit - 1), selectedInView]
        : queried,
    fingerprint = [
      Math.round(view.x),
      Math.round(view.z),
      Math.round(view.halfHeight),
      Math.round(view.yaw * 1000),
      innerWidth,
      innerHeight,
      selectedCode ?? "",
      visible.map((site) => site.code).join("|"),
      window.politicalAtlas?.state?.labelLayoutRevision ?? 0,
      uiLayoutRevision,
    ].join("/");

  if (fingerprint !== lastFingerprint) {
    lastFingerprint = fingerprint;
    placementPassCount++;
    const obstacles = labelObstacles();
    // A guide starts at the canonical site anchor, which may sit exactly
    // beneath the focus crosshair; unrelated HUD/political cards still occlude.
    const guideObstacles = obstacles.filter(rect => !rect.focusCrosshair);
    const visibleSet = new Set(visible.map((site) => site.code)),
      accessLayer = document.querySelector<SVGSVGElement>("#critical-site-access")!;
    accessLayer.replaceChildren();
    for (const marker of markerNodes.values()) marker.hidden = !visibleSet.has(marker.dataset.code!);

    const eligible: PlacementSite[] = [];
    for (let index = 0; index < visible.length; index++) {
      const site = visible[index],
        point = project(site.x, site.z, view),
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
        point.y >= 72 &&
        point.y <= innerHeight - 92;
      marker.hidden = !inView;
      if (!inView) continue;
      const selectedRank = selectedCode === site.code ? 0 : 1;
      eligible.push({
        site,
        point,
        accessPoint,
        detailed,
        placementId: `${selectedRank}/${String(index).padStart(2, "0")}/${site.code}`,
      });
    }

    const inspectorOpen = !document.getElementById("critical-site-panel")!.hidden;
    const sized = eligible.map((entry) => {
      const marker = markerNodes.get(entry.site.code)!;
      // The open inspector already names the selected site. Its map context
      // remains an operable glyph without reserving a duplicate large label.
      const inspecting = inspectorOpen && entry.site.code === selectedCode;
      marker.classList.toggle("inspecting", inspecting);
      marker.hidden = false;
      const label = marker.querySelector<HTMLElement>(".site-label"),
        labelW = label?.offsetWidth || labelWidth(entry.site),
        labelH = label?.offsetHeight || 22;
      return { entry, inspecting, width: inspecting ? 44 : 46 + labelW,
        height: inspecting ? 44 : Math.max(44, 10 + labelH) };
    });
    const placements = placeSites(sized, obstacles),
      placedCodes = new Set(placements.map(p => p.entry.site.code));
    for (const entry of eligible)
      if (!placedCodes.has(entry.site.code))
        markerNodes.get(entry.site.code)!.hidden = true;

    lastVisibleCodes = [];
    for (const placement of placements) {
      const entry = placement.entry,
        marker = markerNodes.get(entry.site.code)!,
        cx = placement.rect.x + 22,
        cy = placement.rect.y + 22;
      marker.hidden = false;
      marker.style.transform = `translate(${Math.round(cx)}px,${Math.round(cy)}px)`;
      lastVisibleCodes.push(entry.site.code);

      // This is a cartographic hint, not physical road geometry. Do not draw
      // a clipped line toward an off-screen junction: that would falsely read
      // as a disconnected physical road. Detailed scale uses the actual mesh.
      const junctionVisible =
        entry.accessPoint.x > 0 && entry.accessPoint.x < innerWidth &&
        entry.accessPoint.y > 0 && entry.accessPoint.y < innerHeight;
      // A cartographic access guide must not cut through another site's
      // reserved callout. The current site's own marker encloses its anchor.
      const guideClearance = placements
        .filter(other => other.entry.site.code !== entry.site.code)
        .map(other => other.rect);
      if (!entry.detailed && junctionVisible &&
          leaderClear(entry.point.x, entry.point.y,
            entry.accessPoint.x, entry.accessPoint.y,
            [...guideObstacles, ...guideClearance])) {
        const accessClass = entry.site.kind === "ruin" ? "ruin-access" : "critical-access";
        appendLine(
          accessLayer,
          accessClass,
          entry.point.x,
          entry.point.y,
          entry.accessPoint.x,
          entry.accessPoint.y,
        );
      }

      const leader = candidateLeader(entry, placement.rect);
      // Each accepted displacement has already reserved an unobstructed
      // segment, including against every other accepted site rectangle.
      if (leader) {
        appendLine(accessLayer, "site-label-leader-halo",
          leader.x1, leader.y1, leader.x2, leader.y2);
        appendLine(accessLayer, "site-label-leader",
          leader.x1, leader.y1, leader.x2, leader.y2);
        if (!entry.detailed) appendAnchor(accessLayer, entry.point.x, entry.point.y);
      }
    }
    pruneMarkerNodes(visibleSet);
  }
  scheduleRender();
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
        cachedMarkers: markerNodes.size,
        markerNodeLimit: MARKER_NODE_LIMIT,
        declutterSystem: "critical-sites.nearest-free",
        politicalObstacleCount: lastPoliticalObstacleCount,
        placementPassCount,
        obstacleMeasureCount,
        nearbyQueryCount,
        uiLayoutRevision,
      };
    },
  },
  configurable: false,
  writable: false,
});

scheduleRender();