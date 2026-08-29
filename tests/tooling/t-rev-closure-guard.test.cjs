'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findUnresolvedTesterRevisions } = require('../../.github/scripts/t-rev-closure-guard.cjs');

function comment(id, body) { return { id, body }; }

function unresolvedIds(comments) {
  return findUnresolvedTesterRevisions(comments).map((entry) => entry.requestId);
}

test('no Tester revision request has no unresolved revisions', () => {
  assert.deepEqual(unresolvedIds([
    comment(1, 'CODER AUDIT — green'),
    comment(2, 'TESTER PASS — independent verification')
  ]), []);
});

test('Tester revision request remains unresolved without an explicit resolution marker', () => {
  assert.deepEqual(unresolvedIds([
    comment(10, 'TESTER REVISION REQUEST — Worker #7\nRepro: defect.'),
    comment(11, 'CODER FIX — corrected candidate abcdef1'),
    comment(12, 'TESTER PASS — this text alone must not resolve a revision')
  ]), [10]);
});

test('a Tester revision acceptance comment is not a new revision request', () => {
  assert.deepEqual(unresolvedIds([
    comment(60, 'TESTER REVISION REQUEST — Worker #7\nRepro: production path missing.'),
    comment(61, 'TESTER REVISION REQUEST ACCEPTED — R04-T06 / #175 — Worker #6 as Coder\nAccepted Tester defect 60.'),
    comment(62, 'CODER FIX — corrected candidate deadbee')
  ]), [60]);
});

test('a later exact resolution marker resolves the referenced Tester revision', () => {
  assert.deepEqual(unresolvedIds([
    comment(20, 'TESTER REVISION REQUEST — Worker #2'),
    comment(21, 'CODER FIX — candidate 0123456789abcdef'),
    comment(22, 'TESTER PASS — independent retest\nT-REV-RESOLVED(request=20, tested_ref=0123456789abcdef)')
  ]), []);
});

test('a newer Tester revision remains unresolved after an older revision was resolved', () => {
  assert.deepEqual(unresolvedIds([
    comment(30, 'TESTER REVISION REQUEST — Worker #1'),
    comment(31, 'T-REV-RESOLVED(request=30, tested_ref=aaaaaaa)'),
    comment(32, 'TESTER REVISION REQUEST — Worker #4'),
    comment(33, 'CODER FIX — awaiting retest')
  ]), [32]);
});

test('a resolution marker cannot resolve a request that appears later in history', () => {
  assert.deepEqual(unresolvedIds([
    comment(40, 'T-REV-RESOLVED(request=41, tested_ref=bbbbbbb)'),
    comment(41, 'TESTER REVISION REQUEST — Worker #3')
  ]), [41]);
});

test('resolution markers are tied to the requested comment id', () => {
  assert.deepEqual(unresolvedIds([
    comment(50, 'TESTER REVISION REQUEST — Worker #3'),
    comment(51, 'TESTER REVISION REQUEST — Worker #5'),
    comment(52, 'TESTER PASS\nT-REV-RESOLVED(request=50, tested_ref=ccccccc)')
  ]), [51]);
});
