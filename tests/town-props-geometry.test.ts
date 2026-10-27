import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPropForTest, squareProgramFor} from '../src/geometry.ts';
import {assetVariants} from '../src/asset-meshes.ts';
import {metresToSource} from '../src/physical-scale.ts';

type Geo = ReturnType<typeof buildPropForTest>['closeDetail'];
const tris = (g: Geo) => g.indices.length / 3;
const base = {x: 0, y: 0, z: 0, code: 'TEST'};
/** Local-metre bounds of a geometry after undoing the feature yaw. */
function localBounds(g: Geo, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw), b = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity};
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2], lx = x * c - z * s, lz = x * s + z * c;
    b.minX = Math.min(b.minX, lx); b.maxX = Math.max(b.maxX, lx); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); b.minZ = Math.min(b.minZ, lz); b.maxZ = Math.max(b.maxZ, lz);
  }
  return b;
}
function assertInside(g: Geo, yaw: number, w: number, d: number, label: string, front = 0, margin = .5, maxHeight = 3.6) {
  const b = localBounds(g, yaw);
  assert.ok(b.minX >= -w / 2 - margin && b.maxX <= w / 2 + margin, `${label}: x ${b.minX.toFixed(2)}..${b.maxX.toFixed(2)} outside ±${w / 2}`);
  assert.ok(b.minZ >= -d / 2 - margin && b.maxZ <= d / 2 + front + margin, `${label}: z ${b.minZ.toFixed(2)}..${b.maxZ.toFixed(2)} outside footprint`);
  assert.ok(b.minY >= -.3 && b.maxY <= maxHeight, `${label}: y ${b.minY.toFixed(2)}..${b.maxY.toFixed(2)}`);
}
function finite(g: Geo) {
  assert.ok(g.positions.every(Number.isFinite) && g.normals.every(Number.isFinite));
  for (let i = 0; i < g.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]) - 1) < 1e-3, 'unit normals');
}

const cases = [
  {label: 'bench', feature: {...base, kind: 'bench', widthM: 1.8, depthM: .6, variant: 3}, w: 1.8, d: .6, budget: 60},
  {label: 'planter', feature: {...base, kind: 'planter', widthM: 1.4, depthM: .7, variant: 11}, w: 1.4, d: .7, budget: 60},
  {label: 'city square', feature: {...base, kind: 'park', label: 'square', widthM: 32, depthM: 24, variant: 7}, w: 32, d: 24, budget: 2600},
  {label: 'village square', feature: {...base, kind: 'park', label: 'square', widthM: 24, depthM: 18, variant: 4, parkShape: 'octagon'}, w: 24, d: 18, budget: 2600},
  {label: 'playground', feature: {...base, kind: 'park', label: 'playground', widthM: 16, depthM: 12, variant: 21}, w: 16, d: 12, budget: 1500},
  {label: 'flower garden', feature: {...base, kind: 'park', label: 'flower-garden', widthM: 12, depthM: 9, variant: 5, parkShape: 'round'}, w: 12, d: 9, budget: 1500},
  {label: 'city bazaar', feature: {...base, kind: 'service', service: 'market', widthM: 28, depthM: 20, variant: 99}, w: 28, d: 20, budget: 1500},
  {label: 'village bazaar', feature: {...base, kind: 'service', service: 'market', widthM: 18, depthM: 13, variant: 98}, w: 18, d: 13, budget: 1500},
  {label: 'city inn', feature: {...base, kind: 'service', service: 'inn', widthM: 17, depthM: 19, variant: 12}, w: 17, d: 19, front: 4.5, budget: 1500},
  {label: 'village inn', feature: {...base, kind: 'service', service: 'inn', widthM: 13, depthM: 16, variant: 13}, w: 13, d: 16, front: 4.5, budget: 1500},
  {label: 'cafe', feature: {...base, kind: 'residence', shop: 'cafe', widthM: 7, depthM: 9, variant: 2, house: {wallHeightM: 2.8, storeys: 1}}, w: 7, d: 9, front: 2.1, budget: 1500},
  {label: 'restaurant', feature: {...base, kind: 'residence', shop: 'restaurant', widthM: 6, depthM: 8, variant: 9, house: {wallHeightM: 3, storeys: 1}}, w: 6, d: 8, front: 2.1, budget: 1500},
];

