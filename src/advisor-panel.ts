/**
 * Accessible Advisor dialogue panel (WP-S010-007-002).
 *
 * Presentation only. It reads facts from the host, calls the pure dialogue
 * pipeline and renders the result. It cannot write world state: every reply
 * either answers from facts, asks a clarification, or reports a refusal.
 */
import { ADVISOR_DIALOGUE_VERSION, respond, type AdvisorFacts, type DialogueReply } from "./advisor-dialogue.ts";
import { SENTENCE_LIBRARY_VERSION } from "./sentence-library.ts";

export type AdvisorPanelOptions = {
  /** Supplies a read-only snapshot; returning undefined means "not ready". */
  readonly readFacts: () => AdvisorFacts | undefined;
  /** Monotonic seed for wording variation only; never affects matching. */
  readonly seed?: () => number;
};

const SUGGESTIONS: readonly string[] = [
  "What are you doing?",
  "Where do you live?",
  "How do you feel?",
  "Where is Greyfield?",
];

export class AdvisorPanel {
  private readonly options: AdvisorPanelOptions;
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private sendCount = 0;

  constructor(root: HTMLElement, options: AdvisorPanelOptions) {
    this.options = options;
    this.root = root;
    const log = root.querySelector<HTMLElement>("[data-advisor-log]");
    const form = root.querySelector<HTMLFormElement>("[data-advisor-form]");
    const input = root.querySelector<HTMLInputElement>("[data-advisor-input]");
    const status = root.querySelector<HTMLElement>("[data-advisor-status]");
    const toggle = root.querySelector<HTMLButtonElement>("[data-advisor-toggle]");
    if (!log || !form || !input || !status || !toggle) throw new Error("Advisor panel markup is incomplete");
    this.log = log;
    this.form = form;
    this.input = input;
    this.status = status;
    this.toggle = toggle;

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.send(this.input.value);
    });
    this.toggle.addEventListener("click", () => this.setExpanded(this.root.getAttribute("data-expanded") !== "true"));

    for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-advisor-suggest]"))) {
      button.addEventListener("click", () => {
        this.send(button.dataset.advisorSuggest ?? button.textContent ?? "");
      });
    }
    this.renderSuggestions();
    this.setExpanded(true);
    this.appendNotice(`Offline Advisor ready · ${SENTENCE_LIBRARY_VERSION}`);
    void ADVISOR_DIALOGUE_VERSION;
  }

  /** True when the panel is visible and usable. */
  get expanded(): boolean {
    return this.root.getAttribute("data-expanded") === "true";
  }

  setExpanded(expanded: boolean): void {
    this.root.setAttribute("data-expanded", String(expanded));
    this.toggle.setAttribute("aria-expanded", String(expanded));
    this.toggle.textContent = expanded ? "Hide Advisor" : "Talk to your Advisor";
    this.input.disabled = !expanded;
    if (expanded) this.input.focus({ preventScroll: true });
  }

  /** Updates the panel heading to name the person being advised. */
  setSubject(name: string | undefined): void {
    const target = this.root.querySelector<HTMLElement>("[data-advisor-subject]");
    if (!target) return;
    target.textContent = name ? `Advising ${name}` : "No protagonist chosen";
  }

  /** Handles one player message; safe to call from tests. */
  send(raw: string): DialogueReply | undefined {
    const message = raw.trim();
    if (!message) return undefined;
    const facts = this.options.readFacts();
    if (!facts) {
      this.appendNotice("The world is still being prepared — the protagonist cannot answer yet.");
      this.setStatus("pending");
      return undefined;
    }
    const seed = (this.options.seed?.() ?? this.sendCount) + this.sendCount;
    this.sendCount += 1;

    this.appendPlayer(message);
    const reply = respond(message, facts, seed);
    this.appendReply(reply);
    this.setStatus(reply.state);
    this.input.value = "";
    this.input.focus({ preventScroll: true });
    return reply;
  }

  private renderSuggestions(): void {
    const list = this.root.querySelector<HTMLElement>("[data-advisor-suggestions]");
    if (!list || list.children.length) return;
    for (const text of SUGGESTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "advisor-suggestion";
      button.dataset.advisorSuggest = text;
      button.textContent = text;
      button.addEventListener("click", () => this.send(text));
      list.append(button);
    }
  }

  private appendPlayer(message: string): void {
    const line = document.createElement("p");
    line.className = "advisor-line advisor-line-player";
    const who = document.createElement("span");
    who.className = "advisor-who";
    who.textContent = "You";
    const body = document.createElement("span");
    body.textContent = message;
    line.append(who, body);
    this.log.append(line);
    this.scrollLog();
  }

  private appendReply(reply: DialogueReply): void {
    const line = document.createElement("p");
    line.className = `advisor-line advisor-line-hero advisor-state-${reply.state}`;
    const who = document.createElement("span");
    who.className = "advisor-who";
    who.textContent = "Advisor";
    const body = document.createElement("span");
    body.textContent = reply.text;
    line.append(who, body);

    // State is always stated in words, not colour alone.
    const state = document.createElement("span");
    state.className = "advisor-state";
    state.textContent = stateLabel(reply.state);
    line.append(state);

    if (reply.intent) {
      const why = document.createElement("details");
      why.className = "advisor-why";
      const summary = document.createElement("summary");
      summary.textContent = "Why this answer";
      const detail = document.createElement("p");
      const confidence = typeof reply.confidence === "number" ? ` · confidence ${(reply.confidence * 100).toFixed(0)}%` : "";
      detail.textContent = `matched ${reply.intent}${confidence} · ${reply.libraryVersion}`;
      why.append(summary, detail);
      line.append(why);
    }

    this.log.append(line);
    this.scrollLog();
  }

  private appendNotice(text: string): void {
    const line = document.createElement("p");
    line.className = "advisor-line advisor-line-notice";
    line.textContent = text;
    this.log.append(line);
    this.scrollLog();
  }

  private setStatus(state: string): void {
    this.status.textContent = stateLabel(state as DialogueReply["state"]);
    this.status.dataset.state = state;
  }

  private scrollLog(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }
}

export function stateLabel(state: DialogueReply["state"]): string {
  switch (state) {
    case "answered": return "answered";
    case "proposed": return "considered";
    case "refused": return "declined";
    case "ambiguous": return "clarify";
    case "unknown": return "not understood";
    case "pending": return "pending";
    default: return String(state);
  }
}
