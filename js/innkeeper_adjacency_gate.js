/* WP-002/I03: read-only Simulation-backed innkeeper inquiry adjacency gate. */
(function installInnkeeperAdjacencyGate() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'wp002-i03-v1';

  function text(value) {
    return String(value ?? '').trim();
  }

  function integer(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  function result(eligible, reason, details = {}) {
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      readOnly: true,
      eligible: Boolean(eligible),
      status: eligible ? 'eligible' : 'ineligible',
      reason,
      protagonistId: details.protagonistId || null,
      innkeeperId: details.innkeeperId || null,
      regionRef: details.regionRef || null,
      distance: Number.isSafeInteger(details.distance) ? details.distance : null
    });
  }

  function regionOf(actor) {
    const regionX = integer(actor?.regionX);
    const regionY = integer(actor?.regionY);
    if (regionX === null || regionY === null) return null;
    return { x: regionX, y: regionY, ref: `region:${regionX},${regionY}` };
  }

  function pointOf(actor) {
    const row = integer(actor?.row);
    const col = integer(actor?.col);
    return row === null || col === null ? null : { row, col };
  }

  function evaluate(innkeeperId) {
    const world = Game.State?.world;
    if (!world || typeof world !== 'object') return result(false, 'missing-authoritative-world');

    const protagonist = world.player;
    const protagonistId = text(world.protagonist?.id) || text(protagonist?.id) || 'protagonist:main';
    if (!protagonist || typeof protagonist !== 'object') {
      return result(false, 'missing-protagonist', { protagonistId });
    }

    const requestedId = text(innkeeperId);
    if (!requestedId) return result(false, 'missing-innkeeper-id', { protagonistId });

    const npcs = Array.isArray(world.npcs) ? world.npcs : [];
    const innkeeper = npcs.find((npc) => text(npc?.id) === requestedId);
    if (!innkeeper || innkeeper.authority !== 'simulation') {
      return result(false, 'missing-authoritative-innkeeper', { protagonistId, innkeeperId: requestedId });
    }

    const protagonistRegion = regionOf(protagonist);
    const innkeeperRegion = regionOf(innkeeper);
    if (!protagonistRegion || !innkeeperRegion) {
      return result(false, 'malformed-region', { protagonistId, innkeeperId: requestedId });
    }
    if (protagonistRegion.x !== innkeeperRegion.x || protagonistRegion.y !== innkeeperRegion.y) {
      return result(false, 'different-region', { protagonistId, innkeeperId: requestedId });
    }

    const protagonistPoint = pointOf(protagonist);
    const innkeeperPoint = pointOf(innkeeper);
    if (!protagonistPoint || !innkeeperPoint) {
      return result(false, 'malformed-position', {
        protagonistId,
        innkeeperId: requestedId,
        regionRef: protagonistRegion.ref
      });
    }

    const distance = Math.abs(protagonistPoint.row - innkeeperPoint.row)
      + Math.abs(protagonistPoint.col - innkeeperPoint.col);
    return result(distance === 1, distance === 1 ? 'adjacent' : 'not-adjacent', {
      protagonistId,
      innkeeperId: requestedId,
      regionRef: protagonistRegion.ref,
      distance
    });
  }

  function evaluateResolvedLocalInnkeeper() {
    const lookup = Game.InnkeeperIdentityLookup;
    if (!lookup || typeof lookup.resolveLocal !== 'function') return result(false, 'identity-lookup-unavailable');
    const resolved = lookup.resolveLocal();
    if (resolved?.status !== 'found' || !text(resolved.characterId)) {
      return result(false, 'no-resolved-innkeeper');
    }
    return evaluate(resolved.characterId);
  }

  Game.InnkeeperAdjacencyGate = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    readOnly: true,
    evaluate,
    evaluateResolvedLocalInnkeeper
  });
})();
