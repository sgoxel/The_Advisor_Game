/**
 * Selected-route overlay (WP-S002-004-008). The route geometry is canonical
 * (lon/lat from routing.ts); this module only projects it to the screen each
 * frame through a projector supplied by the renderer. It never decides routes,
 * and drawing costs one SVG polyline update, not a route recomputation.
 */
import { lonLatToSource, type LonLat } from "./planet.ts";

export type OverlayPoint = {
  lon: number;
  lat: number;
  /** Derived source/render coordinates (presentation only). */
  x: number;
  z: number;
  /** Lazily cached ground height used by the projector. */
  height?: number;
};
export type ScreenPoint = { x: number; y: number };
export type RouteProjector = (point: OverlayPoint) => ScreenPoint | undefined;

type ActiveRoute = { points: OverlayPoint[]; tag: string; id: string };

let active: ActiveRoute | null = null;
let lastShape = "";
let lastTag = "";
let lastTagSize = "";
let tagAnchor: ScreenPoint | undefined;
let tagLine: ScreenPoint[] = [];
let nodes:
  | {
      svg: SVGSVGElement;
      casing: SVGPolylineElement;
      line: SVGPolylineElement;
      start: SVGCircleElement;
      finish: SVGCircleElement;
      tag: HTMLElement;
    }
  | undefined;

function ensureNodes() {
  if (nodes) return nodes;
  const svg = document.getElementById("route-overlay") as SVGSVGElement | null,
    tag = document.getElementById("route-tag");
  if (!svg || !tag) return undefined;
  const ns = "http://www.w3.org/2000/svg",
    make = <K extends keyof SVGElementTagNameMap>(name: K, className: string) => {
      const element = document.createElementNS(ns, name);
      element.setAttribute("class", className);
      svg.append(element);
      return element;
    };
  nodes = {
    svg,
    tag,
    casing: make("polyline", "route-casing"),
    line: make("polyline", "route-line"),
    start: make("circle", "route-end route-start"),
    finish: make("circle", "route-end route-finish"),
  };
  for (const circle of [nodes.start, nodes.finish]) circle.setAttribute("r", "6");
  return nodes;
}

export function setActiveRoute(route: LonLat[] | null, tag = "", id = "") {
  lastShape = "";
  lastTag = "";
  lastTagSize = "";
  if (!route || route.length < 2) {
    active = null;
    hide();
    return;
  }
  active = {
    id,
    tag,
    points: route.map(({ lon, lat }) => ({ lon, lat, ...lonLatToSource(lon, lat) })),
  };
}

export const activeRouteId = () => active?.id ?? null;

function hide() {
  const n = ensureNodes();
  if (!n) return;
  n.svg.classList.remove("visible");
  n.tag.hidden = true;
  lastShape = "";
  lastTagSize = "";
}

/** Called once per rendered frame; does nothing when no route is selected. */
export function updateRouteOverlay(project: RouteProjector) {
  if (!active) return;
  const n = ensureNodes();
  if (!n) return;
  const screen: ScreenPoint[] = [];
  for (const point of active.points) {
    const projected = project(point);
    if (!projected) {
      // Globe view or unprojectable frame: keep the route selected but hide the drawing.
      n.svg.classList.remove("visible");
      n.tag.hidden = true;
      lastShape = "";
      lastTagSize = "";
      return;
    }
    screen.push(projected);
  }
  const shape = screen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  if (shape !== lastShape) {
    lastShape = shape;
    n.casing.setAttribute("points", shape);
    n.line.setAttribute("points", shape);
    const first = screen[0],
      last = screen[screen.length - 1];
    n.start.setAttribute("cx", String(first.x));
    n.start.setAttribute("cy", String(first.y));
    n.finish.setAttribute("cx", String(last.x));
    n.finish.setAttribute("cy", String(last.y));

    // Tag sits at the polyline's half-length point, clamped into the viewport.
    let total = 0;
    for (let k = 1; k < screen.length; k++)
      total += Math.hypot(screen[k].x - screen[k - 1].x, screen[k].y - screen[k - 1].y);
    let travelled = 0,
      mx = first.x,
      my = first.y;
    for (let k = 1; k < screen.length; k++) {
      const seg = Math.hypot(screen[k].x - screen[k - 1].x, screen[k].y - screen[k - 1].y);
      if (travelled + seg >= total / 2 && seg > 0) {
        const f = (total / 2 - travelled) / seg;
        mx = screen[k - 1].x + (screen[k].x - screen[k - 1].x) * f;
        my = screen[k - 1].y + (screen[k].y - screen[k - 1].y) * f;
        break;
      }
      travelled += seg;
    }
    if (active.tag !== lastTag) {
      lastTag = active.tag;
      n.tag.textContent = active.tag;
    }
    tagAnchor = { x: mx, y: my };
    tagLine = screen;
    lastTagSize = "";
  }
  n.svg.classList.add("visible");
  n.tag.hidden = false;
  // Measure only while the tag is displayed, and only when the route or its tag changed.
  if (tagAnchor && lastTagSize === "") {
    lastTagSize = "placed";
    const width = n.tag.offsetWidth,
      height = n.tag.offsetHeight,
      margin = 12,
      left = Math.max(margin, Math.min(innerWidth - width - margin, tagAnchor.x - width / 2));
    // Sit just above the highest route point under the tag so the tag never covers the line.
    let top = tagAnchor.y;
    const lo = left - 8,
      hi = left + width + 8;
    for (let k = 0; k < tagLine.length; k++) {
      const a = tagLine[k],
        b = tagLine[Math.min(k + 1, tagLine.length - 1)];
      if (Math.max(a.x, b.x) < lo || Math.min(a.x, b.x) > hi) continue;
      // Interpolated height of the segment at both ends of its overlap with the tag span.
      for (const x of [Math.max(lo, Math.min(a.x, b.x)), Math.min(hi, Math.max(a.x, b.x))]) {
        const f = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
        top = Math.min(top, a.y + (b.y - a.y) * f);
      }
    }
    const px = left,
      py = Math.max(margin + 70, Math.min(innerHeight - height - 110, top - height - 12));
    n.tag.style.transform = `translate(${px}px,${py}px)`;
  }
}
