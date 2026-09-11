/* WP-041/I05-I06 — preserve the same authoritative protagonist and refresh NPC relevance across one validated region transition. */
(function installRegionProtagonistTransition(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp041-protagonist-transition-v2-npc-relevance';

  function integer(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  function protagonistId(player) {
    return String(player?.stableId || player?.characterId || player?.id || 'protagonist:main');
  }

  function commit(worldInput, resolutionInput) {
    const world = worldInput && typeof worldInput === 'object' ? worldInput : null;
    const resolution = resolutionInput && typeof resolutionInput === 'object' ? resolutionInput : null;
    const player = world?.player;
    if (!world || !player || !resolution ||
        resolution.type !== 'adjacent-region-transition-resolution' ||
        resolution.authority !== 'simulation-resolution') return null;

    const toX = integer(resolution.toRegion?.x);
    const toY = integer(resolution.toRegion?.y);
    const row = integer(resolution.entryTile?.row);
    const col = integer(resolution.entryTile?.col);
    const rows = integer(world.rows);
    const cols = integer(world.cols);
    if (toX === null || toY === null || row === null || col === null || rows === null || cols === null ||
        row < 0 || row >= rows || col < 0 || col >= cols) return null;

    const expectedActorId = protagonistId(player);
    if (String(resolution.actorId || 'protagonist:main') !== expectedActorId) return null;

    const sameObject = player;
    const regionSize = Number(Game.RegionTerrain?.regionSize) || cols || 100;

    // Only authoritative position/location fields change here. All identity, history,
    // memories, needs, relationships, inventory, progression and other current state
    // remain on the exact same protagonist object.
    player.regionX = toX;
    player.regionY = toY;
    player.row = row;
    player.col = col;
    player.startRow = row;
    player.startCol = col;
    player.targetRow = row;
    player.targetCol = col;
    player.worldX = toX * regionSize + col;
    player.worldY = toY * regionSize + row;
    player.moving = false;

    const currentRegion = world.currentRegion && typeof world.currentRegion === 'object' ? world.currentRegion : {};
    world.currentRegion = {
      ...currentRegion,
      x: toX,
      y: toY,
      regionSize,
      authority: currentRegion.authority || 'simulation'
    };

    if (world.player !== sameObject) throw new Error('Protagonist continuity invariant violated: authoritative player object was replaced.');

    // Relevance is scheduling/materialization policy only. It observes the newly committed
    // authoritative region/player location and must never authoritatively move an NPC.
    const npcRelevance = Game.NPCRelevanceRuntime?.recomputeAfterRegionTransition?.(world) || null;

    return Object.freeze({
      authority: 'simulation',
      version: VERSION,
      actorId: expectedActorId,
      sameObject: true,
      regionX: toX,
      regionY: toY,
      row,
      col,
      worldX: player.worldX,
      worldY: player.worldY,
      npcRelevance: npcRelevance ? Object.freeze({
        authority: npcRelevance.authority,
        evaluated: Number(npcRelevance.evaluated || 0),
        scheduled: Number(npcRelevance.scheduled || 0)
      }) : null
    });
  }

  Game.RegionProtagonistTransition = Object.freeze({ VERSION, authority: 'simulation', commit });
})(typeof window !== 'undefined' ? window : globalThis);
