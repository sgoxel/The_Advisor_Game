import { test, expect } from '@playwright/test';

async function loadEmotion(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.CharacterIdentity?.generateBaseIdentity &&
    window.Game?.CharacterAge?.derive &&
    window.Game?.CharacterLocationContext?.compose &&
    window.Game?.CharacterEmotion?.deriveInitial &&
    window.Game?.GameTime?.capture
  ));
}

async function buildGeneratedContext(page, seed = 'EMOTION-SEED-A', characterId = 'npc:emotion:1', current = {}) {
  return page.evaluate(({ seed, characterId, current }) => {
    const base = window.Game.CharacterIdentity.generateBaseIdentity(seed, characterId);
    const age = window.Game.CharacterAge.derive(base, window.Game.CampaignCalendar.capture());
    const formative = { settlementType: 'village', culture: 'lowland', security: 60, prosperity: 55, martialExposure: 30, wildernessExposure: 30, socialDensity: 55 };
    const location = window.Game.CharacterLocationContext.compose(base, formative, {
      location: { regionX: 0, regionY: 0, settlementId: 'starter-village' },
      danger: 10,
      conflict: 5,
      security: 75,
      prosperity: 60,
      hazard: 5,
      exposureGameMinutes: 240,
      ...current
    });
    return { base, age, location };
  }, { seed, characterId, current });
}

test('normal startup exposes Simulation-owned compact emotion contract', async ({ page }) => {
  await loadEmotion(page);
  const evidence = await page.evaluate(() => ({
    authority: window.Game.CharacterEmotion.authority,
    version: window.Game.CharacterEmotion.version,
    strategy: window.Game.CharacterEmotion.reconciliationStrategy,
    scriptLoaded: Array.from(document.scripts).some((script) => script.src.endsWith('/js/character_emotion.js'))
  }));

  expect(evidence.authority).toBe('simulation');
  expect(evidence.version).toBe('r04-character-emotion-v1');
  expect(evidence.strategy).toBe('closed-form-elapsed-game-time');
  expect(evidence.scriptLoaded).toBe(true);
});

test('danger and injury produce traceable short reaction and higher stress than safety', async ({ page }) => {
  await loadEmotion(page);
  const generated = await buildGeneratedContext(page);
  const result = await page.evaluate(({ generated }) => {
    const api = window.Game.CharacterEmotion;
    const danger = api.deriveInitial(
      generated.base,
      generated.location,
      generated.age,
      { danger: 92, conflict: 75, injury: 60, safety: 0, directedTo: { type: 'place', id: 'north-gate' } },
      { authority: 'simulation', totalGameMinutes: 1000 }
    );
    const safe = api.deriveInitial(
      generated.base,
      generated.location,
      generated.age,
      { danger: 0, conflict: 0, injury: 0, safety: 90, socialSupport: 75, success: 50 },
      { authority: 'simulation', totalGameMinutes: 1000 }
    );
    return { danger, safe };
  }, { generated });

  expect(result.danger.mood.stress).toBeGreaterThan(result.safe.mood.stress);
  expect(result.danger.reaction.kind).toBe('fear-stress');
  expect(result.danger.reaction.directedTo).toEqual({ type: 'place', id: 'north-gate' });
  expect(result.danger.causes.some((cause) => cause.id === 'danger')).toBe(true);
  expect(result.danger.mutationBoundary).toBe('emotional-context-only');
});

test('safe context recovers broader mood through authoritative elapsed game time without per-frame ticking', async ({ page }) => {
  await loadEmotion(page);
  const generated = await buildGeneratedContext(page);
  const result = await page.evaluate(({ generated }) => {
    const api = window.Game.CharacterEmotion;
    const distressed = api.deriveInitial(
      generated.base,
      generated.location,
      generated.age,
      { danger: 95, conflict: 90, injury: 45, failure: 70 },
      { authority: 'simulation', totalGameMinutes: 1000 }
    );
    const recovered = api.reconcile(
      distressed,
      generated.base,
      generated.location,
      generated.age,
      { safety: 95, socialSupport: 90, success: 75, workSatisfaction: 70 },
      { authority: 'simulation', totalGameMinutes: 3880 }
    );
    return { distressed, recovered };
  }, { generated });

  expect(result.recovered.mood.stress).toBeLessThan(result.distressed.mood.stress);
  expect(result.recovered.mood.valence).toBeGreaterThan(result.distressed.mood.valence);
  expect(result.recovered.elapsedGameMinutes).toBe(2880);
  expect(result.recovered.reconciliationStrategy).toBe('closed-form-elapsed-game-time');
  expect(result.recovered.lastReconciledGameMinute).toBe(3880);
});

