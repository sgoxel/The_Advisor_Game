import { wrapSourceX } from "./planet.ts";
import { transportNetwork } from "./transport-network.ts";

type AdvisorWorld = {
  state: {
    presentation: string;
    scaleLabel: string;
    view: { x: number; z: number; halfHeight: number; aspect: number; yaw: number };
  };
};

type TransportTelemetry = Readonly<{
  selection: { kind: string; code: string } | null;
}>;

type AdvisorTransport = {
  telemetry(): TransportTelemetry;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const overlay = document.createElementNS(SVG_NS, "svg");
overlay.id = "transport-maritime-overlay";
overlay.setAttribute("aria-hidden", "true");
Object.assign(overlay.style, {
  position: "fixed",
  inset: "0",
  width: "100vw",
  height: "100vh",
  pointerEvents: "none",
  zIndex: "8",
  display: "none",
});
document.body.append(overlay);

let lastFingerprint = "";

function world() {
  return (window as unknown as { advisorWorld?: AdvisorWorld }).advisorWorld;
}

function transport() {
  return (window as unknown as { advisorTransport?: AdvisorTransport }).advisorTransport;
}

function projectSource(x: number, z: number, state: AdvisorWorld["state"]) {
  const { view } = state,
    scale = innerHeight / Math.max(1, view.halfHeight * 2),
    dx = wrapSourceX(x - view.x),
    dz = z - view.z,
    yaw = view.yaw || 0,
    right = dx * Math.cos(yaw) - dz * Math.sin(yaw),
    depth = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return {
    x: innerWidth / 2 + right * scale,
    y: innerHeight / 2 + depth * Math.cos(Math.PI / 6) * scale,
  };
}

function render() {
  const runtime = world(),
    api = transport();
  if (!runtime || !api) return;
  const selection = api.telemetry().selection,
    state = runtime.state,
    fingerprint = [
      selection?.kind ?? "",
      selection?.code ?? "",
      state.presentation,
      state.scaleLabel,
      state.view.x.toFixed(3),
      state.view.z.toFixed(3),
      state.view.halfHeight.toFixed(3),
      state.view.yaw.toFixed(3),
      innerWidth,
      innerHeight,
    ].join("/");
  if (fingerprint === lastFingerprint) return;
  lastFingerprint = fingerprint;
  overlay.replaceChildren();

  if (selection?.kind !== "ferry" || state.presentation !== "flat") {
    overlay.style.display = "none";
    return;
  }
  const ferry = transportNetwork.ferryEdges.find(
      (candidate) => candidate.code === selection.code,
    ),
    fromHarbor = transportNetwork.harbors.find(
      (candidate) => candidate.code === ferry?.fromHarborCode,
    ),
    toHarbor = transportNetwork.harbors.find(
      (candidate) => candidate.code === ferry?.toHarborCode,
    );
  if (!ferry || !fromHarbor || !toHarbor) {
    overlay.style.display = "none";
    return;
  }

  const start = projectSource(fromHarbor.x, fromHarbor.z, state),
    target = projectSource(toHarbor.x, toHarbor.z, state),
    dx = target.x - start.x,
    dy = target.y - start.y,
    length = Math.hypot(dx, dy) || 1,
    ux = dx / length,
    uy = dy / length,
    visibleLength = Math.max(110, Math.min(length, Math.min(innerWidth, innerHeight) * 0.42)),
    end = { x: start.x + ux * visibleLength, y: start.y + uy * visibleLength };

  const defs = document.createElementNS(SVG_NS, "defs"),
    marker = document.createElementNS(SVG_NS, "marker"),
    arrow = document.createElementNS(SVG_NS, "path");
  marker.id = "transport-maritime-arrow";
  marker.setAttribute("markerWidth", "9");
  marker.setAttribute("markerHeight", "9");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "4.5");
  marker.setAttribute("orient", "auto");
  arrow.setAttribute("d", "M 0 0 L 9 4.5 L 0 9 z");
  arrow.setAttribute("fill", "#9ad8e7");
  marker.append(arrow);
  defs.append(marker);
  overlay.append(defs);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} L ${end.x.toFixed(2)} ${end.y.toFixed(2)}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#8bcddd");
  path.setAttribute("stroke-width", "4");
  path.setAttribute("stroke-dasharray", "10 7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("marker-end", "url(#transport-maritime-arrow)");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  overlay.append(path);

  const anchor = document.createElementNS(SVG_NS, "circle");
  anchor.setAttribute("cx", start.x.toFixed(2));
  anchor.setAttribute("cy", start.y.toFixed(2));
  anchor.setAttribute("r", "6");
  anchor.setAttribute("fill", "#84becb");
  anchor.setAttribute("stroke", "#e4fbff");
  anchor.setAttribute("stroke-width", "2");
  overlay.append(anchor);

  const label = document.createElementNS(SVG_NS, "text"),
    labelX = start.x + ux * Math.min(visibleLength * 0.48, 150),
    labelY = start.y + uy * Math.min(visibleLength * 0.48, 150) - 10;
  label.setAttribute("x", labelX.toFixed(2));
  label.setAttribute("y", labelY.toFixed(2));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("fill", "#d9f5fb");
  label.setAttribute("stroke", "rgba(18, 36, 40, .92)");
  label.setAttribute("stroke-width", "4");
  label.setAttribute("paint-order", "stroke fill");
  label.setAttribute("font-size", "13");
  label.setAttribute("font-weight", "700");
  label.setAttribute("letter-spacing", "1.2");
  label.textContent = "SEA / FERRY · NOT WALKABLE";
  overlay.append(label);
  overlay.style.display = "block";
}

function frame() {
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
