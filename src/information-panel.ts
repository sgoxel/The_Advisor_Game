const panel = document.getElementById("region-panel"), toggle = document.getElementById("toggle-region-panel");
toggle?.addEventListener("click", () => {
  if (!panel || !toggle) return;
  const minimized = panel.classList.toggle("minimized");
  toggle.setAttribute("aria-expanded", String(!minimized));
  toggle.setAttribute("aria-label", minimized ? "Show map information" : "Minimize map information");
  toggle.textContent = minimized ? "Show information" : "Minimize";
  // Refit presentation to the available map area; geographic focus/heading stay unchanged.
  window.dispatchEvent(new Event("resize"));
});
