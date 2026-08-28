/*
  R02-T05 campaign save/export serialization.

  This module serializes only the simulation-owned state admitted by
  Game.AuthoritativeState. Import/load validation belongs to R02-T06/#88 and
  UI integration belongs to R02-T07/#89.
*/
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const AuthoritativeState = Game.AuthoritativeState;

  if (!AuthoritativeState) {
    throw new Error('Campaign persistence requires Game.AuthoritativeState.');
  }

  const SAVE_FORMAT = 'the-advisor-game/campaign-save';
  const SAVE_VERSION = 1;
  const MIME_TYPE = 'application/json;charset=utf-8';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function resolveAuthoritativeState(candidate) {
    if (candidate === undefined) {
      return AuthoritativeState.capture(Game.State);
    }
    return deepFreeze(AuthoritativeState.normalize(candidate));
  }

  function createSaveEnvelope(candidate) {
    const authoritativeState = resolveAuthoritativeState(candidate);
    return deepFreeze({
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      authority: 'simulation',
      seedIdentity: authoritativeState.world.seed,
      scope: 'authoritative-only',
      authoritativeState
    });
  }

  function serializeSave(candidate) {
    return JSON.stringify(createSaveEnvelope(candidate));
  }

  function safeFilenamePart(value) {
    const normalized = String(value || 'seed').normalize('NFKC');
    const safe = normalized
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return safe || 'seed';
  }

  function getSuggestedFilename(candidate) {
    const envelope = createSaveEnvelope(candidate);
    return `advisor-campaign-${safeFilenamePart(envelope.seedIdentity)}-v${SAVE_VERSION}.json`;
  }

  function downloadSave(candidate) {
    const envelope = createSaveEnvelope(candidate);
    const content = JSON.stringify(envelope);
    const filename = `advisor-campaign-${safeFilenamePart(envelope.seedIdentity)}-v${SAVE_VERSION}.json`;
    const blob = new Blob([content], { type: MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    return Object.freeze({ filename, mimeType: MIME_TYPE, content });
  }

  Game.CampaignPersistence = Object.freeze({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    mimeType: MIME_TYPE,
    createSaveEnvelope,
    serializeSave,
    getSuggestedFilename,
    downloadSave
  });
})();