test('town props: every new kind draws close-zoom geometry inside its footprint and within budget', () => {
  const report: string[] = [];
  for (const {label, feature, w, d, front, budget} of cases) for (const yaw of [0, .7, -2.1]) {
    const layers = buildPropForTest({...feature, yawRad: yaw}), close = layers.closeDetail;
    assert.ok(tris(close) > 0, `${label}: empty closeDetail`);
    finite(close);
    // Squares carry 5 m shade trees; everything else stays under 3.6 m.
    assertInside(close, yaw, w, d, label, front ?? 0, .5, label.endsWith('square') ? 5.2 : 3.6);
    if (feature.kind === 'park') { assert.ok(tris(layers.structures) > 0, `${label}: ground pad`); assertInside(layers.structures, yaw, w, d, `${label} ground`, 0, .01); }
    // Windows (residence/service façade) are pre-existing; budget the new props only.
    const windows = feature.kind === 'park' || ['bench', 'planter'].includes(feature.kind) || feature.service === 'market' ? 0 : tris(buildPropForTest({...feature, shop: undefined, service: feature.service === 'inn' ? 'inn-plain' : feature.service, yawRad: yaw}).closeDetail);
    const props = tris(close) - windows;
    assert.ok(props > 0 && props <= budget, `${label}: ${props} triangles > ${budget}`);
    if (yaw === 0) report.push(`${label}=${props}`);
  }
  console.log('TOWN_PROP_TRIANGLES', report.join(' '));
});

test('town props: café terraces keep the door clear and inn terraces keep the path clear', () => {
  for (const shop of ['cafe', 'restaurant']) {
    const g = buildPropForTest({...base, kind: 'residence', shop, widthM: 7, depthM: 9, variant: 4, house: {wallHeightM: 2.8, storeys: 1}}).closeDetail;
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      if (z > 4.5 + .45 && y < 2.0) assert.ok(Math.abs(x) >= .8, `${shop}: prop at door x=${x.toFixed(2)} z=${z.toFixed(2)}`);
    }
  }
  for (const [w, d] of [[17, 19], [13, 16]]) {
    const g = buildPropForTest({...base, kind: 'service', service: 'inn', widthM: w, depthM: d, variant: 5}).closeDetail;
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      if (z > d / 2 + .5 && y < 1.9) assert.ok(Math.abs(x) >= 1.4 - 1e-6, `inn: terrace in path x=${x.toFixed(2)}`);
    }
  }
});

test('town props: output is deterministic and seeded by variant', () => {
  for (const {feature} of cases) {
    const a = buildPropForTest({...feature, yawRad: .4}), b = buildPropForTest({...feature, yawRad: .4});
    assert.deepEqual(a.closeDetail, b.closeDetail);
    assert.deepEqual(a.structures, b.structures);
  }
  const one = buildPropForTest({...base, kind: 'planter', widthM: 1.4, depthM: .7, variant: 1}).closeDetail,
    other = buildPropForTest({...base, kind: 'planter', widthM: 1.4, depthM: .7, variant: 2}).closeDetail;
  assert.notDeepEqual(one.colors, other.colors);
});

