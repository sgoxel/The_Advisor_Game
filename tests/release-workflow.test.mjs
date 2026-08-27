import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('verified release workflow is manual-only', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
});

test('restore mode preserves an existing verified tag and release', () => {
  assert.match(workflow, /restore_existing_verified:/);
  assert.match(workflow, /git ls-remote --exit-code --tags origin/);
  assert.match(workflow, /git rev-list -n 1 \"\$RELEASE_TAG\"/);
  assert.match(workflow, /gh release view \"\$RELEASE_TAG\"/);
  assert.match(workflow, /if: \$\{\{ !inputs\.restore_existing_verified \}\}/);
  assert.match(workflow, /without changing the tag or GitHub Release/);
});

test('verified deployment remains exact-SHA and live-checked', () => {
  assert.match(workflow, /ref: \$\{\{ inputs\.verified_commit \}\}/);
  assert.match(workflow, /ACTUAL_SHA=\"\$\(git rev-parse HEAD\)\"/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /release-candidate\.json/);
  assert.match(workflow, /npx playwright test/);
  assert.match(workflow, /confirm_verified/);
});
