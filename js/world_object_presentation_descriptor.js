/*
  R04 #293: Simulation-backed world-object presentation descriptor boundary.

  Presentation may choose how an object looks, but it never derives authoritative
  position, footprint, blocking, walkability, interaction, or entity state from
  PNG pixels, alpha, file names, source-cell dimensions, or renderer state.
*/
(function installWorldObjectPresentationDescriptor(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-object-presentation-descriptor-v1';
  const AUTHORITY = 'simulation';
  const PRESENTATION_AUTHORITY = 'presentation';
  const PRESENTATION_CLASSES = Object.freeze({
    STATIC_PROP: 'static-prop',
    MULTI_TILE_PROP: 'multi-tile-prop',
    WORLD_ENTITY: 'world-entity'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function canonicalString(value, label) {
    if (value === undefined || value === null) throw new TypeError(`${label} is required.`);
    const text = String(value).trim();
    if (!text) throw new TypeError(`${label} must not be empty.`);
    return text;
  }

  function integer(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.trunc(number) !== number) {
      throw new TypeError(`${label} must be an integer.`);
    }
    return number;
  }

  function positiveInteger(value, label) {
    const number = integer(value, label);
    if (number < 1) throw new RangeError(`${label} must be at least 1.`);
    return number;
  }

  function canonicalBoolean(value, label) {
    if (value !== true && value !== false) throw new TypeError(`${label} must be boolean.`);
    return value;
  }

  function canonicalPosition(source) {
    if (!source || typeof source !== 'object') throw new TypeError('position is required.');
    return {
      regionX: integer(source.regionX, 'position.regionX'),
      regionY: integer(source.regionY, 'position.regionY'),
      row: integer(source.row, 'position.row'),
      col: integer(source.col, 'position.col')
    };
  }

  function canonicalOccupiedCells(source, position) {
    if (!Array.isArray(source) || source.length === 0) return null;
    const seen = new Set();
    const cells = source.map((cell, index) => {
      if (!cell || typeof cell !== 'object') throw new TypeError(`footprint.occupiedCells[${index}] must be an object.`);
      const row = integer(cell.row, `footprint.occupiedCells[${index}].row`);
      const col = integer(cell.col, `footprint.occupiedCells[${index}].col`);
      const key = `${row},${col}`;
      if (seen.has(key)) throw new TypeError(`footprint.occupiedCells contains duplicate ${key}.`);
      seen.add(key);
      return { row, col };
    });
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    if (!seen.has(`${position.row},${position.col}`)) {
      throw new TypeError('footprint.occupiedCells must include the authoritative position tile.');
    }
    return cells;
  }

  function rectangularCells(position, width, height) {
    const cells = [];
    for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
      for (let colOffset = 0; colOffset < width; colOffset += 1) {
        cells.push({ row: position.row + rowOffset, col: position.col + colOffset });
      }
    }
    return cells;
  }

  function canonicalFootprint(source, position) {
    if (!source || typeof source !== 'object') {
      throw new TypeError('footprint is required; visual source dimensions never imply logical occupancy.');
    }

    const explicitCells = canonicalOccupiedCells(source.occupiedCells, position);
    if (explicitCells) {
      const rows = explicitCells.map((cell) => cell.row);
      const cols = explicitCells.map((cell) => cell.col);
      return {
        kind: 'explicit-cells',
        width: Math.max(...cols) - Math.min(...cols) + 1,
        height: Math.max(...rows) - Math.min(...rows) + 1,
        occupiedCells: explicitCells
      };
    }

    const width = positiveInteger(source.width, 'footprint.width');
    const height = positiveInteger(source.height, 'footprint.height');
    return {
      kind: 'rectangle',
      width,
      height,
      occupiedCells: rectangularCells(position, width, height)
    };
  }

  function canonicalInteraction(source) {
    if (source === undefined || source === null || source === false) return null;
    if (!source || typeof source !== 'object') throw new TypeError('interaction must be an object, null, or false.');
    return {
      enabled: source.enabled === undefined ? true : canonicalBoolean(source.enabled, 'interaction.enabled'),
      kind: canonicalString(source.kind, 'interaction.kind')
    };
  }

  function canonicalEntity(source) {
    if (source === undefined || source === null) return null;
    if (!source || typeof source !== 'object') throw new TypeError('entity must be an object or null.');
    return {
      entityId: canonicalString(source.entityId, 'entity.entityId'),
      moving: source.moving === undefined ? false : canonicalBoolean(source.moving, 'entity.moving'),
      state: source.state === undefined || source.state === null ? null : canonicalString(source.state, 'entity.state')
    };
  }

  function canonicalVisual(source, semanticType) {
    const visual = source && typeof source === 'object' ? source : {};
    const bounds = visual.bounds && typeof visual.bounds === 'object'
      ? {
          width: positiveInteger(visual.bounds.width, 'visual.bounds.width'),
          height: positiveInteger(visual.bounds.height, 'visual.bounds.height')
        }
      : null;
    const anchor = visual.anchor && typeof visual.anchor === 'object'
      ? {
          x: Number.isFinite(Number(visual.anchor.x)) ? Number(visual.anchor.x) : 0.5,
          y: Number.isFinite(Number(visual.anchor.y)) ? Number(visual.anchor.y) : 1
        }
      : { x: 0.5, y: 1 };

    return {
      authority: PRESENTATION_AUTHORITY,
      nonAuthoritative: true,
      semanticKey: visual.semanticKey === undefined || visual.semanticKey === null
        ? semanticType
        : canonicalString(visual.semanticKey, 'visual.semanticKey'),
      assetAvailable: visual.assetAvailable === undefined ? true : canonicalBoolean(visual.assetAvailable, 'visual.assetAvailable'),
      assetPath: visual.assetPath === undefined || visual.assetPath === null ? null : String(visual.assetPath),
      bounds,
      anchor,
      overhangAllowed: visual.overhangAllowed === undefined ? Boolean(bounds) : canonicalBoolean(visual.overhangAllowed, 'visual.overhangAllowed')
    };
  }

  function presentationClass(footprint, entity) {
    if (entity) return PRESENTATION_CLASSES.WORLD_ENTITY;
    if (footprint.occupiedCells.length > 1 || footprint.width > 1 || footprint.height > 1) {
      return PRESENTATION_CLASSES.MULTI_TILE_PROP;
    }
    return PRESENTATION_CLASSES.STATIC_PROP;
  }

  function describe(input) {
    if (!input || typeof input !== 'object') throw new TypeError('world object input is required.');

    const objectId = canonicalString(input.objectId, 'objectId');
    const semanticType = canonicalString(input.semanticType, 'semanticType');
    const position = canonicalPosition(input.position);
    const footprint = canonicalFootprint(input.footprint, position);
    const blocking = canonicalBoolean(input.blocking, 'blocking');
    const walkable = canonicalBoolean(input.walkable, 'walkable');
    const interaction = canonicalInteraction(input.interaction);
    const entity = canonicalEntity(input.entity);
    const visual = canonicalVisual(input.visual, semanticType);

    return deepFreeze({
      schemaVersion: 1,
      descriptorVersion: VERSION,
      authority: AUTHORITY,
      objectId,
      semanticType,
      presentationClass: presentationClass(footprint, entity),
      position,
      footprint,
      blocking,
      walkable,
      interaction,
      entity,
      visual
    });
  }

  function fingerprint(descriptor) {
    if (!descriptor || descriptor.authority !== AUTHORITY || descriptor.descriptorVersion !== VERSION) {
      throw new TypeError('A current Simulation-backed world-object descriptor is required.');
    }
    return JSON.stringify({
      descriptorVersion: descriptor.descriptorVersion,
      objectId: descriptor.objectId,
      semanticType: descriptor.semanticType,
      presentationClass: descriptor.presentationClass,
      position: descriptor.position,
      footprint: descriptor.footprint,
      blocking: descriptor.blocking,
      walkable: descriptor.walkable,
      interaction: descriptor.interaction,
      entity: descriptor.entity
    });
  }

  function describeMany(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array.');
    return deepFreeze(inputs.map((input) => describe(input)));
  }

  Game.WorldObjectPresentationDescriptor = Object.freeze({
    schemaVersion: 1,
    descriptorVersion: VERSION,
    authority: AUTHORITY,
    presentationClasses: PRESENTATION_CLASSES,
    describe,
    describeMany,
    fingerprint
  });
})(typeof window !== 'undefined' ? window : globalThis);