test('town props: small props exist only at close zoom; street joints stay flat and pavements belong to the street', () => {
  for (const {feature} of cases) assert.equal(tris(buildPropForTest({...feature, shop: undefined}, 16).closeDetail), 0);
  const width = metresToSource(6), joint = buildPropForTest({...base, kind: 'street-joint', footprintWidth: width, yawRad: .3, variant: 0}, 64).structures;
  assert.equal(tris(joint), 10);
  for (let i = 0; i < joint.positions.length; i += 3) {
    assert.ok(Math.abs(joint.positions[i + 1] - .093) < 1e-6);
    assert.ok(Math.hypot(joint.positions[i], joint.positions[i + 2]) <= width / 2 * (1 + 1e-5));
    assert.ok(joint.normals[i + 1] > .999, 'joint faces up');
  }
  const pavementWidth = metresToSource(1.8), street = buildPropForTest({...base, kind: 'street', footprintWidth: width, length: metresToSource(10), yawRad: 0, variant: 0, pavementWidth}, 64).structures,
    plain = buildPropForTest({...base, kind: 'street', footprintWidth: width, length: metresToSource(10), yawRad: 0, variant: 0}, 64).structures;
  assert.equal(tris(street), 2 * tris(plain), 'a paved street adds one pavement slab under the road');
  const xs = [...street.positions].filter((_, i) => i % 3 === 0);
  assert.ok(Math.abs(Math.max(...xs) - (width / 2 + pavementWidth)) < 1e-6, 'pavement reaches its full width on each side');
  const pavedJoint = buildPropForTest({...base, kind: 'street-joint', footprintWidth: width, yawRad: .3, variant: 0, pavementWidth}, 64).structures;
  assert.equal(tris(pavedJoint), 20);
  // The pavement sits clearly below the road (road top .093): slab and joint disc tops at .05.
  const topOf = (g: Geo, lowest: number) => { let top = -Infinity; for (let i = 1; i < g.positions.length; i += 3) if (g.positions[i] > lowest) top = Math.max(top, g.positions[i]); return top; };
  const roadTops = new Set<number>(), allTops = new Set<number>();
  for (let i = 1; i < street.positions.length; i += 3) allTops.add(Math.round(street.positions[i] * 1e4) / 1e4);
  for (let i = 1; i < plain.positions.length; i += 3) roadTops.add(Math.round(plain.positions[i] * 1e4) / 1e4);
  assert.equal(Math.max(...roadTops), .093, 'road top');
  assert.equal(Math.max(...[...allTops].filter((y) => !roadTops.has(y))), .05, 'pavement slab top at .05');
  const plainJoint = new Set<number>(), jointY = new Set<number>();
  for (let i = 1; i < joint.positions.length; i += 3) plainJoint.add(Math.round(joint.positions[i] * 1e4) / 1e4);
  for (let i = 1; i < pavedJoint.positions.length; i += 3) jointY.add(Math.round(pavedJoint.positions[i] * 1e4) / 1e4);
  assert.deepEqual([...jointY].filter((y) => !plainJoint.has(y)), [.05], 'pavement joint disc at .05');
  assert.ok(topOf(street, -1) - .05 > .04, 'pavement stays well under the road');
});

test('town props: the market canopy only draws at far zoom, so the close-up bazaar stays visible', () => {
  const market = {...base, kind: 'service', service: 'market', widthM: 28, depthM: 20, variant: 99, yawRad: .3};
  const maxY = (g: Geo) => { let m = -Infinity; for (let i = 1; i < g.positions.length; i += 3) m = Math.max(m, g.positions[i]); return m; };
  const close = buildPropForTest(market, 8), far = buildPropForTest(market, 64);
  assert.ok(maxY(close.structures) < 3, `close market structures reach y=${maxY(close.structures)}`);
  assert.equal(close.detail.positions.length, 0, 'no canopy posts at close zoom');
  assert.ok(tris(close.structures) > 0, 'low platform kept');
  assert.ok(maxY(far.structures) > 3, 'far-zoom canopy kept');
  assert.ok(tris(far.detail) > 0, 'far-zoom canopy posts kept');
  assert.ok(tris(close.closeDetail) > 0, 'bazaar stalls drawn');
});

// ---------------------------------------------------------------------------------------------
// Seeded park outlines and sizes. The outline is defined here independently of src/geometry.ts:
// rect = the full rectangle; cut/octagon = the rectangle with 45° chamfers of 18 % / 29 % of the short
// side; round = the inscribed ellipse.
// ---------------------------------------------------------------------------------------------
const SHAPES = ['rect', 'cut', 'octagon', 'round'] as const;
const PARKS = [
  {label: 'square', width: [16, 38], depth: [12, 28], budget: 2600, maxHeight: 5.2},
  {label: 'playground', width: [11, 20], depth: [9, 15], budget: 1500, maxHeight: 3.6},
  {label: 'flower-garden', width: [8, 16], depth: [6, 12], budget: 1500, maxHeight: 3.6},
] as const;
/** How far local (x, z) lies outside the outline (0 when inside). */
function outside(shape: string, w: number, d: number, x: number, z: number) {
  const hw = w / 2, hd = d / 2;
  if (shape === 'round') { const k = Math.hypot(x / hw, z / hd); return k <= 1 ? 0 : (k - 1) * Math.min(hw, hd); }
  let out = Math.max(0, Math.abs(x) - hw, Math.abs(z) - hd);
  if (shape !== 'rect') out = Math.max(out, (Math.abs(x) + Math.abs(z) - (hw + hd - (shape === 'cut' ? .18 : .29) * Math.min(w, d))) / Math.SQRT2);
  return out;
}
function worstOutside(g: Geo, yaw: number, shape: string, w: number, d: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let worst = 0;
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i], z = g.positions[i + 2];
    worst = Math.max(worst, outside(shape, w, d, x * c - z * s, x * s + z * c));
  }
  return worst;
}
const park = (label: string, shape: string, w: number, d: number, variant: number, yawRad = 0) => buildPropForTest({...base, kind: 'park', label, parkShape: shape, widthM: w, depthM: d, variant, yawRad});

