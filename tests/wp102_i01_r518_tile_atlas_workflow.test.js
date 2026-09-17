const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const tool = fs.readFileSync(path.join(root, 'tools', 'tile_atlas_tool.py'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'tools', 'TILE_ATLAS_TOOL.md'), 'utf8');

assert.match(tool, /ATLAS_SIZE\s*=\s*1000/);
assert.match(tool, /GRID\s*=\s*10/);
assert.match(tool, /CELL_SIZE\s*=\s*100/);
assert.match(tool, /"ordering":\s*"row-major"/);
assert.match(tool, /"borderTrimPx":\s*0/);
assert.match(tool, /--stage-drive-root/);
assert.match(tool, /stage_result_to_mirror/);

for (const forbidden of [
  '--github-publish',
  'create_git_blob',
  'create_git_tree',
  'update_ref',
  'base64.b64encode',
]) {
  assert.ok(!tool.includes(forbidden), `worker-facing GitHub binary publication token remains: ${forbidden}`);
}

assert.match(docs, /Google Drive/);
assert.match(docs, /Admin performs the GitHub binary push/);
assert.match(docs, /1000x1000 RGBA/);
assert.match(docs, /10x10/);
assert.match(docs, /100x100 RGBA/);
assert.match(docs, /trim 0/i);
assert.ok(!docs.includes('--github-publish'), 'documentation must not advertise a removed GitHub publication option');
assert.ok(!docs.includes('WORKFLOW.md'), 'documentation must not depend on deleted WORKFLOW.md');
assert.ok(!docs.includes('.github/DRIVE_BINARY_FALLBACK.md'), 'documentation must not depend on deleted fallback governance');

console.log('PASS WP-102/I01-R518 tile atlas workflow governance');
