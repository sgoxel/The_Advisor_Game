import { performance } from "node:perf_hooks";
import { villages } from "../src/geography.ts";
import { settlementPlan, settlementRenderFeaturesForBounds } from "../src/settlements.ts";
import { LazySimulation } from "../src/simulation.ts";
import { tileAt } from "../src/world.ts";
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
measure("settlementPlan cold", () => settlementPlan(focus.id));
measure("settlementPlan cached x1000", () => settlementPlan(focus.id), 1000);

const simulation = new LazySimulation();
simulation.setFocus(focus);
measure("simulation initial active country", () => simulation.advance(1));
measure("simulation hot tick", () => simulation.advance(2));
measure("simulation 10 hot ticks", () => simulation.advance(simulation.tick + 1), 10);
console.log("resident count", simulation.stats.residents);

const tile = tileAt(8, Math.floor((focus.x + 131072) / 1024), Math.floor((focus.z + 131072) / 1024));
console.log("diagnostic tile", tile.key, tile.size, tile.minX, tile.minZ);
measure("settlement features x100", () => settlementRenderFeaturesForBounds(tile.minX, tile.minZ, tile.size), 100);
measure("settlement geometry x20", () => buildSettlementGeometry(tile), 20);
measure("generic buildTile x5", () => buildTile(tile), 5);
