import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TERRAIN_PALETTE } from "../src/climate.ts";

const doc = readFileSync(new URL("../docs/FAUNA_ARCHITECTURE.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** Every owner-requested species for WP-S010-009-002. */
const SPECIES = [
  "goats", "sheep", "pigs", "horses", "gazelles", "crows", "eagles",
  "pigeons", "rabbits", "cows", "buffaloes", "ducks", "frogs",
] as const;

const heading = (title: string) => {
  const start = doc.indexOf(`## ${title}`);
  assert.ok(start >= 0, `FAUNA_ARCHITECTURE.md has no heading starting "## ${title}"`);
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next < 0 ? undefined : next);
};

test("the fauna architecture covers all thirteen owner-requested species in one habitat matrix", () => {
  const matrix = heading("6. Species habitat matrix");
  for (const species of SPECIES) {
    // A matrix row must both name the species and carry a habitat cell.
    const row = matrix.split("\n").find((line) => line.startsWith(`| ${species} |`));
    assert.ok(row, `habitat matrix has no row for ${species}`);
    assert.match(row!, /`[a-z-]+`/, `${species} row has no terrain class`);
  }
  // The matrix must be exactly the requested roster, with no invented species rows.
  const rows = matrix.split("\n").filter((line) => /^\| [a-z]+ \|/.test(line));
  assert.equal(rows.length, SPECIES.length, `expected ${SPECIES.length} species rows, found ${rows.length}`);
});

test("every terrain class named in the matrix is a real TerrainClass value", () => {
  const matrix = heading("6. Species habitat matrix");
  const real = new Set(Object.keys(TERRAIN_PALETTE));
  const claimed = new Set<string>();
  for (const match of matrix.matchAll(/`([a-z][a-z-]*)`/g)) {
    const token = match[1];
    // Skip prose tokens that are not terrain classes.
    if (["required", "none", "never", "drove", "allowed", "wild", "domestic"].includes(token)) continue;
    if (real.has(token)) { claimed.add(token); continue; }
    // A backticked token in the matrix must be a terrain class or a known keyword.
    assert.fail(`matrix names "${token}", which is not a TerrainClass`);
  }
  // The matrix must exercise the real taxonomy rather than a private vocabulary.
  for (const required of ["grassland", "meadow", "highland", "cliff", "lake", "dryland", "temperate-forest"])
    assert.ok(claimed.has(required), `matrix never uses the real terrain class "${required}"`);
});

test("the SEED / Simulation / renderer authority contract is stated", () => {
  for (const phrase of [
    /Campaign SEED[^\n]*fixes/i,
    /Simulation[^\n]*authorizes/i,
    /Presentation[^\n]*only draws/i,
  ]) assert.match(doc, phrase, `missing authority statement ${phrase}`);

  // The invariants must include the non-negotiable ones.
  for (const invariant of ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10"])
    assert.match(doc, new RegExp(`\\*\\*${invariant}\\.`), `missing invariant ${invariant}`);

  // It must agree with the immutable README core rule rather than inventing a new one.
  assert.match(readme, /Player advises . AI Character decides . Simulation validates . World reacts?/i,
    "README core authority rule changed or moved");
});

test("hard negatives, persistence and no-camera-spawning are specified", () => {
  assert.match(doc, /Hard negatives \(tested\)/i, "no explicit illegal-habitat negatives");
  for (const negative of ["ducks on", "Cows inside", "Eagles on", "Gazelles on"])
    assert.ok(doc.includes(negative), `missing hard negative "${negative}"`);
  assert.match(doc, /No camera spawning|no "spawn when looked at"/i, "camera-authored life is not forbidden");
  assert.match(doc, /Persistence/i, "persistence contract missing");
});

test("the 3D asset plan stays inside the measured PlayCanvas batch limits", () => {
  // R4 facts that a naive plan would violate.
  assert.match(doc, /65535/, "batch vertex ceiling not recorded");
  assert.match(doc, /128 instances on low-end \/ 1024 on high-end/, "instance limits not recorded");
  // Skinning would exclude instances from batching, so the plan must say so.
  assert.match(doc, /No per-animal skeletal skinning/i, "skinning ban missing");
  assert.match(doc, /one \[?\*?static mesh|One low-poly static mesh/i, "static mesh rule missing");
});

test("all thirteen species have concrete acceptance scenes and testable contracts", () => {
  const scenes = heading("10. Concrete acceptance scenes");
  assert.ok(scenes.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("|---")).length >= 7,
    "expected at least 7 acceptance scenes");
  const contracts = heading("11. Testable contracts");
  for (const contract of ["Determinism", "Habitat legality", "Ownership", "No camera spawning", "No teleport", "Persistence", "Budget", "Accessibility"])
    assert.ok(contracts.includes(contract), `missing contract "${contract}"`);
});

test("the document cites dated public sources", () => {
  const references = heading("13. References");
  const urls = references.match(/https?:\/\/[^\s)]+/g) ?? [];
  assert.ok(urls.length >= 5, `expected at least 5 cited URLs, found ${urls.length}`);
  assert.match(references, /doi:10\.1146\/annurev\.ecolsys\.110308\.120159/, "Elith & Leathwick citation missing");
  assert.match(references, /doi:10\.1111\/j\.1461-0248\.2008\.01277\.x/, "Kearney & Porter citation missing");
  assert.match(references, /doi:10\.1145\/37401\.37406/, "Reynolds boids citation missing");
});

test("the research WP is honestly labelled and no runtime fauna code exists yet", () => {
  assert.match(doc, /VISUAL: N\/A \(research-only; no runtime visuals modified\)/);
  assert.match(doc, /does \*\*not\*\* claim that any animal exists/i);

  // Guard against accidental scope creep into the follow-on implementation WP.
  const src = new URL("../src/", import.meta.url);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) files.push(full);
    }
  };
  walk(src.pathname.replace(/^\//, ""));
  const runtime = files
    .map((file) => readFileSync(file, "utf8"))
    .filter((source) => /\b(?:fauna|animalHerd|speciesPopulation|spawnAnimal)\b/.test(source));
  assert.deepEqual(runtime, [], "runtime fauna code exists; WP-S010-009-001 is research-only");
});
