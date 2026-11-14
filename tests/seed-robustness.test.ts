import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

/**
 * The SEED is player-chosen, so every valid seed code must generate a playable world.
 * Each seed is generated in its own Node process because world modules evaluate once.
 * Each listed seed used to throw during generation (see the comments on SEEDS).
 * Live road routing makes every non-default seed take about a minute; the seeds run in parallel.
 */
const SEEDS = [
  "ADVISOR-0126-STONELEY", // too few legal village sites in a country; river too wide to bridge
  "ADVISOR-0126-STONEHAM", // a country no connected neighbour can enter, only leave
  "ADVISOR-0126-OAKFELL", // a village link no dry, owned corridor can follow
] as const;

const CHILD_SCRIPT = `
globalThis.__ADVISOR_SEED__ = process.argv[1];
const geo = await import(${JSON.stringify(new URL("../src/geography.ts", import.meta.url).href)});
await import(${JSON.stringify(new URL("../src/transport-network.ts", import.meta.url).href)});
const perCountry = new Map();
for (const v of geo.villages) {
  const key = v.continent + "/" + v.country;
  perCountry.set(key, (perCountry.get(key) || 0) + 1);
}
console.log("RESULT " + JSON.stringify({
  seed: process.argv[1],
  cities: geo.cities.length,
  villages: geo.villages.length,
  countries: geo.countries.length,
  minVillagesPerCountry: Math.min(...perCountry.values()),
  roads: geo.roads.length,
}));
`;

function generate(seed: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", CHILD_SCRIPT, seed],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 280_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test("non-default player seeds generate a complete playable world", { timeout: 300_000 }, async () => {
  const results = await Promise.all(SEEDS.map(generate));
  results.forEach((run, index) => {
    const seed = SEEDS[index];
    assert.equal(run.code, 0, `${seed} failed: ${run.stderr.split("\n").filter((line) => /Error/.test(line)).slice(0, 2).join(" | ")}`);
    const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
    assert.ok(line, `${seed} printed no result`);
    const summary = JSON.parse(line.slice("RESULT ".length));
    assert.equal(summary.seed, seed);
    assert.ok(summary.countries > 0);
    assert.ok(summary.cities >= summary.countries * 3, `${seed} city minimum`);
    assert.ok(summary.villages >= summary.countries * 9, `${seed} village minimum`);
    assert.ok(summary.minVillagesPerCountry >= 9, `${seed} every country keeps its rural minimum`);
    assert.ok(summary.roads > 0);
  });
});
