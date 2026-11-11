/**
 * Campaign panel (WP-S010-008-002).
 *
 * Shows the player which campaign they are in — its identity, the SEED it is
 * built from and the creation-derived fantasy date — and lets them explicitly
 * **continue** a resumed campaign or start a **new** one. Before this, a reload
 * silently resumed with no way to see or accept what had been remembered.
 *
 * Presentation only. It never decides world truth: the campaign record is the
 * player's accepted choice, the SEED owns world foundation and the Simulation
 * owns state.
 */
import {
  clearCampaign,
  createCampaign,
  readCampaign,
  resolveCampaign,
  writeCampaign,
  type CampaignRecord,
} from "./campaign.ts";
import { fantasyOrigin, YEAR_OFFSET } from "./clock.ts";

export type CampaignPanelOptions = {
  /** Called after the player accepts a campaign (continue or new). */
  readonly onAccepted?: (record: CampaignRecord, mode: "continued" | "created") => void;
  /** Supplies the current instant; injectable for tests. */
  readonly now?: () => number;
};

export type CampaignPanelState =
  | { readonly kind: "resumed"; readonly record: CampaignRecord }
  | { readonly kind: "new"; readonly record: CampaignRecord }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Formats the campaign's creation-derived fantasy date, e.g. "11.11.0126". */
