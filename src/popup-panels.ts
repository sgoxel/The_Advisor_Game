import "./popup-panels.css";

const openPanels: HTMLElement[] = [];
const FOCUSABLE = "select, input, textarea, button, a[href], [tabindex]:not([tabindex='-1'])";
const isShown = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && !el.closest("[hidden]");
const closeButtonOf = (panel: HTMLElement) => panel.querySelector<HTMLButtonElement>(":scope > .eyebrow button[aria-label^='Close'], :scope > .transport-heading button[aria-label^='Close']");
function shown(panel: HTMLElement, state: { opener: HTMLElement | null }) {
  if (!openPanels.includes(panel)) openPanels.push(panel);
  const active = document.activeElement;
  state.opener = active instanceof HTMLElement && active !== document.body && !panel.contains(active) ? active : null;
  if (!state.opener?.matches("button, select, a[href], input, textarea")) return;
  const close = closeButtonOf(panel);
  const first = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find(el => el !== close && !el.closest("[hidden]") && !(el as HTMLButtonElement).disabled && !!el.getClientRects().length);
  (first ?? close)?.focus({ preventScroll: true });
}
function hidden(panel: HTMLElement, state: { opener: HTMLElement | null }) {
  const index = openPanels.indexOf(panel);
  if (index >= 0) openPanels.splice(index, 1);
  const active = document.activeElement;
  if (active && active !== document.body && !panel.contains(active)) { state.opener = null; return; }
  const target = isShown(state.opener) ? state.opener : document.getElementById("world");
  state.opener = null;
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
  const state = { opener: null as HTMLElement | null };
  let wasShown = !panel.hidden;
  if (wasShown) openPanels.push(panel);
  new MutationObserver(() => {
    const visible = !panel.hidden;
    if (wasShown === visible) return;
    wasShown = visible;
    if (visible) shown(panel, state);
    else hidden(panel, state);
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
}

document.querySelectorAll<HTMLElement>(".panel").forEach(preparePanel);
// Inspectors are also added lazily as direct body children.
new MutationObserver((records) => {
  for (const record of records) for (const node of Array.from(record.addedNodes))
    if (node instanceof HTMLElement && node.matches(".panel")) preparePanel(node);
}).observe(document.body, { childList: true });

// Most recently opened accessible inspector: Escape returns to its opener.
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const npc = document.getElementById("npc-popup");
  if (npc && !npc.hidden) return;
  const panels = openPanels.filter(panel => panel.isConnected && !panel.hidden);
  if (!panels.length) return;
  const active = document.activeElement;
  const panel = panels.find(p => !!active && p.contains(active)) ??
    ((!active || active === document.body || active.id === "world") ? panels[panels.length - 1] : undefined);
  const close = panel && closeButtonOf(panel);
  if (close) { event.preventDefault(); close.click(); }
});
