/*
  WP-014/I03: bounded contextual personality derivation.

  This module derives an immutable evaluation payload from a Simulation-backed baseline and
  optional Simulation-backed context. It never mutates baseline identity or authoritative
  legality, resources, knowledge, position, status, outcomes, or world truth.
*/
(function installCharacterPersonalityContext(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const AUTHORITY = 'simulation';
  const TRAITS = Object.freeze(['sociability', 'caution', 'empathy', 'discipline', 'assertiveness']);

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function finite01(value, fallback) {
    return Number.isFinite(value) ? clamp01(Number(value)) : fallback;
  }

  function requireBaseline(baseline) {
    if (!baseline || baseline.authority !== AUTHORITY || !baseline.traits) {
      throw new TypeError('A Simulation-backed baseline personality is required.');
    }
    const traits = {};
    for (const trait of TRAITS) {
      const value = Number(baseline.traits[trait]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`Baseline trait ${trait} must be within 0.0..1.0.`);
      }
      traits[trait] = value;
    }
    return traits;
  }

  function normalizeContext(context) {
    if (context === undefined || context === null) return Object.freeze({});
    if (context.authority !== AUTHORITY) {
      throw new TypeError('Context, when supplied, must be Simulation-backed.');
    }
    return Object.freeze({
      danger: finite01(context.danger, 0),
      injury: finite01(context.injury, 0),
      fatigue: finite01(context.fatigue, 0),
      hunger: finite01(context.hunger, 0),
      safety: finite01(context.safety, 0.5),
      relationshipTrust: finite01(context.relationshipTrust, 0.5),
      dutyPressure: finite01(context.dutyPressure, 0)
    });
  }

  function derive(baseline, context) {
    const base = requireBaseline(baseline);
    const c = normalizeContext(context);
    const danger = c.danger || 0;
    const injury = c.injury || 0;
    const fatigue = c.fatigue || 0;
    const hunger = c.hunger || 0;
    const safety = c.safety === undefined ? 0.5 : c.safety;
    const trust = c.relationshipTrust === undefined ? 0.5 : c.relationshipTrust;
    const duty = c.dutyPressure || 0;

    const traits = Object.freeze({
      sociability: clamp01(base.sociability + (trust - 0.5) * 0.20 - danger * 0.10 - fatigue * 0.05),
      caution: clamp01(base.caution + danger * 0.20 + injury * 0.15 - safety * 0.05),
      empathy: clamp01(base.empathy + (trust - 0.5) * 0.10 - hunger * 0.05),
      discipline: clamp01(base.discipline + duty * 0.15 - fatigue * 0.10 - hunger * 0.05),
      assertiveness: clamp01(base.assertiveness + safety * 0.05 - danger * 0.10 - injury * 0.10)
    });

    return Object.freeze({
      schemaVersion: 1,
      authority: AUTHORITY,
      characterId: baseline.characterId || null,
      traits,
      context: c
    });
  }

  Game.CharacterPersonalityContext = Object.freeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    traits: TRAITS,
    derive
  });
})(typeof window !== 'undefined' ? window : globalThis);
