/* R04-T06 / #175 — presentation-only bridge from authoritative autonomy runtime results. */
window.Game = window.Game || {};

(function () {
  const Game = window.Game;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function snapshotFromRuntime(input) {
    const source = input && typeof input === 'object' ? input : {};
    const execution = source.execution && typeof source.execution === 'object' ? source.execution : source;
    const status = text(source.status || execution.status).toLowerCase();
    const reasonCode = text(source.reasonCode || execution.reasonCode);
    const selectedOpportunityId = text(execution.selectedOpportunityId || source.selectedOpportunityId);
    const routeKind = text(execution.routeKind || source.routeKind);
    const simulationStatus = text(execution.simulationStatus || source.simulationStatus).toLowerCase();

    let state = 'idle';
    if (status === 'ready') state = 'intent';
    else if (status === 'wait') state = 'idle';
    else if (status === 'stale' || status === 'rejected') state = 'reconsidering';
    else if (status === 'resolved' || simulationStatus === 'resolved') state = 'resolved';
    else if (status === 'validating') state = 'validating';
    else if (status === 'acting') state = 'acting';

    return Object.freeze({
      state,
      intentLabel: selectedOpportunityId ? `Autonomous intent · ${selectedOpportunityId}` : 'Autonomous protagonist decision',
      activityLabel: state === 'resolved'
        ? 'The world reflects the latest Simulation-resolved autonomous action.'
        : state === 'reconsidering'
          ? 'The protagonist is reconsidering from current authoritative circumstances.'
          : state === 'intent'
            ? 'The protagonist has formed an autonomous intent awaiting Simulation validation.'
            : 'The protagonist has no currently resolved autonomous action.',
      contextLabel: text(source.locationRef || source.regionRef || execution.locationRef || execution.regionRef) || 'Current authoritative local context',
      targetLabel: text(execution.targetRef || source.targetRef),
      destinationLabel: text(execution.destinationRef || source.destinationRef),
      reasonLabel: reasonCode ? `Runtime status: ${reasonCode}` : 'Runtime authority remains outside presentation.',
      reasonCode,
      routeKind
    });
  }

  function renderRuntime(input) {
    const presentation = Game.AutonomyFeedbackPresentation;
    const snapshot = snapshotFromRuntime(input);
    if (!presentation || typeof presentation.renderPreview !== 'function') return snapshot;
    return presentation.renderPreview(snapshot);
  }

  function clear() {
    Game.AutonomyFeedbackPresentation?.clear?.();
  }

  Game.AutonomyFeedbackRuntime = Object.freeze({
    authority: 'presentation-only',
    snapshotFromRuntime,
    renderRuntime,
    clear
  });
})();
