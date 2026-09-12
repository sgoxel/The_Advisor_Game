/* WP-002/I05: deterministic read-only Simulation-backed innkeeper work opportunity lookup. */
(function installInnkeeperWorkOpportunityLookup() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'wp002-i05-v1';

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalized(value) {
    return text(value).toLowerCase().replace(/[ _]+/g, '-');
  }

  function noOpportunity(reason, innkeeperId = null) {
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      status: 'no-opportunity',
      reason,
      innkeeperId,
      opportunityId: null,
      source: null,
      canStartDialogue: false,
      canAcceptWork: false,
      canMoveActor: false,
      canAwardResources: false,
      canMutateSimulation: false
    });
  }

  function invalid(reason) {
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      status: 'invalid',
      reason,
      innkeeperId: null,
      opportunityId: null,
      source: null,
      canStartDialogue: false,
      canAcceptWork: false,
      canMoveActor: false,
      canAwardResources: false,
      canMutateSimulation: false
    });
  }

  function validInnkeeperContext(input) {
    if (!input || typeof input !== 'object') return null;
    if (normalized(input.authority) !== 'simulation') return null;
    if (normalized(input.status) !== 'found') return null;
    const characterId = text(input.characterId || input.innkeeperId);
    if (!characterId) return null;
    return characterId;
  }

  function stableOpportunityId(record) {
    return text(record?.id || record?.opportunityId || record?.workId);
  }

  function employerId(record) {
    return text(
      record?.innkeeperId
      || record?.employerId
      || record?.sourceNpcId
      || record?.sourceCharacterId
      || record?.offeredById
    );
  }

  function isWorkOpportunity(record) {
    const marker = normalized(
      record?.kind
      || record?.type
      || record?.category
      || record?.opportunityType
      || record?.workType
    );
    return marker === 'work'
      || marker === 'job'
      || marker === 'employment'
      || marker.startsWith('work-')
      || marker.startsWith('job-');
  }

  function isAvailable(record) {
    if (record?.available === false) return false;
    const status = normalized(record?.status || 'available');
    return status === '' || status === 'available' || status === 'open' || status === 'ready';
  }

  function authoritativeSources(world) {
    const sources = [];
    if (Array.isArray(world?.opportunities)) {
      sources.push({ name: 'world.opportunities', records: world.opportunities });
    }
    if (Array.isArray(world?.originVillage?.opportunities)) {
      sources.push({ name: 'world.originVillage.opportunities', records: world.originVillage.opportunities });
    }
    return sources;
  }

  function resolve(innkeeperContext) {
    const world = Game.State?.world;
    if (!world || typeof world !== 'object') return invalid('missing-authoritative-world');

    const innkeeperId = validInnkeeperContext(innkeeperContext);
    if (!innkeeperId) return invalid('invalid-innkeeper-context');

    const candidates = [];
    authoritativeSources(world).forEach((source) => {
      source.records.forEach((record) => {
        const id = stableOpportunityId(record);
        if (!id || !record || typeof record !== 'object') return;
        if (!isWorkOpportunity(record) || !isAvailable(record)) return;
        if (employerId(record) !== innkeeperId) return;
        if (record.authority != null && normalized(record.authority) !== 'simulation') return;
        candidates.push({ id, source: source.name });
      });
    });

    candidates.sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
    if (!candidates.length) return noOpportunity('no-authoritative-work-opportunity', innkeeperId);

    const selected = candidates[0];
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      status: 'found',
      reason: 'authoritative-existing-work-opportunity',
      innkeeperId,
      opportunityId: selected.id,
      source: selected.source,
      canStartDialogue: false,
      canAcceptWork: false,
      canMoveActor: false,
      canAwardResources: false,
      canMutateSimulation: false
    });
  }

  Game.InnkeeperWorkOpportunityLookup = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    resolve
  });
})();
