import { test, expect } from '@playwright/test';

async function loadContext(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.CharacterIdentity?.generateBaseIdentity && window.Game?.CharacterLocationContext?.compose));
}

test('normal startup exposes Simulation-owned location-context composition', async ({ page }) => {
  await loadContext(page);
  const startup = await page.evaluate(() => ({
    authority: window.Game.CharacterLocationContext.authority,
    scriptLoaded: Array.from(document.scripts).some((script) => script.src.endsWith('/js/character_location_context.js'))
  }));
  expect(startup.authority).toBe('simulation');
  expect(startup.scriptLoaded).toBe(true);
});

test('birthplace formative baseline is deterministic and does not rewrite base personality', async ({ page }) => {
  await loadContext(page);
  const result = await page.evaluate(() => {
    const base = window.Game.CharacterIdentity.generateBaseIdentity('CTX-SEED-A', 'npc:context:1');
    const birthplace = { settlementType: 'border-village', culture: 'marcher', environment: 'forest', security: 35, prosperity: 42, martialExposure: 65, wildernessExposure: 60, socialDensity: 35 };
    const current = { location: { regionX: 3, regionY: -2, settlementId: 'war-town' }, danger: 72, conflict: 85, security: 25, prosperity: 30, hazard: 40, exposureGameMinutes: 720 };
    const first = window.Game.CharacterLocationContext.compose(base, birthplace, current);
    const second = window.Game.CharacterLocationContext.compose(base, birthplace, current);
    return { base, first, second };
  });

  expect(result.second).toEqual(result.first);
  expect(result.first.stableBase.birthplace).toEqual(result.base.birthplace);
  expect(result.first.stableBase.baselinePersonality).toEqual(result.base.baselinePersonality);
  expect(result.first.formative.baselinePersonalityFingerprint).toBe(JSON.stringify(result.base.baselinePersonality));
  expect(result.first.current.baselinePersonalityFingerprint).toBe(JSON.stringify(result.base.baselinePersonality));
});

test('same birthplace can yield different current responses from different baseline traits', async ({ page }) => {
  await loadContext(page);
  const evidence = await page.evaluate(() => {
    const common = {
      authority: 'simulation',
      seed: 'CTX-SEED-B',
      birthplace: { worldX: 12, worldY: 18, regionX: 0, regionY: 0, settlementId: 'village-a' },
      baselineBehavioralTendencies: []
    };
    const brave = {
      ...common,
      characterId: 'npc:brave', worldIdentity: 'character:brave',
      baselinePersonality: { courage: 82, caution: 28, sociability: 55, resilience: 74, ambition: 50, patience: 52 }
    };
    const cautious = {
      ...common,
      characterId: 'npc:cautious', worldIdentity: 'character:cautious',
      baselinePersonality: { courage: 28, caution: 82, sociability: 45, resilience: 42, ambition: 50, patience: 52 }
    };
    const formative = { settlementType: 'fortified-village', culture: 'marcher', martialExposure: 75, security: 45, prosperity: 45 };
    const war = { location: { regionX: 4, regionY: 4 }, danger: 80, conflict: 90, security: 20, prosperity: 25, hazard: 45, exposureGameMinutes: 1440 };
    const api = window.Game.CharacterLocationContext;
    return { brave: api.compose(brave, formative, war), cautious: api.compose(cautious, formative, war) };
  });

  expect(evidence.brave.formative.birthplace).toEqual(evidence.cautious.formative.birthplace);
  expect(evidence.brave.current.modifiers.stress).toBeLessThan(evidence.cautious.current.modifiers.stress);
  expect(evidence.brave.current.modifiers.confidence).toBeGreaterThan(evidence.cautious.current.modifiers.confidence);
});

test('leaving and re-entering restores the same contextual response without changing formative baseline', async ({ page }) => {
  await loadContext(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterLocationContext;
    const base = window.Game.CharacterIdentity.generateBaseIdentity('CTX-SEED-C', 'npc:returning:1');
    const formative = { settlementType: 'village', culture: 'riverfolk', wildernessExposure: 30, martialExposure: 20, security: 60, prosperity: 55 };
    const warTown = { location: { regionX: 5, regionY: 1, settlementId: 'war-town' }, danger: 75, conflict: 88, security: 25, prosperity: 28, exposureGameMinutes: 480 };
    const safeTown = { location: { regionX: 1, regionY: 1, settlementId: 'safe-town' }, danger: 5, conflict: 0, security: 90, prosperity: 72, exposureGameMinutes: 480 };
    const firstWar = api.compose(base, formative, warTown);
    const safe = api.compose(base, formative, safeTown);
    const returnedWar = api.compose(base, formative, warTown);
    return { firstWar, safe, returnedWar };
  });

  expect(evidence.returnedWar).toEqual(evidence.firstWar);
  expect(evidence.safe.stableBase).toEqual(evidence.firstWar.stableBase);
  expect(evidence.safe.formative).toEqual(evidence.firstWar.formative);
  expect(evidence.safe.current.modifiers.stress).toBeLessThan(evidence.firstWar.current.modifiers.stress);
});

test('context is recomputable from saved authoritative inputs and remains presentation-independent', async ({ page }) => {
  await loadContext(page);
  const evidence = await page.evaluate(() => {
    const base = window.Game.CharacterIdentity.generateBaseIdentity('CTX-SEED-D', 'npc:save:1');
    const birthplaceContext = { settlementType: 'market-town', culture: 'lowland', security: 70, prosperity: 65, socialDensity: 78 };
    const currentContext = { location: { regionX: -2, regionY: 3 }, danger: 22, conflict: 10, security: 74, prosperity: 62, hazard: 8, exposureGameMinutes: 120 };
    const before = window.Game.CharacterLocationContext.compose(base, birthplaceContext, currentContext);
    const serialized = JSON.stringify({ base, birthplaceContext, currentContext });
    const restored = JSON.parse(serialized);
    const after = window.Game.CharacterLocationContext.compose(restored.base, restored.birthplaceContext, restored.currentContext);
    return { before, after };
  });

  expect(evidence.after).toEqual(evidence.before);
  expect(JSON.stringify(evidence.before)).not.toContain('viewport');
  expect(JSON.stringify(evidence.before)).not.toContain('sprite');
  expect(JSON.stringify(evidence.before)).not.toContain('css');
});
