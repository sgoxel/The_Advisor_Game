/* WP-002/I02: deterministic Simulation-backed innkeeper identity lookup. */
(function installInnkeeperIdentityLookup() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'wp002-i02-v1';

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
  }

  function stableCharacterId(person) {
    return String(person?.id ?? person?.worldIdentity ?? person?.characterId ?? '').trim();
  }

  function professionOf(person) {
    return normalized(person?.currentProfession || person?.profession || person?.occupation || person?.role || '');
  }

  function isInnkeeperProfession(profession) {
    return profession === 'innkeeper'
      || profession === 'inn-keeper'
      || profession === 'tavern-keeper'
      || profession === 'tavernkeeper'
      || profession === 'barkeep'
      || profession === 'publican';
  }

  function noMatch(reason) {
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      status: 'no-match',
      reason,
      characterId: null,
      profession: null
    });
  }

  function resolveLocal() {
    const world = Game.State?.world;
    if (!world || typeof world !== 'object') return noMatch('missing-authoritative-world');

    const village = world.originVillage;
    const population = Array.isArray(village?.population) ? village.population : [];
    const candidates = population
      .map((person) => ({ person, id: stableCharacterId(person), profession: professionOf(person) }))
      .filter((entry) => entry.id && isInnkeeperProfession(entry.profession))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (!candidates.length) return noMatch('no-local-innkeeper');

    const selected = candidates[0];
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      status: 'found',
      reason: 'authoritative-local-candidate',
      characterId: selected.id,
      profession: selected.profession
    });
  }

  Game.InnkeeperIdentityLookup = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    resolveLocal
  });
})();
