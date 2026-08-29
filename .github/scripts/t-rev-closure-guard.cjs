'use strict';

const REQUEST_MARKER = /^\s*TESTER REVISION REQUEST(?=\s*(?:—|-|:|$))/im;
const RESOLUTION_MARKER = /T-REV-RESOLVED\(request=(\d+),\s*tested_ref=([0-9a-f]{7,40})\)/gi;

function normalizeComments(comments) {
  if (!Array.isArray(comments)) throw new TypeError('comments must be an array');
  return comments.map((comment, index) => ({
    id: Number(comment?.id),
    body: String(comment?.body || ''),
    index
  })).filter((comment) => Number.isSafeInteger(comment.id) && comment.id > 0);
}

function findUnresolvedTesterRevisions(comments) {
  const normalized = normalizeComments(comments);
  const requests = normalized
    .filter((comment) => REQUEST_MARKER.test(comment.body))
    .map((comment) => ({ id: comment.id, index: comment.index }));
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const resolved = new Map();

  for (const comment of normalized) {
    RESOLUTION_MARKER.lastIndex = 0;
    for (let match = RESOLUTION_MARKER.exec(comment.body); match; match = RESOLUTION_MARKER.exec(comment.body)) {
      const requestId = Number(match[1]);
      const request = requestById.get(requestId);
      if (!request || comment.index <= request.index) continue;
      resolved.set(requestId, { commentId: comment.id, testedRef: match[2].toLowerCase() });
    }
  }

  return requests
    .filter((request) => !resolved.has(request.id))
    .map((request) => Object.freeze({ requestId: request.id, commentIndex: request.index }));
}

module.exports = Object.freeze({
  REQUEST_MARKER,
  RESOLUTION_MARKER,
  findUnresolvedTesterRevisions
});
