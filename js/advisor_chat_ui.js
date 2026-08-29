/* R04 #248: presentation-only free-text Advisor chat binding. */
window.Game = window.Game || {};
(function () {
  const Game = window.Game;
  let busy = false;
  let revision = 0;

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function node(id) { return document.getElementById(id); }

  function authoritativeContext() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    const clock = Game.GameTime?.capture ? Game.GameTime.capture() : null;
    const row = Number.isFinite(Number(player.row)) ? Math.trunc(Number(player.row)) : 0;
    const col = Number.isFinite(Number(player.col)) ? Math.trunc(Number(player.col)) : 0;
    const seed = text(world.seed) || 'campaign';
    return {
      authority: 'simulation',
      actorId: text(world.protagonist?.id) || 'protagonist',
      campaignRef: `campaign:${seed}`,
      locationRef: `tile:${row},${col}`,
      worldRef: `seed:${seed}`,
      regionRef: text(world.regionRef) || 'region:0,0',
      contextRevision: revision,
      campaignMinute: Math.max(0, Math.floor(Number(clock?.totalGameMinutes) || 0)),
      actorStateRef: `player:${row},${col}`,
      adviceDispositionBias: text(world.protagonist?.adviceDispositionBias) || 'neutral',
      knownFactRefs: []
    };
  }

  function appendTurn(kind, speaker, message) {
    const transcript = node('advisorTranscript');
    if (!transcript) return;
    const empty = transcript.querySelector('.advisor-transcript-empty');
    if (empty) empty.remove();
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
    return ({accepted:'Accepted as advice',rejected:'Rejected',delayed:'Remembered for later',reinterpreted:'Reinterpreted'})[value] || 'Considered';
  }

  function setStatus(message) {
    const status = node('advisorStatus');
    if (status) status.textContent = message;
  }

  function submit() {
    if (busy) return;
    const input = node('advisorMessageInput');
    const message = text(input?.value);
    if (!message) { setStatus('Write a message before sending.'); input?.focus(); return; }
    const contract = Game.AdvisorConversationContract;
    if (!contract || typeof contract.normalize !== 'function') { setStatus('Local BOT conversation contract is unavailable. No world state changed.'); return; }
    busy = true;
    const button = node('advisorSendBtn');
    if (button) button.disabled = true;
    try {
      revision += 1;
      const result = contract.normalize(message, authoritativeContext());
      appendTurn('advisor', 'Advisor', message);
      if (result.status !== 'ready' || !result.record) {
        appendTurn('protagonist', 'Protagonist', 'I could not interpret that advice safely. Please rephrase it.');
        setStatus(`Advice not applied · ${result.reasonCode || 'invalid context'}. Simulation unchanged.`);
        return;
      }
      appendTurn('protagonist', 'Protagonist', result.record.character.response);
      appendTurn('influence', dispositionLabel(result.disposition), result.record.character.interpretation);
      setStatus(`${dispositionLabel(result.disposition)} · non-binding influence only · Simulation remains authoritative.`);
      if (input) input.value = '';
      Game.State.advisor = Game.State.advisor || {};
      Game.State.advisor.latestInfluence = result;
      Game.State.advisor.transcriptRevision = revision;
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
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true }); else bind();
  Game.AdvisorChatUI = Object.freeze({ bind, submit });
})();