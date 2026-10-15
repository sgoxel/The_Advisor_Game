import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  const index = text.indexOf(before);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(before, index + 1) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return text.slice(0, index) + after + text.slice(index + before.length);
}

{
  const path = "src/world.ts";
  let text = read(path);
  text = replaceOnce(
    text,
    'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";\n',
    'import { nearestPlace, places, roadDistanceAt, roads, type Place, type Road } from "./geography.ts";\nimport { settlementExteriorFor, type SettlementPlotPlan, type SettlementService } from "./settlement-exterior.ts";\n',
    "world settlement exterior import",
  );
  text = replaceOnce(
    text,
    'export type Feature = {\n  kind: "house" | "keep" | "tree" | "rock" | "field" | "well";\n  x: number;\n  z: number;\n  y: number;\n  code: string;\n  variant: number;\n};',
    'export type Feature = {\n  kind: "house" | "keep" | "tree" | "rock" | "field" | "well" | "service" | "street" | "gate" | "guard-post";\n  x: number;\n  z: number;\n  y: number;\n  code: string;\n  variant: number;\n  service?: SettlementService;\n  capacity?: number;\n  residents?: number;\n  label?: string;\n  entranceX?: number;\n  entranceZ?: number;\n};',
    "world feature type",
  );
  const start = text.indexOf("export function featuresFor(tile: Tile): Feature[] {");
  const end = text.indexOf("export type View = {", start);
  if (start < 0 || end < 0) throw new Error("Missing featuresFor block");
  const replacement = `const settlementPlotAnchors = new Map<string, { x: number; z: number } | null>();\n\n/** Tile-owned exterior features. Semantic plans are lazy and candidate selection is deterministic. */\nexport function featuresFor(tile: Tile): Feature[] {\n  const features: Feature[] = [];\n  const plotAt = (kind: Feature["kind"], x: number, z: number) => {\n    const surface = finalSurfaceAt(x, z);\n    if (surface.groundHeight < .2 || surface.water.kind !== "none") return null;\n    if (["house", "keep", "well", "field", "service"].includes(kind)) {\n      const radius = kind === "keep" ? 15 : kind === "field" ? 13 : kind === "house" ? 7 : kind === "service" ? 8 : 2;\n      if (!surface.walkable || naturalSurfaceAt(x, z).freshwaterDistanceSource <= Math.SQRT2 * radius + 3.7 || surfaceRoadAt(x, z, radius + 5).distance <= radius + 5) return null;\n      for (const [dx, dz] of [[-radius,-radius],[-radius,radius],[radius,radius],[radius,-radius],[0,-radius],[0,radius],[-radius,0],[radius,0]]) {\n        const corner = finalSurfaceAt(x + dx, z + dz);\n        if (corner.water.kind !== "none" || !corner.walkable || Math.abs(corner.groundHeight - surface.groundHeight) > (kind === "field" ? .1 : .25)) return null;\n      }\n    }\n    return surface;\n  };\n  const add = (\n    kind: Feature["kind"],\n    x: number,\n    z: number,\n    variant: number,\n    id: string,\n    metadata: Partial<Pick<Feature, "service" | "capacity" | "residents" | "label" | "entranceX" | "entranceZ">> = {},\n  ) => {\n    if (x < tile.minX || x >= tile.minX + tile.size || z < tile.minZ || z >= tile.minZ + tile.size) return;\n    const surface = plotAt(kind, x, z);\n    if (!surface) return;\n    if ((kind === "tree" || kind === "rock") && surface.vegetationDensityScale <= 0) return;\n    features.push({ kind, x, z, y: surface.groundHeight, variant, code: \`${WORLD_SEED}/${GENERATOR_VERSION}/F/\${id}\`, ...metadata });\n  };\n  const nearestStreetPoint = (place: Place, x: number, z: number) => {\n    const plan = settlementExteriorFor(place);\n    let best = { x: place.x, z: place.z }, distance = Infinity;\n    for (const street of plan.streets) for (const point of street.points) {\n      const candidate = Math.hypot(wrapSourceX(x - point.x), z - point.z);\n      if (candidate < distance) { best = point; distance = candidate; }\n    }\n    return best;\n  };\n  const acceptedPlot = (plot: SettlementPlotPlan, featureKind: Feature["kind"]) => {\n    if (settlementPlotAnchors.has(plot.id)) return settlementPlotAnchors.get(plot.id)!;\n    const chosen = plot.candidates.find((candidate) => Boolean(plotAt(featureKind, candidate.x, candidate.z))) || null;\n    settlementPlotAnchors.set(plot.id, chosen);\n    return chosen;\n  };\n\n  for (const place of places) {\n    const plan = settlementExteriorFor(place), extent = plan.radius + 96;\n    if (place.x < tile.minX - extent || place.x > tile.minX + tile.size + extent || place.z < tile.minZ - extent || place.z > tile.minZ + tile.size + extent) continue;\n    const sx = Math.floor(place.x / 2), sz = Math.floor(place.z / 2);\n    for (const street of plan.streets) for (let index = 0; index < street.points.length; index++) {\n      const point = street.points[index];\n      add("street", point.x, point.z, Math.max(6, Math.round(street.width + 3)), \`${place.id}/street/\${street.id}/\${index}\`);\n    }\n    for (const plot of plan.plots) {\n      const featureKind: Feature["kind"] = plot.kind === "service" ? "service" : plot.kind;\n      const point = acceptedPlot(plot, featureKind);\n      if (!point) continue;\n      const entrance = nearestStreetPoint(place, point.x, point.z);\n      add(featureKind, point.x, point.z, coordinateValue(sx, sz, 40 + (digest(plot.id) % 500)), \`${place.id}/\${plot.id}\`, {\n        service: plot.service, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind, entranceX: entrance.x, entranceZ: entrance.z,\n      });\n    }\n    for (const gate of plan.gates) {\n      add("gate", gate.x, gate.z, digest(gate.id), \`${place.id}/gate/\${gate.id}\`, { label: \`${place.name} gate\`, entranceX: place.x, entranceZ: place.z });\n      for (let index = 0; index < gate.guardPosts.length; index++) {\n        const post = gate.guardPosts[index];\n        add("guard-post", post.x, post.z, digest(\`${gate.id}/\${index}\`), \`${place.id}/guard-post/\${gate.id}/\${index}\`, { service: "guard-office", capacity: 4, residents: 2, label: "Guard post", entranceX: gate.x, entranceZ: gate.z });\n      }\n    }\n  }\n\n  if (tile.size <= 256) {\n    for (let gz = Math.floor(tile.minZ / 10) - 1; gz < (tile.minZ + tile.size) / 10 + 1; gz++) {\n      for (let gx = Math.floor(tile.minX / 10) - 1; gx < (tile.minX + tile.size) / 10 + 1; gx++) {\n        const v = coordinateValue(gx, gz, 30), x = gx * 10 + (v % 7) - 3, z = gz * 10 + ((v >>> 5) % 7) - 3, biome = biomeAt(x, z);\n        if (biome === "Woodland" && v % 4 !== 0) add("tree", x, z, v, \`tree/\${gx}/\${gz}\`);\n        else if (!["Settlement", "Ocean", "Lake", "River", "Road", "Bridge"].includes(biome) && v % 31 === 0) add("rock", x, z, v, \`rock/\${gx}/\${gz}\`);\n      }\n    }\n  }\n  return features;\n}\n`;
  text = text.slice(0, start) + replacement + text.slice(end);
  write(path, text);
}

