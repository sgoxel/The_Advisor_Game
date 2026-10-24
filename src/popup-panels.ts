import "./popup-panels.css";

const openPanels: HTMLElement[] = [];
const FOCUSABLE = "select, input, textarea, button, a[href], [tabindex]:not([tabindex='-1'])";
const closeButtonOf = (panel: HTMLElement) =>
  panel.querySelector<HTMLButtonElement>(":scope > .eyebrow button[aria-label^='Close'], :scope > .transport-heading button[aria-label^='Close']");
const isShown = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && !el.closest("[hidden]");

function onPanelShown(panel: HTMLElement, state: { opener: HTMLElement | null }) {
  openPanels.push(panel);
  const active = document.activeElement;
  state.opener = active instanceof HTMLElement && active !== document.body && !panel.contains(active) ? active : null;
  // Only controls (not the map canvas) hand focus into the panel; the canvas keeps its arrow keys.
  if (!state.opener || state.opener.matches("canvas, #world")) return;
  if (!state.opener.matches("button, select, a[href], input, textarea")) return;
  const close = closeButtonOf(panel);
  const first = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
    (el) => el !== close && !el.closest(".popup-minimize, [hidden]") && !(el as HTMLButtonElement).disabled && el.getClientRects().length,
  );
  (first ?? close)?.focus({ preventScroll: true });
}

function onPanelHidden(panel: HTMLElement, state: { opener: HTMLElement | null }) {
  const index = openPanels.indexOf(panel);
  if (index >= 0) openPanels.splice(index, 1);
  const active = document.activeElement;
  if (active && active !== document.body && !panel.contains(active)) return;
  const opener = state.opener;
  state.opener = null;
  const target = isShown(opener) ? opener : document.getElementById("world");
  target?.focus({ preventScroll: true });
}

function preparePanel(panel: HTMLElement) {
  if (panel.id === "region-panel" || panel.dataset.popupReady) return;
  const heading = panel.querySelector<HTMLElement>(":scope > .eyebrow, :scope > .transport-heading");
  if (!heading) return;
  panel.dataset.popupReady = "true";
  heading.classList.add("popup-heading");
  const caption = document.createElement("div");
  caption.className = "popup-caption";
  for (const node of Array.from(heading.childNodes)) {
    if (!(node instanceof HTMLButtonElement)) caption.append(node);
  }
  heading.prepend(caption);
  const minimize = document.createElement("button");
  minimize.type = "button";
  minimize.className = "popup-minimize";
  minimize.textContent = "−";
  minimize.setAttribute("aria-expanded", "true");
  minimize.setAttribute("aria-label", "Minimize window");
  minimize.setAttribute("aria-controls", panel.id);
  heading.insertBefore(minimize, caption.nextSibling);
  let scrollTop = 0;
  minimize.addEventListener("click", () => {
    const collapsed = !panel.classList.contains("popup-minimized");
    if (collapsed) scrollTop = panel.scrollTop;
    panel.classList.toggle("popup-minimized", collapsed);
    minimize.textContent = collapsed ? "+" : "−";
    minimize.setAttribute("aria-expanded", String(!collapsed));
    minimize.setAttribute("aria-label", collapsed ? "Restore window" : "Minimize window");
    panel.scrollTop = collapsed ? 0 : scrollTop;
  });
  // Focus lifecycle: driven by the panel's own `hidden` attribute, no polling.
  const state = { opener: null as HTMLElement | null };
  let shown = !panel.hidden;
  if (shown) openPanels.push(panel);
  new MutationObserver(() => {
    if (!panel.hidden === shown) return;
    shown = !panel.hidden;
    if (shown) onPanelShown(panel, state);
    else onPanelHidden(panel, state);
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
}

document.querySelectorAll<HTMLElement>(".panel").forEach(preparePanel);
// Inspectors are also added lazily as direct body children.
new MutationObserver((records) => {
  for (const record of records) for (const node of Array.from(record.addedNodes))
    if (node instanceof HTMLElement && node.matches(".panel")) preparePanel(node);
}).observe(document.body, { childList: true });

// Escape closes the most recently opened visible panel when focus is inside it, or on the canvas / nothing.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const npc = document.getElementById("npc-popup");
  if (npc && !npc.hidden) return;
  const visible = openPanels.filter((p) => p.isConnected && !p.hidden);
  if (!visible.length) return;
  const active = document.activeElement;
  const canvasOrNone = !active || active === document.body || active.id === "world";
  const panel = visible.find((p) => !!active && p.contains(active)) ?? (canvasOrNone ? visible[visible.length - 1] : undefined);
  const close = panel && closeButtonOf(panel);
  if (!close) return;
  event.preventDefault();
  close.click();
});
