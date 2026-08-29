/* R04 / #258: deterministic resident versus transient NPC housing lifecycle. */
(function installNpcResidencyLifecycle() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-residency-v1';
  const REGION_X = 0;
  const REGION_Y = 0;
  const ENTITY_PREFIX = 'npc-residency:';
  const VISITOR_SCHEDULE = Object.freeze({
    arrivalStartMinute: 8 * 60,
    marketStartMinute: 9 * 60,
    departureStartMinute: 16 * 60,
    goneMinute: 17 * 60
  });
  let timer = null;

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

  function pointKey(point) {
    return `${Number(point.row)},${Number(point.col)}`;
  }

  function clonePoint(point) {
    return { row: Number(point.row), col: Number(point.col) };
  }

  function insideRegion(point, size = 100) {
    return Number.isInteger(point?.row) && Number.isInteger(point?.col) &&
      point.row >= 0 && point.col >= 0 && point.row < size && point.col < size;
  }

  function homeCapacity(building) {
    const rooms = Array.isArray(building?.rooms) ? building.rooms.length : 0;
    return Math.max(2, rooms * 2);
  }

  function residencyDeltaMap(seed) {
    const deltas = Game.WorldDeltaPersistence?.capture?.(seed);
    const region = deltas?.regions?.find((entry) => entry.regionX === REGION_X && entry.regionY === REGION_Y);
    const output = new Map();
    for (const change of region?.entityChanges || []) {
      if (!change?.id?.startsWith(ENTITY_PREFIX) || change.removed === true) continue;
      if (change.state?.kind !== VERSION || typeof change.state?.homeBuildingId !== 'string') continue;
      output.set(change.id.slice(ENTITY_PREFIX.length), change.state.homeBuildingId);
    }
    return output;
  }

  function buildResidents(seedInput, village) {
    const seed = canonicalSeed(seedInput);
    const buildings = Array.isArray(village?.buildings) ? village.buildings : [];
    const population = Array.isArray(village?.population) ? village.population : [];
    const buildingById = new Map(buildings.map((building) => [building.id, building]));
    const housing = buildings.filter((building) => building.role === 'housing' || building.type === 'home');
    if (!housing.length && population.length) throw new Error('Resident population requires authoritative housing buildings.');

    const overrides = residencyDeltaMap(seed);
    const occupancy = new Map();
    const residents = [];

    for (const person of population) {
      const baseHome = buildingById.get(person.homeBuildingId);
      if (!baseHome || (baseHome.role !== 'housing' && baseHome.type !== 'home')) {
        throw new Error(`Persistent local NPC ${String(person.id)} has no valid authoritative home.`);
      }
      const requested = buildingById.get(overrides.get(person.id));
      const requestedIsHousing = requested && (requested.role === 'housing' || requested.type === 'home');
      const chosen = requestedIsHousing ? requested : baseHome;
      const used = occupancy.get(chosen.id) || 0;
      const finalHome = used < homeCapacity(chosen) ? chosen : baseHome;
      const finalUsed = occupancy.get(finalHome.id) || 0;
      if (finalUsed >= homeCapacity(finalHome)) {
        throw new Error(`Authoritative home capacity exceeded for ${String(finalHome.id)}.`);
      }
      occupancy.set(finalHome.id, finalUsed + 1);
      residents.push({
        id: person.id,
        authority: 'simulation',
        residencyType: 'resident',
        persistentLocal: true,
        transient: false,
        homeBuildingId: finalHome.id,
        homeTile: clonePoint(person.homeTile || finalHome.entrance || finalHome),
        occupation: person.occupation,
        regionX: Number(person.regionX || 0),
        regionY: Number(person.regionY || 0),
        persistenceKey: `${ENTITY_PREFIX}${person.id}`
      });
    }

    return residents;
  }

  function sortedRoadTiles(village) {
    return (Array.isArray(village?.roadTiles) ? village.roadTiles : [])
      .map(clonePoint)
      .filter((point) => insideRegion(point, Number(village?.regionSize || 100)))
      .sort((a, b) => a.row - b.row || a.col - b.col);
  }

  function gateCandidates(roads, size) {
    const edge = 2;
    const candidates = roads.filter((point) =>
      point.row <= edge || point.col <= edge || point.row >= size - 1 - edge || point.col >= size - 1 - edge
    );
    return candidates.length ? candidates : roads;
  }

  function manhattan(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
  }

  function chooseGates(village, seed) {
    const size = Number(village?.regionSize || 100);
    const roads = sortedRoadTiles(village);
    if (!roads.length) throw new Error('Transient visitor lifecycle requires an authoritative village road network.');
    const candidates = gateCandidates(roads, size);
    const entry = candidates[stableHash(`${seed}|visitor-entry`) % candidates.length];
    const exit = candidates.slice().sort((a, b) =>
      manhattan(b, entry) - manhattan(a, entry) || a.row - b.row || a.col - b.col
    )[0] || entry;
    return { entry: clonePoint(entry), exit: clonePoint(exit), roads };
  }

  function nearestRoad(roads, origin) {
    return roads.slice().sort((a, b) =>
      manhattan(a, origin) - manhattan(b, origin) || a.row - b.row || a.col - b.col
    )[0] || clonePoint(origin);
  }

  function roadPath(roads, start, end) {
    const allowed = new Set(roads.map(pointKey));
    allowed.add(pointKey(start));
    allowed.add(pointKey(end));
    const queue = [clonePoint(start)];
    const seen = new Set([pointKey(start)]);
    const parent = new Map();
    const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    let goal = null;

    while (queue.length) {
      const current = queue.shift();
      if (pointKey(current) === pointKey(end)) {
        goal = current;
        break;
      }
      for (const [dr, dc] of directions) {
        const next = { row: current.row + dr, col: current.col + dc };
        const key = pointKey(next);
        if (!allowed.has(key) || seen.has(key)) continue;
        seen.add(key);
        parent.set(key, current);
        queue.push(next);
      }
    }

    if (!goal) return [clonePoint(start), clonePoint(end)];
    const output = [];
    let cursor = goal;
    while (cursor) {
      output.push(clonePoint(cursor));
      cursor = parent.get(pointKey(cursor)) || null;
    }
    output.reverse();
    return output;
  }

  function buildTransientVisitor(seedInput, village) {
    const seed = canonicalSeed(seedInput);
    const buildings = Array.isArray(village?.buildings) ? village.buildings : [];
    const market = buildings.find((building) => building.role === 'trade') ||
      buildings.find((building) => building.type === 'market') || buildings[0];
    if (!market) throw new Error('Transient visitor lifecycle requires an authoritative temporary-activity location.');

    const { entry, exit, roads } = chooseGates(village, seed);
    const marketRoad = nearestRoad(roads, market.entrance || market);
    const entryToMarket = roadPath(roads, entry, marketRoad);
    const marketToExit = roadPath(roads, marketRoad, exit);
    const id = `transient:${encodeURIComponent(seed)}:traveling-merchant:0`;
    const names = ['Caro Venn', 'Dara Quill', 'Merek Holt', 'Siva Dorn'];

    return {
      id,
      authority: 'simulation',
      name: names[stableHash(`${seed}|visitor-name`) % names.length],
      occupation: 'traveling-merchant',
      residencyType: 'transient',
      persistentLocal: false,
      transient: true,
      transientReason: 'scheduled-day-visitor',
      homeBuildingId: null,
      temporaryActivityBuildingId: market.id,
      entry,
      exit,
      marketRoad,
      routes: { entryToMarket, marketToExit },
      schedule: { ...VISITOR_SCHEDULE }
    };
  }

  function pathPoint(path, progress) {
    if (!Array.isArray(path) || !path.length) return null;
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
    const index = Math.min(path.length - 1, Math.floor(clamped * path.length));
    return clonePoint(path[index]);
  }

  function transientStateAt(totalGameMinutes, visitor) {
    const total = Math.max(0, Number(totalGameMinutes) || 0);
    const wholeMinute = Math.floor(total);
    const dayIndex = Math.floor(wholeMinute / 1440);
    const minuteOfDay = wholeMinute % 1440;
    const schedule = visitor.schedule;
    let phase = 'outside';
    let activity = 'traveling-outside-region';
    let position = null;
    let presentInVillage = false;

    if (minuteOfDay >= schedule.arrivalStartMinute && minuteOfDay < schedule.marketStartMinute) {
      phase = 'entering';
      activity = 'arriving-for-market';
      presentInVillage = true;
      position = pathPoint(visitor.routes.entryToMarket,
        (minuteOfDay - schedule.arrivalStartMinute) / (schedule.marketStartMinute - schedule.arrivalStartMinute));
    } else if (minuteOfDay >= schedule.marketStartMinute && minuteOfDay < schedule.departureStartMinute) {
      phase = 'visiting';
      activity = 'temporary-market-work';
      presentInVillage = true;
      position = clonePoint(visitor.marketRoad);
    } else if (minuteOfDay >= schedule.departureStartMinute && minuteOfDay < schedule.goneMinute) {
      phase = 'leaving';
      activity = 'departing-village';
      presentInVillage = true;
      position = pathPoint(visitor.routes.marketToExit,
        (minuteOfDay - schedule.departureStartMinute) / (schedule.goneMinute - schedule.departureStartMinute));
    }

    return {
      ...visitor,
      day: dayIndex + 1,
      minuteOfDay,
      phase,
      activity,
      presentInVillage,
      row: position?.row ?? null,
      col: position?.col ?? null
    };
  }

  function resolveVillage(seedInput, explicitVillage) {
    if (explicitVillage) return explicitVillage;
    const seed = canonicalSeed(seedInput);
    const world = Game.State?.world;
    if (world?.originVillage && world?.originBaseState?.seed === seed) return world.originVillage;
    const generated = Game.SpatialWorld?.generateOriginVillage?.(seed);
    return generated?.village || null;
  }

  function captureAt(totalGameMinutes, seedInput, explicitVillage) {
    const seed = canonicalSeed(seedInput);
    const village = resolveVillage(seed, explicitVillage);
    if (!village) throw new Error('NPC residency lifecycle requires the authoritative origin village.');
    const residents = buildResidents(seed, village);
    const visitor = buildTransientVisitor(seed, village);
    const transientVisitors = [transientStateAt(totalGameMinutes, visitor)];
    return deepFreeze({
      version: VERSION,
      authority: 'simulation',
      seed,
      regionX: REGION_X,
      regionY: REGION_Y,
      persistenceModel: 'seed-derived-base+world-delta-home-overrides',
      residentCount: residents.length,
      residents,
      transientVisitors,
      activeTransientVisitors: transientVisitors.filter((entry) => entry.presentInVillage).map((entry) => entry.id)
    });
  }

  function sync() {
    const world = Game.State?.world;
    const time = Game.GameTime?.capture?.();
    if (!world || !time || !Game.SpatialWorld?.generateOriginVillage) return false;
    try {
      const snapshot = captureAt(time.totalGameMinutes, world.seed);
      world.npcResidency = snapshot;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function capture() {
    sync();
    return clone(Game.State?.world?.npcResidency || null);
  }

  function recordResidentHome(npcId, homeBuildingId) {
    if (typeof npcId !== 'string' || !npcId) throw new TypeError('Resident NPC id is required.');
    if (typeof homeBuildingId !== 'string' || !homeBuildingId) throw new TypeError('Authoritative home building id is required.');
    const world = Game.State?.world;
    const seed = canonicalSeed(world?.seed);
    const village = resolveVillage(seed);
    if (!village) throw new Error('Authoritative origin village is unavailable.');
    const person = village.population?.find((entry) => entry.id === npcId);
    if (!person) throw new Error('Only persistent local NPCs can receive a resident-home override.');
    const target = village.buildings?.find((entry) => entry.id === homeBuildingId);
    if (!target || (target.role !== 'housing' && target.type !== 'home')) throw new Error('Resident home override must reference authoritative housing.');

    const current = captureAt(Game.GameTime?.capture?.()?.totalGameMinutes || 0, seed, village);
    const usedByOthers = current.residents.filter((entry) => entry.id !== npcId && entry.homeBuildingId === homeBuildingId).length;
    if (usedByOthers >= homeCapacity(target)) throw new Error('Resident home override exceeds deterministic housing capacity.');
    if (!Game.WorldDeltaPersistence?.recordEntityDelta) throw new Error('World delta persistence is unavailable.');

    Game.WorldDeltaPersistence.recordEntityDelta(REGION_X, REGION_Y, `${ENTITY_PREFIX}${npcId}`, {
      kind: VERSION,
      homeBuildingId
    });
    sync();
    return capture();
  }

  function clearResidentHomeOverride(npcId) {
    const world = Game.State?.world;
    if (!world || !Game.WorldDeltaPersistence?.recordEntityDelta) return false;
    Game.WorldDeltaPersistence.recordEntityDelta(REGION_X, REGION_Y, `${ENTITY_PREFIX}${npcId}`, {}, true);
    sync();
    return true;
  }

  function start() {
    if (timer !== null) return;
    sync();
    timer = window.setInterval(sync, 1000);
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  Game.NPCResidency = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    schedule: VISITOR_SCHEDULE,
    buildResidents,
    buildTransientVisitor,
    transientStateAt,
    captureAt,
    capture,
    sync,
    recordResidentHome,
    clearResidentHomeOverride,
    start,
    stop
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
