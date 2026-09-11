/* WP-041/I01 — read-only authoritative region-edge crossing intent detection. */
(function installRegionTransitionIntent(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp041-region-transition-intent-v1';
  const DIRECTIONS = Object.freeze({
    north: Object.freeze({ dr: -1, dc: 0, regionDx: 0, regionDy: -1 }),
    east: Object.freeze({ dr: 0, dc: 1, regionDx: 1, regionDy: 0 }),
    south: Object.freeze({ dr: 1, dc: 0, regionDx: 0, regionDy: 1 }),
    west: Object.freeze({ dr: 0, dc: -1, regionDx: -1, regionDy: 0 })
  });

  function integer(value, fallback = null) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze(value[key]);
    return value;
  }

  function regionCoordinates(world, player) {
    const current = world?.currentRegion || {};
    return {
      x: integer(player?.regionX, integer(current.x, 0)),
      y: integer(player?.regionY, integer(current.y, 0))
    };
  }

  function detect(worldInput, directionInput) {
    const world = worldInput && typeof worldInput === 'object' ? worldInput : null;
    const player = world?.player;
    const direction = String(directionInput || '').trim().toLowerCase();
    const vector = DIRECTIONS[direction];
    const rows = integer(world?.rows);
    const cols = integer(world?.cols);
    const row = integer(player?.row);
    const col = integer(player?.col);

    if (!world || !player || !vector || rows === null || cols === null || rows <= 0 || cols <= 0 || row === null || col === null) {
      return null;
    }
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null;

    const nextRow = row + vector.dr;
    const nextCol = col + vector.dc;
    const crossesNorth = direction === 'north' && row === 0 && nextRow < 0;
    const crossesSouth = direction === 'south' && row === rows - 1 && nextRow >= rows;
    const crossesWest = direction === 'west' && col === 0 && nextCol < 0;
    const crossesEast = direction === 'east' && col === cols - 1 && nextCol >= cols;
    if (!(crossesNorth || crossesSouth || crossesWest || crossesEast)) return null;

    const region = regionCoordinates(world, player);
    return freeze({
      type: 'adjacent-region-crossing-intent',
      authority: 'simulation-request',
      direction,
      actorId: String(world?.protagonist?.id || player?.id || 'protagonist:main'),
      fromRegion: { x: region.x, y: region.y },
      fromTile: { row, col },
      regionDelta: { x: vector.regionDx, y: vector.regionDy },
      requestedEntryEdge: direction === 'north' ? 'south'
        : direction === 'south' ? 'north'
          : direction === 'east' ? 'west' : 'east',
      directWorldMutation: false
    });
  }

  Game.RegionTransitionIntent = Object.freeze({ VERSION, DIRECTIONS, detect });
})(typeof window !== 'undefined' ? window : globalThis);
