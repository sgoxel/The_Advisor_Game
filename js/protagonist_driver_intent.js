/*
  R04-T01 / #170
  Deterministic autonomous-protagonist driver intent contract.

  This module converts a driver-owned candidate plus an authoritative character/
  world context snapshot into a canonical, immutable intent envelope that can be
  passed to R03 Simulation-owned legality validation. It defines no goal-selection
  policy, resolves no action, and exposes no authoritative mutation API.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;

  const STATUS = Object.freeze({
    READY: 'ready',
    REJECTED: 'rejected'
  });

  const REASON = Object.freeze({
    OK: 'OK',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    MALFORMED_CONTEXT: 'MALFORMED_CONTEXT',
    MALFORMED_CANDIDATE: 'MALFORMED_CANDIDATE',
    ACTOR_CONTEXT_MISMATCH: 'ACTOR_CONTEXT_MISMATCH',
    STALE_CONTEXT_REVISION: 'STALE_CONTEXT_REVISION'
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

  function normalizeStringArray(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanString(item))
      .filter(Boolean)))
      .sort();
  }

  function normalizeContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const hierarchy = source.hierarchy && typeof source.hierarchy === 'object' ? source.hierarchy : {};

    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: cleanString(source.authority).toLowerCase(),
      actorId: cleanString(source.actorId),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      contextRevision: nonNegativeInteger(source.contextRevision),
      campaignMinute: nonNegativeInteger(source.campaignMinute),
      hierarchy: {
        realmRef: cleanString(hierarchy.realmRef) || null,
        regionRef: cleanString(hierarchy.regionRef) || null,
        settlementRef: cleanString(hierarchy.settlementRef) || null
      },
      relevantTargetRefs: normalizeStringArray(source.relevantTargetRefs),
      actorStateRef: cleanString(source.actorStateRef) || null
    });
  }

  function normalizeCandidate(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const targetRef = source.targetRef === null || source.targetRef === undefined
      ? null
      : cleanString(source.targetRef) || null;

    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      actorId: cleanString(source.actorId),
      goalType: cleanString(source.goalType).toLowerCase(),
      actionType: cleanString(source.actionType).toLowerCase(),
      targetRef,
      expectedContextRevision: nonNegativeInteger(source.expectedContextRevision)
    });
  }

  function result(status, reasonCode, candidate, context, actionIntent) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'character-driver',
      status,
      reasonCode,
      canValidate: status === STATUS.READY,
      candidate,
      context,
      actionIntent
    });
  }

  function build(candidateInput, authoritativeContextInput) {
    const candidate = normalizeCandidate(candidateInput);
    const context = normalizeContext(authoritativeContextInput);

    if (context.authority !== 'simulation') {
      return result(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, candidate, context, null);
    }

    if (!context.actorId || !context.campaignRef || !context.locationRef || !context.worldRef || !context.regionRef) {
      return result(STATUS.REJECTED, REASON.MALFORMED_CONTEXT, candidate, context, null);
    }

    if (!candidate.actorId || !candidate.goalType || !candidate.actionType) {
      return result(STATUS.REJECTED, REASON.MALFORMED_CANDIDATE, candidate, context, null);
    }

    if (candidate.actorId !== context.actorId) {
      return result(STATUS.REJECTED, REASON.ACTOR_CONTEXT_MISMATCH, candidate, context, null);
    }

    if (candidate.expectedContextRevision !== context.contextRevision) {
      return result(STATUS.REJECTED, REASON.STALE_CONTEXT_REVISION, candidate, context, null);
    }

    const actionApi = window.Game?.ActionLegality;
    const actionIntent = actionApi?.normalizeIntent
      ? actionApi.normalizeIntent({
          decisionSource: 'character',
          actorId: context.actorId,
          actionType: candidate.actionType,
          campaignRef: context.campaignRef,
          locationRef: context.locationRef,
          targetRef: candidate.targetRef
        })
      : deepFreeze({
          schemaVersion: 1,
          decisionSource: 'character',
          actorId: context.actorId,
          actionType: candidate.actionType,
          campaignRef: context.campaignRef,
          locationRef: context.locationRef,
          targetRef: candidate.targetRef
        });

    return result(STATUS.READY, REASON.OK, candidate, context, actionIntent);
  }

  function canonicalStringify(candidateInput, authoritativeContextInput) {
    const built = build(candidateInput, authoritativeContextInput);
    return JSON.stringify({
      schemaVersion: built.schemaVersion,
      authority: built.authority,
      status: built.status,
      reasonCode: built.reasonCode,
      canValidate: built.canValidate,
      candidate: built.candidate,
      context: built.context,
      actionIntent: built.actionIntent
    });
  }

  window.Game.ProtagonistDriverIntent = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'character-driver',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeContext,
    normalizeCandidate,
    build,
    canonicalStringify
  });
})();