test('baseline personality changes emotional bias without rewriting personality or action legality', async ({ page }) => {
  await loadEmotion(page);
  const evidence = await page.evaluate(() => {
    const common = {
      authority: 'simulation',
      worldIdentity: 'character:test',
      birthDate: { year: 90, month: 1, day: 1 },
      birthplace: { regionX: 0, regionY: 0 },
      baselineBehavioralTendencies: []
    };
    const brave = {
      ...common,
      characterId: 'npc:brave-emotion',
      worldIdentity: 'character:brave-emotion',
      baselinePersonality: { courage: 88, caution: 20, sociability: 60, resilience: 82, ambition: 55, patience: 58 }
    };
    const cautious = {
      ...common,
      characterId: 'npc:cautious-emotion',
      worldIdentity: 'character:cautious-emotion',
      baselinePersonality: { courage: 22, caution: 88, sociability: 44, resilience: 38, ambition: 50, patience: 58 }
    };
    const formative = { settlementType: 'border-village', culture: 'marcher', security: 45, prosperity: 45, martialExposure: 65 };
    const current = { location: { regionX: 4, regionY: 4 }, danger: 78, conflict: 85, security: 25, prosperity: 30, hazard: 30, exposureGameMinutes: 720 };
    const braveLocation = window.Game.CharacterLocationContext.compose(brave, formative, current);
    const cautiousLocation = window.Game.CharacterLocationContext.compose(cautious, formative, current);
    const braveAge = { ok: true, authority: 'simulation', characterId: brave.characterId, ageYears: 36, lifeStage: { id: 'adult' } };
    const cautiousAge = { ok: true, authority: 'simulation', characterId: cautious.characterId, ageYears: 36, lifeStage: { id: 'adult' } };
    const circumstances = { danger: 80, conflict: 75, socialConflict: 35 };
    const time = { authority: 'simulation', totalGameMinutes: 2200 };
    const braveEmotion = window.Game.CharacterEmotion.deriveInitial(brave, braveLocation, braveAge, circumstances, time);
    const cautiousEmotion = window.Game.CharacterEmotion.deriveInitial(cautious, cautiousLocation, cautiousAge, circumstances, time);
    return { brave, cautious, braveEmotion, cautiousEmotion };
  });

  expect(evidence.braveEmotion.mood.stress).toBeLessThan(evidence.cautiousEmotion.mood.stress);
  expect(evidence.braveEmotion.biases.riskTolerance).toBeGreaterThan(evidence.cautiousEmotion.biases.riskTolerance);
  expect(evidence.braveEmotion.baselinePersonalityFingerprint).toBe(JSON.stringify(evidence.brave.baselinePersonality));
  expect(evidence.cautiousEmotion.baselinePersonalityFingerprint).toBe(JSON.stringify(evidence.cautious.baselinePersonality));
  expect(evidence.braveEmotion.biases.role).toBe('bias-only');
  expect(evidence.braveEmotion.biases.legalityAuthority).toBe('simulation-validation-required');
  expect(evidence.braveEmotion.actionAuthority).toBe('none-character-bias-requires-simulation-validation');
});

test('save/load round-trip and direct lazy reconciliation are deterministic', async ({ page }) => {
  await loadEmotion(page);
  const generated = await buildGeneratedContext(page, 'EMOTION-SEED-SAVE', 'npc:emotion:save');
  const evidence = await page.evaluate(({ generated }) => {
    const api = window.Game.CharacterEmotion;
    const initial = api.deriveInitial(
      generated.base,
      generated.location,
      generated.age,
      { danger: 70, failure: 45, memoryNegative: 30 },
      { authority: 'simulation', totalGameMinutes: 500 }
    );
    const serialized = JSON.stringify(initial);
    const restored = api.restore(serialized, generated.base);
    const circumstances = { safety: 80, socialSupport: 65, memoryPositive: 40 };
    const future = { authority: 'simulation', totalGameMinutes: 7700 };
    const directA = api.reconcile(initial, generated.base, generated.location, generated.age, circumstances, future);
    const directB = api.reconcile(restored, generated.base, generated.location, generated.age, circumstances, future);
    return { initial, restored, directA, directB };
  }, { generated });

  expect(evidence.restored).toEqual(evidence.initial);
  expect(evidence.directB).toEqual(evidence.directA);
  expect(evidence.directA.elapsedGameMinutes).toBe(7200);
  expect(evidence.directA.causes.some((cause) => cause.source === 'authoritative-circumstance')).toBe(true);
});

test('emotion derivation is non-mutating and backward game time cannot rewind reconciliation', async ({ page }) => {
  await loadEmotion(page);
  const generated = await buildGeneratedContext(page, 'EMOTION-SEED-BOUNDARY', 'npc:emotion:boundary');
  const evidence = await page.evaluate(({ generated }) => {
    const worldTruth = { location: { row: 12, col: 9 }, legalActions: ['wait'], gold: 3 };
    const before = JSON.stringify(worldTruth);
    const initial = window.Game.CharacterEmotion.deriveInitial(
      generated.base,
      generated.location,
      generated.age,
      { danger: 65, hunger: 55 },
      { authority: 'simulation', totalGameMinutes: 4200 }
    );
    const rewound = window.Game.CharacterEmotion.reconcile(
      initial,
      generated.base,
      generated.location,
      generated.age,
      { safety: 90 },
      { authority: 'simulation', totalGameMinutes: 4000 }
    );
    return { before, after: JSON.stringify(worldTruth), initial, rewound };
  }, { generated });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.rewound.lastReconciledGameMinute).toBe(4200);
  expect(evidence.rewound.elapsedGameMinutes).toBe(0);
  expect(evidence.rewound.mood).toEqual(evidence.initial.mood);
});
