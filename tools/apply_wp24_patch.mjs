import fs from "node:fs";

const worldPath = "src/world.ts";
let world = fs.readFileSync(worldPath, "utf8");
const importNeedle = 'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";';
const oldSiteImport = 'import { nearbyCriticalSites, siteSurfaceSample } from "./sites.ts";';
const siteImport = 'import { nearbyCriticalSites, siteAccessRoads, siteSurfaceSample } from "./sites.ts";';
if (!world.includes('from "./sites.ts"')) {
  if (!world.includes(importNeedle)) throw new Error("world.ts geography import anchor changed");
  world = world.replace(importNeedle, `${importNeedle}\n${siteImport}`);
} else if (world.includes(oldSiteImport)) {
  world = world.replace(oldSiteImport, siteImport);
} else if (!world.includes(siteImport)) {
  throw new Error("world.ts site import anchor changed");
}
const roadIndexNeedle = "for (const road of roads) {";
const roadIndexReplacement = "for (const road of [...roads, ...siteAccessRoads]) {";
if (world.includes(roadIndexNeedle)) world = world.replace(roadIndexNeedle, roadIndexReplacement);
else if (!world.includes(roadIndexReplacement)) throw new Error("world.ts road index anchor changed");
const queryNeedle = `  const modifiers: SurfaceModifier[] = [],\n    place = nearestPlace(x, z),\n    roadMatch = surfaceRoadAt(x, z);`;
const queryReplacement = `  const modifiers: SurfaceModifier[] = [],\n    place = nearestPlace(x, z),\n    roadMatch = surfaceRoadAt(x, z),\n    nearbySites = nearbyCriticalSites(x, z, 20, 4);\n  for (const site of nearbySites) {\n    const prepared = siteSurfaceSample(site, x, z, base.groundHeight);\n    if (prepared.influence <= 0) continue;\n    modifiers.push({\n      id: \`${'${site.code}'}/PREP\`,\n      priority: WORLD_BUILDING_PRIORITIES.site,\n      weight: prepared.influence,\n      targetGroundHeight: prepared.height,\n      material: "Settlement",\n      walkable: prepared.walkable,\n      vegetationDensityScale: 0,\n      reservedUse: site.code,\n    });\n  }`;
if (!world.includes("nearbySites = nearbyCriticalSites")) {
  if (!world.includes(queryNeedle)) throw new Error("world.ts surface query anchor changed");
  world = world.replace(queryNeedle, queryReplacement);
}
const countNeedle = `    candidateCount: roadMatch.candidateCount + (place ? 2 : 0),`;
const countReplacement = `    candidateCount: roadMatch.candidateCount + (place ? 2 : 0) + nearbySites.length,`;
if (world.includes(countNeedle)) world = world.replace(countNeedle, countReplacement);
else if (!world.includes(countReplacement)) throw new Error("world.ts candidate count anchor changed");
fs.writeFileSync(worldPath, world);

const sitesPath = "src/sites.ts";
let sites = fs.readFileSync(sitesPath, "utf8");
const routingPollution = 'for (const branch of siteAccessRoads) if (!roads.some((road) => road.code === branch.code)) roads.push(branch);\n';
if (sites.includes(routingPollution)) sites = sites.replace(routingPollution, "");
fs.writeFileSync(sitesPath, sites);

const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
const scriptNeedle = '    <script type="module" src="/src/political-atlas.ts"></script>';
const siteScript = '    <script type="module" src="/src/site-experience.ts"></script>';
if (!index.includes(siteScript)) {
  if (!index.includes(scriptNeedle)) throw new Error("index.html script anchor changed");
  index = index.replace(scriptNeedle, `${scriptNeedle}\n${siteScript}`);
}
fs.writeFileSync(indexPath, index);
