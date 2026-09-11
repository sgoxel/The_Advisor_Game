const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const authoritativeState = {
  schemaVersion: 1,
  authority: 'simulation',
  world: {
    seed: 'wp041-i08-seed',
    rows: 100,
    cols: 100,
    protagonist: { row: 37, col: 0 }
  }
};

const baseCampaign = {
  format: 'the-advisor-game/campaign-save',
  version: 1,
  mimeType: 'application/json;charset=utf-8',
  createSaveEnvelope() {
    return Object.freeze({
      format: this.format,
      version: this.version,
      authority: 'simulation',
      scope: 'authoritative-only',
      seedIdentity: authoritativeState.world.seed,
      authoritativeState: clone(authoritativeState),
      worldDeltaState: { schemaVersion: 1, authority: 'simulation', regions: [] }
    });
  },
  serializeSave() {
    return JSON.stringify(this.createSaveEnvelope());
  },
  getSuggestedFilename() {
    return 'advisor-campaign-wp041-i08-seed-v1.json';
  },
  validateSave(input) {
    let envelope = input;
    if (typeof input === 'string') {
      try { envelope = JSON.parse(input); } catch (_error) { return Object.freeze({ ok: false, code: 'INVALID_JSON' }); }
    }
    if (!envelope || envelope.format !== this.format || envelope.version !== this.version) {
      return Object.freeze({ ok: false, code: 'INVALID_ENVELOPE' });
    }
    return Object.freeze({
      ok: true,
      envelope: this.createSaveEnvelope(),
      authoritativeState: clone(envelope.authoritativeState),
      worldDeltaState: clone(envelope.worldDeltaState)
    });
  },
  loadSave(input) {
    const checked = this.validateSave(input);
    if (!checked.ok) return checked;
    const player = context.window.Game.State.world.player;
    player.row = checked.authoritativeState.world.protagonist.row;
    player.col = checked.authoritativeState.world.protagonist.col;
    return Object.freeze({
      ok: true,
      authoritativeState: clone(checked.authoritativeState),
      worldDeltaState: clone(checked.worldDeltaState)
    });
  }
};

const player = {
  id: 'protagonist-1', row: 37, col: 0, moving: false,
  startRow: 37, startCol: 0, targetRow: 37, targetCol: 0,
  progress: 1, pathQueue: [], health: 86, history: [{ id: 'kept' }]
};
const world = { currentRegion: { x: 1, y: -2 }, player };
const context = {
  window: {
    Game: {
      State: { world },
      CampaignPersistence: baseCampaign
    }
  },
  Blob: function Blob() {},
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
  document: { body: { appendChild() {} }, createElement() { return { click() {}, remove() {} }; } },
  setTimeout() {}
};
context.window.setTimeout = context.setTimeout;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/region_travel_persistence.js', 'utf8'), context);

const api = context.window.Game.RegionTravelPersistence;
const campaign = context.window.Game.CampaignPersistence;
const saved = api.capture(world);
assert.deepStrictEqual(JSON.parse(JSON.stringify(saved)), {
  schemaVersion: 1, authority: 'simulation', regionX: 1, regionY: -2, localRow: 37, localCol: 0
});
assert.strictEqual(saved.camera, undefined);
assert.strictEqual(saved.render, undefined);

world.currentRegion.x = 99;
world.currentRegion.y = 99;
player.row = 88;
player.col = 88;
player.moving = true;
player.pathQueue = [{ row: 1, col: 1 }];
const history = player.history;
const restored = api.install(world, saved);
assert.strictEqual(restored.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);
assert.strictEqual(player.moving, false);
assert.deepStrictEqual(player.pathQueue, []);
assert.strictEqual(player.health, 86);
assert.strictEqual(player.history, history);

// Installing the same authoritative snapshot again is idempotent: no transition is replayed.
const second = api.install(world, saved);
assert.strictEqual(second.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);
assert.strictEqual(player.history.length, 1);

assert.strictEqual(api.validate({ ...saved, authority: 'presentation' }).ok, false);
assert.strictEqual(api.validate({ ...saved, localRow: 100 }).ok, false);

// Real campaign serialization now carries the authoritative region location.
const campaignEnvelope = campaign.createSaveEnvelope();
assert.strictEqual(campaign.regionTravelIntegrated, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(campaignEnvelope.regionTravelState)), {
  schemaVersion: 1, authority: 'simulation', regionX: 1, regionY: -2, localRow: 37, localCol: 0
});
assert.strictEqual(campaignEnvelope.regionTravelState.camera, undefined);
assert.strictEqual(campaignEnvelope.regionTravelState.render, undefined);

const serialized = campaign.serializeSave();
world.currentRegion.x = 7;
world.currentRegion.y = 8;
player.row = 10;
player.col = 11;
const loaded = campaign.loadSave(serialized);
assert.strictEqual(loaded.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);

// Re-loading is idempotent and never invokes a transition side effect.
const historyLength = player.history.length;
const loadedAgain = campaign.loadSave(serialized);
assert.strictEqual(loadedAgain.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);
assert.strictEqual(player.history.length, historyLength);

// Legacy version-1 origin saves without regionTravelState migrate to (0,0).
const legacyEnvelope = baseCampaign.createSaveEnvelope();
world.currentRegion.x = 4;
world.currentRegion.y = 5;
const legacyLoaded = campaign.loadSave(JSON.stringify(legacyEnvelope));
assert.strictEqual(legacyLoaded.ok, true);
assert.strictEqual(world.currentRegion.x, 0);
assert.strictEqual(world.currentRegion.y, 0);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);

// Mismatched or presentation-authored region state is rejected before mutation.
const mismatch = clone(campaignEnvelope);
mismatch.regionTravelState.localCol = 9;
assert.strictEqual(campaign.validateSave(mismatch).code, 'REGION_LOCATION_MISMATCH');
const presentation = clone(campaignEnvelope);
presentation.regionTravelState.authority = 'presentation';
assert.strictEqual(campaign.validateSave(presentation).code, 'INVALID_REGION_TRAVEL_STATE');

console.log('WP-041/I08 campaign region-travel persistence regression: PASS');
