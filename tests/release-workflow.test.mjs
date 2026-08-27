import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('verified release workflow exposes manual fallback and reusable entry points only', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.match(workflow, /^\s+workflow_call:/m);
  assert.doesNotMatch(workflow, /^\s+issue_comment:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
});

test('manual and reusable paths preserve explicit verification inputs', () => {
  assert.match(workflow, /workflow_dispatch:[\s\S]*confirm_verified:/);
  assert.match(workflow, /workflow_call:[\s\S]*confirm_verified:/);
  assert.match(workflow, /CONFIRM_VERIFIED: \$\{\{ inputs\.confirm_verified \}\}/);
  assert.match(workflow, /Release blocked: independent verification was not explicitly confirmed/);
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
  assert.match(workflow, /Run regression test suite[\s\S]*npm test/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /release-candidate\.json/);
  assert.match(workflow, /npx playwright test/);
  assert.match(workflow, /Upload live release browser evidence/);
});

test('GitHub Release creation remains after live deployment verification', () => {
  const deployIndex = workflow.indexOf('Deploy exact verified artifact to GitHub Pages');
  const markerIndex = workflow.indexOf('Wait for exact verified Pages build');
  const browserIndex = workflow.indexOf('Verify deployed Pages browser and accessibility behavior');
  const createIndex = workflow.indexOf('Create verified GitHub Release');
  assert.ok(deployIndex >= 0 && markerIndex > deployIndex);
  assert.ok(browserIndex > markerIndex);
  assert.ok(createIndex > browserIndex);
});
