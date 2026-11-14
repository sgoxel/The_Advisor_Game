/**
 * New-campaign seed dialog (player choice before the world exists).
 *
 * A first visit, or a player who chooses "New campaign…", picks the SEED that the
 * whole world is generated from. The suggestion uses the project's seed style
 * `ADVISOR-<fantasy year>-<NAME>`; the randomness here is the player's choice and
 * lives outside the world, which stays fully SEED-determined.
 *
 * This module is imported by bootstrap.ts before any world module, and it touches
 * the DOM only inside functions, so the pure rules in campaign.ts can be tested in Node.
 */
import "./seed-dialog.css";
import { campaignNeedsChoice, clearCampaign, fantasyYearAt, normaliseSeedInput, suggestSeed } from "./campaign.ts";

const ENTRY_ID = "new-campaign-entry";
const STORAGE_REFUSED =
  "Browser storage refused to save this campaign. Allow site storage or free some space, then press Start campaign again.";

/**
 * Shows the modal and resolves with the seed the player started. `save` must store
 * the campaign and return true only when it is really kept; until then the dialog
 * stays open, so the page never loads a world the browser did not remember.
 */
export function askForNewCampaign(save: (seed: string) => boolean, doc: Document = document): Promise<string> {
  return new Promise<string>((resolve) => {
    const overlay = doc.createElement("div");
    overlay.className = "seed-dialog-backdrop";
    overlay.innerHTML = `
      <form class="seed-dialog" role="dialog" aria-modal="true" aria-labelledby="seed-dialog-title" aria-describedby="seed-dialog-hint" novalidate>
        <p class="seed-dialog-eyebrow">NEW CAMPAIGN</p>
        <h2 id="seed-dialog-title">Choose your world</h2>
        <p id="seed-dialog-hint" class="seed-dialog-hint">
          The seed code fixes every place, person and road: the same code always rebuilds the same world.
          Your campaign begins in fantasy year <span id="seed-dialog-year"></span>.
        </p>
        <label for="seed-dialog-input">Seed code</label>
        <input id="seed-dialog-input" class="seed-dialog-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="96" aria-describedby="seed-dialog-error" />
        <p id="seed-dialog-error" class="seed-dialog-error" role="alert" hidden></p>
        <div class="seed-dialog-actions">
          <button type="button" id="seed-dialog-suggest" class="seed-dialog-suggest">↻ New suggestion</button>
          <button type="submit" id="seed-dialog-start" class="seed-dialog-start">Start campaign</button>
        </div>
      </form>`;

    const form = overlay.querySelector("form") as HTMLFormElement;
    const input = overlay.querySelector("#seed-dialog-input") as HTMLInputElement;
    const error = overlay.querySelector("#seed-dialog-error") as HTMLElement;
    const suggest = overlay.querySelector("#seed-dialog-suggest") as HTMLButtonElement;
    const start = overlay.querySelector("#seed-dialog-start") as HTMLButtonElement;
    const yearLabel = overlay.querySelector("#seed-dialog-year") as HTMLElement;

    const showError = (message?: string) => {
      error.textContent = message ?? "";
      error.hidden = !message;
      input.setAttribute("aria-invalid", message ? "true" : "false");
    };
    const fill = () => {
      const now = Date.now();
      input.value = suggestSeed(now);
      yearLabel.textContent = String(fantasyYearAt(now)).padStart(4, "0");
      showError();
    };

    // Modal: the page behind is made inert while the dialog is open, then restored.
    const inertedSiblings = Array.from(doc.body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== overlay && !child.inert,
    );
    for (const sibling of inertedSiblings) sibling.inert = true;
    const close = () => {
      for (const sibling of inertedSiblings) sibling.inert = false;
      overlay.remove();
    };

    fill();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = normaliseSeedInput(input.value);
      if (result.error !== undefined) {
        showError(result.error);
        input.focus();
        return;
      }
      if (!save(result.seed)) {
        showError(STORAGE_REFUSED);
        return;
      }
      close();
      resolve(result.seed);
    });
    suggest.addEventListener("click", () => {
      fill();
      input.focus();
    });
    input.addEventListener("input", () => {
      if (!error.hidden) showError();
    });
    // Keep keyboard focus inside the dialog.
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const first = input, last = start;
      if (event.shiftKey && (doc.activeElement === first || doc.activeElement === suggest)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    doc.body.append(overlay);
    input.focus();
    input.select();
  });
}

/**
 * "New campaign…" in the Seed tab. Confirms first, clears the stored campaign and
 * reloads, so the next page load shows the seed dialog before any world module runs.
 */
export function startOverCampaign(win: Window = window): void {
  if (!win.confirm("Start a new campaign? The current campaign will be replaced.")) return;
  clearCampaign();
  if (!campaignNeedsChoice()) {
    win.alert("The saved campaign could not be cleared in this browser, so nothing was changed.");
    return;
  }
  win.location.reload();
}

/**
 * Adds the "New campaign…" button to the Seed tab (`#region-pane-seed`). Idempotent.
 * The pane is static in index.html; the observer only covers a pane that is added later.
 */
export function mountNewCampaignEntry(doc: Document = document, win: Window = window): void {
  const attach = (pane: HTMLElement): void => {
    if (doc.getElementById(ENTRY_ID)) return;
    const button = doc.createElement("button");
    button.type = "button";
    button.id = ENTRY_ID;
    button.className = "seed-new-campaign";
    button.textContent = "New campaign…";
    button.title = "Replace the current campaign with a new world seed";
    button.addEventListener("click", () => startOverCampaign(win));
    pane.append(button);
  };
  const pane = doc.getElementById("region-pane-seed");
  if (pane) {
    attach(pane);
    return;
  }
  const observer = new MutationObserver(() => {
    const found = doc.getElementById("region-pane-seed");
    if (found) {
      observer.disconnect();
      attach(found);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  win.setTimeout(() => observer.disconnect(), 30_000);
}
