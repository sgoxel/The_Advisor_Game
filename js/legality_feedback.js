/*
  R03-T09 / #164
  Presentation-only legality and interaction feedback.
  This module renders authoritative validation/resolution facts; it never validates,
  resolves, mutates Simulation state or treats advisory UI events as commands.
*/
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const STATES = Object.freeze({
    CANDIDATE: 'candidate',
    ALLOWED: 'allowed',
    REJECTED: 'rejected',
    PENDING: 'pending',
    RESOLVED: 'resolved'
  });

  const LABELS = Object.freeze({
    candidate: 'Considering',
    allowed: 'Possible',
    rejected: 'Not possible',
    pending: 'Checking…',
    resolved: 'Result'
  });

  const ICONS = Object.freeze({ candidate: '◇', allowed: '○', rejected: '⊘', pending: '…', resolved: '◆' });

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function simulationOwned(value) {
    return value && typeof value === 'object' && clean(value.authority).toLowerCase() === 'simulation';
  }

  function readableReason(code) {
    const value = clean(code);
    if (!value || value === 'OK') return '';
    return value.toLowerCase().replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
  }

  function candidateSummary(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const action = clean(source.label || source.actionType || source.interactionType || 'an action');
    const target = clean(source.targetLabel || source.destinationLabel || source.targetRef || source.destinationRef);
    return target ? `Considering ${action} — ${target}` : `Considering ${action}`;
  }

  function resolvedSummary(resolution) {
    const consequence = resolution && typeof resolution.consequence === 'object' ? resolution.consequence : null;
    if (!consequence) return 'Simulation committed the result.';
    if (consequence.type === 'protagonist_location') {
      const destination = clean(consequence.destinationRef) || 'the destination';
      return `World updated: arrived at ${destination}.`;
    }
    if (consequence.type === 'world_entity_delta') {
      const target = clean(consequence.targetRef) || 'the target';
      return `World updated: ${target} changed.`;
    }
    return 'Simulation committed the result.';
  }

  function derive(input) {
    const source = input && typeof input === 'object' ? input : {};
    const phase = clean(source.phase).toLowerCase();
    const candidate = source.candidate && typeof source.candidate === 'object' ? source.candidate : {};
    const validation = source.validation && typeof source.validation === 'object' ? source.validation : null;
    const resolution = source.resolution && typeof source.resolution === 'object' ? source.resolution : null;

    if (phase === STATES.RESOLVED || resolution) {
      if (!simulationOwned(resolution) || clean(resolution.status).toLowerCase() !== 'resolved') return null;
      return Object.freeze({
        state: STATES.RESOLVED,
        label: LABELS.resolved,
        summary: resolvedSummary(resolution),
        reason: readableReason(resolution.reasonCode),
        reasonCode: clean(resolution.reasonCode),
        authority: 'Simulation',
        candidate,
        advisoryEnabled: false
      });
    }

    if (phase === STATES.PENDING) {
      if (clean(source.authority).toLowerCase() !== 'simulation') return null;
      return Object.freeze({
        state: STATES.PENDING,
        label: 'Resolving…',
        summary: candidateSummary(candidate),
        reason: 'Waiting for authoritative Simulation result.',
        reasonCode: 'PENDING',
        authority: 'Simulation',
        candidate,
        advisoryEnabled: false
      });
    }

    if (validation) {
      if (!simulationOwned(validation)) return null;
      const status = clean(validation.status).toLowerCase();
      const canResolve = validation.canResolve === true;
      if (status === 'allowed' && canResolve) {
        return Object.freeze({
          state: STATES.ALLOWED,
          label: LABELS.allowed,
          summary: candidateSummary(candidate),
          reason: 'Simulation permits this action now.',
          reasonCode: clean(validation.reasonCode),
          authority: 'Simulation',
          candidate,
          advisoryEnabled: true
        });
      }
      return Object.freeze({
        state: STATES.REJECTED,
        label: status === 'not_applicable' ? 'Not applicable' : LABELS.rejected,
        summary: candidateSummary(candidate),
        reason: readableReason(validation.reasonCode) || 'Simulation rejected this action.',
        reasonCode: clean(validation.reasonCode),
        authority: 'Simulation',
        candidate,
        advisoryEnabled: false
      });
    }

    if (phase === STATES.CANDIDATE) {
      const candidateSource = clean(candidate.source || source.source).toLowerCase();
      if (!['character', 'advisor-context'].includes(candidateSource)) return null;
      return Object.freeze({
        state: STATES.CANDIDATE,
        label: LABELS.candidate,
        summary: candidateSummary(candidate),
        reason: 'Legality has not yet been decided by the Simulation.',
        reasonCode: 'UNVALIDATED_CANDIDATE',
        authority: 'Awaiting Simulation',
        candidate,
        advisoryEnabled: true
      });
    }

    return null;
  }

  function ensureCard() {
    let card = document.getElementById('legalityFeedbackCard');
    if (card) return card;
    const host = document.getElementById('center-area');
    if (!host) return null;

    card = document.createElement('aside');
    card.id = 'legalityFeedbackCard';
    card.className = 'legality-feedback-card';
    card.hidden = true;
    card.setAttribute('aria-label', 'Action and interaction status');
    card.innerHTML = `
      <div class="legality-feedback-header">
        <span>Action context</span>
        <span class="legality-feedback-authority" data-feedback-authority>Simulation</span>
      </div>
      <div class="legality-feedback-state-row" role="status" aria-live="polite" aria-atomic="true">
        <span class="legality-feedback-icon" aria-hidden="true"><span data-feedback-icon>◇</span></span>
        <div class="legality-feedback-copy">
          <p class="legality-feedback-label" data-feedback-label>Considering</p>
          <p class="legality-feedback-summary" data-feedback-summary></p>
        </div>
      </div>
      <p class="legality-feedback-reason" data-feedback-reason></p>
      <div class="legality-feedback-actions">
        <button class="legality-feedback-action" type="button" data-advisor-action="suggest">Suggest this</button>
        <button class="legality-feedback-action" type="button" data-advisor-action="discuss">Discuss</button>
      </div>
      <details class="legality-feedback-details">
        <summary>Why?</summary>
        <p class="legality-feedback-meta" data-feedback-meta></p>
      </details>`;

    card.querySelectorAll('[data-advisor-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const snapshot = card.__feedbackSnapshot;
        if (!snapshot) return;
        card.dispatchEvent(new CustomEvent('advisor-suggestion', {
          bubbles: true,
          detail: Object.freeze({
            kind: button.dataset.advisorAction,
            candidate: snapshot.candidate,
            presentationOnly: true
          })
        }));
      });
    });

    host.appendChild(card);
    return card;
  }

  function render(input) {
    const snapshot = derive(input);
    const card = ensureCard();
    if (!card) return null;
    if (!snapshot) {
      card.hidden = true;
      card.removeAttribute('data-state');
      card.__feedbackSnapshot = null;
      return null;
    }

    card.hidden = false;
    card.dataset.state = snapshot.state;
    card.dataset.authority = snapshot.authority;
    card.__feedbackSnapshot = snapshot;
    card.querySelector('[data-feedback-authority]').textContent = snapshot.authority;
    card.querySelector('[data-feedback-icon]').textContent = ICONS[snapshot.state];
    card.querySelector('[data-feedback-label]').textContent = snapshot.label;
    card.querySelector('[data-feedback-summary]').textContent = snapshot.summary;
    card.querySelector('[data-feedback-reason]').textContent = snapshot.reason;
    card.querySelector('[data-feedback-meta]').textContent = snapshot.reasonCode
      ? `Authoritative reason: ${snapshot.reasonCode}`
      : 'Authoritative reason unavailable.';
    card.querySelectorAll('[data-advisor-action]').forEach((button) => { button.disabled = !snapshot.advisoryEnabled; });
    return snapshot;
  }

  function clear() {
    const card = ensureCard();
    if (!card) return;
    card.hidden = true;
    card.__feedbackSnapshot = null;
  }

  function install() {
    ensureCard();
    document.addEventListener('advisor-legality-feedback', (event) => render(event.detail));
  }

  Game.LegalityFeedback = Object.freeze({
    states: STATES,
    derive,
    render,
    clear,
    install
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})();