{
  const path = "src/geometry.ts";
  let text = read(path);
  text = replaceOnce(
    text,
    '      } else if (f.kind === "keep") {',
    `      } else if (f.kind === "service") {\n        const market = f.service === "market", smith = f.service === "blacksmith", inn = f.service === "inn";\n        const w = market ? 12 : inn ? 11 : 9, d = market ? 10 : inn ? 12 : 9, h = market ? 3.8 : inn ? 6.2 : 5.1;\n        structures.box(x, y - 0.25, z, w, h + 0.25, d, market ? color(188, 166, 116) : plaster);\n        structures.roof(x, y + h, z, w + 1.2, d + 1.2, market ? 2.1 : 2.8, smith ? color(66, 70, 70) : color(122 + (v % 18), 70, 50));\n        if (market && t.size <= 64) {\n          for (const ox of [-4, 0, 4]) detail.box(x + ox, y + .2, z + d / 2 + 1.5, 3, 1.4, 2.3, color(157, 112 + (v % 20), 63));\n        } else if (smith && t.size <= 64) {\n          detail.box(x + w / 2 + 1.1, y + .1, z, 1.8, 1.2, 1.8, color(82, 82, 76));\n          detail.box(x + w / 2 + 1.1, y + 1.3, z, .3, 2.3, .3, timber);\n        }\n      } else if (f.kind === "street") {\n        const size = Math.max(6, Math.min(10, v));\n        structures.box(x, y + .015, z, size, .08, size, color(118, 96, 64));\n      } else if (f.kind === "gate") {\n        for (const ox of [-4.5, 4.5]) structures.box(x + ox, y - .2, z, 1.5, 7.2, 1.5, stone);\n        structures.box(x, y + 5.7, z, 10.5, 1.3, 1.5, timber);\n      } else if (f.kind === "guard-post") {\n        structures.box(x, y - .2, z, 4.5, 6.2, 4.5, stone);\n        structures.roof(x, y + 6, z, 5.2, 5.2, 2.2, color(72, 80, 82));\n      } else if (f.kind === "keep") {`,
    "geometry settlement feature branches",
  );
  write(path, text);
}

