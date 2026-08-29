import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/protagonist_driver_intent.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.CharacterDriverContext?.compose &&
    window.Game?.LocalBotDriver?.characterContextBridge &&
    window.Game?.LocalBotDriver?.select &&
    window.Game?.ActionLegality?.validate &&
    window.Game?.ProtagonistDriverIntent?.build
  ));
}

function simulationContext(actorId, characterContext = undefined) {
  return {
    authority: 'simulation',
    actorId,
    campaignRef: 'campaign:character-context',
    locationRef: 'settlement:origin',
    worldRef: 'world:character-context',
    regionRef: 'region:0,0',
    contextRevision: 12,
    campaignMinute: 540,
    actorStateRef: `actor-state:${actorId}`,
    needs: {},
    ...(characterContext ? { characterContext } : {})
  };
}

const opportunities = [
  {
    id: 'safe-route',
    goalType: 'avoid-risk',
    actionType: 'move',
    targetRef: 'place:safe-road',
    locationRef: 'settlement:origin',
    priority: 4,
    urgency: 50,
    distance: 4,
    riskLevel: 0
  },
  {
    id: 'risky-route',
    goalType: 'explore-danger',
    actionType: 'move',
    targetRef: 'place:ridge',
    locationRef: 'settlement:origin',
    priority: 4,
    urgency: 50,
    distance: 4,
    riskLevel: 100
  }
];

async function buildDriverContexts(page) {
  return page.evaluate(() => {
    const Game = window.Game;
    const build = (characterId, personality) => {
      const generated = Game.CharacterIdentity.generateBaseIdentity('DRIVER-CONTEXT-SEED', characterId);
      const base = {
        ...generated,
        baselinePersonality: { ...personality },
        baselineBehavioralTendencies: ['context-regression']
      };
      const age = Game.CharacterAge.derive(base, Game.CampaignCalendar.capture());
      const location = Game.CharacterLocationContext.compose(
        base,
        { settlementType: 'village', culture: 'lowland', security: 60, prosperity: 55, martialExposure: 25, socialDensity: 50 },
        {
          location: { regionX: 0, regionY: 0, settlementId: 'starter-village' },
          danger: 40,
          conflict: 30,
          security: 55,
          prosperity: 50,
          hazard: 20,
          exposureGameMinutes: 360
        }
      );
      const emotion = Game.CharacterEmotion.deriveInitial(
        base,
        location,
        age,
        { danger: 35, safety: 30, success: 20, failure: 10, socialSupport: 25 },
        Game.GameTime.capture()
      );
      return Game.CharacterDriverContext.compose(base, age, location, emotion, {
        relationships: [{ id: 'npc:friend', trust: 55 }],
        memories: [{ id: 'memory:ridge-warning', salience: 40 }]
      });
    };

    return {
      brave: build('protagonist:brave', { courage: 95, caution: 10, sociability: 60, resilience: 90, ambition: 70, patience: 60 }),
      cautious: build('protagonist:cautious', { courage: 10, caution: 95, sociability: 45, resilience: 35, ambition: 45, patience: 65 })
    };
  });
}

test('Local BOT deterministically consumes the unified Simulation-backed character context', async ({ page }) => {
  await load(page);
  const contexts = await buildDriverContexts(page);
  const result = await page.evaluate(({ contexts, opportunities }) => {
    const api = window.Game.LocalBotDriver;
    const noCharacter = api.select({
      authority: 'simulation', actorId: 'protagonist:none', campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin', worldRef: 'world:character-context', regionRef: 'region:0,0',
      contextRevision: 12, campaignMinute: 540, needs: {}
    }, opportunities);
    const braveContext = {
      authority: 'simulation', actorId: 'protagonist:brave', campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin', worldRef: 'world:character-context', regionRef: 'region:0,0',
      contextRevision: 12, campaignMinute: 540, needs: {}, characterContext: contexts.brave
    };
    const cautiousContext = {
      authority: 'simulation', actorId: 'protagonist:cautious', campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin', worldRef: 'world:character-context', regionRef: 'region:0,0',
      contextRevision: 12, campaignMinute: 540, needs: {}, characterContext: contexts.cautious
    };
    return {
      noCharacter,
      brave: api.select(braveContext, opportunities),
      cautious: api.select(cautiousContext, opportunities),
      braveCanonicalA: api.canonicalStringify(braveContext, opportunities),
      braveCanonicalB: api.canonicalStringify(braveContext, [...opportunities].reverse()),
      advisorBridgePreserved: api.advisorChatBridge === true,
      bridgeVersion: api.characterContextBridgeVersion
    };
  }, { contexts, opportunities });

  expect(result.noCharacter.selected.id).toBe('safe-route');
  expect(result.brave.selected.id).toBe('risky-route');
  expect(result.cautious.selected.id).toBe('safe-route');
  expect(result.brave.selected.urgency).toBe(50);
  expect(result.brave.characterContext).toMatchObject({
    status: 'ready',
    authority: 'simulation',
    characterId: 'protagonist:brave',
    directActionAuthority: false,
    directMovementAuthority: false,
    directLegalityAuthority: false,
    directResolutionAuthority: false,
    directWorldMutationAuthority: false,
    simulationValidationRequired: true
  });
  expect(result.brave.characterContext.decisionBiases.riskTolerance).toBeGreaterThan(result.brave.characterContext.decisionBiases.caution);
  expect(result.cautious.characterContext.decisionBiases.riskTolerance).toBeLessThan(result.cautious.characterContext.decisionBiases.caution);
  expect(result.braveCanonicalA).toBe(result.braveCanonicalB);
  expect(result.advisorBridgePreserved).toBe(true);
  expect(result.bridgeVersion).toBe('r04-local-bot-character-context-v1');
});

