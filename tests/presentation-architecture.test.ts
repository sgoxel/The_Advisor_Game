import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SCALE_LADDER, HANDOFF_LOCAL_FOOTPRINT, HANDOFF_GLOBE_FOOTPRINT } from '../src/handoff.ts';
import {
  SETTLEMENT_ICON_FROM_SCALE, settlementSmallDetailsVisible,
  POLITICAL_BORDER_MAX_SCALE_DENOMINATOR, POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR,
} from '../src/political-presentation.ts';
import { roadRepresentationAtScale, forestBodiesVisibleAtScale, LOD_BLEND_SECONDS } from '../src/surface-presentation.ts';
import { closeLightingEnabled } from '../src/street-lighting.ts';

const docUrl = new URL('../docs/PRESENTATION_ARCHITECTURE.md', import.meta.url);
const doc = readFileSync(docUrl, 'utf8');
const docLines = doc.split('\n');

/** Lines under a `## ` heading, up to the next `## ` heading (exclusive). */
function sectionLines(heading: string): string[] {
  const start = docLines.findIndex((line) => line.startsWith(heading));
  assert.ok(start >= 0, `docs/PRESENTATION_ARCHITECTURE.md has no heading starting "${heading}"`);
  const body: string[] = [];
  for (let i = start + 1; i < docLines.length && !docLines[i].startsWith('## '); i++) body.push(docLines[i]);
  return body;
}

test('every SCALE_LADDER anchor is listed exactly once in the section 3 semantic-zoom matrix', () => {
  // Rows start with `|`; the separator starts with `|---`, so the filter cannot require `| `.
  const rows = sectionLines('## 3. Semantic-zoom matrix').filter((line) => line.startsWith('|'));
  assert.ok(rows.length > 2, 'section 3 matrix has a header, a separator and rows');
  assert.match(rows[0], /^\| d \(anchor\) \|/, 'first matrix row is the header');
  assert.match(rows[1], /^\|\s*:?-{3,}/, 'second matrix row is the |--- separator');

  const anchors: number[] = [];
  for (const row of rows.slice(2)) {
    const firstCell = row.split('|')[1].trim();
    for (const part of firstCell.split(',')) {
      const value = Number(part.trim());
      assert.ok(Number.isFinite(value) && part.trim() !== '', `matrix anchor "${part.trim()}" in row "${row}" is not a number`);
      anchors.push(value);
    }
  }

  assert.equal(new Set(anchors).size, anchors.length, `duplicate anchor in matrix: ${anchors.join(', ')}`);
  assert.deepEqual(
    [...anchors].sort((a, b) => a - b),
    [...SCALE_LADDER].sort((a, b) => a - b),
    'matrix anchors must equal SCALE_LADDER (src/handoff.ts) exactly; add or remove a row when the ladder changes',
  );
});

test('gate values stated in the presentation doc match the source constants', () => {
  assert.equal(SETTLEMENT_ICON_FROM_SCALE, 5);
  assert.equal(settlementSmallDetailsVisible(1), true);
  assert.equal(settlementSmallDetailsVisible(2), false);
  assert.equal(POLITICAL_BORDER_MAX_SCALE_DENOMINATOR, 1000);
  assert.equal(POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR, 1000);

  assert.equal(roadRepresentationAtScale(49), 'ground');
  assert.equal(roadRepresentationAtScale(50), 'cartographic');
  assert.equal(roadRepresentationAtScale(100), 'cartographic');
  assert.equal(roadRepresentationAtScale(101), 'hidden');
  assert.equal(forestBodiesVisibleAtScale(0.5), true);
  assert.equal(forestBodiesVisibleAtScale(1), false);
  assert.ok(LOD_BLEND_SECONDS > 0, 'LOD_BLEND_SECONDS must be positive');

  assert.equal(closeLightingEnabled(1), true);
  assert.equal(closeLightingEnabled(2), false);

  assert.equal(HANDOFF_LOCAL_FOOTPRINT, 127_420);
  assert.equal(HANDOFF_GLOBE_FOOTPRINT, 318_550);
});

test('presentation doc is still research-only and its terrain gap matches the source', () => {
  assert.ok(doc.includes('VISUAL: N/A'), 'doc must keep the status "VISUAL: N/A" (no visual PASS claimed)');

  const gapTable = sectionLines('## 1. ').join('\n');
  assert.ok(
    gapTable.includes('`useFog/useTonemap = false`') && gapTable.includes('**shadow catcher**'),
    'section 1 must describe terrain as emissive with lighting used only as a shadow catcher (useFog/useTonemap = false)',
  );

  const terrainSource = readFileSync(new URL('../src/surface-presentation.ts', import.meta.url), 'utf8');
  assert.ok(
    terrainSource.includes('material.shadowCatcher = true') && terrainSource.includes('material.diffuse.set(0, 0, 0)'),
    'src/surface-presentation.ts terrain is no longer an emissive shadow catcher (fully lit terrain?). ' +
      'Update docs/PRESENTATION_ARCHITECTURE.md section 1 (Terrain row, gap column) and the "research only" status line, then this assertion.',
  );
});

test('every src/*.ts path cited in backticks in the presentation doc exists on disk', () => {
  const cited = new Set<string>();
  for (const match of doc.matchAll(/`(src\/[A-Za-z0-9_\-/]+\.ts)`/g)) cited.add(match[1]);
  assert.ok(cited.size > 0, 'doc should cite at least one src/*.ts path');
  for (const path of cited) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `docs/PRESENTATION_ARCHITECTURE.md cites \`${path}\`, which does not exist`);
  }
});
