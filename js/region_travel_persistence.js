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

  const api = Object.freeze({ regionSize: REGION_SIZE, capture, validate, install });
  Game.RegionTravelPersistence = api;

  /*
    WP-041/I08-R1: compose region travel into the existing campaign envelope without
    creating a second save authority. Campaign save version 1 predates region travel;
    a missing regionTravelState therefore migrates only as the representable origin
    region (0,0) using the validated authoritative protagonist local row/col.
  */
  const campaign = Game.CampaignPersistence;
  if (!campaign || campaign.regionTravelIntegrated === true) return;

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }

  function parseEnvelope(input) {
    if (typeof input !== 'string') return input;
    try {
      return JSON.parse(input);
    } catch (_error) {
      return null;
    }
  }

  function originMigration(authoritativeState) {
    const protagonist = authoritativeState?.world?.protagonist;
    return Object.freeze({
      schemaVersion: 1,
      authority: 'simulation',
      regionX: 0,
      regionY: 0,
      localRow: protagonist?.row,
      localCol: protagonist?.col
    });
  }

  function appendRegionState(baseEnvelope, regionState) {
    return freeze({ ...baseEnvelope, regionTravelState: regionState });
  }

  function createSaveEnvelope(candidate, deltaCandidate, regionCandidate) {
    const baseEnvelope = campaign.createSaveEnvelope(candidate, deltaCandidate);
    const source = regionCandidate || Game.State?.world;
    const regionState = source
      ? api.capture(source)
      : originMigration(baseEnvelope.authoritativeState);
    const checkedRegion = api.validate(regionState);
    if (!checkedRegion.ok) throw new TypeError('Campaign region travel state is invalid.');
    return appendRegionState(baseEnvelope, checkedRegion.state);
  }

  function serializeSave(candidate, deltaCandidate, regionCandidate) {
    return JSON.stringify(createSaveEnvelope(candidate, deltaCandidate, regionCandidate));
  }

  function validateSave(input) {
    const rawEnvelope = parseEnvelope(input);
    const baseChecked = campaign.validateSave(input);
    if (!baseChecked.ok) return baseChecked;

    const rawRegionState = rawEnvelope?.regionTravelState;
    const candidate = rawRegionState === undefined
      ? originMigration(baseChecked.authoritativeState)
      : rawRegionState;
    const regionChecked = api.validate(candidate);
    if (!regionChecked.ok) {
      return Object.freeze({
        ok: false,
        code: 'INVALID_REGION_TRAVEL_STATE',
        message: 'Campaign save region travel state is invalid.'
      });
    }

    const protagonist = baseChecked.authoritativeState.world.protagonist;
    if (regionChecked.state.localRow !== protagonist.row || regionChecked.state.localCol !== protagonist.col) {
      return Object.freeze({
        ok: false,
        code: 'REGION_LOCATION_MISMATCH',
        message: 'Campaign save region travel location does not match authoritative protagonist position.'
      });
    }

    return freeze({
      ...baseChecked,
      envelope: appendRegionState(baseChecked.envelope, regionChecked.state),
      regionTravelState: regionChecked.state
    });
  }

  function loadSave(input) {
    const checked = validateSave(input);
    if (!checked.ok) return checked;

    const baseResult = campaign.loadSave(checked.envelope);
    if (!baseResult.ok) return baseResult;

    const installed = api.install(Game.State?.world, checked.regionTravelState);
    if (!installed.ok) return installed;

    return freeze({
      ...baseResult,
      regionTravelState: api.capture(Game.State.world)
    });
  }

  function getSuggestedFilename(candidate) {
    return campaign.getSuggestedFilename(candidate);
  }

  function downloadSave(candidate, deltaCandidate, regionCandidate) {
    const envelope = createSaveEnvelope(candidate, deltaCandidate, regionCandidate);
    const content = JSON.stringify(envelope);
    const filename = campaign.getSuggestedFilename(candidate);
    const blob = new Blob([content], { type: campaign.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Object.freeze({ filename, mimeType: campaign.mimeType, content });
  }

  Game.CampaignPersistence = Object.freeze({
    ...campaign,
    regionTravelIntegrated: true,
    createSaveEnvelope,
    serializeSave,
    getSuggestedFilename,
    downloadSave,
    validateSave,
    loadSave
  });
})();
