/* R04 #248: free-text Advisor chat; presentation only, with bounded #181 Local BOT influence handoff. */
window.Game = window.Game || {};
(function () {
  const Game = window.Game;
  let busy = false;
  let transcriptRevision = 0;

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function node(id) { return document.getElementById(id); }
  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }

  function simulationContextRevision(world) {
    const player = world?.player || {};
    const explicit = [
      Game.State?.simulation?.contextRevision,
      world?.contextRevision,
      world?.spatialRevision,
      player?.contextRevision,
      player?.spatialRevision
    ].find((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0);
    if (explicit !== undefined) return integer(explicit, 0);

    const loop = Game.AutonomousDecisionLoop;
    if (loop && typeof loop.readCheckpoint === 'function') {
      const regionX = integer(player.regionX, integer(world?.currentRegion?.x, 0));
      const regionY = integer(player.regionY, integer(world?.currentRegion?.y, 0));
      const checkpoint = loop.readCheckpoint({ regionX, regionY });
      if (Number.isSafeInteger(Number(checkpoint?.contextRevision)) && Number(checkpoint.contextRevision) >= 0) {
        return integer(checkpoint.contextRevision, 0);
      }
    }
    return 0;
  }

  function authoritativeContext() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    const clock = Game.GameTime?.capture ? Game.GameTime.capture() : null;
    const row = integer(player.row, 0);
    const col = integer(player.col, 0);
    const seed = text(world.seed) || 'campaign';
    return {
      authority: 'simulation',
      actorId: text(world.protagonist?.id) || text(player.id) || 'protagonist:main',
      campaignRef: `campaign:${seed}`,
      locationRef: `tile:${row},${col}`,
      worldRef: `seed:${seed}`,
      regionRef: text(world.regionRef) || `region:${integer(player.regionX, 0)},${integer(player.regionY, 0)}`,
      contextRevision: simulationContextRevision(world),
      campaignMinute: Math.max(0, Math.floor(Number(clock?.totalGameMinutes) || 0)),
      actorStateRef: `player:${row},${col}`,
      adviceDispositionBias: text(world.protagonist?.adviceDispositionBias) || 'neutral',
      knownFactRefs: []
    };
  }

  function appendTurn(kind, speaker, message) {
    const transcript = node('advisorTranscript');
    if (!transcript) return;
    transcript.querySelector('.advisor-transcript-empty')?.remove();
    const turn = document.createElement('div');
    turn.className = `advisor-turn ${kind}`;
    const label = document.createElement('div');
    label.className = 'advisor-speaker';
    label.textContent = speaker;
    const body = document.createElement('div');
    body.className = 'advisor-message';
    body.textContent = message;
    turn.append(label, body);
    transcript.appendChild(turn);
    while (transcript.children.length > 12) transcript.removeChild(transcript.firstElementChild);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function dispositionLabel(value) {
    return ({ accepted: 'Accepted as advice', rejected: 'Rejected', delayed: 'Remembered for later', reinterpreted: 'Reinterpreted' })[value] || 'Considered';
  }

  function setStatus(message) {
    const status = node('advisorStatus');
    if (status) status.textContent = message;
  }

  function localBotEvaluation(result, context) {
    const localBot = Game.LocalBotDriver;
    if (!localBot || typeof localBot.normalizeAdvisorInfluence !== 'function') return null;
    return localBot.normalizeAdvisorInfluence(result, context);
  }

  function pendingState() {
    return Game.State?.advisor && typeof Game.State.advisor === 'object' ? Game.State.advisor : null;
  }

  function peekPendingInfluenceForDecision(contextInput) {
    const state = pendingState();
    if (!state || state.pending !== true || !state.latestInfluence) return null;
    const serial = Math.max(0, integer(state.transcriptRevision, 0));
    const consumed = Math.max(0, integer(state.consumedTranscriptRevision, 0));
    if (serial <= consumed) return null;

    const context = contextInput && typeof contextInput === 'object' ? contextInput : state.submissionContext;
    const evaluation = localBotEvaluation(state.latestInfluence, context);
    if (!evaluation) return null;
    state.localBotEvaluation = evaluation;

    if (evaluation.reasonCode === 'DELAY_PENDING') return null;
    if (evaluation.status !== 'ready') {
      state.pending = false;
      state.consumedTranscriptRevision = serial;
      return null;
    }
    return state.latestInfluence;
  }

  function markPendingInfluenceConsumed() {
    const state = pendingState();
    if (!state) return;
    state.pending = false;
    state.consumedTranscriptRevision = Math.max(0, integer(state.transcriptRevision, 0));
  }

  function statusFor(result, evaluation) {
    const label = dispositionLabel(result.disposition);
    if (!evaluation) return `${label} · Local BOT influence boundary unavailable. Simulation unchanged.`;
    if (evaluation.reasonCode === 'DELAY_PENDING') {
      return `${label} · pending for a later autonomous Local BOT decision · Simulation remains authoritative.`;
    }
    if (evaluation.status === 'ready') {
      return `${label} · queued for the next autonomous Local BOT decision · Simulation remains authoritative.`;
    }
    return `${label} · no Local BOT influence queued · Simulation remains authoritative.`;
  }

  function submit() {
    if (busy) return;
    const input = node('advisorMessageInput');
    const message = text(input?.value);
    if (!message) {
      setStatus('Write a message before sending.');
      input?.focus();
      return;
    }

    const contract = Game.AdvisorConversationContract;
    const localBot = Game.LocalBotDriver;
    if (!contract || typeof contract.normalize !== 'function') {
      setStatus('Local BOT conversation contract is unavailable. No world state changed.');
      return;
    }
    if (!localBot || typeof localBot.normalizeAdvisorInfluence !== 'function') {
      setStatus('Local BOT influence boundary is unavailable. No world state changed.');
      return;
    }

    busy = true;
    const button = node('advisorSendBtn');
    if (button) button.disabled = true;
    try {
      transcriptRevision += 1;
      const context = authoritativeContext();
      const result = contract.normalize(message, context);
      appendTurn('advisor', 'Advisor', message);

      if (result.status !== 'ready' || !result.record) {
        appendTurn('protagonist', 'Protagonist', 'I could not interpret that advice safely. Please rephrase it.');
        setStatus(`Advice not applied · ${result.reasonCode || 'invalid context'}. Simulation unchanged.`);
        return;
      }

      const evaluation = localBotEvaluation(result, context);
      appendTurn('protagonist', 'Protagonist', result.record.character.response);
      appendTurn('influence', dispositionLabel(result.disposition), result.record.character.interpretation);
      setStatus(statusFor(result, evaluation));
      if (input) input.value = '';

      Game.State.advisor = Game.State.advisor || {};
      const previousConsumed = Math.max(0, integer(Game.State.advisor.consumedTranscriptRevision, 0));
      Game.State.advisor.latestInfluence = result;
      Game.State.advisor.localBotEvaluation = evaluation;
      Game.State.advisor.submissionContext = Object.freeze({ ...context });
      Game.State.advisor.transcriptRevision = transcriptRevision;
      Game.State.advisor.consumedTranscriptRevision = Math.min(previousConsumed, Math.max(0, transcriptRevision - 1));
      Game.State.advisor.pending = evaluation?.status === 'ready' || evaluation?.reasonCode === 'DELAY_PENDING';
    } catch (error) {
      setStatus('Advice could not be processed. No world state changed.');
      if (Game.UI?.addLog) Game.UI.addLog('Advisor chat processing failed.', error?.message || String(error));
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  function bind() {
    const form = node('advisorChatForm');
    const input = node('advisorMessageInput');
    if (!form || !input || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();

  Game.AdvisorChatUI = Object.freeze({
    bind,
    submit,
    authoritativeContext,
    peekPendingInfluenceForDecision,
    markPendingInfluenceConsumed
  });
})();