test('parks: every label x shape x size keeps its pad and props inside the seeded outline and within budget', () => {
  const report: string[] = [];
  for (const {label, width, depth, budget, maxHeight} of PARKS) for (const shape of SHAPES) for (const t of [0, .5, 1]) for (const yaw of [0, .7, -2.1]) {
    const w = width[0] + (width[1] - width[0]) * t, d = depth[0] + (depth[1] - depth[0]) * t, variant = 3 + Math.round(t * 10) + (yaw > 0 ? 17 : 0),
      layers = park(label, shape, w, d, variant, yaw), name = `${label} ${shape} ${w}x${d} yaw ${yaw}`;
    assert.ok(tris(layers.structures) > 0 && tris(layers.closeDetail) > 0, `${name}: pad and props drawn`);
    finite(layers.closeDetail);
    const props = worstOutside(layers.closeDetail, yaw, shape, w, d), pad = worstOutside(layers.structures, yaw, shape, w, d);
    assert.ok(props <= .5, `${name}: a prop vertex lies ${props.toFixed(2)} m outside the outline`);
    assert.ok(pad <= .5, `${name}: a ground vertex lies ${pad.toFixed(2)} m outside the outline`);
    const b = localBounds(layers.closeDetail, yaw);
    assert.ok(b.minY >= -.3 && b.maxY <= maxHeight, `${name}: y ${b.minY.toFixed(2)}..${b.maxY.toFixed(2)}`);
    assert.ok(tris(layers.closeDetail) < budget, `${name}: ${tris(layers.closeDetail)} triangles >= ${budget}`);
    if (yaw === 0) report.push(`${label}/${shape}/${w}x${d}=${tris(layers.closeDetail)}`);
  }
  console.log('PARK_TRIANGLES', report.join(' '));
});

test('parks: output is deterministic per variant and the layout varies with the seed', () => {
  for (const {label, width, depth} of PARKS) for (const shape of SHAPES) {
    const w = (width[0] + width[1]) / 2, d = (depth[0] + depth[1]) / 2, a = park(label, shape, w, d, 11, .4), b = park(label, shape, w, d, 11, .4);
    assert.deepEqual(a.closeDetail, b.closeDetail, `${label} ${shape}: closeDetail deterministic`);
    assert.deepEqual(a.structures, b.structures, `${label} ${shape}: structures deterministic`);
    const variants = new Set([1, 2, 4, 6, 9, 12].map((v) => Buffer.from(park(label, shape, w, d, v).closeDetail.positions.buffer).toString('base64')));
    assert.ok(variants.size >= 2, `${label} ${shape}: the seed changes the layout`);
  }
});

test('parks: each shape draws its own ground outline', () => {
  for (const {label, width, depth} of PARKS) {
    const w = width[1], d = depth[1], pads = SHAPES.map((shape) => park(label, shape, w, d, 5).structures);
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) assert.notDeepEqual(pads[i].positions, pads[j].positions, `${label}: ${SHAPES[i]} vs ${SHAPES[j]}`);
    pads.forEach((pad, k) => {
      const shape = SHAPES[k], xz: [number, number][] = [];
      for (let i = 0; i < pad.positions.length; i += 3) xz.push([pad.positions[i], pad.positions[i + 2]]);
      const near = (x: number, z: number) => xz.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1e-3);
      // The pad reaches the outline: the rectangle corner only for rect, the side midpoints for the ellipse.
      assert.equal(near(w / 2, d / 2), shape === 'rect', `${label} ${shape}: corner vertex`);
      if (shape === 'round') assert.ok(near(w / 2, 0) && near(0, d / 2) && near(-w / 2, 0) && near(0, -d / 2), `${label} round: ellipse extremes`);
      if (shape === 'cut' || shape === 'octagon') {
        const c = (shape === 'cut' ? .18 : .29) * Math.min(w, d);
        assert.ok(near(w / 2 - c, d / 2) && near(w / 2, d / 2 - c), `${label} ${shape}: chamfer ${c.toFixed(2)} m`);
      }
      // Pad tops are flat and never coplanar between layers (square: kerb band .06 under the field at .07).
      const tops = new Set<number>();
      for (let i = 1; i < pad.positions.length; i += 3) if (pad.normals[i] > .999) tops.add(Math.round(pad.positions[i] * 1e4) / 1e4);
      if (label === 'square') assert.deepEqual([...tops].sort(), [.06, .07]);
    });
    // A missing shape draws the plain rectangle.
    assert.deepEqual(buildPropForTest({...base, kind: 'park', label, widthM: w, depthM: d, variant: 5}).structures, pads[0]);
  }
});