export function fantasyDateOf(record: CampaignRecord): string {
  const date = new Date(fantasyOrigin(record.createdAtMs));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCFullYear(), 4)}`;
}

/** Short, human explanation of the YEAR_OFFSET rule for the panel. */
export function fantasyYearRule(): string {
  return `Fantasy year is the real creation year minus ${YEAR_OFFSET}.`;
}

export class CampaignPanel {
  private readonly root: HTMLElement;
  private readonly options: CampaignPanelOptions;
  private state: CampaignPanelState;
  private accepted = false;

  constructor(root: HTMLElement, options: CampaignPanelOptions = {}) {
    this.root = root;
    this.options = options;
    this.state = this.detect();
    this.render();
  }

  /** What the panel currently believes about the campaign. */
  get current(): CampaignPanelState {
    return this.state;
  }

  /** True once the player has explicitly accepted a campaign. */
  get isAccepted(): boolean {
    return this.accepted;
  }

  /** Re-reads storage; used after an external change (e.g. a cleared cache). */
  refresh(): void {
    this.state = this.detect();
    this.render();
  }

  private detect(): CampaignPanelState {
    const { record, problem } = readCampaign();
    if (record && !problem) return { kind: "resumed", record };
    if (problem) {
      // A present-but-broken record is a failure, never a silent new campaign.
      const stored = this.storedRaw();
      if (stored !== null) return { kind: "unreadable", reason: problem };
      return { kind: "unavailable", reason: problem };
    }
    const now = this.options.now?.() ?? Date.now();
    return { kind: "new", record: createCampaign(now) };
  }

  private storedRaw(): string | null {
    try {
      return globalThis.localStorage?.getItem("advisor.campaign.v1") ?? null;
    } catch {
      return null;
    }
  }

  /** Player action: accept what is on screen. */
  accept(mode?: "continued" | "created"): boolean {
    if (this.state.kind === "unreadable" || this.state.kind === "unavailable") return false;
    const record = this.state.record;
    const saved = writeCampaign(record);
    if (!saved) {
      this.state = { kind: "unavailable", reason: "Browser storage refused to save this campaign, so it will not persist." };
      this.render();
      return false;
    }
    this.accepted = true;
    this.options.onAccepted?.(record, mode ?? (this.state.kind === "resumed" ? "continued" : "created"));
    this.hide();
    return true;
  }

  /** Player action: start a different campaign, discarding the remembered one. */
  startNew(): boolean {
    const now = this.options.now?.() ?? Date.now();
    clearCampaign();
    const record = createCampaign(now);
    if (!writeCampaign(record)) {
      this.state = { kind: "unavailable", reason: "Browser storage refused to save this campaign, so it will not persist." };
      this.render();
      return false;
    }
    this.state = { kind: "new", record };
    this.accepted = true;
    this.options.onAccepted?.(record, "created");
    this.hide();
    return true;
  }

  hide(): void {
    this.root.hidden = true;
  }

  show(): void {
    this.root.hidden = false;
    this.refresh();
  }

  private render(): void {
    const kind = this.state.kind;
    this.root.hidden = false;
    this.root.setAttribute("data-state", kind);

    if (kind === "unreadable" || kind === "unavailable") {
      const title = kind === "unreadable" ? "Saved campaign could not be read" : "This campaign cannot be saved";
      const reason = this.state.reason;
      this.root.innerHTML = `
        <div class="campaign-card" role="dialog" aria-modal="true" aria-labelledby="campaign-title">
          <div class="eyebrow">CAMPAIGN</div>
          <h2 id="campaign-title">${escape(title)}</h2>
          <p class="campaign-reason">${escape(reason)}</p>
          <p class="campaign-note">Nothing has been replaced automatically. Your saved world was not modified.</p>
          <div class="campaign-actions">
            <button type="button" data-campaign-retry>Try again</button>
            <button type="button" data-campaign-new class="campaign-secondary">Start a new campaign anyway</button>
          </div>
        </div>`;
      this.root.querySelector("[data-campaign-retry]")?.addEventListener("click", () => this.refresh());
      this.root.querySelector("[data-campaign-new]")?.addEventListener("click", () => {
        clearCampaign();
        this.state = { kind: "new", record: createCampaign(this.options.now?.() ?? Date.now()) };
        this.render();
      });
      // A failure state must be reachable by keyboard, not just clickable.
      this.root.querySelector<HTMLButtonElement>("[data-campaign-retry]")?.focus({ preventScroll: true });
      return;
    }

    const record = this.state.record;
    const resumed = this.state.kind === "resumed";
    this.root.innerHTML = `
      <div class="campaign-card" role="dialog" aria-modal="true" aria-labelledby="campaign-title">
        <div class="eyebrow">${resumed ? "CONTINUE YOUR CAMPAIGN" : "BEGIN A CAMPAIGN"}</div>
        <h2 id="campaign-title">${escape(resumed ? "Welcome back, Advisor" : "A new realm awaits")}</h2>
        <dl class="campaign-facts">
          <dt>World SEED</dt><dd><code>${escape(record.seed)}</code></dd>
          <dt>Began</dt><dd>${escape(fantasyDateOf(record))} <span class="campaign-muted">fantasy</span></dd>
          <dt>Campaign</dt><dd><code>${escape(record.id)}</code></dd>
        </dl>
        <p class="campaign-note">${escape(fantasyYearRule())}</p>
        <div class="campaign-actions">
          <button type="button" data-campaign-accept>${resumed ? "Continue this campaign" : "Begin this campaign"}</button>
          ${resumed ? `<button type="button" data-campaign-new class="campaign-secondary">Start a new campaign</button>` : ""}
        </div>
      </div>`;

    this.root.querySelector("[data-campaign-accept]")?.addEventListener("click", () => this.accept());
    this.root.querySelector("[data-campaign-new]")?.addEventListener("click", () => {
      if (!globalThis.confirm?.("Start a new campaign? The current campaign record will be replaced.")) return;
      this.startNew();
    });
    this.root.querySelector<HTMLButtonElement>("[data-campaign-accept]")?.focus({ preventScroll: true });
  }
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Test helper: resolve a fresh campaign through the same rules the panel uses. */
export function panelStateForTest(now: number): CampaignPanelState {
  const load = resolveCampaign(now);
  return load.state === "resumed" || load.state === "created"
    ? { kind: load.state === "resumed" ? "resumed" : "new", record: load.record }
    : { kind: load.state, reason: load.reason };
}
