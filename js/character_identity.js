/*
  R04 #267: deterministic SEED-backed character base identity.

  This module owns only regenerable base identity. Current location, current profession,
  relationships, memories, injuries, emotional consequences, and other campaign history
  remain separate authoritative deltas. Presentation assets may consume this identity but
  never become Simulation authority.
*/
(function installCharacterIdentity(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-character-base-identity-v1';
  const AUTHORITY = 'simulation';

  const GIVEN_NAMES = Object.freeze({
    female: Object.freeze(['Alda', 'Cera', 'Elin', 'Fara', 'Jora', 'Lysa', 'Mara', 'Pera', 'Sela', 'Vera', 'Yara', 'Mira']),
    male: Object.freeze(['Borin', 'Dain', 'Garr', 'Hale', 'Iven', 'Kell', 'Noll', 'Orin', 'Rian', 'Tarn', 'Wren', 'Toren'])
  });
  const FAMILY_NAMES = Object.freeze(['Ash', 'Brook', 'Dale', 'Fenn', 'Field', 'Forge', 'Glen', 'Hart', 'Moor', 'Oak', 'Reed', 'Stone', 'Vale', 'Ward']);
  const BASE_PROFESSIONS = Object.freeze(['villager', 'farmer', 'laborer', 'carpenter', 'trader', 'guard', 'herder', 'miller', 'healer', 'blacksmith', 'baker', 'innkeeper', 'woodcutter']);
  const PERSONALITY_TRAITS = Object.freeze(['courage', 'caution', 'sociability', 'resilience', 'ambition', 'patience']);

  function canonicalString(value, label) {
    if (value === undefined || value === null) throw new TypeError(`${label} is required.`);
    const text = String(value).trim();
    if (!text) throw new TypeError(`${label} must not be empty.`);
    return text;
  }

  function canonicalSeed(seedInput) {
    const coordinates = Game.WorldCoordinates;
    if (coordinates && typeof coordinates.canonicalSeed === 'function') {
      return coordinates.canonicalSeed(seedInput);
    }
    return canonicalString(seedInput, 'seed');
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

  function unit(seed, characterId, streamName) {
    return hash32(`${VERSION}|${seed}|${characterId}|${streamName}`) / 0x100000000;
  }

  function integer(seed, characterId, streamName, min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) return low;
    return low + Math.floor(unit(seed, characterId, streamName) * (high - low + 1));
  }

  function pick(seed, characterId, streamName, values) {
    return values[integer(seed, characterId, streamName, 0, values.length - 1)];
  }

  function normalizeCoordinate(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  }

  function deterministicBirthplace(seed, characterId, explicit) {
    const source = explicit && typeof explicit === 'object' ? explicit : null;
    if (source) {
      const worldX = normalizeCoordinate(source.worldX, 0);
      const worldY = normalizeCoordinate(source.worldY, 0);
      return {
        worldX,
        worldY,
        regionX: normalizeCoordinate(source.regionX, Math.floor(worldX / 100)),
        regionY: normalizeCoordinate(source.regionY, Math.floor(worldY / 100)),
        settlementId: source.settlementId === undefined || source.settlementId === null
          ? null
          : String(source.settlementId)
      };
    }

    const regionX = integer(seed, characterId, 'birth-region-x', -8, 8);
    const regionY = integer(seed, characterId, 'birth-region-y', -8, 8);
    const localCol = integer(seed, characterId, 'birth-local-col', 0, 99);
    const localRow = integer(seed, characterId, 'birth-local-row', 0, 99);
    return {
      worldX: regionX * 100 + localCol,
      worldY: regionY * 100 + localRow,
      regionX,
      regionY,
      settlementId: regionX === 0 && regionY === 0 ? `starter-village:${encodeURIComponent(seed)}` : null
    };
  }

  function deterministicBirthDate(seed, characterId) {
    return {
      year: integer(seed, characterId, 'birth-year', 930, 982),
      month: integer(seed, characterId, 'birth-month', 1, 12),
      day: integer(seed, characterId, 'birth-day', 1, 28)
    };
  }

  function personality(seed, characterId) {
    const result = {};
    for (const trait of PERSONALITY_TRAITS) {
      result[trait] = integer(seed, characterId, `personality:${trait}`, 20, 80);
    }
    return result;
  }

  function behaviorFromPersonality(base) {
    const tendencies = [];
    if (base.courage >= 60) tendencies.push('bold');
    else if (base.caution >= 60) tendencies.push('careful');
    if (base.sociability >= 60) tendencies.push('social');
    else if (base.sociability <= 40) tendencies.push('reserved');
    if (base.resilience >= 60) tendencies.push('steadfast');
    if (base.ambition >= 60) tendencies.push('aspiring');
    if (base.patience >= 60) tendencies.push('patient');
    if (!tendencies.length) tendencies.push('balanced');
    return tendencies;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function generateBaseIdentity(seedInput, characterIdInput, options) {
    const seed = canonicalSeed(seedInput);
    const characterId = canonicalString(characterIdInput, 'characterId');
    const source = options && typeof options === 'object' ? options : {};
    const gender = source.gender === 'female' || source.gender === 'male'
      ? source.gender
      : (unit(seed, characterId, 'gender') < 0.5 ? 'female' : 'male');
    const firstName = pick(seed, characterId, `given-name:${gender}`, GIVEN_NAMES[gender]);
    const familyName = pick(seed, characterId, 'family-name', FAMILY_NAMES);
    const baselinePersonality = personality(seed, characterId);
    const baseProfession = source.baseProfession
      ? canonicalString(source.baseProfession, 'baseProfession')
      : pick(seed, characterId, 'base-profession', BASE_PROFESSIONS);

    return deepFreeze({
      schemaVersion: 1,
      generatorVersion: VERSION,
      authority: AUTHORITY,
      seed,
      characterId,
      worldIdentity: `character:${encodeURIComponent(seed)}:${encodeURIComponent(characterId)}`,
      name: `${firstName} ${familyName}`,
      gender,
      birthDate: deterministicBirthDate(seed, characterId),
      birthplace: deterministicBirthplace(seed, characterId, source.birthplace),
      baselinePersonality,
      baselineBehavioralTendencies: behaviorFromPersonality(baselinePersonality),
      baseProfession
    });
  }

  function canonicalBaseFingerprint(identity) {
    if (!identity || identity.authority !== AUTHORITY || identity.generatorVersion !== VERSION) {
      throw new TypeError('A CharacterIdentity base identity is required.');
    }
    return JSON.stringify({
      generatorVersion: identity.generatorVersion,
      seed: identity.seed,
      characterId: identity.characterId,
      worldIdentity: identity.worldIdentity,
      name: identity.name,
      gender: identity.gender,
      birthDate: identity.birthDate,
      birthplace: identity.birthplace,
      baselinePersonality: identity.baselinePersonality,
      baselineBehavioralTendencies: identity.baselineBehavioralTendencies,
      baseProfession: identity.baseProfession
    });
  }

  function applyCampaignDeltas(baseIdentity, deltas) {
    if (!baseIdentity || baseIdentity.authority !== AUTHORITY || baseIdentity.generatorVersion !== VERSION) {
      throw new TypeError('A CharacterIdentity base identity is required.');
    }
    const source = deltas && typeof deltas === 'object' ? deltas : {};
    const currentProfession = source.currentProfession === undefined || source.currentProfession === null
      ? baseIdentity.baseProfession
      : canonicalString(source.currentProfession, 'currentProfession');

    return deepFreeze({
      authority: AUTHORITY,
      characterId: baseIdentity.characterId,
      worldIdentity: baseIdentity.worldIdentity,
      base: baseIdentity,
      current: {
        profession: currentProfession,
        location: source.currentLocation && typeof source.currentLocation === 'object'
          ? { ...source.currentLocation }
          : null,
        residence: source.currentResidence && typeof source.currentResidence === 'object'
          ? { ...source.currentResidence }
          : null
      }
    });
  }

  Game.CharacterIdentity = Object.freeze({
    schemaVersion: 1,
    generatorVersion: VERSION,
    authority: AUTHORITY,
    generateBaseIdentity,
    fingerprint: canonicalBaseFingerprint,
    applyCampaignDeltas
  });
})(typeof window !== 'undefined' ? window : globalThis);
