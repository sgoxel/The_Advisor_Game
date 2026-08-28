/*
  R02-T05 campaign save/export serialization.

  This module serializes only simulation-owned authoritative state. It deliberately
  does not validate/apply imported saves (R02-T06/#88) or wire persistence controls
  into the living-map UI (R02-T07/#89).
*/

window.Game = window.Game || {};

(function () {
  const SAVE_FORMAT = 'the-advisor-game-campaign';
  const SAVE_SCHEMA_VERSION = 1;

  function authoritativeApi() {
    const api = window.Game.AuthoritativeState;
    if (!api || typeof api.capture !== 'function') {
      throw new Error('Authoritative state is not available for campaign export.');
    }
    return api;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function createEnvelope(candidateState) {
    const api = authoritativeApi();
    const authoritative = api.capture(candidateState || window.Game.State);

    return deepFreeze({
      format: SAVE_FORMAT,
      schemaVersion: SAVE_SCHEMA_VERSION,
      authoritativeSchemaVersion: authoritative.schemaVersion,
      seedIdentity: authoritative.world.seed,
      authoritative
    });
  }

  function serialize(candidateState) {
    return JSON.stringify(createEnvelope(candidateState));
  }

  function createExportBlob(candidateState) {
    return new Blob([serialize(candidateState)], {
      type: 'application/json;charset=utf-8'
    });
  }

  function sanitizeFilenamePart(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'seed';
  }

  function buildFilename(candidateState) {
    const envelope = createEnvelope(candidateState);
    const seed = sanitizeFilenamePart(envelope.seedIdentity);
    return `advisor-campaign-v${SAVE_SCHEMA_VERSION}-${seed}.json`;
  }

  function download(candidateState) {
    const serialized = serialize(candidateState);
    const envelope = JSON.parse(serialized);
    const filename = `advisor-campaign-v${SAVE_SCHEMA_VERSION}-${sanitizeFilenamePart(envelope.seedIdentity)}.json`;
    const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    return Object.freeze({ filename, serialized });
  }

  window.Game.CampaignSave = Object.freeze({
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createEnvelope,
    serialize,
    createExportBlob,
    buildFilename,
    download
  });
})();
