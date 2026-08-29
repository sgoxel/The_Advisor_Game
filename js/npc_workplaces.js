/* R04 / #259: deterministic profession-compatible workplaces and shared capacity. */
(function installNpcWorkplaces() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-workplaces-v1';

  const OUTDOOR_PROFESSIONS = new Set(['farmer', 'hunter', 'fisher', 'woodcutter', 'forager', 'herder']);
  const NON_WORKING = new Set(['child', 'dependent', 'retired', 'unemployed', 'none']);
  const COMPATIBILITY = Object.freeze({
    guard: ['guard-post', 'barracks', 'watch', 'keep'],
    blacksmith: ['smithy', 'forge', 'workshop'],
    smith: ['smithy', 'forge', 'workshop'],
    innkeeper: ['inn', 'tavern'],
    barkeep: ['inn', 'tavern'],
    merchant: ['market', 'shop', 'trade', 'inn'],
    shopkeeper: ['shop', 'market', 'trade'],
    healer: ['healer', 'clinic', 'temple'],
    priest: ['temple', 'shrine'],
    artisan: ['workshop', 'craft'],
    carpenter: ['workshop', 'carpenter'],
    mason: ['workshop', 'mason'],
    baker: ['bakery', 'oven', 'inn'],
    cook: ['inn', 'tavern', 'kitchen'],
    stablehand: ['stable'],
    clerk: ['hall', 'office', 'market'],
    administrator: ['hall', 'office'],
    militia: ['guard-post', 'barracks', 'watch']
  });

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function canonicalSeed(seedInput) {
    if (Game.WorldCoordinates?.canonicalSeed) return Game.WorldCoordinates.canonicalSeed(seedInput);
    return String(seedInput ?? Game.State?.world?.seed ?? '');
  }

  function stableHash(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-');
  }

  function buildingTokens(building) {
    const tokens = [building?.type, building?.role, building?.function, building?.category, building?.name]
      .map(normalized)
      .filter(Boolean);
    return new Set(tokens.flatMap((token) => token.split(/[^a-z0-9-]+/).filter(Boolean).concat(token)));
  }

  function capacityFor(building) {
    const explicit = Number(building?.workerCapacity ?? building?.capacity?.workers);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;
    const rooms = Array.isArray(building?.rooms) ? building.rooms.length : 0;
    const area = Math.max(1, Number(building?.width || 0) * Number(building?.height || 0));
    if (rooms > 0) return Math.max(2, Math.min(8, rooms * 2));
    if (area >= 100) return 4;
    return 2;
  }

  function professionOf(person) {
    return normalized(person?.currentProfession || person?.profession || person?.occupation || person?.role || 'none');
  }

  function compatibilityKeys(profession) {
    return COMPATIBILITY[profession] || [profession];
  }

  function isCompatible(building, profession) {
    if (!building || !profession || OUTDOOR_PROFESSIONS.has(profession) || NON_WORKING.has(profession)) return false;
    const tokens = buildingTokens(building);
    return compatibilityKeys(profession).some((key) => tokens.has(normalized(key)));
  }

  function stableCharacterId(person) {
    return String(person?.id ?? person?.worldIdentity ?? person?.characterId ?? '');
  }

  function chooseCompatibleBuilding(seed, person, buildings, occupancy) {
    const profession = professionOf(person);
    const compatible = buildings
      .filter((building) => isCompatible(building, profession))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!compatible.length) return null;
    const start = stableHash(`${seed}|${stableCharacterId(person)}|${profession}|workplace`) % compatible.length;
    for (let offset = 0; offset < compatible.length; offset += 1) {
      const building = compatible[(start + offset) % compatible.length];
      const used = occupancy.get(building.id) || 0;
      if (used < capacityFor(building)) return building;
    }
    return null;
  }

  function assign(seedInput, village, residentsInput) {
    if (!village || !Array.isArray(village.buildings)) throw new TypeError('Authoritative village buildings are required.');
    const seed = canonicalSeed(seedInput);
    const population = Array.isArray(residentsInput) ? residentsInput :
      (Array.isArray(village.population) ? village.population : []);
    const buildings = village.buildings;
    const occupancy = new Map();
    const assignments = [];

    for (const person of population.slice().sort((a, b) => stableCharacterId(a).localeCompare(stableCharacterId(b)))) {
      const id = stableCharacterId(person);
      if (!id) throw new Error('Workplace assignment requires stable character identity.');
      const profession = professionOf(person);
      const baseIdentity = Game.CharacterIdentity?.generateBaseIdentity?.(seed, id, {
        baseProfession: normalized(person?.baseProfession || person?.occupation || person?.profession || 'villager') || 'villager'
      });

      if (OUTDOOR_PROFESSIONS.has(profession)) {
        assignments.push({
          id,
          authority: 'simulation',
          profession,
          baseProfession: baseIdentity?.baseProfession || normalized(person?.baseProfession || profession),
          workplaceKind: 'outdoor-worksite-required',
          workplaceBuildingId: null,
          capacitySlot: null
        });
        continue;
      }

      if (NON_WORKING.has(profession)) {
        assignments.push({
          id,
          authority: 'simulation',
          profession,
          baseProfession: baseIdentity?.baseProfession || normalized(person?.baseProfession || profession),
          workplaceKind: 'non-working',
          workplaceBuildingId: null,
          capacitySlot: null
        });
        continue;
      }

      const building = chooseCompatibleBuilding(seed, person, buildings, occupancy);
      if (!building) {
        assignments.push({
          id,
          authority: 'simulation',
          profession,
          baseProfession: baseIdentity?.baseProfession || normalized(person?.baseProfession || profession),
          workplaceKind: 'unassigned-incompatible-or-full',
          workplaceBuildingId: null,
          capacitySlot: null
        });
        continue;
      }

      const slot = occupancy.get(building.id) || 0;
      occupancy.set(building.id, slot + 1);
      assignments.push({
        id,
        authority: 'simulation',
        profession,
        baseProfession: baseIdentity?.baseProfession || normalized(person?.baseProfession || profession),
        workplaceKind: 'building',
        workplaceBuildingId: building.id,
        capacitySlot: slot,
        workplaceCapacity: capacityFor(building),
        homeBuildingId: person.homeBuildingId || null
      });
    }

    return deepFreeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      persistenceModel: 'seed+stable-character+authoritative-building-derived',
      assignments,
      buildingOccupancy: Object.fromEntries(Array.from(occupancy.entries()).sort(([a], [b]) => String(a).localeCompare(String(b))))
    });
  }

  function resolveVillage(seedInput) {
    const seed = canonicalSeed(seedInput);
    const world = Game.State?.world;
    if (world?.originVillage) return world.originVillage;
    return Game.SpatialWorld?.generateOriginVillage?.(seed)?.village || null;
  }

  function capture(seedInput) {
    const seed = canonicalSeed(seedInput);
    const village = resolveVillage(seed);
    if (!village) return null;
    const residency = Game.NPCResidency?.captureAt?.(Game.GameTime?.capture?.()?.totalGameMinutes || 0, seed, village);
    const residents = residency?.residents?.map((resident) => {
      const source = village.population?.find((person) => person.id === resident.id) || {};
      return { ...source, ...resident };
    }) || village.population || [];
    return clone(assign(seed, village, residents));
  }

  function sync() {
    const world = Game.State?.world;
    if (!world) return false;
    const snapshot = capture(world.seed);
    if (!snapshot) return false;
    world.npcWorkplaces = deepFreeze(snapshot);
    return true;
  }

  Game.NPCWorkplaces = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    compatibility: COMPATIBILITY,
    outdoorProfessions: Object.freeze(Array.from(OUTDOOR_PROFESSIONS)),
    nonWorkingProfessions: Object.freeze(Array.from(NON_WORKING)),
    capacityFor,
    isCompatible,
    assign,
    capture,
    sync
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
})();