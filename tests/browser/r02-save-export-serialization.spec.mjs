import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function waitForPersistence(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.CampaignPersistence?.createSaveEnvelope &&
    window.Game?.CampaignPersistence?.serializeSave &&
    window.Game?.CampaignPersistence?.downloadSave
  ));
}

test('save envelope is explicit, versioned and authoritative-only', async ({ page }) => {
  await waitForPersistence(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const envelope = persistence.createSaveEnvelope();
    return {
      format: envelope.format,
      version: envelope.version,
      authority: envelope.authority,
      scope: envelope.scope,
      seedIdentity: envelope.seedIdentity,
      runtimeSeed: window.Game.State.world.seed,
      authoritativeSchemaVersion: envelope.authoritativeState.schemaVersion,
      authoritativeAuthority: envelope.authoritativeState.authority,
      frozen: Object.isFrozen(envelope) && Object.isFrozen(envelope.authoritativeState)
    };
  });

  expect(evidence.format).toBe('the-advisor-game/campaign-save');
  expect(evidence.version).toBe(1);
  expect(evidence.authority).toBe('simulation');
  expect(evidence.scope).toBe('authoritative-only');
  expect(evidence.seedIdentity).toBe(evidence.runtimeSeed);
  expect(evidence.authoritativeSchemaVersion).toBe(1);
  expect(evidence.authoritativeAuthority).toBe('simulation');
  expect(evidence.frozen).toBe(true);
});

test('equivalent authoritative state serializes to byte-identical save content', async ({ page }) => {
  await waitForPersistence(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const authority = window.Game.AuthoritativeState;
    const captured = authority.capture(window.Game.State);
    const first = persistence.serializeSave();
    const second = persistence.serializeSave(captured);
    const parsed = JSON.parse(first);
    const preparedRoundTrip = persistence.serializeSave(parsed.authoritativeState);
    return {
      first,
      second,
      preparedRoundTrip,
      canonicalFromSave: authority.canonicalStringify(parsed.authoritativeState),
      canonicalRuntime: authority.canonicalStringify(captured)
    };
  });

  expect(evidence.second).toBe(evidence.first);
  expect(evidence.preparedRoundTrip).toBe(evidence.first);
  expect(evidence.canonicalFromSave).toBe(evidence.canonicalRuntime);
});

test('presentation, cache and credential-like runtime values cannot enter save bytes', async ({ page }) => {
  await waitForPersistence(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const state = window.Game.State;
    const before = persistence.serializeSave();

    state.camera.x += 424242;
    state.camera.zoom = 0.37;
    state.world.selected = { row: 0, col: 0, marker: 'SECRET_SELECTED' };
    state.world.hover = { row: 1, col: 1, marker: 'SECRET_HOVER' };
    state.world.previewPath = [{ row: 2, col: 2, marker: 'SECRET_PREVIEW' }];
    state.render.r02SecretCache = 'SECRET_RENDER_CACHE';
    state.dom.r02CredentialToken = 'SECRET_CREDENTIAL_TOKEN';
    state.r02Credential = 'SECRET_ROOT_CREDENTIAL';

    const after = persistence.serializeSave();
    return { before, after };
  });

  expect(evidence.after).toBe(evidence.before);
  for (const forbidden of [
    'SECRET_SELECTED',
    'SECRET_HOVER',
    'SECRET_PREVIEW',
    'SECRET_RENDER_CACHE',
    'SECRET_CREDENTIAL_TOKEN',
    'SECRET_ROOT_CREDENTIAL',
    'r02CredentialToken',
    'r02Credential'
  ]) {
    expect(evidence.after).not.toContain(forbidden);
  }
});

test('different authoritative seed identity changes deterministic save bytes', async ({ page }) => {
  await waitForPersistence(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const authority = window.Game.AuthoritativeState;
    const base = authority.capture(window.Game.State);
    const candidate = {
      ...base,
      world: {
        ...base.world,
        seed: `${base.world.seed}-distinct`
      }
    };
    return {
      base: persistence.serializeSave(base),
      distinct: persistence.serializeSave(candidate)
    };
  });

  expect(evidence.distinct).not.toBe(evidence.base);
});

test('downloadSave produces retrievable deterministic JSON without hidden runtime data', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Download evidence is exercised once; serialization is viewport-independent.');
  await waitForPersistence(page);

  await page.evaluate(() => {
    window.Game.State.dom.downloadOnlySecret = 'DO_NOT_EXPORT_ME';
  });
  const expected = await page.evaluate(() => ({
    content: window.Game.CampaignPersistence.serializeSave(),
    filename: window.Game.CampaignPersistence.getSuggestedFilename()
  }));

  const downloadPromise = page.waitForEvent('download');
  const metadata = await page.evaluate(() => window.Game.CampaignPersistence.downloadSave());
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const content = await readFile(downloadPath, 'utf8');

  expect(download.suggestedFilename()).toBe(expected.filename);
  expect(metadata.filename).toBe(expected.filename);
  expect(metadata.mimeType).toBe('application/json;charset=utf-8');
  expect(metadata.content).toBe(expected.content);
  expect(content).toBe(expected.content);
  expect(content).not.toContain('DO_NOT_EXPORT_ME');
  expect(expected.filename).toMatch(/^advisor-campaign-.+-v1\.json$/);
});
