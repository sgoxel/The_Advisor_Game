/* R04 / #268: derive character age and life-stage from authoritative campaign chronology. */
(function installCharacterAge(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-character-age-v1';
  const AUTHORITY = 'simulation';
  const BIRTH_DATE_CALENDAR = 'campaign-calendar-civil-year-minus-2000';

  const LIFE_STAGES = Object.freeze([
    Object.freeze({ minAge: 0, maxAge: 12, id: 'child' }),
    Object.freeze({ minAge: 13, maxAge: 17, id: 'adolescent' }),
    Object.freeze({ minAge: 18, maxAge: 24, id: 'young-adult' }),
    Object.freeze({ minAge: 25, maxAge: 44, id: 'adult' }),
    Object.freeze({ minAge: 45, maxAge: 64, id: 'mature-adult' }),
    Object.freeze({ minAge: 65, maxAge: null, id: 'older-adult' })
  ]);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function validInteger(value) {
    return Number.isInteger(value) ? value : null;
  }

  function normalizeBirthDate(value) {
    if (!value || typeof value !== 'object') return null;
    const year = validInteger(value.year);
    const month = validInteger(value.month);
    const day = validInteger(value.day);
    if (year === null || month === null || day === null || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  }

  function normalizeCampaignDate(value) {
    const source = value && typeof value === 'object' && value.calendar && typeof value.calendar === 'object'
      ? value.calendar
      : value;
    if (!source || typeof source !== 'object') return null;
    const year = validInteger(source.year);
    const month = validInteger(source.month);
    const day = validInteger(source.dayOfMonth ?? source.day);
    if (year === null || month === null || day === null || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return {
      year,
      month,
      dayOfMonth: day,
      hour: Number.isInteger(source.hour) ? source.hour : 0,
      minute: Number.isInteger(source.minute) ? source.minute : 0
    };
  }

  function validateBaseIdentity(baseIdentity) {
    const currentVersion = Game.CharacterIdentity?.generatorVersion;
    if (!baseIdentity || typeof baseIdentity !== 'object' || baseIdentity.authority !== AUTHORITY) {
      throw new TypeError('A Simulation-owned CharacterIdentity base identity is required.');
    }
    if (currentVersion && baseIdentity.generatorVersion !== currentVersion) {
      throw new TypeError('A current CharacterIdentity base identity is required; migrate legacy identities first.');
    }
    if (baseIdentity.birthDateCalendar !== BIRTH_DATE_CALENDAR) {
      throw new TypeError('Character birth date must use the authoritative campaign calendar year basis.');
    }
    if (!normalizeBirthDate(baseIdentity.birthDate)) {
      throw new TypeError('Character birth date is invalid.');
    }
    return baseIdentity;
  }

  function calculateAge(birthDateInput, campaignDateInput) {
    const birthDate = normalizeBirthDate(birthDateInput);
    const campaignDate = normalizeCampaignDate(campaignDateInput);
    if (!birthDate || !campaignDate) return deepFreeze({ ok: false, code: 'INVALID_DATE' });

    let ageYears = campaignDate.year - birthDate.year;
    const beforeBirthday = campaignDate.month < birthDate.month ||
      (campaignDate.month === birthDate.month && campaignDate.dayOfMonth < birthDate.day);
    if (beforeBirthday) ageYears -= 1;
    if (ageYears < 0) return deepFreeze({ ok: false, code: 'CAMPAIGN_DATE_BEFORE_BIRTH' });

    return deepFreeze({ ok: true, ageYears });
  }

  function lifeStageForAge(ageInput) {
    const age = validInteger(ageInput);
    if (age === null || age < 0) return deepFreeze({ ok: false, code: 'INVALID_AGE' });
    const band = LIFE_STAGES.find((entry) => age >= entry.minAge && (entry.maxAge === null || age <= entry.maxAge));
    return deepFreeze({
      ok: true,
      id: band.id,
      minAge: band.minAge,
      maxAge: band.maxAge,
      policy: 'context-only-no-personality-rewrite'
    });
  }

  function derive(baseIdentity, campaignSnapshot) {
    const base = validateBaseIdentity(baseIdentity);
    const snapshot = campaignSnapshot === undefined
      ? Game.CampaignCalendar?.capture?.()
      : campaignSnapshot;
    if (!snapshot || snapshot.authority !== AUTHORITY) {
      return deepFreeze({ ok: false, code: 'AUTHORITATIVE_CAMPAIGN_CALENDAR_REQUIRED' });
    }

    const campaignDate = normalizeCampaignDate(snapshot);
    if (!campaignDate) return deepFreeze({ ok: false, code: 'INVALID_CAMPAIGN_DATE' });
    const age = calculateAge(base.birthDate, campaignDate);
    if (!age.ok) return age;
    const lifeStage = lifeStageForAge(age.ageYears);
    if (!lifeStage.ok) return lifeStage;

    return deepFreeze({
      ok: true,
      version: VERSION,
      authority: AUTHORITY,
      characterId: base.characterId,
      worldIdentity: base.worldIdentity,
      birthDateCalendar: BIRTH_DATE_CALENDAR,
      birthDate: { ...base.birthDate },
      campaignDate,
      ageYears: age.ageYears,
      lifeStage,
      derivation: 'authoritative-birth-date-plus-campaign-calendar',
      baselinePersonalityFingerprint: JSON.stringify(base.baselinePersonality || null),
      stereotypePolicy: 'life-stage-is-context-not-personality-authority'
    });
  }

  function deriveFromSeed(seed, characterId, options = {}) {
    if (!Game.CharacterIdentity?.generateBaseIdentity) throw new Error('CharacterIdentity is required.');
    const base = Game.CharacterIdentity.generateBaseIdentity(seed, characterId, options.identity || {});
    return derive(base, options.campaignSnapshot);
  }

  Game.CharacterAge = Object.freeze({
    version: VERSION,
    authority: AUTHORITY,
    birthDateCalendar: BIRTH_DATE_CALENDAR,
    lifeStages: LIFE_STAGES,
    calculateAge,
    lifeStageForAge,
    derive,
    deriveFromSeed
  });
})(typeof window !== 'undefined' ? window : globalThis);
