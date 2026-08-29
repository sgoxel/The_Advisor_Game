/*
  R04-T05 / #174
  Designer-owned presentation prototype for autonomous protagonist intent/activity.

  This module accepts presentation snapshots only. It does not subscribe to driver
  events, select actions, validate, resolve, mutate Simulation state, or expose a
  command surface. R04-T06 may later bind verified runtime facts to this component.
*/
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const STATES = Object.freeze({
    INTENT: 'intent',
    ACTING: 'acting',
    VALIDATING: 'validating',
    RECONSIDERING: 'reconsidering',
    RESOLVED: 'resolved',
    IDLE: 'idle'
  });

  const LABELS = Object.freeze({
    intent: 'Intent chosen',
    acting: 'Acting autonomously',
    validating: 'Simulation checking',
    reconsidering: 'Reconsidering',
    resolved: 'World result',
    idle: 'Waiting'
  });

  const ICONS = Object.freeze({
    intent: '✦',
    acting: '➜',
    validating: '◇',
    reconsidering: '↻',
    resolved: '◆',
    idle: '—'
  });

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function safeState(value) {
    const state = clean(value).toLowerCase();
    return Object.values(STATES).includes(state) ? state : STATES.IDLE;
  }

  function presentationSnapshot(input) {
    const source = input && typeof input === 'object' ? input : {};
    const state = safeState(source.state);
    const destination = clean(source.destinationLabel || source.destinationRef);
    const interaction = clean(source.interactionLabel || source.targetLabel || source.targetRef);
    const context = clean(source.contextLabel || source.locationLabel || source.locationRef);
    const intent = clean(source.intentLabel || source.goalLabel || source.goalType) || 'No current intent';
    const activity = clean(source.activityLabel || source.actionLabel || source.actionType) || LABELS[state];
    const reason = clean(source.reasonLabel || source.reason) || defaultReason(state);
    const reasonCode = clean(source.reasonCode);

    return Object.freeze({
      presentationOnly: true,
      state,
      stateLabel: LABELS[state],
      icon: ICONS[state],
      intent,
      activity,
      context: context || 'Current local context',
      focusLabel: interaction || destination || 'No specific target',
      focusKind: interaction ? 'Interaction' : (destination ? 'Destination' : 'Focus'),
      reason,
      reasonCode
    });
  }

  function defaultReason(state) {
    switch (state) {
      case STATES.INTENT: return 'The protagonist has formed an autonomous intention.';
      case STATES.ACTING: return 'The protagonist is carrying out a chosen action.';
      case STATES.VALIDATING: return 'The Simulation is checking whether the chosen action can proceed.';
      case STATES.RECONSIDERING: return 'The previous path is being reconsidered from current circumstances.';
      case STATES.RESOLVED: return 'The world reflects the latest resolved consequence.';
      default: return 'The protagonist has no immediate autonomous action.';
    }
  }

  function ensureCard() {
    let card = document.getElementById('autonomyFeedbackCard');
    if (card) return card;
    const host = document.getElementById('center-area');
    if (!host) return null;

    card = document.createElement('aside');
    card.id = 'autonomyFeedbackCard';
    card.className = 'autonomy-feedback-card';
    card.hidden = true;
    card.dataset.presentationOnly = 'true';
    card.setAttribute('aria-label', 'Autonomous protagonist activity');
    card.innerHTML = `
      <div class="autonomy-feedback-header">
        <span class="autonomy-feedback-eyebrow">Protagonist activity</span>
        <span class="autonomy-feedback-badge">Autonomous</span>
      </div>
      <div class="autonomy-feedback-state" role="status" aria-live="polite" aria-atomic="true">
        <span class="autonomy-feedback-icon" data-autonomy-icon aria-hidden="true">—</span>
        <div class="autonomy-feedback-copy">
          <p class="autonomy-feedback-state-label" data-autonomy-state-label>Waiting</p>
          <p class="autonomy-feedback-title" data-autonomy-intent>No current intent</p>
          <p class="autonomy-feedback-activity" data-autonomy-activity></p>
        </div>
      </div>
      <dl class="autonomy-feedback-context">
        <div class="autonomy-feedback-context-row">
          <dt class="autonomy-feedback-term">Context</dt>
          <dd class="autonomy-feedback-value" data-autonomy-context></dd>
        </div>
        <div class="autonomy-feedback-context-row">
          <dt class="autonomy-feedback-term" data-autonomy-focus-kind>Focus</dt>
          <dd class="autonomy-feedback-value" data-autonomy-focus></dd>
        </div>
      </dl>
      <p class="autonomy-feedback-reason" data-autonomy-reason></p>
      <div class="autonomy-feedback-boundary" data-autonomy-boundary>
        <span class="autonomy-feedback-boundary-symbol" aria-hidden="true">◇</span>
        <span><strong>Advisor context is separate.</strong> Selecting or discussing something does not force this action.</span>
      </div>
      <p class="autonomy-feedback-meta" data-autonomy-meta>Presentation only — runtime authority remains outside this panel.</p>`;

    host.appendChild(card);
    return card;
  }

  function renderPreview(input) {
    const snapshot = presentationSnapshot(input);
    const card = ensureCard();
    if (!card) return snapshot;

    card.hidden = false;
    card.dataset.state = snapshot.state;
    card.dataset.presentationOnly = 'true';
    card.__autonomyPresentationSnapshot = snapshot;
    card.querySelector('[data-autonomy-icon]').textContent = snapshot.icon;
    card.querySelector('[data-autonomy-state-label]').textContent = snapshot.stateLabel;
    card.querySelector('[data-autonomy-intent]').textContent = snapshot.intent;
    card.querySelector('[data-autonomy-activity]').textContent = snapshot.activity;
    card.querySelector('[data-autonomy-context]').textContent = snapshot.context;
    card.querySelector('[data-autonomy-focus-kind]').textContent = snapshot.focusKind;
    card.querySelector('[data-autonomy-focus]').textContent = snapshot.focusLabel;
    card.querySelector('[data-autonomy-reason]').textContent = snapshot.reason;
    card.querySelector('[data-autonomy-meta]').textContent = snapshot.reasonCode
      ? `Presentation only · status reference ${snapshot.reasonCode}`
      : 'Presentation only — runtime authority remains outside this panel.';
    return snapshot;
  }

  function clear() {
    const card = document.getElementById('autonomyFeedbackCard');
    if (!card) return;
    card.hidden = true;
    card.removeAttribute('data-state');
    card.__autonomyPresentationSnapshot = null;
  }

  function install() {
    ensureCard();
  }

  Game.AutonomyFeedbackPresentation = Object.freeze({
    states: STATES,
    presentationSnapshot,
    renderPreview,
    clear,
    install
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})();
