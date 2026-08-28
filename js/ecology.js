/* R02-T25 / #127: deterministic Simulation-backed habitat ecology foundation. */
(function installEcologyFoundation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-ecology-v1';

  const DOMESTIC = Object.freeze(['cattle', 'chicken', 'dog', 'cat', 'horse', 'sheep', 'goat']);
  const WILD = Object.freeze(['deer', 'boar', 'hare', 'wolf', 'fox', 'owl']);
  const FANTASY = Object.freeze([
    Object.freeze({ species: 'mossback-grazer', category: 'animal-like', habitats: ['forest', 'hills'], behavior: 'forage' }),
    Object.freeze({ species: 'reedkin-watcher', category: 'humanoid', habitats: ['coast', 'lake-or-river', 'stream'], behavior: 'territorial' }),
    Object.freeze({ species: 'crag-maw', category: 'monstrous', habitats: ['mountains', 'hills'], behavior: 'territorial' }),
    Object.freeze({ species: 'lantern-wisp', category: 'supernatural', habitats: ['forest', 'lake', 'stream'], behavior: 'idle' })
  ]);

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function validateCoordinates(xInput, yInput) {
    const regionX = Number(xInput);
    const regionY = Number(yInput);
    if (!Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionY)) throw new TypeError('Region coordinates must be safe integers.');
    return { regionX, regionY };
  }

  function deterministicCount(seed, regionX, regionY, species, min, max) {
    return min + (hash32(`${seed}|${regionX}|${regionY}|${species}|count`) % (max - min + 1));
  }

  function makeCreature(seed, regionX, regionY, species, category, behavior, index, habitat) {
    const idHash = hash32(`${seed}|${regionX}|${regionY}|${species}|${index}`).toString(16).padStart(8, '0');
    const phase = hash32(`${idHash}|phase`) % 4;
    const behaviorCycle = behavior === 'forage' ? ['forage', 'idle', 'move', 'flee']
      : behavior === 'territorial' ? ['patrol', 'idle', 'territorial', 'move']
        : ['idle', 'move', 'idle', 'flee'];
    return Object.freeze({
      id: `creature:${species}:${idHash}`,
      authority: 'simulation',
      species,
      category,
      regionX,
      regionY,
      habitat,
      behavior: behaviorCycle[phase],
      playerControllable: false
    });
  }

  function domesticForSettlement(seed, regionX, regionY, composition) {
    if (!composition.settlement) return [];
    const settlement = composition.settlement.type;
    const rural = settlement === 'village' || settlement === 'town';
    const allowed = rural ? DOMESTIC : ['dog', 'cat', 'horse', 'chicken'];
    const results = [];
    for (const species of allowed) {
      const chance = hash32(`${seed}|${regionX}|${regionY}|${species}|domestic`) % 100;
      const threshold = species === 'dog' || species === 'cat' ? 76 : 58;
      if (chance >= threshold) continue;
      const count = deterministicCount(seed, regionX, regionY, species, 1, rural ? 3 : 2);
      for (let i = 0; i < count; i += 1) results.push(makeCreature(seed, regionX, regionY, species, 'domestic', species === 'dog' ? 'territorial' : 'forage', i, `settlement:${settlement}`));
    }
    return results;
  }

  function wildForEnvironment(seed, regionX, regionY, composition) {
    const features = new Set(composition.environmentFeatures || []);
    const env = composition.environment || {};
    const suitability = {
      deer: features.has('forest') || features.has('hills'),
      boar: features.has('forest'),
      hare: env.waterRatio < 0.6,
      wolf: features.has('forest') || features.has('mountains'),
      fox: features.has('forest') || features.has('hills'),
      owl: features.has('forest')
    };
    const results = [];
    for (const species of WILD) {
      if (!suitability[species]) continue;
      if ((hash32(`${seed}|${regionX}|${regionY}|${species}|wild`) % 100) >= 46) continue;
      const count = deterministicCount(seed, regionX, regionY, species, 1, 3);
      for (let i = 0; i < count; i += 1) results.push(makeCreature(seed, regionX, regionY, species, 'wild', species === 'wolf' ? 'territorial' : 'forage', i, [...features][0] || 'open-land'));
    }
    return results;
  }

  function fantasyForEnvironment(seed, regionX, regionY, composition) {
    const features = new Set(composition.environmentFeatures || []);
    const danger = hash32(`${seed}|${regionX}|${regionY}|danger`) % 100;
    const results = [];
    for (const entry of FANTASY) {
      const habitat = entry.habitats.find((item) => features.has(item));
      if (!habitat) continue;
      const threshold = entry.category === 'supernatural' ? 17 : entry.category === 'monstrous' ? 23 : 31;
      if ((hash32(`${seed}|${regionX}|${regionY}|${entry.species}|fantasy`) % 100) >= threshold + Math.floor(danger / 8)) continue;
      const count = deterministicCount(seed, regionX, regionY, entry.species, 1, entry.category === 'animal-like' ? 3 : 2);
      for (let i = 0; i < count; i += 1) results.push(makeCreature(seed, regionX, regionY, entry.species, entry.category, entry.behavior, i, habitat));
    }
    return results;
  }

  function composeRegion(seedInput, regionXInput, regionYInput) {
    if (!Game.WorldComposition?.composeRegion) throw new Error('WorldComposition is required before ecology.');
    const { regionX, regionY } = validateCoordinates(regionXInput, regionYInput);
    const seed = String(seedInput ?? Game.State?.world?.seed ?? '');
    const composition = Game.WorldComposition.composeRegion(seed, regionX, regionY);
    const creatures = [
      ...domesticForSettlement(seed, regionX, regionY, composition),
      ...wildForEnvironment(seed, regionX, regionY, composition),
      ...fantasyForEnvironment(seed, regionX, regionY, composition)
    ];
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      regionX,
      regionY,
      habitatFeatures: Object.freeze([...(composition.environmentFeatures || [])]),
      settlementType: composition.settlement?.type || null,
      creatures: Object.freeze(creatures)
    });
  }

  function advanceFoundation(ecologyState, elapsedGameMinutesInput) {
    const elapsed = Number(elapsedGameMinutesInput);
    if (!ecologyState || ecologyState.authority !== 'simulation' || !Array.isArray(ecologyState.creatures)) throw new TypeError('A valid Simulation ecology state is required.');
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new TypeError('Elapsed game minutes must be non-negative and finite.');
    const step = Math.floor(elapsed / 60);
    const creatures = ecologyState.creatures.map((creature) => {
      const cycle = creature.category === 'domestic' ? ['idle', 'forage', 'move', 'idle']
        : creature.category === 'supernatural' ? ['idle', 'move', 'idle', 'flee']
          : ['forage', 'move', 'idle', creature.behavior === 'territorial' ? 'territorial' : 'flee'];
      const phase = (hash32(creature.id) + step) % cycle.length;
      return Object.freeze({ ...creature, behavior: cycle[phase] });
    });
    return Object.freeze({ ...ecologyState, creatures: Object.freeze(creatures), elapsedGameMinutes: elapsed });
  }

  Game.Ecology = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    domesticSpecies: DOMESTIC,
    wildSpecies: WILD,
    fantasySpecies: Object.freeze(FANTASY.map((entry) => entry.species)),
    composeRegion,
    advanceFoundation
  });
})();
