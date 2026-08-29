/*
  Admin #233 / R04 #235: canonical 100x100 thematic-region and seeded settlement spatial contract.

  This compatibility layer upgrades the legacy R02 coordinate-addressable contracts without
  rewriting their historical implementation. Simulation remains authoritative. Presentation,
  rendering and device state cannot choose region themes, building positions, roads, homes,
  workplaces or resident identities.
*/
(function installSpatialWorld100Contract() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const RNG = Game.RNG;
  const Coordinates = Game.WorldCoordinates;
  const Config = Game.Config || {};
  const legacyRegionTerrain = Game.RegionTerrain;

  if (!RNG || !Coordinates || !legacyRegionTerrain) return;

  const VERSION = 'admin-100x100-spatial-v1';
  const REGION_SIZE = 100;
  const CENTER = Object.freeze({ row: 50, col: 50 });
  const MAIN_ROAD_HALF_WIDTH = 1;
  const LARGE_CITY_THRESHOLD = 0.10;
  const THEME_NAMES = Object.freeze(['village', 'town', 'forest', 'coast', 'large-city']);

  const BUILDING_SPECS = Object.freeze([
    Object.freeze({ type: 'well', role: 'landmark', width: 4, height: 4, zone: 'center', passable: true }),
    Object.freeze({ type: 'village_hall', role: 'landmark', width: 12, height: 10, zone: 'center' }),
    Object.freeze({ type: 'inn', role: 'lodging', width: 14, height: 10, zone: 'center' }),
    Object.freeze({ type: 'bakery', role: 'food', width: 10, height: 8, zone: 'center' }),
    Object.freeze({ type: 'market', role: 'trade', width: 14, height: 12, zone: 'center', passable: true }),
    Object.freeze({ type: 'smithy', role: 'production', width: 10, height: 10, zone: 'edge' }),
    Object.freeze({ type: 'workshop', role: 'labor', width: 10, height: 10, zone: 'edge' }),
    Object.freeze({ type: 'guard_post', role: 'guard', width: 8, height: 8, zone: 'edge' }),
    Object.freeze({ type: 'mill', role: 'production', width: 10, height: 10, zone: 'edge' }),
    Object.freeze({ type: 'farmstead', role: 'agriculture', width: 12, height: 10, zone: 'edge' }),
    ...Array.from({ length: 12 }, (_, index) => Object.freeze({
      type: 'home', role: 'housing', width: 10, height: 10, zone: 'housing', housingIndex: index
    }))
  ]);

  const OCCUPATIONS = Object.freeze([
    'innkeeper', 'baker', 'trader', 'blacksmith', 'carpenter', 'laborer',
    'farmer', 'farmer', 'herder', 'guard', 'guard', 'guard',
    'miller', 'woodcutter', 'healer', 'villager', 'farmer', 'laborer',
    'trader', 'carpenter', 'villager', 'herder', 'guard', 'villager'
  ]);
  const GIVEN_NAMES = Object.freeze(['Alda', 'Borin', 'Cera', 'Dain', 'Elin', 'Fara', 'Garr', 'Hale', 'Iven', 'Jora', 'Kell', 'Lysa', 'Mara', 'Noll', 'Orin', 'Pera', 'Rian', 'Sela', 'Tarn', 'Vera', 'Wren', 'Yara', 'Toren', 'Mira']);
  const FAMILY_NAMES = Object.freeze(['Ash', 'Brook', 'Dale', 'Fenn', 'Field', 'Forge', 'Glen', 'Hart', 'Moor', 'Oak', 'Reed', 'Stone', 'Vale', 'Ward']);
  const VILLAGE_PREFIX = Object.freeze(['Alder', 'Briar', 'Clear', 'Dawn', 'Elder', 'Fair', 'Green', 'High', 'Oak', 'River', 'Stone', 'Willow']);
  const VILLAGE_SUFFIX = Object.freeze(['bridge', 'brook', 'ford', 'haven', 'mead', 'stead', 'vale', 'wick', 'wood']);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function canonicalSeed(seedInput) {
    return Coordinates.canonicalSeed(seedInput);
  }

  function stream(seed, key, ...parts) {
    return RNG.createStream(seed, VERSION, key, ...parts);
  }

  function pick(seed, key, values, ...parts) {
    const random = stream(seed, key, ...parts)();
    return values[Math.min(values.length - 1, Math.floor(random * values.length))];
  }

  function integer(seed, key, min, max, ...parts) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high <= low) return low;
    return low + Math.floor(stream(seed, key, ...parts)() * (high - low + 1));
  }

  function key(row, col) { return `${row},${col}`; }
  function inside(row, col) { return row >= 0 && row < REGION_SIZE && col >= 0 && col < REGION_SIZE; }
  function manhattan(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }

  function macroCell(value) { return Math.floor(Number(value) / 2); }

  function describeTheme(seedInput, regionXInput, regionYInput) {
    const seed = canonicalSeed(seedInput);
    const x = Coordinates.normalizeCoordinate(regionXInput, 'region x');
    const y = Coordinates.normalizeCoordinate(regionYInput, 'region y');
    const region = Coordinates.describeRegion(seed, x, y);
    const macroX = macroCell(x);
    const macroY = macroCell(y);
    const districtX = x - macroX * 2;
    const districtY = y - macroY * 2;
    const originMacro = macroX === 0 && macroY === 0;
    const cityRoll = stream(seed, 'large-city-macro', macroX, macroY)();

    if (!originMacro && cityRoll < LARGE_CITY_THRESHOLD) {
      return deepFreeze({
        authority: 'simulation',
        version: VERSION,
        region,
        theme: 'large-city',
        settlementId: `large-city:${encodeURIComponent(seed)}:${macroX}:${macroY}`,
        regionFootprint: {
          anchorRegionX: macroX * 2,
          anchorRegionY: macroY * 2,
          regionsWide: 2,
          regionsHigh: 2,
          regionCount: 4,
          totalLogicalTiles: 4 * REGION_SIZE * REGION_SIZE
        },
        district: { x: districtX, y: districtY, index: districtY * 2 + districtX }
      });
    }

    if (x === 0 && y === 0) {
      return deepFreeze({
        authority: 'simulation', version: VERSION, region, theme: 'village',
        settlementId: `starter-village:${encodeURIComponent(seed)}`,
        regionFootprint: { anchorRegionX: 0, anchorRegionY: 0, regionsWide: 1, regionsHigh: 1, regionCount: 1, totalLogicalTiles: REGION_SIZE * REGION_SIZE }
      });
    }

    const roll = stream(seed, 'region-theme', x, y)();
    const theme = roll < 0.25 ? 'village' : roll < 0.48 ? 'town' : roll < 0.74 ? 'forest' : 'coast';
    return deepFreeze({
      authority: 'simulation', version: VERSION, region, theme,
      settlementId: theme === 'village' || theme === 'town' ? `${theme}:${region.id}` : null,
      regionFootprint: { anchorRegionX: x, anchorRegionY: y, regionsWide: 1, regionsHigh: 1, regionCount: 1, totalLogicalTiles: REGION_SIZE * REGION_SIZE }
    });
  }

  function cloneBaseTile(tile, theme, localRow, localCol, seed) {
    const result = { ...tile, theme };
    if (theme === 'forest' && !tile.water && tile.type !== 'mountain' && !tile.road) {
      const density = RNG.hashNoise(seed, tile.worldY, tile.worldX, `${VERSION}|forest-density`);
      if (density > 0.30) {
        result.type = 'forest';
        result.road = false;
        result.water = false;
      }
    } else if (theme === 'coast') {
      const wave = Math.floor((RNG.hashNoise(seed, localRow, 0, `${VERSION}|coast-wave`) - 0.5) * 10);
      const coastStart = 72 + wave;
      if (localCol >= coastStart) {
        result.type = 'lake';
        result.water = true;
        result.road = false;
      } else if (localCol >= coastStart - 5 && result.type !== 'mountain') {
        result.type = 'dirt';
        result.water = false;
        result.road = false;
      }
    }
    return Object.freeze(result);
  }

  function generateRegion(seedInput, regionXInput, regionYInput) {
    const seed = canonicalSeed(seedInput);
    const theme = describeTheme(seed, regionXInput, regionYInput);
    const descriptor = theme.region;
    const originWorldX = descriptor.x * REGION_SIZE;
    const originWorldY = descriptor.y * REGION_SIZE;
    const tiles = [];
    const counts = { grass: 0, dirt: 0, forest: 0, lake: 0, river: 0, road: 0, mountain: 0, settlement: 0 };

    for (let row = 0; row < REGION_SIZE; row += 1) {
      const line = [];
      for (let col = 0; col < REGION_SIZE; col += 1) {
        const base = legacyRegionTerrain.sampleTile(seed, originWorldX + col, originWorldY + row);
        const tile = cloneBaseTile(base, theme.theme, row, col, seed);
        counts[tile.type] = (counts[tile.type] || 0) + 1;
        line.push(tile);
      }
      tiles.push(Object.freeze(line));
    }

    return deepFreeze({
      schemaVersion: 2,
      generatorVersion: VERSION,
      authority: 'simulation',
      hasGameplayFiniteBoundary: false,
      regionSize: REGION_SIZE,
      region: descriptor,
      theme,
      originWorldX,
      originWorldY,
      counts,
      tiles
    });
  }

  function fingerprint(region) {
    if (!region || !Array.isArray(region.tiles)) throw new TypeError('region base state is required.');
    const prefix = region.theme?.theme || 'unknown';
    return `${prefix}:` + region.tiles.map((row) => row.map((tile) => String(tile.type || '?')[0]).join('')).join('|');
  }

  Game.RegionTerrain = Object.freeze({
    schemaVersion: 2,
    generatorVersion: VERSION,
    authority: 'simulation',
    hasGameplayFiniteBoundary: false,
    regionSize: REGION_SIZE,
    sampleTile: legacyRegionTerrain.sampleTile,
    generateRegion,
    fingerprint
  });

  function makeMatrix(initial = false) {
    return Array.from({ length: REGION_SIZE }, () => Array.from({ length: REGION_SIZE }, () => initial));
  }

  function markRoad(roads, row, col) {
    if (inside(row, col)) roads.add(key(row, col));
  }

  function seedMainRoads(roads) {
    for (let offset = -MAIN_ROAD_HALF_WIDTH; offset <= MAIN_ROAD_HALF_WIDTH; offset += 1) {
      for (let col = 2; col < REGION_SIZE - 2; col += 1) markRoad(roads, CENTER.row + offset, col);
      for (let row = 2; row < REGION_SIZE - 2; row += 1) markRoad(roads, row, CENTER.col + offset);
    }
  }

  function footprintCells(footprint, padding = 0) {
    const cells = [];
    const row0 = footprint.row - padding;
    const col0 = footprint.col - padding;
    const row1 = footprint.row + footprint.height - 1 + padding;
    const col1 = footprint.col + footprint.width - 1 + padding;
    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) if (inside(row, col)) cells.push({ row, col });
    }
    return cells;
  }

  function overlapsReserved(reserved, footprint, padding = 2) {
    for (const cell of footprintCells(footprint, padding)) if (reserved[cell.row][cell.col]) return true;
    return false;
  }

  function overlapsRoad(roads, footprint, padding = 1) {
    for (const cell of footprintCells(footprint, padding)) if (roads.has(key(cell.row, cell.col))) return true;
    return false;
  }

  function reserveFootprint(reserved, footprint) {
    for (const cell of footprintCells(footprint, 0)) reserved[cell.row][cell.col] = true;
  }

  function releaseFootprint(reserved, footprint) {
    for (const cell of footprintCells(footprint, 0)) reserved[cell.row][cell.col] = false;
  }

  function housingBounds(index, width, height) {
    const quadrant = index % 4;
    if (quadrant === 0) return { r0: 5, r1: 38 - height, c0: 5, c1: 38 - width };
    if (quadrant === 1) return { r0: 5, r1: 38 - height, c0: 62, c1: 95 - width };
    if (quadrant === 2) return { r0: 62, r1: 95 - height, c0: 5, c1: 38 - width };
    return { r0: 62, r1: 95 - height, c0: 62, c1: 95 - width };
  }

  function zoneBounds(spec, index) {
    if (spec.zone === 'housing') return housingBounds(spec.housingIndex ?? index, spec.width, spec.height);
    if (spec.zone === 'center') return { r0: 28, r1: 72 - spec.height, c0: 28, c1: 72 - spec.width };
    const side = index % 4;
    if (side === 0) return { r0: 6, r1: 25, c0: 28, c1: 72 - spec.width };
    if (side === 1) return { r0: 72, r1: 94 - spec.height, c0: 28, c1: 72 - spec.width };
    if (side === 2) return { r0: 28, r1: 72 - spec.height, c0: 6, c1: 25 };
    return { r0: 28, r1: 72 - spec.height, c0: 72, c1: 94 - spec.width };
  }

  function makeRooms(buildingId, footprint, isHome) {
    const innerRow = footprint.row + 1;
    const innerCol = footprint.col + 1;
    const innerWidth = Math.max(2, footprint.width - 2);
    const innerHeight = Math.max(2, footprint.height - 2);
    if (isHome) {
      const leftWidth = Math.max(2, Math.floor(innerWidth / 2));
      return [
        { id: `${buildingId}:room:0`, row: innerRow, col: innerCol, width: leftWidth, height: innerHeight, purpose: 'living-sleeping' },
        { id: `${buildingId}:room:1`, row: innerRow, col: innerCol + leftWidth, width: Math.max(2, innerWidth - leftWidth), height: innerHeight, purpose: 'cooking-storage' }
      ];
    }
    return [{ id: `${buildingId}:room:0`, row: innerRow, col: innerCol, width: innerWidth, height: innerHeight, purpose: 'primary' }];
  }

  function chooseEntrance(footprint) {
    const centerRow = footprint.row + Math.floor(footprint.height / 2);
    const centerCol = footprint.col + Math.floor(footprint.width / 2);
    const dr = CENTER.row - centerRow;
    const dc = CENTER.col - centerCol;
    if (Math.abs(dc) >= Math.abs(dr)) {
      if (dc >= 0) return { row: centerRow, col: footprint.col + footprint.width };
      return { row: centerRow, col: footprint.col - 1 };
    }
    if (dr >= 0) return { row: footprint.row + footprint.height, col: centerCol };
    return { row: footprint.row - 1, col: centerCol };
  }

  function finalizeBuilding(region, spec, index, reserved, footprint) {
    const entrance = chooseEntrance(footprint);
    if (!inside(entrance.row, entrance.col)) return null;
    const id = `${region.id}:building:${index}:${spec.type}`;
    reserveFootprint(reserved, footprint);
    return {
      id,
      authority: 'simulation',
      type: spec.type,
      role: spec.role,
      row: entrance.row,
      col: entrance.col,
      footprint,
      entrance,
      passable: spec.passable === true,
      rooms: makeRooms(id, footprint, spec.type === 'home')
    };
  }

  function placeBuilding(seed, region, spec, index, reserved, roads) {
    const bounds = zoneBounds(spec, index);
    const r1 = Math.max(bounds.r0, bounds.r1);
    const c1 = Math.max(bounds.c0, bounds.c1);
    const validAt = (row, col) => {
      const footprint = { row, col, width: spec.width, height: spec.height };
      if (overlapsReserved(reserved, footprint, 2)) return null;
      if (!spec.passable && overlapsRoad(roads, footprint, 1)) return null;
      return finalizeBuilding(region, spec, index, reserved, footprint);
    };

    for (let attempt = 0; attempt < 240; attempt += 1) {
      const row = integer(seed, `building-${index}-row`, bounds.r0, r1, region.x, region.y, attempt);
      const col = integer(seed, `building-${index}-col`, bounds.c0, c1, region.x, region.y, attempt);
      const building = validAt(row, col);
      if (building) return building;
    }

    const rowCount = r1 - bounds.r0 + 1;
    const colCount = c1 - bounds.c0 + 1;
    const total = rowCount * colCount;
    const offset = integer(seed, `building-${index}-fallback-offset`, 0, Math.max(0, total - 1), region.x, region.y);
    for (let step = 0; step < total; step += 1) {
      const candidate = (offset + step) % total;
      const row = bounds.r0 + Math.floor(candidate / colCount);
      const col = bounds.c0 + (candidate % colCount);
      const building = validAt(row, col);
      if (building) return building;
    }

    throw new Error(`Unable to place deterministic building ${spec.type} in 100x100 origin village.`);
  }

  function buildingFootprintCandidates(seed, region, spec, index) {
    const bounds = zoneBounds(spec, index);
    const r1 = Math.max(bounds.r0, bounds.r1);
    const c1 = Math.max(bounds.c0, bounds.c1);
    const candidates = [];
    const seen = new Set();
    const addCandidate = (row, col) => {
      const candidateKey = key(row, col);
      if (seen.has(candidateKey)) return;
      seen.add(candidateKey);
      candidates.push({ row, col, width: spec.width, height: spec.height });
    };

    for (let attempt = 0; attempt < 240; attempt += 1) {
      addCandidate(
        integer(seed, `building-${index}-row`, bounds.r0, r1, region.x, region.y, attempt),
        integer(seed, `building-${index}-col`, bounds.c0, c1, region.x, region.y, attempt)
      );
    }

    const rowCount = r1 - bounds.r0 + 1;
    const colCount = c1 - bounds.c0 + 1;
    const total = rowCount * colCount;
    const offset = integer(seed, `building-${index}-fallback-offset`, 0, Math.max(0, total - 1), region.x, region.y);
    for (let step = 0; step < total; step += 1) {
      const candidate = (offset + step) % total;
      addCandidate(bounds.r0 + Math.floor(candidate / colCount), bounds.c0 + (candidate % colCount));
    }
    return candidates;
  }

  function placeHousingBuildings(seed, region, reserved, roads) {
    const homeIndexes = BUILDING_SPECS
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) => spec.zone === 'housing')
      .map(({ index }) => index);
    const placements = new Map();

    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      const indexes = homeIndexes.filter((index) => ((BUILDING_SPECS[index].housingIndex ?? index) % 4) === quadrant);
      const candidatesByIndex = new Map(indexes.map((index) => [
        index,
        buildingFootprintCandidates(seed, region, BUILDING_SPECS[index], index)
      ]));

      const solve = (position) => {
        if (position >= indexes.length) return true;
        const index = indexes[position];
        const spec = BUILDING_SPECS[index];
        for (const footprint of candidatesByIndex.get(index) || []) {
          if (overlapsReserved(reserved, footprint, 2)) continue;
          if (!spec.passable && overlapsRoad(roads, footprint, 1)) continue;
          const entrance = chooseEntrance(footprint);
          if (!inside(entrance.row, entrance.col)) continue;

          reserveFootprint(reserved, footprint);
          placements.set(index, footprint);
          if (solve(position + 1)) return true;
          placements.delete(index);
          releaseFootprint(reserved, footprint);
        }
        return false;
      };

      if (!solve(0)) {
        throw new Error(`Unable to place deterministic housing quadrant ${quadrant} in 100x100 origin village.`);
      }
    }

    return homeIndexes.map((index) => {
      const spec = BUILDING_SPECS[index];
      const footprint = placements.get(index);
      const building = footprint ? finalizeBuilding(region, spec, index, reserved, footprint) : null;
      if (!building) throw new Error(`Unable to finalize deterministic building ${spec.type} in 100x100 origin village.`);
      return building;
    });
  }

  function nearestRoadTarget(roads, start) {
    let best = null;
    let bestDistance = Infinity;
    for (const text of roads) {
      const [rowText, colText] = text.split(',');
      const point = { row: Number(rowText), col: Number(colText) };
      const distance = manhattan(start, point);
      if (distance < bestDistance || (distance === bestDistance && key(point.row, point.col) < key(best?.row ?? 999, best?.col ?? 999))) {
        best = point;
        bestDistance = distance;
      }
    }
    return best;
  }

  function bfs(start, goalTest, blocked, allowedSet = null) {
    const queue = [start];
    const parent = new Map();
    const seen = new Set([key(start.row, start.col)]);
    const dirs = [[-1,0],[0,1],[1,0],[0,-1]];
    let goal = null;
    while (queue.length) {
      const current = queue.shift();
      if (goalTest(current)) { goal = current; break; }
      for (const [dr, dc] of dirs) {
        const next = { row: current.row + dr, col: current.col + dc };
        if (!inside(next.row, next.col)) continue;
        const nextKey = key(next.row, next.col);
        if (seen.has(nextKey)) continue;
        if (blocked[next.row][next.col] && nextKey !== key(start.row, start.col)) continue;
        if (allowedSet && !allowedSet.has(nextKey) && !goalTest(next)) continue;
        seen.add(nextKey);
        parent.set(nextKey, current);
        queue.push(next);
      }
    }
    if (!goal) return [];
    const path = [];
    let cursor = goal;
    while (cursor) {
      path.push(cursor);
      const previous = parent.get(key(cursor.row, cursor.col));
      cursor = previous || null;
    }
    path.reverse();
    return path;
  }

  function connectBuildingToRoad(building, roads, blocked) {
    const target = nearestRoadTarget(roads, building.entrance);
    if (!target) return [];
    const targetKey = key(target.row, target.col);
    const path = bfs(building.entrance, (point) => key(point.row, point.col) === targetKey, blocked);
    for (const point of path) roads.add(key(point.row, point.col));
    return path;
  }

  function roadPath(start, end, roads) {
    const startKey = key(start.row, start.col);
    const endKey = key(end.row, end.col);
    const allowed = new Set(roads);
    allowed.add(startKey);
    allowed.add(endKey);
    const emptyBlocked = makeMatrix(false);
    return bfs(start, (point) => key(point.row, point.col) === endKey, emptyBlocked, allowed);
  }

  function interiorPath(from, to) {
    const points = [{ row: from.row, col: from.col }];
    let row = from.row;
    let col = from.col;
    while (col !== to.col) { col += col < to.col ? 1 : -1; points.push({ row, col }); }
    while (row !== to.row) { row += row < to.row ? 1 : -1; points.push({ row, col }); }
    return points;
  }

  function combinePaths(...parts) {
    const output = [];
    for (const part of parts) {
      for (const point of part || []) {
        const previous = output[output.length - 1];
        if (!previous || previous.row !== point.row || previous.col !== point.col) output.push({ row: point.row, col: point.col });
      }
    }
    return output;
  }

  function nearestAvailableRoadTile(roads, origin, used) {
    const candidates = Array.from(roads).map((text) => {
      const [rowText, colText] = text.split(',');
      return { row: Number(rowText), col: Number(colText) };
    });
    candidates.sort((a, b) => manhattan(a, origin) - manhattan(b, origin) || a.row - b.row || a.col - b.col);
    for (const candidate of candidates) {
      const candidateKey = key(candidate.row, candidate.col);
      if (used.has(candidateKey)) continue;
      used.add(candidateKey);
      return candidate;
    }
    return { row: origin.row, col: origin.col };
  }

  function workRoleForOccupation(occupation) {
    const role = String(occupation || 'villager');
    if (role === 'innkeeper') return 'lodging';
    if (role === 'baker') return 'food';
    if (role === 'trader' || role === 'villager') return 'trade';
    if (role === 'blacksmith' || role === 'miller') return 'production';
    if (role === 'farmer' || role === 'herder') return 'agriculture';
    if (role === 'guard') return 'guard';
    if (role === 'healer') return 'landmark';
    return 'labor';
  }

  function residentHomeTile(home, residentSlot) {
    const room = home.rooms[residentSlot % home.rooms.length] || home.rooms[0];
    return {
      row: room.row + Math.min(room.height - 1, 1 + Math.floor(residentSlot / home.rooms.length)),
      col: room.col + Math.min(room.width - 1, 1)
    };
  }

  function generateOriginVillage(seedInput) {
    const seed = canonicalSeed(seedInput);
    const region = Coordinates.describeRegion(seed, 0, 0);
    const theme = describeTheme(seed, 0, 0);
    const terrain = generateRegion(seed, 0, 0);
    const reserved = makeMatrix(false);
    const roads = new Set();
    seedMainRoads(roads);

    const buildings = BUILDING_SPECS
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) => spec.zone !== 'housing')
      .map(({ spec, index }) => placeBuilding(seed, region, spec, index, reserved, roads));
    buildings.push(...placeHousingBuildings(seed, region, reserved, roads));
    const blocked = makeMatrix(false);
    for (const building of buildings) {
      if (building.passable) continue;
      for (const cell of footprintCells(building.footprint, 0)) blocked[cell.row][cell.col] = true;
    }

    // The anchor/well is building[0]. It is part of the same authoritative
    // Simulation-owned road network as every other required village structure.
    // Connect it before the remaining building connectors; do not create a
    // second/decorative road topology in the presentation layer.
    const anchorRoadConnection = connectBuildingToRoad(buildings[0], roads, blocked);
    if (!anchorRoadConnection.length) {
      throw new Error('Unable to connect origin-village anchor building to authoritative road network.');
    }

    const paths = [];
    for (let index = 1; index < buildings.length; index += 1) {
      const building = buildings[index];
      const points = connectBuildingToRoad(building, roads, blocked);
      paths.push({
        id: `${region.id}:path:${index - 1}`,
        authority: 'simulation',
        fromBuildingId: buildings[0].id,
        toBuildingId: building.id,
        points
      });
    }

    const homes = buildings.filter((building) => building.role === 'housing');
    const byRole = new Map();
    for (const building of buildings) {
      if (!byRole.has(building.role)) byRole.set(building.role, []);
      byRole.get(building.role).push(building);
    }

    const usedWorkTiles = new Set();
    const usedSocialTiles = new Set();
    // Social/public destinations are deterministic products of the generated
    // settlement, not of the protagonist or the village-center coordinate.
    const socialDestinations = buildings.filter((building) => building && building.entrance);
    const socialOffset = socialDestinations.length
      ? integer(seed, 'social-destination-offset', 0, socialDestinations.length - 1)
      : 0;
    const population = OCCUPATIONS.map((occupation, index) => {
      const home = homes[index % homes.length];
      const residentSlot = Math.floor(index / homes.length);
      const workRole = workRoleForOccupation(occupation);
      const workChoices = byRole.get(workRole) || byRole.get('trade') || [buildings[0]];
      const work = workChoices[index % workChoices.length];
      const homeTile = residentHomeTile(home, residentSlot);
      const workTile = nearestAvailableRoadTile(roads, work.entrance, usedWorkTiles);
      const socialDestination = socialDestinations.length
        ? socialDestinations[(socialOffset + index * 5) % socialDestinations.length]
        : home;
      const socialTile = nearestAvailableRoadTile(roads, socialDestination.entrance, usedSocialTiles);
      const homeRoad = roadPath(home.entrance, work.entrance, roads);
      const workSocialRoad = roadPath(work.entrance, socialTile, roads);
      const socialHomeRoad = roadPath(socialTile, home.entrance, roads);
      const routes = {
        homeToWork: combinePaths(interiorPath(homeTile, home.entrance), homeRoad, [workTile]),
        workToSocial: combinePaths([workTile], workSocialRoad, [socialTile]),
        socialToHome: combinePaths([socialTile], socialHomeRoad, interiorPath(home.entrance, homeTile))
      };
      return {
        id: `${region.id}:person:${index}`,
        authority: 'simulation',
        name: `${pick(seed, `person-${index}-given`, GIVEN_NAMES, index)} ${pick(seed, `person-${index}-family`, FAMILY_NAMES, index)}`,
        occupation,
        homeBuildingId: home.id,
        workBuildingId: work.id,
        regionX: 0,
        regionY: 0,
        homeTile,
        workTile,
        socialTile,
        routes
      };
    });

    const villageName = `${pick(seed, 'village-prefix', VILLAGE_PREFIX)}${pick(seed, 'village-suffix', VILLAGE_SUFFIX)}`;
    const roadTiles = Array.from(roads).map((text) => {
      const [rowText, colText] = text.split(',');
      return { row: Number(rowText), col: Number(colText) };
    }).sort((a, b) => a.row - b.row || a.col - b.col);

    for (const building of buildings) {
      building.worldX = terrain.originWorldX + building.col;
      building.worldY = terrain.originWorldY + building.row;
    }

    return deepFreeze({
      schemaVersion: 2,
      generatorVersion: VERSION,
      authority: 'simulation',
      seed,
      region,
      theme,
      protagonistOrigin: {
        regionX: 0,
        regionY: 0,
        worldX: 0,
        worldY: 0,
        localRow: CENTER.row,
        localCol: CENTER.col
      },
      village: {
        id: `${region.id}:village:origin`,
        name: villageName,
        inhabited: true,
        thematicRegion: 'village',
        regionSize: REGION_SIZE,
        center: { row: CENTER.row, col: CENTER.col },
        buildings,
        paths,
        roadTiles,
        population,
        spatialModelVersion: VERSION
      },
      surroundingTerrain: {
        generatorVersion: terrain.generatorVersion,
        counts: { ...terrain.counts },
        regionFingerprint: fingerprint(terrain),
        theme: terrain.theme.theme
      }
    });
  }

  function addTag(tile, tag) {
    if (!tile) return;
    if (tile.tags instanceof Set) tile.tags.add(tag);
    else if (Array.isArray(tile.tags) && !tile.tags.includes(tag)) tile.tags.push(tag);
  }

  function removeTag(tile, tag) {
    if (!tile) return;
    if (tile.tags instanceof Set) tile.tags.delete(tag);
    else if (Array.isArray(tile.tags)) {
      const index = tile.tags.indexOf(tag);
      if (index >= 0) tile.tags.splice(index, 1);
    }
  }

  function stampVillageOnRuntimeTerrain(world, village) {
    if (!world || !Array.isArray(world.terrain) || !village) return;
    for (const point of village.roadTiles || []) {
      const tile = world.terrain[point.row]?.[point.col];
      if (!tile) continue;
      tile.type = 'road';
      tile.elevation = 1;
      removeTag(tile, 'blocked');
      addTag(tile, 'road');
    }
    for (const building of village.buildings || []) {
      for (const cell of footprintCells(building.footprint, 0)) {
        const tile = world.terrain[cell.row]?.[cell.col];
        if (!tile) continue;
        tile.type = 'settlement';
        tile.elevation = 1;
        addTag(tile, 'settlement');
        addTag(tile, `building-${building.type}`);
        if (!building.passable) addTag(tile, 'blocked');
      }
      const entrance = building.entrance;
      const entranceTile = world.terrain[entrance.row]?.[entrance.col];
      if (entranceTile) {
        entranceTile.type = 'road';
        removeTag(entranceTile, 'blocked');
        addTag(entranceTile, 'road');
        addTag(entranceTile, 'building-entrance');
      }
    }
  }

  let runtimeBound = false;
  function bindRuntime() {
    const Terrain = Game.Terrain;
    if (!Terrain || typeof Terrain.generateWorld !== 'function') return false;
    if (runtimeBound) return true;
    const generateWorld = Terrain.generateWorld.bind(Terrain);
    Terrain.generateWorld = function admin100x100SpatialGenerateWorld(seedInput, colsInput, rowsInput) {
      const result = generateWorld(seedInput, colsInput, rowsInput);
      const base = generateOriginVillage(seedInput);
      const world = Game.State?.world;
      if (world) {
        world.currentRegion = { ...base.region, theme: base.theme.theme, regionSize: REGION_SIZE };
        world.originVillage = base.village;
        world.originBaseState = base;
        world.spatialRegion = {
          version: VERSION,
          authority: 'simulation',
          regionSize: REGION_SIZE,
          theme: base.theme
        };
        if (world.player && world.rows >= REGION_SIZE && world.cols >= REGION_SIZE) {
          world.player.row = CENTER.row;
          world.player.col = CENTER.col;
          world.player.startRow = CENTER.row;
          world.player.startCol = CENTER.col;
          world.player.targetRow = CENTER.row;
          world.player.targetCol = CENTER.col;
          world.player.regionX = 0;
          world.player.regionY = 0;
          world.player.worldX = 0;
          world.player.worldY = 0;
        }
        stampVillageOnRuntimeTerrain(world, base.village);
      }
      return {
        ...(result || {}),
        playerStart: { row: base.protagonistOrigin.localRow, col: base.protagonistOrigin.localCol },
        originVillageBase: base,
        spatialRegion: base.theme
      };
    };
    runtimeBound = true;
    return true;
  }

  Game.SpatialWorld = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    regionSize: REGION_SIZE,
    center: CENTER,
    themeNames: THEME_NAMES,
    describeTheme,
    generateRegion,
    generateOriginVillage,
    stampVillageOnRuntimeTerrain,
    bindRuntime
  });

  Game.OriginVillage = Object.freeze({
    schemaVersion: 2,
    generatorVersion: VERSION,
    authority: 'simulation',
    origin: Coordinates.origin,
    regionSize: REGION_SIZE,
    generate: generateOriginVillage,
    bindRuntime
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindRuntime);
  else bindRuntime();
})();