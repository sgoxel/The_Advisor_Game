/**
 * Accessible Advisor dialogue panel (WP-S010-007-002).
 *
 * Presentation only. It reads facts from the host, calls the pure dialogue
 * pipeline and renders the result. It cannot write world state: every reply
 * either answers from facts, asks a clarification, or reports a refusal.
 */
import { ADVISOR_DIALOGUE_VERSION, Conversation, type AdvisorFacts, type DialogueReply, type FollowUpPrompt } from "./advisor-dialogue.ts";
import { SENTENCE_LIBRARY_VERSION } from "./sentence-library.ts";
import {
  applyExchange,
  loadCharacter,
  saveCharacter,
  setEveningPlan,
  statusOf,
  trustLabel,
  type CharacterState,
  type ExchangeOutcome,
} from "./character-state.ts";

export type AdvisorPanelOptions = {
  /** Supplies a read-only snapshot; returning undefined means "not ready". */
  readonly readFacts: () => AdvisorFacts | undefined;
  /** Monotonic seed for wording variation only; never affects matching. */
  readonly seed?: () => number;
  /** Notified after a relationship change is saved, so the host can react. */
  readonly onRelationshipChange?: (state: CharacterState, outcome: ExchangeOutcome) => void;
  /**
   * Runs a character-accepted proposal through the Simulation. The dialogue
   * layer never mutates the world itself: it only reports that the character
   * agreed to weigh the advice. Returning undefined means "no executor".
   */
  readonly onAdviceAccepted?: (
    proposal: { readonly intent: string; readonly targetId?: string; readonly targetName?: string },
    facts: AdvisorFacts,
  ) => Promise<{ readonly started: boolean; readonly message: string }>;
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
  private readonly conversation = new Conversation();

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
    this.refreshRelationship();
    // On phones and short landscape screens the Advisor starts as a compact
    // bar so the map and the information panel keep their space; the header
    // button or the quick dock expands it on demand.
    this.setExpanded(window.innerWidth > 700 && window.innerHeight >= 640);
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
    const label = expanded ? "Hide" : "Talk";
    const text = this.toggle.querySelector<HTMLElement>("[data-advisor-toggle-label]");
    if (text) text.textContent = label;
    else this.toggle.textContent = expanded ? "Hide Advisor" : "Talk to your Advisor";
    this.toggle.setAttribute("aria-label", expanded ? "Hide Advisor" : "Talk to your Advisor");
    this.toggle.title = expanded ? "Hide Advisor" : "Talk to your Advisor";
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
    // The conversation object is what makes "why?" follow-ups possible.
    const reply = this.conversation.ask(message, facts, seed);
    this.appendReply(reply);
    this.setStatus(reply.state);
    this.renderFollowUps(reply.followUps);
    // Record the relationship change and save it against this character, so the
    // protagonist keeps their history across reloads.
    if (reply.exchange && facts.characterCode) {
      const before = loadCharacter(facts.characterCode, reply.exchange.day);
      const outcome = applyExchange(before, {
        tag: reply.exchange.tag,
        day: reply.exchange.day,
        moodBand: before.moodDelta > 0.1 ? "cheerful" : before.moodDelta < -0.1 ? "miserable" : "calm",
        refused: reply.exchange.refused,
        intent: reply.exchange.intent,
      });
      saveCharacter(outcome.state);
      this.renderRelationship(outcome.state, outcome);
      if (this.options.onRelationshipChange) {
        this.options.onRelationshipChange(outcome.state, outcome);
      }
    }
    this.input.value = "";
    this.input.focus({ preventScroll: true });
    // A character may agree to weigh advice. An evening preference changes their
    // own plan and needs no journey; everything else goes to the Simulation.
    if (reply.state === "proposed" && reply.proposal && facts.characterCode) {
      if (isEveningIntent(reply.proposal.intent)) {
        this.saveEveningPreference(reply.proposal.intent, reply.proposal.targetName, facts);
      } else if (this.options.onAdviceAccepted) {
        void this.resolveAdvice(reply.proposal, facts);
      }
    }
    return reply;
  }

  /** Persists an accepted "where to go after duty" preference. */
  private saveEveningPreference(intent: string, _targetName: string | undefined, facts: AdvisorFacts): void {
    if (!facts.characterCode) return;
    const destination =
      intent === "advice.evening_inn" ? "inn" as const
        : intent === "advice.evening_market" ? "market" as const
          : intent === "advice.evening_home" ? "home" as const
            : undefined;
    if (!destination) return;
    const day = facts.day ?? 0;
    const saved = setEveningPlan(loadCharacter(facts.characterCode, day), destination, day);
    saveCharacter(saved);
    this.renderRelationship(saved);
    const line = document.createElement("p");
    line.className = "advisor-line advisor-line-hero advisor-state-answered";
    const who = document.createElement("span");
    who.className = "advisor-who";
    who.textContent = "Advisor";
    const body = document.createElement("span");
    body.textContent = `Saved: after duty, ${destination === "home" ? "straight home" : `the ${destination}`}.`;
    const state = document.createElement("span");
    state.className = "advisor-state";
    state.textContent = "planned";
    line.append(who, body, state);
    this.log.append(line);
    this.scrollLog();
  }

  /** Asks the Simulation to carry out an accepted proposal, then reports truthfully. */
  private async resolveAdvice(
    proposal: { readonly intent: string; readonly targetId?: string; readonly targetName?: string },
    facts: AdvisorFacts,
  ): Promise<void> {
    const executor = this.options.onAdviceAccepted;
    if (!executor) return;
    let result: { readonly started: boolean; readonly message: string };
    try {
      result = await executor(proposal, facts);
    } catch {
      result = { started: false, message: "The attempt could not be completed." };
    }
    const line = document.createElement("p");
    line.className = `advisor-line advisor-line-hero advisor-state-${result.started ? "answered" : "refused"}`;
    const who = document.createElement("span");
    who.className = "advisor-who";
    who.textContent = "Advisor";
    const body = document.createElement("span");
    body.textContent = result.message;
    const state = document.createElement("span");
    state.className = "advisor-state";
    state.textContent = result.started ? "acting" : "declined";
    line.append(who, body, state);
    this.log.append(line);
    this.scrollLog();
    this.setStatus(result.started ? "answered" : "refused");
  }

  /** Refreshes the relationship strip without asking a question it cannot answer. */
  refreshRelationship(): void {
    const facts = this.options.readFacts();
    if (!facts?.characterCode) {
      this.renderRelationship(undefined);
      return;
    }
    this.renderRelationship(loadCharacter(facts.characterCode, facts.day ?? 0));
  }

  private renderRelationship(state: CharacterState | undefined, outcome?: ExchangeOutcome): void {
    const host = this.root.querySelector<HTMLElement>("[data-advisor-relationship]");
    if (!host) return;
    if (!state) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const mood = state.moodDelta === 0 ? "steady"
      : state.moodDelta > 0 ? `lighter (+${state.moodDelta.toFixed(2)})`
        : `heavier (${state.moodDelta.toFixed(2)})`;
    const status = statusOf(state);
    const delta = outcome && !outcome.repeated
      ? outcome.trustDelta === 0 ? ""
        : outcome.trustDelta > 0 ? ` · +${outcome.trustDelta.toFixed(1)} trust`
          : ` · ${outcome.trustDelta.toFixed(1)} trust`
      : outcome?.repeated ? " · already asked today" : "";
    host.innerHTML =
      `<span class="rel-trust" title="Advisor trust, 0-100">${trustLabel(state.trust)} <b>${Math.round(state.trust)}</b></span>` +
      `<span class="rel-mood" title="How conversation has shaded their mood">${mood}</span>` +
      (status ? `<span class="rel-status">${status}</span>` : "") +
      (delta ? `<span class="rel-delta">${delta}</span>` : "");
  }

  /** Restarts the conversation, dropping the remembered answer. */
  resetConversation(): void {
    this.conversation.reset();
    this.log.replaceChildren();
    this.renderSuggestions();
    this.clearFollowUps();
    this.appendNotice(`Offline Advisor ready · ${SENTENCE_LIBRARY_VERSION}`);
  }

  private renderFollowUps(prompts: readonly FollowUpPrompt[] | undefined): void {
    this.clearFollowUps();
    const host = this.root.querySelector<HTMLElement>("[data-advisor-followups]");
    if (!host || !prompts?.length) return;
    host.hidden = false;
    const label = document.createElement("span");
    label.className = "advisor-followup-label";
    label.textContent = "Ask next";
    host.append(label);
    for (const prompt of prompts.slice(0, 4)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "advisor-suggestion advisor-followup";
      button.textContent = prompt.label;
      button.dataset.advisorFollowup = prompt.message;
      button.addEventListener("click", () => this.send(prompt.message));
      host.append(button);
    }
  }

  private clearFollowUps(): void {
    const host = this.root.querySelector<HTMLElement>("[data-advisor-followups]");
    if (!host) return;
    host.replaceChildren();
    host.hidden = true;
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
}/** True when this intent is a post-duty destination preference. */
function isEveningIntent(intent: string): boolean {
  return intent === "advice.evening_inn" || intent === "advice.evening_market" || intent === "advice.evening_home";
}


