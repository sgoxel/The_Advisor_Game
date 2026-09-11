/*
  R04 / #253 + WP-112: starter-village interior Simulation-derived descriptors.

  Admin presentation invariant: this module does NOT create or draw an interior canvas.
  Interior floors/walls/doors remain authoritative world/terrain data. Any non-NPC visible
  interior artwork must be flattened by StaticTileCompositor into the affected 100x100 tiles.
*/
(function installStarterVillageInteriors(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-starter-village-interiors-v3-static-tile-data-only';
  let lastWorld = null;
  let lastVillage = null;

  function tags(tile) {
    if (!tile) return null;
    if (tile.tags instanceof Set) return tile.tags;
    if (Array.isArray(tile.tags)) { tile.tags = new Set(tile.tags); return tile.tags; }
    tile.tags = new Set();
    return tile.tags;
  }

  function add(tile, tag) {
    const set = tags(tile);
    if (set) set.add(tag);
  }

  function remove(tile, tag) {
    const set = tags(tile);
    if (set) set.delete(tag);
  }

  function key(row, col) {
    return `${row},${col}`;
  }

  function descriptorFor(building) {
    const f = building?.footprint;
    const e = building?.entrance;
    if (!f || !e || building.passable === true) return null;

    const row0 = Number(f.row);
    const col0 = Number(f.col);
    const row1 = row0 + Number(f.height) - 1;
    const col1 = col0 + Number(f.width) - 1;
    if (![row0, col0, row1, col1].every(Number.isFinite) || row1 - row0 < 2 || col1 - col0 < 2) return null;

    let door;
    if (Number(e.row) < row0) {
      door = { row: row0, col: Math.max(col0 + 1, Math.min(col1 - 1, Number(e.col))) };
    } else if (Number(e.row) > row1) {
      door = { row: row1, col: Math.max(col0 + 1, Math.min(col1 - 1, Number(e.col))) };
    } else if (Number(e.col) < col0) {
      door = { row: Math.max(row0 + 1, Math.min(row1 - 1, Number(e.row))), col: col0 };
    } else {
      door = { row: Math.max(row0 + 1, Math.min(row1 - 1, Number(e.row))), col: col1 };
    }

    const walls = [];
    const floors = [];
    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) {
        const boundary = row === row0 || row === row1 || col === col0 || col === col1;
        const point = { row, col };
        if (boundary && (row !== door.row || col !== door.col)) walls.push(point);
        else floors.push(point);
      }
    }

    const rooms = (Array.isArray(building.rooms) ? building.rooms : []).map((room) => Object.freeze({
      id: String(room.id),
      purpose: String(room.purpose || 'primary'),
      row: Number(room.row),
      col: Number(room.col),
      width: Number(room.width),
      height: Number(room.height)
    }));

    return Object.freeze({
      schemaVersion: 1,
      version: VERSION,
      authority: 'simulation-derived',
      buildingId: String(building.id),
      buildingType: String(building.type || 'building'),
      footprint: Object.freeze({ ...f }),
      entrance: Object.freeze({ row: Number(e.row), col: Number(e.col) }),
      door: Object.freeze(door),
      rooms: Object.freeze(rooms),
      walls: Object.freeze(walls.map(Object.freeze)),
      floors: Object.freeze(floors.map(Object.freeze))
    });
  }

  function clearBlockingTerrain(tile) {
    if (!tile) return;
    tile.type = 'settlement';
    tile.blocked = false;
    tile.obstacle = false;
    for (const tag of ['blocked', 'obstacle', 'water', 'lake', 'river', 'mountain', 'forest', 'building-wall']) {
      remove(tile, tag);
    }
    add(tile, 'settlement');
  }

  function materialize(world) {
    const village = world?.originVillage;
    if (!world || !Array.isArray(world.terrain) || !Array.isArray(village?.buildings)) return false;
    if (world === lastWorld && village === lastVillage && world.buildingInteriors?.version === VERSION) return true;

    const interiors = village.buildings.map(descriptorFor).filter(Boolean);
    const floorIndex = new Map();
    const wallIndex = new Map();
    const changedCells = [];

    for (const interior of interiors) {
      for (const point of interior.walls) {
        const tile = world.terrain[point.row]?.[point.col];
        if (!tile) continue;
        tile.type = 'settlement';
        tile.blocked = true;
        add(tile, 'settlement');
        add(tile, 'blocked');
        add(tile, 'building-wall');
        add(tile, `building:${interior.buildingId}`);
        wallIndex.set(key(point.row, point.col), interior.buildingId);
        changedCells.push(point);
      }

      for (const point of interior.floors) {
        const tile = world.terrain[point.row]?.[point.col];
        if (!tile) continue;
        clearBlockingTerrain(tile);
        add(tile, 'building-interior');
        add(tile, 'building-floor');
        add(tile, `building:${interior.buildingId}`);
        floorIndex.set(key(point.row, point.col), interior.buildingId);
        changedCells.push(point);
      }

      const entranceTile = world.terrain[interior.entrance.row]?.[interior.entrance.col];
      if (entranceTile) {
        clearBlockingTerrain(entranceTile);
        add(entranceTile, 'building-entrance');
        add(entranceTile, `building:${interior.buildingId}`);
        changedCells.push(interior.entrance);
      }

      const doorTile = world.terrain[interior.door.row]?.[interior.door.col];
      if (doorTile) {
        clearBlockingTerrain(doorTile);
        add(doorTile, 'building-door');
        add(doorTile, 'building-interior');
        add(doorTile, `building:${interior.buildingId}`);
        changedCells.push(interior.door);
      }
    }

    world.buildingInteriors = Object.freeze({
      schemaVersion: 1,
      version: VERSION,
      authority: 'simulation-derived',
      seed: String(world.seed || Game.State?.settings?.seed || ''),
      interiors: Object.freeze(interiors),
      floorIndex,
      wallIndex
    });

    lastWorld = world;
    lastVillage = village;

    // Interior state changes presentation-relevant terrain/building pixels. The compositor may
    // not be loaded yet; when it is, its initialization performs a complete composition pass.
    if (Game.StaticTileCompositor?.invalidateTiles) {
      Game.StaticTileCompositor.invalidateTiles(changedCells, 'starter-village-interior-materialize');
    } else if (Game.State?.render) {
      Game.State.render.needsBackgroundRebuild = true;
    }
    return true;
  }

  function interiorAt(row, col) {
    const state = Game.State?.world?.buildingInteriors;
    const id = state?.floorIndex?.get(key(Number(row), Number(col)));
    return id ? state.interiors.find((item) => item.buildingId === id) || null : null;
  }

  function install() {
    materialize(Game.State?.world);
    return true;
  }

  Game.StarterVillageInteriors = Object.freeze({
    version: VERSION,
    authority: 'simulation-derived',
    presentation: 'static-100px-tile-compositor-only',
    install,
    materialize,
    interiorAt,
    descriptorFor,
    snapshot() {
      const state = Game.State?.world?.buildingInteriors;
      return state ? {
        schemaVersion: state.schemaVersion,
        version: state.version,
        authority: state.authority,
        seed: state.seed,
        interiors: state.interiors
      } : null;
    }
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') global.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
