import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function waitForRng(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.RNG?.normalizeSeed &&
    window.Game?.RNG?.deriveSeed &&
    window.Game?.RNG?.createStream
  ));
}

test('equivalent SEED inputs canonicalize to identical deterministic streams', async ({ page }) => {
  await waitForRng(page);

  const result = await page.evaluate(() => {
    const RNG = window.Game.RNG;
    const inputs = [42, '42', '  42  ', '\t42\n'];
    const canonical = inputs.map((value) => RNG.normalizeSeed(value));
    const streams = inputs.map((value) => {
      const rng = RNG.createStream(value, 'authoritative-world');
      return [rng(), rng(), rng(), rng()];
    });

    const composed = 'Cafe\u0301';
    const precomposed = 'Caf\u00e9';
    const unicodeA = RNG.createStream(composed, 'world');
    const unicodeB = RNG.createStream(precomposed, 'world');

    return {
      canonical,
      streams,
      unicodeCanonicalEqual: RNG.normalizeSeed(composed) === RNG.normalizeSeed(precomposed),
      unicodeSequenceA: [unicodeA(), unicodeA(), unicodeA()],
      unicodeSequenceB: [unicodeB(), unicodeB(), unicodeB()],
      fallback: RNG.normalizeSeed('   ', ' SIMSOFT-001 ')
    };
  });

  expect(result.canonical).toEqual(['42', '42', '42', '42']);
  for (const stream of result.streams.slice(1)) expect(stream).toEqual(result.streams[0]);
  expect(result.unicodeCanonicalEqual).toBe(true);
  expect(result.unicodeSequenceA).toEqual(result.unicodeSequenceB);
  expect(result.fallback).toBe('SIMSOFT-001');
});

test('distinct seeds and stream keys produce distinct reproducible sequences', async ({ page }) => {
  await waitForRng(page);

  const result = await page.evaluate(() => {
    const RNG = window.Game.RNG;
    const sample = (seed, key) => {
      const rng = RNG.createStream(seed, key);
      return [rng(), rng(), rng(), rng(), rng()];
    };
    return {
      a1: sample('SIMSOFT-001', 'terrain'),
      a2: sample('SIMSOFT-001', 'terrain'),
      b: sample('SIMSOFT-002', 'terrain'),
      otherStream: sample('SIMSOFT-001', 'settlements'),
      derived: RNG.deriveSeed(' SIMSOFT-001 ', ' terrain ')
    };
  });

  expect(result.a1).toEqual(result.a2);
  expect(result.a1).not.toEqual(result.b);
  expect(result.a1).not.toEqual(result.otherStream);
  expect(result.derived).toBe('SIMSOFT-001|terrain');
});

test('existing canonical ASCII SEED sequences remain compatible', async ({ page }) => {
  await waitForRng(page);

  const result = await page.evaluate(() => {
    const RNG = window.Game.RNG;
    const base = RNG.createSeededRandom('SIMSOFT-001');
    const legacySettlementComposite = RNG.createSeededRandom('SIMSOFT-001|settlements');
    return {
      base: [base(), base(), base(), base(), base()],
      settlements: [legacySettlementComposite(), legacySettlementComposite(), legacySettlementComposite()],
      shapeNoise: RNG.hashNoise('SIMSOFT-001', 1, 2, 'shape-jitter|grass')
    };
  });

  expect(result.base).toEqual([
    0.6935764136724174,
    0.8397024634759873,
    0.49151112465187907,
    0.729884977452457,
    0.808938056929037
  ]);
  expect(result.settlements).toEqual([
    0.9531604025978595,
    0.34220383665524423,
    0.6118565059732646
  ]);
  expect(result.shapeNoise).toBe(0.014000639785081148);
});

test('authoritative generation sources contain no ambient nondeterministic RNG inputs', async () => {
  const authoritativeSources = [
    'js/rng.js',
    'js/terrain.js',
    'js/topology.js',
    'js/organic_elevation.js'
  ];
  const forbidden = [
    /Math\.random\s*\(/,
    /Date\.now\s*\(/,
    /performance\.now\s*\(/,
    /crypto\.getRandomValues\s*\(/
  ];

  for (const path of authoritativeSources) {
    const raw = fs.readFileSync(path, 'utf8');
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const pattern of forbidden) {
      expect(source, `${path} must not use ${pattern}`).not.toMatch(pattern);
    }
  }
});