test('parks: playground equipment scales with size and fences/hedges leave the street entrance open', () => {
  const small = park('playground', 'rect', 11, 9, 4).closeDetail, large = park('playground', 'rect', 20, 15, 4).closeDetail;
  assert.ok(tris(large) > tris(small) + 150, `large playground adds a slide and see-saw (${tris(small)} -> ${tris(large)})`);
  for (const [label, shape, w, d] of [['playground', 'rect', 16, 12], ['playground', 'cut', 11, 9], ['playground', 'round', 14, 11], ['flower-garden', 'rect', 12, 9], ['flower-garden', 'octagon', 16, 12], ['flower-garden', 'round', 8, 6]] as const) {
    const g = park(label, shape, w, d, 8).closeDetail;
    // Nothing taller than a few cm stands in the 2.4 m entrance at the front edge (end posts/hedge ends may lean in by their half-thickness).
    let front = 0;
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      if (z > d / 2 - .45 && y > .2) { front++; assert.ok(Math.abs(x) >= 1.05, `${label} ${shape}: entrance blocked at x=${x.toFixed(2)} z=${z.toFixed(2)}`); }
    }
    assert.ok(front > 0, `${label} ${shape}: the fence/hedge runs along the front edge`);
  }
});

// ---------------------------------------------------------------------------------------------
// Square composition, café parasols, garden paths/beds, bazaar paving and the playground tree.
// ---------------------------------------------------------------------------------------------
const CENTRES = ['fountain', 'statue', 'market-cross', 'well', 'tree'];
/** Triangles of one exact vertex colour. */
function trisOfColour(g: Geo, rgb: readonly number[]) {
  const out: [number, number, number][] = [];
  for (let t = 0; t < g.indices.length; t += 3) {
    const a = g.indices[t];
    if (g.colors[a * 4] === rgb[0] && g.colors[a * 4 + 1] === rgb[1] && g.colors[a * 4 + 2] === rgb[2]) {
      const c = [0, 1, 2].map((k) => (g.positions[g.indices[t] * 3 + k] + g.positions[g.indices[t + 1] * 3 + k] + g.positions[g.indices[t + 2] * 3 + k]) / 3);
      out.push([c[0], c[1], c[2]]);
    }
  }
  return out;
}

test('squares: the seeded programme varies the centrepiece and the programme around it', () => {
  const programmes = (w: number, d: number, shape: string) => Array.from({length: 32}, (_, v) => squareProgramFor(v, w, d, shape));
  const city = programmes(32, 24, 'rect'), village = programmes(20, 15, 'octagon');
  const cityCentres = new Set(city.map((p) => p.centre)), villageCentres = new Set(village.map((p) => p.centre));
  assert.ok(cityCentres.size >= 4, `city centrepieces: ${[...cityCentres]}`);
  assert.ok(villageCentres.size >= 3, `village centrepieces: ${[...villageCentres]}`);
  assert.deepEqual(new Set([...cityCentres, ...villageCentres]), new Set(CENTRES), 'every centrepiece type appears');
  // City squares lean civic, village squares rustic.
  assert.ok(city.filter((p) => p.centre === 'fountain' || p.centre === 'statue').length > 16, 'city: mostly fountains and statues');
  assert.ok(village.filter((p) => ['well', 'tree', 'market-cross'].includes(p.centre)).length > 24, 'village: mostly wells, trees and crosses');
  assert.ok(city.every((p) => p.civic) && village.every((p) => !p.civic));
  for (const all of [city, village]) {
    assert.ok(all.some((p) => p.decks === 0) && all.some((p) => p.decks === 2), 'some squares have no café deck, some two');
    assert.ok(all.some((p) => p.stalls >= 2) && all.some((p) => p.stalls === 0), 'some squares have market stalls');
    assert.ok(new Set(all.map((p) => p.trees)).size >= 3, 'tree layouts vary');
    assert.ok(all.some((p) => p.lamps > 0) && all.some((p) => p.greenery === 'beds') && all.some((p) => p.greenery === 'planters'));
    for (const p of all) {
      assert.ok(p.stalls === 0 || (p.stalls >= 2 && p.stalls <= 4 && p.decks < 2), 'stalls (2-4) only beside fewer than two decks');
      assert.ok(p.centre !== 'tree' || (p.trees === 'none' && !p.benchRing), 'the seat tree stands alone');
    }
  }
  assert.deepEqual(squareProgramFor(77, 30, 22, 'cut'), squareProgramFor(77, 30, 22, 'cut'), 'pure');
});

