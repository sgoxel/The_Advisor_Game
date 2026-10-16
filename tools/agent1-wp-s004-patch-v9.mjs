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
  '        chosen = plot.candidates.find((candidate) => {\n          if (!plotAt(featureKind, candidate.x, candidate.z)) return false;\n          if (occupied.some((other) => Math.hypot(wrapSourceX(candidate.x - other.x), candidate.z - other.z) < plot.clearanceRadius + other.radius)) return false;',
  '        chosen = plot.candidates.find((candidate) => {\n          if (!plotAt(featureKind, candidate.x, candidate.z)) return false;\n          const servingStreet = settlementStreetAt(place, candidate.x, candidate.z),\n            footprintClearance = Math.max(1.5, Math.min(plot.width, plot.depth) * .48);\n          if (servingStreet && servingStreet.distance < servingStreet.width * .5 + footprintClearance + 1.2) return false;\n          if (occupied.some((other) => Math.hypot(wrapSourceX(candidate.x - other.x), candidate.z - other.z) < plot.clearanceRadius + other.radius)) return false;',
  'internal street clearance',
);
write('src/world.ts', world);

let geometry = read('src/geometry.ts');
geometry = replaceOnce(
  geometry,
  '      } else if (f.kind === "garden") {\n        const yaw = f.yawRad || 0, w = f.footprintWidth || 9, d = f.footprintDepth || 8;\n        structures.boxYaw(x, y + .02, z, w, .08, d, yaw, color(117, 132, 71));\n        if (t.size <= 64) {\n          for (const lz of [-d / 2, d / 2]) detail.boxYaw(x, y + .12, z + Math.cos(yaw) * lz, w, .18, .16, yaw, timber);\n          for (const lx of [-w * .28, 0, w * .28]) { const c = Math.cos(yaw), s = Math.sin(yaw), qx = x + lx * c, qz = z - lx * s; detail.boxYaw(qx, y + .13, qz, .42, .3, d * .72, yaw, color(151, 126, 62)); }\n        }',
  '      } else if (f.kind === "garden") {\n        const yaw = f.yawRad || 0, w = f.footprintWidth || 9, d = f.footprintDepth || 8;\n        structures.boxYaw(x, y + .02, z, w, .08, d, yaw, color(117, 132, 71));\n        if (t.size <= 64) {\n          const c = Math.cos(yaw), s = Math.sin(yaw), off = (lx: number, lz: number) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });\n          for (const lz of [-d / 2, d / 2]) { const q = off(0, lz); detail.boxYaw(q.x, y + .12, q.z, w, .18, .16, yaw, timber); }\n          for (const lx of [-w * .28, 0, w * .28]) { const q = off(lx, 0); detail.boxYaw(q.x, y + .13, q.z, .42, .3, d * .72, yaw, color(151, 126, 62)); }\n        }',
  'rotated garden geometry',
);
geometry = replaceOnce(
  geometry,
  '      } else if (f.kind === "tree" || f.kind === "roadside-tree") {\n        const climate = climateSampleAt(sourceToLonLat(x, z), y),\n          family = climate.forestFamily || (f.kind === "roadside-tree" ? "temperate-deciduous-mixed" : undefined);\n        if (!family) continue;',
  '      } else if (f.kind === "tree" || f.kind === "roadside-tree") {\n        const climate = climateSampleAt(sourceToLonLat(x, z), y),\n          roadsideFamily = climate.zone === "Arid" || climate.terrainClass === "dryland" || climate.terrainClass === "desert"\n            ? "warm-dry-woodland"\n            : climate.zone === "Subpolar" || climate.zone === "Cold temperate" || climate.zone === "Alpine"\n              ? "conifer-boreal"\n              : "temperate-deciduous-mixed",\n          family = climate.forestFamily || (f.kind === "roadside-tree" ? roadsideFamily : undefined);\n        if (!family) continue;',
  'climate compatible roadside tree',
);
write('src/geometry.ts', geometry);

console.log('WP-S004 morphology hardening patch applied');