test('character context changes preference only and cannot bypass Simulation legality', async ({ page }) => {
  await load(page);
  const contexts = await buildDriverContexts(page);
  const evidence = await page.evaluate(({ characterContext, opportunities }) => {
    const Game = window.Game;
    const context = {
      authority: 'simulation', actorId: 'protagonist:brave', campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin', worldRef: 'world:character-context', regionRef: 'region:0,0',
      contextRevision: 12, campaignMinute: 540, needs: {}, characterContext
    };
    const before = Game.AuthoritativeState.canonicalStringify(Game.State);
    const built = Game.LocalBotDriver.buildIntent(context, opportunities);
    const legality = Game.ActionLegality.validate(built.intent.actionIntent, {
      actorId: 'protagonist:brave',
      campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin',
      actions: { move: { enabled: false, requiresTarget: false } },
      targets: [{ ref: 'place:ridge', category: 'place' }]
    });
    const after = Game.AuthoritativeState.canonicalStringify(Game.State);
    return {
      built,
      legality,
      unchanged: before === after,
      hasExecute: typeof Game.LocalBotDriver.execute === 'function',
      hasResolve: typeof Game.LocalBotDriver.resolve === 'function'
    };
  }, { characterContext: contexts.brave, opportunities });

  expect(evidence.built.selection.selected.id).toBe('risky-route');
  expect(evidence.built.intent).toMatchObject({ status: 'ready', authority: 'character-driver', canValidate: true });
  expect(evidence.legality).toMatchObject({
    authority: 'simulation',
    status: 'impossible',
    reasonCode: 'ACTION_CURRENTLY_IMPOSSIBLE',
    canResolve: false
  });
  expect(evidence.unchanged).toBe(true);
  expect(evidence.hasExecute).toBe(false);
  expect(evidence.hasResolve).toBe(false);
});

test('mismatched or authority-bearing character context is rejected rather than trusted', async ({ page }) => {
  await load(page);
  const contexts = await buildDriverContexts(page);
  const evidence = await page.evaluate(({ brave, opportunities }) => {
    const Game = window.Game;
    const base = {
      authority: 'simulation', actorId: 'protagonist:cautious', campaignRef: 'campaign:character-context',
      locationRef: 'settlement:origin', worldRef: 'world:character-context', regionRef: 'region:0,0',
      contextRevision: 12, campaignMinute: 540, needs: {}
    };
    const mismatch = Game.LocalBotDriver.select({ ...base, characterContext: brave }, opportunities);
    const authorityBearing = JSON.parse(JSON.stringify(brave));
    authorityBearing.characterId = 'protagonist:cautious';
    authorityBearing.driverPolicy.directActionAuthority = true;
    const elevated = Game.LocalBotDriver.select({ ...base, characterContext: authorityBearing }, opportunities);
    return { mismatch, elevated };
  }, { brave: contexts.brave, opportunities });

  expect(evidence.mismatch).toMatchObject({ status: 'rejected', reasonCode: 'INVALID_CHARACTER_CONTEXT', selected: null, candidate: null });
  expect(evidence.elevated).toMatchObject({ status: 'rejected', reasonCode: 'INVALID_CHARACTER_CONTEXT', selected: null, candidate: null });
});