test('squares: each centrepiece draws its own landmark, and every variant stays inside its outline and budget', () => {
  // A variant for each centrepiece on a 30 x 22 square (city lean) or 20 x 15 (village lean for the seat tree and well).
  const found = new Map<string, {v: number; w: number; d: number}>();
  for (let v = 0; v < 256 && found.size < CENTRES.length; v++) for (const [w, d] of [[30, 22], [20, 15]]) {
    const p = squareProgramFor(v, w, d, 'rect');
    if (!found.has(p.centre) && !(p.centre === 'statue' && p.obelisk)) found.set(p.centre, {v, w, d});
  }
  assert.equal(found.size, CENTRES.length);
  const signature: Record<string, number[]> = {fountain: [70, 120, 150], statue: [86, 108, 94], well: [48, 78, 96]};
  for (const [centre, {v, w, d}] of found) {
    const g = park('square', 'rect', w, d, v).closeDetail, maxY = localBounds(g, 0).maxY;
    if (signature[centre]) assert.ok(trisOfColour(g, signature[centre]).length > 0, `${centre}: landmark drawn`);
    if (centre === 'market-cross' || centre === 'tree') assert.ok(maxY > 4.2, `${centre}: tall landmark (${maxY.toFixed(2)} m)`);
  }
  const report: string[] = [];
  for (const shape of SHAPES) for (const [w, d] of [[16, 12], [24, 18], [38, 28]]) {
    let most = 0;
    for (let v = 0; v < 32; v++) {
      const layers = park('square', shape, w, d, v), close = layers.closeDetail, name = `square ${shape} ${w}x${d} v${v}`, b = localBounds(close, 0);
      assert.ok(worstOutside(close, 0, shape, w, d) <= .5, `${name}: a prop lies outside the outline`);
      assert.ok(b.minY >= -.3 && b.maxY <= 5.2, `${name}: y ${b.minY.toFixed(2)}..${b.maxY.toFixed(2)}`);
      assert.ok(tris(close) < 2600, `${name}: ${tris(close)} triangles`);
      most = Math.max(most, tris(close));
    }
    report.push(`${shape}/${w}x${d}<=${most}`);
  }
  console.log('SQUARE_VARIANT_MAX_TRIANGLES', report.join(' '));
});

test('cafés: parasols shade the terrace tables, inside the terrace and clear of the door', () => {
  for (const w of [4.6, 5.4, 6.2, 7, 8]) for (const variant of [1, 2, 3]) {
    const d = 9, front = d / 2, g = buildPropForTest({...base, kind: 'residence', shop: 'cafe', widthM: w, depthM: d, variant, house: {wallHeightM: 2.8, storeys: 1}}).closeDetail;
    const apexes = new Set<number>();
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      if (z > front + .45 && y < 2.0) assert.ok(Math.abs(x) >= .8, `café ${w} m: prop at the door x=${x.toFixed(2)}`);
      if (z > front + .3) assert.ok(Math.abs(x) <= w / 2 + .5 && z <= front + 2.6, `café ${w} m: terrace prop outside x=${x.toFixed(2)} z=${z.toFixed(2)}`);
      if (Math.abs(y - 2.3) < 1e-6 && z > front + 1) apexes.add(Math.round(x * 100));
    }
    assert.ok(apexes.size >= 2, `café ${w} m v${variant}: ${apexes.size} parasols`);
    assert.ok([...apexes].every(x => Math.abs(x) >= 170),
      `café ${w} m v${variant}: a canopy is centered over the owned home entrance`);
  }
});

