/* R04 / #271: one read-only Simulation-backed character truth for compatible AI drivers. */
(function installCharacterDriverContext(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-character-driver-context-v1';
  const AUTHORITY = 'simulation';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function requireSimulation(value, label, characterId) {
    if (!value || value.authority !== AUTHORITY) throw new TypeError(`${label} must be Simulation-backed.`);
    if (characterId && value.characterId !== characterId) throw new TypeError(`${label} must match the character.`);
    return value;
  }

  function compose(baseIdentityInput, ageContextInput, locationContextInput, emotionStateInput, extras = {}) {
    const base = requireSimulation(baseIdentityInput, 'CharacterIdentity');
    const age = requireSimulation(ageContextInput, 'CharacterAge', base.characterId);
    const location = requireSimulation(locationContextInput, 'CharacterLocationContext', base.characterId);
    const emotion = requireSimulation(emotionStateInput, 'CharacterEmotion', base.characterId);
    if (age.ok === false || emotion.ok === false) throw new TypeError('Character age and emotion contexts must be valid.');

    const source = extras && typeof extras === 'object' ? extras : {};
    return deepFreeze({
      version: VERSION,
      authority: AUTHORITY,
      source: 'authoritative-character-model',
      characterId: base.characterId,
      worldIdentity: base.worldIdentity,
      stable: {
        name: base.name,
        gender: base.gender,
        birthDate: clone(base.birthDate),
        birthplace: clone(base.birthplace),
        baselinePersonality: clone(base.baselinePersonality),
        baselineBehavioralTendencies: clone(base.baselineBehavioralTendencies || []),
        baseProfession: base.baseProfession
      },
      current: {
        ageYears: age.ageYears,
        lifeStage: age.lifeStage?.id || null,
        location: clone(location.current?.location || null),
        locationModifiers: clone(location.current?.modifiers || {}),
        mood: clone(emotion.mood || {}),
        reaction: clone(emotion.reaction || null),
        decisionBiases: clone(emotion.biases || {}),
        relationships: clone(source.relationships || []),
        memories: clone(source.memories || [])
      },
      driverPolicy: {
        directActionAuthority: false,
        directMovementAuthority: false,
        directLegalityAuthority: false,
        directResolutionAuthority: false,
        directWorldMutationAuthority: false,
        simulationValidationRequired: true,
        externalProviderDataPolicy: 'character-context-only-no-player-credentials'
      }
    });
  }

  function fingerprint(context) {
    const value = requireSimulation(context, 'CharacterDriverContext');
    if (value.version !== VERSION) throw new TypeError('Current CharacterDriverContext version required.');
    return JSON.stringify(value);
  }

  Game.CharacterDriverContext = Object.freeze({ version: VERSION, authority: AUTHORITY, compose, fingerprint });
})(typeof window !== 'undefined' ? window : globalThis);
