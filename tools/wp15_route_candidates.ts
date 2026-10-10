import { routeBetweenVillages, clearVillageRouteCache } from "../src/village-routes.ts";

const candidates = [
  ["0/4/2/0", "0/6/2/2"],
  ["0/4/2/1", "0/6/2/2"],
  ["1/0/0/0", "1/8/0/2"],
  ["1/5/0/0", "1/7/1/2"],
] as const;
let found = false;
for (const [from, to] of candidates) {
  clearVillageRouteCache();
  const route = routeBetweenVillages(from, to);
  console.log(JSON.stringify({
    from, to,
    found: route.found,
    difficultM: route.surfaceM.difficult,
    roadM: route.surfaceM.road,
    distanceM: route.distanceM,
    fantasySeconds: route.fantasySeconds,
    straightLineFantasySeconds: route.straightLineFantasySeconds,
    ratio: route.straightLineFantasySeconds > 0 ? route.fantasySeconds / route.straightLineFantasySeconds : 0,
    expansions: route.expansions,
  }));
  if (route.found && route.surfaceM.difficult > 1_000 && route.fantasySeconds > route.straightLineFantasySeconds * 1.1) {
    found = true;
    break;
  }
}
if (!found) throw new Error("no scanned seeded neighbour demonstrates material highland travel cost");