/** The flower colours of src/geometry.ts (blossom caps), defined here independently. */
const FLOWER_RGB = [[198, 52, 48], [232, 196, 60], [126, 74, 160], [236, 232, 222], [226, 120, 160], [230, 130, 50]];
const blossoms = (g: Geo) => FLOWER_RGB.flatMap((rgb) => trisOfColour(g, rgb));

test('flower gardens: the hedge entrance sits where the main path meets the street side; the paths stop short of the hedge', () => {
  for (const shape of ['rect', 'round', 'octagon']) for (const [w, d] of [[8, 6], [12, 9], [16, 12], [14, 7]]) for (const variant of [2, 5, 8]) {
    const layers = park('flower-garden', shape, w, d, variant), name = `garden ${shape} ${w}x${d} v${variant}`;
    // Ground: the main path (top .09) and the cross path (top .08) are told apart by their top height.
    const main: [number, number][] = [], cross: [number, number][] = [], g = layers.structures;
    for (let i = 0; i < g.positions.length; i += 3) if (g.normals[i + 1] > .999) {
      const y = Math.round(g.positions[i + 1] * 1e4) / 1e4;
      if (y === .09) main.push([g.positions[i], g.positions[i + 2]]); else if (y === .08) cross.push([g.positions[i], g.positions[i + 2]]);
    }
    assert.ok(main.length > 0, `${name}: main path`);
    const pathEnd = Math.max(...main.map((p) => p[1])), pathHalf = Math.max(...main.map((p) => Math.abs(p[0])));
    assert.ok(pathEnd >= d / 2 - .25, `${name}: the main path reaches the street side (${pathEnd.toFixed(2)})`);
    assert.ok(Math.min(...main.map((p) => p[1])) >= -d / 2 + 1, `${name}: the main path stops short of the rear hedge`);
    if (cross.length) assert.ok(Math.max(...cross.map((p) => Math.abs(p[0]))) <= w / 2 - .9, `${name}: the cross path stops short of the side hedges`);
    // Hedge (colour 58,102,52): nothing within the gap at the street side, and the gap (>= 1.6 m) is centred on the path end.
    const hedge = trisOfColour(layers.closeDetail, [58, 102, 52]);
    assert.ok(hedge.length > 0, `${name}: hedge drawn`);
    const c = layers.closeDetail;
    let nearest = Infinity;
    for (let i = 0; i < c.positions.length; i += 3) {
      const a = i / 3, x = c.positions[i], z = c.positions[i + 2];
      if (c.colors[a * 4] === 58 && c.colors[a * 4 + 1] === 102 && c.colors[a * 4 + 2] === 52 && z > pathEnd - 1.2) nearest = Math.min(nearest, Math.abs(x));
    }
    assert.ok(nearest >= Math.max(.8, pathHalf + .2), `${name}: hedge ${nearest.toFixed(2)} m from the path axis at the entrance`);
    assert.ok(nearest < 1.6, `${name}: the hedge closes beside the entrance (${nearest.toFixed(2)})`);
  }
});

test('flower gardens: beds are densely planted (>= 12 clumps per standard bed)', () => {
  // Quadrant layout (rect 12 x 9, variant 8) and ring layout (round 12 x 9, variant 5): one bed per quadrant plus a centre bed.
  for (const [shape, variant, centreMin] of [['rect', 8, 7], ['round', 5, 12], ['octagon', 8, 12]] as const) {
    const g = park('flower-garden', shape, 12, 9, variant).closeDetail, caps = blossoms(g), name = `garden ${shape} v${variant}`;
    // A blossom cap is 4 triangles.
    const centre = caps.filter(([x, , z]) => Math.abs(x) < 1.3 && Math.abs(z) < 1.3).length / 4;
    assert.ok(centre >= centreMin, `${name}: centre bed ${centre} clumps`);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const n = caps.filter(([x, , z]) => x * sx > 0 && z * sz > 0 && !(Math.abs(x) < 1.3 && Math.abs(z) < 1.3)).length / 4;
      assert.ok(n >= 12, `${name}: quadrant ${sx},${sz} bed has ${n} clumps`);
    }
  }
  // Seeded colours: two variants plant different colours.
  const colours = (v: number) => FLOWER_RGB.map((rgb) => trisOfColour(park('flower-garden', 'rect', 12, 9, v).closeDetail, rgb).length).join(',');
  assert.notEqual(colours(8), colours(12));
});

