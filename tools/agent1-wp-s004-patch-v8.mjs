import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing patch anchor: ${label}`);
  return text.replace(before, after);
}

let exterior = read('src/settlement-exterior.ts');
exterior = replaceOnce(
  exterior,
  '  | "guard-office"\n  | "farmstead";',
  '  | "guard-office"\n  | "farmstead"\n  | "merchant"\n  | "headman";',
  'service roles',
);
exterior = replaceOnce(
  exterior,
  'export type SettlementPlotKind = "keep" | "well" | "house" | "field" | "service";',
  'export type SettlementPlotKind = "keep" | "well" | "house" | "garden" | "field" | "service";',
  'garden plot kind',
);
exterior = replaceOnce(
  exterior,
  '  if (kind === "house") return { width: 5.8 + u * 4.5, depth: 6.5 + unit(`${place.code}/PLOT/${id}/DEPTH`) * 5 };\n  switch (service) {',
  '  if (kind === "house") return { width: 5.8 + u * 4.5, depth: 6.5 + unit(`${place.code}/PLOT/${id}/DEPTH`) * 5 };\n  if (kind === "garden") return { width: 7 + u * 5, depth: 6 + unit(`${place.code}/PLOT/${id}/DEPTH`) * 6 };\n  switch (service) {',
  'garden footprint',
);
exterior = replaceOnce(
  exterior,
  '    case "farmstead": return { width: 18, depth: 15 };\n    default: return { width: 9, depth: 9 };',
  '    case "farmstead": return { width: 18, depth: 15 };\n    case "merchant": return { width: 12, depth: 11 };\n    case "headman": return { width: 16, depth: 14 };\n    default: return { width: 9, depth: 9 };',
  'special footprints',
);
exterior = replaceOnce(
  exterior,
  '  plots.push(servicePlot(place, streets, "guard-office", 0, .12, 1, 18, 6));\n  plots.push(servicePlot(place, streets, "farmstead", streets.length - 1, .82, 1, 14, 6));',
  '  plots.push(servicePlot(place, streets, "guard-office", 0, .12, 1, 18, 6));\n  plots.push(servicePlot(place, streets, "farmstead", streets.length - 1, .82, 1, 14, 6));\n  plots.push(servicePlot(place, streets, "merchant", 0, place.kind === "city" ? .62 : .72, 1, place.kind === "city" ? 36 : 18, place.kind === "city" ? 5 : 3));\n  plots.push(servicePlot(place, streets, "headman", Math.min(1, streets.length - 1), place.kind === "city" ? .24 : .28, -1, place.kind === "city" ? 20 : 12, place.kind === "city" ? 8 : 6));',
  'merchant and headman roles',
);
exterior = replaceOnce(
  exterior,
  '      setbackBase = archetype === "dispersed-farming" ? 10 : place.kind === "city" ? 3 : 5,\n      setback = setbackBase + unit(`${address}/SETBACK`) * (archetype === "dispersed-farming" ? 15 : 8);\n    plots.push(plotOnStreet(place, street, `HOUSE/${index}`, "house", fraction, side, setback, residents + 2, residents, undefined, `${place.code}/HOUSEHOLD/${index}`));',
  '      setbackBase = archetype === "dispersed-farming" ? 10 : place.kind === "city" ? 3 : 5,\n      setback = setbackBase + unit(`${address}/SETBACK`) * (archetype === "dispersed-farming" ? 15 : 8),\n      ownerId = `${place.code}/HOUSEHOLD/${index}`;\n    plots.push(plotOnStreet(place, street, `HOUSE/${index}`, "house", fraction, side, setback, residents + 2, residents, undefined, ownerId));\n    if (index % 5 === 0)\n      plots.push(plotOnStreet(place, street, `GARDEN/${index}`, "garden", fraction, side, setback + 12 + unit(`${address}/GARDEN-DEPTH`) * 5, 0, 0, undefined, ownerId));',
  'home gardens',
);
write('src/settlement-exterior.ts', exterior);

let world = read('src/world.ts');
world = replaceOnce(
  world,
  '  kind: "house" | "keep" | "tree" | "rock" | "field" | "well" | "service" | "street" | "border" | "gate" | "guard-post";',
  '  kind: "house" | "keep" | "tree" | "roadside-tree" | "rock" | "garden" | "field" | "well" | "service" | "path" | "street" | "border" | "gate" | "guard-post";',
  'feature kinds',
);
world = replaceOnce(
  world,
  '    if (["house", "keep", "well", "field", "service"].includes(kind)) {\n      const radius = kind === "keep" ? 15 : kind === "field" ? 13 : kind === "house" ? 7 : kind === "service" ? 8 : 2;',
  '    if (["house", "keep", "well", "garden", "field", "service"].includes(kind)) {\n      const radius = kind === "keep" ? 15 : kind === "field" ? 13 : kind === "house" ? 7 : kind === "garden" ? 4 : kind === "service" ? 8 : 2;',
  'garden legality',
);
world = replaceOnce(
  world,
  '      const entrance = nearestStreetPoint(place, point.x, point.z);\n      add(featureKind, point.x, point.z, coordinateValue(sx, sz, 40 + (digest(plot.id) % 500)), place.id + "/" + plot.id, {\n        service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind, entranceX: entrance.x, entranceZ: entrance.z,\n        yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, fieldForm: plot.fieldForm,\n      });\n    }\n    for (const gate of plan.gates) {',
  '      const streetEntrance = nearestStreetPoint(place, point.x, point.z),\n        accessDx = wrapSourceX(streetEntrance.x - point.x), accessDz = streetEntrance.z - point.z,\n        accessDistance = Math.hypot(accessDx, accessDz),\n        edgeOffset = Math.min(accessDistance * .45, Math.max(1.4, Math.min(plot.width, plot.depth) * .42)),\n        door = accessDistance > 0 ? { x: wrapSourceX(point.x + accessDx / accessDistance * edgeOffset), z: point.z + accessDz / accessDistance * edgeOffset } : point;\n      add(featureKind, point.x, point.z, coordinateValue(sx, sz, 40 + (digest(plot.id) % 500)), place.id + "/" + plot.id, {\n        service: plot.service, ownerId: plot.ownerId, capacity: plot.capacity, residents: plot.residents, label: plot.service || plot.kind, entranceX: door.x, entranceZ: door.z,\n        yawRad: plot.yawRad, footprintWidth: plot.width, footprintDepth: plot.depth, fieldForm: plot.fieldForm,\n      });\n      if ((featureKind === "house" || featureKind === "service" || featureKind === "keep") && accessDistance > edgeOffset + .8) {\n        const pathDx = wrapSourceX(streetEntrance.x - door.x), pathDz = streetEntrance.z - door.z, pathLength = Math.hypot(pathDx, pathDz);\n        add("path", wrapSourceX(door.x + pathDx * .5), door.z + pathDz * .5, digest(plot.id + "/PATH"), place.id + "/path/" + plot.id, {\n          ownerId: plot.ownerId, label: "Access path", entranceX: door.x, entranceZ: door.z, yawRad: Math.atan2(pathDx, pathDz), footprintWidth: 1.25, footprintDepth: pathLength, length: pathLength,\n        });\n      }\n    }\n    ensureResolvedPlots(place);\n    const mainStreet = plan.streets[0];\n    for (let index = 2; index < mainStreet.points.length - 2; index += 3) {\n      const value = digest(place.code + "/ROADSIDE-TREE/" + index);\n      if (value % 5 === 0) continue;\n      const anchor = mainStreet.points[index], previous = mainStreet.points[index - 1], next = mainStreet.points[index + 1],\n        dx = wrapSourceX(next.x - previous.x), dz = next.z - previous.z, length = Math.hypot(dx, dz) || 1,\n        side = (value & 1) === 0 ? -1 : 1, offset = mainStreet.width * .5 + 5 + ((value >>> 3) % 5),\n        x = wrapSourceX(anchor.x - dz / length * offset * side), z = anchor.z + dx / length * offset * side;\n      if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 18)) continue;\n      let clear = true;\n      for (const plot of plan.plots) {\n        const plotAnchor = settlementPlotAnchors.get(plot.id);\n        if (plotAnchor && Math.hypot(wrapSourceX(x - plotAnchor.x), z - plotAnchor.z) < plot.clearanceRadius + 4) { clear = false; break; }\n      }\n      if (!clear) continue;\n      const surface = finalSurfaceAt(x, z);\n      if (surface.water.kind !== "none" || !surface.walkable) continue;\n      add("roadside-tree", x, z, value, place.id + "/roadside-tree/" + index, { label: "Roadside tree" });\n    }\n    for (const gate of plan.gates) {',
  'entrances paths and roadside trees',
);
write('src/world.ts', world);

let geometry = read('src/geometry.ts');
geometry = replaceOnce(
  geometry,
  '        const yaw = f.yawRad || 0, market = f.service === "market", smith = f.service === "blacksmith", inn = f.service === "inn",\n          butcher = f.service === "butcher", guard = f.service === "guard-office", farm = f.service === "farmstead",\n          w = f.footprintWidth || (market ? 18 : inn ? 13 : smith ? 13 : farm ? 18 : 10),\n          d = f.footprintDepth || (market ? 13 : inn ? 16 : smith ? 12 : farm ? 15 : 11),\n          h = market ? 3.4 : inn ? 7.1 : smith ? 4.8 : guard ? 6.7 : farm ? 4.2 : 4.6,\n          wall = smith ? color(151, 144, 126) : guard ? stone : farm ? color(181, 158, 112) : plaster,\n          roof = smith ? color(58, 63, 64) : guard ? color(67, 76, 80) : farm ? color(105, 72, 47) : color(128 + (v % 15), 72, 50);',
  '        const yaw = f.yawRad || 0, market = f.service === "market", smith = f.service === "blacksmith", inn = f.service === "inn",\n          butcher = f.service === "butcher", guard = f.service === "guard-office", farm = f.service === "farmstead", merchant = f.service === "merchant", headman = f.service === "headman",\n          w = f.footprintWidth || (market ? 18 : inn ? 13 : smith ? 13 : farm ? 18 : headman ? 16 : merchant ? 12 : 10),\n          d = f.footprintDepth || (market ? 13 : inn ? 16 : smith ? 12 : farm ? 15 : headman ? 14 : merchant ? 11 : 11),\n          h = market ? 3.4 : inn ? 7.1 : smith ? 4.8 : guard ? 6.7 : farm ? 4.2 : headman ? 8.3 : merchant ? 5.4 : 4.6,\n          wall = headman ? color(188, 184, 161) : merchant ? color(199, 174, 126) : smith ? color(151, 144, 126) : guard ? stone : farm ? color(181, 158, 112) : plaster,\n          roof = headman ? color(72, 79, 82) : merchant ? color(126, 73, 48) : smith ? color(58, 63, 64) : guard ? color(67, 76, 80) : farm ? color(105, 72, 47) : color(128 + (v % 15), 72, 50);',
  'service silhouettes',
);
geometry = replaceOnce(
  geometry,
  '        } else if (farm) {\n          const barn = off(w * .55, -d * .2), shed = off(-w * .58, d * .22);\n          structures.boxYaw(barn.x, y, barn.z, w * .72, 4.7, d * .82, yaw, color(132, 93, 58));\n          structures.roofYaw(barn.x, y + 4.7, barn.z, w * .78, d * .9, 2.2, yaw, color(93, 64, 43));\n          structures.boxYaw(shed.x, y, shed.z, w * .42, 2.9, d * .46, yaw, color(145, 113, 71));\n        }\n      } else if (f.kind === "street") {',
  '        } else if (farm) {\n          const barn = off(w * .55, -d * .2), shed = off(-w * .58, d * .22);\n          structures.boxYaw(barn.x, y, barn.z, w * .72, 4.7, d * .82, yaw, color(132, 93, 58));\n          structures.roofYaw(barn.x, y + 4.7, barn.z, w * .78, d * .9, 2.2, yaw, color(93, 64, 43));\n          structures.boxYaw(shed.x, y, shed.z, w * .42, 2.9, d * .46, yaw, color(145, 113, 71));\n        } else if (merchant) {\n          const awning = off(0, d / 2 + 1.3), crateA = off(-w * .34, d / 2 + 2.1), crateB = off(w * .28, d / 2 + 2.4);\n          structures.boxYaw(awning.x, y + 3.1, awning.z, w * .82, .18, 2.4, yaw, color(170, 118, 66));\n          detail.boxYaw(crateA.x, y + .05, crateA.z, 1.6, 1.1, 1.5, yaw, color(115, 83, 49));\n          detail.boxYaw(crateB.x, y + .05, crateB.z, 1.3, .9, 1.3, yaw, color(129, 93, 52));\n        } else if (headman) {\n          const wing = off(w * .42, -d * .08), porch = off(0, d / 2 + 1.1);\n          structures.boxYaw(wing.x, y, wing.z, w * .48, 5.1, d * .72, yaw, stone);\n          structures.roofYaw(wing.x, y + 5.1, wing.z, w * .54, d * .78, 2.1, yaw, color(77, 82, 83));\n          structures.boxYaw(porch.x, y + .05, porch.z, w * .48, .18, 2.2, yaw, color(151, 132, 95));\n          for (const lx of [-w * .2, w * .2]) { const q = off(lx, d / 2 + 1.45); detail.boxYaw(q.x, y, q.z, .24, 3.1, .24, yaw, timber); }\n        }\n      } else if (f.kind === "garden") {\n        const yaw = f.yawRad || 0, w = f.footprintWidth || 9, d = f.footprintDepth || 8;\n        structures.boxYaw(x, y + .02, z, w, .08, d, yaw, color(117, 132, 71));\n        if (t.size <= 64) {\n          for (const lz of [-d / 2, d / 2]) detail.boxYaw(x, y + .12, z + Math.cos(yaw) * lz, w, .18, .16, yaw, timber);\n          for (const lx of [-w * .28, 0, w * .28]) { const c = Math.cos(yaw), s = Math.sin(yaw), qx = x + lx * c, qz = z - lx * s; detail.boxYaw(qx, y + .13, qz, .42, .3, d * .72, yaw, color(151, 126, 62)); }\n        }\n      } else if (f.kind === "path") {\n        structures.boxYaw(x, y + .015, z, f.footprintWidth || 1.25, .06, f.length || f.footprintDepth || 3, f.yawRad || 0, color(137, 116, 79));\n      } else if (f.kind === "street") {',
  'special details garden and path',
);
geometry = replaceOnce(
  geometry,
  '      } else if (f.kind === "tree") {\n        const climate = climateSampleAt(sourceToLonLat(x, z), y),\n          family = climate.forestFamily;\n        if (!family) continue;',
  '      } else if (f.kind === "tree" || f.kind === "roadside-tree") {\n        const climate = climateSampleAt(sourceToLonLat(x, z), y),\n          family = climate.forestFamily || (f.kind === "roadside-tree" ? "temperate-deciduous-mixed" : undefined);\n        if (!family) continue;',
  'roadside tree geometry',
);
write('src/geometry.ts', geometry);

let exteriorTest = read('tests/settlement-exterior.test.ts');
exteriorTest = replaceOnce(
  exteriorTest,
  'const REQUIRED_SERVICES = ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead"] as const;',
  'const REQUIRED_SERVICES = ["market", "inn", "blacksmith", "butcher", "guard-office", "farmstead", "merchant", "headman"] as const;',
  'required special roles test',
);
exteriorTest = replaceOnce(
  exteriorTest,
  '      services = new Set(plan.plots.flatMap((plot) => plot.service ? [plot.service] : [])),\n      homes = plan.plots.filter((plot) => plot.kind === "house");',
  '      services = new Set(plan.plots.flatMap((plot) => plot.service ? [plot.service] : [])),\n      homes = plan.plots.filter((plot) => plot.kind === "house"),\n      gardens = plan.plots.filter((plot) => plot.kind === "garden");',
  'garden test setup',
);
exteriorTest = replaceOnce(
  exteriorTest,
  '    assert.ok(homes.length >= (place.kind === "city" ? 80 : 20));\n    assert.ok(plan.plots.filter((plot) => plot.kind === "field").length >= (place.kind === "city" ? 8 : 4));',
  '    assert.ok(homes.length >= (place.kind === "city" ? 80 : 20));\n    assert.ok(gardens.length >= Math.floor(homes.length / 6), `${place.code} lacks household gardens/yards`);\n    assert.ok(gardens.every((garden) => garden.ownerId?.startsWith(`${place.code}/HOUSEHOLD/`)));\n    assert.ok(plan.plots.filter((plot) => plot.kind === "field").length >= (place.kind === "city" ? 8 : 4));',
  'garden test assertions',
);
exteriorTest = replaceOnce(
  exteriorTest,
  '  assert.ok(summary.plots < places.length * 160);',
  '  assert.ok(summary.plots < places.length * 200);',
  'bounded plot count',
);
write('tests/settlement-exterior.test.ts', exteriorTest);

let worldTest = read('tests/world.test.ts');
worldTest = replaceOnce(
  worldTest,
  "  for(const service of ['market','inn','blacksmith','butcher','guard-office','farmstead'])",
  "  for(const service of ['market','inn','blacksmith','butcher','guard-office','farmstead','merchant','headman'])",
  'world special roles test',
);
worldTest = replaceOnce(
  worldTest,
  "  assert.ok(exterior.some(f=>f.kind==='guard-post'),'missing guard post');",
  "  assert.ok(exterior.some(f=>f.kind==='guard-post'),'missing guard post');\n  assert.ok(exterior.some(f=>f.kind==='garden'&&f.ownerId),'missing household garden/yard');\n  assert.ok(exterior.some(f=>f.kind==='path'),'missing building access path');\n  assert.ok(exterior.some(f=>f.kind==='roadside-tree'),'missing irregular roadside vegetation');",
  'world morphology details test',
);
worldTest = replaceOnce(
  worldTest,
  '    "world.ts",\n    "geometry.ts",',
  '    "world.ts",\n    "geometry.ts",\n    "settlement-exterior.ts",',
  'determinism source coverage',
);
write('tests/world.test.ts', worldTest);

console.log('WP-S004 morphology completion patch applied');
