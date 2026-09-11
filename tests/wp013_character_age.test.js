'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../js/character_age.js');

function loadAgeModule(campaignSnapshot) {
  delete require.cache[modulePath];
  global.window = global;
  global.Game = {
    CharacterIdentity: { generatorVersion: 'r04-character-base-identity-v3' },
    CampaignCalendar: { capture: () => campaignSnapshot }
  };
  require(modulePath);
  return global.Game.CharacterAge;
}

function baseIdentity(overrides = {}) {
  return {
    authority: 'simulation',
    generatorVersion: 'r04-character-base-identity-v3',
    characterId: 'character:test',
    worldIdentity: 'character:seed:test',
    birthDateCalendar: 'campaign-calendar-civil-year-minus-1900',
    birthDate: { year: 80, month: 9, day: 11 },
    baselinePersonality: { courage: 50 },
    ...overrides
  };
}

function snapshot(year, month, day) {
  return {
    authority: 'simulation',
    calendar: { year, month, dayOfMonth: day, hour: 12, minute: 0 }
  };
}

function run() {
  const age = loadAgeModule(snapshot(126, 9, 10));

  assert.deepEqual(age.calculateAge({ year: 80, month: 9, day: 11 }, { year: 126, month: 9, dayOfMonth: 10 }), { ok: true, ageYears: 45 });
  assert.deepEqual(age.calculateAge({ year: 80, month: 9, day: 11 }, { year: 126, month: 9, dayOfMonth: 11 }), { ok: true, ageYears: 46 });
  assert.deepEqual(age.calculateAge({ year: 80, month: 9, day: 11 }, { year: 126, month: 9, dayOfMonth: 12 }), { ok: true, ageYears: 46 });
  assert.equal(age.calculateAge({ year: 130, month: 1, day: 1 }, { year: 126, month: 1, dayOfMonth: 1 }).code, 'CAMPAIGN_DATE_BEFORE_BIRTH');
  assert.equal(age.calculateAge({ year: 80, month: 13, day: 1 }, { year: 126, month: 1, dayOfMonth: 1 }).code, 'INVALID_DATE');

  const preBirthday = age.derive(baseIdentity(), snapshot(126, 9, 10));
  assert.equal(preBirthday.ok, true);
  assert.equal(preBirthday.authority, 'simulation');
  assert.equal(preBirthday.ageYears, 45);
  assert.equal(preBirthday.lifeStage.id, 'mature-adult');
  assert.equal(Object.isFrozen(preBirthday), true);

  const onBirthday = age.derive(baseIdentity(), snapshot(126, 9, 11));
  assert.equal(onBirthday.ageYears, 46, 'birthday boundary increments exactly once');
  assert.equal(age.derive(baseIdentity(), snapshot(126, 9, 11)).ageYears, 46, 'repeated derivation must not accumulate drift');

  const captured = age.derive(baseIdentity());
  assert.equal(captured.ageYears, 45, 'default derivation must use authoritative CampaignCalendar capture');

  assert.equal(age.derive(baseIdentity(), { authority: 'presentation', calendar: { year: 126, month: 9, dayOfMonth: 11 } }).code, 'AUTHORITATIVE_CAMPAIGN_CALENDAR_REQUIRED');
  assert.throws(() => age.derive(baseIdentity({ generatorVersion: 'legacy' }), snapshot(126, 9, 11)), /current CharacterIdentity/);
  assert.throws(() => age.derive(baseIdentity({ birthDateCalendar: 'wrong-calendar' }), snapshot(126, 9, 11)), /authoritative campaign calendar/);

  console.log('WP-013 character age regression: PASS');
}

run();
