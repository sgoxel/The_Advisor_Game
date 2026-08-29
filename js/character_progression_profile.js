/*
  R04 #278: minimum Simulation-owned protagonist progression/profile projection.

  This is not a deep progression system. It removes imported demo rank/mission truth by
  keeping one canonical profile for rank, profession and temporary activity/status.
  New campaigns begin at the README-defined Peasant-scale rank. Explicit current
  Simulation profiles supplied by an established campaign are preserved.
*/
(function installCharacterProgressionProfile(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const SCHEMA_VERSION = 1;
  const AUTHORITY = 'simulation';
  const STARTER_RANK = 'Peasant';
  const STARTER_STATUS = 'Idle';

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }

  function canonicalSeed(seedInput) {
    const raw = seedInput === undefined || seedInput === null ? Game.State?.world?.seed : seedInput;
    if (Game.RNG?.normalizeSeed) return Game.RNG.normalizeSeed(raw, 'SIMSOFT-001');
    return text(String(raw || 'SIMSOFT-001')) || 'SIMSOFT-001';
  }

  function baseIdentity(seed, characterId) {
    if (!Game.CharacterIdentity?.generateBaseIdentity) {
      throw new Error('CharacterIdentity must be loaded before CharacterProgressionProfile.');
    }
    return Game.CharacterIdentity.generateBaseIdentity(seed, characterId);
  }

  function isCurrentProfile(candidate) {
    return Boolean(candidate && typeof candidate === 'object'
      && candidate.authority === AUTHORITY
      && candidate.schemaVersion === SCHEMA_VERSION
      && text(candidate.characterId)
      && text(candidate.rank)
      && text(candidate.baseProfession)
      && text(candidate.currentProfession)
      && text(candidate.status));
  }

  function normalize(seedInput, characterIdInput = 'protagonist', candidateInput = null) {
    const seed = canonicalSeed(seedInput);
    const characterId = text(characterIdInput) || 'protagonist';
    const base = baseIdentity(seed, characterId);
    const candidate = isCurrentProfile(candidateInput) && candidateInput.seed === seed && candidateInput.characterId === characterId
      ? candidateInput
      : null;

    return freeze({
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      source: candidate ? 'campaign-state' : 'new-campaign-default',
      seed,
      characterId,
      worldIdentity: base.worldIdentity,
      name: candidate ? text(candidate.name) || base.name : base.name,
      rank: candidate ? text(candidate.rank) : STARTER_RANK,
      baseProfession: candidate ? text(candidate.baseProfession) : base.baseProfession,
      currentProfession: candidate ? text(candidate.currentProfession) : base.baseProfession,
      status: candidate ? text(candidate.status) : STARTER_STATUS,
      activity: candidate ? text(candidate.activity) || text(candidate.status) : STARTER_STATUS.toLowerCase()
    });
  }

  function localBotContext(profileInput) {
    const profile = isCurrentProfile(profileInput)
      ? profileInput
      : normalize(Game.State?.world?.seed, 'protagonist', Game.State?.characterProfile);
    return freeze({
      authority: AUTHORITY,
      characterId: profile.characterId,
      rank: profile.rank,
      baseProfession: profile.baseProfession,
      currentProfession: profile.currentProfession,
      status: profile.status,
      activity: profile.activity
    });
  }

  function render(profile) {
    if (!global.document) return profile;
    const nameNode = global.document.querySelector('.character-name');
    const metaNode = global.document.querySelector('.character-meta');
    if (nameNode) nameNode.textContent = profile.name;
    if (metaNode) {
      metaNode.replaceChildren();
      const rows = [
        `Rank: ${profile.rank}`,
        `Base profession: ${profile.baseProfession}`,
        `Profession: ${profile.currentProfession}`,
        `Status: ${profile.status}`
      ];
      rows.forEach((row, index) => {
        if (index) metaNode.appendChild(global.document.createElement('br'));
        metaNode.appendChild(global.document.createTextNode(row));
      });
    }
    return profile;
  }

  function installCurrent(candidateInput = null, seedInput = undefined) {
    if (!Game.State) throw new Error('Game.State is required.');
    const profile = normalize(seedInput, 'protagonist', candidateInput || Game.State.characterProfile || null);
    Game.State.characterProfile = profile;
    render(profile);
    return profile;
  }

  function bindGenerationRefresh() {
    const Terrain = Game.Terrain;
    if (!Terrain || typeof Terrain.generateWorld !== 'function' || Terrain.generateWorld.__r04CharacterProfileRefresh) return;
    const generateWorld = Terrain.generateWorld.bind(Terrain);
    const wrapped = function (seedInput, colsInput, rowsInput) {
      const result = generateWorld(seedInput, colsInput, rowsInput);
      installCurrent(null, seedInput);
      return result;
    };
    Object.defineProperty(wrapped, '__r04CharacterProfileRefresh', { value: true });
    Terrain.generateWorld = wrapped;
  }

  function initialize() {
    bindGenerationRefresh();
    installCurrent();
  }

  Game.CharacterProgressionProfile = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    starterRank: STARTER_RANK,
    normalize,
    isCurrentProfile,
    installCurrent,
    render,
    toLocalBotContext: localBotContext
  });

  if (global.document) {
    if (global.document.readyState === 'loading') global.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
