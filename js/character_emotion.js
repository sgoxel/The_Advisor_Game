/* R04 / #270: compact Simulation-owned emotional reaction and mood foundation. */
(function installCharacterEmotion(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-character-emotion-v1';
  const AUTHORITY = 'simulation';
  const RECONCILIATION_STRATEGY = 'closed-form-elapsed-game-time';
  const REACTION_DURATION_GAME_MINUTES = 180;

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

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, finite(value, min)));
  }

  function rounded(value) {
    return Math.round(clamp(value));
  }

  function canonicalTarget(value) {
    if (!value || typeof value !== 'object') return null;
    const type = String(value.type || '').trim();
    const id = String(value.id || '').trim();
    if (!type || !id) return null;
    return { type, id };
  }

  function validateBaseIdentity(baseIdentity) {
    if (!baseIdentity || baseIdentity.authority !== AUTHORITY || !baseIdentity.characterId || !baseIdentity.baselinePersonality) {
      throw new TypeError('A Simulation-backed CharacterIdentity base identity is required.');
    }
    return baseIdentity;
  }

  function validateLocationContext(baseIdentity, locationContext) {
    if (!locationContext || locationContext.authority !== AUTHORITY || locationContext.characterId !== baseIdentity.characterId || !locationContext.current?.modifiers) {
      throw new TypeError('A matching Simulation-backed CharacterLocationContext composition is required.');
    }
    return locationContext;
  }

  function validateAgeContext(baseIdentity, ageContext) {
    if (ageContext === null || ageContext === undefined) return null;
    if (!ageContext || ageContext.authority !== AUTHORITY || ageContext.characterId !== baseIdentity.characterId || ageContext.ok === false) {
      throw new TypeError('CharacterAge context must be Simulation-backed and match the character.');
    }
    return ageContext;
  }

  function normalizeGameTime(candidate) {
    const source = candidate === undefined ? Game.GameTime?.capture?.() : candidate;
    if (!source || source.authority !== AUTHORITY) {
      throw new TypeError('A Simulation-backed authoritative game-time snapshot is required.');
    }
    const totalGameMinutes = finite(source.totalGameMinutes, -1);
    if (totalGameMinutes < 0) throw new TypeError('Authoritative game time must be a non-negative minute count.');
    return {
      authority: AUTHORITY,
      totalGameMinutes: Number(totalGameMinutes.toFixed(6))
    };
  }

  function normalizeCircumstances(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return deepFreeze({
      danger: clamp(source.danger),
      safety: clamp(source.safety),
      conflict: clamp(source.conflict),
      success: clamp(source.success),
      failure: clamp(source.failure),
      hunger: clamp(source.hunger),
      injury: clamp(source.injury),
      workSatisfaction: clamp(source.workSatisfaction),
      socialSupport: clamp(source.socialSupport),
      socialConflict: clamp(source.socialConflict),
      relationshipPositive: clamp(source.relationshipPositive),
      relationshipNegative: clamp(source.relationshipNegative),
      memoryPositive: clamp(source.memoryPositive),
      memoryNegative: clamp(source.memoryNegative),
      lifeStageStrain: clamp(source.lifeStageStrain),
      directedTo: canonicalTarget(source.directedTo)
    });
  }

  function personality(baseIdentity) {
    const source = baseIdentity.baselinePersonality || {};
    return {
      courage: clamp(source.courage),
      caution: clamp(source.caution),
      sociability: clamp(source.sociability),
      resilience: clamp(source.resilience),
      ambition: clamp(source.ambition),
      patience: clamp(source.patience)
    };
  }

  function targetMood(baseIdentity, locationContext, circumstances) {
    const traits = personality(baseIdentity);
    const current = locationContext.current.modifiers;
    const contextStress = clamp(current.stress);
    const contextMorale = clamp(current.morale);
    const contextConfidence = clamp(current.confidence);
    const contextSuspicion = clamp(current.suspicion);

    const pressure = clamp(
      circumstances.danger * 0.28 +
      circumstances.conflict * 0.20 +
      circumstances.injury * 0.18 +
      circumstances.hunger * 0.09 +
      circumstances.failure * 0.10 +
      circumstances.socialConflict * 0.08 +
      circumstances.relationshipNegative * 0.04 +
      circumstances.memoryNegative * 0.03 +
      circumstances.lifeStageStrain * 0.05
    );
    const support = clamp(
      circumstances.safety * 0.22 +
      circumstances.success * 0.18 +
      circumstances.workSatisfaction * 0.13 +
      circumstances.socialSupport * 0.20 +
      circumstances.relationshipPositive * 0.11 +
      circumstances.memoryPositive * 0.06
    );

    const stress = rounded(contextStress * 0.46 + pressure * 0.58 + traits.caution * 0.10 - traits.courage * 0.12 - traits.resilience * 0.12 - support * 0.20);
    const valence = rounded(contextMorale * 0.50 + support * 0.52 + circumstances.success * 0.10 - pressure * 0.48 + traits.resilience * 0.08);
    const confidence = rounded(contextConfidence * 0.55 + traits.courage * 0.20 + circumstances.success * 0.18 - circumstances.failure * 0.15 - stress * 0.16);
    const socialOpenness = rounded(traits.sociability * 0.48 + circumstances.socialSupport * 0.24 + valence * 0.18 - circumstances.socialConflict * 0.18 - contextSuspicion * 0.16 - stress * 0.12);

    return deepFreeze({ stress, valence, confidence, socialOpenness });
  }

  function makeReaction(circumstances, gameMinute) {
    const candidates = [
      ['fear-stress', circumstances.danger, 'danger'],
      ['conflict-stress', circumstances.conflict, 'conflict'],
      ['pain-stress', circumstances.injury, 'injury'],
      ['frustration', circumstances.failure, 'failure'],
      ['social-distress', circumstances.socialConflict, 'social-conflict'],
      ['need-distress', circumstances.hunger, 'hunger'],
      ['relief', circumstances.safety, 'safety'],
      ['encouraged', circumstances.success, 'success'],
      ['supported', circumstances.socialSupport, 'social-support'],
      ['fulfilled', circumstances.workSatisfaction, 'work-satisfaction']
    ].sort((left, right) => right[1] - left[1] || left[2].localeCompare(right[2]));
    const [kind, intensity, cause] = candidates[0] || ['neutral', 0, 'none'];
    if (intensity < 20) return null;
    return deepFreeze({
      kind,
      intensity: rounded(intensity),
      cause,
      directedTo: circumstances.directedTo ? clone(circumstances.directedTo) : null,
      startedAtGameMinute: gameMinute,
      expiresAtGameMinute: Number((gameMinute + REACTION_DURATION_GAME_MINUTES).toFixed(6))
    });
  }

  function traceCauses(locationContext, ageContext, circumstances) {
    const causes = [];
    const push = (id, value, source) => {
      const score = rounded(value);
      if (score >= 20) causes.push({ id, intensity: score, source });
    };

    push('location-stress', locationContext.current.modifiers.stress, 'current-location-context');
    push('location-morale', locationContext.current.modifiers.morale, 'current-location-context');
    for (const key of ['danger', 'safety', 'conflict', 'success', 'failure', 'hunger', 'injury', 'workSatisfaction', 'socialSupport', 'socialConflict', 'relationshipPositive', 'relationshipNegative', 'memoryPositive', 'memoryNegative', 'lifeStageStrain']) {
      push(key, circumstances[key], 'authoritative-circumstance');
    }
    if (ageContext?.lifeStage?.id) {
      causes.push({ id: `life-stage:${ageContext.lifeStage.id}`, intensity: rounded(circumstances.lifeStageStrain), source: 'character-age-context' });
    }

    causes.sort((left, right) => right.intensity - left.intensity || left.id.localeCompare(right.id));
    return deepFreeze(causes.slice(0, 8));
  }

  function decisionBiases(baseIdentity, mood, locationContext) {
    const traits = personality(baseIdentity);
    const suspicion = clamp(locationContext.current.modifiers.suspicion);
    return deepFreeze({
      riskTolerance: rounded(traits.courage * 0.48 + mood.confidence * 0.32 + mood.valence * 0.12 - mood.stress * 0.24),
      caution: rounded(traits.caution * 0.55 + mood.stress * 0.30 + suspicion * 0.15 - mood.confidence * 0.12),
      socialApproach: rounded(traits.sociability * 0.48 + mood.socialOpenness * 0.34 + mood.valence * 0.16 - mood.stress * 0.16),
      persistence: rounded(traits.resilience * 0.36 + traits.patience * 0.28 + mood.confidence * 0.24 - mood.stress * 0.18),
      role: 'bias-only',
      legalityAuthority: 'simulation-validation-required'
    });
  }

  function buildState(baseIdentity, locationContext, ageContext, circumstances, gameTime, mood, reaction, previousMinute) {
    const minute = gameTime.totalGameMinutes;
    return deepFreeze({
      ok: true,
      version: VERSION,
      authority: AUTHORITY,
      characterId: baseIdentity.characterId,
      worldIdentity: baseIdentity.worldIdentity,
      baselinePersonalityFingerprint: JSON.stringify(baseIdentity.baselinePersonality),
      ageContext: ageContext ? {
        ageYears: ageContext.ageYears,
        lifeStage: ageContext.lifeStage?.id || null
      } : null,
      mood,
      reaction,
      biases: decisionBiases(baseIdentity, mood, locationContext),
      causes: traceCauses(locationContext, ageContext, circumstances),
      lastReconciledGameMinute: minute,
      elapsedGameMinutes: Math.max(0, Number((minute - previousMinute).toFixed(6))),
      reconciliationStrategy: RECONCILIATION_STRATEGY,
      mutationBoundary: 'emotional-context-only',
      actionAuthority: 'none-character-bias-requires-simulation-validation'
    });
  }

  function deriveInitial(baseIdentityInput, locationContextInput, ageContextInput, circumstancesInput = {}, gameTimeInput) {
    const baseIdentity = validateBaseIdentity(baseIdentityInput);
    const locationContext = validateLocationContext(baseIdentity, locationContextInput);
    const ageContext = validateAgeContext(baseIdentity, ageContextInput);
    const circumstances = normalizeCircumstances(circumstancesInput);
    const gameTime = normalizeGameTime(gameTimeInput);
    const mood = targetMood(baseIdentity, locationContext, circumstances);
    const reaction = makeReaction(circumstances, gameTime.totalGameMinutes);
    return buildState(baseIdentity, locationContext, ageContext, circumstances, gameTime, mood, reaction, gameTime.totalGameMinutes);
  }

  function validatePrevious(previousState, baseIdentity) {
    if (!previousState || previousState.authority !== AUTHORITY || previousState.version !== VERSION || previousState.characterId !== baseIdentity.characterId || !previousState.mood) {
      throw new TypeError('A compatible Simulation-backed prior emotional state is required.');
    }
    return previousState;
  }

  function reconcile(previousStateInput, baseIdentityInput, locationContextInput, ageContextInput, circumstancesInput = {}, gameTimeInput) {
    const baseIdentity = validateBaseIdentity(baseIdentityInput);
    const previousState = validatePrevious(previousStateInput, baseIdentity);
    const locationContext = validateLocationContext(baseIdentity, locationContextInput);
    const ageContext = validateAgeContext(baseIdentity, ageContextInput);
    const circumstances = normalizeCircumstances(circumstancesInput);
    const gameTime = normalizeGameTime(gameTimeInput);
    const previousMinute = finite(previousState.lastReconciledGameMinute, gameTime.totalGameMinutes);
    const monotonicMinute = Math.max(previousMinute, gameTime.totalGameMinutes);
    const elapsed = Math.max(0, monotonicMinute - previousMinute);
    const target = targetMood(baseIdentity, locationContext, circumstances);

    // Closed-form reconciliation lets distant characters update directly after elapsed
    // authoritative game time without replaying every missed minute or render frame.
    const blend = elapsed <= 0 ? 0 : 1 - Math.exp(-elapsed / 720);
    const mood = deepFreeze({
      stress: rounded(previousState.mood.stress + (target.stress - previousState.mood.stress) * blend),
      valence: rounded(previousState.mood.valence + (target.valence - previousState.mood.valence) * blend),
      confidence: rounded(previousState.mood.confidence + (target.confidence - previousState.mood.confidence) * blend),
      socialOpenness: rounded(previousState.mood.socialOpenness + (target.socialOpenness - previousState.mood.socialOpenness) * blend)
    });

    const reactionCandidate = makeReaction(circumstances, monotonicMinute);
    const priorReactionActive = previousState.reaction && monotonicMinute < finite(previousState.reaction.expiresAtGameMinute, 0);
    const reaction = reactionCandidate || (priorReactionActive ? deepFreeze(clone(previousState.reaction)) : null);
    return buildState(
      baseIdentity,
      locationContext,
      ageContext,
      circumstances,
      { authority: AUTHORITY, totalGameMinutes: monotonicMinute },
      mood,
      reaction,
      previousMinute
    );
  }

  function restore(serializedState, baseIdentity) {
    const parsed = typeof serializedState === 'string' ? JSON.parse(serializedState) : clone(serializedState);
    validateBaseIdentity(baseIdentity);
    validatePrevious(parsed, baseIdentity);
    return deepFreeze(parsed);
  }

  Game.CharacterEmotion = Object.freeze({
    version: VERSION,
    authority: AUTHORITY,
    reconciliationStrategy: RECONCILIATION_STRATEGY,
    normalizeCircumstances,
    deriveInitial,
    reconcile,
    restore
  });
})(typeof window !== 'undefined' ? window : globalThis);
