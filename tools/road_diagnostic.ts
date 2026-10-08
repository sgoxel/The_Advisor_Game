import { roads, roadAt, nearbyPlaces } from "../src/geography.ts";
import { cellAt, heightAt } from "../src/world.ts";
import { wrapSourceX } from "../src/planet.ts";

for (const road of roads) {
  for (let x = road.minX; x < road.maxX; x += 14) {
    const cell = cellAt(x, road.z);
    if (cell.walkable) continue;
    const wx = wrapSourceX(x),
      cx = Math.floor(wx / 2),
      cz = Math.floor(road.z / 2),
      px = cx * 2 + 1,
      pz = cz * 2 + 1;
    console.log(
      JSON.stringify(
        {
          road,
          x,
          wx,
          cell,
          sample: { px, pz, height: heightAt(px, pz) },
          roadAtSample: roadAt(px, pz)?.code ?? null,
          nearby: nearbyPlaces(px, pz).map((p) => ({
            id: p.id,
            x: p.x,
            z: p.z,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
}
console.log("No blocked road reproduced by diagnostic scan.");
