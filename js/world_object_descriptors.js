/*
  R04 #293: Simulation-backed world-object presentation descriptors.

  This boundary deliberately separates authoritative object facts from presentation metadata.
  PNG pixels, alpha, source-cell size, asset paths and visible bounds never create or change
  logical position, occupied cells, blocking, interaction, motion or persistent entity state.
*/
(function installWorldObjectDescriptors(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-world-object-descriptor-v1';
  const AUTHORITY = 'simulation';

  const PRESENTATION_CLASSES = Object.freeze({
    TERRAIN_OVERLAY: 'terrain-overlay',
    STATIC_PROP: 'static-prop',
    MULTI_TILE_PROP: 'multi-tile-prop',
    WORLD_SPACE_ENTITY: 'world-space-entity'
  });

  const PERSISTENCE_MODES = Object.freeze({
    REGENERABLE_BASE: 'regenerable-base',
    PERSISTENT_DELTA: 'persistent-delta'
  });

  function canonicalString(value, label) {
    if (value === undefined || value === null) throw new TypeError(`${label} is required.`);
    const text = String(value).trim();
    if (!text) throw new TypeError(`${label} must not be empty.`);
    return text;
  }

  function finiteInteger(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number)) throw new TypeError(`${label} must be an integer.`);
    return number;
  }

  function canonicalBoolean(value, fallback) {
    if (value === undefined) return Boolean(fallback);
    return value === true;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  function stableClone(value) {
    if (Array.isArray(value)) return value.map(stableClone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableClone(value[key]);
    return result;
  }

  function normalizeClass(value, moving) {
    const candidate = value || (moving ? PRESENTATION_CLASSES.WORLD_SPACE_ENTITY : PRESENTATION_CLASSES.STATIC_PROP);
    if (!Object.values(PRESENTATION_CLASSES).includes(candidate)) {
      throw new TypeError(`Unsupported world-object presentation class: ${candidate}`);
    }
    if (moving && candidate !== PRESENTATION_CLASSES.WORLD_SPACE_ENTITY) {
      throw new TypeError('Moving objects must use world-space-entity presentation class.');
    }
    return candidate;
  }

  function normalizeAnchor(source) {
    const input = source && typeof source === 'object' ? source : {};
    return {
      regionX: finiteInteger(input.regionX ?? 0, 'position.regionX'),
      regionY: finiteInteger(input.regionY ?? 0, 'position.regionY'),
      row: finiteInteger(input.row, 'position.row'),
      col: finiteInteger(input.col, 'position.col')
    };
  }

  function normalizeCell(cell, index) {
    if (!cell || typeof cell !== 'object') throw new TypeError(`footprint.cells[${index}] must be an object.`);
    return {
      row: finiteInteger(cell.row, `footprint.cells[${index}].row`),
      col: finiteInteger(cell.col, `footprint.cells[${index}].col`)
    };
  }

  function normalizeFootprint(source, anchor) {
    const input = source && typeof source === 'object' ? source : {};
    let cells = Array.isArray(input.cells) ? input.cells.map(normalizeCell) : [];

    if (!cells.length) {
      const width = finiteInteger(input.width ?? 1, 'footprint.width');
      const height = finiteInteger(input.height ?? 1, 'footprint.height');
      if (width < 1 || height < 1) throw new RangeError('footprint width/height must be >= 1.');
      cells = [];
      for (let dr = 0; dr < height; dr += 1) {
        for (let dc = 0; dc < width; dc += 1) cells.push({ row: anchor.row + dr, col: anchor.col + dc });
      }
    }

    const unique = new Map();
    for (const cell of cells) unique.set(`${cell.row},${cell.col}`, cell);
    const ordered = Array.from(unique.values()).sort((a, b) => a.row - b.row || a.col - b.col);
    if (!ordered.length) throw new TypeError('footprint must contain at least one occupied cell.');

    const rows = ordered.map((cell) => cell.row);
    const cols = ordered.map((cell) => cell.col);
    return {
      cells: ordered,
      bounds: {
        minRow: Math.min(...rows),
        maxRow: Math.max(...rows),
        minCol: Math.min(...cols),
        maxCol: Math.max(...cols)
      },
      cellCount: ordered.length
    };
  }

  function normalizeInteraction(source) {
    const input = source && typeof source === 'object' ? source : {};
    const enabled = canonicalBoolean(input.enabled, false);
    return {
      enabled,
      kind: enabled && input.kind !== undefined && input.kind !== null ? canonicalString(input.kind, 'interaction.kind') : null,
      state: enabled && input.state !== undefined ? stableClone(input.state) : null
    };
  }

  function normalizePersistence(source) {
    const input = source && typeof source === 'object' ? source : {};
    const mode = input.mode || PERSISTENCE_MODES.REGENERABLE_BASE;
    if (!Object.values(PERSISTENCE_MODES).includes(mode)) throw new TypeError(`Unsupported persistence mode: ${mode}`);
    return {
      mode,
      seed: input.seed === undefined || input.seed === null ? null : String(input.seed),
      generatorVersion: input.generatorVersion === undefined || input.generatorVersion === null ? null : String(input.generatorVersion),
      revision: input.revision === undefined || input.revision === null ? null : finiteInteger(input.revision, 'persistence.revision')
    };
  }

  function normalizePresentation(source, presentationClass) {
    const input = source && typeof source === 'object' ? source : {};
    const semanticId = canonicalString(input.semanticId, 'presentation.semanticId');
    const family = input.family === undefined || input.family === null
      ? semanticId.split('.')[0]
      : canonicalString(input.family, 'presentation.family');
    return {
      class: presentationClass,
      semanticId,
      family,
      variant: input.variant === undefined || input.variant === null ? null : String(input.variant),
      anchor: input.anchor === undefined || input.anchor === null ? 'bottom-center' : String(input.anchor),
      baseline: input.baseline === undefined || input.baseline === null ? 'authoritative-ground' : String(input.baseline),
      // These are optional renderer hints only. They are intentionally absent from
      // authoritativeFingerprint() and cannot affect logical footprint/state.
      visualHints: input.visualHints && typeof input.visualHints === 'object' ? stableClone(input.visualHints) : {}
    };
  }

  function fromSimulation(source) {
    if (!source || typeof source !== 'object' || source.authority !== AUTHORITY) {
      throw new TypeError('World-object descriptors require Simulation-owned input (`authority: simulation`).');
    }

    const objectId = canonicalString(source.objectId ?? source.entityId, 'objectId');
    const moving = canonicalBoolean(source.moving, false);
    const presentationClass = normalizeClass(source.presentationClass, moving);
    const position = normalizeAnchor(source.position);
    const footprint = normalizeFootprint(source.footprint, position);
    const blocking = canonicalBoolean(source.blocking, false);
    const walkable = source.walkable === undefined ? !blocking : canonicalBoolean(source.walkable, !blocking);
    const interaction = normalizeInteraction(source.interaction);
    const persistence = normalizePersistence(source.persistence);
    const presentation = normalizePresentation(source.presentation, presentationClass);

    const entityState = presentationClass === PRESENTATION_CLASSES.WORLD_SPACE_ENTITY
      ? stableClone(source.entityState && typeof source.entityState === 'object' ? source.entityState : {})
      : null;

    return deepFreeze({
      schemaVersion: 1,
      generatorVersion: VERSION,
      authority: AUTHORITY,
      objectId,
      entityId: source.entityId === undefined || source.entityId === null ? null : String(source.entityId),
      position,
      footprint,
      blocking,
      walkable,
      interaction,
      moving,
      entityState,
      persistence,
      presentation
    });
  }

  function authoritativeFingerprint(descriptor) {
    assertDescriptor(descriptor);
    return JSON.stringify(stableClone({
      generatorVersion: descriptor.generatorVersion,
      authority: descriptor.authority,
      objectId: descriptor.objectId,
      entityId: descriptor.entityId,
      position: descriptor.position,
      footprint: descriptor.footprint,
      blocking: descriptor.blocking,
      walkable: descriptor.walkable,
      interaction: descriptor.interaction,
      moving: descriptor.moving,
      entityState: descriptor.entityState,
      persistence: descriptor.persistence,
      presentationClass: descriptor.presentation.class,
      semanticIdentity: descriptor.presentation.semanticId
    }));
  }

  function presentationRequest(descriptor) {
    assertDescriptor(descriptor);
    return deepFreeze({
      authority: 'presentation-only',
      objectId: descriptor.objectId,
      entityId: descriptor.entityId,
      semanticId: descriptor.presentation.semanticId,
      family: descriptor.presentation.family,
      variant: descriptor.presentation.variant,
      class: descriptor.presentation.class,
      anchor: descriptor.presentation.anchor,
      baseline: descriptor.presentation.baseline,
      visualHints: stableClone(descriptor.presentation.visualHints),
      authoritativePosition: descriptor.position,
      authoritativeFootprint: descriptor.footprint
    });
  }

  function assertDescriptor(value) {
    if (!value || value.authority !== AUTHORITY || value.generatorVersion !== VERSION || !Object.isFrozen(value)) {
      throw new TypeError('A current frozen Simulation-backed world-object descriptor is required.');
    }
    return value;
  }

  function sameAuthority(left, right) {
    return authoritativeFingerprint(left) === authoritativeFingerprint(right);
  }

  Game.WorldObjectDescriptors = Object.freeze({
    schemaVersion: 1,
    generatorVersion: VERSION,
    authority: AUTHORITY,
    presentationAuthority: 'presentation-only',
    PRESENTATION_CLASSES,
    PERSISTENCE_MODES,
    fromSimulation,
    authoritativeFingerprint,
    presentationRequest,
    sameAuthority,
    assertDescriptor
  });
})(typeof window !== 'undefined' ? window : globalThis);
