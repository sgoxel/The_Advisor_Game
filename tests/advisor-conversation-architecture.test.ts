/**
 * WP-S010-007-001 — the Advisor conversation contract must stay aligned with the
 * immutable README rules it implements. This is a documentation-conformance test:
 * it pins the parts of the contract that later implementation WPs (#507/#508)
 * are allowed to rely on, so a silent edit cannot weaken the authority boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const doc = readFileSync(new URL("../docs/ADVISOR_CONVERSATION_ARCHITECTURE.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const lines = doc.split("\n");

function section(heading: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert.ok(start >= 0, `ADVISOR_CONVERSATION_ARCHITECTURE.md has no heading starting "${heading}"`);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## "); i++) body.push(lines[i]);
  return body;
}

test("all ten root invariants are present and numbered", () => {
  const body = section("## 2. Root invariants").join("\n");
  for (let i = 1; i <= 10; i++) {
    assert.match(body, new RegExp(`\\*\\*I${i}\\*\\*`), `missing invariant I${i}`);
  }
});

test("the authority chain matches the README core rule", () => {
  // README: Player advises -> AI Character decides -> Simulation validates -> World reacts.
  for (const phrase of [
    "The player advises; the protagonist decides",
    "The Simulation is the sole authority",
    "Same protagonist",
  ]) {
    const hinted = doc.includes(phrase) || readme.includes(phrase);
    assert.ok(hinted, `authority phrase "${phrase}" is not stated in either document`);
  }
  assert.match(readme, /Player advises → AI Character decides → Simulation validates → World reacts/, "README core rule changed");
});

test("every threat in the authority table has a defence and a failure behaviour", () => {
  const rows = section("## 9. Threat and authority table").filter((line) => line.startsWith("|"));
  const body = rows.slice(2); // header + separator
  assert.ok(body.length >= 8, `expected at least 8 threat rows, found ${body.length}`);
  for (const row of body) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 4, `threat row does not have 4 columns: ${row}`);
    for (const cell of cells) assert.ok(cell.length > 0, `threat row has an empty cell: ${row}`);
  }
  // The specific negative cases the implementation WPs must test.
  for (const threat of ["Forged entity", "Teleport", "Fabricated resource", "Premature success", "Blind obedience"]) {
    assert.ok(doc.includes(threat), `authority table lost the "${threat}" case`);
  }
});

test("matching priority is a total, documented order", () => {
  const rows = section("### 4.4 Matching priority").filter((line) => line.startsWith("|"));
  const stages = rows.slice(2).map((row) => row.split("|")[2]?.trim());
  assert.deepEqual(stages, ["`exact` on normalized string", "`normalized` literal", "`phrase` (longest phrase first, then priority)", "`pattern` with all slots resolved", "fuzzy phrase (opt-in only)"]);
  assert.match(doc, /longest match first, then higher `priority`, then\s+lexicographic `id`/, "tie-break chain must stay total and deterministic");
});

test("the four routing modes and the offline fallback are all documented", () => {
  for (const mode of ["**M1 Local**", "**M2 Library-assisted LLM**", "**M3 LLM interpretation**", "**M4 Deterministic offline**"]) {
    assert.ok(doc.includes(mode), `routing mode missing: ${mode}`);
  }
  assert.match(section("## 8. Routing modes").join("\n"), /never surfaces raw model text as world truth/);
});

test("the command interface forbids every README-prohibited mutation", () => {
  const body = doc.toLowerCase();
  for (const forbidden of ["invent", "teleport", "grant", "mark an action as successful"]) {
    assert.ok(body.includes(forbidden), `command boundary no longer mentions "${forbidden}"`);
  }
  // Six validation stages, in order, before any world change.
  const validation = section("### 6.3 Validation pipeline").join("\n");
  for (const stage of ["**Schema**", "**Set membership**", "**Parameter resolution**", "**Preconditions**", "**Character evaluation**", "**Simulation execution**"]) {
    assert.ok(validation.includes(stage), `validation stage missing: ${stage}`);
  }
  assert.match(validation, /Nothing before step 6 changes world state/);
});

test("ambiguity is never silently resolved to the permissive reading", () => {
  assert.match(doc, /Never pick the more permissive candidate/);
  assert.match(doc, /the more permissive candidate is never preferred/);
});

test("acceptance contracts cover determinism, offline parity and no-leakage", () => {
  const body = section("## 13. Acceptance contracts for #507 / #508").join("\n");
  for (const item of ["**Determinism**", "**Ambiguity**", "**Autonomy**", "**Offline parity**", "**No leakage**", "**Versioning**"]) {
    assert.ok(body.includes(item), `acceptance contract missing: ${item}`);
  }
});

test("the required reference analysis is cited with resolvable URLs", () => {
  const refs = section("## 15. References").join("\n");
  const urls = [...refs.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0]);
  assert.ok(urls.length >= 3, `expected at least 3 cited references, found ${urls.length}`);
  for (const url of urls) assert.match(url, /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, `unusable reference URL: ${url}`);
  assert.ok(refs.includes("spaCy") && refs.includes("OpenAI") && refs.includes("Anthropic"), "reference analysis must keep its three named systems");
});

test("the document does not claim an implemented conversation runtime", () => {
  assert.match(doc, /does\s+not claim any runtime Advisor chat exists/);
  assert.doesNotMatch(doc, /\bIMPLEMENTED\b/, "research contract must not read as an implementation claim");
});
