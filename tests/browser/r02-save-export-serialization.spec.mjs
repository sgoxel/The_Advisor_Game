import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function waitForCampaignSave(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.CampaignSave?.createEnvelope &&
    window.Game?.CampaignSave?.serialize &&
    window.Game?.CampaignSave?.download
  ));
}

test('save envelope is explicit, versioned and authoritative-only', async ({ page }) => {
  await waitForCampaignSave(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignSave;
    const envelope = persistence.createEnvelope();
    const blob = persistence.createExportBlob();
    return {
      format: envelope.format,
      schemaVersion: envelope.schemaVersion,
      authoritativeSchemaVersion: envelope.authoritativeSchemaVersion,
      seedIdentity: envelope.seedIdentity,
      runtimeSeed: window.Game.State.world.seed,
      authoritativeAuthority: envelope.authoritative.authority,
      blobType: blob.type,
      frozen: Object.isFrozen(envelope) && Object.isFrozen(envelope.authoritative)
    };
  });

  expect(evidence.format).toBe('the-advisor-game-campaign');
  expect(evidence.schemaVersion).toBe(1);
  expect(evidence.authoritativeSchemaVersion).toBe(1);
  expect(evidence.seedIdentity).toBe(evidence.runtimeSeed);
  expect(evidence.authoritativeAuthority).toBe('simulation');
  expect(evidence.blobType).toBe('application/json;charset=utf-8');
  expect(evidence.frozen).toBe(true);
});

test('equivalent authoritative state serializes to byte-identical save content', async ({ page }) => {
  await waitForCampaignSave(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignSave;
    const authority = window.Game.AuthoritativeState;
    const captured = authority.capture(window.Game.State);
    const first = persistence.serialize();
    const second = persistence.serialize(captured);
    const parsed = JSON.parse(first);
    const preparedRoundTrip = persistence.serialize(parsed.authoritative);
    return {
      first,
      second,
      preparedRoundTrip,
      canonicalFromSave: authority.canonicalStringify(parsed.authoritative),
      canonicalRuntime: authority.canonicalStringify(captured)
    };
  });

  expect(evidence.second).toBe(evidence.first);
  expect(evidence.preparedRoundTrip).toBe(evidence.first);
  expect(evidence.canonicalFromSave).toBe(evidence.canonicalRuntime);
});

test('presentation, cache and credential-like runtime values cannot enter save bytes', async ({ page }) => {
  await waitForCampaignSave(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignSave;
    const state = window.Game.State;
    const before = persistence.serialize();

    state.camera.x += 424242;
    state.camera.zoom = 0.37;
    state.world.selected = { row: 0, col: 0, marker: 'SECRET_SELECTED' };
    state.world.hover = { row: 1, col: 1, marker: 'SECRET_HOVER' };
    state.world.previewPath = [{ row: 2, col: 2, marker: 'SECRET_PREVIEW' }];
    state.render.r02SecretCache = 'SECRET_RENDER_CACHE';
    state.dom.r02CredentialToken = 'SECRET_CREDENTIAL_TOKEN';
    state.r02Credential = 'SECRET_ROOT_CREDENTIAL';

    const after = persistence.serialize();
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
  await waitForCampaignSave(page);

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignSave;
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
      base: persistence.serialize(base),
      distinct: persistence.serialize(candidate)
    };
  });

  expect(evidence.distinct).not.toBe(evidence.base);
});

test('download produces retrievable deterministic JSON without hidden runtime data', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Download evidence is exercised once; serialization is viewport-independent.');
  await waitForCampaignSave(page);

  await page.evaluate(() => {
    window.Game.State.dom.downloadOnlySecret = 'DO_NOT_EXPORT_ME';
  });
  const expected = await page.evaluate(() => ({
    content: window.Game.CampaignSave.serialize(),
    filename: window.Game.CampaignSave.buildFilename()
  }));

  const downloadPromise = page.waitForEvent('download');
  const metadata = await page.evaluate(() => window.Game.CampaignSave.download());
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const content = await readFile(downloadPath, 'utf8');

  expect(download.suggestedFilename()).toBe(expected.filename);
  expect(metadata.filename).toBe(expected.filename);
  expect(metadata.serialized).toBe(expected.content);
  expect(content).toBe(expected.content);
  expect(content).not.toContain('DO_NOT_EXPORT_ME');
  expect(expected.filename).toMatch(/^advisor-campaign-v1-.+\.json$/);
});
