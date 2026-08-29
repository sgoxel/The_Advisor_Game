/*
  R03-T02 / #157
  Stable Simulation-owned interaction-target identity and compact context contract.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;
  const CATEGORIES = Object.freeze(['npc', 'location', 'animal', 'creature']);
  const RELEVANCE = Object.freeze(['active', 'nearby', 'inactive']);
  const STATUS = Object.freeze({ RESOLVED: 'resolved', REJECTED: 'rejected' });
  const REASON = Object.freeze({
    OK: 'OK',
    MALFORMED_REFERENCE: 'MALFORMED_REFERENCE',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    WORLD_CONTEXT_MISMATCH: 'WORLD_CONTEXT_MISMATCH',
    REGION_CONTEXT_MISMATCH: 'REGION_CONTEXT_MISMATCH',
    STALE_CONTEXT_REFERENCE: 'STALE_CONTEXT_REFERENCE',
    TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
    TARGET_CATEGORY_MISMATCH: 'TARGET_CATEGORY_MISMATCH'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
  }

  function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeCategory(value) {
    const category = cleanString(value).toLowerCase();
    return CATEGORIES.includes(category) ? category : '';
  }

  function normalizeRelevance(value) {
    const relevance = cleanString(value).toLowerCase();
    return RELEVANCE.includes(relevance) ? relevance : 'inactive';
  }

  function normalizeLocation(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      settlementRef: cleanString(source.settlementRef) || null,
      siteRef: cleanString(source.siteRef) || null,
      row: finiteNumberOrNull(source.row),
      col: finiteNumberOrNull(source.col)
    };
  }

  function normalizeTarget(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      ref: cleanString(source.ref || source.id),
      category: normalizeCategory(source.category),
      stateRef: cleanString(source.stateRef),
      available: source.available !== false,
      relevance: normalizeRelevance(source.relevance),
      location: normalizeLocation(source.location)
    };
  }

  function normalizeContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const targets = (Array.isArray(source.targets) ? source.targets : [])
      .map(normalizeTarget)
      .filter((target) => target.ref && target.category)
      .sort((a, b) => a.ref.localeCompare(b.ref) || a.category.localeCompare(b.category));

    return {
      authority: cleanString(source.authority).toLowerCase(),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      revision: nonNegativeInteger(source.revision),
      targets
    };
  }

  function normalizeReference(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      ref: cleanString(source.ref),
      category: normalizeCategory(source.category),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      contextRevision: nonNegativeInteger(source.contextRevision)
    });
  }

  function makeReference(targetCandidate, contextCandidate) {
    const target = normalizeTarget(targetCandidate);
    const context = normalizeContext(contextCandidate);
    return normalizeReference({
      ref: target.ref,
      category: target.category,
      worldRef: context.worldRef || target.location.worldRef,
      regionRef: context.regionRef || target.location.regionRef,
      contextRevision: context.revision
    });
  }

  function result(status, reasonCode, reference, target) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      reference,
      target: target ? deepFreeze(target) : null
    });
  }

  function resolve(referenceCandidate, contextCandidate) {
    const reference = normalizeReference(referenceCandidate);
    const context = normalizeContext(contextCandidate);

    if (!reference.ref || !reference.category || !reference.worldRef || !reference.regionRef) {
      return result(STATUS.REJECTED, REASON.MALFORMED_REFERENCE, reference, null);
    }
    if (context.authority !== 'simulation') {
      return result(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, reference, null);
    }
    if (!context.worldRef || reference.worldRef !== context.worldRef) {
      return result(STATUS.REJECTED, REASON.WORLD_CONTEXT_MISMATCH, reference, null);
    }
    if (!context.regionRef || reference.regionRef !== context.regionRef) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, reference, null);
    }
    if (reference.contextRevision !== context.revision) {
      return result(STATUS.REJECTED, REASON.STALE_CONTEXT_REFERENCE, reference, null);
    }

    const target = context.targets.find((item) => item.ref === reference.ref);
    if (!target) return result(STATUS.REJECTED, REASON.TARGET_NOT_FOUND, reference, null);
    if (target.category !== reference.category) {
      return result(STATUS.REJECTED, REASON.TARGET_CATEGORY_MISMATCH, reference, null);
    }
    if (
      (target.location.worldRef && target.location.worldRef !== context.worldRef) ||
      (target.location.regionRef && target.location.regionRef !== context.regionRef)
    ) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, reference, null);
    }

    return result(STATUS.RESOLVED, REASON.OK, reference, target);
  }

  function canonicalStringify(referenceCandidate) {
    return JSON.stringify(normalizeReference(referenceCandidate));
  }

  window.Game.InteractionTarget = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    categories: CATEGORIES,
    relevanceLevels: RELEVANCE,
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeTarget: (candidate) => deepFreeze(normalizeTarget(candidate)),
    normalizeReference,
    makeReference,
    resolve,
    canonicalStringify
  });
})();
