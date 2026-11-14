/**
 * Presentation-only UI shell.
 *
 * Wires the compact icon controls, segmented panel tabs, command dock,
 * keyboard shortcuts and the help sheet. It owns no world state: every action
 * forwards to the existing authoritative controls in `main.ts`, so Simulation
 * truth, routes and clock are untouched.
 */

export type UiShellOptions = {
  /** Ask for the nearest rendered resident, as Enter does on the canvas. */
  readonly findNearestResident?: () => void;
};

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable ||
    !!target.closest("[contenteditable='true']");
};

/** Click a real control by id, if it is usable, so the shell adds no authority. */
function press(id: string): boolean {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[hidden]")) return false;
  element.click();
  return true;
}

/** Segmented tabs inside one group; all panes remain in the DOM. */
export function setupTabs(root: ParentNode = document): void {
  for (const group of Array.from(root.querySelectorAll<HTMLElement>("[data-ui-tabs]"))) {
    const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>("[role='tab'][data-tab]"));
    if (!tabs.length) continue;
    const select = (name: string, focus = false) => {
      for (const tab of tabs) {
        const active = tab.dataset.tab === name;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        const pane = tab.getAttribute("aria-controls");
        const target = pane ? document.getElementById(pane) : null;
        if (target) target.hidden = !active;
        if (active && focus) tab.focus({ preventScroll: true });
      }
    };
    for (const [index, tab] of tabs.entries()) {
      tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
      tab.addEventListener("click", () => select(tab.dataset.tab ?? ""));
      tab.addEventListener("keydown", (event) => {
        const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!delta) return;
        event.preventDefault();
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        select(next.dataset.tab ?? "", true);
      });
    }
  }
}

/** Switch a named group to a tab, used by the dock and shortcuts. */
export function showTab(group: string, name: string): void {
  const host = document.querySelector<HTMLElement>(`[data-ui-tabs='${group}']`);
  const tab = host?.querySelector<HTMLButtonElement>(`[role='tab'][data-tab='${name}']`);
  tab?.click();
}

/** True when the segment is already showing, so a second press can close. */
function activeTab(group: string, name: string): boolean {
  return document.querySelector<HTMLElement>(`[data-ui-tabs='${group}'] [data-tab='${name}']`)
    ?.getAttribute("aria-selected") === "true";
}

export function setupUiShell(options: UiShellOptions = {}): void {
  setupTabs(document);

  const regionPanel = document.getElementById("region-panel");
  const travelPanel = document.getElementById("travel-panel");
  const help = document.getElementById("help-sheet");

  const setRegion = (open: boolean) => {
    if (!regionPanel) return;
    const expanded = !regionPanel.classList.contains("minimized");
    if (expanded === open) return;
    press("toggle-region-panel");
  };

  /** Open a region-panel category, expanding the panel when collapsed. */
  const openRegion = (tab: string) => {
    setRegion(true);
    showTab("region", tab);
    document.getElementById("dock-layers")?.setAttribute("aria-pressed", String(tab === "layers"));
  };

  const openTravel = () => {
    if (!travelPanel) return;
    if (travelPanel.hidden) {
      // The Explore button lives in the Place segment; reveal that segment
      // first so the real control is not inside a hidden pane.
      showTab("region", "place");
      press("open-travel");
      showTab("travel", "place");
    } else if (activeTab("travel", "place")) press("close-travel");
    else showTab("travel", "place");
  };

  const openHelp = (open: boolean) => {
    if (!help) return;
    help.hidden = !open;
    if (open) {
      help.querySelector<HTMLButtonElement>("#help-close")?.focus({ preventScroll: true });
    } else {
      document.getElementById("world")?.focus({ preventScroll: true });
    }
  };

  const toggleAdvisor = () => press("advisor-toggle");

  const findNearest = () => {
    if (travelPanel && !travelPanel.hidden) press("close-travel");
    options.findNearestResident?.();
  };

  // Popover-style tooltips rely on the title for assistive tech; keep both.
  for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-tip]"))) {
    if (!node.title) node.title = node.dataset.tip ?? "";
  }

  const dock: Record<string, () => void> = {
    "dock-home": () => press("home"),
    "dock-realm": () => press("overview"),
    "dock-travel": openTravel,
    "dock-layers": () => openRegion("layers"),
    "dock-advisor": toggleAdvisor,
    "dock-help": () => openHelp(true),
    "dock-resident": () => findNearest(),
  };
  for (const [id, run] of Object.entries(dock)) {
    document.getElementById(id)?.addEventListener("click", (event) => {
      event.preventDefault();
      run();
    });
  }
  document.getElementById("inspect-nearest")?.addEventListener("click", (event) => {
    event.preventDefault();
    findNearest();
  });
  document.getElementById("header-help")?.addEventListener("click", (event) => {
    event.preventDefault();
    openHelp(true);
  });

  help?.addEventListener("click", (event) => {
    if (event.target === help) openHelp(false);
  });
  document.getElementById("help-close")?.addEventListener("click", () => openHelp(false));

  // Keep the layer dock state honest when the panel is opened elsewhere.
  new MutationObserver(() => {
    const layers = document.getElementById("dock-layers");
    if (!layers || !regionPanel) return;
    const open = !regionPanel.classList.contains("minimized") && activeTab("region", "layers");
    layers.setAttribute("aria-pressed", String(open));
  }).observe(regionPanel ?? document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      if (help && !help.hidden) { event.preventDefault(); openHelp(false); return; }
      return;
    }
    if (isTyping(event.target)) return;
    // Enter on the canvas keeps its existing inspect-nearest-resident action.
    switch (event.key.toLowerCase()) {
      case "h": event.preventDefault(); press("home"); break;
      case "r": event.preventDefault(); press("overview"); break;
      case "t": event.preventDefault(); openTravel(); break;
      case "c": event.preventDefault(); press("compass"); break;
      case "l": event.preventDefault(); openRegion("layers"); break;
      case "a": event.preventDefault(); toggleAdvisor(); break;
      case "f": event.preventDefault(); findNearest(); break;
      case "p": {
        event.preventDefault();
        const focus = (window as unknown as { advisorFocusProtagonist?: () => boolean }).advisorFocusProtagonist;
        if (!focus?.()) press("protagonist-chip");
        break;
      }
      case "g": event.preventDefault(); press("focus-gate-watch"); break;
      case "?":
      case "/": event.preventDefault(); openHelp(help?.hidden ?? false); break;
      default: break;
    }
  });

  // A one-time nudge: the information panel starts collapsed, so new players
  // may never find it. Pulse its icon until the panel is opened once.
  const HINT_KEY = "advisor-game:ui:info-discovered";
  try {
    if (!localStorage.getItem(HINT_KEY)) {
      const toggle = document.getElementById("toggle-region-panel");
      toggle?.classList.add("discovery-pulse");
      const clear = () => {
        toggle?.classList.remove("discovery-pulse");
        try { localStorage.setItem(HINT_KEY, "1"); } catch { /* storage may be disabled */ }
      };
      toggle?.addEventListener("click", clear, { once: true });
    }
  } catch { /* storage may be disabled; the map stays fully usable */ }

  // A tab press in the region panel reveals the panel body on touch screens.
  document.getElementById("region-tab-layers")?.addEventListener("click", () => setRegion(true));
}
