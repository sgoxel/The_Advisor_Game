/* WP-041/I08: authoritative region-travel persistence adapter. */
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const REGION_SIZE = 100;

  function integer(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new TypeError(`${label} must be a safe integer.`);
    return number;
  }

  function local(value, label) {
    const number = integer(value, label);
    if (number < 0 || number >= REGION_SIZE) throw new RangeError(`${label} must be inside the canonical 100x100 region.`);
    return number;
  }

  function currentRegion(world) {
    const source = world?.currentRegion || world?.region || {};
    return {
      x: integer(source.x ?? source.regionX ?? world?.regionX ?? 0, 'region x'),
      y: integer(source.y ?? source.regionY ?? world?.regionY ?? 0, 'region y')
    };
  }

  function capture(worldInput) {
    const world = worldInput || Game.State?.world;
    if (!world || !world.player) throw new TypeError('Authoritative world and protagonist are required.');
    const region = currentRegion(world);
    return Object.freeze({
      schemaVersion: 1,
      authority: 'simulation',
      regionX: region.x,
      regionY: region.y,
      localRow: local(world.player.row, 'protagonist local row'),
      localCol: local(world.player.col, 'protagonist local col')
    });
  }

  function validate(candidate) {
    try {
      if (!candidate || candidate.schemaVersion !== 1 || candidate.authority !== 'simulation') {
        return Object.freeze({ ok: false, code: 'INVALID_REGION_TRAVEL_STATE' });
      }
      return Object.freeze({
        ok: true,
        state: Object.freeze({
          schemaVersion: 1,
          authority: 'simulation',
          regionX: integer(candidate.regionX, 'region x'),
          regionY: integer(candidate.regionY, 'region y'),
          localRow: local(candidate.localRow, 'protagonist local row'),
          localCol: local(candidate.localCol, 'protagonist local col')
        })
      });
    } catch (_error) {
      return Object.freeze({ ok: false, code: 'INVALID_REGION_TRAVEL_STATE' });
    }
  }

  function install(worldInput, candidate) {
    const world = worldInput || Game.State?.world;
    const checked = validate(candidate);
    if (!checked.ok || !world || !world.player) return checked;
    const state = checked.state;

    if (world.currentRegion && typeof world.currentRegion === 'object') {
      world.currentRegion.x = state.regionX;
      world.currentRegion.y = state.regionY;
    } else if (world.region && typeof world.region === 'object') {
      world.region.x = state.regionX;
      world.region.y = state.regionY;
    } else {
      world.regionX = state.regionX;
      world.regionY = state.regionY;
    }

    Object.assign(world.player, {
      row: state.localRow,
      col: state.localCol,
      moving: false,
      startRow: state.localRow,
      startCol: state.localCol,
      targetRow: state.localRow,
      targetCol: state.localCol,
      progress: 1,
      pathQueue: []
    });
    return Object.freeze({ ok: true, state });
  }

  Game.RegionTravelPersistence = Object.freeze({ regionSize: REGION_SIZE, capture, validate, install });
})();
