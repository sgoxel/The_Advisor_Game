import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  RELEASE_APPROVAL_PHRASE,
  authorizeReleaseComment
} from '../scripts/authorize-release-comment.mjs';

const OWNER = 'sgoxel';
const SHA = '0123456789abcdef0123456789abcdef01234567';

function approvalBody(overrides = {}) {
  const values = {
    verified_commit: SHA,
    release_tag: 'v0.2.0-dev.1',
    release_name: 'Phase 2 — Seeded Checks and RNG Contract',
    restore_existing_verified: 'false',
    ...overrides
  };
  return [
    RELEASE_APPROVAL_PHRASE,
    `verified_commit: ${values.verified_commit}`,
    `release_tag: ${values.release_tag}`,
    `release_name: ${values.release_name}`,
    `restore_existing_verified: ${values.restore_existing_verified}`,
    '',
    'Tester evidence may continue below the structured authorization block.'
  ].join('\n');
}

function validEvent() {
  return {
    action: 'created',
    issue: {
      number: 26,
      state: 'open',
      title: 'P02-T06 — Phase 2 release gate',
      body: 'Phase: #20\nRole owner: Tester Worker\n\nRelease readiness acceptance:\n- Exact candidate required.'
    },
    comment: {
      id: 123456789,
      body: approvalBody(),
      user: { login: OWNER }
    }
  };
}

function authorize(event = validEvent(), options = {}) {
  return authorizeReleaseComment(event, {
    repositoryOwner: OWNER,
    actor: OWNER,
    ...options
  });
}

test('valid Tester release-gate approval authorizes exact structured release inputs', () => {
  assert.deepEqual(authorize(), {
    verified_commit: SHA,
    release_tag: 'v0.2.0-dev.1',
    release_name: 'Phase 2 — Seeded Checks and RNG Contract',
    restore_existing_verified: 'false',
    issue_number: '26',
    authorization_comment_id: '123456789'
  });
});

test('restore mode can be authorized explicitly', () => {
  const event = validEvent();
  event.comment.body = approvalBody({
    release_tag: 'v0.1.0-dev.1',
    release_name: 'Phase 1 — Deterministic Simulation Foundation',
    restore_existing_verified: 'true'
  });
  assert.equal(authorize(event).restore_existing_verified, 'true');
});

test('pull request comments cannot authorize a release', () => {
  const event = validEvent();
  event.issue.pull_request = { url: 'https://example.invalid/pr/1' };
  assert.throws(() => authorize(event), /only on a GitHub issue/);
});

test('closed or non-release-gate issues cannot authorize a release', () => {
  const closed = validEvent();
  closed.issue.state = 'closed';
  assert.throws(() => authorize(closed), /must still be open/);

  const wrongTitle = validEvent();
  wrongTitle.issue.title = 'Infrastructure task';
  assert.throws(() => authorize(wrongTitle), /must identify a release gate/);
});

test('non-Tester-owned issues cannot authorize a release', () => {
  const event = validEvent();
  event.issue.body = 'Role owner: Coder Worker';
  assert.throws(() => authorize(event), /must be owned by Tester Worker/);
});

test('repository owner identity is required for actor and comment author', () => {
  assert.throws(() => authorize(validEvent(), { actor: 'someone-else' }), /actor must be the repository owner/);

  const event = validEvent();
  event.comment.user.login = 'someone-else';
  assert.throws(() => authorize(event), /comment must be created by the repository owner identity/);
});

test('authorization phrase must be the exact first line', () => {
  const event = validEvent();
  event.comment.body = `Note first\n${event.comment.body}`;
  assert.throws(() => authorize(event), /exact first line/);
});

test('structured fields must be present once and in the required order', () => {
  const wrongOrder = validEvent();
  const lines = wrongOrder.comment.body.split('\n');
  [lines[1], lines[2]] = [lines[2], lines[1]];
  wrongOrder.comment.body = lines.join('\n');
  assert.throws(() => authorize(wrongOrder), /missing or out of order/);

  const duplicate = validEvent();
  duplicate.comment.body += `\nrelease_tag: duplicate`;
  assert.throws(() => authorize(duplicate), /must appear exactly once/);
});

test('invalid SHA, tag, release name, or restore flag is rejected', () => {
  const badSha = validEvent();
  badSha.comment.body = approvalBody({ verified_commit: 'abc123' });
  assert.throws(() => authorize(badSha), /40-character hexadecimal/);

  const badTag = validEvent();
  badTag.comment.body = approvalBody({ release_tag: 'v0.2 bad' });
  assert.throws(() => authorize(badTag), /must not contain whitespace/);

  const emptyName = validEvent();
  emptyName.comment.body = approvalBody({ release_name: '' });
  assert.throws(() => authorize(emptyName), /release_name must not be empty/);

  const badRestore = validEvent();
  badRestore.comment.body = approvalBody({ restore_existing_verified: 'yes' });
  assert.throws(() => authorize(badRestore), /must be exactly true or false/);
});

const triggerWorkflowUrl = new URL('../.github/workflows/tester-approved-release.yml', import.meta.url);
const triggerWorkflow = await readFile(triggerWorkflowUrl, 'utf8');

test('autonomous caller is issue-comment-only and strictly owner/approval gated', () => {
  assert.match(triggerWorkflow, /^on:\s*\n\s+issue_comment:/m);
  assert.match(triggerWorkflow, /types: \[created\]/);
  assert.match(triggerWorkflow, /github\.event\.issue\.pull_request == null/);
  assert.match(triggerWorkflow, /github\.event\.issue\.state == 'open'/);
  assert.match(triggerWorkflow, /github\.actor == github\.repository_owner/);
  assert.match(triggerWorkflow, /RELEASE CANDIDATE APPROVED FOR VERIFIED RELEASE WORKFLOW/);
  assert.match(triggerWorkflow, /node scripts\/authorize-release-comment\.mjs/);
  assert.doesNotMatch(triggerWorkflow, /^\s+push:/m);
  assert.doesNotMatch(triggerWorkflow, /^\s+pull_request:/m);
  assert.doesNotMatch(triggerWorkflow, /^\s+workflow_dispatch:/m);
});

test('autonomous caller delegates to the reusable Verified Release with explicit verification', () => {
  assert.match(triggerWorkflow, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(triggerWorkflow, /confirm_verified: true/);
  assert.match(triggerWorkflow, /fromJSON\(needs\.authorize\.outputs\.restore_existing_verified\)/);
  assert.doesNotMatch(triggerWorkflow, /actions\/deploy-pages/);
  assert.doesNotMatch(triggerWorkflow, /gh release create/);
});
