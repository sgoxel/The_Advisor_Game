import { boundaryPoint, logicalRegion } from "./continuity.ts";
import { inspectRegion, continuityTelemetry } from "./continuity-runtime.ts";
import { lonLatToSource, type LonLat } from "./planet.ts";
import type { RouteProjector } from "./route-overlay.ts";
let enabled = false, minimized = false, overlay: HTMLDivElement | undefined, cached: ReturnType<typeof inspectRegion> | undefined;
let drawing: HTMLDivElement, panel: HTMLDivElement, toggle: HTMLButtonElement, details: HTMLPreElement;
export function setContinuityOverlay(value: boolean) { enabled = value; if (overlay) overlay.hidden = !value; }
export function continuityOverlayBytes() { return cached ? 5120 + cached.ports.length*8192 : 0; }
export function updateContinuityOverlay(project: RouteProjector, focus: LonLat, streaming: { pending: number; prepared: number; active: number; cached: number }) {
  if (!enabled) return;
  if (!overlay) {
    overlay = document.createElement("div"); overlay.id = "continuity-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:25;pointer-events:none";
    drawing = document.createElement("div"); drawing.style.cssText = "position:absolute;inset:0";
    panel = document.createElement("div");
    toggle = document.createElement("button"); toggle.id = "continuity-minimize";
    toggle.style.cssText = "pointer-events:auto;min-height:44px;min-width:44px;display:block;border:1px solid #91ac99;border-radius:4px;color:#eff9df;background:#263f35;cursor:pointer;padding:8px;font:13px system-ui";
    toggle.onclick = () => { minimized = !minimized; updateVisibility(); };
    details = document.createElement("pre"); details.style.cssText = "margin:8px 0 0;font:12px monospace;white-space:pre-wrap";
    panel.append(toggle, details); overlay.append(drawing,panel);
    document.body.append(overlay);
  }
  overlay.hidden = false;
  panel.style.cssText = `position:absolute;right:64px;${innerWidth < 700 || innerHeight < 600 ? "bottom:94px;max-width:164px" : "top:130px;max-width:450px"};max-height:calc(100vh - 205px);overflow:auto;pointer-events:auto;background:#172b28ee;color:#eff9df;padding:10px;font:12px monospace;white-space:pre-wrap`;
  updateVisibility();
  if(minimized)return;
  const region = logicalRegion(focus);
  if (cached?.region.id !== region.id) cached = inspectRegion(focus);
  const screen = (position: LonLat) => { const p = lonLatToSource(position.lon, position.lat); return project({ ...position, ...p }); }, shapes: string[] = [];
  for (const edge of cached.edges) {
    const points = Array.from({length: 9}, (_, i) => screen(boundaryPoint(edge, i / 8))).filter(p => p !== undefined);
    if (points.length > 1) shapes.push(`<polyline points="${points.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#61e0e8" stroke-width="2"/>`);
  }
  for (const port of cached.ports) {
    const p = screen(port.position);
    if (p) shapes.push(`<circle cx="${p.x}" cy="${p.y}" r="8" fill="${port.status === "legal" ? "#ffd778" : "#ff756b"}" stroke="#182b28" stroke-width="2"/>`);
  }
  const telemetry = continuityTelemetry();
  drawing.innerHTML = `<svg width="100%" height="100%" aria-hidden="true">${shapes.join("")}</svg>`;
  details.textContent = `Continuity inspection\nF${region.face} / L${region.level} / ${region.u},${region.v}\nPorts ${cached.ports.length} (${cached.ports.filter(p => p.status === "legal").length} legal)\nQueued ${streaming.pending} / prepared ${streaming.prepared}\nActive ${streaming.active} / cached ${streaming.cached}\nFine queries ${telemetry.fineSamples + telemetry.portSamples}\nRecursive neighbors ${telemetry.recursiveRequests}\n${cached.ports.slice(0,2).map(p => `${p.featureId.split("/").slice(-4).join("/")}\n${p.elevationM} m / ${p.status}`).join("\n")}`;
  updateVisibility();
}
function updateVisibility() {
  if (!toggle) return;
  drawing.hidden = details.hidden = minimized;
  toggle.textContent = minimized ? "Show inspection" : "Minimize";
  toggle.setAttribute("aria-label", minimized ? "Show continuity inspection" : "Minimize continuity inspection");
  toggle.setAttribute("aria-expanded",String(!minimized));
}
