import { performance } from "node:perf_hooks";
import { villages } from "../src/geography.ts";
import { settlementPlan, settlementRenderFeaturesForBounds } from "../src/settlements.ts";
import { LazySimulation } from "../src/simulation.ts";
import { WORLD_MIN, WORLD_SIZE, type Tile } from "../src/world.ts";
import { buildSettlementGeometry } from "../src/settlement-render.ts";
import { buildTile } from "../src/geometry.ts";

function measure(name: string, fn: () => unknown, count = 1) {
  const started = performance.now();
  let value: unknown;
  for (let i = 0; i < count; i++) value = fn();
  const elapsed = performance.now() - started;
  console.log(`${name}: ${elapsed.toFixed(2)} ms total (${(elapsed / count).toFixed(2)} ms/op)`);
  return value;
}

const focus = villages[0];
function tileAtFocus(size: number): Tile {
  const minX = Math.floor((focus.x - WORLD_MIN) / size) * size + WORLD_MIN,
    minZ = Math.floor((focus.z - WORLD_MIN) / size) * size + WORLD_MIN,
    level = Math.round(Math.log2(WORLD_SIZE / size)),
    x = Math.floor((minX - WORLD_MIN) / size),
    z = Math.floor((minZ - WORLD_MIN) / size);
  return { level, x, z, size, minX, minZ, key: `PERF/${level}/${x}/${z}` };
}

measure("settlementPlan cold", () => settlementPlan(focus.id));
measure("settlementPlan cached x1000", () => settlementPlan(focus.id), 1000);

const simulation = new LazySimulation();
simulation.setFocus(focus);
measure("simulation initial active country", () => simulation.advance(1));
measure("simulation hot tick", () => simulation.advance(2));
measure("simulation 10 hot ticks", () => simulation.advance(simulation.tick + 1), 10);
console.log("resident count", simulation.stats.residents);

for (const size of [256, 128, 64, 32]) {
  const tile = tileAtFocus(size),
    features = settlementRenderFeaturesForBounds(tile.minX, tile.minZ, tile.size);
  console.log(`tile ${size}: ${tile.key}; settlement features ${features.length}`);
  measure(`settlement geometry ${size} x5`, () => buildSettlementGeometry(tile), 5);
  measure(`generic buildTile ${size} x3`, () => buildTile(tile), 3);
}
