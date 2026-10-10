import "./site-experience.css";
import { criticalSites, nearbyCriticalSites, siteAcceptanceSummary, type CriticalSite } from "./sites.ts";
import { wrapSourceX } from "./planet.ts";

declare global {
  interface Window {
    advisorWorld?: any;
    advisorSites?: any;
  }
}

type SiteDetail = {
  signature: string;
  stones: number;
  walls: number;
  props: number;
};

const markerNodes = new Map<string, HTMLButtonElement>();
const detailCache = new Map<string, SiteDetail>();
let selectedCode: string | null = null;
let lastFingerprint = "";
let lastVisibleCodes: string[] = [];

function detailFor(site: CriticalSite): SiteDetail {
  let detail = detailCache.get(site.code);
  if (!detail) {
    const variant = site.variant;
    detail = {
      signature: `${site.code}/${site.archetype}/${variant % 97}/${site.radiusM}`,
      stones: site.kind === "ruin" ? 4 + (variant % 5) : 5 + (variant % 7),
      walls: site.kind === "ruin" ? 3 + (variant % 4) : 0,
      props: 2 + (variant % 4),
    };
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

  const access = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  access.id = "critical-site-access";
  access.setAttribute("aria-hidden", "true");
  document.body.append(access);

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
    <div class="region-actions"><button id="focus-critical-site">Focus site</button></div>
    <p class="hint">Inspection reveals existing SEED-defined data; it never creates or rerolls this place.</p>`;
  document.body.append(panel);
  panel.querySelector<HTMLButtonElement>("#close-critical-site")!.onclick = () => selectSite(null);
  panel.querySelector<HTMLButtonElement>("#focus-critical-site")!.onclick = () => {
    const site = criticalSites.find((item) => item.code === selectedCode);
    if (!site || !window.advisorWorld) return;
    window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
    window.advisorWorld.setHalfHeight(420);
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
  (document.getElementById("critical-site-archetype") as HTMLElement).textContent = site.archetype.replaceAll("-", " ");
  (document.getElementById("critical-site-road") as HTMLElement).textContent = site.access.roadCode;
  (document.getElementById("critical-site-distance") as HTMLElement).textContent = `${Math.round(site.access.lengthM)} m to legal road junction`;
  (document.getElementById("critical-site-ground") as HTMLElement).textContent = `${site.radiusM} m usable core + ${site.falloffM} m blend`;
  (document.getElementById("critical-site-residency") as HTMLElement).textContent = `${detail.signature} · focused only`;
  for (const [id, marker] of markerNodes) marker.setAttribute("aria-pressed", id === code ? "true" : "false");
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
    (document.getElementById("critical-site-access") as SVGSVGElement).replaceChildren();
    lastVisibleCodes = [];
    return requestAnimationFrame(render);
  }

  const radius = Math.hypot(view.halfHeight * view.aspect, view.halfHeight) * 1.35,
    visible = nearbyCriticalSites(view.x, view.z, radius, innerWidth < 600 ? 8 : 14),
    fingerprint = `${Math.round(view.x)}/${Math.round(view.z)}/${Math.round(view.halfHeight)}/${Math.round(view.yaw * 1000)}/${innerWidth}/${innerHeight}/${visible.map((s) => s.code).join("|")}`;
  if (fingerprint !== lastFingerprint) {
    lastFingerprint = fingerprint;
    const visibleSet = new Set(visible.map((site) => site.code)),
      accessLayer = document.getElementById("critical-site-access") as SVGSVGElement;
    accessLayer.replaceChildren();
    for (const marker of markerNodes.values()) marker.hidden = !visibleSet.has(marker.dataset.code!);
    for (const site of visible) {
      const point = project(site.x, site.z, view),
        accessPoint = project(site.access.x, site.access.z, view),
        marker = markerFor(site),
        detailed = view.halfHeight <= 700 && Math.hypot(wrapSourceX(site.x - view.x), site.z - view.z) <= 1200;
      marker.hidden =
        point.x < 12 || point.x > innerWidth - 12 || point.y < 82 || point.y > innerHeight - 104;
      marker.style.transform = `translate(${Math.round(point.x)}px,${Math.round(point.y)}px)`;
      marker.classList.toggle("detailed", detailed);
      if (detailed) {
        const detail = detailFor(site);
        marker.style.setProperty("--site-variant", String(detail.stones));
      }
      if (!marker.hidden && accessPoint.x > 0 && accessPoint.x < innerWidth && accessPoint.y > 0 && accessPoint.y < innerHeight) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(point.x));
        line.setAttribute("y1", String(point.y));
        line.setAttribute("x2", String(accessPoint.x));
        line.setAttribute("y2", String(accessPoint.y));
        line.classList.add(site.kind === "ruin" ? "ruin-access" : "critical-access");
        accessLayer.append(line);
      }
    }
    lastVisibleCodes = visible.filter((site) => !markerNodes.get(site.code)?.hidden).map((site) => site.code);
    if (selectedCode && !criticalSites.some((site) => site.code === selectedCode)) selectSite(null);
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
          detailedCount: lastVisibleCodes.filter((code) => detailCache.has(code)).length,
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
