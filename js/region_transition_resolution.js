/* WP-041/I02 — authoritative adjacent-region coordinate resolution. */
(function installRegionTransitionResolution(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp041-region-transition-resolution-v1';

  function integer(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze(value[key]);
    return value;
  }

  function resolve(worldInput, intentInput) {
    const world = worldInput && typeof worldInput === 'object' ? worldInput : null;
    const intent = intentInput && typeof intentInput === 'object' ? intentInput : null;
    const rows = integer(world?.rows);
    const cols = integer(world?.cols);
    const fromX = integer(intent?.fromRegion?.x);
    const fromY = integer(intent?.fromRegion?.y);
    const deltaX = integer(intent?.regionDelta?.x);
    const deltaY = integer(intent?.regionDelta?.y);
    const fromRow = integer(intent?.fromTile?.row);
    const fromCol = integer(intent?.fromTile?.col);
    const direction = String(intent?.direction || '').toLowerCase();

    if (!world || !intent || intent.type !== 'adjacent-region-crossing-intent' ||
        intent.authority !== 'simulation-request' || rows === null || cols === null ||
        rows <= 0 || cols <= 0 || fromX === null || fromY === null || deltaX === null ||
        deltaY === null || fromRow === null || fromCol === null) return null;

    const expected = {
      north: { dx: 0, dy: -1, edge: 'south' },
      east: { dx: 1, dy: 0, edge: 'west' },
      south: { dx: 0, dy: 1, edge: 'north' },
      west: { dx: -1, dy: 0, edge: 'east' }
    }[direction];
    if (!expected || deltaX !== expected.dx || deltaY !== expected.dy || intent.requestedEntryEdge !== expected.edge) return null;

    let row = fromRow;
    let col = fromCol;
    if (direction === 'north') row = rows - 1;
    else if (direction === 'south') row = 0;
    else if (direction === 'west') col = cols - 1;
    else col = 0;

    if (row < 0 || row >= rows || col < 0 || col >= cols) return null;

    return freeze({
      type: 'adjacent-region-transition-resolution',
      authority: 'simulation-resolution',
      actorId: String(intent.actorId || 'protagonist:main'),
      direction,
      fromRegion: { x: fromX, y: fromY },
      toRegion: { x: fromX + deltaX, y: fromY + deltaY },
      entryTile: { row, col },
      directWorldMutation: false
    });
  }

  Game.RegionTransitionResolution = Object.freeze({ VERSION, resolve });
})(typeof window !== 'undefined' ? window : globalThis);