test('bazaar: the market ground carries flat paving bands and joints above the platform, never coplanar with it', () => {
  for (const [w, d] of [[28, 20], [18, 13]]) {
    const g = buildPropForTest({...base, kind: 'service', service: 'market', widthM: w, depthM: d, variant: 7}).closeDetail, levels = new Map<number, number>();
    for (let t = 0; t < g.indices.length; t += 3) {
      const ys = [0, 1, 2].map((k) => g.positions[g.indices[t + k] * 3 + 1]);
      if (Math.max(...ys) > .2) continue;
      assert.ok(ys.every((y) => Math.abs(y - ys[0]) < 1e-6) && g.normals[g.indices[t] * 3 + 1] > .999, 'paving is flat and faces up');
      const y = Math.round(ys[0] * 1e4) / 1e4;
      levels.set(y, (levels.get(y) ?? 0) + 1);
      for (const k of [0, 1, 2]) {
        const x = g.positions[g.indices[t + k] * 3], z = g.positions[g.indices[t + k] * 3 + 2];
        assert.ok(Math.abs(x) <= w / 2 && Math.abs(z) <= d / 2, `paving inside the platform (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    assert.deepEqual([...levels.keys()].sort(), [.182, .186, .19], `${w}x${d}: paving levels ${[...levels.keys()]}`);
    assert.ok((levels.get(.19) ?? 0) >= 20, 'a grid of joints');
  }
});

test('playgrounds: the shade tree stands >= 1.2 m inside the fence', () => {
  /** Distance from local (x, z) to the fence (the outline inset .15 m); positive inside. */
  const toFence = (shape: string, w: number, d: number, x: number, z: number) => {
    const hw = w / 2, hd = d / 2;
    let inside = Math.min(hw - Math.abs(x), hd - Math.abs(z));
    if (shape === 'cut') inside = Math.min(inside, (hw + hd - .18 * Math.min(w, d) - Math.abs(x) - Math.abs(z)) / Math.SQRT2);
    return inside - .15;
  };
  for (const shape of ['rect', 'cut']) for (const [w, d] of [[11, 9], [14, 11], [16, 12], [20, 15]]) for (let variant = 0; variant < 12; variant++) {
    const g = park('playground', shape, w, d, variant).closeDetail;
    // Only the tree rises above 2.4 m (its two crown apexes, over the trunk).
    const tops: [number, number][] = [];
    for (let i = 0; i < g.positions.length; i += 3) if (g.positions[i + 1] > 2.4) tops.push([g.positions[i], g.positions[i + 2]]);
    assert.ok(tops.length > 0, `playground ${shape} ${w}x${d} v${variant}: tree planted`);
    for (const [x, z] of tops) assert.ok(toFence(shape, w, d, x, z) >= 1.2, `playground ${shape} ${w}x${d} v${variant}: tree ${toFence(shape, w, d, x, z).toFixed(2)} m from the fence`);
  }
});

test('yard objects stay inside their footprint, within budget, close-up only and deterministic', () => {
  const SIZES: Record<string, [number, number]> = { woodpile: [1.9, 1.1], barrels: [1.3, .9], cart: [1.5, 2.4], washline: [3.2, .5], coop: [2.6, 2.2], 'door-bench': [2.6, .6] };
  for (const [label, [w, d]] of Object.entries(SIZES)) for (const variant of [1, 7, 42, 999]) for (const yawRad of [0, .7, -2.1]) {
    const g = buildPropForTest({...base, kind: 'yard-prop', label, widthM: w, depthM: d, variant, yawRad});
    // Procedural kits stay under 120 triangles; a loaded Blender model (src/models) is drawn exactly.
    const model = assetVariants(label).reduce((top, m) => top && top.triangles > m.triangles ? top : m, undefined as undefined | {triangles: number});
    assert.ok(tris(g.closeDetail) > 0 && tris(g.closeDetail) <= (model ? model.triangles : 120), `${label}: ${tris(g.closeDetail)} triangles`);
    assertInside(g.closeDetail, yawRad, w, d, `${label} v${variant}`, 0, .15, 2.2);
    finite(g.closeDetail);
    assert.equal(tris(buildPropForTest({...base, kind: 'yard-prop', label, widthM: w, depthM: d, variant, yawRad}, 16).closeDetail), 0, `${label} is close-up only`);
    assert.deepEqual(g.closeDetail.positions, buildPropForTest({...base, kind: 'yard-prop', label, widthM: w, depthM: d, variant, yawRad}).closeDetail.positions);
  }
});
