/*
  WP-014/I04: bounded personality-derived Advisor advice weighting.

  This module produces a deterministic Character-decision input from Simulation-backed
  contextual personality. It is not an authority layer and cannot validate legality,
  resolve actions, mutate resources, move characters, or create world truth.
*/
(function installCharacterPersonalityAdviceWeight(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const AUTHORITY = 'simulation';
  const TRAITS = Object.freeze(['sociability', 'caution', 'empathy', 'discipline', 'assertiveness']);
  const NEUTRAL = 0.5;

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function finite01(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? clamp01(n) : fallback;
  }

  function requirePersonality(personality) {
    if (!personality || personality.authority !== AUTHORITY || !personality.traits) {
      throw new TypeError('Simulation-backed contextual personality is required.');
    }
    const traits = {};
    for (const trait of TRAITS) {
      const value = Number(personality.traits[trait]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`Contextual trait ${trait} must be within 0.0..1.0.`);
      }
      traits[trait] = value;
    }
    return traits;
  }

  function normalizeAdvice(advice) {
    if (advice === undefined || advice === null) {
      return Object.freeze({ social: NEUTRAL, safety: NEUTRAL, prosocial: NEUTRAL, duty: NEUTRAL, initiative: NEUTRAL });
    }
    if (typeof advice !== 'object' || Array.isArray(advice)) {
      throw new TypeError('Advice metadata must be an object when supplied.');
    }
    return Object.freeze({
      social: finite01(advice.social, NEUTRAL),
      safety: finite01(advice.safety, NEUTRAL),
      prosocial: finite01(advice.prosocial, NEUTRAL),
      duty: finite01(advice.duty, NEUTRAL),
      initiative: finite01(advice.initiative, NEUTRAL)
    });
  }

  function centeredCompatibility(trait, signal) {
    return (trait - NEUTRAL) * (signal - NEUTRAL) * 4;
  }

  function evaluate(personality, advice) {
    const traits = requirePersonality(personality);
    const metadata = normalizeAdvice(advice);

    const contributions = Object.freeze({
      sociability: centeredCompatibility(traits.sociability, metadata.social) * 0.18,
      caution: centeredCompatibility(traits.caution, metadata.safety) * 0.24,
      empathy: centeredCompatibility(traits.empathy, metadata.prosocial) * 0.20,
      discipline: centeredCompatibility(traits.discipline, metadata.duty) * 0.20,
      assertiveness: centeredCompatibility(traits.assertiveness, metadata.initiative) * 0.18
    });

    const raw = Object.values(contributions).reduce((sum, value) => sum + value, 0);
    const influence = clamp01(NEUTRAL + raw * 0.5);

    return Object.freeze({
      schemaVersion: 1,
      authority: 'character-decision-input',
      sourceAuthority: AUTHORITY,
      characterId: personality.characterId || null,
      influence,
      multiplier: 0.75 + influence * 0.5,
      contributions,
      adviceMetadata: metadata,
      authoritative: false
    });
  }

  Game.CharacterPersonalityAdviceWeight = Object.freeze({
    schemaVersion: 1,
    sourceAuthority: AUTHORITY,
    traits: TRAITS,
    evaluate
  });
})(typeof window !== 'undefined' ? window : globalThis);
