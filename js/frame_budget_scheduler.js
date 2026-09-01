window.Game = window.Game || {};

(function (global) {
  'use strict';

  const Game = global.Game;
  if (Game.FrameBudgetScheduler) return;

  const FRAME_TARGET_MS = 16.67;
  const INTERACTION_HOLD_MS = 140;
  const MIN_SLACK_MS = 2.0;
  const MAX_BACKGROUND_SLICE_MS = 6.0;
  const MAX_SAMPLES = 240;
  const queue = [];
  const queuedByKey = new Map();
  const frameSamples = [];
  const jobSamples = [];
  let interactionUntil = 0;
  let renderDepth = 0;
  let wrappedRenderer = null;
  let originalRenderWorld = null;
  let lastRenderStartedAt = 0;
  let sequence = 0;

  const counters = {
    frames: 0,
    interactionFrames: 0,
    deferredJobs: 0,
    completedJobs: 0,
    yieldedJobs: 0,
    failedJobs: 0,
    executedSlices: 0
  };

  function nowMs() {
    return global.performance && typeof global.performance.now === 'function'
      ? global.performance.now()
      : Date.now();
  }

  function clampSample(list, value) {
    if (!Number.isFinite(value)) return;
    list.push(value);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  }

  function percentile(list, ratio) {
    if (!list.length) return 0;
    const sorted = list.slice().sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
  }

  function cameraIsInteracting() {
    const state = Game.State;
    const camera = state && state.camera;
    if (!camera) return false;
    if (camera.dragActive) return true;
    if (Math.abs(Number(camera.inertiaVelocityX) || 0) >= Number(camera.inertiaMinVelocity || 0.0001)) return true;
    if (Math.abs(Number(camera.inertiaVelocityY) || 0) >= Number(camera.inertiaMinVelocity || 0.0001)) return true;
    const keys = state && state.input && state.input.keys;
    if (keys && typeof keys.has === 'function') {
      for (const key of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) {
        if (keys.has(key)) return true;
      }
    }
    return false;
  }

  function noteInteraction(kind, holdMs) {
    // Runtime modules legitimately wrap Renderer.renderWorld after scheduler startup.
    // Reassert the scheduler as the outermost wrapper at the interaction boundary so
    // the visible interaction frame is always measured/prioritized. Shared renderDepth
    // prevents duplicate accounting if an older scheduler wrapper remains deeper in the chain.
    wrapRenderer();
    const hold = Number.isFinite(Number(holdMs)) ? Math.max(0, Number(holdMs)) : INTERACTION_HOLD_MS;
    interactionUntil = Math.max(interactionUntil, nowMs() + hold);
    return String(kind || 'interaction');
  }

  function interactionActive(at) {
    const time = Number.isFinite(at) ? at : nowMs();
    return time < interactionUntil || cameraIsInteracting();
  }

  function normalizeJob(key, step, options) {
    if (typeof step !== 'function') throw new TypeError('FrameBudgetScheduler.enqueue requires a step function.');
    const safeKey = String(key || `job-${++sequence}`);
    const opts = options && typeof options === 'object' ? options : {};
    return {
      key: safeKey,
      step,
      priority: Number.isFinite(Number(opts.priority)) ? Number(opts.priority) : 0,
      createdAt: nowMs(),
      version: opts.version == null ? null : String(opts.version),
      label: String(opts.label || safeKey),
      required: opts.required === true,
      attempts: 0
    };
  }

  function enqueue(key, step, options) {
    const job = normalizeJob(key, step, options);
    const prior = queuedByKey.get(job.key);
    if (prior) {
      const index = queue.indexOf(prior);
      if (index >= 0) queue.splice(index, 1);
    }
    queuedByKey.set(job.key, job);
    queue.push(job);
    queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.key.localeCompare(b.key));
    return job.key;
  }

  function cancel(key) {
    const safeKey = String(key || '');
    const job = queuedByKey.get(safeKey);
    if (!job) return false;
    queuedByKey.delete(safeKey);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    return true;
  }

  function finishJob(job) {
    queuedByKey.delete(job.key);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    counters.completedJobs += 1;
  }

  function shouldYield(deadline) {
    return interactionActive() || nowMs() >= deadline;
  }

  function runBackgroundSlice(frameStartedAt) {
    if (!queue.length) return { ran: 0, deferred: 0 };

    const current = nowMs();
    if (interactionActive(current)) {
      counters.deferredJobs += queue.length;
      return { ran: 0, deferred: queue.length };
    }

    const elapsed = Math.max(0, current - (Number(frameStartedAt) || current));
    const available = Math.min(MAX_BACKGROUND_SLICE_MS, FRAME_TARGET_MS - elapsed - MIN_SLACK_MS);
    if (available <= 0.25) {
      counters.deferredJobs += queue.length;
      return { ran: 0, deferred: queue.length };
    }

    const deadline = current + available;
    let ran = 0;
    while (queue.length && nowMs() < deadline && !interactionActive()) {
      const job = queue[0];
      const started = nowMs();
      job.attempts += 1;
      let result;
      try {
        result = job.step(Object.freeze({
          key: job.key,
          label: job.label,
          deadline,
          budgetMs: Math.max(0, deadline - started),
          shouldYield: () => shouldYield(deadline),
          interactionActive: () => interactionActive()
        }));
      } catch (error) {
        counters.failedJobs += 1;
        finishJob(job);
        global.setTimeout(() => { throw error; }, 0);
        continue;
      }
      const duration = Math.max(0, nowMs() - started);
      clampSample(jobSamples, duration);
      counters.executedSlices += 1;
      ran += 1;

      const done = result === true || (result && typeof result === 'object' && result.done === true);
      if (done) {
        finishJob(job);
      } else {
        counters.yieldedJobs += 1;
        queue.push(queue.shift());
      }

      if (shouldYield(deadline)) break;
    }
    if (queue.length) counters.deferredJobs += queue.length;
    return { ran, deferred: queue.length };
  }

  function recordRenderFrame(startedAt, endedAt) {
    const duration = Math.max(0, endedAt - startedAt);
    counters.frames += 1;
    if (interactionActive(endedAt)) counters.interactionFrames += 1;
    clampSample(frameSamples, duration);
    return duration;
  }

  function wrapRenderer() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function') return false;
    // Only the current top-level function proves the scheduler is still outermost.
    // If another runtime module wrapped renderWorld later, wrap that new chain again.
    // renderDepth makes a nested older scheduler wrapper account only once.
    if (renderer.renderWorld.__frameBudgetWrapped === true) return true;

    const previousRenderWorld = renderer.renderWorld;
    originalRenderWorld = previousRenderWorld;
    const wrapped = function (...args) {
      const startedAt = nowMs();
      lastRenderStartedAt = startedAt;
      renderDepth += 1;
      try {
        return previousRenderWorld.apply(this, args);
      } finally {
        renderDepth -= 1;
        const endedAt = nowMs();
        if (renderDepth === 0) {
          recordRenderFrame(startedAt, endedAt);
          runBackgroundSlice(startedAt);
        }
      }
    };
    Object.defineProperty(wrapped, '__frameBudgetWrapped', { value: true });
    renderer.renderWorld = wrapped;
    wrappedRenderer = renderer;
    return true;
  }

  function installInteractionSignals() {
    const canvas = Game.State && Game.State.dom && Game.State.dom.canvas
      ? Game.State.dom.canvas
      : document.getElementById('gameCanvas');
    const target = canvas || document;
    target.addEventListener('wheel', () => noteInteraction('wheel'), { capture: true, passive: true });
    target.addEventListener('mousedown', () => noteInteraction('pointer-pan'), true);
    target.addEventListener('mousemove', (event) => {
      if ((event.buttons || 0) !== 0 || (Game.State && Game.State.camera && Game.State.camera.dragActive)) noteInteraction('pointer-pan');
    }, true);
    target.addEventListener('touchstart', () => noteInteraction('touch-pan'), { capture: true, passive: true });
    target.addEventListener('touchmove', () => noteInteraction('touch-pan'), { capture: true, passive: true });
    global.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) noteInteraction('keyboard-pan');
    }, true);
  }

  function metrics() {
    return Object.freeze({
      authority: 'scheduling-only',
      frameTargetMs: FRAME_TARGET_MS,
      interactionActive: interactionActive(),
      queueDepth: queue.length,
      queuedKeys: queue.map((job) => job.key),
      frames: counters.frames,
      interactionFrames: counters.interactionFrames,
      deferredJobs: counters.deferredJobs,
      completedJobs: counters.completedJobs,
      yieldedJobs: counters.yieldedJobs,
      failedJobs: counters.failedJobs,
      executedSlices: counters.executedSlices,
      renderP50Ms: percentile(frameSamples, 0.50),
      renderP95Ms: percentile(frameSamples, 0.95),
      renderWorstMs: frameSamples.length ? Math.max(...frameSamples) : 0,
      jobP95Ms: percentile(jobSamples, 0.95),
      jobWorstMs: jobSamples.length ? Math.max(...jobSamples) : 0,
      lastRenderStartedAt
    });
  }

  Game.FrameBudgetScheduler = Object.freeze({
    version: '1.0.1',
    authority: 'scheduling-only',
    enqueue,
    cancel,
    noteInteraction,
    interactionActive,
    runBackgroundSlice,
    metrics,
    wrapRenderer,
    constants: Object.freeze({
      frameTargetMs: FRAME_TARGET_MS,
      interactionHoldMs: INTERACTION_HOLD_MS,
      minSlackMs: MIN_SLACK_MS,
      maxBackgroundSliceMs: MAX_BACKGROUND_SLICE_MS
    })
  });

  installInteractionSignals();
  if (!wrapRenderer()) {
    let attempts = 0;
    const install = () => {
      attempts += 1;
      if (!wrapRenderer() && attempts < 120) global.requestAnimationFrame(install);
    };
    global.requestAnimationFrame(install);
  }
})(window);