{
  const path = "tests/final-surface-integration.test.ts";
  let text = read(path);
  const before = `  let bank: ReturnType<typeof naturalSurfaceAt> | undefined;\n  for(const radius of [4,6,8,10,12]) {\n    for(let index=0;index<24;index++) {\n      const angle=index/24*Math.PI*2,\n        sample=naturalSurfaceAt(p.x+Math.cos(angle)*radius,p.z+Math.sin(angle)*radius);\n      if(sample.material==="Riverbank"&&sample.water.kind==="none") {\n        bank=sample;\n        break;\n      }\n    }\n    if(bank) break;\n  }`;
  const after = `  let bank: ReturnType<typeof naturalSurfaceAt> | undefined;\n  for(const radius of [2,3,4,5,6,8,10,12]) {\n    for(let index=0;index<48;index++) {\n      const angle=index/48*Math.PI*2, sample=naturalSurfaceAt(p.x+Math.cos(angle)*radius,p.z+Math.sin(angle)*radius);\n      if(sample.material==="Riverbank"&&sample.water.kind==="none"&&(!bank||sample.groundHeight<bank.groundHeight)) bank=sample;\n    }\n  }`;
  text = replaceOnce(text, before, after, "crossing bank nearest legal support");
  write(path, text);
}

{
  const path = "tests/world.test.ts";
  let text = read(path);
  const anchor = `  for(const kind of ['keep','well','field']) assert.ok(features.some(f=>f.kind===kind),\`missing \${kind}\`);\n`;
  const addition = `${anchor}  const exterior=[...tiles.values()].flatMap(featuresFor);\n  for(const service of ['market','inn','blacksmith','butcher','guard-office','farmstead'])\n    assert.ok(exterior.some(f=>f.kind==='service'&&f.service===service),\`missing \${service}\`);\n  assert.ok(exterior.some(f=>f.kind==='gate'),'missing gate');\n  assert.ok(exterior.some(f=>f.kind==='guard-post'),'missing guard post');\n`;
  text = replaceOnce(text, anchor, addition, "Alderwick exterior assertions");
  write(path, text);
}

console.log("AGENT #1 WP-S004 runtime patch applied");
