/*
  WP-014/I02: deterministic Simulation-backed baseline personality generation.

  Personality influences Character reasoning but is never an authority layer. This module
  derives a stable baseline from immutable CharacterIdentity inputs and never mutates world
  truth, resources, legality, position, outcomes, mood, or contextual state.
*/
(function installCharacterPersonality(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp014-personality-baseline-v1';
  const AUTHORITY = 'simulation';
  const TRAITS = Object.freeze(['sociability', 'caution', 'empathy', 'discipline', 'assertiveness']);

  function canonical(value, label) {
    if (value === undefined || value === null) throw new TypeError(`${label} is required.`);
    const text = String(value).trim();
    if (!text) throw new TypeError(`${label} must not be empty.`);
    return text;
  }

  function hash32(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return hash >>> 0;
  }

  function traitValue(seed, characterId, trait) {
    // 24-bit normalization gives an inclusive, bounded and serialization-stable 0..1 value.
    const bucket = hash32(`${VERSION}|${seed}|${characterId}|${trait}`) & 0x00ffffff;
    return bucket / 0x00ffffff;
  }

  function generate(seedInput, characterIdInput) {
    const seed = canonical(seedInput, 'seed');
    const characterId = canonical(characterIdInput, 'characterId');
    const traits = {};
    for (const trait of TRAITS) traits[trait] = traitValue(seed, characterId, trait);
    return Object.freeze({
      schemaVersion: 1,
      generatorVersion: VERSION,
      authority: AUTHORITY,
      seed,
      characterId,
      traits: Object.freeze(traits)
    });
  }

  function fromIdentity(identity) {
    if (!identity || identity.authority !== AUTHORITY) {
      throw new TypeError('A Simulation-backed character identity is required.');
    }
    return generate(identity.seed, identity.characterId);
  }

  Game.CharacterPersonality = Object.freeze({
    schemaVersion: 1,
    generatorVersion: VERSION,
    authority: AUTHORITY,
    traits: TRAITS,
    generate,
    fromIdentity
  });
})(typeof window !== 'undefined' ? window : globalThis);
