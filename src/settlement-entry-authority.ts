import { settlementEntranceAccess } from "./settlement-access.ts";
import { settlementBuilding, type BuildingUse } from "./settlements.ts";
import { cellAt } from "./world.ts";

type EntryDecision = {
  action: "enter-building" | "exit-building";
  buildingCode: string;
  characterDecision: "accepted" | "rejected";
  simulation: "validated" | "rejected";
  worldAction: "entered" | "exited" | "none";
  reason: string;
  accessLengthM?: number;
};

type SettlementApi = {
  enter(code: string): unknown;
  exit(): unknown;
  state: {
    selectedBuildingCode?: string;
    activeInterior?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type AdvisorWindow = Window & typeof globalThis & { advisorSettlements?: SettlementApi };
const advisorWindow = window as AdvisorWindow;
const ENTERABLE = new Set<BuildingUse>([
  "home",
  "inn",
  "market",
  "blacksmith",
  "farmstead",
  "barn",
  "butcher",
  "guard-office",
]);

let installed = false;
let last: EntryDecision | null = null;
let accepted = 0;
let rejected = 0;

function status(message: string) {
  const interior = document.getElementById("interior-status");
  if (interior && !document.getElementById("interior-experience")?.hidden) {
    interior.textContent = message;
    return;
  }
  const selection = document.getElementById("settlement-selection");
  if (!selection) return;
  let output = selection.querySelector<HTMLOutputElement>(".settlement-authority-status");
  if (!output) {
    output = document.createElement("output");
    output.className = "settlement-authority-status";
    output.setAttribute("aria-live", "polite");
    selection.append(output);
  }
  output.textContent = message;
}

function evaluateEntry(buildingCode: string): EntryDecision {
  const building = settlementBuilding(buildingCode);
  if (!building || !ENTERABLE.has(building.use)) {
    return {
      action: "enter-building",
      buildingCode,
      characterDecision: "rejected",
      simulation: "rejected",
      worldAction: "none",
      reason: "The character cannot enter that exterior-only destination.",
    };
  }

  // Advisor proposes a concrete action. Simulation validates the canonical portal
  // against the plot-access record and the walkable internal-street endpoint before
  // the world may materialize an interior. Render proximity alone is never enough.
  const characterDecision = "accepted" as const,
    access = settlementEntranceAccess(building);
  let walkableStreetEndpoint = false;
  try {
    walkableStreetEndpoint = cellAt(access.street.x, access.street.z).walkable;
  } catch {
    walkableStreetEndpoint = false;
  }
  const connected =
    Number.isFinite(access.lengthM) &&
    access.lengthM >= 0 &&
    access.sourcePoints.length >= 2;
  if (!connected || !walkableStreetEndpoint) {
    return {
      action: "enter-building",
      buildingCode,
      characterDecision,
      simulation: "rejected",
      worldAction: "none",
      accessLengthM: access.lengthM,
      reason: !connected
        ? "Simulation rejected the entry: no canonical entrance-to-street access path exists."
        : "Simulation rejected the entry: the canonical street endpoint is not walkable.",
    };
  }
  return {
    action: "enter-building",
    buildingCode,
    characterDecision,
    simulation: "validated",
    worldAction: "entered",
    accessLengthM: access.lengthM,
    reason: `Advisor proposal accepted → Simulation validated ${access.lengthM.toFixed(1)} m canonical access → character entered.`,
  };
}

function install(api: SettlementApi) {
  if (installed) return;
  installed = true;
  const rawEnter = api.enter.bind(api),
    rawExit = api.exit.bind(api);
  const enter = (buildingCode: string) => {
    const decision = evaluateEntry(buildingCode);
    last = decision;
    if (
      decision.characterDecision !== "accepted" ||
      decision.simulation !== "validated"
    ) {
      rejected++;
      status(decision.reason);
      return undefined;
    }
    accepted++;
    const result = rawEnter(buildingCode);
    status(decision.reason);
    return result;
  };
  const exit = () => {
    const buildingCode = String(api.state.activeInterior ?? ""),
      result = rawExit();
    last = {
      action: "exit-building",
      buildingCode,
      characterDecision: "accepted",
      simulation: buildingCode ? "validated" : "rejected",
      worldAction: buildingCode ? "exited" : "none",
      reason: buildingCode
        ? "Character exited through the canonical building transition; the realized interior was released."
        : "No active interior existed to exit.",
    };
    status(last.reason);
    return result;
  };
  const proxy = new Proxy(api, {
    get(target, property, receiver) {
      if (property === "enter") return enter;
      if (property === "exit") return exit;
      if (property === "state")
        return {
          ...target.state,
          authority: { installed: true, last, accepted, rejected },
        };
      return Reflect.get(target, property, receiver);
    },
  });
  advisorWindow.advisorSettlements = proxy;

  // The player-facing control must enter through the same Advisor→Simulation gate;
  // capture prevents the experience module's original handler from bypassing it.
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>(".enter-building")
          : null;
      if (!target || target.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const code = String(proxy.state.selectedBuildingCode ?? "");
      if (code) enter(code);
    },
    true,
  );

  const relabel = () => {
    // The project intentionally does not include DOM.Iterable; materialize the
    // NodeList before iteration so this UI helper stays inside the existing TS lib contract.
    for (const button of Array.from(
      document.querySelectorAll<HTMLButtonElement>(".enter-building"),
    ))
      if (!button.disabled) button.textContent = "Advise entry";
  };
  new MutationObserver(relabel).observe(document.body, {
    childList: true,
    subtree: true,
  });
  relabel();
}

const timer = window.setInterval(() => {
  if (!advisorWindow.advisorSettlements) return;
  window.clearInterval(timer);
  install(advisorWindow.advisorSettlements);
}, 0);
