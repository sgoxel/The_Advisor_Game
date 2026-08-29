/*
  R04 #278: backward-compatible campaign-save extension for the authoritative protagonist profile.

  The R02 core persistence format/version and world validator remain unchanged. This adapter
  decorates the same v1 authoritative-only envelope with one Simulation-owned characterProfile
  field, validates it independently, and restores it after the core world save has loaded.
  Legacy v1 saves that predate this field migrate deterministically to the new-campaign Peasant
  default because the old Level 7 Ranger UI strings were never authoritative save state.
*/
(function installCharacterProfilePersistence(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const Core = Game.CampaignPersistence;
  if (!Core) throw new Error('Character profile persistence requires CampaignPersistence.');

  const MIME_TYPE = Core.mimeType || 'application/json;charset=utf-8';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function invalid(code, message) {
    return deepFreeze({ ok: false, code, message });
  }

  function profileApi() {
    const api = Game.CharacterProgressionProfile;
    if (!api?.normalize || !api?.isCurrentProfile || !api?.installCurrent) {
      throw new Error('CharacterProgressionProfile is unavailable.');
    }
    return api;
  }

  function parseEnvelope(input) {
    if (typeof input !== 'string') return input;
    try { return JSON.parse(input); } catch (_error) { return null; }
  }

  function resolveProfile(seedIdentity, candidateInput = undefined) {
    const api = profileApi();
    const candidate = candidateInput === undefined ? Game.State?.characterProfile : candidateInput;
    if (candidate === null || candidate === undefined) return api.normalize(seedIdentity, 'protagonist', null);
    if (!api.isCurrentProfile(candidate) || candidate.seed !== seedIdentity || candidate.characterId !== 'protagonist') {
      if (candidateInput === undefined) return api.normalize(seedIdentity, 'protagonist', null);
      throw new TypeError('Character profile does not match the authoritative campaign seed/protagonist.');
    }
    return api.normalize(seedIdentity, 'protagonist', candidate);
  }

  function decorateEnvelope(coreEnvelope, profileCandidate = undefined) {
    const characterProfile = resolveProfile(coreEnvelope.seedIdentity, profileCandidate);
    return deepFreeze({ ...coreEnvelope, characterProfile });
  }

  function createSaveEnvelope(candidate, deltaCandidate, profileCandidate = undefined) {
    return decorateEnvelope(Core.createSaveEnvelope(candidate, deltaCandidate), profileCandidate);
  }

  function serializeSave(candidate, deltaCandidate, profileCandidate = undefined) {
    return JSON.stringify(createSaveEnvelope(candidate, deltaCandidate, profileCandidate));
  }

  function getSuggestedFilename(candidate) {
    return Core.getSuggestedFilename(candidate);
  }

  function downloadSave(candidate, deltaCandidate, profileCandidate = undefined) {
    const envelope = createSaveEnvelope(candidate, deltaCandidate, profileCandidate);
    const content = JSON.stringify(envelope);
    const filename = Core.getSuggestedFilename(candidate);
    const blob = new Blob([content], { type: MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Object.freeze({ filename, mimeType: MIME_TYPE, content });
  }

  function validateSave(input) {
    const coreChecked = Core.validateSave(input);
    if (!coreChecked.ok) return coreChecked;

    const envelope = parseEnvelope(input);
    if (!envelope || typeof envelope !== 'object') return invalid('INVALID_ENVELOPE', 'Campaign save must be a JSON object.');

    const seedIdentity = coreChecked.authoritativeState.world.seed;
    const api = profileApi();
    const supplied = envelope.characterProfile;
    let characterProfile;
    let profileMigratedFromLegacy = false;

    if (supplied === undefined) {
      characterProfile = api.normalize(seedIdentity, 'protagonist', null);
      profileMigratedFromLegacy = true;
    } else {
      if (!api.isCurrentProfile(supplied) || supplied.seed !== seedIdentity || supplied.characterId !== 'protagonist') {
        return invalid('INVALID_CHARACTER_PROFILE', 'Save character profile schema, authority or campaign identity is invalid.');
      }
      characterProfile = api.normalize(seedIdentity, 'protagonist', supplied);
    }

    return deepFreeze({
      ...coreChecked,
      characterProfile,
      profileMigratedFromLegacy,
      envelope: decorateEnvelope(coreChecked.envelope, characterProfile)
    });
  }

  function loadSave(input) {
    const checked = validateSave(input);
    if (!checked.ok) return checked;
    const coreLoaded = Core.loadSave(input);
    if (!coreLoaded.ok) return coreLoaded;

    // Legacy v1 envelopes never contained authoritative profile state. Preserve that
    // migration provenance by installing a fresh deterministic default instead of
    // reclassifying the validated default object as established campaign state.
    const characterProfile = profileApi().installCurrent(
      checked.profileMigratedFromLegacy ? null : checked.characterProfile,
      checked.authoritativeState.world.seed
    );

    return deepFreeze({
      ...coreLoaded,
      characterProfile,
      profileMigratedFromLegacy: checked.profileMigratedFromLegacy
    });
  }

  const Adapter = Object.freeze({
    format: Core.format,
    version: Core.version,
    mimeType: MIME_TYPE,
    createSaveEnvelope,
    serializeSave,
    getSuggestedFilename,
    downloadSave,
    validateSave,
    loadSave
  });

  Game.CharacterProfilePersistence = Object.freeze({
    core: Core,
    adapter: Adapter,
    profileField: 'characterProfile'
  });
  Game.CampaignPersistence = Adapter;
})(typeof window !== 'undefined' ? window : globalThis);
