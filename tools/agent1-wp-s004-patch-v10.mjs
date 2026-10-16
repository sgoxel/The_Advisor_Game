import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`missing patch anchor: ${label}`);
  return text.replace(before, after);
}

let world = read('src/world.ts');
world = replaceOnce(
  world,
  '  kind: "house" | "keep" | "tree" | "roadside-tree" | "rock" | "garden" | "field" | "well" | "service" | "path" | "street" | "border" | "gate" | "guard-post";',
  '  kind: "house" | "keep" | "tree" | "roadside-tree" | "rock" | "garden" | "field" | "well" | "service" | "path" | "pavement" | "street" | "border" | "gate" | "guard-post";',
  'pavement feature kind',
);
world = replaceOnce(
  world,
  '          const servingStreet = settlementStreetAt(place, candidate.x, candidate.z),\n            footprintClearance = Math.max(1.5, Math.min(plot.width, plot.depth) * .48);\n          if (servingStreet && servingStreet.distance < servingStreet.width * .5 + footprintClearance + 1.2) return false;',
  '          const servingStreet = settlementStreetAt(place, candidate.x, candidate.z);\n          if (servingStreet && servingStreet.distance < servingStreet.width * .5 + plot.clearanceRadius + 1.5) return false;\n          if (surfaceRoadAt(candidate.x, candidate.z, plot.clearanceRadius + 6).distance <= plot.clearanceRadius + 6) return false;\n          if (featureKind !== "field" && plan.gates.some((gate) => Math.hypot(wrapSourceX(candidate.x - gate.x), candidate.z - gate.z) < plot.clearanceRadius + 12)) return false;',
  'full footprint road and gate clearance',
);
world = replaceOnce(
  world,
  '    for (const gate of plan.gates) {\n      const gateYaw = Math.PI / 2 - gate.bearingRad;',
  '    const pedestrianStreets = plan.streets.slice(0, place.kind === "city" ? Math.min(2, plan.streets.length) : 1);\n    for (const street of pedestrianStreets) {\n      const side = (digest(`${place.code}/PAVEMENT/${street.id}/SIDE`) & 1) === 0 ? -1 : 1;\n      for (let index = 1; index < street.points.length; index++) {\n        const a = street.points[index - 1], b = street.points[index], dx = wrapSourceX(b.x - a.x), dz = b.z - a.z, length = Math.hypot(dx, dz);\n        if (length < 1) continue;\n        const nx = -dz / length, nz = dx / length, offset = side * (street.width * .5 + 2.25),\n          x = wrapSourceX(a.x + dx * .5 + nx * offset), z = a.z + dz * .5 + nz * offset;\n        if (plan.gates.some((gate) => Math.hypot(wrapSourceX(x - gate.x), z - gate.z) < 11)) continue;\n        add("pavement", x, z, digest(`${street.id}/PAVEMENT/${index}`), `${place.id}/pavement/${street.id}/${index}`, {\n          label: "Packed pedestrian edge", yawRad: Math.atan2(dx, dz), footprintWidth: 1.5, footprintDepth: length, length,\n        });\n      }\n    }\n    for (const gate of plan.gates) {\n      const gateYaw = Math.PI / 2 - gate.bearingRad;',
  'pedestrian public edge',
);
write('src/world.ts', world);

let geometry = read('src/geometry.ts');
geometry = replaceOnce(
  geometry,
  '      } else if (f.kind === "path") {\n        structures.boxYaw(x, y + .015, z, f.footprintWidth || 1.25, .06, f.length || f.footprintDepth || 3, f.yawRad || 0, color(137, 116, 79));\n      } else if (f.kind === "street") {',
  '      } else if (f.kind === "path") {\n        structures.boxYaw(x, y + .015, z, f.footprintWidth || 1.25, .06, f.length || f.footprintDepth || 3, f.yawRad || 0, color(137, 116, 79));\n      } else if (f.kind === "pavement") {\n        structures.boxYaw(x, y + .018, z, f.footprintWidth || 1.5, .075, f.length || f.footprintDepth || 3, f.yawRad || 0, color(154, 141, 111));\n      } else if (f.kind === "street") {',
  'pavement geometry',
);
write('src/geometry.ts', geometry);

let worldTest = read('tests/world.test.ts');
worldTest = replaceOnce(
  worldTest,
  "  assert.ok(exterior.some(f=>f.kind==='path'),'missing building access path');\n  assert.ok(exterior.some(f=>f.kind==='roadside-tree'),'missing irregular roadside vegetation');",
  "  assert.ok(exterior.some(f=>f.kind==='path'),'missing building access path');\n  assert.ok(exterior.some(f=>f.kind==='pavement'),'missing pedestrian/public edge');\n  assert.ok(exterior.some(f=>f.kind==='roadside-tree'),'missing irregular roadside vegetation');",
  'representative pavement test',
);
write('tests/world.test.ts', worldTest);

console.log('WP-S004 pedestrian and clearance completion patch applied');
