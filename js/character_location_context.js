/* R04 / #269: stable birthplace baseline plus current authoritative location context. */
(function installCharacterLocationContext(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-character-location-context-v1';
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

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function canonicalText(value, fallback = 'unknown') {
    const text = String(value ?? '').trim().toLowerCase();
    return text || fallback;
  }

  function stableHash(text) {
    let hash = 2166136261;
    const input = String(text ?? '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function validateBase(baseIdentity) {
    if (!baseIdentity || baseIdentity.authority !== AUTHORITY || !baseIdentity.characterId || !baseIdentity.birthplace || !baseIdentity.baselinePersonality) {
      throw new TypeError('A Simulation-backed CharacterIdentity base identity is required.');
    }
    return baseIdentity;
  }

  function formativeContext(baseIdentity, birthplaceContext = {}) {
    const base = validateBase(baseIdentity);
    const birthplace = base.birthplace;
    const settlementType = canonicalText(birthplaceContext.settlementType ?? birthplaceContext.type, birthplace.settlementId ? 'settlement' : 'unknown');
    const culture = canonicalText(birthplaceContext.culture, 'local');
    const environment = canonicalText(birthplaceContext.environment ?? birthplaceContext.terrain, 'mixed');
    const security = clamp(finite(birthplaceContext.security, 50), 0, 100);
    const prosperity = clamp(finite(birthplaceContext.prosperity, 50), 0, 100);
    const martialExposure = clamp(finite(birthplaceContext.martialExposure, 0), 0, 100);
    const wildernessExposure = clamp(finite(birthplaceContext.wildernessExposure, 0), 0, 100);
    const socialDensity = clamp(finite(birthplaceContext.socialDensity, settlementType === 'city' ? 70 : 45), 0, 100);

    // These are enduring context descriptors, not replacements for baseline personality.
    // Small deterministic variation prevents one settlement type from forcing one personality.
    const variation = (stableHash(`${base.seed}|${base.characterId}|formative`) % 11) - 5;
    return deepFreeze({
      authority: AUTHORITY,
      source: 'birthplace-formative-context',
      birthplace: clone(birthplace),
      culture,
      settlementType,
      environment,
      familiarity: {
        martial: clamp(Math.round(martialExposure + base.baselinePersonality.courage * 0.15 + variation), 0, 100),
        wilderness: clamp(Math.round(wildernessExposure + base.baselinePersonality.resilience * 0.12 - variation), 0, 100),
        urbanSocial: clamp(Math.round(socialDensity + base.baselinePersonality.sociability * 0.1), 0, 100)
      },
      formativeConditions: { security, prosperity },
      baselinePersonalityFingerprint: JSON.stringify(base.baselinePersonality)
    });
  }

  function currentEffects(baseIdentity, formative, current = {}) {
    const base = validateBase(baseIdentity);
    const personality = base.baselinePersonality;
    const danger = clamp(finite(current.danger, 0), 0, 100);
    const conflict = clamp(finite(current.conflict ?? current.warIntensity, 0), 0, 100);
    const security = clamp(finite(current.security, 50), 0, 100);
    const prosperity = clamp(finite(current.prosperity, 50), 0, 100);
    const hazard = clamp(finite(current.hazard, 0), 0, 100);
    const exposureMinutes = Math.max(0, finite(current.exposureGameMinutes, 0));
    const exposureFactor = clamp(exposureMinutes / (24 * 60), 0, 1);

    const threat = clamp((danger * 0.35) + (conflict * 0.35) + (hazard * 0.2) + ((100 - security) * 0.1), 0, 100);
    const courageBuffer = clamp((personality.courage + formative.familiarity.martial) / 4, 0, 50);
    const resilienceBuffer = clamp(personality.resilience / 5, 0, 20);
    const cautionSensitivity = clamp(personality.caution / 5, 0, 20);
    const stress = clamp(Math.round((threat - courageBuffer + cautionSensitivity) * (0.55 + exposureFactor * 0.45)), 0, 100);
    const morale = clamp(Math.round(55 + prosperity * 0.2 + security * 0.15 + resilienceBuffer - threat * 0.45), 0, 100);
    const suspicion = clamp(Math.round(conflict * 0.4 + danger * 0.15 + personality.caution * 0.25 - personality.sociability * 0.1), 0, 100);
    const confidence = clamp(Math.round(45 + personality.courage * 0.35 + formative.familiarity.martial * 0.15 - threat * 0.35), 0, 100);

    return deepFreeze({
      authority: AUTHORITY,
      source: 'current-authoritative-location-context',
      location: current.location && typeof current.location === 'object' ? clone(current.location) : null,
      authoritativeConditions: { danger, conflict, security, prosperity, hazard, exposureGameMinutes: exposureMinutes },
      modifiers: { stress, morale, suspicion, confidence },
      // Explicit proof for consumers/tests that location context does not rewrite personality.
      baselinePersonalityFingerprint: JSON.stringify(personality)
    });
  }

  function compose(baseIdentity, birthplaceContext = {}, currentContext = {}) {
    const base = validateBase(baseIdentity);
    const formative = formativeContext(base, birthplaceContext);
    const current = currentEffects(base, formative, currentContext);
    return deepFreeze({
      version: VERSION,
      authority: AUTHORITY,
      characterId: base.characterId,
      worldIdentity: base.worldIdentity,
      stableBase: {
        birthplace: clone(base.birthplace),
        baselinePersonality: clone(base.baselinePersonality),
        baselineBehavioralTendencies: clone(base.baselineBehavioralTendencies || [])
      },
      formative,
      current
    });
  }

  function composeFromSeed(seed, characterId, options = {}) {
    if (!Game.CharacterIdentity?.generateBaseIdentity) throw new Error('CharacterIdentity is required.');
    const base = Game.CharacterIdentity.generateBaseIdentity(seed, characterId, options.identity || {});
    return compose(base, options.birthplaceContext || {}, options.currentContext || {});
  }

  Game.CharacterLocationContext = Object.freeze({
    version: VERSION,
    authority: AUTHORITY,
    formativeContext,
    currentEffects,
    compose,
    composeFromSeed
  });
})(typeof window !== 'undefined' ? window : globalThis);
