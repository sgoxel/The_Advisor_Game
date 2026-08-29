/* R04-T06 / #175 — presentation-only bridge from authoritative autonomy runtime results. */
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const OBSERVE_INTERVAL_MS = 200;
  let observerTimer = null;
  let lastObservedKey = '';

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function runtimeAuthority(input) {
    const source = input && typeof input === 'object' ? input : {};
    const execution = source.execution && typeof source.execution === 'object' ? source.execution : {};
    return text(source.authority || execution.authority).toLowerCase();
  }

  function snapshotFromRuntime(input) {
    const source = input && typeof input === 'object' ? input : {};
    const execution = source.execution && typeof source.execution === 'object' ? source.execution : source;
    const status = text(source.status || source.lastStatus || execution.status).toLowerCase();
    const reasonCode = text(source.reasonCode || source.lastReasonCode || execution.reasonCode);
    const selectedOpportunityId = text(execution.selectedOpportunityId || source.selectedOpportunityId);
    const routeKind = text(execution.routeKind || source.routeKind);
    const simulationStatus = text(execution.simulationStatus || source.simulationStatus).toLowerCase();

    let state = 'idle';
    if (status === 'ready') state = 'intent';
    else if (status === 'wait' || status === 'idle') state = 'idle';
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
    if (runtimeAuthority(input) !== 'simulation') {
      return Object.freeze({ ignored: true, reasonCode: 'NON_SIMULATION_RUNTIME' });
    }
    const presentation = Game.AutonomyFeedbackPresentation;
    const snapshot = snapshotFromRuntime(input);
    if (!presentation || typeof presentation.renderPreview !== 'function') return snapshot;
    return presentation.renderPreview(snapshot);
  }

  function currentRegionCoordinates() {
    const world = Game.State?.world;
    const current = world?.currentRegion || {};
    const player = world?.player || {};
    const regionX = Number.isSafeInteger(player.regionX) ? player.regionX : (Number.isSafeInteger(current.x) ? current.x : 0);
    const regionY = Number.isSafeInteger(player.regionY) ? player.regionY : (Number.isSafeInteger(current.y) ? current.y : 0);
    return { regionX, regionY };
  }

  function checkpointRuntimeSnapshot() {
    const loop = Game.AutonomousDecisionLoop;
    if (!loop || typeof loop.readCheckpoint !== 'function') return null;
    const coordinates = currentRegionCoordinates();
    const checkpoint = loop.readCheckpoint(coordinates);
    if (!checkpoint) return null;
    return Object.freeze({
      authority: 'simulation',
      status: checkpoint.lastStatus || 'idle',
      reasonCode: checkpoint.lastReasonCode || '',
      selectedOpportunityId: checkpoint.selectedOpportunityId || '',
      locationRef: checkpoint.locationRef || '',
      regionRef: checkpoint.regionRef || '',
      worldRef: checkpoint.worldRef || '',
      campaignMinute: checkpoint.campaignMinute,
      contextRevision: checkpoint.contextRevision,
      checkpointSerial: checkpoint.serial
    });
  }

  function observeNow() {
    const runtime = checkpointRuntimeSnapshot();
    if (!runtime) return null;
    const key = JSON.stringify([
      runtime.worldRef,
      runtime.regionRef,
      runtime.locationRef,
      runtime.checkpointSerial,
      runtime.campaignMinute,
      runtime.status,
      runtime.reasonCode,
      runtime.selectedOpportunityId
    ]);
    if (key === lastObservedKey) return runtime;
    lastObservedKey = key;
    renderRuntime(runtime);
    return runtime;
  }

  function startObserver() {
    if (observerTimer !== null || typeof window === 'undefined') return;
    observeNow();
    observerTimer = window.setInterval(observeNow, OBSERVE_INTERVAL_MS);
  }

  function stopObserver() {
    if (observerTimer !== null && typeof window !== 'undefined') window.clearInterval(observerTimer);
    observerTimer = null;
  }

  function clear() {
    lastObservedKey = '';
    Game.AutonomyFeedbackPresentation?.clear?.();
  }

  Game.AutonomyFeedbackRuntime = Object.freeze({
    authority: 'presentation-only',
    observeIntervalMs: OBSERVE_INTERVAL_MS,
    snapshotFromRuntime,
    renderRuntime,
    observeNow,
    startObserver,
    stopObserver,
    clear
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    else startObserver();
  }
})();
