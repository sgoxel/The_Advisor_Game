'use strict';

const assert = require('assert');
const path = require('path');

const transitionPath = path.resolve(__dirname, '../js/region_protagonist_transition.js');

function loadRuntime() {
  delete require.cache[transitionPath];
  global.window = global;

  const player = { id: 'protagonist:main', regionX: 0, regionY: 0, row: 99, col: 42, health: 88 };
  const camera = { x: -400, y: 275, zoom: 1, followPlayer: true };
  const world = {
    rows: 100,
    cols: 100,
    currentRegion: { x: 0, y: 0, authority: 'simulation' },
    player,
    npcs: []
  };
  const calls = [];

  global.Game = {
    State: { world, camera },
    RegionTerrain: { regionSize: 100 },
    Renderer: {
      centerCamera: () => {
        calls.push({ type: 'center', regionX: player.regionX, regionY: player.regionY, row: player.row, col: player.col });
        camera.x = player.col * 10;
        camera.y = player.row * 10;
      },
      markDirty: (worldDirty, minimapDirty) => calls.push({ type: 'dirty', worldDirty, minimapDirty })
    }
  };

  require(transitionPath);
  return { world, player, camera, calls };
}

function run() {
  const { world, player, camera, calls } = loadRuntime();
  const identity = player;

  const result = global.Game.RegionProtagonistTransition.commit(world, {
    type: 'adjacent-region-transition-resolution',
    authority: 'simulation-resolution',
    actorId: 'protagonist:main',
    toRegion: { x: 1, y: 0 },
    entryTile: { row: 12, col: 0 }
  });

  assert.ok(result, 'validated transition must commit');
  assert.strictEqual(world.player, identity, 'camera rebase must not replace the authoritative protagonist');
  assert.equal(player.regionX, 1);
  assert.equal(player.regionY, 0);
  assert.equal(player.row, 12);
  assert.equal(player.col, 0);
  assert.equal(player.health, 88, 'presentation rebase must not mutate unrelated authoritative state');

  assert.equal(calls.length, 2, 'transition should recenter then invalidate render/minimap once');
  assert.deepEqual(calls[0], { type: 'center', regionX: 1, regionY: 0, row: 12, col: 0 }, 'camera must observe already-committed authoritative destination state');
  assert.deepEqual(calls[1], { type: 'dirty', worldDirty: true, minimapDirty: true }, 'existing render lifecycle must be invalidated after rebasing');
  assert.equal(camera.x, 0);
  assert.equal(camera.y, 120);
  assert.deepEqual(result.presentation, { authority: 'presentation-only', cameraRebased: true });
  assert.equal(result.authority, 'simulation', 'transition result remains Simulation-owned while presentation metadata stays explicitly non-authoritative');

  console.log('WP-041/I07 region camera rebase: PASS');
}

run();
