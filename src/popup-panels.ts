import "./popup-panels.css";

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
}

document.querySelectorAll<HTMLElement>(".panel").forEach(preparePanel);
// Inspectors are also added lazily as direct body children.
new MutationObserver((records) => {
  for (const record of records) for (const node of Array.from(record.addedNodes))
    if (node instanceof HTMLElement && node.matches(".panel")) preparePanel(node);
}).observe(document.body, { childList: true });
